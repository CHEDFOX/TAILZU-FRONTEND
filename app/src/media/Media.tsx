/**
 * Universal <Media> — renders a MediaSpec regardless of source (backend URL,
 * bundled asset, emoji, data URI, SVG).
 *
 * Use this instead of raw <Image> anywhere backend might swap the asset:
 *
 *   <Media spec={{ key: "brand.mark" }}  style={{ width: 44, height: 44 }} />
 *   <Media spec={{ url: "https://..." }} style={styles.avatar} />
 *   <Media spec="media:brand.mark"        style={...} />
 *   <Media spec={{ emoji: "🎙️" }}         style={{ fontSize: 22 }} />
 *
 * Fallback shape: when the spec resolves to nothing (missing key, broken URL,
 * unknown asset) the render is null — callers can wrap the component in a
 * default:
 *
 *   <View style={styles.slot}>
 *     <Media spec={brandMarkSpec} style={styles.slotIcon} />
 *     <Text style={styles.slotFallback}>T</Text>  // shows if <Media> renders nothing
 *   </View>
 *
 * SVG handling — expo-image v2+ supports SVG natively, so we just pass the
 * URI through. If a stricter/animated SVG renderer is needed, swap in
 * react-native-svg's <SvgUri> for isSvg() specs.
 */
import React from "react";
import { Image as RNImage, Text, StyleProp, TextStyle, ImageStyle, ViewStyle } from "react-native";
import { Image as ExpoImage, ImageContentFit } from "expo-image";
import { resolveMedia, MediaSpec, isSvg } from "./resolveMedia";

type Props = {
  spec: MediaSpec | null | undefined;
  /** Image dimensions + positioning (also used to size an emoji). */
  style?: StyleProp<ImageStyle | ViewStyle>;
  /** How the image fits its box. Matches expo-image's contentFit. */
  contentFit?: ImageContentFit;
  /** Tint color — applied to bundled assets + template-rendered images.
   * URL-hosted PNGs render their own colors regardless. */
  tintColor?: string;
  /** Fired once when the image bytes are loaded. */
  onLoad?: () => void;
  /** Fired if the fetch/decode fails. Use to render a fallback tile. */
  onError?: () => void;
  /** Test id passthrough. */
  testID?: string;
  /** Accessibility label — screen readers announce this. */
  accessibilityLabel?: string;
};

export function Media(props: Props): React.ReactElement | null {
  const { spec, style, contentFit = "contain", tintColor, onLoad, onError, testID, accessibilityLabel } = props;
  const resolved = resolveMedia(spec);

  if (resolved.kind === "empty") return null;

  if (resolved.kind === "emoji") {
    return (
      <Text style={style as StyleProp<TextStyle>} testID={testID} accessibilityLabel={accessibilityLabel}>
        {resolved.glyph}
      </Text>
    );
  }

  if (resolved.kind === "bundled") {
    return (
      <RNImage
        source={resolved.source}
        style={style as StyleProp<ImageStyle>}
        resizeMode={contentFit === "contain" ? "contain" : contentFit === "cover" ? "cover" : "stretch"}
        tintColor={tintColor as string | undefined}
        onLoad={onLoad}
        onError={onError}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }

  // URI path — expo-image handles disk caching, prefetch, SVG, GIFs, and
  // transitions. Suits everything we ship from the backend media store.
  return (
    <ExpoImage
      source={{ uri: resolved.uri }}
      style={style}
      contentFit={contentFit}
      tintColor={tintColor}
      onLoad={onLoad}
      onError={onError}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      cachePolicy="disk"
      transition={120}
    />
  );
}

/** Convenience for the (very common) case of an emoji-or-image icon slot. */
export function MediaIcon(props: Props): React.ReactElement | null {
  return <Media contentFit="contain" {...props} />;
}

/** True when a spec would render as SVG — callers that need an animated /
 * styled SVG renderer (react-native-svg <SvgUri>) can check this and branch. */
export { isSvg };
