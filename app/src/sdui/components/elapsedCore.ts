/**
 * Text format "elapsed" (BOT_CALL_CAPABILITY): how long since a start time, as a call shows it ("On a call · 0:12"). Free of
 * react-native, so the rule is tested on its own (elapsedCore.test.ts); Text.tsx ticks it every second.
 */

/** A start time as ms: a number (or numeric string) is epoch ms, anything else is read as ISO; NaN when it is neither. */
function startMs(start: unknown): number {
  if (typeof start === "number") return start;
  if (typeof start !== "string" || !start.trim()) return NaN;
  const s = start.trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Date.parse(s);
}

const two = (n: number) => String(n).padStart(2, "0");

/** "m:ss" since `start`, or "h:mm:ss" past an hour; "0:00" for a start still to come; "" for no start time at all. */
export function elapsedText(start: unknown, now: number): string {
  const at = startMs(start);
  if (!Number.isFinite(at) || !Number.isFinite(now)) return "";
  const secs = Math.max(0, Math.floor((now - at) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
