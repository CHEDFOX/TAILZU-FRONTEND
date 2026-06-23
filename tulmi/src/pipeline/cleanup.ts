/**
 * The cleanup "brain": OpenRouter chat calls that
 *  - clean()/cleanStream()  : polish raw transcript OR typed text (voice + typing)
 *  - draftReply()           : draft a personalized reply from screen content + intent
 *
 * Default model: anthropic/claude-haiku-4.5, swappable via CLEANUP_MODEL.
 * System prompts are built in ../prompts.ts from the versioned shared/prompts/.
 */
import OpenAI from "openai";
import { getConfig } from "../config.js";
import { buildCleanupSystem, buildReplySystem } from "../prompts.js";
import type { CleanupOptions } from "../../../shared/types/api.js";

let client: OpenAI | null = null;
function openrouter(): OpenAI {
  if (!client) {
    const cfg = getConfig();
    client = new OpenAI({
      apiKey: cfg.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": cfg.OPENROUTER_APP_URL,
        "X-Title": cfg.OPENROUTER_APP_NAME,
      },
    });
  }
  return client;
}

const TEMPERATURE = 0.2; // low: faithful cleanup, not creativity
const REPLY_TEMPERATURE = 0.4; // a touch more latitude for natural drafting

// --- Cleanup / refine (voice + typing) -------------------------------------

/** Non-streaming cleanup of a transcript or typed text. */
export async function clean(
  input: string,
  opts: CleanupOptions = {},
): Promise<string> {
  if (!input.trim()) return "";
  const res = await openrouter().chat.completions.create({
    model: getConfig().CLEANUP_MODEL,
    temperature: TEMPERATURE,
    messages: [
      { role: "system", content: buildCleanupSystem(opts) },
      { role: "user", content: input },
    ],
  });
  return (res.choices[0]?.message?.content ?? "").trim();
}

/** Streaming cleanup — yields cleaned text deltas as they arrive. */
export async function* cleanStream(
  input: string,
  opts: CleanupOptions = {},
): AsyncGenerator<string, void, unknown> {
  if (!input.trim()) return;
  const stream = await openrouter().chat.completions.create({
    model: getConfig().CLEANUP_MODEL,
    temperature: TEMPERATURE,
    stream: true,
    messages: [
      { role: "system", content: buildCleanupSystem(opts) },
      { role: "user", content: input },
    ],
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

// --- Screen-reply drafting --------------------------------------------------

/** Draft a personalized reply from on-screen content + the user's intent. */
export async function draftReply(
  screenContent: string,
  intent: string,
  opts: CleanupOptions = {},
  recipient?: string,
): Promise<string> {
  if (!intent.trim()) return "";
  const userMsg =
    `SCREEN CONTENT (what I'm replying to):\n${screenContent.trim() || "(none)"}\n\n` +
    `MY INTENT (what I want to say back):\n${intent.trim()}`;

  const res = await openrouter().chat.completions.create({
    model: getConfig().CLEANUP_MODEL,
    temperature: REPLY_TEMPERATURE,
    messages: [
      { role: "system", content: buildReplySystem(opts, recipient) },
      { role: "user", content: userMsg },
    ],
  });
  return (res.choices[0]?.message?.content ?? "").trim();
}
