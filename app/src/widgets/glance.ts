/**
 * THE X0 WIDGET'S DATA, BOTH PLATFORMS (the contract: the backend's docs/widget-glance-v2.md). One widget, X0, shows the whole
 * app at a glance and leads with what matters now: something that needs the person, bots working, a thing just done, or all
 * quiet. iOS: targets/widgets (kind space.tailzu.x0) and the "Bots at work" Live Activity; Android: TailzuX0Widget.kt.
 *
 * The widgets never ask the server. The app does, here: GET /v1/shell/glance?v=2&tz= on the person's session, checked by
 * glanceCore.cleanGlance, then
 *   1. the bots' faces (each bot's faceUrl) downloaded once per picture into faces/<face>.png in the App Group container (iOS)
 *      or widget-faces/<face>.png in the app's files dir (Android): the widgets draw them from there and never fetch;
 *   2. the glance written under `x0.glance` (setWidgetGlance), and the widget redrawn;
 *   3. iOS: the Bots at work Live Activity started, updated or ended to match (glanceCore.activityPlan), and its push token
 *      registered at POST /v1/widgets/activity-token whenever it appears or changes.
 *
 * When: on launch and every bootstrap, coming to the front (no more often than the server's refreshAfterSec), on a push and
 * after an answer (at once), and as the app leaves the front (the widget is what the person sees next; at most every
 * widgets.glance.floorSec). Answers from the widget itself go through POST /v1/widgets/act on the widgets' own narrow token
 * (now.ts), the same as the quick-access widgets'.
 *
 * Knobs: widgets.glance.enabled (the kill switch), widgets.glance.path, widgets.glance.floorSec, widgets.glance.faceTimeoutMs,
 * widgets.activity.enabled, widgets.activity.tokenPath, widgets.activity.doneSec.
 */
import { AppState, Platform, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import {
  addBotsActivityTokenListener,
  beginBackgroundWork,
  botsActivityPushToken,
  endBackgroundWork,
  endBotsActivity,
  setWidgetGlance,
  startBotsActivity,
  updateBotsActivity,
} from "../../modules/tulmi-bridge";
import { callEndpoint } from "../sdui/client";
import { bool, num, str } from "../sdui/knobs";
import {
  activityPlan,
  cleanGlance,
  faceSources,
  facesToFetch,
  glanceDue,
  isPng,
  type ActivityMemo,
  type ActivityOp,
} from "./glanceCore";

/** The App Group the app and the widget extension share (app.config.ts entitlements). */
const APP_GROUP = "group.com.tulmi.app";
const FACES_KEY = "x0.widgets.faces";
const ACTIVITY_KEY = "x0.widgets.botsActivity";
const ACTIVITY_TOKEN_KEY = "x0.widgets.botsActivityToken";

let lastAt = 0;
let refreshAfterSec = 0;
let inFlight: Promise<void> | null = null;
/** A forced refresh asked for while one was out: run again when it lands (an answer must not be missed by a fetch begun before it). */
let again = false;
/** Bumped at sign-out, so work that started before it never writes the old account back. */
let epoch = 0;
let watching = false;
/** Whether a signed-in refresh has run since launch or sign-out: leaving the front asks again only then. */
let live = false;

const native = () => Platform.OS === "ios" || Platform.OS === "android";
const ios = () => Platform.OS === "ios";

// ------------------------------------------------------------------ faces

/** Where the widget looks for faces: the App Group container's faces/ (iOS), the files dir's widget-faces/ (Android). */
function facesDir(): Directory | null {
  try {
    if (Platform.OS === "ios") {
      const group = Paths.appleSharedContainers[APP_GROUP];
      return group ? new Directory(group, "faces") : null;
    }
    if (Platform.OS === "android") return new Directory(Paths.document, "widget-faces");
  } catch {
    // no container (a build without the App Group): faces are discs with initials
  }
  return null;
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const writeJson = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});

/** One face: downloaded to the cache, checked to be a PNG, then moved into place (the widget never reads half a file). */
async function fetchFace(dir: Directory, face: string, url: string, timeoutMs: number): Promise<boolean> {
  const tmp = new File(Paths.cache, `x0-face-${face}.png`);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    if (tmp.exists) tmp.delete();
    const got = await File.downloadFileAsync(url, tmp, { idempotent: true, signal: abort.signal });
    if (!isPng(await got.bytes())) {
      got.delete();
      return false;
    }
    await got.move(new File(dir, `${face}.png`), { overwrite: true });
    return true;
  } catch {
    try { if (tmp.exists) tmp.delete(); } catch { /* the cache is the system's to clear */ }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Every face the glance names that is not on the phone yet, or whose picture changed. Never throws. */
async function syncFaces(g: NonNullable<ReturnType<typeof cleanGlance>>): Promise<void> {
  const dir = facesDir();
  if (!dir) return;
  const have = (await readJson<Record<string, string>>(FACES_KEY)) ?? {};
  const want = facesToFetch(faceSources(g), have);
  if (want.length === 0) return;
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch {
    return;
  }
  const timeoutMs = num("widgets.glance.faceTimeoutMs", 8000);
  const got = await Promise.all(want.map((w) => fetchFace(dir, w.face, w.url, timeoutMs)));
  const next = { ...have };
  want.forEach((w, i) => { if (got[i]) next[w.face] = w.url; });
  await writeJson(FACES_KEY, next);
}

// ------------------------------------------------------------------ the Live Activity (iOS)

/** The activity's push token, registered once per job and token. */
async function registerActivityToken(token: string | null, jobId: string | undefined): Promise<void> {
  if (!token || !jobId || !bool("widgets.activity.enabled", true)) return;
  const key = `${jobId}:${token}`;
  if ((await AsyncStorage.getItem(ACTIVITY_TOKEN_KEY).catch(() => null)) === key) return;
  try {
    await callEndpoint("POST", str("widgets.activity.tokenPath", "/v1/widgets/activity-token"), { jobId, token, platform: "ios" });
    await AsyncStorage.setItem(ACTIVITY_TOKEN_KEY, key).catch(() => {});
  } catch {
    // offline or an older server: tried again after the next glance
  }
}

function runOp(op: ActivityOp): void {
  const json = JSON.stringify({ jobId: op.jobId, state: op.state, ...(op.dismissAfterSec != null ? { dismissAfterSec: op.dismissAfterSec } : {}) });
  if (op.op === "start") startBotsActivity(json);
  else if (op.op === "update") updateBotsActivity(json);
  else endBotsActivity(json);
}

/** Bring the activity in line with the glance (contract §6). The server's switch off ends a running one. */
async function syncActivity(g: NonNullable<ReturnType<typeof cleanGlance>>): Promise<void> {
  if (!ios()) return;
  const memo = await readJson<ActivityMemo>(ACTIVITY_KEY);
  const on = bool("widgets.activity.enabled", true);
  const plan = on
    ? activityPlan(g, memo, Date.now(), num("widgets.activity.doneSec", 900))
    : { ops: memo ? [{ op: "end" as const, jobId: memo.jobId, state: memo.state, dismissAfterSec: 0 }] : [], memo: null };
  for (const op of plan.ops) runOp(op);
  if (plan.memo) await writeJson(ACTIVITY_KEY, plan.memo);
  else {
    await AsyncStorage.multiRemove([ACTIVITY_KEY, ACTIVITY_TOKEN_KEY]).catch(() => {});
    return;
  }
  await registerActivityToken(botsActivityPushToken(), plan.memo.jobId);
}

// ------------------------------------------------------------------ when

/** Watch the app leave the front (the widget is what the person sees next) and the activity's token arrive. Once. */
function watch(): void {
  if (watching) return;
  watching = true;
  AppState.addEventListener("change", (s: AppStateStatus) => {
    if (s !== "background") return;
    // A little background time on iOS, so the request is out before the app is put to sleep.
    const work = beginBackgroundWork();
    void refreshGlance({ mode: "soon" }).finally(() => endBackgroundWork(work));
  });
  if (ios()) {
    addBotsActivityTokenListener((token, jobId) => {
      void readJson<ActivityMemo>(ACTIVITY_KEY).then((m) => registerActivityToken(token, jobId ?? m?.jobId));
    });
  }
}

/**
 * Fetch the glance and hand it to the X0 widget (and the Live Activity). `force`: something just changed (a push, an answer),
 * so the server's interval does not hold it back; `mode: "soon"` (leaving the front) asks again unless it just did. Never
 * throws; one at a time.
 */
export function refreshGlance(o: { force?: boolean; mode?: "due" | "soon" | "force" } = {}): Promise<void> {
  if (!native() || !bool("widgets.glance.enabled", true)) return Promise.resolve();
  watch();
  const mode = o.force ? "force" : o.mode ?? "due";
  if (mode === "soon" && !live) return Promise.resolve();
  if (mode !== "soon") live = true;
  if (inFlight) {
    if (mode === "force") again = true;
    return inFlight;
  }
  const now = Date.now();
  if (!glanceDue(lastAt, now, refreshAfterSec, mode, num("widgets.glance.floorSec", 15))) return Promise.resolve();
  const mine = epoch;
  inFlight = (async () => {
    try {
      lastAt = now;
      const tz = -new Date().getTimezoneOffset();
      const g = cleanGlance(await callEndpoint("GET", `${str("widgets.glance.path", "/v1/shell/glance")}?v=2&tz=${tz}`), now);
      if (!g || mine !== epoch) return;
      refreshAfterSec = g.refreshAfterSec;
      // The faces first, so the widget's first draw of this glance has them (each bounded: a slow picture never holds it).
      await syncFaces(g);
      if (mine !== epoch) return;
      setWidgetGlance(JSON.stringify(g));
      await syncActivity(g);
    } catch {
      // offline, signed out, an older server: the widget keeps what it last had
      lastAt = 0;
    } finally {
      inFlight = null;
      if (again) {
        again = false;
        void refreshGlance({ force: true });
      }
    }
  })();
  return inFlight;
}

/** SIGN-OUT: nothing of the account stays in the widget, its faces or a Live Activity. */
export function forgetGlance(): void {
  epoch++;
  again = false;
  live = false;
  lastAt = 0;
  refreshAfterSec = 0;
  setWidgetGlance(null);
  // "" ends every Bots at work activity, whichever job it shows.
  if (ios()) endBotsActivity("");
  void (async () => {
    await AsyncStorage.multiRemove([ACTIVITY_KEY, ACTIVITY_TOKEN_KEY, FACES_KEY]).catch(() => {});
    try {
      const dir = facesDir();
      if (dir?.exists) dir.delete();
    } catch {
      // a face left behind is a bot's picture, nothing of the person's
    }
  })();
}
