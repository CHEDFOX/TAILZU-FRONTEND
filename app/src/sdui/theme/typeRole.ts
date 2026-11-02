/**
 * The backend's type scale as React Native text styles: a role's family slot resolved to a face, then the role.
 */
import { Platform, type TextStyle } from "react-native";
import type { ThemeTokens } from "../types";
import * as K from "../knobs";

/**
 * The platform serif — what the "display" slot draws in until the backend
 * names a face (theme.font.display, or theme.font.family for the whole app).
 * The two faces are knobs too, for a server that wants a different fallback
 * without naming one in the theme.
 */
const serif = () => Platform.select({
  ios: K.str("ui.font.serifIos", "Georgia"),
  android: K.str("ui.font.serifAndroid", "serif"),
  default: K.str("ui.font.serifAndroid", "serif"),
});

/**
 * Resolve a role's family SLOT to a face. "body" is the running face, which
 * is the system font until the theme names one; "display" is the heading
 * face, which is `display`, else `family`, else the platform serif. Anything
 * else is taken as a face name.
 */
export function fontSlot(theme: ThemeTokens, slot: string | undefined): string | undefined {
  if (!slot || slot === "body") return theme.font?.family;
  if (slot === "display") return theme.font?.display ?? theme.font?.family ?? serif();
  return slot;
}

/**
 * A role from the backend's type scale, as a React Native text style.
 *
 * The backend writes the scale; this only translates it. The one thing the
 * device adds is the resolution of slots and colour keys, which cannot be
 * done anywhere else. `fallback` is the renderer's own copy of the role, used
 * only when the theme does not carry it — a bootstrap cached before the scale
 * existed — so nothing goes unsized.
 */
export function typeRole(theme: ThemeTokens, role: string, fallback?: TextStyle): TextStyle {
  const r = theme.font?.roles?.[role];
  if (!r) return fallback ?? {};
  const out: TextStyle = { fontSize: r.size };
  const fam = fontSlot(theme, r.family);
  if (fam) out.fontFamily = fam;
  if (r.weight) out.fontWeight = r.weight as TextStyle["fontWeight"];
  if (r.lineHeight != null) out.lineHeight = r.lineHeight;
  if (r.letterSpacing != null) out.letterSpacing = r.letterSpacing;
  if (r.italic) out.fontStyle = "italic";
  if (r.transform) out.textTransform = r.transform;
  if (r.align) out.textAlign = r.align;
  if (r.color) out.color = theme.color[r.color] ?? r.color;
  if (r.marginTop != null) out.marginTop = r.marginTop;
  if (r.marginBottom != null) out.marginBottom = r.marginBottom;
  if (r.marginVertical != null) out.marginVertical = r.marginVertical;
  return out;
}
