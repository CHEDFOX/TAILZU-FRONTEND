/**
 * LiveView: a running web page or artifact, in a sandbox of its own (the server's shared/types/sdui.ts 3e; the rules are
 * liveViewRules.ts). The Code bot's Design and Live preview run the artifact here: the page the server wrote frames the artifact viewer
 * (src/artifacts/livehost.ts on the server), and a tap on a part comes back as a message.
 *
 * Locked down:
 *   - a WebView of its own, `incognito`: no cookies, storage or cache shared with anything, and none of the app's tokens (the app keeps
 *     them in SecureStore; nothing here can reach it). Messages carry data, never a token.
 *   - only http(s), data: and about: pages; the page stays where it was put (decideNav); no new windows, no file access, no camera,
 *     microphone or location, no link previews. A link that leaves is offered to open in the browser only when the node allows popups,
 *     and only after the person says yes.
 *   - every message is untrusted: parsed, size-capped, and only `ready`, `failed` and `open` mean anything to the app; the rest goes to
 *     the screen's state (`messagePath`) and `on.onResult`, where the server decides what a message may do.
 *
 * States: loading (until the page loads, or says `ready` when `waitForReady`; 15 s at most), the page, or an error with "Try again"
 * (a fresh WebView). `send`, bound to state, is handed to the page's window.tzLive whenever it changes, and after each load.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { CompProps } from "./components";
import { decideNav, LIVE_READY_MS, liveSourceOf, openableHost, parseLiveMessage, sendScript } from "./liveViewRules";
import * as K from "./knobs";

type Phase = "loading" | "ready" | "failed";

export function LiveView({ props, style, store, fire }: CompProps) {
  const source = useMemo(() => liveSourceOf(props), [props.url, props.html, props.origin]);
  const [phase, setPhase] = useState<Phase>(source ? "loading" : "failed");
  const [round, setRound] = useState(0);
  const [loads, setLoads] = useState(0);
  const ref = useRef<WebView>(null);
  const settled = useRef(false);
  const waitReady = props.waitForReady === true;
  const font = typeof props.fontFamily === "string" && props.fontFamily ? { fontFamily: props.fontFamily } : null;
  const ink = K.color("ui.LiveView.text", "#0A0A0A");
  const meta = K.color("ui.LiveView.meta", "#5C5C5C");

  // A new page, or "Try again": a fresh WebView from the start.
  const failed = useRef(false);
  useEffect(() => {
    settled.current = false;
    failed.current = !source;
    setPhase(source ? "loading" : "failed");
  }, [source, round]);

  // A page that never draws is an error, not a spinner forever.
  useEffect(() => {
    if (phase !== "loading") return;
    const t = setTimeout(() => setPhase((p) => (p === "loading" ? "failed" : p)), LIVE_READY_MS);
    return () => clearTimeout(t);
  }, [phase, round]);

  // Once per page: an error, a failed status and a lost process can all arrive for one failure.
  const fail = useCallback((message: string) => {
    if (failed.current) return;
    failed.current = true;
    setPhase("failed");
    fire("onError", message);
  }, [fire]);

  // What the app tells the page, whenever it changes and after each load.
  let sendJson = "null";
  try { sendJson = JSON.stringify(props.send ?? null); } catch { /* not data */ }
  useEffect(() => {
    if (!loads) return;
    const js = sendScript(props.send);
    if (js) ref.current?.injectJavaScript(js);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendJson, loads]);

  // One offer at a time, at most every two seconds: a page cannot stack questions.
  const lastOffer = useRef(0);
  const offer = useCallback((url: string) => {
    const host = openableHost(url);
    if (props.allowPopups !== true || !host || Date.now() - lastOffer.current < 2000) return;
    lastOffer.current = Date.now();
    Alert.alert(
      K.txt("liveView.openTitle", "Open {host} in your browser?", { host }),
      K.txt("liveView.openBody", "It leaves the app."),
      [
        { text: K.txt("liveView.openCancel", "Not now"), style: "cancel" },
        { text: K.txt("liveView.openYes", "Open"), onPress: () => { Linking.openURL(url).catch(() => {}); } },
      ],
    );
  }, [props.allowPopups]);

  const onMessage = useCallback((data: string) => {
    const m = parseLiveMessage(data);
    if (!m) return;
    if (m.t === "ready") { setPhase("ready"); return; }
    if (m.t === "failed") { fail(typeof m.message === "string" ? m.message.slice(0, 200) : ""); return; }
    if (m.t === "open") { if (typeof m.url === "string") offer(m.url); return; }
    if (typeof props.messagePath === "string" && props.messagePath) store.set(props.messagePath, m);
    fire("onResult", m);
  }, [fail, offer, fire, store, props.messagePath]);

  const height = typeof props.height === "number" ? props.height : undefined;
  const label = typeof props.title === "string" ? props.title : undefined;

  return (
    <View style={[{ overflow: "hidden" }, height ? { height } : null, style]} accessibilityLabel={label}>
      {source && (
        <WebView
          key={round}
          ref={ref}
          source={source.kind === "html" ? { html: source.html, baseUrl: source.baseUrl } : { uri: source.url }}
          style={{ flex: 1, backgroundColor: "transparent", opacity: phase === "ready" ? 1 : 0 }}
          originWhitelist={["http://*", "https://*", "data:*", "about:*", "blob:*"]}
          incognito
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          allowsLinkPreview={false}
          allowsBackForwardNavigationGestures={false}
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled={false}
          geolocationEnabled={false}
          mediaCapturePermissionGrantType="deny"
          setBuiltInZoomControls={false}
          onShouldStartLoadWithRequest={(req) => {
            const d = decideNav({ source, url: req.url, topFrame: req.isTopFrame !== false, settled: settled.current });
            if (d === "allow") return true;
            // A link the person clicked (iOS says so; Android does not tell, and asks only for the top frame).
            if (d === "offer" && (req.navigationType === "click" || req.navigationType === undefined)) offer(req.url);
            return false;
          }}
          onFileDownload={() => { /* nothing is saved from a live page */ }}
          onMessage={(e) => onMessage(e.nativeEvent.data)}
          onLoadEnd={() => {
            settled.current = true;
            setLoads((n) => n + 1);
            if (!waitReady) setPhase((p) => (p === "loading" ? "ready" : p));
          }}
          onError={() => fail("")}
          onHttpError={(e) => { if (e.nativeEvent.statusCode >= 400) fail(""); }}
          onContentProcessDidTerminate={() => fail("")}
          onRenderProcessGone={() => fail("")}
        />
      )}
      {phase === "loading" && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 10 }} pointerEvents="none">
          <ActivityIndicator color={meta} />
          {typeof props.loadingText === "string" && props.loadingText ? <Text style={[{ fontSize: 13, lineHeight: 18, color: meta }, font]}>{props.loadingText}</Text> : null}
        </View>
      )}
      {phase === "failed" && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 12, padding: 18 }}>
          <Text style={[{ fontSize: 14, lineHeight: 19, color: ink, textAlign: "center" }, font]}>{typeof props.errorText === "string" && props.errorText ? props.errorText : K.txt("liveView.error", "Couldn't show this page.")}</Text>
          {source ? (
            <Pressable
              onPress={() => setRound((n) => n + 1)}
              accessibilityRole="button"
              style={{ borderWidth: 1, borderColor: K.color("ui.LiveView.outline", "#D4D4D4"), borderRadius: 16, paddingVertical: 7, paddingHorizontal: 14 }}
            >
              <Text style={[{ fontSize: 13, lineHeight: 17, color: ink }, font]}>{typeof props.retryText === "string" && props.retryText ? props.retryText : K.txt("liveView.retry", "Try again")}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}
