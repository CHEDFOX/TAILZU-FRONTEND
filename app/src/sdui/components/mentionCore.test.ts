// node --test --experimental-strip-types src/sdui/components/mentionCore.test.ts
//
// A message field's @ and /: the triggers (at the start or after a space only); the filter; a pick takes "@wo" out; backspace
// takes a chip off; the draft's shape; clearing; and at sending, "@mom hi" with one Mom is her chip and "hi", with two Moms
// the list opens and nothing is sent, "@zed hi" (nobody) is sent as words.
import test from "node:test";
import assert from "node:assert";
import {
  EMPTY, atSubmit, backspace, canSend, draftOf, escape, filterBots, filterPeople, fromDraft, isEmptyDraft, pickBot, pickPerson, pickThing, pickTool,
  tokenAt, typed, type BotRef, type Person,
} from "./mentionCore.ts";

const PEOPLE: Person[] = [{ id: "u1", name: "Mom" }, { id: "u2", name: "Rohan Sharma" }, { id: "u3", name: "Meera" }];
const BOTS: BotRef[] = [
  { slug: "plan", name: "Plan Ease", color: "#8F6A1F", kind: "plan" },
  { slug: "notes", name: "Notes", color: "#2F5D50", kind: "notes" },
];

test("@ and / open their lists only at the start or after a space", () => {
  assert.deepStrictEqual(typed(EMPTY, "@").menu, { kind: "people", query: "", start: 0, end: 1 });
  assert.deepStrictEqual(typed(EMPTY, "hi @ro").menu, { kind: "people", query: "ro", start: 3, end: 6 });
  assert.strictEqual(typed(EMPTY, "mail me@home").menu, null, "inside a word: nothing");
  assert.strictEqual(typed(EMPTY, "and/or").menu, null);
  assert.deepStrictEqual(typed(EMPTY, "/").menu, { kind: "bots", query: "", start: 0, end: 1 });
  assert.deepStrictEqual(typed(EMPTY, "look /pl").menu, { kind: "bots", query: "pl", start: 5, end: 8 });
  assert.strictEqual(typed(typed(EMPTY, "@ro"), "@ro ").menu, null, "a space after the word closes it");
  assert.deepStrictEqual(tokenAt("one two", 3), { start: 0, end: 3, word: "one" }, "the caret's word, not the last one");
  assert.strictEqual(typed(EMPTY, "@mo hi", 3).menu?.kind, "people", "the word the caret is in");
});

test("@ opens nothing once there is a person; / still works with a person", () => {
  const s = pickPerson(typed(EMPTY, "@m"), PEOPLE[0]!);
  assert.strictEqual(typed(s, "@r").menu, null);
  assert.strictEqual(typed(s, "/").menu?.kind, "bots");
});

test("the lists are filtered by what is typed after the trigger", () => {
  assert.deepStrictEqual(filterPeople(PEOPLE, "").map((p) => p.id), ["u1", "u2", "u3"]);
  assert.deepStrictEqual(filterPeople(PEOPLE, "M").map((p) => p.id), ["u1", "u3"]);
  assert.deepStrictEqual(filterPeople(PEOPLE, "sha").map((p) => p.id), ["u2"], "a later word of the name");
  assert.deepStrictEqual(filterBots(BOTS, "pl").map((b) => b.slug), ["plan"]);
  assert.deepStrictEqual(filterBots(BOTS, "").length, 2);
});

test("a pick takes the \"@wo\" out and adds the chip; a bot then a thing; a tool closes the list", () => {
  const s = pickPerson(typed(EMPTY, "hi @mo"), PEOPLE[0]!);
  assert.strictEqual(s.text, "hi ");
  assert.deepStrictEqual(s.person, { id: "u1", name: "Mom" });
  assert.strictEqual(s.menu, null);
  const lead = pickPerson(typed(EMPTY, "@mo hi", 3), PEOPLE[0]!);
  assert.strictEqual(lead.text, "hi", "and the space after it at the start");
  const b = pickBot(typed(s, "hi /pl"), BOTS[0]!);
  assert.strictEqual(b.text, "hi ");
  assert.deepStrictEqual(b.menu, { kind: "things", bot: "plan", botName: "Plan Ease" });
  assert.strictEqual(typed(b, "hi x").menu?.kind, "things", "the things stay open while typing");
  const t = pickThing(b, { id: "e:1", title: "Doctor", line: "Fri, 7:40" });
  assert.deepStrictEqual(t.thing, { bot: "plan", botName: "Plan Ease", id: "e:1", title: "Doctor" });
  assert.strictEqual(t.menu, null);
  assert.strictEqual(pickThing(EMPTY, { id: "x", title: "x", line: "" }), EMPTY, "no bot's list: nothing");
  const tool = pickTool(typed(EMPTY, "/as"));
  assert.strictEqual(tool.text, "");
  assert.strictEqual(tool.menu, null);
  assert.deepStrictEqual(escape(b).menu?.kind, "bots", "Escape from a bot's things: back to the bots");
  assert.strictEqual(escape(typed(EMPTY, "@")).menu, null, "and from a list: closed");
});

test("backspace in an empty field takes the last chip off: the thing, then the person", () => {
  let s = pickThing(pickBot(typed(pickPerson(typed(EMPTY, "@m"), PEOPLE[0]!), "/"), BOTS[0]!), { id: "e:1", title: "Doctor", line: "" });
  assert.ok(s.person && s.thing);
  s = backspace(s);
  assert.ok(s.person && !s.thing);
  s = backspace(s);
  assert.ok(!s.person);
  assert.strictEqual(backspace({ ...s, text: "x", person: PEOPLE[0]! }).person?.id, "u1", "not while there are words");
});

test("the draft: the words without the chips, and the chips' ids and names; empty strings for none; read back", () => {
  const s = pickThing(pickBot(typed(pickPerson(typed(EMPTY, "@m"), PEOPLE[0]!), " see this /"), BOTS[0]!), { id: "e:1", title: "Doctor", line: "" });
  const d = draftOf(s);
  assert.deepStrictEqual(d, { text: "see this", toId: "u1", toName: "Mom", bot: "plan", botName: "Plan Ease", thingId: "e:1", thingTitle: "Doctor" });
  assert.deepStrictEqual(draftOf(EMPTY), { text: "", toId: "", toName: "", bot: "", botName: "", thingId: "", thingTitle: "" });
  const back = fromDraft(d);
  assert.deepStrictEqual(back.person, { id: "u1", name: "Mom" });
  assert.strictEqual(back.thing?.id, "e:1");
  assert.ok(canSend(s) && !canSend(EMPTY) && canSend({ ...EMPTY, thing: back.thing }), "a thing alone can be sent");
});

test("clearing: an empty or missing draft says nothing", () => {
  assert.ok(isEmptyDraft(undefined) && isEmptyDraft(null) && isEmptyDraft(""));
  assert.ok(isEmptyDraft(draftOf(EMPTY)));
  assert.ok(!isEmptyDraft({ text: "", toId: "u1", toName: "Mom" }));
  assert.ok(!isEmptyDraft({ text: "hi" }));
  assert.deepStrictEqual(fromDraft(undefined), EMPTY);
});

test("sending \"@name\" typed out: one match is a chip, two open the list and send nothing, nobody is just words", () => {
  const one = atSubmit(typed(EMPTY, "@mom hi"), PEOPLE);
  assert.strictEqual(one.send, true);
  assert.deepStrictEqual(one.state.person, { id: "u1", name: "Mom" });
  assert.strictEqual(one.state.text, "hi");
  assert.deepStrictEqual(draftOf(one.state).toId, "u1");
  const comma = atSubmit(typed(EMPTY, "@Mom, dinner"), PEOPLE);
  assert.strictEqual(comma.state.person?.id, "u1", "its punctuation does not stop it");
  const two = [...PEOPLE, { id: "u4", name: "Mom Two" }];
  const many = atSubmit(typed(EMPTY, "@mom hi"), two);
  assert.strictEqual(many.send, false, "nothing sent");
  assert.deepStrictEqual(many.state.menu, { kind: "people", query: "mom", start: 0, end: 4 });
  assert.strictEqual(many.state.person, null);
  assert.deepStrictEqual(filterPeople(two, "mom").map((p) => p.id), ["u1", "u4"], "the list shows both");
  const picked = pickPerson(many.state, two[3]!);
  assert.strictEqual(picked.text, "hi", "a pick from it takes the @mom out");
  const nobody = atSubmit(typed(EMPTY, "@zed hi"), PEOPLE);
  assert.strictEqual(nobody.send, true);
  assert.strictEqual(nobody.state.person, null);
  assert.strictEqual(nobody.state.text, "@zed hi", "sent as words");
  const chip = atSubmit({ ...typed(EMPTY, "@rohan hi"), person: PEOPLE[0]! }, PEOPLE);
  assert.strictEqual(chip.state.person?.id, "u1", "a person picked already wins");
  assert.strictEqual(chip.state.text, "@rohan hi");
  const plain = atSubmit(typed(EMPTY, "hi @mom"), PEOPLE);
  assert.strictEqual(plain.state.person, null, "not at the start: words");
});
