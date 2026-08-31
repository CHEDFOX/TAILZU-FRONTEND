/**
 * KeyboardPreview — a real keyboard, drawn as one component.
 *
 * The haptics picker first tried to compose this out of generic Button nodes
 * with style overrides, and it came out as a field of orange pills with the
 * labels clipped. That was the predictable result of fighting three things at
 * once: Button's own padding, its min-height, and its text metrics. A keyboard
 * is not a row of buttons that happen to be small — it is a grid with its own
 * sizing rules, so it gets its own component.
 *
 * The backend sends the same rows the keyboard itself is built from
 * (KB_ROW_* in catalog.ts), so this cannot drift from the real thing: add a key
 * there and it appears here.
 *
 * Interaction is one callback with the key's id, so the caller decides what a
 * tap means. Here it toggles haptics; nothing about this component knows that.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import type { CompProps } from "./components";

export type PreviewKey = {
  /** What the key shows. */
  label: string;
  /** What it is called in settings — what it types, or its role. */
  id: string;
  /** Share of the leftover width. Ignored when `w` is set. */
  flex?: number;
  /** Fixed width in points, for keys that must not stretch. */
  w?: number;
  /** Function key (shift, backspace, 123): recessed, like the real one. */
  fn?: boolean;
  /** Occupies width and is never drawn or tappable — the row indents. */
  spacer?: boolean;
};

/**
 * Typed as the renderer's own CompProps so it drops straight into REGISTRY;
 * the props bag is narrowed at the top of the component instead of in the
 * signature, which is what every other node here does.
 */
type Preview = {
  rows?: PreviewKey[][];
  /** Key ids currently switched on. */
  selected?: string[];
  /** Everything is on, whatever `selected` says. */
  all?: boolean;
  /** Row height in points. The real keyboard uses 44. */
  keyHeight?: number;
  accent?: string;
};

const GAP = 6;
const RADIUS = 5;

export default function KeyboardPreview({ props: raw, style, fire }: CompProps) {
  const props = (raw ?? {}) as Preview;
  const rows = Array.isArray(props.rows) ? props.rows : [];
  const on = new Set((props?.selected ?? []).map((s) => String(s).toLowerCase()));
  const all = props?.all === true;
  const h = Number(props?.keyHeight) > 0 ? Number(props.keyHeight) : 44;
  const accent = String(props?.accent ?? "#E8A23C");

  return (
    <View style={[{ gap: GAP }, style]}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap: GAP, height: h }}>
          {(row ?? []).map((k, i) => {
            if (k?.spacer) {
              return <View key={i} style={{ flex: k.flex ?? 1 }} />;
            }
            const lit = all || on.has(String(k.id).toLowerCase());
            // Sizing comes from the row, never from the label — that is what
            // keeps "space" and "q" the widths the real keyboard gives them
            // instead of the widths their text happens to need.
            const sizing = k.w ? { width: k.w } : { flex: k.flex ?? 1 };
            return (
              <Pressable
                key={i}
                onPress={() => fire("onPress", k.id)}
                accessibilityRole="button"
                accessibilityLabel={k.label}
                accessibilityState={{ selected: lit }}
                style={({ pressed }) => [
                  sizing,
                  {
                    height: h,
                    borderRadius: RADIUS,
                    alignItems: "center",
                    justifyContent: "center",
                    // The two fills the keyboard uses, so a glance here maps
                    // onto the thing being configured.
                    backgroundColor: lit ? accent : (k.fn ? "#FFFFFF26" : "#FFFFFF8C"),
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  // adjustsFontSizeToFit stops a wide label ("return",
                  // "space") from being clipped in a narrow key, which is what
                  // made the first attempt unreadable.
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  style={{
                    color: lit ? "#000000" : (k.fn ? "#FFFFFF" : "#111114"),
                    fontSize: k.label.length > 2 ? 13 : 17,
                    fontWeight: "500",
                    paddingHorizontal: 2,
                  }}
                >
                  {k.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
