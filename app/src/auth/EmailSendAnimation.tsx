/**
 * EmailSendAnimation — the "we're sending your code" moment.
 *
 * A faithful take on Plutto's centered-envelope + sonar-ring pulse, with a
 * Tailzu touch: the rings ride the brand accent (#5b4bff) instead of gold,
 * there are two staggered rings for a richer sonar, the envelope drifts up a
 * hair as it "sends", and a soft accent glow breathes underneath it.
 *
 * Plays full-screen (absolute fill) while the OTP request is in flight.
 * Physics: spring-in on the envelope; eased ring expansion. Haptics: a light
 * tick as it leaves, a success notification as it lands.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import * as Haptics from "expo-haptics";

const ENV_W = 84;
const ENV_H = 60;
const RING = 240;
const ACCENT = "#5b4bff";
const WHITE = "#FFFFFF";

function Ring({ color, anim }: { color: string; anim: Animated.Value }) {
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.1, 1] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { borderColor: color, opacity, transform: [{ scale }] }]}
    />
  );
}

export default function EmailSendAnimation({ accent = ACCENT }: { accent?: string }) {
  const envScale = useRef(new Animated.Value(0.82)).current;
  const envOpacity = useRef(new Animated.Value(0)).current;
  const envLift = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  // Two staggered sonar rings.
  const ringA = useRef(new Animated.Value(0)).current;
  const ringB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Envelope springs in, then drifts up a touch (the "send").
    Animated.parallel([
      Animated.timing(envOpacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(envScale, { toValue: 1, friction: 6, tension: 55, useNativeDriver: true }),
    ]).start(() => {
      Animated.spring(envLift, { toValue: 1, friction: 7, tension: 40, useNativeDriver: true }).start();
    });

    // Soft accent glow breathing under the envelope.
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    ).start();

    const pulse = (v: Animated.Value) => {
      v.setValue(0);
      Animated.timing(v, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    };
    pulse(ringA);
    const stagger = setTimeout(() => pulse(ringB), 360);
    const iv = setInterval(() => { pulse(ringA); }, 720);
    const ivB = setInterval(() => { pulse(ringB); }, 720);

    const h1 = setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), 300);
    const h2 = setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), 1500);

    return () => {
      clearInterval(iv); clearInterval(ivB); clearTimeout(stagger);
      clearTimeout(h1); clearTimeout(h2);
    };
  }, [envScale, envOpacity, envLift, glow, ringA, ringB]);

  const lift = envLift.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.4] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] });

  return (
    <View style={styles.container} pointerEvents="none">
      <Ring color={accent} anim={ringA} />
      <Ring color={accent} anim={ringB} />

      <Animated.View
        style={[styles.glow, { backgroundColor: accent, opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
      />

      <Animated.View style={{ opacity: envOpacity, transform: [{ scale: envScale }, { translateY: lift }] }}>
        <Svg width={ENV_W} height={ENV_H} viewBox="0 0 84 60">
          <Rect x="2" y="6" width="80" height="48" rx="7" stroke={WHITE} strokeWidth="1.4" fill="none" />
          <Path d="M 4 11 L 42 35 L 80 11" stroke={WHITE} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: RING, height: RING, borderRadius: RING / 2, borderWidth: 1 },
  glow: { position: "absolute", width: 130, height: 130, borderRadius: 65 },
});
