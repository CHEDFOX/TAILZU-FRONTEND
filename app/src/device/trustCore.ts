/**
 * ABUSE AND FRAUD PREVENTION, THE RULES (docs: perms2 8.5). Pure: no react-native, no native module, so each rule is tested in
 * Node (trustCore.test.ts); trust.ts calls the module and the server.
 *
 * What this is and is not. The phone asks APPLE or GOOGLE one question — "is this the real X0 Bot on a real device?" — and posts
 * their answer. It builds no identity: nothing here reads the phone's name, model, boot time, disk, keyboards, locale, time zone
 * or anything at all about its network (Apple names the user's network connection as a fingerprinting input), and no stable
 * per-device key is ever made from what a token contains. The install id (installId.ts) is MADE, not derived: a random v4 UUID
 * with no input from the device, which resets on reinstall. A scan test enforces every line of that.
 *
 * It never prompts, never blocks a screen, runs only the steps the server asked for and the binary can do, and runs each once:
 * on failure it posts a short reason code and stops. Everything is dark until the server's flags turn it on.
 */

/** The step the server may ask for. */
export type TrustStep = "appAttest" | "appAssert" | "deviceCheck" | "playIntegrity";

/** What the server wants now (sdui/types.ts TrustAsk, from the bootstrap). */
export interface TrustAskLike {
  challenge?: unknown;
  do?: unknown;
  cloudProject?: unknown;
}

/** The one route each step may post to. A step off its route is refused before any native call. */
export const TRUST_ROUTE: Record<TrustStep, string> = {
  appAttest: "/v1/trust/ios/attest",
  appAssert: "/v1/trust/ios/assert",
  deviceCheck: "/v1/trust/ios/devicecheck",
  playIntegrity: "/v1/trust/android/integrity",
};

/** The capability a step needs, so a binary that cannot do it is never asked (and never penalised for it: rule 6). */
const NEEDS: Record<TrustStep, string> = {
  appAttest: "AppAttest1",
  appAssert: "AppAttest1",
  deviceCheck: "DeviceCheck1",
  playIntegrity: "PlayIntegrity1",
};

const STEPS: TrustStep[] = ["appAttest", "appAssert", "deviceCheck", "playIntegrity"];

/** The challenge: base64url, single use, the server's 32 random bytes. Anything else is not ours and nothing is run. */
export function challengeOk(c: unknown): c is string {
  return typeof c === "string" && c.length >= 16 && c.length <= 512 && /^[A-Za-z0-9_-]+$/.test(c);
}

/** base64 (what the module hands back for an attestation, assertion or device token). */
export function base64Ok(v: unknown, max = 32_768): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max && /^[A-Za-z0-9+/=]+$/.test(v);
}

/** A key id or integrity token: printable, bounded, no spaces. */
export function tokenOk(v: unknown, max = 16_384): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max && /^[\x21-\x7e]+$/.test(v);
}

/** The steps to run, in the server's order: each asked for once, known, and backed by a capability this binary declared. */
export function trustSteps(ask: TrustAskLike | null | undefined, caps: readonly string[]): TrustStep[] {
  if (!ask || !challengeOk(ask.challenge) || !Array.isArray(ask.do)) return [];
  const out: TrustStep[] = [];
  for (const raw of ask.do.slice(0, 8)) {
    const step = STEPS.find((s) => s === raw);
    if (!step || out.includes(step)) continue;
    if (!caps.includes(NEEDS[step])) continue;
    out.push(step);
  }
  return out;
}

/**
 * The short reason a step failed. Never a message from the system: codes only, so nothing about the phone is sent. Every code
 * the module can reject with maps onto one of these (the sets below), because the server reads only this word.
 */
export type FailCode = "unsupported" | "throttled" | "no_play" | "timeout" | "refused" | "no_key" | "error";

/** The codes the module itself rejects with (its own words), each kept as it is. */
const MODULE_CODES = new Set<string>(["unsupported", "throttled", "no_play", "timeout", "refused", "no_key"]);

/**
 * A failure that says NOTHING about this phone: the network went, Apple's or Google's service could not be reached, or a
 * warm-up had gone stale. The server must read these as no signal, so they must not come back as "error", which it scores as an
 * attestation claimed and failed (+40, spec 8.3) — a penalty for losing a network breaks rule 6 of spec 8.2.
 */
const TEMPORARY = new Set<string>(["transient", "provider_invalid", "not_prepared", "system", "unavailable"]);

/**
 * A failure that means this phone or this build cannot do the step at all: again a no-signal answer, never a penalty.
 *
 * `invalid_key` is here because it is the honest reinstall: App Attest keys do not survive one, the filed key id (Keychain)
 * does, and an assertion with a dead key is not an attestation claimed and failed. `bodyFor` attests a fresh key instead, so
 * this only matters when even that retry fails — and then the answer must be no signal, not +40.
 */
const CANNOT = new Set<string>(["no_store", "no_context", "no_screen", "hash_too_long", "attested", "invalid_key"]);

export function failCode(err: unknown): FailCode {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  // The module rejects with a short code of its own (Expo's promise.reject(code, message)); it is already the answer.
  const code = typeof e?.code === "string" ? e.code.toLowerCase() : "";
  if (MODULE_CODES.has(code)) return code as FailCode;
  // "timeout" is the no-signal code for "ask again later"; trust.ts has already retried a stale provider once.
  if (TEMPORARY.has(code)) return "timeout";
  if (CANNOT.has(code)) return "unsupported";
  if (code === "bad_project" || code === "api_not_available") return "no_play";
  const text = String(e?.message ?? err ?? "").toLowerCase();
  if (!text) return "error";
  if (text.includes("unsupported") || text.includes("not supported") || text.includes("unavailable")) return "unsupported";
  if (text.includes("throttl") || text.includes("too many") || text.includes("rate")) return "throttled";
  if (text.includes("play") && (text.includes("missing") || text.includes("unavailable") || text.includes("not found"))) return "no_play";
  if (text.includes("api_not_available") || text.includes("play_store")) return "no_play";
  if (text.includes("timeout") || text.includes("timed out")) return "timeout";
  if (text.includes("denied") || text.includes("refused")) return "refused";
  return "error";
}

/** A v4 UUID from 16 random bytes. The bytes are the ONLY input: nothing of the device goes into it (installId.ts). */
export function uuidV4From(bytes: ArrayLike<number>): string {
  if (!bytes || bytes.length < 16) throw new Error("16 random bytes needed");
  const b = Array.from({ length: 16 }, (_, i) => Number(bytes[i]) & 0xff);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The shape AsyncStorage may hold under tulmi.installId: a v4 UUID and nothing else. */
export const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const installIdOk = (v: unknown): v is string => typeof v === "string" && INSTALL_ID.test(v);

/** What the steps need from the phone and the server, injected so every rule is testable. */
export interface TrustDeps {
  /** What this binary declared (device/permCaps.ts). */
  caps: readonly string[];
  appAttest: (challenge: string) => Promise<{ keyId: string; attestation: string }>;
  appAssert: (challenge: string) => Promise<{ keyId: string; assertion: string }>;
  /** Drops this account's App Attest key on this phone, so the next attest makes a fresh one. */
  attestForget?: () => Promise<void>;
  deviceCheckToken: () => Promise<string>;
  /** Play Integrity: prepares when asked to and answers a token for the challenge. */
  integrityToken: (challenge: string, cloudProject?: string) => Promise<string>;
  /** POST to the step's own route. Answers 204; nothing comes back to act on. */
  post: (path: string, body: unknown) => Promise<unknown>;
}

export type StepOutcome = "sent" | "failed";

/**
 * Every step the server asked for, once, in order, in the background. A step that throws posts `{ challenge, failed: code }` to
 * its own route and the rest still run; a step with no capability is not run at all and nothing is posted for it (a missing
 * capability is never a penalty). Nothing is retried, and nothing here ever throws.
 */
export async function runTrustAsk(
  ask: TrustAskLike | null | undefined,
  deps: TrustDeps,
): Promise<{ step: TrustStep; outcome: StepOutcome; code?: FailCode }[]> {
  const steps = trustSteps(ask, deps.caps);
  if (!steps.length) return [];
  const challenge = String((ask as { challenge?: unknown }).challenge);
  const cloudProject = typeof ask?.cloudProject === "string" && ask.cloudProject ? ask.cloudProject : undefined;
  const done: { step: TrustStep; outcome: StepOutcome; code?: FailCode }[] = [];
  for (const step of steps) {
    const path = TRUST_ROUTE[step];
    try {
      const out = await bodyFor(step, challenge, cloudProject, deps);
      await deps.post(out.path, out.body);
      done.push({ step, outcome: "sent" });
    } catch (err) {
      const code = failCode(err);
      done.push({ step, outcome: "failed", code });
      // DeviceCheck shares the ask's one challenge with App Attest, which has usually spent it already, so its failure goes
      // without one (the route takes a challenge only when one is sent).
      const failure = step === "deviceCheck" ? { failed: code } : { challenge, failed: code };
      try { await deps.post(path, failure); } catch { /* the server asks again next time */ }
    }
  }
  return done;
}

/**
 * ONE ASK AT A TIME. A second call while the first is still running is DROPPED, not queued: two bootstraps close together (the
 * boot loader and the foreground refresh both ask for one) each carry their OWN challenge, so nothing else can see the second
 * coming — and two App Attest flows at once each find no key in the Keychain and each make one. Every extra key counts against
 * Apple's per-device attested-key metric, which the server scores against the person (spec 8.5). The server asks again at the
 * next bootstrap, so nothing is lost by dropping it.
 */
export function oneAtATime<A extends unknown[]>(run: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  let busy = false;
  return async (...args: A): Promise<void> => {
    if (busy) return;
    busy = true;
    try { await run(...args); } finally { busy = false; }
  };
}

const codeOf = (err: unknown): string => {
  const c = (err as { code?: unknown } | null | undefined)?.code;
  return typeof c === "string" ? c.toLowerCase() : "";
};

/**
 * One App Attest attestation, posted to the attest route. The server asks `appAttest` only when it holds NO key for this
 * account, so a phone that answers "attested" (it filed a key whose attestation never reached the server: a lost POST) must
 * not sign with that key — the server could check nothing. It forgets it and makes one fresh key, once.
 */
async function attestBody(challenge: string, deps: TrustDeps): Promise<{ path: string; body: Record<string, string> }> {
  let r: { keyId: string; attestation: string };
  try {
    r = await deps.appAttest(challenge);
  } catch (err) {
    if (codeOf(err) !== "attested" || !deps.attestForget) throw err;
    await deps.attestForget();
    r = await deps.appAttest(challenge);
  }
  if (!tokenOk(r?.keyId, 256) || !base64Ok(r?.attestation)) throw new Error("unsupported");
  return { path: TRUST_ROUTE.appAttest, body: { challenge, keyId: r.keyId, attestation: r.attestation } };
}

async function bodyFor(
  step: TrustStep,
  challenge: string,
  cloudProject: string | undefined,
  deps: TrustDeps,
): Promise<{ path: string; body: Record<string, string> }> {
  const path = TRUST_ROUTE[step];
  if (step === "appAttest") return attestBody(challenge, deps);
  if (step === "appAssert") {
    let r: { keyId: string; assertion: string };
    try {
      r = await deps.appAssert(challenge);
    } catch (err) {
      // The server holds a key for this account but this phone cannot sign with it: either it has none at all (a reinstall
      // drops the per-install filing, "no_key") or the key it had is no longer valid to App Attest ("invalid_key", which is
      // DCError.invalidKey — again a reinstall, because the filed key id survives one and the App Attest key does not).
      // Swift has already dropped the dead key, and the challenge is still unspent, so a fresh one is attested with it and
      // an honest reinstall is never scored as a failed check.
      const c = codeOf(err);
      if (c !== "no_key" && c !== "invalid_key") throw err;
      return attestBody(challenge, deps);
    }
    if (!tokenOk(r?.keyId, 256) || !base64Ok(r?.assertion)) throw new Error("unsupported");
    return { path, body: { challenge, keyId: r.keyId, assertion: r.assertion } };
  }
  if (step === "deviceCheck") {
    const token = await deps.deviceCheckToken();
    if (!base64Ok(token)) throw new Error("unsupported");
    // DeviceCheck's token is Apple's own and carries the challenge nowhere: the body is the token alone (perms2 9.3).
    return { path, body: { token } };
  }
  const token = await deps.integrityToken(challenge, cloudProject);
  if (!tokenOk(token)) throw new Error("unsupported");
  return { path, body: { challenge, token } };
}
