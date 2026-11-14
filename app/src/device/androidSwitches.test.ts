// node --test --experimental-strip-types src/device/androidSwitches.test.ts
//
// THE THREE 8.9.1 ANDROID SWITCHES, DRIVEN FOR REAL (perms2/SPEC.md 5, 7, 10.1, and rule 1: no
// permission without its working screen in the same build).
//
// EVERY 8.9.1 ANDROID BINARY CARRIES THE FUNCTIONS. TulmiPermsModule.kt declares calendarBusy,
// motionDays and arrivalArm whatever TULMI_ANDROID_CALENDAR / _MOTION / _ARRIVAL said at build
// time: a switch takes the PERMISSION out of the merged manifest and swaps the Play services half
// for one that answers "unknown" or "unavailable". So "is the function there?" says nothing about
// what this build can do — `abilities()`, which the module reads off the merged manifest and the
// compiled source set, is the only honest test.
//
// WHAT GOES WRONG WITHOUT IT, and why these tests exist at all: asking for a permission a build
// does not declare comes straight back `never_ask_again`, which reads as "blocked" and makes a
// screen offer Settings for a switch that is not there — and for arrival the pair request would
// show the real system location sheet, because COARSE *is* declared for "Use my location". A stray
// action from the server must reach none of that.
//
// FROM 8.9.1 ALL THREE ARE ON IN `preview` AND `production` (app/eas.json), so the switch-ON tests
// are the release build's behaviour. The switch-OFF tests are still the ones that matter most: they
// are the `development` profile, any build made with none of the three set, and — if Play ever asks
// for one of them to be turned back off — the release after that.
//
// These run the REAL src/device/health.ts, motion.ts, calendar.ts and arrival.ts with react-native
// and natives.ts faked by a module hook, because what they decide is not in a pure core: it is the
// branch that picks the core in the first place. The cores' own decisions stay in
// androidPermCore.test.ts, androidCalendarCore.test.ts, androidMotionCore.test.ts and
// androidArrivalCore.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { BUSY_PATH } from "./calendarCore.ts";

// react-native and natives.ts, faked. Both read globalThis at CALL time, so one hook serves every
// test in this file and each test sets up the binary it wants. `natives` is matched by specifier,
// so no module in the chain can reach a real native package.
const HOOKS = `
const RN = 'export const Platform = { get OS() { return globalThis.__phone.os; }, get Version() { return globalThis.__phone.api; } };'
  + 'export const PermissionsAndroid = {'
  + '  check: (p) => globalThis.__phone.check(p),'
  + '  request: (p) => globalThis.__phone.request(p),'
  + '  requestMultiple: (ps) => globalThis.__phone.requestMultiple(ps),'
  + '};';
const NATIVES = 'export const tulmiPerms = () => globalThis.__phone.native;'
  + 'export const healthKit = () => null; export const healthConnect = () => null;'
  + 'export const optionalNative = () => null;';
const STORE = 'export default { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };';
const FAKE = new Map([
  ["react-native", RN],
  ["@react-native-async-storage/async-storage", STORE],
  ["natives", NATIVES],
]);
export async function resolve(spec, ctx, next) {
  if (FAKE.has(spec)) return { url: "tulmifake:" + spec, shortCircuit: true, format: "module" };
  if (/(^|\\/)natives(\\.ts)?$/.test(spec)) return { url: "tulmifake:natives", shortCircuit: true, format: "module" };
  // The app's own files import each other without the extension, which Node needs.
  if (/^\\.{1,2}\\//.test(spec) && !/\\.[a-z]+$/.test(spec)) return next(spec + ".ts", ctx);
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.startsWith("tulmifake:")) {
    return { format: "module", shortCircuit: true, source: FAKE.get(url.slice("tulmifake:".length)) };
  }
  return next(url, ctx);
}
`;
register("data:text/javascript," + encodeURIComponent(HOOKS));

const FINE = "android.permission.ACCESS_FINE_LOCATION";
const COARSE = "android.permission.ACCESS_COARSE_LOCATION";
const BACKGROUND = "android.permission.ACCESS_BACKGROUND_LOCATION";
const ACTIVITY = "android.permission.ACTIVITY_RECOGNITION";
const READ_CALENDAR = "android.permission.READ_CALENDAR";
const HEALTH_PATH = "/v1/bots/fit/health/days";

/** The day key the payload builder uses, so a fake day lands inside the window it asked for. */
const key = (ms: number, offsetMin: number) => new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10);

interface Phone {
  /** Every permission the code really asked the system for, in order. Empty is the whole point of a switch-off test. */
  asked: string[];
  /** Whether motionForget() reached the module. */
  forgot: boolean;
  /** What motionDays answers; the default is two days of steps and no spans. */
  days?: (fromMs: number, toMs: number, offsetMin: number) => unknown;
}

/**
 * An Android binary whose 8.9.1 switches are `on`. `granted` is the set the person has already
 * given; anything else is granted when asked, unless `refuse` names it — and a permission a build
 * does not declare is what `switchOff` below refuses, which is what the system really answers.
 */
function phone(on: { calendar?: boolean; motion?: boolean; arrival?: boolean }, opts: {
  granted?: string[];
  refuse?: Record<string, string>;
} = {}): Phone {
  const state: Phone = { asked: [], forgot: false };
  const held = new Set(opts.granted ?? []);
  const answer = (p: string): string => {
    state.asked.push(p);
    return opts.refuse?.[p] ?? "granted";
  };
  (globalThis as unknown as { __phone: unknown }).__phone = {
    os: "android",
    api: 33,
    check: async (p: string) => held.has(p),
    request: async (p: string) => answer(p),
    requestMultiple: async (ps: string[]) => Object.fromEntries(ps.map((p) => [p, answer(p)])),
    native: {
      // Read off the manifest and the compiled source set by the real module; here, the switches.
      abilities: () => ({
        calendarRead: on.calendar === true,
        motion: on.motion === true,
        arrival: on.arrival === true,
        calendarAdd: true,
        focus: true,
      }),
      // In every 8.9.1 binary, whatever the switches say — which is the thing being tested.
      calendarBusy: async () => [],
      calendarStatus: () => "undetermined",
      motionStatus: () => "undetermined",
      motionDays: async (fromMs: number, toMs: number, offsetMin: number) =>
        (state.days ?? ((f: number, t: number, o: number) => [
          { day: key(t - 86_400_000, o), steps: 900, spans: [] },
          { day: key(t, o), steps: 1200, spans: [] },
        ]))(fromMs, toMs, offsetMin),
      motionDriving: async () => null,
      motionWatch: async () => true,
      motionForget: async () => {
        state.forgot = true;
        return true;
      },
      arrivalArm: async () => ({ armed: 1 }),
      arrivalList: async () => [],
      arrivalClear: async () => undefined,
    },
  };
  return state;
}

/** The same binary with its three 8.9.1 switches off: no ability, and the permissions out of the manifest. */
function switchOff(): Phone {
  return phone({}, { refuse: { [ACTIVITY]: "never_ask_again", [READ_CALENDAR]: "never_ask_again", [FINE]: "never_ask_again", [BACKGROUND]: "never_ask_again" } });
}

const ITEMS = [{ id: "pick-milk", lat: 12.9, lon: 77.6, radiusM: 150, title: "Milk" }];

// ----------------------------------------------------------------------------------- motion: steps
test("health.sync source 'motion' reads Android's own step counter when TULMI_ANDROID_MOTION is on", async () => {
  const p = phone({ motion: true });
  const { runHealthSync } = await import("./health.ts");
  const posts: { path: string; body: { source?: string; days: { steps: number }[] } }[] = [];
  const r = await runHealthSync(
    { path: HEALTH_PATH, source: "motion", ask: true, days: 2 },
    async (path, body) => {
      posts.push({ path, body: body as never });
      return {};
    },
    0,
  );
  assert.equal(r.outcome, "synced");
  // The grant the sheet really asks for, and nothing else.
  assert.deepEqual(p.asked, [ACTIVITY]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.source, "motion");
  assert.ok(posts[0].body.days.some((d) => d.steps > 0));
});

test("health.sync source 'motion' is unavailable with the switch off, and prompts nobody", async () => {
  const p = switchOff();
  const { runHealthSync } = await import("./health.ts");
  const posts: unknown[] = [];
  const r = await runHealthSync(
    { path: HEALTH_PATH, source: "motion", ask: true, days: 2 },
    async (path, body) => {
      posts.push([path, body]);
      return {};
    },
    0,
  );
  assert.equal(r.outcome, "unavailable");
  assert.deepEqual(p.asked, []);
  assert.deepEqual(posts, []);
});

test("switching the Motion source off deletes the phone's own days too", async () => {
  const p = phone({ motion: true });
  const { runHealthSync } = await import("./health.ts");
  await runHealthSync({ path: HEALTH_PATH, source: "motion", enable: false }, async () => ({}), 0);
  assert.equal(p.forgot, true, "motionForget() ran beside the server's own delete");
  // And it is the motion source only: Apple Health and Health Connect keep nothing of their own.
  const q = phone({ motion: true });
  await runHealthSync({ path: HEALTH_PATH, enable: false }, async () => ({}), 0);
  assert.equal(q.forgot, false);
});

test("Android reports no workouts: a span from the module is dropped before the payload", async () => {
  const p = phone({ motion: true });
  p.days = (_f, t, o) => [{ day: key(t, o), steps: 1000, spans: [{ kind: "walking", minutes: 40 }] }];
  const { runHealthSync } = await import("./health.ts");
  const posts: { days: { workouts: unknown[] }[] }[] = [];
  const r = await runHealthSync(
    { path: HEALTH_PATH, source: "motion", ask: true, days: 2 },
    async (_path, body) => {
      posts.push(body as never);
      return {};
    },
    0,
  );
  assert.equal(r.outcome, "synced");
  assert.deepEqual(posts[0].days.flatMap((d) => d.workouts), []);
});

// ----------------------------------------------------------------------- motion: the grant on its own
test("the motion grant is not asked for, and not claimed, with the switch off", async () => {
  const p = switchOff();
  const { hasMotion, motionRequest, prepareMotion } = await import("./motion.ts");
  // The functions ARE there — that is exactly why their presence cannot be the gate.
  assert.equal(hasMotion(), true);
  assert.equal(await prepareMotion(true), "unavailable");
  assert.deepEqual(await motionRequest(), { granted: false, blocked: false });
  assert.deepEqual(p.asked, []);
});

test("the motion grant is asked for with the switch on", async () => {
  const p = phone({ motion: true });
  const { motionRequest } = await import("./motion.ts");
  assert.deepEqual(await motionRequest(), { granted: true, blocked: false });
  assert.deepEqual(p.asked, [ACTIVITY]);
});

// ------------------------------------------------------------------- motion: the driving watch (5.2)
test("the driving watch is turned on and off through the module, and the switch-off build claims nothing", async () => {
  const p = phone({ motion: true });
  const { watchDriving } = await import("./motion.ts");
  assert.equal(await watchDriving(true), true);
  assert.equal(await watchDriving(false), true);
  assert.deepEqual(p.asked, [], "no permission is asked for by the watch itself");

  // An Android binary without the function (an older one) must not claim the registration happened:
  // the driving check would then answer "unknown" for ever with the switch showing as on.
  const q = phone({ motion: true });
  delete (globalThis as unknown as { __phone: { native: Record<string, unknown> } }).__phone.native.motionWatch;
  assert.equal(await watchDriving(true), false);
  assert.deepEqual(q.asked, []);

  // THE IPHONE HAS NOTHING TO REGISTER: CoreMotion is asked at question time, so "done" is the
  // honest answer there and the switch is not reported as having failed.
  phone({ motion: true });
  (globalThis as unknown as { __phone: { os: string } }).__phone.os = "ios";
  delete (globalThis as unknown as { __phone: { native: Record<string, unknown> } }).__phone.native.motionWatch;
  assert.equal(await watchDriving(true), true);
});

// --------------------------------------------------------------------------------------- calendar
test("calendar.sync is unavailable with TULMI_ANDROID_CALENDAR off, and prompts nobody", async () => {
  const p = switchOff();
  const { runCalendarSync } = await import("./calendar.ts");
  const posts: unknown[] = [];
  const r = await runCalendarSync({ path: BUSY_PATH, ask: true, days: 7 }, async (path, body) => {
    posts.push([path, body]);
    return {};
  }, 0);
  // Not "blocked": there is nothing to turn on in Settings, so the screen must not offer it.
  assert.equal(r.outcome, "unavailable");
  assert.deepEqual(p.asked, []);
  assert.deepEqual(posts, []);
});

test("calendar.sync asks for READ_CALENDAR with the switch on", async () => {
  const p = phone({ calendar: true });
  const { runCalendarSync } = await import("./calendar.ts");
  const r = await runCalendarSync({ path: BUSY_PATH, ask: true, days: 7 }, async () => ({}), 0);
  assert.deepEqual(p.asked, [READ_CALENDAR]);
  // An empty calendar still syncs; what matters here is that the one permission was asked for.
  assert.ok(r.outcome === "synced" || r.outcome === "empty", r.outcome);
});

// ---------------------------------------------------------------------------------------- arrival
test("arrival is unavailable with TULMI_ANDROID_ARRIVAL off, and no location sheet is shown", async () => {
  const p = switchOff();
  const { arrivalBackgroundGranted, hasArrival, runArrivalSync } = await import("./arrival.ts");
  assert.equal(hasArrival(), false);
  const r = await runArrivalSync({ items: ITEMS, ask: true });
  assert.equal(r.outcome, "unavailable");
  assert.equal(await arrivalBackgroundGranted(), false);
  // The important line: COARSE is declared in every build, so a FINE+COARSE request would really
  // have put the system's location sheet in front of someone for a feature this build does not have.
  assert.deepEqual(p.asked, []);
});

test("arrival asks for precise location, and then owes the background step, with the switch on", async () => {
  const p = phone({ arrival: true });
  const { hasArrival, runArrivalSync } = await import("./arrival.ts");
  assert.equal(hasArrival(), true);
  const r = await runArrivalSync({ items: ITEMS, ask: true });
  assert.deepEqual(p.asked, [FINE, COARSE]);
  // Precise location is held now; "Allow all the time" is its own step, after our card.
  assert.equal(r.outcome, "background");
});

test("arrival arms the set once both grants are held", async () => {
  const p = phone({ arrival: true }, { granted: [FINE, BACKGROUND] });
  const { runArrivalSync } = await import("./arrival.ts");
  const r = await runArrivalSync({ items: ITEMS, ask: false });
  assert.deepEqual(p.asked, []);
  assert.equal(r.outcome, "armed");
  assert.equal(r.armed, 1);
});
