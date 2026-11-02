// node --test
//
// An answer as it is written (askStream.ts): pieces in order onto the screen's state; a gap stops the appending; a reset starts
// over; the live events of a stream go to its listener only while it listens.
import test from "node:test";
import assert from "node:assert";
import { StreamTap, listenStream, listening, makeStreamId, streamEvent, type StreamState } from "./askStream.ts";

test("a stream id the server takes", () => {
  const id = makeStreamId();
  assert.match(id, /^[A-Za-z0-9]{22}$/);
  assert.notStrictEqual(makeStreamId(), id);
});

test("pieces in order: the words grow, the step follows, a reset starts over; one missing stops it", () => {
  const state: StreamState = { id: "x", text: "", step: "" };
  const tap = new StreamTap((p) => Object.assign(state, p));
  tap.take({ n: 0, step: "Reading the project…" });
  tap.take({ n: 1, text: "नमस्ते " });
  tap.take({ n: 1, text: "नमस्ते " }); // the same piece again: once
  tap.take({ n: 2, text: "दुनिया " });
  assert.deepStrictEqual(state, { id: "x", text: "नमस्ते दुनिया ", step: "Reading the project…" });
  tap.take({ n: 3, reset: true });
  tap.take({ n: 4, text: "Again " });
  assert.strictEqual(state.text, "Again ");
  tap.take({ n: 6, text: "lost " }); // 5 never came
  tap.take({ n: 7, text: "more" });
  assert.strictEqual(state.text, "Again ");
  assert.ok(tap.gap);
});

test("a stream's events reach its listener while it listens, and nobody else's", () => {
  const got: unknown[] = [];
  const off = listenStream("abc", (d) => got.push(d));
  assert.strictEqual(streamEvent("ask:abc", { n: 0 }), true);
  assert.strictEqual(streamEvent("ask:other", { n: 0 }), true);
  assert.strictEqual(streamEvent("job:1", {}), false);
  assert.deepStrictEqual(got, [{ n: 0 }]);
  off();
  streamEvent("ask:abc", { n: 1 });
  assert.strictEqual(got.length, 1);
  assert.strictEqual(listening(), 0);
});
