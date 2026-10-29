/**
 * SEND A FILE, SPEAK, PLAY A SOUND: the three media actions (backend shared/types/sdui.ts section 3d), declared by
 * FileUpload, VoiceRecord and AudioPlay in the registry.
 *
 *   uploadFile   the picker for the kind asked (a photo or a screenshot from the library, a video, any file, the
 *                camera), then POST multipart to the server's path with the session, a progress line in state as it
 *                goes, and the answer in state at the end. A refusal is said in the server's words where those are
 *                written for a person (mediaCore.refusalWords).
 *   recordVoice  a tap starts the microphone (asked for properly: refused for good runs onBlocked, for Settings);
 *                the next tap stops it and sends the take to /v1/transcribe-clean; the words go into the field. While
 *                it listens the voice's level is in state, for the screen's bars.
 *   playAudio    one sound at a time: a server path is fetched with the session (and kept for the session), an https
 *                address played as it is; how far it is goes into state.
 *
 * Each belongs to the screen that started it (`owner`, its store): leaving that screen (SduiApp's ScreenHost) stops
 * the sound, throws the recording away and stops the upload. The words a person reads are knobs (media.*).
 */
import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { AudioModule, createAudioPlayer, RecordingPresets, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import type { ActionRef, ActionSpec } from "./types";
import { getBaseUrl } from "../storage";
import { commonHeaders, errorDetail, userErrorMessage } from "./client";
import { num, txt } from "./knobs";
import * as api from "../api";
import {
  MAX_BYTES, cleanName, every, fillPath, isApiPath, joinWords, levelOf, nameFor, playStateOf, progressOf, refusalWords, soundSource,
  type PickKind,
} from "./mediaCore";

/** What a media action needs from the screen that ran it (actions.ts builds one from its Ctx). */
export interface MediaIO {
  /** The screen's store: what "leaving the screen" is measured by. */
  owner: unknown;
  get(path: string): unknown;
  set(path: string, value: unknown): void;
  /** Run one of the action's follow-ups; `event` is what $event means in it. */
  run(ref: ActionRef | undefined, event?: unknown): Promise<void>;
}

type UploadSpec = Extract<ActionSpec, { kind: "uploadFile" }>;
type PlaySpec = Extract<ActionSpec, { kind: "playAudio" }>;
type RecordSpec = Extract<ActionSpec, { kind: "recordVoice" }>;

const warn = (what: string, e: unknown) => console.warn(`[Tailzu][media] ${what}:`, errorDetail(e));

// =================================================================== send a file

interface Picked { uri: string; name: string; mime: string; size: number; kind: PickKind }

async function pick(kind: PickKind): Promise<Picked | null> {
  if (kind === "file") {
    const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
    const a = r.canceled ? null : r.assets?.[0];
    if (!a) return null;
    return { uri: a.uri, name: nameFor(kind, a.name, a.uri, a.mimeType), mime: a.mimeType || "application/octet-stream", size: Number(a.size) || 0, kind };
  }
  const video = kind === "video";
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: video ? ["videos"] : ["images"],
    // A picture is sent as a JPEG the server reads (an iPhone's HEIC is not one), a little smaller than taken.
    quality: num("media.photoQuality", 0.85),
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    ...(video ? { videoMaxDuration: num("media.videoMaxSeconds", 600) } : {}),
  };
  if (kind === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Refused(txt("media.cameraOff", "Allow the camera for Tailzu in Settings to take a photo."));
  }
  const r = kind === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const a = r.canceled ? null : r.assets?.[0];
  if (!a) return null;
  const mime = a.mimeType || (video ? "video/mp4" : "image/jpeg");
  return { uri: a.uri, name: nameFor(kind, a.fileName, a.uri, mime), mime, size: Number(a.fileSize) || 0, kind };
}

/** A failure whose words are already for a person. */
class Refused extends Error {}

/**
 * The file under the name it was picked with, so the server keeps that name ("Price list.pdf", not a cache id). A
 * copy in our own cache when the picker's file is called something else; removed once sent.
 */
async function underItsName(p: Picked): Promise<{ uri: string; done: () => void }> {
  let last = p.uri.split("/").pop() ?? "";
  try { last = decodeURIComponent(last); } catch { /* not encoded */ }
  if (last === p.name || !FileSystem.cacheDirectory) return { uri: p.uri, done: () => {} };
  const dir = `${FileSystem.cacheDirectory}tz-send-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}/`;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    // A file URI: the name percent-encoded (a space or a Hindi letter is not a URI character); on disk it is the name.
    const to = dir + encodeURIComponent(cleanName(p.name, "file"));
    await FileSystem.copyAsync({ from: p.uri, to });
    return { uri: to, done: () => { FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {}); } };
  } catch (e) {
    warn("copy under its name", e);
    FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {});
    return { uri: p.uri, done: () => {} };
  }
}

let sending: { owner: unknown; task: FileSystem.UploadTask | null; stopped: boolean } | null = null;

export async function uploadFile(a: UploadSpec, io: MediaIO): Promise<void> {
  const failed = txt("media.sendFailed", "Couldn't send that file. Try again.");
  let picked: Picked | null;
  try {
    picked = await pick(a.pick);
  } catch (e) {
    warn("pick", e);
    await io.run(a.onError, e instanceof Refused ? e.message : txt("media.pickFailed", "Couldn't open your files. Try again."));
    return;
  }
  if (!picked) { await io.run(a.onCancel); return; }
  // The cap: the action's, else the server's (media.maxBytes), and never over the upload route's own.
  const cap = Math.min(num("media.maxBytes", 52428800), MAX_BYTES) || MAX_BYTES;
  const max = Math.min(Number(a.maxBytes) || cap, cap);
  if (picked.size > max) {
    await io.run(a.onError, txt("media.tooBig", "That file is over {mb} MB, the most Tailzu takes.", { mb: Math.round(max / 1024 / 1024) }));
    return;
  }
  const path = a.path ?? "/v1/files";
  if (!isApiPath(path)) { await io.run(a.onError, failed); return; }

  // One upload at a time: a second pick replaces the first.
  if (sending) { sending.stopped = true; sending.task?.cancelAsync().catch(() => {}); }
  const mine: { owner: unknown; task: FileSystem.UploadTask | null; stopped: boolean } = { owner: io.owner, task: null, stopped: false };
  sending = mine;
  const p = picked;
  const show = (sent: number, total: number) => { if (a.progressTo && !mine.stopped) io.set(a.progressTo, progressOf(p.name, p.kind, sent, total)); };
  const often = every(num("media.progressMs", 150));
  show(0, p.size);
  const file = await underItsName(p);
  try {
    const base = await getBaseUrl();
    const task = FileSystem.createUploadTask(`${base}${path}`, file.uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "file",
      mimeType: p.mime,
      headers: { ...(await commonHeaders()) },
    }, (d) => {
      const done = d.totalBytesExpectedToSend > 0 && d.totalBytesSent >= d.totalBytesExpectedToSend;
      if (often(done)) show(d.totalBytesSent, d.totalBytesExpectedToSend || p.size);
    });
    mine.task = task;
    if (mine.stopped) { task.cancelAsync().catch(() => {}); return; }
    const res = await task.uploadAsync();
    if (mine.stopped) return;
    if (!res) throw new Error("upload: no answer");
    if (a.progressTo) io.set(a.progressTo, undefined);
    if (res.status < 200 || res.status >= 300) {
      console.warn(`[Tailzu][media] upload refused: ${res.status} ${String(res.body ?? "").slice(0, 200)}`);
      await io.run(a.onError, refusalWords(res.status, String(res.body ?? ""), {
        fallback: failed,
        signedOut: txt("error.unauthorized", "Your session has expired. Sign in again to continue."),
        tooMany: txt("error.rateLimited", "Too many requests. Wait a moment, then try again."),
        off: txt("media.filesOff", "Sending files isn't switched on yet."),
      }));
      return;
    }
    let answer: Record<string, unknown>;
    try { answer = JSON.parse(res.body) as Record<string, unknown>; } catch { throw new Error(`upload: not JSON: ${String(res.body).slice(0, 80)}`); }
    // The answer as the server gave it, with the name it was picked with and its size in words, for the screen.
    const bytes = Number((answer.file as { bytes?: unknown } | undefined)?.bytes) || p.size;
    io.set(a.assignTo, { ...answer, name: p.name, size: progressOf(p.name, p.kind, 0, bytes).size });
    await io.run(a.onSuccess);
  } catch (e) {
    if (mine.stopped) return;
    warn("upload", e);
    if (a.progressTo) io.set(a.progressTo, undefined);
    await io.run(a.onError, userErrorMessage(e, failed));
  } finally {
    file.done();
    if (sending === mine) sending = null;
  }
}

// =================================================================== play a sound

interface Playing { owner: unknown; id: string; statePath?: string; io: MediaIO; player: AudioPlayer; sub: { remove(): void } | null; watchdog?: ReturnType<typeof setTimeout> }
let playing: Playing | null = null;
/** A sound being fetched, not playing yet: a press on its button (stop) or leaving its screen drops it. */
let pending: { owner: unknown; statePath?: string; io: MediaIO; dropped: boolean } | null = null;
/** A server sound fetched once this session: its address → the file in our cache. */
const fetched = new Map<string, string>();

/** A server path's sound as a file of ours, fetched with the session; a refusal in words. */
async function soundFile(path: string): Promise<string> {
  const had = fetched.get(path);
  if (had) {
    const info = await FileSystem.getInfoAsync(had).catch(() => null);
    if (info?.exists) return had;
    fetched.delete(path);
  }
  if (!FileSystem.cacheDirectory) throw new Error("no cache directory");
  const to = `${FileSystem.cacheDirectory}tz-sound-${fetched.size}-${Date.now().toString(36)}.mp3`;
  const base = await getBaseUrl();
  const res = await FileSystem.downloadAsync(`${base}${path}`, to, { headers: { ...(await commonHeaders()) } });
  if (res.status < 200 || res.status >= 300) {
    let said = "";
    try { said = String((JSON.parse(await FileSystem.readAsStringAsync(to)) as { message?: unknown }).message ?? ""); } catch { /* not JSON */ }
    FileSystem.deleteAsync(to, { idempotent: true }).catch(() => {});
    throw new Refused(res.status === 503 && said ? said : txt("media.playFailed", "Couldn't play that. Try again."));
  }
  fetched.set(path, to);
  return to;
}

/** Stop whatever plays, or is about to (the state that showed it is cleared). */
export function stopAudio(): void {
  const w = pending;
  pending = null;
  if (w) {
    w.dropped = true;
    if (w.statePath) w.io.set(w.statePath, undefined);
  }
  const p = playing;
  if (!p) return;
  playing = null;
  if (p.watchdog) clearTimeout(p.watchdog);
  try { p.sub?.remove(); } catch { /* gone */ }
  try { p.player.pause(); } catch { /* gone */ }
  try { p.player.remove(); } catch { /* gone */ }
  if (p.statePath) p.io.set(p.statePath, undefined);
}

export async function playAudio(a: PlaySpec, io: MediaIO): Promise<void> {
  stopAudio();
  const id = String(a.id ?? a.url);
  const url = fillPath(String(a.url ?? ""), (path) => io.get(path));
  const src = soundSource(url);
  const failed = txt("media.playFailed", "Couldn't play that. Try again.");
  if (!src) { await io.run(a.onError, failed); return; }
  // Shown at once, so the press is answered while the sound is fetched.
  if (a.statePath) io.set(a.statePath, playStateOf(id, 0, 0));
  const claim = { owner: io.owner, statePath: a.statePath, io, dropped: false };
  pending = claim;
  try {
    const uri = "path" in src ? await soundFile(src.path) : src.web;
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    if (claim.dropped) return; // stopped, another sound, or the screen went, meanwhile
    pending = null;
    const player = createAudioPlayer({ uri }, { updateInterval: num("media.playTickMs", 250) });
    const me: Playing = { owner: io.owner, id, statePath: a.statePath, io, player, sub: null };
    playing = me;
    me.sub = player.addListener("playbackStatusUpdate", (s) => {
      if (playing !== me) return;
      if (me.watchdog && s.isLoaded) { clearTimeout(me.watchdog); me.watchdog = undefined; }
      if (s.didJustFinish) {
        stopAudio();
        void io.run(a.onEnd);
        return;
      }
      if (s.isLoaded && a.statePath) io.set(a.statePath, playStateOf(id, s.currentTime, s.duration));
    });
    // A sound that never loads is said, not waited on.
    me.watchdog = setTimeout(() => {
      if (playing !== me) return;
      stopAudio();
      void io.run(a.onError, failed);
    }, num("media.playLoadMs", 10000));
    player.play();
  } catch (e) {
    if (claim.dropped) return;
    if (pending === claim) pending = null;
    if (playing?.player && playing.id === id) stopAudio();
    warn("play", e);
    if (a.statePath) io.set(a.statePath, undefined);
    await io.run(a.onError, e instanceof Refused ? e.message : userErrorMessage(e, failed));
  }
}

// =================================================================== speak

interface Listening {
  owner: unknown; io: MediaIO; spec: RecordSpec; state: "listening" | "busy"; stopped: boolean;
  recorder: InstanceType<typeof AudioModule.AudioRecorder>; meter?: ReturnType<typeof setInterval>; limit?: ReturnType<typeof setTimeout>;
}
let heard: Listening | null = null;

/** The app's recording format (the one VoiceButton sends), with the level metered for the bars. */
function recordingOptions(): Record<string, unknown> {
  const p = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true } as Record<string, any>;
  const common = { extension: p.extension, sampleRate: p.sampleRate, numberOfChannels: p.numberOfChannels, bitRate: p.bitRate, isMeteringEnabled: true };
  return Platform.OS === "ios" ? { ...common, directory: p.directory, ...p.ios } : { ...common, directory: p.directory, ...p.android };
}

const say = (h: Listening, v: "listening" | "busy" | "idle") => { if (h.spec.statePath) h.io.set(h.spec.statePath, v); };
const level = (h: Listening, v: number) => { if (h.spec.levelTo && h.io.get(h.spec.levelTo) !== v) h.io.set(h.spec.levelTo, v); };

function quiet(h: Listening) {
  if (h.meter) clearInterval(h.meter);
  if (h.limit) clearTimeout(h.limit);
  h.meter = h.limit = undefined;
}

function letGo(h: Listening) {
  try { (h.recorder as unknown as { release?: () => void }).release?.(); } catch { /* gone */ }
  setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
}

export async function recordVoice(a: RecordSpec, io: MediaIO): Promise<void> {
  // The second tap: stop, and write it down.
  if (heard && heard.owner === io.owner) {
    if (heard.state === "listening") await finish(heard);
    return;
  }
  if (heard) cancelRecording();
  const off = txt("media.micOff", "Tailzu needs the microphone to hear you.");
  try {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      await io.run(perm.canAskAgain === false ? (a.onBlocked ?? a.onError) : a.onError, off);
      return;
    }
  } catch (e) {
    warn("mic permission", e);
    await io.run(a.onError, off);
    return;
  }
  stopAudio();
  let recorder: Listening["recorder"] | null = null;
  try {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    recorder = new AudioModule.AudioRecorder(recordingOptions() as never);
    await recorder.prepareToRecordAsync();
    recorder.record();
  } catch (e) {
    warn("mic start", e);
    try { (recorder as unknown as { release?: () => void } | null)?.release?.(); } catch { /* gone */ }
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    await io.run(a.onError, txt("media.micFailed", "Couldn't start the microphone. Try again."));
    return;
  }
  const h: Listening = { owner: io.owner, io, spec: a, state: "listening", stopped: false, recorder };
  heard = h;
  say(h, "listening");
  level(h, 0);
  h.meter = setInterval(() => {
    if (h.stopped || h.state !== "listening") return;
    try { level(h, levelOf((h.recorder.getStatus() as { metering?: number }).metering)); } catch { /* not ready */ }
  }, num("media.meterMs", 120));
  const most = Math.max(5, Math.min(600, Number(a.maxSeconds) || 120));
  h.limit = setTimeout(() => { if (h.state === "listening" && !h.stopped) void finish(h); }, most * 1000);
}

async function finish(h: Listening): Promise<void> {
  try { await writeDown(h); } finally { if (heard === h) heard = null; }
}

/** Stop listening, send the take, write the words in. Taps meanwhile are ignored (`heard` is still this one). */
async function writeDown(h: Listening): Promise<void> {
  h.state = "busy";
  quiet(h);
  say(h, "busy");
  level(h, 0);
  const a = h.spec;
  let uri: string | null = null;
  try {
    await h.recorder.stop();
    uri = h.recorder.uri;
  } catch (e) {
    warn("mic stop", e);
  }
  letGo(h);
  if (h.stopped) return;
  if (!uri) { say(h, "idle"); await h.io.run(a.onError, txt("media.noAudio", "I didn't hear anything. Try again.")); return; }
  try {
    const { cleanedText } = await api.transcribeClean(uri, a.language ? { language: a.language } : {});
    if (h.stopped) return;
    const words = String(cleanedText ?? "").trim();
    say(h, "idle");
    if (!words) { await h.io.run(a.onError, txt("media.noWords", "I didn't catch that. Try again.")); return; }
    h.io.set(a.assignTo, a.append ? joinWords(h.io.get(a.assignTo), words) : words);
    await h.io.run(a.onDone, words);
  } catch (e) {
    if (h.stopped) return;
    warn("transcribe", e);
    say(h, "idle");
    await h.io.run(a.onError, userErrorMessage(e, txt("media.transcribeFailed", "Couldn't turn that into words. Try again.")));
  }
}

/** Throw the recording away (the screen went). */
export function cancelRecording(): void {
  const h = heard;
  if (!h) return;
  h.stopped = true;
  quiet(h);
  if (h.state === "listening") {
    h.recorder.stop().then(() => {
      const uri = h.recorder.uri;
      if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }).catch(() => {}).finally(() => letGo(h));
  } else {
    letGo(h);
  }
  heard = null;
}

// =================================================================== leaving a screen

/** The screen whose store is `owner` has gone: its sound stops, its recording and its upload are dropped. */
export function leaveMedia(owner: unknown): void {
  if (playing?.owner === owner || pending?.owner === owner) stopAudio();
  if (heard?.owner === owner) cancelRecording();
  const up = sending;
  if (up && up.owner === owner) { up.stopped = true; up.task?.cancelAsync().catch(() => {}); sending = null; }
}
