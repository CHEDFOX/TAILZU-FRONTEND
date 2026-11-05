// node --test --experimental-strip-types src/sdui/voice/voiceLiveCore.test.ts
//
// Live words, turn by turn: a turn ends after 900 ms of silence only with words; a chat listens again unless stopWhen
// holds; no words ends it quietly; stop drops the words; the level is made up from the words and decays; a turn with two
// finals and a partial gives all three, in order; going to the background ends the session.
import test from "node:test";
import assert from "node:assert";
import { LEVEL, VoiceSession, countWords, joinTurn, levelOnWords, type StreamEvents, type VoiceIO, type VoiceSpec } from "./voiceLiveCore.ts";

/** A fake clock and stream: timers run when the test moves the clock. */
function rig(spec: Partial<VoiceSpec> = {}, o: { stopWhen?: () => boolean; heardMs?: number } = {}) {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const log: string[] = [];
  const heard: string[] = [];
  const levels: number[] = [];
  let words = "";
  let on: StreamEvents | null = null;
  let opened = 0, stopped = 0, cancelled = 0;
  const ended: string[] = [];
  const failed: Array<[string, string | undefined]> = [];
  const io: VoiceIO = {
    open(ev) { on = ev; opened++; log.push("open"); return { stop: () => { stopped++; log.push("stop"); }, cancel: () => { cancelled++; log.push("cancel"); } }; },
    status(s) { log.push(`status:${s}`); },
    words(t) { words = t; },
    level(v) { levels.push(v); },
    async heard(t) {
      heard.push(t);
      log.push(`heard:${t}`);
      if (o.heardMs) await new Promise<void>((res) => { const id = ++seq; timers.set(id, { at: now + o.heardMs!, fn: res }); });
    },
    stopWhen: () => (o.stopWhen ? o.stopWhen() : false),
    ended(why) { ended.push(why); },
    failed(m, c) { failed.push([m, c]); },
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(h) { timers.delete(h as number); },
  };
  const s = new VoiceSession({ mode: "once", ...spec }, io);
  /** Move the clock, running every timer due on the way, in order. */
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
    now = end;
    await Promise.resolve(); await Promise.resolve();
  }
  return { s, io, log, heard, levels, ended, failed, get words() { return words; }, get on() { return on!; }, advance, get opened() { return opened; }, get stopped() { return stopped; }, get cancelled() { return cancelled; } };
}

test("a turn ends after 900 ms of silence, and only with words", async () => {
  const r = rig();
  r.s.start();
  assert.strictEqual(r.s.status, "listening");
  await r.advance(3000);
  assert.strictEqual(r.heard.length, 0, "no words: no turn end, however long the pause");
  r.on.partial("dinner");
  await r.advance(500);
  r.on.partial("dinner is");
  await r.advance(850);
  assert.strictEqual(r.heard.length, 0, "a word came 850 ms ago: still listening");
  r.on.partial("dinner is ready");
  await r.advance(899);
  assert.strictEqual(r.heard.length, 0);
  await r.advance(2);
  assert.strictEqual(r.stopped, 1, "the stream is asked to finish");
  r.on.final("dinner is ready.");
  r.on.closed();
  await r.advance(0);
  assert.deepStrictEqual(r.heard, ["dinner is ready."], "its last final, taken over the partial");
  assert.deepStrictEqual(r.ended, ["done"], "once: one turn");
  assert.strictEqual(r.s.status, "");
  assert.strictEqual(r.words, "", "the words go when it is over");
  assert.ok(r.log.includes("status:sending"));
});

test("a closing turn that never hears its last final takes the words it has after the grace", async () => {
  const r = rig({ graceMs: 700 });
  r.s.start();
  r.on.partial("see you at seven");
  await r.advance(900);
  assert.strictEqual(r.heard.length, 0);
  await r.advance(700);
  assert.deepStrictEqual(r.heard, ["see you at seven"]);
});

test("a turn with two finals and a partial gives all three, in order", async () => {
  const r = rig();
  r.s.start();
  r.on.partial("mom");
  r.on.final("Mom,");
  await r.advance(400);
  r.on.partial("dinner");
  r.on.final("dinner is ready");
  await r.advance(600);
  r.on.partial("come down");
  assert.strictEqual(r.words, "Mom, dinner is ready come down", "LiveWords sees the whole turn");
  await r.advance(900);
  await r.advance(700);
  assert.deepStrictEqual(r.heard, ["Mom, dinner is ready come down"]);
  assert.strictEqual(joinTurn(["a ", " b"], " c "), "a b c");
});

test("a chat listens again after each turn, unless stopWhen holds", async () => {
  let ask = false;
  const r = rig({ mode: "chat" }, { stopWhen: () => ask, heardMs: 300 });
  r.s.start();
  r.on.partial("what's on today");
  await r.advance(900);
  r.on.closed();
  await r.advance(0);
  assert.strictEqual(r.s.status, "sending", "he sends while onHeard runs");
  await r.advance(300);
  assert.strictEqual(r.s.status, "listening", "and listens again");
  assert.strictEqual(r.opened, 2);
  assert.strictEqual(r.words, "", "empty between turns");
  r.on.partial("and tomorrow");
  await r.advance(900);
  r.on.closed();
  await r.advance(300);
  assert.deepStrictEqual(r.heard, ["what's on today", "and tomorrow"]);
  assert.strictEqual(r.opened, 3);
  ask = true;
  r.on.partial("mom dinner");
  await r.advance(900);
  r.on.closed();
  await r.advance(300);
  assert.strictEqual(r.opened, 3, "stopWhen held: no new turn");
  assert.deepStrictEqual(r.ended, ["done"]);
});

test("no words ends it quietly: 8 s in the first turn, 12 s in a chat's later turn", async () => {
  const a = rig();
  a.s.start();
  await a.advance(7999);
  assert.deepStrictEqual(a.ended, []);
  await a.advance(1);
  assert.deepStrictEqual(a.ended, ["quiet"]);
  assert.strictEqual(a.cancelled, 1, "the stream is dropped");
  const b = rig({ mode: "chat" });
  b.s.start();
  b.on.partial("hello");
  await b.advance(900);
  b.on.closed();
  await b.advance(0);
  await b.advance(11999);
  assert.deepStrictEqual(b.ended, []);
  await b.advance(1);
  assert.deepStrictEqual(b.ended, ["quiet"]);
});

test("stop ends it at once and drops the words of the turn", async () => {
  const r = rig({ mode: "chat" });
  r.s.start();
  r.on.partial("never mind");
  await r.advance(300);
  r.s.stop();
  await r.advance(5000);
  assert.deepStrictEqual(r.heard, [], "nothing sent");
  assert.deepStrictEqual(r.ended, ["stop"]);
  assert.strictEqual(r.cancelled, 1);
  assert.strictEqual(r.words, "");
  r.on.partial("late words");
  await r.advance(2000);
  assert.deepStrictEqual(r.heard, [], "a late event from the dropped stream does nothing");
  r.s.stop();
  assert.deepStrictEqual(r.ended, ["stop"], "stop is idempotent");
});

test("going to the background ends the session", async () => {
  const r = rig({ mode: "chat" });
  r.s.start();
  r.on.partial("half a");
  r.s.background();
  await r.advance(2000);
  assert.deepStrictEqual(r.ended, ["background"]);
  assert.deepStrictEqual(r.heard, []);
  assert.strictEqual(r.s.status, "");
});

test("the level is made up from the words and decays", async () => {
  const r = rig();
  r.s.start();
  r.on.partial("one");
  assert.strictEqual(r.levels.at(-1), levelOnWords(1));
  assert.ok(Math.abs(levelOnWords(1) - 0.65) < 1e-9 && levelOnWords(9) === 1);
  await r.advance(LEVEL.tickMs);
  assert.ok(Math.abs(r.levels.at(-1)! - 0.65 * LEVEL.decay) < 1e-9, "decays x0.85 every 80 ms");
  r.on.partial("one two three");
  assert.ok(Math.abs(r.levels.at(-1)! - 0.75) < 1e-9, "two new words");
  await r.advance(800);
  assert.ok(r.levels.at(-1)! < 0.2, "fades while it is quiet");
  assert.strictEqual(countWords("  a  b "), 2);
});

test("errors: no microphone says so; a failed open says so; both end it", async () => {
  const r = rig();
  r.s.start();
  r.on.error("", "permission");
  assert.deepStrictEqual(r.failed, [["", "permission"]]);
  assert.deepStrictEqual(r.ended, ["error"]);
  const io = rig().io;
  io.open = () => { throw new Error("no stream"); };
  const ended: string[] = [];
  io.ended = (w) => { ended.push(w); };
  const s = new VoiceSession({}, io);
  s.start();
  assert.deepStrictEqual(ended, ["error"]);
});

test("a session never runs past its longest", async () => {
  const r = rig({ mode: "chat", maxMs: 5000 });
  r.s.start();
  for (let i = 0; i < 4; i++) { r.on.partial(`word ${i}`); await r.advance(800); }
  await r.advance(2000);
  assert.ok(r.ended.includes("max") || r.ended.includes("done"));
  assert.ok(r.s.done);
});
