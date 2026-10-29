// node --test --experimental-strip-types src/auth/linkComputer.test.ts
//
// Signing in on a computer with this phone: the computer's QR opens
// https://app.x0bot.com/s/bots.link?l=<token> (or tulmi://screen/bots.link?l=…
// from the browser's page), which the router takes as the screen bots.link with
// its `l`. That link carries no session of any kind: it must never be read as a
// sign-in link for THIS phone, whatever its token happens to spell.

import test from "node:test";
import assert from "node:assert";
import { randomBytes } from "node:crypto";
import { readAuthLink } from "./linkState.ts";

const token = () => randomBytes(32).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("the computer's QR link is a screen link, never a sign-in link for this phone", () => {
  for (let i = 0; i < 200; i++) {
    const l = token();
    assert.strictEqual(readAuthLink(`https://app.x0bot.com/s/bots.link?l=${l}`), null);
    assert.strictEqual(readAuthLink(`tulmi://screen/bots.link?l=${l}`), null);
  }
});
