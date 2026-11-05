/**
 * LIVE WORDS' COLOURS (LiveWords.tsx): each word is born light grey and settles to ink. Pure, tested in Node.
 *
 * A word keeps its birth while it stays the same word in the same place; one whose text changes in a later partial (the
 * stream corrects itself as it hears more) is born again, so the eye goes to what is new.
 */

export interface LiveWord { text: string; born: number }

/** The words of the turn, each with when it was born (ms). */
export class LiveWordsTrack {
  words: LiveWord[] = [];

  /** The turn's words now: a word unchanged keeps its birth, a new or changed one is born `now`. */
  update(text: string, now: number): void {
    const next = text.trim() ? text.trim().split(/\s+/) : [];
    this.words = next.map((w, i) => {
      const was = this.words[i];
      return was && was.text === w ? was : { text: w, born: now };
    });
  }

  /** How settled word i is, 0 (just born) to 1 (ink), eased out. */
  k(i: number, now: number, settleMs: number): number {
    const w = this.words[i];
    if (!w) return 1;
    const u = settleMs > 0 ? Math.min(1, Math.max(0, (now - w.born) / settleMs)) : 1;
    return 1 - (1 - u) * (1 - u);
  }

  /** Every word has settled (nothing left to redraw). */
  settled(now: number, settleMs: number): boolean {
    return this.words.every((w) => now - w.born >= settleMs);
  }
}

const hex = (c: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** From `a` (k 0) to `b` (k 1), as #rrggbb. A colour that is not #rrggbb is taken as it is at the nearer end. */
export function mixColor(a: string, b: string, k: number): string {
  const x = hex(a), y = hex(b);
  if (!x || !y) return k < 0.5 ? a : b;
  const t = Math.min(1, Math.max(0, k));
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}
