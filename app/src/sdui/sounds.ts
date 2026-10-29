/**
 * THE BOTS' SOUNDS ON THIS PHONE (the rules are soundsCore.ts's; the server's side is backend experience/bots/sounds.ts).
 *
 *   The pack      the bootstrap's flag "bots.sounds" names the catalog's version; when it moves, the catalog and the files
 *                 this phone lacks are fetched into its own folder (documents: kept across launches), and the old files go.
 *                 Until a pack is here, nothing plays.
 *   Playing       pull-a-bot: the tick at the line, a throw when the bot is thrown (never the same twice running, a rare
 *                 one now and then), "new" or "up to date" after the refresh; the bots' moments: the sound a recipe names
 *                 (core.ts onSound). One small expo-audio player per sound, made when first needed and kept (a few at a
 *                 time), so a sound starts at once; the next throw is picked and readied while the finger is still down.
 *   The session   before a sound, the audio session that mixes with other apps, lowers none, and is silent when the phone
 *                 is (soundsCore SFX_MODE); after a while without one, the one the app's own players use (APP_MODE).
 *                 Never while the app's own sound or microphone is on (media.ts says so: yieldSoundsTo).
 *   The switch    "Sounds" on the You tab (devicePref "sounds"): kept on this phone, on until turned off, honoured at once;
 *                 a screen whose state names `soundsOn` gets this phone's value for the switch to show.
 *
 * Nothing here throws or waits on the caller: every call returns at once, and a sound that cannot play is not played.
 *
 * Knobs: pullBot.sounds.enabled (true), pullBot.sounds.volume (0.7), pullBot.sounds.rareChance (0.05),
 * pullBot.sounds.noRepeat (true), bots.sounds.moments (true), bots.sounds.momentVolume (0.5), bots.sounds.players (8),
 * bots.sounds.sessionIdleMs (4000).
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { getBaseUrl } from "../storage";
import { bool, num } from "./knobs";
import type { Store } from "./state";
import { APP_MODE, mayPlay, momentSound, pick, SFX_MODE, SoundStore, volumeOf, type Sound } from "./soundsCore";

const KEPT = "tz.botSounds.v1";
const PREF = "tz.botSounds.on.v1";
const DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}bot-sounds/` : null;

const absolute = async (url: string): Promise<string> => (url.startsWith("https://") ? url : (await getBaseUrl()).replace(/\/$/, "") + url);

const store = new SoundStore({
  read: () => AsyncStorage.getItem(KEPT),
  write: (text) => AsyncStorage.setItem(KEPT, text),
  fetch: async (path) => {
    const res = await fetch(await absolute(path), { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`bots sounds ${res.status}`);
    return res.json();
  },
  download: async (url, name) => {
    if (!DIR) return false;
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const res = await FileSystem.downloadAsync(await absolute(url), DIR + name);
    if (res.status >= 200 && res.status < 300) return true;
    await FileSystem.deleteAsync(DIR + name, { idempotent: true }).catch(() => {});
    return false;
  },
  list: async () => (DIR ? FileSystem.readDirectoryAsync(DIR).catch(() => [] as string[]) : []),
  remove: async (name) => { if (DIR) await FileSystem.deleteAsync(DIR + name, { idempotent: true }); },
});
// The kept pack, as soon as the app starts; the server's when the bootstrap says (syncSounds).
void store.restore();
// A new pack: the players of the old one go.
store.subscribe(() => releaseAll());

/** The bootstrap's flag "bots.sounds": fetch and keep the server's pack when it is another version. Never throws. */
export function syncSounds(flag: unknown): void {
  void store.sync(flag).catch(() => {});
}

// ===================================================================== the person's switch

let userOn = true;
const switched = new Set<(on: boolean) => void>();
void AsyncStorage.getItem(PREF).then((v) => { if (v === "0") setOn(false, false); }).catch(() => {});

function setOn(on: boolean, keep: boolean): void {
  if (on === userOn) return;
  userOn = on;
  if (!on) releaseAll();
  if (keep) void AsyncStorage.setItem(PREF, on ? "1" : "0").catch(() => {});
  for (const fn of switched) { try { fn(on); } catch { /* a listener's fault is its own */ } }
}

/** The Sounds switch on this phone (on until turned off). */
export function soundsOn(): boolean {
  return userOn;
}

/** The action devicePref "sounds": kept on this phone, honoured at once. */
export function setSoundsOn(on: boolean): void {
  setOn(on, true);
}

/** ScreenHost: a screen whose state names `soundsOn` (the one with the switch) gets this phone's, kept in step. */
export function useSoundsState(s: Store): void {
  useEffect(() => {
    const put = (on: boolean) => { const was = s.get("soundsOn"); if (was !== undefined && was !== on) s.set("soundsOn", on); };
    put(userOn);
    switched.add(put);
    return () => { switched.delete(put); };
  }, [s]);
}

// ===================================================================== who else is playing

let otherBusy: () => boolean = () => false;

/** media.ts: whether the app's own sound or microphone is on (a sound never cuts in). */
export function yieldSoundsTo(check: () => boolean): void {
  otherBusy = check;
}

// ===================================================================== the players

/** Players by file name, oldest first (a Map keeps its order). */
const players = new Map<string, AudioPlayer>();

function release(p: AudioPlayer): void {
  try { p.pause(); } catch { /* gone */ }
  try { p.remove(); } catch { /* gone */ }
}

function releaseAll(): void {
  for (const p of players.values()) release(p);
  players.clear();
  next = null;
}

function playerFor(s: Sound): AudioPlayer | null {
  const name = DIR ? store.file(s) : null;
  if (!name) return null;
  const had = players.get(name);
  if (had) {
    players.delete(name);
    players.set(name, had);
    return had;
  }
  try {
    const p = createAudioPlayer({ uri: DIR + name }, { updateInterval: 1000 });
    players.set(name, p);
    const most = Math.max(2, Math.round(num("bots.sounds.players", 8)));
    while (players.size > most) {
      const [oldest, op] = players.entries().next().value as [string, AudioPlayer];
      players.delete(oldest);
      release(op);
    }
    return p;
  } catch {
    return null;
  }
}

// ===================================================================== the session

let setting: Promise<void> | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;

/**
 * The sounds' session, asked for before every sound (the app's own players set theirs before each of theirs, so it is
 * never taken on trust: a sound must never be heard on a silent phone); sounds asked for together share one call. After a
 * quiet spell the app's own comes back.
 */
function session(): Promise<void> {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => {
    idle = null;
    if (!safeBusy()) setAudioModeAsync(APP_MODE).catch(() => {});
  }, Math.max(1000, num("bots.sounds.sessionIdleMs", 4000)));
  if (!setting) setting = setAudioModeAsync(SFX_MODE).catch(() => {}).then(() => { setting = null; });
  return setting;
}

function allowed(knob: boolean): boolean {
  return mayPlay({ knob, user: userOn, active: AppState.currentState === "active", busy: safeBusy() });
}

function safeBusy(): boolean {
  try { return otherBusy(); } catch { return true; }
}

function play(s: Sound | null, volume: number): void {
  if (!s) return;
  const p = playerFor(s);
  if (!p) return;
  void session().then(() => {
    // The switch may have gone off, or the app's own sound started, while the session was set.
    if (!userOn || safeBusy()) return;
    try {
      p.volume = volume;
      // A player that has played starts again from the top; a new one is there already.
      if (p.currentTime > 0.005) p.seekTo(0).then(() => p.play(), () => {});
      else p.play();
    } catch { /* a sound is never worth an error */ }
  });
}

// ===================================================================== pull-a-bot and the moments

let lastThrow: string | null = null;
/** The next throw, picked and readied while the finger is down. */
let next: Sound | null = null;

function pickThrow(): Sound | null {
  return pick(store.pack, "throw", {
    last: lastThrow,
    rareChance: num("pullBot.sounds.rareChance", 0.05),
    noRepeat: bool("pullBot.sounds.noRepeat", true),
    rand: Math.random,
    usable: (s) => store.file(s) !== null,
  });
}

const pullOn = () => bool("pullBot.sounds.enabled", true);
const pullVolume = () => volumeOf(num("pullBot.sounds.volume", 0.7), 0.7);

/** A finger came down on a pulling list: ready the line's sound, the next throw and the answers, so each starts at once. */
export function warmPull(): void {
  try {
    if (!store.pack || !allowed(pullOn())) return;
    if (!next) next = pickThrow();
    for (const kind of ["tick", "new", "uptodate"] as const) {
      const s = store.pack.sounds.find((x) => x.kind === kind && x.weight > 0);
      if (s) playerFor(s);
    }
    if (next) playerFor(next);
  } catch { /* nothing to ready */ }
}

/** Pull-a-bot's moments: the line ("tick"), the throw, something new ("new"), nothing new ("uptodate"). */
export function playPull(kind: "tick" | "throw" | "new" | "uptodate"): void {
  try {
    if (!store.pack || !allowed(pullOn())) return;
    let s: Sound | null;
    if (kind === "throw") {
      s = next && next.id !== lastThrow && store.file(next) ? next : pickThrow();
      next = null;
      if (s) lastThrow = s.id;
    } else {
      s = pick(store.pack, kind, { last: null, rareChance: 0, noRepeat: false, rand: Math.random, usable: (x) => store.file(x) !== null });
    }
    play(s, pullVolume());
    if (kind === "throw") next = pickThrow();
  } catch { /* a sound is never worth an error */ }
}

/** A bots' moment's sound, by the name its recipe gives (core.ts BotTile.onSound). */
export function playMoment(name: string): void {
  try {
    if (!store.pack || !allowed(bool("bots.sounds.moments", true))) return;
    play(momentSound(store.pack, name), volumeOf(num("bots.sounds.momentVolume", 0.5), 0.5));
  } catch { /* a sound is never worth an error */ }
}
