// node --test --experimental-strip-types src/billing/elsewhere.test.ts
//
// The one rule in this app that can cost somebody money by being wrong in
// either direction: too loose and they are billed twice by two stores that
// cannot see each other, too strict and they cannot move to the plan they are
// trying to pay more for.

import test from "node:test";
import assert from "node:assert";
import { manageElsewhere } from "./elsewhere.ts";

type Flags = Parameters<typeof manageElsewhere>[0];
const ios = (f: Flags) => manageElsewhere(f, "ios");
const android = (f: Flags) => manageElsewhere(f, "android");

test("a free account buys, on either phone", () => {
  assert.equal(ios({ "billing.entitled": false }), null);
  assert.equal(android({}), null);
  assert.equal(ios(null), null);
});

test("its own store goes through — that is a tier change, not a second sub", () => {
  // Monthly to annual. The store swaps it and prorates it; blocking this
  // strands somebody on the plan they are trying to spend more on.
  assert.equal(ios({ "billing.entitled": true, "billing.manage.apple": true }), null);
  assert.equal(android({ "billing.entitled": true, "billing.manage.google": true }), null);
});

test("bought on iOS, opening Android — refused, and sent to Apple", () => {
  const msg = android({ "billing.entitled": true, "billing.manage.apple": true });
  assert.match(String(msg), /App Store/);
  assert.match(String(msg), /Subscriptions/);
});

test("bought on Android, opening iOS — refused, and sent to Google", () => {
  const msg = ios({ "billing.entitled": true, "billing.manage.google": true });
  assert.match(String(msg), /Google Play/);
});

test("bought on the web — neither phone may sell a second one", () => {
  const f = { "billing.entitled": true, "billing.manage.web": true };
  assert.match(String(ios(f)), /billed on the web/);
  assert.match(String(android(f)), /billed on the web/);
});

test("a store this build has never heard of still stops the purchase", () => {
  // A promotional grant, or a billing engine added after this release. The
  // safe direction is to stop: the cost of a wrong "go ahead" is real money,
  // and the cost of a wrong stop is a support email.
  const msg = ios({ "billing.entitled": true });
  assert.match(String(msg), /already has an active subscription/);
});
