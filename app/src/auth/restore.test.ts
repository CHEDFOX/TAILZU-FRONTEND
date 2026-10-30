// node --test --experimental-strip-types src/auth/restore.test.ts
//
// Signed in or not, at launch: only a phone holding no session is signed out.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { restoreSession, type StoredSession } from "./restore.ts";

/** A world where getSession answers from a list, and the phone holds what `held` says. */
function world(answers: Array<string | null | Error>, held: StoredSession | StoredSession[] = "present") {
  const log: string[] = [];
  let i = 0, j = 0;
  return {
    log,
    deps: {
      getSession: async () => {
        const a = answers[Math.min(i++, answers.length - 1)];
        log.push(`get:${a instanceof Error ? "throw" : a}`);
        if (a instanceof Error) throw a;
        return a;
      },
      stored: async () => (Array.isArray(held) ? held[Math.min(j++, held.length - 1)]! : held),
      untilActive: async () => { log.push("active"); },
      sleep: async (ms: number) => { log.push(`sleep:${ms}`); },
    },
  };
}

describe("restoring the session at launch", () => {
  it("a session read at once is signed in, with no waiting", async () => {
    const w = world(["s1"]);
    assert.deepEqual(await restoreSession(w.deps), { state: "in", session: "s1" });
    assert.deepEqual(w.log, ["active", "get:s1"]);
  });

  it("nothing kept on the phone is signed out, at once", async () => {
    const w = world([null], "absent");
    assert.deepEqual(await restoreSession(w.deps), { state: "out" });
    assert.deepEqual(w.log, ["active", "get:null"]);
  });

  it("an expired token whose refresh failed for a moment is tried again, never shown the sign-in page", async () => {
    const w = world([null, null, "s2"]);
    assert.deepEqual(await restoreSession(w.deps), { state: "in", session: "s2" });
    assert.deepEqual(w.log, ["active", "get:null", "sleep:200", "active", "get:null", "sleep:400", "active", "get:s2"]);
  });

  it("a Keychain that cannot be read yet (a locked phone) is waited out, not taken as signed out", async () => {
    const w = world([new Error("locked"), "s3"], "unreadable");
    assert.deepEqual(await restoreSession(w.deps), { state: "in", session: "s3" });
  });

  it("still unreachable after every try: opens signed in (held), to catch up when it can", async () => {
    const w = world([null], "present");
    assert.deepEqual(await restoreSession({ ...w.deps, tries: 4 }), { state: "held" });
    assert.deepEqual(w.log.filter((l) => l.startsWith("sleep")), ["sleep:200", "sleep:400", "sleep:800"]);
  });

  it("a session that goes from kept to gone while trying (the refresh token was refused) is signed out", async () => {
    const w = world([null], ["present", "absent"]);
    assert.deepEqual(await restoreSession(w.deps), { state: "out" });
  });

  it("a storage read that throws counts as unreadable, not as nothing kept", async () => {
    const w = world([null, "s4"]);
    const deps = { ...w.deps, stored: async (): Promise<StoredSession> => { throw new Error("keychain"); } };
    assert.deepEqual(await restoreSession(deps), { state: "in", session: "s4" });
  });
});
