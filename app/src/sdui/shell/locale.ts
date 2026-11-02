/** The language and layout direction a boot takes from the server and the phone. */
import { I18nManager } from "react-native";
import * as Updates from "expo-updates";
import type { LanguageOption } from "../types";
import { str, list } from "../knobs";

/**
 * Apply the layout direction the backend asked for (RTL for Arabic/Hebrew/…).
 * React Native only flips layout after a reload, so when the direction actually
 * changes we force it and restart the bundle. It's a no-op when already correct,
 * so this never loops.
 */
export async function applyDirection(): Promise<boolean> {
  // Reads the bootstrap the knobs point at — callers setKnobs(b) first.
  const wantRTL = str("textDirection", "ltr") === "rtl";
  if (I18nManager.isRTL === wantRTL) return false;
  try {
    I18nManager.allowRTL(wantRTL);
    I18nManager.forceRTL(wantRTL);
    await Updates.reloadAsync(); // restart so the new direction takes effect
  } catch {
    // Expo Go / no updates runtime: direction applies on the next launch.
  }
  return true;
}

/**
 * The device's language, when it is one Tailzu supports.
 *
 * Region is dropped ("hi-IN" → "hi"): the choice drives recognition and
 * writing, where the language matters and the region does not. An
 * unsupported language returns null and the user stays on "auto".
 *
 * "Supported" is the SERVER's list — the bootstrap's `languages`, the same
 * list the picker offers. It was a set compiled in here, which disagreed with
 * that list in both directions: a language the picker offered was never taken
 * from the phone, and one the server had dropped still could be. Only a
 * bootstrap with no list falls back to languages.systemDefaultable.
 */
export function inferSystemLanguage(languages?: LanguageOption[]): string | null {
  try {
    const supported = languages && languages.length
      ? languages.map((l) => String(l?.code ?? "").toLowerCase())
      : list<string>("languages.systemDefaultable", [
          "hi", "mr", "ta", "te", "bn", "gu", "pa", "kn", "ml", "ur",
          "en", "es", "fr", "de", "pt", "ar", "ja", "ko", "zh", "ru",
        ]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Localization = require("expo-localization");
    const tag = Localization.getLocales?.()?.[0]?.languageCode;
    const code = String(tag ?? "").trim().toLowerCase().split("-")[0];
    return code && supported.includes(code) ? code : null;
  } catch {
    return null;   // module absent — the user keeps "auto"
  }
}
