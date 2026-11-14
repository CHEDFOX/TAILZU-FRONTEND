// Checks docs/store-listing.md: every field's length against its store's limit, and the store rules.
//
//   node tools/media/store/check-listing.mjs                      # check, print a table; exits 1 on any problem
//   node tools/media/store/check-listing.mjs --write              # also rewrite each heading's count ("· 27 / 30")
//   node tools/media/store/check-listing.mjs --android-health on  # check against a Health Connect Android build instead
//                                                                 # of the one app/native-inputs.lock calls production
//
// A field is a heading "### <name> · <n> / <limit>" followed by a ```text block; the block's text is the field, exactly
// (its last newline is not part of it). Characters are counted as the stores count them: one per character (code point),
// a line break is one.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC = path.resolve(HERE, "../../../docs/store-listing.md");
const write = process.argv.includes("--write");
/** `on` / `off` from the command line, else null: the lock decides. */
const saidHealth = (() => {
  const i = process.argv.indexOf("--android-health");
  const v = i < 0 ? "" : String(process.argv[i + 1] ?? "").toLowerCase();
  return v === "on" || v === "off" ? v : null;
})();

const src = fs.readFileSync(DOC, "utf8");
const FIELD = /^(#{3,4}) (.+?) · (\d+) \/ (\d+)[ \t]*\n+```text\n([\s\S]*?)\n```/gm;

/** What no field may say (store rules): money, other companies and apps, superlatives, things not in the build. */
const RULES = [
  ["money or a price", /₹|\$|€|£|\bRs\.?\s?\d|\bINR\b|\bUSD\b|\d+\s?(rupees|paise)\b|\bper month\b.*\d|\bprice[sd]? (is|are|at|from)\b/i],
  ["another company or app", /\b(google|gmail|whatsapp|github|gitlab|slack|notion|iphone|ipad|android|mac\s?book|macos|windows|microsoft|uber|ola|irctc|booking\.com|makemytrip|airbnb|openstreetmap|chatgpt|openai|gemini|claude|siri|alexa|wispr|grammarly|gboard|swiftkey|instagram|facebook|youtube|zoom|razorpay|upi|paytm|phonepe|gpay|tailzu)\b/i],
  ["a superlative or ranking", /\b(best|#\s?1|number one|top[- ]rated|world'?s first|leading|award)/i],
  ["something not in the build", /\b(coming soon|soon|image generation|video generation|generate (images|videos)|images? bot|video bot)\b/i],
  ["a review or testimonial", /★|⭐|"[^"]{0,60}" ?[-—] ?[A-Z][a-z]+ [A-Z]\.|\btestimonial|\breviews? say/i],
];
/** Fields where store words are expected and allowed (the review notes are not shown on the store). */
const ALLOW = { "another company or app": /review notes|app access/i };

const fields = [];
let m;
while ((m = FIELD.exec(src))) {
  const [whole, hashes, name, , limit, body] = m;
  fields.push({ whole, hashes, name: name.trim(), limit: Number(limit), body, count: [...body].length, at: m.index });
}

const problems = [];
for (const f of fields) {
  if (f.count > f.limit) problems.push(`${f.name}: ${f.count} characters, over its ${f.limit}`);
  if (!f.body.trim()) problems.push(`${f.name}: empty`);
  for (const [what, re] of RULES) {
    if (ALLOW[what]?.test(f.name)) continue;
    const hit = f.body.match(re);
    // A link to the site's own pages is not a price; "per month" alone (no figure) is fine.
    if (hit) problems.push(`${f.name}: ${what}: "${f.body.slice(Math.max(0, hit.index - 20), hit.index + hit[0].length + 20).replace(/\n/g, " ")}"`);
  }
  if (/keywords/i.test(f.name)) {
    if (/,\s/.test(f.body) || /\s,/.test(f.body)) problems.push(`${f.name}: a space next to a comma`);
    const words = f.body.split(",").map((w) => w.trim().toLowerCase());
    const dup = words.filter((w, i) => words.indexOf(w) !== i);
    if (dup.length) problems.push(`${f.name}: repeated: ${dup.join(", ")}`);
    const name = fields.find((x) => /^app name/i.test(x.name));
    const sub = fields.find((x) => /^subtitle/i.test(x.name));
    const taken = new Set(`${name?.body ?? ""} ${sub?.body ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const again = words.flatMap((w) => w.split(/[^a-z0-9]+/)).filter((w) => taken.has(w));
    if (again.length) problems.push(`${f.name}: words already in the name or subtitle (indexed there already): ${[...new Set(again)].join(", ")}`);
  }
  if (/url/i.test(f.name) && !/^https:\/\/\S+$/.test(f.body)) problems.push(`${f.name}: not one https link`);
}

// ------------------------------------------------------------------ what the build really asks for (docs: perms §7.5)
//
// A listing and a privacy answer that say the opposite of the binary are the two ways a store build is refused for something
// nobody wrote down. So: if the build has a usage string for a thing, the listing and the privacy document must say the app
// does it. HealthKit's own rule is explicit (App Review 2.5.1: apps "should indicate that integration in their app
// description"); the rest follow the same logic.
//
// Both files are read where they are; a file that is missing is not a failure here, only a skipped check.
const CONFIG = path.resolve(HERE, "../../../app/app.config.ts");
const LOCK = path.resolve(HERE, "../../../app/native-inputs.lock");
const PRIVACY = path.resolve(HERE, "../../../../TAILZU-BACKEND/docs/store-privacy.md");
/** The privacy manifest, which from 8.9.1 declares Device ID: the store answers may not then call it "not collected". */
const PRIVACY_MANIFEST = path.resolve(HERE, "../../../app/assets/PrivacyInfo.xcprivacy");
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
/** Whether the RELEASE build carries Health Connect, from the lock A8 writes. Null when there is no lock to read. */
function lockedAndroidHealth() {
  return lockedSwitch("androidHealth");
}
/**
 * One of the lock's per-profile Android switches, for the `production` profile: "on", "off", or null when there is no lock.
 * `app.config.ts` holds every one of these permissions inside `SWITCH ? [...] : []`, so the words are in the file for EVERY
 * build and the config alone can never answer the question. The lock is what records which build is really being uploaded.
 */
function lockedSwitch(name) {
  const raw = read(LOCK);
  if (!raw) return null;
  try { return JSON.parse(raw)?.[name]?.production === "on" ? "on" : "off"; } catch { return null; }
}
const bodyOf = (re) => fields.filter((f) => re.test(f.name)).map((f) => f.body).join("\n");

const config = read(CONFIG);
const privacy = read(PRIVACY);
if (config) {
  const appStore = bodyOf(/^(description|what's new)/i);
  const play = bodyOf(/^(full description|release notes)/i);
  // HealthKit in the binary -> the App Store description and What's New say so.
  if (/\bHEALTH_USAGE\b/.test(config) && !/apple health/i.test(appStore)) {
    problems.push("Description / What's New: the build has a Health usage string but the App Store text never says Apple Health (App Review 2.5.1)");
  }
  // THE SAME RULE FOR THE OTHER THREE IPHONE READS OF 8.9.1. Only Apple Health was tested for, so the Description
  // could name it and say nothing about Motion & Fitness, the calendar or Reminders — which is what it did. The
  // DESCRIPTION is what each one is checked against, not What's New: What's New is about one version, and licence
  // 3.3.3(H) asks for Motion & Fitness to be "clearly evident in Your marketing text", which is the description a
  // person reads before installing. Unlike the Android switches, these three are in EVERY iPhone build (the keys are
  // unconditional in app.config.ts and check-config-shape.mjs requires them), so this only cuts one way.
  const description = bodyOf(/^description/i);
  const IPHONE_READS = [
    ["NSMotionUsageDescription", /motion & fitness/i, "Motion & Fitness (licence 3.3.3(H): \"clearly evident in Your marketing text\")"],
    // The calendar pattern has to name the PHONE's calendar, not the app's own: the description says "your own calendar
    // and to-do list" and "plans my workouts around my calendar" in paragraphs that have nothing to do with the busy-times
    // read, so a bare /calendar/ passed even with the whole "from your phone" paragraph deleted.
    ["NSCalendarsFullAccessUsageDescription", /\bbusy\b[^.]*\bcalendar\b|\bcalendar\b[^.]*\bbusy\b/i, "the phone's calendar (App Review 2.5.1)"],
    ["NSRemindersFullAccessUsageDescription", /\breminders\b/i, "the phone's Reminders (App Review 2.5.1)"],
  ];
  for (const [key, says, what] of IPHONE_READS) {
    if (new RegExp(`\\b${key}\\b`).test(config) && !says.test(description)) {
      problems.push(`Description: the build has ${key} but the description never says it reads ${what}`);
    }
  }
  // HEALTH CONNECT IS CONDITIONAL, so the config alone cannot answer it: app.config.ts holds READ_STEPS and READ_EXERCISE
  // inside `TULMI_ANDROID_HEALTH ? [...] : []`, so those words are in the file for EVERY build. What decides is the build
  // profile's own switch, recorded in app/native-inputs.lock (androidHealth.production), or --android-health on the
  // command line for another profile. Play wants the listing to represent the health access accurately either way, which
  // cuts both ways: with the switch on the sentence must be there, and with it off it must NOT be, or the listing
  // advertises Health Connect for a binary that has none (Play help 12991134).
  const androidHealth = saidHealth ?? lockedAndroidHealth();
  const saysHC = /health connect/i.test(play);
  if (androidHealth === "on" && !saysHC) {
    problems.push("Full description / Release notes: the Android build reads Health Connect but the Play text never says so (Play help 12991134)");
  }
  if (androidHealth === "off" && saysHC) {
    problems.push("Full description / Release notes: the Play text promises Health Connect, but this Android build is built without it (app/native-inputs.lock androidHealth.production is off)");
  }

  // THE THREE ANDROID HALVES OF 8.9.1 (docs: perms2). Each is its own build switch, its own permission and its own line in
  // the listing, and each cuts both ways for the same reason Health Connect does: a listing that promises a thing the
  // binary cannot do, and a binary that does a thing the listing never mentions, are the same mistake (Play help 12991134).
  // Arrival is the one Play reviews by hand, so its line is also what the background-location declaration and the demo
  // video have to say; the Play reviewer reads it in App access instructions, which is where each line goes.
  const access = bodyOf(/^app access instructions/i);
  const HALVES = [
    ["androidCalendar", "the phone's calendars", /plan around my calendar/i,
      "Plan around my calendar (READ_CALENDAR)"],
    ["androidMotion", "the phone's step counter", /step counter|physical activity/i,
      "Count my steps (ACTIVITY_RECOGNITION)"],
    ["androidArrival", "background location", /when the app is closed or not in use/i,
      "Remind me when I get there (ACCESS_BACKGROUND_LOCATION, and Play's background-location declaration)"],
  ];
  for (const [lockKey, , says, what] of HALVES) {
    const on = lockedSwitch(lockKey);
    const said = says.test(access);
    if (on === "on" && !said) {
      problems.push(`App access instructions: the Android build has ${what}, but the Play text never says so (Play help 12991134)`);
    }
    if (on === "off" && said) {
      problems.push(`App access instructions: the Play text describes ${what}, but this Android build is built without it (app/native-inputs.lock ${lockKey}.production is off)`);
    }
  }
  // AND THE ONE OF THE THREE GOOGLE ALSO ASKS FOR IN THE LISTING ITSELF. Play's prominent-disclosure rule puts the
  // background-location words "within the app itself as well as in the app description and website" (Play help 9799150),
  // so the Full description carries them too, not only App access instructions, and it cuts both ways as above. The words
  // Play names are "location", "background" and one of its closed phrases, which is why all three are looked for.
  const fullPlay = bodyOf(/^full description/i);
  const saysBackground = /\blocation\b/i.test(fullPlay) && /\bin the background\b/i.test(fullPlay)
    && /when the app is closed or not in use/i.test(fullPlay);
  const arrival = lockedSwitch("androidArrival");
  if (arrival === "on" && !saysBackground) {
    problems.push("Full description: the Android build uses location in the background for arrival reminders, but the Full description never says so (Play help 9799150: the disclosure belongs in the app description too)");
  }
  if (arrival === "off" && saysBackground) {
    problems.push("Full description: it discloses background location, but this Android build is built without it (app/native-inputs.lock androidArrival.production is off)");
  }
}
if (privacy) {
  // A usage string or permission in the build, and the privacy answers still calling it "not collected" or "never read".
  // Each phrase is one a STALE document has and a true one does not. "Health info (only Fitness info above)" is Play's own
  // category and stays true, so the health phrase is the whole "Health and fitness" category, as both forms spell it.
  const stale = [
    ["location", config && /NSLocationWhenInUseUsageDescription|ACCESS_COARSE_LOCATION/.test(config),
      /(?:Location \((?:precise and coarse|approximate and precise)\))|(?:no location permission or API)|(?:health or fitness)/i],
    ["health", config && /HEALTH_USAGE|READ_STEPS/.test(config), /\bHealth and [Ff]itness,/],
    ["contacts", true, /(?:the phone's contacts are never read)|(?:No contacts, calendar or location permission is in the build)/i],
    // BUILD 8.9.1 (docs: perms2 §11.5). Each phrase is one a STALE document has and a true one does not.
    // The busy-times read: with the calendar key in the build, the document may not still say the phone's calendars are never read.
    ["calendars", config && /NSCalendarsFullAccessUsageDescription/.test(config),
      /the phone's calendars or reminders \(the\s+app keeps its own calendar on the server\)|never reads the phone's calendars/i],
    // The one Reminders list: the same, for reminders.
    ["reminders", config && /NSRemindersFullAccessUsageDescription/.test(config), /reminders are never read|never reads your reminders/i],
    // Motion: the document said "motion data" was not collected, which stops being true with the key in the build.
    ["motion", config && /NSMotionUsageDescription/.test(config), /(?:^|[^w])\bmotion data\b/i],
    // THE ANDROID HALVES OF 8.9.1: once the uploaded build carries one, the store answers may not still say the permission
    // is blocked. The lock is the only thing that knows, for the reason `lockedSwitch` gives.
    ["the Android calendar read", lockedSwitch("androidCalendar") === "on",
      /`READ_CALENDAR` and `WRITE_CALENDAR` stay blocked|No calendar permission is in the build/i],
    ["the Android step counter", lockedSwitch("androidMotion") === "on", /and `ACTIVITY_RECOGNITION`, so no library/i],
    ["Android background location", lockedSwitch("androidArrival") === "on",
      /So are `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`|no background location, and no geofence of our own(?![\s\S]{0,400}Android)/i],
    // Device ID: declared from 8.9.1 (attestation, and the install number), so it may not also be in the "not collected" line.
    ["the Device ID", config && /NSPrivacyCollectedDataTypeDeviceID/.test(read(PRIVACY_MANIFEST) ?? ""),
      /Identifiers'\s*\*\*Device ID\*\*|Device ID \(no IDFA/i],
  ];
  for (const [what, inBuild, re] of stale) {
    if (inBuild && re.test(privacy)) problems.push(`store-privacy.md: still says ${what} is not collected or never read, while the build has it (docs/store-privacy.md)`);
  }
}

const pad = Math.max(...fields.map((f) => f.name.length));
for (const f of fields) console.log(`${f.count > f.limit ? "OVER" : "ok  "}  ${f.name.padEnd(pad)}  ${String(f.count).padStart(4)} / ${f.limit}`);
if (problems.length) console.log(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
else console.log(`\n${fields.length} fields, all within their limits and the store rules.`);

if (write) {
  let out = src;
  for (const f of fields.slice().reverse()) {
    const head = `${f.hashes} ${f.name} · ${f.count} / ${f.limit}`;
    const fixed = f.whole.replace(/^#{3,4} .+? · \d+ \/ \d+/, head);
    out = out.slice(0, f.at) + fixed + out.slice(f.at + f.whole.length);
  }
  if (out !== src) { fs.writeFileSync(DOC, out); console.log("counts written into the headings."); }
}
process.exit(problems.length ? 1 : 0);
