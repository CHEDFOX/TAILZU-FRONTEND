/**
 * EmailSendAnimation — the "we're sending your code" moment.
 *
 * A centered white envelope that springs in, with a single white sonar ring
 * pulsing outward. No dots, no extra rings — plays full-screen while the OTP is
 * in flight. (Black + white only; the brand orange is reserved for the icon.)
 *
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
const RING_COLOR = "#FFFFFF";
const WHITE = "#FFFFFF";

export default function EmailSendAnimation() {
  const envScale = useRef(new Animated.Value(0.82)).current;
  const envOpacity = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(envOpacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(envScale, { toValue: 1, friction: 6, tension: 55, useNativeDriver: true }),
    ]).start();

    const pulse = () => {
      ringScale.setValue(0.1);
      ringOpacity.setValue(0.5);
      Animated.parallel([
        Animated.timing(ringScale, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(ringOpacity, { toValue: 0, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    };
    pulse();
    const iv = setInterval(pulse, 720);

    const h1 = setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), 300);
    const h2 = setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), 1500);

    return () => { clearInterval(iv); clearTimeout(h1); clearTimeout(h2); };
  }, [envScale, envOpacity, ringScale, ringOpacity]);

  return (
    <View style={styles.container} pointerEvents="none">
      <Animated.View style={[styles.ring, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
      <Animated.View style={{ opacity: envOpacity, transform: [{ scale: envScale }] }}>
        <Svg width={ENV_W} height={ENV_H} viewBox="0 0 84 60">
          <Rect x="2" y="6" width="80" height="48" rx="7" stroke={WHITE} strokeWidth="1.4" fill="none" />
          <Path d="M 4 11 L 42 35 L 80 11" stroke={WHITE} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...(StyleSheet as any).absoluteFillObject, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: RING, height: RING, borderRadius: RING / 2, borderWidth: 1, borderColor: RING_COLOR },
});
