// node --test --experimental-strip-types src/sdui/voice/callRealtimeCore.test.ts
//
// The live call's rules: the phases the screen draws, the words it keeps, when the view is worth reading again, what a closed
// connection means, the echo-canceller list, the hard length that comes back from the server, and the write throttle.

import test from "node:test";
import assert from "node:assert";
import {
  CALL, SOFT_AEC_MODELS, actedWrites, aecFor, afterClose, callOn, callStart, dropCall, endCallNow, hasToolCall,
  holdCall, leaveCall, maxSecOf, overrunMsOf, stateOf, step, tail, writeWaitMs, type CallEvent, type CallState,
} from "./callRealtimeCore.ts";

/** Run a line of events through the rules, as the data channel delivers them. */
function run(events: CallEvent[], from: CallState = callStart()): { state: CallState; rereads: number } {
  let state = from;
  let rereads = 0;
  for (const e of events) {
    const r = step(state, e);
    state = r.next;
    if (r.reread) rereads++;
  }
  return { state, rereads };
}

test("a call starts connecting, with nothing said and the bot not yet heard", () => {
  assert.deepStrictEqual(callStart(), { phase: "connecting", spoke: false, said: "", heard: "", owed: false });
  assert.deepStrictEqual(stateOf(callStart()), { spoke: false });
});

test("the bot speaks: speaking, his words as they come, and from now a fallback skips the opening", () => {
  const { state } = run([
    { type: "output_audio_buffer.started" },
    { type: "response.output_audio_transcript.delta", delta: "Hello. " },
    { type: "response.output_audio_transcript.delta", delta: "Time to leave." },
  ]);
  assert.strictEqual(state.phase, "speaking");
  assert.strictEqual(state.said, "Hello. Time to leave.");
  assert.deepStrictEqual(stateOf(state), { spoke: true });
});

test("a new reply clears the last one's words", () => {
  const { state } = run([
    { type: "output_audio_buffer.started" },
    { type: "response.output_audio_transcript.delta", delta: "Done." },
    { type: "output_audio_buffer.stopped" },
    { type: "output_audio_buffer.started" },
  ]);
  assert.strictEqual(state.said, "");
});

test("he stops, she speaks, she stops: listening, listening, thinking", () => {
  let s = run([{ type: "output_audio_buffer.started" }]).state;
  s = run([{ type: "output_audio_buffer.stopped" }], s).state;
  assert.strictEqual(s.phase, "listening");
  s = run([{ type: "output_audio_buffer.started" }, { type: "input_audio_buffer.speech_started" }], s).state;
  // Barge-in shows at once, even mid-reply.
  assert.strictEqual(s.phase, "listening");
  s = run([{ type: "input_audio_buffer.speech_stopped" }], s).state;
  assert.strictEqual(s.phase, "thinking");
});

test("a cleared buffer is a stopped one", () => {
  const s = run([{ type: "output_audio_buffer.started" }, { type: "output_audio_buffer.cleared" }]).state;
  assert.strictEqual(s.phase, "listening");
});

test("the person's words are kept, cut at 300 characters from the start", () => {
  const long = "x".repeat(400);
  const s = run([{ type: "conversation.item.input_audio_transcription.completed", transcript: long }]).state;
  assert.strictEqual(s.heard.length, CALL.heardMax);
  const s2 = run([{ type: "conversation.item.input_audio_transcription.completed", transcript: "kal subah" }]).state;
  assert.strictEqual(s2.heard, "kal subah");
});

test("the bot's words keep their newest 280 characters", () => {
  const s = run([
    { type: "output_audio_buffer.started" },
    { type: "response.output_audio_transcript.delta", delta: "a".repeat(200) },
    { type: "response.output_audio_transcript.delta", delta: "b".repeat(200) },
  ]).state;
  assert.strictEqual(s.said.length, CALL.saidMax);
  assert.ok(s.said.endsWith("b"));
  assert.strictEqual(tail("abcdef", 3), "def");
  assert.strictEqual(tail("ab", 9), "ab");
});

test("a tool turn: thinking, and the view is read again after the next spoken reply, once", () => {
  const tool: CallEvent = { type: "response.done", response: { output: [{ type: "function_call", name: "mark_paid" }] } };
  assert.ok(hasToolCall(tool));
  let r = step(callStart(), tool);
  assert.strictEqual(r.next.phase, "thinking");
  assert.strictEqual(r.next.owed, true);
  assert.strictEqual(r.reread, false);
  // The spoken reply that follows asks for the read, and only that one.
  r = step(r.next, { type: "response.done", response: { output: [{ type: "message" }] } });
  assert.strictEqual(r.reread, true);
  assert.strictEqual(r.next.owed, false);
  r = step(r.next, { type: "response.done", response: { output: [{ type: "message" }] } });
  assert.strictEqual(r.reread, false);
});

test("a plain reply with no tool before it never reads the view", () => {
  const { rereads } = run([
    { type: "output_audio_buffer.started" },
    { type: "output_audio_buffer.stopped" },
    { type: "response.done", response: { output: [{ type: "message" }] } },
  ]);
  assert.strictEqual(rereads, 0);
  assert.strictEqual(hasToolCall({ type: "response.done", response: null }), false);
  assert.strictEqual(hasToolCall({ type: "response.done" }), false);
});

test("an event this build does not know, and a broken one, change nothing", () => {
  const start = callStart();
  for (const e of [{}, { type: 7 }, { type: "session.updated" }, { type: "error" }] as CallEvent[]) {
    assert.deepStrictEqual(step(start, e).next, start);
  }
});

test("after a tool turn, only the view's own actions are written, each path once", () => {
  const map = { paid: "paidDone", done: "itemDone", later: "itemDone" };
  assert.deepStrictEqual(actedWrites(["paid"], map), ["paidDone"]);
  assert.deepStrictEqual(actedWrites(["done", "later"], map), ["itemDone"]);
  // A name the screen did not ask about, and a name that is not a string, write nothing.
  assert.deepStrictEqual(actedWrites(["cant", 3, null], map), []);
  assert.deepStrictEqual(actedWrites(["paid"], undefined), []);
  assert.deepStrictEqual(actedWrites("paid", map), []);
  // Nothing inherited counts as a mapping.
  assert.deepStrictEqual(actedWrites(["toString", "__proto__"], map), []);
});

test("the media closed: still answered means the turn call takes over; ended means the call is over", () => {
  assert.strictEqual(afterClose({ state: "answered" }), "fallback");
  assert.strictEqual(afterClose({ state: "ended" }), "ended");
  assert.strictEqual(afterClose({ state: "missed" }), "ended");
  // A view we could not read falls back: the person keeps a working call either way.
  assert.strictEqual(afterClose(null), "fallback");
  assert.strictEqual(afterClose({}), "fallback");
});

test("the hard length comes from the server and is never raised past 15 minutes", () => {
  assert.strictEqual(maxSecOf(900), 900);
  assert.strictEqual(maxSecOf(420), 420);
  assert.strictEqual(maxSecOf(5000), CALL.maxSecCap);
  assert.strictEqual(maxSecOf(42.7), 42);
  for (const bad of [undefined, null, "x", -5, 0, NaN]) assert.strictEqual(maxSecOf(bad), 0);
  assert.strictEqual(overrunMsOf(900), 900_000 + CALL.overrunMs);
  // No usable reply: no backstop timer, because there is no length to overrun.
  assert.strictEqual(overrunMsOf(0), 0);
});

test("state writes are throttled to ten a second, and the wait is what is left of the tick", () => {
  assert.strictEqual(writeWaitMs(1000, 1000 + CALL.writeMs), 0);
  assert.strictEqual(writeWaitMs(1000, 5000), 0);
  assert.strictEqual(writeWaitMs(1000, 1040), 60);
  assert.strictEqual(writeWaitMs(1000, 1000), CALL.writeMs);
});

test("the echo canceller: the phone's own, unless this Android model is on the list", () => {
  assert.strictEqual(aecFor("ios", "iPhone 15"), "hw");
  assert.strictEqual(aecFor("android", "Samsung SM-A155F"), "hw");
  assert.strictEqual(aecFor("android", ""), "hw");
  // The list starts empty (the device matrix fills it) and is matched as an upper-case substring.
  assert.deepStrictEqual(SOFT_AEC_MODELS, []);
  const list = SOFT_AEC_MODELS as string[];
  list.push("infinix x67");
  try {
    assert.strictEqual(aecFor("android", "Infinix Infinix X67"), "soft");
    assert.strictEqual(aecFor("android", "Infinix X68"), "hw");
    assert.strictEqual(aecFor("ios", "Infinix X67"), "hw");
  } finally {
    list.length = 0;
  }
});

test("one call on this phone: the screen that holds it ends it, and another screen's leaving does not", () => {
  const a = {};
  const b = {};
  let ended: string[] = [];
  const call = { owner: a, end: (why: "left" | "set") => ended.push(why) };
  assert.strictEqual(callOn(), false);
  holdCall(call);
  assert.strictEqual(callOn(), true);
  leaveCall(b);
  assert.deepStrictEqual(ended, []);
  leaveCall(a);
  assert.deepStrictEqual(ended, ["left"]);
  endCallNow();
  assert.deepStrictEqual(ended, ["left", "set"]);
  dropCall(call);
  assert.strictEqual(callOn(), false);
  // A call already dropped is not ended twice by a later screen leaving.
  ended = [];
  leaveCall(a);
  endCallNow();
  assert.deepStrictEqual(ended, []);
});
