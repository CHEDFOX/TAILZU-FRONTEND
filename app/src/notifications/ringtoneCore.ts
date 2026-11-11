/**
 * THE IPHONE'S RINGTONE, PUT IN PLACE: the steps, free of expo-file-system and expo-asset so each is tested on its own
 * (ringtoneCore.test.ts); ringtone.ios.ts hands in the real files.
 *
 * iOS plays a notification sound the push names only from a few places, and the App Group container's Library/Sounds is the
 * one this app can write from an update. So the tone ships inside the update as an app asset (assets/sounds/x0_ring_1.wav), and
 * on launch it is copied there: into a ".part" file first, then moved over the real name, so iOS never reads half a file. Once
 * it is there the push token says so (BotRingtone, callsCore.ts) and the server names it; until then it sends "default".
 * Nothing here ever throws: a failure only means the default sound.
 */
import { RINGTONE_FILE } from "./callsCore.ts";

/** Smaller than this, the file at the tone's name is not the tone (an interrupted copy): copied again. The tone is 882,044 bytes. */
export const RINGTONE_MIN_BYTES = 100_000;

/** The parts of an expo-file-system File the install uses. */
export interface FileLike {
  readonly exists: boolean;
  readonly size?: number | null;
  delete(): void;
  copy(to: FileLike): Promise<void>;
  move(to: FileLike, o: { overwrite: boolean }): Promise<void>;
}

export interface RingtoneIO {
  /** The App Group container's Library/Sounds, or null when the binary has no App Group. */
  soundsDir(): unknown;
  /** Make that folder (with its parents; fine when it is already there). */
  makeDir(dir: unknown): void;
  /** A file in that folder. */
  file(dir: unknown, name: string): FileLike;
  /** The tone shipped in this update, on disk: its file:// address, or "" when it could not be had. */
  bundled(): Promise<string>;
  /** The file at an address. */
  fileAt(uri: string): FileLike;
}

/** The tone in place: true when it is there now (already, or copied just now), false on any failure. */
export async function installRingtone(io: RingtoneIO): Promise<boolean> {
  let tmp: FileLike | null = null;
  try {
    const dir = io.soundsDir();
    if (!dir) return false;
    io.makeDir(dir);
    const dest = io.file(dir, RINGTONE_FILE);
    if (dest.exists && (dest.size ?? 0) > RINGTONE_MIN_BYTES) return true;
    const uri = await io.bundled();
    if (!uri) return false;
    tmp = io.file(dir, `${RINGTONE_FILE}.part`);
    if (tmp.exists) tmp.delete();
    await io.fileAt(uri).copy(tmp);
    await tmp.move(dest, { overwrite: true });
    tmp = null;
    return dest.exists;
  } catch {
    // Half a copy is not left behind for the next launch to trip on.
    try { if (tmp?.exists) tmp.delete(); } catch { /* the next launch deletes it first */ }
    return false;
  }
}

/**
 * `ringtoneReady(timeoutMs)`: one install per launch, however often it is asked, and an answer within `timeoutMs` (the push
 * token's registration waits on it, and must not wait long). Past the time, the answer is whether the tone is there now; the
 * install carries on, and the next launch's registration says what it did.
 */
export function ringtoneOnce(
  install: () => Promise<boolean>,
  installedNow: () => boolean,
): (timeoutMs?: number) => Promise<boolean> {
  let running: Promise<boolean> | null = null;
  const now = () => { try { return installedNow(); } catch { return false; } };
  return (timeoutMs = 2000) => {
    if (!running) running = install().catch(() => false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<boolean>((r) => { timer = setTimeout(() => r(now()), Math.max(0, timeoutMs)); });
    return Promise.race([running, late]).finally(() => { if (timer) clearTimeout(timer); });
  };
}
