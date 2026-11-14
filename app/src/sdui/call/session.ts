/**
 * ONE CALL, HELD FOR ONE SCREEN (the `call` block; the feature is TAILZU-BACKEND/docs/rooms.md).
 *
 * The arithmetic is callCore.ts; this is the part that touches the microphone, the camera and the network, and it is the only file in
 * the app that names `react-native-webrtc`.
 *
 *   join()     the mic (and the camera) opened, an offer made, POSTed to the join path; the answer set, and the loop started
 *   set(op)    mic, cam, speaker on or off, or the camera flipped
 *   leave()    hung up: the server told, the tracks stopped, the connection closed
 *   tracks()   what a Caller node draws: the stream for one identity, as it changes
 *
 * THE LOOP, every two seconds: say we are still here (`/v1/rooms/seat/live`), take back who is in the call and what each is sending,
 * pull in whatever is new, answer the SFU when it asks, and let go of whoever left. That one call is also the heartbeat — a seat that
 * stops saying it is there is dropped by the server after twenty seconds, which is how a killed app leaves a call.
 *
 * WHAT NEVER LEAVES THIS OBJECT: the seat (a bearer), and the SFU's session. The screen is given who is in the call and nothing else
 * (callCore.ts stateOf).
 *
 * ONE CHANGE AT A TIME. The SFU refuses a second offer while the first is unanswered, so every exchange goes through `step`.
 */
import { AppState } from "react-native";

import {
  CALL_LIMITS, backoffMs, heard, speakingOf, stateOf, tooManyTries, wanted,
  type CallKnock, type CallPerson, type CallPhase, type HeldTrack, type SpeakingSince,
} from "./callCore.ts";

// ===================================================== the little of the live client this file uses

interface TrackLike { kind: string; enabled: boolean; stop(): void; _switchCamera?: () => void }
interface StreamLike { id: string; getTracks(): TrackLike[]; getAudioTracks(): TrackLike[]; getVideoTracks(): TrackLike[] }
interface TransceiverLike { mid: string | null; receiver: { track: TrackLike | null }; sender: { track: TrackLike | null; replaceTrack(t: TrackLike | null): Promise<void> }; stop?: () => void }
interface PeerLike {
  connectionState: string;
  addTransceiver(source: TrackLike | "audio" | "video", init?: { direction?: string }): TransceiverLike;
  getTransceivers(): TransceiverLike[];
  createOffer(options?: unknown): Promise<{ sdp?: string; type?: string }>;
  createAnswer(options?: unknown): Promise<{ sdp?: string; type?: string }>;
  setLocalDescription(d?: unknown): Promise<void>;
  setRemoteDescription(d: unknown): Promise<void>;
  addEventListener(name: string, fn: (e: never) => void): void;
  close(): void;
  localDescription: { sdp?: string } | null;
  iceGatheringState: string;
}
interface Webrtc {
  mediaDevices: { getUserMedia(constraints: unknown): Promise<StreamLike> };
  RTCPeerConnection: new (config?: unknown) => PeerLike;
  RTCSessionDescription: new (d: { type: string; sdp: string }) => unknown;
  MediaStream: new (tracks?: TrackLike[]) => StreamLike;
}

/**
 * THE ONE PLACE THE CALL BLOCK NAMES THE LIVE CLIENT, in one require, inside try/catch (callRealtime.imports.test.ts holds the rule).
 * The same JavaScript reaches binaries made before the client was linked, where a static import would stop the app starting at all, so
 * it is asked for here and nowhere else; a binary without it gets null, and the block is never registered (blocks/registry.ts).
 */
let loaded: (Webrtc & { RTCView?: unknown }) | null | undefined;

function webrtc(): (Webrtc & { RTCView?: unknown }) | null {
  if (loaded !== undefined) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("react-native-webrtc") as Partial<Webrtc> & { RTCView?: unknown };
    loaded = m && typeof m.RTCPeerConnection === "function" && m.mediaDevices ? (m as Webrtc & { RTCView?: unknown }) : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** The client, or null on a binary without it. */
export const loadWebrtc = (): Webrtc | null => webrtc();

/** The client's own view, which draws one track. Null when there is no client, and then a tile draws a letter instead. */
export const rtcView = (): unknown => webrtc()?.RTCView ?? null;

/** Whether this binary can hold a call at all (the registry asks before it promises the block). */
export const callAvailable = (): boolean => loadWebrtc() !== null;

// ===================================================== what the session is given

export interface SessionApi {
  /** POST a path of ours, with the app's own signed-in client. Throws on anything but a 2xx. */
  post<T>(path: string, body: unknown): Promise<T>;
  /** Write the call's state into the screen's store. */
  write(state: Record<string, unknown>): void;
  /** The pictures changed: a Caller node redraws. */
  changed(): void;
  onEnd?: () => void;
  onBlocked?: () => void;
  onError?: () => void;
  now?: () => number;
}

export interface JoinOpts { join: string; knock?: string; video?: boolean }

interface SeatAnswer { seat: string; identity: string; name: string; host: boolean; answer: string; people?: CallPerson[] }
interface LiveAnswer { status: string; people?: CallPerson[]; waiting?: CallKnock[]; gone?: boolean }
interface PullAnswer { offer: string | null; mustAnswer: boolean; tracks: Array<{ trackName: string; mid?: string }> }

const SEAT = "/v1/rooms/seat";
/** Cloudflare's own, and the SFU wants the whole offer at once rather than a trickle. */
const ICE = [{ urls: "stun:stun.cloudflare.com:3478" }];

export class CallSession {
  private pc: PeerLike | null = null;
  private mine: StreamLike | null = null;
  /** The bearer. It never leaves this object. */
  private seat = "";
  private me: { identity: string; name: string } | null = null;
  private host = false;

  private phase: CallPhase = "connecting";
  private micOn = true;
  private camOn = true;
  private speakerOn = true;
  private frontOn = true;

  private people: CallPerson[] = [];
  private waiting: CallKnock[] = [];
  private held: HeldTrack[] = [];
  /** The track each held mid is carrying, so a Caller node can be handed a stream. */
  private byMid = new Map<string, TrackLike>();
  private lastHeard: SpeakingSince = {};

  private beat: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private tries = 0;
  private lastOk = 0;
  private stopped = false;
  private appSub: { remove(): void } | null = null;
  private readonly now: () => number;

  constructor(private readonly rtc: Webrtc, private readonly api: SessionApi) {
    this.now = api.now ?? Date.now;
  }

  // --------------------------------------------------------------------- joining

  async join(o: JoinOpts): Promise<void> {
    this.camOn = o.video !== false;
    this.push();
    try {
      this.mine = await this.rtc.mediaDevices.getUserMedia({ audio: true, video: this.camOn ? { facingMode: "user" } : false });
    } catch {
      this.phase = "failed";
      this.push();
      this.api.onBlocked?.();
      return;
    }
    try {
      const pc = new this.rtc.RTCPeerConnection({ iceServers: ICE, bundlePolicy: "max-bundle" });
      this.pc = pc;
      pc.addEventListener("track", (() => this.api.changed()) as never);
      pc.addEventListener("connectionstatechange", (() => {
        if (this.stopped) return;
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.sayReconnecting();
      }) as never);

      const audio = this.mine.getAudioTracks()[0];
      const video = this.mine.getVideoTracks()[0];
      if (!audio) throw new Error("no microphone");
      const aT = pc.addTransceiver(audio, { direction: "sendonly" });
      const vT = video ? pc.addTransceiver(video, { direction: "sendonly" }) : null;

      await pc.setLocalDescription(await pc.createOffer({}));
      await this.gathered(pc);

      const out = await this.api.post<SeatAnswer>(o.join, {
        sdp: pc.localDescription?.sdp ?? "",
        audioMid: aT.mid ?? "0",
        ...(vT?.mid ? { videoMid: vT.mid } : {}),
        ...(o.knock ? { knock: o.knock } : {}),
      });
      await pc.setRemoteDescription(new this.rtc.RTCSessionDescription({ type: "answer", sdp: out.answer }));

      this.seat = out.seat;
      this.me = { identity: out.identity, name: out.name };
      this.host = !!out.host;
      this.people = out.people ?? [];
      this.phase = "live";
      this.lastOk = this.now();
      this.push();

      // The camera is closed while the app is away, and opened again when it comes back; the sound carries on.
      this.appSub = AppState.addEventListener("change", (s) => { void this.onAppState(String(s)); });
      this.loop();
    } catch {
      this.phase = "failed";
      this.push();
      this.stopTracks();
      this.api.onError?.();
    }
  }

  /** The SFU takes the whole offer at once, so the candidates are waited for rather than trickled. */
  private async gathered(pc: PeerLike): Promise<void> {
    if (pc.iceGatheringState === "complete") return;
    await new Promise<void>((done) => {
      const t = setTimeout(done, 3_000);
      pc.addEventListener("icegatheringstatechange", (() => {
        if (pc.iceGatheringState === "complete") { clearTimeout(t); done(); }
      }) as never);
    });
  }

  // --------------------------------------------------------------------- the loop

  private loop(): void {
    if (this.stopped || this.beat) return;
    const tick = async () => {
      this.beat = null;
      if (this.stopped) return;
      await this.step(() => this.beatOnce()).catch(() => undefined);
      if (!this.stopped) this.beat = setTimeout(() => { void tick(); }, CALL_LIMITS.beatMs);
    };
    this.beat = setTimeout(() => { void tick(); }, CALL_LIMITS.beatMs);
  }

  private async beatOnce(): Promise<void> {
    let out: LiveAnswer;
    try {
      out = await this.api.post<LiveAnswer>(`${SEAT}/live`, { seat: this.seat, audio: this.micOn, video: this.camOn });
    } catch {
      this.tries += 1;
      if (tooManyTries(this.tries)) { this.finish("failed"); this.api.onError?.(); return; }
      if (this.now() - this.lastOk > CALL_LIMITS.quietMs) this.sayReconnecting();
      // The next beat waits a little longer each time.
      if (this.beat) { clearTimeout(this.beat); this.beat = null; }
      this.beat = setTimeout(() => { void this.step(() => this.beatOnce()).then(() => this.loop()); }, backoffMs(this.tries));
      return;
    }
    this.tries = 0;
    this.lastOk = this.now();

    if (out.gone || out.status === "ended") { this.finish("ended"); this.api.onEnd?.(); return; }
    if (this.phase === "reconnecting") this.phase = "live";
    this.people = (out.people ?? []).slice(0, CALL_LIMITS.people);
    this.waiting = this.host ? out.waiting ?? [] : [];

    const { pull, drop } = wanted(this.people, this.held);
    if (drop.length) {
      for (const t of drop) this.byMid.delete(t.mid);
      this.held = this.held.filter((t) => !drop.includes(t));
      this.api.changed();
    }
    if (pull.length) await this.pull(pull);
    this.push();
  }

  /** Someone else's tracks into our session: the server asks the SFU, and the SFU's offer is answered here. */
  private async pull(want: Array<{ identity: string; kind: "audio" | "video" }>): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    const out = await this.api.post<PullAnswer>(`${SEAT}/pull`, { seat: this.seat, want });
    if (out.offer) {
      await pc.setRemoteDescription(new this.rtc.RTCSessionDescription({ type: "offer", sdp: out.offer }));
      await pc.setLocalDescription(await pc.createAnswer({}));
      await this.gathered(pc);
      if (out.mustAnswer) await this.api.post(`${SEAT}/answer`, { seat: this.seat, sdp: pc.localDescription?.sdp ?? "" });
    }
    // Each track the SFU gave a mid is now on one of our transceivers.
    const byMid = new Map(pc.getTransceivers().filter((t) => t.mid).map((t) => [t.mid as string, t]));
    for (const t of out.tracks) {
      if (!t.mid) continue;
      const got = want.find((w) => t.trackName === `${w.identity}-${w.kind}`);
      const track = byMid.get(t.mid)?.receiver.track;
      if (!got || !track) continue;
      this.held = [...this.held.filter((h) => !(h.identity === got.identity && h.kind === got.kind)), { ...got, mid: t.mid }];
      this.byMid.set(t.mid, track);
    }
    this.api.changed();
  }

  // --------------------------------------------------------------------- the person's own switches

  async set(op: "mic" | "cam" | "speaker" | "flip", value?: boolean): Promise<void> {
    const on = (was: boolean) => (value === undefined ? !was : value);
    if (op === "mic") {
      this.micOn = on(this.micOn);
      for (const t of this.mine?.getAudioTracks() ?? []) t.enabled = this.micOn;
    } else if (op === "cam") {
      this.camOn = on(this.camOn);
      for (const t of this.mine?.getVideoTracks() ?? []) t.enabled = this.camOn;
    } else if (op === "speaker") {
      this.speakerOn = on(this.speakerOn);
    } else if (op === "flip") {
      this.frontOn = !this.frontOn;
      this.mine?.getVideoTracks()[0]?._switchCamera?.();
    }
    this.push();
    // The others learn from the next heartbeat what we are sending now; this makes it the next one rather than in two seconds.
    if (op === "mic" || op === "cam") await this.step(() => this.beatOnce()).catch(() => undefined);
  }

  /** Away: the camera is closed, the sound carries on. Back: the camera again. */
  private async onAppState(s: string): Promise<void> {
    const away = s === "background";
    for (const t of this.mine?.getVideoTracks() ?? []) t.enabled = this.camOn && !away;
  }

  // --------------------------------------------------------------------- leaving

  async leave(): Promise<void> {
    if (this.stopped) return;
    const seat = this.seat;
    this.finish("ended");
    if (seat) await this.api.post(`${SEAT}/leave`, { seat }).catch(() => undefined);
    this.api.onEnd?.();
  }

  /** Everything let go of, once. Safe to call twice. */
  finish(phase: CallPhase): void {
    if (this.stopped) return;
    this.stopped = true;
    this.phase = phase;
    if (this.beat) { clearTimeout(this.beat); this.beat = null; }
    this.appSub?.remove();
    this.appSub = null;
    this.stopTracks();
    try { this.pc?.close(); } catch { /* already closed */ }
    this.pc = null;
    this.byMid.clear();
    this.held = [];
    this.people = [];
    this.waiting = [];
    this.seat = "";
    this.push();
    this.api.changed();
  }

  private stopTracks(): void {
    for (const t of this.mine?.getTracks() ?? []) { try { t.stop(); } catch { /* already stopped */ } }
    this.mine = null;
  }

  // --------------------------------------------------------------------- what the screen and the tiles read

  /** The stream for one identity, for a Caller node. Null when they are not sending a picture. */
  streamFor(identity: string): StreamLike | null {
    if (this.me && identity === this.me.identity) return this.camOn ? this.mine : null;
    const held = this.held.find((t) => t.identity === identity && t.kind === "video");
    const track = held ? this.byMid.get(held.mid) : null;
    return track ? new this.rtc.MediaStream([track]) : null;
  }

  /** Who is in the call, for a Caller node that was given a name rather than an identity. */
  snapshot(): { me: { identity: string; name: string } | null; people: readonly CallPerson[]; speaking: ReadonlySet<string> } {
    return { me: this.me, people: this.people, speaking: speakingOf(this.lastHeard, this.now()) };
  }

  /** Levels read off the connection, folded in so a tile lights for whoever is talking. */
  noteLevels(levels: Record<string, number>): void {
    this.lastHeard = heard(this.lastHeard, levels, this.now());
  }

  private sayReconnecting(): void {
    if (this.phase === "live") { this.phase = "reconnecting"; this.push(); }
  }

  /** One change at a time: the SFU refuses a second offer while the first is unanswered. */
  private step<T>(run: () => Promise<T>): Promise<T> {
    const mine = this.chain.then(run, run);
    this.chain = mine.then(() => undefined, () => undefined);
    return mine;
  }

  private push(): void {
    this.api.write(stateOf({
      phase: this.phase, mic: this.micOn, cam: this.camOn, speaker: this.speakerOn, front: this.frontOn,
      me: this.me, people: this.people, waiting: this.waiting, speaking: speakingOf(this.lastHeard, this.now()),
    }));
  }
}
