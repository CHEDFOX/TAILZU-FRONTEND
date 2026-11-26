/**
 * WHICH SCREENS A LINK FROM OUTSIDE MAY OPEN, AND WITH WHAT.
 *
 * Any web page, message or app can open tulmi://screen/<id>?… (and a universal
 * link on our domains takes the same path). A screen opened that way used to
 * get any id the server knows and the whole query string as its params, so a
 * page could open a hand-off screen with `button=pay`, or prefill one with
 * whatever it liked. Now a link opens only the screens below, which are every
 * screen the server, its emails and pages, the widgets, the quick actions,
 * the keyboards and the desktop write into a link, and each keeps only the
 * params that screen's links carry, each a plain id-shaped value.
 *
 * The microphone screens (transient: flow_arm, keyboard_record, …) pass
 * through with no params: the shell never navigates to one from a link, only
 * consumes the keyboard's App-Group tombstone (useStartup.ts).
 *
 * The server can replace the list of screens (`deeplink.screens`) and add the
 * params of a screen it adds (`deeplink.screenParams`); a screen it lists with
 * no params entry opens with none.
 */

/** Screen id → the params a link to it may carry. */
export const LINK_SCREENS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // The server's own links (pushes, emails, pages, widgets: grep "tulmi://screen/" in the backend).
  "bots.ask": ["voice"],
  "bots.spaces": ["join"],
  "bots.code": [],
  "bots.code.job": ["id"],
  "bots.keybot": [],
  "bots.keybot.on": [],
  "bots.plan.item": ["kind"],
  "bots.usage": [],
  "bots.thread": ["id"],
  "bots.space.tasks": ["id"],
  "bots.space.item": ["item"],
  "bots.link": ["l", "c"],
  "bots.bot": ["slug"],
  "bots.approve": ["task"],
  "bots.tasks": [],
  "bots.activity": [],
  "bots.home": [],
  "home": [],
  // The built-in bots' pages (the widgets' "bots.{slug}"), Nudj's home among them (an arrival reminder's tap).
  "bots.plan": [],
  "bots.travel": [],
  "bots.talk": [],
  // The connectors' "Open" page and the desktop's links (src/main/links.js in the desktop app).
  "assistant_apps": ["entry"],
  "assistant_tasks": [],
  // A push's quota screen, and the keyboard's microphone-permission screen (kb.mic.permissionScreenId).
  "paywall": [],
  "onboarding": [],
});

/** A param's value as a link may carry it: an id, a code, a token, a small word. */
const VALUE = /^[A-Za-z0-9_.:-]{1,128}$/;

export type LinkScreenRules = {
  /** The screens a link may open (deeplink.screens), or the default. */
  screens?: readonly string[];
  /** Params for screens the server added (deeplink.screenParams). */
  params?: Readonly<Record<string, readonly string[]>>;
  /** The microphone screens (nav.transientScreenIds). */
  transient?: readonly string[];
};

/**
 * The screen and params a link may open, or null when it may not open that screen.
 * `query` is the link's query string, already parsed.
 */
export function linkScreen(
  screenId: string,
  query: Record<string, unknown>,
  rules: LinkScreenRules = {},
): { screenId: string; params: Record<string, string> } | null {
  if (rules.transient?.includes(screenId)) return { screenId, params: {} };
  const screens = rules.screens ?? Object.keys(LINK_SCREENS);
  if (!screens.includes(screenId)) return null;
  const own = Object.prototype.hasOwnProperty.call(LINK_SCREENS, screenId) ? LINK_SCREENS[screenId] : undefined;
  const added = rules.params && Object.prototype.hasOwnProperty.call(rules.params, screenId) ? rules.params[screenId] : undefined;
  const allowed = own ?? (Array.isArray(added) ? added : []);
  const params: Record<string, string> = {};
  for (const k of allowed) {
    const v = query[k];
    if (typeof v === "string" && VALUE.test(v)) params[k] = v;
  }
  return { screenId, params };
}
