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
