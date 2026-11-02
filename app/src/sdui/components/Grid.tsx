/** Grid: children in equal columns with a gap (a Bots kit layout node; its look is the node's props, then ui.Grid.* knobs). */
import React from "react";
import { View } from "react-native";
import * as K from "../knobs";
import type { CompProps } from "./props";

export const Grid = ({ props, children, style }: CompProps) => {
  const columns = Math.max(1, Number(props.columns ?? K.num("ui.Grid.columns", 2)));
  const gap = Number(props.gap ?? K.num("ui.Grid.gap", 12));
  const kids = React.Children.toArray(children);
  return (
    <View style={[{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -gap / 2 }, style]}>
      {kids.map((k, i) => (
        <View key={i} style={{ width: `${100 / columns}%`, padding: gap / 2 }}>
          {k}
        </View>
      ))}
    </View>
  );
};
