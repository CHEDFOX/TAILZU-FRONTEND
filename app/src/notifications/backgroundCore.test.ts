import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { callCheckBody, callCheckPath, isPress, noticeState, nudgeOf, payloadData } from "./backgroundCore.ts";
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

// THE PRE-RING CHECK (docs: perms2 5.3): two yes-or-no answers about this phone, on that call's own route, and nothing else.
describe("the pre-ring check", () => {
  it("answers only on that call's own route, and only for a real call id", () => {
    assert.equal(callCheckPath("call_9aZ-1"), "/v1/botsapp/plan/calls/call_9aZ-1/check");
    for (const bad of ["", "Call Nine", "../../admin", "a/b", "x".repeat(70), null, 7]) assert.equal(callCheckPath(bad), null);
  });

  it("is a nudge only when the push names a call and something to answer", () => {
    assert.deepEqual(nudgeOf({ data: { kind: "plan_call_check", call: "c1", want: ["driving", "focus"] } }),
      { kind: "callCheck", path: "/v1/botsapp/plan/calls/c1/check", want: ["driving", "focus"] });
    // only the two known questions, in a fixed order, so a push can never ask for a new kind of answer
    assert.deepEqual(nudgeOf({ data: { kind: "plan_call_check", call: "c1", want: ["focus", "location", "contacts"] } }),
      { kind: "callCheck", path: "/v1/botsapp/plan/calls/c1/check", want: ["focus"] });
    assert.equal(nudgeOf({ data: { kind: "plan_call_check", call: "c1", want: [] } }), null);
    assert.equal(nudgeOf({ data: { kind: "plan_call_check", call: "c1", want: ["location"] } }), null);
    assert.equal(nudgeOf({ data: { kind: "plan_call_check", want: ["focus"] } }), null);
    assert.equal(nudgeOf({ data: { kind: "plan_call_check", call: "c1" } }), null);
  });

  it("sends only what was asked for and only what the phone could really tell", () => {
    assert.deepEqual(callCheckBody(["driving", "focus"], { driving: true, focus: false }), { driving: true, focus: false });
    // a question the phone cannot answer is left out: no answer at all is fine, and the call rings as today
    assert.deepEqual(callCheckBody(["driving", "focus"], { driving: null, focus: true }), { focus: true });
    assert.deepEqual(callCheckBody(["driving"], { driving: null, focus: true }), {});
    assert.deepEqual(callCheckBody(["focus"], { driving: true, focus: null }), {});
    // nothing about where the phone is, or which Focus, can be in the body at all
    const body = callCheckBody(["driving", "focus"], { driving: false, focus: true });
    assert.deepEqual(Object.keys(body).sort(), ["driving", "focus"]);
  });
});
