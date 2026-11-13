import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPress, noticeState, nudgeOf, payloadData } from "./backgroundCore.ts";
import { NLOOK_LIMITS } from "../native/looksTable.ts";
import { bodyBytes } from "../native/looksCore.ts";

const state = {
  bot: "code", botName: "Xode", face: "code", task: "Fix the cart total", stage: 3, of: 5, stageName: "Build",
  stages: ["Read", "Plan", "Build", "Check", "Done"], startedAt: 1_763_000_000_000, phase: "working", link: "tulmi://job/j1",
};

describe("what a data push carries", () => {
  it("reads Android's dataString, iOS's data, and the notification's own content", () => {
    const d = { kind: "native.looks", v: 9 };
    assert.deepEqual(payloadData({ data: { dataString: JSON.stringify(d) }, notification: null }), d);
    assert.deepEqual(payloadData({ data: d }), d);
    assert.deepEqual(payloadData({ notification: { request: { content: { data: d } } } }), d);
    assert.deepEqual(payloadData({ data: { body: JSON.stringify(d) } }), d);
    assert.equal(payloadData(null), null);
    assert.equal(payloadData("x"), null);
  });

  it("a press on a button is not a data push", () => {
    assert.equal(isPress({ actionIdentifier: "done", notification: {} }), true);
    assert.equal(isPress({ data: {} }), false);
  });
});

describe("a catalog nudge", () => {
  it("names the version, or none", () => {
    assert.deepEqual(nudgeOf({ data: { kind: "native.looks", v: 9 } }), { kind: "looks", v: 9 });
    assert.deepEqual(nudgeOf({ data: { kind: "native.looks" } }), { kind: "looks", v: null });
    assert.deepEqual(nudgeOf({ data: { kind: "native.looks", v: -4 } }), { kind: "looks", v: null });
  });
  it("anything else is not ours", () => {
    assert.equal(nudgeOf({ data: { kind: "chat.reply" } }), null);
    assert.equal(nudgeOf({ data: {} }), null);
  });
});

describe("the Android notice's push", () => {
  it("an update carries the job's state, checked and cut", () => {
    const n = nudgeOf({ data: { kind: "bots.update", event: "update", state: { ...state, task: "t".repeat(900), evil: "x" }, look: "bu.base" } });
    assert.ok(n && n.kind === "notice" && n.event === "update" && n.json);
    const s = JSON.parse(n!.kind === "notice" ? n!.json! : "{}");
    assert.equal(s.task.length, 200);
    assert.equal(s.look, "bu.base");
    assert.equal("evil" in s, false);
  });

  it("an end needs no state, and an unknown event is nothing", () => {
    assert.deepEqual(nudgeOf({ data: { kind: "bots.update", event: "end" } }), { kind: "notice", event: "end", json: null });
    assert.equal(nudgeOf({ data: { kind: "bots.update", event: "boom", state } }), null);
  });

  it("a state with no bot is not a job, and a look that is not an id is left out", () => {
    assert.equal(noticeState({ ...state, bot: "" }, null), null);
    assert.equal(noticeState("job", null), null);
    assert.equal("look" in noticeState(state, "../up")!, false);
  });

  it("a private job carries no question words, and the flags it was sent with survive", () => {
    const s = noticeState({ ...state, phase: "needs", private: true, question: "A bot needs you", failed: true }, null)!;
    assert.equal(s.private, true);
    assert.equal(s.failed, true);
    assert.equal("question" in s, false);
    assert.equal("choices" in s, false);
    const t = noticeState({ ...state, phase: "needs", private: true, question: "Pay Dr. Mehta 4,000?", choices: [{ id: "y", label: "Pay 4,000" }] }, null)!;
    assert.equal("question" in t, false);
    assert.equal("choices" in t, false);
  });

  it("is held to the Live Activity's body cap whatever it was sent", () => {
    const s = noticeState({
      ...state, task: "क".repeat(900), question: "क".repeat(900), stages: Array.from({ length: 30 }, () => "क".repeat(90)),
      vars: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, "क".repeat(400)])),
    }, "bu.base")!;
    assert.ok(bodyBytes(s) <= NLOOK_LIMITS.activityBodyBytes);
  });
});
