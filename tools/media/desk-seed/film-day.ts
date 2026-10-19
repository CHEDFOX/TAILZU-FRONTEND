/**
 * A film's day, in a throwaway copy of the backend (see README.md): the clock held at
 * Sunday 18 October 2026, 11:48 PM in India, and fourteen days of
 * dictations in the in-memory stores, so the desk's own pages compute
 * their own numbers from them.
 */
const FIXED = Date.UTC(2026, 9, 18, 18, 18, 0); // 23:48 IST
const RealDate = globalThis.Date;
const START = RealDate.now();
const nowMs = () => FIXED + (RealDate.now() - START);
class FilmDate extends RealDate {
  constructor(...a: any[]) { if (a.length === 0) super(nowMs()); else super(...(a as [any])); }
  static now() { return nowMs(); }
}
(globalThis as any).Date = FilmDate;

const { __filmSeed } = await import("./history/store.js");
const { __filmUsage } = await import("./usage/metering.js");
const { randomUUID } = await import("node:crypto");

const IST = 330 * 60_000;
const at = (daysAgo: number, h: number, m: number) => RealDate.UTC(2026, 9, 18 - daysAgo, h, m) - IST;
let seed = 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const LINES: Array<[string, string]> = [
  ["Messages", "Count me in for Saturday! 🚴"],
  ["Slack", "Shipped the retry fix. Watching the error rate tonight; will post numbers in the morning."],
  ["Gmail", "Hi Ananya, thanks for the notes. Thursday at 4 works for me; I'll bring the revised deck."],
  ["Notes", "Ask Prof. Rao about the critiques of Gardner's theory."],
  ["WhatsApp", "Reached home, legs are dead 😅 Same time next week?"],
  ["Code", "Add a retry to the upload: three attempts with exponential backoff. Log each failure."],
  ["Notes", "Grocery run: oats, curd, bananas, coffee beans."],
  ["Slack", "Can we move the design review to 3? The client call ran over."],
];
// Today, by the hour: when they talked, and how much.
const TODAY: Array<[number, number, number]> = [
  [8, 41, 46], [9, 12, 38], [9, 47, 92], [10, 5, 120], [10, 33, 88], [10, 58, 140], [11, 20, 104], [11, 46, 76],
  [12, 30, 52], [13, 40, 66], [14, 2, 118], [14, 37, 96], [15, 10, 132], [15, 44, 150], [16, 8, 110], [16, 39, 128],
  [17, 15, 84], [17, 52, 70], [18, 30, 44], [19, 5, 62], [19, 48, 40], [20, 26, 96], [21, 3, 148], [21, 35, 120],
  [22, 10, 92], [22, 41, 74], [23, 12, 58], [23, 30, 41],
];
const DAYS = [0, 1980, 2310, 1460, 2750, 1890, 1210, 2240, 2620, 1730, 2050, 1380, 2410, 1650];
const rows: any[] = [];
const events: { at: number; audioSeconds: number; words: number }[] = [];
const add = (ms: number, words: number) => {
  const [app, out] = LINES[Math.floor(rnd() * LINES.length)];
  const audioSeconds = Math.round((words / 160) * 60 + 2);
  rows.push({
    id: randomUUID(), kind: "voice", targetApp: app, input: out.toLowerCase(), output: out, wordsIn: words + 6, wordsOut: words,
    durationMs: 900 + Math.round(rnd() * 700), tone: "none", presetId: "signature", createdAt: new RealDate(ms).toISOString(), audioSeconds,
  });
  events.push({ at: ms, audioSeconds, words });
};
for (const [h, m, w] of TODAY) add(at(0, h, m), w);
DAYS.forEach((total, d) => {
  if (!d) return;
  let left = total;
  for (let h = 9; left > 0 && h < 23; h += 1 + Math.floor(rnd() * 2)) {
    const w = Math.min(left, 60 + Math.floor(rnd() * 110));
    add(at(d, h, Math.floor(rnd() * 59)), w);
    left -= w;
  }
});
rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
__filmSeed("static-film", rows);
__filmUsage("static-film", events.sort((a, b) => a.at - b.at));
console.log(`[film] ${rows.length} dictations, today ${TODAY.reduce((s, x) => s + x[2], 0)} words, clock ${new Date().toISOString()}`);
await import("./server.js");
