// node --test --experimental-strip-types src/sdui/blocks/nodeCore.test.ts
//
// ONE NODE: what its props come to, what it reads, and the two things that must never happen — a person's own
// words being evaluated, and a node re-rendering for a write it does not care about.
import test from "node:test";
import assert from "node:assert";
import {
  ScreenBudget, compileNode, kernelScope, nodeReads, resolveActionRef, resolveInto, scopeFor, type BaseScope,
} from "./nodeCore.ts";
import { LIMITS } from "../kernel/limits.ts";
import { ARGS_KEY, ARGS_UP_KEY } from "../kernel/defs.ts";

const base = (state: unknown, extra: Partial<BaseScope> = {}): BaseScope => ({
  state, device: { perm: { mic: "granted" } }, local: { seen: true },
  env: { locale: "en-US", now: 1_700_000_000_000 }, text: (k) => k, ...extra,
});

test("a $ value and a $t text are worked out; a bare string is handed back untouched", () => {
  const node = {
    type: "Text",
    props: {
      content: { $t: "{{ count(state.items) }} of {{ state.total }} done" },
      opacity: { $: "state.busy ? 0.4 : 1" },
      // A note's own title. It LOOKS like a template, which is exactly the point.
      title: "{{ state.secret }} is mine",
    },
  };
  const c = compileNode(node);
  const props: Record<string, unknown> = { ...node.props };
  resolveInto(props, c.props, kernelScope(base({ items: [1, 2, 3], total: 4, busy: true, secret: "shh" }), undefined));
  assert.strictEqual(props.content, "3 of 4 done");
  assert.strictEqual(props.opacity, 0.4);
  assert.strictEqual(props.title, "{{ state.secret }} is mine", "user text is never a template (SPEC 2.2)");
});

test("what a node reads is what re-renders it, and nothing else", () => {
  const c = compileNode({ type: "Text", props: { content: { $: "state.a.b + local.seen" } } });
  assert.deepStrictEqual([...c.deps], ["local.seen", "state.a.b"]);
  assert.strictEqual(nodeReads(c.deps, "state.a.b"), true);
  assert.strictEqual(nodeReads(c.deps, "state.a"), true, "a write to the parent changes what it reads");
  assert.strictEqual(nodeReads(c.deps, "state.a.b.c"), true, "and so does one underneath it");
  assert.strictEqual(nodeReads(c.deps, "state.other"), false, "a write anywhere else costs this node nothing");
});

test("a node with no expressions compiles to nothing at all, so it keeps today's behaviour", () => {
  const c = compileNode({ type: "Stack", props: { gap: 8 }, style: { padding: 12 } });
  assert.strictEqual(c.live, false);
  assert.deepStrictEqual([...c.deps], []);
});

test("compiling is cached on the node, so a screen's tree compiles once and not once a frame", () => {
  const node = { type: "Text", props: { content: { $: "state.x" } } };
  assert.strictEqual(compileNode(node), compileNode(node));
});

test("a value that cannot be worked out leaves what the server wrote, and says so", () => {
  const node = { type: "Text", props: { content: { $: "state.x" }, n: { $: "1 +" } } };
  const c = compileNode(node);
  assert.strictEqual(c.errors.length, 1, "the broken one is reported at compile");
  assert.match(c.errors[0]!, /^props\.n:/);
  const props: Record<string, unknown> = { ...node.props };
  resolveInto(props, c.props, kernelScope(base({ x: "ok" }), undefined));
  assert.strictEqual(props.content, "ok", "the other prop is unharmed");
});

test("a template's arguments become the scope its children are drawn in", () => {
  // What the kernel's expansion leaves behind: the template's root carries the caller's arguments.
  const made = { type: "Stack", [ARGS_KEY]: [{ bot: { $: "item" }, n: 2 }] };
  const c = compileNode(made);
  const scope = scopeFor(c, base({}), { item: { name: "Blip" }, index: 0 });
  assert.deepStrictEqual(scope?.argsStack, [{ bot: { name: "Blip" }, n: 2 }]);
  // And a child of it reads `args.bot.name`.
  const child = compileNode({ type: "Text", props: { content: { $: "args.bot.name" } } });
  const props: Record<string, unknown> = {};
  resolveInto(props, child.props, kernelScope(base({}), scope));
  assert.strictEqual(props.content, "Blip");
});

test("slot content reads the scope where it was written, not where it landed", () => {
  // The caller's frame, then the template's; `$argsUp: 1` steps back past the template's.
  const outer = scopeFor(compileNode({ type: "S", [ARGS_KEY]: [{ who: "caller" }] }), base({}), undefined);
  const inner = scopeFor(compileNode({ type: "S", [ARGS_KEY]: [{ who: "template" }] }), base({}), outer);
  assert.deepStrictEqual(inner?.argsStack, [{ who: "caller" }, { who: "template" }]);
  const slot = scopeFor(compileNode({ type: "Text", [ARGS_UP_KEY]: 1 }), base({}), inner);
  assert.deepStrictEqual(slot?.argsStack, [{ who: "caller" }], "one frame back: the caller's");
});

test("every root the kernel names is filled in, including where a gesture ended", () => {
  const c = compileNode({
    type: "Text",
    props: { a: { $: "device.perm.mic" }, b: { $: "local.seen" }, d: { $: "index" }, e: { $: "ui.pill.x" } },
  });
  const props: Record<string, unknown> = {};
  const scope = kernelScope(base({ ui: { pill: { x: 42 } } }), { index: 7 });
  // `ui` is its own root, written by the gesture block into the store under `ui.*`.
  resolveInto(props, c.props, { ...scope, ui: { pill: { x: 42 } } });
  assert.strictEqual(props.a, "granted");
  assert.strictEqual(props.b, true);
  assert.strictEqual(props.d, 7);
  assert.strictEqual(props.e, 42);
});

// ---------------------------------------------------------------------------
// WHAT HAPPENS WHEN AN EXPRESSION DOES NOT WORK (pure/SPEC.md 2.2, 5.1).

test("an expression that will not compile leaves NOTHING in the prop, and says so", () => {
  const c = compileNode({ type: "Text", props: { content: { $: "state.(" }, keep: "as written" } });
  assert.ok(c.errors.length > 0, "the handshake has something to say");
  const props: Record<string, unknown> = { content: { $: "state.(" }, keep: "as written" };
  resolveInto(props, c.props, kernelScope(base({}), undefined));
  assert.strictEqual(props.content, undefined, "never the { $ } object: a component would be asked to draw it");
  assert.strictEqual(props.keep, "as written", "and the props that were never expressions are untouched");
});

test("an expression that throws while running leaves nothing either", () => {
  // 8 KB is the cap on one built string (SPEC 5.1), so this one is refused as it runs, not as it compiles.
  const c = compileNode({ type: "Text", props: { content: { $t: "{{ state.big }}" } } });
  assert.strictEqual(c.errors.length, 0, "it compiles: only running it is too much");
  const said: string[] = [];
  const props: Record<string, unknown> = {};
  resolveInto(props, c.props, kernelScope(base({ big: "x".repeat(9000) }), undefined), (w) => said.push(w));
  assert.strictEqual(props.content, undefined);
  assert.ok(said.length > 0, "and the server hears about it");
});

test("a node that reads the clock says so, so the renderer knows to tick", () => {
  assert.strictEqual(compileNode({ type: "Text", props: { c: { $t: "{{ fmt.elapsed(state.t) }}" } } }).time, true);
  assert.strictEqual(compileNode({ type: "Text", props: { c: { $: "now()" } } }).time, true);
  assert.strictEqual(compileNode({ type: "Text", props: { c: { $: "state.t" } } }).time, false);
});

test("bind by expression is compiled as a VALUE; a bare string in bind stays a dot-path", () => {
  const c = compileNode({ type: "Text", bind: { content: { $: "state.who" }, other: "some.path" } });
  assert.deepStrictEqual(c.binds.map(([k]) => k), ["content"], "only the evaluable one");
  assert.ok(c.deps.includes("state.who"));
  const out = resolveInto({}, c.binds, kernelScope(base({ who: "Blip" }), undefined));
  assert.strictEqual(out.content, "Blip");
});

test("a List's row-scoped props are left for the row, not worked out at the List", () => {
  const list = compileNode({
    type: "List",
    props: { data: { $: "state.feed" }, sticky: { $: "item.kind == 'day'" }, item: { type: "Use", def: "row" } },
  });
  assert.deepStrictEqual(list.props.map(([k]) => k), ["data"], "sticky and item never reach the List itself");
  const each = compileNode({ type: "Each", props: { data: { $: "state.rows" }, item: { type: "Use", def: "row" } } });
  assert.deepStrictEqual(each.props.map(([k]) => k), ["data"]);
  // Any other node keeps both: they are only row-scoped on a list.
  const plain = compileNode({ type: "Stack", props: { sticky: { $: "1 == 1" } } });
  assert.deepStrictEqual(plain.props.map(([k]) => k), ["sticky"]);
});

test("a screen may compile only so many expressions, and spend only so much per change", () => {
  const budget = new ScreenBudget();
  // Past the per-screen cap the prop is nothing, with a reason — not the object the server wrote.
  for (let i = 0; i < LIMITS.exprPerScreen; i += 1) {
    assert.strictEqual(compileNode({ type: "Text", props: { c: { $: `${i}` } } }, budget).errors.length, 0);
  }
  const over = compileNode({ type: "Text", props: { c: { $: "1" } } }, budget);
  assert.ok(over.errors[0]?.includes("more than"), over.errors.join());
  const props: Record<string, unknown> = { c: { $: "1" } };
  resolveInto(props, over.props, kernelScope(base({}), undefined));
  assert.strictEqual(props.c, undefined);

  // And the ops: counted per change of the store, and started again by the next one.
  const b2 = new ScreenBudget();
  assert.strictEqual(b2.spend(1, LIMITS.opsPerChange), true);
  assert.strictEqual(b2.spend(1, 1), false, "that change has had its 20,000");
  assert.strictEqual(b2.firstRefusal(), true);
  assert.strictEqual(b2.firstRefusal(), false, "said once, not twenty thousand times");
  assert.strictEqual(b2.spend(2, 1), true, "the next change starts again");
});

test("a row's action can be the one its caller handed in ($ref), and cannot point at itself", () => {
  const open = { kind: "navigate", screenId: "note" };
  const scope = kernelScope(base({}), { item: { id: 1 }, argsStack: [{ onOpen: open }] });
  assert.strictEqual(resolveActionRef({ $ref: "args.onOpen" }, scope), open);
  assert.deepStrictEqual(resolveActionRef({ $ref: "item.id" }, scope), 1);
  assert.strictEqual(resolveActionRef({ $ref: "args.nothing" }, scope), undefined);
  assert.strictEqual(resolveActionRef({ $ref: "state.sneaky" }, scope), undefined, "only args and item");
  // A ref that points at another ref is followed, but not for ever.
  const loop: Record<string, unknown> = { $ref: "args.a" };
  const deep = kernelScope(base({}), { argsStack: [{ a: loop }] });
  assert.strictEqual(resolveActionRef(loop, deep), undefined);
  // An ordinary action is handed straight back.
  assert.strictEqual(resolveActionRef(open, scope), open);
});
