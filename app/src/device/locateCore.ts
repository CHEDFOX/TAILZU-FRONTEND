/**
 * "USE MY LOCATION", THE RULES (perms/SPEC.md 2). Pure: no react-native, so each rule is tested in Node (locateCore.test.ts).
 *
 * One fix, named by the phone's own geocoder. The native function returns address PARTS (never a coordinate), and only the
 * area's words, like "HSR Layout, Bengaluru", ever reach state. Nothing is stored until the person taps Save on the card.
 */

/** What the native area function may return. Words only. */
export interface AreaParts {
  subLocality?: string | null;
  locality?: string | null;
  subAdminArea?: string | null;
  adminArea?: string | null;
  countryCode?: string | null;
}

export type LocStatus = "granted" | "denied" | "blocked" | "undetermined";

/** The longest area the server keeps (planTravel.setHome: clean(words, 120)). */
export const AREA_MAX = 120;

/** How long the one fix may take before the person is told to type instead. */
export const LOCATE_TIMEOUT_MS = 12_000;

/** A word of the address that is safe to keep: not empty, no street number or postcode (a 4+ digit run, or starting with a digit). */
function clean(v: unknown): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/\d{4,}/.test(s) || /^\d/.test(s)) return "";
  return s;
}

/**
 * The area's name from the address parts: the neighbourhood and the city ("HSR Layout, Bengaluru"), or the city and the state when
 * the phone named no neighbourhood. Never a street, house number, postcode or coordinate. Repeats collapse (a neighbourhood that
 * is also the city is said once). At most AREA_MAX characters. null when there is nothing to say.
 */
export function areaLabel(parts: AreaParts | null | undefined): string | null {
  if (!parts || typeof parts !== "object") return null;
  const sub = clean(parts.subLocality);
  const city = clean(parts.locality) || clean(parts.subAdminArea);
  const state = clean(parts.adminArea);
  const picked = sub ? [sub, city || state] : [city, state];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of picked) {
    if (!p) continue;
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  if (!out.length) return null;
  let label = out.join(", ");
  if (label.length > AREA_MAX) label = out[0].slice(0, AREA_MAX).trim();
  return label || null;
}

export type LocateOutcome = "found" | "none" | "denied" | "blocked" | "error";

/** What the action needs from the phone, injected so it is testable. */
export interface LocateDeps {
  /** Reads the permission; never prompts. */
  status: () => Promise<LocStatus>;
  /** Shows the system prompt (only ever called when `ask` and the status is undetermined). */
  ask: () => Promise<LocStatus>;
  /** One fix then the OS geocoder. */
  area: (timeoutMs: number) => Promise<AreaParts | null>;
}

/**
 * The location.area action: returns the outcome and, for "found", the label. `ask: false` never calls `ask`. A permission that is
 * denied reads as denied, and a refused-for-good one as blocked, so the screen can offer Settings only then.
 */
export async function locateArea(
  opts: { ask?: boolean },
  deps: LocateDeps,
): Promise<{ outcome: LocateOutcome; label?: string }> {
  try {
    let status = await deps.status();
    if (status === "blocked") return { outcome: "blocked" };
    if (status !== "granted") {
      if (!opts.ask) return { outcome: "denied" };
      status = await deps.ask();
      if (status === "blocked") return { outcome: "blocked" };
      if (status !== "granted") return { outcome: "denied" };
    }
    const parts = await deps.area(LOCATE_TIMEOUT_MS);
    const label = areaLabel(parts);
    return label ? { outcome: "found", label } : { outcome: "none" };
  } catch {
    return { outcome: "error" };
  }
}
