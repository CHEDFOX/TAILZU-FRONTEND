/**
 * THE NUMBER THIS INSTALL MADE UP ABOUT ITSELF (docs: perms2 8.4). A random v4 UUID, made from 16 random bytes and nothing else,
 * kept in AsyncStorage under `tulmi.installId`.
 *
 * It is MADE, not derived: no part of the phone goes into it — not its name, model, boot time, screen, locale, keyboards or
 * anything at all about its network — so it is not data derived from a device. It lives in AsyncStorage, never the Keychain and
 * never the App Group, so a reinstall throws it away and the next install is a different phone as far as the server knows
 * (Android too: the app does not allow backup). It is only ever COUNTED by the server, to catch the sign-out, new email, sign-in
 * loop on one phone, and never used to link one account to another.
 *
 * It is made on first use and sent only while the last bootstrap's flags say `trust.installId` (sdui/client/http.ts), so until the
 * owner turns that on, nothing leaves the phone.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { installIdOk, uuidV4From } from "./trustCore";

const KEY = "tulmi.installId";

let cached: string | null = null;

/** This install's number, made on the first call that needs it. null when storage cannot be read or written. */
export async function installId(): Promise<string | null> {
  if (cached) return cached;
  try {
    const kept = await AsyncStorage.getItem(KEY);
    if (installIdOk(kept)) {
      cached = kept;
      return cached;
    }
    const made = uuidV4From(Crypto.getRandomBytes(16));
    await AsyncStorage.setItem(KEY, made);
    cached = made;
    return cached;
  } catch {
    // Nothing is guessed from the device instead: no number is better than a derived one.
    return null;
  }
}
