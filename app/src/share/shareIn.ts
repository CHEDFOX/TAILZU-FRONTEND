/**
 * SHARING INTO TAILZU, AS A RULE AND NOT A TANGLE OF CALLBACKS.
 *
 * Something arrives from another app's Share menu (the iOS share extension,
 * the Android share intent: modules/tulmi-share): words, a link, files. The
 * app does three things with it, in order, and this file is that order:
 *
 *   1. make sense of it: a text that is only a web address is a link; the
 *      words that came with it stay as words; at most five files;
 *   2. send each file to the backend's file door (POST /v1/files), once, as
 *      the signed-in person, and drop the local copy whatever happened;
 *   3. open the share-in screen with what survived (file ids, text, link),
 *      where the person picks a bot or Ask. Nothing survived: say so.
 *
 * Free of react-native (useShareIn.ts wires it), so it is tested on its own
 * (shareIn.test.ts).
 */
import type { SharedBatch, SharedItem } from "../../modules/tulmi-share";

export type SharedFile = Extract<SharedItem, { type: "file" }>;

export interface SharePlan {
  text: string;
  url: string;
  files: SharedFile[];
  /** Files left behind: over five, or ones the native side could not take. */
  skipped: number;
}

/** The share-in screen's limits (bots.share-in in the backend). */
export const MAX_FILES = 5;
const MAX_TEXT = 2000;
const WEB = /^https?:\/\/\S+$/i;

/** What was shared, as the share-in screen takes it. */
export function planShare(batch: SharedBatch): SharePlan {
  const words: string[] = [];
  const links: string[] = [];
  const files: SharedFile[] = [];
  let skipped = Number(batch.skipped) || 0;
  for (const item of batch.items ?? []) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "url") {
      const u = String(item.url ?? "").trim();
      if (WEB.test(u)) links.push(u);
    } else if (item.type === "text") {
      const t = String(item.text ?? "").trim();
      if (!t) continue;
      if (WEB.test(t)) links.push(t);
      else words.push(t);
    } else if (item.type === "file") {
      if (typeof item.uri !== "string" || !item.uri) { skipped++; continue; }
      if (files.length >= MAX_FILES) { skipped++; continue; }
      files.push(item);
    }
  }
  const unique = [...new Set(links)];
  // One link is the link; any more go with the words, so nothing is lost.
  const text = [...words, ...unique.slice(1)].filter((t, i, all) => all.indexOf(t) === i).join("\n\n").slice(0, MAX_TEXT);
  return { text, url: (unique[0] ?? "").slice(0, MAX_TEXT), files, skipped };
}

/** The share-in screen's params: `file` (the first id), `files` (all of them, when more than one), `text`, `url`. */
export function shareParams(plan: Pick<SharePlan, "text" | "url">, ids: string[]): Record<string, string> {
  return {
    ...(ids.length ? { file: ids[0]! } : {}),
    ...(ids.length > 1 ? { files: ids.join(",") } : {}),
    ...(plan.text ? { text: plan.text } : {}),
    ...(plan.url ? { url: plan.url } : {}),
  };
}

export interface ShareWords {
  /** While files go up. */
  adding: string;
  /** Nothing could be added. */
  failed: string;
  /** Some of it could not be added (the rest is on the screen). */
  partly: string;
  /** The Bots app is not on for this person. */
  off: string;
}

export interface ShareIO {
  /** What is waiting (taken as it is read), or null. */
  consume(): SharedBatch | null;
  /** The share-in screen is there for this person (the bootstrap's bots.app). */
  enabled(): boolean;
  /** POST /v1/files: the file's id, or the server's words for why not ("" when it gave none). */
  upload(file: SharedFile): Promise<{ id: string } | { error: string }>;
  /** Drop the local copy. */
  discard(file: SharedFile): Promise<void>;
  /** Open the share-in screen. */
  open(params: Record<string, string>): void;
  toast(message: string, tone?: "error"): void;
  words: ShareWords;
}

export type ShareOutcome = "none" | "off" | "failed" | "opened";

export async function runShareIn(io: ShareIO): Promise<ShareOutcome> {
  const batch = io.consume();
  if (!batch || !batch.items?.length) return "none";
  const plan = planShare(batch);
  if (!io.enabled()) {
    await Promise.all(plan.files.map((f) => io.discard(f).catch(() => {})));
    io.toast(io.words.off);
    return "off";
  }
  const ids: string[] = [];
  const errors: string[] = [];
  if (plan.files.length) io.toast(io.words.adding);
  // One at a time: a phone on a slow network sends one file well rather than five badly.
  for (const f of plan.files) {
    try {
      const r = await io.upload(f);
      if ("id" in r && r.id) ids.push(r.id);
      else errors.push("error" in r ? r.error : "");
    } catch {
      errors.push("");
    } finally {
      await io.discard(f).catch(() => {});
    }
  }
  if (!ids.length && !plan.text && !plan.url) {
    io.toast(errors.find(Boolean) || io.words.failed, "error");
    return "failed";
  }
  if (errors.length || plan.skipped) io.toast(errors.find(Boolean) || io.words.partly, "error");
  io.open(shareParams(plan, ids));
  return "opened";
}
