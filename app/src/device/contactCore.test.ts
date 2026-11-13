// node --test --experimental-strip-types src/device/contactCore.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { pickContactEmail, pickedEmail } from "./contactCore.ts";

test("only one clean address is taken", () => {
  assert.equal(pickedEmail(" asha@example.com "), "asha@example.com");
  for (const bad of ["", "asha", "a@b", "Asha <asha@example.com>", "a@b.com, c@d.com", "a b@c.com", null, 5, "x".repeat(260) + "@a.com"]) {
    assert.equal(pickedEmail(bad as never), null, String(bad));
  }
});

test("picked, cancelled, error", async () => {
  assert.deepEqual(await pickContactEmail(async () => "asha@example.com"), { outcome: "picked", email: "asha@example.com" });
  assert.deepEqual(await pickContactEmail(async () => null), { outcome: "cancel" });
  assert.deepEqual(await pickContactEmail(async () => "not an email"), { outcome: "error" });
  assert.deepEqual(await pickContactEmail(async () => { throw new Error("x"); }), { outcome: "error" });
  assert.deepEqual(await pickContactEmail(undefined), { outcome: "error" });
});
