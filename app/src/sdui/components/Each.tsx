/**
 * Each: one template, drawn once per entry of a small array (pure/SPEC.md 2.6, B6).
 *
 * `List` is for feeds — it windows, it pages, it owns a scroller. `Each` is for the eight chips on a card, the five
 * rows of a summary, the three buttons a bot offers: everything is drawn, nothing is windowed, and the count is
 * capped hard (listCore.LIST_LIMITS.eachMax) so a server that sends ten thousand entries draws two hundred rather
 * than locking the phone.
 *
 * The rows arrive already resolved; drawing the template with `item` and `index` in scope is the host's (v3Host.ts).
 */
import React from "react";
import { View } from "react-native";
import type { CompProps } from "./props";
import { eachCount, rowKeys, rowsOf } from "./listCore";
import { useV3Host, type ItemScope } from "./v3Host";

export const Each = ({ node, props, style, children }: CompProps) => {
  const host = useV3Host();
  const rows = rowsOf(props.data);
  const template = props.item ?? node.props?.item;
  const keyProp = typeof props.key === "string" ? props.key : typeof props.keyProp === "string" ? props.keyProp : "";
  const count = eachCount(rows.length, props.max);

  // Without the host, or without a template, or with nothing to repeat: whatever the node holds, which is where a
  // server puts its empty state.
  if (!host || template == null || count === 0) return <View style={style}>{children}</View>;

  // Each key is unique even when the array repeats an entry (eight chips that read the same): a repeated key would
  // be one row to React, and the second would stop redrawing.
  const drawn = rows.slice(0, count);
  const keys = rowKeys(drawn, keyProp);

  return (
    <View style={style}>
      {drawn.map((item, index) => {
        const scope: ItemScope = { item, index };
        const key = keys[index];
        return <React.Fragment key={key}>{host.renderItem(template, scope, key)}</React.Fragment>;
      })}
    </View>
  );
};
