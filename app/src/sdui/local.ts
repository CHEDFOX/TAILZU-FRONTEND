/**
 * PHONE-LOCAL VALUES on the phone (spec 2.9, B9): `local.*` names and the local.set / local.remove actions.
 * MMKV (already linked) when the binary has it; otherwise a memory copy mirrored to AsyncStorage (call hydrateLocal() once).
 * Rules and limits live in localCore.ts.
 *
 * FOR V1:
 *  - read `local.<path>` with getLocal(path); subscribe with subscribeLocal(cb).
 *  - actions local.set / local.remove call setLocal(path, value) / removeLocal(path); on { ok:false } run the action's onError.
 *  - call setLocalAccount(userId) when the session changes.
 *  - SIGN-OUT: call clearLocal() inside forgetAccountData() (src/sdui/client/bootstrap.ts). useAuthSession already calls it on
 *    every SIGNED_OUT (sign-out, account deletion, a revoked session), so one call covers every path and a different person
 *    on the same phone starts empty.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BlockRegistry } from "./blockRegistry";
import { LOCAL_SPEC, LocalStore, memoryKV, type KV, type LocalResult } from "./localCore";

export { LOCAL_SPEC as SPEC } from "./localCore";
export function registerLocal(registry: BlockRegistry): void {
  registry.addBlock("local", LOCAL_SPEC);
}

const ASYNC_KEY = "tulmi.local.v1";
let mirror: KV | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function mmkvKV(): KV | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMMKV } = require("react-native-mmkv");
    const m = createMMKV({ id: "tailzu.local" });
    return {
      get: (k) => m.getString(k),
      set: (k, v) => m.set(k, v),
      delete: (k) => { m.remove(k); },
      keys: () => m.getAllKeys(),
    };
  } catch {
    return null;   // not in this binary: AsyncStorage mirror below
  }
}

function asyncKV(): KV {
  const mem = memoryKV();
  mirror = mem;
  const persist = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const o: Record<string, string> = {};
      for (const k of mem.keys()) o[k] = mem.get(k) as string;
      AsyncStorage.setItem(ASYNC_KEY, JSON.stringify(o)).catch(() => {});
    }, 50);
  };
  return { get: mem.get, keys: mem.keys, set: (k, v) => { mem.set(k, v); persist(); }, delete: (k) => { mem.delete(k); persist(); } };
}

const store = new LocalStore(mmkvKV() ?? asyncKV());

/** Load the AsyncStorage copy (only when MMKV is absent). Await once at start; harmless otherwise. */
export async function hydrateLocal(): Promise<void> {
  if (!mirror) return;
  try {
    const raw = await AsyncStorage.getItem(ASYNC_KEY);
    const o = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const k of Object.keys(o)) if (typeof o[k] === "string" && mirror.get(k) === undefined) mirror.set(k, o[k] as string);
    store.recount();
    store.notifyAll();
  } catch { /* start empty */ }
}

export const getLocal = (path: string): unknown => store.get(path);
export const allLocal = (): Record<string, unknown> => store.all();
export const setLocal = (path: string, value: unknown): LocalResult => store.set(path, value);
export const removeLocal = (path: string): LocalResult => store.remove(path);
export const setLocalAccount = (id: string | null | undefined): void => store.setAccount(id);
export const subscribeLocal = (cb: (path: string) => void): (() => void) => store.subscribe(cb);

/** Sign-out: wipe every namespace (and the AsyncStorage copy). */
export function clearLocal(): void {
  store.clearAll();
  if (mirror) AsyncStorage.removeItem(ASYNC_KEY).catch(() => {});
}
