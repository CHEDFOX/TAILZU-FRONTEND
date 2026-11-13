/**
 * The renderer — walks a Node tree and draws it via the component registry,
 * resolving data bindings, visibility, events, and entry motion.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { Animated } from "react-native";
import type { Node, NodeEvent } from "./types";
import { useStoreVersion } from "./state";
import { REGISTRY } from "./components";
import type { CompProps } from "./components/props";
import { resolveStyle } from "./theme/style";
import { useTheme } from "./theme/ThemeContext";
import { Ctx, evalCondition, runAction } from "./actions";
import { num, str } from "./knobs";
import { motionMode, nodeOff, noteBadNode } from "./safety";

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

/** A node and everything under it, inside its own boundary. */
export function RenderNode({ node, ctx }: { node: Node; ctx: Ctx }) {
  // The boundary wraps the BODY rather than sitting inside it, so a throw in the body's own hooks — an onAppear
  // action, a style the theme cannot resolve — is caught too, not just one in the component it draws.
  return (
    <NodeBoundary node={node} ctx={ctx}>
      <RenderNodeBody node={node} ctx={ctx} />
    </NodeBoundary>
  );
}

function RenderNodeBody({ node, ctx }: { node: Node; ctx: Ctx }) {
  const theme = useTheme();
  useStoreVersion(ctx.store); // re-render when bound state changes

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
  const visible = evalCondition(node.visibleIf, ctx);
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
   * every store write (useStoreVersion above subscribes to the whole store).
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
  const fire = useCallback((event: NodeEvent, value?: any) => {
    void runAction(nodeRef.current.on?.[event], { ...ctxRef.current, event: value });
  }, []);

  if (!visible) return null;

  // A type this build does not draw falls back — and so does one the server switched off (`sdui.off`) or one safe
  // mode does not allow. "Off" and "never built" look the same from here on purpose: the fallback is the server's
  // own answer for a player that cannot draw something, so a kill switch gets the same answer for free.
  const Comp = nodeOff(node.type) ? undefined : REGISTRY[node.type];
  if (!Comp) {
    return node.fallback ? <RenderNode node={node.fallback} ctx={ctx} /> : null;
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
  if (node.bind) {
    for (const k of Object.keys(node.bind)) {
      const v = ctx.store.get(node.bind[k]);
      if (v !== undefined) props[k] = v;
    }
  }

  const style = resolveStyle(resolveStyleConditionals(node.style, ctx), theme);

  const children = (node.children ?? []).map((child, i) => <RenderNode key={i} node={child} ctx={ctx} />);

  const bag: CompProps = { node, props, style, store: ctx.store, children, fire, ctx };
  const rendered = <Comp {...bag} />;

  // Fire onAppear once, and wrap in entry motion if requested.
  return node.motion?.appear ? <Motion spec={node.motion}>{rendered}</Motion> : rendered;
}

function Motion({ spec, children }: { spec: NonNullable<Node["motion"]>; children: React.ReactNode }) {
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
