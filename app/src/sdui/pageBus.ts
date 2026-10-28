/**
 * WHAT THE SCREEN ON SHOW IS DOING, FOR THE NODES THAT FOLLOW IT (Home's header: HeadBar, LiveMark).
 *
 * The SDUI Screen (components.tsx) is the one scroll view of the screen on show. It says here how far it is scrolled
 * and where a finger is on it; a node that follows (the compact bar that comes in once Home's header has scrolled
 * away, the living mark's eyes) listens, with no React render per event. A new Screen says 0 when it mounts.
 */
export interface PageEvent {
  /** How far the screen is scrolled (px). */
  y: number;
  /** Where a finger is, in window coordinates (NaN: none). */
  touchX: number;
  touchY: number;
}

type Listener = (e: PageEvent) => void;
const listeners = new Set<Listener>();
const now: PageEvent = { y: 0, touchX: NaN, touchY: NaN };

export function pageNow(): PageEvent { return now; }

export function onPage(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function tell(): void { listeners.forEach((fn) => { try { fn(now); } catch { /* a listener's fault is its own */ } }); }

export function pageScrolled(y: number): void { now.y = y; tell(); }

export function pageTouched(x: number, y: number): void { now.touchX = x; now.touchY = y; tell(); }
