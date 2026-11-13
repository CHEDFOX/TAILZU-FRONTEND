// node --test
//
// Templates: a definition drawn in its place, slots filled by the caller, and every way a screen could try to
// draw forever.
import test from "node:test";
import assert from "node:assert";
import { LIMITS } from "./limits.ts";
import { ARGS_KEY, ARGS_UP_KEY, type Defs, checkDefs, expandItem, expandTree } from "./defs.ts";

const text = (content: unknown): Record<string, unknown> => ({ type: "Text", props: { content } });

const defs: Defs = {
  "bot.row": {
    params: ["bot"],
    root: {
      type: "Stack",
      children: [
        text({ $: "args.bot.name" }),
        { type: "Slot", name: "trail", children: [text("›")] },
      ],
    },
  },
  "bot.page": {
    root: { type: "Stack", children: [{ type: "Use", def: "bot.row", args: { bot: { $: "state.bot" } } }] },
  },
};

test("a Use is replaced by what it names, and its arguments ride on the root", () => {
  const out = expandTree({ type: "Use", def: "bot.row", args: { bot: { $: "item" } } }, defs);
  const node = out.node as Record<string, unknown>;
  assert.strictEqual(node.type, "Stack");
  assert.deepStrictEqual(node[ARGS_KEY], [{ bot: { $: "item" } }], "the renderer works the arguments out in the caller's scope");
  const kids = node.children as Record<string, unknown>[];
  assert.strictEqual(kids.length, 2);
  assert.deepStrictEqual(kids[1], text("›"), "a slot nobody filled draws its own default");
  assert.strictEqual(out.nodes, 3);
});

test("a slot is filled by the caller, and what the caller wrote belongs to the caller", () => {
  const out = expandTree(
    { type: "Use", def: "bot.row", args: {}, slots: { trail: text({ $: "state.count" }) } },
    defs,
  );
  const kids = (out.node as Record<string, unknown>).children as Record<string, unknown>[];
  assert.deepStrictEqual(kids[1], { ...text({ $: "state.count" }), [ARGS_UP_KEY]: 1 });
});

test("slot contents read the caller's arguments, however deep in the template they land", () => {
  // The common shape: a list row (which knows `user`) draws a card (which knows `bot`) and fills its slot with
  // something of its own. Without the marker that Text would read `args.user` against the card's arguments.
  const nested: Defs = {
    card: { root: { type: "Card", children: [text({ $: "args.bot.name" }), { type: "Slot", name: "trail" }] } },
    row: {
      root: {
        type: "Use", def: "card", args: { bot: { $: "args.user.bot" } },
        slots: { trail: text({ $: "args.user.name" }) },
      },
    },
  };
  const out = expandTree({ type: "Use", def: "row", args: { user: { $: "item" } } }, nested);
  const card = out.node as Record<string, unknown>;
  assert.strictEqual(card.type, "Card");
  assert.deepStrictEqual(
    card[ARGS_KEY],
    [{ user: { $: "item" } }, { bot: { $: "args.user.bot" } }],
    "both frames survive: the outer one first, the inner one worked out in the scope it makes",
  );
  const kids = card.children as Record<string, unknown>[];
  assert.strictEqual(kids[0]![ARGS_UP_KEY], undefined, "the template's own node reads the template's arguments");
  assert.strictEqual(kids[1]![ARGS_UP_KEY], 1, "the caller's node steps back to the caller's arguments");
});

test("a template whose root is a Use keeps both sets of arguments", () => {
  const chained: Defs = {
    outer: { root: { type: "Use", def: "inner", args: { x: { $: "args.y" } } } },
    inner: { root: text({ $: "args.x" }) },
  };
  const out = expandTree({ type: "Use", def: "outer", args: { y: { $: "item.name" } } }, chained);
  assert.deepStrictEqual(
    (out.node as Record<string, unknown>)[ARGS_KEY],
    [{ y: { $: "item.name" } }, { x: { $: "args.y" } }],
    "the outer frame no longer overwrites the inner one, which would leave args.x undefined for ever",
  );
});

test("a Use may not carry props that expansion would quietly drop", () => {
  const rows: Defs = { row: { root: text("x") } };
  assert.throws(
    () => expandTree({ type: "Use", def: "row", visibleIf: { expr: "!state.hidden" } }, rows),
    /carries "visibleIf"/,
    "a condition that disappeared would leave the node always showing",
  );
  assert.match(checkDefs({ a: { root: { type: "Use", def: "a", style: { marginTop: 8 } } } }).join(" "), /carrying "style"/);
  assert.ok(expandTree({ type: "Use", def: "row", fallback: text("…") }, rows).node, "a fallback is allowed");
});

test("a slot may hold several nodes, and they are laid out in its place", () => {
  const out = expandTree(
    { type: "Use", def: "bot.row", slots: { trail: [text("a"), text("b")] } },
    defs,
  );
  const kids = (out.node as Record<string, unknown>).children as Record<string, unknown>[];
  assert.strictEqual(kids.length, 3, "the name, then the two nodes the slot held");
  assert.deepStrictEqual(kids.slice(1).map((k) => (k.props as Record<string, unknown>).content), ["a", "b"]);
});

test("templates nest, up to the depth the limits allow", () => {
  const out = expandTree({ type: "Use", def: "bot.page" }, defs);
  const page = out.node as Record<string, unknown>;
  const row = (page.children as Record<string, unknown>[])[0]!;
  assert.strictEqual(row.type, "Stack");
  assert.ok(row[ARGS_KEY], "the inner Use keeps its own arguments");

  const deep: Defs = {};
  for (let i = 0; i <= LIMITS.defsDepth + 1; i += 1) {
    deep[`d${i}`] = { root: i === LIMITS.defsDepth + 1 ? text("end") : { type: "Use", def: `d${i + 1}` } };
  }
  assert.throws(() => expandTree({ type: "Use", def: "d0" }, deep), /nest at most/);
});

test("recursion is refused when the definitions are checked, not after the phone has hung", () => {
  const loop: Defs = {
    a: { root: { type: "Stack", children: [{ type: "Use", def: "b" }] } },
    b: { root: { type: "Stack", children: [{ type: "Use", def: "a" }] } },
  };
  const errors = checkDefs(loop);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0]!, /a → b → a|b → a → b/);

  assert.deepStrictEqual(checkDefs(defs), [], "the good ones pass");
  assert.match(checkDefs({ x: { root: { type: "Use", def: "x" } } })[0]!, /circle/);
  assert.match(checkDefs({ x: { root: { type: "Use", def: "gone" } } })[0]!, /does not define/);
  assert.match(checkDefs({ x: {} as never })[0]!, /no root/);

  const many: Defs = {};
  for (let i = 0; i <= LIMITS.defs; i += 1) many[`d${i}`] = { root: text("x") };
  assert.match(checkDefs(many)[0]!, /at most 32 definitions/);
});

test("a row template lives under the smaller ceiling, because it is drawn once per row", () => {
  const kids = Array.from({ length: LIMITS.defsNodes + 5 }, () => text("x"));
  const wide = { type: "Stack", children: kids };
  assert.throws(() => expandItem(wide), /at most 200 nodes/);
  assert.strictEqual(expandTree(wide).nodes, kids.length + 1, "the same tree is fine as a screen");
});

test("a screen cannot be made endless, wide or deep", () => {
  let deep: unknown = text("x");
  for (let i = 0; i < LIMITS.depth + 5; i += 1) deep = { type: "Stack", children: [deep] };
  assert.throws(() => expandTree(deep), /nests at most/);

  const kids = Array.from({ length: LIMITS.nodes + 10 }, () => text("x"));
  assert.throws(() => expandTree({ type: "Stack", children: kids }), /at most 2500 nodes/);

  assert.throws(() => expandTree({ type: "Use", def: "nope" }, defs), /no template named/);
  assert.throws(() => expandTree({ type: "Use" }, defs), /no template named/);
});

test("a fan-out that draws nothing is still work, and still bounded", () => {
  // Six definitions, each a Slot holding thirty Uses of the next. Nothing here is a node, so the node count
  // stays at 0 while the expansion walks 30^5 branches: minutes of a frozen phone unless the steps are counted.
  const fan: Defs = {};
  const names = ["a", "b", "c", "d", "e", "f"];
  names.forEach((name, i) => {
    const kids = i + 1 < names.length ? Array.from({ length: 30 }, () => ({ type: "Use", def: names[i + 1] })) : [];
    fan[name] = { root: { type: "Slot", children: kids } };
  });
  assert.deepStrictEqual(checkDefs(fan), [], "nothing about these definitions is wrong on paper");
  const started = Date.now();
  assert.throws(() => expandTree({ type: "Use", def: "a" }, fan), /at most 10000 steps/);
  assert.ok(Date.now() - started < 1000, "and it gives up at once, not after a second of work");

  const ok = expandTree({ type: "Stack", children: [text("x"), text("y")] });
  assert.strictEqual(ok.nodes, 3);
  assert.ok(ok.steps >= ok.nodes, "an ordinary screen reports what it cost");
});

test("the hostile definitions are reported by the gate, not crashed through it", () => {
  const proto = checkDefs(JSON.parse('{"__proto__":{"root":{"type":"Stack","children":[{"type":"Use","def":"__proto__"}]}}}'));
  assert.match(proto.join(" "), /not a plain name/, "a definition called __proto__ is refused, not followed for ever");

  let deep: unknown = text("end");
  for (let i = 0; i < 6000; i += 1) deep = { type: "Stack", children: [deep] };
  const nested = checkDefs({ d: { root: deep } });
  assert.match(nested.join(" "), /nests more than 48 deep/, "a 6,000-deep root is a sentence, not a RangeError");

  assert.throws(() => expandTree(text("x"), JSON.parse('{"__proto__":{"root":{"type":"Text"}}}')), /not a name a template may have/);
});

test("a node copied out of a template cannot carry a prototype key across", () => {
  const nasty = JSON.parse('{"type":"Stack","__proto__":{"polluted":true},"children":[]}');
  const out = expandTree(nasty) as { node: Record<string, unknown> };
  assert.ok(!Object.prototype.hasOwnProperty.call(out.node, "__proto__"));
  assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
});
