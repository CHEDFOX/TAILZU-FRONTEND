/**
 * Component registry — maps SDUI node `type`s to React Native components, plus
 * token-aware styling. The renderer (Renderer.tsx) resolves props/bind/style
 * and hands them to these.
 */
import React, { createContext, useContext, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  useAudioRecorder,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
} from "expo-audio";
import type { Node, NodeEvent, ThemeTokens } from "./types";
import { Store, getPath } from "./state";
import * as api from "../api";

/**
 * Display serif for headings (Plutto uses PlayfairDisplay). We use the platform
 * serif so it works with no bundled font; swap for @expo-google-fonts/playfair
 * later to match exactly. The backend can also override via theme.font.family.
 */
const SERIF = Platform.select({ ios: "Georgia", android: "serif", default: "serif" });

// --- Theme context ----------------------------------------------------------

export const ThemeContext = createContext<ThemeTokens | null>(null);
export const useTheme = (): ThemeTokens => {
  const t = useContext(ThemeContext);
  if (!t) throw new Error("ThemeContext missing");
  return t;
};

// --- Styling ----------------------------------------------------------------

/** Resolve a "$color.primary"-style token against the theme, else pass through. */
function tok(value: any, theme: ThemeTokens): any {
  if (typeof value === "string" && value.startsWith("$")) return getPath(theme, value.slice(1));
  return value;
}

const ALIGN: Record<string, any> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const JUSTIFY: Record<string, any> = {
  start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around",
};

export function resolveStyle(style: Record<string, any> | undefined, theme: ThemeTokens): any {
  if (!style) return {};
  const s = style;
  const out: Record<string, any> = {};
  if (s.flex != null) out.flex = s.flex;
  if (s.direction) out.flexDirection = s.direction;
  if (s.align) out.alignItems = ALIGN[s.align];
  if (s.justify) out.justifyContent = JUSTIFY[s.justify];
  if (s.wrap) out.flexWrap = "wrap";
  if (s.gap != null) out.gap = tok(s.gap, theme);
  if (s.padding != null) out.padding = tok(s.padding, theme);
  if (s.margin != null) out.margin = tok(s.margin, theme);
  if (s.width != null) out.width = tok(s.width, theme);
  if (s.height != null) out.height = tok(s.height, theme);
  if (s.opacity != null) out.opacity = s.opacity;
  if (s.background != null) out.backgroundColor = tok(s.background, theme);
  if (s.color != null) out.color = tok(s.color, theme);
  if (s.radius != null) out.borderRadius = tok(s.radius, theme);
  if (s.borderWidth != null) out.borderWidth = s.borderWidth;
  if (s.borderColor != null) out.borderColor = tok(s.borderColor, theme);
  if (s.fontSize != null) out.fontSize = tok(s.fontSize, theme);
  if (s.fontWeight != null) out.fontWeight = tok(s.fontWeight, theme);
  if (s.textAlign != null) out.textAlign = s.textAlign;
  return out;
}

function textVariant(variant: string | undefined, theme: ThemeTokens): any {
  const f = theme.font.sizes;
  const fam = theme.font.family ?? SERIF;
  switch (variant) {
    case "brand":
      return { fontFamily: fam, color: theme.color.text, fontSize: f.brand, lineHeight: 38, letterSpacing: 0.2 };
    case "h1":
      return { fontFamily: fam, color: theme.color.text, fontSize: f.h1, lineHeight: 34, letterSpacing: 0.3 };
    case "overline":
      return { color: theme.color.label, fontSize: f.overline, letterSpacing: 3, fontWeight: "500", textTransform: "uppercase", marginBottom: 10 };
    case "quote":
      return { fontFamily: fam, color: theme.color.muted ?? theme.color.text, fontSize: f.lg, lineHeight: 28, fontStyle: "italic" };
    case "label":
      return { color: theme.color.label, fontSize: f.label, letterSpacing: 1, marginBottom: 8 };
    case "muted":
      return { color: theme.color.muted, fontSize: f.body, lineHeight: 22 };
    case "caption":
      return { color: theme.color.muted, fontSize: f.caption };
    default: // body
      return { color: theme.color.body ?? theme.color.text, fontSize: f.body, lineHeight: 26, fontWeight: "300" };
  }
}

// --- Component props bag ----------------------------------------------------

export interface CompProps {
  node: Node;
  props: Record<string, any>;
  style: any;
  store: Store;
  children: React.ReactNode;
  fire: (event: NodeEvent, value?: any) => void;
}

// --- Components -------------------------------------------------------------

const Screen = ({ children, style }: CompProps) => {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.color.bg }}
      contentContainerStyle={[
        {
          paddingHorizontal: theme.space.content ?? theme.space.lg,
          paddingTop: theme.space.contentTop ?? theme.space.lg,
          paddingBottom: 120, // airy scroll buffer (clears the tab bar)
        },
        style,
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
};

const Stack = ({ children, style }: CompProps) => <View style={style}>{children}</View>;

const Spacer = ({ style }: CompProps) => <View style={style.height || style.width ? style : { flex: 1 }} />;

const TextC = ({ props, style }: CompProps) => {
  const theme = useTheme();
  return <Text style={[textVariant(props.variant, theme), style]}>{props.content ?? ""}</Text>;
};

const ImageC = ({ props, style }: CompProps) => (
  <Image source={{ uri: props.source }} style={[{ width: "100%", aspectRatio: props.aspectRatio ?? 1.6, borderRadius: 10 }, style]} />
);

const Icon = ({ props, style }: CompProps) => {
  const theme = useTheme();
  return <Text style={[{ fontSize: 20, color: theme.color.text }, style]}>{props.name}</Text>;
};

const Button = ({ props, style, fire }: CompProps) => {
  const theme = useTheme();
  const bg =
    props.variant === "danger" ? theme.color.danger :
    props.variant === "secondary" ? "#3a3a44" : theme.color.primary;
  return (
    <Pressable
      onPress={() => fire("onPress")}
      disabled={props.disabled}
      style={({ pressed }) => [
        { backgroundColor: bg, borderRadius: theme.radius.pill, paddingVertical: 16, alignItems: "center", opacity: props.disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 }}>{props.label}</Text>
    </Pressable>
  );
};

const TextField = ({ node, props, style, store, fire }: CompProps) => {
  const theme = useTheme();
  const bindPath = node.bind?.value;
  return (
    <TextInput
      value={String(props.value ?? "")}
      onChangeText={(t) => {
        if (bindPath) store.set(bindPath, t);
        fire("onChange", t);
      }}
      placeholder={props.placeholder}
      placeholderTextColor={theme.color.muted}
      multiline={props.multiline}
      autoCapitalize={props.autoCapitalize}
      autoCorrect={props.autoCorrect}
      style={[
        {
          backgroundColor: theme.color.inputBg, color: theme.color.text, borderRadius: theme.radius.md,
          paddingHorizontal: 12, paddingVertical: 10, minHeight: props.multiline ? 80 : 44,
          borderWidth: 1, borderColor: theme.color.border, textAlignVertical: props.multiline ? "top" : "center",
        },
        style,
      ]}
    />
  );
};

const Chip = ({ props, style, store, fire }: CompProps) => {
  const theme = useTheme();
  const selected = props.group ? store.get(props.group) === props.value : !!props.selected;
  return (
    <Pressable
      onPress={() => {
        if (props.group) store.set(props.group, props.value);
        fire("onPress");
      }}
      style={[
        {
          paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1,
          backgroundColor: selected ? theme.color.primary : theme.color.inputBg,
          borderColor: selected ? theme.color.primary : theme.color.border,
        },
        style,
      ]}
    >
      <Text style={{ color: selected ? "#fff" : theme.color.muted, fontWeight: selected ? "700" : "400" }}>{props.label}</Text>
    </Pressable>
  );
};

const Card = ({ children, style }: CompProps) => {
  const theme = useTheme();
  return (
    <View style={[{ backgroundColor: theme.color.card, borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: theme.color.border }, style]}>
      {children}
    </View>
  );
};

const Divider = ({ style }: CompProps) => {
  const theme = useTheme();
  return <View style={[{ height: 1, backgroundColor: theme.color.border, marginVertical: 8 }, style]} />;
};

const ProgressBar = ({ style }: CompProps) => {
  const theme = useTheme();
  return <ActivityIndicator color={theme.color.primary} style={style} />;
};

// List is rendered specially by the renderer (needs per-item scope); placeholder here.
const ListPlaceholder = ({ children }: CompProps) => <View>{children}</View>;

// --- SDUI v2 content blocks -------------------------------------------------

// Tiny uppercase kicker above a heading (the Plutto "overline").
const Overline = ({ props, style }: CompProps) => {
  const theme = useTheme();
  return <Text style={[{ color: theme.color.label, fontSize: theme.font.sizes.overline, letterSpacing: 3, fontWeight: "500", textTransform: "uppercase", marginBottom: 10 }, style]}>{props.content ?? ""}</Text>;
};

const Heading = ({ props, style }: CompProps) => {
  const theme = useTheme();
  const fam = theme.font.family ?? SERIF;
  return <Text style={[{ fontFamily: fam, color: theme.color.text, fontSize: theme.font.sizes.h1, lineHeight: 34, letterSpacing: 0.3, marginBottom: 24 }, style]}>{props.content ?? ""}</Text>;
};

const Paragraph = ({ props, style }: CompProps) => {
  const theme = useTheme();
  return <Text style={[{ color: theme.color.body ?? theme.color.text, fontSize: theme.font.sizes.body, lineHeight: 26, fontWeight: "300", marginBottom: 18 }, style]}>{props.content ?? ""}</Text>;
};

const Quote = ({ props, style }: CompProps) => {
  const theme = useTheme();
  const fam = theme.font.family ?? SERIF;
  return <Text style={[{ fontFamily: fam, color: theme.color.muted, fontSize: theme.font.sizes.lg, lineHeight: 28, fontStyle: "italic", textAlign: "center", marginVertical: 16 }, style]}>{props.content ?? ""}</Text>;
};

const Badge = ({ props, style }: CompProps) => {
  const theme = useTheme();
  const tone = props.tone === "accent" ? theme.color.primary : theme.color.label;
  return (
    <View style={[{ alignSelf: "flex-start", paddingHorizontal: 11, paddingVertical: 5, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: tone, marginBottom: 24 }, style]}>
      <Text style={{ color: tone, fontSize: theme.font.sizes.overline, fontWeight: "500", letterSpacing: 2.5, textTransform: "uppercase" }}>{props.label ?? ""}</Text>
    </View>
  );
};

const KeyValue = ({ props, style }: CompProps) => {
  const theme = useTheme();
  return (
    <View style={[{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.color.border }, style]}>
      <Text style={{ color: theme.color.muted, fontSize: theme.font.sizes.body }}>{props.label ?? ""}</Text>
      <Text style={{ color: theme.color.text, fontSize: theme.font.sizes.body, fontWeight: "600" }}>{props.value ?? ""}</Text>
    </View>
  );
};

const Hero = ({ props, style }: CompProps) => {
  const theme = useTheme();
  return (
    <View style={[{ borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: theme.color.card, borderWidth: 1, borderColor: theme.color.border, marginBottom: 12 }, style]}>
      {props.image ? (
        <Image source={{ uri: props.image }} style={{ width: "100%", height: 140 }} />
      ) : null}
      <View style={{ padding: 16 }}>
        {props.title ? <Text style={{ color: theme.color.text, fontSize: theme.font.sizes.h1, fontWeight: "800" }}>{props.title}</Text> : null}
        {props.subtitle ? <Text style={{ color: theme.color.muted, fontSize: theme.font.sizes.body, marginTop: 4 }}>{props.subtitle}</Text> : null}
      </View>
    </View>
  );
};

/**
 * VoiceButton — records the mic (expo-audio), uploads to /v1/transcribe-clean,
 * and writes the cleaned text to bind.value. A server-declared native capability
 * so the main app can dictate, not just the keyboard.
 */
const VoiceButton = ({ node, props, style, store, fire }: CompProps) => {
  const theme = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const bindPath = node.bind?.value;

  async function start() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        fire("onError", "Microphone permission denied");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e: any) {
      fire("onError", e?.message ?? "mic error");
    }
  }

  async function stop() {
    setRecording(false);
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("No audio captured");
      const { cleanedText } = await api.transcribeClean(uri, {
        targetApp: props.targetApp,
        language: props.language,
      });
      if (bindPath) store.set(bindPath, cleanedText);
      fire("onChange", cleanedText);
    } catch (e: any) {
      fire("onError", e?.message ?? "transcription failed");
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? (props.transcribingLabel ?? "Transcribing…")
    : recording
    ? (props.stopLabel ?? "■ Stop & transcribe")
    : (props.label ?? "🎙️ Record");
  const bg = recording ? theme.color.danger : theme.color.primary;

  return (
    <Pressable
      onPress={recording ? stop : start}
      disabled={busy}
      style={[
        { backgroundColor: bg, borderRadius: theme.radius.md, paddingVertical: 13, alignItems: "center", opacity: busy ? 0.6 : 1 },
        style,
      ]}
    >
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
};

export const REGISTRY: Record<string, React.ComponentType<CompProps>> = {
  Screen, Stack, Spacer, Text: TextC, Image: ImageC, Icon, Button,
  TextField, Chip, Card, Divider, ProgressBar, List: ListPlaceholder, VoiceButton,
  Overline, Heading, Paragraph, Quote, Badge, KeyValue, Hero,
};
