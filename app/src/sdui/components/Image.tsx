/** Image: a picture from a URL or the media registry, framed on its focus point when it has one. */
import { StyleSheet, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { resolveMedia } from "../../media/resolveMedia";
import { useFocusFill } from "../../media/focusFill";
import * as K from "../knobs";
import type { CompProps } from "./props";

export const ImageC = ({ props, style }: CompProps) => {
  // Resolve the source through the media registry so both a raw URL string AND
  // a media-key spec ({ key: "card.voice" }) work — the old code fed
  // props.source straight into { uri }, so a { key } object produced a broken
  // image. Use expo-image so remote GIFs animate on both platforms and
  // contentFit ("cover" for a background fill, "contain" for a framed asset)
  // is honored.
  const m = resolveMedia(props.source as any);
  const src = m.kind === "uri" ? { uri: m.uri } : m.kind === "bundled" ? m.source : null;
  // Called unconditionally — it is a hook, and the early return for a missing
  // source is below it for that reason.
  const placed = useFocusFill(props);
  // Defaults, and ONLY where the caller left a gap.
  //
  // These used to be unconditional and merged UNDER the incoming style, which
  // meant `aspectRatio: 1.6` survived any style that set width and height but
  // not a ratio — and Yoga, holding a width and a ratio, derives the height
  // and ignores the one it was given. Every full-bleed image in the app came
  // out as a rounded 1.6 landscape strip cropped through its own middle: the
  // opening media, the flow clip, every hero. The style was correct and the
  // default quietly outranked it.
  const s = (StyleSheet.flatten(style as any) ?? {}) as Record<string, any>;
  // Four insets fix both dimensions, so the box is already fully described.
  const pinned =
    s.position === "absolute" &&
    (s.top != null || s.bottom != null) && (s.left != null || s.right != null);
  const base: Record<string, any> = {};
  if (s.width == null && !pinned) base.width = "100%";
  if (s.aspectRatio == null && s.height == null && !pinned) {
    base.aspectRatio = props.aspectRatio ?? K.num("ui.Image.aspectRatio", 1.6);
  }
  if (s.borderRadius == null) base.borderRadius = Number(props.radius ?? K.num("ui.Image.radius", 10));
  if (!src) return <View style={[base, style] as any} />;
  // FOCUS PLACEMENT, the same as Video. When the backend says where the
  // subject sits in the art and where it should land, the still is sized and
  // slid here rather than handed to `cover` and centred. Whether a subject
  // gets cut off the side of the screen has nothing to do with whether it
  // moves, so a still needs this exactly as much as a clip does — it was only
  // ever wired to Video because the first case that needed it was a film.
  if (placed.on) {
    return (
      <View style={[base, style, { overflow: "hidden" }] as any} onLayout={placed.onLayout}>
        {placed.fit ? (
          <ExpoImage
            source={src as any}
            contentFit="cover"
            style={{ position: "absolute", ...placed.fit }}
          />
        ) : null}
      </View>
    );
  }
  return <ExpoImage source={src as any} contentFit={props.contentFit ?? K.str("ui.Image.contentFit", "cover")} style={[base, style] as any} />;
};
