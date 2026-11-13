/**
 * THE voiceCall AND voiceCallSet ACTIONS (VOICE_REALTIME_CAPABILITY): Plan Ease's call as a live conversation. The phone opens
 * one WebRTC connection straight to the voice service, with the microphone on it and a data channel it only READS; our server
 * does the SDP exchange with its own key and holds the session beside the call, so no credential ever reaches the phone. The
 * rules (phases, words, the throttle, the timers) are callRealtimeCore.ts; this file is the microphone, the connection and the
 * screen's actions.
 *
 * THE NATIVE CLIENT IS LOADED LAZILY AND NEVER TRUSTED. `react-native-webrtc` is in the store build only, and this JavaScript
 * also reaches binaries made before it, so the one `require` sits behind the binary's own feature ("realtimeCall") and inside
 * try/catch. Anything that throws — a missing module, a refused microphone, a server that says no — runs the action's
 * `onFallback`, and the call carries on turn by turn exactly as it does today. No other file in the app mentions the client
 * (callRealtime.imports.test.ts holds that).
 *
 * One call per phone, and one microphone open at a time. It ends on voiceCallSet end, when the screen goes (the shell's
 * ScreenHost → callRealtimeCore leaveCall), when the app goes to the background or something interrupts the audio (then
 * onIdle, and "Tap to talk" resumes it), at the server's maxSec plus ten seconds, or when the media closes (the call's view
 * then says whether it ended or fell back). The registry is held from the moment the audio session is asked for, so a warmed-up
 * microphone, and one a call is still opening, go with the screen and end on an End too. Everything that opens a microphone —
 * the warm-up, the call, a second tap on "Tap to talk" — waits for the one in front of it instead of opening its own.
 */
import { AppState, Platform } from "react-native";
import { AudioModule } from "expo-audio";
import { callAudio, isCallAudioAvailable, onCallInterrupted } from "../../../modules/tulmi-stream";
import { endFlowSession, isFlowActive } from "../../../modules/tulmi-bridge";
import { hasBinaryFeature } from "../../device/binary";
import { callEndpoint, errorDetail } from "../client";
import { stopAudio } from "../../media/media";
import type { ActionRef } from "../types";
import { setVoiceLevel, setVoiceWords } from "./voiceBus";
import { voiceStop } from "./voiceLive";
import {
  CALL, actedWrites, aecFor, afterClose, callStart, dropCall, endCallNow, holdCall, maxSecOf, overrunMsOf, stateOf, step,
  writeWaitMs, type CallState, type HeldCall,
} from "./callRealtimeCore";

/** The voiceCall action, as the server sends it (types.ts). */
export interface CallSpec {
  path: string;
  viewPath: string;
  resume?: boolean;
  statePath: string;
  phasePath: string;
  saidPath: string;
  heardPath: string;
  actedState?: Record<string, string>;
  onEnded?: ActionRef;
  onIdle?: ActionRef;
  onFallback?: ActionRef;
  onBlocked?: ActionRef;
}

/** What the action needs of the screen that ran it. */
export interface CallIO {
  owner: object;
  set(path: string, value: unknown): void;
  run(ref: ActionRef | undefined, event?: unknown): Promise<void>;
}

const warn = (what: string, e: unknown) => console.warn(`[Tailzu][call] ${what}: ${errorDetail(e)}`);

/**
 * Is the app behind something right now? A call is the foreground's: its microphone must never be left open with nobody
 * there. ("inactive" is a pulled-down notification shade on iOS: still here.)
 */
const away = (): boolean => AppState.currentState === "background";

// ===================================================== the little of the live client this file uses

/** Only what the call asks of `react-native-webrtc`. Written out here so no other file has to name the module at all. */
interface Webrtc {
  mediaDevices: { getUserMedia(constraints: unknown): Promise<MediaStreamLike> };
  RTCPeerConnection: new (config?: unknown) => PeerLike;
}

interface MediaStreamLike {
  getTracks(): { stop(): void }[];
}

interface ChannelLike {
  readyState: string;
  addEventListener(name: string, fn: (e: { data?: unknown }) => void): void;
}

interface PeerLike {
  connectionState: string;
  addTrack(track: unknown, stream: MediaStreamLike): unknown;
  createDataChannel(label: string, init?: unknown): ChannelLike;
  createOffer(options?: unknown): Promise<{ sdp?: string; type?: string }>;
  setLocalDescription(d: unknown): Promise<void>;
  setRemoteDescription(d: unknown): Promise<void>;
  getStats(): Promise<unknown>;
  addEventListener(name: string, fn: () => void): void;
  close(): void;
}

/**
 * The one place the live client is named. Behind the binary's own feature and inside try/catch: an older binary, or a client
 * that will not load, returns null and the call falls back to the turn call.
 */
function loadWebrtc(): Webrtc | null {
  if (!hasBinaryFeature("realtimeCall") || !isCallAudioAvailable()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-webrtc") as Webrtc;
  } catch (e) {
    warn("live client", e);
    return null;
  }
}

/** What this phone's model is called, for the echo-canceller list. Android alone says one, and Android alone needs it. */
function modelName(): string {
  if (Platform.OS !== "android") return "";
  const c = Platform.constants as unknown as { Manufacturer?: unknown; Model?: unknown } | undefined;
  return `${String(c?.Manufacturer ?? "")} ${String(c?.Model ?? "")}`.trim();
}

/** The screen never locks during a call. Required lazily, like everything else native here. */
function keepAwake(on: boolean): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const k = require("expo-keep-awake") as { activateKeepAwakeAsync?(t: string): Promise<void>; deactivateKeepAwake?(t: string): void };
    if (on) void k.activateKeepAwakeAsync?.("tulmi-call")?.catch(() => {});
    else k.deactivateKeepAwake?.("tulmi-call");
  } catch { /* without it the screen may dim; the call goes on */ }
}

// ===================================================== the microphone and the offer

/** A microphone open, a connection built on it, and the offer it made. */
interface Ready {
  rtc: Webrtc;
  pc: PeerLike;
  dc: ChannelLike;
  stream: MediaStreamLike;
  sdp: string;
}

/** Everything a Ready holds, let go of. */
function drop(r: Ready | null): void {
  if (!r) return;
  try { for (const t of r.stream.getTracks()) t.stop(); } catch { /* gone */ }
  try { r.pc.close(); } catch { /* gone */ }
}

/**
 * Take the audio session, open the microphone, build the connection and make the offer. Everything up to the offer, which is
 * what `warm` does while the answer is in flight.
 */
async function openMic(owner: object): Promise<Ready | null> {
  // A Flow session holds its own microphone in the background (iOS), with its own playAndRecord engine: it is ended first, and
  // if it somehow still has it, the call does not start at all. Ending one that is not armed would deactivate the audio
  // session and close the keyboard's Live Activity for nothing, so it is asked first.
  if (isFlowActive()) {
    endFlowSession();
    if (isFlowActive()) return null;
  }
  // A live dictation on this screen, or a sound playing, may hold the microphone too.
  voiceStop(owner);
  stopAudio();
  // Which echo canceller this phone needs, and which the process really has. A phone whose own canceller is not good enough
  // (SOFT_AEC_MODELS) cannot hold a live call on it: the bot hears itself, cuts itself off, and its own "…OK?" can come back as
  // the person's "OK" — the read-back before a payment or a move. The ask is remembered for the next start of the app, and until
  // then this call stays a turn call. Nothing has been sent to the server yet, so nothing is spent.
  const want = aecFor(Platform.OS, modelName());
  const has = callAudio("prepare", { aec: want });
  if (want === "soft" && has === "hw") {
    warn("echo canceller", new Error("this phone needs the software one; the next start of the app has it"));
    return null;
  }
  const rtc = loadWebrtc();
  if (!rtc) return null;
  callAudio("begin");
  let stream: MediaStreamLike | null = null;
  let pc: PeerLike | null = null;
  try {
    stream = await rtc.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    // No STUN or TURN: the voice service answers with its own public address and the phone's own candidate reaches it
    // outward, which is how a browser does this too. Nothing of ours is in the media path.
    pc = new rtc.RTCPeerConnection({ iceServers: [] });
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    const dc = pc.createDataChannel(CALL.channel);
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    const sdp = String(offer?.sdp ?? "");
    if (!sdp) throw new Error("no offer");
    return { rtc, pc, dc, stream, sdp };
  } catch (e) {
    warn("microphone", e);
    try { for (const t of stream?.getTracks() ?? []) t.stop(); } catch { /* gone */ }
    try { pc?.close(); } catch { /* gone */ }
    callAudio("end");
    return null;
  }
}

/** Is the microphone already ours to open? A call never asks for the permission itself: the screen does that first. */
async function micGranted(): Promise<boolean> {
  try {
    const p = await AudioModule.getRecordingPermissionsAsync();
    return !!p?.granted;
  } catch {
    return false;
  }
}

/**
 * The microphone and offer got ready while `POST answer` was in flight, worth using for CALL.warmMs. It is in the one-call
 * registry (callRealtimeCore) from the moment the audio session is asked for, so nothing else takes the session meanwhile and
 * the screen going takes the warm microphone with it rather than leaving it open for its twenty seconds.
 */
interface Warm {
  owner: object;
  held: HeldCall;
  /** Null while the microphone is still opening. */
  ready: Ready | null;
  /** Done once the microphone is open or has failed: a call waits on this instead of opening a second one beside it. */
  opening: Promise<void>;
  at: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Let go of already: a microphone that arrives after this is let go at once. */
  gone: boolean;
  /** The app going behind something drops a warmed microphone: nothing holds one with nobody there. */
  appSub: { remove(): void } | null;
}

let warmed: Warm | null = null;

/** A microphone and connection we are not going to use. The audio session too, unless a call holds it or is taking it. */
function letGo(r: Ready | null): void {
  drop(r);
  if (!live && !starting) callAudio("end");
}

function dropWarm(): void {
  const w = warmed;
  warmed = null;
  if (!w) return;
  w.gone = true;
  if (w.timer) clearTimeout(w.timer);
  try { w.appSub?.remove(); } catch { /* gone */ }
  w.appSub = null;
  dropCall(w.held);
  letGo(w.ready);
}

/**
 * voiceCallSet warm: get ready now, so answering is one round trip shorter. Only when the microphone is already granted, and
 * never beside a call: a call that starts meanwhile takes this microphone over (takeWarm) rather than open a second one.
 */
async function warm(io: CallIO): Promise<void> {
  if (!hasBinaryFeature("realtimeCall")) return;
  // Nothing to warm if one is warm already, a call is on, or a call is taking the microphone this moment. Asked again after
  // the permission, because that is an await and the call's own first steps may run inside it.
  if (warmed || live || starting) return;
  if (!(await micGranted())) return;
  if (warmed || live || starting) return;
  let opened = () => {};
  const w: Warm = {
    owner: io.owner, held: { owner: io.owner, end: () => dropWarm() }, ready: null,
    opening: new Promise<void>((r) => { opened = r; }), at: Date.now(), timer: null, gone: false, appSub: null,
  };
  warmed = w;
  holdCall(w.held);
  w.appSub = AppState.addEventListener("change", (st) => { if (st === "background" && warmed === w) dropWarm(); });
  try {
    const ready = await openMic(io.owner);
    // Let go of while the microphone opened (the screen went, the person ended the call, or the app went behind something):
    // whatever opened goes now.
    if (w.gone || warmed !== w) { letGo(ready); return; }
    if (away()) { w.ready = ready; dropWarm(); return; }
    if (!ready) { dropWarm(); return; }
    w.ready = ready;
    w.at = Date.now();
    w.timer = setTimeout(dropWarm, CALL.warmMs);
  } finally {
    // However it went, a call waiting on this microphone goes on now.
    opened();
  }
}

/**
 * The warmed microphone, if this screen's and still fresh; the registry slot stays with the call that asked. One that is still
 * opening is waited for, so there is never a second microphone open beside it.
 */
async function takeWarm(owner: object): Promise<Ready | null> {
  const w = warmed;
  if (!w) return null;
  await w.opening;
  // It let go of itself while we waited: it failed, or the screen went.
  if (warmed !== w) return null;
  warmed = null;
  w.gone = true;
  if (w.timer) clearTimeout(w.timer);
  dropCall(w.held);
  if (!w.ready || w.owner !== owner || Date.now() - w.at > CALL.warmMs) {
    letGo(w.ready);
    return null;
  }
  return w.ready;
}

// ===================================================== the call

interface Live {
  a: CallSpec;
  io: CallIO;
  ready: Ready;
  state: CallState;
  /** Set once, by whichever ending came first, so nothing runs twice. */
  over: boolean;
  /** We closed it ourselves, so a closing connection is not a failure. */
  closing: boolean;
  /** `ready` was sent: the server starts the opening on the first one only. */
  told: boolean;
  held: HeldCall;
  lastWrite: number;
  writeTimer: ReturnType<typeof setTimeout> | null;
  timers: ReturnType<typeof setTimeout>[];
  level: ReturnType<typeof setInterval> | null;
  appSub: { remove(): void } | null;
  offInterrupt: (() => void) | null;
  /** The server's own hard length for this call, from its `live` reply: the phone's backstop is armed from `ready`. */
  maxSec: number;
  /** The connection said "disconnected" and is being given its few seconds to come back. */
  iceLost: boolean;
}

let live: Live | null = null;

/**
 * A call taking the audio session right this moment, between the first `callAudio` and the live call below: its registry slot,
 * so it can be told to let go, and a promise that is done when it has either built its call or given up. A warm let go
 * meanwhile must not end the session under it, and a second tap must wait for it rather than open a second microphone.
 */
interface Start {
  slot: HeldCall;
  done: Promise<void>;
}

let starting: Start | null = null;

export async function voiceCall(a: CallSpec, io: CallIO): Promise<void> {
  if (!hasBinaryFeature("realtimeCall")) { await io.run(a.onFallback); return; }
  if (!(await micGranted())) { await io.run(a.onBlocked); return; }
  // A second tap, while the first call is still opening its microphone: the one in front is told to let go and waited for, so
  // only ever one microphone is open and no call is left orphaned with it. Asked here, after the permission, because that is
  // an await of its own and the one in front may have claimed the microphone inside it.
  while (starting) {
    const first = starting;
    first.slot.end("set");
    await first.done;
  }
  // One call per phone: a second one takes over rather than fight for the microphone.
  if (live) endLive(live, "set");
  // The screen says "connecting" before the microphone, not after: "Tap to talk" goes with it, so a second tap cannot start a
  // second call while this one opens.
  io.set(a.phasePath, "connecting");
  // Held from here, before the microphone and the audio session are asked for, and handed to the call itself below: no other
  // sound, dictation or speech may take the session in between, and a screen that goes, or an End, is answered (`gone`).
  let gone = false;
  const slot: HeldCall = { owner: io.owner, end: () => { gone = true; } };
  let settled = () => {};
  const mine: Start = { slot, done: new Promise<void>((r) => { settled = r; }) };
  starting = mine;
  holdCall(slot);
  // The app can go behind something while the microphone opens and the server answers, and that window is minutes long on a
  // slow connection. Watched from HERE, not from the moment the call is up: iOS keeps an app with an open audio session
  // running, so the bot would speak the opening to an empty room with the microphone on.
  let left = false;
  const bgSub = AppState.addEventListener("change", (st) => { if (st === "background") left = true; });
  const offBg = onCallInterrupted(() => { left = true; });
  const stopWatch = () => { try { bgSub.remove(); } catch { /* gone */ } offBg?.(); };
  let ready: Ready | null = null;
  try {
    // The warm-up's microphone, even one still opening, else our own.
    ready = (await takeWarm(io.owner)) ?? (await openMic(io.owner));
  } finally {
    if (starting === mine) starting = null;
    settled();
  }
  dropCall(slot);
  if (gone) { stopWatch(); letGo(ready); return; }
  if (!ready) { stopWatch(); await io.run(a.onFallback); return; }
  if (left || away()) {
    // Nothing has been sent to the server yet: the call simply waits for a tap, as it does when the app goes mid-call.
    stopWatch();
    letGo(ready);
    io.set(a.phasePath, "idle");
    await io.run(a.onIdle);
    return;
  }
  keepAwake(true);

  const c: Live = {
    a, io, ready, state: callStart(), over: false, closing: false, told: false,
    held: { owner: io.owner, end: () => {} },
    lastWrite: 0, writeTimer: null, timers: [], level: null, appSub: null, offInterrupt: null, maxSec: 0, iceLost: false,
  };
  c.held.end = (why) => endLive(c, why);
  live = c;
  holdCall(c.held);
  write(c, true);
  // The call itself watches the app from here on; the start's own watch is done.
  stopWatch();
  watchApp(c);

  // Getting the call up has to be done inside this, whatever is slow: the server may take up to 13 s to answer. It is counted
  // from the offer going out, not from the microphone opening.
  after(c, CALL.overallMs, () => { if (!up(c)) fall(c, "slow"); });

  let reply: { sdp?: unknown; maxSec?: unknown };
  try {
    reply = await callEndpoint("POST", a.path, { sdp: ready.sdp, ...(a.resume ? { resume: true } : {}) });
  } catch (e) {
    // Any refusal at all is "carry on turn by turn": the server has already said why in its own log.
    warn("live", e);
    fall(c, "refused");
    return;
  }
  if (c.over) return;
  const answer = typeof reply?.sdp === "string" ? reply.sdp : "";
  if (!answer) { fall(c, "no_sdp"); return; }

  // The server arms its own hard length when the phone says `ready`, so the phone's backstop is armed there too (tellReady):
  // counted from the microphone instead, a slow start could close the call before the server's own goodbye.
  c.maxSec = maxSecOf(reply?.maxSec);
  // From the reply, the connection has this long to come up.
  after(c, CALL.connectMs, () => { if (!up(c)) fall(c, "connect"); });

  listen(c);
  try {
    await c.ready.pc.setRemoteDescription({ type: "answer", sdp: answer });
  } catch (e) {
    warn("answer", e);
    fall(c, "answer");
    return;
  }
  if (c.over) return;
  // It may already be up by the time the answer is set.
  tellReady(c);
}

/**
 * Both ops return at once, on purpose. The screen runs `warm` and `POST answer` as a sequence, and a sequence awaits each
 * step: waiting here for the microphone would put the answer behind it, which is the opposite of what warming is for.
 */
export function voiceCallSet(op: "warm" | "end", io: CallIO): void {
  if (op === "warm") { void warm(io).catch((e) => warn("warm", e)); return; }
  // Whatever holds the call ends with it: a warmed microphone, a call still opening one, or the live call.
  endCallNow();
}

/** A timer that is forgotten with the call. */
function after(c: Live, ms: number, fn: () => void): void {
  if (ms <= 0) { fn(); return; }
  c.timers.push(setTimeout(() => { if (!c.over) fn(); }, ms));
}

/** Is the connection up and the channel open? */
function up(c: Live): boolean {
  return c.ready.pc.connectionState === "connected" && c.ready.dc.readyState === "open";
}

/** The events, the connection's own state, the app's, and the audio being taken away. */
function listen(c: Live): void {
  const { pc, dc } = c.ready;
  dc.addEventListener("message", (e) => {
    if (c.over) return;
    let event: unknown;
    try { event = JSON.parse(typeof e?.data === "string" ? e.data : ""); } catch { return; }
    if (!event || typeof event !== "object") return;
    const r = step(c.state, event);
    c.state = r.next;
    write(c, false);
    if (r.reread) void reread(c);
  });
  dc.addEventListener("open", () => tellReady(c));
  dc.addEventListener("close", () => { if (!c.closing) closed(c); });
  pc.addEventListener("connectionstatechange", () => {
    if (c.over || c.closing) return;
    const s = pc.connectionState;
    if (s === "connected") { c.iceLost = false; tellReady(c); }
    else if (s === "failed" || s === "closed") closed(c);
    else if (s === "disconnected" && !c.iceLost) {
      // "disconnected" is not an ending: it is what a handover from Wi-Fi to mobile data looks like, and it usually comes back
      // by itself. The call is given up only if it has not by then.
      c.iceLost = true;
      after(c, CALL.iceGraceMs, () => {
        if (c.ready.pc.connectionState === "connected") c.iceLost = false;
        else closed(c);
      });
    }
  });
  // The bot's level while he speaks, the person's while she does: the stage reads it, it never goes into state.
  c.level = setInterval(() => void levelTick(c), CALL.levelMs);
}

/** Said once, when the channel is open and the connection up: the server then starts the opening. */
function tellReady(c: Live): void {
  if (c.over || c.told || !up(c)) return;
  // The app went behind something while the call was coming up: park it rather than let the bot speak to an empty room.
  if (away()) { idle(c); return; }
  c.told = true;
  // The phone's own backstop, armed from here because that is where the SERVER starts its hard length: it says goodbye at the
  // lead and hangs up at the length, and the phone only closes ten seconds after that.
  const overrun = overrunMsOf(c.maxSec);
  if (overrun) after(c, overrun, () => closed(c));
  void callEndpoint("POST", `${c.a.path}/ready`, {}).catch((e) => warn("ready", e));
}

/**
 * The app going behind something, and the audio being taken away: both park the live part and keep the call, so "Tap to talk"
 * picks it up again. Watched from the moment the call exists, before its offer is even sent.
 */
function watchApp(c: Live): void {
  c.appSub = AppState.addEventListener("change", (st) => { if (st === "background") idle(c); });
  c.offInterrupt = onCallInterrupted(() => idle(c));
}

/** The voice level, straight off the connection: his while he speaks, hers while she is heard. */
async function levelTick(c: Live): Promise<void> {
  if (c.over) return;
  try {
    const report = await c.ready.pc.getStats();
    const want = c.state.phase === "speaking" ? "inbound-rtp" : "media-source";
    let level = 0;
    forEachStat(report, (s) => {
      if (s.type === want && typeof s.audioLevel === "number") level = Math.max(level, s.audioLevel);
    });
    setVoiceLevel(c.io.owner, Math.max(0, Math.min(1, level)));
  } catch { /* statistics are a nicety */ }
}

interface Stat { type?: unknown; audioLevel?: unknown }

/** The client hands statistics back as a Map on one platform and a plain object on the other. */
function forEachStat(report: unknown, fn: (s: Stat) => void): void {
  if (!report) return;
  const each = (report as { forEach?: unknown }).forEach;
  if (typeof each === "function") {
    (report as { forEach(cb: (v: Stat) => void): void }).forEach((v) => { if (v && typeof v === "object") fn(v); });
    return;
  }
  for (const v of Object.values(report as Record<string, Stat>)) if (v && typeof v === "object") fn(v);
}

/** The screen's state, at most ten times a second, and always the last value. */
function write(c: Live, now: boolean): void {
  const wait = now ? 0 : writeWaitMs(c.lastWrite, Date.now());
  if (wait > 0) {
    if (!c.writeTimer) c.writeTimer = setTimeout(() => { c.writeTimer = null; write(c, true); }, wait);
    return;
  }
  if (c.writeTimer) { clearTimeout(c.writeTimer); c.writeTimer = null; }
  c.lastWrite = Date.now();
  const { a, io, state } = c;
  io.set(a.phasePath, state.phase);
  io.set(a.saidPath, state.said);
  io.set(a.heardPath, state.heard);
  io.set(a.statePath, stateOf(state));
}

/** A tool ran: read the call again, so the item card's buttons show what was done. */
async function reread(c: Live): Promise<void> {
  try {
    const view = await callEndpoint("GET", c.a.viewPath);
    if (c.over) return;
    for (const path of actedWrites((view as { acted?: unknown })?.acted, c.a.actedState)) c.io.set(path, true);
  } catch (e) {
    warn("view", e);
  }
}

// ===================================================== the ways it ends

/** Let go of the microphone, the connection, the timers and the audio session. */
function teardown(c: Live): void {
  c.closing = true;
  if (c.writeTimer) { clearTimeout(c.writeTimer); c.writeTimer = null; }
  for (const t of c.timers) clearTimeout(t);
  c.timers = [];
  if (c.level) { clearInterval(c.level); c.level = null; }
  try { c.appSub?.remove(); } catch { /* gone */ }
  c.appSub = null;
  c.offInterrupt?.();
  c.offInterrupt = null;
  drop(c.ready);
  callAudio("end");
  keepAwake(false);
  setVoiceLevel(c.io.owner, 0);
  setVoiceWords(c.io.owner, "");
  if (live === c) live = null;
  dropCall(c.held);
}

/** The one ending, whichever came first. */
function finish(c: Live): boolean {
  if (c.over) return false;
  c.over = true;
  teardown(c);
  return true;
}

/** It could not start, or it broke before the bot was heard: the turn call takes over, with no tap from the person. */
function fall(c: Live, why: string): void {
  if (!finish(c)) return;
  console.warn(`[Tailzu][call] turn call takes over (${why})`);
  void c.io.run(c.a.onFallback);
}

/** The media closed and we did not close it: the call's own view says whether it is over or carries on turn by turn. */
function closed(c: Live): void {
  if (!finish(c)) return;
  void (async () => {
    let view: unknown = null;
    try { view = await callEndpoint("GET", c.a.viewPath); } catch (e) { warn("view", e); }
    if (afterClose(view) === "ended") {
      c.io.set(c.a.phasePath, "ended");
      await c.io.run(c.a.onEnded);
    } else {
      await c.io.run(c.a.onFallback);
    }
  })();
}

/** The app went behind something, or the audio was taken: the live part stops and the call waits for a tap. */
function idle(c: Live): void {
  if (!finish(c)) return;
  void callEndpoint("POST", `${c.a.path}/stop`, {}).catch((e) => warn("stop", e));
  c.io.set(c.a.phasePath, "idle");
  void c.io.run(c.a.onIdle);
}

/** The screen asked (voiceCallSet end, or its own hangup), or the screen went. Nothing is run after: the screen knows. */
function endLive(c: Live, why: "left" | "set"): void {
  if (!finish(c)) return;
  if (why === "left") void callEndpoint("POST", `${c.a.path}/stop`, {}).catch(() => {});
}
