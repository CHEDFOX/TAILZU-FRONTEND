import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DRAWS_FORMAT, activityVars, androidStillKey, artIndexValue, artKeysUsed, artVerdict, bodyBytes, buildIndex, cleanArt, cleanDesign,
  cleanFonts, cleanLook, cleanNativeLooks, cleanPathD, clampVars, copyIsCurrent, copyKey, fitActivityBody, fontIndexValue, fontVerdict,
  glanceQuery, iosStillKey, isAllowedLink, isColour, looksUrl, pickScale, planArt, planFonts, readLooksFlag, slugsOfGlance,
  stillFits, stillSpecs, stillsTotal, toHex, utf8Bytes, writePayload,
  type NLookArt, type NLookDesign, type NLookCatalog,
} from "./looksCore.ts";
import { NLOOK_LIMITS, bindsOn, eachItemInfo, bindPathInfo, WORD_SLOTS } from "./looksTable.ts";

/**
 * The SHARED fixtures (the backend's shared/native/fixtures) are the referee for every side, so this runs them whenever they are on
 * disk. In a checkout without the backend next to it the fixture tests are skipped (said so), and the unit tests below still run.
 */
/** The shared fixtures still spell art as { sha256, bytes, scales }; the catalog now serves { files: [{ scale, sha256, bytes }] }. */
const newArt = (a: unknown): NLookArt[] => ((a as Record<string, any>[] | undefined) ?? []).map((x) => (x.files ? x : {
  key: x.key, w: x.w, h: x.h, files: (x.scales as number[]).map((scale) => ({ scale, sha256: x.sha256, bytes: x.bytes })),
}) as NLookArt);
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../../../../TAILZU-BACKEND/shared/native/fixtures");
const BACKEND = path.resolve(here, "../../../../TAILZU-BACKEND/shared");
const haveFixtures = existsSync(path.join(FIXTURES, "designs.json"));
const readJson = (f: string) => JSON.parse(readFileSync(path.join(FIXTURES, f), "utf8")) as Record<string, any>;
const skip = haveFixtures ? false : "the backend's shared fixtures are not next to this checkout";

type Node = { type: string; props?: Record<string, unknown>; children?: Node[] };

// ---------------------------------------------------------------- the shared fixtures

describe("the shared design fixtures", { skip }, () => {
  const cases = haveFixtures ? (readJson("designs.json").cases as Record<string, any>[]) : [];
  const catalog = haveFixtures ? (JSON.parse(readFileSync(path.join(BACKEND, "native/looks.json"), "utf8")) as NLookCatalog) : null;
  const inCatalog = (extra: Record<string, unknown> = {}) => ({
    drawsFormat: 1,
    palettes: Object.keys(catalog!.palettes),
    art: [] as NLookArt[],
    designIds: ["x0.plain", "bots.plain", ...Object.keys(catalog!.designs)],
    fallbackOf: Object.fromEntries(Object.entries(catalog!.designs).map(([id, d]) => [id, d.fallback])),
    ...extra,
  });
  // The Android planner counts RemoteViews levels, which no JavaScript does: the fixture says iOS draws that design in full.
  const ANDROID_ONLY = new Set(["android.levels.overCap.usesFallback"]);

  for (const c of cases) {
    it(`${c.id}: ${c.expect}`, () => {
      const design = structuredClone(c.design) as NLookDesign & { roots: Record<string, Node> };
      const g = c.generate as Record<string, any> | undefined;
      if (g?.repeatNode && g.times) {
        design.roots[g.root].children = Array.from({ length: Number(g.times) }, () => structuredClone(g.repeatNode));
      }
      if (g?.nestNode && g.depth) {
        let node = design.roots[g.root] as Node;
        for (let i = 1; i < Number(g.depth); i++) { const child = structuredClone(g.nestNode) as Node; node.children = [child]; node = child; }
        node.children = [structuredClone(g.leaf)];
      }
      if (g?.padNoteToBytes) (design as { note?: string }).note = "p".repeat(Number(g.padNoteToBytes));
      const extra: Record<string, unknown> = {};
      if (c.palettes) extra.palettes = Object.keys(c.palettes);
      if (c.catalogArt) extra.art = newArt(c.catalogArt);
      const r = cleanDesign(design, inCatalog(extra));
      assert.equal(r.verdict, ANDROID_ONLY.has(String(c.id)) ? "ok" : c.expect);
      if (r.verdict === "ok" || r.verdict === "clamped") assert.ok(r.design);
      else assert.equal(r.design, undefined);
    });
  }

  it("a clamped case says WHERE, and keeps what it must", () => {
    const bad = cases.find((c) => c.id === "unknown.styleKey.ignored")!;
    const r = cleanDesign(bad.design, inCatalog());
    const at = r.issues.map((i) => i.at);
    assert.ok(at.includes("roots.small.style.blur") && at.includes("roots.small.style.rotate"));
    assert.equal((r.design!.roots!.small!.style as Record<string, unknown>).pad, 8);
  });

  it("an unknown node draws its fallback, and the sibling survives either way", () => {
    const withFb = cleanDesign(cases.find((c) => c.id === "unknown.node.usesFallback")!.design, inCatalog());
    assert.equal(withFb.design!.roots!.small!.children!.length, 2);
    const without = cleanDesign(cases.find((c) => c.id === "unknown.node.noFallbackDrawsNothing")!.design, inCatalog());
    assert.equal(without.design!.roots!.small!.children!.length, 1);
  });

  it("align: an alongTheStack value is dropped and the node is kept (it draws as start)", () => {
    const r = cleanDesign(cases.find((c) => c.id === "align.alongTheStack.clamped")!.design, inCatalog());
    assert.equal(r.verdict, "clamped");
    assert.ok(JSON.stringify(r.design).indexOf("between") < 0);
  });
});

describe("the shared activity fixtures", { skip }, () => {
  const A = haveFixtures ? readJson("activity.json") : { designCases: [], stateCases: [] };
  const catalog = haveFixtures ? (JSON.parse(readFileSync(path.join(BACKEND, "native/looks.json"), "utf8")) as NLookCatalog) : null;
  for (const c of A.designCases as Record<string, any>[]) {
    it(`${c.id}: ${c.expect}`, () => {
      const design = structuredClone(c.design) as NLookDesign & { roots: Record<string, Node> };
      const g = c.generate as Record<string, any> | undefined;
      if (g?.repeatNode && g.times) design.roots[g.root].children = Array.from({ length: Number(g.times) }, () => structuredClone(g.repeatNode));
      const r = cleanDesign(design, {
        drawsFormat: 1, palettes: Object.keys(catalog!.palettes), art: newArt(c.catalogArt),
        designIds: ["x0.plain", "bots.plain", ...Object.keys(catalog!.designs)],
      });
      assert.equal(r.verdict, c.expect);
    });
  }

  it("a region over its node cap keeps the first few rather than losing the region", () => {
    const c = (A.designCases as Record<string, any>[]).find((x) => x.id === "limit.minimalNodes.clamped")!;
    const design = structuredClone(c.design) as NLookDesign & { roots: Record<string, Node> };
    design.roots.minimal.children = Array.from({ length: 6 }, () => ({ type: "Text", props: { text: "m" } }));
    const r = cleanDesign(design, { drawsFormat: 1, palettes: Object.keys(catalog!.palettes) });
    const count = (n: Node): number => 1 + (n.children ?? []).reduce((t, k) => t + count(k), 0);
    assert.ok(count(r.design!.roots!.minimal as Node) <= NLOOK_LIMITS.activity.nodesPerRoot.minimal);
  });

  it("body.overBudget.dropsVars: vars go first, and the body ends under the cap", () => {
    const c = (A.stateCases as Record<string, any>[]).find((x) => x.id === "body.overBudget.dropsVars")!;
    const g = c.generate as Record<string, any>;
    const base = structuredClone(c.state) as Record<string, unknown>;
    const state = { ...base, ...(g?.vars ? { vars: Object.fromEntries(Array.from({ length: Number(g.vars.keys ?? 12) }, (_, i) => [`k${i}`, "v".repeat(Number(g.vars.valueChars ?? 120))])) } : {}) };
    const r = fitActivityBody(state);
    assert.ok(r.bytes <= NLOOK_LIMITS.activityBodyBytes);
    if (bodyBytes(state) > NLOOK_LIMITS.activityBodyBytes) assert.equal(r.gave[0], "vars");
  });

  it("vars.overKeyCount.clamped: twelve keys at most", () => {
    const out = clampVars(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${String(i).padStart(2, "0")}`, "x"])));
    assert.equal(Object.keys(out!).length, NLOOK_LIMITS.vars.keys);
  });

  it("every state case from today's server and the new fields stays under the body cap", () => {
    for (const c of A.stateCases as Record<string, any>[]) {
      if (c.generate) continue;
      assert.ok(fitActivityBody(structuredClone(c.state)).bytes <= NLOOK_LIMITS.activityBodyBytes, String(c.id));
    }
  });
});

describe("the shared path fixtures", { skip }, () => {
  const cases = haveFixtures ? (readJson("paths.json").cases as Record<string, any>[]) : [];
  for (const c of cases) {
    it(`${c.id}: ${c.expect}`, () => {
      let d = String(c.d ?? "");
      const g = c.generate as Record<string, any> | undefined;
      if (g?.repeat && g.toChars) d = String(g.repeat).repeat(Math.ceil(Number(g.toChars) / String(g.repeat).length));
      if (g?.paths) d = Array.from({ length: Number(g.paths) }, (_, i) => `M ${i} 0 L ${i} 4`).join(" ");
      const r = cleanPathD(d);
      if (c.expect === "dropped") assert.equal(r, null);
      else {
        assert.ok(r);
        assert.equal(r!.cut, c.expect === "clamped");
      }
    });
  }
});

describe("the shared bind fixtures", { skip }, () => {
  const cases = haveFixtures ? (readJson("binds.json").cases as Record<string, any>[]) : [];
  for (const c of cases) {
    const p = (typeof c.path === "string" ? c.path : "").replace(/\[\]/g, "[0]");
    if (!p) continue;
    it(`${c.id}: ${c.expect}`, () => {
      const surface = c.surface as "widget" | "activity";
      const inside = typeof c.inside === "string" ? c.inside : null;
      let ok: boolean;
      let sensitive: boolean;
      if (p === "it" || p.startsWith("it.")) {
        const list = inside?.includes("needs.items[].choices") ? "needs.items[].choices"
          : inside?.includes("needs.items") ? "needs.items"
            : inside?.includes("stages") ? "stages" : inside?.includes("bots") ? "bots" : "";
        const info = list ? eachItemInfo(list, p) : null;
        ok = !!info;
        sensitive = info?.sensitive === true;
      } else if (p.startsWith("words.")) {
        const word = p.slice(6);
        const slots = (WORD_SLOTS as Record<string, Record<string, Record<string, unknown>>>)[word];
        const side = surface === "widget" ? "widget" : "state";
        ok = bindsOn(p, surface) && (!slots || Object.values(slots).every((s) => s[side] !== null));
        sensitive = bindPathInfo(p)?.sensitive === true;
      } else if (c.asTimer === true) {
        ok = false;
        sensitive = false;
      } else {
        ok = bindsOn(p, surface);
        sensitive = bindPathInfo(p)?.sensitive === true;
      }
      assert.equal(ok, c.expect === "ok");
      if (c.expect === "ok" && c.sensitive !== undefined) assert.equal(sensitive, c.sensitive === true);
    });
  }
});

describe("the tables agree with the backend's file", { skip }, () => {
  it("every closed table and limit here is the backend's, so a change over there that is not copied here fails", async () => {
    const N = await import(path.join(BACKEND, "types/nlook.ts"));
    const T = await import("./looksTable.ts");
    for (const name of [
      "NLOOK_FORMAT", "NLOOK_CAPS", "WIDGET_ROOTS", "ACTIVITY_ROOTS", "ANDROID_WIDGET_ROOTS", "NLOOK_SURFACES", "NLOOK_TYPES",
      "NLOOK_STYLE_KEYS", "NLOOK_PROPS", "SHAPE_KINDS", "KIT_NAMES", "TEXT_CHANGES", "IMAGE_FITS", "IMAGE_SRC_PREFIXES", "PALETTE_ROLES",
      "ROLE_FALLBACK", "TYPE_TOKENS", "TEXT_WEIGHTS", "CONDITION_KEYS", "LINK_ALLOW", "BIND_PATHS", "EACH_LISTS", "WORD_SLOTS",
      "EACH_ITEM_PREFIX", "BIND_OPEN", "BIND_CLOSE",
    ]) {
      assert.deepEqual((T as Record<string, unknown>)[name], (N as Record<string, unknown>)[name], name);
    }
    assert.equal(String(T.ID_PATTERN), String(N.NLOOK_LIMITS.idPattern));
    assert.equal(String(T.INDEXED_PATH), String(N.INDEXED_PATH));
    const { idPattern: _i, path: p1, ...restN } = N.NLOOK_LIMITS as Record<string, any>;
    const { path: p2, ...restT } = T.NLOOK_LIMITS as unknown as Record<string, any>;
    void _i;
    assert.deepEqual(restT, restN);
    assert.deepEqual({ ...p2 }, { dChars: p1.dChars, perShape: p1.perShape });
    // And the lookups give the same answers on every path the table names, an index into it, and a few that are not in it.
    const probes = [...Object.keys(N.BIND_PATHS), "needs.items[0].question", "needs.items[0].choices[1].label", "vars.eta", "vars.a.b", "words.step", "job.mood", "bots[3].name", "needs.items[9].question"];
    for (const probe of probes) assert.deepEqual(T.bindPathInfo(probe), N.bindPathInfo(probe), probe);
    for (const probe of ["bots", "needs.items[0].choices", "needs.items[].choices", "nope"]) assert.equal(T.eachListKey(probe), N.eachListKey(probe), probe);
    for (const root of [...N.ACTIVITY_ROOTS, "nope"]) assert.equal(T.activityNodeCap(root), N.activityNodeCap(root), root);
  });

  it("cleaning the served catalog gives the same designs the server's own clean gives", async () => {
    const S = await import(path.join(BACKEND, "../tulmi/src/experience/native/clean.ts")).catch(() => null);
    if (!S) return; // the server's file needs its own dependency tree; the fixtures above are the referee either way
    const doc = JSON.parse(readFileSync(path.join(BACKEND, "native/looks.json"), "utf8"));
    const c = cleanNativeLooks(doc, { platform: "ios" })!;
    for (const [id, d] of Object.entries(doc.designs)) {
      const theirs = S.cleanDesign(d, { drawsFormat: 1, palettes: Object.keys(doc.palettes), art: doc.art ?? [] });
      assert.deepEqual(c.designs[id], theirs.design, id);
    }
  });
});

// ---------------------------------------------------------------- the catalog, as the phone cleans it

const PAL = {
  dark: { ground: "#0A0A0A", ink: "#FFFFFF", meta: "#A3A3A3", line: "#262626", surface: "#171717", accent: "#FFFFFF" },
  light: { ground: "#FFFFFF", ink: "#0A0A0A", meta: "#5C5C5C", line: "#E6E6E6", surface: "#F5F5F5", accent: "#0A0A0A" },
};
const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);
const doc = (over: Record<string, unknown> = {}) => ({
  v: 7, format: 1, palettes: { ink: PAL },
  designs: {
    "x0.one": { id: "x0.one", format: 1, surface: "widget", palette: "ink", roots: { small: { type: "Text", props: { text: "{{greeting.hello}}" } } } },
  },
  ...over,
});

describe("cleanNativeLooks: one bad design never refuses the catalog", () => {
  it("drops the bad design alone and keeps the rest", () => {
    const d = doc();
    (d.designs as Record<string, unknown>)["Bad Id"] = { id: "Bad Id", format: 1, surface: "widget", roots: {} };
    (d.designs as Record<string, unknown>)["x0.future"] = { id: "x0.future", format: 2, surface: "widget", roots: { small: { type: "Text", props: { text: "x" } } } };
    const c = cleanNativeLooks(d, { platform: "ios" })!;
    assert.deepEqual(Object.keys(c.designs), ["x0.one"]);
    assert.equal(c.dropped.length, 1);
    assert.deepEqual(c.skipped, ["x0.future"]);
  });

  it("refuses only a catalog that is not one: no object, no v, no palette, too big", () => {
    assert.equal(cleanNativeLooks(null, { platform: "ios" }), null);
    assert.equal(cleanNativeLooks(doc({ v: 0 }), { platform: "ios" }), null);
    assert.equal(cleanNativeLooks(doc({ v: 1.5 }), { platform: "ios" }), null);
    assert.equal(cleanNativeLooks(doc({ palettes: {} }), { platform: "ios" }), null);
    assert.equal(cleanNativeLooks(doc({ note: "x".repeat(300_000) }), { platform: "ios" }), null);
    assert.equal(cleanNativeLooks(doc(), { platform: "ios", drawsFormat: 0 }), null);
  });

  it("a palette with a bad colour is dropped alone, and a design that names it draws the first palette that is sound", () => {
    const d = doc({ palettes: { ink: PAL, broken: { dark: { ...PAL.dark, ink: "white" }, light: PAL.light } } });
    (d.designs as Record<string, any>)["x0.one"].palette = "broken";
    const c = cleanNativeLooks(d, { platform: "ios" })!;
    assert.deepEqual(Object.keys(c.palettes), ["ink"]);
    assert.equal(c.designs["x0.one"]!.palette, "ink");
  });

  it("a design whose key and id differ is dropped, so a file name can never be something the design chose", () => {
    const d = doc();
    (d.designs as Record<string, any>)["x0.other"] = { ...(d.designs as Record<string, any>)["x0.one"], id: "../escape" };
    const c = cleanNativeLooks(d, { platform: "ios" })!;
    assert.deepEqual(Object.keys(c.designs), ["x0.one"]);
  });

  it("art over a cap is left out of the list, and a design that names it falls to its alt", () => {
    const art = [
      { key: "ok", w: 100, h: 100, files: [{ scale: 2, sha256: SHA, bytes: 1000 }, { scale: 3, sha256: SHA, bytes: 1000 }] },
      { key: "huge", w: 2000, h: 100, files: [{ scale: 2, sha256: SHA2, bytes: 1000 }] },
      { key: "heavy", w: 100, h: 100, files: [{ scale: 2, sha256: SHA2, bytes: 600_000 }] },
      { key: "badsha", w: 100, h: 100, files: [{ scale: 2, sha256: "xyz", bytes: 1000 }] },
      { key: "noscale", w: 100, h: 100, files: [{ scale: 7, sha256: SHA, bytes: 1000 }] },
    ];
    assert.deepEqual(cleanArt(art).map((a) => a.key), ["ok"]);
    const d = doc({ art });
    (d.designs as Record<string, any>)["x0.one"].roots.small = { type: "Image", props: { src: "art:huge", alt: "pose:blip" } };
    const c = cleanNativeLooks(d, { platform: "ios" })!;
    assert.equal((c.designs["x0.one"]!.roots!.small as { props: { src: string } }).props.src, "pose:blip");
  });

  it("art is held to 64 files and 6 MB", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ key: `a${i}`, w: 10, h: 10, files: [{ scale: 2, sha256: i.toString(16).padStart(64, "0"), bytes: 1000 }] }));
    assert.equal(cleanArt(many).length, 64);
    const fat = Array.from({ length: 20 }, (_, i) => ({ key: `f${i}`, w: 10, h: 10, files: [{ scale: 2, sha256: i.toString(16).padStart(64, "0"), bytes: 500_000 }] }));
    assert.ok(cleanArt(fat).length <= 12);
  });

  it("fonts: this platform's, under 300 KB, four at most", () => {
    const fonts = [
      { id: "serif.soft", sha256: SHA, bytes: 90_000, platforms: ["ios"] },
      { id: "droid", sha256: SHA2, bytes: 90_000, platforms: ["android"] },
      { id: "fat", sha256: "c".repeat(64), bytes: 400_000, platforms: ["ios"] },
    ];
    assert.deepEqual(cleanFonts(fonts, "ios").map((f) => f.id), ["serif.soft"]);
    assert.deepEqual(cleanFonts(fonts, "android").map((f) => f.id), ["droid"]);
  });
});

describe("what to download", () => {
  const designs = doc().designs as unknown as Record<string, NLookDesign>;
  const art: NLookArt[] = [
    { key: "dusk.sky", w: 100, h: 100, files: [{ scale: 2, sha256: SHA, bytes: 5000 }, { scale: 3, sha256: SHA, bytes: 5000 }] },
    { key: "unused", w: 100, h: 100, files: [{ scale: 2, sha256: SHA2, bytes: 5000 }] },
  ];

  it("fetches only art a kept design uses, once, at the screen's scale", () => {
    const d = structuredClone(designs);
    d["x0.one"]!.roots!.small = { type: "Image", props: { src: "art:dusk.sky" } };
    assert.deepEqual([...artKeysUsed(d)], ["dusk.sky"]);
    const jobs = planArt({ designs: d, art }, 3);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.path, `/v1/native/art/${SHA}@3.png`);
    assert.equal(planArt({ designs: d, art }, 2)[0]!.scale, 2);
  });

  it("the design's own art list counts too, and a bot still is never a file the catalog lists", () => {
    const d = structuredClone(designs);
    d["x0.one"]!.art = ["dusk.sky", "bot:$bot.wave"];
    assert.deepEqual([...artKeysUsed(d)], ["dusk.sky"]);
  });

  it("picks the smallest scale at or above the screen's, else the largest", () => {
    assert.equal(pickScale([2, 3], 2), 2);
    assert.equal(pickScale([2, 3], 2.6), 3);
    assert.equal(pickScale([1, 2], 3), 2);
    assert.equal(pickScale([3], 1), 3);
  });

  it("a font job names its own address", () => {
    assert.equal(planFonts({ fonts: [{ id: "x", sha256: SHA, bytes: 10, platforms: ["ios"] }] })[0]!.path, `/v1/native/font/${SHA}`);
  });

  it("refuses a bad magic, a size over the cap, and a digest that is not the one promised", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    assert.equal(artVerdict(png, SHA, SHA), "ok");
    assert.equal(artVerdict(png, SHA, SHA2), "bad_sha");
    assert.equal(artVerdict(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), SHA, SHA), "bad_magic");
    assert.equal(artVerdict(new Uint8Array(NLOOK_LIMITS.art.fileBytes + 1).fill(0x89), SHA, SHA), "too_big");
    const ttf = new Uint8Array(100); ttf.set([0, 1, 0, 0]);
    assert.equal(fontVerdict(ttf, SHA, SHA), "ok");
    const html = new Uint8Array(100); html.set([0x3c, 0x68, 0x74, 0x6d]);
    assert.equal(fontVerdict(html, SHA, SHA), "bad_magic");
    assert.equal(fontVerdict(new Uint8Array(NLOOK_LIMITS.fonts.fileBytes + 1), SHA, SHA), "too_big");
  });

  it("hex is lowercase, two characters a byte", () => {
    assert.equal(toHex(new Uint8Array([0, 15, 255]).buffer), "000fff");
  });
});

// ---------------------------------------------------------------- the dotted bot's stills

describe("stills: named the way each platform looks them up", () => {
  const botDesign = (props: Record<string, unknown>): Record<string, NLookDesign> => ({
    d: { id: "d", format: 1, surface: "widget", roots: { small: { type: "Bot", props } } },
  });

  it("iOS: bot:<slug>.<moment>@<t>.<scheme>.<px>, both schemes, px = size x scale", () => {
    assert.equal(iosStillKey("code", "wave", 0.6, "dark", 44 * 3), "bot:code.wave@0.60.dark.132");
    const s = stillSpecs(botDesign({ who: "$bot", moment: "wave", at: 0.6, size: 44 }), ["code"], { platform: "ios", scale: 3 });
    assert.deepEqual(s.map((x) => x.key), ["bot:code.wave@0.60.dark.132", "bot:code.wave@0.60.light.132"]);
  });

  it("iOS clamps the way the Swift does: an empty moment is rest, an empty slug x0, px 8 to 512", () => {
    assert.equal(iosStillKey("", "", 2, "light", 2000), "bot:x0.rest@1.00.light.512");
    assert.equal(iosStillKey("a", "m", -1, "light", 1), "bot:a.m@0.00.light.8");
  });

  it("Android: bot:<slug>.<moment>@<t trimmed>, one still, no scheme or size", () => {
    assert.equal(androidStillKey("code", "wave", 0.6), "bot:code.wave@0.6");
    assert.equal(androidStillKey("code", "wave", 1), "bot:code.wave@1");
    assert.equal(androidStillKey("code", "wave", 0), "bot:code.wave@0");
    assert.equal(androidStillKey("", "", 0.456), "bot:blip.rest@0.46");
    const s = stillSpecs(botDesign({ who: "$bot", moment: "wave", at: 0.6, size: 44 }), ["code", "plan"], { platform: "android", scale: 3 });
    assert.deepEqual(s.map((x) => x.key), ["bot:code.wave@0.6", "bot:plan.wave@0.6"]);
    // Two specs under one Android key keep the larger px.
    const two = stillSpecs({ ...botDesign({ who: "$bot", moment: "wave", at: 0.6, size: 20 }), ...{} }, ["code"], { platform: "android", scale: 2 });
    assert.equal(two.find((x) => x.key === "bot:code.wave@0.6")?.px, 40);
  });

  it("the Android notice's stills come from each liveupdate design's fill, keyed by its exact text, at 64 dp (max 256 px)", () => {
    const bu: NLookDesign = {
      id: "bu.base", format: 1, surface: "liveupdate",
      fill: { title: "x", tracker: "bot:$bot.work@0.4", large: "bot:$bot.rest@0.6" },
    };
    const designs = { "bu.base": bu };
    const s = stillSpecs(designs, ["code", "plan"], { platform: "android", scale: 2, liveUpdate: true });
    assert.deepEqual(s.map((x) => x.key), ["bot:code.work@0.4", "bot:plan.work@0.4", "bot:code.rest@0.6", "bot:plan.rest@0.6"]);
    assert.deepEqual(s.map((x) => x.px), [128, 128, 128, 128]);
    assert.equal(stillSpecs(designs, ["code"], { platform: "android", scale: 4, liveUpdate: true })[0]!.px, 256);
    assert.equal(stillSpecs(designs, ["code"], { platform: "android", scale: 2 }).length, 0);
    assert.equal(stillSpecs(designs, ["code"], { platform: "ios", scale: 2, liveUpdate: true }).length, 0);
    // No @t means the middle of the moment.
    const noT: NLookDesign = { ...bu, fill: { tracker: "bot:$bot.work" } };
    assert.equal(stillSpecs({ x: noT }, ["code"], { platform: "android", scale: 2, liveUpdate: true })[0]!.at, 0.5);
  });

  it("the notice never costs a widget its still: widget designs are walked first, the notice last", () => {
    const many = Array.from({ length: 8 }, (_, i) => `b${i}`);
    const bu: NLookDesign = { id: "bu.base", format: 1, surface: "liveupdate", fill: { tracker: "bot:$bot.work@0.4" } };
    const ds = { "bu.base": bu, ...botDesign({ who: "$bot", moment: "wave", at: 0.6, size: 44 }) };
    const s = stillSpecs(ds, many, { platform: "android", scale: 2, liveUpdate: true });
    assert.equal(s.length, 16);
    assert.ok(s.slice(0, 8).every((x) => x.key.includes(".wave@")));
  });

  it("art in the server's files shape is kept, one hash per scale, and each file is checked on its own", () => {
    const art = cleanArt([
      { key: "ok", w: 100, h: 100, files: [{ scale: 3, sha256: SHA2, bytes: 3000 }, { scale: 2, sha256: SHA, bytes: 2000 }] },
      { key: "dup", w: 10, h: 10, files: [{ scale: 2, sha256: SHA, bytes: 10 }, { scale: 2, sha256: SHA2, bytes: 10 }] },
      { key: "none", w: 10, h: 10, files: [{ scale: 2, sha256: "bad", bytes: 10 }] },
      { key: "old", w: 10, h: 10, sha256: SHA, bytes: 10, scales: [2] },
    ]);
    assert.deepEqual(art.map((a) => a.key), ["ok", "dup"]);
    assert.deepEqual(art[0]!.files.map((f) => f.scale), [2, 3]);
    assert.equal(art[1]!.files.length, 1);
    const jobs = planArt({ designs: { d: { id: "d", format: 1, surface: "widget", art: ["ok"] } }, art }, 3);
    assert.equal(jobs[0]!.path, `/v1/native/art/${SHA2}@3.png`);
  });

  it("only the bots shown: a literal avatar id is one still, $bot is one per shown bot, and none shown means none", () => {
    assert.equal(stillSpecs(botDesign({ who: "blip", moment: "rest" }), ["a", "b"], { platform: "android", scale: 2 }).length, 1);
    assert.equal(stillSpecs(botDesign({ who: "$bot", moment: "rest" }), [], { platform: "android", scale: 2 }).length, 0);
    assert.equal(stillSpecs(botDesign({ who: "{{it.slug}}", moment: "rest" }), ["a", "b"], { platform: "android", scale: 2 }).length, 2);
  });

  it("a bot slug that is not a safe name is never drawn", () => {
    assert.equal(stillSpecs(botDesign({ who: "$bot" }), ["../x", "Code Bot"], { platform: "android", scale: 2 }).length, 0);
  });

  it("the stills' own budget: 24 files", () => {
    const many = Array.from({ length: 8 }, (_, i) => `b${i}`);
    const ds: Record<string, NLookDesign> = {};
    for (let m = 0; m < 6; m++) Object.assign(ds, { [`d${m}`]: { id: `d${m}`, format: 1, surface: "widget", roots: { small: { type: "Bot", props: { who: "$bot", moment: `m${m}` } } } } });
    assert.equal(stillSpecs(ds, many, { platform: "android", scale: 2 }).length, 24);
  });

  it("the shown bots come off a glance: the job, the last thing done, the questions, then the row", () => {
    assert.deepEqual(slugsOfGlance({ job: { bot: "code" }, lastDone: { bot: "plan" }, needs: { items: [{ bot: "code" }, { bot: "notes" }] }, bots: [{ slug: "travel" }] }), ["code", "plan", "notes", "travel"]);
  });
});

// ---------------------------------------------------------------- the index, the flag, the glance

describe("the index the widgets read", () => {
  const c = cleanNativeLooks(doc(), { platform: "ios" })!;

  it("maps each design to its file, and each art key to the file the platform reads", () => {
    const { index } = buildIndex(c, { art: { "dusk.sky": artIndexValue("ios", SHA, 3) } });
    assert.deepEqual(index.designs, { "x0.one": "x0.one.json" });
    assert.equal(index.art["dusk.sky"], `${SHA}@3.png`);
    assert.equal(artIndexValue("android", SHA, 3), `nlook/art/${SHA}@3.png`);
    assert.equal(fontIndexValue("ios", SHA, "ttf"), `${SHA}.ttf`);
    assert.equal(fontIndexValue("android", SHA, "otf"), `nlook/font/${SHA}`);
    assert.equal(index.drawsFormat, DRAWS_FORMAT);
  });

  it("a write with no design in it is not written at all", () => {
    const { index } = buildIndex({ ...c, designs: {} }, { art: {} });
    assert.equal(writePayload(index, {}), null);
    const ok = buildIndex(c, { art: {} });
    assert.ok(JSON.parse(writePayload(ok.index, ok.designs)!).designs["x0.one"]);
  });

  it("a copy is keyed on (v, drawsFormat): the same v with a higher format is not current", () => {
    assert.equal(copyKey(7, 1), "7:1");
    assert.equal(copyIsCurrent({ v: 7, drawsFormat: 1 }, { v: 7 }, 1), true);
    assert.equal(copyIsCurrent({ v: 7, drawsFormat: 1 }, { v: 7 }, 2), false);
    assert.equal(copyIsCurrent({ v: 6, drawsFormat: 1 }, { v: 7 }, 1), false);
    assert.equal(copyIsCurrent({ v: 8, drawsFormat: 1 }, { v: 7 }, 1), true);
    assert.equal(copyIsCurrent({ v: 8, drawsFormat: 1 }, { v: 7 }, 2), false);
    assert.equal(copyIsCurrent(null, { v: 7 }, 1), false);
  });

  it("the stills budget counts distinct pictures and never makes room by dropping a wanted one", () => {
    const held = [{ sha: "a", bytes: 600 }, { sha: "a", bytes: 600 }, { sha: "b", bytes: 300 }];
    assert.equal(stillsTotal(held), 900);
    assert.equal(stillFits(held, { sha: "c", bytes: 100 }, 1000), true);
    assert.equal(stillFits(held, { sha: "c", bytes: 101 }, 1000), false);
    assert.equal(stillFits(held, { sha: "b", bytes: 9999 }, 1000), true);
  });

  it("reads the bootstrap's flag only when it is a version and a path on the API", () => {
    assert.deepEqual(readLooksFlag({ v: 7, url: "/v1/native/looks?v=7" }), { v: 7, url: "/v1/native/looks?v=7" });
    assert.equal(readLooksFlag({ v: 7, url: "https://elsewhere.example/x" }), null);
    assert.equal(readLooksFlag({ v: 0, url: "/v1/x" }), null);
    assert.equal(readLooksFlag(undefined), null);
  });

  it("asks for what this build can draw and says which platform", () => {
    assert.equal(looksUrl("/v1/native/looks?v=7", "ios", ["NativeLook1", "WidgetBoard1"]), "/v1/native/looks?v=7&platform=ios&can=NativeLook1%2CWidgetBoard1");
    assert.equal(looksUrl("/v1/native/looks", "android", ["NativeLook1"]), "/v1/native/looks?platform=android&can=NativeLook1");
  });
});

describe("the glance's look", () => {
  it("keeps a design per widget kind, a palette and the vars, and nothing else", () => {
    assert.deepEqual(cleanLook({ look: { x0: "x0.dusk", board: "board.night", "Bad Kind": "x", x1: "../up" }, palette: "ink", vars: { moved: "3", since: "9" }, other: 1 }), {
      look: { x0: "x0.dusk", board: "board.night" }, palette: "ink", vars: { moved: "3", since: "9" },
    });
    assert.deepEqual(cleanLook({}), {});
    assert.deepEqual(cleanLook("nope"), {});
    assert.deepEqual(cleanLook({ look: { x0: 5 } }), {});
  });

  it("vars are held to 12 keys, a key of 24 characters, a value of 120", () => {
    const v = clampVars({ ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, "x".repeat(200)])) })!;
    assert.equal(Object.keys(v).length, 12);
    assert.ok(Object.values(v).every((s) => s.length === 120));
  });

  it("the request carries nl, can and platform only for a build that draws native looks", () => {
    assert.equal(glanceQuery({ drawsNative: false, held: 7, platform: "ios", caps: ["NativeLook1"] }), "");
    assert.equal(glanceQuery({ drawsNative: true, held: 7, platform: "ios", caps: ["PushTimeSensitive", "NativeLook1", "WidgetBoard1"] }), "&nl=7&can=NativeLook1%2CWidgetBoard1&platform=ios");
    assert.equal(glanceQuery({ drawsNative: true, held: 0, platform: "android", caps: ["NativeLook1"] }), "&nl=0&can=NativeLook1&platform=android");
  });
});

describe("the Live Activity's vars", () => {
  const now = 1_763_000_000_000;
  it("left and eta, as the server counts them", () => {
    assert.deepEqual(activityVars({ now, startedAt: now - 20 * 60_000, stage: 3, of: 5, phase: "working" }), { eta: "20", left: "2" });
    assert.deepEqual(activityVars({ now, startedAt: now - 20 * 60_000, stage: 1, of: 5, phase: "working" }), { left: "4" });
    assert.equal(activityVars({ now, startedAt: now - 20 * 60_000, stage: 5, of: 5, phase: "done" }), undefined);
  });
});

describe("small grammar", () => {
  it("colours, links and utf-8", () => {
    for (const ok of ["#fff000", "#fff00080", "ink", "paper", "hollow@0.5", "$color", "$bot.code", "ink@1"]) assert.equal(isColour(ok), true, ok);
    for (const bad of ["red", "#fff", "ink@2", "$bot.", "", "ink@x"]) assert.equal(isColour(bad), false, bad);
    assert.equal(isAllowedLink("tulmi://home"), true);
    assert.equal(isAllowedLink("https://github.com/a/b/pull/3"), true);
    assert.equal(isAllowedLink("https://evil.example/"), false);
    assert.equal(isAllowedLink("javascript:alert(1)"), false);
    assert.equal(utf8Bytes("a"), 1);
    assert.equal(utf8Bytes("é"), 2);
    assert.equal(utf8Bytes("क"), 3);
    assert.equal(utf8Bytes("😀"), 4);
  });
});
