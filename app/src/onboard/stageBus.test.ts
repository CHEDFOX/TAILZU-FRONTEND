// node --test --experimental-strip-types src/onboard/stageBus.test.ts
//
// The board Blip is told where to stand on. Each case is a way he could end up
// in the wrong place, or the app could end up with paper stuck over it.

import test, { beforeEach } from "node:test";
import assert from "node:assert";
import * as bus from "./stageBus.ts";

const look = bus.DEFAULT_LOOK;
const stage = (over: Partial<bus.StageInfo> = {}): bus.StageInfo => ({
  id: "onboard", first: 3, of: 10, step: 0, look, origin: { x: 0, y: 0 }, ...over,
});
const spot = (over: Partial<Parameters<typeof bus.pushSpot>[0]> = {}) => bus.pushSpot({
  stage: "onboard", layer: "onboard#1", pose: "present", h: 100, say: "Hi", bubble: "side", burst: false, ...over,
});

beforeEach(() => bus._reset());

test("the last spot pushed is the current one, and popping falls back to the one before", () => {
  bus.mountStage(stage());
  const a = spot({ pose: "listen" });
  assert.equal(bus.snapshot().spot?.pose, "listen");
  const b = spot({ pose: "tada" });
  assert.equal(bus.snapshot().spot?.pose, "tada");
  bus.popSpot(b);
  assert.equal(bus.snapshot().spot?.pose, "listen");
  bus.popSpot(a);
  assert.equal(bus.snapshot().spot, null);
});

test("a spot that changes is told apart by its rev, and an identical update changes nothing", () => {
  bus.mountStage(stage());
  const t = spot();
  const before = bus.snapshot();
  bus.updateSpot(t, { pose: "present", h: 100 });
  assert.equal(bus.snapshot(), before, "no change, no new snapshot");
  bus.updateSpot(t, { say: "Hello again" });
  assert.ok(bus.snapshot().spot!.rev > before.spot!.rev);
  bus.updateSpot(t, { rect: { x: 1, y: 2, w: 3, h: 4 } });
  assert.deepEqual(bus.snapshot().spot!.rect, { x: 1, y: 2, w: 3, h: 4 });
});

test("popping or updating a spot that is not there does nothing", () => {
  bus.mountStage(stage());
  const before = bus.snapshot();
  bus.popSpot(999);
  bus.updateSpot(999, { say: "x" });
  assert.equal(bus.snapshot(), before);
});

test("remember keeps the furthest step, and never goes back", () => {
  assert.equal(bus.remembered("onboard"), 0);
  bus.remember("onboard", 3);
  bus.remember("onboard", 1);
  assert.equal(bus.remembered("onboard"), 3);
  bus.remember("onboard", 5);
  assert.equal(bus.remembered("onboard"), 5);
  assert.equal(bus.remembered("onboard.auth"), 0, "each stage has its own");
});

test("a recreated store is raised to the furthest step: the floor wins over a step back at zero", () => {
  bus.remember("onboard", 4);
  assert.equal(bus.resolveStep({ stored: 0, floor: bus.remembered("onboard"), count: 7 }).idx, 4);
  // Once the person is past it, the stored step is what counts.
  assert.equal(bus.resolveStep({ stored: 6, floor: 4, count: 7 }).idx, 6);
  // And a step past the end is the last one, not a crash.
  assert.equal(bus.resolveStep({ stored: 40, floor: 0, count: 7 }).idx, 6);
  assert.equal(bus.resolveStep({ stored: -3, floor: 0, count: 7 }).idx, 0);
  assert.equal(bus.resolveStep({ stored: NaN, floor: 0, count: 7 }).idx, 0);
});

test("the sign-in phase picks the code step, and sign-in never lands on a step no phase has earned", () => {
  const phaseStep = { verify: 2, verifying: 2 };
  assert.deepEqual(bus.resolveStep({ stored: 1, floor: 0, phase: "verify", phaseStep, count: 3 }), { idx: 2, fromPhase: true });
  assert.deepEqual(bus.resolveStep({ stored: 1, floor: 0, phase: "verifying", phaseStep, count: 3 }), { idx: 2, fromPhase: true });
  assert.deepEqual(bus.resolveStep({ stored: 1, floor: 0, phase: "entry", phaseStep, count: 3 }), { idx: 1, fromPhase: false });
  assert.deepEqual(bus.resolveStep({ stored: 0, floor: 0, phase: "sending", phaseStep, count: 3 }), { idx: 0, fromPhase: false });
  // A remembered step of 2 (the code step) must not put sign-in on the code step.
  assert.equal(bus.resolveStep({ stored: 0, floor: 2, phase: "entry", phaseStep, count: 3 }).idx, 1);
  // Outside the gate there is no phase, and the code step is an ordinary step.
  assert.equal(bus.resolveStep({ stored: 2, floor: 0, phase: null, phaseStep, count: 3 }).idx, 2);
});

test("while the app swaps trees the paper is held, and it is let go when the app settles", () => {
  bus.mountStage(stage());
  assert.equal(bus.snapshot().mode, "live");
  bus.setAppPhase("auth");
  bus.unmountStage("onboard");
  for (const phase of ["auth", "loading", "pending", "stage"] as const) {
    bus.setAppPhase(phase);
    assert.equal(bus.snapshot().mode, "hold", `held through ${phase}`);
    assert.equal(bus.snapshot().stage?.id, "onboard", "with the stage it left");
  }
  for (const phase of ["other", "connect", "language"] as const) {
    bus.mountStage(stage());
    bus.setAppPhase("auth");
    bus.unmountStage("onboard");
    assert.equal(bus.snapshot().mode, "hold");
    bus.setAppPhase(phase);
    assert.equal(bus.snapshot().mode, "off", `released on ${phase}`);
    assert.equal(bus.snapshot().stage, null);
  }
});

test("the app's phase maps onto the overlay's, and a failed first fetch lets the paper go", () => {
  // Phases that are not "ready" pass straight through.
  for (const phase of ["loading", "auth", "connect", "language"] as const) {
    assert.equal(bus.appPhaseFor({ phase, hasScreen: false }), phase);
  }
  // Waiting on the first screen holds the paper.
  assert.equal(bus.appPhaseFor({ phase: "ready", hasScreen: false }), "pending");
  assert.equal(bus.appPhaseFor({ phase: "ready", hasScreen: true, rootType: "OnboardStage" }), "stage");
  assert.equal(bus.appPhaseFor({ phase: "ready", hasScreen: true, rootType: "Screen" }), "other");
  // A stale screen with a failed refresh is still the screen that was there.
  assert.equal(bus.appPhaseFor({ phase: "ready", hasScreen: true, rootType: "OnboardStage", failed: true }), "stage");
  // No screen and an error is the error card: nothing is coming to hand over to.
  assert.equal(bus.appPhaseFor({ phase: "ready", hasScreen: false, failed: true }), "other");

  // End to end on the board: the hold begins when the stage leaves, and the
  // failure lets it go at once instead of covering the Retry card for 12 s.
  bus.mountStage(stage());
  bus.setAppPhase(bus.appPhaseFor({ phase: "auth", hasScreen: false }));
  bus.unmountStage("onboard");
  bus.setAppPhase(bus.appPhaseFor({ phase: "ready", hasScreen: false }));
  assert.equal(bus.snapshot().mode, "hold");
  bus.setAppPhase(bus.appPhaseFor({ phase: "ready", hasScreen: false, failed: true }));
  assert.equal(bus.snapshot().mode, "off");
  assert.equal(bus.snapshot().stage, null);
});

test("nothing is held before there has ever been a stage, and a released hold cannot come back", () => {
  bus.setAppPhase("loading");
  assert.equal(bus.snapshot().mode, "off");
  bus.setAppPhase("pending");
  assert.equal(bus.snapshot().mode, "off");
  bus.mountStage(stage());
  bus.unmountStage("onboard");
  assert.equal(bus.snapshot().mode, "hold");
  bus.setAppPhase("other");
  assert.equal(bus.snapshot().mode, "off");
  bus.setAppPhase("loading");
  assert.equal(bus.snapshot().mode, "off", "released means released");
});

test("a stage that goes and comes back in one beat (a refetch) never shows as held", () => {
  bus.setAppPhase("stage");
  bus.mountStage(stage({ step: 2 }));
  const seen: bus.Mode[] = [];
  bus.subscribe(() => seen.push(bus.snapshot().mode));
  bus.unmountStage("onboard");
  bus.mountStage(stage({ step: 2 }));
  assert.equal(bus.snapshot().mode, "live");
  assert.equal(bus.snapshot().stage?.step, 2);
});

test("a hold that never ends can be released", () => {
  bus.mountStage(stage());
  bus.unmountStage("onboard");
  bus.setAppPhase("auth");
  assert.equal(bus.snapshot().mode, "hold");
  assert.ok(bus.snapshot().holdSince > 0);
  bus.release();
  assert.equal(bus.snapshot().mode, "off");
  assert.equal(bus.snapshot().holdSince, 0);
});

test("the progress fill is the steps so far: first + step, of the total", () => {
  assert.equal(bus.progressFill({ first: 0, step: 0, of: 10 }), 1);
  assert.equal(bus.progressFill({ first: 0, step: 2, of: 10 }), 3);
  assert.equal(bus.progressFill({ first: 3, step: 0, of: 10 }), 4, "Languages is the fourth of ten");
  assert.equal(bus.progressFill({ first: 3, step: 6, of: 10 }), 10, "Done fills the bar");
  assert.equal(bus.progressFill({ first: 3, step: 9, of: 10 }), 10, "never past the end");
});

test("scroll is kept by layer, so a step shown again starts at the top", () => {
  bus.mountStage(stage());
  spot({ layer: "onboard#2" });
  bus.setScroll("onboard#2", 120);
  assert.equal(bus.snapshot().scroll, 120);
  bus.setScroll("onboard#1", 300);
  assert.equal(bus.snapshot().scroll, 120, "another layer's scroll is not this spot's");
  bus.forgetScroll("onboard#2");
  assert.equal(bus.getScroll("onboard#2"), 0);
});

test("the view React draws from does not change when only a rect or a scroll does", () => {
  bus.mountStage(stage());
  const t = spot({ layer: "onboard#1" });
  const v1 = bus.viewSnapshot();
  bus.updateSpot(t, { rect: { x: 0, y: 10, w: 100, h: 100 } });
  bus.setScroll("onboard#1", 40);
  assert.equal(bus.viewSnapshot(), v1, "same object, so the overlay does not re-render");
  bus.updateStage("onboard", { step: 1 });
  const v2 = bus.viewSnapshot();
  assert.notEqual(v2, v1);
  assert.equal(v2.stage?.step, 1);
  assert.equal(bus.viewSnapshot(), v2);
});

test("a stage whose look was cut short still has paper and ink", () => {
  const l = bus.readLook({ ground: "#101010", bubble: { size: 21 }, glide: { slide: "wide" } });
  assert.equal(l.ground, "#101010");
  assert.equal(l.bubble.size, 21);
  assert.equal(l.bubble.bigSize, 22, "missing keys take the design's own");
  assert.equal(l.glide.slide, 26, "a value of the wrong kind is ignored");
  assert.equal(l.progress.on, "#1C1A17");
  assert.deepEqual(bus.readLook(null), bus.DEFAULT_LOOK);
  assert.equal(bus.REDUCED_GLIDE.slide, 0, "reduced motion: no travel");
});

test("a listener that throws does not stop the others", () => {
  let heard = 0;
  bus.subscribe(() => { throw new Error("boom"); });
  bus.subscribe(() => { heard++; });
  bus.mountStage(stage());
  assert.equal(heard, 1);
});

test("a tree that failed lets go at once, and the stage unmounting because of it is not held", () => {
  bus.setAppPhase("auth");
  bus.mountStage(stage({ id: "onboard.auth", first: 0 }));
  assert.equal(bus.snapshot().mode, "live");
  bus.abandon();
  bus.unmountStage("onboard.auth");
  assert.equal(bus.snapshot().mode, "off", "the native screen is not covered");
  // The next stage to mount switches holding back on.
  bus.mountStage(stage());
  bus.unmountStage("onboard");
  assert.equal(bus.snapshot().mode, "hold");
});
