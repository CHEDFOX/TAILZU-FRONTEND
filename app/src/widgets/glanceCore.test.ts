// node --test --experimental-strip-types src/widgets/glanceCore.test.ts
//
// The X0 widget's rules (the backend's docs/widget-glance-v2.md): only a v2 glance, every field checked and cut at a word, only
// this app's links (a PR only on github.com), safe face names; the case it leads with; when to ask again; which faces to fetch;
// the Bots at work Live Activity's start, update and end.

import test from "node:test";
import assert from "node:assert";
import {
  activityPlan, activityState, cleanGlance, cut, faceSources, facesToFetch, glanceAt, glanceDue, isFaceUrl, isPng, isPrUrl, nextStepAt,
  pickCase, STEPS_AHEAD_MS, STEPS_MAX, type ActivityMemo, type Glance,
} from "./glanceCore.ts";

const NOW = 1_793_350_000_000;

/** The contract's example glance. */
function sample(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 2, at: NOW, refreshAfterSec: 300, case: "needs",
    greeting: { hello: "Good evening, Aanya", line: "Anything to write up before the day ends?", part: "evening" },
    summary: "3 things moved since this morning",
    week: { done: 4, minutesSaved: 120, dots: 4, line: "4 things done this week · 2 h saved" },
    bots: [
      { slug: "code", name: "Code bot", color: "#3F7D3A", face: "code", faceUrl: "https://api.x0bot.com/blip/bots/head-code.png?v=7",
        state: "needs", needs: 1, working: true, line: "fixing cart", link: "tulmi://screen/bots.code" },
      { slug: "travel", name: "Travel bot", color: "#3E6E8E", face: "travel", faceUrl: "https://api.x0bot.com/blip/bots/head-travel.png?v=7",
        state: "working", needs: 0, working: true, line: "finding a hotel in Goa", link: "tulmi://screen/bots.travel" },
      { slug: "gym-bot", name: "Gym bot", color: "#2F5D50", face: null, faceUrl: null, state: "idle", link: "tulmi://screen/bots.gym-bot" },
    ],
    more: 3,
    needs: { count: 2, items: [{
      id: "job:j1:q1", kind: "question", bot: "code", botName: "Code bot", face: "code",
      question: "Round the cart total per item, or once at the end?",
      choices: [{ id: "a0", label: "Per item", primary: true }, { id: "a1", label: "At the end" }],
      decideLink: "tulmi://screen/bots.thread?id=t1", private: false, answerable: true, link: "tulmi://screen/bots.code",
    }] },
    job: { id: "j1", bot: "code", task: "Fixing cart", stage: 3, of: 5, stageName: "Build",
      stages: ["Understand", "Plan", "Build", "Check", "Ship"], startedAt: NOW - 52 * 60_000, link: "tulmi://screen/bots.code.job?id=j1" },
    counts: { working: 2, needs: 2 },
    lock: { inline: "Code bot needs you", title: "Code bot needs you", line: "Round the cart total per item…" },
    links: { ask: "tulmi://screen/bots.ask", home: "tulmi://", mic: "tulmi://screen/bots.ask?voice=1" },
    words: { needsYou: "Needs you", ready: "Ready", ask: "Ask any bot…", brand: "X0", youDecide: "You decide",
      working: "{n} working", step: "Step {stage} of {of}", minIn: "{n} min in", seePr: "See the PR", done: "Done" },
    ...over,
  };
}

const glance = (over: Record<string, unknown> = {}): Glance => cleanGlance(sample(over), NOW)!;

test("only a version 2 glance", () => {
  assert.equal(cleanGlance(null), null);
  assert.equal(cleanGlance({ v: 1, bots: [] }), null);
  assert.equal(cleanGlance("x"), null);
  const g = cleanGlance({ v: 2 }, NOW)!;
  assert.equal(g.case, "quiet");
  assert.deepEqual(g.bots, []);
  assert.equal(g.job, null);
  assert.equal(g.refreshAfterSec, 900);
  assert.equal(g.at, NOW);
});

test("the contract's example comes through whole", () => {
  const g = glance();
  assert.equal(g.case, "needs");
  assert.equal(g.bots.length, 3);
  assert.equal(g.bots[0]!.color, "#3F7D3A");
  assert.equal(g.bots[2]!.face, null);
  assert.equal(g.bots[2]!.line, "");
  assert.equal(g.needs.items[0]!.choices.length, 2);
  assert.equal(g.needs.items[0]!.answerable, true);
  assert.equal(g.job!.stage, 3);
  assert.deepEqual(g.job!.stages, ["Understand", "Plan", "Build", "Check", "Ship"]);
  assert.equal(g.words.youDecide, "You decide");
  assert.equal(g.links.mic, "tulmi://screen/bots.ask?voice=1");
});

test("links are this app's own; a PR only on github.com; faces only https and safe names", () => {
  const g = glance({
    bots: [
      { slug: "code", name: "Code bot", face: "../etc/passwd", faceUrl: "http://x.com/a.png", link: "https://evil.com" },
      { slug: "BAD SLUG", name: "x" },
      { slug: "plan", name: "Plan bot", face: "plan", faceUrl: "https://api.x0bot.com/blip/bots/head-plan.png", color: "red" },
    ],
    links: { ask: "javascript:alert(1)", home: "tulmi://", mic: "https://app.x0bot.com/s/bots.ask" },
    lastDone: { id: "j0", bot: "code", result: "Cart fix is ready", pr: { number: 131, url: "https://evil.com/pull/1" }, link: "intent://x" },
  });
  assert.equal(g.bots.length, 2);
  assert.equal(g.bots[0]!.face, null);
  assert.equal(g.bots[0]!.faceUrl, null);
  assert.equal(g.bots[0]!.link, "");
  assert.equal(g.bots[1]!.color, null);
  assert.equal(g.links.ask, "");
  assert.equal(g.links.mic, "https://app.x0bot.com/s/bots.ask");
  assert.equal(g.lastDone!.pr, null);
  assert.equal(g.lastDone!.link, "");
  assert.equal(isPrUrl("https://github.com/x0/app/pull/131"), true);
  assert.equal(isPrUrl("https://github.com.evil.com/x"), false);
  assert.equal(isFaceUrl("https://api.x0bot.com/blip/bots/head-code.png?v=7"), true);
  assert.equal(isFaceUrl("https://user:pw@x.com/a.png"), false);
  assert.equal(isFaceUrl("file:///a.png"), false);
});

test("answers: only ids the answer path takes, at most three, and answerable only with something to answer", () => {
  const g = glance({ needs: { count: 1, items: [
    { id: "job:j1:q1", kind: "question", bot: "code", question: "Which?", answerable: true, choices: [
      { id: "a0", label: "One" }, { id: "BAD ID", label: "Two" }, { id: "a2", label: "" }, { id: "a3", label: "Three" },
      { id: "a4", label: "Four" }, { id: "a5", label: "Five" },
    ] },
    { id: "has space", kind: "question" },
    { id: "job:j2:q1", kind: "question", answerable: true, choices: [] },
  ] } });
  assert.equal(g.needs.items.length, 2);
  assert.deepEqual(g.needs.items[0]!.choices.map((c) => c.id), ["a0", "a3", "a4"]);
  assert.equal(g.needs.items[1]!.answerable, false);
});

test("words are cut at a word, with … only when cut", () => {
  assert.equal(cut("Short one", 14), "Short one");
  assert.equal(cut("Round the cart total per item, or once at the end?", 24), "Round the cart total…");
  assert.equal(cut("  spaced   out  ", 20), "spaced out");
  assert.equal(cut("Supercalifragilisticexpialidocious", 10), "Supercali…");
  assert.equal(Array.from(cut("नमस्ते दुनिया यह एक लंबा वाक्य है", 12)).length <= 12, true);
  const g = glance({ greeting: { hello: "x".repeat(200), line: "word ".repeat(60) } });
  assert.ok(g.greeting.hello.length <= 60);
  assert.ok(g.greeting.line.endsWith("…") && Array.from(g.greeting.line).length <= 100);
});

test("numbers are whole and in range", () => {
  const g = glance({ week: { done: -3, dots: 9, minutesSaved: 1.6 }, refreshAfterSec: 5, job: { id: "j1", stage: 9, of: 5 } });
  assert.equal(g.week.done, 0);
  assert.equal(g.week.dots, 5);
  assert.equal(g.week.minutesSaved, 2);
  assert.equal(g.refreshAfterSec, 60);
  assert.equal(g.job!.stage, 5);
});

test("the case: the server's when the glance backs it, else needs → done → working → quiet", () => {
  assert.equal(glance().case, "needs");
  assert.equal(glance({ case: "needs", needs: { count: 0, items: [] } }).case, "working");
  assert.equal(glance({ case: "done", needs: { count: 0, items: [] } }).case, "working");
  const done = { id: "j0", bot: "code", botName: "Code bot", result: "Cart fix is ready", endedAt: NOW - 60_000, link: "tulmi://screen/bots.code.job?id=j0" };
  assert.equal(glance({ case: "bogus", needs: { count: 0, items: [] }, lastDone: done }).case, "done");
  assert.equal(glance({ case: "quiet" }).case, "quiet");
  const q = cleanGlance({ v: 2, case: "working" }, NOW)!;
  assert.equal(q.case, "quiet");
  assert.equal(pickCase({ needs: { count: 0, items: [] }, lastDone: null, job: null, bots: [], counts: { working: 1, needs: 0 } }), "working");
});

test("asks again on the server's interval, sooner when something happened", () => {
  assert.equal(glanceDue(0, NOW, 900, "due"), true);
  assert.equal(glanceDue(NOW - 299_000, NOW, 300, "due"), false);
  assert.equal(glanceDue(NOW - 300_000, NOW, 300, "due"), true);
  assert.equal(glanceDue(NOW - 5_000, NOW, 300, "soon"), false);
  assert.equal(glanceDue(NOW - 20_000, NOW, 300, "soon"), true);
  assert.equal(glanceDue(NOW - 1, NOW, 300, "force"), true);
  assert.equal(glanceDue(NOW - 600_000, NOW, Number.NaN, "due"), false);
  assert.equal(glanceDue(NOW - 900_000, NOW, Number.NaN, "due"), true);
});

test("faces: each once, fetched when missing or its picture changed", () => {
  const g = glance();
  const src = faceSources(g);
  assert.deepEqual(src.map((s) => s.face), ["code", "travel"]);
  assert.deepEqual(facesToFetch(src, {}).length, 2);
  assert.deepEqual(facesToFetch(src, { code: src[0]!.url, travel: src[1]!.url }), []);
  assert.deepEqual(facesToFetch(src, { code: "https://api.x0bot.com/blip/bots/head-code.png?v=6", travel: src[1]!.url }).map((s) => s.face), ["code"]);
  assert.equal(isPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), true);
  assert.equal(isPng(new TextEncoder().encode("<html>404</html>")), false);
});

test("the Live Activity's state: the job, and its bot's question when it waits on the person", () => {
  const s = activityState(glance())!;
  assert.equal(s.phase, "needs");
  assert.equal(s.botName, "Code bot");
  assert.equal(s.face, "code");
  assert.equal(s.question, "Round the cart total per item, or once at the end?");
  assert.equal(s.itemId, "job:j1:q1");
  assert.equal(s.choices!.length, 2);
  const hidden = activityState(glance({ needs: { count: 1, items: [{ ...(sample().needs as { items: object[] }).items[0], private: true }] } }))!;
  assert.equal(hidden.phase, "needs");
  assert.equal(hidden.question, undefined);
  assert.equal(hidden.choices, undefined);
  const working = activityState(glance({ needs: { count: 0, items: [] } }))!;
  assert.equal(working.phase, "working");
  assert.equal(working.question, undefined);
  assert.equal(activityState(glance({ job: null })), null);
});

test("the Live Activity: started for a new job, updated on change, ended on its lastDone or at once", () => {
  const g = glance();
  const first = activityPlan(g, null, NOW);
  assert.deepEqual(first.ops.map((o) => o.op), ["start"]);
  assert.equal(first.memo!.jobId, "j1");

  const again = activityPlan(g, first.memo, NOW);
  assert.deepEqual(again.ops, []);

  const moved = activityPlan(glance({ needs: { count: 0, items: [] }, job: { ...(sample().job as object), stage: 4, stageName: "Check" } }), first.memo, NOW);
  assert.deepEqual(moved.ops.map((o) => o.op), ["update"]);
  assert.equal(moved.ops[0]!.state.stage, 4);
  assert.equal(moved.ops[0]!.state.phase, "working");

  const lastDone = { id: "j1", bot: "code", botName: "Code bot", result: "Cart fix is ready", endedAt: NOW - 5 * 60_000, minutes: 58,
    pr: { number: 131, url: "https://github.com/x0/app/pull/131" }, link: "tulmi://screen/bots.code.job?id=j1" };
  const done = activityPlan(glance({ job: null, needs: { count: 0, items: [] }, lastDone }), moved.memo, NOW);
  assert.equal(done.memo, null);
  assert.equal(done.ops.length, 1);
  const end = done.ops[0]!;
  assert.equal(end.op, "end");
  assert.equal(end.state.phase, "done");
  assert.equal(end.state.stage, 5);
  assert.equal(end.state.result, "Cart fix is ready");
  assert.equal(end.state.pr!.number, 131);
  assert.equal(end.dismissAfterSec, 600);

  const gone = activityPlan(glance({ job: null, needs: { count: 0, items: [] } }), moved.memo, NOW);
  assert.deepEqual(gone.ops.map((o) => [o.op, o.dismissAfterSec]), [["end", 0]]);

  const old = activityPlan(glance({ job: null, needs: { count: 0, items: [] }, lastDone: { ...lastDone, endedAt: NOW - 60 * 60_000 } }), moved.memo, NOW);
  assert.equal(old.ops[0]!.dismissAfterSec, 0);

  const next: ActivityMemo = moved.memo!;
  const swap = activityPlan(glance({ job: { ...(sample().job as object), id: "j2" }, lastDone }), next, NOW);
  assert.deepEqual(swap.ops.map((o) => [o.op, o.jobId]), [["end", "j1"], ["start", "j2"]]);
  assert.equal(swap.ops[0]!.state.phase, "done");

  assert.deepEqual(activityPlan(glance({ job: null }), null, NOW), { ops: [], memo: null });
});

// ------------------------------------------------------------------ steps: lines that take over at their own minute

const MIN = 60_000;
/** A quiet evening glance with Plan Ease idle: its line, the lock words, and what comes next on their own. */
function planGlance(steps: unknown, over: Record<string, unknown> = {}): Glance {
  return cleanGlance(sample({
    case: "quiet", needs: { count: 0, items: [] }, job: null, counts: { working: 0, needs: 0 },
    bots: [
      { slug: "plan", name: "Plan Ease", state: "idle", line: "Next: design review 6 pm", link: "tulmi://screen/bots.plan" },
      { slug: "code", name: "Code bot", state: "idle", line: "Ready", link: "tulmi://screen/bots.code" },
    ],
    lock: { inline: "Next: design review 6 pm", title: "Design review at 6 pm", line: "Indiranagar" },
    steps, ...over,
  }), NOW)!;
}

test("no steps from a server or a request without them: the glance reads as written, and never changes on its own", () => {
  const g = planGlance(undefined);
  assert.deepEqual(g.steps, []);
  assert.strictEqual(glanceAt(g, NOW + 5 * 60 * MIN), g);
  assert.equal(nextStepAt(g, NOW), null);
});

test("a leave-by takes the row and the lock screen at its minute, and the next thing after it, with no new glance", () => {
  const g = planGlance([
    { at: NOW + 80 * MIN, bot: "plan", line: "Leave by 5:30 pm, Appointment", lock: { inline: "Leave by 5:30 · Appointment", title: "Leave by 5:30 pm", line: "Appointment, Indiranagar" } },
    { at: NOW + 110 * MIN, bot: "plan", line: "Next: Appointment 6 pm", lock: { inline: "Next: Appointment 6:00", title: "Appointment at 6 pm", line: "Indiranagar" } },
    { at: NOW + 150 * MIN, bot: "plan", line: "Tomorrow: PTM 9:30 am", lock: { inline: "Ready", title: "Good evening, Aanya", line: "" } },
  ]);
  assert.equal(g.steps.length, 3);
  // Before the first: as written.
  assert.equal(glanceAt(g, NOW + 79 * MIN).bots[0]!.line, "Next: design review 6 pm");
  assert.equal(glanceAt(g, NOW + 79 * MIN).lock.inline, "Next: design review 6 pm");
  // From the leave-by's minute.
  const leave = glanceAt(g, NOW + 80 * MIN);
  assert.equal(leave.bots[0]!.line, "Leave by 5:30 pm, Appointment");
  assert.deepEqual(leave.lock, { inline: "Leave by 5:30 · Appointment", title: "Leave by 5:30 pm", line: "Appointment, Indiranagar" });
  // Another bot's row is not touched.
  assert.equal(leave.bots[1]!.line, "Ready");
  // Then the next thing, then tomorrow: never "next" for a thing already over.
  assert.equal(glanceAt(g, NOW + 111 * MIN).lock.title, "Appointment at 6 pm");
  assert.equal(glanceAt(g, NOW + 200 * MIN).bots[0]!.line, "Tomorrow: PTM 9:30 am");
  assert.equal(glanceAt(g, NOW + 200 * MIN).lock.inline, "Ready");
  // When it next reads differently.
  assert.equal(nextStepAt(g, NOW), NOW + 80 * MIN);
  assert.equal(nextStepAt(g, NOW + 80 * MIN), NOW + 110 * MIN);
  assert.equal(nextStepAt(g, NOW + 150 * MIN), null);
});

test("a step's line and its lock words each hold until the next step that sets them", () => {
  const g = planGlance([
    { at: NOW + 10 * MIN, bot: "plan", line: "Leave by 9:00 for PTM" , lock: { inline: "Leave by 9:00 · PTM", title: "Leave by 9:00 am", line: "PTM at school, 9:30" } },
    { at: NOW + 20 * MIN, bot: "plan", line: "Next: PTM 9:30" },
    { at: NOW + 30 * MIN, lock: { inline: "Next: PTM 9:30", title: "PTM at 9:30", line: "School" } },
  ]);
  const a = glanceAt(g, NOW + 25 * MIN);
  assert.equal(a.bots[0]!.line, "Next: PTM 9:30");
  assert.equal(a.lock.title, "Leave by 9:00 am");
  const b = glanceAt(g, NOW + 35 * MIN);
  assert.equal(b.bots[0]!.line, "Next: PTM 9:30");
  assert.equal(b.lock.title, "PTM at 9:30");
});

test("what needs the person beats the time of day: an asking or busy row keeps its line, a question keeps the lock screen", () => {
  const steps = [{ at: NOW + MIN, bot: "plan", line: "Leave by 5:30 pm", lock: { inline: "Leave by 5:30", title: "Leave by 5:30 pm", line: "" } }];
  const asking = planGlance(steps, {
    case: "needs",
    bots: [{ slug: "plan", name: "Plan Ease", state: "needs", needs: 1, line: "Move the grocery run to Sat 11 am?" }],
    needs: { count: 1, items: [{ id: "pm:e1:1793400000000", kind: "plan", bot: "plan", question: "Move the grocery run to Sat 11 am?",
      choices: [{ id: "move", label: "Move it", primary: true }, { id: "keep", label: "Keep" }], answerable: true }] },
    lock: { inline: "Plan Ease needs you", title: "Plan Ease needs you", line: "Move the grocery run?" },
  });
  const later = glanceAt(asking, NOW + 2 * MIN);
  assert.equal(later.bots[0]!.line, "Move the grocery run to Sat 11 am?");
  assert.equal(later.lock.title, "Plan Ease needs you");
  const busy = planGlance(steps, { bots: [{ slug: "plan", name: "Plan Ease", state: "working", working: true, line: "reading the circular" }] });
  assert.equal(glanceAt(busy, NOW + 2 * MIN).bots[0]!.line, "reading the circular");
  // The lock words still move on a quiet or busy widget.
  assert.equal(glanceAt(busy, NOW + 2 * MIN).lock.title, "Leave by 5:30 pm");
});

test("steps are checked: a time, a bot the glance has or lock words, within two days; cut to their lengths; oldest first", () => {
  const g = planGlance([
    { at: NOW + 30 * MIN, bot: "plan", line: "B" },
    { at: NOW + 20 * MIN, bot: "plan", line: "A " + "x".repeat(80) },
    { at: 0, bot: "plan", line: "no time" },
    { at: "soon", bot: "plan", line: "no time" },
    { at: NOW + 40 * MIN, bot: "ghost", line: "a bot it does not have" },
    { at: NOW + 50 * MIN, bot: "plan", line: "" },
    { at: NOW + 60 * MIN, bot: "plan", line: "   ", lock: { inline: "", title: "", line: "" } },
    { at: NOW + STEPS_AHEAD_MS + MIN, bot: "plan", line: "too far ahead" },
    "not a step", null,
    { at: NOW + 70 * MIN, lock: { inline: "I".repeat(80), title: "T", line: "L" } },
  ]);
  assert.deepEqual(g.steps.map((s) => s.at), [NOW + 20 * MIN, NOW + 30 * MIN, NOW + 70 * MIN]);
  assert.ok(Array.from(g.steps[0]!.line).length <= 40);
  assert.ok(g.steps[0]!.line.endsWith("…"));
  assert.equal(g.steps[2]!.bot, "");
  assert.equal(g.steps[2]!.line, "");
  assert.ok(Array.from(g.steps[2]!.lock!.inline).length <= 40);
  assert.equal(g.steps[0]!.lock, null);
});

test("of the steps already begun only the one in force is kept, and at most a handful in all", () => {
  const g = planGlance([
    { at: NOW - 30 * MIN, bot: "plan", line: "old", lock: { inline: "old lock", title: "", line: "" } },
    { at: NOW - 20 * MIN, bot: "plan", line: "in force" },
    { at: NOW - 10 * MIN, lock: { inline: "lock in force", title: "", line: "" } },
    ...Array.from({ length: 30 }, (_, i) => ({ at: NOW + (i + 1) * MIN, bot: "plan", line: `step ${i + 1}` })),
  ]);
  assert.equal(g.steps.length, STEPS_MAX);
  assert.deepEqual(g.steps.slice(0, 2).map((s) => s.line || s.lock?.inline), ["in force", "lock in force"]);
  assert.equal(g.steps[2]!.line, "step 1");
  // Read now, the kept ones give what the whole list gave.
  const now = glanceAt(g, NOW);
  assert.equal(now.bots[0]!.line, "in force");
  assert.equal(now.lock.inline, "lock in force");
});

