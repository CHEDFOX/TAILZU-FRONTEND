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

test("bought on iOS, opening Android — one tap to where it lives", () => {
  // The whole point of the button: nobody should be reading directions to a
  // settings screen to undo a tap they did not mean to make.
  const e = android({
    "billing.entitled": true,
    "billing.manage.apple": true,
    "billing.manage.url": "https://apps.apple.com/account/subscriptions",
  });
  assert.match(e!.message, /the App Store/);
  assert.match(e!.message, /covers every device/);
  assert.equal(e!.action!.url, "https://apps.apple.com/account/subscriptions");
  assert.equal(e!.action!.label, "Open App Store");
});

test("bought on Android, opening iOS — one tap to Google Play", () => {
  const e = ios({
    "billing.entitled": true,
    "billing.manage.google": true,
    "billing.manage.url": "https://play.google.com/store/account/subscriptions",
  });
  assert.match(e!.message, /Google Play/);
  assert.equal(e!.action!.label, "Open Google Play");
});

test("bought on the web — neither phone may sell a second one", () => {
  const f = {
    "billing.entitled": true,
    "billing.manage.web": true,
    "billing.manage.url": "mailto:support@tailzu.space",
  };
  assert.match(ios(f)!.message, /the web/);
  assert.equal(android(f)!.action!.url, "mailto:support@tailzu.space");
});

test("no address means no button, and never a dead one", () => {
  // An older server, or a store it has no page for. The refusal still stands;
  // it just has nothing to offer, which is better than a button that opens
  // nothing.
  const e = android({ "billing.entitled": true, "billing.manage.apple": true });
  assert.match(e!.message, /the App Store/);
  assert.equal(e!.action, undefined);
});

test("a store this build has never heard of still stops the purchase", () => {
  // A promotional grant, or a billing engine added after this release. The
  // safe direction is to stop: the cost of a wrong "go ahead" is real money,
  // and the cost of a wrong stop is a support email.
  const e = ios({ "billing.entitled": true });
  assert.match(e!.message, /already has an active subscription/);
  assert.equal(e!.action, undefined);
});
