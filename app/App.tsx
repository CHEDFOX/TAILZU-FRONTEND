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

/**
 * The knobs, if they will load — and a stand-in that answers every call with
 * its fallback if they will not.
 *
 * The boot-failure card below is what shows when a MODULE failed to load, and
 * the knobs module is a module. It has no imports of its own, so it all but
 * cannot fail, but "all but" is not good enough for the last screen there is.
 */
type KnobFns = {
  txt: (k: string, f: string) => string;
  num: (k: string, f: number) => number;
  bool: (k: string, f: boolean) => boolean;
  color: (k: string, f: string) => string;
};
function knobFns(): KnobFns {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("./src/sdui/knobs") as KnobFns;
  } catch {
    return { txt: (_k, f) => f, num: (_k, f) => f, bool: (_k, f) => f, color: (_k, f) => f };
  }
}

/**
 * POINT THE KNOBS AT THE LAST SERVER'S VALUES BEFORE ANYTHING ELSE LOADS.
 *
 * Everything the app would otherwise decide for itself is a knob, but a knob
 * can only read a bootstrap that is in hand, and the first of a launch lands
 * seconds after the modules below have been evaluated — so module-scope sizes,
 * the sign-in screen's words and this file's own failure card could only ever
 * use the compiled-in fallbacks. The last bootstrap's labels + flags are kept
 * in a synchronous store (storage.readKnobSnapshotSync); reading it here, once,
 * before the app's modules are required, lets every one of those follow the
 * server too. Absent, unreadable or not in this binary: the fallbacks stand.
 */
let primed = false;
function primeKnobs(): void {
  if (primed) return;
  primed = true;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const snap = require("./src/storage").readKnobSnapshotSync();
    if (snap) {
      require("./src/sdui/knobs").setKnobs(snap);
      require("./src/sdui/client").markKnobsPrimed();
    }
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch { /* the fallbacks stand */ }
}

/**
 * Blip's overlay, or nothing.
 *
 * Loaded on its own, apart from the app's modules above, so that if it cannot
 * load (a Skia that is not in this binary, a drawing module that throws as it
 * is evaluated) the cost is Blip and only Blip. The sign-in and the rest of the
 * app never depend on it.
 */
function loadBlipHost(): React.ComponentType | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("./src/onboard/BlipHost").default as React.ComponentType;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu] Blip could not load:", e);
    return null;
  }
}

/**
 * THE VERY FIRST LAUNCH WAITS A MOMENT FOR THE NEWEST UPDATE.
 *
 * expo-updates fetches an update in the background and applies it on the NEXT
 * launch, so a fresh download used to run the store's own JavaScript through
 * the whole onboarding. On an install's first launch only, it now asks for an
 * update and, when one is there and lands within a few seconds, restarts into
 * it before anything is drawn. The mark is written before the wait, so a
 * restart (or a crash) never waits again; every later launch is as before.
 */
let bootKv: any = null;
function firstLaunch(): boolean {
  try {
    if (!Updates?.isEnabled || (globalThis as { __DEV__?: boolean }).__DEV__) return false;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMMKV } = require("react-native-mmkv");
    bootKv = bootKv ?? createMMKV({ id: "tailzu.boot" });
    if (bootKv.getBoolean("launched")) return false;
    bootKv.set("launched", true);
    // An install that has ever reached the server keeps its last bootstrap
    // (storage.readKnobSnapshotSync): it is not new, and never waits.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return !require("./src/storage").readKnobSnapshotSync();
  } catch { return false; }
}
function useFirstLaunchUpdate(): boolean {
  const [ready, setReady] = React.useState(() => !firstLaunch());
  React.useEffect(() => {
    if (ready) return;
    const ms = knobFns().num("boot.firstLaunchUpdateMs", 6000);
    let done = false;
    const go = () => { if (!done) { done = true; setReady(true); } };
    const timer = setTimeout(go, ms);
    (async () => {
      try {
        const res = await Updates.checkForUpdateAsync();
        if (done || !res?.isAvailable) return go();
        await Updates.fetchUpdateAsync();
        if (done) return;            // too slow: it applies on the next launch, as before
        done = true;
        await Updates.reloadAsync(); // straight into the newest code
      } catch { go(); }
    })();
    return () => clearTimeout(timer);
  }, [ready]);
  return ready;
}

/** Last-resort screen. Depends on nothing but react-native (knobs optional). */
function BootFailure({ error }: { error: unknown }) {
  const e = error as { message?: string; stack?: string };
  const { txt, num, bool, color } = knobFns();
  return (
    <View style={{ flex: 1, backgroundColor: color("boot.failure.bg", "#0e0e12"), paddingTop: num("boot.failure.paddingTop", 90), paddingHorizontal: 24 }}>
      <Text style={{ color: color("boot.failure.titleColor", "#F3E2C6"), fontSize: num("boot.failure.titleSize", 19), fontWeight: "700", marginBottom: 10 }}>
        {txt("boot.failure.title", "X0 Bot couldn't start")}
      </Text>
      <Text style={{ color: color("boot.failure.bodyColor", "rgba(255,255,255,0.62)"), fontSize: num("boot.failure.bodySize", 14), lineHeight: 20, marginBottom: 18 }}>
        {txt("boot.failure.body", "Something failed before the app could draw anything. The detail below says what.")}
      </Text>
      {bool("boot.failure.showDetails", true) && (
        <ScrollView style={{ flex: 1 }}>
          <Text selectable style={{ color: color("boot.failure.detailColor", "#FFFFFF"), fontSize: num("boot.failure.detailSize", 12.5), lineHeight: 19, marginBottom: 14 }}>
            {String(e?.message ?? error ?? "unknown")}
          </Text>
          <Text selectable style={{ color: color("boot.failure.stackColor", "rgba(255,255,255,0.4)"), fontSize: num("boot.failure.stackSize", 10.5), lineHeight: 16 }}>
            {String(e?.stack ?? "").split("\n").slice(0, num("boot.failure.stackLines", 14)).join("\n")}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

export default function App() {
  const ready = useFirstLaunchUpdate();
  if (!ready) return <View style={{ flex: 1, backgroundColor: knobFns().color("boot.waitBg", "#0B0B0D") }} />;
  try {
    // Before the app's own modules: their module-scope values read knobs too.
    primeKnobs();
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { SafeAreaProvider } = require("react-native-safe-area-context");
    const SduiApp = require("./src/sdui/SduiApp").default;
    const { ErrorBoundary } = require("./src/sdui/ErrorBoundary");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const BlipHost = loadBlipHost();
    return (
      // SafeAreaProvider is REQUIRED, not decorative: useSafeAreaInsets() throws
      // without it, and the tab bar calls it on every render. It wraps the
      // ErrorBoundary rather than sitting inside it so the recovery UI is
      // inset-aware too.
      <SafeAreaProvider>
        <ErrorBoundary
          onReset={() => { Updates?.reloadAsync?.().catch(() => {}); }}
          // The error card must never sit under Blip's paper.
          onError={() => { try { require("./src/onboard/stageBus").abandon(); } catch { /* no overlay, nothing to let go */ } }}
        >
          <SduiApp />
        </ErrorBoundary>
        {/* Blip, the onboarding's one character, drawn above whatever is
            showing and mounted once for the life of the app, so he is never
            rebuilt when a screen or the sign-in gate is. It draws nothing at
            all outside onboarding, and takes no touches. */}
        {BlipHost ? <BlipHost /> : null}
      </SafeAreaProvider>
    );
  } catch (err) {
    return <BootFailure error={err} />;
  }
}
