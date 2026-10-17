// node --test --experimental-strip-types src/auth/linkState.test.ts
//
// A sign-in link redeems only on the phone that started that sign-in. Each
// refusal below is a link an attacker could send — from a web page, a mail,
// a message — to sign someone into the attacker's account (login CSRF).

import test from "node:test";
import assert from "node:assert";
import { randomBytes } from "node:crypto";
import {
  STATE_TTL_MS, isState, judgeLink, makeRedeemer, mintState, newPending, parsePending, readAuthLink, withState,
} from "./linkState.ts";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const S = mintState(randomBytes(32));

test("a state is 32 random bytes, base64url, and nothing else looks like one", () => {
  assert.equal(S.length, 43);
  assert.match(S, /^[A-Za-z0-9_-]+$/);
  assert.equal(isState(S), true);
  assert.notEqual(mintState(randomBytes(32)), S);
  // Known vector: base64url of bytes 0..31.
  assert.equal(mintState(Uint8Array.from({ length: 32 }, (_, i) => i)), "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
  assert.throws(() => mintState(new Uint8Array(8)));
  for (const bad of ["", "short", "x".repeat(31), "has space".padEnd(40, "x"), "a/b".padEnd(40, "x"), "x".repeat(129), undefined, 42]) {
    assert.equal(isState(bad), false, String(bad));
  }
});

test("the redirect carries the state in its query, before any fragment", () => {
  assert.equal(withState("https://api.tailzu.space/auth/callback", S), `https://api.tailzu.space/auth/callback?state=${S}`);
  assert.equal(withState("https://x.test/cb?a=1", S), `https://x.test/cb?a=1&state=${S}`);
  assert.equal(withState("https://x.test/cb#f", S), `https://x.test/cb?state=${S}#f`);
});

test("reads the three shapes a sign-in link comes back in, with its state", () => {
  // PKCE: Google by way of Supabase's page, bounced by /auth/callback.
  assert.deepEqual(readAuthLink(`tulmi://auth/callback?state=${S}&code=abc-123`), { kind: "code", code: "abc-123", state: S });
  // Implicit: the session in the fragment, the state in the query.
  assert.deepEqual(
    readAuthLink(`tulmi://auth/callback?state=${S}#access_token=AT&refresh_token=RT&token_type=bearer`),
    { kind: "session", accessToken: "AT", refreshToken: "RT", state: S },
  );
  // A mailed token hash, any path, with its GoTrue type.
  assert.deepEqual(
    readAuthLink(`https://tailzu.space/auth/confirm?token_hash=H&type=magiclink&state=${S}`),
    { kind: "auth", tokenHash: "H", type: "magiclink", state: S },
  );
  assert.deepEqual(readAuthLink("tulmi://x?token=T&type=signup"), { kind: "auth", tokenHash: "T", type: "signup" });
  // No state is read as no state — and judged below.
  assert.deepEqual(readAuthLink("tulmi://auth/callback#access_token=AT&refresh_token=RT"), { kind: "session", accessToken: "AT", refreshToken: "RT" });
});

test("does not swallow links that are not sign-in links", () => {
  for (const url of [
    "tulmi://screen/stats",
    "tulmi://screen/redeem?token=PROMO",            // a screen may carry its own `token`
    "tulmi://screen/redeem?code=PROMO",             // …or its own `code`
    `com.tulmi.app:/oauthredirect?state=${S}&code=g`, // Google's native redirect is expo-auth-session's, not ours
    "https://tailzu.space/s/stats?code=x",
    "tulmi://auth/callback?error=access_denied&error_description=no",
    `tulmi://auth/callback?state=${S}&code=c&error=server_error`,
    "tulmi://auth/callback#access_token=only-half",
    "",
  ]) assert.equal(readAuthLink(url), null, url);
});

test("redeems only the state this phone is waiting for, unexpired", () => {
  const pending = newPending(S, NOW);
  const code = { kind: "code" as const, code: "c", state: S };
  assert.equal(judgeLink(code, pending, NOW, false), "ok");
  assert.equal(judgeLink(code, pending, NOW + STATE_TTL_MS, false), "ok");

  // The attacks. Signed in: a swap to another account.
  assert.equal(judgeLink(code, pending, NOW, true), "signed-in");
  // A link with no state — every link minted outside this phone's own flow.
  assert.equal(judgeLink({ kind: "session", accessToken: "AT", refreshToken: "RT" }, pending, NOW, false), "no-state");
  assert.equal(judgeLink({ kind: "auth", tokenHash: "H", type: "email", state: "short" }, pending, NOW, false), "no-state");
  // A well-formed state this phone never minted (the attacker's own flow).
  assert.equal(judgeLink({ ...code, state: mintState(randomBytes(32)) }, pending, NOW, false), "mismatch");
  // A phone that is not signing in at all.
  assert.equal(judgeLink(code, null, NOW, false), "no-pending");
  // A sign-in started and abandoned long ago.
  assert.equal(judgeLink(code, pending, NOW + STATE_TTL_MS + 1, false), "expired");
});

test("the stored record is read strictly", () => {
  assert.deepEqual(parsePending(JSON.stringify(newPending(S, NOW))), { state: S, exp: NOW + STATE_TTL_MS });
  for (const raw of [null, "", "{", "null", JSON.stringify({ state: "short", exp: NOW }), JSON.stringify({ state: S }), JSON.stringify({ state: S, exp: "soon" })]) {
    assert.equal(parsePending(raw), null, String(raw));
  }
});

test("one door: checks first, clears the state, spends once, answers everyone the same", async () => {
  const spent: string[] = [];
  let stored: string | null = JSON.stringify(newPending(S, NOW));
  let signedIn = false;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const redeem = makeRedeemer({
    signedIn: async () => signedIn,
    readPending: async () => stored,
    clearPending: async () => { stored = null; },
    spend: async (l) => { await gate; spent.push(l.kind); return { error: null }; },
    now: () => NOW,
  });

  // The browser session's result and the link listener get the same URL.
  const link = readAuthLink(`tulmi://auth/callback?state=${S}&code=c1`)!;
  const a = redeem(link);
  const b = redeem({ ...link });
  release();
  assert.deepEqual(await a, { ok: true });
  assert.deepEqual(await b, { ok: true });
  assert.deepEqual(spent, ["code"]);           // the code was spent once
  assert.equal(stored, null);                  // and the state is gone

  // A second link with a fresh (unknown) state finds nothing waiting.
  signedIn = false;
  const other = readAuthLink(`tulmi://auth/callback?state=${mintState(randomBytes(32))}&code=c2`)!;
  assert.deepEqual(await redeem(other), { ok: false, verdict: "no-pending" });
  assert.deepEqual(spent, ["code"]);
});

test("a refused link spends nothing and leaves this phone's own sign-in waiting", async () => {
  let stored: string | null = JSON.stringify(newPending(S, NOW));
  let spent = 0;
  const redeem = makeRedeemer({
    signedIn: async () => false,
    readPending: async () => stored,
    clearPending: async () => { stored = null; },
    spend: async () => { spent++; return { error: null }; },
    now: () => NOW,
  });
  // The attacker's session link, sent while this phone is mid-sign-in.
  const evil = readAuthLink(`tulmi://auth/callback?state=${mintState(randomBytes(32))}#access_token=AT&refresh_token=RT`)!;
  assert.deepEqual(await redeem(evil), { ok: false, verdict: "mismatch" });
  assert.deepEqual(await redeem(readAuthLink("tulmi://x?token_hash=H&type=magiclink")!), { ok: false, verdict: "no-state" });
  assert.equal(spent, 0);
  assert.notEqual(stored, null);
  // The phone's own return still works afterwards.
  assert.deepEqual(await redeem(readAuthLink(`tulmi://auth/callback?state=${S}&code=mine`)!), { ok: true });
  assert.equal(spent, 1);
});

test("a failure to spend is reported, not swallowed", async () => {
  const redeem = makeRedeemer({
    signedIn: async () => false,
    readPending: async () => JSON.stringify(newPending(S, NOW)),
    clearPending: async () => {},
    spend: async () => ({ error: { message: "invalid flow state, no valid flow state found" } }),
    now: () => NOW,
  });
  assert.deepEqual(await redeem({ kind: "code", code: "c", state: S }), { ok: false, verdict: "failed", message: "invalid flow state, no valid flow state found" });
});
