/**
 * THE VOICE OF THE SESSION ON SHOW, OUTSIDE THE SCREEN'S STATE (voiceLive.ts writes it; BotStage and LiveWords read it).
 *
 * The level changes a dozen times a second and the words with every partial. On the phone a Store write re-renders every
 * node of the screen, so neither goes into state: BotStage reads the level every frame (his bubbles pulse with it, his
 * antenna glows), and LiveWords listens for the words and redraws only itself. Kept per screen (its Store), so a screen
 * left behind under another never hears the new one's voice.
 */

interface Bus {
  words: string;
  level: number;
  listeners: Set<() => void>;
}

const buses = new WeakMap<object, Bus>();

function busOf(owner: object): Bus {
  let b = buses.get(owner);
  if (!b) {
    b = { words: "", level: 0, listeners: new Set() };
    buses.set(owner, b);
  }
  return b;
}

/** The words of the turn being heard ("" between turns). */
export function setVoiceWords(owner: object, text: string): void {
  const b = busOf(owner);
  if (b.words === text) return;
  b.words = text;
  for (const fn of [...b.listeners]) {
    try { fn(); } catch { /* a listener's fault is its own */ }
  }
}

export function voiceWords(owner: object): string {
  return buses.get(owner)?.words ?? "";
}

/** The voice level, 0..1 (made up from the words: voiceLiveCore.ts). */
export function setVoiceLevel(owner: object, v: number): void {
  busOf(owner).level = v;
}

export function voiceLevel(owner: object): number {
  return buses.get(owner)?.level ?? 0;
}

/** Called each time the words change. Returns the way to stop listening. */
export function onVoiceWords(owner: object, fn: () => void): () => void {
  const b = busOf(owner);
  b.listeners.add(fn);
  return () => { b.listeners.delete(fn); };
}
