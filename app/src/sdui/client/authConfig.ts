import type { BootstrapResponse } from "../types";
import { setKnobs, num, bool, str, obj, color } from "../knobs";
import { loadRemoteFonts } from "../theme/remoteFonts";
import { bootstrap } from "./bootstrap";

/**
 * Pre-session auth config, read from the public SDUI bootstrap `flags`. Lets the
 * backend turn auth methods on/off without an app update — e.g. flip phone
 * sign-in on once an SMS provider is live. Resilient: returns null on any
 * failure so the gate falls back to its safe local defaults (never bricks).
 *
 *   flags["auth.enablePhone"] → boolean   (default off)
 */
/** The sign-in backdrop, served in the boot flags. See catalog.ts. */
export type AuthBackground = {
  url: string;
  contentType?: string;
  /** Painted behind the media, so a video's first frame is not a black flash. */
  background: string;
  fit: "cover" | "contain";
};

function readGoogleWeb(v: unknown): { callback: string; resume: string } | null {
  if (!v || typeof v !== "object") return null;
  const callback = String((v as any).callback ?? "");
  const resume = String((v as any).resume ?? "");
  if (!/^https:\/\//.test(callback) || !/^tulmi:\/\//.test(resume)) return null;
  return { callback, resume };
}

export async function fetchAuthConfig(): Promise<
  {
    enablePhone: boolean;
    reviewEmail: string;
    /**
     * Google on Android by way of Supabase's OAuth page. `callback` is the
     * backend page Supabase lands on; `resume` is the app scheme that page
     * hands the session to. Null when the backend has not switched it on,
     * and the native Google client is used instead.
     */
    googleWeb: { callback: string; resume: string } | null;
    background: AuthBackground | null;
    /** The code step's own backdrop, when one was uploaded. */
    backgroundCode: AuthBackground | null;
    /** The server-composed sign-in screen, and whether to draw it. */
    sdui: boolean;
    screen: unknown | null;
    scrim: number;
    suction: unknown | null;
    /** The theme, needed to draw the server tree at all. See AuthGateScreen. */
    theme: BootstrapResponse["theme"] | null;
    /** The bootstrap's flags and labels, for the server tree's ctx. */
    flags: Record<string, unknown>;
    labels: Record<string, string>;
  } | null
> {
  try {
    const b = await bootstrap();
    const f = b.flags ?? {};
    // Every knob below reads THIS bootstrap. The sign-in screen has no other:
    // SduiApp has not committed one yet, so without this the auth screen's
    // words, sizes and switches would all be the compiled-in fallbacks.
    setKnobs(b);
    // The faces the sign-in screen is set in. This runs before SduiApp has
    // committed a bootstrap (that is what registers fonts for the rest of the
    // app), so without this the first screen a new person sees would be drawn
    // in the system font. It never blocks: the gate decides how long to wait.
    loadRemoteFonts((b as unknown as { fonts?: Record<string, unknown> }).fonts);
    return {
      enablePhone: bool("auth.enablePhone", false) || f["auth.enablePhone"] === "true",
      // The one address that takes a password instead of a code. Empty
      // whenever the backend is not in a submission window, and an empty
      // string can never equal a typed address, so the path simply is not
      // there the rest of the time.
      reviewEmail: str("auth.reviewEmail", "").trim().toLowerCase(),
      // Both halves or neither. The page has to be https and the resume has
      // to be a scheme this build claims — anything else would send the user
      // somewhere the app cannot come back from, which is the bug this exists
      // to fix.
      googleWeb: readGoogleWeb(obj("auth.googleWeb", {})),
      // Absent whenever nothing has been uploaded to `hero.auth`, and the
      // screen is designed to read on plain black in exactly that case — an
      // empty slot must never cost anyone a broken first screen.
      background: readBackground(obj("auth.background", {})),
      backgroundCode: readBackground(obj("auth.background.code", {})),
      // Both halves must be present. A flag saying yes with no tree behind it
      // would draw an empty sign-in screen, which is worse than the native one
      // in every way — so the absence of either falls back.
      // The tree itself is content, not a knob: absent means "no server
      // screen", and nothing may stand in for it.
      sdui: bool("auth.sdui", false) && !!f["auth.screen"],
      screen: f["auth.screen"] ?? null,
      scrim: Math.max(0, Math.min(1, num("auth.scrim", 0.42))),
      suction: obj("auth.suction", { staggerMs: 95, durationMs: 780, fromY: 120 }),
      theme: b.theme ?? null,
      flags: f as Record<string, unknown>,
      labels: b.labels ?? {},
    };
  } catch {
    return null;
  }
}

/**
 * Validate the backdrop the server sent. Anything malformed resolves to null
 * rather than throwing: this runs on the sign-in screen, where a thrown error
 * is a user who cannot get into the app at all.
 */
function readBackground(raw: unknown): AuthBackground | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url : "";
  // https only. This URL is rendered before there is a session, so it is the
  // one piece of server-controlled content the gate trusts.
  if (!/^https:\/\//i.test(url)) return null;
  const fit = o.fit === "contain" ? "contain" : "cover";
  return {
    url,
    contentType: typeof o.contentType === "string" ? o.contentType : undefined,
    background: typeof o.background === "string" ? o.background : color("auth.background.ground", "#000000"),
    fit,
  };
}
