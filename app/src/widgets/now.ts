/**
 * THE QUICK-ACCESS WIDGETS' DATA: "From your people" (targets/widgets PeopleWidget.swift, the Android bridge's
 * TailzuPeopleWidget in TailzuQuickWidgets.kt). Needs you was retired for the X0 widget (glance.ts), whose answers post on the
 * same narrow token this file keeps.
 *
 * The widgets never ask the server. The app does, here: GET /v1/widgets/now answers both widgets' rows already worded, with
 * where each tap goes, each button and how it answers, and everything they are drawn with; the app checks it (nowCore.cleanNow)
 * and writes it as it is to the App Group (iOS) / its SharedPreferences (Android), and the widgets are redrawn. Asked on launch,
 * on coming to the front, when a push arrives, and after an answer, never more often than the server's `fetchSec`.
 *
 * Answering in place: the widgets' buttons post with a narrow token of their own (POST /v1/widgets/token; backend
 * src/widgets/token.ts) that can only answer this person's needs-you and tick their own tasks, and runs out in a day. The app asks
 * for it here, keeps it in the shared Keychain (iOS) / private SharedPreferences (Android) through the bridge, and asks again
 * well before it runs out. The session's token never goes near a widget. Sign-out revokes it on the server and deletes it here.
 *
 * Knobs: widgets.now.enabled (the app's kill switch), widgets.now.path, widgets.token.path, widgets.now.fetchSec (until the server's
 * own arrives with the rows).
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setWidgetNow, setWidgetToken } from "../../modules/tulmi-bridge";
import { callEndpoint } from "../sdui/client";
import { bool, num, str } from "../sdui/knobs";
import { getBaseUrl } from "../storage";
import { cleanNow, fetchDue, installId, tokenDue, type TokenMeta } from "./nowCore";

const ID_KEY = "x0.widgets.installId";
const TOKEN_META_KEY = "x0.widgets.tokenMeta";

let lastAt = 0;
let lastRev = "";
let serverFetchSec: number | null = null;
let inFlight: Promise<void> | null = null;

const native = () => Platform.OS === "ios" || Platform.OS === "android";

/** This phone's id for its widget token: made once, kept. */
async function deviceId(): Promise<string> {
  try {
    const have = await AsyncStorage.getItem(ID_KEY);
    if (have && /^[A-Za-z0-9_-]{8,64}$/.test(have)) return have;
    const id = installId();
    await AsyncStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    return installId();
  }
}

async function readMeta(): Promise<TokenMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(TOKEN_META_KEY);
    const m = raw ? (JSON.parse(raw) as TokenMeta) : null;
    return m && typeof m.expiresAt === "number" && typeof m.issuedAt === "number" ? m : null;
  } catch {
    return null;
  }
}

/** No token for the widgets (answering in place is off): the widget's copy goes, and so does what says when to renew it. */
async function dropToken(): Promise<void> {
  if (!(await readMeta())) return;
  setWidgetToken(null);
  await AsyncStorage.removeItem(TOKEN_META_KEY).catch(() => {});
}

/**
 * The widgets' token, asked for when there is none or it is past the share of its life the server set. The server says no
 * (`token: null`) when answering in place is switched off: the widget's copy is then deleted, and every button opens the app.
 */
async function ensureToken(): Promise<void> {
  const now = Date.now();
  if (!tokenDue(await readMeta(), now)) return;
  const r = await callEndpoint("POST", str("widgets.token.path", "/v1/widgets/token"), { device: await deviceId(), platform: Platform.OS })
    .catch(() => undefined) as { token?: unknown; expiresAt?: unknown; renewAt?: unknown; path?: unknown } | undefined;
  if (!r) return;   // offline: the old one (if any) stands until it runs out
  if (typeof r.token !== "string" || typeof r.expiresAt !== "number") {
    setWidgetToken(null);
    await AsyncStorage.removeItem(TOKEN_META_KEY).catch(() => {});
    return;
  }
  setWidgetToken({
    token: r.token,
    expiresAt: r.expiresAt,
    baseUrl: await getBaseUrl(),
    path: typeof r.path === "string" && r.path.startsWith("/v1/") ? r.path : "/v1/widgets/act",
  });
  const meta: TokenMeta = { issuedAt: now, expiresAt: r.expiresAt, ...(typeof r.renewAt === "number" ? { renewAt: r.renewAt } : {}) };
  await AsyncStorage.setItem(TOKEN_META_KEY, JSON.stringify(meta)).catch(() => {});
}

/**
 * Fetch both widgets' rows and hand them to the widgets. `force`: something just changed (a push, an answer), so the server's
 * interval does not hold it back. Never throws; one at a time.
 */
export function refreshWidgetsNow(o: { force?: boolean } = {}): Promise<void> {
  if (!native() || !bool("widgets.now.enabled", true)) return Promise.resolve();
  if (inFlight) return inFlight;
  const now = Date.now();
  if (!fetchDue(lastAt, now, serverFetchSec ?? num("widgets.now.fetchSec", 60), !!o.force)) return Promise.resolve();
  inFlight = (async () => {
    try {
      lastAt = now;
      const tz = -new Date().getTimezoneOffset();
      const path = `${str("widgets.now.path", "/v1/widgets/now")}?tz=${tz}&platform=${Platform.OS}`;
      const doc = cleanNow(await callEndpoint("GET", path));
      if (!doc) return;
      if (typeof doc.fetchSec === "number" && Number.isFinite(doc.fetchSec)) serverFetchSec = doc.fetchSec;
      // The token first, so a row's button never meets a widget without one.
      if ((doc.act as { inPlace?: unknown } | undefined)?.inPlace === true) await ensureToken();
      else await dropToken();
      const rev = typeof doc.rev === "string" ? doc.rev : "";
      if (rev && rev === lastRev) return;
      lastRev = rev;
      setWidgetNow(JSON.stringify(doc));
    } catch {
      // offline, signed out, an older server: the widgets keep what they last had
      lastAt = 0;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * SIGN-OUT, FIRST HALF: while the session still stands, the server revokes this phone's widget token (bounded: signing out
 * never waits on the network). The second half (forgetWidgets) runs when the session has gone.
 */
export async function revokeWidgetToken(): Promise<void> {
  if (!native()) return;
  const work = (async () => {
    const device = await deviceId();
    await callEndpoint("DELETE", str("widgets.token.path", "/v1/widgets/token"), { device });
  })().catch(() => { /* the token runs out on its own within a day */ });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((r) => { timer = setTimeout(r, 2500); })]);
  if (timer) clearTimeout(timer);
}

/** SIGN-OUT, SECOND HALF: nothing of the account stays in a widget, and its token goes from the Keychain. */
export function forgetWidgets(): void {
  lastAt = 0;
  lastRev = "";
  serverFetchSec = null;
  setWidgetNow(null);
  setWidgetToken(null);
  void AsyncStorage.removeItem(TOKEN_META_KEY).catch(() => {});
}
