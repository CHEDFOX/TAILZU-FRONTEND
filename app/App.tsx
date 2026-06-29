/**
 * Tulmi — app entry.
 *
 * The app is a GENERIC, server-driven renderer: it boots from the backend and
 * draws whatever screens/navigation/styling the server sends (see src/sdui).
 * There are no hardcoded screens here anymore — change the server, change the
 * app. The native keyboard lives separately (modules/tulmi-keyboard, targets/).
 *
 * GestureHandlerRootView wraps everything so the app's gesture capabilities
 * (e.g. backend-driven edge-swipe-back — see src/sdui/gestures) work anywhere.
 */
import { GestureHandlerRootView } from "react-native-gesture-handler";
import SduiApp from "./src/sdui/SduiApp";

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SduiApp />
    </GestureHandlerRootView>
  );
}
