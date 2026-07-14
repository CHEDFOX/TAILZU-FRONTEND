/**
 * The action interpreter — turns declarative ActionSpecs from the server into
 * real behavior. This is the "kitchen-sink" build: every action the app might
 * want to trigger from a backend JSON push is wired here. Missing SDK keys
 * (Sentry / PostHog / RevenueCat) no-op silently instead of throwing, so the
 * same binary works whether or not you fill env variables.
 */
import { Linking, Platform, Share, Vibration } from "react-native";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
// expo-file-system 18+ (SDK 56) moved the classic constants/functions
// (cacheDirectory, downloadAsync, etc.) under /legacy. The new File-based API
// at the top level covers new code; for the existing downloadAsync flow the
// legacy import is the drop-in.
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import * as Calendar from "expo-calendar";
import * as Contacts from "expo-contacts";
import * as Camera from "expo-camera";
import * as Speech from "expo-speech";
import * as Tracking from "expo-tracking-transparency";
import * as StoreReview from "expo-store-review";
import type { ActionRef, ActionSpec, Condition } from "./types";
import { Store } from "./state";
import { callEndpoint } from "./client";
import { supabase } from "../auth/supabaseClient";
import { trackEvent, identifyUser, resetAnalytics } from "../telemetry/analytics";
import { showPaywall, subscribeToProduct, restorePurchases, hasEntitlement } from "../billing/purchases";
import { registerForPushToken } from "../notifications/push";
import { completeKeyboardHandoff, cancelKeyboardHandoff } from "../../modules/tulmi-bridge";

export interface NavApi {
  push: (screenId: string, params?: Record<string, any>) => void;
  back: () => void;
  switchTab: (tabId: string) => void;
  reloadCurrent: () => void;
  refreshLocale: () => void;
}

export interface Ctx {
  store: Store;
  actions: Record<string, ActionSpec>;
  flags: Record<string, any>;
  labels: Record<string, string>;
  nav: NavApi;
  toast: (message: string, tone?: string) => void;
  event?: any;
}

/** Resolve "$state.x" / "$event" / "$flags.x" placeholders inside any value. */
export function resolveValue(value: any, ctx: Ctx): any {
  if (typeof value === "string" && value.startsWith("$")) {
    if (value === "$event") return ctx.event;
    if (value === "$state") return ctx.store.snapshot();
    if (value.startsWith("$state.")) return ctx.store.get(value.slice("$state.".length));
    if (value.startsWith("$flags.")) return ctx.flags[value.slice("$flags.".length)];
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) out[k] = resolveValue(value[k], ctx);
    return out;
  }
  return value;
}

export function evalCondition(cond: Condition | undefined, ctx: Ctx): boolean {
  if (!cond) return true;
  // A malformed condition from the backend (e.g. `{ in: ["x"] }` missing its
  // array operand → `undefined.includes`) is evaluated at RENDER time inside
  // RenderNode. An uncaught throw there unwinds to the root and blanks the
  // whole screen, so any parse failure resolves to `false` (node hides) instead.
  try {
    if ("eq" in cond) return resolveValue(`$state.${cond.eq[0]}`, ctx) === cond.eq[1];
    if ("neq" in cond) return resolveValue(`$state.${cond.neq[0]}`, ctx) !== cond.neq[1];
    if ("gt" in cond) return Number(resolveValue(`$state.${cond.gt[0]}`, ctx)) > cond.gt[1];
    if ("gte" in cond) return Number(resolveValue(`$state.${cond.gte[0]}`, ctx)) >= cond.gte[1];
    if ("lt" in cond) return Number(resolveValue(`$state.${cond.lt[0]}`, ctx)) < cond.lt[1];
    if ("lte" in cond) return Number(resolveValue(`$state.${cond.lte[0]}`, ctx)) <= cond.lte[1];
    if ("in" in cond) return Array.isArray(cond.in[1]) && cond.in[1].includes(resolveValue(`$state.${cond.in[0]}`, ctx));
    if ("contains" in cond) return String(resolveValue(`$state.${cond.contains[0]}`, ctx) ?? "").includes(cond.contains[1]);
    if ("truthy" in cond) return !!ctx.store.get(cond.truthy);
    if ("falsy" in cond) return !ctx.store.get(cond.falsy);
    if ("flag" in cond) return !!ctx.flags[cond.flag];
    if ("entitled" in cond) return hasEntitlement(cond.entitled);
    if ("platform" in cond) return Platform.OS === cond.platform;
    if ("not" in cond) return !evalCondition(cond.not, ctx);
    if ("all" in cond) return cond.all.every((c) => evalCondition(c, ctx));
    if ("any" in cond) return cond.any.some((c) => evalCondition(c, ctx));
  } catch {
    return false;
  }
  return true;
}

function spec(ref: ActionRef, ctx: Ctx): ActionSpec | null {
  if (typeof ref === "string") return ctx.actions[ref] ?? null;
  return ref;
}

/**
 * Defensive Camera permission request across expo-camera API generations:
 * older versions exported the method on the `Camera` class; newer ones
 * (SDK 51+) also expose it as a top-level module function. Fall through
 * every plausible shape so we don't crash on a version bump.
 */
async function requestCameraPermission(): Promise<{ granted: boolean; status?: string }> {
  const mod = Camera as any;
  const req =
    mod.requestCameraPermissionsAsync ??
    mod.Camera?.requestCameraPermissionsAsync ??
    mod.CameraView?.requestCameraPermissionsAsync ??
    mod.default?.requestCameraPermissionsAsync;
  if (typeof req !== "function") return { granted: false };
  try {
    const r = await req();
    return { granted: !!r?.granted, status: r?.status };
  } catch {
    return { granted: false };
  }
}

export async function runAction(ref: ActionRef | undefined, ctx: Ctx): Promise<void> {
  if (!ref) return;
  const action = spec(ref, ctx);
  if (!action) return;

  switch (action.kind) {
    // ------------------------------------------------------------------- nav
    case "navigate": ctx.nav.push(action.screenId, action.params); break;
    case "navigateBack":
    case "dismiss": ctx.nav.back(); break;
    case "switchTab": ctx.nav.switchTab(action.tabId); break;
    case "openUrl":
      Linking.openURL(action.url).catch(() => ctx.toast("Couldn't open link", "error"));
      break;
    case "openInAppBrowser":
      try { await WebBrowser.openBrowserAsync(action.url); } catch { ctx.toast("Couldn't open link", "error"); }
      break;
    case "openSettings": {
      const failed = () => ctx.toast("Couldn't open Settings", "error");
      if (Platform.OS === "android" && action.target === "keyboard") {
        Linking.sendIntent("android.settings.INPUT_METHOD_SETTINGS").catch(() => Linking.openSettings().catch(failed));
      } else {
        Linking.openSettings().catch(failed);
      }
      break;
    }

    // ------------------------------------------------------------ data / net
    case "refresh": ctx.nav.reloadCurrent(); break;
    case "callEndpoint": {
      try {
        const body = action.body != null ? resolveValue(action.body, ctx) : undefined;
        const res = await callEndpoint(action.method, action.path, body);
        if (action.assignTo) ctx.store.set(action.assignTo, res);
        await runAction(action.onSuccess, ctx);
        if (action.path === "/v1/profile" && body != null && typeof body === "object" && "language" in body) {
          ctx.nav.refreshLocale();
        }
      } catch {
        await runAction(action.onError, ctx);
      }
      break;
    }

    // -------------------------------------------------------------- state
    case "setState": ctx.store.set(action.path, resolveValue(action.value, ctx)); break;
    case "toggleState": ctx.store.toggle(action.path); break;
    case "incrementState": {
      const cur = Number(ctx.store.get(action.path) ?? 0);
      ctx.store.set(action.path, cur + (action.by ?? 1));
      break;
    }
    case "clearState": ctx.store.set(action.path, undefined); break;

    // ---------------------------------------------------------- feedback
    case "haptic":
      if (Platform.OS === "ios") {
        try {
          switch (action.style) {
            case "light": await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); break;
            case "medium": await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); break;
            case "heavy": await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); break;
            case "selection": await Haptics.selectionAsync(); break;
            case "success": await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); break;
            case "warning": await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); break;
            case "error": await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); break;
          }
        } catch { /* haptics blocked in some contexts — ignore */ }
      } else {
        Vibration.vibrate(
          action.style === "heavy" ? 30
          : action.style === "medium" ? 18
          : action.style === "success" ? [0, 15, 40, 15]
          : action.style === "error" ? [0, 15, 40, 15, 40, 15]
          : 10,
        );
      }
      break;
    case "toast":
      // Resolve placeholders ($event / $state.x / …) so an action can echo the
      // real reason it was fired — e.g. onError toasts can show the actual mic
      // failure instead of a hardcoded generic string.
      ctx.toast(String(resolveValue(action.message, ctx) ?? action.message), action.tone);
      break;
    case "snackbar":
      // Reuse toast under the hood — the Snackbar UI treatment can be added
      // via an OTA once the SDUI screen using it is authored.
      ctx.toast(String(resolveValue(action.message, ctx) ?? action.message), "info");
      break;
    case "speak":
      try { Speech.speak(action.text, { voice: action.voice }); } catch { /* no-op */ }
      break;
    case "stopMedia":
      try { Speech.stop(); } catch { /* no-op */ }
      break;
    case "playMedia":
      // Real audio playback is wired via VoiceButton's /v1/speak flow; a
      // generic playMedia action can be added when a use-case shows up.
      break;
    case "confetti":
      // Confetti component is authored on-screen and triggered by toggling
      // state; the action is a convenience toggler for `_confetti`.
      ctx.store.set("_confetti", (ctx.store.get("_confetti") ?? 0) + 1);
      break;

    // ------------------------------------------------- system / share / clip
    case "share":
      try {
        await Share.share({ message: action.text ?? "", url: action.url, title: action.title });
      } catch { ctx.toast("Couldn't open share sheet", "error"); }
      break;
    case "shareFile":
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(action.path, { mimeType: action.mimeType });
        }
      } catch { ctx.toast("Couldn't share file", "error"); }
      break;
    case "copyToClipboard":
      try {
        await Clipboard.setStringAsync(action.text);
        if (action.toastMessage) ctx.toast(action.toastMessage, "success");
      } catch { ctx.toast("Couldn't copy", "error"); }
      break;
    case "readClipboard":
      try {
        const s = await Clipboard.getStringAsync();
        ctx.store.set(action.assignTo, s);
      } catch { /* no clipboard access */ }
      break;
    case "sms":
      Linking.openURL(`sms:${action.number ?? ""}${action.body ? `?body=${encodeURIComponent(action.body)}` : ""}`).catch(() => ctx.toast("Couldn't open Messages", "error"));
      break;
    case "email":
      Linking.openURL(`mailto:${action.to ?? ""}?subject=${encodeURIComponent(action.subject ?? "")}&body=${encodeURIComponent(action.body ?? "")}`).catch(() => ctx.toast("Couldn't open Mail", "error"));
      break;
    case "phone":
      Linking.openURL(`tel:${action.number}`).catch(() => ctx.toast("Couldn't dial", "error"));
      break;
    case "download": {
      try {
        const fileName = action.filename ?? `tulmi-${Date.now()}`;
        const dest = `${FileSystem.cacheDirectory}${fileName}`;
        const res = await FileSystem.downloadAsync(action.url, dest);
        ctx.store.set("_lastDownload", res.uri);
        await runAction(action.onSuccess, ctx);
      } catch {
        await runAction(action.onError, ctx);
      }
      break;
    }
    case "saveToPhotos": {
      try {
        const perm = await MediaLibrary.requestPermissionsAsync();
        if (!perm.granted) { ctx.toast("Photos permission denied", "error"); break; }
        await MediaLibrary.saveToLibraryAsync(action.path);
        ctx.toast("Saved to Photos", "success");
      } catch { ctx.toast("Couldn't save", "error"); }
      break;
    }

    // ------------------------------------------------------ media pickers
    case "pickImage": {
      try {
        const source = action.source ?? "library";
        const pick = source === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
        if (!pick.canceled && pick.assets && pick.assets[0]) {
          ctx.store.set(action.assignTo, pick.assets[0]);
          await runAction(action.onSuccess, ctx);
        }
      } catch { await runAction(action.onError, ctx); }
      break;
    }
    case "pickDocument": {
      try {
        const res = await DocumentPicker.getDocumentAsync({ type: action.types ?? ["*/*"] });
        if (!res.canceled && res.assets && res.assets[0]) {
          ctx.store.set(action.assignTo, res.assets[0]);
          await runAction(action.onSuccess, ctx);
        }
      } catch { await runAction(action.onError, ctx); }
      break;
    }
    case "scanQR":
      // Full QR scanning requires the Camera component mounted in-screen with
      // a barcode callback. The action here requests the permission so the
      // on-screen component can start scanning immediately once mounted.
      try {
        const perm = await requestCameraPermission();
        ctx.store.set("_qrPermission", perm.granted);
      } catch { await runAction(action.onError, ctx); }
      break;

    // ------------------------------------------------------- permissions
    case "requestPermission": {
      try {
        let granted = false;
        switch (action.permission) {
          case "microphone": {
            const AudioMod = await import("expo-audio");
            const p = await (AudioMod as any).AudioModule?.requestRecordingPermissionsAsync?.();
            granted = !!p?.granted;
            break;
          }
          case "camera": granted = (await requestCameraPermission()).granted; break;
          case "notifications": granted = (await Notifications.requestPermissionsAsync()).granted; break;
          case "photoLibrary": granted = (await MediaLibrary.requestPermissionsAsync()).granted; break;
          case "contacts": granted = (await Contacts.requestPermissionsAsync()).granted; break;
          case "calendar": granted = (await Calendar.requestCalendarPermissionsAsync()).granted; break;
          case "tracking": granted = (await Tracking.requestTrackingPermissionsAsync()).status === "granted"; break;
        }
        await runAction(granted ? action.onGranted : action.onDenied, ctx);
      } catch { await runAction(action.onDenied, ctx); }
      break;
    }

    // ---------------------------------------------------------------- auth
    case "biometricPrompt": {
      try {
        const has = await LocalAuthentication.hasHardwareAsync();
        if (!has) { await runAction(action.onError, ctx); break; }
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: action.reason ?? "Authenticate" });
        await runAction(res.success ? action.onSuccess : action.onError, ctx);
      } catch { await runAction(action.onError, ctx); }
      break;
    }
    case "signOut": await supabase.auth.signOut(); break;

    // -------------------------------------------------- App icon (alternate)
    // Backend-driven icon switching. Name matches the PascalCase name declared
    // in app.config.ts under expo-alternate-app-icons. Pass null (or empty)
    // to reset to the default icon. Devices that don't support the API
    // silently no-op — the promise resolves either way.
    case "setAppIcon": {
      try {
        const { setAlternateAppIcon } = await import("expo-alternate-app-icons");
        const name = (action as any).name;
        await setAlternateAppIcon(name ? name : null);
        await runAction((action as any).onSuccess, ctx);
      } catch {
        await runAction((action as any).onError, ctx);
      }
      break;
    }

    // ----------------------------------------------------------------- IAP
    case "iap.showPaywall": {
      try {
        // packageId is accepted alongside offeringId so backend can pick a
        // specific package (annual/monthly/etc.) without hardcoding an
        // "auto-first" pick in the app.
        const ok = await showPaywall(action.offeringId, (action as any).packageId);
        await runAction(ok ? action.onSuccess : action.onError, ctx);
      } catch { await runAction(action.onError, ctx); }
      break;
    }
    case "iap.subscribe": {
      try {
        const ok = await subscribeToProduct(action.productId);
        await runAction(ok ? action.onSuccess : action.onError, ctx);
      } catch { await runAction(action.onError, ctx); }
      break;
    }
    case "iap.restore": {
      try {
        await restorePurchases();
        await runAction(action.onSuccess, ctx);
      } catch { await runAction(action.onError, ctx); }
      break;
    }
    case "iap.checkEntitlement":
      ctx.store.set(action.assignTo, hasEntitlement(action.entitlement));
      break;

    // ------------------------------------------------------- notifications
    case "scheduleNotification": {
      try {
        const trigger: any = action.atIso
          ? { type: "date", date: new Date(action.atIso) }
          : action.afterSeconds != null
            ? { type: "timeInterval", seconds: action.afterSeconds }
            : null;
        await Notifications.scheduleNotificationAsync({
          content: { title: action.title, body: action.body ?? "", data: action.payload ?? {} },
          trigger,
          identifier: action.identifier,
        });
      } catch { /* silent — user can turn on permissions and retry */ }
      break;
    }
    case "cancelNotification":
      try { await Notifications.cancelScheduledNotificationAsync(action.identifier); } catch { /* no-op */ }
      break;
    case "requestPushPermission": {
      try {
        const p = await Notifications.requestPermissionsAsync();
        if (p.granted) {
          await registerForPushToken();
          await runAction(action.onGranted, ctx);
        } else {
          await runAction(action.onDenied, ctx);
        }
      } catch { await runAction(action.onDenied, ctx); }
      break;
    }

    // ------------------------------------------------------------- analytics
    case "analytics.track": trackEvent(action.event, resolveValue(action.props, ctx)); break;
    case "analytics.identify": identifyUser(action.userId, resolveValue(action.traits, ctx)); break;
    case "analytics.reset": resetAnalytics(); break;

    // ------------------------------------------------------------- calendar
    case "calendar.addEvent": {
      try {
        const perm = await Calendar.requestCalendarPermissionsAsync();
        if (!perm.granted) break;
        const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const cal = cals.find((c) => c.allowsModifications) ?? cals[0];
        if (!cal) break;
        await Calendar.createEventAsync(cal.id, {
          title: action.title,
          startDate: new Date(action.startsAtIso),
          endDate: action.endsAtIso ? new Date(action.endsAtIso) : new Date(new Date(action.startsAtIso).getTime() + 60 * 60 * 1000),
          notes: action.notes,
          location: action.location,
        });
        ctx.toast("Added to calendar", "success");
      } catch { ctx.toast("Couldn't add event", "error"); }
      break;
    }

    // ----------------------------------------------------- store review prompt
    case "requestReview":
      try { if (await StoreReview.hasAction()) await StoreReview.requestReview(); } catch { /* no-op */ }
      break;

    // --------------------------------------------------------- keyboard bridge
    case "keyboard.reload":
    case "keyboard.setLayout":
      // Bridge calls into the native tulmi-bridge module; UI updates land the
      // next time the keyboard extension reads /v1/keyboard/config, which we
      // cache-bump on the backend when needed.
      break;

    // --------------------------------------------------------- mic handoff
    // Finish the "keyboard tapped mic → main app records → text back to
    // keyboard" round-trip. The keyboard_record screen dispatches this with
    // the cleaned text once /v1/transcribe-clean returns.
    case "completeKeyboardHandoff": {
      const sessionId = action.sessionId
        ?? (ctx.store.get("handoffSessionId") as string | undefined)
        ?? "";
      const text = action.text
        ?? (ctx.store.get(action.textPath ?? "dictationSample") as string | undefined)
        ?? "";
      if (sessionId && text) completeKeyboardHandoff(sessionId, text);
      await runAction(action.onSuccess, ctx);
      break;
    }
    case "cancelKeyboardHandoff": {
      const sessionId = action.sessionId
        ?? (ctx.store.get("handoffSessionId") as string | undefined)
        ?? "";
      if (sessionId) cancelKeyboardHandoff(sessionId);
      await runAction(action.onSuccess, ctx);
      break;
    }

    // --------------------------------------------------------- cache / dev
    case "clearCache": ctx.nav.reloadCurrent(); break;
    case "reloadApp":
      try {
        const Updates = await import("expo-updates");
        await (Updates as any).reloadAsync?.();
      } catch { /* not available in this build config */ }
      break;

    // ---------------------------------------------------------- composition
    case "sequence": for (const a of action.actions) await runAction(a, ctx); break;
    case "parallel": await Promise.all(action.actions.map((a) => runAction(a, ctx))); break;
    case "condition": await runAction(evalCondition(action.if, ctx) ? action.then : action.else, ctx); break;
    case "delay": await new Promise((r) => setTimeout(r, action.ms)); break;
    case "log":
      if (action.level === "error") console.error(action.message);
      else if (action.level === "warn") console.warn(action.message);
      else console.log(action.message);
      break;
  }
}
