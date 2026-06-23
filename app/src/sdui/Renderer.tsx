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

  // List needs per-item scope.
  let children: React.ReactNode;
  if (node.type === "List") {
    const items: any[] = Array.isArray(props.items) ? props.items : [];
    const template: Node | undefined = props.itemTemplate;
    children = template
      ? items.map((item, i) => (
          <RenderNode key={i} node={template} ctx={{ ...ctx, store: new Store({ item, index: i }) }} />
        ))
      : null;
  } else {
    children = (node.children ?? []).map((child, i) => <RenderNode key={i} node={child} ctx={ctx} />);
  }

  const bag: CompProps = { node, props, style, store: ctx.store, children, fire };
  const rendered = <Comp {...bag} />;

  // Fire onAppear once, and wrap in entry motion if requested.
  return node.motion?.appear ? <Motion spec={node.motion}>{rendered}</Motion> : rendered;
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
