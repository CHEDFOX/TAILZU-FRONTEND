/**
 * Abuse and fraud prevention, the phone's half (docs: perms2 8.5). Dark: it runs only when the bootstrap's answer carries a
 * `trust` ask, only the steps this binary declared a capability for, once each, in the background, and never blocks a screen or
 * shows anything. There is no card and no prompt, because nothing here asks the person for anything.
 *
 * All it does is carry one question to Apple or Google — "is this the real X0 Bot on a real device?" — and post their answer.
 * It builds no identity: it never reads the phone's model, boot time, disk, keyboards, locale or anything about its network, and
 * the module's functions are reached only through natives.ts, so an older binary has none of them and nothing runs at all. The
 * rules are in trustCore.ts.
 */
import * as Crypto from "expo-crypto";
import { supabase } from "../auth/supabaseClient";
import { tulmiPerms } from "./natives";
import { permCaps } from "./permCaps";
import { oneAtATime, runTrustAsk, type TrustAskLike, type TrustDeps } from "./trustCore";

/** A challenge is single use: one run per challenge, however many bootstraps carry it. */
const ran = new Set<string>();

const sha256 = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);

/**
 * The opaque per-account key the module files an App Attest key id under (Apple's advice is one key per account per install).
 * It is a HASH of the account id, never the id itself, it goes no further than the phone's own Keychain, and it is the only
 * thing about the account this code touches.
 */
async function accountKey(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id ?? "";
  if (!id) throw new Error("refused: not signed in");
  return sha256(`x0|acct|${id}`);
}

const deps = (post: (path: string, body: unknown) => Promise<unknown>, cloudProject?: string): TrustDeps => ({
  caps: permCaps(),
  appAttest: async (challenge) => {
    const m = tulmiPerms();
    if (!m?.attestKey) throw new Error("unsupported");
    return m.attestKey(await accountKey(), challenge);
  },
  appAssert: async (challenge) => {
    const m = tulmiPerms();
    if (!m?.attestAssert) throw new Error("unsupported");
    return m.attestAssert(await accountKey(), challenge);
  },
  attestForget: async () => {
    const m = tulmiPerms();
    if (m?.attestForget) await m.attestForget(await accountKey());
  },
  deviceCheckToken: async () => {
    const m = tulmiPerms();
    if (!m?.deviceCheckToken) throw new Error("unsupported");
    return m.deviceCheckToken();
  },
  integrityToken: async (challenge, project) => {
    const m = tulmiPerms();
    if (!m?.integrityToken) throw new Error("unsupported");
    const number = String(project ?? cloudProject ?? "");
    // The warm-up is asked for only when the server asked for a token: Play allows at most a few a minute per install.
    const prepare = async () => {
      if (!m.integrityPrepare) return;
      if (!(await m.integrityPrepare(number))) throw new Error("no_play");
    };
    await prepare();
    // Google signs the token over OUR request hash, so the server can tell that this token answers this challenge (perms2 8.5).
    const requestHash = await sha256(`x0|integrity|${challenge}`);
    try {
      return await m.integrityToken(requestHash);
    } catch (err) {
      // A token provider that has gone stale is the one case Play says to warm up again — once, never in a loop (perms2 8.5).
      if ((err as { code?: unknown } | null)?.code !== "provider_invalid") throw err;
      await prepare();
      return m.integrityToken(requestHash);
    }
  },
  post,
});

/**
 * The bootstrap's `trust` ask, run in the background. Never throws, never retries and never waits on a screen: the caller fires
 * it and forgets it (sdui/client/bootstrap.ts).
 *
 * `oneAtATime` drops a second ask while one is still running. Two bootstraps close together (the boot loader and the foreground
 * refresh both call `bootstrap()`) each carry their OWN challenge, so `ran` cannot see the second one coming — and two App
 * Attest flows at once would each find no key in the Keychain and each make one (trustCore.ts says why that costs the person).
 */
export const runTrust = oneAtATime(async (
  ask: TrustAskLike | null | undefined,
  post: (path: string, body: unknown) => Promise<unknown>,
): Promise<void> => {
  try {
    const challenge = typeof ask?.challenge === "string" ? ask.challenge : "";
    if (!challenge || ran.has(challenge)) return;
    ran.add(challenge);
    // A long-lived app would otherwise keep every challenge it ever saw.
    if (ran.size > 50) for (const old of [...ran].slice(0, 25)) ran.delete(old);
    const cloudProject = typeof ask?.cloudProject === "string" ? ask.cloudProject : undefined;
    await runTrustAsk(ask, deps(post, cloudProject));
  } catch {
    /* the server asks again when it next wants a check */
  }
});
