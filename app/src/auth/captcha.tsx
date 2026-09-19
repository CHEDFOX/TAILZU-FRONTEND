/**
 * Bot protection for the sign-in gate — Cloudflare Turnstile in a hidden WebView.
 *
 * WHY THIS EXISTS
 *
 * The Supabase auth endpoints are open by construction. They authenticate with
 * the anon key, and the anon key is compiled into every copy of the app — it is
 * public by design, it cannot be a secret, and the app being unreleased changes
 * nothing. Anyone who has a build, or reads the repo, can POST a phone number to
 * /auth/v1/otp and make an SMS go out on our Twilio account.
 *
 * That is not theoretical: the Verify log already shows requests from numbers in
 * two countries that were never checked. A code sent and never entered is the
 * signature of a bot, and at volume it is SMS pumping — an attacker points the
 * endpoint at premium numbers that pay them a share of what we are billed.
 *
 * Geo-blocking is the usual answer and is not available to us: we serve
 * everywhere. A CAPTCHA is the control that does not care where the request came
 * from, only whether a person made it.
 *
 * WHERE IT ACTUALLY RUNS
 *
 * Not here. Supabase enforces it: with Attack Protection on, GoTrue rejects any
 * /otp or /token request whose captcha token is missing or invalid. So this
 * protects the ENDPOINT, not just our screen — a bot with the anon key and no
 * browser cannot get past it. This file's only job is to obtain a token so our
 * own users still get through.
 *
 * ORDER MATTERS
 *
 *   1. Ship this.
 *   2. Then turn on Attack Protection in Supabase.
 *
 * The other order locks every user out, including you.
 *
 * SAFE WHEN OFF
 *
 * No site key, or a widget that fails or times out, resolves to `undefined`, and
 * the caller sends the request without a token. So this is inert until Supabase
 * is switched on, and a broken widget degrades to today's behaviour rather than
 * an unsignable-in app. The trade is deliberate: an outage of Cloudflare must
 * not be an outage of sign-in.
 *
 * NO NEW NATIVE CODE. react-native-webview is already a dependency, so this
 * reaches installed builds as an OTA.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { TURNSTILE } from "./authConfig";

/** How long a solve may take before the caller gives up and sends without one. */
const SOLVE_TIMEOUT_MS = 8000;

type Waiter = (token: string | undefined) => void;

/**
 * Module state, not context.
 *
 * The callers are async functions inside callbacks, not components — `send()`
 * runs from a pan responder — so a hook would have to be threaded through every
 * one of them. One host mounts, and everything else asks it by function call.
 */
let ask: ((id: number) => void) | null = null;
const waiting = new Map<number, Waiter>();
let nextId = 1;

/** Is a challenge configured at all? */
export const captchaConfigured = (): boolean => TURNSTILE.siteKey.length > 0;

/**
 * Get a token for one auth request.
 *
 * Turnstile tokens are SINGLE USE — one solve per send, and a resend needs its
 * own. Resolves `undefined` rather than throwing: every caller's fallback is to
 * send without one, and a throw here would have to be caught identically in
 * four places.
 */
export function solveCaptcha(): Promise<string | undefined> {
  if (!captchaConfigured() || !ask) return Promise.resolve(undefined);
  const id = nextId++;
  return new Promise<string | undefined>((resolve) => {
    let settled = false;
    const done = (t: string | undefined) => {
      if (settled) return;
      settled = true;
      waiting.delete(id);
      clearTimeout(timer);
      resolve(t);
    };
    const timer = setTimeout(() => done(undefined), SOLVE_TIMEOUT_MS);
    waiting.set(id, done);
    ask!(id);
  });
}

/**
 * The page the WebView runs.
 *
 * `execution: "execute"` renders the widget without solving, so nothing happens
 * until a sign-in actually asks — no background traffic on a screen the user is
 * only looking at. Every outcome posts back, including the failures, so a
 * caller is never left waiting on a challenge that already gave up.
 *
 * The id is echoed through so overlapping solves cannot claim each other's
 * token — a user who taps send, backs out and sends again has two in flight.
 */
function page(siteKey: string): string {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
<style>html,body{margin:0;background:transparent}</style>
</head><body><div id="w"></div>
<script>
  var widget = null, current = null;
  function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){} }
  function render(){
    if (widget !== null || !window.turnstile) return;
    widget = window.turnstile.render('#w', {
      sitekey: ${JSON.stringify(siteKey)},
      size: 'invisible',
      execution: 'execute',
      callback: function(t){ post({ id: current, token: t }); },
      'error-callback': function(){ post({ id: current, token: null }); },
      'timeout-callback': function(){ post({ id: current, token: null }); },
      'expired-callback': function(){ post({ id: current, token: null }); }
    });
    post({ ready: true });
  }
  window.onloadTurnstileCallback = render;
  var tries = 0;
  var iv = setInterval(function(){
    if (window.turnstile) { clearInterval(iv); render(); }
    else if (++tries > 100) { clearInterval(iv); post({ ready: false }); }
  }, 100);
  window.solve = function(id){
    current = id;
    if (!window.turnstile || widget === null) { post({ id: id, token: null }); return; }
    try { window.turnstile.reset(widget); window.turnstile.execute(widget); }
    catch (e) { post({ id: id, token: null }); }
  };
</script></body></html>`;
}

/**
 * Mount once, near the sign-in gate. Draws nothing.
 *
 * One pixel at zero opacity rather than `display: none` or a zero-sized box: a
 * WebView with no layout is not guaranteed to run its page, and a widget that
 * never loads is a sign-in that waits out the full timeout every time.
 */
export function CaptchaHost(): React.ReactElement | null {
  const ref = useRef<WebView>(null);

  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    let msg: { id?: number; token?: string | null; ready?: boolean };
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (typeof msg.id !== "number") return;      // a readiness ping, not a solve
    const w = waiting.get(msg.id);
    if (w) w(msg.token ?? undefined);
  }, []);

  useEffect(() => {
    ask = (id: number) => {
      // Injected rather than held in state: this is a command, and re-rendering
      // the host to deliver one would reload the widget mid-solve.
      ref.current?.injectJavaScript(`window.solve && window.solve(${id}); true;`);
    };
    return () => {
      ask = null;
      // Nothing is coming back after this. Release every caller rather than
      // leaving a sign-in button spinning until its own timeout.
      for (const [, w] of waiting) w(undefined);
      waiting.clear();
    };
  }, []);

  if (!captchaConfigured()) return null;

  return (
    <View
      style={{ position: "absolute", top: 0, left: 0, width: 1, height: 1, opacity: 0, overflow: "hidden" }}
      pointerEvents="none"
    >
      <WebView
        ref={ref}
        // The site key is bound to a domain, and the page has none of its own —
        // baseUrl is what the widget sees as its origin, so it has to be a
        // domain listed on the key.
        source={{ html: page(TURNSTILE.siteKey), baseUrl: TURNSTILE.origin }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        // A challenge is not a page the user navigates. Nothing here should
        // scroll, bounce, or open a link.
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        androidLayerType="software"
        style={{ width: 1, height: 1, backgroundColor: "transparent" }}
      />
    </View>
  );
}
