/**
 * THE SERVER-DRAWN LOOKS, THE RULES (looks.ts wires them to the phone; botArt.ts draws the stills). Free of react-native, so each rule
 * is tested on its own (looksCore.test.ts) against the SAME shared fixtures the server, iOS and Android read.
 *
 * The contract is the backend's shared/types/nlook.ts (mirrored as data in looksTable.ts) and native/SPEC.md. Three checks guard a
 * design: the server cleans it on publish, THIS file cleans it again before anything native is written, and native code clamps a
 * third time. The rule the whole format rests on: UNKNOWN DEGRADES, NEVER THROWS. An unknown node draws its `fallback`, then nothing;
 * an unknown style key is ignored; an unknown colour becomes ink; a design whose `format` is too new is skipped ALONE. Only four
 * things refuse a whole design: a bad id, a fallback that rings, more nodes than the cap, and more bytes than the cap.
 *
 *   cleanDesign / cleanNativeLooks   a mirror of the server's clean.ts, one design at a time: a bad one is dropped ALONE
 *   planArt / planFonts              what to download (by content hash, within the caps), and what to leave
 *   stillSpecs                       the dotted-bot stills the designs and the glance need, named the way each platform looks them up
 *   buildIndex                       what the widgets read to find a design, art and font by id
 *   fitActivityBody, clampVars       the Live Activity's 3.5 KB and its free `vars`, in the order the server gives things up
 *   cleanLook                        the glance's `look`, `palette` and `vars`, checked before a widget reads them
 *   glanceQuery                      the glance request's own `nl`, `can` and `platform`
 *
 * No downloaded code anywhere (App Review 2.5.2): a design is data, drawn by interpreters compiled into the binary.
 */
import {
  ACTIVITY_ROOTS, BIND_CLOSE, BIND_PATHS, BIND_OPEN, CONDITION_KEYS, EACH_ITEM_PREFIX, ID_PATTERN, IMAGE_FITS, IMAGE_SRC_PREFIXES, KIT_NAMES,
  LINK_ALLOW, NLOOK_LIMITS, NLOOK_PROPS, NLOOK_STYLE_KEYS, NLOOK_SURFACES, NLOOK_TYPES, PALETTE_ROLES, ROLE_FALLBACK, SHAPE_KINDS,
  TEXT_CHANGES, TEXT_WEIGHTS, TYPE_TOKENS, WIDGET_ROOTS, activityNodeCap, bindPathInfo, bindsOn, eachItemInfo, eachListKey,
  type NLookSurface, type NLookType,
} from "./looksTable.ts";

/** The highest design format this JavaScript lets the binary draw. An OTA may raise it with a NativeLook2 binary behind it. */
export const DRAWS_FORMAT = 1;

// ---------------------------------------------------------------- the shapes (the catalog as the server serves it)

export interface NLookNode {
  type: string;
  props?: Record<string, unknown>;
  style?: Record<string, unknown>;
  children?: NLookNode[];
  if?: Record<string, unknown>;
  fallback?: NLookNode;
}

export interface NLookDesign {
  id: string;
  format: number;
  surface: NLookSurface;
  fallback?: string;
  palette?: string;
  roots?: Record<string, NLookNode>;
  fill?: Record<string, unknown>;
  art?: string[];
  note?: string;
  since?: number;
}

export interface NLookArtFile { scale: 1 | 2 | 3; sha256: string; bytes: number }
export interface NLookArt { key: string; w: number; h: number; files: NLookArtFile[] }
export interface NLookFont { id: string; sha256: string; bytes: number; platforms: ("ios" | "android")[] }
export type NLookScheme = Record<string, string>;
export interface NLookPalette { dark: NLookScheme; light: NLookScheme; alpha?: { dim?: number; rule?: number }; note?: string }

export interface NLookCatalog {
  v: number;
  format: number;
  note?: string;
  palettes: Record<string, NLookPalette>;
  designs: Record<string, NLookDesign>;
  art?: NLookArt[];
  fonts?: NLookFont[];
}

export type Platform = "ios" | "android";

/** What a case in the shared fixtures expects. `skipped` is not a problem: the design is simply not for this build. */
export type Verdict = "ok" | "clamped" | "dropped" | "skipped";
export interface CleanIssue { at: string; why: string }

export interface CleanResult {
  id: string;
  verdict: Verdict;
  design?: NLookDesign;
  issues: CleanIssue[];
  binds: string[];
}

export interface CleanOptions {
  drawsFormat?: number;
  palettes?: readonly string[];
  art?: readonly NLookArt[];
  designIds?: readonly string[];
  fallbackOf?: Readonly<Record<string, string | undefined>>;
}

const NODE_TYPES = new Set<string>(NLOOK_TYPES);
const STYLE_KEYS = new Set<string>(NLOOK_STYLE_KEYS);
const ROLES = new Set<string>(PALETTE_ROLES);
const CONDS = new Set<string>(CONDITION_KEYS);
const ALIGNS = new Set(["start", "center", "end"]);
const FITS = new Set<string>(IMAGE_FITS);
const KITS = new Set<string>(KIT_NAMES);
const SHAPES = new Set<string>(SHAPE_KINDS);
const CHANGES = new Set<string>(TEXT_CHANGES);
const FONTS = new Set<string>(TYPE_TOKENS);
const WEIGHTS = new Set<number>(TEXT_WEIGHTS);

/** How many numbers each path command takes. Anything else drops only that path (never the shape, never the design). */
const PATH_ARGS: Readonly<Record<string, number>> = { M: 2, L: 2, Q: 4, C: 6, Z: 0, O: 3 };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** What a string is in UTF-8 bytes: what the server's Buffer.byteLength and Swift's JSONEncoder count. */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i++; } else n += 3;
    } else n += 3;
  }
  return n;
}

// ---------------------------------------------------------------- the small pieces

/** The path grammar, M L Q C Z O. The `d` as it may be drawn, or null when the whole path is refused. Over 12 subpaths the extras are cut. */
export function cleanPathD(d: string): { d: string; cut: boolean } | null {
  if (!d || d.length > NLOOK_LIMITS.path.dChars) return null;
  const tokens = d.trim().split(/[\s,]+/).filter(Boolean);
  const out: string[] = [];
  let cmd = "";
  let subpaths = 0;
  let cut = false;
  for (let i = 0; i < tokens.length;) {
    const t = tokens[i]!;
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t.toUpperCase();
      if (!(cmd in PATH_ARGS)) return null;
      i++;
    } else if (!cmd) {
      return null;
    }
    const n = PATH_ARGS[cmd]!;
    const args = tokens.slice(i, i + n);
    if (args.length < n) return null;
    for (const a of args) if (!Number.isFinite(Number(a))) return null;
    if (cmd === "M") {
      subpaths++;
      if (subpaths > NLOOK_LIMITS.path.perShape) { cut = true; break; }
    }
    out.push(cmd, ...args);
    i += n;
    // A bare Z repeats nothing: the next token must name a command again.
    if (n === 0 && i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]!)) return null;
  }
  if (!out.length) return null;
  return { d: out.join(" "), cut };
}

/** A colour the grammar allows: a hex, a palette role, $color or $bot.<slug>, any of them with an @alpha suffix. */
export function isColour(v: unknown): boolean {
  const s = str(v);
  if (!s) return false;
  const at = s.lastIndexOf("@");
  const base = at > 0 ? s.slice(0, at) : s;
  if (at > 0) {
    const a = Number(s.slice(at + 1));
    if (!Number.isFinite(a) || a < 0 || a > 1) return false;
  }
  if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(base)) return true;
  if (ROLES.has(base)) return true;
  if (base === "$color") return true;
  return /^\$bot\.[a-z0-9_-]{1,40}$/.test(base);
}

/** A link a design may open: our own scheme, or the one https shape today's allow-list permits. Checked again natively. */
export function isAllowedLink(v: unknown): boolean {
  const s = str(v).trim();
  if (!s) return false;
  if (s.startsWith(`${LINK_ALLOW.scheme}://`)) return true;
  return s.startsWith(LINK_ALLOW.httpsPrefix);
}

/** Every `{{path}}` a template names. */
export function templatePaths(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const open = text.indexOf(BIND_OPEN, from);
    if (open < 0) break;
    const close = text.indexOf(BIND_CLOSE, open + BIND_OPEN.length);
    if (close < 0) break;
    out.push(text.slice(open + BIND_OPEN.length, close).trim());
    from = close + BIND_CLOSE.length;
  }
  return out;
}

/** Whether a bound path resolves on this surface, inside (or outside) an `Each`. An unknown one is not an error: it resolves empty. */
export function bindResolves(path: string, surface: NLookSurface, inEach: string | null): boolean {
  if (path.startsWith(EACH_ITEM_PREFIX) || path === "it") return inEach ? !!eachItemInfo(inEach, path) : false;
  return bindsOn(path, surface);
}

/** What `if.has` may name: a path this build knows, or the START of one ("lastDone.pr"). */
export function hasPathKnown(path: string, surface: NLookSurface): boolean {
  if (bindsOn(path, surface)) return true;
  const under = `${path}.`;
  return Object.entries(BIND_PATHS).some(([key, info]) => key.startsWith(under) && info.on.includes(surface));
}

// ---------------------------------------------------------------- one node

interface Ctx {
  surface: NLookSurface;
  issues: CleanIssue[];
  art: Map<string, NLookArt>;
  unknownBinds: string[];
}

function fallbackOf(node: NLookNode, depth: number, ctx: Ctx, at: string, why: string): NLookNode | null {
  ctx.issues.push({ at, why });
  return isObj(node.fallback) ? cleanNode(node.fallback as NLookNode, depth, ctx, `${at}.fallback`, null) : null;
}

function cleanNode(raw: NLookNode, depth: number, ctx: Ctx, at: string, inEach: string | null): NLookNode | null {
  if (!isObj(raw)) return null;
  if (depth > NLOOK_LIMITS.widget.depth) {
    ctx.issues.push({ at, why: `deeper than ${NLOOK_LIMITS.widget.depth}: everything below is dropped` });
    return null;
  }
  const type = str(raw.type);
  const surface = NLOOK_SURFACES[ctx.surface];
  if (!NODE_TYPES.has(type)) return fallbackOf(raw, depth, ctx, at, `unknown node type "${type || "?"}"`);
  if (surface.without.includes(type as NLookType)) return fallbackOf(raw, depth, ctx, at, `a ${ctx.surface} has no ${type}`);

  const props: Record<string, unknown> = {};
  const known = new Set(NLOOK_PROPS[type as NLookType]);
  for (const [k, v] of Object.entries(isObj(raw.props) ? raw.props : {})) {
    if (!known.has(k)) { ctx.issues.push({ at: `${at}.props.${k}`, why: "not a prop of this node type: ignored" }); continue; }
    props[k] = v;
  }

  let each: string | null = inEach;
  switch (type) {
    case "V": case "H": case "Z": {
      if (props.align !== undefined && !ALIGNS.has(str(props.align))) {
        ctx.issues.push({ at: `${at}.props.align`, why: `align is start | center | end (across the stack); "${str(props.align)}" is dropped and the node draws as start` });
        delete props.align;
      }
      break;
    }
    case "Text": {
      const text = str(props.text);
      if (text.length > NLOOK_LIMITS.textChars) {
        ctx.issues.push({ at: `${at}.props.text`, why: `over ${NLOOK_LIMITS.textChars} characters: cut` });
        props.text = text.slice(0, NLOOK_LIMITS.textChars);
      }
      for (const p of templatePaths(str(props.text))) {
        if (!bindResolves(p, ctx.surface, each)) ctx.unknownBinds.push(`${at}.props.text: {{${p}}}`);
      }
      if (props.align !== undefined && !ALIGNS.has(str(props.align))) { ctx.issues.push({ at: `${at}.props.align`, why: "text align is start | center | end" }); delete props.align; }
      if (props.font !== undefined && !FONTS.has(str(props.font))) { ctx.issues.push({ at: `${at}.props.font`, why: `unknown type token "${str(props.font)}": sans` }); delete props.font; }
      if (props.weight !== undefined && !WEIGHTS.has(Number(props.weight))) { ctx.issues.push({ at: `${at}.props.weight`, why: "weight is 400 to 800 in hundreds" }); delete props.weight; }
      if (props.tint !== undefined && !isColour(props.tint)) { ctx.issues.push({ at: `${at}.props.tint`, why: "unknown colour: ink" }); props.tint = "ink"; }
      if (props.change !== undefined && !CHANGES.has(str(props.change))) { ctx.issues.push({ at: `${at}.props.change`, why: "change is numeric | fade | push | none" }); delete props.change; }
      for (const key of ["timer", "countdown", "relative"] as const) {
        const p = str(props[key]);
        if (!p) continue;
        if (bindPathInfo(p)?.kind !== "date" || !bindsOn(p, ctx.surface)) {
          ctx.issues.push({ at: `${at}.props.${key}`, why: `${key} needs a date path; "${p}" is not one` });
          delete props[key];
        }
      }
      break;
    }
    case "Image": {
      const src = str(props.src);
      const ok = IMAGE_SRC_PREFIXES.some((p) => src.startsWith(p));
      const alt = str(props.alt);
      const bad = (why: string): NLookNode | null => {
        if (!alt) return fallbackOf(raw, depth, ctx, at, `${why}, and no alt`);
        ctx.issues.push({ at: `${at}.props.src`, why: `${why}: the alt draws` });
        props.src = alt;
        delete props.alt;
        return null;
      };
      if (!ok) { const r = bad(`"${src}" is not art:, face:, pose: or sym:`); if (r || !alt) return r; }
      if (src.startsWith("art:")) {
        const key = src.slice(4);
        const file = ctx.art.get(key);
        if (!key.startsWith("bot:") && !file) { const r = bad(`art "${key}" is not in the catalog`); if (r || !alt) return r; }
        if (file && Math.max(file.w, file.h) > NLOOK_LIMITS.art.longEdgePx) { const r = bad(`art "${key}" is ${Math.max(file.w, file.h)} px on the long edge`); if (r || !alt) return r; }
        if (file && file.files.some((f) => f.bytes > NLOOK_LIMITS.art.fileBytes)) { const r = bad(`art "${key}" is over ${NLOOK_LIMITS.art.fileBytes} bytes`); if (r || !alt) return r; }
      }
      for (const p of templatePaths(src)) if (!bindResolves(p, ctx.surface, each)) ctx.unknownBinds.push(`${at}.props.src: {{${p}}}`);
      if (props.fit !== undefined && !FITS.has(str(props.fit))) { ctx.issues.push({ at: `${at}.props.fit`, why: "fit is fill | fit | stretch" }); delete props.fit; }
      if (props.tint !== undefined && !isColour(props.tint)) { ctx.issues.push({ at: `${at}.props.tint`, why: "unknown colour: ink" }); props.tint = "ink"; }
      break;
    }
    case "Shape": {
      if (!SHAPES.has(str(props.kind))) return fallbackOf(raw, depth, ctx, at, `unknown shape kind "${str(props.kind)}"`);
      for (const key of ["fill", "stroke"] as const) {
        if (props[key] !== undefined && !isColour(props[key])) { ctx.issues.push({ at: `${at}.props.${key}`, why: "unknown colour: ink" }); props[key] = "ink"; }
      }
      if (str(props.kind) === "path") {
        const cleaned = cleanPathD(str(props.d));
        if (!cleaned) return fallbackOf(raw, depth, ctx, at, "the path's d is not in the M L Q C Z O grammar");
        if (cleaned.cut) ctx.issues.push({ at: `${at}.props.d`, why: `over ${NLOOK_LIMITS.path.perShape} paths: the extras are dropped` });
        props.d = cleaned.d;
      }
      break;
    }
    case "Kit": {
      if (!KITS.has(str(props.name))) return fallbackOf(raw, depth, ctx, at, `unknown kit part "${str(props.name)}"`);
      break;
    }
    case "Bar": case "Ring": {
      for (const key of ["color", "track"] as const) {
        if (props[key] !== undefined && !isColour(props[key])) { ctx.issues.push({ at: `${at}.props.${key}`, why: "unknown colour: ink" }); props[key] = "ink"; }
      }
      if (type === "Bar" && props.segments !== undefined && !eachListKey(str(props.segments))) {
        ctx.issues.push({ at: `${at}.props.segments`, why: `"${str(props.segments)}" is not a list this build knows` });
        delete props.segments;
      }
      break;
    }
    case "Grid": {
      const cols = Math.round(Number(props.cols));
      props.cols = Number.isFinite(cols) ? Math.max(1, Math.min(4, cols)) : 1;
      break;
    }
    case "Each": {
      const list = eachListKey(str(props.of));
      if (!list) return fallbackOf(raw, depth, ctx, at, `Each walks only a list this build knows; "${str(props.of)}" is not one`);
      const cap = Math.min(NLOOK_LIMITS.eachMax, surface.eachMax);
      const want = Math.round(Number(props.max));
      if (!Number.isFinite(want) || want > cap) {
        if (Number.isFinite(want)) ctx.issues.push({ at: `${at}.props.max`, why: `at most ${cap} copies on a ${ctx.surface}` });
        props.max = cap;
      } else {
        props.max = Math.max(1, want);
      }
      props.of = list === "needs.items[].choices" ? str(props.of) : list;
      each = list;
      break;
    }
    case "Button": {
      const act = isObj(props.act) ? props.act : null;
      const open = props.open;
      if (!act && open === undefined) return fallbackOf(raw, depth, ctx, at, "a Button answers an item or opens a link, and this one does neither");
      if (open !== undefined) {
        const link = str(open);
        const ok = link.includes(BIND_OPEN)
          ? templatePaths(link).length > 0 && templatePaths(link).every((pth) => bindPathInfo(pth)?.kind === "link" && bindResolves(pth, ctx.surface, each))
          : isAllowedLink(link);
        if (!ok) return fallbackOf(raw, depth, ctx, at, `a link opens only ${LINK_ALLOW.scheme}:// or ${LINK_ALLOW.httpsPrefix}, or binds a link path`);
      }
      if (act && (str(act.item) === "" || str(act.action) === "")) return fallbackOf(raw, depth, ctx, at, "act needs an item and an action");
      break;
    }
    default: break;
  }

  const style: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(isObj(raw.style) ? raw.style : {})) {
    if (!STYLE_KEYS.has(k)) { ctx.issues.push({ at: `${at}.style.${k}`, why: "not a style key of format 1: ignored" }); continue; }
    if (k === "bg" && !isColour(v)) { ctx.issues.push({ at: `${at}.style.${k}`, why: "unknown colour: ink" }); style[k] = "ink"; continue; }
    if (k === "border") {
      if (!isObj(v) || !isColour(v.color)) { ctx.issues.push({ at: `${at}.style.border`, why: "a border is { color, width }" }); continue; }
      style[k] = { color: v.color, width: Number(v.width) || 1 };
      continue;
    }
    if (k === "align" && !ALIGNS.has(str(v))) { ctx.issues.push({ at: `${at}.style.align`, why: "align is start | center | end" }); continue; }
    if (k === "offset" && ctx.surface !== "widget") { ctx.issues.push({ at: `${at}.style.offset`, why: "offset is iOS-only and ignored here" }); continue; }
    style[k] = v;
  }

  let cond: Record<string, unknown> | undefined;
  if (isObj(raw.if)) {
    cond = {};
    for (const [k, v] of Object.entries(raw.if)) {
      if (!CONDS.has(k)) { ctx.issues.push({ at: `${at}.if.${k}`, why: "not a condition key of format 1: ignored" }); continue; }
      if (k === "has" && !hasPathKnown(str(v), ctx.surface)) { ctx.issues.push({ at: `${at}.if.has`, why: `"${str(v)}" is not a path this build knows` }); continue; }
      cond[k] = v;
    }
    if (!Object.keys(cond).length) cond = undefined;
  }

  const children: NLookNode[] = [];
  for (const [n, child] of (Array.isArray(raw.children) ? raw.children : []).entries()) {
    const c = cleanNode(child as NLookNode, depth + 1, ctx, `${at}.children[${n}]`, each);
    if (c) children.push(c);
  }
  const fb = isObj(raw.fallback) ? cleanNode(raw.fallback as NLookNode, depth, ctx, `${at}.fallback`, each) : null;

  return {
    type,
    ...(Object.keys(props).length ? { props } : {}),
    ...(Object.keys(style).length ? { style } : {}),
    ...(cond ? { if: cond } : {}),
    ...(children.length ? { children } : {}),
    ...(fb ? { fallback: fb } : {}),
  };
}

// ---------------------------------------------------------------- one design

/** How many nodes a tree holds, for the per-root and per-design caps. */
export function countNodes(n: NLookNode | undefined): number {
  if (!n) return 0;
  let total = 1;
  for (const c of n.children ?? []) total += countNodes(c);
  if (n.fallback) total += countNodes(n.fallback);
  return total;
}

/** Keep the first `cap` nodes of a tree, so a region that is too busy still draws its first lines. */
function capNodes(n: NLookNode, cap: number): NLookNode {
  let left = cap;
  const walk = (node: NLookNode): NLookNode | null => {
    if (left <= 0) return null;
    left--;
    const children: NLookNode[] = [];
    for (const c of node.children ?? []) { const k = walk(c); if (k) children.push(k); }
    const rest: NLookNode = { ...node };
    delete rest.children;
    return { ...rest, ...(children.length ? { children } : {}) };
  };
  return walk(n) ?? { type: "Spacer", props: { min: 0 } };
}

/** The `fallback` chain from this id: true when it rings. */
function cycles(id: string, of: Readonly<Record<string, string | undefined>>): boolean {
  const seen = new Set<string>([id]);
  let at = of[id];
  while (at) {
    if (seen.has(at)) return true;
    seen.add(at);
    at = of[at];
  }
  return false;
}

/** One design, cleaned on its own. A bad one is dropped ALONE: the rest of the catalog is kept. */
export function cleanDesign(raw: unknown, o: CleanOptions = {}): CleanResult {
  const issues: CleanIssue[] = [];
  const unknownBinds: string[] = [];
  const d = isObj(raw) ? raw : {};
  const id = str(d.id);
  if (!ID_PATTERN.test(id)) {
    return { id: id || "(no id)", verdict: "dropped", issues: [{ at: "id", why: "an id is [a-z0-9._-], 1 to 40 characters" }], binds: [] };
  }
  const format = Number(d.format);
  if (!Number.isFinite(format) || format < 1) return { id, verdict: "dropped", issues: [{ at: "format", why: "format is a whole number from 1" }], binds: [] };
  const draws = o.drawsFormat ?? DRAWS_FORMAT;
  if (format > draws) return { id, verdict: "skipped", issues: [{ at: "format", why: `format ${format} is above the ${draws} this build draws: skipped alone` }], binds: [] };

  const surface = str(d.surface) as NLookSurface;
  if (!Object.prototype.hasOwnProperty.call(NLOOK_SURFACES, surface)) {
    return { id, verdict: "dropped", issues: [{ at: "surface", why: "surface is widget, activity or liveupdate" }], binds: [] };
  }
  const fb = str(d.fallback);
  if (fb) {
    if (o.designIds && !o.designIds.includes(fb)) issues.push({ at: "fallback", why: `"${fb}" is not a design in this catalog` });
    if (o.fallbackOf && cycles(id, { ...o.fallbackOf, [id]: fb })) {
      return { id, verdict: "dropped", issues: [{ at: "fallback", why: "the fallback chain rings, which would be a loop at render time" }], binds: [] };
    }
  }
  let palette = str(d.palette);
  if (palette && o.palettes && !o.palettes.includes(palette)) {
    issues.push({ at: "palette", why: `"${palette}" is not in the catalog: the default palette draws` });
    palette = o.palettes[0] ?? "";
  }

  const art = new Map((o.art ?? []).map((a) => [a.key, a]));
  const out: NLookDesign = {
    id, format, surface,
    ...(fb ? { fallback: fb } : {}),
    ...(palette ? { palette } : {}),
    ...(typeof d.note === "string" ? { note: d.note } : {}),
    ...(Array.isArray(d.art) ? { art: d.art.filter((k): k is string => typeof k === "string") } : {}),
    ...(Number.isFinite(Number(d.since)) && Number(d.since) > 0 ? { since: Math.round(Number(d.since)) } : {}),
  };

  if (surface === "liveupdate") {
    const fill = cleanFill(d.fill, issues, unknownBinds);
    if (!fill) return { id, verdict: "dropped", issues: [...issues, { at: "fill", why: "a liveupdate design is a fill, and this one has none" }], binds: unknownBinds };
    out.fill = fill;
  } else {
    const roots = isObj(d.roots) ? d.roots : {};
    const allowed = new Set<string>(NLOOK_SURFACES[surface].roots);
    const kept: Record<string, NLookNode> = {};
    let total = 0;
    for (const [name, tree] of Object.entries(roots)) {
      if (!allowed.has(name)) { issues.push({ at: `roots.${name}`, why: `a ${surface} design has no "${name}" root` }); continue; }
      const ctx: Ctx = { surface, issues, art, unknownBinds };
      const node = cleanNode(tree as NLookNode, 1, ctx, `roots.${name}`, null);
      if (!node) { issues.push({ at: `roots.${name}`, why: "nothing in this root could be drawn" }); continue; }
      const n = countNodes(node);
      if (surface === "widget" && n > NLOOK_LIMITS.widget.nodesPerRoot) {
        return { id, verdict: "dropped", issues: [...issues, { at: `roots.${name}`, why: `${n} nodes, over the ${NLOOK_LIMITS.widget.nodesPerRoot} a root may hold` }], binds: unknownBinds };
      }
      if (surface === "activity") {
        const cap = activityNodeCap(name);
        if (n > cap) {
          issues.push({ at: `roots.${name}`, why: `${n} nodes, over the ${cap} this region may hold: the first ${cap} are kept` });
          kept[name] = capNodes(node, cap);
          total += cap;
          continue;
        }
      }
      kept[name] = node;
      total += n;
    }
    if (!Object.keys(kept).length) return { id, verdict: "dropped", issues: [...issues, { at: "roots", why: "a design needs at least one root this surface draws" }], binds: unknownBinds };
    if (surface === "widget" && total > NLOOK_LIMITS.widget.nodes) {
      return { id, verdict: "dropped", issues: [...issues, { at: "roots", why: `${total} nodes in all, over the ${NLOOK_LIMITS.widget.nodes} a design may hold` }], binds: unknownBinds };
    }
    out.roots = kept;
  }

  const bytes = utf8Bytes(JSON.stringify(out));
  const cap = surface === "activity" ? NLOOK_LIMITS.activity.designBytes : NLOOK_LIMITS.widget.designBytes;
  if (bytes > cap) return { id, verdict: "dropped", issues: [...issues, { at: "(whole design)", why: `${bytes} bytes, over the ${cap} a ${surface} design may hold` }], binds: unknownBinds };

  return { id, verdict: issues.length ? "clamped" : "ok", design: out, issues, binds: unknownBinds };
}

/** The Android notice's template fill: no canvas, only these slots, and the chip may never carry words that can be private. */
function cleanFill(raw: unknown, issues: CleanIssue[], unknownBinds: string[]): Record<string, unknown> | null {
  if (!isObj(raw)) return null;
  const fill: Record<string, unknown> = {};
  const text = (key: "title" | "text" | "sub" | "chip") => {
    const v = str(raw[key]);
    if (!v) return;
    const cut = v.slice(0, NLOOK_LIMITS.textChars);
    for (const p of templatePaths(cut)) {
      if (!bindResolves(p, "liveupdate", null)) { unknownBinds.push(`fill.${key}: {{${p}}}`); continue; }
      if (key === "chip" && bindPathInfo(p)?.sensitive) {
        issues.push({ at: "fill.chip", why: `"${p}" can carry private words, and the chip shows on a locked phone` });
        return;
      }
    }
    fill[key] = cut;
  };
  text("title"); text("text"); text("sub"); text("chip");
  if (isObj(raw.progress)) {
    const p = raw.progress;
    fill.progress = {
      ...(eachListKey(str(p.segments)) ? { segments: eachListKey(str(p.segments))! } : {}),
      ...(str(p.at) ? { at: str(p.at) } : {}),
      ...(isColour(p.color) ? { color: str(p.color) } : {}),
      ...(isColour(p.track) ? { track: str(p.track) } : {}),
    };
  }
  for (const key of ["tracker", "large"] as const) if (str(raw[key])) fill[key] = str(raw[key]);
  if (isColour(raw.color)) fill.color = str(raw.color);
  const acts = Array.isArray(raw.actions) ? raw.actions : [];
  const kept: Record<string, unknown>[] = acts.filter(isObj).slice(0, 3).flatMap((a): Record<string, unknown>[] => {
    const label = str(a.label).slice(0, NLOOK_LIMITS.textChars);
    if (!label) return [];
    if (a.open !== undefined) {
      const open = str(a.open);
      if (!open.includes(BIND_OPEN) && !isAllowedLink(open)) { issues.push({ at: "fill.actions", why: `a link opens only ${LINK_ALLOW.scheme}://` }); return []; }
      return [{ label, open }];
    }
    if (isObj(a.act) && str(a.act.item) && str(a.act.action)) return [{ label, act: { item: str(a.act.item), action: str(a.act.action) } }];
    return [];
  });
  if (acts.length > 3) issues.push({ at: "fill.actions", why: "at most 3 actions: the extras are dropped" });
  if (kept.length) fill.actions = kept;
  return fill;
}

// ---------------------------------------------------------------- the catalog

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const SHA = /^[0-9a-f]{64}$/;
const ART_KEY = /^[A-Za-z0-9][A-Za-z0-9._:$@-]{0,63}$/;

/** A palette scheme whose roles are all hexes, or null. A role left out falls back by ROLE_FALLBACK, so only the others are required. */
function cleanScheme(v: unknown): NLookScheme | null {
  if (!isObj(v)) return null;
  const out: NLookScheme = {};
  for (const role of PALETTE_ROLES) {
    const x = v[role];
    if (x === undefined) { if (!ROLE_FALLBACK[role]) return null; continue; }
    if (typeof x !== "string" || !HEX.test(x)) return null;
    out[role] = x;
  }
  return out;
}

/** A palette whose two schemes are sound, or null. Its alphas are numbers in 0 to 1. */
export function cleanPalette(v: unknown): NLookPalette | null {
  if (!isObj(v)) return null;
  const dark = cleanScheme(v.dark), light = cleanScheme(v.light);
  if (!dark || !light) return null;
  const alpha: { dim?: number; rule?: number } = {};
  if (isObj(v.alpha)) {
    for (const k of ["dim", "rule"] as const) {
      const n = Number(v.alpha[k]);
      if (v.alpha[k] !== undefined && Number.isFinite(n) && n >= 0 && n <= 1) alpha[k] = n;
    }
  }
  return { dark, light, ...(Object.keys(alpha).length ? { alpha } : {}), ...(typeof v.note === "string" ? { note: v.note.slice(0, 200) } : {}) };
}

/** The art the catalog lists that is within every cap. A file over a cap is simply not listed: a design that names it draws its alt. */
export function cleanArt(v: unknown): NLookArt[] {
  const out: NLookArt[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const a of Array.isArray(v) ? v : []) {
    if (!isObj(a)) continue;
    const key = str(a.key);
    const w = Number(a.w), h = Number(a.h);
    if (!ART_KEY.test(key) || seen.has(key)) continue;
    if (!(w > 0 && h > 0 && Math.max(w, h) <= NLOOK_LIMITS.art.longEdgePx)) continue;
    // One entry per scale served, each with the hash of its own file; a file that is not sound is not listed.
    const files: NLookArtFile[] = [];
    for (const f of Array.isArray(a.files) ? a.files : []) {
      if (!isObj(f)) continue;
      const scale = Number(f.scale), sha = str(f.sha256).toLowerCase(), bytes = Number(f.bytes);
      if ((scale !== 1 && scale !== 2 && scale !== 3) || files.some((x) => x.scale === scale) || !SHA.test(sha)) continue;
      if (!(bytes > 0 && bytes <= NLOOK_LIMITS.art.fileBytes)) continue;
      files.push({ scale, sha256: sha, bytes: Math.round(bytes) });
    }
    if (!files.length) continue;
    files.sort((x, y) => x.scale - y.scale);
    const biggest = Math.max(...files.map((f) => f.bytes));
    if (out.length >= NLOOK_LIMITS.art.files || total + biggest > NLOOK_LIMITS.art.totalBytes) break;
    seen.add(key);
    total += biggest;
    out.push({ key, w: Math.round(w), h: Math.round(h), files });
  }
  return out;
}

/** The fonts the catalog lists for this platform that are within the caps. */
export function cleanFonts(v: unknown, platform: Platform): NLookFont[] {
  const out: NLookFont[] = [];
  const seen = new Set<string>();
  for (const f of Array.isArray(v) ? v : []) {
    if (!isObj(f)) continue;
    const id = str(f.id), sha = str(f.sha256).toLowerCase(), bytes = Number(f.bytes);
    const platforms = (Array.isArray(f.platforms) ? f.platforms : []).filter((p): p is Platform => p === "ios" || p === "android");
    if (!/^[a-z0-9._-]{1,40}$/.test(id) || seen.has(id) || !SHA.test(sha)) continue;
    if (!(bytes > 0 && bytes <= NLOOK_LIMITS.fonts.fileBytes) || !platforms.includes(platform)) continue;
    if (out.length >= NLOOK_LIMITS.fonts.inCatalog) break;
    seen.add(id);
    out.push({ id, sha256: sha, bytes: Math.round(bytes), platforms });
  }
  return out;
}

export interface CleanedCatalog {
  v: number;
  format: number;
  drawsFormat: number;
  palettes: Record<string, NLookPalette>;
  designs: Record<string, NLookDesign>;
  art: NLookArt[];
  fonts: NLookFont[];
  /** Designs refused (and why), and ones too new for this build. Reported, never thrown. */
  dropped: { id: string; why: string }[];
  skipped: string[];
}

export interface CleanCatalogOptions { drawsFormat?: number; platform: Platform }

/**
 * What GET /v1/native/looks answered, cleaned ONE DESIGN AT A TIME: a bad design is dropped and the rest are kept. Null only when the
 * catalog as a whole is not one (not an object, no usable `v`, no palette at all, over 256 KB): then the last good copy stays.
 */
export function cleanNativeLooks(doc: unknown, o: CleanCatalogOptions): CleanedCatalog | null {
  if (!isObj(doc)) return null;
  const v = Number(doc.v);
  if (!Number.isFinite(v) || v < 1 || Math.round(v) !== v) return null;
  if (utf8Bytes(JSON.stringify(doc)) > NLOOK_LIMITS.catalogBytes) return null;
  const draws = Math.max(0, Math.min(o.drawsFormat ?? DRAWS_FORMAT, DRAWS_FORMAT));
  if (draws < 1) return null;

  const palettes: Record<string, NLookPalette> = {};
  if (isObj(doc.palettes)) {
    for (const [name, p] of Object.entries(doc.palettes)) {
      if (!/^[a-z0-9._-]{1,40}$/.test(name)) continue;
      const clean = cleanPalette(p);
      if (clean) palettes[name] = clean;
    }
  }
  const paletteNames = Object.keys(palettes);
  if (!paletteNames.length) return null;

  const art = cleanArt(doc.art);
  const fonts = cleanFonts(doc.fonts, o.platform);
  const raw = isObj(doc.designs) ? doc.designs : {};
  const ids = Object.keys(raw);
  const fallbackOfId: Record<string, string | undefined> = {};
  for (const [id, d] of Object.entries(raw)) if (isObj(d) && typeof d.fallback === "string") fallbackOfId[id] = d.fallback;

  const designs: Record<string, NLookDesign> = {};
  const dropped: { id: string; why: string }[] = [];
  const skipped: string[] = [];
  for (const [key, d] of Object.entries(raw)) {
    if (!isObj(d) || d.id !== key) { dropped.push({ id: key, why: "the key and the design's own id must be the same word" }); continue; }
    const r = cleanDesign(d, { drawsFormat: draws, palettes: paletteNames, art, designIds: ids, fallbackOf: fallbackOfId });
    if (r.verdict === "skipped") skipped.push(r.id);
    else if (r.verdict === "dropped" || !r.design) dropped.push({ id: r.id, why: r.issues[0]?.why ?? "refused" });
    else designs[r.id] = r.design;
  }
  return { v, format: Number(doc.format) || 1, drawsFormat: draws, palettes, designs, art, fonts, dropped, skipped };
}

// ---------------------------------------------------------------- what to download

/** Every node of a design, roots and fallbacks included. */
export function walkDesign(d: NLookDesign, fn: (n: NLookNode) => void): void {
  const walk = (n: NLookNode | undefined) => {
    if (!n) return;
    fn(n);
    for (const c of n.children ?? []) walk(c);
    if (n.fallback) walk(n.fallback);
  };
  for (const root of Object.values(d.roots ?? {})) walk(root);
}

/** The catalog art keys the kept designs use: their `art` lists, and every `Image src: "art:<key>"` (a bot still is not one). */
export function artKeysUsed(designs: Record<string, NLookDesign>): Set<string> {
  const keys = new Set<string>();
  for (const d of Object.values(designs)) {
    for (const k of d.art ?? []) if (!k.startsWith("bot:")) keys.add(k.startsWith("art:") ? k.slice(4) : k);
    walkDesign(d, (n) => {
      const src = str(n.props?.src);
      if (n.type === "Image" && src.startsWith("art:") && !src.startsWith("art:bot:") && !src.includes(BIND_OPEN)) keys.add(src.slice(4));
    });
  }
  return keys;
}

export interface ArtJob { key: string; sha: string; scale: number; bytes: number; path: string }

/** The scale to fetch: the smallest served at or above the screen's, else the largest served. */
export function pickScale(scales: readonly number[], screenScale: number): number {
  const sorted = [...scales].sort((a, b) => a - b);
  const want = Math.max(1, Math.min(3, Math.ceil(Number.isFinite(screenScale) ? screenScale : 2)));
  return sorted.find((s) => s >= want) ?? sorted[sorted.length - 1] ?? 1;
}

/** The art file's address on the server: immutable, by content, with nothing of the person in it. */
export const artPath = (sha: string, scale: number): string => `/v1/native/art/${sha}@${scale}.png`;
export const fontPath = (sha: string): string => `/v1/native/font/${sha}`;

/** The art a catalog needs: only what a kept design uses, one variant at the screen's scale, within the files and bytes caps. */
export function planArt(c: Pick<CleanedCatalog, "designs" | "art">, screenScale: number): ArtJob[] {
  const used = artKeysUsed(c.designs);
  const jobs: ArtJob[] = [];
  let total = 0;
  for (const a of c.art) {
    if (!used.has(a.key)) continue;
    const scale = pickScale(a.files.map((f) => f.scale), screenScale);
    const f = a.files.find((x) => x.scale === scale)!;
    if (jobs.length >= NLOOK_LIMITS.art.files || total + f.bytes > NLOOK_LIMITS.art.totalBytes) break;
    total += f.bytes;
    jobs.push({ key: a.key, sha: f.sha256, scale, bytes: f.bytes, path: artPath(f.sha256, scale) });
  }
  return jobs;
}

export interface FontJob { id: string; sha: string; bytes: number; path: string }

export function planFonts(c: Pick<CleanedCatalog, "fonts">): FontJob[] {
  return c.fonts.slice(0, NLOOK_LIMITS.fonts.inCatalog).map((f) => ({ id: f.id, sha: f.sha256, bytes: f.bytes, path: fontPath(f.sha256) }));
}

// ---------------------------------------------------------------- the files we download: checked before they are kept

/** PNG's eight magic bytes. */
export const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function isPngBytes(b: ArrayLike<number>): boolean {
  if (b.length <= PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((m, i) => b[i] === m);
}

/** What a font file is by its first four bytes: "ttf", "otf" or null. Anything else is not kept (WOFF is not accepted here). */
export function fontKind(b: ArrayLike<number>): "ttf" | "otf" | null {
  if (b.length < 64) return null;
  const at = (i: number) => b[i]!;
  if (at(0) === 0x00 && at(1) === 0x01 && at(2) === 0x00 && at(3) === 0x00) return "ttf";
  if (at(0) === 0x74 && at(1) === 0x72 && at(2) === 0x75 && at(3) === 0x65) return "ttf"; // "true"
  if (at(0) === 0x4f && at(1) === 0x54 && at(2) === 0x54 && at(3) === 0x4f) return "otf"; // "OTTO"
  return null;
}

/** A downloaded art file's verdict: the bytes are a PNG, within the size cap, and their digest is the one the catalog promised. */
export function artVerdict(bytes: ArrayLike<number>, sha: string, digestHex: string): "ok" | "bad_magic" | "too_big" | "bad_sha" {
  if (bytes.length > NLOOK_LIMITS.art.fileBytes) return "too_big";
  if (!isPngBytes(bytes)) return "bad_magic";
  return digestHex.toLowerCase() === sha.toLowerCase() ? "ok" : "bad_sha";
}

export function fontVerdict(bytes: ArrayLike<number>, sha: string, digestHex: string): "ok" | "bad_magic" | "too_big" | "bad_sha" {
  if (bytes.length > NLOOK_LIMITS.fonts.fileBytes) return "too_big";
  if (!fontKind(bytes)) return "bad_magic";
  return digestHex.toLowerCase() === sha.toLowerCase() ? "ok" : "bad_sha";
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}

// ---------------------------------------------------------------- the dotted bot's stills

/** The bytes of the distinct pictures among these stills (two keys with one sha are one file). */
export function stillsTotal(entries: Iterable<{ sha: string; bytes: number }>): number {
  const seen = new Set<string>();
  let total = 0;
  for (const e of entries) if (!seen.has(e.sha)) { seen.add(e.sha); total += e.bytes; }
  return total;
}

/** Whether one more still of `add` fits under the stills' byte budget. Wanted stills are never evicted to make room: the one that does not fit is not kept. */
export function stillFits(held: Iterable<{ sha: string; bytes: number }>, add: { sha: string; bytes: number }, limit: number): boolean {
  const all = [...held];
  if (all.some((e) => e.sha === add.sha)) return true;
  return stillsTotal(all) + add.bytes <= limit;
}

/** The bots' own stills have their own budget (nlook.ts art.stillFiles / stillBytes). */
export interface StillSpec {
  /** The art key a widget looks up, exactly as that platform spells it. */
  key: string;
  /** What to draw: an avatar id or a bot slug, the moment, how far through it (0 to 1), the size in px, the scheme. */
  who: string;
  moment: string;
  at: number;
  px: number;
  scheme: "dark" | "light";
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const num = (v: unknown, d: number): number => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** iOS: `String(format: "%.2f")`. */
const at2 = (t: number): string => t.toFixed(2);
/** Android's trim2: 0.6 -> "0.6", 1 -> "1", 0 -> "0". */
function trim2(v: number): string {
  const r = Math.round(v * 100) / 100;
  const s = String(r);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** A still key longer than this is dropped by the iOS reader. */
const MAX_STILL_KEY = 80;

/** The key iOS looks a still up under: bot:<slug>.<moment>@<t>.<scheme>.<px> (NLookView.swift BotArtKey.make). */
export function iosStillKey(who: string, moment: string, at: number, scheme: "dark" | "light", px: number): string {
  const t = clamp(Number.isFinite(at) ? at : 0, 0, 1);
  return `bot:${who || "x0"}.${moment || "rest"}@${at2(t)}.${scheme}.${clamp(Math.round(px), 8, 512)}`;
}

/** The key Android looks a still up under: bot:<slug>.<moment>@<t>, no scheme and no size (NLookPlan.kt). */
export function androidStillKey(who: string, moment: string, at: number): string {
  return `bot:${who || "blip"}.${moment || "rest"}@${trim2(clamp(Number.isFinite(at) ? at : 0, 0, 1))}`;
}

/** Whether a `who` is the bound bot ("$bot", or a template over the item) rather than one avatar's own id. */
const isBound = (who: string): boolean => who === "$bot" || who === "" || who.includes(BIND_OPEN);

/**
 * THE STILLS A SET OF DESIGNS NEEDS: every `Bot` node, for every bot the current glance or activity actually shows ("only what is
 * shown"), at the scheme(s) it paints on. The stills' budget is 24 files; past it, the extras are left and the widget draws the
 * bundled pose instead. iOS asks for both schemes; Android's key has neither a scheme nor a size, so one (the light ink) is drawn.
 */
export function stillSpecs(
  designs: Record<string, NLookDesign>,
  bots: readonly string[],
  o: { platform: Platform; scale: number; liveUpdate?: boolean },
): StillSpec[] {
  const scale = Math.max(1, num(o.scale, 2));
  const slugs = [...new Set(bots.filter((b) => /^[a-z0-9][a-z0-9_-]{0,47}$/.test(b)))].slice(0, 8);
  const out = new Map<string, StillSpec>();
  // An iOS key longer than 80 characters is dropped by the widget, so it is never drawn. Two specs under one Android key (no size in it)
  // keep the larger px.
  const add = (s: StillSpec) => {
    if (s.key.length > MAX_STILL_KEY) return;
    const had = out.get(s.key);
    if (!had || s.px > had.px) out.set(s.key, s);
  };
  // Home-screen designs first, then the rest, then the notice: the 24-picture limit never drops a widget's still for the notice's.
  const rank = (d: NLookDesign): number => (d.surface === "widget" ? 0 : 1);
  for (const d of Object.values(designs).sort((x, y) => rank(x) - rank(y))) {
    walkDesign(d, (n) => {
      if (n.type !== "Bot") return;
      const who = str(n.props?.who) || "$bot";
      const moment = str(n.props?.moment) || "rest";
      const at = clamp(num(n.props?.at, 0), 0, 1);
      const size = clamp(num(n.props?.size, 32), 8, 400);
      const px = clamp(Math.round(size * scale), 8, 512);
      const whos = isBound(who) ? slugs : /^[a-z0-9][a-z0-9_-]{0,47}$/.test(who) ? [who] : [];
      for (const w of whos) {
        if (o.platform === "ios") {
          for (const scheme of ["dark", "light"] as const) add({ key: iosStillKey(w, moment, at, scheme, px), who: w, moment, at, px, scheme });
        } else {
          add({ key: androidStillKey(w, moment, at), who: w, moment, at, px, scheme: "light" });
        }
      }
    });
  }
  // The Android notice's own stills: the tracker and large icon each `liveupdate` design names in its fill, as `bot:<who>.<moment>[@<t>]`
  // with `$bot` the bot's slug. The key is the fill text exactly (the notice looks it up by that text); the size is the 64 dp large
  // icon slot, at most 256 px (the notice shrinks anything bigger).
  if (o.platform === "android" && o.liveUpdate) {
    const px = clamp(Math.round(64 * scale), 8, 256);
    for (const d of Object.values(designs)) {
      if (d.surface !== "liveupdate") continue;
      for (const slot of ["tracker", "large"] as const) {
        const text = str(d.fill?.[slot]);
        if (!text.startsWith("bot:")) continue;
        for (const w of text.includes("$bot") ? slugs : [""]) {
          const key = text.split("$bot").join(w);
          const m = /^bot:([a-z0-9][a-z0-9_-]{0,47})\.([a-z0-9_.-]+?)(?:@(\d*\.?\d+))?$/.exec(key);
          if (!m) continue;
          add({ key, who: m[1]!, moment: m[2]!, at: m[3] === undefined ? 0.5 : clamp(Number(m[3]), 0, 1), px, scheme: "light" });
        }
      }
    }
  }
  // The file budget counts distinct pictures: iOS's dark and light of a scheme-less paint are one file, so up to twice the files in
  // keys may be asked for; looks.ts holds the real count of distinct pictures to the budget as they are drawn.
  const cap = o.platform === "ios" ? NLOOK_LIMITS.art.stillFiles * 2 : NLOOK_LIMITS.art.stillFiles;
  return [...out.values()].slice(0, cap);
}

/** The bot slugs a glance shows (its row of bots, the running job's, the last thing done, each question's). */
export function slugsOfGlance(g: {
  bots?: readonly { slug: string }[]; job?: { bot: string } | null; lastDone?: { bot: string } | null; needs?: { items: readonly { bot: string }[] };
}): string[] {
  const all = [
    ...(g.job ? [g.job.bot] : []),
    ...(g.lastDone ? [g.lastDone.bot] : []),
    ...(g.needs?.items ?? []).map((i) => i.bot),
    ...(g.bots ?? []).map((b) => b.slug),
  ];
  return [...new Set(all.filter(Boolean))].slice(0, 8);
}

// ---------------------------------------------------------------- the index the widgets read

export interface NLookIndex {
  v: number;
  drawsFormat: number;
  palettes: Record<string, NLookPalette>;
  designs: Record<string, string>;
  art: Record<string, string>;
  fonts?: Record<string, string>;
}

/** One art file as the index names it, per platform: iOS by file name (the widget reads nlook/art/<name>), Android by its path under files/. */
export const artIndexValue = (platform: Platform, sha: string, scale: number): string =>
  platform === "ios" ? `${sha}@${scale}.png` : `nlook/art/${sha}@${scale}.png`;

export const fontIndexValue = (platform: Platform, sha: string, ext: "ttf" | "otf"): string =>
  platform === "ios" ? `${sha}.${ext}` : `nlook/font/${sha}`;

/** The index and the design files, as the bridge's setNativeLooks takes them. */
export function buildIndex(
  c: Pick<CleanedCatalog, "v" | "drawsFormat" | "palettes" | "designs">,
  have: { art: Record<string, string>; fonts?: Record<string, string> },
): { index: NLookIndex; designs: Record<string, NLookDesign> } {
  const files: Record<string, string> = {};
  for (const id of Object.keys(c.designs)) files[id] = `${id}.json`;
  return {
    index: {
      v: c.v, drawsFormat: c.drawsFormat, palettes: c.palettes, designs: files,
      art: have.art, ...(have.fonts && Object.keys(have.fonts).length ? { fonts: have.fonts } : {}),
    },
    designs: c.designs,
  };
}

/** The whole write, as one JSON string. Null when it would be empty (a catalog with no design cannot be written). */
export function writePayload(index: NLookIndex, designs: Record<string, NLookDesign>): string | null {
  if (!Object.keys(designs).length) return null;
  const text = JSON.stringify({ index, designs });
  return utf8Bytes(text) > 512 * 1024 ? null : text;
}

/** (v, drawsFormat) is what a copy is keyed on: an OTA that raises what the binary may draw refetches the same `v`. */
export function copyKey(v: number, drawsFormat: number): string {
  return `${v}:${drawsFormat}`;
}

/** The bootstrap's word on the catalog: its version and where to get it (a path on the API). */
export function readLooksFlag(flag: unknown): { v: number; url: string } | null {
  if (!isObj(flag)) return null;
  const v = Number(flag.v), url = str(flag.url);
  if (!Number.isFinite(v) || v < 1 || !url.startsWith("/v1/")) return null;
  return { v, url };
}

/** The catalog's address with what this build can draw and which platform asks: the server only sends designs it can use. */
export function looksUrl(url: string, platform: Platform, caps: readonly string[]): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}platform=${platform}&can=${encodeURIComponent(caps.join(","))}`;
}

/** Whether a copy this phone holds already covers what the server says (and nothing is waiting on a re-draw). */
export function copyIsCurrent(held: { v: number; drawsFormat: number } | null, flag: { v: number }, drawsFormat: number): boolean {
  // At or above the flag: the server always serves its current catalog, so a copy newer than the bootstrap's flag is not stale.
  return !!held && held.v >= flag.v && held.drawsFormat === drawsFormat;
}

// ---------------------------------------------------------------- the glance: `look`, `palette`, `vars`

/** The `vars` map clamped on its own, before anything is measured: 12 keys, a key 24 characters, a value 120. */
export function clampVars(vars: unknown): Record<string, string> | undefined {
  if (!isObj(vars)) return undefined;
  const keys = Object.keys(vars).sort().slice(0, NLOOK_LIMITS.vars.keys);
  const out: Record<string, string> = {};
  for (const k of keys) {
    const key = k.slice(0, NLOOK_LIMITS.vars.keyChars);
    const v = vars[k];
    const value = v === null || v === undefined ? "" : String(v).slice(0, NLOOK_LIMITS.vars.valueChars);
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface GlanceLookDoc { look?: Record<string, string>; palette?: string; vars?: Record<string, string> }

/**
 * The glance's server-drawn look, checked before a widget reads it: a design id per widget kind (a kind is a short word, an id the
 * design pattern; at most 8), a palette name, and the free `vars`. Anything else is left out, and no `look` means the native view.
 */
export function cleanLook(doc: unknown): GlanceLookDoc {
  if (!isObj(doc)) return {};
  const out: GlanceLookDoc = {};
  if (isObj(doc.look)) {
    const look: Record<string, string> = {};
    for (const [kind, id] of Object.entries(doc.look).slice(0, 8)) {
      if (/^[a-z][a-z0-9_]{0,23}$/.test(kind) && typeof id === "string" && ID_PATTERN.test(id)) look[kind] = id;
    }
    if (Object.keys(look).length) out.look = look;
  }
  const palette = str(doc.palette);
  if (ID_PATTERN.test(palette)) out.palette = palette;
  const vars = clampVars(doc.vars);
  if (vars) out.vars = vars;
  return out;
}

/** The glance request's own query: the catalog version this phone HOLDS (`nl`), what it can draw (`can`) and which phone (`platform`). */
export function glanceQuery(o: { drawsNative: boolean; held: number; platform: Platform; caps: readonly string[] }): string {
  if (!o.drawsNative) return "";
  const can = o.caps.filter((c) => /^(NativeLook|WidgetBoard|LiveUpdate|ActivityPushStart)/.test(c)).slice(0, 8);
  return `&nl=${Math.max(0, Math.round(o.held) || 0)}&can=${encodeURIComponent(can.join(","))}&platform=${o.platform}`;
}

// ---------------------------------------------------------------- the Live Activity's body

/** What a content state encodes to, in bytes: what the phone's JSONEncoder would produce for the same fields. */
export function bodyBytes(state: unknown): number {
  return utf8Bytes(JSON.stringify(state));
}

/** Cut words at a word where it can, so a trimmed task still reads as words rather than as a half one. */
function cutWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const hard = s.slice(0, max);
  const at = hard.lastIndexOf(" ");
  return (at > max * 0.6 ? hard.slice(0, at) : hard).trimEnd();
}

export interface FitResult<T> { state: T; bytes: number; gave: string[] }

/**
 * The state as it may be sent. The SAME order the server and BotsLiveActivity.parse() give things up in (size.ts, the fixtures'
 * body.overBudget.dropsVars): `vars` first, then the stage names (trimmed, then given up), then the long words, then the answers.
 * Never throws and never refuses: something is always given up until it fits, because a push over 4 KB fails silently.
 */
export function fitActivityBody<T extends Record<string, unknown>>(state: T, cap: number = NLOOK_LIMITS.activityBodyBytes): FitResult<T> {
  const gave: string[] = [];
  let s: Record<string, unknown> = { ...state };
  const bytes = () => bodyBytes(s);
  const done = (): FitResult<T> => ({ state: s as T, bytes: bytes(), gave });
  if (bytes() <= cap) return done();

  if (s.vars !== undefined) { delete s.vars; gave.push("vars"); if (bytes() <= cap) return done(); }

  if (Array.isArray(s.stages) && s.stages.length) {
    for (const max of [24, 12, 6]) {
      s = { ...s, stages: (s.stages as unknown[]).map((n) => cutWords(String(n), max)) };
      if (bytes() <= cap) { gave.push(`stage names cut to ${max}`); return done(); }
    }
    s = { ...s, stages: [] };
    gave.push("stage names");
    if (bytes() <= cap) return done();
  }

  for (const key of ["question", "result", "task"] as const) {
    const v = typeof s[key] === "string" ? (s[key] as string) : "";
    if (!v) continue;
    for (const max of [120, 60, 30]) {
      if (v.length <= max) continue;
      s = { ...s, [key]: cutWords(v, max) };
      if (bytes() <= cap) { gave.push(`${key} cut to ${max}`); return done(); }
    }
  }

  if (Array.isArray(s.choices) && s.choices.length) {
    s = { ...s, choices: [] };
    gave.push("choices");
    if (bytes() <= cap) return done();
  }
  delete s.stages;
  gave.push("stages");
  return done();
}

const MIN = 60_000;

/**
 * The Live Activity's `vars`, as the server fills them (experience/native/bind.ts activityVars): `left` (stages to go) and `eta` (a
 * rough minutes-left, only once a stage has finished and a minute has passed, never above two hours). Both are numbers we counted
 * ourselves, so both are safe on a lock root. They ride only WITH a design.
 */
export function activityVars(i: { now: number; startedAt: number; stage: number; of: number; phase: string }): Record<string, string> | undefined {
  const left = Math.max(0, Math.round(i.of) - Math.round(i.stage));
  const elapsed = Math.floor((i.now - i.startedAt) / MIN);
  const done = Math.max(0, Math.round(i.stage) - 1);
  const eta = i.phase === "working" && done >= 1 && elapsed >= 1 ? Math.round((elapsed / done) * left) : 0;
  return clampVars({
    ...(left > 0 ? { left: String(left) } : {}),
    ...(eta >= 1 && eta <= 120 ? { eta: String(eta) } : {}),
  });
}

// ---------------------------------------------------------------- the activity roots, for the island's nodes

/** The activity root names (so a caller can tell a widget design from an activity one without reading its surface). */
export const isActivityRoot = (name: string): boolean => (ACTIVITY_ROOTS as readonly string[]).includes(name);
export const isWidgetRoot = (name: string): boolean => (WIDGET_ROOTS as readonly string[]).includes(name);
