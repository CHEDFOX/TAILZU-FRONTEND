// node --test
//
// The formatting helpers, on both paths: with Intl, and on a build that has none.
import test from "node:test";
import assert from "node:assert";
import {
  type FormatEnv, finite, fmtCurrency, fmtDatetime, fmtDuration, fmtElapsed, fmtNumber, fmtPlural, fmtRelative,
  millisOf,
} from "./format.ts";

const NOW = Date.UTC(2026, 10, 13, 9, 30, 0);
const withIntl: FormatEnv = { locale: "en-US", now: NOW, timeZone: "UTC", intl: true };
const plain: FormatEnv = { locale: "en-US", now: NOW, timeZone: "UTC", intl: false };

test("a time may be milliseconds or the ISO string the server sends", () => {
  assert.strictEqual(millisOf(NOW), NOW);
  assert.strictEqual(millisOf("2026-11-13T09:30:00.000Z"), NOW);
  assert.strictEqual(millisOf("not a time"), null);
  assert.strictEqual(millisOf(undefined), null);
  assert.strictEqual(millisOf(Number.POSITIVE_INFINITY), null);
  assert.strictEqual(finite("3"), 0, "anything that is not a finite number is 0");
});

test("numbers are grouped, with or without Intl", () => {
  assert.strictEqual(fmtNumber(1234567, undefined, plain), "1,234,567");
  assert.strictEqual(fmtNumber(1234567, undefined, withIntl), "1,234,567");
  assert.strictEqual(fmtNumber(-1234.5, 2, plain), "-1,234.50");
  assert.strictEqual(fmtNumber(Number.NaN, undefined, plain), "0");
  assert.strictEqual(fmtNumber("12", undefined, plain), "0", "text is not a number");
});

test("money falls back to the code in front when Intl is away", () => {
  assert.strictEqual(fmtCurrency(1200, "INR", plain), "INR 1,200.00");
  assert.strictEqual(fmtCurrency(1200, "nope", plain), "1,200.00");
  const intl = fmtCurrency(1200, "INR", withIntl);
  assert.ok(intl.includes("1,200"), intl);
});

test("one word or the other, with # standing for the number", () => {
  assert.strictEqual(fmtPlural(1, "# note", "# notes", plain), "1 note");
  assert.strictEqual(fmtPlural(3, "# note", "# notes", plain), "3 notes");
  assert.strictEqual(fmtPlural(0, "# note", "# notes", plain), "0 notes");
  assert.strictEqual(fmtPlural(2, "one", "many", plain), "many");
});

test("how long ago, in plain words when there is no Intl", () => {
  assert.strictEqual(fmtRelative(NOW - 10_000, plain), "just now");
  assert.strictEqual(fmtRelative(NOW - 5 * 60_000, plain), "5 min ago");
  assert.strictEqual(fmtRelative(NOW + 2 * 3_600_000, plain), "in 2 h");
  assert.strictEqual(fmtRelative(NOW - 3 * 86_400_000, plain), "3 d ago");
  assert.strictEqual(fmtRelative("nonsense", plain), "");
  const intl = fmtRelative(NOW - 5 * 60_000, withIntl);
  assert.match(intl, /5 min/);
});

test("dates and times, in the zone the renderer asked for", () => {
  assert.strictEqual(fmtDatetime(NOW, "date", plain), "2026-11-13");
  assert.strictEqual(fmtDatetime(NOW, "time", plain), "09:30");
  assert.strictEqual(fmtDatetime(NOW, undefined, plain), "2026-11-13 09:30");
  assert.strictEqual(fmtDatetime("nope", "date", plain), "");
  const intl = fmtDatetime(NOW, "date", withIntl);
  assert.match(intl, /2026/);
});

test("a length of time reads as a clock, and never goes backwards", () => {
  assert.strictEqual(fmtDuration(9_000), "0:09");
  assert.strictEqual(fmtDuration(65_000), "1:05");
  assert.strictEqual(fmtDuration(3_723_000), "1:02:03");
  assert.strictEqual(fmtDuration(-5_000), "0:00");
  assert.strictEqual(fmtDuration("abc"), "0:00");
});

test("elapsed is the call screen's clock, worked out from the environment's now", () => {
  assert.strictEqual(fmtElapsed(NOW - 125_000, plain), "2:05");
  assert.strictEqual(fmtElapsed("2026-11-13T09:28:00.000Z", plain), "2:00");
  assert.strictEqual(fmtElapsed(undefined, plain), "0:00");
});

/** Swap the global `Intl` for a test, and put the real one back. */
const setIntl = (v: unknown): void => { (globalThis as unknown as { Intl: unknown }).Intl = v; };

test("an Intl object is built once and kept, so a list on a tick is not mostly constructors", () => {
  const real = globalThis.Intl;
  let built = 0;
  try {
    setIntl({
      NumberFormat: function () { built += 1; return { format: (n: number) => `#${n}` }; },
      RelativeTimeFormat: function () { built += 1; return { format: (n: number, u: string) => `${n} ${u}` }; },
    });
    // A locale of its own, because the cache lives for as long as the module does.
    const env: FormatEnv = { locale: "zz-CACHE", now: NOW, timeZone: "UTC", intl: true };
    for (let i = 0; i < 100; i += 1) {
      fmtNumber(i, 0, env);
      fmtRelative(NOW - 600_000, env);
    }
    assert.strictEqual(built, 2, "one NumberFormat and one RelativeTimeFormat, not two hundred");
    assert.strictEqual(fmtNumber(7, 0, env), "#7", "and the kept one is the one that does the formatting");
  } finally {
    setIntl(real);
  }
});

test("a build without a formatter falls back once, not on every single label", () => {
  const real = globalThis.Intl;
  let tries = 0;
  try {
    setIntl({ RelativeTimeFormat: function () { tries += 1; throw new Error("this build has no RelativeTimeFormat"); } });
    const env: FormatEnv = { locale: "zz-NONE", now: NOW, timeZone: "UTC", intl: true };
    for (let i = 0; i < 20; i += 1) assert.strictEqual(fmtRelative(NOW - 600_000, env), "10 min ago");
    assert.strictEqual(tries, 1, "the one that failed is remembered, so it is not thrown and caught twenty times");
  } finally {
    setIntl(real);
  }
});
