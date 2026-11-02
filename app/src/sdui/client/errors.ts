/** Failures as the person holding the phone should read them, and as the log should. */
import { txt } from "../knobs";

/**
 * The free plan's word cap, refused by the server.
 *
 * Its own class because it is the one failure that is not a failure: nothing is
 * broken, the user has simply used what the free plan includes. Retrying it
 * cannot help and an error toast is the wrong answer — the right one is the
 * paywall, which is what the action runner does when it sees this.
 */
export class QuotaExceededError extends Error {
  constructor(message = "quota_exceeded") {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/**
 * A REFUSED REQUEST, WORDED FOR THE PERSON HOLDING THE PHONE.
 *
 * The message used to be "/v1/app/screen → 500", and several screens show a
 * thrown error's message as it stands — so that is what users read. The
 * message is now the server's words for what happened (labels error.*), and
 * the raw path + status travel in `detail`, which is what goes to the log.
 */
export class HttpError extends Error {
  constructor(public readonly status: number, public readonly detail: string) {
    super(httpErrorText(status));
    this.name = "HttpError";
  }
}

/** What to tell a person about a refused request, by status. */
export function httpErrorText(status: number): string {
  if (status === 401 || status === 403) {
    return txt("error.unauthorized", "Your session has expired. Sign in again to continue.");
  }
  if (status === 404) return txt("error.notFound", "That isn't available right now.");
  if (status === 429) return txt("error.rateLimited", "Too many requests. Wait a moment, then try again.");
  if (status >= 500) return txt("error.server", "Something went wrong on our side. Try again in a moment.");
  return txt("error.generic", "Something went wrong. Try again.");
}

/**
 * Any failure, as something a person can read. Raw detail never reaches the
 * screen from here; callers log it themselves (see errorDetail).
 *
 * `fallback` is the caller's own sentence for a failure this cannot name — a
 * native module's, the OS's, a bug's. A mic control says "Couldn't start the
 * microphone" there rather than the generic line, and never the error's own
 * message ("Mic start: Error Domain=NSOSStatusErrorDomain …").
 */
export function userErrorMessage(err: unknown, fallback?: string): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof QuotaExceededError) {
    return txt("error.quota", "You've used this month's free words.");
  }
  // fetch rejects with a TypeError when there is no connection at all.
  if (err instanceof TypeError) {
    return txt("error.network", "Couldn't reach X0 Bot. Check your connection and try again.");
  }
  return fallback ?? txt("error.generic", "Something went wrong. Try again.");
}

/**
 * A live stream's failure (modules/tulmi-stream), as something a person can
 * read. `message` is the server's sentence when it sent one; the rest are
 * named by code, and anything else gets the caller's `other`.
 */
export function streamErrorMessage(
  message: string,
  code: string | undefined,
  words: { permission: string; other: string },
): string {
  if (code === "permission") return words.permission;
  // The server keeps its sign-in refusal in the keyboards' old wording, which
  // is not for people, so this one is always said here.
  if (code === "unauthorized") return httpErrorText(401);
  if (message) return message;
  if (code === "network") {
    return txt("error.network", "Couldn't reach X0 Bot. Check your connection and try again.");
  }
  return words.other;
}

/** The raw detail of a failure, for logs only. */
export function errorDetail(err: unknown): string {
  if (err instanceof HttpError) return err.detail;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
