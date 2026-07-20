/**
 * The renderer — walks a Node tree and draws it via the component registry,
 * resolving data bindings, visibility, events, and entry motion.
 */
import React, { useEffect, useRef } from "react";
import { Animated } from "react-native";
import type { Node, NodeEvent } from "./types";
import { Store, useStoreVersion } from "./state";
import { REGISTRY, resolveStyle, useTheme, CompProps } from "./components";
import { Ctx, evalCondition, runAction } from "./actions";

export function RenderNode({ node, ctx }: { node: Node; ctx: Ctx }) {
  const theme = useTheme();
  useStoreVersion(ctx.store); // re-render when bound state changes

  // Node lifecycle: fire onAppear when this node mounts and onDisappear when it
  // unmounts. Backend screens rely on this — e.g. flow_arm's root has
  // on.onAppear: armFlowSession, so opening it IN-APP (not just via the keyboard
  // tombstone) arms Flow. Effect is unconditional (before the visibleIf return)
  // to satisfy rules-of-hooks; the empty dep array fires it exactly once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (node.on?.onAppear) void runAction(node.on.onAppear, ctx);
    return () => {
      if (node.on?.onDisappear) void runAction(node.on.onDisappear, ctx);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!evalCondition(node.visibleIf, ctx)) return null;

  const Comp = REGISTRY[node.type];
  if (!Comp) {
    return node.fallback ? <RenderNode node={node.fallback} ctx={ctx} /> : null;
  }

  // Resolve props: literal props + bound props (bind: { prop -> statePath }).
  const props: Record<string, any> = { ...(node.props ?? {}) };
  if (node.bind) for (const k of Object.keys(node.bind)) props[k] = ctx.store.get(node.bind[k]);
  // Resolve "@label.key" string props against the catalog's central copy.
  for (const k of Object.keys(props)) {
    const v = props[k];
    if (typeof v === "string" && v.startsWith("@")) props[k] = ctx.labels[v.slice(1)] ?? v.slice(1);
  }

  const style = resolveStyle(node.style, theme);
  const fire = (event: NodeEvent, value?: any) => {
    void runAction(node.on?.[event], { ...ctx, event: value });
  };

  // List needs per-item scope (see ListItems — stable per-row stores).
  let children: React.ReactNode;
  if (node.type === "List") {
    const items: any[] = Array.isArray(props.items) ? props.items : [];
    const template: Node | undefined = props.itemTemplate;
    children = template ? <ListItems items={items} template={template} ctx={ctx} /> : null;
  } else {
    children = (node.children ?? []).map((child, i) => <RenderNode key={i} node={child} ctx={ctx} />);
  }

  const bag: CompProps = { node, props, style, store: ctx.store, children, fire };
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
