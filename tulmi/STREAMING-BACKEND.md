# Backend setup — turn on live dictation

Your app + both keyboards are already built for live dictation (see
`../STREAMING.md`). They stay on the old file-based dictation until your backend
serves **one new endpoint**: `GET /v1/transcribe-stream`. This guide adds it.

> **Where this runs:** your **backend repo** on the VPS (the Fastify server),
> *not* the app repo. `transcribe-stream.ts` (next to this file) is the drop-in.

You'll do this on the backend. ~15 minutes.

---

## 1. Get a Deepgram API key

Deepgram is the speech engine (fast, cheap, built for live, ~$0.0043/min, free
trial credit to start).

1. Sign up at <https://console.deepgram.com/signup>
2. Create an API key, copy it.

(Prefer a different engine later? Only `openEngine()` in `transcribe-stream.ts`
changes — the app never knows.)

## 2. Add the file + dependencies (in the backend repo)

Copy `transcribe-stream.ts` into your backend's source (e.g. `src/routes/`),
then:

```bash
npm i @fastify/websocket @deepgram/sdk
# only if you route any language to Google Chirp (see "Per-language routing"):
npm i @google-cloud/speech
# Sarvam needs no extra dep — it reuses the `ws` that @fastify/websocket pulls in.
```

Engine SDKs load **lazily**, so you only need the dep + key for the engines your
routing table actually uses. Deepgram-only? You can skip the Google install.

(If your backend is plain JS, not TypeScript, tell me and I'll hand you a `.js`
version — the logic is identical.)

## 3. Register the route

Wherever your Fastify app registers routes/plugins (often `src/server.ts` or
`src/app.ts`), add:

```ts
import transcribeStream from "./routes/transcribe-stream";
// ...after the fastify instance is created, with your other routes:
await fastify.register(transcribeStream);
```

## 4. Set the keys + redeploy

Add to the server's environment (the same place your other secrets live) — only
the engines you actually route to:

```
DEEPGRAM_API_KEY=your_key_here                          # Western / European
SARVAM_API_KEY=your_key_here                            # Indic + Hinglish
GOOGLE_APPLICATION_CREDENTIALS=/app/shared/gcp-sa.json  # Google Chirp (path to JSON)
```

> Google reads a **service-account JSON file**, not an API key — set the env var
> to its path and make sure the file is inside the container (e.g. mount it or
> bake it into `shared/`). The other two are plain API keys.

Then deploy/restart the backend as you normally do.

**Quick check it's live** (replace with your real host):

```bash
# Should NOT 404. A 400/426 "Upgrade Required" means the route exists. 👍
curl -i https://YOUR-BACKEND-HOST/v1/transcribe-stream
```

## 5. Flip the switch for the keyboards

The keyboards only go live when `GET /v1/keyboard/config` reports it. In that
endpoint's JSON, add `liveVoice: true` under `features`:

```jsonc
{
  "theme":    { /* ... */ },
  "features": { "voice": true, "refine": true, "liveVoice": true },
  "labels":   { /* ... */ }
}
```

The in-app voice button goes live when the server-driven UI sets the node prop
`live: true` on a `VoiceButton`.

That's it. No app rebuild needed for the keyboards — they pick up `liveVoice` on
their next config refresh.

---

## Per-language routing (best engine per language)

The app is a renderer — the **backend owns all control**. The user picks a
language in the app; it arrives in the `start` message, and `transcribe-stream.ts`
routes it to the engine that's best for that language group. Every engine is
normalised to the same `ready/partial/final/done` protocol, so the phone never
knows which one answered.

| Language group | Engine | Why |
|---|---|---|
| Western / European (`en`,`es`,`fr`,`de`,`pt`,`ru`,…) | **Deepgram** | fast, cheap, top accuracy |
| Indic + Hinglish (`hi`,`ta`,`te`,`bn`,`mr`,`gu`,…) | **Sarvam** | best Indic + native code-switching |
| MENA / CJK / long tail (`ar`,`ur`,`he`,`zh`,`ja`,…) | **Google Chirp** | 100+ languages, universal fallback |

To change the mapping, edit the `ENGINE_BY_LANG` table near the top of
`transcribe-stream.ts` — one row per language. `DEFAULT_ENGINE` (Google) catches
anything unmapped. Adding a new engine = one adapter + one row; **no app change**.

> **Sarvam adapter:** the realtime endpoint/auth/message-shape in `openSarvam()`
> is marked with a `⚠️ VERIFY` comment — confirm it against the current Sarvam
> docs (their realtime API shape can change) before relying on the Indic path.

---

## Auth note

`transcribe-stream.ts` currently accepts the stream without verifying the token
(works against `DEV_SKIP_AUTH=true`, like the rest of your dev backend). Before
production, verify `msg.token` (the Supabase JWT the app sends in the `start`
message) using your existing verifier — there's a `TODO (auth)` marking the
exact spot.

## How it maps to the app

| App sends                     | Backend does                          | Backend replies            |
|-------------------------------|---------------------------------------|----------------------------|
| `{type:"start", ...}`         | opens a Deepgram live connection      | `{type:"ready"}`           |
| raw PCM (16 kHz mono) frames  | forwards bytes to Deepgram            | `{type:"partial", text}`   |
| (keeps talking)               | Deepgram finalizes a segment          | `{type:"final", text}`     |
| `{type:"stop"}`               | flushes + closes                      | `{type:"done"}`, closes    |

Full protocol: `../STREAMING.md`.
