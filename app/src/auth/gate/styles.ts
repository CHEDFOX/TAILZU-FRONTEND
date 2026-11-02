/** The gate's styles. */
import { StyleSheet } from "react-native";
import { color, num } from "../../sdui/knobs";
import { SH, PILL_W, PILL_H, PILL_PAD, BADGE, SOCIAL_SIZE, SOCIAL_GAP, WHITE, ACCENT_DIM, VOID, ABYSS, FILL } from "./look";

export const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: VOID },
  kav: { flex: 1 },
  backTopLeft: { position: "absolute", top: 56, left: 18, width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 10 },
  // BOTTOM-ALIGNED, so background art keeps the top two thirds. This used to
  // centre the whole block, which put the pills over the middle of the picture
  // and left the composition with nowhere to breathe. Matches what the
  // server-composed screen does, so the two paths look alike and it stops
  // mattering which one is drawing.
  stack: { flex: 1, alignItems: "center", justifyContent: "flex-end", paddingBottom: 42, paddingHorizontal: 28 },
  // box-none on the stack too, so the air between rows reaches the dismiss
  // layer rather than stopping at a container nobody can see.
  block: { alignItems: "center", width: "100%" },
  brandWrap: { alignItems: "center", marginBottom: 34 },
  brand: { fontSize: 40, fontWeight: "700", color: WHITE, letterSpacing: -0.5 },
  tag: { marginTop: 6, fontSize: 16, fontWeight: "300", color: "rgba(255,255,255,0.72)", letterSpacing: 0.2 },

  pillWrap: { width: PILL_W, height: PILL_H, borderRadius: PILL_H / 2, justifyContent: "center" },
  pill: { ...FILL, borderRadius: PILL_H / 2, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.06)" },
  // Android has no blur behind it — needs a stronger fill to stay visible.
  pillAndroid: { backgroundColor: "rgba(255,255,255,0.12)" },
  pillBorder: { ...FILL, borderRadius: PILL_H / 2, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.14)" },
  contentRow: { position: "absolute", left: PILL_PAD + BADGE + 10, right: PILL_PAD + BADGE + 10, top: 0, bottom: 0, flexDirection: "row", alignItems: "center" },
  flag: { fontSize: 18, marginRight: 5 },
  pickRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 4 },
  pickText: { fontSize: 15, fontWeight: "300", color: "rgba(255,255,255,0.32)", letterSpacing: 0.3 },
  badgeFlag: { fontSize: 20, lineHeight: 24 },
  dial: { fontSize: 15, fontWeight: "300", color: WHITE, marginRight: 4 },
  input: { flex: 1, fontSize: 15, fontWeight: "300", color: WHITE, letterSpacing: 0.3, padding: 0 },

  envWrap: { position: "absolute", left: PILL_PAD, top: PILL_PAD, width: BADGE, height: BADGE, zIndex: 5 },
  envCircle: { width: BADGE, height: BADGE, borderRadius: BADGE / 2, backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  arrowWrap: { position: "absolute", right: PILL_PAD, top: PILL_PAD, width: BADGE, height: BADGE },
  // Solid pale ink, not a translucent white. It is the one thing on the
  // screen that means "go", and a tint made it another faint circle beside a
  // faint badge. Not amber: signing in is not something live.
  arrowCircle: { width: BADGE, height: BADGE, borderRadius: BADGE / 2, backgroundColor: ACCENT_DIM, alignItems: "center", justifyContent: "center" },

  // 48/48 was proportioned against a heading that no longer exists. Bottom
  // aligned and titleless, that much air stranded the socials at the foot of
  // the screen away from everything else.
  divider: { width: PILL_W * 0.66, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.15)", marginTop: 26, marginBottom: 24 },

  socialRow: { flexDirection: "row", gap: SOCIAL_GAP },
  social: { width: SOCIAL_SIZE, height: SOCIAL_SIZE, borderRadius: SOCIAL_SIZE / 2, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center", justifyContent: "center" },
  verifyActions: { flexDirection: "row", gap: SOCIAL_GAP },

  codeRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: num("auth.code.gap", 10) },
  codeBox: { width: num("auth.code.boxSize", 38), height: num("auth.code.boxSize", 38), borderRadius: num("auth.code.boxSize", 38) / 2, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", backgroundColor: "rgba(255,255,255,0.02)", alignItems: "center", justifyContent: "center" },
  codeBoxFilled: { borderColor: "rgba(255,255,255,0.85)", backgroundColor: "rgba(255,255,255,0.05)" },
  codeBoxError: { borderColor: color("auth.code.errorColor", "rgba(255,90,60,0.85)") },
  codeDigit: { fontSize: 17, fontWeight: "300", color: WHITE },
  hiddenInput: { position: "absolute", opacity: 0, width: 1, height: 1 },
  verifyStatus: { height: 28, marginTop: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  /** Quiet, not alarming: the user may still have a working code in hand. */
  sendFailed: { fontSize: 12, color: "rgba(255,255,255,0.5)", textAlign: "center" },
  socialBusy: { opacity: 0.4 },

  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...FILL, backgroundColor: "rgba(0,0,0,0.55)" },
  modalSheet: { height: SH * num("auth.country.sheetHeight", 0.72), backgroundColor: ABYSS, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 18 },
  modalHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", marginBottom: 12 },
  modalSearch: { height: 44, borderRadius: 12, paddingHorizontal: 12, backgroundColor: "rgba(255,255,255,0.06)", color: WHITE, fontSize: 15, marginBottom: 8 },
  cRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.06)" },
  cFlag: { fontSize: 22, marginRight: 12 },
  cName: { flex: 1, fontSize: 15, fontWeight: "300", color: WHITE },
  cDial: { fontSize: 14, color: "rgba(255,255,255,0.5)" },
});
