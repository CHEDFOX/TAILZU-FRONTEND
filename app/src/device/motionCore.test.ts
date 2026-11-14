// node --test --experimental-strip-types src/device/motionCore.test.ts
//
// Motion's rules (docs: perms2 5): ten minutes or more becomes a walk, run or ride; a CAR never does; and the driving check
// answers yes, no, or "cannot tell".
import test from "node:test";
import assert from "node:assert/strict";
import { MIN_SPAN_MINUTES, drivingAnswer, motionRead, spanKind } from "./motionCore.ts";
import { buildPayload } from "./healthCore.ts";

test("walking, running and cycling are kinds; a car, a train and a guess are not", () => {
  assert.equal(spanKind("walking"), "walk");
  assert.equal(spanKind("Running"), "run");
  assert.equal(spanKind(" cycling "), "cycle");
  for (const v of ["automotive", "stationary", "unknown", "car", "", null, 7, {}]) assert.equal(spanKind(v as never), null);
});

test("a day's steps and its long spans come through; short spans and cars are dropped", () => {
  const { stepsByDay, workouts } = motionRead([
    { day: "2026-11-13", steps: 7421, spans: [
      { kind: "walking", minutes: 31 },
      { kind: "walking", minutes: MIN_SPAN_MINUTES - 1 },   // too short to be a walk
      { kind: "automotive", minutes: 45 },                   // a car is never a workout
      { kind: "cycling", minutes: 12 },
    ] },
    { day: "2026-11-14", steps: 0, spans: [] },
    { day: "nope", steps: 99, spans: [{ kind: "walking", minutes: 60 }] },
    { steps: 10 },
    null,
  ]);
  assert.deepEqual([...stepsByDay], [["2026-11-13", 7421]]);
  assert.deepEqual(workouts, [
    { day: "2026-11-13", kind: "walk", minutes: 31 },
    { day: "2026-11-13", kind: "cycle", minutes: 12 },
  ]);
  assert.deepEqual(motionRead("nope"), { stepsByDay: new Map(), workouts: [] });
});

test("what motion sends is exactly the shape Apple Health sends, plus source", () => {
  const read = motionRead([{ day: "2026-11-14", steps: 5000, spans: [{ kind: "running", minutes: 22 }] }]);
  const { payload, empty } = buildPayload({
    window: ["2026-11-13", "2026-11-14"], stepsByDay: read.stepsByDay, workouts: read.workouts, offsetMin: 330, source: "motion",
  });
  assert.equal(empty, false);
  assert.equal(payload.source, "motion");
  assert.deepEqual(payload.days, [
    { day: "2026-11-13", steps: 0, workouts: [] },
    { day: "2026-11-14", steps: 5000, workouts: [{ kind: "run", minutes: 22 }] },
  ]);
  // nothing finer than a day exists in the payload at all
  assert.ok(!JSON.stringify(payload).includes("T"));
});

test("the driving answer is yes, no, or cannot tell", () => {
  assert.equal(drivingAnswer(true), true);
  assert.equal(drivingAnswer(false), false);
  for (const v of [null, undefined, "yes", 1, {}]) assert.equal(drivingAnswer(v), null);
});
