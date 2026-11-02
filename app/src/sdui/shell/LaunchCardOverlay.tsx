import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { RenderNode } from "../Renderer";
import { ThemeContext } from "../theme/ThemeContext";
import { Store } from "../state";
import type { Ctx, NavApi } from "../actions";
import type { LaunchCard, ThemeTokens } from "../types";
import { txt, num, color } from "../knobs";

/**
 * The card the app opens with — whatever the backend put in `launchCard`.
 *
 * This is the entire app-side of the feature, and it is deliberately thin: a
 * sheet, a scrim, and the ordinary renderer pointed at a node tree the server
 * wrote. Every card after this one is a backend change and nothing else.
 *
 * THE NAV IS THE TRICK. A card's button carries an ordinary `navigate` — the
 * same action any button anywhere carries — so nothing in the tree has to
 * know it is inside a card. The nav handed to it closes the card first and
 * then does the real thing, which is what stops a card being left hanging
 * over the screen it just sent you to. `dismiss` maps to nav.back, so inside
 * a card that is simply "close", with no separate action kind to learn.
 */
export function LaunchCardOverlay({
  card,
  theme,
  nav,
  flags,
  labels,
  toast,
  onClose,
}: {
  card: LaunchCard;
  theme: ThemeTokens;
  nav: NavApi;
  flags: Record<string, any>;
  labels: Record<string, string>;
  toast: (m: string, tone?: string) => void;
  onClose: () => void;
}) {
  const store = useMemo(() => new Store({}), [card.id]);
  const cardNav: NavApi = useMemo(() => ({
    push: (s, p) => { onClose(); nav.push(s, p); },
    replace: (s, p) => { onClose(); nav.replace(s, p); },
    // Inside a card, "back" is "close the card".
    back: onClose,
    switchTab: (t) => { onClose(); nav.switchTab(t); },
    reloadCurrent: nav.reloadCurrent,
    refreshLocale: nav.refreshLocale,
  }), [nav, onClose]);
  const ctx: Ctx = useMemo(
    () => ({ store, actions: {}, flags, labels, nav: cardNav, toast }),
    [store, flags, labels, cardNav, toast],
  );

  // ITS OWN PROVIDER. This overlay sits outside the one wrapped around the
  // screen — it has to, or it would unmount with every navigation — and every
  // node inside it reads the theme from context. Without this the first card
  // anyone published would throw "ThemeContext missing" on open, on every
  // install, and the feature would look like it had never worked.
  return (
    <ThemeContext.Provider value={theme}>
      <View style={[StyleSheet.absoluteFill, {
        alignItems: "center", justifyContent: "center", padding: 24,
      }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: card.backdrop ?? color("app.launchCard.backdrop", "rgba(4,4,6,0.72)") }]}
          onPress={card.dismissOnBackdrop === false ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel={txt("action.dismiss", "Dismiss")}
        />
        <View style={[
          {
            backgroundColor: theme.color.card, borderRadius: theme.radius.card,
            padding: num("app.launchCard.padding", 24), width: "100%", maxWidth: num("app.launchCard.maxWidth", 360),
          },
          card.sheet as any,
        ]}>
          <RenderNode node={card.root} ctx={ctx} />
        </View>
      </View>
    </ThemeContext.Provider>
  );
}
