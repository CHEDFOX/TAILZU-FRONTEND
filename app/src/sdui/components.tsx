/**
 * Component registry — maps SDUI node `type`s to React Native components, plus
 * token-aware styling. The renderer (Renderer.tsx) resolves props/bind/style
 * and hands them to these.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
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
import { isStreamAvailable, startStream, type LiveSession } from "../../modules/tulmi-stream";
import { VoiceToggle, RefineButton, DraftButton } from "./morphControls";

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

/**
 * Title Case: capitalize the first letter of every word, leaving the rest as-is
 * (so contractions/acronyms aren't mangled). Applied to app COPY only — never to
 * user-entered or bound/dynamic text (see staticText).
 */
function titleCase(s: string): string {
  return s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
/** Title-case static copy, but pass bound/dynamic text (user data) through untouched. */
function staticText(node: Node, raw: string): string {
  return node.bind?.content != null ? raw : titleCase(raw);
}

/** Resolve a "$color.primary"-style token against the theme, else pass through. */
function tok(value: any, theme: ThemeTokens): any {
  if (typeof value === "string" && value.startsWith("$")) return getPath(theme, value.slice(1));
  return value;
}

/**
 * Black or white, whichever reads on `bg` — so a white button gets dark text
 * and a dark button gets white. Lets the backend set any primary color (white
 * for the app's white buttons, or the sacred orange) without breaking labels.
 */
function readableOn(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((bg || "").trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#000000" : "#ffffff";
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
  // Positioning + insets + per-side spacing — lets the backend lay out overlays
  // (e.g. the voice toggle pinned to the type box's right edge) declaratively.
  if (s.position) out.position = s.position;
  if (s.top != null) out.top = tok(s.top, theme);
  if (s.right != null) out.right = tok(s.right, theme);
  if (s.bottom != null) out.bottom = tok(s.bottom, theme);
  if (s.left != null) out.left = tok(s.left, theme);
  if (s.zIndex != null) out.zIndex = s.zIndex;
  if (s.alignSelf) out.alignSelf = ALIGN[s.alignSelf] ?? s.alignSelf;
  if (s.overflow) out.overflow = s.overflow;
  if (s.minHeight != null) out.minHeight = tok(s.minHeight, theme);
  if (s.minWidth != null) out.minWidth = tok(s.minWidth, theme);
  if (s.maxWidth != null) out.maxWidth = tok(s.maxWidth, theme);
  for (const k of ["marginTop", "marginBottom", "marginLeft", "marginRight", "marginHorizontal", "marginVertical",
                   "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "paddingHorizontal", "paddingVertical"]) {
    if (s[k] != null) out[k] = tok(s[k], theme);
  }
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

const TextC = ({ node, props, style }: CompProps) => {
  const theme = useTheme();
  return <Text style={[textVariant(props.variant, theme), style]}>{staticText(node, props.content ?? "")}</Text>;
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
  const isSecondary = props.variant === "secondary";
  const bg =
    props.variant === "danger" ? theme.color.danger :
    isSecondary ? "#3a3a44" : theme.color.primary;
  // Secondary stays white text on its dark chip; primary/danger auto-contrast so
  // a white button reads with black text (and orange/dark with white).
  const labelColor = isSecondary ? "#fff" : readableOn(bg);
  return (
    <Pressable
      onPress={() => fire("onPress")}
      disabled={props.disabled}
      style={({ pressed }) => [
        { backgroundColor: bg, borderRadius: theme.radius.pill, paddingVertical: 16, alignItems: "center", opacity: props.disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <Text style={{ color: labelColor, fontWeight: "700", fontSize: 15, letterSpacing: 0.5 }}>{titleCase(props.label ?? "")}</Text>
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
      <Text style={{ color: selected ? readableOn(theme.color.primary) : theme.color.muted, fontWeight: selected ? "700" : "400" }}>{titleCase(props.label ?? "")}</Text>
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
const Overline = ({ node, props, style }: CompProps) => {
  const theme = useTheme();
  return <Text style={[{ color: theme.color.label, fontSize: theme.font.sizes.overline, letterSpacing: 3, fontWeight: "500", textTransform: "uppercase", marginBottom: 10 }, style]}>{staticText(node, props.content ?? "")}</Text>;
};

const Heading = ({ node, props, style }: CompProps) => {
  const theme = useTheme();
  const fam = theme.font.family ?? SERIF;
  return <Text style={[{ fontFamily: fam, color: theme.color.text, fontSize: theme.font.sizes.h1, lineHeight: 34, letterSpacing: 0.3, marginBottom: 24 }, style]}>{staticText(node, props.content ?? "")}</Text>;
};

const Paragraph = ({ node, props, style }: CompProps) => {
  const theme = useTheme();
  return <Text style={[{ color: theme.color.body ?? theme.color.text, fontSize: theme.font.sizes.body, lineHeight: 26, fontWeight: "300", marginBottom: 18 }, style]}>{staticText(node, props.content ?? "")}</Text>;
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
 * VoiceButton — dictation for the main app, written to bind.value.
 *
 * Two modes, picked by the server:
 *   • Live (props.live === true, native module present): streams mic audio over
 *     a WebSocket and fills the field word-by-word as you speak. See STREAMING.md.
 *   • File-based (default / fallback): records the mic (expo-audio), uploads to
 *     /v1/transcribe-clean, writes the cleaned text once.
 *
 * Live falls back to file-based automatically if the native module is missing.
 */
const VoiceButton = ({ node, props, style, store, fire }: CompProps) => {
  const theme = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const bindPath = node.bind?.value;

  // Live (streaming) session + the text committed so far this dictation.
  const live = useRef<{ session: LiveSession | null; committed: string }>({
    session: null,
    committed: "",
  });
  const wantLive = props.live === true && isStreamAvailable();

  async function startLive() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        fire("onError", "Microphone permission denied");
        return;
      }
      const { url, token } = await api.streamConfig();
      live.current.committed = "";
      setRecording(true);
      const write = (text: string) => {
        if (bindPath) store.set(bindPath, text);
      };
      live.current.session = startStream(
        { url, token, targetApp: props.targetApp, language: props.language },
        {
          onPartial: (t) => write(live.current.committed + t),
          onFinal: (t) => {
            live.current.committed += t.endsWith(" ") ? t : `${t} `;
            write(live.current.committed);
          },
          onError: (m) => {
            fire("onError", m);
            endLive();
          },
          onClosed: async () => {
            endLive();
            const raw = live.current.committed.trim();
            write(raw);
            fire("onChange", raw);
            if (!raw) return;
            // Auto-refine: the raw dictation shows live, then is replaced by the
            // backend's cleaned-up version — no manual "Refine" step.
            try {
              setBusy(true);
              const { refinedText } = await api.refine(raw, {
                targetApp: props.targetApp,
                language: props.language,
              });
              const finalText = refinedText?.trim() || raw;
              write(finalText);
              fire("onChange", finalText);
            } catch {
              // keep the raw transcript if refine fails
            } finally {
              setBusy(false);
            }
          },
        },
      );
    } catch (e: any) {
      fire("onError", e?.message ?? "mic error");
      endLive();
    }
  }

  function stopLive() {
    setBusy(true);
    live.current.session?.stop();
  }

  function endLive() {
    setRecording(false);
    setBusy(false);
    live.current.session = null;
  }

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

  const onPress = wantLive
    ? recording
      ? stopLive
      : startLive
    : recording
    ? stop
    : start;

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={[
        { backgroundColor: bg, borderRadius: theme.radius.md, paddingVertical: 13, alignItems: "center", opacity: busy ? 0.6 : 1 },
        style,
      ]}
    >
      <Text style={{ color: recording ? "#fff" : readableOn(theme.color.primary), fontWeight: "700", fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
};

/**
 * LanguageGreetingGrid — Plutto-style language picker: a large serif greeting
 * that rotates through each language's own "hello", over a centered grid of
 * hairline pills. Pure Animated (no native deps) → ships over OTA.
 *
 * Backend node: { type:"LanguageGreetingGrid", bind:{ value:"language" },
 *   props:{ items:[{ value, label, greeting }] },
 *   on:{ onChange:<set state>, onSubmit:<save + navigate> } }
 * `onSubmit` lets a tap proceed immediately (like Plutto); omit it to keep a
 * separate Continue button. Falls back to a built-in list if items is absent.
 */
const LANG_GREETINGS_FALLBACK = [
  { value: "en", label: "English", greeting: "Hello" },
  { value: "hi", label: "Hindi", greeting: "नमस्ते" },
  { value: "hinglish", label: "Hinglish", greeting: "Namaste" },
  { value: "es", label: "Spanish", greeting: "Hola" },
  { value: "fr", label: "French", greeting: "Bonjour" },
  { value: "ar", label: "Arabic", greeting: "مرحبا" },
  { value: "pt", label: "Portuguese", greeting: "Olá" },
  { value: "auto", label: "Auto-detect", greeting: "Welcome" },
];

const LanguageGreetingGrid = ({ node, props, store, fire }: CompProps) => {
  const theme = useTheme();
  const items: Array<{ value: string; label: string; greeting?: string }> =
    Array.isArray(props.items) && props.items.length ? props.items : LANG_GREETINGS_FALLBACK;
  const bindPath = node.bind?.value;
  const greetings = items.map((i) => i.greeting).filter(Boolean) as string[];

  const [gi, setGi] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [fade]);

  useEffect(() => {
    if (greetings.length < 2) return;
    const id = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 280, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        setGi((p) => (p + 1) % greetings.length);
        Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
      });
    }, 2500);
    return () => clearInterval(id);
  }, [greetings.length, fade]);

  const select = (value: string) => {
    if (bindPath) store.set(bindPath, value);
    fire("onChange", value);
    fire("onSubmit", value); // backend may map → save + navigate (Plutto proceeds on tap)
  };

  const white = theme.color.text ?? "rgba(255,255,255,0.96)";
  const hair = theme.color.hairline ?? "rgba(255,255,255,0.12)";
  const fam = theme.font?.family ?? SERIF;

  return (
    <View style={{ alignItems: "center", paddingVertical: 28 }}>
      <Animated.Text
        style={{
          fontFamily: fam, fontSize: 46, fontWeight: "300", color: white,
          textAlign: "center", letterSpacing: 0.2, marginBottom: 40, opacity: fade,
        }}
      >
        {greetings.length ? greetings[gi % greetings.length] : "Hello"}
      </Animated.Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
        {items.map((l) => (
          <Pressable
            key={l.value}
            onPress={() => select(l.value)}
            style={({ pressed }) => ({
              minWidth: 104, height: 52, borderRadius: 26, borderWidth: 0.5, borderColor: hair,
              alignItems: "center", justifyContent: "center", paddingHorizontal: 18,
              opacity: pressed ? 0.55 : 1,
            })}
          >
            <Text style={{ color: white, fontSize: 15, fontWeight: "300", letterSpacing: 0.5 }}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

/**
 * Row — a tappable settings/list row: label on the left, an optional value +
 * chevron on the right, separated by a hairline. `danger` tints the label (e.g.
 * Delete account). Fires onPress.
 */
const Row = ({ props, style, fire }: CompProps) => {
  const theme = useTheme();
  const danger = !!props.danger;
  const showChevron = props.chevron !== false;
  return (
    <Pressable
      onPress={() => fire("onPress")}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 17,
          borderBottomWidth: props.divider === false ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.color.border,
          opacity: pressed ? 0.55 : 1,
        },
        style,
      ]}
    >
      <Text style={{ flex: 1, color: danger ? theme.color.danger : theme.color.text, fontSize: 16, fontWeight: "400" }}>
        {props.label}
      </Text>
      {props.value ? <Text style={{ color: theme.color.muted, fontSize: 15, marginRight: showChevron ? 8 : 0 }}>{props.value}</Text> : null}
      {showChevron ? <Text style={{ color: theme.color.muted, fontSize: 20, marginTop: -2 }}>›</Text> : null}
    </Pressable>
  );
};

/**
 * Pager — horizontal, full-width paged swipe between child "pages" (e.g. the
 * Refine and Reply playgrounds on Home). On arrival it gives a one-time peek
 * nudge (scrolls a touch and springs back) so the user knows there's more to
 * the side, and shows page dots. Pure RN ScrollView — no extra deps.
 */
const Pager = ({ children, props }: CompProps) => {
  const { width } = useWindowDimensions();
  const ref = useRef<ScrollView>(null);
  const [idx, setIdx] = useState(0);
  const pages = React.Children.toArray(children);
  const hint = props.hint !== false && pages.length > 1;
  const peek = Number(props.peek) || 42;
  // A real spring-driven nudge (not a flat scroll): the page physically slides a
  // little to reveal the next section, then settles back with a soft bounce —
  // so the swipe is discoverable. Drives the ScrollView offset via a listener.
  const nudge = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!hint) return;
    const sub = nudge.addListener(({ value }) => ref.current?.scrollTo({ x: value, animated: false }));
    const t = setTimeout(() => {
      Animated.sequence([
        Animated.spring(nudge, { toValue: peek, friction: 6, tension: 70, useNativeDriver: false }),
        Animated.spring(nudge, { toValue: 0, friction: 7, tension: 55, useNativeDriver: false }),
      ]).start(() => nudge.removeListener(sub));
    }, 650);
    return () => { clearTimeout(t); nudge.removeListener(sub); };
  }, [hint, peek, nudge]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))}
      >
        {pages.map((p, i) => (
          <View key={i} style={{ width }}>{p}</View>
        ))}
      </ScrollView>
      {pages.length > 1 && (
        <View style={styles_dots.row} pointerEvents="none">
          {pages.map((_, i) => (
            <View key={i} style={[styles_dots.dot, { backgroundColor: i === idx ? "#fff" : "rgba(255,255,255,0.28)" }]} />
          ))}
        </View>
      )}
    </View>
  );
};

const styles_dots = {
  row: { position: "absolute" as const, bottom: 12, left: 0, right: 0, flexDirection: "row" as const, justifyContent: "center" as const, gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3 },
};

export const REGISTRY: Record<string, React.ComponentType<CompProps>> = {
  Screen, Stack, Spacer, Text: TextC, Image: ImageC, Icon, Button,
  TextField, Chip, Card, Divider, ProgressBar, List: ListPlaceholder, VoiceButton,
  Overline, Heading, Paragraph, Quote, Badge, KeyValue, Hero,
  LanguageGreetingGrid, VoiceToggle, RefineButton, DraftButton, Pager, Row,
};
