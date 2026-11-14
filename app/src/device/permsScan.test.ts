// node --test --experimental-strip-types src/device/permsScan.test.ts
//
// The scans for location, contacts and health (perms/SPEC.md 5.2, 6.5 item 8, 8):
//  - the two health packages, the HealthKit core and the TulmiPerms module are named only in src/device/natives.ts;
//  - src never calls HealthKit's background APIs (a cold launch must register no observer query);
//  - the three actions never put a coordinate or a health number in state.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { CORE_ACTIONS } from "../sdui/registry.ts";

const app = process.cwd();

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rel = (f: string) => relative(app, f).split(sep).join("/");
const src = files(join(app, "src")).map((f) => ({ r: rel(f), text: readFileSync(f, "utf8") }));

test("the health packages and TulmiPerms are reached only through natives.ts", () => {
  const names = ["@kingstinct/react-native-healthkit", "@react-native-healthkit/core", "react-native-health-connect", "TulmiPerms", "tulmi-perms"];
  const bad: string[] = [];
  for (const f of src) {
    if (f.r === "src/device/natives.ts") continue;
    const code = noComments(f.text);
    for (const n of names) if (code.includes(n)) bad.push(`${f.r} names ${n}`);
  }
  assert.deepEqual(bad, []);
});

test("no HealthKit background API is called anywhere in src", () => {
  const apis = ["configureBackgroundTypes", "enableBackgroundDelivery", "disableBackgroundDelivery", "disableAllBackgroundDelivery", "subscribeToChanges", "subscribeToQuantitySamples", "subscribeToCategorySamples", "subscribeToObserverQuery"];
  const bad: string[] = [];
  for (const f of src) {
    const code = noComments(f.text);
    for (const a of apis) if (code.includes(a)) bad.push(`${f.r} uses ${a}`);
  }
  assert.deepEqual(bad, []);
});

test("natives.ts requires each health package only on its own platform, after the presence check", () => {
  const t = readFileSync(join(app, "src/device/natives.ts"), "utf8");
  assert.match(t, /if \(platform !== "ios"\) return null;[\s\S]*?hasHybridObject[\s\S]*?require\("@kingstinct\/react-native-healthkit"\)/);
  assert.match(t, /if \(platform !== "android"\) return null;[\s\S]*?TurboModuleRegistry\.get\("HealthConnect"\)[\s\S]*?require\("react-native-health-connect"\)/);
  assert.ok(!/^import .*(healthkit|health-connect)/m.test(t), "no top-level import of a health package");
  // the require sits inside a load callback handed to the pure helper, which checks presence first
  assert.match(t, /healthKitFrom<[^>]*>\(/);
  assert.match(t, /healthConnectFrom<[^>]*>\(/);
});

test("the three actions are registered", () => {
  for (const a of ["location.area", "contact.pick", "health.sync"]) assert.ok((CORE_ACTIONS as readonly string[]).includes(a), a);
});

function block(text: string, from: string, to: string): string {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `${from} block`);
  return text.slice(a, b);
}

test("the actions write only the area's words and the one email to state, and health writes nothing", () => {
  const t = readFileSync(join(app, "src/sdui/actions.ts"), "utf8");
  const loc = block(t, 'case "location.area": {', 'case "contact.pick": {');
  assert.deepEqual([...loc.matchAll(/store\.set\(([^)]*)\)/g)].map((m) => m[1]), ["action.assignTo, r.label"]);
  const con = block(t, 'case "contact.pick": {', 'case "health.sync": {');
  assert.deepEqual([...con.matchAll(/store\.set\(([^)]*)\)/g)].map((m) => m[1]), ["action.assignTo, r.email"]);
  const hea = block(t, 'case "health.sync": {', 'case "biometricPrompt": {');
  assert.ok(!/store\.set|setState|assignTo/.test(hea), "health.sync writes nothing to state");
  // the analytics call for each carries the outcome only
  for (const b of [loc, con, hea]) for (const m of b.matchAll(/trackEvent\([^)]*\)/g)) assert.match(m[0], /\{ outcome: r\.outcome \}\)$/);
});

test("location in the permission actions is real, not the old 'treat as denied'", () => {
  const t = readFileSync(join(app, "src/sdui/actions.ts"), "utf8");
  assert.ok(!t.includes("expo-location not installed"));
  assert.match(t, /case "location": granted = await locationGranted\(\)/);
  assert.match(t, /locationRequest\(\)/);
});

test("no value is logged by the three paths", () => {
  for (const f of ["src/device/locate.ts", "src/device/locateCore.ts", "src/device/health.ts", "src/device/healthCore.ts", "src/device/contact.ts", "src/device/contactCore.ts"]) {
    assert.ok(!/console\.(log|warn|error|info|debug)/.test(noComments(readFileSync(join(app, f), "utf8"))), f);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// BUILD 8.9.1 (docs: perms2 9, 12): the calendar, reminders, Focus, motion, sleep, arrival and trust additions obey the same
// rules — one action each, every native function through natives.ts, no value in state, nothing logged, and the trust code
// reads nothing about the device or its network.
// ---------------------------------------------------------------------------------------------------------------------------

test("the 8.9.1 actions are registered", () => {
  for (const a of ["calendar.editor", "calendar.sync", "reminders.sync", "focus.sync", "arrival.sync", "motion.watch"]) {
    assert.ok((CORE_ACTIONS as readonly string[]).includes(a), a);
  }
});

test("the 8.9.1 actions write nothing to state, and their analytics carry the outcome only", () => {
  const t = readFileSync(join(app, "src/sdui/actions.ts"), "utf8");
  const nine = block(t, 'case "calendar.editor": {', '// ---------------------------------------------------------------- auth');
  assert.ok(!/store\.set|setState|assignTo/.test(nine), "nothing of a calendar, list, Focus or place reaches state");
  const events = [...nine.matchAll(/trackEvent\([^)]*\)/g)].map((m) => m[0]);
  // calendar.editor, calendar.sync, reminders.sync, focus.sync, motion.watch, arrival.sync — one each, and motion.watch's
  // outcome is a word about the switch ("watching", "stopped", "unsupported") and nothing about the person or the phone.
  assert.equal(events.length, 6);
  for (const e of events) assert.match(e, /\{ outcome: r\.outcome \}\)$/);
});

test("Android's 'opened' never runs onSaved: the app does not claim an event was added", () => {
  // TulmiPermsModule.kt resolves "opened" as soon as the calendar app's insert screen starts, before the person has saved or
  // cancelled anything, and the server's Add to my calendar sends onSaved: "Added to your calendar." (perms2 2.2 says
  // onOpened does nothing). A fallback would make every Android tap claim a saved event, cancelled ones included.
  const t = readFileSync(join(app, "src/sdui/actions.ts"), "utf8");
  const editor = block(t, 'case "calendar.editor": {', 'case "calendar.sync": {');
  assert.match(editor, /r\.outcome === "opened"\) await runAction\(action\.onOpened, ctx\)/);
  assert.ok(!/onOpened \?\? action\.onSaved/.test(editor), "opened must not fall back to onSaved");
});

test("each 8.9.1 path is pinned in its own core, so a screen cannot post it anywhere else", () => {
  const pins: [string, string][] = [
    ["src/device/calendarCore.ts", '"/v1/botsapp/plan/busy"'],
    ["src/device/remindersCore.ts", '"/v1/botsapp/plan/reminders/sync"'],
    ["src/device/focusCore.ts", '"/v1/botsapp/plan/focus"'],
  ];
  for (const [f, pin] of pins) assert.ok(readFileSync(join(app, f), "utf8").includes(pin), f);
  // arrival posts nothing at all: the places come from the server and the phone answers nobody
  const arrival = noComments(readFileSync(join(app, "src/device/arrivalCore.ts"), "utf8"));
  assert.ok(!/post\s*\(/.test(arrival) && !arrival.includes("callEndpoint"), "arrival.sync sends nothing");
});

// THE ANDROID ASK IS WIRED, AND IT IS NOT OPTIONAL (perms2 9.1; perms2/ANDROID-WIRING.md 9).
//
// TulmiPermsModule.kt's calendarAsk / motionAsk / locationAsk PROMPT NOTHING on Android — they answer "granted" or
// "undetermined" — so a path that trusted them would show the card, take the person's Continue, put no system sheet in front of
// them, and then say "X0 Bot can't see your calendar" about a permission they were never asked for. Only PermissionsAndroid can
// ask, and only its never_ask_again means "blocked". This holds the three branches in place; the cores' own tests hold the
// decisions, including that ask:false prompts nothing.
test("calendar, motion and arrival each ask with PermissionsAndroid on Android", () => {
  const wired: [string, RegExp][] = [
    ["src/device/calendar.ts", /Platform\.OS === "android"\) return calendarReady\(ask, androidAsk\)/],
    ["src/device/motion.ts", /Platform\.OS === "android"\) return motionReady\(ask, androidAsk\)/],
    ["src/device/motion.ts", /Platform\.OS === "android"\) \{\s*\n\s*const r = await motionReady\(true, androidAsk\)/],
    ["src/device/arrival.ts", /Platform\.OS === "android" \? arrivalGrants\(ask, androidAsk, hasArrival\(\)\)/],
  ];
  for (const [f, re] of wired) assert.match(readFileSync(join(app, f), "utf8"), re, f);
  // Each one hands the real PermissionsAndroid in, so the core's tested decision reaches a real system sheet.
  for (const f of ["src/device/calendar.ts", "src/device/motion.ts", "src/device/arrival.ts"]) {
    const t = readFileSync(join(app, f), "utf8");
    assert.match(t, /request: \(p: string\) => PermissionsAndroid\.request\(/, f);
    assert.match(t, /check: \(p: string\) => PermissionsAndroid\.check\(/, f);
  }
  // And the decision really does request when told to: the rule lives in one place for all three.
  const perm = readFileSync(join(app, "src/device/androidPermCore.ts"), "utf8");
  assert.match(perm, /if \(now === "granted" \|\| !ask\) return now;/);
  assert.match(perm, /raw === "never_ask_again"\) return "blocked"/);
});

test("no value is logged by the 8.9.1 paths", () => {
  for (const f of [
    "src/device/calendar.ts", "src/device/calendarCore.ts", "src/device/reminders.ts", "src/device/remindersCore.ts",
    "src/device/focus.ts", "src/device/focusCore.ts", "src/device/motion.ts", "src/device/motionCore.ts",
    "src/device/arrival.ts", "src/device/arrivalCore.ts", "src/device/trust.ts", "src/device/trustCore.ts",
    "src/device/installId.ts",
  ]) {
    assert.ok(!/console\.(log|warn|error|info|debug)/.test(noComments(readFileSync(join(app, f), "utf8"))), f);
  }
});

test("THE TRUST SCAN: the abuse-prevention code reads nothing about the device or its network (perms2 rule 7)", () => {
  // Each of these is either a required-reason API, a device identifier, or something about the phone's network — which Apple
  // names as a fingerprinting input. None of it may be anywhere near this code, on either side.
  const forbidden = [
    "systemUptime", "kern.boottime", "volumeAvailableCapacity", "attributesOfItem", "activeInputModes", "canOpenURL",
    "identifierForVendor", "getAndroidId", "Settings.Secure.ANDROID_ID", "advertisingIdentifier", "lastBoot",
    "netinfo", "NetInfo", "NWPathMonitor", "CTTelephonyNetworkInfo", "getifaddrs", "CNCopyCurrentNetworkInfo",
    "NEHotspotNetwork", "WifiManager", "TelephonyManager", "ConnectivityManager",
    "expo-application", "expo-device", "expo-localization", "src/sdui/device/facts", "src/device/signals",
  ];
  const files = ["src/device/trust.ts", "src/device/trustCore.ts", "src/device/installId.ts"];
  for (const extra of ["modules/tulmi-perms/ios/TulmiTrust.swift", "modules/tulmi-perms/android/src/main/java/expo/modules/tulmiperms/TulmiTrust.kt"]) {
    if (existsSync(join(app, extra))) files.push(extra);
  }
  const bad: string[] = [];
  for (const f of files) {
    const code = noComments(readFileSync(join(app, f), "utf8"));
    for (const n of forbidden) if (code.includes(n)) bad.push(`${f} reads ${n}`);
  }
  assert.deepEqual(bad, []);
});

/**
 * FOUR INVARIANTS OF THE SWIFT, ASSERTED ON ITS SOURCE TEXT (NATIVE_IOS's review, items 1, 4, 6, 7, 8 and 9).
 *
 * There is no way to run a Swift test from this repo — no toolchain here, and the pod's `source_files` glob would ship any
 * test file inside the module — and each of these four would have caught one of that review's findings. They are cheap on
 * the text, and a file that is not there is skipped rather than failed, so a build without the iOS module still passes.
 */
test("the Swift keeps the four things the review found broken", () => {
  const read = (f: string): string | null => (existsSync(join(app, f)) ? readFileSync(join(app, f), "utf8") : null);
  const bad: string[] = [];

  // 1 and 8. The Focus Filter's parameter has NO default, because iOS runs perform() with the default values when a Focus's
  // values stop being relevant — which is how the END of a Focus arrives. With `default: .calls` the end would read as a
  // choice. And the marker class is what `abilities()` looks for, so cutting the filter removes the capability.
  const focus = read("targets/widgets/_shared/FocusFilter.swift");
  if (focus) {
    if (!focus.includes("var hold: X0FocusHold?")) bad.push("FocusFilter.swift: the hold parameter is not optional");
    if (focus.includes("default: .calls")) bad.push("FocusFilter.swift: the hold parameter has a default again");
    if (!focus.includes("X0FocusFilterCompiled")) bad.push("FocusFilter.swift: the marker class abilities() looks for is gone");
  }

  // 6 and 4. The attest key lives in the app group's keychain, so the app and its extensions find the SAME key; and
  // DCErrorServerUnavailable is reported as "unavailable", never "throttled", because it is usually the phone's own line.
  const trust = read("modules/tulmi-perms/ios/TulmiTrust.swift");
  if (trust) {
    if (!trust.includes("kSecAttrAccessGroup")) bad.push("TulmiTrust.swift: the keychain item is not in the access group");
    if (!trust.includes("6552H8HYA4.com.tulmi.app")) bad.push("TulmiTrust.swift: the access group is not this app's");
    if (trust.includes('"throttled"')) bad.push('TulmiTrust.swift: "throttled" is back (it must be "unavailable")');
  }

  // 9. Every ask and read asks the binary whether it HAS the usage key first, so a build without one rejects "unsupported"
  // instead of showing a prompt iOS would kill the app for.
  const mod = read("modules/tulmi-perms/ios/TulmiPermsModule.swift");
  if (mod) {
    const says = (mod.match(/TulmiKeys\.says\(/g) ?? []).length;
    if (says < 8) bad.push(`TulmiPermsModule.swift: only ${says} TulmiKeys.says( calls, expected one per ask and read`);
  }

  // 7. The pending-requests read comes BEFORE the "denied" answer, so a refusal does not leave the places armed.
  const arrival = read("modules/tulmi-perms/ios/TulmiArrival.swift");
  if (arrival) {
    const pending = arrival.indexOf("getPendingNotificationRequests");
    const denied = arrival.indexOf('done("denied")');
    if (pending < 0 || denied < 0 || pending > denied) bad.push("TulmiArrival.swift: denied is answered before the pending requests are read");
  }

  assert.deepEqual(bad, []);
});

test("the trust steps are the platforms' own tools and nothing else", () => {
  const core = readFileSync(join(app, "src/device/trustCore.ts"), "utf8");
  for (const route of ["/v1/trust/ios/attest", "/v1/trust/ios/assert", "/v1/trust/ios/devicecheck", "/v1/trust/android/integrity"]) {
    assert.ok(core.includes(route), route);
  }
  // no fifth step, and no push token anywhere near it (perms2 8.2 rule 2)
  assert.ok(!/getExpoPushToken|pushToken/.test(core));
});
