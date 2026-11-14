/**
 * THE CALL'S ARITHMETIC (sdui/call/callCore.ts): what to pull and what to let go as people come, go and turn a camera off; who counts as
 * talking, with the hold that stops a tile flickering; what a screen reads, and that the seat is never in it; who a tile means by "me",
 * "speaker" and a name; and how long to wait before trying a dropped call again.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  CALL_LIMITS, CALL_SPEC, backoffMs, heard, speakingOf, stateOf, tooManyTries, wanted, whoIs,
  type CallPerson, type HeldTrack,
} from "./callCore.ts";

const person = (identity: string, o: Partial<CallPerson> = {}): CallPerson =>
  ({ identity, name: identity, role: "guest", audio: `${identity}-audio`, ...o });

test("pulls what it has not got, and lets go of what nobody is sending", () => {
  const people = [person("g_1"), person("g_2", { video: "g_2-video" })];

  // Nothing held yet: everything each person sends.
  assert.deepEqual(wanted(people, []).pull, [
    { identity: "g_1", kind: "audio" },
    { identity: "g_2", kind: "audio" },
    { identity: "g_2", kind: "video" },
  ]);

  // Already holding g_1's audio: only what is new.
  const have: HeldTrack[] = [{ identity: "g_1", kind: "audio", mid: "0" }];
  assert.deepEqual(wanted(people, have).pull.map((t) => `${t.identity}:${t.kind}`), ["g_2:audio", "g_2:video"]);
  assert.deepEqual(wanted(people, have).drop, []);

  // g_2 turned their camera off: the tile lets the track go rather than freezing on its last frame.
  const holding: HeldTrack[] = [{ identity: "g_2", kind: "audio", mid: "0" }, { identity: "g_2", kind: "video", mid: "1" }];
  const off = wanted([person("g_2")], holding);
  assert.deepEqual(off.pull, []);
  assert.deepEqual(off.drop, [{ identity: "g_2", kind: "video", mid: "1" }]);

  // g_2 left altogether.
  assert.equal(wanted([], holding).drop.length, 2);
});

test("draws at most the people one call holds", () => {
  const many = Array.from({ length: CALL_LIMITS.people + 20 }, (_, i) => person(`g_${i}`));
  assert.equal(wanted(many, []).pull.length, CALL_LIMITS.people);
});

test("holds a tile lit between words, and forgets a long silence", () => {
  const t0 = 1_000_000;
  let last = heard({}, { g_1: 0.5, g_2: 0.001 }, t0);
  assert.deepEqual([...speakingOf(last, t0)], ["g_1"]);

  // Still lit a moment after they stop: a sentence has gaps in it.
  assert.deepEqual([...speakingOf(last, t0 + CALL_LIMITS.speakingHoldMs - 1)], ["g_1"]);
  assert.deepEqual([...speakingOf(last, t0 + CALL_LIMITS.speakingHoldMs + 1)], []);

  // Someone long silent is dropped from the map, so it cannot grow all call.
  last = heard(last, {}, t0 + CALL_LIMITS.speakingHoldMs * 11);
  assert.deepEqual(Object.keys(last), []);
});

test("the screen reads the call, and never the seat", () => {
  const out = stateOf({
    phase: "live", mic: true, cam: false, speaker: true, front: true,
    me: { identity: "h_1", name: "Aanya" },
    people: [person("g_1", { name: "Ravi", video: "g_1-video" })],
    waiting: [{ id: "k1", name: "Asha" }],
    speaking: new Set(["g_1"]),
  });
  assert.deepEqual(out, {
    phase: "live", mic: true, cam: false, speaker: true, front: true,
    me: { identity: "h_1", name: "Aanya" },
    people: [{ identity: "g_1", name: "Ravi", role: "guest", speaking: true, mic: true, cam: true }],
    waiting: [{ id: "k1", name: "Asha" }],
  });
  // No bearer, no SFU session, no track names: a screen's state is readable by anything the server draws.
  const text = JSON.stringify(out);
  for (const leak of ["seat", "sess", "-audio", "-video"]) assert.equal(text.includes(leak), false, leak);
});

test("a tile knows who it means", () => {
  const s = {
    me: { identity: "h_1" },
    people: [person("g_1"), person("g_2")],
    speaking: new Set(["g_2"]),
  };
  assert.equal(whoIs("me", s), "h_1");
  assert.equal(whoIs("speaker", s), "g_2");
  assert.equal(whoIs("g_1", s), "g_1");
  // Nobody talking: the first person, so a one-tile screen is never blank.
  assert.equal(whoIs("speaker", { ...s, speaking: new Set<string>() }), "g_1");
  // Alone in the call: themselves.
  assert.equal(whoIs("speaker", { me: { identity: "h_1" }, people: [], speaking: new Set<string>() }), "h_1");
  assert.equal(whoIs("me", { me: null, people: [], speaking: new Set<string>() }), "");
});

test("waits longer each time a call drops, then gives up", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(backoffMs), [1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
  assert.equal(tooManyTries(CALL_LIMITS.retries - 1), false);
  assert.equal(tooManyTries(CALL_LIMITS.retries), true);
});

test("promises what it really has", () => {
  assert.equal(CALL_SPEC.block, "call");
  assert.deepEqual(Object.keys(CALL_SPEC.nodes), ["Caller"]);
  assert.deepEqual(Object.keys(CALL_SPEC.actions), ["call.join", "call.set", "call.leave"]);
  // Every path it says it writes is one stateOf really writes.
  const written = Object.keys(stateOf({
    phase: "connecting", mic: true, cam: true, speaker: true, front: true, me: null, people: [], waiting: [], speaking: new Set<string>(),
  }));
  for (const key of Object.keys(CALL_SPEC.writes)) {
    assert.equal(written.includes(key.replace("statePath.", "")), true, key);
  }
});
