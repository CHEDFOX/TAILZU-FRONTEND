// Which platforms the EAS "production" environment can take a payment on, as
// this machine sees it. Run under `eas env:exec production`, which hands a
// command what `eas update` and `eas build --local` get: plain and sensitive
// variables, never "secret" ones (only Expo's own builders read those). A
// RevenueCat key kept as "secret" builds fine on Expo and is empty here.
//
//   node eas-keys.mjs ios            exit 1 unless the iOS key is there
//   node eas-keys.mjs --any ios android
//                                    write the platforms that have one to
//                                    $GITHUB_OUTPUT as platforms=...; exit 1
//                                    only if none does
//
// Names only, never values: nothing here is masked in the log.
import { appendFileSync } from "node:fs";

const KEYS = { ios: "REVENUECAT_IOS_KEY", android: "REVENUECAT_ANDROID_KEY" };
const args = process.argv.slice(2);
const any = args[0] === "--any";
const want = any ? args.slice(1) : args;
const has = want.filter((p) => process.env[KEYS[p]]?.trim());

for (const p of want) {
  if (!has.includes(p)) {
    console.log(`::${any ? "warning" : "error"}::${KEYS[p]} is empty in the EAS production environment as read from here, so ${any ? `${p} is left out` : "nothing was built"}. On expo.dev → Environment variables, give it "sensitive" visibility, not "secret".`);
  }
}
for (const k of ["SENTRY_DSN", "POSTHOG_API_KEY"]) {
  if (!process.env[k]?.trim()) console.log(`::warning::${k} is empty: this release reports no ${k.startsWith("SENTRY") ? "crashes" : "analytics"}.`);
}

if (any) {
  if (has.length && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `platforms=${has.length > 1 ? "all" : has[0]}\n`);
  process.exit(has.length ? 0 : 1);
}
process.exit(has.length === want.length ? 0 : 1);
