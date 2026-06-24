/**
 * Tulmi live dictation — backend streaming endpoint (DROP-IN for the backend repo).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ This file does NOT belong to the app repo — it's a handoff artifact.      │
 * │ Copy it into your Fastify backend repo (the one on the VPS) and register  │
 * │ it. See STREAMING-BACKEND.md (next to this file) for setup.               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Implements the WebSocket side of STREAMING.md:
 *   GET /v1/transcribe-stream
 *   client → { type:"start", language, ... } then raw 16 kHz mono PCM frames,
 *            then { type:"stop" }
 *   server → { type:"ready" | "partial" | "final" | "done" | "error", text? }
 *
 * ── Per-language engine routing ────────────────────────────────────────────
 * The app is a renderer: the BACKEND owns all control. The user selects a
 * language in the app; that language arrives here in the `start` message, and
 * we route it to the engine that is genuinely best for that language group:
 *
 *   Western / European (en, es, fr, de, …)  → Deepgram  (fast, cheap, accurate)
 *   Indic + Hinglish    (hi, ta, te, bn, …)  → Sarvam    (best Indic + code-switch)
 *   MENA / CJK / long tail (ar, ur, zh, …)   → Google    (Chirp, 100+ languages)
 *
 * Every engine is normalised to the SAME wire protocol above, so the phone
 * never knows (or cares) which engine answered. Add/swap an engine = add one
 * adapter + one row in ENGINE_BY_LANG. No app changes, ever.
 *
 * Requires:  npm i @fastify/websocket @deepgram/sdk
 *            (+ @google-cloud/speech for Google; Sarvam uses the bundled `ws`)
 * Env:       DEEPGRAM_API_KEY=...           (Deepgram)
 *            SARVAM_API_KEY=...             (Sarvam)
 *            GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json  (Google)
 *            (+ your existing DEV_SKIP_AUTH / Supabase)
 * Engine SDKs are loaded lazily, so you only need keys/deps for the engines
 * your routing table actually uses.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import websocket from "@fastify/websocket";

interface StartMessage {
  type: "start";
  token?: string;
  targetApp?: string;
  language?: string; // the user's selected language, e.g. "hi" | "en" | "ar" | "auto"
  sampleRate?: number;
  encoding?: string;
  channels?: number;
}

/** Emits a protocol message back to the phone. */
type Emit = (obj: unknown) => void;

/** A live speech engine, normalised to one tiny interface. */
interface Engine {
  send(chunk: Buffer): void; // forward a PCM audio frame
  close(): void; // flush + close the upstream engine
}

const NOOP: Engine = { send() {}, close() {} };

// ── Routing ────────────────────────────────────────────────────────────────
type EngineId = "deepgram" | "sarvam" | "google";

/** Universal fallback for anything not explicitly mapped (Google = 100+ langs). */
const DEFAULT_ENGINE: EngineId = "google";

/** Best engine per language. Keys are bare language codes (BCP-47 base). */
const ENGINE_BY_LANG: Record<string, EngineId> = {
  // Western / European → Deepgram (fast, cheap, top accuracy)
  en: "deepgram", es: "deepgram", fr: "deepgram", de: "deepgram", it: "deepgram",
  pt: "deepgram", nl: "deepgram", ru: "deepgram", sv: "deepgram", da: "deepgram",
  no: "deepgram", pl: "deepgram", uk: "deepgram", tr: "deepgram", id: "deepgram",
  // Indic + Hinglish → Sarvam (best Indic accuracy + native code-switching)
  hi: "sarvam", hinglish: "sarvam", ta: "sarvam", te: "sarvam", bn: "sarvam",
  mr: "sarvam", gu: "sarvam", kn: "sarvam", ml: "sarvam", pa: "sarvam", or: "sarvam",
  // MENA / CJK / long tail → Google Chirp (universal, widest coverage)
  ar: "google", ur: "google", he: "google", fa: "google",
  zh: "google", ja: "google", ko: "google",
};

function pickEngine(language?: string): EngineId {
  if (!language || language === "auto") return DEFAULT_ENGINE;
  const l = language.toLowerCase();
  return ENGINE_BY_LANG[l] ?? ENGINE_BY_LANG[l.split(/[-_]/)[0]] ?? DEFAULT_ENGINE;
}

// ── Language code helpers ────────────────────────────────────────────────────
/** App language → Google/BCP-47 locale. */
function toBcp47(language?: string): string {
  if (!language || language === "auto") return "en-US";
  const map: Record<string, string> = {
    en: "en-US", hi: "hi-IN", hinglish: "hi-IN", ar: "ar-SA", ur: "ur-IN",
    he: "he-IL", fa: "fa-IR", zh: "zh", ja: "ja-JP", ko: "ko-KR",
    ta: "ta-IN", te: "te-IN", bn: "bn-IN", mr: "mr-IN", gu: "gu-IN",
    kn: "kn-IN", ml: "ml-IN", pa: "pa-Guru-IN", es: "es-ES", fr: "fr-FR",
    de: "de-DE", it: "it-IT", pt: "pt-BR", nl: "nl-NL", ru: "ru-RU",
  };
  const l = language.toLowerCase();
  return map[l] ?? (l.includes("-") ? language : l);
}

/** App language → Sarvam language-code (their `xx-IN` form). */
function toSarvamLang(language?: string): string {
  const map: Record<string, string> = {
    hi: "hi-IN", hinglish: "hi-IN", ta: "ta-IN", te: "te-IN", bn: "bn-IN",
    mr: "mr-IN", gu: "gu-IN", kn: "kn-IN", ml: "ml-IN", pa: "pa-IN",
    or: "od-IN", en: "en-IN",
  };
  return map[(language ?? "hi").toLowerCase()] ?? "hi-IN";
}

// ── Adapters (one per engine) ────────────────────────────────────────────────
// Each opens its upstream, wires its events to `emit`, and returns an Engine.
// SDKs are imported lazily so an unused engine needs neither dep nor key.

async function openDeepgram(start: StartMessage, emit: Emit): Promise<Engine> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    emit({ type: "error", message: "DEEPGRAM_API_KEY not set on the server" });
    return NOOP;
  }
  const { createClient, LiveTranscriptionEvents } = await import("@deepgram/sdk");
  const deepgram = createClient(key);

  // Hinglish → "hi" (Deepgram has no hinglish code); "auto" → multilingual model.
  const language =
    !start.language || start.language === "auto"
      ? "multi"
      : start.language === "hinglish"
        ? "hi"
        : start.language;

  const dg: any = deepgram.listen.live({
    model: "nova-2",
    language,
    encoding: "linear16", // matches the app's pcm_s16le
    sample_rate: start.sampleRate ?? 16000,
    channels: start.channels ?? 1,
    interim_results: true, // live "partial" text
    smart_format: true,
    punctuate: true,
  });

  dg.on(LiveTranscriptionEvents.Open, () => emit({ type: "ready" }));
  dg.on(LiveTranscriptionEvents.Transcript, (data: any) => {
    const text = data?.channel?.alternatives?.[0]?.transcript ?? "";
    if (text) emit({ type: data.is_final ? "final" : "partial", text });
  });
  dg.on(LiveTranscriptionEvents.Error, (e: any) =>
    emit({ type: "error", message: String(e?.message ?? e) }),
  );

  return {
    send: (chunk) => {
      try {
        dg.send(chunk);
      } catch {
        /* engine not ready yet */
      }
    },
    close: () => {
      try {
        // @deepgram/sdk v3 renamed finish() → requestClose(); support both.
        if (typeof dg.requestClose === "function") dg.requestClose();
        else if (typeof dg.finish === "function") dg.finish();
      } catch {
        /* ignore */
      }
    },
  };
}

async function openGoogle(start: StartMessage, emit: Emit): Promise<Engine> {
  // Creds come from GOOGLE_APPLICATION_CREDENTIALS (path to the service-account
  // JSON). No API-key env needed — the client reads that file automatically.
  let speech: any;
  try {
    speech = await import("@google-cloud/speech");
  } catch {
    emit({
      type: "error",
      message: "@google-cloud/speech not installed (npm i @google-cloud/speech)",
    });
    return NOOP;
  }

  let client: any;
  try {
    client = new speech.SpeechClient();
  } catch (e: any) {
    emit({ type: "error", message: `Google STT init failed: ${String(e?.message ?? e)}` });
    return NOOP;
  }

  const request = {
    config: {
      encoding: "LINEAR16" as const,
      sampleRateHertz: start.sampleRate ?? 16000,
      languageCode: toBcp47(start.language),
      enableAutomaticPunctuation: true,
      // `latest_long` covers ~125 languages in the v1 API and keeps this a
      // single call. For Chirp 2 (even broader) move to the v2 API with a
      // regional recognizer — same adapter shape, different client call.
      model: "latest_long",
    },
    interimResults: true,
  };

  let stream: any;
  try {
    stream = client
      .streamingRecognize(request)
      .on("error", (e: any) => emit({ type: "error", message: String(e?.message ?? e) }))
      .on("data", (data: any) => {
        const result = data?.results?.[0];
        const text = result?.alternatives?.[0]?.transcript ?? "";
        if (text) emit({ type: result?.isFinal ? "final" : "partial", text });
      });
  } catch (e: any) {
    emit({ type: "error", message: String(e?.message ?? e) });
    return NOOP;
  }

  // Google opens the stream eagerly; signal ready now so the app starts sending.
  emit({ type: "ready" });

  return {
    send: (chunk) => {
      try {
        stream.write({ audioContent: chunk });
      } catch {
        /* stream closed */
      }
    },
    close: () => {
      try {
        stream.end();
      } catch {
        /* ignore */
      }
    },
  };
}

async function openSarvam(start: StartMessage, emit: Emit): Promise<Engine> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    emit({ type: "error", message: "SARVAM_API_KEY not set on the server" });
    return NOOP;
  }
  const WS = (await import("ws")).default;

  // ⚠️ VERIFY against current Sarvam docs (https://docs.sarvam.ai): the realtime
  // endpoint, the auth header name, the query params, and the inbound transcript
  // JSON shape. The pattern below is the standard streaming flow — only these
  // vendor specifics may need tweaking if their realtime API has changed.
  const lang = toSarvamLang(start.language);
  const url =
    `wss://api.sarvam.ai/speech-to-text/ws` +
    `?language-code=${encodeURIComponent(lang)}&model=saarika:v2`;

  let ws: any;
  try {
    ws = new WS(url, { headers: { "api-subscription-key": key } });
  } catch (e: any) {
    emit({ type: "error", message: `Sarvam connect failed: ${String(e?.message ?? e)}` });
    return NOOP;
  }

  ws.on("open", () => emit({ type: "ready" }));
  ws.on("message", (raw: any) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // Be liberal in what we accept — different builds nest the transcript
    // differently. Adjust to match the shape you see in their docs/logs.
    const text = msg?.transcript ?? msg?.data?.transcript ?? msg?.text ?? "";
    const isFinal =
      msg?.is_final === true || msg?.type === "final" || msg?.data?.is_final === true;
    if (text) emit({ type: isFinal ? "final" : "partial", text });
  });
  ws.on("error", (e: any) => emit({ type: "error", message: String(e?.message ?? e) }));

  return {
    send: (chunk) => {
      try {
        if (ws.readyState === 1) ws.send(chunk);
      } catch {
        /* not open yet */
      }
    },
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Route the start message to the best engine and open it. */
async function openEngine(
  start: StartMessage,
  emit: Emit,
): Promise<{ engine: Engine; id: EngineId }> {
  const id = pickEngine(start.language);
  const opener =
    id === "deepgram" ? openDeepgram : id === "sarvam" ? openSarvam : openGoogle;
  const engine = await opener(start, emit);
  return { engine, id };
}

// ── Route ────────────────────────────────────────────────────────────────────
async function transcribeStream(fastify: FastifyInstance): Promise<void> {
  // Safe to register more than once; guard if your app already adds it.
  if (!fastify.hasDecorator("websocketServer")) {
    await fastify.register(websocket);
  }

  fastify.get(
    "/v1/transcribe-stream",
    { websocket: true },
    (socket: any, _req: FastifyRequest) => {
      let engine: Engine | null = null;
      let opening = false;
      let closed = false;
      // Audio that arrives before the engine finishes opening is buffered here
      // and flushed the instant it's ready, so the first words aren't lost.
      const pending: Buffer[] = [];

      const emit: Emit = (obj) => {
        // ws readyState OPEN === 1
        if (!closed && socket.readyState === 1) socket.send(JSON.stringify(obj));
      };

      const closeEngine = () => {
        try {
          engine?.close();
        } catch {
          /* ignore */
        }
      };

      socket.on("message", (raw: Buffer, isBinary: boolean) => {
        // Binary frames are audio → forward to the engine (buffer until ready).
        if (isBinary) {
          if (engine) engine.send(raw);
          else if (opening) pending.push(raw);
          return;
        }

        // Text frames are JSON control messages.
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (msg.type === "start") {
          if (opening || engine) return; // already started
          // TODO (auth): unless process.env.DEV_SKIP_AUTH === "true", verify
          // msg.token as a Supabase JWT here (reuse your existing verifier) and
          // close with { type:"error" } if invalid. Left open so it works
          // against DEV_SKIP_AUTH first, like the rest of the backend.
          opening = true;
          openEngine(msg as StartMessage, emit)
            .then(({ engine: e }) => {
              if (closed) {
                e.close();
                return;
              }
              engine = e;
              // Flush anything the phone sent while we were connecting.
              for (const buf of pending) e.send(buf);
              pending.length = 0;
            })
            .catch((err) =>
              emit({ type: "error", message: String(err?.message ?? err) }),
            )
            .finally(() => {
              opening = false;
            });
        } else if (msg.type === "stop") {
          closeEngine();
          // Flush, tell the client we're done, then close the socket.
          setTimeout(() => {
            emit({ type: "done" });
            try {
              socket.close();
            } catch {
              /* ignore */
            }
          }, 300);
        }
      });

      socket.on("close", () => {
        closed = true;
        closeEngine();
      });
      socket.on("error", () => {
        closed = true;
        closeEngine();
      });
    },
  );
}

export default fp(transcribeStream, { name: "tulmi-transcribe-stream" });
