/**
 * THE BILLING KEY COMES FROM THE SERVER, AND MUST NOT COME BACK INTO THE BUNDLE.
 *
 * This is a guard, not a unit test: what it watches for is a line being added back, and the cost of that line is
 * paid months later by somebody who cannot see the connection.
 *
 * The keys were baked into the manifest by app.config.ts. `eas update` re-evaluates that config on every publish, so
 * an update built without the variables replaced working keys with empty strings — purchases stopped, nobody had
 * touched billing. The guard that followed refused to publish for a platform whose key the release could not read,
 * which let a PAYMENT integration decide who received JavaScript: Android was dropped from every update for two
 * months, and the run stayed green on a warning.
 *
 * Both halves are gone. The server sends the keys (bootstrap `billing.revenueCatKey.*`) and the app takes them at
 * boot. Put either half back and this fails.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..");
const read = (p: string) => readFileSync(join(APP, p), "utf8");

test("THE MANIFEST CARRIES NO BILLING KEY: a publish has nothing to lose", () => {
  const config = read("app.config.ts");
  const live = config
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
  assert.ok(!/REVENUECAT_[A-Z_]*KEY/.test(live), "app.config.ts reads a RevenueCat key from the environment again");
  assert.ok(!/revenueCat[A-Za-z]*Key\s*:/.test(live), "app.config.ts puts a RevenueCat key in `extra` again");
});

test("and the billing layer does not read one out of the manifest", () => {
  const live = read("src/billing/purchases.ts")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*"))
    .join("\n");
  assert.ok(!/expoConfig/.test(live), "purchases.ts reads the manifest for a key again");
  assert.ok(/setBillingKey/.test(live), "purchases.ts still takes the key the server sent");
});

test("the boot takes the key the server sent, for the platform it is on", () => {
  const boot = read("src/sdui/shell/hooks/useBootLoader.ts");
  assert.ok(/setBillingKey\(/.test(boot), "nothing hands the key to the billing layer at boot");
  assert.ok(/billing\.revenueCatKey\.ios/.test(boot) && /billing\.revenueCatKey\.android/.test(boot),
    "the boot no longer reads both platforms' keys off bootstrap");
});

test("NOTHING ABOUT BILLING GATES A RELEASE: a payment key cannot decide who gets JavaScript", () => {
  const flow = readFileSync(join(APP, "..", ".github", "workflows", "eas-release.yml"), "utf8");
  const live = flow.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
  assert.ok(!/REVENUECAT/.test(live), "the release reads a RevenueCat key again");
  assert.ok(!/eas-keys/.test(live), "the release runs the payment-key gate again");
  // and it publishes to every platform, never a subset worked out from a key
  assert.ok(/--platform all/.test(live), "the update no longer publishes for all platforms");
});
