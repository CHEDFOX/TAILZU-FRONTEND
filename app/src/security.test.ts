// node --test --experimental-strip-types src/security.test.ts
//
// The lines a screen, a link from the internet or a typed URL cannot cross.
// Each case here is a request that would have carried the user's token, or a
// page that would have opened, somewhere it should not.

import test from "node:test";
import assert from "node:assert";
import {
  checkBaseUrl, isBackendPath, isOpenableUrl, isScreenId, isTailzuPage, isWebUrl, safeFileName,
} from "./security.ts";

test("a release build talks only to https on tailzu.space", () => {
  assert.equal(checkBaseUrl("https://api.tailzu.space", false), "https://api.tailzu.space");
  assert.equal(checkBaseUrl(" https://api.tailzu.space/ ", false), "https://api.tailzu.space");
  assert.equal(checkBaseUrl("https://staging.tailzu.space", false), "https://staging.tailzu.space");
  for (const bad of [
    "http://api.tailzu.space",            // the token in clear text
    "https://evil.example",               // someone else's server
    "https://tailzu.space.evil.example",  // a lookalike suffix
    "https://eviltailzu.space",           // a lookalike prefix
    "https://user:pw@api.tailzu.space",   // credentials
    "https://api.tailzu.space?x=1",       // paths are appended to it
    "javascript:alert(1)",
    "",
    null,
  ]) assert.equal(checkBaseUrl(bad, false), null, String(bad));
});

test("a development build may point at a PC", () => {
  assert.equal(checkBaseUrl("http://10.0.2.2:8770", true), "http://10.0.2.2:8770");
  assert.equal(checkBaseUrl("http://192.168.1.5:8770/", true), "http://192.168.1.5:8770");
  assert.equal(checkBaseUrl("ftp://10.0.2.2", true), null);
  assert.equal(checkBaseUrl("file:///etc/passwd", true), null);
});

test("callEndpoint stays under /v1/ on the backend", () => {
  for (const ok of ["/v1/profile", "/v1/history/abc%2F..%2Fx", "/v1/history/42?x=1", "/v1/train/converse"]) {
    assert.equal(isBackendPath(ok), true, ok);
  }
  for (const bad of [
    "/v2/profile", "v1/profile", "https://evil.example/v1/x", "//evil.example/v1/",
    "/v1//evil.example", "/v1/../admin", "/v1/./x", "/v1/%2e%2e/admin", "/v1/%2E%2e/admin",
    "/v1/..%5cadmin", "/v1/\\evil", "/v1/x@evil", "/v1/x\r\nHost: evil", "/v1/%zz", "/v1/a b",
    undefined, 42,
  ]) assert.equal(isBackendPath(bad), false, String(bad));
});

test("openUrl hands the OS pages, mail and settings — not code or intents", () => {
  for (const ok of ["https://tailzu.space/privacy", "mailto:support@tailzu.space", "app-settings:", "tel:+15550001234", "tulmi://screen/stats"]) {
    assert.equal(isOpenableUrl(ok), true, ok);
  }
  for (const bad of [
    "javascript:alert(1)", "JAVASCRIPT:alert(1)", "file:///data/data/com.tulmi.app", "content://x",
    "data:text/html,<script>", "intent://scan/#Intent;scheme=zxing;end", "whatsapp://send", "https://", "",
  ]) assert.equal(isOpenableUrl(bad), false, bad);
});

test("the in-app browser and downloads are web pages only", () => {
  assert.equal(isWebUrl("https://tailzu.space"), true);
  assert.equal(isWebUrl("http://example.com/a.pdf"), true);
  assert.equal(isWebUrl("file:///etc/hosts"), false);
  assert.equal(isWebUrl("javascript:alert(1)"), false);
});

test("the WebView node shows tailzu.space and nothing else", () => {
  assert.equal(isTailzuPage("https://tailzu.space/help"), true);
  assert.equal(isTailzuPage("https://app.tailzu.space/x"), true);
  assert.equal(isTailzuPage("http://tailzu.space/help"), false);
  assert.equal(isTailzuPage("https://tailzu.space.evil.example/"), false);
  assert.equal(isTailzuPage("https://evil.example/?tailzu.space"), false);
});

test("a link names a screen, never a path", () => {
  for (const ok of ["stats", "keyboard_record", "flow_arm", "history.detail"]) assert.equal(isScreenId(ok), true, ok);
  for (const bad of ["", "../x", "a/b", "<script>", "x".repeat(81), undefined]) assert.equal(isScreenId(bad), false, String(bad));
});

test("a download stays in the cache directory", () => {
  assert.equal(safeFileName("../../Documents/secret", "f"), "secret");
  assert.equal(safeFileName("..\\..\\x.txt", "f"), "x.txt");
  assert.equal(safeFileName("..", "f"), "f");
  assert.equal(safeFileName("report 1.pdf", "f"), "report_1.pdf");
  assert.equal(safeFileName(undefined, "tulmi-1"), "tulmi-1");
});
