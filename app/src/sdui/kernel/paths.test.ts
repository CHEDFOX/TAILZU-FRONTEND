// node --test
//
// The three kinds of path the server may name, and the limits table they are measured against.
import test from "node:test";
import assert from "node:assert";
import { LIMITS, byteLen, everyFloorMs, stringFits } from "./limits.ts";
import {
  encodeHole, localKeyError, localKeyOk, looksLikeSecret, networkPathError, networkPathOk, pathsTouch,
  statePathError, statePathOk,
} from "./paths.ts";
import { BLOCKS, LATER_BLOCKS, VOCAB, canDraw, isBlock, missingBlocks, unknownBlocks } from "./blocks.ts";

test("a state path is plain segments, and the three dangerous names are refused", () => {
  assert.ok(statePathOk("call.startedAt"));
  assert.ok(statePathOk("rows.3.id"));
  assert.ok(!statePathOk("__proto__"));
  assert.ok(!statePathOk("a.constructor.b"));
  assert.ok(!statePathOk("a.prototype"));
  assert.match(statePathError("a..b"), /empty segment/);
  assert.match(statePathError("a b"), /plain name/);
  assert.match(statePathError(""), /non-empty string/);
  assert.match(statePathError(5), /non-empty string/);
  assert.match(statePathError("a.".repeat(LIMITS.pathSegments) + "b"), /at most 12 segments/);
  assert.match(statePathError("a".repeat(LIMITS.pathChars + 1)), /at most 128 characters/);
});

test("a local key follows the same shape and never reads like a secret", () => {
  assert.ok(localKeyOk("hint.dismissed"));
  assert.ok(localKeyOk("lastChoice"));
  assert.ok(!localKeyOk("authToken"));
  assert.ok(!localKeyOk("api_key"));
  assert.ok(!localKeyOk("session"));
  assert.match(localKeyError("refreshToken"), /reads like a secret/);
  assert.match(localKeyError("a.__proto__"), /not a name/);
  assert.ok(looksLikeSecret("userPassword"));
  assert.ok(looksLikeSecret("otp"));
  assert.ok(!looksLikeSecret("pinnedNote"), "a word that merely starts with one is fine");
  assert.ok(!looksLikeSecret("spinner"));
});

test("a network path is relative, under /v1/, and cannot climb or leave", () => {
  assert.ok(networkPathOk("/v1/notes/n1"));
  assert.ok(networkPathOk("/v1/feed?cursor=abc"));
  assert.match(networkPathError("/v2/notes"), /starts with \/v1\//);
  assert.match(networkPathError("https://evil.test/v1/x"), /no scheme/);
  assert.match(networkPathError("//evil.test/v1/x"), /names no host/);
  assert.match(networkPathError("/v1/../admin"), /\.\./);
  assert.match(networkPathError("/v1//admin"), /"\/\/"/);
  assert.match(networkPathError("/v1/a b"), /space or a control/);
  assert.match(networkPathError("/v1/" + "x".repeat(3000)), /2048 bytes/);
  assert.match(networkPathError("javascript:alert(1)"), /no scheme/);
});

test("every spelling of a dot segment is refused, because every URL library resolves them", () => {
  // WHATWG (the window), OkHttp (Android) and Foundation (iOS) all read `.%2e`, `%2e.` and `%2e%2e` as `..`, so
  // a path that only LOOKS clean leaves /v1/. The resolved path is checked here, not the text as written.
  for (const climb of ["/v1/%2e%2e/admin", "/v1/.%2e/admin", "/v1/%2e./admin", "/v1/notes/.%2E/.%2e/internal", "/v1/%2E%2E/x"]) {
    assert.match(networkPathError(climb), /\.\./, climb);
    assert.strictEqual(new URL(climb, "https://api.test").pathname.startsWith("/v1/"), false, `${climb} really does climb out`);
  }
  assert.match(networkPathError("/v1/a%2f%2fb"), /"\/\/"/);
  assert.match(networkPathError("/v1/a%5cb"), /backslash/);
});

test("ordinary words in a query do not cost the person their request", () => {
  // The climbing checks measure the PATH, the part before `?`: only that decides which endpoint is reached.
  assert.ok(networkPathOk(`/v1/search?q=${encodeHole("wait...")}`), "an ellipsis typed into a search box");
  assert.ok(networkPathOk(`/v1/search?q=${encodeHole("http://x.y")}`), "a pasted URL");
  assert.ok(networkPathOk(`/v1/search?q=${encodeHole("a//b")}`));
  assert.ok(!networkPathOk(`/v1/notes/${encodeHole("../admin")}/open`), "the same words in the path still climb");
});

test("a value filled into a path is encoded, so it cannot become part of the path", () => {
  assert.strictEqual(encodeHole("../admin"), "%2E%2E%2Fadmin", "the dots are encoded as well as the slash");
  assert.strictEqual(encodeHole("n 1"), "n%201");
  assert.strictEqual(encodeHole(42), "42");
  assert.strictEqual(encodeHole(Number.NaN), "0");
  assert.strictEqual(encodeHole(null), "");
  assert.strictEqual(encodeHole({ id: 1 }), "");
  assert.ok(networkPathOk(`/v1/notes/${encodeHole("n 1/2")}`), "an ordinary id comes through as one segment");
  assert.ok(
    !networkPathOk(`/v1/notes/${encodeHole("../admin")}`),
    "encoding makes the slash harmless, and the last gate refuses the dots anyway (SPEC 2.2)",
  );
});

test("two paths touch when one is inside the other", () => {
  assert.ok(pathsTouch("state.a.b", "state.a.b"));
  assert.ok(pathsTouch("state.a.b", "state.a"));
  assert.ok(pathsTouch("state.a", "state.a.b"));
  assert.ok(!pathsTouch("state.a", "state.ab"));
  assert.ok(pathsTouch("state.rows.*", "state.rows.4.name"));
  assert.ok(!pathsTouch("state.rows.*", "state.other"));
});

test("a byte is a byte: the limits are measured in them, not in characters", () => {
  assert.strictEqual(byteLen("abc"), 3);
  assert.strictEqual(byteLen("é"), 2);
  assert.strictEqual(byteLen("中"), 3);
  assert.strictEqual(byteLen("😀"), 4);
  assert.ok(stringFits("x".repeat(LIMITS.stringBytes)));
  assert.ok(!stringFits("x".repeat(LIMITS.stringBytes + 1)));
  assert.ok(!stringFits("😀".repeat(LIMITS.stringBytes / 2)));
});

test("the limits table is frozen, so a screen can never raise one", () => {
  assert.throws(() => {
    (LIMITS as unknown as Record<string, number>).exprOps = 1e9;
  });
  assert.strictEqual(LIMITS.exprOps, 256);
  assert.strictEqual(everyFloorMs(true, true), 250);
  assert.strictEqual(everyFloorMs(true, false), 1000);
  assert.strictEqual(everyFloorMs(false, true), 1000);
});

test("the blocks are a closed list, and vocab 2 is what this kernel speaks", () => {
  assert.strictEqual(VOCAB, 2);
  assert.strictEqual(BLOCKS.length, 14);
  assert.ok(isBlock("call"), "one of our own calls (TAILZU-BACKEND/docs/rooms.md)");
  assert.ok(isBlock("expr"));
  assert.ok(!isBlock("scene"), "the standalone drawing node belongs to the animation spec's format 3");
  assert.ok(LATER_BLOCKS.includes("scene"));
  assert.deepStrictEqual(unknownBlocks(["expr", "wat", 7]), ["wat", "7"]);
  assert.deepStrictEqual(missingBlocks(["expr", "rules"], ["expr", "list"]), ["list"]);
  assert.ok(canDraw(["expr", "defs"], ["expr"]));
  assert.ok(!canDraw([], ["expr"]), "every block is off for a screen unless the client declared it");
  assert.ok(canDraw([], []), "a screen that needs nothing new draws anywhere");
});
