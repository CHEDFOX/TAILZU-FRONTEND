// node --test --experimental-strip-types src/sdui/motion/valuesCore.test.ts
//
// The `ui.*` value bus: names are shared by whoever asks for them, a view holds the names it writes while it
// is mounted, and a name nobody holds is given up the moment the cap needs its place. That last one is what
// keeps the cap from running out for the rest of the launch after a dozen screens have been and gone.

import test from "node:test";
import assert from "node:assert";
import { bareName, ValueBus } from "./valuesCore.ts";

/** A stand-in for a shared value: an object, so identity can be checked. */
const made = () => ({ value: 0 });

test("the `ui.` prefix is not part of the name", () => {
  assert.equal(bareName("ui.pill.x"), "pill.x");
  assert.equal(bareName("pill.x"), "pill.x");
  assert.equal(bareName("uiX"), "uiX", "only the prefix with its dot");
});

test("one name is one value, however it is written and whoever asks", () => {
  const bus = new ValueBus(8, made);
  const a = bus.get("ui.scrollY");
  assert.ok(a);
  assert.equal(bus.get("scrollY"), a, "the writer and the reader land on the same number");
  assert.equal(bus.size, 1);
  assert.equal(bus.get(""), null, "a nameless value is nothing");
});

test("peek does not make a name", () => {
  const bus = new ValueBus(8, made);
  assert.equal(bus.peek("pill.x"), null);
  assert.equal(bus.size, 0);
  bus.get("pill.x");
  assert.ok(bus.peek("pill.x"));
});

test("a name goes when the last view holding it has gone", () => {
  const bus = new ValueBus(8, made);
  bus.hold("pill.x");
  bus.hold("ui.pill.x");
  assert.equal(bus.holds("pill.x"), 2, "two nodes on one `into`");
  bus.release("pill.x");
  assert.equal(bus.size, 1, "one is still writing it");
  bus.release("ui.pill.x");
  assert.equal(bus.size, 0);
  assert.equal(bus.holds("pill.x"), 0);
  bus.release("pill.x");
  assert.equal(bus.size, 0, "letting go of nothing is nothing");
});

test("the cap gives up what nobody holds rather than refusing for ever", () => {
  // Two screens' worth of names, on a bus that can only hold two: without the sweep, the third screen's
  // values would be refused for the rest of the launch, so its drags and parallaxes would quietly stop.
  const bus = new ValueBus(2, made);
  bus.get("gone.a");
  bus.get("gone.b");
  assert.equal(bus.size, 2);
  const fresh = bus.get("new.a");
  assert.ok(fresh, "the names the screen that has gone left behind make way");
  assert.equal(bus.size, 1);
});

test("a name a live view is holding is never swept from under it", () => {
  const bus = new ValueBus(2, made);
  const held = bus.hold("pill.x");
  bus.get("loose");
  assert.equal(bus.size, 2);
  assert.ok(bus.get("another"), "the loose name makes way");
  assert.equal(bus.peek("loose"), null, "it is the one that went");
  assert.equal(bus.get("pill.x"), held, "and the held one is still the same number a finger is writing");
  // Now every name is spoken for, so there is genuinely nothing to give.
  bus.hold("another");
  assert.equal(bus.get("third"), null);
});

test("clear forgets the names and the holds together", () => {
  const bus = new ValueBus(4, made);
  bus.hold("pill.x");
  bus.clear();
  assert.equal(bus.size, 0);
  assert.equal(bus.holds("pill.x"), 0);
});
