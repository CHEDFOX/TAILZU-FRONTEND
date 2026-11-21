/**
 * THE EMPTY VESSEL: the shape of the screen you are going to, drawn while it is still being fetched.
 *
 * SduiApp's `shown` keeps the PREVIOUS screen on display when the one being opened is not cached, on the reasoning
 * that "a flash of nothing is worse than a beat of something". That is true of the two options it had. It is not the
 * whole choice: leaving the old screen up means a tap changes nothing for as long as the fetch takes, so the tap
 * reads as not having registered — which is why people press again — and then the screen jumps.
 *
 * A skeleton is the third option and beats both. It answers the tap in the same frame, it says "a screen is coming
 * and here is roughly its shape", and when the real screen lands it replaces something the same size rather than
 * something different. The eye has nothing to re-learn.
 *
 * IT IS DELIBERATELY GENERIC — a head, a title, a few cards. It is not a per-screen mock: a skeleton that promised a
 * particular layout and then drew another would be worse than one that promised only "a screen". Everything is in
 * the theme's own ink at low alpha, so it is the app's colour and never a grey borrowed from somewhere else.
 *
 * It breathes, slowly, because a still skeleton reads as a screen that has finished loading and is simply empty.
 * With Reduce Motion on it holds still and sits a little stronger instead, which says the same thing without moving.
 */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";

/**
 * One block of the vessel. React Native has no colour inheritance — no `currentColor`, no cascade — so the ink is
 * handed to every block rather than set once on a wrapper.
 */
function Bar({ h, w, r, ink, o }: {
  h: number; w: number | `${number}%`; r: number; ink: string; o: Animated.AnimatedInterpolation<number> | number;
}): React.ReactElement {
  return <Animated.View style={{ height: h, width: w, borderRadius: r, backgroundColor: ink, opacity: o }} />;
}

export function ScreenSkeleton({ ink, bg, pad = 16 }: { ink: string; bg: string; pad?: number }): React.ReactElement {
  const [still, setStill] = useState(false);
  const pulse = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (live) setStill(!!v); }).catch(() => { if (live) setStill(false); });
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v: boolean) => setStill(!!v));
    return () => { live = false; sub?.remove?.(); };
  }, []);

  useEffect(() => {
    if (still) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.55, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [still, pulse]);

  // The theme's own ink, carried at a low alpha so the vessel is the app's colour and never a grey from elsewhere.
  const o: Animated.AnimatedInterpolation<number> | number = still
    ? 0.14
    : pulse.interpolate({ inputRange: [0.55, 1], outputRange: [0.07, 0.16] });

  return (
    <View style={{ flex: 1, backgroundColor: bg, padding: pad, paddingTop: pad + 8 }} accessibilityLabel="Loading" accessible>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <Bar h={30} w={30} r={15} ink={ink} o={o} />
        <Bar h={22} w="42%" r={8} ink={ink} o={o} />
      </View>
      <View style={{ gap: 12 }}>
        <Bar h={86} w="100%" r={18} ink={ink} o={o} />
        <Bar h={86} w="100%" r={18} ink={ink} o={o} />
        <Bar h={86} w="100%" r={18} ink={ink} o={o} />
      </View>
    </View>
  );
}
