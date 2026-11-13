// node --test --experimental-strip-types src/sdui/components/input/inputCore.test.ts
//
// Inputs: what is taken out of a value before it is stored, what each kind's written format is, and the arithmetic
// the sliders, steppers and the month grid are drawn from.
import test from "node:test";
import assert from "node:assert";
import {
  INPUT_KINDS, INPUT_LIMITS, asSwitch, chipAdded, chipList, chipRemoved, chosen, clampRating, clampStep, dateValue,
  daysInMonth, firstWeekday, fraction, inputKind, monthGrid, monthStep, options, parseDate, parseTime, sanitizeCode,
  sanitizeLine, sanitizeNumber, sanitizeSearch, sanitizeText, slideCommitted, slideThreshold, slideTravel, stepped,
  columnOffset, timeValue, valueAtX, valueForStore,
} from "./inputCore.ts";

test("WHAT A PERSON TYPES IS DATA: it is never read as a template", () => {
  // The whole of pure/SPEC.md 2.2 principle 4, as one line: the braces survive, exactly as typed.
  const typed = "{{ state.authToken }} and {{ now() }}";
  assert.strictEqual(sanitizeLine(typed), typed);
  assert.strictEqual(sanitizeText(typed), typed);
  assert.strictEqual(valueForStore("text", typed), typed);
  assert.strictEqual(sanitizeLine("$state.token"), "$state.token", "the old token shape is text too");
  assert.strictEqual(sanitizeLine("@label.key"), "@label.key");
});

test("control characters and text that lies about its direction are taken out", () => {
  assert.strictEqual(sanitizeLine("he\u0000llo"), "hello");
  assert.strictEqual(sanitizeLine("pay ‮DROW‬ 100"), "pay DROW 100", "bidi overrides, which rewrite what is read");
  assert.strictEqual(sanitizeLine("one\ntwo"), "one two", "a line is one line");
  assert.strictEqual(sanitizeText("one\r\ntwo\rthree"), "one\ntwo\nthree", "several lines keep their breaks, folded");
  assert.strictEqual(sanitizeText("a\tb"), "a\tb", "a tab in a note is a tab");
});

test("every typed value is capped", () => {
  assert.strictEqual(sanitizeLine("x".repeat(9000)).length, INPUT_LIMITS.lineMax);
  assert.strictEqual(sanitizeLine("x".repeat(99), 10).length, 10);
  assert.strictEqual(sanitizeText("x".repeat(99_999)).length, INPUT_LIMITS.textMax);
  assert.strictEqual(sanitizeText("x".repeat(99_999), 1e9).length, INPUT_LIMITS.textMax, "a node cannot raise the cap");
  // One spaced line, with the leading space gone — but not the trailing one, which is the space before the next word.
  assert.strictEqual(sanitizeSearch("  a   b  "), "a b ");
  assert.strictEqual(sanitizeSearch("x".repeat(400)).length, INPUT_LIMITS.searchMax);
});

test("a code is the letters and digits, upper case, as long as the field", () => {
  assert.strictEqual(sanitizeCode("7kq-29d", 6), "7KQ29D");
  assert.strictEqual(sanitizeCode(" 1 2 3 4 5 6 7 ", 6), "123456", "pasted from a message");
  assert.strictEqual(sanitizeCode("12ab34", 6, true), "1234", "digits only");
  assert.strictEqual(sanitizeCode("abc", 99).length, 3);
  assert.strictEqual(sanitizeCode("a".repeat(50), 99).length, INPUT_LIMITS.codeMax);
});

test("a number can be typed from the left, and only lands when it is a number", () => {
  assert.deepStrictEqual(sanitizeNumber("", {}), { text: "", value: null });
  assert.deepStrictEqual(sanitizeNumber("-", { min: -10 }), { text: "-", value: null }, "halfway through typing -5");
  assert.deepStrictEqual(sanitizeNumber("1.", {}), { text: "1.", value: 1 });
  assert.deepStrictEqual(sanitizeNumber("1.2.3", {}), { text: "1.23", value: 1.23 }, "one point");
  assert.deepStrictEqual(sanitizeNumber("12abc", {}), { text: "12", value: 12 });
  assert.deepStrictEqual(sanitizeNumber("1.239", { decimals: 2 }), { text: "1.23", value: 1.23 });
  assert.deepStrictEqual(sanitizeNumber("1.5", { decimals: 0 }), { text: "15", value: 15 }, "no point allowed at all");
  assert.strictEqual(sanitizeNumber("-5", {}).value, 5, "no minus unless the range goes below zero");
  assert.strictEqual(sanitizeNumber("-5", { min: -10 }).value, -5);
  assert.strictEqual(sanitizeNumber("500", { min: 0, max: 100 }).value, 100, "clamped");
});

test("a slider is inside its range, on its step, and never NaN", () => {
  assert.strictEqual(clampStep(0.34, 0, 1, 0.1), 0.3);
  assert.strictEqual(clampStep(5, 0, 1, 0), 1);
  assert.strictEqual(clampStep(-5, 0, 1, 0), 0);
  assert.strictEqual(clampStep("nonsense", 2, 8, 2), 2, "nothing is the floor, not NaN");
  assert.strictEqual(clampStep(0.1 + 0.2, 0, 1, 0), 0.3, "no 0.30000000000000004 in the store");
  assert.strictEqual(clampStep(7, 0, 1, 0), 1, "a max below the min cannot invert the range");
  assert.strictEqual(fraction(5, 0, 10), 0.5);
  assert.strictEqual(fraction(5, 10, 10), 0, "an empty range is the start");
  // A finger halfway along a 200-wide track with a 24-wide knob.
  assert.strictEqual(valueAtX(100, 200, 24, 0, 10, 1), 5);
  assert.strictEqual(valueAtX(-50, 200, 24, 0, 10, 1), 0);
  assert.strictEqual(valueAtX(9999, 200, 24, 0, 10, 1), 10);
});

test("a stepper, a rating and a slide each stop where they should", () => {
  assert.strictEqual(stepped(3, 1, 0, 5, 1), 4);
  assert.strictEqual(stepped(5, 1, 0, 5, 1), 5, "it stops at the top");
  assert.strictEqual(stepped(0, -1, 0, 5, 1), 0);
  assert.strictEqual(stepped(undefined, 1, 2, 5, 1), 3, "nothing yet counts as the floor");
  assert.strictEqual(clampRating(3.6, 5), 4);
  assert.strictEqual(clampRating(99, 5), 5);
  assert.strictEqual(clampRating(-1, 5), 0);
  assert.strictEqual(clampRating(3, 99), 3, "a node cannot ask for more stars than the cap");
  assert.strictEqual(slideCommitted(0.95), true);
  assert.strictEqual(slideCommitted(0.5), false, "a brush of a sleeve is not a confirmation");
  assert.strictEqual(slideCommitted(0.5, 0.4), true);
});

test("options are pairs however the server writes them, and only an option that exists can be chosen", () => {
  assert.deepStrictEqual(options(["a", "b"]), [{ value: "a", label: "a" }, { value: "b", label: "b" }]);
  assert.deepStrictEqual(options([{ id: "x", title: "Ex" }]), [{ value: "x", label: "Ex" }]);
  assert.deepStrictEqual(options([{ label: "no value" }]), [], "a choice with no value is no choice");
  assert.strictEqual(options(Array.from({ length: 500 }, (_, i) => `o${i}`)).length, INPUT_LIMITS.optionsMax);
  const list = options(["a", "b"]);
  assert.deepStrictEqual(chosen(list, "b"), { value: "b", label: "b" });
  assert.strictEqual(chosen(list, "c"), null, "a value the list does not hold is not chosen");
  assert.strictEqual(valueForStore("segmented", "c", { options: ["a", "b"] }), null);
  assert.strictEqual(valueForStore("segmented", "a", { options: ["a", "b"] }), "a");
});

test("chips are unique, short and capped", () => {
  assert.deepStrictEqual(chipList(["a", "a", " b "]), ["a", "b"]);
  assert.deepStrictEqual(chipList("a,b"), ["a", "b"], "a comma-separated string too");
  assert.deepStrictEqual(chipAdded(["a"], "b"), ["a", "b"]);
  assert.deepStrictEqual(chipAdded(["a"], "a"), ["a"], "the same chip twice is one chip");
  assert.deepStrictEqual(chipAdded(["a"], "   "), ["a"]);
  assert.deepStrictEqual(chipAdded(["a", "b"], "c", 2), ["a", "b"], "full");
  assert.deepStrictEqual(chipRemoved(["a", "b"], "a"), ["b"]);
  assert.strictEqual(chipList(Array.from({ length: 99 }, (_, i) => `c${i}`)).length, INPUT_LIMITS.chipsMax);
  assert.strictEqual(chipAdded([], "x".repeat(200))[0]!.length, INPUT_LIMITS.chipMax);
});

test("a switch reads the way a person would read it", () => {
  assert.strictEqual(asSwitch(true), true);
  assert.strictEqual(asSwitch("false"), false);
  assert.strictEqual(asSwitch("off"), false);
  assert.strictEqual(asSwitch("0"), false);
  assert.strictEqual(asSwitch("yes"), true);
  assert.strictEqual(asSwitch(undefined), false);
});

test("dates and times have one written form, and the calendar arithmetic is its own", () => {
  assert.strictEqual(dateValue(2026, 11, 13), "2026-11-13");
  assert.strictEqual(dateValue(2026, 2, 31), "2026-02-28", "a day past the month's end is pulled back");
  assert.strictEqual(dateValue(2024, 2, 31), "2024-02-29", "a leap year");
  assert.strictEqual(daysInMonth(2000, 2), 29, "a century that is a leap year");
  assert.strictEqual(daysInMonth(1900, 2), 28, "and one that is not");
  assert.strictEqual(timeValue(9, 5), "09:05");
  assert.strictEqual(timeValue(99, 99), "23:59");
  assert.deepStrictEqual(parseDate("2026-11-13"), { year: 2026, month: 11, day: 13 });
  assert.strictEqual(parseDate("2026-02-30"), null, "a day that does not exist");
  assert.strictEqual(parseDate("13/11/2026"), null);
  assert.deepStrictEqual(parseTime("9:05"), { hour: 9, minute: 5 });
  assert.strictEqual(parseTime("24:00"), null);
  // 1 November 2026 is a Sunday.
  assert.strictEqual(firstWeekday(2026, 11), 0);
  const grid = monthGrid(2026, 11);
  assert.strictEqual(grid.length % 7, 0, "whole weeks");
  assert.strictEqual(grid[0], 1, "it starts on the Sunday column");
  assert.strictEqual(grid.filter((d) => d !== null).length, 30);
  assert.deepStrictEqual(monthStep(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepStrictEqual(monthStep(2026, 1, -1), { year: 2025, month: 12 });
});

test("every kind writes the format the server is promised", () => {
  assert.strictEqual(inputKind("code"), "code");
  assert.strictEqual(inputKind("holograph"), null, "a kind this build does not draw");
  assert.strictEqual(inputKind(7), null);
  assert.strictEqual(INPUT_KINDS.length, new Set(INPUT_KINDS).size, "no kind is listed twice");

  assert.strictEqual(valueForStore("multiline", "a\nb"), "a\nb");
  assert.strictEqual(valueForStore("number", "12", { max: 10 }), 10);
  assert.strictEqual(valueForStore("number", "abc"), null);
  assert.strictEqual(valueForStore("switch", "off"), false);
  assert.strictEqual(valueForStore("slider", 0.26, { min: 0, max: 1, step: 0.25 }), 0.25);
  assert.strictEqual(valueForStore("rating", "4", { stars: 5 }), 4);
  assert.deepStrictEqual(valueForStore("chips", ["a", "a"]), ["a"]);
  assert.strictEqual(valueForStore("date", "2026-11-13"), "2026-11-13");
  assert.strictEqual(valueForStore("date", "2026-13-01"), null);
  assert.strictEqual(valueForStore("time", "9:5"), null, "minutes are two digits");
  assert.strictEqual(valueForStore("time", "9:05"), "09:05");
  assert.strictEqual(valueForStore("code", "ab-12", 6 as never), "AB12");
  assert.strictEqual(valueForStore("slideToConfirm", true), true);
});

test("a garbled slide threshold falls back to nine tenths, never to the loosest setting", () => {
  // This is the one control meant to stop an accidental confirm, so a missing or broken value must not make it the
  // easiest control on the screen to trip.
  assert.strictEqual(slideThreshold(undefined), 0.9);
  assert.strictEqual(slideThreshold(null), 0.9);
  assert.strictEqual(slideThreshold(""), 0.9);
  assert.strictEqual(slideThreshold("abc"), 0.9);
  assert.strictEqual(slideThreshold(0), 0.9);
  assert.strictEqual(slideThreshold(-1), 0.9);
  assert.strictEqual(slideThreshold(0.1), 0.5, "half is the floor");
  assert.strictEqual(slideThreshold(0.75), 0.75);
  assert.strictEqual(slideThreshold(5), 1);
  // A 15% slide used to commit when the threshold was nonsense.
  assert.strictEqual(slideCommitted(0.15, null), false);
  assert.strictEqual(slideCommitted(0.15, "abc"), false);
  assert.strictEqual(slideCommitted(0.95, undefined), true);
  assert.strictEqual(slideCommitted(NaN, 0.9), false, "a NaN travel is not a confirm");
});

test("the knob's travel is a real number, whatever the layout says", () => {
  assert.strictEqual(slideTravel(300, 48), 244);
  assert.strictEqual(slideTravel(0, 48), 1, "never zero: it is a divisor");
  assert.strictEqual(slideTravel(NaN, 48), 1);
  assert.strictEqual(slideTravel(300, NaN), 1);
  assert.strictEqual(slideTravel(undefined, undefined), 1);
});

test("a picker column opens on the value already chosen", () => {
  assert.strictEqual(columnOffset(0, 34, 160), 0, "the first row is already in view");
  assert.strictEqual(columnOffset(20, 34, 160), Math.round(20 * 34 - 63), "the chosen row sits in the middle");
  assert.strictEqual(columnOffset(1, 34, 160), 0, "never scrolled above the top");
  assert.strictEqual(columnOffset(-1, 34, 160), 0);
  assert.strictEqual(columnOffset(NaN, 34, 160), 0);
  assert.strictEqual(columnOffset(5, 0, 160), 0);
});

test("an option offered twice is one option", () => {
  // Two rows with one value would be two React keys that are the same, and `chosen()` could only find the first.
  assert.deepStrictEqual(options(["a", "a", "b"]).map((o) => o.value), ["a", "b"]);
  assert.deepStrictEqual(
    options([{ value: "x", label: "First" }, { value: "x", label: "Second" }]),
    [{ value: "x", label: "First" }],
    "the first label wins",
  );
  assert.deepStrictEqual(options([{ id: "p" }, { value: "p" }]).length, 1, "the older shape counts as the same value");
});
