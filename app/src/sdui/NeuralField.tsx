/**
 * NeuralField — the training tab's hero, as a node.
 *
 *   { "type": "NeuralField",
 *     "bind": { "state": "sessionState", "level": "level", "training": "on" },
 *     "props": { "alpha": 1, "regions": [...] } }
 *
 * Every number the drawing uses comes down in props, so retuning the hero is
 * a cache bump and not a release. The component's whole job is to hand those
 * numbers to the canvas once, then forward the three things that change —
 * which state the session is in, how loud the voice is, whether a session is
 * running — as they change and no more often.
 *
 * It never takes a touch. It is scenery with a pulse, and the controls that
 * sit over it own every gesture on the screen.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, AppState, Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import type { CompProps } from "./components";
// Named without a ".html" anywhere in it, deliberately: Metro reads an
// import specifier that ENDS in a known asset extension as an asset request,
// so "./neuralField.html" was resolved as a file to bundle rather than as a
// module to import, and the build failed with "none of these files exist".
import { neuralFieldHtml } from "./neuralFieldPage";
import * as K from "./knobs";

/** What the field looks like when the node says nothing: the knob, else this. */
const fallbackRegions = () => K.list("ui.NeuralField.regions", [
  { x: 0.55, y: 0.42, hue: 335, n: 6, z: 0.40, sc: 1.00 },
  { x: 0.02, y: 0.14, hue: 196, n: 5, z: -0.35, sc: 0.78 },
  { x: 1.04, y: 0.22, hue: 40,  n: 5, z: 0.65, sc: 0.74 },
  { x: 0.10, y: 0.86, hue: 262, n: 6, z: 0.10, sc: 0.80 },
  { x: 0.98, y: 0.80, hue: 152, n: 5, z: -0.55, sc: 0.76 },
  { x: 0.55, y: 1.16, hue: 58,  n: 4, z: 0.30, sc: 0.62 },
  { x: 0.60, y: -0.16, hue: 300, n: 4, z: -0.75, sc: 0.62 },
]);

export const NeuralField = ({ props, style }: CompProps): React.ReactElement => {
  const ref = useRef<WebView>(null);
  /**
   * THE BLINK.
   *
   * A WebView paints its own background before its content exists, and on a
   * screen that is otherwise black that first frame is a white flash — a blink
   * every time this screen is pushed. So the view is held at zero and faded up
   * once the page says it has drawn a real frame. The ground under it is black,
   * which is what the field looks like before it lights anyway, so there is
   * nothing to see during the wait.
   */
  const fade = useRef(new Animated.Value(0)).current;
  const lit = useRef(false);
  const light = () => {
    if (lit.current) return;
    lit.current = true;
    Animated.timing(fade, { toValue: 1, duration: Number(props?.fadeMs ?? K.num("ui.NeuralField.fadeMs", 420)), useNativeDriver: true }).start();
  };

  // Every value the page reads, resolved the same way: the node's prop, then
  // the ui.NeuralField.* knob, then what this always drew.
  const alpha = Number(props?.alpha ?? K.num("ui.NeuralField.alpha", 1));
  const bloom = Number(props?.bloom ?? K.num("ui.NeuralField.bloom", 0.44));
  const focal = Number(props?.focal ?? K.num("ui.NeuralField.focal", 0.35));
  const maxPulses = Number(props?.maxPulses ?? K.num("ui.NeuralField.maxPulses", 700));
  // How much of the network has been earned, 0..1 — see the page's build().
  const growth = Number(props?.growth ?? K.num("ui.NeuralField.growth", 1));
  const signal: number[] = props?.signal ?? K.list("ui.NeuralField.signal", [232, 162, 60]);
  const head: number[] = props?.head ?? K.list("ui.NeuralField.head", [255, 241, 214]);

  // The page is built ONCE. Rebuilding it would throw away the baked plates
  // and re-lay the whole field, which is the one expensive thing here — so
  // the config is frozen on first render and everything after it is a
  // message (see LIVE below). A server that changes the geometry — regions,
  // focal length, tuning — does so with a cache bump, which remounts the
  // screen anyway.
  const html = useMemo(
    () => neuralFieldHtml({
      regions: Array.isArray(props?.regions) && props.regions.length ? props.regions : fallbackRegions(),
      alpha, bloom, focal, maxPulses, growth, signal, head,
      // The page's own constants, merged over its internal table: the global
      // knob first, the node's own `tuning` over that.
      tuning: {
        ...K.obj<Record<string, unknown>>("ui.NeuralField.tuning", {}),
        ...(props?.tuning && typeof props.tuning === "object" ? props.tuning : {}),
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const state = String(props?.state ?? "idle");
  const training = props?.training === true || props?.training === "true";
  // Quantised, because the level arrives sixty times a second and the field
  // only reads it as a rate. Twenty steps is finer than the eye, and it turns
  // a flood of bridge messages into a trickle.
  const steps = Math.max(1, Number(props?.levelSteps ?? K.num("ui.NeuralField.levelSteps", 20)));
  const level = Math.round(Math.min(1, Math.max(0, Number(props?.level ?? 0))) * steps) / steps;

  const send = (msg: Record<string, unknown>) => {
    ref.current?.injectJavaScript(`window.tz && window.tz(${JSON.stringify(msg)}); true;`);
  };

  useEffect(() => {
    send({ state, level, training });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, level, training]);

  /**
   * LIVE. Everything the page accepts after it is built, forwarded when it
   * changes. alpha EASES to the new value and growth rebuilds the network
   * under the last frame (see the page's window.tz), so a screen that sends a
   * brighter or denser field gets one without a remount — which used to be
   * the only way, because the page froze these on first render and ignored
   * every later prop. The mount itself is skipped: the page was built with
   * these values, and the message would arrive before the page exists.
   */
  const signalKey = JSON.stringify(signal);
  const headKey = JSON.stringify(head);
  const live = { alpha, growth, bloom, maxPulses, signal, head };
  const liveRef = useRef(live);
  liveRef.current = live;
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    send(liveRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alpha, growth, bloom, maxPulses, signalKey, headKey]);

  /**
   * IT ONLY RUNS WHEN SOMEONE IS LOOKING AT IT.
   *
   * A canvas at sixty frames a second is the most expensive thing in the app,
   * and for most of its life nobody is watching: the phone is in a pocket, or
   * the user is on another tab. Leaving the tab is already free — the app
   * draws one screen at a time, so this component unmounts and the WebView
   * goes with it. Backgrounding is not: the view stays mounted, the page
   * still believes it is visible, and the loop would keep drawing into
   * nothing until the battery noticed.
   *
   * So the app's own lifecycle is the switch. The page stops its loop
   * outright and resumes from where it was — the field is a simulation of
   * state, not a timeline, so a pause costs it nothing.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => send({ run: s === "active" }));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[{ overflow: "hidden", backgroundColor: String(props?.background ?? K.color("ui.NeuralField.background", "#000000")) }, style]} pointerEvents="none">
      <Animated.View style={{ flex: 1, opacity: fade }}>
      <WebView
        ref={ref}
        // The page posts this on its first composited frame; onLoadEnd is the
        // floor under it, for a page that somehow never gets that far.
        onMessage={light}
        // The mount's own message is dropped — injectJavaScript before the
        // page exists goes nowhere — so the state is stated again once there
        // is something to hear it. Without this a session that starts on the
        // same frame as the screen opens in idle and stays there.
        // The live values ride along: any that changed while the page was
        // still loading were sent into nothing.
        onLoadEnd={() => {
          send({ state, level, training, run: true, ...liveRef.current });
          setTimeout(light, Number(props?.lightFallbackMs ?? K.num("ui.NeuralField.lightFallbackMs", 600)));
        }}
        source={{ html }}
        originWhitelist={["*"]}
        style={{ flex: 1, backgroundColor: "transparent" }}
        containerStyle={{ backgroundColor: "transparent" }}
        // Scenery. Every gesture belongs to what is drawn over it.
        pointerEvents="none"
        scrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        javaScriptEnabled
        domStorageEnabled={false}
        // No chrome of its own: no zoom, no text inflation, no white flash
        // between mount and first paint.
        scalesPageToFit={false}
        setBuiltInZoomControls={false}
        textZoom={100}
        androidLayerType={Platform.OS === "android" ? "hardware" : undefined}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // A field that cannot load is a black screen, which is exactly what
        // this screen is under it. Nothing to say.
        renderError={() => <View />}
        onShouldStartLoadWithRequest={() => true}
      />
      </Animated.View>
    </View>
  );
};
