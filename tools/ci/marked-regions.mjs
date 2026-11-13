#!/usr/bin/env node
// THE MARKED REGIONS MUST MATCH, BYTE FOR BYTE.
//
// Two pieces of this app are written twice on purpose, and a silent drift in either is a bug nobody sees until a phone is
// in someone's hand:
//
//   BotsAtWorkAttributes   the Live Activity's state, declared once in the widget extension and once in the bridge pod.
//                          ActivityKit matches the two by the type's NAME and its ENCODING, so if one copy gains a field
//                          the other has not, every push silently stops decoding — the activity just stops moving.
//   NLookPathCore          the `M L Q C Z O` path parser, in the widget renderer and in the keyboard. A path drawn for an
//                          animation scene has to stay drawable as a widget shape and as a key print; two parsers that
//                          disagree is two different drawings of one design.
//   CoreExprGrammar        the numeric expression grammar, in the bot tiles' core and in the screen kernel. A number
//                          means the same thing in a bot's moment and on a screen, or one of the two is wrong.
//
// A pair's file is usually marked at both ends. One may instead be named with `{ file, from, to }`: the region is the
// text from `from` to the end of `to`, both of which must appear exactly once. That is for a file nobody may touch —
// `src/botTiles/core.ts` is frozen by its own sha chain, so the kernel carries the marked copy and core.ts carries none.
//
// Each pair has one owner (OWNERSHIP.md): IOS-WIDGETS holds the pen on the nlook copies and on both copies of the
// attributes; IOS-KEYBOARD and ANDROID-KEYBOARD hold their own path copies. This only checks.
//
// Every file a pair names must exist. A missing one FAILS: all six are written, so a rename or a move that loses one
// would otherwise switch the check off with nobody noticing. An unmarked file fails too, for the same reason.
//
//   node tools/ci/marked-regions.mjs                 every pair, for a local run
//   node tools/ci/marked-regions.mjs --lang Swift    only the Swift pairs
//   node tools/ci/marked-regions.mjs --lang Kotlin   only the Kotlin pairs
//   node tools/ci/marked-regions.mjs --lang TS       only the TypeScript pairs (eas-release.yml's marked-regions-ts job
//                                                    runs this one, and so does the phone's own `npm test`)
//
// Each workflow runs the pairs its own `paths` watch, so an iOS push is never failed by a Kotlin drift it did not cause
// and the Android workflow actually runs the Kotlin one.

import { readFileSync, existsSync } from "node:fs";

const PAIRS = [
  {
    marker: "BotsAtWorkAttributes",
    lang: "Swift",
    files: [
      "app/targets/widgets/_shared/BotsAtWork.swift",
      "app/modules/tulmi-bridge/ios/BotsLiveActivity.swift",
    ],
    why: "ActivityKit matches the two copies by name and encoding; a field in one and not the other breaks every push.",
  },
  {
    marker: "NLookPathCore",
    lang: "Swift",
    files: [
      "app/targets/widgets/NLookPath.swift",
      "app/targets/keyboard/KBPath.swift",
    ],
    why: "One path grammar, two parsers: a design must draw the same as a widget shape and as a key print.",
  },
  {
    marker: "NLookPathCore",
    lang: "Kotlin",
    files: [
      "app/modules/tulmi-bridge/android/src/main/java/expo/modules/tulmibridge/NLookPaint.kt",
      "app/modules/tulmi-keyboard/android/KbPath.kt",
    ],
    why: "The same two parsers on Android. The widget copy (NLookPaint.kt) is the master; the keyboard copies it.",
  },
  {
    marker: "CoreExprGrammar",
    lang: "TS",
    files: [
      "app/src/sdui/kernel/coreGrammar.ts",
      {
        file: "app/src/botTiles/core.ts",
        from: "// ---- the expression language (the mic program's, motionLang.ts on the server: same grammar, numbers only)",
        to: "  return s[0]!;\n}",
      },
    ],
    why: "One numeric grammar for the bot's moments and for a screen's expressions. core.ts is the master and carries no markers: it is frozen by its own sha chain, so the kernel holds the marked copy.",
  },
];

/// `--lang Swift` / `--lang Kotlin`, or nothing for every pair.
function wantedLang(argv) {
  const at = argv.indexOf("--lang");
  if (at === -1) return null;
  const want = argv[at + 1];
  const known = [...new Set(PAIRS.map((p) => p.lang))];
  if (!want || !known.includes(want)) {
    console.error(`--lang takes one of: ${known.join(", ")}`);
    process.exit(2);
  }
  return want;
}

/// Everything between "// BEGIN <marker>" and "// END <marker>", or null when the file has no such region.
function region(path, marker) {
  const text = readFileSync(path, "utf8");
  const begin = text.indexOf(`// BEGIN ${marker}`);
  const end = text.indexOf(`// END ${marker}`);
  if (begin === -1 || end === -1 || end < begin) return null;
  return text.slice(begin, end + `// END ${marker}`.length);
}

/// A file named with `{ file, from, to }`: the region is its text from `from` to the end of `to`, wrapped in the
/// markers the other copy carries, so the two compare as they are written. Null when either anchor is not there
/// exactly once — a moved or copied anchor must fail, not quietly check half a file.
function anchored(entry, marker) {
  const text = readFileSync(entry.file, "utf8");
  const first = text.indexOf(entry.from);
  const last = text.indexOf(entry.to);
  if (first === -1 || last === -1 || last < first) return null;
  if (text.indexOf(entry.from, first + 1) !== -1 || text.indexOf(entry.to, last + 1) !== -1) return null;
  const body = text.slice(first, last + entry.to.length);
  return `// BEGIN ${marker}\n${body}\n// END ${marker}`;
}

/// The path of a pair's file, however it was named.
const pathOf = (entry) => (typeof entry === "string" ? entry : entry.file);

/// A pair's file as it compares: a marked region, or an anchored slice wrapped in the same markers.
const bodyOf = (entry, marker) => (typeof entry === "string" ? region(entry, marker) : anchored(entry, marker));

const lang = wantedLang(process.argv.slice(2));
const pairs = lang ? PAIRS.filter((p) => p.lang === lang) : PAIRS;
let failed = false;

console.log(lang ? `Checking the ${lang} pairs.` : "Checking every pair.");

for (const pair of pairs) {
  const name = `${pair.marker} (${pair.lang})`;
  let broke = false;

  const missing = pair.files.map(pathOf).filter((f) => !existsSync(f));
  if (missing.length) {
    failed = true;
    console.error(`FAIL ${name}: ${missing.join(", ")} is not there. Both copies of a marked region must exist.`);
    console.error(`     ${pair.why}`);
    continue;
  }

  const regions = pair.files.map((f) => ({ file: pathOf(f), anchors: typeof f !== "string", body: bodyOf(f, pair.marker) }));
  const empty = regions.filter((r) => r.body === null);
  if (empty.length) {
    failed = true;
    for (const r of empty) {
      if (r.anchors) console.error(`FAIL ${name}: ${r.file} does not hold this pair's two anchor lines exactly once.`);
      else console.error(`FAIL ${name}: ${r.file} has no "// BEGIN ${pair.marker}" / "// END ${pair.marker}" region.`);
    }
    console.error(`     ${pair.why}`);
    continue;
  }

  const [first, ...rest] = regions;
  for (const other of rest) {
    if (other.body === first.body) continue;
    failed = true;
    broke = true;
    console.error(`FAIL ${name}: ${first.file} and ${other.file} differ inside the markers.`);
    console.error(`     ${pair.why}`);
    // The first differing line, so the message is useful on its own.
    const a = first.body.split("\n");
    const b = other.body.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] === b[i]) continue;
      console.error(`     first difference at line ${i + 1} of the region:`);
      console.error(`       ${first.file}: ${a[i] ?? "(the region ends here)"}`);
      console.error(`       ${other.file}: ${b[i] ?? "(the region ends here)"}`);
      break;
    }
  }
  // This pair's own verdict, not the run's: an earlier failure must not silence a later pair's "identical".
  if (!broke) console.log(`- ${name}: identical in ${pair.files.length} files.`);
}

if (failed) {
  console.error("\nThe marked regions must be changed in ONE commit, in every copy. See OWNERSHIP.md.");
  process.exit(1);
}
console.log("\nEvery marked region matches.");
