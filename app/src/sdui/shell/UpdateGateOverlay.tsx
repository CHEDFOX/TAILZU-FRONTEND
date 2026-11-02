import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { typeRole } from "../theme/typeRole";
import type { ThemeTokens, UpdateGate } from "../types";
import { txt, num, color } from "../knobs";
import { isOpenableUrl } from "../../security";

/** Backend-driven update screen: a hard blocker (forced) or a dismissible nudge. */
export function UpdateGateOverlay({
  info,
  forced,
  theme,
  labels,
  onDismiss,
}: {
  info: UpdateGate;
  forced: boolean;
  theme: ThemeTokens;
  labels: Record<string, string>;
  onDismiss: () => void;
}) {
  const storeUrl = info.url?.[Platform.OS === "ios" ? "ios" : "android"] ?? info.url?.default;
  return (
    <View style={[StyleSheet.absoluteFill, {
      backgroundColor: theme.color.updateOverlay ?? color("app.color.updateOverlay", "rgba(8,8,12,0.96)"),
      alignItems: "center", justifyContent: "center", padding: 28,
    }]}>
      <Text style={typeRole(theme, "updateTitle", { color: theme.color.text, fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 10 })}>
        {info.title ?? txt("updateGate.title", "Update available")}
      </Text>
      <Text style={typeRole(theme, "updateBody", { color: theme.color.muted, fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 22 })}>
        {info.message ?? txt("updateGate.message", "A new version is available.")}
      </Text>
      <Pressable
        onPress={() => { if (isOpenableUrl(storeUrl)) Linking.openURL(storeUrl).catch(() => {}); }}
        accessibilityRole="button"
        style={{ backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingVertical: 14, paddingHorizontal: 28, minWidth: num("app.updateGate.buttonMinWidth", 200), alignItems: "center" }}
      >
        <Text style={[typeRole(theme, "updateAction", { fontWeight: "700", fontSize: 15 }), { color: theme.color.primaryText ?? color("app.color.primaryText", "#FFFFFF") }]}>
          {info.cta ?? txt("updateGate.cta", "Update now")}
        </Text>
      </Pressable>
      {!forced && (
        <Pressable onPress={onDismiss} style={{ marginTop: 14 }}>
          <Text style={typeRole(theme, "updateLater", { color: theme.color.muted })}>
            {txt("updateGate.dismiss", "Not now")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
