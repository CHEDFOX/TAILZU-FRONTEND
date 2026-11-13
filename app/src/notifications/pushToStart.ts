/**
 * PUSH-TO-START (native/SPEC.md section 1.3; iOS 17.2 and later): "Bots at work" can appear on the Lock Screen while the app is shut,
 * because the phone tells the server the token ActivityKit gave it for STARTING one. Behaviour, not looks.
 *
 * The native side (modules/tulmi-bridge/ios/BotsLiveActivity.swift) keeps watching for new activities and for the start token from an
 * app-delegate subscriber, so nothing here has to be running for an activity to adopt itself. What JavaScript does is the one thing
 * the extension cannot: tell the SERVER, with the session the app keeps. The token is also kept in the App Group by the native side,
 * and read here on every start, so a token that arrived before a listener was attached is never lost.
 *
 *   POST /v1/widgets/activity-start-token { token, nl, platform: "ios" }     the person's own token, with the catalog version this
 *                                                                           phone holds (`nl`): a push-started activity may name only
 *                                                                           a design the phone has already downloaded
 *   POST /v1/widgets/activity-start-token { token: null }                    sign-out, or the person turned it off: forget it
 *
 * Registered again whenever the token or `nl` changes. Every call is guarded by hasBinaryFeature("activityPushStart") (bridge.ts):
 * a binary built before this existed says nothing and is never asked. LAUNCH DARK: knob widgets.activity.pushStart defaults OFF on the phone,
 * and the server keeps nothing while its own switch (ACTIVITY_PUSH_START) is off (it answers push:false, and the phone saves the key
 * only on push:true).
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { callEndpoint } from "../sdui/client";
import { bool, str } from "../sdui/knobs";
import { hasBinaryFeature } from "../device/binary";
import { heldLooksVersion } from "../native/looks";
import { onPushToStartToken, pushToStartToken } from "../native/bridge";

const KEY = "x0.widgets.startToken";
/** When the server last said it would not keep a token (its switch is off): asked again after a day, not on every glance. */
const REFUSED_KEY = "x0.widgets.startToken.refused";
const RETRY_MS = 24 * 3600_000;
let watching = false;
let sending = false;

const HEX = /^[0-9a-f]{20,400}$/i;

/** Tell the server the start token, once per (token, nl). Never throws; tried again after the next glance. */
export async function registerPushToStart(token: string | null = pushToStartToken()): Promise<void> {
  if (Platform.OS !== "ios" || !token || !HEX.test(token) || !bool("widgets.activity.pushStart", false) || sending) return;
  sending = true;
  try {
    const nl = await heldLooksVersion();
    const key = `${token}:${nl}`;
    if ((await AsyncStorage.getItem(KEY).catch(() => null)) === key) return;
    const refused = await AsyncStorage.getItem(REFUSED_KEY).catch(() => null);
    // "<key>@<ms>": the same token and catalog are not offered again for RETRY_MS.
    if (refused && refused.startsWith(`${key}@`) && Date.now() - Number(refused.slice(key.length + 1)) < RETRY_MS) return;
    const res = await callEndpoint("POST", str("widgets.activity.startTokenPath", "/v1/widgets/activity-start-token"), {
      token: token.toLowerCase(), ...(nl > 0 ? { nl } : {}), platform: "ios",
    });
    // Saved only when the server kept it (`push: true`). While its switch is off it answers push:false: nothing is saved, so the
    // token is sent again once the switch is on (after RETRY_MS at the latest).
    if ((res as { push?: unknown } | null | undefined)?.push === true) {
      await AsyncStorage.setItem(KEY, key).catch(() => {});
      await AsyncStorage.removeItem(REFUSED_KEY).catch(() => {});
    } else {
      await AsyncStorage.setItem(REFUSED_KEY, `${key}@${Date.now()}`).catch(() => {});
    }
  } catch {
    // offline, signed out or an older server: tried again after the next glance
  } finally {
    sending = false;
  }
}

/** Watch for the token to arrive or change, once. A no-op where the binary cannot say (the listener is guarded in the bridge). */
export function watchPushToStart(): void {
  if (watching || Platform.OS !== "ios") return;
  watching = true;
  onPushToStartToken((token) => { void registerPushToStart(token); });
}

/** SIGN-OUT: the server forgets this phone's start token, so nothing is pushed to the next person's Lock Screen. Best effort. */
export async function forgetPushToStart(o: { local?: boolean } = {}): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEY, REFUSED_KEY]).catch(() => {});
    // After sign-out the session is gone and the call always fails: the server's copy is told from signingOut() instead.
    if (o.local || Platform.OS !== "ios" || !hasBinaryFeature("activityPushStart")) return;
    await callEndpoint("POST", str("widgets.activity.startTokenPath", "/v1/widgets/activity-start-token"), { token: null });
  } catch {
    // the session may already be gone: the server drops a token that APNs reports unregistered
  }
}
