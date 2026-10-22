// node --test --experimental-strip-types src/onboard/blipEngine.test.ts
//
// A whole onboarding run against a scripted clock: Blip arrives, walks, lands,
// changes pose, rides a scroll, is held and let go. No phone, no Skia: the
// engine only asks for words, confetti, fades and timers, and the test answers.

import test, { beforeEach } from "node:test";
import assert from "node:assert";
import { BlipEngine, type BubbleSpec, type EngineIO } from "./blipEngine.ts";
import * as bus from "./stageBus.ts";

interface Fx {
  said: (BubbleSpec | null)[];
  bubbleYs: number[];
  confetti: [number, number][];
  fades: number[];
  released: number;
}

function rig(opts: { winW?: number; holdMaxMs?: number } = {}) {
  let clock = 1000;
  let wall = Date.now();
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const fx: Fx = { said: [], bubbleYs: [], confetti: [], fades: [], released: 0 };
  const io: EngineIO = {
    say: (s) => fx.said.push(s),
    bubbleY: (y) => fx.bubbleYs.push(y),
    confetti: (x, y) => fx.confetti.push([x, y]),
    fade: (to) => fx.fades.push(to),
    release: () => { fx.released++; bus.release(); },
    later: (fn, ms) => {
      const t = { at: clock + ms, fn, live: true };
      timers.push(t);
      return () => { t.live = false; };
    },
    hostOrigin: () => ({ x: 0, y: 0 }),
    winW: () => opts.winW ?? 390,
    holdMaxMs: () => opts.holdMaxMs ?? 12000,
    now: () => clock,
    wall: () => wall,
  };
  const engine = new BlipEngine(io, { dpr: 2, hmax: 220, seed: 0 });
  /** Advance the clock in 16 ms frames, running timers, syncing and ticking as the loop does. */
  let draws = 0;
  const run = (ms: number, reduced = false) => {
    const end = clock + ms;
    while (clock < end) {
      clock += 16; wall += 16;
      for (const t of timers) if (t.live && t.at <= clock) { t.live = false; t.fn(); }
      const s = bus.snapshot();
      engine.sync(s, clock);
      if (engine.advance(clock, reduced).draw) draws++;
    }
  };
  return { engine, fx, run, io, now: () => clock, draws: () => draws };
}

const look = bus.DEFAULT_LOOK;
const stage = (over: Partial<bus.StageInfo> = {}): bus.StageInfo => ({
  id: "onboard", first: 3, of: 10, step: 0, look, origin: { x: 0, y: 40 }, ...over,
});
const spot = (rect: bus.Rect | null, over: Partial<Parameters<typeof bus.pushSpot>[0]> = {}) => {
  const t = bus.pushSpot({
    stage: "onboard", layer: "onboard#1", pose: "present", h: 100, say: "Hi", bubble: "side", burst: false, ...over,
  });
  if (rect) bus.updateSpot(t, { rect });
  return t;
};

beforeEach(() => bus._reset());

test("the first spot: he is simply there, in its pose, fades in, and says his words", () => {
  const r = rig();
  bus.mountStage(stage());
  spot({ x: 0, y: 100, w: 140, h: 120 }, { pose: "listen", say: "I'm listening." });
  r.run(100);
  // feet: middle of the box's bottom edge, plus the stage's corner
  assert.equal(r.engine.bot.x, 70);
  assert.equal(r.engine.bot.y, 40 + 100 + 120 - 2);
  assert.equal(r.engine.bot.pose, "listen");
  assert.equal(r.engine.bot.tr, null, "no journey from nowhere");
  assert.deepEqual(r.fx.fades, [1]);
  const said = r.fx.said.filter(Boolean) as BubbleSpec[];
  assert.equal(said.length, 1);
  assert.equal(said[0].text, "I'm listening.");
  assert.equal(said[0].anchor, "left");
  assert.equal(said[0].x, 0 + 140 - 16, "just inside the box's right edge, a sixth of him in");
  assert.equal(said[0].resay, false);
});

test("a spot with no rect yet is waited for, not guessed at", () => {
  const r = rig();
  bus.mountStage(stage());
  const t = spot(null);
  r.run(200);
  assert.equal(r.engine.placed, false);
  assert.equal(r.fx.said.length, 0);
  bus.updateSpot(t, { rect: { x: 10, y: 10, w: 100, h: 100 } });
  r.run(50);
  assert.equal(r.engine.placed, true);
});

test("a far spot: the bubble hides, he walks (not in the pose he was in), and says it where he lands", () => {
  const r = rig();
  bus.mountStage(stage());
  const a = spot({ x: 0, y: 100, w: 140, h: 120 }, { pose: "listen", say: "One" });
  r.run(100);
  const before = r.fx.said.length;
  bus.popSpot(a);
  spot({ x: 100, y: 500, w: 140, h: 120 }, { pose: "tap", say: "Two", layer: "onboard#2" });
  r.run(16);
  assert.equal(r.fx.said.at(-1), null, "his words go while he walks");
  assert.ok(r.engine.bot.tr, "on a journey");
  assert.equal(r.engine.bot.pose, "walk");
  r.run(300);
  assert.equal(r.fx.said.length, before + 1, "nothing said yet, just hidden");
  r.run(1500);
  assert.equal(r.engine.bot.tr, null);
  assert.equal(r.engine.bot.x, 170);
  assert.equal(r.engine.bot.pose, "tap", "and in the pose the spot asked for");
  const last = r.fx.said.at(-1) as BubbleSpec;
  assert.equal(last.text, "Two");
  assert.equal(last.resay, false, "it appears; it is not a re-say");
});

test("a pose he keeps (waving, holding the key or a tile) he keeps while he walks", () => {
  const r = rig();
  bus.mountStage(stage());
  const a = spot({ x: 0, y: 100, w: 140, h: 120 }, { pose: "wave" });
  r.run(50);
  bus.popSpot(a);
  spot({ x: 0, y: 400, w: 140, h: 120 }, { pose: "key", layer: "onboard#2" });
  r.run(32);
  assert.equal(r.engine.bot.pose, "wave");
});

test("the same place with a new pose is not a journey: he re-poses and says it again", () => {
  const r = rig();
  bus.mountStage(stage());
  const rect = { x: 20, y: 300, w: 134, h: 120 };
  const a = spot(rect, { pose: "present", say: "Go on, say something." });
  r.run(100);
  bus.popSpot(a);
  spot(rect, { pose: "listen", say: "I'm all ears." });
  r.run(32);
  assert.equal(r.engine.bot.tr, null, "no journey");
  assert.equal(r.engine.bot.pose, "listen");
  const last = r.fx.said.at(-1) as BubbleSpec;
  assert.equal(last.text, "I'm all ears.");
  assert.equal(last.resay, true, "the bubble was up, so it is said again, not re-appeared");
});

test("a successful try: the same place, and confetti fires 250 ms later, once", () => {
  const r = rig();
  bus.mountStage(stage());
  const rect = { x: 20, y: 300, w: 134, h: 120 };
  const a = spot(rect, { pose: "listen", say: "I'm all ears." });
  r.run(100);
  bus.popSpot(a);
  spot(rect, { pose: "tada", say: "That's me.", burst: true });
  r.run(160);
  assert.equal(r.fx.confetti.length, 0, "not yet");
  r.run(160);
  assert.equal(r.fx.confetti.length, 1);
  r.run(1000);
  assert.equal(r.fx.confetti.length, 1);
  const [x, y] = r.fx.confetti[0];
  assert.equal(x, 20 + 134 / 2);
  assert.ok(y < r.engine.bot.y, "thrown from his body, not his feet");
});

test("landing at a burst spot (done) cheers 250 ms after he arrives", () => {
  const r = rig();
  bus.mountStage(stage());
  const a = spot({ x: 0, y: 100, w: 140, h: 120 }, { pose: "think" });
  r.run(50);
  bus.popSpot(a);
  spot({ x: 20, y: 80, w: 320, h: 232 }, { pose: "tada", h: 190, bubble: "corner", burst: true, say: "We did it!", layer: "onboard#2" });
  r.run(3000);
  assert.equal(r.fx.confetti.length, 1);
  const said = r.fx.said.at(-1) as BubbleSpec;
  assert.equal(said.anchor, "right");
  assert.equal(said.x, 390 - (20 + 320 - 10), "right-anchored, measured from the window's right edge");
});

test("a step that scrolls carries him and his words with it, with no animation", () => {
  const r = rig();
  bus.mountStage(stage());
  const t = spot({ x: 0, y: 300, w: 140, h: 120 }, { pose: "tap" });
  r.run(100);
  const y0 = r.engine.bot.y, by0 = r.fx.bubbleYs.at(-1)!;
  bus.setScroll("onboard#1", 60);
  r.run(32);
  assert.equal(r.engine.bot.y, y0 - 60);
  assert.equal(r.fx.bubbleYs.at(-1), by0 - 60);
  bus.setScroll("onboard#1", 0);
  r.run(32);
  assert.equal(r.engine.bot.y, y0);
  assert.equal(r.engine.bot.tr, null, "scrolling is not a journey");
  void t;
});

test("a spot that re-measures where it already is, a few points off, moves him without a walk", () => {
  const r = rig();
  bus.mountStage(stage());
  const t = spot({ x: 0, y: 300, w: 140, h: 120 });
  r.run(100);
  bus.updateSpot(t, { rect: { x: 0, y: 306, w: 140, h: 120 } });
  r.run(32);
  assert.equal(r.engine.bot.tr, null);
  assert.equal(r.engine.bot.y, 40 + 306 + 120 - 2);
  // far off (the content really moved): that is a journey
  bus.updateSpot(t, { rect: { x: 0, y: 500, w: 140, h: 120 } });
  r.run(32);
  assert.ok(r.engine.bot.tr);
});

test("a new spot while he is walking redirects the walk instead of queueing another", () => {
  const r = rig();
  bus.mountStage(stage());
  const a = spot({ x: 0, y: 100, w: 140, h: 120 });
  r.run(50);
  bus.popSpot(a);
  const b = spot({ x: 200, y: 600, w: 140, h: 120 }, { layer: "onboard#2", say: "B" });
  r.run(300);
  assert.ok(r.engine.bot.tr);
  bus.popSpot(b);
  spot({ x: 0, y: 300, w: 140, h: 120 }, { layer: "onboard#3", say: "C" });
  r.run(3000);
  assert.equal(r.engine.bot.x, 70);
  assert.equal(r.engine.bot.y, 40 + 300 + 120 - 2);
  const said = (r.fx.said.filter(Boolean) as BubbleSpec[]).map((s) => s.text);
  assert.deepEqual(said.slice(-1), ["C"]);
  assert.ok(!said.includes("B"), "never said it: he never got there");
});

test("while the app swaps trees he holds still on paper; let go, the next spot is a first spot", () => {
  const r = rig();
  bus.setAppPhase("auth");
  bus.mountStage(stage({ id: "onboard.auth", first: 0 }));
  const t = spot({ x: 0, y: 200, w: 140, h: 120 }, { say: "Got it!", pose: "nod" });
  r.run(100);
  bus.popSpot(t);
  bus.unmountStage("onboard.auth");
  bus.setAppPhase("loading");
  assert.equal(bus.snapshot().mode, "hold");
  const x = r.engine.bot.x, y = r.engine.bot.y;
  r.run(500);
  assert.equal(r.engine.shown, true);
  assert.equal(r.engine.bot.x, x);
  assert.equal(r.engine.bot.y, y);
  assert.equal(r.engine.bot.pose, "nod");
  assert.equal((r.fx.said.at(-1) as BubbleSpec).text, "Got it!", "his words stay up");

  // The new tree arrives: he walks to its spot.
  bus.setAppPhase("stage");
  bus.mountStage(stage());
  spot({ x: 0, y: 400, w: 140, h: 120 }, { say: "I'm listening.", layer: "onboard#1" });
  r.run(2000);
  assert.equal(r.engine.bot.y, 40 + 400 + 120 - 2);
  assert.equal((r.fx.said.at(-1) as BubbleSpec).text, "I'm listening.");

  // Let go (the app settled somewhere else): he fades, and forgets where he was.
  bus.setAppPhase("other");
  bus.unmountStage("onboard");
  r.run(100);
  assert.equal(r.fx.fades.at(-1), 0);
  assert.equal(r.engine.shown, false);
  assert.equal(r.engine.placed, false);
  assert.equal(r.fx.said.at(-1), null);
  assert.equal(r.engine.active(r.now()), true, "still fading");
  r.run(400);
  assert.equal(r.engine.active(r.now()), false, "and then the loop may stop");

  // A later onboarding starts from a first spot again.
  bus.setAppPhase("auth");
  bus.mountStage(stage({ id: "onboard.auth", first: 0 }));
  spot({ x: 0, y: 150, w: 140, h: 120 }, { layer: "onboard.auth#1" });
  r.run(100);
  assert.equal(r.engine.bot.tr, null, "he does not walk in from where he left");
  assert.equal(r.engine.bot.y, 40 + 150 + 120 - 2);
});

test("a hold that never ends is let go after the server's time", () => {
  const r = rig({ holdMaxMs: 5000 });
  bus.setAppPhase("auth");
  bus.mountStage(stage());
  const t = spot({ x: 0, y: 200, w: 140, h: 120 });
  r.run(50);
  bus.popSpot(t);
  bus.unmountStage("onboard");
  r.run(4000);
  assert.equal(r.fx.released, 0);
  assert.equal(bus.snapshot().mode, "hold");
  r.run(1500);
  assert.equal(r.fx.released, 1);
  assert.equal(bus.snapshot().mode, "off");
});

test("reduced motion: no walk, he is there after 160 ms; and nothing is redrawn while he is a still", () => {
  const r = rig();
  bus.mountStage(stage());
  bus.setReduced(true);
  const a = spot({ x: 0, y: 100, w: 140, h: 120 });
  r.run(100, true);
  bus.popSpot(a);
  spot({ x: 100, y: 500, w: 140, h: 120 }, { layer: "onboard#2", pose: "tap", say: "There" });
  r.run(100, true);
  assert.equal(r.engine.bot.tr, null, "no journey");
  assert.equal(r.engine.bot.y, 40 + 100 + 120 - 2, "not there yet at 100 ms");
  r.run(120, true);
  assert.equal(r.engine.bot.x, 170);
  assert.equal(r.engine.bot.y, 40 + 500 + 120 - 2);
  assert.equal(r.engine.bot.pose, "tap");
  assert.equal((r.fx.said.at(-1) as BubbleSpec).text, "There");
  // Settled and still: no more frames to draw.
  r.run(200, true);
  let draws = 0;
  for (let i = 0; i < 20; i++) {
    const now = r.now() + 40 * (i + 1);
    if (r.engine.advance(now, true).draw) draws++;
  }
  assert.equal(draws, 0);
});

test("at rest he is drawn about 30 times a second, walking about 60 (a frame every 16 ms here)", () => {
  const r = rig();
  bus.mountStage(stage());
  const a = spot({ x: 0, y: 100, w: 140, h: 120 });
  r.run(100);
  const d0 = r.draws();
  r.run(1000);
  const rest = r.draws() - d0;
  assert.ok(rest >= 25 && rest <= 35, `rest: ${rest} frames in a second`);
  bus.popSpot(a);
  spot({ x: 100, y: 500, w: 140, h: 120 }, { layer: "onboard#2" });
  r.run(16);
  assert.ok(r.engine.bot.tr);
  const d1 = r.draws();
  r.run(480);
  const walking = r.draws() - d1;
  assert.ok(walking >= 25, `walking: ${walking} frames in half a second`);
});

test("his height is capped at what the overlay's picture can hold", () => {
  const r = rig();
  bus.mountStage(stage());
  spot({ x: 0, y: 100, w: 400, h: 400 }, { h: 500 });
  r.run(50);
  assert.equal(r.engine.bot.H, 220);
});

test("a spot with no words says nothing, and takes the bubble away", () => {
  const r = rig();
  bus.mountStage(stage());
  const a = spot({ x: 0, y: 100, w: 140, h: 120 }, { say: "Hi" });
  r.run(50);
  bus.updateSpot(a, { say: "" });
  r.run(50);
  assert.equal(r.fx.said.at(-1), null);
});
