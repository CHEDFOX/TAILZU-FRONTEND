import { useContext } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import * as K from "../knobs";
import type { CompProps } from "./props";
import { ScreenViewport, KeyboardAbove } from "./Screen";

/**
 * A box — and, when the backend gives it one, a tappable box.
 *
 * It used to be a bare View, so `on.onPress` on a Stack did nothing at all.
 * Not an error, not a warning: the node rendered perfectly and simply could
 * not be tapped. The Languages rows were built that way and every tap fell
 * through, which is the kind of failure that looks like a backend bug for a
 * day before anyone suspects the container.
 *
 * Pressable only when there is something to press, so the thousands of plain
 * Stacks in the tree keep costing exactly one View.
 */
export const Stack = ({ node, props, children, style, fire }: CompProps) => {
  /**
   * ONE WINDOW TALL, WHATEVER THE WINDOW IS.
   *
   * A screen that scrolls cannot lay its first pane out with flex — a
   * ScrollView's content is sized by its content, so `flex: 1` inside one
   * collapses to nothing and the pane's spacers vanish. The device is the only
   * thing that knows how tall a window is, so it is the device that answers:
   * the backend says "this pane is the opening view", and the height follows
   * the phone rather than a number guessed on a server.
   */
  const fill = props?.fillViewport === true;
  const win = useWindowDimensions();
  // The scroll view's own height when this pane is inside one, the window when
  // it is not. See ScreenViewport: the window is taller than the space the
  // pane actually scrolls in, by exactly the chrome around it, and that
  // difference is a control pushed under the fold.
  const screenH = useContext(ScreenViewport);
  const sized = fill ? [style, { minHeight: screenH || win.height }] : style;
  if (props?.keyboard === "above" && !node.on?.onPress && !node.on?.onLongPress) return <KeyboardAbove style={sized}>{children}</KeyboardAbove>;
  if (!node.on?.onPress && !node.on?.onLongPress) return <View style={sized}>{children}</View>;
  // How far it dims under a finger. A Stack is the app's general-purpose
  // pressable — the allow pill, the plan rows, the deck cards are all one —
  // so the one number that says "this was pressed" cannot be fixed in the
  // binary. 1 disables the dim for anything that shows its press another way.
  const pressOpacity = props?.pressOpacity !== undefined ? Number(props.pressOpacity) : K.num("ui.Stack.pressOpacity", 0.6);
  /**
   * AN EDGE THAT ONLY EXISTS WHILE A FINGER IS ON IT.
   *
   * A border is the loudest thing a row can wear, and on a list where every
   * row is selectable it is loud on all of them at once — which says nothing
   * about which one you are choosing. Drawn on press instead, it says exactly
   * that and nothing the rest of the time.
   *
   * Only while pressed, not for a moment afterwards: a timed flash is a
   * decision about how long, made in the binary, and the press already lasts
   * precisely as long as the user holds it.
   */
  const pressBorderColor = props?.pressBorderColor ? String(props.pressBorderColor) : "";
  const pressBorderWidth = props?.pressBorderWidth !== undefined
    ? Number(props.pressBorderWidth) : K.num("ui.Stack.pressBorderWidth", 1);
  /**
   * HOW FAR PAST ITS OWN EDGE IT STILL ANSWERS.
   *
   * A target the size of the thing drawn is a target the size of the thing
   * drawn, and a small round control — a close arrow, a chevron in a corner —
   * is routinely smaller than the finger reaching for it. The slop is the
   * difference, taken outward, so the control can stay the size it looks best
   * at and still be hit. The backend sets it because the backend decided how
   * big to draw it.
   */
  const hitSlop = props?.hitSlop !== undefined ? Number(props.hitSlop) : undefined;
  return (
    <Pressable
      onPress={node.on?.onPress ? () => fire("onPress") : undefined}
      onLongPress={node.on?.onLongPress ? () => fire("onLongPress") : undefined}
      hitSlop={Number.isFinite(hitSlop) && (hitSlop as number) > 0 ? hitSlop : undefined}
      // A row of text is not obviously a button, so the press has to say so.
      style={({ pressed }) => [
        sized,
        pressed && { opacity: pressOpacity },
        pressed && pressBorderColor
          ? { borderWidth: pressBorderWidth, borderColor: pressBorderColor }
          : null,
      ]}
      accessibilityRole="button"
      // What a screen reader says for a box whose content is a picture (the Bots kit's icon buttons).
      accessibilityLabel={typeof props?.accessibilityLabel === "string" ? props.accessibilityLabel : undefined}
    >
      {children}
    </Pressable>
  );
};
