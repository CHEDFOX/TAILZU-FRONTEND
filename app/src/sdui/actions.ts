/**
 * The action interpreter — turns declarative ActionSpecs from the server into
 * real behavior. This is the "kitchen-sink" build: every action the app might
 * want to trigger from a backend JSON push is wired here. Missing SDK keys
 * (Sentry / PostHog / RevenueCat) no-op silently instead of throwing, so the
 * same binary works whether or not you fill env variables.
 */
import { list, num, str, txt } from "./knobs";
import { Alert, Linking, Platform, Share, Vibration } from "react-native";
import { manageElsewhere } from "../billing/elsewhere";
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
// NO expo-calendar, NO expo-contacts. The app keeps its own calendar on the
// server (calendar.addEvent below) and reads no one's contacts, so neither
// module is in the binary: Apple rejects purpose strings for permissions an
// app never asks for, and a linked EventKit or Contacts API without its
// purpose string fails the upload (ITMS-90683). See app.config.ts.
import * as Camera from "expo-camera";
import * as Speech from "expo-speech";
import * as StoreReview from "expo-store-review";
import type { ActionRef, ActionSpec, Condition } from "./types";
import { Store } from "./state";
import { callEndpoint, invalidateScreens, QuotaExceededError, expireBootstrap } from "./client";
import { supabase } from "../auth/supabaseClient";
import { trackEvent, identifyUser, resetAnalytics } from "../telemetry/analytics";
import { buyPackage, subscribeToProduct, restorePurchases, hasEntitlement } from "../billing/purchases";
import { registerForPushToken, unregisterPushToken } from "../notifications/push";
import { completeKeyboardHandoff, cancelKeyboardHandoff, endFlowSession } from "../../modules/tulmi-bridge";
import { setLanguage } from "../storage";
import { armFlow } from "../widgets/flow";
import { isHandoffUrl, isOpenableUrl, isWebUrl, safeFileName } from "../security";
import { fillText, navParams, resolveValue } from "./fill";
import { playAudio, recordVoice, stopAudio, uploadFile, type MediaIO } from "./media";
import { runOutboxAction } from "./offline";
import { listenStream, makeStreamId, StreamTap } from "./askStream";

export interface NavApi {
  push: (screenId: string, params?: Record<string, any>) => void;
  /** Swap the top of the stack, leaving nothing behind to go back to. */
  replace: (screenId: string, params?: Record<string, any>) => void;
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

/**
 * Refuse a purchase that belongs to another store, and say where it lives.
 *
 * The rule itself is in billing/elsewhere.ts, free of react-native so it can
 * be tested on its own — it is a decision about somebody's money made from
 * three booleans, and the alert around it is the easy half.
 *
 * Returns true when it handled the tap.
 */
function elsewhere(ctx: Ctx): boolean {
  const e = manageElsewhere(ctx.flags, Platform.OS, txt);
  if (!e) return false;
  Alert.alert(
    txt("billing.elsewhere.title", "You already subscribe"),
    e.message,
    e.action
      ? [
          { text: txt("billing.elsewhere.dismiss", "Not now"), style: "cancel" },
          { text: e.action.label, onPress: () => openExternal(e.action!.url, ctx) },
        ]
      : undefined,
  );
  return true;
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
    if ("contains" in cond) {
      // An ARRAY is tested for membership, not for a substring of its joined
      // form. Stringifying ["hinglish"] gives "hinglish", whose substring "hi"
      // would light up Hindi in a multi-select — a wrong answer that looks
      // right. Strings keep substring semantics.
      const v = resolveValue(`$state.${cond.contains[0]}`, ctx);
      return Array.isArray(v) ? v.includes(cond.contains[1]) : String(v ?? "").includes(cond.contains[1]);
    }
    if ("startsWith" in cond) return String(resolveValue(`$state.${cond.startsWith[0]}`, ctx) ?? "").startsWith(cond.startsWith[1]);
    if ("endsWith" in cond) return String(resolveValue(`$state.${cond.endsWith[0]}`, ctx) ?? "").endsWith(cond.endsWith[1]);
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

const linkFailed = (ctx: Ctx) => ctx.toast(txt("toast.openLinkFailed", "Couldn't open link"), "error");

/**
 * Hand a URL to the OS — only a scheme security.isOpenableUrl allows, and for
 * an assistant's hand-off (`handoff`) only a link on its list (isHandoffUrl).
 */
function openExternal(url: unknown, ctx: Ctx, handoff = false): void {
  const allowed = handoff ? isHandoffUrl(url) : isOpenableUrl(url);
  if (!allowed || typeof url !== "string") { console.warn("[sdui] openUrl refused:", String(url).slice(0, 80)); linkFailed(ctx); return; }
  Linking.openURL(url).catch(() => linkFailed(ctx));
}

/** Only files this app put in its own cache (a download, a picked file) leave it. */
const inCache = (path: unknown): boolean =>
  typeof path === "string" && !!FileSystem.cacheDirectory && path.startsWith(FileSystem.cacheDirectory) && !path.includes("..");

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

/** The read-only twin of the above: what IS the answer, without asking. */
async function getCameraPermission(): Promise<{ granted: boolean }> {
  const mod = Camera as any;
  const get =
    mod.getCameraPermissionsAsync ??
    mod.Camera?.getCameraPermissionsAsync ??
    mod.CameraView?.getCameraPermissionsAsync ??
    mod.default?.getCameraPermissionsAsync;
  if (typeof get !== "function") return { granted: false };
  try {
    return { granted: !!(await get())?.granted };
  } catch {
    return { granted: false };
  }
}

/** What a media action needs of the screen that ran it; a follow-up runs with `event` as its $event. */
function mediaIO(ctx: Ctx): MediaIO {
  return {
    owner: ctx.store,
    get: (path) => ctx.store.get(path),
    set: (path, value) => ctx.store.set(path, value),
    run: (ref, event) => runAction(ref, event === undefined ? ctx : { ...ctx, event }),
  };
}

export async function runAction(ref: ActionRef | undefined, ctx: Ctx): Promise<void> {
  if (!ref) return;
  const action = spec(ref, ctx);
  if (!action) return;

  switch (action.kind) {
    // ------------------------------------------------------------------- nav
    // Params can be references too ("$state.ask.res.taskId"): the screen to
    // open is sometimes one an answer named — the task an ask just left
    // waiting for approval. Filled in as callEndpoint's body is; a literal
    // param goes as written. The server sends a reference only to a bundle
    // that says it can (ActionParams in the registry).
    case "navigate": {
      const params = navParams(action.params, ctx);
      if (action.replace) ctx.nav.replace(action.screenId, params);
      else ctx.nav.push(action.screenId, params);
      break;
    }
    case "navigateBack":
    case "dismiss": ctx.nav.back(); break;
    case "switchTab": ctx.nav.switchTab(action.tabId); break;
    // The address can be a reference ("$state.link.authorizeUrl"): a sign-in
    // page the server only knows after a call (callEndpoint ... assignTo)
    // cannot be written into the screen. Resolved here, then held to the same
    // checks as a literal one (openExternal / isWebUrl), so a state value
    // opens nothing a typed address could not.
    case "openUrl": openExternal(fillText(action.url, ctx), ctx, action.handoff === true); break;
    case "openInAppBrowser":
      try {
        const url = fillText(action.url, ctx);
        if (!isWebUrl(url)) throw new Error("not a web page");
        await WebBrowser.openBrowserAsync(url);
      } catch { linkFailed(ctx); }
      break;
    case "openSettings": {
      const failed = () => ctx.toast(txt("toast.openSettingsFailed", "Couldn't open Settings"), "error");
      if (Platform.OS === "android" && action.target === "keyboard") {
        Linking.sendIntent("android.settings.INPUT_METHOD_SETTINGS").catch(() => Linking.openSettings().catch(failed));
      } else {
        Linking.openSettings().catch(failed);
      }
      break;
    }

    // ------------------------------------------------------------ data / net
    case "refresh":
      // A refresh means "the server knows something I don't" — so drop the
      // cache first, or reloadCurrent would happily re-serve the copy we are
      // trying to get past.
      invalidateScreens();
      ctx.nav.reloadCurrent();
      break;
    case "callEndpoint": {
      // `stream`: the answer's words, written into state as they come over the live socket (askStream.ts).
      let unlisten: (() => void) | null = null;
      try {
        let body = action.body != null ? resolveValue(action.body, ctx) : undefined;
        const streamPath = typeof action.stream === "string" && action.stream ? action.stream : "";
        if (streamPath && body && typeof body === "object" && !Array.isArray(body)) {
          const id = makeStreamId();
          ctx.store.set(streamPath, { id, text: "", step: "" });
          const tap = new StreamTap((patch) => { for (const k of Object.keys(patch)) ctx.store.set(`${streamPath}.${k}`, (patch as Record<string, unknown>)[k]); });
          unlisten = listenStream(id, (d) => tap.take(d));
          body = { ...(body as Record<string, unknown>), streamId: id };
        }
        // Paths can carry state too: "/v1/history/$state.item.id".
        //
        // resolveValue only rewrites a string that IS a reference; a path is a
        // string that CONTAINS one, so it was being sent literally — inside a
        // list row that meant deleting the row hit /v1/history/$state.item.id
        // and 404'd. Tokens run to the first character that cannot be part of a
        // path segment.
        const path = action.path.includes("$state.")
          ? action.path.replace(/\$state\.[A-Za-z0-9_.]+/g, (m) => {
              const v = ctx.store.get(m.slice("$state.".length));
              return v == null ? "" : encodeURIComponent(String(v));
            })
          : action.path;
        const res = await callEndpoint(action.method, path, body);
        // Any write can change what a screen renders. Dropping every cached
        // screen after one is the difference between a settings toggle that
        // sticks and one that appears to revert when you navigate back.
        if (action.method && action.method.toUpperCase() !== "GET") invalidateScreens();
        if (action.assignTo) ctx.store.set(action.assignTo, res);
        await runAction(action.onSuccess, ctx);
        if (action.path === "/v1/profile" && body != null && typeof body === "object" && "language" in body) {
          // The keyboard reads its language from the App Group, and that was
          // only ever written by the first-launch pick. A change made here in
          // Settings updated the profile and the app's locale but left the
          // keyboard dictating and refining in the OLD language — a Hindi
          // speaker who picked English at first launch and switched later got
          // Hindi speech "refined" toward English. Mirror it every time.
          const code = (body as { language?: unknown }).language;
          if (typeof code === "string" && code) {
            try { await setLanguage(code); } catch { /* storage only; never block the save */ }
          }
          ctx.nav.refreshLocale();
        }
      } catch (err) {
        // The free-plan cap is not an error to apologise for. Every one of
        // these calls carries a generic "check your connection" toast, and
        // that is what a user who had simply run out of free words was told —
        // so the one thing that would have helped, the paywall, was the one
        // thing they never saw.
        if (err instanceof QuotaExceededError) {
          // The bootstrap still says there are words left; let the next
          // foreground ask again instead of waiting out its TTL.
          expireBootstrap();
          // Which screen answers "out of words" is the server's call.
          ctx.nav.push(str("quota.screenId", "paywall"));
          break;
        }
        await runAction(action.onError, ctx);
      } finally {
        // A moment more: the last words can come over the socket just after the answer.
        if (unlisten) setTimeout(unlisten, 600);
      }
      break;
    }

    // -------------------------------------------------------------- state
    case "setState": ctx.store.set(action.path, resolveValue(action.value, ctx)); break;
    case "toggleState": ctx.store.toggle(action.path); break;
    // Add or remove one value in an array at `path` — the primitive a
    // multi-select needs and the only one the store could not express. `min`
    // keeps a required choice from being emptied: with min 1, unchecking the
    // last item does nothing rather than leaving the user with no answer.
    case "toggleInArray": {
      const cur = ctx.store.get(action.path);
      const list = Array.isArray(cur) ? [...cur] : [];
      const value = resolveValue(action.value, ctx);
      const at = list.indexOf(value);
      if (at >= 0) {
        if (list.length <= Number(action.min ?? 0)) break;
        list.splice(at, 1);
      } else {
        list.push(value);
      }
      ctx.store.set(action.path, list);
      break;
    }
    // Push onto an array at `path`. The primitive a THREAD needs: a screen
    // whose content grows turn by turn cannot be expressed by setState, which
    // only ever replaces. `max` drops from the front, so a long conversation
    // bounds its own memory instead of growing until the screen stutters.
    case "appendState": {
      const cur = ctx.store.get(action.path);
      const list = Array.isArray(cur) ? [...cur] : [];
      list.push(resolveValue(action.value, ctx));
      const max = Number(action.max ?? 0);
      ctx.store.set(action.path, max > 0 && list.length > max ? list.slice(-max) : list);
      break;
    }
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
          action.style === "heavy" ? num("haptics.android.heavyMs", 30)
          : action.style === "medium" ? num("haptics.android.mediumMs", 18)
          : action.style === "success" ? list<number>("haptics.android.successPattern", [0, 15, 40, 15])
          : action.style === "error" ? list<number>("haptics.android.errorPattern", [0, 15, 40, 15, 40, 15])
          : num("haptics.android.lightMs", 10),
        );
      }
      break;
    case "toast":
      // Resolve placeholders ($event / $state.x / …) so an action can echo the
      // real reason it was fired — e.g. onError toasts can show the actual mic
      // failure instead of a hardcoded generic string.
      // Nothing to say is said by no toast at all.
      { const m = fillText(action.message, ctx); if (m) ctx.toast(m, action.tone); }
      break;
    case "snackbar":
      // Reuse toast under the hood — the Snackbar UI treatment can be added
      // via an OTA once the SDUI screen using it is authored.
      { const m = fillText(action.message, ctx); if (m) ctx.toast(m, "info"); }
      break;
    case "speak":
      try { Speech.speak(action.text, { voice: action.voice }); } catch { /* no-op */ }
      break;
    case "stopMedia":
      try { Speech.stop(); } catch { /* no-op */ }
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
      } catch { ctx.toast(txt("toast.shareFailed", "Couldn't open share sheet"), "error"); }
      break;
    case "shareFile":
      try {
        if (!inCache(action.path)) throw new Error("not a file this app made");
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(action.path, { mimeType: action.mimeType });
        }
      } catch { ctx.toast(txt("toast.shareFileFailed", "Couldn't share file"), "error"); }
      break;
    case "copyToClipboard":
      try {
        // A row copies its own text: "$state.item.output" is the line, not
        // the words to put on the clipboard.
        const text = fillText(action.text, ctx);
        if (!text) break;
        await Clipboard.setStringAsync(text);
        const said = fillText(action.toastMessage, ctx);
        if (said) ctx.toast(said, "success");
      } catch { ctx.toast(txt("toast.copyFailed", "Couldn't copy"), "error"); }
      break;
    case "readClipboard":
      try {
        const s = await Clipboard.getStringAsync();
        ctx.store.set(action.assignTo, s);
      } catch { /* no clipboard access */ }
      break;
    case "sms":
      Linking.openURL(`sms:${action.number ?? ""}${action.body ? `?body=${encodeURIComponent(action.body)}` : ""}`).catch(() => ctx.toast(txt("toast.smsFailed", "Couldn't open Messages"), "error"));
      break;
    case "email":
      Linking.openURL(`mailto:${action.to ?? ""}?subject=${encodeURIComponent(action.subject ?? "")}&body=${encodeURIComponent(action.body ?? "")}`).catch(() => ctx.toast(txt("toast.emailFailed", "Couldn't open Mail"), "error"));
      break;
    case "phone":
      Linking.openURL(`tel:${action.number}`).catch(() => ctx.toast(txt("toast.phoneFailed", "Couldn't dial"), "error"));
      break;
    case "download": {
      try {
        if (!isWebUrl(action.url)) throw new Error("not a web address");
        // A name, never a path: "../" would write outside the cache directory.
        const fileName = safeFileName(action.filename, `${str("download.filePrefix", "tulmi-")}${Date.now()}`);
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
        if (!inCache(action.path)) throw new Error("not a file this app made");
        const perm = await MediaLibrary.requestPermissionsAsync();
        if (!perm.granted) { ctx.toast(txt("toast.photosDenied", "Photos permission denied"), "error"); break; }
        await MediaLibrary.saveToLibraryAsync(action.path);
        ctx.toast(txt("toast.photosSaved", "Saved to Photos"), "success");
      } catch { ctx.toast(txt("toast.photosFailed", "Couldn't save"), "error"); }
      break;
    }

    // ------------------------------------------------------ media pickers
    case "pickImage": {
      try {
        const source = action.source ?? "library";
        const quality = num("media.pickImageQuality", 0.8);
        const pick = source === "camera"
          ? await ImagePicker.launchCameraAsync({ quality })
          : await ImagePicker.launchImageLibraryAsync({ quality });
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
    // Send a picked file, play a sound, speak into a field (media.ts): each
    // belongs to this screen's store, and stops when the screen goes.
    case "uploadFile": await uploadFile(action, mediaIO(ctx)); break;
    case "playAudio": await playAudio(action, mediaIO(ctx)); break;
    case "stopAudio": stopAudio(); break;
    case "recordVoice": await recordVoice(action, mediaIO(ctx)); break;
    // Keep an ask to send once the phone is online, take one out, try one again (offline.tsx).
    case "outbox": await runOutboxAction(action, ctx); break;
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
        // DENIED ONCE IS NOT THE SAME AS DENIED FOREVER, AND THE SCREEN HAS TO
        // KNOW WHICH.
        //
        // iOS shows a permission dialog once per install. After that — the
        // user tapped Don't Allow, or turned the switch off in Settings —
        // requesting returns denied instantly and draws nothing. The Allow
        // button on the onboarding screen then does visibly nothing, which
        // reads as a broken button rather than as a decision already on
        // record, and there is nowhere left to go except Settings.
        //
        // `canAskAgain` is the only thing that separates the two, and it was
        // being thrown away. When it is false the backend gets `onBlocked`, so
        // it can offer Settings instead of asking again for something the
        // system will not ask for.
        let blocked = false;
        switch (action.permission) {
          case "microphone": {
            const AudioMod = await import("expo-audio");
            const p = await (AudioMod as any).AudioModule?.requestRecordingPermissionsAsync?.();
            granted = !!p?.granted;
            blocked = !granted && p?.canAskAgain === false;
            break;
          }
          case "camera": granted = (await requestCameraPermission()).granted; break;
          case "notifications": granted = (await Notifications.requestPermissionsAsync()).granted; break;
          case "photoLibrary": granted = (await MediaLibrary.requestPermissionsAsync()).granted; break;
          case "contacts":
          case "calendar":
            // NOT IN THIS BUILD: neither module is linked (see the imports).
            // Denied, so onDenied fires instead of the screen waiting.
            console.warn(`[sdui] requestPermission('${action.permission}'): not built in — treating as denied`);
            granted = false;
            break;
          case "tracking":
            // NOT IN THIS BUILD, deliberately. Shipping the ATT prompt means
            // shipping NSUserTrackingUsageDescription, and App Store Connect
            // refuses to publish an App Privacy card for a binary that CAN ask
            // to track until you declare which data does the tracking. None
            // does. Nothing has ever sent permission:"tracking" either, so the
            // key bought a blocked submission and no feature.
            //
            // Denied rather than silent, so onDenied fires and a caller learns
            // the answer instead of waiting. Restoring it is the plugin, the
            // usage string, and a new build — plus a truthful tracking
            // declaration, which is the part that should give anyone pause.
            console.warn('[sdui] requestPermission("tracking"): not built in — treating as denied');
            granted = false;
            break;
          case "location":
            // expo-location is NOT a dependency in this build. Wiring a real
            // location prompt needs that native module added (a native change),
            // so we can't grant here — fall through as denied (onDenied fires)
            // instead of silently doing nothing. See report: needs expo-location.
            console.warn("[sdui] requestPermission('location'): expo-location not installed — treating as denied");
            granted = false;
            break;
        }
        // onBlocked falls back to onDenied, so a screen that has not been
        // taught the difference behaves exactly as it does today.
        const next = granted
          ? action.onGranted
          : (blocked ? ((action as { onBlocked?: unknown }).onBlocked ?? action.onDenied) : action.onDenied);
        await runAction(next as any, ctx);
      } catch { await runAction(action.onDenied, ctx); }
      break;
    }

    // ASK NOTHING, JUST LOOK.
    //
    // requestPermission cannot answer "do we already have this?", because on an
    // undetermined permission the asking IS the prompt. A screen whose whole
    // job is to explain a permission before requesting it therefore cannot use
    // it to decide whether it is still needed — checking would fire the dialog
    // it was written to precede.
    //
    // This reads the current status and never prompts. An undetermined
    // permission reads as denied, which is the honest answer: we do not have it.
    case "checkPermission": {
      let granted = false;
      try {
        switch (action.permission) {
          case "microphone": {
            const AudioMod = await import("expo-audio");
            const p = await (AudioMod as any).AudioModule?.getRecordingPermissionsAsync?.();
            granted = !!p?.granted;
            break;
          }
          case "camera": granted = (await getCameraPermission()).granted; break;
          case "notifications": granted = (await Notifications.getPermissionsAsync()).granted; break;
          case "photoLibrary": granted = (await MediaLibrary.getPermissionsAsync()).granted; break;
          // None is built in — see requestPermission for why. Not granted.
          case "contacts":
          case "calendar":
          case "location":
          case "tracking": granted = false; break;
        }
      } catch {
        // A module that will not load cannot tell us we have the permission.
        granted = false;
      }
      if (action.assignTo) ctx.store.set(action.assignTo, granted);
      await runAction(granted ? action.onGranted : action.onDenied, ctx);
      break;
    }

    // ---------------------------------------------------------------- auth
    case "biometricPrompt": {
      try {
        const has = await LocalAuthentication.hasHardwareAsync();
        // NOTHING TO CHECK AGAINST is not a failed check. A phone with no
        // screen lock at all (no Face ID, fingerprint or passcode) cannot
        // answer the prompt either way, and "you cancelled" and "this phone
        // can't" are different things for the screen to say. The screen names
        // what happens then (onUnavailable); without one this is what it
        // always was, an error. A passcode counts: the system prompt falls
        // back to it.
        const level = await LocalAuthentication.getEnrolledLevelAsync().catch(() => LocalAuthentication.SecurityLevel.NONE);
        if (action.onUnavailable && level === LocalAuthentication.SecurityLevel.NONE) { await runAction(action.onUnavailable, ctx); break; }
        if (!has) { await runAction(action.onError, ctx); break; }
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: fillText(action.reason, ctx) || txt("auth.biometric.prompt", "Authenticate") });
        await runAction(res.success ? action.onSuccess : action.onError, ctx);
      } catch { await runAction(action.onError, ctx); }
      break;
    }
    case "signOut":
      // The phone stops receiving this account's pushes BEFORE the session
      // goes: afterwards nothing is left to prove whose row to drop.
      await unregisterPushToken();
      await supabase.auth.signOut();
      break;

    // ----------------------------------------------------------------- IAP
    case "iap.showPaywall": {
      if (elsewhere(ctx)) break;
      try {
        // packageId is accepted alongside offeringId so backend can pick a
        // specific package (annual/monthly/etc.) without hardcoding an
        // "auto-first" pick in the app.
        const res = await buyPackage(action.offeringId, (action as any).packageId);
        // SAY WHY. The backend's onError is one fixed toast, and it cannot know
        // whether the store refused, the build shipped without a key, or the
        // user simply tapped Cancel. A cancel carries no reason and stays
        // quiet; everything else names itself, once, where it can be read.
        if (!res.ok && res.reason) {
          console.warn("[iap] purchase failed:", res.detail ?? res.reason);
          Alert.alert(txt("iap.error.title", "Couldn't start the purchase"), res.reason);
        }
        // A purchase changes quota and entitlement; the next foreground must
        // not keep showing the paywall from a bootstrap cached before it.
        if (res.ok) expireBootstrap();
        await runAction(res.ok ? action.onSuccess : action.onError, ctx);
      } catch { await runAction(action.onError, ctx); }
      break;
    }
    case "iap.subscribe": {
      if (elsewhere(ctx)) break;
      try {
        const ok = await subscribeToProduct(action.productId);
        if (ok) expireBootstrap();
        await runAction(ok ? action.onSuccess : action.onError, ctx);
      } catch { await runAction(action.onError, ctx); }
      break;
    }
    case "iap.restore": {
      try {
        await restorePurchases();
        expireBootstrap();
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
    // The app's OWN calendar (the server's, POST /v1/botsapp/calendar/events),
    // never the phone's: no calendar permission is asked for or linked. The
    // event's day and time are this phone's clock, with its offset as `tz`.
    case "calendar.addEvent": {
      try {
        const start = new Date(action.startsAtIso);
        if (isNaN(start.getTime())) throw new Error("no start");
        const end = action.endsAtIso
          ? new Date(action.endsAtIso)
          : new Date(start.getTime() + num("calendar.defaultDurationMs", 3600000));
        const pad = (n: number) => String(n).padStart(2, "0");
        const minutes = Math.max(5, Math.min(24 * 60, Math.round((end.getTime() - start.getTime()) / 60000) || 60));
        await callEndpoint("POST", "/v1/botsapp/calendar/events", {
          title: action.title,
          day: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
          time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
          minutes,
          ...(action.notes ? { notes: action.notes } : {}),
          ...(action.location ? { place: action.location } : {}),
          tz: -start.getTimezoneOffset(),
        });
        ctx.toast(txt("toast.calendarAdded", "Added to calendar"), "success");
      } catch { ctx.toast(txt("toast.calendarFailed", "Couldn't add event"), "error"); }
      break;
    }

    // ----------------------------------------------------- store review prompt
    case "requestReview":
      try { if (await StoreReview.hasAction()) await StoreReview.requestReview(); } catch { /* no-op */ }
      break;

    // --------------------------------------------------------- mic handoff
    // Finish the "keyboard tapped mic → main app records → text back to
    // keyboard" round-trip. The keyboard_record screen dispatches this with
    // the cleaned text once /v1/transcribe-clean returns.
    case "completeKeyboardHandoff": {
      const sessionId = action.sessionId
        ?? (ctx.store.get(str("kb.handoff.sessionPath", "handoffSessionId")) as string | undefined)
        ?? "";
      const text = action.text
        ?? (ctx.store.get(action.textPath ?? str("kb.handoff.textPath", "dictationSample")) as string | undefined)
        ?? "";
      if (sessionId && text) completeKeyboardHandoff(sessionId, text);
      await runAction(action.onSuccess, ctx);
      break;
    }
    case "cancelKeyboardHandoff": {
      const sessionId = action.sessionId
        ?? (ctx.store.get(str("kb.handoff.sessionPath", "handoffSessionId")) as string | undefined)
        ?? "";
      if (sessionId) cancelKeyboardHandoff(sessionId);
      await runAction(action.onSuccess, ctx);
      break;
    }

    // Arm the background-audio Flow Session. Dispatched by the SDUI arming
    // screen (kb.mic.mode="flow") when it loads: the app holds the mic alive in
    // the background so the keyboard can drive dictation after the user swipes
    // back. iOS only; a no-op on Android (records in-process). idleTimeoutMs is
    // backend-authored on the action; without one, the same kb.flow.idleTimeoutMs
    // the shell arms with (it used to fall back to 5 min here and 10 on the
    // server, so an action without the field armed a shorter session).
    case "armFlowSession":
      await armFlow(Number(action.idleTimeoutMs ?? num("kb.flow.idleTimeoutMs", 600000)), action.oneShot === true);
      await runAction(action.onSuccess, ctx);
      break;

    // End the background-audio Flow Session NOW — the user-facing off switch
    // for the background microphone (App Review requires the user to be able
    // to stop a background capture without force-quitting). Backend wires it
    // from Settings; safe no-op when no session is armed.
    case "endFlowSession": {
      endFlowSession();
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
