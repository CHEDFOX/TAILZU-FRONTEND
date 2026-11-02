import { Platform, StyleSheet, type StyleProp, type TextStyle } from "react-native";

/**
 * iOS clips the last letter of text drawn tighter than the font (letterSpacing below 0): the box is measured a little
 * short of the ink. Room for it on the right, taken back by the margin, so the text sits exactly where it did.
 * Nothing on other platforms, for letterSpacing at or above 0, or where the style already sets the right padding or margin.
 */
export function tightRoom(style: StyleProp<TextStyle>): TextStyle | null {
  if (Platform.OS !== "ios") return null;
  const s = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  if (!(Number(s.letterSpacing) < 0)) return null;
  if (s.paddingRight != null || s.paddingHorizontal != null || s.padding != null || s.marginRight != null || s.marginHorizontal != null || s.margin != null) return null;
  const pad = Math.ceil((Number(s.fontSize) || 16) * 0.14);
  return { paddingRight: pad, marginRight: -pad };
}
