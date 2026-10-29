// node --test --experimental-strip-types src/sdui/soundsCore.test.ts
//
// The bots' sounds: the server's catalog read safely (and the server's own pack reads whole); the pack on the phone follows
// the server's version, files first, the old ones let go; the throw is picked by weight, never the same twice running,
// the rare one about 1 in 20 and never twice running either; a moment's sound by its name; nothing plays when either
// switch is off, the app is behind, or the app's own sound or microphone is on; and the session asked for respects the
// silent switch and mixes with other audio.

import test from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_MODE, fileName, mayPlay, momentSound, parsePack, pick, readSoundsFlag, SFX_MODE, SoundStore, volumeOf, type Sound, type SoundPack, type SoundsIO,
} from "./soundsCore.ts";

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const s = (id: string, kind: Sound["kind"], weight = 1, rare = false) =>
  ({ id, kind, url: `/bots/sounds/${id}.m4a?h=0123456789ab`, hash: "0123456789ab", weight, ms: 300, ...(rare ? { rare: true } : {}) });

const PACK = {
  v: 3,
  sounds: [
    s("boing", "throw", 3), s("pop", "throw", 3), s("plink", "throw", 2), s("tok", "throw", 1), s("slide", "throw", 1, true),
    s("tick", "tick"), s("chime", "new"), s("hmm", "uptodate"), s("sneeze", "moment"), s("fart.small", "moment"),
  ],
};

test("the catalog is read safely: what does not read is left out", () => {
  const p = parsePack(PACK)!;
  assert.equal(p.v, 3);
  assert.equal(p.sounds.length, 10);
  assert.equal(p.sounds.find((x) => x.id === "slide")!.rare, true);
  const bad = parsePack({
    v: 2,
    sounds: [
      s("ok", "throw"), { ...s("ok", "tick") }, { ...s("Bad Id", "throw") }, { ...s("x", "boom" as never) }, { ...s("y", "throw"), hash: "nope" },
      { ...s("z", "throw"), url: "http://evil.example/z.m4a" }, { ...s("w", "throw"), url: "/bots/sounds/../../etc" }, { ...s("q", "throw"), weight: -1 },
      { ...s("r", "throw"), url: "https://cdn.example/r.m4a" }, 7, null,
    ],
  })!;
  assert.deepEqual(bad.sounds.map((x) => x.id), ["ok", "r"]);
  assert.equal(parsePack({ v: 0, sounds: PACK.sounds }), null);
  assert.equal(parsePack({ v: 1, sounds: [] }), null);
  assert.equal(parsePack("x"), null);
  assert.equal(fileName(p.sounds.find((x) => x.id === "fart.small")!), "fart_small-0123456789ab.m4a");
});

test("the server's own pack reads whole, as it serves it", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, "../../../../TAILZU-BACKEND/shared/bots/sounds.json");
  if (!existsSync(file)) return;
  const cat = JSON.parse(readFileSync(file, "utf8")) as { v: number; sounds: Array<{ id: string; file: string; hash: string }> };
  // As GET /v1/bots/sounds serves it: each file's address with its hash.
  const served = { v: cat.v, sounds: cat.sounds.map((x) => ({ ...x, url: `/bots/sounds/${x.file}?h=${x.hash}`, file: undefined })) };
  const p = parsePack(served)!;
  assert.equal(p.sounds.length, cat.sounds.length);
  for (const kind of ["throw", "tick", "new", "uptodate"] as const) assert.ok(p.sounds.some((x) => x.kind === kind), kind);
  for (const name of ["sneeze", "fart.small", "party", "hic", "clap"]) assert.ok(momentSound(p, name), name);
});

test("the throw: by weight, never the same twice running", () => {
  const p = parsePack(PACK)!;
  const rand = seeded(11);
  const counts: Record<string, number> = {};
  let last: string | null = null;
  const N = 40000;
  for (let i = 0; i < N; i++) {
    const got = pick(p, "throw", { last, rareChance: 0, noRepeat: true, rand })!;
    assert.notEqual(got.id, last, "never the one that played last");
    counts[got.id] = (counts[got.id] ?? 0) + 1;
    last = got.id;
  }
  assert.equal(counts.slide, undefined, "the rare one only on its own roll");
  // With no repeats the shares bend toward the lighter ones, but the heavier still come up more.
  assert.ok(counts.boing! > counts.plink! && counts.plink! > counts.tok!, JSON.stringify(counts));
  // Without the rule, weights are kept exactly (3:3:2:1).
  const free: Record<string, number> = {};
  for (let i = 0; i < N; i++) { const got = pick(p, "throw", { last: "boing", rareChance: 0, noRepeat: false, rand })!; free[got.id] = (free[got.id] ?? 0) + 1; }
  assert.ok(Math.abs(free.boing! / N - 3 / 9) < 0.015 && Math.abs(free.tok! / N - 1 / 9) < 0.01, JSON.stringify(free));
});

test("the rare one: about rareChance of the throws, and never twice running", () => {
  const p = parsePack(PACK)!;
  const rand = seeded(5);
  let last: string | null = null, rare = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) {
    const got = pick(p, "throw", { last, rareChance: 0.05, noRepeat: true, rand })!;
    if (got.rare) { rare++; assert.notEqual(last, got.id); }
    last = got.id;
  }
  assert.ok(Math.abs(rare / N - 0.05) < 0.006, `rare ${rare / N}`);
  // A chance that is not a number counts as none; one over 1 as always (but never twice running).
  assert.equal(pick(p, "throw", { last: null, rareChance: Number.NaN, noRepeat: true, rand })!.rare, false);
  assert.equal(pick(p, "throw", { last: null, rareChance: 5, noRepeat: true, rand })!.id, "slide");
  assert.notEqual(pick(p, "throw", { last: "slide", rareChance: 5, noRepeat: true, rand })!.id, "slide");
});

test("only sounds the phone has; one sound of a kind plays every time; a moment's by its name", () => {
  const p = parsePack(PACK)!;
  const rand = seeded(2);
  for (let i = 0; i < 50; i++) assert.equal(pick(p, "throw", { last: null, rareChance: 0, noRepeat: true, rand, usable: (x) => x.id === "pop" })!.id, "pop");
  assert.equal(pick(p, "throw", { last: null, rareChance: 0, noRepeat: true, rand, usable: () => false }), null);
  assert.equal(pick(p, "tick", { last: "tick", rareChance: 0, noRepeat: true, rand })!.id, "tick");
  assert.equal(pick(null, "tick", { last: null, rareChance: 0, noRepeat: true, rand }), null);
  assert.equal(momentSound(p, "sneeze")!.id, "sneeze");
  assert.equal(momentSound(p, "boing"), null, "a throw is not a moment's");
  assert.equal(momentSound(p, "snore"), null, "a moment with no sound plays none");
});

test("the rules: both switches on, the app in front, nothing of the app's own playing", () => {
  const all = { knob: true, user: true, active: true, busy: false };
  assert.equal(mayPlay(all), true);
  assert.equal(mayPlay({ ...all, knob: false }), false, "the server turned them off");
  assert.equal(mayPlay({ ...all, user: false }), false, "the person turned them off on this phone");
  assert.equal(mayPlay({ ...all, active: false }), false, "the app is behind");
  assert.equal(mayPlay({ ...all, busy: true }), false, "a voice sample or the microphone is on");
  assert.equal(volumeOf(0.4, 0.7), 0.4);
  assert.equal(volumeOf(3, 0.7), 1);
  assert.equal(volumeOf(Number.NaN, 0.7), 0.7);
});

test("the session a sound asks for: silent when the phone is, mixed with other audio, lowering none of it", () => {
  // expo-audio: playsInSilentMode false is iOS's ambient category (the silent switch silences it) and, on Android, nothing
  // while the ringer is on silent or vibrate; mixWithOthers takes no audio focus and ducks nothing.
  assert.deepEqual(SFX_MODE, { playsInSilentMode: false, interruptionMode: "mixWithOthers", allowsRecording: false, shouldPlayInBackground: false });
  assert.notEqual(SFX_MODE.interruptionMode, "duckOthers");
  assert.equal(APP_MODE.playsInSilentMode, true, "the app's own players' session comes back after");
});

/** IO in memory: a server with catalogs by version and files, a phone with a kept catalog and a folder. */
function io(o: { server: Record<number, unknown>; missing?: string[] }) {
  const folder = new Set<string>();
  const calls: string[] = [];
  let kept: string | null = null;
  const x: SoundsIO & { folder: Set<string>; calls: string[]; kept: () => string | null } = {
    folder, calls, kept: () => kept,
    read: async () => kept,
    write: async (t) => { kept = t; },
    fetch: async (p) => { calls.push(`GET ${p}`); const v = Number(/v=(\d+)/.exec(p)?.[1]); if (!(v in o.server)) throw new Error("404"); return o.server[v]; },
    download: async (url, name) => { calls.push(`FILE ${url}`); if (o.missing?.some((m) => url.includes(m))) return false; folder.add(name); return true; },
    list: async () => [...folder],
    remove: async (name) => { folder.delete(name); },
  };
  return x;
}

test("the pack on the phone: the server's when its version moves, files first; the old ones let go; up or down", async () => {
  const v4: SoundPack = { v: 4, sounds: [...PACK.sounds.slice(0, 3), { ...s("zip", "throw", 2), hash: "aaaaaaaaaaaa" }, ...PACK.sounds.slice(5)] as Sound[] };
  const d = io({ server: { 3: PACK, 4: v4 }, missing: ["plink"] });
  const store = new SoundStore(d);
  await store.restore();
  assert.equal(store.pack, null, "nothing until the server's come");
  let heard = 0;
  store.subscribe(() => heard++);
  assert.equal(await store.sync({ v: 3, url: "/v1/bots/sounds?v=3" }), true);
  assert.equal(store.pack!.v, 3);
  assert.equal(heard, 1);
  assert.equal(store.file(store.pack!.sounds.find((x) => x.id === "boing")!), "boing-0123456789ab.m4a");
  assert.equal(store.file(store.pack!.sounds.find((x) => x.id === "plink")!), null, "a file that did not come is not played");
  assert.equal(d.calls.filter((c) => c.startsWith("FILE")).length, PACK.sounds.length);
  // The same version: nothing fetched.
  d.calls.length = 0;
  assert.equal(await store.sync({ v: 3, url: "/v1/bots/sounds?v=3" }), false);
  assert.deepEqual(d.calls, []);
  // A new pack: only the new file is fetched; the files it no longer names go.
  assert.equal(await store.sync({ v: 4, url: "/v1/bots/sounds?v=4" }), true);
  // (plink never came, so it is asked for again.)
  assert.deepEqual(d.calls.filter((c) => c.startsWith("FILE")), ["FILE /bots/sounds/plink.m4a?h=0123456789ab", "FILE /bots/sounds/zip.m4a?h=0123456789ab"]);
  assert.ok(d.folder.has("zip-aaaaaaaaaaaa.m4a"));
  assert.ok(!d.folder.has("tok-0123456789ab.m4a"), "tok is not in v4");
  assert.equal(JSON.parse(d.kept()!).v, 4, "kept for the next start");
  // Taken back on the server: the phone follows it down.
  assert.equal(await store.sync({ v: 3, url: "/v1/bots/sounds?v=3" }), true);
  assert.equal(store.pack!.v, 3);
  // The next start: the kept pack, with what is in the folder.
  const again = new SoundStore(d);
  await again.restore();
  assert.equal(again.pack!.v, 3);
  assert.equal(again.file(again.pack!.sounds[0]!), "boing-0123456789ab.m4a");
});

test("a catalog that does not read, is not the version named, or does not come, changes nothing", async () => {
  const d = io({ server: { 3: PACK, 5: { v: 6, sounds: PACK.sounds }, 7: { nope: true } } });
  const store = new SoundStore(d);
  await store.sync({ v: 3, url: "/v1/bots/sounds?v=3" });
  assert.equal(await store.sync({ v: 5, url: "/v1/bots/sounds?v=5" }), false);
  assert.equal(await store.sync({ v: 7, url: "/v1/bots/sounds?v=7" }), false);
  assert.equal(await store.sync({ v: 9, url: "/v1/bots/sounds?v=9" }), false);
  assert.equal(store.pack!.v, 3);
  assert.equal(readSoundsFlag({ v: 2, url: "https://elsewhere.example/x" }), null, "only a path on the API");
  assert.equal(readSoundsFlag({ v: 0, url: "/v1/bots/sounds" }), null);
  assert.deepEqual(readSoundsFlag({ v: 2, url: "/v1/bots/sounds?v=2" }), { v: 2, url: "/v1/bots/sounds?v=2" });
  assert.equal(await store.sync(undefined), false);
});

test("the app's knob fallbacks for the sounds (sounds.ts reads them)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "sounds.ts"), "utf8");
  for (const [k, v] of [
    ['bool("pullBot.sounds.enabled", true)', ""], ['num("pullBot.sounds.volume", 0.7)', ""], ['num("pullBot.sounds.rareChance", 0.05)', ""],
    ['bool("pullBot.sounds.noRepeat", true)', ""], ['bool("bots.sounds.moments", true)', ""], ['num("bots.sounds.momentVolume", 0.5)', ""],
  ]) assert.ok(src.includes(k), `${k}${v}`);
});
