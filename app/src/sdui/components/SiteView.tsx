/**
 * SiteView: a real site, signed in on this phone (the server's shared/types/sdui.ts SITE_VIEW; decisions in siteViewCore.ts).
 *
 * Two modes:
 *   signin  the site's own sign-in page, full size, in a WebView that KEEPS what the site sets — so the person signs in once,
 *           with their own keyboard and the SMS code filling itself in, and stays signed in here as any browser would. When
 *           the sign-in has given way to a signed-in page it fires onComplete { site, url }: a host name, never a session.
 *   read    unseen: opens a page of that site with the session already here, reads it by the server's own walk, and fires
 *           onResult with the words. The server makes the card. Nothing of the session leaves the phone, in either mode.
 *
 * Unlike LiveView this WebView is NOT incognito, and that is the point: a sign-in nobody keeps is a sign-in every time. It
 * is still held to the site — the page itself may go only to the site's hosts and the sign-in pages it hands off to — and
 * the current address is always shown, so what somebody is typing into is never a surprise.
 *
 * The scripts are the server's (its src/sites/phone.ts), passed in the props, so how a page is read changes when the server
 * deploys. Every message back is untrusted: a page's own scripts can post here too, so it is parsed and capped, and the most
 * a lying page can do is fake a read of itself for the one person looking at it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { CompProps } from "./props";
import { freshSignIn, hostAllowed, parseSiteMessage, pressed, signInStep, siteViewOf, wrapScript, type SignInState } from "./siteViewCore";
import * as K from "../knobs";

/** How often a sign-in page is looked at: drawers animate in, and single-page sites change without a load. */
const LOOK_EVERY_MS = 2000;
/** How long a read waits after the page loads for a single-page site to draw its content. */
const READ_SETTLE_MS = 2500;
/** A read that has said nothing by now has failed. */
const READ_GIVE_UP_MS = 25_000;

const hostOf = (u: string): string => { try { return new URL(u).hostname; } catch { return ""; } };

export function SiteView({ props, style, fire }: CompProps) {
  const p = useMemo(() => siteViewOf(props as Record<string, unknown>), [props]);
  const ref = useRef<WebView>(null);
  const [uri, setUri] = useState(p?.url ?? "");
  const [here, setHere] = useState(p?.url ?? "");
  const [loading, setLoading] = useState(true);
  const sign = useRef<SignInState>(freshSignIn());
  const sent = useRef(false);
  const ink = K.color("ui.SiteView.text", "#0A0A0A");
  const meta = K.color("ui.SiteView.meta", "#5C5C5C");

  const run = useCallback((kind: "shape" | "login" | "read") => {
    if (!p) return;
    const js = kind === "shape" ? p.scripts.shape : kind === "login" ? p.scripts.findLogin : p.scripts.read;
    ref.current?.injectJavaScript(wrapScript(kind, js));
  }, [p]);

  // SIGN-IN: look at the page every couple of seconds until they are through.
  useEffect(() => {
    if (!p || p.mode !== "signin") return;
    const t = setInterval(() => { if (!sign.current.done) run("shape"); }, LOOK_EVERY_MS);
    return () => clearInterval(t);
  }, [p, run]);

  // READ: one read, or an error — never a page left open waiting.
  useEffect(() => {
    if (!p || p.mode !== "read") return;
    const t = setTimeout(() => { if (!sent.current) { sent.current = true; fire("onError", "timeout"); } }, READ_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [p, fire]);

  const onMessage = useCallback((data: string) => {
    if (!p) return;
    const m = parseSiteMessage(data);
    if (!m) return;
    if (m.k === "error") {
      if (m.kind === "read" && !sent.current) { sent.current = true; fire("onError", m.message); }
      return;
    }
    if (m.k === "read") {
      if (p.mode !== "read" || sent.current) return;
      sent.current = true;
      fire("onResult", m.v);
      return;
    }
    if (p.mode !== "signin") return;
    if (m.k === "shape") {
      const r = signInStep(sign.current, m.v);
      sign.current = r.st;
      if (r.next === "findLogin") run("login");
      else if (r.next === "signedIn") fire("onComplete", { site: p.site, url: m.v.url });
      return;
    }
    if (m.k === "login") {
      const r = pressed(sign.current, m.v.clicked, here, p.home);
      sign.current = r.st;
      if (r.next === "goHome" && p.home) setUri(p.home);
    }
  }, [p, run, fire, here]);

  if (!p) return null;
  const read = p.mode === "read";

  const view = (
    <WebView
      ref={ref}
      source={{ uri }}
      style={{ flex: 1, backgroundColor: "#FFFFFF" }}
      // Kept, on purpose: this is where the person stays signed in. (LiveView is the opposite.)
      incognito={false}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      domStorageEnabled
      cacheEnabled
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      allowsBackForwardNavigationGestures={!read}
      geolocationEnabled={false}
      mediaCapturePermissionGrantType="deny"
      onShouldStartLoadWithRequest={(req) => req.isTopFrame === false || hostAllowed(req.url, p.hosts)}
      onNavigationStateChange={(s) => { if (s.url) setHere(s.url); }}
      onFileDownload={() => { /* nothing is saved from a site */ }}
      onMessage={(e) => onMessage(e.nativeEvent.data)}
      onLoadEnd={() => {
        setLoading(false);
        if (read) setTimeout(() => { if (!sent.current) run("read"); }, READ_SETTLE_MS);
        else run("shape");
      }}
      onError={() => { if (read && !sent.current) { sent.current = true; fire("onError", "load"); } }}
      onContentProcessDidTerminate={() => ref.current?.reload()}
    />
  );

  // A read is never seen: laid out at a phone's size, off the screen, so the page draws as it would for the person.
  if (read) {
    return (
      <View pointerEvents="none" style={{ position: "absolute", left: -10_000, top: 0, width: 390, height: 844, opacity: 0 }}>
        {view}
      </View>
    );
  }

  return (
    <View style={[{ flex: 1, overflow: "hidden" }, style]}>
      {/* The address the page is really at, always: never a surprise what is being typed into. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8 }} accessibilityRole="header">
        <Text style={{ color: meta, fontSize: 12 }}>{K.txt("siteView.secure", "Secure")}</Text>
        <Text style={{ color: ink, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>{hostOf(here) || p.site}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {view}
        {loading && (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" }}>
            <ActivityIndicator color={ink} />
          </View>
        )}
      </View>
    </View>
  );
}
