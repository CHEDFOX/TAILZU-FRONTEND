/**
 * The renderer — walks a Node tree and draws it via the component registry,
 * resolving data bindings, visibility, events, and entry motion.
 *
 * VOCAB 2 (pure/SPEC.md 2.2-2.12) rides on top of all of that, and only for a screen that asked for it:
 *   - `{ "$": … }` values and `{ "$t": … }` texts are worked out by the kernel before a prop reaches a component,
 *     against a scope of state, device, local, item, index, args and ui. A bare string is never touched.
 *   - a node that uses one re-renders only when a path it reads changes; every other node keeps today's
 *     behaviour, a re-render on any store write.
 *   - `motion` and `gestures` wrap what the node drew (gesture outside, motion inside, so a scale never moves the
 *     box that takes the finger); `paint` lets the style keys through and draws a backdrop blur.
 *   - a node's own `rules` run while it is visible.
 * None of it costs a screen that states no `needs`: `ctx.blocks` is empty and every branch below is skipped.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState } from "react-native";
import type { MotionSpec, Node, NodeEvent } from "./types";
import { useStoreWatch } from "./state";
import { REGISTRY } from "./components";
import type { CompProps } from "./components/props";
import { resolveStyle, resolvePaintBlur } from "./theme/style";
import { BackdropBlur } from "./components/blur";
import { useTheme } from "./theme/ThemeContext";
import { Ctx, evalCondition, runAction } from "./actions";
import { num, str } from "./knobs";
import { gesturesOn, motionMode, nodeOff, noteBadNode, rulesOn } from "./safety";
import { usesMotion, wrapMotion, type MotionHost } from "./motion";
import { usesGesture, wrapGesture, type GestureHost } from "./gesture";
import {
  NO_EXPRESSIONS, compileNode, kernelScope, resolveActionRef, resolveInto, scopeFor,
  type OpsGuard, type RenderScope, type ScreenBudget,
} from "./blocks/nodeCore.ts";
import { baseScope, useFactsWatch } from "./blocks/scope";
import { useRules } from "./blocks/useRules";
import { blockForType } from "./blocks/registry";

// Conditions a style value can carry (a subset of the SDUI Condition keys).
const STYLE_COND_KEYS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains",
  "startsWith", "endsWith", "truthy", "falsy", "flag", "entitled", "platform",
  "not", "all", "any"] as const;

/**
 * Resolve state-conditional style VALUES: a value shaped
 * `{ <condition>, then, else }` becomes `then` or `else` based on the condition
 * (evaluated live against state, so it re-resolves on every re-render). Lets the
 * backend style a node by state — e.g. a selected plan card's border — which the
 * paywall relies on. Values without a condition shape pass through untouched.
 */
function resolveStyleConditionals(
  style: Record<string, any> | undefined,
  ctx: Ctx,
): Record<string, any> | undefined {
  if (!style) return style;
  let out: Record<string, any> | null = null;
  for (const k of Object.keys(style)) {
    const v = style[k];
    if (
      v && typeof v === "object" && !Array.isArray(v) &&
      ("then" in v || "else" in v) &&
      STYLE_COND_KEYS.some((c) => c in v)
    ) {
      if (!out) out = { ...style };
      out[k] = evalCondition(v as any, ctx) ? v.then : v.else;
    }
  }
  return out ?? style;
}

/**
 * ONE BOUNDARY PER NODE — the safety floor's first piece (safety.ts, SPEC 5.2).
 *
 * Until this, the nearest boundary to a server-described node was the one at the root of the app: a single node that
 * threw — a bad prop, a value the component did not expect, anything the server got wrong about one row of one card
 * — unwound past everything else and left the person looking at the apology screen with no way on. One node, the
 * whole app.
 *
 * Now a throw stops at the node. It draws that node's own `fallback` if the server gave it one, nothing if not, and
 * its siblings and the rest of the screen draw as though nothing happened. The type and the screen go back on the
 * next handshake (`bad: <type>:<screen>`), so the server learns what the person never had to see.
 *
 * It does NOT try again by itself. A node that throws throws on every render, so retrying in place is a loop; the
 * fallback stands until the screen is left and come back to.
 *
 * ONE SCREEN NEEDS MORE THAN NOTHING. Catching here means an outer boundary never fires, and the sign-in gate had
 * one: a tree that threw used to drop to the app's own sign-in screen, because a bad tree should cost someone the
 * look and never the way in. A node that throws with no `fallback` therefore also tells the ctx (`onNodeError`), and
 * the gate is the only place that passes one. Everywhere else it is absent and nothing changes.
 */
class NodeBoundary extends React.Component<
  { node: Node; ctx: Ctx; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Reporting must never become the next error.
    const type = this.props.node?.type ?? "?";
    try { noteBadNode(type, error); } catch { /* ignore */ }
    if (!this.props.node?.fallback) {
      try { this.props.ctx?.onNodeError?.(type, error); } catch { /* ignore */ }
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const fb = this.props.node?.fallback;
    return fb ? <RenderNode node={fb} ctx={this.props.ctx} /> : null;
  }
}

/**
 * A node and everything under it, inside its own boundary.
 *
 * MEMOISED, WHICH IS WHAT MAKES THE DEPENDENCY TRACKING REAL (SPEC 2.2). Every node used to be redrawn by its
 * parent, and every real screen's root is a Screen or a Stack with no expression on it — so that root subscribed
 * to every write, redrew, and took the whole tree with it. The tracking was measurable only on a node drawn at
 * the root, which is not where nodes live. With this, a parent's redraw stops at a child whose `node`, `ctx` and
 * `scope` are the same objects, and a live child is redrawn by its own subscription instead. A vocab-1 node still
 * has a subscription with no paths (today's behaviour), so nothing that worked before becomes quieter.
 */
export const RenderNode = React.memo(function RenderNode(
  { node, ctx, scope }: { node: Node; ctx: Ctx; scope?: RenderScope },
) {
  // The boundary wraps the BODY rather than sitting inside it, so a throw in the body's own hooks — an onAppear
  // action, a style the theme cannot resolve — is caught too, not just one in the component it draws.
  return (
    <NodeBoundary node={node} ctx={ctx}>
      <RenderNodeBody node={node} ctx={ctx} scope={scope} />
    </NodeBoundary>
  );
});

/** True when this block is live on the screen being drawn. Empty `blocks` is a vocab-1 screen: nothing is live. */
const on = (ctx: Ctx, block: string): boolean => !!ctx.blocks && ctx.blocks.includes(block);

/**
 * COMPONENTS WHOSE WHOLE ANSWER IS THEIR PROPS.
 *
 * A node may be redrawn only when a path it reads changes ONLY if everything about what it draws is in the props
 * this render worked out. These are the ones that hold nothing else: no `store`, no `ctx`, no condition of their
 * own. Every other type — `MentionField`, `VoiceButton`, `BotCard`, `Vanish`, the inputs, a `List` reading its
 * own cursor — reads the store while it draws, so it keeps today's subscription (every write) and nothing of
 * theirs becomes quieter. SPEC 2.2: "nothing that works today changes."
 */
const PURE_PROPS: ReadonlySet<string> = new Set([
  "Text", "Stack", "Grid", "SafeArea", "SVG", "Image", "Button", "Scroll",
  "Each", "Rise", "MorphOut", "PersonBot", "BlipSpot",
]);

/** True when a style holds a value that is decided by a condition, which is read live and not through deps. */
function hasStyleConditional(style: Record<string, any> | undefined): boolean {
  if (!style) return false;
  for (const k of Object.keys(style)) {
    const v = style[k];
    if (v && typeof v === "object" && !Array.isArray(v) && ("then" in v || "else" in v)
      && STYLE_COND_KEYS.some((c) => c in v)) return true;
  }
  return false;
}

/**
 * Every path this node reads — or null, which means "redraw on any write", today's behaviour for every node.
 *
 * A deps list is a promise that NOTHING ELSE this node draws can change behind it. Three things break that
 * promise, and each one hands back null instead:
 *   - a legacy `visibleIf` (`{ truthy: "show" }`), which is worked out live against the store, not compiled;
 *   - a style value decided by a condition (`{ truthy: "sel", then: 1, else: 0.3 }`), the same;
 *   - a component that reads the store or the ctx while it draws (PURE_PROPS above).
 * Before this, a node with one `{ $ }` prop and a legacy `visibleIf` stayed hidden for ever after the condition
 * came true, because nothing told it to look again.
 */
function depsOf(node: Node, exprDeps: readonly string[]): string[] | null {
  if (!PURE_PROPS.has(node.type)) return null;
  const vis = node.visibleIf as unknown;
  const kernelVis = !!vis && typeof vis === "object" && typeof (vis as { expr?: unknown }).expr === "string";
  if (vis !== undefined && vis !== null && !kernelVis) return null;
  if (hasStyleConditional(node.style as Record<string, any> | undefined)) return null;
  const out = [...exprDeps];
  if (node.bind) {
    for (const k of Object.keys(node.bind)) {
      const p = node.bind[k];
      if (typeof p === "string" && p && !out.includes(`state.${p}`)) out.push(`state.${p}`);
    }
  }
  // A node with rules is redrawn on any write: its `when` is looked at by the rule host, not by this render, and
  // what the rule does is usually a state write the node itself draws.
  return out;
}

/**
 * ONCE A SECOND, FOR A NODE THAT READS THE CLOCK (pure/SPEC.md 2.2: `now()`, `since()`, `fmt.elapsed`).
 *
 * The kernel puts `@time` in such a node's dependencies precisely so the renderer knows it has to come back —
 * and nothing was coming back, so a call's running time showed the second it was drawn and that second for ever.
 * Paused while the node is off screen and while the app is not in front (SPEC 2.4: nothing runs in the
 * background). It is the same once-a-second tick `Text`'s own `useNow` already runs for `elapsed`.
 */
function useTick(on: boolean): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) timer = setInterval(() => force((n) => n + 1), 1000); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    if (AppState.currentState !== "background") start();
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? start() : stop()));
    return () => { stop(); sub.remove(); };
  }, [on]);
}

function RenderNodeBody({ node, ctx, scope }: { node: Node; ctx: Ctx; scope?: RenderScope }) {
  const theme = useTheme();

  // VOCAB 2, only where the screen asked for it. `compileNode` is cached on the node object, so a screen's tree
  // compiles once and every render after this is a lookup.
  const exprOn = on(ctx, "expr");
  // The screen's own budget (SPEC 5.1: 600 expressions, 20,000 ops per change), made once per screen in
  // ScreenTree and absent on a screen that asked for nothing.
  const budget = ctx.budget as ScreenBudget | undefined;
  // A screen that did not ask for `expr` is not even looked at for one: its props are data, as they always were.
  const compiled = exprOn ? compileNode(node, budget) : NO_EXPRESSIONS;
  const live = compiled.live;
  // Said whenever there is anything to say, not only for a node that is still live: a node whose ONE expression
  // failed to compile is not live at all, and it was the one worth hearing about.
  if (compiled.errors.length > 0) reportOnce(node, compiled.errors);
  const deps = useMemo(
    () => (live ? depsOf(node, compiled.deps) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node, live],
  );
  // One watcher either way: null deps is exactly today's behaviour (re-render on any write), a list of paths is
  // the new one. The hook is always called, so a node that gains an expression cannot change the hook order.
  const ver = useStoreWatch(ctx.store, deps);
  // `device.*` and `local.*` are not in the store, so they are watched separately — and only when read.
  useFactsWatch(deps);

  // What this screen may still spend on this change of the store; absent for a screen with no budget.
  const guard: OpsGuard | undefined = budget
    ? (ops) => {
      const ok = budget.spend(ver, ops);
      if (!ok && budget.firstRefusal()) badValue(node)("too much work for one change");
      return ok;
    }
    : undefined;

  // THE SCOPE THIS NODE'S CHILDREN ARE DRAWN IN (a template's `$args`, worked out here).
  //
  // MEMOISED, because its identity is what every child's `React.memo` compares, and `scopeFor` allocates. The key
  // is the store's version, which moves only when something this node reads has changed — so a redraw that came
  // from somewhere else hands the children the very same object and stops there. Worked out before the early
  // returns below, so the hook order never changes with what the node turns out to draw.
  const kidScope = useMemo(
    () => (live ? scopeFor(compiled, baseScope(ctx), scope, badValue(node), guard) : scope),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, compiled, scope, ctx, ver],
  );

  // Node lifecycle: fire onAppear when this node becomes visible and
  // onDisappear when it stops being visible. Backend screens rely on this —
  // e.g. flow_arm's root has on.onAppear: armFlowSession, so opening it IN-APP
  // (not just via the keyboard tombstone) arms Flow.
  //
  // VISIBILITY, NOT MOUNT. A hidden node stays mounted — visibleIf only makes
  // it render null — so firing on mount meant onAppear ran for nodes the user
  // could not see, and never ran again when one actually appeared. "Appear"
  // now means what it says.
  //
  // That also turns visibleIf + onAppear into the one thing the SDUI had no
  // way to express: run an action WHEN A CONDITION BECOMES TRUE. The keyboard
  // step uses it to move on by itself the moment the keyboard is finally
  // enabled — a state the app polls and the server cannot know. Without this
  // the backend can only react to taps, never to the device changing under it.
  //
  // A node with no visibleIf is visible from its first render, so it fires once
  // on mount exactly as before.
  // `visibleIf` is either today's Condition or the kernel's `{ expr }` (SPEC 2.2). A condition the kernel cannot
  // work out hides the node, which is what a condition that cannot be read has always meant here.
  let visible = true;
  if (live && compiled.visible) {
    try {
      visible = !!compiled.visible.run(kernelScope(baseScope(ctx), kidScope));
    } catch {
      visible = false;
    }
  } else {
    visible = evalCondition(node.visibleIf, ctx);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible) return;
    if (node.on?.onAppear) void runAction(node.on.onAppear, ctx);
    return () => {
      if (node.on?.onDisappear) void runAction(node.on.onDisappear, ctx);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /**
   * ONE `fire` PER NODE, FOR THE LIFE OF THE NODE.
   *
   * It used to be a fresh arrow on every render, and every node re-renders on
   * every store write (useStoreWatch above, with no paths, is that subscription).
   * For anything that draws, a new function per render costs nothing. For a
   * component that puts `fire` in a dependency array it is fatal, and the
   * spoken screen is exactly that: VoiceSession's effect owns the microphone,
   * the socket and the synthesiser, and its cleanup closes all three.
   *
   * So the train screen ate itself. Mounting wrote the empty transcript, which
   * bumped the store, which re-rendered the node, which handed VoiceSession a
   * new `fire`, which tore the session down and started another — and the new
   * one's first act was to write "listening" and a level, which did it again.
   * The mic was asked for and dropped several times a second, no turn ever
   * finished, and the orb sat still: not an orb that fails to respond, an orb
   * that was never allowed to start.
   *
   * Refs rather than deps because the identity is the whole point: the latest
   * node and ctx are read at call time, so behaviour is unchanged and the
   * function outlives every render.
   */
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const scopeRef = useRef(kidScope);
  scopeRef.current = kidScope;
  const fire = useCallback((event: NodeEvent, value?: any) => {
    const ctxNow = ctxRef.current;
    let act: unknown = nodeRef.current.on?.[event];
    // A TEMPLATE'S ROW FIRES ITS CALLER'S ACTION (SPEC 2.3): `on: { onPress: { $ref: "args.onOpen" } }`. Without
    // this the row handed runAction an object with no `kind`, which reported `action:?` and did nothing — so the
    // main use of a template, a list of rows that open what the screen says they open, could not work at all.
    if (on(ctxNow, "defs") && act && typeof act === "object" && "$ref" in (act as object)) {
      act = resolveActionRef(act, kernelScope(baseScope(ctxNow), scopeRef.current));
    }
    void runAction(act as never, { ...ctxNow, event: value });
  }, []);

  // ONCE A SECOND while this node is on screen, if anything on it reads the clock (SPEC 2.2).
  useTick(live && compiled.time && visible);

  // A NODE'S OWN RULES (SPEC 2.4), live only while the node is. Called unconditionally, and does nothing at all
  // when the node has none or the screen did not ask for `rules`.
  useRules((node as { rules?: unknown }).rules, ctx, on(ctx, "rules") && rulesOn(), visible, kidScope);

  if (!visible) return null;

  // A type this build does not draw falls back — and so does one the server switched off (`sdui.off`) or one safe
  // mode does not allow. "Off" and "never built" look the same from here on purpose: the fallback is the server's
  // own answer for a player that cannot draw something, so a kill switch gets the same answer for free.
  //
  // A type that belongs to a block is only this screen's to draw when the screen said it needs that block: the
  // registry is one list for the whole launch, the gate is per screen (SPEC 2.0, principle 2).
  const fromBlock = blockForType(node.type);
  const blocked = fromBlock !== null && !on(ctx, fromBlock);
  const Comp = nodeOff(node.type) || blocked ? undefined : REGISTRY[node.type];
  if (!Comp) {
    return node.fallback ? <RenderNode node={node.fallback} ctx={ctx} scope={scope} /> : null;
  }

  // Resolve props: literal props + bound props (bind: { prop -> statePath }).
  const props: Record<string, any> = { ...(node.props ?? {}) };
  // Resolve "@label.key" string props against the catalog's central copy.
  //
  // A key the catalog does not have drew as the KEY — "paywall.cta.monthly"
  // on a button, in front of a user. Blank is the honest failure: nothing is
  // better than an identifier. The server can ask for the key back (policy
  // "key") while it is authoring, to see what is missing.
  //
  // Only the node's OWN props, before binding: a bound value is the user's
  // text (a history row, a dictation), and "@Sarah can you…" is a sentence,
  // not a label key — it went blank.
  let missingPolicy: string | null = null;
  for (const k of Object.keys(props)) {
    const v = props[k];
    if (typeof v === "string" && v.startsWith("@")) {
      const hit = ctx.labels[v.slice(1)];
      if (hit !== undefined) { props[k] = hit; continue; }
      if (missingPolicy === null) missingPolicy = str("labels.missingPolicy", "blank");
      props[k] = missingPolicy === "key" ? v.slice(1) : "";
    }
  }
  // A bind to a key the screen never declared resolves to undefined, and
  // undefined is not "unbound" — it lands on the prop and erases the literal
  // underneath it. That is how a clip bound to a play flag the screen forgot
  // to seed became a video with `playing: undefined`, which falls through to
  // `autoplay: false` and never starts. Keep the literal when the store has
  // nothing to say; a screen that does declare the key still wins, including
  // when it declares it false.
  //
  // ---------------------------------------------------------------------------------------------------------
  // THE KERNEL'S TURN (SPEC 2.2). Only `{ "$": … }` and `{ "$t": … }` props are worked out; every other prop is
  // already in `props`, exactly as the server wrote it, which is how a note title that happens to read
  // "{{ state.token }}" draws as those characters. It runs AFTER the catalog pass, so a value an expression built
  // is never read back as an "@key", and BEFORE `bind`, which keeps its old last word.
  // THE NODE'S OWN SCOPE IS THE ONE ITS FRAME MAKES. A template's root carries the `$args` the caller gave it
  // (kidScope above), and SPEC 2.3's own example puts an expression on that very node — `args.bot.name` on the
  // root, `{ $ref: "args.onOpen" }` in its `on`. Reading its props in the scope OUTSIDE the frame left both
  // undefined, so a one-node row template drew nothing at all. For every node without a frame this is the same
  // object as `scope`, so nothing else changes.
  const kScope = live ? kernelScope(baseScope(ctx), kidScope) : null;
  if (kScope && compiled.props.length > 0) resolveInto(props, compiled.props, kScope, badValue(node), guard);
  if (node.bind) {
    // `bind` by expression (SPEC 2.2): a `{ "$": … }` there is a VALUE, not a path — it used to be handed to
    // `store.get`, where `path.split` threw and took the node with it. A bare string is still a dot-path.
    const byExpr = compiled.binds.length > 0 ? new Map(compiled.binds) : null;
    const bound = byExpr && kScope ? resolveInto({}, compiled.binds, kScope, badValue(node), guard) : null;
    for (const k of Object.keys(node.bind)) {
      if (byExpr?.has(k)) {
        const v = bound?.[k];
        if (v !== undefined) props[k] = v;
        continue;
      }
      const path = node.bind[k];
      if (typeof path !== "string" || !path) continue;
      const v = ctx.store.get(path);
      if (v !== undefined) props[k] = v;
    }
  }

  // The same for the style's own values, before the theme reads it.
  let styleSrc = node.style;
  if (kScope && compiled.style.length > 0) {
    styleSrc = resolveInto({ ...(node.style ?? {}) }, compiled.style, kScope, badValue(node), guard);
  }
  // `paint` (B7) is the server's own style keys — gradients, shadows, filters, blend — and they are let through
  // only for a screen that asked for the block.
  const paintOn = on(ctx, "paint");
  const style = resolveStyle(resolveStyleConditionals(styleSrc, ctx), theme, paintOn);
  const blur = resolvePaintBlur(styleSrc, paintOn);

  // Children are drawn in the scope this node makes: a template's `$args` worked out here, so a row reads its own
  // arguments (kernel defs.ts leaves the frames; nodeCore turns them into a scope).
  const children = (node.children ?? []).map((child, i) => (
    <RenderNode key={i} node={child} ctx={ctx} scope={kidScope} />
  ));
  // A backdrop blur sits under everything the node draws; the box needs `overflow: hidden` for it to follow the
  // node's own corners, which is the server's to say.
  const kids = blur
    ? [<BackdropBlur key="__blur" intensity={blur.intensity} tint={blur.tint} />, ...children]
    : children;

  const bag: CompProps = { node, props, style, store: ctx.store, children: kids, fire, ctx };
  let rendered: React.ReactNode = <Comp {...bag} />;

  // GESTURE OUTSIDE, MOTION INSIDE (V2's hand-off): a motion that scales or moves a node must not move the box
  // that takes the finger. Both return the child untouched when the node asks for nothing.
  if (on(ctx, "motion") && usesMotion(node)) {
    rendered = wrapMotion(node, rendered, ctx.hosts?.motion as MotionHost | undefined);
  }
  if (on(ctx, "gesture") && gesturesOn() && usesGesture(node)) {
    rendered = wrapGesture(node, rendered, ctx.hosts?.gesture as GestureHost | undefined);
  }

  // Fire onAppear once, and wrap in entry motion if requested (the seven vocab-1 presets, unchanged: a format-2
  // motion is an object of style keys and has no `appear`, so the two never meet).
  const preset = node.motion as MotionSpec | undefined;
  return preset?.appear ? <Motion spec={preset}>{rendered}</Motion> : rendered;
}

/**
 * WHAT WOULD NOT COMPILE, SAID ONCE (SPEC 2.11, `sdui.bad`).
 *
 * A node that throws is reported by its boundary; an expression that will not compile throws nothing at all —
 * the prop simply keeps what the server wrote. So it is reported here instead, once per node object, because a
 * node re-renders and the report is news only the first time.
 */
const told = new WeakSet<object>();

function reportOnce(node: Node, errors: readonly string[]): void {
  if (told.has(node)) return;
  told.add(node);
  for (const why of errors.slice(0, 2)) {
    try { noteBadNode(`${node.type}:${why.slice(0, 30)}`); } catch { /* reporting is never the next error */ }
  }
}

/** Anything an expression on this node could not work out, reported once per node type (SPEC 2.11, `sdui.bad`). */
function badValue(node: Node): (why: string) => void {
  return (why) => {
    try { noteBadNode(`${node.type}:${why.slice(0, 30)}`); } catch { /* reporting is never the next error */ }
  };
}

function Motion({ spec, children }: { spec: MotionSpec; children: React.ReactNode }) {
  // `sdui.motion`, and safe mode, which forces it off. Both mean here what Reduce Motion already means everywhere
  // else in this app (Rise.tsx): the thing is simply there, at the end of its entrance, from the first frame.
  //
  // FROM THE FIRST FRAME means the value starts at 1, not at 0 with an effect to follow. Starting at 0 is starting
  // invisible, and the effect only runs after the first paint — so every node with `motion.appear` flashed blank for
  // a frame in the one mode whose whole point is not to move. The effect still sets it, for a mode that changes
  // while the screen is up.
  const mode = motionMode();
  const v = useRef(new Animated.Value(mode === "on" ? 0 : 1)).current;
  useEffect(() => {
    if (mode !== "on") { v.setValue(1); return; }
    Animated.timing(v, {
      toValue: 1,
      duration: spec.durationMs ?? num("motion.appear.durationMs", 260),
      delay: spec.delayMs ?? num("motion.appear.delayMs", 0),
      useNativeDriver: true,
    }).start();
  }, [v, spec, mode]);

  const travel = mode === "on" ? num("motion.appear.travel", 10) : 0;
  const transform =
    spec.appear === "fadeInUp" ? [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }) }] :
    spec.appear === "fadeInDown" ? [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-travel, 0] }) }] :
    spec.appear === "scaleIn" ? [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [num("motion.appear.fromScale", 0.96), 1] }) }] :
    [];

  return <Animated.View style={{ opacity: v, transform }}>{children}</Animated.View>;
}
