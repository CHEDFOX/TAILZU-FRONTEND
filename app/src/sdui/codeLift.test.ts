// node --test --experimental-strip-types src/sdui/codeLift.test.ts
//
// The code step's lift. The one-pill entry lives at the foot of the screen and
// rides up with the keyboard; the onboarding's boxes live near the top and
// must stay where they are, or they spring off the screen as the pad opens.

import test from "node:test";
import assert from "node:assert";
import { codeLiftTarget } from "./codeLift.ts";

test("the pill rides up by the keyboard's height less its overlap, while focused", () => {
  assert.equal(codeLiftTarget({ boxes: false, focused: true, kbHeight: 300, overlap: 34 }), -266);
});

test("the pill stays down when it is not focused or the keyboard is not up", () => {
  assert.equal(codeLiftTarget({ boxes: false, focused: false, kbHeight: 300, overlap: 34 }), 0);
  assert.equal(codeLiftTarget({ boxes: false, focused: true, kbHeight: 0, overlap: 34 }), 0);
  assert.equal(codeLiftTarget({ boxes: false, focused: true, kbHeight: Number.NaN, overlap: 34 }), 0);
});

test("the boxes never lift, whatever the keyboard does", () => {
  for (const kbHeight of [0, 216, 300, 420]) {
    for (const focused of [true, false]) {
      assert.equal(codeLiftTarget({ boxes: true, focused, kbHeight, overlap: 34 }), 0);
    }
  }
});
