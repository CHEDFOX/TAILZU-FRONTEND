/**
 * What a person sees when the app cannot reach the server and has nothing
 * cached to show: a calm card that says so and keeps trying by itself.
 *
 * It replaced the developer's connection screen ("Backend URL… Emulator →
 * your PC = http://10.0.2.2:8770"), which is where a first launch without a
 * signal used to land. That screen is still here for development, behind a
 * long press on the title, and only where the server's
 * app.offline.devConnection flag (or a dev build) allows it.
 *
 * Every word, colour and timing is a knob, so the server decides them; the
 * values in this file are only for a phone that has never once reached it.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ThemeTokens } from "./types";
import { bool, color, num, txt } from "./knobs";

export default function OfflineScreen({ theme, onRetry, onDev }: {
  theme?: ThemeTokens | null;
  onRetry: () => void | Promise<void>;
  onDev?: () => void;
}) {
  const c = theme?.color ?? {};
  const bg = color("app.offline.bg", c.bg ?? "#000000");
  const ink = color("app.offline.text", c.text ?? "#FFFFFF");
  const mute = color("app.offline.muted", c.muted ?? "#8A857C");
  const accent = color("app.offline.accent", c.primary ?? "#E8A23C");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const attempts = useRef(0);

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    attempts.current += 1;
    try { await onRetry(); } finally { setBusy(false); }
  };

  // Keep trying: first after retryMs, then backing off to retryMaxMs.
  useEffect(() => {
    const base = num("app.offline.retryMs", 8000);
    const max = num("app.offline.retryMaxMs", 30000);
    const delay = Math.min(max, base * Math.pow(num("app.offline.retryFactor", 1.6), attempts.current));
    let left = Math.ceil(delay / 1000);
    setWait(left);
    const tick = setInterval(() => {
      left -= 1;
      setWait(Math.max(0, left));
      if (left <= 0) { clearInterval(tick); void retry(); }
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const devAllowed = bool("app.offline.devConnection", typeof __DEV__ !== "undefined" && __DEV__);

  return (
    <View style={{ flex: 1, backgroundColor: bg, alignItems: "center", justifyContent: "center",
      padding: num("app.offline.padding", 32) }}>
      <Pressable
        disabled={!devAllowed || !onDev}
        delayLongPress={num("app.offline.devHoldMs", 3000)}
        onLongPress={onDev}
        accessibilityRole="header"
      >
        <Text style={{ color: ink, fontSize: num("app.offline.titleSize", 22), fontWeight: "600",
          textAlign: "center", marginBottom: num("app.offline.titleGap", 10) }}>
          {txt("offline.title", "You're offline")}
        </Text>
      </Pressable>
      <Text style={{ color: mute, fontSize: num("app.offline.bodySize", 15), lineHeight: num("app.offline.bodyLineHeight", 22),
        textAlign: "center", maxWidth: num("app.offline.bodyMaxWidth", 320), marginBottom: num("app.offline.bodyGap", 28) }}>
        {txt("offline.body", "Tailzu can't reach its server right now. Check your connection. It will keep trying.")}
      </Text>
      <Pressable
        onPress={retry}
        disabled={busy}
        accessibilityRole="button"
        style={{ backgroundColor: accent, borderRadius: num("app.offline.buttonRadius", 22),
          paddingHorizontal: num("app.offline.buttonPadX", 28), paddingVertical: num("app.offline.buttonPadY", 12),
          minWidth: num("app.offline.buttonMinWidth", 160), alignItems: "center", opacity: busy ? num("app.offline.busyOpacity", 0.7) : 1 }}
      >
        {busy
          ? <ActivityIndicator color={color("app.offline.buttonText", "#000000")} />
          : <Text style={{ color: color("app.offline.buttonText", "#000000"), fontSize: num("app.offline.buttonTextSize", 16), fontWeight: "600" }}>
              {txt("offline.retry", "Try again")}
            </Text>}
      </Pressable>
      <Text style={{ color: mute, fontSize: num("app.offline.noteSize", 13), marginTop: num("app.offline.noteGap", 14), minHeight: 18 }}>
        {busy ? txt("offline.checking", "Checking…") : wait > 0 ? txt("offline.retryIn", "Trying again in {s}s", { s: wait }) : ""}
      </Text>
    </View>
  );
}
