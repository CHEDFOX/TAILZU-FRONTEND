/**
 * WHICH CLIPS HAVE PAINTED A FRAME, for whoever is waiting on one.
 *
 * The splash hands over to the opening film, and the hand-over is only
 * seamless if the film is already ON SCREEN when the splash lifts. A
 * downloaded file is not that: expo-video still has to open it and decode a
 * frame, and until it has, the view under the splash is the empty ground —
 * the mark vanishes for a beat and comes back, which is the blink.
 *
 * The player reports its first frame here (MediaPlayer, onFirstFrameRender);
 * the splash gate waits on it (SduiApp). Keyed by the uri the player was
 * given, which is the url the screen carries.
 */
const seen = new Set<string>();
const waiting = new Map<string, Array<() => void>>();

export function firstFrameSeen(uri: string): void {
  if (!uri || seen.has(uri)) return;
  seen.add(uri);
  const list = waiting.get(uri);
  waiting.delete(uri);
  list?.forEach((resolve) => resolve());
}

/** Resolves once `uri` has painted a frame — at once if it already has. */
export function whenFirstFrame(uri: string): Promise<void> {
  if (seen.has(uri)) return Promise.resolve();
  return new Promise((resolve) => {
    const list = waiting.get(uri) ?? [];
    list.push(resolve);
    waiting.set(uri, list);
  });
}
