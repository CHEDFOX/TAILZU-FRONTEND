/**
 * Per-user usage metering. Every successful request records audio seconds +
 * word count so we can enforce a free tier later.
 *
 * Writes to the Supabase `usage_events` table (see supabase/migrations). When
 * Supabase is disabled (DEV_SKIP_AUTH local testing) we log instead of writing,
 * so the pipeline still runs end-to-end without a database.
 */
import { dataClientFor, supabase, type AuthedUser } from "../auth/supabase.js";
import type { UsageRecord } from "../../../shared/types/api.js";

export interface MeterInput extends UsageRecord {
  user: AuthedUser;
  /** Which surface produced this: "rest" | "stream". */
  source: "rest" | "stream";
}

export async function recordUsage(input: MeterInput): Promise<void> {
  const sb = dataClientFor(input.user);

  if (!sb) {
    // Dev / no-Supabase mode: don't lose the signal, just log it.
    console.info(
      `[usage] user=${input.user.id} audio=${input.audioSeconds.toFixed(
        1,
      )}s words=${input.words} model=${input.model} source=${input.source}`,
    );
    return;
  }

  const { error } = await sb.from("usage_events").insert({
    user_id: input.user.id,
    audio_seconds: input.audioSeconds,
    word_count: input.words,
    model: input.model,
    source: input.source,
  });

  if (error) {
    // Never fail the user's request because metering failed; log loudly.
    console.error(`[usage] failed to record for ${input.user.id}:`, error.message);
  }
}

/**
 * Sum a user's audio-seconds usage since a given ISO timestamp. This is the
 * read side free-tier enforcement will use later (e.g. "minutes this month").
 */
export async function usageSince(
  userId: string,
  sinceIso: string,
): Promise<{ audioSeconds: number; words: number } | null> {
  const sb = supabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("usage_events")
    .select("audio_seconds, word_count")
    .eq("user_id", userId)
    .gte("created_at", sinceIso);

  if (error || !data) return null;

  return data.reduce(
    (acc, row) => ({
      audioSeconds: acc.audioSeconds + (row.audio_seconds ?? 0),
      words: acc.words + (row.word_count ?? 0),
    }),
    { audioSeconds: 0, words: 0 },
  );
}
