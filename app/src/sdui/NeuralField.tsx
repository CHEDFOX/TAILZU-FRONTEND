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
import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import type { CompProps } from "./components";
import { neuralFieldHtml } from "./neuralField.html";

/** What the field looks like when the server says nothing. */
const FALLBACK_REGIONS = [
  { x: 0.55, y: 0.42, hue: 335, n: 6, z: 0.40, sc: 1.00 },
  { x: 0.02, y: 0.14, hue: 196, n: 5, z: -0.35, sc: 0.78 },
  { x: 1.04, y: 0.22, hue: 40,  n: 5, z: 0.65, sc: 0.74 },
  { x: 0.10, y: 0.86, hue: 262, n: 6, z: 0.10, sc: 0.80 },
  { x: 0.98, y: 0.80, hue: 152, n: 5, z: -0.55, sc: 0.76 },
  { x: 0.55, y: 1.16, hue: 58,  n: 4, z: 0.30, sc: 0.62 },
  { x: 0.60, y: -0.16, hue: 300, n: 4, z: -0.75, sc: 0.62 },
];

export const NeuralField = ({ props, style }: CompProps): React.ReactElement => {
  const ref = useRef<WebView>(null);

  // The page is built ONCE. Rebuilding it would throw away the baked plates
  // and re-lay the whole field, which is the one expensive thing here — so
  // the config is frozen on first render and everything after it is a
  // message. A server that changes the geometry does so with a cache bump,
  // which remounts the screen anyway.
  const html = useMemo(
    () => neuralFieldHtml({
      regions: Array.isArray(props?.regions) && props.regions.length ? props.regions : FALLBACK_REGIONS,
      alpha: Number(props?.alpha ?? 1),
      bloom: Number(props?.bloom ?? 0.44),
      focal: Number(props?.focal ?? 0.35),
      maxPulses: Number(props?.maxPulses ?? 700),
      signal: props?.signal ?? [232, 162, 60],
      head: props?.head ?? [255, 241, 214],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const state = String(props?.state ?? "idle");
  const training = props?.training === true || props?.training === "true";
  // Quantised, because the level arrives sixty times a second and the field
  // only reads it as a rate. Twenty steps is finer than the eye, and it turns
  // a flood of bridge messages into a trickle.
  const level = Math.round(Math.min(1, Math.max(0, Number(props?.level ?? 0))) * 20) / 20;

  useEffect(() => {
    ref.current?.injectJavaScript(
      `window.tz && window.tz(${JSON.stringify({ state, level, training })}); true;`,
    );
  }, [state, level, training]);

  return (
    <View style={[{ overflow: "hidden" }, style]} pointerEvents="none">
      <WebView
        ref={ref}
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
    </View>
  );
};
