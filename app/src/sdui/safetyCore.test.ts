// node --test --experimental-strip-types src/sdui/safetyCore.test.ts
//
// The safety floor (SPEC 5.2, 5.3): the kill switches, the crash-loop guard and the report that tells the server
// what the device had to turn off for itself.
import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  BadNodes, MAX_BAD, MAX_OFF, OPEN_FLOOR, REPORT_MAX_BYTES, VOCAB1_TYPES,
  cleanLaunch, drawingScreen, floorFrom, gesturesOn, leftLaunch, nodeOff, readGuard, rulesOn,
  safetyReportOf, screenOff, startLaunch,
} from "./safetyCore.ts";

const KNOBS = { safe: false, off: [] as string[], motion: "on" };
const DEVICE = { safe: false, off: [] as string[] };

test("the defaults change nothing: no safe mode, nothing off, motion as it was", () => {
  const f = floorFrom(KNOBS, DEVICE);
  assert.deepStrictEqual(f, OPEN_FLOOR);
  assert.strictEqual(nodeOff("Text", f), false);
  assert.strictEqual(nodeOff("Anything", f), false, "an unknown type is the registry's business, not the floor's");
  assert.strictEqual(screenOff("home", f), false);
  assert.strictEqual(rulesOn(f), true);
  assert.strictEqual(gesturesOn(f), true);
  assert.strictEqual(f.motion, "on");
});

test("sdui.off names node types or screens, and they are treated as unknown", () => {
  const f = floorFrom({ ...KNOBS, off: ["List", "home"] }, DEVICE);
  assert.strictEqual(nodeOff("List", f), true);
  assert.strictEqual(nodeOff("Text", f), false, "a sibling type keeps drawing");
  assert.strictEqual(screenOff("home", f), true);
  assert.strictEqual(screenOff("plan", f), false);
  assert.strictEqual(screenOff("", f), false, "a screen with no id is not everything");
});

test("sdui.safe: vocab-1 types only, no rules, no gestures, no motion", () => {
  const f = floorFrom({ ...KNOBS, safe: true }, DEVICE);
  assert.strictEqual(f.safe, true);
  assert.strictEqual(f.motion, "off", "safe mode takes motion with it, whatever sdui.motion says");
  assert.strictEqual(rulesOn(f), false);
  assert.strictEqual(gesturesOn(f), false);
  for (const t of VOCAB1_TYPES) assert.strictEqual(nodeOff(t, f), false, `${t} is vocab 1 and still draws`);
  assert.strictEqual(nodeOff("List", f), true, "a vocabulary this build never had is off in a rescue");
  // Safe mode in THIS build draws every type it ever drew: the floor is a rescue, not a downgrade.
  assert.strictEqual(VOCAB1_TYPES.includes("Screen") && VOCAB1_TYPES.includes("PersonBot"), true);
});

test("sdui.off also names BLOCKS, as SPEC 5.3's own example does", () => {
  const m = floorFrom({ ...KNOBS, off: ["motion"] }, DEVICE);
  assert.strictEqual(m.motion, "off", "the motion block off means no motion, whatever sdui.motion says");
  assert.strictEqual(m.safe, false, "switching one block off is not safe mode");
  assert.strictEqual(gesturesOn(m), true, "and it leaves the others alone");

  const g = floorFrom({ ...KNOBS, off: ["gesture"] }, DEVICE);
  assert.strictEqual(gesturesOn(g), false);
  assert.strictEqual(g.motion, "on");
  assert.strictEqual(rulesOn(g), true);

  const r = floorFrom({ ...KNOBS, off: ["rules"] }, DEVICE);
  assert.strictEqual(rulesOn(r), false);
  assert.strictEqual(gesturesOn(r), true);

  // Named on the device's own list (the crash guard's) it means the same thing.
  assert.strictEqual(floorFrom(KNOBS, { safe: false, off: ["motion"] }).motion, "off");
  // A block this build does not have is simply nothing: no throw, nothing else turned off.
  const l = floorFrom({ ...KNOBS, off: ["list"] }, DEVICE);
  assert.deepStrictEqual([l.motion, gesturesOn(l), rulesOn(l), l.safe], ["on", true, true, false]);
});

test("sdui.motion: off, reduced, and anything else left alone", () => {
  assert.strictEqual(floorFrom({ ...KNOBS, motion: "off" }, DEVICE).motion, "off");
  assert.strictEqual(floorFrom({ ...KNOBS, motion: "reduced" }, DEVICE).motion, "reduced");
  assert.strictEqual(floorFrom({ ...KNOBS, motion: "nonsense" }, DEVICE).motion, "on");
});

test("the device's own switches add to the server's, and either can turn safe mode on", () => {
  const f = floorFrom({ ...KNOBS, off: ["List"] }, { safe: true, off: ["plan"] });
  assert.strictEqual(f.safe, true);
  assert.deepStrictEqual([...f.off].sort(), ["List", "plan"]);
  const both = floorFrom({ ...KNOBS, off: ["home"] }, { safe: false, off: ["home"] });
  assert.deepStrictEqual(both.off, ["home"], "named twice is still once");
});

// ---------------------------------------------------------------------------

test("a launch that closes cleanly leaves nothing behind", () => {
  const a = startLaunch(readGuard(null));
  assert.strictEqual(a.safe, false);
  assert.strictEqual(a.guard.open, true, "open while it runs");
  const drawing = drawingScreen(a.guard, "home");
  assert.strictEqual(drawing.screen, "home");
  const clean = cleanLaunch(drawing, a.safe);
  assert.strictEqual(clean.open, false);
  assert.strictEqual(clean.screen, "");
  const b = startLaunch(clean);
  assert.strictEqual(b.safe, false, "nothing crashed, so nothing is rescued");
  assert.strictEqual(b.note, "");
});

test("one crash is bad luck: the screen is tried again", () => {
  const first = startLaunch(readGuard(null));
  const died = drawingScreen(first.guard, "plan");   // killed here — never closed
  const second = startLaunch(died);
  assert.strictEqual(second.safe, false, "a single crash does not switch anything off");
  assert.deepStrictEqual(second.guard.off, []);
  assert.strictEqual(second.guard.crashes, 1);
  assert.strictEqual(second.guard.loopScreen, "plan");
});

test("two crashed launches on the same screen: safe mode, that screen off, and the server told", () => {
  let g = startLaunch(readGuard(null)).guard;
  g = drawingScreen(g, "plan");
  g = startLaunch(g).guard;
  g = drawingScreen(g, "plan");
  const rescue = startLaunch(g);
  assert.strictEqual(rescue.safe, true, "this launch draws in safe mode");
  assert.strictEqual(rescue.note, "loop:plan");
  assert.deepStrictEqual(rescue.guard.off, ["plan"]);
  assert.strictEqual(screenOff("plan", floorFrom(KNOBS, { safe: rescue.safe, off: rescue.guard.off })), true);
  assert.strictEqual(rescue.guard.crashes, 0, "the count starts again once the screen is off");
});

test("two crashes on DIFFERENT screens are not a loop", () => {
  let g = startLaunch(readGuard(null)).guard;
  g = drawingScreen(g, "plan");
  g = startLaunch(g).guard;
  g = drawingScreen(g, "home");
  const third = startLaunch(g);
  assert.strictEqual(third.safe, false);
  assert.deepStrictEqual(third.guard.off, []);
  assert.strictEqual(third.guard.crashes, 1, "the count follows the screen, not the launch");
});

test("a clean launch clears it; a rescue that only stayed up because a screen was off does not", () => {
  let g = startLaunch(readGuard(null)).guard;
  g = drawingScreen(g, "plan");
  g = startLaunch(g).guard;
  g = drawingScreen(g, "plan");
  const rescue = startLaunch(g);
  // The rescue launch survives — but only because "plan" was off, so the list stands.
  const afterRescue = cleanLaunch(drawingScreen(rescue.guard, "home"), rescue.safe);
  assert.deepStrictEqual(afterRescue.off, ["plan"]);
  assert.strictEqual(afterRescue.crashes, 0);
  // The next launch is ordinary and stays up on its own: the app is whole again.
  const ordinary = startLaunch(afterRescue);
  assert.strictEqual(ordinary.safe, false);
  const afterOrdinary = cleanLaunch(drawingScreen(ordinary.guard, "plan"), ordinary.safe);
  assert.deepStrictEqual(afterOrdinary.off, [], "a clean ordinary launch gives the screens back");
});

test("a launch that is left within the clean window is not a crash", () => {
  // Someone opens the app on "home" and force-quits it a second later — twice. Nothing crashed, so the third
  // launch is ordinary and "home" still draws.
  let g = readGuard(null);
  for (const _ of [1, 2]) {
    const start = startLaunch(g);
    assert.strictEqual(start.safe, false);
    g = leftLaunch(drawingScreen(start.guard, "home"));
    assert.strictEqual(g.open, false, "reaching the background closes the record");
  }
  const third = startLaunch(g);
  assert.strictEqual(third.safe, false, "two quick exits are not two crashes");
  assert.strictEqual(third.note, "");
  assert.deepStrictEqual(third.guard.off, [], "and nothing is switched off behind the person's back");
});

test("coming back to the foreground opens the crumb again, so a later crash still counts", () => {
  let g = startLaunch(readGuard(null)).guard;
  g = leftLaunch(drawingScreen(g, "plan"));
  g = drawingScreen(g, "plan");                 // back in the foreground, same screen
  assert.strictEqual(g.open, true);
  const next = startLaunch(g);                  // killed mid-draw this time
  assert.strictEqual(next.guard.crashes, 1);
  assert.strictEqual(next.guard.loopScreen, "plan");
});

test("a launch that is left keeps the screens the crash guard switched off", () => {
  // Two crashes on "plan" put it off; the rescue launch is then backgrounded within seconds. A second in the
  // foreground is no proof the app is whole, so "plan" stays off until a launch really does stay up.
  let g = startLaunch(readGuard(null)).guard;
  g = drawingScreen(g, "plan");
  g = startLaunch(g).guard;
  g = drawingScreen(g, "plan");
  const rescue = startLaunch(g);
  assert.deepStrictEqual(rescue.guard.off, ["plan"]);
  const left = leftLaunch(drawingScreen(rescue.guard, "home"));
  assert.deepStrictEqual(left.off, ["plan"]);
  assert.strictEqual(left.crashes, 0, "but it owes nothing for a crash that did not happen");
  // The launch after it stays up on its own, and the app is whole again.
  const ordinary = startLaunch(left);
  assert.strictEqual(ordinary.safe, false);
  assert.deepStrictEqual(cleanLaunch(drawingScreen(ordinary.guard, "plan"), ordinary.safe).off, []);
});

test("the record survives the round trip, and anything unreadable reads as nothing kept", () => {
  let g = startLaunch(readGuard(null)).guard;
  g = drawingScreen(g, "plan");
  const back = readGuard(JSON.stringify(g));
  assert.deepStrictEqual(back, g);
  for (const junk of [null, undefined, "", "{", "[]", '{"open":"yes","crashes":"lots","off":"plan"}']) {
    const r = readGuard(junk as string | null);
    assert.strictEqual(r.open, false, "nothing readable means no launch to blame");
    assert.strictEqual(r.crashes, 0);
    assert.deepStrictEqual(r.off, []);
  }
  assert.strictEqual(startLaunch(readGuard("{")).safe, false, "an unreadable record never rescues by accident");
});

test("the device switches off only so many of its own screens", () => {
  let g = readGuard(null);
  for (let i = 0; i < MAX_OFF + 3; i++) {
    g = startLaunch(g).guard;
    g = drawingScreen(g, `s${i}`);
    g = startLaunch(g).guard;
    g = drawingScreen(g, `s${i}`);
    g = startLaunch(g).guard;
  }
  assert.strictEqual(g.off.length, MAX_OFF);
});

// ---------------------------------------------------------------------------

test("a bad node is named once per type and screen", () => {
  const bad = new BadNodes();
  assert.strictEqual(bad.note("BotCard", "home"), true);
  assert.strictEqual(bad.note("BotCard", "home"), false, "it throws every render; it is reported once");
  assert.strictEqual(bad.note("BotCard", "plan"), true, "the same type on another screen is news");
  assert.strictEqual(bad.note("Vanish", "home"), true);
  assert.deepStrictEqual(bad.list(), ["BotCard:home", "BotCard:plan", "Vanish:home"]);
});

test("the report is capped and says what is wrong without saying who", () => {
  const bad = new BadNodes();
  for (let i = 0; i < MAX_BAD + 4; i++) bad.note(`T${i}`, "home");
  assert.strictEqual(bad.list().length, MAX_BAD);

  const quiet = safetyReportOf(new BadNodes(), false, "");
  assert.deepStrictEqual(quiet, { safe: 1, ok: true }, "a good launch says only that the floor is here");

  const loud = safetyReportOf(bad, true, "loop:plan");
  assert.strictEqual(loud.safe, 1);
  assert.strictEqual(loud.ok, false);
  assert.strictEqual(loud.mode, "safe");
  assert.strictEqual(loud.why, "loop:plan");
  assert.strictEqual(loud.bad?.length, MAX_BAD);
  assert.ok(JSON.stringify(loud).length <= REPORT_MAX_BYTES, "anim §3.9: 512 bytes");
});

test("the worst report there is still fits in 512 bytes", () => {
  // The longest of everything at once: four full-length type and screen ids, safe mode, and a `why` with a
  // full-length screen in it. This is where the cap used to be passed, by about 130 bytes.
  const bad = new BadNodes();
  for (let i = 0; i < MAX_BAD; i++) bad.note(`${i}${"T".repeat(80)}`, `${i}${"s".repeat(80)}`);
  const out = safetyReportOf(bad, true, `loop:${"s".repeat(80)}`);
  assert.ok(JSON.stringify(out).length <= REPORT_MAX_BYTES, `512 bytes, got ${JSON.stringify(out).length}`);
  assert.strictEqual(out.safe, 1, "the promise itself always rides");
  assert.ok(out.why, "and so does the reason safe mode is on");
  assert.ok((out.bad?.length ?? 0) > 0, "with as many names as fit");
});

test("ids are cut, so nothing long rides along", () => {
  const bad = new BadNodes();
  bad.note("T".repeat(200), "s".repeat(200));
  const line = bad.list()[0]!;
  assert.strictEqual(line.length, 40 + 1 + 40);
  const g = drawingScreen(readGuard(null), "s".repeat(200));
  assert.strictEqual(g.screen.length, 64);
});

test("VOCAB1_TYPES is every type the registry draws, so a rescue draws what this build always drew", () => {
  // Read as text rather than imported: components/index.ts pulls in react-native and Skia, which no Node test can
  // load. A type added to the registry before the cut and forgotten here would be dark in safe mode, which is the
  // one launch where a missing node is least affordable.
  const src = readFileSync(new URL("./components/index.ts", import.meta.url), "utf8");
  const body = src.split("export const REGISTRY")[1]?.split("\n};")[0] ?? "";
  const keys = body
    .slice(body.indexOf("{") + 1)
    .replace(/\/\/[^\n]*/g, "")
    .split(",")
    .map((part) => part.split(":")[0]!.trim())
    .filter((k) => /^[A-Za-z][A-Za-z0-9]*$/.test(k));
  assert.ok(keys.length > 20, `the registry should have been read, got ${keys.length} keys`);
  assert.deepStrictEqual([...keys].sort(), [...VOCAB1_TYPES].sort());
});
