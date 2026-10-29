// node --test --experimental-strip-types src/widgets/nowCore.test.ts
//
// The quick-access widgets' rules: only this app's links reach a widget, only documents it reads, buttons it knows; when to fetch;
// when to ask for a new narrow token; ids and keys.

import test from "node:test";
import assert from "node:assert";
import { actKey, cleanNow, fetchDue, installId, isAppLink, tokenDue } from "./nowCore.ts";

test("only this app's own links", () => {
  for (const ok of ["tulmi://screen/bots.thread?id=a", "com.tulmi.app://screen/x", "https://app.x0bot.com/s/bots.spaces", "https://x0bot.com/s/x", "https://app.tailzu.space/s/x"]) {
    assert.equal(isAppLink(ok), true, ok);
  }
  for (const bad of ["", "javascript:alert(1)", "https://evil.com/s/x", "http://app.x0bot.com/s/x", "https://app.x0bot.com.evil.com/x", "tulmi://screen/a b", "intent://x", "file:///etc", 42, null]) {
    assert.equal(isAppLink(bad), false, String(bad));
  }
});

test("a document this build reads, with every link and button checked", () => {
  assert.equal(cleanNow(null), null);
  assert.equal(cleanNow({ v: 99, people: {}, needs: {} }), null);
  const doc = cleanNow({
    v: 1, rev: "abc",
    people: { on: true, url: "https://evil.com", rows: [
      { id: "msg:t:m", kind: "message", url: "tulmi://screen/bots.thread?id=t", line: "Sam: running late" },
      { id: "item:i", kind: "shared", url: "https://evil.com/x" },
      { nope: true },
    ], empty: { title: "x", url: "javascript:x" } },
    needs: { on: true, rows: [{ id: "stask:s:t", kind: "task", url: "tulmi://screen/x", actions: [
      { id: "done", label: "Done", mode: "inPlace", style: "primary" },
      { id: "open", label: "Open", mode: "open", url: "https://evil.com" },
      { id: "x", label: "X", mode: "explode" },
      { id: "BAD ID", label: "y", mode: "inPlace" },
    ] }] },
  })!;
  const people = doc.people as { url: string; rows: Array<{ url: string }>; empty: { url: string } };
  assert.equal(people.url, "");
  assert.deepEqual(people.rows.map((r) => r.url), ["tulmi://screen/bots.thread?id=t", ""]);
  assert.equal(people.empty.url, "");
  const actions = (doc.needs as { rows: Array<{ actions: Array<{ id: string }> }> }).rows[0]!.actions;
  assert.deepEqual(actions.map((a) => a.id), ["done"]);
  assert.deepEqual(cleanNow({ v: 1 })!.people, { on: false, rows: [] });
});

test("fetches no more often than the server says, unless something just happened", () => {
  assert.equal(fetchDue(0, 1000, 60), true);
  assert.equal(fetchDue(1_000_000, 1_030_000, 60), false);
  assert.equal(fetchDue(1_000_000, 1_060_000, 60), true);
  assert.equal(fetchDue(1_000_000, 1_000_001, 60, true), true);
  assert.equal(fetchDue(1_000_000, 1_000_001, 0), true);
  assert.equal(fetchDue(1_000_000, 1_030_000, Number.NaN), false);
});

test("asks for a new token when there is none, it ran out, or half its life has gone", () => {
  const day = 86_400_000;
  assert.equal(tokenDue(null, 5), true);
  const meta = { issuedAt: 0, expiresAt: day };
  assert.equal(tokenDue(meta, day / 4), false);
  assert.equal(tokenDue(meta, day / 2), true);
  assert.equal(tokenDue({ ...meta, renewAt: 0.9 }, day / 2), false);
  assert.equal(tokenDue({ ...meta, renewAt: 7 }, day / 2), true);
  assert.equal(tokenDue(meta, day + 1), true);
});

test("ids and keys", () => {
  const id = installId(() => 0.5);
  assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(installId(), installId());
  assert.match(actKey(), /^[A-Za-z0-9_.:-]{8,120}$/);
  assert.notEqual(actKey(), actKey());
});
