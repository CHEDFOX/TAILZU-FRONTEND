/** The toast: one line over the bottom of the screen, coloured by its tone. */
import { Text, View } from "react-native";
import { typeRole } from "../theme/typeRole";
import type { ThemeTokens } from "../types";
import { num, color } from "../knobs";
import type { Toast } from "./types";
import { styles } from "./styles";

export function ToastView({ toast, theme }: { toast: Toast; theme: ThemeTokens }) {
  return (
    <View style={[styles.toast, {
      bottom: num("app.toast.bottom", 76),
      borderRadius: num("app.toast.radius", 10),
      backgroundColor:
        toast.tone === "error"   ? (theme.color.toastError   ?? color("app.color.toastError", "#3a1417"))
      : toast.tone === "success" ? (theme.color.toastSuccess ?? color("app.color.toastSuccess", "#13301a"))
      :                            (theme.color.toastInfo    ?? color("app.color.toastInfo", "#1c1c25")),
    }]} accessibilityLiveRegion="polite">
      <Text style={[typeRole(theme, "toast"), { color: theme.color.toastText ?? color("app.color.toastText", "#FFFFFF") }]}>{toast.message}</Text>
    </View>
  );
}
