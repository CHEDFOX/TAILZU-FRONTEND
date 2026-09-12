/**
 * The renderer — walks a Node tree and draws it via the component registry,
 * resolving data bindings, visibility, events, and entry motion.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { Animated } from "react-native";
import type { Node, NodeEvent } from "./types";
import { Store, useStoreVersion } from "./state";
import { REGISTRY, resolveStyle, useTheme, CompProps } from "./components";
import { Ctx, evalCondition, runAction } from "./actions";

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

export function RenderNode({ node, ctx }: { node: Node; ctx: Ctx }) {
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

  const Comp = REGISTRY[node.type];
  if (!Comp) {
    return node.fallback ? <RenderNode node={node.fallback} ctx={ctx} /> : null;
  }

  // Resolve props: literal props + bound props (bind: { prop -> statePath }).
  const props: Record<string, any> = { ...(node.props ?? {}) };
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
  // Resolve "@label.key" string props against the catalog's central copy.
  for (const k of Object.keys(props)) {
    const v = props[k];
    if (typeof v === "string" && v.startsWith("@")) props[k] = ctx.labels[v.slice(1)] ?? v.slice(1);
  }

  const style = resolveStyle(resolveStyleConditionals(node.style, ctx), theme);

  // List needs per-item scope (see ListItems — stable per-row stores).
  let children: React.ReactNode;
  if (node.type === "List") {
    const items: any[] = Array.isArray(props.items) ? props.items : [];
    const template: Node | undefined = props.itemTemplate;
    if (items.length === 0 && typeof props.emptyLabel === "string" && props.emptyLabel) {
      // The catalog has sent `emptyLabel` on the history list since it was
      // written and this renderer dropped it, so an empty History was a blank
      // area under a heading — indistinguishable from a screen that failed to
      // load. The label is already resolved above ("@history.empty" → copy).
      children = (
        <RenderNode
          node={{
            type: "Paragraph",
            props: { content: props.emptyLabel },
            style: { opacity: 0.6, textAlign: "center", marginTop: 24, marginBottom: 24 },
          }}
          ctx={ctx}
        />
      );
    } else {
      children = template ? <ListItems items={items} template={template} ctx={ctx} /> : null;
    }
  } else {
    children = (node.children ?? []).map((child, i) => <RenderNode key={i} node={child} ctx={ctx} />);
  }

  const bag: CompProps = { node, props, style, store: ctx.store, children, fire, ctx };
  const rendered = <Comp {...bag} />;

  // Fire onAppear once, and wrap in entry motion if requested.
  return node.motion?.appear ? <Motion spec={node.motion}>{rendered}</Motion> : rendered;
}

/**
 * List rows with STABLE per-item scope. Each row gets its own Store, memoized by
 * index across parent re-renders — so a bound field / toggle in a row isn't
 * wiped every time something unrelated on the screen re-renders. (The old code
 * built `new Store(...)` for every row on every render, discarding row state.)
 * Item data is refreshed in an effect — never mutated during render — and only
 * when it actually changed, so per-row user state under other keys is preserved.
 */
function ListItems({ items, template, ctx }: { items: any[]; template: Node; ctx: Ctx }) {
  const storesRef = useRef<Store[]>([]);
  // Lazily grow/shrink the pool to the current row count, reusing existing
  // stores by index. Ref mutation during render is safe (no state, no notify).
  if (storesRef.current.length !== items.length) {
    const next: Store[] = [];
    for (let i = 0; i < items.length; i++) {
      next[i] = storesRef.current[i] ?? new Store({ item: items[i], index: i });
    }
    storesRef.current = next;
  }
  const stores = storesRef.current;
  useEffect(() => {
    items.forEach((item, i) => {
      const s = stores[i];
      if (!s) return;
      if (JSON.stringify(s.get("item")) !== JSON.stringify(item)) s.set("item", item);
      if (s.get("index") !== i) s.set("index", i);
    });
  });
  return (
    <>
      {items.map((_, i) => (
        <RenderNode key={i} node={template} ctx={{ ...ctx, store: stores[i] }} />
      ))}
    </>
  );
}

function Motion({ spec, children }: { spec: NonNullable<Node["motion"]>; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: spec.durationMs ?? 260,
      delay: spec.delayMs ?? 0,
      useNativeDriver: true,
    }).start();
  }, [v, spec]);

  const transform =
    spec.appear === "fadeInUp" ? [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] :
    spec.appear === "fadeInDown" ? [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }] :
    spec.appear === "scaleIn" ? [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] :
    [];

  return <Animated.View style={{ opacity: v, transform }}>{children}</Animated.View>;
}
