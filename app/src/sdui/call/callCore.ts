/**
 * A CALL, WITHOUT REACT NATIVE OR WEBRTC (the `call` block; the feature is TAILZU-BACKEND/docs/rooms.md).
 *
 * Everything here is arithmetic on plain objects, so each rule is tested on its own (callCore.test.ts) and the part that touches the
 * microphone, the camera and the network stays small (index.ts).
 *
 *   wanted(people, have)        which of the others' tracks this phone has not pulled yet, and which it holds for someone who has gone
 *   stateOf(...)                what the screen reads: phase, mic, cam, speaker, front, me, people, waiting
 *   heard / speakingOf          who is talking, with a hold so a tile does not flicker between words
 *   whoIs(who, …)               who a tile means by "me", "speaker" or a name
 *   backoffMs(tries)            how long to wait before asking again after the call dropped
 *   CALL_SPEC                   what the block promises, as data, for the server's lint
 *
 * THE SEAT IS NEVER IN THE STATE. A screen is data from the server and its state is readable by anything the server draws, so the seat
 * (a bearer: whoever holds it is in the call) lives only in the session object, and what the screen gets is who is in the call.
 *
 * Not to be confused with `sdui/live/`, which is live UPDATES over the app's socket. This is a call.
 */

/** Where a call stands, as the screen reads it. */
export type CallPhase = "connecting" | "live" | "reconnecting" | "ended" | "failed";

/** Someone else in the call, as the server's heartbeat sends them. */
export interface CallPerson {
  identity: string;
  name: string;
  role: "host" | "guest";
  /** The names of the tracks they are sending; absent while that one is off. */
  audio?: string;
  video?: string;
}

/** Someone at the door (the host's own). */
export interface CallKnock { id: string; name: string }

/** One of someone else's tracks, once it has arrived. */
export interface HeldTrack { identity: string; kind: "audio" | "video"; mid: string }

export const CALL_LIMITS = {
  /** The heartbeat, while the call is up. */
  beatMs: 2_000,
  /** A beat that takes longer than this is given up on; the next one goes out on time. */
  beatTimeoutMs: 8_000,
  /** Nothing heard back for this long: the call says it is reconnecting. */
  quietMs: 7_000,
  /** Tries before a call that will not come back is called failed. */
  retries: 6,
  /** The most people one call draws. */
  people: 50,
  /** A tile stays lit this long after someone stops talking, so it does not flicker between words. */
  speakingHoldMs: 1_200,
  /** Someone is talking above this (0..1, from the track's own level). */
  speakingLevel: 0.02,
} as const;

/** What the block promises, as data, so the server's lint and this code cannot drift. */
export const CALL_SPEC = {
  block: "call",
  what: "One of our own calls, held for a screen: take a seat, change the microphone and camera, leave. The people in it are written into the screen's state; a Caller node draws one person's picture.",
  nodes: { Caller: "{ who: me | speaker | <identity>, mirror?, fit?, radius?, background?, nameColor?, fontFamily? }" },
  actions: {
    "call.join": "{ join, statePath, knock?, video?, onEnd?, onBlocked?, onError? }",
    "call.set": "{ op: mic | cam | speaker | flip, value? }",
    "call.leave": "{}",
  },
  writes: {
    "statePath.phase": "connecting | live | reconnecting | ended | failed",
    "statePath.mic": "the person's own microphone is on",
    "statePath.cam": "their own camera is on",
    "statePath.speaker": "the loudspeaker rather than the earpiece (the phone only)",
    "statePath.front": "the front camera rather than the back (the phone only)",
    "statePath.me": "{ identity, name }",
    "statePath.people": "[{ identity, name, role, speaking, mic, cam }] — everyone else in the call",
    "statePath.waiting": "[{ id, name }] — who is at the door, for the host only",
  },
  rules: "the seat is a bearer and never reaches the screen's state; the routes it talks to are /v1/rooms/seat/*",
  limits: CALL_LIMITS,
} as const;

// ===================================================================== what to pull, and what to drop

export interface WantedOut {
  /** Tracks to ask the server for. */
  pull: Array<{ identity: string; kind: "audio" | "video" }>;
  /** Tracks held for someone who is no longer in the call, or who turned that one off. */
  drop: HeldTrack[];
}

/**
 * The difference between who is in the call and what this phone already has. Both ways matter: a new person is pulled in, and someone
 * who left (or turned their camera off) is let go, so a tile does not keep a frozen last frame.
 */
export function wanted(people: readonly CallPerson[], have: readonly HeldTrack[]): WantedOut {
  const kinds = ["audio", "video"] as const;
  const held = new Set(have.map((t) => `${t.identity}:${t.kind}`));
  const want = new Set<string>();
  const pull: WantedOut["pull"] = [];
  for (const p of people.slice(0, CALL_LIMITS.people)) {
    for (const kind of kinds) {
      if (!p[kind]) continue;
      want.add(`${p.identity}:${kind}`);
      if (!held.has(`${p.identity}:${kind}`)) pull.push({ identity: p.identity, kind });
    }
  }
  return { pull, drop: have.filter((t) => !want.has(`${t.identity}:${t.kind}`)) };
}

// ===================================================================== who is talking

/** The last time each identity was heard above the threshold. */
export type SpeakingSince = Readonly<Record<string, number>>;

/** Who counts as talking now: anyone heard inside the hold. */
export function speakingOf(lastHeard: SpeakingSince, now: number): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [identity, at] of Object.entries(lastHeard)) {
    if (now - at <= CALL_LIMITS.speakingHoldMs) out.add(identity);
  }
  return out;
}

/** The levels just read, folded into when each person was last heard. */
export function heard(lastHeard: SpeakingSince, levels: Readonly<Record<string, number>>, now: number): SpeakingSince {
  const out: Record<string, number> = { ...lastHeard };
  for (const [identity, level] of Object.entries(levels)) {
    if (level >= CALL_LIMITS.speakingLevel) out[identity] = now;
  }
  // Anyone long silent is forgotten, so the map cannot grow with a call's comings and goings.
  for (const identity of Object.keys(out)) {
    if (now - (out[identity] ?? 0) > CALL_LIMITS.speakingHoldMs * 10) delete out[identity];
  }
  return out;
}

// ===================================================================== the state a screen reads

export interface StateIn {
  phase: CallPhase;
  mic: boolean;
  cam: boolean;
  speaker: boolean;
  front: boolean;
  me: { identity: string; name: string } | null;
  people: readonly CallPerson[];
  waiting: readonly CallKnock[];
  speaking: ReadonlySet<string>;
}

/** Exactly what goes into the screen's state, and nothing else: no seat, no session, no track names. */
export function stateOf(s: StateIn): Record<string, unknown> {
  return {
    phase: s.phase,
    mic: s.mic,
    cam: s.cam,
    speaker: s.speaker,
    front: s.front,
    me: s.me ? { identity: s.me.identity, name: s.me.name } : null,
    people: s.people.slice(0, CALL_LIMITS.people).map((p) => ({
      identity: p.identity,
      name: p.name,
      role: p.role,
      speaking: s.speaking.has(p.identity),
      mic: !!p.audio,
      cam: !!p.video,
    })),
    waiting: s.waiting.map((k) => ({ id: k.id, name: k.name })),
  };
}

/** Whoever a `Caller` node means by `who`: "me", "speaker" (the first one talking, else the first person), or an identity. */
export function whoIs(who: string, s: { me: { identity: string } | null; people: readonly CallPerson[]; speaking: ReadonlySet<string> }): string {
  if (who === "me") return s.me?.identity ?? "";
  if (who !== "speaker") return who;
  const talking = s.people.find((p) => s.speaking.has(p.identity));
  return (talking ?? s.people[0])?.identity ?? s.me?.identity ?? "";
}

// ===================================================================== coming back

/** How long to wait before trying the call again: a second, then two, four, eight, up to fifteen. */
export function backoffMs(tries: number): number {
  return Math.min(15_000, 1_000 * 2 ** Math.max(0, Math.min(tries, 4)));
}

/** A call that has dropped this many times in a row is not coming back. */
export const tooManyTries = (tries: number): boolean => tries >= CALL_LIMITS.retries;
