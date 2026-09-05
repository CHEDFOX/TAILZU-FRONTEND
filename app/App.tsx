/**
 * Tulmi — app entry.
 *
 * The app is a GENERIC, server-driven renderer: it boots from the backend and
 * draws whatever screens/navigation/styling the server sends (see src/sdui).
 * There are no hardcoded screens here anymore — change the server, change the
 * app. The native keyboard lives separately (modules/tulmi-keyboard, targets/).
 *
 * WHY THE ROOT LOADS ITS OWN TREE WITH require()
 *
 * An ErrorBoundary can only catch what happens while RENDERING its children.
 * It cannot catch a throw that happens while a module is being evaluated —
 * a bad import, a native module missing from the binary, a side effect at file
 * scope. Those unwind before React has anything to render, and the result is a
 * black screen with nothing reported anywhere.
 *
 * That is exactly the state this app was in, and it cost hours of guessing.
 *
 * Static imports are evaluated when this file loads, so wrapping them proves
 * nothing. A require() INSIDE the component body is evaluated on first render
 * instead — inside the try below — which turns an invisible module-load crash
 * into a message on screen naming the file and the error.
 */
import React from "react";
import { ScrollView, Text, View } from "react-native";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Updates: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Updates = require("expo-updates");
} catch { /* absent in some runtimes — Reset then just retries */ }

/** Last-resort screen. Deliberately depends on nothing but react-native. */
function BootFailure({ error }: { error: unknown }) {
  const e = error as { message?: string; stack?: string };
  return (
    <View style={{ flex: 1, backgroundColor: "#0e0e12", paddingTop: 90, paddingHorizontal: 24 }}>
      <Text style={{ color: "#E8A23C", fontSize: 19, fontWeight: "700", marginBottom: 10 }}>
        Tailzu couldn&apos;t start
      </Text>
      <Text style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 20, marginBottom: 18 }}>
        Something failed before the app could draw anything. The detail below says what.
      </Text>
      <ScrollView style={{ flex: 1 }}>
        <Text selectable style={{ color: "#fff", fontSize: 12.5, lineHeight: 19, marginBottom: 14 }}>
          {String(e?.message ?? error ?? "unknown")}
        </Text>
        <Text selectable style={{ color: "rgba(255,255,255,0.4)", fontSize: 10.5, lineHeight: 16 }}>
          {String(e?.stack ?? "").split("\n").slice(0, 14).join("\n")}
        </Text>
      </ScrollView>
    </View>
  );
}

export default function App() {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { SafeAreaProvider } = require("react-native-safe-area-context");
    const SduiApp = require("./src/sdui/SduiApp").default;
    const { ErrorBoundary } = require("./src/sdui/ErrorBoundary");
    /* eslint-enable @typescript-eslint/no-require-imports */
    return (
      // SafeAreaProvider is REQUIRED, not decorative: useSafeAreaInsets() throws
      // without it, and the tab bar calls it on every render. It wraps the
      // ErrorBoundary rather than sitting inside it so the recovery UI is
      // inset-aware too.
      <SafeAreaProvider>
        <ErrorBoundary onReset={() => { Updates?.reloadAsync?.().catch(() => {}); }}>
          <SduiApp />
        </ErrorBoundary>
      </SafeAreaProvider>
    );
  } catch (err) {
    return <BootFailure error={err} />;
  }
}
