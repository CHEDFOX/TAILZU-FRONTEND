/**
 * A film's meeting, in a scratch copy of the backend: the clock held at
 * Monday 19 October 2026, 12:02 PM in India, and one note in the in-memory
 * store — AMI meeting ES2002a's kick-off (CC BY 4.0), its transcript the
 * corpus's own words by turn, organised the way the writer would.
 */
import fs from "node:fs";
const FIXED = Date.UTC(2026, 9, 19, 6, 32, 0); // 12:02 IST
const RealDate = globalThis.Date;
const START = RealDate.now();
const nowMs = () => FIXED + (RealDate.now() - START);
class FilmDate extends RealDate {
  constructor(...a: any[]) { if (a.length === 0) super(nowMs()); else super(...(a as [any])); }
  static now() { return nowMs(); }
}
(globalThis as any).Date = FilmDate;

const { __filmNote } = await import("./notes/store.js");
const seed = JSON.parse(fs.readFileSync(new URL("./note-seed.json", import.meta.url), "utf8"));
const started = RealDate.UTC(2026, 9, 19, 6, 12, 0); // 11:42 IST
__filmNote("static-film", {
  id: "5b0c3f7e-6a41-4f2e-9d0a-2f6c1e8a7b19",
  status: "ready",
  startedAt: new RealDate(started).toISOString(),
  endedAt: new RealDate(started + seed.duration * 1000).toISOString(),
  durationSeconds: seed.duration,
  words: seed.words,
  title: process.env.NOTE_TITLE || "Remote control kick-off: price, budget, roles",
  summary: "You kicked off the new remote control: it sells for 25 euros, internationally, and can cost no more than 12.50 to make. Marketing asked whether that is the wholesale or the shelf price. The team floated one remote for every device, and a way to find it when it's lost. Each role works on its part before the next meeting, in thirty minutes.",
  highlights: [
    { speaker: "You", text: "We'll sell the remote for 25 euros, internationally, and we're aiming to make 50 million euros." },
    { speaker: "You", text: "It can't cost more than 12.50 euros to make: half the selling price." },
    { speaker: "Speaker 1", text: "Is the 25 euros the wholesale price, or the price on the shelf?" },
    { speaker: "Speaker 3", text: "My parents bought a new remote because they were fed up with four or five. What mattered was how many devices it controls." },
    { speaker: "You", text: "Some remotes beep when you whistle for them. Is that something we'd want to include?" },
    { speaker: "You", text: "Before the next meeting: industrial design works on the working design, interface on the technical functions, marketing on the requirements." },
    { speaker: "Speaker 2", text: "Production cost is the main factor. There's a cap, so it depends how much we can fit into that price." },
  ],
  people: [
    { label: "Speaker 1", name: process.env.N1 || "Marketing" },
    { label: "Speaker 2", name: process.env.N2 || "Industrial designer" },
    { label: "Speaker 3", name: process.env.N3 || "Interface designer" },
  ],
  transcript: seed.segments,
  organised: true,
  systemAudio: "ok",
} as any);
console.log(`[film] a note of ${seed.segments.length} turns, ${seed.words} words, clock ${new Date().toISOString()}`);
await import("./server.js");
