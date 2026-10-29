// node --test
//
// The bots' looks and moments (core.ts compileLooks, the interpreter; looksStore.ts; the starter pack): today's kinds,
// drawn from avatar data, are exactly what they were (frames and drawing, against hashes taken from the core before
// looks were data); the starter pack is the server's catalog and compiles clean; every moment plays on every look,
// on a tile's stage and a page's, once and as a loop, finite and inside, its end when delivered; the others answer;
// Home's surprises are rare and only for idle bots; what a build cannot play falls back; the store follows the server.
import test from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  BLIP, BotTile, BotTilesWorld, LOOKS_FORMAT, MOMENT_FUNCS, checkExpression, compileAvatar, compileLooks, gridWorld, rng,
  type BotKind, type Looks, type TileCtx,
} from "./core.ts";
import { LooksStore, readFlag } from "./looksStore.ts";
import { STARTER } from "./starter.ts";
// @ts-expect-error a plain .mjs script, no types
import { DESKTOP_OUT, LOOKS_SOURCE, PHONE_OUT, hashesOf, sha } from "./genStarter.mjs";

const KINDS: BotKind[] = ["code", "keybot", "plan", "travel", "notes", "make", "custom"];
const L: Looks = compileLooks(STARTER);
const MOMENTS = [...L.moments.values()].filter((m) => !m.react).map((m) => m.id);
const AVATARS = [...L.avatars.keys()];

/** A context that records every call and every property it is given, rounded (the drawing, as a string). */
function recorder() {
  const out: string[] = [];
  const r = (v: unknown) => (typeof v === "number" ? (Math.round(v * 1e6) / 1e6).toString() : String(v));
  const ctx: Record<string, unknown> = {};
  for (const prop of ["globalAlpha", "fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin"]) {
    let val: unknown = 0;
    Object.defineProperty(ctx, prop, { get: () => val, set: (v) => { val = v; out.push(prop + "=" + r(v)); } });
  }
  for (const m of ["save", "restore", "translate", "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo", "arc", "fill", "stroke"]) {
    ctx[m] = (...a: unknown[]) => { out.push(m + "(" + a.map(r).join(",") + ")"); };
  }
  return { ctx: ctx as unknown as TileCtx, out };
}

/** A context that draws nothing and counts its calls. */
function counter(): TileCtx & { calls: number } {
  const c = { calls: 0, globalAlpha: 1, fillStyle: "#000" as unknown, strokeStyle: "#000" as unknown, lineWidth: 1, lineCap: "butt" as const, lineJoin: "miter" as const } as TileCtx & { calls: number };
  for (const m of ["save", "restore", "translate", "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo", "arc", "fill", "stroke"]) {
    (c as unknown as Record<string, () => void>)[m] = () => { c.calls++; };
  }
  return c;
}

const h16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const nums = (a: ArrayLike<number>, n: number) => { let s = ""; for (let i = 0; i < n; i++) s += (Math.round(a[i]! * 1e6) / 1e6) + ","; return s; };

/**
 * Every kind in every mood on a tile, every kind in every act on a page, every kind's still pose, and a carry: frames
 * and drawing, hashed. `avatar(kind)` dresses each bot (null: none given, Blip as the core has him).
 */
function scenes(avatar: (kind: BotKind) => ReturnType<typeof compileAvatar> | null): Record<string, string> {
  const res: Record<string, string> = {};
  const run = (name: string, t: BotTile, frames: number, jitter: boolean, after?: (t: BotTile) => void) => {
    const r = rng(9);
    const rec = recorder();
    for (let f = 0; f < frames; f++) {
      t.step(jitter ? 1 / 60 + (r() - 0.5) / 200 : 1 / 60);
      if (f >= frames - 3 || f % 97 === 0) t.draw(rec.ctx);
    }
    if (after) after(t);
    t.draw(rec.ctx);
    res[name] = h16(nums(t.x, t.n) + "|" + nums(t.y, t.n) + "|" + nums(t.fabric.ux, t.fabric.n) + "|" + rec.out.join(";"));
  };
  for (const kind of KINDS) for (const mood of ["idle", "working", "needs"] as const) {
    const t = new BotTile({ kind, color: "#4F7A3A", mood, seed: 5, avatar: avatar(kind) });
    t.resize(169, 132, 72);
    run(`tile/${kind}/${mood}`, t, 900, true);
  }
  for (const kind of KINDS) for (const act of ["play", "wave", "survey", "read", "settle", "think", "carry"] as const) {
    const t = new BotTile({ kind, color: "#A9573A", mood: "idle", seed: 3, size: 30, avatar: avatar(kind) });
    t.cloth = 0;
    t.resize(150, 56, 54);
    t.setAct(act);
    run(`buddy/${kind}/${act}`, t, 700, false);
  }
  for (const kind of KINDS) {
    const t = new BotTile({ kind, color: "#3E6E8E", mood: "needs", seed: 8, avatar: avatar(kind) });
    t.resize(169, 132, 72);
    for (let f = 0; f < 200; f++) t.step(1 / 60);
    t.settle(true);
    run(`settle/${kind}`, t, 10, false);
  }
  {
    const t = new BotTile({ kind: "code", color: "#4F7A3A", mood: "idle", seed: 9, size: 44, avatar: avatar("code") });
    t.cloth = 0;
    t.resize(358, 68, 66);
    t.setAct("carry");
    run("carry/lane", t, 60 * 30, false, (b) => { b.deliver(); for (let f = 0; f < 240; f++) b.step(1 / 60); });
  }
  return res;
}

/** Taken from core.ts as it was before looks were data (the same scenes, run on that file). */
const BEFORE: Record<string, string> = {
  "tile/code/idle": "88644cfcbb457e31",
  "tile/code/working": "f98c39340eb788ff",
  "tile/code/needs": "6823b49fc5136d53",
  "tile/keybot/idle": "87cfc815fd7a3cc9",
  "tile/keybot/working": "9dfc387f829ec7f9",
  "tile/keybot/needs": "b8293ff49dd8a9ae",
  "tile/plan/idle": "09b517c18baf6a56",
  "tile/plan/working": "0192c2101bd95d0e",
  "tile/plan/needs": "71a71d33101ef6c9",
  "tile/travel/idle": "c3a786ae6067f1bb",
  "tile/travel/working": "50213be1686d9e35",
  "tile/travel/needs": "27987cc36e52d62b",
  "tile/notes/idle": "76e638ed98c4a8b5",
  "tile/notes/working": "043eb8f3e8c81897",
  "tile/notes/needs": "af0b71eb617346ff",
  "tile/make/idle": "61a33b4f7eaf0b13",
  "tile/make/working": "bd7d042cfb86bf7d",
  "tile/make/needs": "9df7d289051ec4f7",
  "tile/custom/idle": "7a4baad0553baa6e",
  "tile/custom/working": "5ad14b6c1ecfe091",
  "tile/custom/needs": "ca628e895169f180",
  "buddy/code/play": "c95e3aed35827ee6",
  "buddy/code/wave": "4ea8fb18227d0683",
  "buddy/code/survey": "9980bdf066be0aa9",
  "buddy/code/read": "33c1721a5228a5ef",
  "buddy/code/settle": "25480fa5cd858bcf",
  "buddy/code/think": "4214ee39e3a94d0a",
  "buddy/code/carry": "6368da04b26da5bf",
  "buddy/keybot/play": "945f68a838134b38",
  "buddy/keybot/wave": "eb3bc45b8dd001a7",
  "buddy/keybot/survey": "c9489b6f6b3b0ab4",
  "buddy/keybot/read": "4147c1eefc1c21a7",
  "buddy/keybot/settle": "e11e3f04276a4a58",
  "buddy/keybot/think": "8d0f4e7f06aa19aa",
  "buddy/keybot/carry": "ff5328005cc49021",
  "buddy/plan/play": "a57c5643569c6463",
  "buddy/plan/wave": "79d8903d77963a11",
  "buddy/plan/survey": "fdf7109408652011",
  "buddy/plan/read": "a94c6b8a9dad5827",
  "buddy/plan/settle": "772a9388573d4daa",
  "buddy/plan/think": "73e4799f4338265d",
  "buddy/plan/carry": "6368da04b26da5bf",
  "buddy/travel/play": "f5f525f0ce74aca5",
  "buddy/travel/wave": "9369ba30412f16be",
  "buddy/travel/survey": "7358fb2ed805fcae",
  "buddy/travel/read": "ab524db8cc5169c3",
  "buddy/travel/settle": "a4451e13a5151d3a",
  "buddy/travel/think": "eb5fc5301d09d30b",
  "buddy/travel/carry": "ff5328005cc49021",
  "buddy/notes/play": "7b34bdf9e76af291",
  "buddy/notes/wave": "324c191e1e48a86f",
  "buddy/notes/survey": "35f3aeafd2760c64",
  "buddy/notes/read": "84f8555cfd9a443e",
  "buddy/notes/settle": "7585899aca20152c",
  "buddy/notes/think": "acde84e6904f66f7",
  "buddy/notes/carry": "a771f5699011b49b",
  "buddy/make/play": "c59083fa4de39a74",
  "buddy/make/wave": "58a2b4e58495706d",
  "buddy/make/survey": "58a2b4e58495706d",
  "buddy/make/read": "58a2b4e58495706d",
  "buddy/make/settle": "58a2b4e58495706d",
  "buddy/make/think": "58a2b4e58495706d",
  "buddy/make/carry": "58a2b4e58495706d",
  "buddy/custom/play": "9c224d18af203acd",
  "buddy/custom/wave": "5253bd3a59a9d25a",
  "buddy/custom/survey": "9d9b1bb64c28587b",
  "buddy/custom/read": "21f2d39b5c323964",
  "buddy/custom/settle": "170f811a03e391a0",
  "buddy/custom/think": "ed0138e68ab5f074",
  "buddy/custom/carry": "ff5328005cc49021",
  "settle/code": "5ea90326033ab127",
  "settle/keybot": "5e6a0e86107ac654",
  "settle/plan": "6732996cffe378da",
  "settle/travel": "7cdc7d18c401c97a",
  "settle/notes": "d08a7f8294eb9855",
  "settle/make": "e2e2cd9ad84f57f5",
  "settle/custom": "66d7e148d70335b2",
  "carry/lane": "3a324e09b8ed09ed"
};

test("today's kinds look and move exactly as before: drawn from the catalog's avatars, and with none given", () => {
  for (const [name, dress] of [["no avatar", () => null], ["the catalog's", (k: BotKind) => L.avatar(k)], ["Blip", () => BLIP]] as const) {
    const now = scenes(dress);
    const diff = Object.keys(BEFORE).filter((k) => now[k] !== BEFORE[k]);
    assert.deepStrictEqual(diff, [], `${name}: frames or drawing changed in ${diff.join(", ")}`);
  }
  for (const k of KINDS) assert.strictEqual(L.kinds[k], k, `${k} wears its own avatar`);
});

test("the starter pack is the server's catalog, unchanged, and compiles without an error", { skip: false }, () => {
  assert.deepStrictEqual(L.errors, []);
  assert.ok(L.v >= 1);
  const text = readFileSync(PHONE_OUT, "utf8");
  const h = hashesOf(text);
  assert.strictEqual(h.actualBody, h.body, "starter.ts was edited by hand: run `node src/botTiles/genStarter.mjs`");
  if (existsSync(LOOKS_SOURCE)) {
    const src = readFileSync(LOOKS_SOURCE, "utf8");
    assert.strictEqual(h.src, sha(src), "the server's shared/bots/looks.json changed: run `node src/botTiles/genStarter.mjs` (and commit TAILZU-DESKTOP/botLooks.js)");
    assert.deepStrictEqual(STARTER, JSON.parse(src));
    if (existsSync(DESKTOP_OUT)) assert.strictEqual(hashesOf(readFileSync(DESKTOP_OUT, "utf8")).src, sha(src), "TAILZU-DESKTOP/botLooks.js is behind: regenerate it");
  }
  // The first library, every one of them.
  for (const id of ["dance", "fart", "sneeze", "sleep", "juggle", "celebrate", "dizzy", "shrug", "facepalm", "highfive", "sweat", "hiccup"]) {
    assert.ok(L.moment(id), `${id} plays`);
  }
});

/** A bot on a stage: a tile's (with its fabric) or a page's. */
function staged(avatar: string, w: number, h: number, size?: number, seed = 4): BotTile {
  const t = new BotTile({ kind: "custom", color: "#6E4A6B", mood: "idle", seed, size, avatar: L.avatar("custom", avatar) });
  t.resize(w, h, h - (size ? 2 : 14));
  for (let f = 0; f < 30; f++) t.step(1 / 60);
  return t;
}

test("every moment on every look, on a tile and on a page's stage: finite, inside, in bounded drawing; once ends, a loop goes on, deliver ends it", () => {
  for (const [w, h, size] of [[169, 132, undefined], [104, 48, 30], [350, 128, 52]] as const) {
    for (const id of MOMENTS) for (const av of AVATARS) {
      const m = L.moment(id)!;
      for (const mode of ["once", "loop"] as const) {
        const t = staged(av, w, h, size);
        assert.ok(t.playMoment(m, mode), `${id} plays`);
        const frames = Math.ceil((m.dur + 0.5) * 60);
        let worst = 0;
        for (let f = 0; f < frames; f++) {
          t.step(1 / 60);
          if (f % 15 === 0) {
            assert.ok(t.finite(), `${id}/${av}/${mode} ${w}x${h}: not finite at ${f}`);
            assert.ok(t.inside(), `${id}/${av}/${mode} ${w}x${h}: left the stage at ${f}`);
            const c = counter();
            t.draw(c);
            worst = Math.max(worst, c.calls);
          }
        }
        assert.ok(worst < 900, `${id}/${av}: ${worst} calls in a frame`);
        if (mode === "once") assert.ok(t.momentDone() && t.momentId() === "", `${id} once: over, and back to his own play`);
        else {
          assert.strictEqual(t.momentId(), id, `${id} loop: still at it`);
          t.deliver();
          for (let f = 0; f < 60 * (m.endDur + 0.3); f++) t.step(1 / 60);
          assert.ok(t.momentDone(), `${id}: its end, then over`);
          assert.ok(t.finite() && t.inside());
        }
      }
    }
  }
});

test("a moment is the same everywhere: same seed, same frames", () => {
  for (const id of MOMENTS) {
    const a = staged("pip", 169, 132), b = staged("pip", 169, 132);
    a.playMoment(L.moment(id), "loop"); b.playMoment(L.moment(id), "loop");
    for (let f = 0; f < 240; f++) { a.step(1 / 60); b.step(1 / 60); }
    assert.deepStrictEqual(Array.from(a.x), Array.from(b.x), id);
    assert.deepStrictEqual(Array.from(a.qx), Array.from(b.qx), id);
  }
});

test("moments are physics: the body never jumps, and a recipe moves him through goals (a hop leaves the floor, a sit lowers him)", () => {
  for (const id of MOMENTS) {
    const t = staged("blip", 169, 132);
    t.playMoment(L.moment(id), "once");
    for (let f = 0; f < 240; f++) {
      const x0 = Array.from(t.x.slice(0, 13)), y0 = Array.from(t.y.slice(0, 13));
      t.step(1 / 60);
      for (let i = 0; i < 13; i++) assert.ok(Math.hypot(t.x[i]! - x0[i]!, t.y[i]! - y0[i]!) < t.S * 0.95, `${id}: part ${i} jumped`);
    }
  }
  const hop = staged("blip", 169, 132);
  hop.playMoment(L.moment("celebrate"), "once");
  let air = 0;
  for (let f = 0; f < 90; f++) { hop.step(1 / 60); if (!hop.grounded) air++; }
  assert.ok(air > 10, `celebrate leaves the floor (${air} frames)`);
  const nap = staged("blip", 169, 132);
  nap.playMoment(L.moment("sleep"), "loop");
  for (let f = 0; f < 60 * 4; f++) nap.step(1 / 60);
  assert.ok(nap.sit > 0.8, "asleep, sitting");
  assert.ok(nap.lid > 0.85, "eyes shut");
});

test("the props and particles a recipe asks for: notes when he dances, a party hat when he celebrates, 0s and 1s in the air, stars round a dizzy head", () => {
  const seen = (id: string, frames: number) => {
    const t = staged("blip", 169, 132);
    t.playMoment(L.moment(id), "loop");
    const parts = new Set<string>();
    for (let f = 0; f < frames; f++) {
      t.step(1 / 60);
      for (let q = 0; q < t.qlife.length; q++) if (t.qlife[q]! > 0 && t.qpart[q]) parts.add(t.qpart[q]!.id);
      for (let s = 0; s < t.wparts.length; s++) if (t.wparts[s]) parts.add("prop:" + t.wparts[s]!.id);
    }
    return parts;
  };
  assert.ok(seen("dance", 120).has("note"));
  assert.ok(seen("celebrate", 60).has("prop:partyhat"));
  const j = seen("juggle", 120);
  assert.ok(j.has("bit0") && j.has("bit1"));
  assert.ok(seen("dizzy", 130).has("star"));
  assert.ok(seen("sleep", 60 * 5).has("z"));
  assert.ok(seen("fart", 60).has("puff"));
});

test("juggling drops one now and then: it lands, and he looks at it", () => {
  const t = staged("blip", 169, 132, undefined, 11);
  t.playMoment(L.moment("juggle"), "loop");
  let dropped = false, looked = false;
  for (let f = 0; f < 60 * 30 && !looked; f++) {
    t.step(1 / 60);
    const q = t.qMiss;
    if (q >= 0 && t.qlife[q]! > 0 && t.qy[q]! > t.floor - t.S * 0.1) dropped = true;
    if (dropped && q >= 0 && t.lookY > t.y[0]! && Math.abs(t.lookX - t.qx[q]!) < 1e-6) looked = true;
  }
  assert.ok(dropped, "a 0 or a 1 on the floor");
  assert.ok(looked, "and his eyes on it");
});

/** Four of Home's tiles in one world. */
function home(seed = 1): BotTilesWorld {
  const bots = (["custom", "code", "keybot", "plan"] as BotKind[]).map((k, i) => new BotTile({ kind: k, color: "#4F7A3A", mood: "idle", seed: seed + i, avatar: L.avatar(k) }));
  const w = gridWorld(bots);
  bots.forEach((_b, i) => w.place(i, (i % 2) * 181, Math.floor(i / 2) * 144, 169, 132, 72));
  for (let f = 0; f < 60; f++) w.step(1 / 60);
  return w;
}

test("the others answer: they lean away from a fart, look at a sneeze, laugh at hiccups, and the nearest comes for a high five", () => {
  for (const [id, react] of [["fart", "react.leanaway"], ["sneeze", "react.look"], ["hiccup", "react.laugh"], ["celebrate", "react.cheer"], ["highfive", "highfive.join"]]) {
    const w = home();
    w.tiles[0]!.playMoment(L.moment(id!), "once");
    const answered = new Set<number>();
    let leaned = false;
    for (let f = 0; f < 60 * 3; f++) {
      w.step(1 / 60);
      w.tiles.forEach((t, i) => {
        if (i > 0 && t.momentId() === react) {
          answered.add(i);
          assert.strictEqual(t.partner, 0, "with him as their partner");
          // Leaning away: his head further from the source than his hips.
          if (react === "react.leanaway" && Math.abs(t.peerX - t.x[0]!) > Math.abs(t.peerX - t.x[2]!) + t.S * 0.05) leaned = true;
        }
      });
      for (const t of w.tiles) assert.ok(t.finite() && t.inside());
    }
    assert.ok(answered.size >= 1, `${id}: someone answers with ${react}`);
    if (react === "react.leanaway") assert.ok(leaned, "and leans away from it");
    if (id === "highfive") assert.strictEqual(answered.size, 1, "one partner for a high five");
  }
  // Alone (a page's own stage): the high five is to the screen.
  const solo = staged("blip", 169, 132);
  solo.playMoment(L.moment("highfive"), "once");
  let palm = false;
  for (let f = 0; f < 120; f++) { solo.step(1 / 60); for (const p of solo.wparts) if (p?.id === "palm") palm = true; }
  assert.ok(palm, "alone: a hand on the glass");
});

test("Home's idle surprises: only bots at their own idle play, at the rate the server sets, and never while a tile is tapped", () => {
  const list = ["fart", "sneeze", "hiccup"].map((id) => L.moment(id)!);
  const w = home();
  w.tiles[1]!.setMood("working");
  w.surprise(list, 2, 1, 3);
  const played = new Set<number>();
  for (let f = 0; f < 60 * 20; f++) { w.step(1 / 60); w.tiles.forEach((t, i) => { if (t.mo && !t.mo.react) played.add(i); }); }
  assert.ok(played.size >= 2, `surprises happen (${[...played].join(",")})`);
  assert.ok(!played.has(1), "never for a working bot");
  const none = home();
  none.surprise(list, 2, 0, 3);
  for (let f = 0; f < 60 * 20; f++) { none.step(1 / 60); assert.ok(none.tiles.every((t) => !t.mo), "chance 0: none"); }
  const tapped = home();
  tapped.surprise(list, 1, 1, 3);
  tapped.focus(2, 50, 50);
  for (let f = 0; f < 60 * 4; f++) { tapped.step(1 / 60); assert.ok(tapped.tiles.every((t) => !t.mo), "not while tapped"); }
});

test("Reduce Motion in a moment: its still pose (asleep: sitting, eyes shut), and nothing moves", () => {
  const t = staged("blip", 169, 132);
  t.playMoment(L.moment("sleep"), "loop");
  t.settle(true);
  assert.ok(t.sit > 0.8 && t.lid > 0.85, "the sleep pose");
  const x = Array.from(t.x);
  for (let f = 0; f < 60; f++) t.step(1 / 60);
  assert.deepStrictEqual(Array.from(t.x), x);
  const c = recorder();
  t.draw(c.ctx);
  assert.ok(c.out.length > 20);
  t.settle(false);
  for (let f = 0; f < 60; f++) t.step(1 / 60);
  assert.ok(t.finite() && t.momentId() === "sleep", "and lives on in it after");
});

test("what a build cannot play is left out, never a crash: a newer format, an unknown track, a bad expression, a missing part", () => {
  const base = JSON.parse(JSON.stringify(STARTER)) as { v: number; moments: Record<string, unknown>; avatars: Record<string, unknown> };
  base.moments["future"] = { format: LOOKS_FORMAT + 1, dur: 1, tracks: [{ do: "teleport" }], fallback: "wave" };
  base.moments["odd"] = { dur: 1, tracks: [{ do: "teleport" }], fallback: "wave" };
  base.moments["typo"] = { dur: 1, tracks: [{ do: "crouch", v: "sin(t" }], fallback: "think" };
  base.moments["nopart"] = { dur: 1, tracks: [{ do: "prop", part: "nothing" }] };
  base.avatars["broken"] = { extends: "blip", eyes: { style: "three" } };
  const C = compileLooks(base);
  assert.strictEqual(C.moment("future"), null);
  assert.strictEqual(C.moment("odd"), null);
  assert.strictEqual(C.fallback("odd"), "wave");
  assert.strictEqual(C.moment("typo"), null);
  assert.strictEqual(C.fallback("typo"), "think");
  assert.strictEqual(C.moment("nopart"), null);
  assert.strictEqual(C.fallback("nothing at all"), "play");
  assert.ok(!C.avatars.has("broken"), "a broken look is left out");
  assert.strictEqual(C.avatar("custom", "broken"), C.avatar("custom"), "and his kind's is worn instead");
  assert.ok(C.moment("dance"), "the rest still plays");
  const t = new BotTile({ kind: "make", color: "#000000", seed: 1 });
  t.resize(169, 132, 72);
  assert.ok(!t.playMoment(L.moment("dance")), "Make a bot is dots: no moments");
  assert.ok(!t.playMoment(null));
});

test("the moment language: the mic program's grammar, its built-ins, numbers only; unknown names are errors", () => {
  for (const ok of ["0.3*sin(beat*pi) + crest(t)", "x > 2 ? -1 : 1", "clamp(u, 0, 1)^2", "ramp(t, 0.1, 0.4)", "min(1, 2, 3) + hash(k) + tri(T)", "-2^2"]) assert.strictEqual(checkExpression(ok), "", ok);
  for (const bad of ["sin(", "foo(1)", "y + 1", "1 +", "a.b", "random()"]) assert.notStrictEqual(checkExpression(bad), "", bad);
  for (const f of ["sin", "smooth", "crest", "ramp", "run", "noise", "sign", "tri", "hash"]) assert.ok(MOMENT_FUNCS.includes(f), f);
  // Non-finite is 0, and division by zero too.
  const C = compileLooks({ v: 1, moments: { m: { dur: 1, tracks: [{ do: "crouch", v: "1/0 + log(-1) + sqrt(-4)" }] } } });
  assert.deepStrictEqual(C.errors, []);
  const t = staged("blip", 169, 132);
  t.playMoment(C.moment("m"), "once");
  for (let f = 0; f < 30; f++) t.step(1 / 60);
  assert.ok(t.finite());
});

test("a look from data: shapes, eyes, ears, antennae, what he wears; an inline spec over Blip; a living bot re-skinned in place", () => {
  for (const id of AVATARS) {
    const t = staged(id, 169, 132);
    for (let f = 0; f < 120; f++) t.step(1 / 60);
    const c = counter();
    t.draw(c);
    assert.ok(c.calls > 30 && c.calls < 900, `${id}: ${c.calls} calls`);
    assert.ok(t.finite() && t.inside(), id);
  }
  const own = compileAvatar({ extends: "pip", eyes: { style: "visor" }, wear: [{ part: "tophat", on: "crown" }] } as never, L);
  assert.strictEqual(own.eyes, 3);
  assert.strictEqual(own.head, 2, "the rest is Pip's");
  assert.strictEqual(own.wear.length, 1);
  const t = staged("blip", 169, 132);
  const before = t.x[2];
  t.setAvatar(L.avatar("custom", "bolt"));
  assert.strictEqual(t.x[2], before, "where he stood");
  assert.strictEqual(t.rH, t.S * L.avatar("custom", "bolt").headR, "his new head");
  for (let f = 0; f < 240; f++) t.step(1 / 60);
  assert.ok(t.finite() && t.inside());
});

test("the store: the build's starter, a kept copy when newer, the server's when the bootstrap names another version (up or down); a broken one is refused", async () => {
  let kept: string | null = null, fetched = 0;
  const server: Record<string, unknown> = {};
  const io = { read: async () => kept, write: async (s: string) => { kept = s; }, fetch: async (path: string) => { fetched++; return server[path]; } };
  const v2 = { ...(STARTER as object), v: 2 };
  const s = new LooksStore(STARTER, io);
  assert.strictEqual(s.current.v, 1);
  let told = 0;
  s.subscribe(() => { told++; });
  assert.strictEqual(readFlag({ v: 2, url: "https://elsewhere.example/x" }), null, "only the API's own paths");
  server["/v1/bots/looks?v=2"] = v2;
  assert.ok(await s.sync({ v: 2, url: "/v1/bots/looks?v=2" }));
  assert.strictEqual(s.current.v, 2);
  assert.strictEqual(told, 1);
  assert.ok(kept && JSON.parse(kept).v === 2, "kept for the next start");
  assert.ok(!(await s.sync({ v: 2, url: "/v1/bots/looks?v=2" })), "the same version: nothing to do");
  assert.strictEqual(fetched, 1);
  // The next start: the kept copy wins over the starter.
  const again = new LooksStore(STARTER, io);
  await again.restore();
  assert.strictEqual(again.current.v, 2);
  // Taken back on the server: down to 1.
  server["/v1/bots/looks?v=1"] = STARTER;
  assert.ok(await again.sync({ v: 1, url: "/v1/bots/looks?v=1" }));
  assert.strictEqual(again.current.v, 1);
  // A broken one is refused; what is here stays.
  server["/v1/bots/looks?v=3"] = { ...(STARTER as object), v: 3, moments: { bad: { dur: -1, tracks: [] } } };
  assert.ok(!(await again.sync({ v: 3, url: "/v1/bots/looks?v=3" })));
  assert.strictEqual(again.current.v, 1);
  // A version that is not what the flag said is refused too.
  server["/v1/bots/looks?v=4"] = v2;
  assert.ok(!(await again.sync({ v: 4, url: "/v1/bots/looks?v=4" })));
});
