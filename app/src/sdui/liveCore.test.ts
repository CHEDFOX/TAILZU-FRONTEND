// node --test --experimental-strip-types src/sdui/liveCore.test.ts
//
// Live updates on the phone: which events a screen hears, one quiet reload per burst and never on top of typing, a half-typed
// field kept through a reload, and the socket: signed in by its first message, answering pings, reconnecting with backoff, and
// saying when it is back after a gap.

import test from "node:test";
import assert from "node:assert";
import {
  backoffMs, CLOSE, hears, LiveClient, mergeLiveState, parseLiveMessage, reloadDelay, ReloadScheduler, wsUrlOf,
  type LiveSocket, type LiveTimers,
} from "./liveCore.ts";

/** A clock and timers moved by hand. */
function clock(start = 1_000_000) {
  let now = start;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: LiveTimers = {
    set: (fn, ms) => { const id = ++seq; due.set(id, { at: now + ms, fn }); return id; },
    clear: (h) => { due.delete(h as number); },
    now: () => now,
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...due.entries()].filter(([, d]) => d.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      due.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      await flush();
    }
    now = end;
    await flush();
  };
  return { timers, advance, pending: () => due.size };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("hears its own topics, a wildcard's family, and nothing else", () => {
  assert.equal(hears(["home", "bots"], "home"), true);
  assert.equal(hears(["home", "bots"], "keybot"), false);
  assert.equal(hears(["job:*"], "job:42"), true);
  assert.equal(hears(["job:*"], "jobs"), false);
  assert.equal(hears(["job:42"], "job:4"), false);
  assert.equal(hears(undefined, "home"), false);
  assert.equal(hears([], "home"), false);
});

test("the socket's address is the API's host with ws or wss, and no token in it", () => {
  assert.equal(wsUrlOf("https://api.x0bot.com"), "wss://api.x0bot.com/v1/live");
  assert.equal(wsUrlOf("http://192.168.1.4:8787/"), "ws://192.168.1.4:8787/v1/live");
  assert.equal(wsUrlOf("https://x.x0bot.com", "v1/live"), "wss://x.x0bot.com/v1/live");
});

test("reads only the server's own messages", () => {
  assert.deepEqual(parseLiveMessage('{"type":"ready","heartbeatMs":5000}'), { type: "ready", heartbeatMs: 5000 });
  assert.deepEqual(parseLiveMessage('{"type":"event","topic":"home","at":5}'), { type: "event", topic: "home", at: 5 });
  assert.equal(parseLiveMessage('{"type":"event"}'), null);
  assert.equal(parseLiveMessage("not json"), null);
  assert.equal(parseLiveMessage({ type: "ping" }), null);
  assert.equal(parseLiveMessage('{"type":"whatever"}'), null);
});

test("backs off 1 s, 2 s, 4 s … to 30 s, between half and all of it", () => {
  assert.equal(backoffMs(0, () => 1), 1000);
  assert.equal(backoffMs(0, () => 0), 500);
  assert.equal(backoffMs(3, () => 1), 8000);
  assert.equal(backoffMs(10, () => 1), 30_000);
  assert.equal(backoffMs(99, () => 0), 15_000);
});

test("a burst is one reload, 300 ms after its last event, and never more than a second after its first", async () => {
  const c = clock();
  let runs = 0;
  const s = new ReloadScheduler({ run: () => { runs++; }, timers: c.timers });
  s.poke(); await c.advance(100); s.poke(); await c.advance(100); s.poke();
  await c.advance(299);
  assert.equal(runs, 0);
  await c.advance(1);
  assert.equal(runs, 1);
  // A steady stream still reloads, once a second.
  for (let i = 0; i < 10; i++) { s.poke(); await c.advance(200); }
  assert.equal(runs, 3);
  s.cancel();
});

test("waits while the person types, then reloads once they pause (and at most 15 s later)", async () => {
  const c = clock();
  let typed = 0;
  let runs = 0;
  const s = new ReloadScheduler({ run: () => { runs++; }, lastTypedAt: () => typed, timers: c.timers });
  typed = c.timers.now();
  s.poke();
  await c.advance(1000);
  typed = c.timers.now();          // still typing
  await c.advance(1100);
  assert.equal(runs, 0);
  await c.advance(100);            // 1.2 s since the last keystroke
  assert.equal(runs, 1);
  // Typing without a pause: the reload goes by MAX_DEFER_MS anyway (the words are kept by mergeLiveState).
  s.poke();
  for (let i = 0; i < 40; i++) { typed = c.timers.now(); await c.advance(500); }
  assert.equal(runs, 2);
  s.cancel();
});

test("reloadDelay: settled, capped, and deferred for typing", () => {
  const o = { delayMs: 300, maxWaitMs: 1000, quietMs: 1200, maxDeferMs: 15_000 };
  assert.equal(reloadDelay(0, 0, 0, 0, o), 300);
  assert.equal(reloadDelay(900, 0, 900, 0, o), 100);
  assert.equal(reloadDelay(500, 0, 500, 400, o), 1100);
  assert.equal(reloadDelay(20_000, 0, 20_000, 19_999, o), 0);
});

test("one reload at a time; an event during one brings exactly one more after it", async () => {
  const c = clock();
  let runs = 0;
  let finish: () => void = () => {};
  const s = new ReloadScheduler({ run: () => { runs++; return new Promise<void>((r) => { finish = r; }); }, timers: c.timers });
  s.poke();
  await c.advance(300);
  assert.equal(runs, 1);
  s.poke(); s.poke();
  await c.advance(2000);
  assert.equal(runs, 1);
  finish();
  await flush();
  await c.advance(300);
  assert.equal(runs, 2);
  finish();
  await flush();
  await c.advance(5000);
  assert.equal(runs, 2);
  s.cancel();
});

test("a cancelled scheduler never runs", async () => {
  const c = clock();
  let runs = 0;
  const s = new ReloadScheduler({ run: () => { runs++; }, timers: c.timers });
  s.poke();
  s.cancel();
  await c.advance(5000);
  s.poke();
  await c.advance(5000);
  assert.equal(runs, 0);
});

test("mergeLiveState keeps what was typed here and takes the server's new word for the rest", () => {
  const prev = { ask: "", asking: false, prefs: { look: "light", height: "normal" }, items: [1, 2] };
  const local = { ask: "kal subah mil", asking: false, prefs: { look: "light", height: "tall" }, items: [1, 2], micGranted: true };
  const next = { ask: "", asking: false, prefs: { look: "dark", height: "normal" }, items: [1, 2, 3], fresh: "new" };
  assert.deepEqual(mergeLiveState(prev, local, next), [
    ["prefs.look", "dark"],
    ["items", [1, 2, 3]],
    ["fresh", "new"],
  ]);
});

test("mergeLiveState: nothing to write when nothing changed, and never a prototype path", () => {
  const s = { a: 1, b: { c: [1] } };
  assert.deepEqual(mergeLiveState(s, structuredClone(s), structuredClone(s)), []);
  const bad = JSON.parse('{"__proto__":{"x":1},"a.b":2,"ok":3}');
  assert.deepEqual(mergeLiveState({}, {}, bad), [["ok", 3]]);
  assert.deepEqual(mergeLiveState(undefined, undefined, { a: 1 }), [["a", 1]]);
});

/** A socket the test drives: what the client sent, and the server's side. */
class FakeSocket implements LiveSocket {
  sent: string[] = [];
  closedByClient = false;
  onopen: LiveSocket["onopen"] = null;
  onmessage: LiveSocket["onmessage"] = null;
  onclose: LiveSocket["onclose"] = null;
  onerror: LiveSocket["onerror"] = null;
  url: string;
  constructor(url: string) { this.url = url; }
  send(d: string) { this.sent.push(d); }
  close() { this.closedByClient = true; }
  open() { this.onopen?.(); }
  say(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop(code?: number) { this.onclose?.({ code }); }
}

function client(o: { token?: string | null } = {}) {
  const c = clock();
  const sockets: FakeSocket[] = [];
  const topics: string[] = [];
  let resumed = 0;
  const lc = new LiveClient({
    open: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
    url: () => "wss://api.x0bot.com/v1/live",
    token: () => (o.token === undefined ? "jwt-1" : o.token),
    onEvent: (t) => topics.push(t),
    onResume: () => { resumed++; },
    timers: c.timers,
    random: () => 1,
  });
  return { lc, c, sockets, topics, resumed: () => resumed };
}

test("signs in with its first message, never in the URL, and hears events once ready", async () => {
  const { lc, sockets, topics } = client();
  lc.start();
  await flush();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0]!.url.includes("jwt"), false);
  sockets[0]!.open();
  assert.deepEqual(JSON.parse(sockets[0]!.sent[0]!), { type: "auth", token: "jwt-1" });
  sockets[0]!.say({ type: "event", topic: "early" });   // before ready: not ours yet
  sockets[0]!.say({ type: "ready", heartbeatMs: 1000 });
  assert.equal(lc.connected, true);
  sockets[0]!.say({ type: "event", topic: "home" });
  assert.deepEqual(topics, ["home"]);
  sockets[0]!.say({ type: "ping" });
  assert.deepEqual(JSON.parse(sockets[0]!.sent[1]!), { type: "pong" });
  lc.stop();
  assert.equal(sockets[0]!.closedByClient, true);
});

test("reconnects with backoff, and says it is back (the screen reloads once)", async () => {
  const { lc, c, sockets, resumed } = client();
  lc.start();
  await flush();
  sockets[0]!.open();
  sockets[0]!.say({ type: "ready", heartbeatMs: 1000 });
  assert.equal(resumed(), 0);
  sockets[0]!.drop(1006);
  await c.advance(999);
  assert.equal(sockets.length, 1);
  await c.advance(1);
  assert.equal(sockets.length, 2);
  sockets[1]!.drop(1006);                       // refused again: 2 s this time
  await c.advance(1999);
  assert.equal(sockets.length, 2);
  await c.advance(1);
  assert.equal(sockets.length, 3);
  sockets[2]!.open();
  sockets[2]!.say({ type: "ready", heartbeatMs: 1000 });
  assert.equal(resumed(), 1);
  // Ready resets the backoff.
  sockets[2]!.drop(1006);
  await c.advance(1000);
  assert.equal(sockets.length, 4);
  lc.stop();
});

test("a socket that goes quiet for two and a half heartbeats is dropped and replaced", async () => {
  const { lc, c, sockets } = client();
  lc.start();
  await flush();
  sockets[0]!.open();
  sockets[0]!.say({ type: "ready", heartbeatMs: 1000 });
  await c.advance(2000);
  sockets[0]!.say({ type: "ping" });            // heard: the watch starts again
  await c.advance(2400);
  assert.equal(sockets[0]!.closedByClient, false);
  await c.advance(100);
  assert.equal(sockets[0]!.closedByClient, true);
  await c.advance(1000);
  assert.equal(sockets.length, 2);
  lc.stop();
});

test("a renewal reconnects at once; too many open waits long", async () => {
  const { lc, c, sockets } = client();
  lc.start();
  await flush();
  sockets[0]!.open();
  sockets[0]!.say({ type: "ready", heartbeatMs: 1000 });
  sockets[0]!.drop(CLOSE.renew);
  await c.advance(1000);
  assert.equal(sockets.length, 2);
  sockets[1]!.open();
  sockets[1]!.say({ type: "ready", heartbeatMs: 1000 });
  sockets[1]!.drop(CLOSE.tooMany);
  await c.advance(29_000);
  assert.equal(sockets.length, 2);
  await c.advance(1000);
  assert.equal(sockets.length, 3);
  lc.stop();
});

test("signed out: no socket, and it looks again later", async () => {
  const { lc, c, sockets } = client({ token: null });
  lc.start();
  await flush();
  assert.equal(sockets.length, 0);
  await c.advance(60_000);
  assert.equal(sockets.length, 0);
  lc.stop();
  assert.equal(c.pending(), 0);
});

test("stopped (the app went to the background): the socket closes, nothing is left waiting, and start comes back", async () => {
  const { lc, c, sockets, resumed } = client();
  lc.start();
  await flush();
  sockets[0]!.open();
  sockets[0]!.say({ type: "ready", heartbeatMs: 1000 });
  lc.stop();
  assert.equal(sockets[0]!.closedByClient, true);
  assert.equal(c.pending(), 0);
  lc.start();
  await flush();
  sockets[1]!.open();
  sockets[1]!.say({ type: "ready", heartbeatMs: 1000 });
  assert.equal(resumed(), 1);
  lc.stop();
});
