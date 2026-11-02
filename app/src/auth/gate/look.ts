/** The sign-in gate's geometry, colours and type scale: server knobs read once, at module scope (after App.tsx primed them). */
import { Dimensions } from "react-native";
import { typeRole } from "../../sdui/theme/typeRole";
import type { ThemeTokens } from "../../sdui/types";
import { color, num, str } from "../../sdui/knobs";

export const { width: SW, height: SH } = Dimensions.get("window");
// THE GEOMETRY IS THE SERVER'S TOO. Module scope, because the StyleSheet and
// the pan responder below are built from it once — which is still after App.tsx
// has pointed the knobs at the last bootstrap on disk, so these follow the
// server from the launch after it changes them.
export const PILL_W = Math.min(num("auth.pill.maxWidth", 320), SW - num("auth.pill.sideInset", 56));
export const PILL_H = num("auth.pill.height", 56);
export const PILL_PAD = num("auth.pill.padding", 5);
export const BADGE = PILL_H - PILL_PAD * 2; // 46
export const SOCIAL_SIZE = num("auth.social.size", 52);
export const SOCIAL_GAP = num("auth.social.gap", 16);
export const SHAKE = num("auth.anim.shakeDistance", 8);
export const MAX_DRAG = PILL_W - PILL_PAD * 2 - BADGE;
export const DRAG_THRESHOLD = MAX_DRAG * num("auth.pill.commitFraction", 0.6);

/** What counts as an address worth sending a code to. A bad pattern from the
 *  server must never cost anyone the sign-in screen, so it falls back. */
export function emailRx(): RegExp {
  try {
    return new RegExp(str("auth.emailPattern", "^\\S+@\\S+\\.\\S+$"));
  } catch {
    return /^\S+@\S+\.\S+$/;
  }
}

export const WHITE = color("auth.color.ink", "#FFFFFF");
/**
 * The target circle, in pale ink.
 *
 * Not amber, not even a dimmed one: amber is reserved for what is live right
 * now (recording, listening), and signing in is not. Pale still says "go"
 * on the dark screen, and the black arrow keeps its contrast on it.
 */
export const ACCENT_DIM = color("auth.color.target", "#F3E2C6");
export const VOID = color("auth.color.bg", "#000000");
export const ABYSS = color("auth.color.sheet", "#050508");

// RN 0.85 removed StyleSheet.absoluteFillObject — spreading it yields {} and
// the pill layers collapse to a zero-height centered hairline. Spell it out.
export const FILL = { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 } as const;

/**
 * The type scale, for this screen's chrome.
 *
 * Held at module scope rather than passed down, because the type belongs to
 * rows nested several components deep (the pill's field, the code boxes, the
 * country sheet) and none of them has any other reason to know about a theme.
 * It is filled the moment the auth config lands — which is before any of
 * those rows can be reached — and until then each site draws its own copy.
 */
let scale: ThemeTokens | null = null;
/** The gate sets the scale as its auth config lands. */
export function setScale(next: ThemeTokens | null): void { scale = next; }
export const at = (role: string, fallback: any) => (scale ? typeRole(scale, role, fallback) : fallback);
