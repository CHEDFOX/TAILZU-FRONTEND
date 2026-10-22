// node --test --experimental-strip-types src/sdui/holdToSpeak.test.ts
//
// Each case is a thing a thumb does to a held mic button.

import test from "node:test";
import assert from "node:assert";
import { createHold, type HoldIO } from "./holdToSpeak.ts";

function rig(over: Partial<HoldIO> = {}) {
  const log: string[] = [];
  let clock = 0;
  let release: (ok: boolean) => void = () => {};
  const io: HoldIO = {
    prepare: () => new Promise<boolean>((r) => { release = r; log.push("prepare"); }),
    record: () => log.push("record"),
    finish: async () => { log.push("finish"); },
    discard: async () => { log.push("discard"); },
    busy: () => false,
    now: () => clock,
    minMs: () => 350,
    ...over,
  };
  return { hold: createHold(io), log, tick: (ms: number) => { clock += ms; }, ready: (ok = true) => release(ok) };
}
const flush = () => new Promise((r) => setImmediate(r));

test("hold, speak, let go: it records and then sends", async () => {
  const r = rig();
  const p = r.hold.press();
  r.ready();
  await p;
  assert.equal(r.hold.recording, true);
  r.tick(1500);
  await r.hold.release();
  assert.deepEqual(r.log, ["prepare", "record", "finish"]);
  assert.equal(r.hold.recording, false);
});

test("a finger lifted while the recorder is still getting ready starts nothing", async () => {
  const r = rig();
  const p = r.hold.press();
  await r.hold.release();
  r.ready();
  await p;
  assert.deepEqual(r.log, ["prepare"]);
  assert.equal(r.hold.recording, false);
});

test("a tap is not a recording: too short, it is dropped and never sent", async () => {
  const r = rig();
  const p = r.hold.press();
  r.ready();
  await p;
  r.tick(120);
  await r.hold.release();
  assert.deepEqual(r.log, ["prepare", "record", "discard"]);
});

test("the shortest hold that counts is the server's number", async () => {
  const r = rig({ minMs: () => 600 });
  const p = r.hold.press();
  r.ready();
  await p;
  r.tick(500);
  await r.hold.release();
  assert.deepEqual(r.log.slice(-1), ["discard"]);
});

test("a second press while the first is still starting does not start a second recording", async () => {
  const r = rig();
  const a = r.hold.press();
  const b = r.hold.press();
  r.ready();
  await Promise.all([a, b]);
  assert.deepEqual(r.log, ["prepare", "record"]);
});

test("a release the instant after record() still finds the recording", async () => {
  const r = rig();
  const p = r.hold.press();
  r.ready();
  await p;
  r.tick(1000);
  const done = r.hold.release();
  assert.equal(r.hold.recording, false, "armed is cleared synchronously");
  await done;
  assert.deepEqual(r.log, ["prepare", "record", "finish"]);
});

test("not allowed to use the mic: nothing records", async () => {
  const r = rig();
  const p = r.hold.press();
  r.ready(false);
  await p;
  await r.hold.release();
  assert.deepEqual(r.log, ["prepare"]);
});

test("while a recording is being transcribed, presses are ignored", async () => {
  const r = rig({ busy: () => true });
  await r.hold.press();
  assert.deepEqual(r.log, []);
});

test("a release with nothing held does nothing, and the next hold works", async () => {
  const r = rig();
  await r.hold.release();
  const p = r.hold.press();
  r.ready();
  await p;
  r.tick(900);
  await r.hold.release();
  await flush();
  assert.deepEqual(r.log, ["prepare", "record", "finish"]);
});
