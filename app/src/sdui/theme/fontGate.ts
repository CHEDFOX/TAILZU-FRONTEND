/**
 * WAITING FOR A FONT, BUT NEVER FOR LONG.
 *
 * remoteFonts.ts loads the server's faces in the background and never blocks:
 * the app draws in the system font until a face is ready. That is right for
 * almost every screen, and wrong for one moment: the first thing a new person
 * sees. Hello is set in a face that arrives over the network, and drawing it in
 * the system font and then swapping a half second later is the kind of flicker
 * a first impression does not get a second chance at.
 *
 * So the sign-in gate may ask "are these ready?" and wait, for at most as long
 * as the server says (onboard.fontWaitMs, 600 by default). This is the whole of
 * the rule, free of React Native so it is tested on its own (fontGate.test.ts):
 *
 *   - a face that is loading is waited for;
 *   - a face that is already loaded, never asked for, or that failed, is not;
 *   - the wait ends at the deadline whatever has happened, so a dead URL costs
 *     the deadline and nothing more.
 */
export function createFontGate() {
  const loaded = new Set<string>();
  const pending = new Set<string>();
  const waiters = new Set<() => void>();
  const wake = () => { for (const w of [...waiters]) w(); };

  return {
    /** A face began loading. */
    start(name: string): void { pending.add(name); },
    /** It finished: loaded, or failed. Either way nobody should wait for it any more. */
    done(name: string, ok: boolean): void {
      pending.delete(name);
      if (ok) loaded.add(name);
      wake();
    },
    /** Loaded, or on its way: remoteFonts skips these on the next bootstrap. */
    known(name: string): boolean { return loaded.has(name) || pending.has(name); },
    loaded(name: string): boolean { return loaded.has(name); },
    /** Resolves when every named face that is loading has finished, or after `ms`. */
    ready(names: string[], ms: number): Promise<void> {
      const waitFor = names.filter((n) => pending.has(n));
      if (!waitFor.length) return Promise.resolve();
      return new Promise<void>((resolve) => {
        let finished = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          if (finished) return;
          finished = true;
          if (timer) clearTimeout(timer);
          waiters.delete(check);
          resolve();
        };
        const check = () => { if (waitFor.every((n) => !pending.has(n))) finish(); };
        timer = setTimeout(finish, Math.max(0, ms));
        waiters.add(check);
      });
    },
  };
}
