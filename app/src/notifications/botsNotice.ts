/**
 * THE ANDROID "BOTS AT WORK" NOTICE, FROM THE APP (native/SPEC.md sections 1.4 and 3.4). Android has no Live Activity; what it has, from
 * this build, is an ongoing notification (a status-bar chip on Android 16, an ordinary ongoing progress notice below that) that says what
 * a bot is doing while it does it. The native side (TailzuBotsUpdate.kt) posts it from a state kept in prefs and reposts it on the X0
 * tick with the minutes counted on; this file is what feeds it.
 *
 *   syncBotsNotice(g)   after each glance: the same plan the iPhone's Live Activity follows (glanceCore activityPlan), played as
 *                       setBotsUpdate(state) on a start or an update and endBotsUpdate() on an end. The notice ends with the job
 *   applyNoticePush     the data-only push the server sends while the app is shut (backgroundCore.ts checks it): repost or end
 *   forgetBotsNotice    sign-out: the notice goes, and its state with it
 *
 * LAUNCH DARK, twice over. The app plays its own plan only when the server has turned the notice on (flag widgets.notice.enabled, off
 * unless the server says), and a push is only ever sent by a server whose ANDROID_BOTS_NOTICE is on, to a binary that said LiveUpdate1.
 * Every bridge call goes through bridge.ts, so a binary without the code is never asked for it.
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { hasBinaryFeature } from "../device/binary";
import { bool } from "../sdui/knobs";
import { endBotsUpdate, setBotsUpdate } from "../native/bridge";
import { activityPlan, type ActivityMemo, type Glance } from "../widgets/glanceCore";
import { nudgeOf } from "./backgroundCore";

const KEY = "x0.widgets.botsNotice";
/** "1" while the app last saw the server's notice switch off. */
const OFF = "x0.widgets.botsNotice.off";

const can = (): boolean => Platform.OS === "android" && hasBinaryFeature("liveUpdate");

async function readMemo(): Promise<ActivityMemo | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ActivityMemo) : null;
  } catch {
    return null;
  }
}

/** Bring the notice in line with the glance. Never throws. The server's switch off ends a standing one. */
export async function syncBotsNotice(g: Glance): Promise<void> {
  if (!can()) return;
  try {
    const memo = await readMemo();
    const on = bool("widgets.notice.enabled", false);
    // Remembered for applyNoticePush, which runs while the app is shut and cannot read the live flag.
    void (on ? AsyncStorage.removeItem(OFF) : AsyncStorage.setItem(OFF, "1")).catch(() => {});
    // A notice has no "done" state to linger in: it ends with the job (doneSec 0).
    const plan = on ? activityPlan(g, memo, Date.now(), 0) : { ops: memo ? [{ op: "end" as const, jobId: memo.jobId, state: memo.state }] : [], memo: null };
    for (const op of plan.ops) {
      if (op.op === "end") endBotsUpdate();
      else setBotsUpdate(JSON.stringify(op.state));
    }
    if (plan.memo) await AsyncStorage.setItem(KEY, JSON.stringify(plan.memo)).catch(() => {});
    else await AsyncStorage.removeItem(KEY).catch(() => {});
  } catch {
    // a notice never stops a glance
  }
}

/** The notice's data push, played: true when it was one. Never throws. */
export function applyNoticePush(payload: unknown): boolean {
  if (!can()) return false;
  try {
    const n = nudgeOf(payload);
    if (!n || n.kind !== "notice") return false;
    if (n.event === "end" || !n.json) {
      endBotsUpdate();
      void AsyncStorage.removeItem(KEY).catch(() => {});
      return true;
    }
    // The switch's LAST-KNOWN value, as syncBotsNotice saw it: a headless push may run before any bootstrap is loaded, so the
    // live flag cannot be read here. Off (the app last saw it off) ends the notice instead, so the two paths never fight.
    const json = n.json;
    void AsyncStorage.getItem(OFF)
      .then((off) => { if (off === "1") endBotsUpdate(); else setBotsUpdate(json); })
      .catch(() => setBotsUpdate(json));
    return true;
  } catch {
    return false;
  }
}

/** SIGN-OUT: the notice goes, and the memo of what it showed. */
export function forgetBotsNotice(): void {
  if (!can()) return;
  try { endBotsUpdate(); } catch { /* nothing posted */ }
  void AsyncStorage.removeItem(KEY).catch(() => {});
}
