/**
 * Tulmi — app entry.
 *
 * The app is a GENERIC, server-driven renderer: it boots from the backend and
 * draws whatever screens/navigation/styling the server sends (see src/sdui).
 * There are no hardcoded screens here anymore — change the server, change the
 * app. The native keyboard lives separately (modules/tulmi-keyboard, targets/).
 *
 * The whole tree is wrapped in an ErrorBoundary so a single unexpected throw in
 * any backend-driven node can't leave the user on a blank screen — they get a
 * recover-in-place UI, and "Reset" reloads the JS bundle for a clean reboot.
 */
import { SafeAreaProvider } from "react-native-safe-area-context";
import SduiApp from "./src/sdui/SduiApp";
import { ErrorBoundary } from "./src/sdui/ErrorBoundary";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Updates: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Updates = require("expo-updates");
} catch { /* absent in some runtimes — Reset then just retries */ }

export default function App() {
  return (
    // SafeAreaProvider is REQUIRED, not decorative: useSafeAreaInsets() throws
    // without it, and the tab bar calls it on every render — so its absence is
    // a crash on every screen, not a layout nicety. It wraps the ErrorBoundary
    // rather than sitting inside it so the recovery UI is inset-aware too.
    <SafeAreaProvider>
      <ErrorBoundary onReset={() => { Updates?.reloadAsync?.().catch(() => {}); }}>
        <SduiApp />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
