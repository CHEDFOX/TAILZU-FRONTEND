import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { num } from "../../sdui/knobs";

// tiny spinner for the verifying moment
export function MicroLoader() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: num("auth.anim.loaderSpinMs", 900), easing: Easing.linear, useNativeDriver: true })).start();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.7)", transform: [{ rotate }] }} />
  );
}
