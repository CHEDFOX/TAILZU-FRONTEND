/**
 * App-wide error boundary.
 *
 * The SDUI renderer walks backend-supplied trees; a single unexpected throw in
 * any node's render/effect would otherwise unwind to the root and leave the
 * user staring at a blank/white screen with no way out. This boundary catches
 * that, reports it, and shows a minimal recover-in-place UI (Try again) plus a
 * cache-reset escape hatch so a bad cached screen can't wedge the app forever.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
// Knobs are safe this high up: the module depends on nothing, and before any
// bootstrap has landed each call simply returns its fallback. App.tsx points
// them at the last server's values from disk before this ever renders.
import { bool, color, num, txt } from "./knobs";

// Optional Sentry — the app already env-gates it elsewhere. require() so a
// missing module (Expo Go) doesn't hard-fail the bundle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sentry: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Sentry = require("@sentry/react-native");
} catch { /* absent — fine */ }

type Props = {
  children: React.ReactNode;
  /** Called when the user taps "Reset" — e.g. clear the SDUI cache + reboot. */
  onReset?: () => void;
};
type State = { error: Error | null; stack?: string };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error("[Tailzu][ErrorBoundary]", error, info?.componentStack);
    // Keep the first few frames for the on-screen detail. The component stack
    // names the node that threw, which is the one thing a screenshot of this
    // screen could never tell us before.
    const frames = (info?.componentStack ?? "")
      .split("\n").map((l) => l.trim()).filter(Boolean).slice(0, num("errorBoundary.stackFrames", 4)).join(" › ");
    if (frames) this.setState((st) => ({ ...st, stack: frames }));
    try { Sentry?.captureException?.(error); } catch { /* reporting is best-effort */ }
  }

  private retry = () => this.setState({ error: null });

  private reset = () => {
    this.setState({ error: null });
    try { this.props.onReset?.(); } catch { /* ignore */ }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const bg = color("errorBoundary.bg", "#0e0e12");
    return (
      <View style={{ flex: 1, backgroundColor: bg, alignItems: "center", justifyContent: "center", padding: num("errorBoundary.padding", 32) }}>
        <Text style={{ color: color("errorBoundary.titleColor", "#FFFFFF"), fontSize: num("errorBoundary.titleSize", 20), fontWeight: "600", marginBottom: 10, textAlign: "center" }}>
          {txt("errorBoundary.title", "Something went wrong")}
        </Text>
        <Text style={{ color: color("errorBoundary.bodyColor", "rgba(255,255,255,0.6)"), fontSize: num("errorBoundary.bodySize", 15), lineHeight: 22, textAlign: "center", marginBottom: 16 }}>
          {txt("errorBoundary.body", "The screen hit an unexpected error. You can try again, or reset if it keeps happening.")}
        </Text>
        {/*
          SHOW WHAT BROKE.

          This screen used to say only "something went wrong", which meant a
          crash on a tester's device carried no information at all — the person
          holding the phone could not tell us what happened and neither could a
          screenshot. One line of message and the first frames of the stack turn
          an unreproducible report into a fixable one.

          Selectable so it can be copied out, capped so a long stack cannot push
          the buttons off screen, and low-contrast so it reads as diagnostics
          rather than as part of the apology.
        */}
        {/* The server may hide the raw detail (a release audience), in which
            case the gap it leaves is kept so the buttons do not jump. */}
        {bool("errorBoundary.showDetails", true) ? (
          <Text
            selectable
            numberOfLines={num("errorBoundary.detailLines", 6)}
            style={{
              color: color("errorBoundary.detailColor", "rgba(255,255,255,0.38)"),
              fontSize: num("errorBoundary.detailSize", 11.5), lineHeight: 17,
              textAlign: "center", marginBottom: 26, fontVariant: ["tabular-nums"],
            }}
          >
            {String(this.state.error?.message ?? this.state.error ?? "unknown")}
            {this.state.stack ? `\n${this.state.stack}` : ""}
          </Text>
        ) : <View style={{ height: 10 }} />}
        <Pressable
          onPress={this.retry}
          accessibilityRole="button"
          style={{
            backgroundColor: color("errorBoundary.accent", "#E8A23C"),
            paddingHorizontal: 28, paddingVertical: 13,
            borderRadius: num("errorBoundary.buttonRadius", 26), marginBottom: 14,
          }}
        >
          <Text style={{ color: color("errorBoundary.buttonText", "#0e0e12"), fontSize: num("errorBoundary.buttonTextSize", 16), fontWeight: "600" }}>
            {txt("errorBoundary.retry", "Try again")}
          </Text>
        </Pressable>
        <Pressable onPress={this.reset} accessibilityRole="button" style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
          <Text style={{ color: color("errorBoundary.resetColor", "rgba(255,255,255,0.5)"), fontSize: num("errorBoundary.resetSize", 14) }}>
            {txt("errorBoundary.reset", "Reset the app")}
          </Text>
        </Pressable>
      </View>
    );
  }
}
