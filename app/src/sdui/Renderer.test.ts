// node --test --experimental-strip-types src/sdui/Renderer.test.ts
//
// THE SAFETY FLOOR AS IT IS ACTUALLY WIRED (SPEC 5.2), not only as safetyCore decides it.
//
// The floor's promise is that a node that throws cannot take a screen down, and the only honest way to check that is
// to let a node throw inside the real RenderNode. So this transpiles Renderer.tsx, safety.ts, safetyCore.ts and
// knobs.ts with the repo's own TypeScript, stands react-native, the registry, the theme, the store and the actions in
// for themselves, and draws the result through react-reconciler (already here, for React's own tests). React is real,
// which is the point: the boundary is React's, and only React can say whether it holds.
//
// The two wirings that cannot be rendered in Node — the breadcrumb in ScreenHost and the handshake's fields — are
// checked as text at the end, so deleting either of them fails here rather than on a phone.
import test from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// THE KERNEL AND THE PURE GLUE ARE THE REAL ONES. They are free of React Native, so Node loads them as they
// are, and the transpiled files below reach them through this bridge rather than through a stand-in — which is
// the point: what is proved here is the real expression evaluator, the real template expansion and the real
// dependency tracking, wired into the real renderer.
import { NO_EXPRESSIONS, compileNode, kernelScope, resolveInto, scopeFor } from "./blocks/nodeCore.ts";
import { blocksForScreen, missingForScreen, screenNeeds, updateTree } from "./blocks/blocksCore.ts";
import { expandTree } from "./kernel/defs.ts";
import { KernelError } from "./kernel/expr.ts";
import { pathsTouch } from "./kernel/paths.ts";

/** What the stand-ins hand the transpiled modules in place of the real imports. */
const bridge = {
  NO_EXPRESSIONS, compileNode, kernelScope, resolveInto, scopeFor,
  blocksForScreen, missingForScreen, screenNeeds, updateTree,
  expandTree, KernelError, pathsTouch,
};
(globalThis as unknown as { __bridge: typeof bridge }).__bridge = bridge;

/** What the test says this client has, and what a node's scope reads. The stand-ins below read these. */
const world = {
  blocks: [] as string[],
  device: { perm: { mic: "granted" }, platform: "ios" } as Record<string, unknown>,
  local: { seen: true } as Record<string, unknown>,
  /** Which block each node type came from, as the real registry's map would say. */
  nodeBlock: { List: "list", Input: "input" } as Record<string, string>,
  /** Every call the renderer made to the rules hook, so the wiring can be checked. */
  rules: [] as Array<{ raw: unknown; on: boolean; visible: boolean }>,
  /** How many times the counting node drew. */
  draws: 0,
};
(globalThis as unknown as { __world: typeof world }).__world = world;

const require = createRequire(import.meta.url);
const APP = fileURLToPath(new URL("../../", import.meta.url));
const React = require("react") as typeof import("react");
const Reconciler = require("react-reconciler");
const { DefaultEventPriority } = require("react-reconciler/constants");
const ts = require("typescript");

/** Everything the four real files import that Node cannot load: react-native, Skia, MMKV, the theme, the store. */
const STUBS = `
const React = require(${JSON.stringify(join(APP, "node_modules/react"))});

// --- react-native
class Value { constructor(v) { this.v = v; } setValue(v) { this.v = v; } interpolate() { return this; } }
exports.Animated = {
  Value,
  timing: () => ({ start() {} }),
  // The style rides along so a test can read the opacity the FIRST frame was drawn with.
  View: ({ children, style }) => React.createElement("view", { style }, children),
};
exports.AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };

// --- theme, actions
exports.resolveStyle = (s, _theme, paint) => ({ ...(s ?? {}), ...(paint ? { __paint: 1 } : {}) });
exports.resolvePaintBlur = (s, paint) => (paint && s && s.blur ? { intensity: 20, tint: "light" } : null);
exports.BackdropBlur = ({ intensity }) => React.createElement("blur", { intensity });
exports.useTheme = () => ({});
exports.evalCondition = (c) => c === undefined || c !== false;
exports.runAction = async () => {};

// --- the kernel and the pure glue: the real ones, through the bridge
const B = globalThis.__bridge;
exports.NO_EXPRESSIONS = B.NO_EXPRESSIONS;
exports.compileNode = B.compileNode;
exports.kernelScope = B.kernelScope;
exports.resolveInto = B.resolveInto;
exports.scopeFor = B.scopeFor;
exports.pathsTouch = B.pathsTouch;
exports.expandTree = B.expandTree;
exports.KernelError = B.KernelError;
exports.blocksForScreen = B.blocksForScreen;
exports.missingForScreen = B.missingForScreen;
exports.screenNeeds = B.screenNeeds;
exports.updateTree = B.updateTree;

// --- where the roots come from on a phone (device facts, the phone's own values, the clock)
const W = globalThis.__world;
exports.baseScope = (ctx) => ({
  get state() { return ctx.store.snapshot(); },
  get device() { return W.device; },
  get local() { return W.local; },
  get ui() { return ctx.store.get("ui"); },
  get env() { return { locale: "en-US", now: Date.now() }; },
  text: (k) => k,
});
exports.useFactsWatch = () => {};
exports.watchFacts = () => () => {};
// The rules hook is checked as WIRING here (does the renderer drive a node's rules, and only while it is
// visible); what a rule actually does is rulesHost.test.ts, where the clock belongs to the test.
exports.useRules = (raw, _ctx, on, visible) => { if (raw !== undefined) W.rules.push({ raw, on, visible }); };
exports.blockForType = (type) => W.nodeBlock[type] ?? null;
exports.setupBlocks = () => W.blocks;
exports.clientBlocks = () => W.blocks;
exports.registeredBlocks = () => W.blocks;

// --- motion and gesture: the wrap, as the real ones do it (child untouched when the node asks for nothing)
exports.usesMotion = (n) => !!n?.motion && typeof n.motion === "object" && !n.motion.appear;
exports.wrapMotion = (n, child) => React.createElement("motion", null, child);
exports.usesGesture = (n) => Array.isArray(n?.gestures) && n.gestures.length > 0;
exports.wrapGesture = (n, child) => React.createElement("gesture", null, child);
exports.SharedOverlay = () => null;

// --- the hosts, the live socket and the shell: nothing this harness draws needs them
exports.StateMirror = class { value() { return null; } sync() {} stop() {} };
exports.makeMotionHost = () => ({});
exports.makeGestureHost = () => ({});
exports.makeShellHost = () => ({});
exports.makeSubscribeHost = () => ({});
exports.makeV3Host = () => ({});
exports.itemBool = () => false;
exports.bindSubscribeHost = () => {};
exports.subscribeHub = () => null;
exports.V3HostContext = React.createContext(null);

// --- the registry, with the three kinds of node a boundary has to survive
const Text = ({ props }) => {
  const v = props?.text ?? props?.content;
  // Only a value the server could have MEANT as text is drawn: an unresolved { $: … } object is nothing here.
  return React.createElement("text", null, typeof v === "string" || typeof v === "number" ? String(v) : "");
};
const Stack = ({ children }) => React.createElement("stack", null, children);
const Boom = () => { throw new Error("boom in render"); };
const Bang = () => { throw new Error("bang in render"); };
const HookBoom = () => { React.useEffect(() => { throw new Error("boom in effect"); }, []); return null; };
// Counts its own draws, so "re-renders only when a path it reads changes" can be measured.
const Counter = ({ props }) => { W.draws += 1; return React.createElement("text", null, String(props?.content ?? "")); };
const List = ({ props }) => React.createElement("list", null, String(props?.content ?? "list"));
exports.REGISTRY = { Text, Stack, Screen: Stack, Boom, Bang, HookBoom, Counter, List };

// --- storage: the synchronous crash-guard store (MMKV on a phone)
let guardRaw = null;
exports.readBootGuardSync = () => guardRaw;
exports.writeBootGuardSync = (raw) => { guardRaw = raw; };
exports.__seed = (raw) => { guardRaw = raw; };
exports.__guard = () => (guardRaw ? JSON.parse(guardRaw) : null);
`;

const SOURCES: Record<string, [string, Record<string, string>]> = {
  "renderer.cjs": ["src/sdui/Renderer.tsx", {
    "react-native": "./stubs.cjs",
    "./state": "./state.cjs",
    "./components": "./stubs.cjs",
    "./components/blur": "./stubs.cjs",
    "./theme/style": "./stubs.cjs",
    "./theme/ThemeContext": "./stubs.cjs",
    "./actions": "./stubs.cjs",
    "./knobs": "./knobs.cjs",
    "./safety": "./safety.cjs",
    "./motion": "./stubs.cjs",
    "./gesture": "./stubs.cjs",
    "./blocks/nodeCore.ts": "./stubs.cjs",
    "./blocks/scope": "./stubs.cjs",
    "./blocks/useRules": "./stubs.cjs",
    "./blocks/registry": "./stubs.cjs",
  }],
  // The real store, so dependency tracking is measured and not described.
  "state.cjs": ["src/sdui/state.ts", { "./kernel/paths.ts": "./stubs.cjs" }],
  // The gate, the templates and the hosts, for one screen.
  "screenTree.cjs": ["src/sdui/blocks/ScreenTree.tsx", {
    "../Renderer": "./renderer.cjs",
    "../actions": "./stubs.cjs",
    "../knobs": "./knobs.cjs",
    "../safety": "./safety.cjs",
    "./blocksCore.ts": "./stubs.cjs",
    "./registry": "./stubs.cjs",
    "./declared.ts": "./stubs.cjs",
    "./hosts": "./stubs.cjs",
    "./scope": "./stubs.cjs",
    "./useRules": "./stubs.cjs",
    "../components/v3Host": "./stubs.cjs",
    "../live/subscribe": "./stubs.cjs",
    "../kernel/defs.ts": "./stubs.cjs",
    "../kernel/index.ts": "./stubs.cjs",
  }],
  "safety.cjs": ["src/sdui/safety.ts", {
    "react-native": "./stubs.cjs",
    "./knobs": "./knobs.cjs",
    "../storage": "./stubs.cjs",
    "./safetyCore": "./safetyCore.cjs",
  }],
  "safetyCore.cjs": ["src/sdui/safetyCore.ts", {}],
  "knobs.cjs": ["src/sdui/knobs.ts", {}],
};

/**
 * One set of the real modules, freshly loaded.
 *
 * A fresh directory per build because safety.ts keeps this launch's state in module scope, and a rescue launch and
 * an ordinary one are two different launches — require would otherwise hand the second the first one's memory.
 */
function build(seed: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "b0-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stubs.cjs"), STUBS);
  for (const [out, [src, map]] of Object.entries(SOURCES)) {
    const code = readFileSync(join(APP, src), "utf8");
    let js = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: src,
    }).outputText as string;
    js = js.replace(/require\("([^"]+)"\)/g, (_m: string, spec: string) => {
      if (spec in map) return `require(${JSON.stringify(map[spec])})`;
      if (spec === "react" || spec === "react/jsx-runtime") return `require(${JSON.stringify(join(APP, "node_modules", spec))})`;
      throw new Error(`${src} imports ${spec}, which this harness does not stand in for`);
    });
    writeFileSync(join(dir, out), js);
  }
  const stubs = require(join(dir, "stubs.cjs"));
  if (seed !== null) stubs.__seed(seed);
  return {
    stubs,
    safety: require(join(dir, "safety.cjs")),
    Store: require(join(dir, "state.cjs")).Store as new (initial?: Record<string, unknown>) => never,
    RenderNode: require(join(dir, "renderer.cjs")).RenderNode as (p: unknown) => unknown,
    ScreenTree: require(join(dir, "screenTree.cjs")).ScreenTree as (p: unknown) => unknown,
  };
}

// --- the smallest host react-reconciler will accept: a tree of plain objects.
let prio = DefaultEventPriority;
const host = {
  supportsMutation: true, supportsPersistence: false, supportsHydration: false, isPrimaryRenderer: true,
  // The opacity is read HERE, while the first frame is being built, not after the effects have run.
  createInstance: (type: string, props: any) => ({ type, children: [] as unknown[], o: props?.style?.opacity?.v }),
  createTextInstance: (text: string) => ({ text }),
  appendInitialChild: (p: any, c: unknown) => p.children.push(c),
  appendChild: (p: any, c: unknown) => p.children.push(c),
  appendChildToContainer: (p: any, c: unknown) => p.children.push(c),
  insertBefore: (p: any, c: unknown, b: unknown) => p.children.splice(p.children.indexOf(b), 0, c),
  insertInContainerBefore: (p: any, c: unknown, b: unknown) => p.children.splice(p.children.indexOf(b), 0, c),
  removeChild: (p: any, c: unknown) => p.children.splice(p.children.indexOf(c), 1),
  removeChildFromContainer: (p: any, c: unknown) => p.children.splice(p.children.indexOf(c), 1),
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getRootHostContext: () => ({}), getChildHostContext: (c: unknown) => c,
  getPublicInstance: (i: unknown) => i,
  prepareForCommit: () => null, resetAfterCommit: () => {}, preparePortalMount: () => {},
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
  scheduleMicrotask: queueMicrotask, supportsMicrotasks: true,
  getCurrentUpdatePriority: () => prio, setCurrentUpdatePriority: (p: number) => { prio = p; },
  resolveUpdatePriority: () => prio,
  getCurrentEventPriority: () => DefaultEventPriority,
  commitUpdate: () => {}, commitTextUpdate: (t: any, _o: string, n: string) => { t.text = n; },
  resetTextContent: () => {}, clearContainer: (c: any) => { c.children = []; },
  hideInstance: () => {}, unhideInstance: () => {}, hideTextInstance: () => {}, unhideTextInstance: () => {},
  detachDeletedInstance: () => {}, getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {}, afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {}, getInstanceFromScope: () => null,
  maySuspendCommit: () => false, preloadInstance: () => true, startSuspendingCommit: () => {},
  suspendInstance: () => {}, waitForCommitToBeReady: () => null,
  NotPendingTransition: null, HostTransitionContext: React.createContext(null),
  resetFormInstance: () => {}, requestPostPaintCallback: () => {}, shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => {}, resolveEventType: () => null, resolveEventTimeStamp: () => -1.1,
};
const R = Reconciler(host);

/**
 * Draw one element and say what came out, plus anything React could not contain.
 *
 * `effects` false stops after the first frame is committed, which is the only way to see what a person's eye would
 * have seen before any useEffect ran.
 */
function render(el: unknown, effects = true): { out: string; uncaught: unknown[] } {
  const container = { children: [] as unknown[] };
  const uncaught: unknown[] = [];
  const root = R.createContainer(container, 0, null, false, null, "",
    (e: unknown) => uncaught.push(e), () => {}, () => {}, null);
  const warn = console.warn; const error = console.error;
  console.warn = () => {}; console.error = () => {};   // the floor logs each bad node, and React logs the throw
  try {
    R.updateContainerSync(el, root, null, null);
    R.flushSyncWork();
    if (effects) R.flushPassiveEffects();
  } finally {
    console.warn = warn; console.error = error;
  }
  return { out: dump(container), uncaught };
}
const dump = (n: any): string =>
  n.text !== undefined ? n.text
    : n.type === "text" ? n.children.map(dump).join("")
      : `${n.type ?? "root"}${n.o === undefined ? "" : `@${n.o}`}(${n.children.map(dump).join(",")})`;

// The renderer now watches the store itself (dependency tracking, SPEC 2.2), so even the vocab-1 tests need one
// that can be subscribed to. This is the smallest store that answers: the real one is used from `v2` below.
const CTX = {
  store: { get: () => undefined, set() {}, snapshot: () => ({}), subscribe: () => () => {} },
  actions: {}, flags: {}, labels: {}, nav: {}, toast() {},
};
const T = (text: string) => ({ type: "Text", props: { text } });

// ---------------------------------------------------------------------------
// The boundary. One launch, clean, drawing "home".

const app = build(null);
app.safety.noteScreen("home");
const draw = (node: unknown, ctx: unknown = CTX) => render(React.createElement(app.RenderNode as any, { node, ctx }));

test("a node that throws does not take its siblings, or the screen, with it", () => {
  const r = draw({ type: "Stack", children: [T("a"), { type: "Boom" }, T("c")] });
  assert.strictEqual(r.out, "root(stack(a,c))", "the throwing node is simply not there");
  assert.deepStrictEqual(r.uncaught, [], "and nothing escaped to the app's own boundary");
});

test("a throwing node draws its own fallback, when the server gave it one", () => {
  const r = draw({ type: "Stack", children: [T("a"), { type: "Boom", fallback: T("instead") }, T("c")] });
  assert.strictEqual(r.out, "root(stack(a,instead,c))");
});

test("a throw in a node's own hooks is caught too, not just one in what it draws", () => {
  const r = draw({ type: "Stack", children: [T("a"), { type: "HookBoom", fallback: T("fb") }] });
  assert.deepStrictEqual(r.uncaught, [], "an onAppear action that throws is still the node's business");
  assert.ok(r.out.includes("fb"), `the fallback stands in: ${r.out}`);
});

test("a fallback that throws as well is contained, and the screen still draws", () => {
  const r = draw({ type: "Stack", children: [{ type: "Boom", fallback: { type: "Boom", fallback: T("deep") } }, T("z")] });
  assert.strictEqual(r.out, "root(stack(deep,z))");
  assert.deepStrictEqual(r.uncaught, []);
});

test("the handshake names the bad node once per type and screen, and nothing about the person", () => {
  draw({ type: "Boom" });
  draw({ type: "Boom" });   // it throws on every render; it is news once
  const report = app.safety.safetyReport();
  assert.strictEqual(report.safe, 1, "the build says it has the floor");
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.bad.filter((l: string) => l === "Boom:home").length, 1);
  assert.ok(JSON.stringify(report).length <= 512, "anim §3.9");
});

test("a node with nowhere to fall back tells the ctx, which is how the sign-in screen gets its way in back", () => {
  // The gate's own shape: the server's tree inside a boundary that drops to the app's native screen.
  const seen: string[] = [];
  class Gate extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? React.createElement("native-signin", null) : this.props.children; }
  }
  const ctx = { ...CTX, onNodeError: (type: string) => { seen.push(type); } };

  const tree = { type: "Screen", children: [T("title"), { type: "Bang" }] };
  const r = render(React.createElement(Gate, null, React.createElement(app.RenderNode as any, { node: tree, ctx })));
  // The per-node boundary catches first, so the gate's own never fires — this call is the only thing left that can
  // tell it. Without it the sign-in screen draws its title and no way in at all.
  assert.deepStrictEqual(seen, ["Bang"]);
  assert.strictEqual(r.out, "root(stack(title))", "and it is the gate, not the renderer, that decides what now");

  // A node the server gave a fallback is the server's own answer, and the gate is not told.
  seen.length = 0;
  draw({ type: "Stack", children: [{ type: "Bang", fallback: T("ok") }] }, ctx);
  assert.deepStrictEqual(seen, []);
});

test("with motion on, a node that appears starts at nothing and is animated in", () => {
  const r = render(React.createElement(app.RenderNode as any, {
    node: { ...T("a"), motion: { appear: "fadeInUp" } }, ctx: CTX,
  }), false);
  assert.strictEqual(r.out, "root(view@0(a))", "the first frame is the start of the entrance");
});

test("with motion off, a node that appears is simply there, from the very first frame", () => {
  // A rescue launch forces motion off. Starting at 0 and setting 1 in an effect means one frame of nothing, in the
  // one mode whose whole promise is that nothing moves and nothing flashes.
  const still = build(JSON.stringify({ open: true, screen: "plan", loopScreen: "plan", crashes: 1, off: [] }));
  assert.strictEqual(still.safety.motionMode(), "off");
  const r = render(React.createElement(still.RenderNode as any, {
    node: { ...T("a"), motion: { appear: "fadeInUp" } }, ctx: CTX,
  }), false);
  assert.strictEqual(r.out, "root(view@1(a))", "there, at the end of its entrance, before any effect runs");
});

// ---------------------------------------------------------------------------
// The crash-loop guard and the kill switches, through the real wiring.

test("a screen is written down as it draws, synchronously, so it survives what happens next", () => {
  const fresh = build(null);
  fresh.safety.noteScreen("plan");
  const kept = fresh.stubs.__guard();
  assert.strictEqual(kept.open, true, "the record is open while the screen draws");
  assert.strictEqual(kept.screen, "plan");
  fresh.safety.markClean();
  assert.strictEqual(fresh.stubs.__guard().open, false, "and closed once the launch has plainly stayed up");
});

test("two launches killed on one screen: a rescue launch, that screen off, and the server told", () => {
  // What the second crash left on disk: open, on "plan", with one crash already counted against it.
  const rescue = build(JSON.stringify({ open: true, screen: "plan", loopScreen: "plan", crashes: 1, off: [] }));
  assert.strictEqual(rescue.safety.safeMode(), true);
  assert.strictEqual(rescue.safety.screenOff("plan"), true, "the screen that did it does not draw");
  assert.strictEqual(rescue.safety.screenOff("home"), false, "the rest of the app does");
  assert.deepStrictEqual(rescue.safety.deviceOff(), ["plan"], "and the handshake says what this device turned off");
  assert.strictEqual(rescue.safety.safetyReport().why, "loop:plan");
  assert.strictEqual(rescue.safety.lastBootNote(), "died=plan loop:plan");
  // Safe mode is vocab-1 only, so a type from a newer vocabulary draws its fallback instead.
  assert.strictEqual(rescue.safety.nodeOff("List"), true);
  assert.strictEqual(rescue.safety.nodeOff("Text"), false);
  assert.strictEqual(rescue.safety.motionMode(), "off");
  assert.strictEqual(rescue.safety.gesturesOn(), false);
  assert.strictEqual(rescue.safety.rulesOn(), false);
});

test("a type the floor switched off draws its fallback, the same answer a type this build never had gets", () => {
  const rescue = build(JSON.stringify({ open: true, screen: "plan", loopScreen: "plan", crashes: 1, off: [] }));
  const el = React.createElement(rescue.RenderNode as any, {
    // "Boom" is in this harness's registry but not in vocab 1, so the rescue treats it as unknown — and never
    // calls it, which is the whole point: a node that cannot throw cannot take the launch down again.
    node: { type: "Stack", children: [T("a"), { type: "Boom", fallback: T("instead") }] },
    ctx: CTX,
  });
  assert.strictEqual(render(el).out, "root(stack(a,instead))");
});

// ---------------------------------------------------------------------------
// The two wirings Node cannot draw.

test("ScreenHost writes the breadcrumb before it draws, and refuses a screen the floor turned off", () => {
  const src = readFileSync(new URL("./shell/ScreenHost.tsx", import.meta.url), "utf8");
  assert.match(src, /noteScreen\(screen\.screenId\)/, "the crumb is written for the screen about to draw");
  assert.match(src, /if \(screenOff\(screen\.screenId\)\)/, "and a screen on the off list draws its fallback");
  assert.ok(
    src.indexOf("noteScreen(") < src.indexOf("<RenderNode"),
    "the crumb has to be written before the tree draws, not in an effect after it",
  );
});

test("the handshake declares the floor, and what this device turned off for itself", () => {
  const src = readFileSync(new URL("./client/capabilities.ts", import.meta.url), "utf8");
  assert.match(src, /sdui: safetyReport\(\)/, "SPEC 2.11: `sdui`, with `safe: 1` inside it");
  assert.match(src, /off: deviceOff\(\)/, "SPEC 2.11: only what the device switched off, never what was never built");
});

// ---------------------------------------------------------------------------
// VOCAB 2, THROUGH THE REAL RENDERER (pure/SPEC.md 2.2, 2.3, 2.4, 2.12).
//
// The kernel is the real one and so is the store, so what is measured here is the wiring: which blocks a screen
// is given, what a prop comes to, what a person's own words come to, and how little re-renders.

/** A fresh build with a real store, and `blocks` live for the screen being drawn. */
function v2(blocks: string[], state: Record<string, unknown> = {}) {
  world.blocks = blocks;
  world.rules = [];
  world.draws = 0;
  const app2 = build(null);
  app2.safety.noteScreen("v2");
  const store = new app2.Store(state) as unknown as {
    get(p: string): unknown; set(p: string, v: unknown): void; snapshot(): Record<string, unknown>;
  };
  const ctx = { ...CTX, store, blocks, screenId: "v2" };
  return { app: app2, store, ctx, draw: (node: unknown, scope?: unknown) => render(React.createElement(app2.RenderNode as any, { node, ctx, scope })) };
}

test("a $ value and a $t text are worked out before they reach the component", () => {
  const { draw } = v2(["expr"], { items: [1, 2, 3], total: 4, busy: true });
  const r = draw({
    type: "Text",
    props: { content: { $t: "{{ count(state.items) }} of {{ state.total }} done" } },
    style: { opacity: { $: "state.busy ? 0.4 : 1" } },
  });
  assert.strictEqual(r.out, "root(3 of 4 done)");
});

test("a note's own title is drawn as written, even when it looks exactly like a template", () => {
  const { draw } = v2(["expr"], { secret: "shh" });
  // The same characters a `$t` would be written with, as a bare string: the server puts people's words here.
  const r = draw({ type: "Text", props: { content: "{{ state.secret }} is mine" } });
  assert.strictEqual(r.out, "root({{ state.secret }} is mine)", "SPEC 2.2 principle 4");
});

test("a screen that did not ask for `expr` gets no expressions at all", () => {
  const { draw } = v2([], { who: "Blip" });
  const r = draw({ type: "Text", props: { content: { $: "state.who" } } });
  assert.strictEqual(r.out, "root()", "the object is not a string, and it is certainly not evaluated");
});

test("a node re-renders when a path it reads changes, and not when anything else does", () => {
  const { store, draw } = v2(["expr"], { a: "one", b: "x" });
  draw({ type: "Counter", props: { content: { $: "state.a" } } });
  const first = world.draws;
  R.flushSyncFromReconciler(() => store.set("b", "y"));
  assert.strictEqual(world.draws, first, "a write it does not read costs it nothing");
  R.flushSyncFromReconciler(() => store.set("a", "two"));
  assert.ok(world.draws > first, "a write it does read draws it again");
});

test("`visibleIf: { expr }` hides and shows, and an expression it cannot work out hides", () => {
  const { draw } = v2(["expr"], { ready: false });
  assert.strictEqual(draw({ type: "Text", props: { content: "hi" }, visibleIf: { expr: "state.ready" } }).out, "root()");
  const { draw: draw2 } = v2(["expr"], { ready: true });
  assert.strictEqual(draw2({ type: "Text", props: { content: "hi" }, visibleIf: { expr: "state.ready" } }).out, "root(hi)");
});

test("Use and Slot expand, and a row reads its own arguments", () => {
  const { ctx, app: appV } = v2(["expr", "defs"], { rows: [{ name: "Blip" }] });
  // The kernel expands the screen once; the renderer then works the arguments out per node.
  const expanded = expandTree(
    { type: "Stack", children: [{ type: "Use", def: "row", args: { bot: { $: "state.rows[0]" } }, slots: { trail: { type: "Text", props: { content: "›" } } } }] },
    { row: { params: ["bot"], root: { type: "Stack", children: [{ type: "Text", props: { content: { $: "args.bot.name" } } }, { type: "Slot", name: "trail" }] } } },
  );
  const r = render(React.createElement(appV.RenderNode as any, { node: expanded.node, ctx }));
  assert.strictEqual(r.out, "root(stack(stack(Blip,›)))");
});

test("a node's rules are driven, and only while the node is on screen", () => {
  const { draw } = v2(["expr", "rules"], { ready: false });
  const rules = [{ id: "go", when: { expr: "state.ready" }, do: { kind: "navigate" } }];
  draw({ type: "Text", props: { content: "hi" }, rules, visibleIf: { expr: "state.ready" } });
  const call = world.rules.at(-1)!;
  assert.strictEqual(call.on, true, "the screen asked for `rules` and the floor allows them");
  assert.strictEqual(call.visible, false, "the node is hidden, so its rules are not live");
  // And a screen that did not ask for the block gets them switched off.
  const off = v2(["expr"], {});
  off.draw({ type: "Text", props: { content: "hi" }, rules });
  assert.strictEqual(world.rules.at(-1)!.on, false);
});

test("gesture outside, motion inside, and neither when the screen did not ask", () => {
  const node = { type: "Text", props: { content: "x" }, motion: { opacity: { k: [[0, 0]] } }, gestures: [{ kind: "tap" }] };
  assert.strictEqual(v2(["expr", "motion", "gesture"]).draw(node).out, "root(gesture(motion(x)))");
  assert.strictEqual(v2(["expr", "motion"]).draw(node).out, "root(motion(x))", "no gesture block, no detector");
  assert.strictEqual(v2(["expr"]).draw(node).out, "root(x)", "and a screen that asked for neither pays nothing");
});

test("paint is let through, and its backdrop blur drawn, only for a screen that asked", () => {
  const node = { type: "Stack", style: { blur: 20 }, children: [{ type: "Text", props: { content: "a" } }] };
  assert.strictEqual(v2(["paint"]).draw(node).out, "root(stack(blur(),a))", "the blur sits under the children");
  assert.strictEqual(v2([]).draw(node).out, "root(stack(a))");
});

test("a node type that belongs to a block the screen did not ask for draws its fallback", () => {
  const node = { type: "List", props: { content: "rows" }, fallback: { type: "Text", props: { content: "instead" } } };
  assert.strictEqual(v2(["list"]).draw(node).out, "root(list(rows))", "asked for, and drawn");
  assert.strictEqual(v2(["expr"]).draw(node).out, "root(instead)", "not asked for: the server's own answer");
});

// --- the gate, one screen at a time

function screen(blocks: string[], s: Record<string, unknown>) {
  const made = v2(blocks, (s.state as Record<string, unknown>) ?? {});
  return render(React.createElement(made.app.ScreenTree as any, { screen: s, ctx: made.ctx }));
}

test("a screen needing a block this client lacks draws the server's fallback, never half of itself", () => {
  const out = screen(["expr"], {
    screenId: "pay", needs: ["expr", "gesture"],
    root: { type: "Stack", children: [{ type: "Text", props: { content: "slide to pay" } }], fallback: { type: "Text", props: { content: "server says: update" } } },
  }).out;
  assert.strictEqual(out, "root(server says: update)");
});

test("…and the player's own card when the server gave no fallback, naming the block", () => {
  const out = screen(["expr"], {
    screenId: "pay", needs: ["gesture"],
    root: { type: "Stack", children: [{ type: "Text", props: { content: "slide to pay" } }] },
  }).out;
  assert.match(out, /stack\(.*gesture\)/, `the card says which block is missing: ${out}`);
  assert.ok(!out.includes("slide to pay"), "and nothing of the screen itself");
});

test("a screen with no `needs` draws exactly as it always did", () => {
  const out = screen(["expr", "list"], {
    screenId: "home",
    root: { type: "Stack", children: [{ type: "Text", props: { content: "home" } }] },
  }).out;
  assert.strictEqual(out, "root(stack(home))");
});

test("under sdui.safe every block is off, so a screen that needs one gets the update card", () => {
  // Safe mode is the device's own answer; `clientBlocks` takes the floor off whatever registered.
  world.blocks = [];
  const safe = build(JSON.stringify({ open: true, screen: "pay", loopScreen: "pay", crashes: 1, off: [] }));
  assert.strictEqual(safe.safety.safeMode(), true);
  const store = new safe.Store({}) as unknown as { get(p: string): unknown };
  const out = render(React.createElement(safe.ScreenTree as any, {
    screen: { screenId: "feed", needs: ["list"], root: { type: "Stack", children: [{ type: "Text", props: { content: "rows" } }], fallback: { type: "Text", props: { content: "frozen" } } } },
    ctx: { ...CTX, store, blocks: [], screenId: "feed" },
  })).out;
  assert.strictEqual(out, "root(frozen)");
});
