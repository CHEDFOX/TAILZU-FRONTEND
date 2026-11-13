/**
 * PAINT, pure (spec 2.7, B7). A box's paint keys from the server — backgroundImage, boxShadow, filter, mixBlendMode, blur —
 * checked, clamped and turned into React Native 0.85's own style keys. No React Native import, so it runs under node --test.
 * Unknown keys are ignored, a bad value is dropped (never thrown), and every number is clamped to the limits below.
 */

import normalizeColor from "@react-native/normalize-colors";

export const PAINT_LIMITS = {
  layers: 4,        // gradient layers on one box
  stops: 8,         // colour stops in one gradient
  shadows: 4,       // box shadows on one box
  shadowBlur: 80,
  shadowOffset: 100,
  shadowSpread: 50,
  filters: 4,       // filter functions on one box
  blur: 100,        // backdrop blur intensity (expo-blur's scale)
  strLen: 2048,     // longest paint string we will read
  filterStr: 256,   // longest filter string we will read
} as const;

/** The filter functions both iOS and Android draw on RN 0.85 (iOS draws only these two without the SwiftUI filter flag). */
export const FILTER_FUNCTIONS = ["brightness", "opacity"] as const;

export const BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
  "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
] as const;

export const BLUR_TINTS = ["light", "dark", "default", "extraLight", "regular", "prominent"] as const;

export type Shadow = { offsetX: number; offsetY: number; blurRadius: number; spreadDistance: number; color: string; inset?: boolean };
export type PaintBlur = { intensity: number; tint: (typeof BLUR_TINTS)[number] };
export type PaintOut = {
  /** RN style keys to merge into the box's style. */
  style: Record<string, unknown>;
  /** Set when the box wants a backdrop blur drawn behind its children (components/blur.tsx BackdropBlur). */
  blur?: PaintBlur;
};

/** The keys this module owns. style.ts keeps them out of the plain passthrough. */
export const PAINT_KEYS = ["backgroundImage", "boxShadow", "filter", "mixBlendMode", "blur"] as const;
/** True for a key the plain passthrough must not copy: ours, or RN's own experimental_ ones (experimental_backgroundImage). */
export const isPaintKey = (k: string): boolean => (PAINT_KEYS as readonly string[]).includes(k) || k.startsWith("experimental_");

export const PAINT_SPEC = {
  block: "paint",
  keys: {
    backgroundImage: "CSS string 'linear-gradient(...)' / 'radial-gradient(...)' (comma separated for layers), or { kind: 'linear'|'radial', angle?, stops: [{ color, at? }] } or an array of those; <= 4 layers, <= 8 stops",
    boxShadow: "CSS string '0 4 12 0 rgba(0,0,0,.2)' or { offsetX, offsetY, blurRadius, spreadDistance, color, inset } or an array; <= 4",
    filter: "string 'brightness(0.8) grayscale(1)' or [{ brightness: 0.8 }]; only " + FILTER_FUNCTIONS.join(", "),
    mixBlendMode: BLEND_MODES.join(" | "),
    blur: "number 0..100 or { intensity, tint }: a real blur of what is behind the box",
  },
  filters: FILTER_FUNCTIONS,
  blendModes: BLEND_MODES,
  tints: BLUR_TINTS,
  limits: PAINT_LIMITS,
} as const;

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/px$/i, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(?:rgba?|hsla?)\(\s*[-0-9.%\s,/]+\)$/i;
const NAMED = /^[a-z]{3,24}$/i;

/** A colour we will hand to the renderer: hex, rgb(a), hsl(a), transparent or a plain colour name. Nothing else (no url(), no var()). */
export function safeColor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length === 0 || s.length > 64) return null;
  if (HEX.test(s) || FUNC_COLOR.test(s)) return s;
  // A plain word must be one of React Native's own colour names (or transparent), else RN drops the whole gradient.
  if (NAMED.test(s) && (s.toLowerCase() === "transparent" || normalizeColor(s.toLowerCase()) != null)) return s;
  return null;
}

/** Split on commas that are not inside parentheses. */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Split on spaces that are not inside parentheses (so "0 4 12 rgba(0, 0, 0, .2)" keeps its colour whole). */
function splitSpaces(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const DIRS = new Map<string, number>(Object.entries({
  "to top": 0, "to right": 90, "to bottom": 180, "to left": 270,
  "to top right": 45, "to right top": 45, "to bottom right": 135, "to right bottom": 135,
  "to bottom left": 225, "to left bottom": 225, "to top left": 315, "to left top": 315,
}));

function stopText(color: string, at: unknown): string | null {
  const c = safeColor(color);
  if (!c) return null;
  if (at == null) return c;
  if (typeof at === "string") {
    const s = at.trim();
    return /^-?\d+(\.\d+)?%$/.test(s) ? `${c} ${clamp(parseFloat(s), 0, 100)}%` : c;
  }
  // A bare finite number in an object stop is a fraction 0..1; anything else is ignored.
  return typeof at === "number" && Number.isFinite(at) ? `${c} ${clamp(at, 0, 1) * 100}%` : c;
}

function gradientFromObject(o: any): string | null {
  if (!o || typeof o !== "object" || !Array.isArray(o.stops)) return null;
  const stops: string[] = [];
  for (const st of o.stops.slice(0, PAINT_LIMITS.stops)) {
    const t = st && typeof st === "object" ? stopText(st.color, st.at) : stopText(st, null);
    if (t) stops.push(t);
  }
  if (stops.length < 2) return null;
  if (o.kind === "radial") {
    const shape = o.shape === "circle" ? "circle" : "ellipse";
    return `radial-gradient(${shape}, ${stops.join(", ")})`;
  }
  if (o.kind !== "linear" && o.kind != null) return null;
  const a = num(o.angle);
  return `linear-gradient(${a == null ? 180 : clamp(a, -3600, 3600)}deg, ${stops.join(", ")})`;
}

function gradientFromString(s: string): string | null {
  const m = /^(linear|radial)-gradient\((.*)\)$/is.exec(s.trim());
  if (!m) return null;
  const parts = splitTop(m[2]);
  const head = parts[0]?.toLowerCase() ?? "";
  const stops: string[] = [];
  let lead = "";
  let rest = parts;
  const isLead = m[1] === "linear"
    ? /^-?\d+(\.\d+)?(deg|turn|rad|grad)$/.test(head) || DIRS.has(head)
    : /^(circle|ellipse)|^(closest|farthest)-(side|corner)|\bat\b/.test(head);
  if (isLead) {
    rest = parts.slice(1);
    if (m[1] === "linear") {
      const d = /^(-?\d+(?:\.\d+)?)deg$/.exec(head);
      lead = d ? `${clamp(parseFloat(d[1]), -3600, 3600)}deg` : DIRS.has(head) ? `${DIRS.get(head)}deg` : head;
      if (!d && !DIRS.has(head)) lead = "";   // turn/rad/grad: ignored, default direction
    } else {
      lead = /^[a-z0-9\s%.-]+$/.test(head) ? head : "";
    }
  }
  for (const p of rest.slice(0, PAINT_LIMITS.stops)) {
    const bits = splitSpaces(p);
    const color = safeColor(bits[0]);
    if (!color) return null;
    const at = bits[1];
    stops.push(at && /^-?\d+(\.\d+)?%$/.test(at) ? `${color} ${clamp(parseFloat(at), 0, 100)}%` : color);
  }
  if (stops.length < 2) return null;
  return `${m[1]}-gradient(${[lead, ...stops].filter(Boolean).join(", ")})`;
}

/** backgroundImage -> RN's experimental_backgroundImage string, or null when nothing valid is left. */
export function paintGradient(v: unknown): string | null {
  if (v == null) return null;
  let layers: string[] = [];
  if (typeof v === "string") {
    if (v.length > PAINT_LIMITS.strLen) return null;
    layers = splitTop(v).map(gradientFromString).filter((x): x is string => !!x);
  } else if (Array.isArray(v)) {
    layers = v.slice(0, PAINT_LIMITS.layers).map((x) => (typeof x === "string" ? gradientFromString(x) : gradientFromObject(x))).filter((x): x is string => !!x);
  } else if (typeof v === "object") {
    const g = gradientFromObject(v);
    if (g) layers = [g];
  }
  layers = layers.slice(0, PAINT_LIMITS.layers);
  return layers.length ? layers.join(", ") : null;
}

function oneShadow(o: any): Shadow | null {
  if (!o || typeof o !== "object") return null;
  const color = o.color == null ? "rgba(0,0,0,0.25)" : safeColor(o.color);
  const x = num(o.offsetX), y = num(o.offsetY);
  if (!color || x == null || y == null) return null;
  const blur = num(o.blurRadius) ?? 0, spread = num(o.spreadDistance) ?? 0;
  const out: Shadow = {
    offsetX: clamp(x, -PAINT_LIMITS.shadowOffset, PAINT_LIMITS.shadowOffset),
    offsetY: clamp(y, -PAINT_LIMITS.shadowOffset, PAINT_LIMITS.shadowOffset),
    blurRadius: clamp(blur, 0, PAINT_LIMITS.shadowBlur),
    spreadDistance: clamp(spread, -PAINT_LIMITS.shadowSpread, PAINT_LIMITS.shadowSpread),
    color,
  };
  if (o.inset === true) out.inset = true;
  return out;
}

function shadowFromString(s: string): Shadow | null {
  let inset = false;
  const nums: number[] = [];
  let color: string | null = null;
  for (const t of splitSpaces(s.trim())) {
    if (t.toLowerCase() === "inset") { inset = true; continue; }
    const n = /^-?\d+(\.\d+)?(px)?$/i.test(t) ? num(t) : null;
    if (n != null) { nums.push(n); continue; }
    const c = safeColor(t);
    if (c && !color) color = c; else return null;
  }
  if (nums.length < 2 || nums.length > 4) return null;
  return oneShadow({ offsetX: nums[0], offsetY: nums[1], blurRadius: nums[2], spreadDistance: nums[3], color: color ?? undefined, inset });
}

/** boxShadow -> an array of RN shadow objects (<= 4), or null. */
export function paintShadows(v: unknown): Shadow[] | null {
  if (v == null) return null;
  let list: unknown[];
  if (typeof v === "string") list = v.length > PAINT_LIMITS.strLen ? [] : splitTop(v);
  else list = Array.isArray(v) ? v : [v];
  const out = list.slice(0, PAINT_LIMITS.shadows)
    .map((x) => (typeof x === "string" ? shadowFromString(x) : oneShadow(x)))
    .filter((x): x is Shadow => !!x);
  return out.length ? out : null;
}

const FILTER_RANGE: Record<string, [number, number]> = {
  brightness: [0, 3], opacity: [0, 1],
};

function filterOne(name: string, raw: unknown): Record<string, number | string> | null {
  if (!(FILTER_FUNCTIONS as readonly string[]).includes(name)) return null;
  const [lo, hi] = FILTER_RANGE[name];
  let n: number | null;
  if (typeof raw === "string" && raw.trim().endsWith("%")) { const p = num(raw.trim().slice(0, -1)); n = p == null ? null : p / 100; }
  else n = num(raw);
  return n == null ? null : { [name]: clamp(n, lo, hi) };
}

/** filter -> an array of { fn: value } (<= 4), only functions both platforms draw, or null. */
export function paintFilter(v: unknown): Array<Record<string, number | string>> | null {
  if (v == null) return null;
  const out: Array<Record<string, number | string>> = [];
  if (typeof v === "string") {
    if (v.length > PAINT_LIMITS.filterStr) return null;
    const re = /([a-zA-Z-]+)\(([^()]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(v)) && out.length < PAINT_LIMITS.filters) {
      const f = filterOne(m[1], m[2].trim());
      if (f) out.push(f);
    }
  } else if (Array.isArray(v)) {
    for (const item of v.slice(0, PAINT_LIMITS.filters)) {
      if (!item || typeof item !== "object") continue;
      const [k] = Object.keys(item);
      const f = k ? filterOne(k, (item as any)[k]) : null;
      if (f) out.push(f);
    }
  }
  return out.length ? out : null;
}

export function paintBlend(v: unknown): string | null {
  return typeof v === "string" && (BLEND_MODES as readonly string[]).includes(v) ? v : null;
}

export function paintBlur(v: unknown): PaintBlur | null {
  let intensity: number | null, tint: unknown = "light";
  if (v && typeof v === "object") { intensity = num((v as any).intensity); tint = (v as any).tint ?? "light"; }
  else intensity = num(v);
  if (intensity == null || intensity <= 0) return null;
  const t = (BLUR_TINTS as readonly string[]).includes(tint as string) ? (tint as PaintBlur["tint"]) : "light";
  return { intensity: clamp(intensity, 0, PAINT_LIMITS.blur), tint: t };
}

/**
 * The one entry: a style bag in, the checked RN keys out. Reads only the five paint keys; everything else is ignored.
 * A key whose value is bad contributes nothing. Never throws.
 */
export function resolvePaint(style: Record<string, any> | undefined | null, resolve?: (v: string) => unknown): PaintOut {
  const out: PaintOut = { style: {} };
  if (!style || typeof style !== "object") return out;
  try {
    if (resolve) {
      const r = (v: unknown, d = 0): unknown => {
        if (typeof v === "string") return v.startsWith("$") ? resolve(v) : v;
        if (d > 4 || !v || typeof v !== "object") return v;
        if (Array.isArray(v)) return v.slice(0, 16).map((x) => r(x, d + 1));
        const o: Record<string, unknown> = {};
        for (const k of Object.keys(v).slice(0, 16)) o[k] = r((v as any)[k], d + 1);
        return o;
      };
      style = { ...style, backgroundImage: r(style.backgroundImage), boxShadow: r(style.boxShadow) };
    }
    const g = paintGradient(style.backgroundImage);
    if (g) out.style.experimental_backgroundImage = g;
    const sh = paintShadows(style.boxShadow);
    if (sh) out.style.boxShadow = sh;
    const f = paintFilter(style.filter);
    if (f) out.style.filter = f;
    const b = paintBlend(style.mixBlendMode);
    if (b) out.style.mixBlendMode = b;
    const bl = paintBlur(style.blur);
    if (bl) out.blur = bl;
  } catch { /* a throw never escapes */ }
  return out;
}
