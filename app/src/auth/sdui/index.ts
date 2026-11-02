/**
 * The sign-in screen's components, in the SDUI registry.
 *
 * These are what stood between the auth screen and the rest of the app. Every
 * other screen is composed by the server; this one was not, because the pills,
 * the country sheet and the native sign-in buttons had no registry entries —
 * and components live in the binary, so no amount of backend work could add
 * them. Registering these is what moves auth onto the same footing as the
 * other twenty-four.
 *
 * They are WRAPPERS, deliberately. MethodPill (gate/MethodPill) is the one that already
 * ships, imported rather than reimplemented: it carries the swipe-to-submit
 * gesture, the drag threshold, the country gate and the haptics, all of which
 * are load-bearing and none of which are worth writing twice. What these add is
 * a props surface, so the server decides placement, copy and which methods
 * exist.
 *
 * The auth LOGIC is not here and must never move here. It stays in
 * AuthGateScreen and arrives through AuthFlowContext, so the native screen
 * remains the thing doing the work and stays a working fallback. A component
 * that finds no flow draws nothing rather than throwing — an auth node that
 * somehow rendered on another screen must not take that screen down.
 */
export { SwipePill } from "./SwipePill";
export { AppleSignIn } from "./AppleSignIn";
export { GoogleSignIn } from "./GoogleSignIn";
export { CodeEntry } from "./CodeEntry";
export { AuthPhase } from "./AuthPhase";
