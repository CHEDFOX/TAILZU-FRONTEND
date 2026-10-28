// node --test --experimental-strip-types src/sdui/outboxCore.test.ts
//
// The outbox: asks typed while offline are kept with when they were typed, survive the app closing, and go out once the connection
// is back, in order, each with its own client id (the server answers an id once). A refusal that will not change fails that ask and
// the next goes; anything else waits and holds the ones after it.

import test from "node:test";
import assert from "node:assert";
import { clockText, Outbox, retryable, type OutboxIO } from "./outboxCore.ts";
import { decideNav, liveSourceOf, openableHost, parseLiveMessage, sendScript } from "./liveViewRules.ts";

function io(o: { fail?: (path: string, body: Record<string, unknown>) => unknown; disk?: { v: string | null }; ids?: string } = {}) {
  let t = Date.UTC(2026, 9, 28, 4, 8);   // 9:38 in India
  let n = 0;
  const disk = o.disk ?? { v: null as string | null };
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  const x: OutboxIO & { sent: typeof sent; disk: typeof disk; tick(ms: number): void } = {
    sent, disk,
    load: async () => disk.v,
    save: async (j) => { disk.v = j; },
    send: async (path, body) => {
      const err = o.fail?.(path, body);
      if (err) throw err;
      sent.push({ path, body });
      return { ok: true };
    },
    now: () => t,
    newId: () => `${o.ids ?? "id"}-${String(++n).padStart(4, "0")}`,
    timeText: () => "9:38",
    tick: (ms) => { t += ms; },
  };
  return x;
}

const ask = (label: string) => ({ path: "/v1/shell/ask", body: { message: label, bot: "any", device: "phone", mode: "text" }, label, sub: "Any bot · asked {time}" });

test("an ask is kept with its own id and when it was typed, and goes out once, with both", async () => {
  const d = io();
  const box = new Outbox(d);
  await box.ready();
  const e = box.add(ask("Move gym to 7 am on Thursday"))!;
  assert.equal(e.sub, "Any bot · asked 9:38");
  assert.deepEqual(box.view(), { outbox: [{ id: "id-0001", label: "Move gym to 7 am on Thursday", sub: "Any bot · asked 9:38", state: "waiting", typedAt: e.typedAt }], outboxWaiting: 1 });
  assert.equal(await box.flush(false), 0);   // offline: nothing goes
  assert.equal(await box.flush(true), 1);
  assert.deepEqual(d.sent, [{ path: "/v1/shell/ask", body: { message: "Move gym to 7 am on Thursday", bot: "any", device: "phone", mode: "text", clientId: "id-0001", typedAt: e.typedAt } }]);
  assert.equal(box.view().outbox[0]!.state, "sent");
  assert.equal(box.view().outboxWaiting, 0);
  assert.equal(await box.flush(true), 0);   // sent is sent
});

test("they go in order; a failure that may pass holds the rest, and the next try comes later", async () => {
  let down = true;
  const d = io({ fail: () => (down ? Object.assign(new Error("offline"), {}) : null) });
  const box = new Outbox(d);
  box.add(ask("first")); box.add(ask("second"));
  assert.equal(await box.flush(true), 0);
  assert.deepEqual(box.view().outbox.map((x) => x.state), ["waiting", "waiting"]);
  down = false;
  assert.equal(await box.flush(true), 0);   // too soon: it waits its turn (2 s)
  d.tick(2_000);
  assert.equal(await box.flush(true), 2);
  assert.deepEqual(d.sent.map((s) => s.body.message), ["first", "second"]);
});

test("a refusal that will not change fails that ask, the next still goes; it can be tried again or taken out", async () => {
  const d = io({ fail: (_p, b) => (b.message === "bad" ? { status: 422 } : null) });
  const box = new Outbox(d);
  box.add(ask("bad")); box.add(ask("good"));
  assert.equal(await box.flush(true), 1);
  assert.deepEqual(box.view().outbox.map((x) => x.state), ["failed", "sent"]);
  assert.equal(box.retry("id-0001"), true);
  assert.equal(box.view().outbox[0]!.state, "waiting");
  assert.equal(box.remove("id-0001"), true);
  assert.equal(box.remove("id-0002"), false);   // a sent one stays until it is cleared
  box.clear();
  assert.deepEqual(box.view().outbox, []);
  assert.equal(retryable({ status: 409 }), true);   // still on its way
  assert.equal(retryable({ status: 401 }), true);   // the session renews
  assert.equal(retryable({ status: 503 }), true);
  assert.equal(retryable(new TypeError("Network request failed")), true);
  assert.equal(retryable({ status: 400 }), false);
});

test("kept across a restart: one that was on its way waits again, and an ask typed meanwhile stays after the kept ones", async () => {
  const disk = { v: null as string | null };
  const first = new Outbox(io({ disk, fail: () => ({ status: 503 }) }));
  first.add(ask("kept"));
  await first.flush(true);
  // As if the app stopped mid-send.
  const rows = JSON.parse(disk.v!);
  rows[0].state = "sending";
  disk.v = JSON.stringify(rows);
  const second = new Outbox(io({ disk, ids: "later" }));
  second.add(ask("typed now"));
  await second.ready();
  assert.deepEqual(second.view().outbox.map((x) => [x.label, x.state]), [["kept", "waiting"], ["typed now", "waiting"]]);
  // Bad rows on disk are dropped, not trusted.
  const third = new Outbox(io({ disk: { v: JSON.stringify([{ id: 1 }, null, "x"]) } }));
  await third.ready();
  assert.deepEqual(third.view().outbox, []);
});

test("only /v1/ routes, only something typed, and a full outbox takes no more; sent ones go after a day", async () => {
  const d = io();
  const box = new Outbox(d, { max: 2 });
  assert.equal(box.add({ ...ask("x"), path: "https://evil.example/v1/x" }), null);
  assert.equal(box.add({ ...ask("x"), path: "/v1/../admin" }), null);
  assert.equal(box.add({ ...ask("  "), label: "  " }), null);
  box.add(ask("a")); box.add(ask("b"));
  assert.equal(box.add(ask("c")), null);
  await box.flush(true);
  assert.ok(box.add(ask("c")));   // a sent one makes room
  d.tick(25 * 3600_000);
  box.add(ask("d"));
  assert.deepEqual(box.view().outbox.map((x) => x.label), ["c", "d"]);
});

test("the time an ask was typed reads as a phone shows it", () => {
  assert.equal(clockText(0, new Date(2026, 9, 28, 9, 38)), "9:38");
  assert.equal(clockText(0, new Date(2026, 9, 28, 21, 5)), "9:05");
  assert.equal(clockText(0, new Date(2026, 9, 28, 0, 0)), "12:00");
});

// ------------------------------------------------------------------ the live view's rules

test("a live page comes only from http(s), data: or about:, or the html the server wrote", () => {
  assert.deepEqual(liveSourceOf({ url: "https://preview.example/app" }), { kind: "url", url: "https://preview.example/app" });
  assert.deepEqual(liveSourceOf({ url: "data:text/html,<p>hi</p>" }), { kind: "url", url: "data:text/html,<p>hi</p>" });
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "tulmi://x", "https://user:pass@x.example/", "intent://x", "", 42]) {
    assert.equal(liveSourceOf({ url }), null, String(url));
  }
  assert.deepEqual(liveSourceOf({ html: "<p>x</p>", origin: "https://tailzu.space/path" }), { kind: "html", html: "<p>x</p>", baseUrl: "https://tailzu.space/" });
  assert.deepEqual(liveSourceOf({ html: "<p>x</p>", origin: "http://tailzu.space" }), { kind: "html", html: "<p>x</p>", baseUrl: "about:blank" });
  assert.deepEqual(liveSourceOf({ html: "<p>x</p>" }), { kind: "html", html: "<p>x</p>", baseUrl: "about:blank" });
});

test("the page stays where it was put: its frames load, the top moves only within its own site, an address that leaves is offered", () => {
  const page = liveSourceOf({ html: "<p>x</p>", origin: "https://tailzu.space" })!;
  assert.equal(decideNav({ source: page, url: "https://tailzu.space/", topFrame: true, settled: false }), "allow");
  assert.equal(decideNav({ source: page, url: "https://tailzu.space/other", topFrame: true, settled: true }), "offer");
  assert.equal(decideNav({ source: page, url: "https://viewer.example/?type=react", topFrame: false, settled: true }), "allow");
  assert.equal(decideNav({ source: page, url: "https://evil.example/", topFrame: true, settled: false }), "offer");
  assert.equal(decideNav({ source: page, url: "javascript:alert(1)", topFrame: false, settled: true }), "block");
  assert.equal(decideNav({ source: page, url: "tel:123", topFrame: true, settled: true }), "block");
  const site = liveSourceOf({ url: "https://preview.example/app" })!;
  assert.equal(decideNav({ source: site, url: "https://preview.example/cart", topFrame: true, settled: true }), "allow");
  assert.equal(decideNav({ source: site, url: "https://other.example/", topFrame: true, settled: true }), "offer");
  assert.equal(decideNav({ source: site, url: "about:blank", topFrame: true, settled: true }), "allow");
  assert.equal(openableHost("https://example.com:8443/a?b"), "example.com");
  assert.equal(openableHost("https://u:p@example.com/"), null);
  assert.equal(openableHost("mailto:a@b.c"), null);
});

test("what the page says: small objects with a t, nothing else; what the app says back is one safe line", () => {
  assert.deepEqual(parseLiveMessage('{"t":"select","id":"5:86"}'), { t: "select", id: "5:86" });
  for (const raw of ["", "nope", "[1]", '{"x":1}', '{"t":""}', `{"t":"${"x".repeat(40)}"}`, `{"t":"a","p":"${"x".repeat(9000)}"}`, null, 7]) {
    assert.equal(parseLiveMessage(raw), null, String(raw).slice(0, 40));
  }
  assert.equal(sendScript({ pick: true }), 'try { if (typeof window.tzLive === "function") window.tzLive({"pick":true}); } catch (e) {} true;');
  assert.equal(sendScript(null), null);
  assert.equal(sendScript([1]), null);
  assert.ok(!sendScript({ s: "a\u2028b" })!.includes("\u2028"));
});
