/**
 * Blur — the screen behind an overlay, blurred, under a light white veil (BotCard's overlay, a BotStage's open thought).
 * A real blur: expo-blur on a phone (Android's with the method that draws one), the browser's backdrop-filter on the web
 * (react-native-web, the render check). It fills its parent; fade it in and out with the parent's opacity.
 */
import React, { useEffect, useRef } from "react";
import { Platform, View } from "react-native";

const WEB = Platform.OS === "web";

export function Blur(): React.ReactElement {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!WEB) return;
    // react-native-web: the view is a div; the blur is the browser's.
    const el = ref.current as unknown as { style?: Record<string, string> } | null;
    if (el?.style) {
      el.style.backdropFilter = "blur(10px) saturate(1.05)";
      el.style.webkitBackdropFilter = "blur(10px) saturate(1.05)";
    }
  }, []);
  if (WEB) return <View ref={ref} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.42)" }} />;
  // Required here, not at the top: the web bundle never touches the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BlurView } = require("expo-blur") as typeof import("expo-blur");
  return (
    <View style={{ flex: 1 }}>
      <BlurView
        intensity={30}
        tint="light"
        // Android draws a real blur only with this method; without it, a translucent fill.
        experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.35)" }} />
    </View>
  );
}
