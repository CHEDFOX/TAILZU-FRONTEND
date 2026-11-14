/**
 * DEVICE FACTS on the phone (spec 2.9, B9): the read-only `device.*` values, kept current, with change subscriptions.
 * Every source is already linked (safe-area-context, Keyboard, AccessibilityInfo, Appearance, expo-localization, NetInfo,
 * AppState, the existing permission reads, the keyboard-enabled poll, Linking.canOpenURL). Reads never REQUEST a permission.
 * Location goes through the natives gate (it is a module added after the build); an older binary reads "unsupported".
 *
 * V1 calls startDeviceFacts() once when the client declares "device", reads with deviceFact(path) / getDeviceFacts(), and
 * subscribes with subscribeDeviceFacts(cb) (cb gets the list of changed paths). Mount <FactsInsetsSync/> inside the
 * SafeAreaProvider so insets follow rotation.
 */
import React, { useEffect } from "react";
import { AccessibilityInfo, AppState, Appearance, Dimensions, Keyboard, Linking, PixelRatio, Platform } from "react-native";
import { initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
import NetInfo from "@react-native-community/netinfo";
import * as Localization from "expo-localization";
import { getDeviceSignals, refreshDeviceSignals } from "../../device/signals";
import { tulmiPerms } from "../../device/natives";
import { APP_VERSION } from "../client/version";
import type { BlockRegistry } from "../blockRegistry";
import {
  CAN_OPEN_SCHEMES, DEVICE_SPEC, changedPaths, defaultFacts, locationPerm, mergeFacts, permFrom, probeSchemes, readFact, type Facts,
} from "./factsCore";

export { DEVICE_SPEC as SPEC } from "./factsCore";
export function registerDevice(registry: BlockRegistry): void {
  registry.addBlock("device", DEVICE_SPEC);
}

let facts: Facts = defaultFacts();
const listeners = new Set<(changed: string[]) => void>();
let started = false;
let teardown: Array<() => void> = [];

export function getDeviceFacts(): Facts { return facts; }
export function deviceFact(path: string): unknown { return readFact(facts, path); }

export function subscribeDeviceFacts(cb: (changed: string[]) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Apply a patch; tell listeners which listed paths changed. A throwing listener never stops the others. */
export function patchDeviceFacts(patch: Record<string, any>): void {
  const next = mergeFacts(facts, patch);
  const changed = changedPaths(facts, next);
  facts = next;
  if (!changed.length) return;
  for (const cb of [...listeners]) { try { cb(changed); } catch { /* never escapes */ } }
}

const platform = (): Facts["platform"] => (Platform.OS === "android" ? "android" : Platform.OS === "web" ? "web" : "ios");

function sizePatch() {
  const w = Dimensions.get("window");
  return { width: w.width, height: w.height, fontScale: PixelRatio.getFontScale() };
}

async function readPerms(): Promise<void> {
  const perm: Record<string, string> = {};
  try {
    const s = await refreshDeviceSignals();
    patchDeviceFacts({ keyboard: { enabled: s.keyboard ? s.keyboard.enabled : true, ready: s.keyboard ? s.keyboard.fullAccess : true } });
  } catch { /* keep the last reading */ }
  try {
    const A = await import("expo-audio");
    perm.mic = permFrom(await (A as any).AudioModule?.getRecordingPermissionsAsync?.());   // reads only, never asks
  } catch { /* keep */ }
  try {
    const N = await import("expo-notifications");
    perm.notifications = permFrom(await N.getPermissionsAsync());
  } catch { /* keep */ }
  try {
    const C = await import("expo-camera");
    perm.camera = permFrom(await (C as any).Camera?.getCameraPermissionsAsync?.());
  } catch { /* keep */ }
  try {
    perm.location = locationPerm(tulmiPerms()?.locationStatus?.());
  } catch { perm.location = "unsupported"; }
  if (Platform.OS === "ios") {
    try {
      const M = await import("expo-media-library");
      perm.photos = permFrom(await (M as any).getPermissionsAsync?.());
    } catch { /* keep */ }
  } else perm.photos = "unsupported";
  patchDeviceFacts({ perm });
}

async function readCanOpen(): Promise<void> {
  if (Platform.OS === "web") return;
  const canOpen: Record<string, boolean | null> = {};
  const probe = probeSchemes(platform());
  for (const k of Object.keys(CAN_OPEN_SCHEMES)) if (!probe.includes(k)) canOpen[k] = null;
  await Promise.all(probe.map(async (k) => {
    const url = CAN_OPEN_SCHEMES[k];
    try { canOpen[k] = await Linking.canOpenURL(url); } catch { canOpen[k] = false; }
  }));
  patchDeviceFacts({ canOpen });
}

/** Start reading and watching. Safe to call twice. `blocks` is what this client declared (device.blocks). Returns a stop function. */
export function startDeviceFacts(opts: { blocks?: string[]; runtime?: string } = {}): () => void {
  if (started) { patchDeviceFacts({ blocks: opts.blocks, runtime: opts.runtime }); return stopDeviceFacts; }
  started = true;
  const cs = Appearance.getColorScheme();
  patchDeviceFacts({
    ...sizePatch(), platform: platform(), appVersion: APP_VERSION, blocks: opts.blocks ?? [], runtime: opts.runtime ?? "",
    scheme: cs === "dark" ? "dark" : "light",
    locale: Localization.getLocales?.()?.[0]?.languageTag ?? "en",
    insets: initialWindowMetrics?.insets ?? undefined,
    appState: AppState.currentState === "background" || AppState.currentState === "inactive" ? AppState.currentState : "active",
    keyboard: { enabled: getDeviceSignals().keyboard?.enabled ?? true, ready: getDeviceSignals().keyboard?.fullAccess ?? true },
  });
  const add = (s: { remove: () => void } | undefined | null) => { if (s) teardown.push(() => s.remove()); };
  add(Dimensions.addEventListener("change", () => patchDeviceFacts(sizePatch())));
  add(Appearance.addChangeListener(({ colorScheme }) => patchDeviceFacts({ scheme: colorScheme === "dark" ? "dark" : "light" })));
  add(AppState.addEventListener("change", (st) => {
    patchDeviceFacts({ appState: st === "active" ? "active" : st === "background" ? "background" : "inactive" });
    if (st === "active") { void readPerms(); void readCanOpen(); patchDeviceFacts({ locale: Localization.getLocales?.()?.[0]?.languageTag ?? facts.locale }); }
  }));
  const showEv = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
  const hideEv = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
  add(Keyboard.addListener(showEv, (e) => patchDeviceFacts({ keyboard: { visible: true, height: e?.endCoordinates?.height ?? 0 } })));
  add(Keyboard.addListener(hideEv, () => patchDeviceFacts({ keyboard: { visible: false, height: 0 } })));
  try {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => patchDeviceFacts({ reduceMotion: !!v })).catch(() => {});
    add(AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => patchDeviceFacts({ reduceMotion: !!v })));
  } catch { /* keep default */ }
  try {
    const un = NetInfo.addEventListener((s) => patchDeviceFacts({ online: !(s.isConnected === false || s.isInternetReachable === false) }));
    teardown.push(un);
  } catch { /* keep default (online) */ }
  void readPerms();
  void readCanOpen();
  return stopDeviceFacts;
}

export function stopDeviceFacts(): void {
  for (const t of teardown) { try { t(); } catch { /* ignore */ } }
  teardown = [];
  started = false;
}

/** Re-read the permission facts now (after a primed card answered, or a screen opened). */
export function refreshDevicePerms(): Promise<void> { return readPerms(); }

/** Mount once inside the SafeAreaProvider: feeds device.insets, which follows rotation. Draws nothing. */
export function FactsInsetsSync(): React.ReactElement | null {
  const i = useSafeAreaInsets();
  useEffect(() => { patchDeviceFacts({ insets: i }); }, [i.top, i.bottom, i.left, i.right]);
  return null;
}
