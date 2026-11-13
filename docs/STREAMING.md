# Tulmi live dictation — streaming protocol

This is the contract between the **phone side** (app + both keyboards, in this
repo) and the **backend** (separate repo). The phone side is already built
against this spec; the backend just has to match it.

True-live dictation replaces the one-shot `POST /v1/transcribe-clean` (record a
whole `.m4a`, upload, wait) with an **always-open WebSocket**: the client streams
raw mic audio in small chunks and the server streams transcript text back as it
is recognized, so words appear in the text field while the user is still talking.

## Endpoint

```
GET /v1/transcribe-stream      (HTTP → WebSocket upgrade)
```

Derive the WebSocket URL from the configured backend base URL by swapping the
scheme: `http://…` → `ws://…`, `https://…` → `wss://…`, then append
`/v1/transcribe-stream`. (The phone side does this automatically.)

### Auth

The client sends the user's Supabase JWT two ways (use whichever your server
framework reads more easily):

1. As an `Authorization: Bearer <jwt>` header on the upgrade request.
2. Inside the first `start` message (below) as `token`.

A `"dev"` token is sent when there is no session yet (matches the existing
`DEV_SKIP_AUTH=true` backend behavior).

## Message flow

```
client ──▶ server   start         (JSON, text frame)   — once, first
server ──▶ client   ready         (JSON, text frame)   — server is ready for audio
client ──▶ server   <audio>       (binary frames)      — raw PCM, many
server ──▶ client   partial       (JSON, text frame)   — interim, may change
server ──▶ client   final         (JSON, text frame)   — a committed segment
client ──▶ server   stop          (JSON, text frame)   — once, last
server ──▶ client   done          (JSON, text frame)   — optional, cleaned full text
                    (server closes the socket)
```

### Client → server

**`start`** (first message):

```json
{
  "type": "start",
  "token": "<jwt or 'dev'>",
  "targetApp": "WhatsApp",
  "language": "auto",
  "sampleRate": 16000,
  "encoding": "pcm_s16le",
  "channels": 1
}
```

**Audio** — binary WebSocket frames containing raw PCM:
`16000 Hz, 16-bit signed little-endian, mono`. Frames are whatever size the OS
hands us (~20–100 ms each). No container, no header — just samples.

**`stop`** (last message): `{ "type": "stop" }`

### Server → client (all JSON text frames)

| `type`    | Fields            | Meaning                                                        |
|-----------|-------------------|----------------------------------------------------------------|
| `ready`   | —                 | Connected to the speech engine; start sending audio.           |
| `partial` | `text`            | Interim hypothesis for the **current** segment. Will be replaced. |
| `final`   | `text`            | A segment is finalized. Commit it; the next `partial` starts fresh. |
| `done`    | `text` (optional) | After `stop`: the whole utterance, optionally LLM-cleaned.      |
| `error`   | `message`         | Something failed; the client shows it and stops.               |

## How the client renders it (so the backend knows what to expect)

The client keeps a `pending` string = the partial text currently shown in the
field. The effect is "type, then correct as you go":

- On **`partial(text)`**: delete `pending.length` chars backward, insert `text`,
  set `pending = text`.
- On **`final(text)`**: delete `pending.length` chars backward, insert `text` +
  a trailing space, set `pending = ""`. (Committed text stays put.)

So `partial` messages **must** carry the full text of the *current* segment (not
just the newest word), and after a `final` the engine should reset and send
`partial`s for the next segment from scratch. This matches Deepgram-style
`is_final` / interim results, AssemblyAI partial/final transcripts, and the
OpenAI Realtime `delta` + `completed` events (accumulate deltas into the segment
text server-side before forwarding).

## Backend sketch (engine-agnostic)

```
on WS connection:
  read `start` → auth, pick targetApp/language
  open a streaming session to your speech engine (Deepgram / AssemblyAI /
    OpenAI Realtime / self-hosted Whisper)
  send {"type":"ready"}

  on binary audio frame:  forward bytes to the engine
  on engine interim:      send {"type":"partial","text": <segment so far>}
  on engine final:        send {"type":"final","text": <segment>}

  on `stop`:
    flush the engine; optionally run the full transcript through /v1/refine-style
    cleanup; send {"type":"done","text": <cleaned>}; close.
```

Most engines want 16 kHz mono PCM, which is exactly what the client sends — so
in many cases the backend just pipes the bytes straight through.

## Feature flag

Until the backend implements this endpoint, the phone side stays on file-based
dictation. The switch is server-driven:

- **Keyboards** read `features.liveVoice` (boolean, default `false`) from
  `GET /v1/keyboard/config`. Set it `true` once the endpoint is live and the
  keyboards go live automatically — no app update needed.
- **App** `VoiceButton` goes live when the server-driven UI sets the node prop
  `live: true` (and the native stream module is present). Otherwise it records a
  file as before.

If a stream errors or the module is missing, every surface falls back to the
existing `POST /v1/transcribe-clean` path, so nothing breaks.

---

# The realtime call (Plan Ease's live conversation)

The dictation stream above is turn by turn: audio up, words back, our server in
the middle. **Plan Ease's call is not on it.** When Plan Ease calls (anything the
call judge thinks matters, and always a leave-by or a bill due today) and the
person answers, a store build opens one
WebRTC connection from the phone **straight to the voice service**, and the
conversation runs on that: both sides speak, either can interrupt, and the words
come back as events on a data channel.

Why not this stream: raw PCM over a TCP socket is about 640 kbps (≈4.8 MB a
minute) and stalls on a lossy 4G cell, where Opus over WebRTC is about 30–40 kbps
(≈0.5 MB). Barge-in, the jitter buffer and the echo cancellation come with
libwebrtc instead of being written here. See the design spec for the rest.

## Who holds what

- **Our server does the handshake**, with its own key: the phone posts its offer,
  the server creates the session (model, instructions, tools, voice) and answers
  with the SDP. **The phone never holds a credential of the voice service**, not
  even a short-lived one.
- **Our server holds a second, side connection** on the same call. Every tool the
  bot runs, the cost record, the consent re-check, the idle end, the hard length
  and the transcript into the Plan Ease chat are all there — not here.
- **The phone's data channel is read only.** The app never sends on it. The phase
  the screen draws, the bot's words and the person's last words come off it, and
  nothing else.

## The phone's side of it

| Step | What happens |
|---|---|
| `POST <call>/live` | `{sdp, resume?}` → `{sdp, maxSec}`. Any non-200 at all means "carry on turn by turn". |
| set the answer | then the connection comes up and the data channel opens |
| `POST <call>/live/ready` | once; the server then has the bot say the opening |
| the conversation | events on the data channel; the voice level from the connection's own statistics |
| `POST <call>/live/stop` | the app went to the background, or something took the audio |

Timers: 10 s from the `live` reply to "connected and open", 25 s overall from
sending it, and `maxSec + 10 s` as the backstop if our server dies. Past any of
them the phone closes and the call carries on turn by turn, with no tap from the
person.

## One microphone at a time

Three things want the microphone: the warm-up (the screen runs `voiceCallSet`
`warm` beside `POST answer`, so the offer is ready a round trip sooner), the call
itself, and a second "Tap to talk" while the first is still opening one. Each
waits for the one in front of it instead of opening its own, and the registry in
`callRealtimeCore.ts` holds the call from the first `callAudio` to the last — so
every other sound stands aside, and an End, or the screen going, is answered even
mid-open:

- `warm` returns at once, so the answer is never held up behind the microphone,
  and a call that starts meanwhile takes that microphone over, even one still
  opening;
- an End while a call is opening (`voiceCallSet` `end` → `endCallNow`) ends
  whatever holds the call — a warmed microphone, a call still opening one, or the
  live call — so nothing is said after the hang-up;
- a second tap waits for the first call to let go, so no call is left orphaned
  with a microphone, talking over the turn call;
- leaving the app while the call is still connecting parks it, from before the
  microphone is opened to the moment `ready` is sent: an app with an open audio
  session keeps running, so a call left starting in the background would be a
  microphone in an empty room.

A connection that says `disconnected` is given about five seconds to come back by
itself before the call is given up — that is what a handover from Wi-Fi to mobile
data looks like. `failed` and `closed` are given up at once.

## The echo canceller (Android)

Some budget phones claim an echo canceller that is not good enough for a
speakerphone call, and the bot answers its own voice. For the models
`SOFT_AEC_MODELS` lists, the call asks for libwebrtc's software canceller
instead. **It cannot be chosen when a call starts:** React creates its native
modules as the app starts, before any JavaScript runs, and the live client builds
its audio in its own constructor. So `callAudio("prepare", { aec })` only
REMEMBERS the ask, and `CallAec.kt` applies it at the next start of the app, from
`TulmiStreamPackage.kt`'s application listener — which is also why `prepare`
answers what the process really HAS (`"soft"` or `"hw"`), not what was asked for.

**A call that needs the software one and did not get it does not happen.** The
phone compares the two, logs it and stays a turn call (`openMic`, before anything
is sent to the server, so nothing is spent): on those models a live call would
have the bot cutting itself off and its own "…OK?" coming back as the person's
"OK" — the read-back before a payment or a move. The ask is stored, so the next
start of the app has the software canceller and the live call runs. A phone that
does not need it never loads any of the live client at start-up. The device
matrix must restart the app between a hardware and a software run.

**The ask is written only when a call starts, never from the app's own start-up
path, on purpose.** `openMic` writes it, and it runs only for people the server
sent a live call to — the switch on, allowed, and the AI permission given — so a
phone loads the live client at start-up only if someone on it really gets live
calls. A start-up write gated on the binary feature alone would store it on every
listed phone, people without that permission included, for a call they cannot
get; gating it properly would mean the bootstrap carrying who is eligible. The
most it would save is one turn call per phone, once.

## Where it lives

| Part | File |
|---|---|
| The rules: phases, the words kept, the throttle, the timers, the echo-canceller list, which screen holds the call | `app/src/sdui/voice/callRealtimeCore.ts` (+ `.test.ts`) |
| The microphone, the connection, the screen's actions (`voiceCall`, `voiceCallSet`) | `app/src/sdui/voice/callRealtime.ts` |
| That no file imports the live client | `app/src/sdui/voice/callRealtime.imports.test.ts` |
| That one microphone opens at a time: End mid-open, two taps, the warm-up still opening; and that leaving the app mid-connect parks the call, a brief `disconnected` does not end it, and the phone's backstop is counted from `ready` | `app/src/sdui/voice/callRealtime.turns.test.ts` (the phone stood in for) |
| The phone's audio for a call: speaker, focus, interruptions | `app/modules/tulmi-stream` (`callAudio`), in both native modules |
| The echo canceller, chosen at the start of the app (Android) | `app/modules/tulmi-stream/android/.../CallAec.kt`, `TulmiStreamPackage.kt` (`android/consumer-rules.pro` keeps the class it names) |
| What the binary promises the server (`realtimeCall` → `VoiceRealtime`) | `app/src/device/binaryCore.ts`, the bridge's `binaryFeatures` |
| Leaving the screen ends the call; a Flow session is asked about first | `app/src/sdui/shell/ScreenHost.tsx` (`leaveCall`), `app/modules/tulmi-bridge/index.ts` (`isFlowActive`) |
| The store build's native config | `app/app.config.ts`, `app/plugins/withNoWebrtcFgs.js` (no screen-sharing service in the merged manifest), `app/plugins/withWebrtcPin.js` (one named libwebrtc, Android and iOS) |

## Store build only, and safe over the air

The live client (`react-native-webrtc`) is native, so the call ships in a store
build and nowhere else. The same JavaScript still reaches binaries made before
it, so:

- the one `require` of the client sits behind the binary's own feature
  (`realtimeCall`) and inside try/catch, and `callRealtime.imports.test.ts`
  fails the build if any file imports it instead;
- an older binary says no `realtimeCall`, so the server never sends it the call's
  actions at all and keeps today's turn-by-turn call;
- anything that throws — no client, no microphone, a server that says no — runs
  the screen's own fallback, which is today's call.
