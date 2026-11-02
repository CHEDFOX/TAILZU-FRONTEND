import { useEffect, useRef } from "react";
import { fetchScreen } from "../../client";
import type { BootstrapResponse, ScreenResponse } from "../../types";
import { num, bool, str } from "../../knobs";
import { getOnboarded, setOnboarded } from "../../../storage";
import { liftLaunch } from "../../../launch/launchCore";
import type { Phase } from "../types";

/**
 * How long the splash may wait for the first screen's picture to arrive.
 *
 * A cached file resolves in milliseconds. This is the ceiling for the case
 * where it does not — a cold install on a bad connection — because a splash
 * that waits forever is worse than the black it was holding back.
 */
const splashMediaWaitMs = () => num("app.splash.mediaWaitMs", 1500);

/**
 * How long a FIRST run may hold the splash while it fetches what the opening
 * needs — the intro's animation and the onboarding screen's art.
 *
 * Longer than the returning-user budget on purpose. A first launch has an
 * empty cache and one chance to make the opening look composed; the
 * alternative is not "faster", it is watching each piece pop in one at a time
 * across the first three screens. It is still a ceiling, not a promise: when
 * it expires the app opens regardless.
 */
const firstRunMediaWaitMs = () => num("app.splash.firstRunMediaWaitMs", 4500);

/**
 * The first remote picture on a screen, if it has one.
 *
 * A screen existing is not a screen you can look at. The opening media is a
 * file on the server, and it only starts downloading once the node that wants
 * it has rendered — so dropping the splash the moment a screen exists shows
 * black until that file lands. This finds what to wait for.
 *
 * Only `{ url }` sources count. A `{ key }` source needs the client media
 * registry, which is populated as the bootstrap lands — the exact race that
 * made the server resolve urls itself. Falling through on one means hiding
 * immediately, which is what happened before this existed: no regression, just
 * no improvement.
 */
/**
 * Every remote asset on a screen — pictures AND clips.
 *
 * firstRemoteImage below answers "is there something to wait for"; this
 * answers "what is all of it", which is what a first run needs. Someone
 * opening the app for the first time should not watch the intro download, then
 * the onboarding art download, then the keyboard walkthrough download. They
 * wait once, on the splash, where waiting is invisible.
 */
function allRemoteMedia(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const c of node) allRemoteMedia(c, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const n = node as Record<string, any>;
  const src = n.props?.source;
  const url = typeof src === "string" ? src : src?.url;
  if (typeof url === "string" && /^https?:\/\//i.test(url) && !out.includes(url)) out.push(url);
  for (const k of Object.keys(n)) {
    if (k === "props" || k === "style") continue;
    allRemoteMedia(n[k], out);
  }
  if (n.props) allRemoteMedia(n.props, out);
  return out;
}

function firstRemoteImage(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown[]; fallback?: unknown };
  if (n.type === "Image") {
    const src = n.props?.source;
    const url =
      typeof src === "string" ? src
      : typeof src === "object" && src !== null ? (src as { url?: string }).url
      : undefined;
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  for (const c of n.children ?? []) {
    const hit = firstRemoteImage(c);
    if (hit) return hit;
  }
  return firstRemoteImage(n.fallback);
}

/** When the splash lifts (once there is something to see, a first run waiting for the whole opening), and the onboarded mark it reads. */
export function useSplashGate({
  phase, boot, screen, screenError, shown,
}: {
  phase: Phase;
  boot: BootstrapResponse | null;
  screen: ScreenResponse | null;
  screenError: string | null;
  shown: ScreenResponse | null;
}) {
  // Whether this device has finished onboarding — the LOCAL answer, used only
  // when the server sends none (boot.firstRun). Read once at startup, and a
  // ref rather than state because the splash gate must not re-run when it
  // resolves — a second pass there would drop the splash early.
  const onboardedRef = useRef(false);
  useEffect(() => {
    // An unreadable flag is treated as a first run — it only costs a wait.
    getOnboarded().then((v) => { onboardedRef.current = v; }).catch(() => {});
  }, []);

  // ONBOARDING IS DONE WHEN THE USER IS STANDING ON THE TABS.
  //
  // setOnboarded existed and nothing called it, so the local answer above was
  // "first run" on every launch and every launch held the splash for the
  // first-run budget. The server's boot.firstRun is the real answer now; this
  // keeps the offline fallback honest, once, the first time a tab's own
  // screen is what is drawn.
  const onboardedSaved = useRef(false);
  const shownScreenId = shown?.screenId;
  useEffect(() => {
    if (onboardedSaved.current || phase !== "ready" || !shownScreenId) return;
    const navShell = boot?.navigation;
    if (navShell?.kind !== "tabs") return;
    if (!navShell.tabs.some((t) => (t.screenId ?? t.id) === shownScreenId)) return;
    onboardedSaved.current = true;
    onboardedRef.current = true;
    setOnboarded().catch(() => { /* next landing tries again */ onboardedSaved.current = false; });
  }, [phase, boot, shownScreenId]);

  const splashHidden = useRef(false);

  /**
   * NOTHING HOLDS THE SPLASH FOREVER.
   *
   * index.ts calls preventAutoHideAsync, so the splash stays up until this app
   * decides to lift it — and every condition below is downstream of a boot
   * that has to finish. Each time one of those has hung, the result has been
   * the same picture: the launch image, no screen, no error, nothing to retry
   * from, and an app that from outside is not responding.
   *
   * This is the floor under all of it. It does not fix a hang and is not meant
   * to: it makes one visible. The app underneath is live — it takes touches,
   * it can show the connection banner, it reports the stall on the next launch
   * — and a dark screen you can act on is a different thing from a frozen
   * launch image.
   */
  useEffect(() => {
    const t = setTimeout(() => {
      if (splashHidden.current) return;
      splashHidden.current = true;
      liftLaunch();
    }, num("app.splash.maxHoldMs", 7000));
    return () => clearTimeout(t);
  }, []);

  // DROP THE SPLASH once there is a PICTURE under it, and not a moment before.
  //
  // index.ts holds it at launch. Three moments were candidates for letting go,
  // and only the last one is black-free:
  //
  //   phase === "ready"  — the bootstrap landed. No screen yet.
  //   screen !== null    — the screen landed. Its media has not started.
  //   the file is here   — this one.
  //
  // The opening media is a file on the server. The node that wants it only
  // begins fetching once it has rendered, so hiding on `screen` uncovers a
  // download in progress. Prefetching it first puts that download behind the
  // splash, where a wait is invisible.
  //
  // The timeout is the promise this cannot break: whatever the network does,
  // the splash goes. A splash that waits forever is worse than the black it
  // was holding back.
  useEffect(() => {
    // THE SPLASH LIFTS WHEN THERE IS ANYTHING TO LOOK AT — not only when an
    // SDUI screen arrives.
    //
    // This used to wait for `screen` alone, and three render paths never
    // produce one: the auth gate, the language pick and the connection error.
    // index.ts calls preventAutoHideAsync, so nothing else was ever going to
    // lift it. A signed-out user therefore got a perfectly good sign-in screen
    // drawn underneath a splash that never moved — and could not sign in,
    // which meant no session, which meant the next launch did the same thing.
    // The keyboard came down with it: the token it reads is refreshed by an
    // app that gets past its own front door, so it fell back to its built-in
    // layout and looked like a regression of its own.
    //
    // Every one of those symptoms was this one line.
    const somethingToSee =
      phase === "auth" || phase === "connect" ||
      !!screen || !!screenError;
    if (splashHidden.current || !somethingToSee) return;
    splashHidden.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const drop = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      liftLaunch();
    };
    // The media wait belongs to the SCREEN path only. On every other path
    // there is no opening picture to wait for, and waiting for one that will
    // never come is how this broke in the first place.
    if (!screen) { drop(); return; }

    // A FIRST RUN WAITS FOR THE WHOLE OPENING, not just its first picture.
    //
    // Someone new sees the intro, then onboarding, then the keyboard step, and
    // fetching each one as they arrive means three separate pops in the first
    // fifteen seconds. The splash is the one place a wait is invisible, so it
    // is the place to spend it — once, for all of it.
    //
    // A returning user waits for the opening picture and nothing else: their
    // cache is warm, and the rest is already on disk.
    // The server's answer (boot.firstRun: true until onboarding is done); the
    // device's own record only when there is none.
    const first = bool("boot.firstRun", !onboardedRef.current);
    const urls = first
      ? allRemoteMedia((screen as ScreenResponse).root)
      : [firstRemoteImage((screen as ScreenResponse).root)].filter(Boolean) as string[];

    if (!urls.length && !first) { drop(); return; }
    timer = setTimeout(drop, first ? firstRunMediaWaitMs() : splashMediaWaitMs());

    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ExpoImage = require("expo-image")?.Image;
        const warm = (u: string) => ExpoImage?.prefetch?.(u, "disk") ?? Promise.resolve();

        if (first) {
          // The screen AFTER this one, too. On a first run that is the
          // onboarding step, and it is the next thing they will look at.
          // No literal fallback for postLanguageScreenId: absent must stay
          // absent (see commitBoot).
          const afterIntro = boot?.initialScreenId === str("boot.introScreenId", "intro")
            ? str("boot.postIntroScreenId", "onboarding")
            : "";
          const nextId = str("postLanguageScreenId", afterIntro) || null;
          if (nextId) {
            const next = await fetchScreen(nextId).catch(() => null);
            if (next?.root) {
              for (const u of allRemoteMedia(next.root)) if (!urls.includes(u)) urls.push(u);
            }
          }
        }
        await Promise.all(urls.map((u) => warm(u).catch(() => {})));
        drop();
      } catch { drop(); }
    })();
    return () => { if (timer) clearTimeout(timer); };
  }, [screen, screenError, phase]);
}
