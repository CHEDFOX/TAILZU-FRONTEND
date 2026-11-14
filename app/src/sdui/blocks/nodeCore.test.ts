// node --test --experimental-strip-types src/sdui/blocks/nodeCore.test.ts
//
// ONE NODE: what its props come to, what it reads, and the two things that must never happen — a person's own
// words being evaluated, and a node re-rendering for a write it does not care about.
import test from "node:test";
import assert from "node:assert";
import { compileNode, kernelScope, nodeReads, resolveInto, scopeFor, type BaseScope } from "./nodeCore.ts";
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
