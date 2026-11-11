// node --test --experimental-strip-types src/notifications/ringtoneCore.test.ts
//
// The iPhone's ringtone put where iOS plays it from: copied once, never half a file, nothing left behind when a step fails, and
// an answer for the push token within its time however slow the copy is.

import test from "node:test";
import assert from "node:assert";
import { RINGTONE_MIN_BYTES, installRingtone, ringtoneOnce, type FileLike, type RingtoneIO } from "./ringtoneCore.ts";

const TONE = 882_044;
const SOUNDS = "group/Library/Sounds";

/** A pretend disk: path → size. */
function disk(opts: { group?: boolean; bundled?: string; failCopy?: boolean; failMove?: boolean; failDir?: boolean } = {}) {
  const files = new Map<string, number>();
  if (opts.bundled !== "") files.set(opts.bundled ?? "file:///update/x0_ring_1.wav", TONE);
  const log: string[] = [];
  const file = (path: string): FileLike => ({
    get exists() { return files.has(path); },
    get size() { return files.get(path) ?? 0; },
    delete() { log.push(`delete ${path}`); files.delete(path); },
    async copy(to) {
      log.push(`copy ${path} -> ${(to as unknown as { path: string }).path}`);
      if (opts.failCopy) {
        // A copy that dies halfway leaves a stub behind.
        files.set((to as unknown as { path: string }).path, 1000);
        throw new Error("disk full");
      }
      files.set((to as unknown as { path: string }).path, files.get(path) ?? 0);
    },
    async move(to, o) {
      const dest = (to as unknown as { path: string }).path;
      log.push(`move ${path} -> ${dest}${o.overwrite ? " (overwrite)" : ""}`);
      if (opts.failMove) throw new Error("no room");
      if (files.has(dest) && !o.overwrite) throw new Error("exists");
      files.set(dest, files.get(path) ?? 0);
      files.delete(path);
    },
    path,
  } as FileLike & { path: string });
  const io: RingtoneIO = {
    soundsDir: () => (opts.group === false ? null : SOUNDS),
    makeDir: (dir) => { if (opts.failDir) throw new Error("no access"); log.push(`mkdir ${String(dir)}`); },
    file: (dir, name) => file(`${String(dir)}/${name}`),
    bundled: async () => opts.bundled ?? "file:///update/x0_ring_1.wav",
    fileAt: (uri) => file(uri),
  };
  return { files, log, io };
}

test("the first launch copies the tone in through a .part file, then moves it over the real name", async () => {
  const d = disk();
  assert.equal(await installRingtone(d.io), true);
  assert.equal(d.files.get(`${SOUNDS}/x0_ring_1.wav`), TONE);
  assert.equal(d.files.has(`${SOUNDS}/x0_ring_1.wav.part`), false);
  assert.deepStrictEqual(d.log, [
    `mkdir ${SOUNDS}`,
    `copy file:///update/x0_ring_1.wav -> ${SOUNDS}/x0_ring_1.wav.part`,
    `move ${SOUNDS}/x0_ring_1.wav.part -> ${SOUNDS}/x0_ring_1.wav (overwrite)`,
  ]);
});

test("every launch after that finds it in place and copies nothing", async () => {
  const d = disk();
  await installRingtone(d.io);
  d.log.length = 0;
  assert.equal(await installRingtone(d.io), true);
  assert.equal(await installRingtone(d.io), true);
  assert.deepStrictEqual(d.log, [`mkdir ${SOUNDS}`, `mkdir ${SOUNDS}`]);
});

test("a stub at the tone's name (an interrupted copy) is replaced, and an old .part is cleared first", async () => {
  const d = disk();
  d.files.set(`${SOUNDS}/x0_ring_1.wav`, 4096);
  d.files.set(`${SOUNDS}/x0_ring_1.wav.part`, 12);
  assert.ok(4096 < RINGTONE_MIN_BYTES && RINGTONE_MIN_BYTES < TONE);
  assert.equal(await installRingtone(d.io), true);
  assert.equal(d.files.get(`${SOUNDS}/x0_ring_1.wav`), TONE);
  assert.ok(d.log.includes(`delete ${SOUNDS}/x0_ring_1.wav.part`));
});

test("a build without the App Group has nowhere to put it: no tone, and nothing touched", async () => {
  const d = disk({ group: false });
  assert.equal(await installRingtone(d.io), false);
  assert.deepStrictEqual(d.log, []);
});

test("an update that could not hand over its tone means no tone (the server sends the default sound)", async () => {
  const d = disk({ bundled: "" });
  assert.equal(await installRingtone(d.io), false);
  assert.equal(d.files.has(`${SOUNDS}/x0_ring_1.wav`), false);
});

test("a copy that fails leaves no half file behind, and says no tone", async () => {
  const d = disk({ failCopy: true });
  assert.equal(await installRingtone(d.io), false);
  assert.equal(d.files.has(`${SOUNDS}/x0_ring_1.wav`), false);
  assert.equal(d.files.has(`${SOUNDS}/x0_ring_1.wav.part`), false);
});

test("a move that fails leaves the real name untouched and the .part cleared", async () => {
  const d = disk({ failMove: true });
  assert.equal(await installRingtone(d.io), false);
  assert.equal(d.files.has(`${SOUNDS}/x0_ring_1.wav`), false);
  assert.equal(d.files.has(`${SOUNDS}/x0_ring_1.wav.part`), false);
});

test("a folder that cannot be made is a no, never a throw", async () => {
  assert.equal(await installRingtone(disk({ failDir: true }).io), false);
  const throwing: RingtoneIO = { ...disk().io, soundsDir: () => { throw new Error("no container"); } };
  assert.equal(await installRingtone(throwing), false);
});

test("one install per launch, however often the token's registration asks", async () => {
  let runs = 0;
  const ready = ringtoneOnce(async () => { runs++; return true; }, () => false);
  assert.equal(await ready(), true);
  assert.equal(await ready(), true);
  assert.equal(await Promise.all([ready(), ready()]).then((r) => r.every(Boolean)), true);
  assert.equal(runs, 1);
});

test("a slow install is not waited on past its time: the answer is whether the tone is there now", async () => {
  let finish: (v: boolean) => void = () => {};
  const slow = new Promise<boolean>((r) => { finish = r; });
  let there = false;
  const ready = ringtoneOnce(() => slow, () => there);
  assert.equal(await ready(20), false);
  there = true;
  assert.equal(await ready(20), true);
  finish(true);
  assert.equal(await ready(20), true);
});

test("an install that throws, or a check that throws, is a no", async () => {
  const ready = ringtoneOnce(async () => { throw new Error("boom"); }, () => true);
  assert.equal(await ready(), false);
  const stuck = ringtoneOnce(() => new Promise<boolean>(() => {}), () => { throw new Error("gone"); });
  assert.equal(await stuck(10), false);
});
