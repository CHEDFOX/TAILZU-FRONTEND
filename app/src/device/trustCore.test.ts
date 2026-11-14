// node --test --experimental-strip-types src/device/trustCore.test.ts
//
// Abuse prevention's rules (docs: perms2 8.5): only the steps the server asked for AND this binary can do, each once, each on
// its own route; a failure posts a short code and stops; a missing capability is never penalised; and the install id is a random
// v4 UUID with nothing of the device in it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INSTALL_ID, TRUST_ROUTE, base64Ok, challengeOk, failCode, installIdOk, oneAtATime, runTrustAsk, trustSteps, uuidV4From,
  type TrustDeps,
} from "./trustCore.ts";
import { emptyAnswer } from "../sdui/client/endpointCore.ts";

const CHALLENGE = "Q0hBTExFTkdFLTMyLWJ5dGVzLW9mLXJhbmRvbQ";
const ALL = ["AppAttest1", "DeviceCheck1", "PlayIntegrity1"];

function deps(over: Partial<TrustDeps> = {}) {
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const d: TrustDeps = {
    caps: ALL,
    appAttest: async () => ({ keyId: "key-1", attestation: "YXR0ZXN0" }),
    appAssert: async () => ({ keyId: "key-1", assertion: "YXNzZXJ0" }),
    deviceCheckToken: async () => "ZGV2aWNl",
    integrityToken: async () => "integrity.token-1",
    post: async (path, body) => { posted.push({ path, body: body as Record<string, unknown> }); return {}; },
    ...over,
  };
  return Object.assign(d, { posted });
}

test("a challenge that is not the server's 32 random bytes runs nothing", () => {
  assert.ok(challengeOk(CHALLENGE));
  for (const c of ["", "short", `a${"b".repeat(600)}`, "has spaces in it ok", "plus+slash/=", null, 7]) {
    assert.ok(!challengeOk(c as never), String(c));
  }
  assert.deepEqual(trustSteps({ challenge: "short", do: ["deviceCheck"] }, ALL), []);
  assert.deepEqual(trustSteps(null, ALL), []);
  assert.deepEqual(trustSteps({ challenge: CHALLENGE, do: "deviceCheck" }, ALL), []);
});

test("only the steps this binary declared are run, in the server's order, once each", () => {
  assert.deepEqual(trustSteps({ challenge: CHALLENGE, do: ["deviceCheck", "appAttest", "deviceCheck"] }, ALL),
    ["deviceCheck", "appAttest"]);
  assert.deepEqual(trustSteps({ challenge: CHALLENGE, do: ["appAttest", "appAssert", "deviceCheck", "playIntegrity"] }, []), []);
  assert.deepEqual(trustSteps({ challenge: CHALLENGE, do: ["appAttest", "deviceCheck"] }, ["DeviceCheck1"]), ["deviceCheck"]);
  assert.deepEqual(trustSteps({ challenge: CHALLENGE, do: ["playIntegrity"] }, ["PlayIntegrity1"]), ["playIntegrity"]);
  assert.deepEqual(trustSteps({ challenge: CHALLENGE, do: ["nonsense", "appAttest"] }, ALL), ["appAttest"]);
});

test("a step with no capability is not run and NOTHING is posted for it (rule 6)", async () => {
  let called = 0;
  const d = deps({ caps: [], appAttest: async () => { called++; throw new Error("never"); } });
  assert.deepEqual(await runTrustAsk({ challenge: CHALLENGE, do: ["appAttest", "deviceCheck", "playIntegrity"] }, d), []);
  assert.equal(called, 0);
  assert.equal(d.posted.length, 0);
});

test("each answer goes to its own route, with the challenge and nothing about the phone", async () => {
  const d = deps();
  const done = await runTrustAsk({ challenge: CHALLENGE, do: ["appAttest", "appAssert", "deviceCheck", "playIntegrity"], cloudProject: "123" }, d);
  assert.deepEqual(done.map((r) => r.outcome), ["sent", "sent", "sent", "sent"]);
  assert.deepEqual(d.posted.map((p) => p.path), [
    TRUST_ROUTE.appAttest, TRUST_ROUTE.appAssert, TRUST_ROUTE.deviceCheck, TRUST_ROUTE.playIntegrity,
  ]);
  assert.deepEqual(d.posted[0].body, { challenge: CHALLENGE, keyId: "key-1", attestation: "YXR0ZXN0" });
  assert.deepEqual(d.posted[1].body, { challenge: CHALLENGE, keyId: "key-1", assertion: "YXNzZXJ0" });
  // DeviceCheck's body is Apple's token alone (perms2 9.3)
  assert.deepEqual(d.posted[2].body, { token: "ZGV2aWNl" });
  assert.deepEqual(d.posted[3].body, { challenge: CHALLENGE, token: "integrity.token-1" });
  for (const p of d.posted) {
    for (const k of Object.keys(p.body)) {
      assert.ok(["challenge", "keyId", "attestation", "assertion", "token"].includes(k), k);
    }
  }
});

test("a step that fails posts a short code to its own route, once, and the others still run", async () => {
  const d = deps({ appAttest: async () => { throw new Error("DCError: unsupported on this device"); } });
  const done = await runTrustAsk({ challenge: CHALLENGE, do: ["appAttest", "deviceCheck"] }, d);
  assert.deepEqual(done, [{ step: "appAttest", outcome: "failed", code: "unsupported" }, { step: "deviceCheck", outcome: "sent" }]);
  assert.deepEqual(d.posted[0], { path: TRUST_ROUTE.appAttest, body: { challenge: CHALLENGE, failed: "unsupported" } });
  assert.equal(d.posted.length, 2);
});

const coded = (code: string) => Object.assign(new Error(code), { code });

test("a phone holding a key the server never got forgets it and attests ONE fresh key, posted to the attest route", async () => {
  let calls = 0;
  let forgot = 0;
  const d = deps({
    appAttest: async () => { calls++; if (calls === 1) throw coded("attested"); return { keyId: "key-2", attestation: "ZnJlc2g" }; },
    attestForget: async () => { forgot++; },
  });
  const done = await runTrustAsk({ challenge: CHALLENGE, do: ["appAttest"] }, d);
  assert.deepEqual(done, [{ step: "appAttest", outcome: "sent" }]);
  assert.equal(forgot, 1);
  assert.equal(calls, 2);
  assert.deepEqual(d.posted, [{ path: TRUST_ROUTE.appAttest, body: { challenge: CHALLENGE, keyId: "key-2", attestation: "ZnJlc2g" } }]);
});

test("an assert with no key on this phone (a reinstall) attests a fresh key with the same challenge, never a failure", async () => {
  const d = deps({ appAssert: async () => { throw coded("no_key"); } });
  const done = await runTrustAsk({ challenge: CHALLENGE, do: ["appAssert"] }, d);
  assert.deepEqual(done, [{ step: "appAssert", outcome: "sent" }]);
  assert.deepEqual(d.posted, [{ path: TRUST_ROUTE.appAttest, body: { challenge: CHALLENGE, keyId: "key-1", attestation: "YXR0ZXN0" } }]);
});

test("an assert whose key App Attest no longer knows (a reinstall too) attests a fresh one", async () => {
  // TulmiTrust.swift rejects DCError.invalidKey as "invalid_key" and drops the filed key id, so the challenge is still
  // unspent and one fresh key can be attested with it. The server's NO_SIGNAL has no "error", so without this an honest
  // reinstall was recorded as a failed attestation and scored +40.
  const d = deps({ appAssert: async () => { throw coded("invalid_key"); } });
  const done = await runTrustAsk({ challenge: CHALLENGE, do: ["appAssert"] }, d);
  assert.deepEqual(done, [{ step: "appAssert", outcome: "sent" }]);
  assert.deepEqual(d.posted, [{ path: TRUST_ROUTE.appAttest, body: { challenge: CHALLENGE, keyId: "key-1", attestation: "YXR0ZXN0" } }]);
});

test("and if even that fresh attestation fails, it is posted as no signal rather than a failure", async () => {
  const d = deps({ appAssert: async () => { throw coded("invalid_key"); }, appAttest: async () => { throw coded("invalid_key"); } });
  await runTrustAsk({ challenge: CHALLENGE, do: ["appAssert"] }, d);
  assert.deepEqual(d.posted[0].body, { challenge: CHALLENGE, failed: "unsupported" });
});

test("'attested' with no way to forget is a no-signal code, never an error the server scores", async () => {
  const d = deps({ appAttest: async () => { throw coded("attested"); } });
  await runTrustAsk({ challenge: CHALLENGE, do: ["appAttest"] }, d);
  assert.deepEqual(d.posted[0].body, { challenge: CHALLENGE, failed: "unsupported" });
});

test("a DeviceCheck failure is posted WITHOUT the challenge, which App Attest has usually spent", async () => {
  const d = deps({ deviceCheckToken: async () => { throw coded("unsupported"); } });
  await runTrustAsk({ challenge: CHALLENGE, do: ["appAttest", "deviceCheck"] }, d);
  assert.deepEqual(d.posted[1], { path: TRUST_ROUTE.deviceCheck, body: { failed: "unsupported" } });
});

test("a token the module hands back in the wrong shape is a failure, not something posted", async () => {
  const bad = deps({ appAttest: async () => ({ keyId: "", attestation: "not base64 !!" }) as never });
  await runTrustAsk({ challenge: CHALLENGE, do: ["appAttest"] }, bad);
  assert.deepEqual(bad.posted[0].body, { challenge: CHALLENGE, failed: "unsupported" });
  assert.ok(base64Ok("YXR0ZXN0"));
  for (const v of ["", "a b", "üü", null, 7, "x".repeat(40_000)]) assert.ok(!base64Ok(v as never), String(v));
});

test("the module's own code is the answer, kept as it is", () => {
  const withCode = (code: string, message = "This phone cannot do that.") => Object.assign(new Error(message), { code });
  assert.equal(failCode(withCode("unsupported")), "unsupported");
  assert.equal(failCode(withCode("throttled")), "throttled");
  assert.equal(failCode(withCode("no_play")), "no_play");
  assert.equal(failCode(withCode("no_key")), "no_key");
  assert.equal(failCode(withCode("bad_project")), "no_play");
  assert.equal(failCode(withCode("something_new")), "error");
  // A LOST NETWORK IS NOT A FAILED ATTESTATION. The server scores "error" as claimed-and-failed (+40, spec 8.3), so a local
  // or passing failure must come back as one of its no-signal codes instead (spec 8.2 rule 6).
  for (const code of ["transient", "provider_invalid", "not_prepared", "system", "unavailable"]) {
    assert.equal(failCode(withCode(code)), "timeout", code);
  }
  // `invalid_key` is here too: App Attest keys do not survive a reinstall and the filed key id (Keychain) does, so a dead
  // key is the honest reinstall, not an attestation claimed and failed.
  for (const code of ["no_store", "no_context", "no_screen", "hash_too_long", "invalid_key"]) {
    assert.equal(failCode(withCode(code)), "unsupported", code);
  }
  // and a real platform refusal is still "error", which is the signal worth having
  for (const code of ["invalid", "failed"]) assert.equal(failCode(withCode(code)), "error", code);
  // the phone's own words are never the code: a message naming a model would say nothing about the phone
  assert.equal(failCode(withCode("", "iPhone 12,1 refused")), "refused");
});

test("the failure codes are codes, never a message from the system", () => {
  assert.equal(failCode(new Error("Throttled: too many requests")), "throttled");
  assert.equal(failCode(new Error("API_NOT_AVAILABLE")), "no_play");
  assert.equal(failCode(new Error("play services unavailable")), "unsupported");
  assert.equal(failCode(new Error("request timed out")), "timeout");
  assert.equal(failCode(new Error("user denied")), "refused");
  assert.equal(failCode(new Error("something odd happened on iPhone 12,1")), "error");
  assert.equal(failCode(undefined), "error");
});

test("a post that fails is not retried, and nothing throws out of a run", async () => {
  const d = deps({ post: async () => { throw new Error("offline"); } });
  const done = await runTrustAsk({ challenge: CHALLENGE, do: ["deviceCheck"] }, d);
  assert.deepEqual(done, [{ step: "deviceCheck", outcome: "failed", code: "error" }]);
});

test("a 204 answer is a SENT step, not a failure posted a second time", async () => {
  // Each trust route answers 204 with no body (perms2 9.3). React Native's fetch reads json() as text() then JSON.parse, so
  // parsing an empty body throws — and a thrown success used to be reported as failed AND posted again, which spent the
  // single-use challenge and told the server the step had failed.
  const d = deps({
    post: async (path, body) => {
      d.posted.push({ path, body: body as Record<string, unknown> });
      const res = new Response(null, { status: 204 });            // what the server really answers
      return emptyAnswer(res.status) ? undefined : res.json();    // what the poster must do with it
    },
  });
  const done = await runTrustAsk({ challenge: CHALLENGE, do: ["appAttest", "deviceCheck"] }, d);
  assert.deepEqual(done, [{ step: "appAttest", outcome: "sent" }, { step: "deviceCheck", outcome: "sent" }]);
  assert.equal(d.posted.length, 2);
  for (const p of d.posted) assert.equal("failed" in p.body, false);
});

test("one ask at a time: a second ask while one is running is dropped", async () => {
  // Two bootstraps close together carry two challenges, so nothing else catches the duplicate, and two App Attest flows at
  // once each make a key — which the server scores against an honest phone (perms2 8.5).
  let running = 0;
  let peak = 0;
  let finished = 0;
  let release: (() => void) | null = null;
  const gated = oneAtATime(async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise<void>((done) => { release = done; });
    running--;
    finished++;
  });
  const first = gated();
  const second = gated();
  await second;                       // dropped at once: it does not wait for the first
  assert.equal(peak, 1);
  release!();
  await first;
  assert.equal(finished, 1);
  // once the first is done, the next ask runs as usual
  const third = gated();
  release!();
  await third;
  assert.equal(finished, 2);
});

test("the trust ask is wrapped so only one runs at a time", () => {
  const src = readFileSync("src/device/trust.ts", "utf8");
  assert.match(src, /oneAtATime\(/);
  assert.match(src, /export const runTrust = oneAtATime\(/);
});

test("the install id is a v4 UUID made from random bytes and nothing else", () => {
  const bytes = Array.from({ length: 16 }, (_, i) => i * 16 + 7);
  const id = uuidV4From(bytes);
  assert.ok(INSTALL_ID.test(id), id);
  assert.ok(installIdOk(id));
  // the same bytes always give the same id, so the version and variant bits are the only thing forced
  assert.equal(uuidV4From(bytes), id);
  assert.equal(id[14], "4");
  assert.ok(["8", "9", "a", "b"].includes(id[19]));
  assert.throws(() => uuidV4From([1, 2, 3]));
  for (const v of ["", "not-a-uuid", "0123456789ab-cdef-0123-4567-89abcdef", null, 7]) assert.ok(!installIdOk(v as never));
  // all-zero and all-ff bytes still make a valid v4
  assert.ok(INSTALL_ID.test(uuidV4From(new Array(16).fill(0))));
  assert.ok(INSTALL_ID.test(uuidV4From(new Array(16).fill(255))));
});

test("the install id is kept in AsyncStorage, made from random bytes, and sent only behind the flag", () => {
  const src = readFileSync("src/device/installId.ts", "utf8");
  assert.match(src, /AsyncStorage/);
  assert.match(src, /"tulmi\.installId"/);
  assert.match(src, /Crypto\.getRandomBytes\(16\)/);
  assert.match(src, /uuidV4From/);
  // never the Keychain, never the App Group, never derived from the device (the file's own words are not code: comments go first)
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const bad of ["SecureStore", "expo-secure-store", "tulmi-bridge", "setWidget", "expo-application", "expo-device"]) {
    assert.ok(!code.includes(bad), bad);
  }
  const http = readFileSync("src/sdui/client/http.ts", "utf8");
  assert.match(http, /bool\("trust\.installId", false\)/);
  assert.match(http, /X-App-Install/);
  // the header is inside the flag's own block, so a phone with the flag off sends nothing
  const gated = http.slice(http.indexOf('bool("trust.installId"'), http.indexOf('bool("trust.installId"') + 240);
  assert.ok(gated.includes("X-App-Install"), "the install header is behind the flag");
});
