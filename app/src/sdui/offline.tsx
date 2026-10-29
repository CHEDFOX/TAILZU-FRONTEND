/**
 * OFFLINE, ON THE PHONE (the server's shared/types/sdui.ts 3e; docs/bots-app.md "Offline").
 *
 *   the connection   NetInfo's reading: offline when it says there is no connection or no internet; unknown counts as online.
 *   the outbox       outboxCore.ts, kept in AsyncStorage under tulmi.cache.outbox (which goes with the account at sign-out), sent
 *                    in order whenever the phone is online, by POST /v1/shell/ask with each ask's own client id.
 *   every screen     gets `online`, `outbox` and `outboxWaiting` in its state (useOfflineState), so the server draws them.
 *   the Offline page while offline, a screen the bootstrap lists in `offline.roots` (Home) is shown as `offline.screenId`, kept
 *                    from when the phone was last online; it goes back when the connection returns (useOfflineSwitch). Any other
 *                    screen shows the line `offline.bar` over it (OfflineBar). When kept asks have gone, `offline.sentToast`.
 */
import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import { callEndpoint, peekScreen, prefetchScreens } from "./client";
import { clockText, Outbox } from "./outboxCore";
import { fillText, resolveValue, type Scope } from "./fill";
import { color, list, num, str, txt } from "./knobs";
import type { Store } from "./state";

const KEY = "tulmi.cache.outbox";

// --------------------------------------------------------------- the connection

let online: boolean | null = null;
const onlineListeners = new Set<(v: boolean) => void>();
let netOff: (() => void) | null = null;

function startNet(): void {
  if (netOff) return;
  netOff = NetInfo.addEventListener((s) => {
    const v = s.isConnected === false || s.isInternetReachable === false ? false : s.isConnected === true ? true : null;
    if (v === null || v === online) return;
    online = v;
    onlineListeners.forEach((f) => { try { f(v); } catch { /* a listener's own problem */ } });
  });
}

function onOnline(f: (v: boolean) => void): () => void {
  startNet();
  onlineListeners.add(f);
  return () => { onlineListeners.delete(f); };
}

/** The phone's connection: true, false, or null before the first reading. */
export function useOnline(): boolean | null {
  const [v, setV] = useState<boolean | null>(online);
  useEffect(() => onOnline(setV), []);
  return v;
}

// --------------------------------------------------------------- the outbox

export const outbox = new Outbox({
  load: () => AsyncStorage.getItem(KEY),
  save: (j) => AsyncStorage.setItem(KEY, j),
  send: (path, body) => callEndpoint("POST", path, body),
  now: () => Date.now(),
  newId: () => Crypto.randomUUID(),
  timeText: (ms) => clockText(ms),
}, {
  // The server's (outbox.max, at most 20; outbox.keepSentMs), read each time, so a new bootstrap's hold.
  max: () => num("outbox.max", 20),
  keepSentMs: () => num("outbox.keepSentMs", 86400000),
});

let sentListener: ((n: number) => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  const due = outbox.nextDue();
  if (due == null || online === false) return;
  timer = setTimeout(() => { timer = null; void sendOutbox(); }, Math.max(1000, due - Date.now()));
}

/** Send what waits, if the phone is online, and come back for what has to wait its turn. */
export async function sendOutbox(): Promise<void> {
  if (online === false) return;
  const n = await outbox.flush(true).catch(() => 0);
  if (n > 0) sentListener?.(n);
  schedule();
}

/** Start sending whenever the phone is online. `onSent` hears how many went. */
export function startOutbox(onSent: (n: number) => void): () => void {
  sentListener = onSent;
  const off = onOnline((v) => {
    if (v) void sendOutbox();
    else if (timer) { clearTimeout(timer); timer = null; }
  });
  void outbox.ready().then(() => sendOutbox());
  return () => { off(); if (sentListener === onSent) sentListener = null; };
}

/** The `outbox` action: add · remove · retry · clear (shared/types/sdui.ts). */
export async function runOutboxAction(
  a: { op?: unknown; path?: unknown; body?: unknown; label?: unknown; sub?: unknown; id?: unknown },
  ctx: Scope & { toast: (m: string, tone?: string) => void },
): Promise<void> {
  switch (a.op) {
    case "add": {
      const e = outbox.add({ path: a.path, body: resolveValue(a.body ?? {}, ctx), label: fillText(a.label, ctx), sub: fillText(a.sub ?? "", ctx) });
      if (!e) { ctx.toast(txt("outbox.notKept", "Couldn't keep that ask."), "error"); return; }
      void sendOutbox();
      return;
    }
    case "remove": outbox.remove(resolveValue(a.id, ctx)); return;
    case "retry": if (outbox.retry(resolveValue(a.id, ctx))) void sendOutbox(); return;
    case "clear": outbox.clear(); return;
  }
}

// --------------------------------------------------------------- what every screen reads

/** Puts `online`, `outbox` and `outboxWaiting` in a screen's state, and keeps them current. */
export function useOfflineState(store: Store): void {
  const on = useOnline();
  useEffect(() => {
    // Each write re-renders the screen, so only what changed is written.
    let last = "";
    const put = () => {
      const v = outbox.view();
      const key = JSON.stringify(v);
      if (key === last) return;
      last = key;
      store.set("outbox", v.outbox);
      store.set("outboxWaiting", v.outboxWaiting);
    };
    put();
    void outbox.ready().then(put);
    return outbox.subscribe(put);
  }, [store]);
  useEffect(() => { if (store.get("online") !== (on !== false)) store.set("online", on !== false); }, [store, on]);
}

// --------------------------------------------------------------- the Offline page, and the line over the others

type NavItem = { screenId: string; params?: Record<string, any> };

/**
 * While offline, a screen listed in `offline.roots` (Home) is shown as `offline.screenId` (only if a copy is kept, so a phone that has
 * never had it does not trade Home for an error); when the connection returns, what it stood in for comes back. The Offline page is
 * fetched (and so kept) whenever the phone is online.
 */
export function useOfflineSwitch(o: { ready: boolean; top: NavItem | undefined; online: boolean | null; replace: (screenId: string, params?: Record<string, any>) => void }): void {
  const from = useRef<NavItem | null>(null);
  const offlineId = str("offline.screenId", "");
  const topId = o.top?.screenId;
  useEffect(() => {
    if (!o.ready || !offlineId || !o.top) return;
    if (o.online === false && list<string>("offline.roots", []).includes(o.top.screenId) && peekScreen(offlineId)) {
      from.current = o.top;
      o.replace(offlineId);
    } else if (o.online === true && o.top.screenId === offlineId && from.current) {
      const back = from.current;
      from.current = null;
      o.replace(back.screenId, back.params);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.ready, o.online, topId, offlineId]);
  useEffect(() => {
    if (o.ready && o.online !== false && offlineId) void prefetchScreens([offlineId]);
  }, [o.ready, o.online, offlineId]);
}

/** The line over any other screen while offline (Kit3's "You're offline · I'll keep working and catch you up"). */
export function OfflineBar({ online: on, screenId, top }: { online: boolean | null; screenId?: string; top: number }) {
  const words = str("offline.bar", "");
  if (on !== false || !words || (screenId && screenId === str("offline.screenId", ""))) return null;
  const font = str("offline.bar.font", "");
  return (
    <View pointerEvents="none" style={{ position: "absolute", top, left: 16, right: 16, alignItems: "center" }} accessibilityLiveRegion="polite">
      <View style={{
        backgroundColor: color("offline.bar.bg", "#FFFFFF"), borderColor: color("offline.bar.border", "#E6E6E6"), borderWidth: 1,
        borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14,
      }}>
        <Text style={{ fontSize: 13, lineHeight: 18, color: color("offline.bar.text", "#0A0A0A"), ...(font ? { fontFamily: font } : null) }}>{words}</Text>
      </View>
    </View>
  );
}
