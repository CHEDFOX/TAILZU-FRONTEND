/**
 * BinaryReveal — a wordmark decoding itself out of binary, forever.
 *
 * Every slot flips between 0 and 1 at speed, then the word resolves into it one
 * character at a time, holds, and scatters back to binary. The paywall runs it
 * as its hero: the product turns raw noise into finished words, and this is
 * that claim made literal while the user reads the price.
 *
 * Mechanics worth knowing:
 *
 * Characters are drawn in a MONOSPACE face and each slot is a fixed-width cell.
 * A proportional face would reflow the whole line every flip, because "1" is
 * narrower than "T" — the word would jitter horizontally the entire time.
 *
 * The resolve is staggered, left to right, so the word assembles rather than
 * snapping. That stagger is the difference between "it decoded" and "the text
 * changed".
 *
 * One interval drives everything and one setState carries a whole frame; at six
 * characters and ~20fps this costs nothing, so no Skia and no worklets here.
 *
 * Props (all backend-authored):
 *   text            the word to resolve to (default "Tailzu")
 *   color           character colour (default brand amber)
 *   background      fill behind it (default black)
 *   flipMs          ms per binary flip (default 55)
 *   lockMs          ms between characters locking in (default 90)
 *   holdMs          ms the finished word holds (default 2000)
 *   scrambleMs      ms of pure binary before the resolve starts (default 900)
 *   fontSize        (default 40)
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { CompProps } from "./components";

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

type Phase = "scramble" | "resolve" | "hold";

export const BinaryReveal = ({ props, style }: CompProps): React.ReactElement => {
  const text = String(props?.text ?? "Tailzu");
  const color = String(props?.color ?? "#E8A23C");
  const background = String(props?.background ?? "#000000");
  const flipMs = Number(props?.flipMs) > 0 ? Number(props.flipMs) : 55;
  const lockMs = Number(props?.lockMs) > 0 ? Number(props.lockMs) : 90;
  const holdMs = Number(props?.holdMs) > 0 ? Number(props.holdMs) : 2000;
  const scrambleMs = Number(props?.scrambleMs) > 0 ? Number(props.scrambleMs) : 900;
  const fontSize = Number(props?.fontSize) > 0 ? Number(props.fontSize) : 40;

  const chars = useMemo(() => Array.from(text), [text]);
  // How many characters are locked to the real word, left to right.
  const [locked, setLocked] = useState(0);
  // Bumped every flip; the rendered binary is derived from it, so a frame is
  // one number in state rather than an array of characters.
  const [frame, setFrame] = useState(0);

  const phase = useRef<Phase>("scramble");
  const since = useRef(0);

  useEffect(() => {
    phase.current = "scramble";
    since.current = 0;
    setLocked(0);
    const id = setInterval(() => {
      since.current += flipMs;
      if (phase.current === "scramble") {
        setFrame((f) => f + 1);
        if (since.current >= scrambleMs) {
          phase.current = "resolve";
          since.current = 0;
        }
      } else if (phase.current === "resolve") {
        setFrame((f) => f + 1);
        // Unresolved slots keep flipping while the resolved ones hold, which is
        // what makes the word appear to pull itself out of the noise.
        const shouldBeLocked = Math.floor(since.current / lockMs);
        if (shouldBeLocked >= chars.length) {
          setLocked(chars.length);
          phase.current = "hold";
          since.current = 0;
        } else {
          setLocked(shouldBeLocked);
        }
      } else if (since.current >= holdMs) {
        phase.current = "scramble";
        since.current = 0;
        setLocked(0);
      }
    }, flipMs);
    return () => clearInterval(id);
  }, [chars.length, flipMs, lockMs, holdMs, scrambleMs]);

  return (
    <View style={[styles.wrap, { backgroundColor: background }, style]}>
      <View style={styles.row}>
        {chars.map((ch, i) => {
          const isLocked = i < locked;
          // Deterministic per slot per frame — using Math.random() here would
          // reroll every character on any unrelated re-render.
          const bit = (frame * 31 + i * 17) % 2 === 0 ? "0" : "1";
          return (
            <Text
              key={i}
              style={[
                styles.cell,
                {
                  color,
                  fontSize,
                  width: fontSize * 0.72,
                  lineHeight: fontSize * 1.2,
                  // The binary sits back; the resolved letter comes forward.
                  opacity: isLocked ? 1 : 0.55,
                  fontWeight: isLocked ? "600" : "400",
                },
              ]}
              allowFontScaling={false}
            >
              {isLocked ? ch : bit}
            </Text>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center" },
  cell: { fontFamily: MONO, textAlign: "center" },
});
