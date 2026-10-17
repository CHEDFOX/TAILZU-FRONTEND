import { registerRootComponent } from "expo";

import App from "./App";

// HOLD THE SPLASH until the app has something to show.
//
// Nothing was holding it. expo-splash-screen hides on its own the moment the
// root view mounts — which is long before the first screen has been fetched
// and drawn — so a launch went: splash, then half a second of black, then the
// opening media. Measured at 0.55s on an iPhone 13 mini, mean luma 0.4.
//
// preventAutoHideAsync is a promise this file cannot await, and a rejection
// here would take the app down before it starts, so it is fire-and-forget with
// a catch: the worst case is the old behaviour. SduiApp calls hideAsync once
// the first screen has painted.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SplashScreen = require("expo-splash-screen");
  SplashScreen.preventAutoHideAsync?.()?.catch?.(() => {});
} catch { /* absent in a runtime without the module — nothing to hold */ }

// Registers App as the root component for both Expo Go and native builds.
registerRootComponent(App);
