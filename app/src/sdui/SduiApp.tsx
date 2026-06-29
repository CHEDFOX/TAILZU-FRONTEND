/**
 * The Tulmi app shell — a GENERIC renderer. It boots from the server, draws the
 * server's navigation + screens, and runs the server's actions. The only
 * client-local screen is Connection (you need it to reach the server at all).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  I18nManager,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Updates from "expo-updates";
import { bootstrap, fetchScreen, syncKeyboardCredentials, APP_VERSION } from "./client";
import { RenderNode } from "./Renderer";
import { ThemeContext } from "./components";
import { Store } from "./state";
import { composeTemplate } from "./templates";
import type { Ctx, NavApi } from "./actions";
import type { BootstrapResponse, ScreenResponse, ThemeTokens, UpdateGate } from "./types";
import { DEFAULT_BASE_URL, getBaseUrl, setBaseUrl } from "../storage";
import * as api from "../api";
import AuthGateScreen from "../auth/AuthGateScreen";
import { supabaseAuth } from "../auth/supabaseClient";
import { useEdgeSwipeBack, resolveEdgeSwipe } from "./gestures";
import { SUPABASE_CONFIGURED } from "../auth/supabaseConfig";

interface NavItem { screenId: string; params?: Record<string, any> }
interface Toast { message: string; tone?: string }

/**
 * Apply the layout direction the backend asked for (RTL for Arabic/Hebrew/…).
 * React Native only flips layout after a reload, so when the direction actually
 * changes we force it and restart the bundle. It's a no-op when already correct,
 * so this never loops.
 */
async function applyDirection(flags?: Record<string, any>): Promise<boolean> {
  const wantRTL = flags?.textDirection === "rtl";
  if (I18nManager.isRTL === wantRTL) return false;
  try {
    I18nManager.allowRTL(wantRTL);
    I18nManager.forceRTL(wantRTL);
    await Updates.reloadAsync(); // restart so the new direction takes effect
  } catch {
    // Expo Go / no updates runtime: direction applies on the next launch.
  }
  return true;
}

export default function SduiApp() {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "connect" | "auth">("loading");
  const [tabId, setTabId] = useState("");
  const [stack, setStack] = useState<NavItem[]>([]);
  const [screen, setScreen] = useState<ScreenResponse | null>(null);
  const [screenLoading, setScreenLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showConnection, setShowConnection] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  const showToast = useCallback((message: string, tone?: string) => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2800);
  }, []);

  const loadBoot = useCallback(async () => {
    setPhase("loading");
    try {
      const b = await bootstrap();
      // If the user's language flips the layout direction, this restarts the
      // app — so do it before we commit the rest of the boot state.
      if (await applyDirection(b.flags)) return;
      setBoot(b);
      const firstTab = b.navigation.kind === "tabs" ? b.navigation.tabs[0]?.id ?? "" : "";
      setTabId(firstTab);
      // The server owns onboarding: initialScreenId is "onboarding" until the
      // user's profile is marked onboarded, then "home".
      setStack([{ screenId: b.initialScreenId }]);
      setShowConnection(false);
      setPhase("ready");
      // Hand the keyboard the live backend URL + user token.
      void syncKeyboardCredentials();
    } catch {
      setPhase("connect");
    }
  }, []);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      // Gate on auth first: the app needs a JWT to talk to the backend.
      const { data: { session } } = await supabaseAuth.getSession();
      if (SUPABASE_CONFIGURED && !session) setPhase("auth");
      else await loadBoot();
      // React to sign-out from anywhere (e.g. Settings → Sign out).
      const { data: { subscription } } = supabaseAuth.onAuthStateChange((_e, s) => {
        if (!s && SUPABASE_CONFIGURED) setPhase("auth");
      });
      unsub = () => subscription.unsubscribe();
    })();
    return () => unsub();
  }, [loadBoot]);

  const current = stack[stack.length - 1];

  // Fetch the current screen whenever the top of the stack (or reload) changes.
  useEffect(() => {
    if (phase !== "ready" || !current) return;
    let alive = true;
    setScreenLoading(true);
    fetchScreen(current.screenId, current.params)
      .then((s) => alive && setScreen(s))
      .catch(() => alive && showToast("Couldn't load screen", "error"))
      .finally(() => alive && setScreenLoading(false));
    return () => {
      alive = false;
    };
  }, [phase, current, reload, showToast]);

  const nav: NavApi = useMemo(
    () => ({
      push: (screenId, params) => setStack((s) => [...s, { screenId, params }]),
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      switchTab: (id) => {
        if (boot?.navigation.kind !== "tabs") return;
        const tab = boot.navigation.tabs.find((t) => t.id === id);
        if (!tab) return;
        setTabId(id);
        setStack([{ screenId: tab.screenId }]);
      },
      reloadCurrent: () => setReload((n) => n + 1),
      refreshLocale: () => {
        // Re-pull bootstrap so labels + direction reflect the new language,
        // then re-fetch the current screen in place (stack is preserved).
        (async () => {
          try {
            const b = await bootstrap();
            if (await applyDirection(b.flags)) return; // RTL change → app restarts
            setBoot(b);
            setReload((n) => n + 1);
          } catch {
            /* keep current UI if the refresh fails */
          }
        })();
      },
    }),
    [boot],
  );

  const theme: ThemeTokens | null = useMemo(() => {
    if (!boot) return null;
    if (!screen?.theme) return boot.theme;
    return { ...boot.theme, color: { ...boot.theme.color, ...(screen.theme.color ?? {}) } };
  }, [boot, screen]);

  // Edge-swipe-back: a general, backend-driven capability (src/sdui/gestures).
  // Swiping right from the left edge pops the nav stack. Called unconditionally
  // (before any early return) so hook order stays stable; the zone only renders
  // when there's somewhere to go back to and the backend hasn't disabled it.
  const { edgeZone } = useEdgeSwipeBack(
    stack.length > 1 ? nav.back : null,
    resolveEdgeSwipe(boot?.flags),
  );

  // --- Render states --------------------------------------------------------

  if (phase === "auth") {
    return <AuthGateScreen onAuthed={loadBoot} />;
  }

  if (phase === "connect" || showConnection) {
    return (
      <ConnectionScreen
        onDone={loadBoot}
        onCancel={boot ? () => setShowConnection(false) : undefined}
      />
    );
  }

  if (phase === "loading" || !theme) {
    return (
      <View style={[styles.center, { backgroundColor: "#0e0e12" }]}>
        <ActivityIndicator color="#5b4bff" size="large" />
        <Text style={{ color: "#8a8a96", marginTop: 12 }}>Loading Tulmi…</Text>
      </View>
    );
  }

  const canGoBack = stack.length > 1;
  const tabs = boot?.navigation.kind === "tabs" ? boot.navigation.tabs : [];

  // Version gate: backend can force or suggest an app update.
  const update = boot?.update;
  const below = (v?: string) => !!v && cmpVersion(APP_VERSION, v) < 0;
  const updateForced = !!update && below(update.minVersion);
  const updateOptional = !updateForced && !!update && below(update.latestVersion) && !updateDismissed;

  return (
    <View style={[styles.app, { backgroundColor: theme.color.bg }]}>
      <View style={styles.header}>
        {canGoBack ? (
          <Pressable onPress={nav.back} hitSlop={10}>
            <Text style={[styles.headerIcon, { color: theme.color.text }]}>‹</Text>
          </Pressable>
        ) : (
          <Text style={[styles.brand, { color: theme.color.text }]}>{screen?.title ?? "Tulmi"}</Text>
        )}
        {canGoBack && <Text style={[styles.brand, { color: theme.color.text, flex: 1, marginLeft: 8 }]}>{screen?.title ?? ""}</Text>}
        <Pressable onPress={() => setShowConnection(true)} hitSlop={10}>
          <Text style={[styles.headerIcon, { color: theme.color.muted }]}>⚙</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        {screen ? (
          <ThemeContext.Provider value={theme}>
            <ScreenHost screen={screen} nav={nav} flags={boot?.flags ?? {}} labels={boot?.labels ?? {}} toast={showToast} />
          </ThemeContext.Provider>
        ) : (
          <View style={styles.center}><ActivityIndicator color={theme.color.primary} /></View>
        )}
        {screenLoading && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color={theme.color.primary} />
          </View>
        )}
      </View>

      {tabs.length > 0 && (
        <View style={[styles.tabs, { backgroundColor: theme.color.surface, borderTopColor: theme.color.border }]}>
          {tabs.map((t) => {
            const active = t.id === tabId;
            return (
              <Pressable key={t.id} style={styles.tab} onPress={() => nav.switchTab(t.id)}>
                <Text style={{ color: active ? theme.color.text : theme.color.muted, fontWeight: active ? "700" : "400" }}>
                  {t.title}
                </Text>
                {active && <View style={[styles.tabUnderline, { backgroundColor: theme.color.primary }]} />}
              </Pressable>
            );
          })}
        </View>
      )}

      {toast && (
        <View style={[styles.toast, { backgroundColor: toast.tone === "error" ? "#3a1417" : toast.tone === "success" ? "#13301a" : "#1c1c25" }]}>
          <Text style={{ color: "#fff" }}>{toast.message}</Text>
        </View>
      )}

      {(updateForced || updateOptional) && update && (
        <UpdateGateOverlay
          info={update}
          forced={updateForced}
          theme={theme}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}

      {/* Backend-driven edge-swipe-back zone (left edge). Rendered last so it
          sits above the screen content; null when there's no back / disabled. */}
      {edgeZone}
    </View>
  );
}

/** Compare dotted versions: returns <0, 0, >0. */
function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Backend-driven update screen: a hard blocker (forced) or a dismissible nudge. */
function UpdateGateOverlay({
  info,
  forced,
  theme,
  onDismiss,
}: {
  info: UpdateGate;
  forced: boolean;
  theme: ThemeTokens;
  onDismiss: () => void;
}) {
  const storeUrl = info.url?.[Platform.OS === "ios" ? "ios" : "android"] ?? info.url?.default;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(8,8,12,0.96)", alignItems: "center", justifyContent: "center", padding: 28 }]}>
      <Text style={{ color: theme.color.text, fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 10 }}>
        {info.title ?? "Update Tulmi"}
      </Text>
      <Text style={{ color: theme.color.muted, fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 22 }}>
        {info.message ?? "A new version is available."}
      </Text>
      <Pressable
        onPress={() => storeUrl && Linking.openURL(storeUrl)}
        style={{ backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingVertical: 14, paddingHorizontal: 28, minWidth: 200, alignItems: "center" }}
      >
        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{info.cta ?? "Update now"}</Text>
      </Pressable>
      {!forced && (
        <Pressable onPress={onDismiss} style={{ marginTop: 14 }}>
          <Text style={{ color: theme.color.muted }}>Not now</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Builds the per-screen Store + Ctx and renders the node tree. */
function ScreenHost({
  screen,
  nav,
  flags,
  labels,
  toast,
}: {
  screen: ScreenResponse;
  nav: NavApi;
  flags: Record<string, any>;
  labels: Record<string, string>;
  toast: (m: string, tone?: string) => void;
}) {
  const store = useMemo(() => new Store(screen.state ?? {}), [screen]);
  const ctx: Ctx = { store, actions: screen.actions ?? {}, flags, labels, nav, toast };
  // A screen is either a full `root` tree, or a named `template` + `blocks`.
  const root = screen.root ?? composeTemplate(screen);
  return <RenderNode node={root} ctx={ctx} />;
}

// --- Connection (client-local; needed to reach the server) ------------------

function ConnectionScreen({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [url, setUrl] = useState(DEFAULT_BASE_URL);
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getBaseUrl().then((u) => {
      setUrl(u);
      setLoaded(true);
    });
  }, []);

  async function test() {
    setStatus("Checking…");
    try {
      await setBaseUrl(url);
      const h = await api.health();
      setStatus(`OK — ${h.service} v${h.version}`);
    } catch (e: any) {
      setStatus("Cannot reach backend: " + e.message);
    }
  }

  async function connect() {
    await setBaseUrl(url);
    onDone();
  }

  return (
    <View style={[styles.app, { backgroundColor: "#0e0e12", padding: 16, paddingTop: 64 }]}>
      <Text style={[styles.brand, { color: "#fff", marginBottom: 16 }]}>Connection</Text>
      <Text style={{ color: "#cfcfe0", marginBottom: 6 }}>Backend URL</Text>
      <TextInput
        value={loaded ? url : ""}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="http://10.0.2.2:8770 or https://your-vps"
        placeholderTextColor="#8a8a96"
        style={styles.input}
      />
      <Text style={{ color: "#8a8a96", fontSize: 13, marginTop: 8 }}>
        Emulator → your PC = http://10.0.2.2:8770. Physical phone → your PC's LAN IP, or your VPS URL.
      </Text>
      <View style={{ height: 16 }} />
      <Pressable style={[styles.btn, { backgroundColor: "#5b4bff" }]} onPress={connect}>
        <Text style={styles.btnText}>Connect</Text>
      </Pressable>
      <View style={{ height: 8 }} />
      <Pressable style={[styles.btn, { backgroundColor: "#3a3a44" }]} onPress={test}>
        <Text style={styles.btnText}>Test connection</Text>
      </Pressable>
      {onCancel && (
        <>
          <View style={{ height: 8 }} />
          <Pressable style={[styles.btn, { backgroundColor: "transparent" }]} onPress={onCancel}>
            <Text style={[styles.btnText, { color: "#8a8a96" }]}>Cancel</Text>
          </Pressable>
        </>
      )}
      {!!status && <Text style={{ color: "#9b9bd0", marginTop: 12 }}>{status}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16 },
  brand: { fontSize: 22, fontWeight: "800" },
  headerIcon: { fontSize: 24, fontWeight: "700" },
  tabs: { flexDirection: "row", borderTopWidth: 1 },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabUnderline: { height: 2, width: 28, borderRadius: 2, marginTop: 6 },
  loadingOverlay: { position: "absolute", top: 8, right: 16 },
  toast: { position: "absolute", left: 16, right: 16, bottom: 76, padding: 14, borderRadius: 10 },
  input: {
    backgroundColor: "#1c1c25", color: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 44, borderWidth: 1, borderColor: "#2a2a36",
  },
  btn: { borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
