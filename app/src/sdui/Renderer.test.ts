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

// --- state, theme, actions
exports.useStoreVersion = () => {};
exports.resolveStyle = (s) => s;
exports.useTheme = () => ({});
exports.evalCondition = (c) => c === undefined || c !== false;
exports.runAction = async () => {};

// --- the registry, with the three kinds of node a boundary has to survive
const Text = ({ props }) => React.createElement("text", null, String(props?.text ?? ""));
const Stack = ({ children }) => React.createElement("stack", null, children);
const Boom = () => { throw new Error("boom in render"); };
const Bang = () => { throw new Error("bang in render"); };
const HookBoom = () => { React.useEffect(() => { throw new Error("boom in effect"); }, []); return null; };
exports.REGISTRY = { Text, Stack, Screen: Stack, Boom, Bang, HookBoom };

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
    "./state": "./stubs.cjs",
    "./components": "./stubs.cjs",
    "./theme/style": "./stubs.cjs",
    "./theme/ThemeContext": "./stubs.cjs",
    "./actions": "./stubs.cjs",
    "./knobs": "./knobs.cjs",
    "./safety": "./safety.cjs",
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
    RenderNode: require(join(dir, "renderer.cjs")).RenderNode as (p: unknown) => unknown,
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

const CTX = { store: {}, actions: {}, flags: {}, labels: {}, nav: {}, toast() {} };
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
