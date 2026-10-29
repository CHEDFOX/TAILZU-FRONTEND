// node --test --experimental-strip-types src/billing/storePriceCore.test.ts
//
// A plan's price on the paywall comes from the store once it answers; until then, and whenever it cannot say, the server's
// words stay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillStorePrice, isStorePriceSpec } from "./storePriceCore.ts";

const prices = { $rc_annual: { price: "₹4,999.00", perMonth: "₹416.58" }, $rc_monthly: { price: "₹499.00", perMonth: null } };

test("the store's price, in the person's currency", () => {
  assert.equal(fillStorePrice({ packageId: "$rc_annual" }, prices), "₹4,999.00");
  assert.equal(fillStorePrice({ packageId: "$rc_monthly", template: "Then {price}" }, prices), "Then ₹499.00");
  assert.equal(fillStorePrice({ packageId: "$rc_annual", field: "perMonth", template: "{price} / mo, billed yearly" }, prices),
    "₹416.58 / mo, billed yearly");
});

test("the server's words stay when the store cannot say", () => {
  assert.equal(fillStorePrice({ packageId: "$rc_annual" }, null), null);
  assert.equal(fillStorePrice({ packageId: "$rc_weekly" }, prices), null);
  assert.equal(fillStorePrice({ packageId: "$rc_monthly", field: "perMonth" }, prices), null);
});

test("a template without {price} is the price alone", () => {
  assert.equal(fillStorePrice({ packageId: "$rc_monthly", template: "per month" }, prices), "₹499.00");
});

test("only a spec with a package is one", () => {
  assert.equal(isStorePriceSpec({ packageId: "$rc_annual" }), true);
  for (const v of [null, undefined, "x", {}, { packageId: "" }, { packageId: 3 }]) assert.equal(isStorePriceSpec(v), false);
});
