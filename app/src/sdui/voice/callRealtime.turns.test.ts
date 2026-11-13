// node --test --experimental-strip-types src/sdui/voice/callRealtime.turns.test.ts
//
// ONE MICROPHONE AT A TIME (callRealtime.ts). Three things happen while a live call is opening its microphone, and each of them
// used to leave something behind: the person ends the call (the call carried on and spoke after the hang-up), a second tap
// starts another one (two microphones, and the first call was orphaned with one of them), and the warm-up is still opening when
// the call arrives (the warm microphone was thrown away and a second opened beside it).
//
// The real call needs a phone, so the phone is stood in for here: the native modules are swapped for the harness below, the
// microphone answers only when the test says so, and the rules file (callRealtimeCore.ts) is the real one, so the registry
// every other sound stands aside for is the real registry.

import test, { mock } from "node:test";
import assert from "node:assert";
import { registerHooks } from "node:module";
import { CALL, SOFT_AEC_MODELS, callOn } from "./callRealtimeCore.ts";

// ===================================================== the phone, stood in for

/** One microphone being opened: it answers when the test says, with a microphone or with nothing. */
interface Open {
  n: number;
  /** Its offer, as the server would be sent it. */
  sdp: string;
  /** Its tracks were stopped: this microphone has been let go of. */
  stopped: boolean;
  /** The connection built on it was closed. */
  closed: boolean;
  /** Answer the open: true with a microphone, false as a refusal. */
  finish(ok: boolean): void;
}

/** What the call did to the phone, and what the phone answers. The stub modules below are windows onto this. */
const T = {
  /** Every callAudio op, in order. */
  audio: [] as string[],
  /** Which echo canceller each op asked for, and which the phone answers it really has (null: it does not say). */
  aecAsked: [] as (string | undefined)[],
  aecHas: null as null | "hw" | "soft",
  /** Every endpoint call. */
  calls: [] as { method: string; path: string; body: unknown }[],
  /** One per microphone the call asked for, in order. */
  opens: [] as Open[],
  granted: true,
  /** What POST live answers. */
  liveReply: { sdp: "answer-sdp", maxSec: 60 } as unknown,
  /** True: POST live waits for the test to answer it (`liveGate`). */
  gate: false,
  liveGate: null as null | ((v: unknown) => void),
  /** Every AppState listener, and what the app's state says it is. */
  app: [] as ((s: string) => void)[],
  appState: "active",
  /** The call's connection and channel, and the listeners it put on them. */
  pc: null as null | { connectionState: string },
  dc: null as null | { readyState: string },
  pcl: new Map<string, (() => void)[]>(),
};

/** The app goes behind something, or comes back: every listener hears it, as the phone's own would. */
function appGoes(state: string): void {
  T.appState = state;
  for (const f of [...T.app]) f(state);
}

/** The connection changed state: whatever the call put on it hears it. */
function pcGoes(state: string): void {
  if (T.pc) T.pc.connectionState = state;
  for (const f of [...(T.pcl.get("connectionstatechange") ?? [])]) f();
}

let opens = 0;

/** The live client, as much of it as the call uses. */
const webrtc = {
  mediaDevices: {
    getUserMedia: () =>
      new Promise<{ getTracks(): { stop(): void }[] }>((resolve, reject) => {
        const o: Open = { n: ++opens, sdp: `offer-${opens}`, stopped: false, closed: false, finish: () => {} };
        o.finish = (ok: boolean) => {
          if (ok) resolve({ getTracks: () => [{ stop: () => { o.stopped = true; } }] });
          else reject(new Error("no microphone"));
        };
        T.opens.push(o);
      }),
  },
  RTCPeerConnection: class {
    mine = T.opens[T.opens.length - 1];
    connectionState = "new";
    constructor() { T.pc = this; T.pcl = new Map(); }
    addTrack() { return {}; }
    createDataChannel() { const dc = { readyState: "connecting", addEventListener() {} }; T.dc = dc; return dc; }
    async createOffer() { return { sdp: this.mine.sdp, type: "offer" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    async getStats() { return {}; }
    addEventListener(name: string, fn: () => void) { const l = T.pcl.get(name) ?? []; l.push(fn); T.pcl.set(name, l); }
    close() { this.mine.closed = true; }
  },
};

(globalThis as Record<string, unknown>).__call = {
  Platform: { OS: "android", constants: { Manufacturer: "Test", Model: "Phone" } },
  AppState: {
    get currentState() { return T.appState; },
    addEventListener: (_name: string, fn: (s: string) => void) => {
      T.app.push(fn);
      return { remove() { const i = T.app.indexOf(fn); if (i >= 0) T.app.splice(i, 1); } };
    },
  },
  AudioModule: { getRecordingPermissionsAsync: async () => ({ granted: T.granted }) },
  callAudio: (op: string, o?: { aec?: string }) => { T.audio.push(op); T.aecAsked.push(o?.aec); return T.aecHas; },
  isCallAudioAvailable: () => true,
  onCallInterrupted: () => () => {},
  endFlowSession: () => {},
  isFlowActive: () => false,
  hasBinaryFeature: (f: string) => f === "realtimeCall",
  callEndpoint: (method: string, path: string, body: unknown) => {
    T.calls.push({ method, path, body });
    if (path.endsWith("/live")) {
      if (!T.gate) return Promise.resolve(T.liveReply);
      return new Promise((r) => { T.liveGate = r as (v: unknown) => void; });
    }
    if (method === "GET") return Promise.resolve({ state: "answered" });
    return Promise.resolve({});
  },
  errorDetail: (e: unknown) => String(e),
  stopAudio: () => {},
  voiceStop: () => {},
  setVoiceLevel: () => {},
  setVoiceWords: () => {},
};

/**
 * The two modules the call requires lazily: expo-keep-awake, and the live client, which is the one above. The client is asked
 * for by name in exactly one place in the app and nowhere else, this test included (callRealtime.imports.test.ts holds that),
 * so it is everything-but-keep-awake here rather than a name.
 */
(globalThis as Record<string, unknown>).require = (id: string) => (id === "expo-keep-awake" ? {} : webrtc);

/** A stand-in module: everything it exports is a window onto the harness. */
const stub = (body: string) => `data:text/javascript,${encodeURIComponent(`const T = globalThis.__call;\n${body}`)}`;

const STUBS: Record<string, string> = {
  "react-native": stub("export const Platform = T.Platform;\nexport const AppState = T.AppState;"),
  "expo-audio": stub("export const AudioModule = T.AudioModule;"),
  "../../../modules/tulmi-stream": stub(
    "export const callAudio = (...a) => T.callAudio(...a);\nexport const isCallAudioAvailable = () => T.isCallAudioAvailable();\n" +
    "export const onCallInterrupted = (f) => T.onCallInterrupted(f);",
  ),
  "../../../modules/tulmi-bridge": stub("export const endFlowSession = () => T.endFlowSession();\nexport const isFlowActive = () => T.isFlowActive();"),
  "../../device/binary": stub("export const hasBinaryFeature = (f) => T.hasBinaryFeature(f);"),
  "../client": stub("export const callEndpoint = (...a) => T.callEndpoint(...a);\nexport const errorDetail = (e) => T.errorDetail(e);"),
  "../../media/media": stub("export const stopAudio = () => T.stopAudio();"),
  "./voiceBus": stub("export const setVoiceLevel = () => T.setVoiceLevel();\nexport const setVoiceWords = () => T.setVoiceWords();"),
  "./voiceLive": stub("export const voiceStop = () => T.voiceStop();"),
};

registerHooks({
  resolve(specifier, context, next) {
    const url = STUBS[specifier];
    if (url) return { url, shortCircuit: true };
    // The app's own imports leave the extension to the bundler; Node wants the whole name.
    if (/^\.{1,2}\//.test(specifier) && !/\.[a-z]+$/.test(specifier)) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});

const { voiceCall, voiceCallSet } = await import("./callRealtime.ts");

// ===================================================== the screen, stood in for

const owner = {};
const sets: [string, unknown][] = [];
const ran: string[] = [];

const io = {
  owner,
  set: (path: string, value: unknown) => { sets.push([path, value]); },
  run: async (ref: unknown) => { if (ref !== undefined) ran.push(String(ref)); },
};

const spec = {
  path: "/bots/plan/calls/c1/live",
  viewPath: "/bots/plan/calls/c1",
  statePath: "rt",
  phasePath: "phase",
  saidPath: "said",
  heardPath: "heard",
  onFallback: "rtFallback",
  onIdle: "idle",
  onEnded: "ended",
  onBlocked: "blocked",
};

/** Let the event loop run everything that is already due. */
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/** Clean slate, with nothing left holding the microphone from the test before. */
async function start(): Promise<void> {
  voiceCallSet("end", io);
  await settle();
  T.audio.length = 0;
  T.aecAsked.length = 0;
  T.aecHas = null;
  T.calls.length = 0;
  T.opens.length = 0;
  opens = 0;
  sets.length = 0;
  ran.length = 0;
  T.granted = true;
  T.gate = false;
  T.liveGate = null;
  T.app.length = 0;
  T.appState = "active";
  T.pc = null;
  T.dc = null;
  T.pcl = new Map();
}

/** The call is up: the channel open, the connection connected, and the server told `ready`. */
function up(): void {
  if (T.dc) T.dc.readyState = "open";
  pcGoes("connected");
}

const liveCalls = () => T.calls.filter((c) => c.path.endsWith("/live"));

// ===================================================== the three races

test("End while the microphone is opening: nothing is said after the hang-up", async () => {
  await start();
  const call = voiceCall(spec, io);
  await settle();
  assert.strictEqual(T.opens.length, 1, "the microphone was not asked for");
  // The screen says "connecting" before the microphone, so "Tap to talk" is already gone.
  assert.deepStrictEqual(sets[0], ["phase", "connecting"]);
  // The person presses End call while it is still opening.
  assert.strictEqual(callOn(), true, "the call does not hold the audio session yet");
  voiceCallSet("end", io);
  // The microphone arrives after the hang-up.
  T.opens[0].finish(true);
  await call;
  await settle();
  assert.deepStrictEqual(liveCalls(), [], "the call was still started after the hang-up");
  assert.deepStrictEqual(ran, [], "the screen was told to carry on, after the person ended the call");
  assert.ok(T.opens[0].stopped && T.opens[0].closed, "the microphone was left open");
  assert.strictEqual(T.audio[T.audio.length - 1], "end", "the audio session was left to the call");
  assert.strictEqual(callOn(), false);
});

test("Two taps: the first lets its microphone go, and only the second call is live", async () => {
  await start();
  const first = voiceCall(spec, io);
  await settle();
  assert.strictEqual(T.opens.length, 1);
  const second = voiceCall(spec, io);
  await settle();
  // The second tap waits: a second microphone beside the first is how a call is orphaned.
  assert.strictEqual(T.opens.length, 1, "a second microphone was opened beside the first");
  T.opens[0].finish(true);
  await first;
  await settle();
  // Now, and only now, the second call opens its own.
  assert.strictEqual(T.opens.length, 2);
  assert.ok(T.opens[0].stopped, "the first tap's microphone was left open");
  assert.deepStrictEqual(liveCalls(), [], "the first tap started a call it had been told to drop");
  T.opens[1].finish(true);
  await second;
  await settle();
  assert.strictEqual(liveCalls().length, 1, "there is not exactly one live call");
  assert.deepStrictEqual(liveCalls()[0].body, { sdp: "offer-2" }, "the live call is not the second tap's");
  assert.ok(!T.opens[1].stopped, "the live call's own microphone was let go");
  assert.strictEqual(callOn(), true);
});

test("The warm-up is still opening when the call arrives: the call takes that microphone, not a second one", async () => {
  await start();
  voiceCallSet("warm", io);
  // Warming returns at once: the answer the screen sends next does not wait for the microphone.
  assert.strictEqual(T.opens.length, 0, "warming opened the microphone before it returned");
  await settle();
  assert.strictEqual(T.opens.length, 1);
  // The answer came back quickly and the call starts while the warm microphone is still opening.
  const call = voiceCall(spec, io);
  await settle();
  assert.strictEqual(T.opens.length, 1, "the call opened a second microphone beside the warm one");
  T.opens[0].finish(true);
  await call;
  await settle();
  assert.strictEqual(T.opens.length, 1, "the call opened its own microphone after all");
  assert.strictEqual(liveCalls().length, 1);
  assert.deepStrictEqual(liveCalls()[0].body, { sdp: "offer-1" }, "the call did not use the warmed-up offer");
  assert.ok(!T.opens[0].stopped, "the warmed-up microphone was let go of");
  // One prepare and one begin for the one microphone: nothing asked for the audio session twice.
  assert.deepStrictEqual(T.audio, ["prepare", "begin"]);
});

test("A refused microphone still falls back to the turn call, and lets the audio session go", async () => {
  await start();
  const call = voiceCall(spec, io);
  await settle();
  T.opens[0].finish(false);
  await call;
  await settle();
  assert.deepStrictEqual(ran, ["rtFallback"]);
  assert.deepStrictEqual(liveCalls(), []);
  assert.strictEqual(T.audio[T.audio.length - 1], "end");
  assert.strictEqual(callOn(), false);
});

test("No microphone permission: the screen is told, and nothing is opened", async () => {
  await start();
  T.granted = false;
  await voiceCall(spec, io);
  assert.deepStrictEqual(ran, ["blocked"]);
  assert.deepStrictEqual(T.opens, []);
  assert.deepStrictEqual(T.audio, []);
  assert.deepStrictEqual(sets, [], "the screen was moved to connecting for a call that cannot start");
});

// ===================================================== the echo canceller this phone needs

test("A phone that needs the software echo canceller and has not got it yet stays a turn call", async () => {
  await start();
  // The harness phone, on the list of models whose own canceller is not good enough. The list is normally filled by the
  // device matrix; it is put back as it was at the end.
  (SOFT_AEC_MODELS as string[]).push("TEST PHONE");
  try {
    // The process was started before the ask was stored, so it still has the phone's own canceller.
    T.aecHas = "hw";
    await voiceCall(spec, io);
    await settle();
    assert.deepStrictEqual(T.aecAsked, ["soft"], "the call did not ask for the software canceller");
    assert.deepStrictEqual(ran, ["rtFallback"], "the call went on with a canceller that lets the bot hear itself");
    assert.deepStrictEqual(liveCalls(), [], "a session was created, and paid for, on the wrong canceller");
    assert.deepStrictEqual(T.opens, [], "the microphone was opened for a call that cannot be held");
    assert.strictEqual(callOn(), false);
    // The next start of the app has it, and then the live call runs.
    await start();
    T.aecHas = "soft";
    const call = voiceCall(spec, io);
    await settle();
    T.opens[0].finish(true);
    await call;
    await settle();
    assert.strictEqual(liveCalls().length, 1, "the live call was refused although the canceller is the right one");
  } finally {
    (SOFT_AEC_MODELS as string[]).length = 0;
  }
});

// ===================================================== leaving the app while it connects

test("The app goes behind something while the microphone opens: nothing is sent to the server", async () => {
  await start();
  const call = voiceCall(spec, io);
  await settle();
  assert.strictEqual(T.opens.length, 1);
  // The person leaves the app before the microphone is even open.
  appGoes("background");
  T.opens[0].finish(true);
  await call;
  await settle();
  assert.deepStrictEqual(liveCalls(), [], "a call was started for an app nobody is looking at");
  assert.deepStrictEqual(ran, ["idle"], "the screen was not parked");
  assert.ok(T.opens[0].stopped && T.opens[0].closed, "the microphone was left open in the background");
  assert.strictEqual(T.audio[T.audio.length - 1], "end", "the audio session was left open");
  assert.strictEqual(callOn(), false);
});

test("The app goes behind something while POST live is in flight: the live part is stopped, the bot never speaks", async () => {
  await start();
  T.gate = true;
  const call = voiceCall(spec, io);
  await settle();
  T.opens[0].finish(true);
  await settle();
  assert.ok(T.liveGate, "POST live is not in flight");
  // Now the person leaves. iOS keeps an app with an open audio session running, so this is a microphone in an empty room.
  appGoes("background");
  await settle();
  // The server answers afterwards and the connection comes up: still nothing is said.
  T.liveGate!({ sdp: "answer-sdp", maxSec: 60 });
  await settle();
  up();
  await call;
  await settle();
  assert.ok(!T.calls.some((c) => c.path.endsWith("/ready")), "the bot was told to start speaking in the background");
  assert.ok(T.calls.some((c) => c.path.endsWith("/stop")), "the live part was not stopped");
  assert.deepStrictEqual(ran, ["idle"]);
  assert.strictEqual(callOn(), false);
});

test("A missed background event is caught at ready: the app's own state is asked before the bot speaks", async () => {
  await start();
  T.gate = true;
  const call = voiceCall(spec, io);
  await settle();
  T.opens[0].finish(true);
  await settle();
  // The app is behind something and no change event reached us (one can be missed on a cold-started app).
  T.appState = "background";
  T.liveGate!({ sdp: "answer-sdp", maxSec: 60 });
  await settle();
  up();
  await call;
  await settle();
  assert.ok(!T.calls.some((c) => c.path.endsWith("/ready")), "the bot was told to start speaking in the background");
  assert.deepStrictEqual(ran, ["idle"]);
  assert.strictEqual(callOn(), false);
});

// ===================================================== a connection that wobbles

test("A brief 'disconnected' does not end the call; one that does not come back does", async () => {
  await start();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const call = voiceCall(spec, io);
    await settle();
    T.opens[0].finish(true);
    await call;
    await settle();
    up();
    await settle();
    assert.ok(T.calls.some((c) => c.path.endsWith("/ready")), "the server was never told the phone is ready");
    // A handover from Wi-Fi to mobile data looks exactly like this, and comes back by itself.
    pcGoes("disconnected");
    await settle();
    assert.strictEqual(callOn(), true, "a brief wobble ended the call");
    pcGoes("connected");
    mock.timers.tick(CALL.iceGraceMs + 1_000);
    await settle();
    assert.strictEqual(callOn(), true, "the call was given up although the connection came back");
    assert.deepStrictEqual(ran, [], "the screen was moved on for a wobble");
    // One that does not come back is a dropped call.
    pcGoes("disconnected");
    mock.timers.tick(CALL.iceGraceMs + 1_000);
    await settle();
    assert.strictEqual(callOn(), false, "a connection that never came back was kept");
  } finally {
    mock.timers.reset();
  }
});

test("The phone's own backstop is counted from ready, not from the microphone", async () => {
  await start();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const call = voiceCall(spec, io);
    await settle();
    T.opens[0].finish(true);
    await call;
    await settle();
    // Nine seconds to connect, inside the connect timer: the server has not started its own hard length yet.
    mock.timers.tick(9_000);
    up();
    await settle();
    // The server says goodbye at maxSec - 15 s and hangs up at maxSec, both counted from here. The phone waits ten seconds
    // more than that; counted from the microphone, as it used to be, it would have closed the call at 61 s and the person
    // would have been dropped into the turn call instead of hearing the goodbye.
    mock.timers.tick(65_000);
    await settle();
    assert.strictEqual(callOn(), true, "the phone closed the call before the server's own goodbye");
    mock.timers.tick(6_000);
    await settle();
    assert.strictEqual(callOn(), false, "the phone's own backstop never fired");
  } finally {
    mock.timers.reset();
  }
});

test("and the call lets everything go at the end", async () => {
  await start();
  assert.strictEqual(callOn(), false);
});
