// node --test --experimental-strip-types src/security.test.ts
//
// The lines a screen, a link from the internet or a typed URL cannot cross.
// Each case here is a request that would have carried the user's token, or a
// page that would have opened, somewhere it should not.

import test from "node:test";
import assert from "node:assert";
import {
  checkBaseUrl, isBackendPath, isHandoffUrl, isOpenableUrl, isScreenId, isTailzuPage, isWebUrl, safeFileName,
} from "./security.ts";

test("a release build talks only to https on x0bot.com, or tailzu.space from before the move", () => {
  assert.equal(checkBaseUrl("https://api.x0bot.com", false), "https://api.x0bot.com");
  assert.equal(checkBaseUrl(" https://api.x0bot.com/ ", false), "https://api.x0bot.com");
  assert.equal(checkBaseUrl("https://staging.x0bot.com", false), "https://staging.x0bot.com");
  // A build that stored the old address keeps reaching it: the server answers there too.
  assert.equal(checkBaseUrl("https://api.tailzu.space", false), "https://api.tailzu.space");
  for (const bad of [
    "http://api.x0bot.com",               // the token in clear text
    "https://evil.example",               // someone else's server
    "https://x0bot.com.evil.example",     // a lookalike suffix
    "https://evilx0bot.com",              // a lookalike prefix
    "https://tailzu.space.evil.example",
    "https://eviltailzu.space",
    "https://user:pw@api.x0bot.com",      // credentials
    "https://api.x0bot.com?x=1",          // paths are appended to it
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
  for (const ok of ["https://x0bot.com/privacy", "mailto:support@x0bot.com", "app-settings:", "tel:+15550001234", "tulmi://screen/stats"]) {
    assert.equal(isOpenableUrl(ok), true, ok);
  }
  for (const bad of [
    "javascript:alert(1)", "JAVASCRIPT:alert(1)", "file:///data/data/com.tulmi.app", "content://x",
    "data:text/html,<script>", "intent://scan/#Intent;scheme=zxing;end", "whatsapp://send", "https://", "",
  ]) assert.equal(isOpenableUrl(bad), false, bad);
});

// The assistant's hand-offs, written as the backend writes them
// (connectors/handoffs/links.ts): every word percent-encoded.
const HANDOFFS = [
  "https://wa.me/919876543210?text=Running%2010%20min%20late%0ASorry!",
  "https://wa.me/?text=hi",
  "https://api.whatsapp.com/send?phone=919876543210&text=hi",
  "https://t.me/share/url?url=See%20you%20at%208",
  "https://t.me/rahul_k?text=hey",
  "tel:+919876543210",
  "tel:112",
  "sms:?body=Reached",
  "sms:+919876543210?body=On%20my%20way",
  "upi://pay?pa=9876543210@ybl&pn=9876543210%40ybl&am=99.50&cu=INR",
  "upi://pay?pa=rahul.k@okaxis&pn=Rahul&am=200.00&cu=INR&tn=Dinner%20%F0%9F%8D%95",
  "https://www.google.com/maps/dir/?api=1&destination=Connaught%20Place&travelmode=driving",
  "https://www.google.com/maps/search/?api=1&query=chai%20near%20me",
  "https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Bformatted_address%5D=T3%2C%20Delhi%20Airport",
  "https://www.amazon.in/s?k=usb%20c%20cable",
  "https://www.flipkart.com/search?q=phone%20cover",
  "https://www.youtube.com/results?search_query=lofi%20beats",
  "https://music.youtube.com/search?q=arijit",
  "https://open.spotify.com/search/arijit%20singh",
  "https://www.threads.com/intent/post?text=hello",
  "https://www.threads.net/intent/post?text=hello",
  "https://www.booking.com/searchresults.html?ss=Goa&checkin=2026-11-01&checkout=2026-11-03&group_adults=2&no_rooms=1",
  "https://mail.google.com/mail/?view=cm&fs=1&to=a%40b.com&su=Hi&body=Hello",
  "mailto:a@b.com?subject=Hi&body=Hello",
];

test("openUrl opens every hand-off the assistant writes", () => {
  for (const ok of HANDOFFS) assert.equal(isOpenableUrl(ok), true, ok);
});

test("a UPI link opens only as a payment, and only as written", () => {
  for (const bad of [
    "upi://mandate?pa=x@ybl&am=1",          // an autopay mandate, not a payment
    "upi://collect?pa=x@ybl",
    "upi:pay?pa=x@ybl",
    "upi://pay",
    "upi://pay?",
    "upi://pay?pn=Rahul&pa=x@ybl",          // the backend writes the payee first
    "upi://pay?pa=&am=1",
    "upi://pay?pa=x@ybl&am=1#frag",
    "upi://pay?pa=x@ybl&tn=two words",      // not encoded
    "upi://pay?pa=x@ybl&tn=a\nb",
    "upi://pay?pa=x@ybl\\evil",
    " upi://pay?pa=x@ybl",
    "upi://pay?pa=x@ybl\u0000",
    "upi://evil.example/pay?pa=x@ybl",
    "phonepe://pay?pa=x@ybl", "gpay://upi/pay?pa=x@ybl", "paytmmp://pay?pa=x@ybl",
  ]) assert.equal(isOpenableUrl(bad), false, JSON.stringify(bad));
  assert.equal(isOpenableUrl("UPI://pay?pa=x@ybl"), true);
});

test("an assistant's answer opens only a hand-off, in the form the backend writes it", () => {
  for (const ok of HANDOFFS) assert.equal(isHandoffUrl(ok), true, ok);
  assert.equal(isHandoffUrl("https://t.me/rahul_k"), true);
  assert.equal(isHandoffUrl(`https://wa.me/?text=${"%E0%A4%A8".repeat(800)}`), true);   // a long Hindi message
  for (const bad of [
    "https://example.com/",                                   // any other site
    "https://x0bot.com/",
    "http://wa.me/?text=hi",
    "https://wa.me.evil.com/?text=hi",
    "https://wa.me/?text=hi&app_absent=1",                     // a parameter it never writes
    "https://wa.me/?text=hi#x",
    "https://wa.me/?text=two words",
    "https://user@wa.me/?text=hi",
    "https://wa.me:8443/?text=hi",
    "https://t.me/proxy?server=evil.example&port=443&secret=00", // t.me's own pages are no one's chat
    "https://t.me/joinchat/abc",
    "https://t.me/rahul_k?start=x",
    "https://www.google.com/maps/place/x",
    "https://www.google.com/maps/dir/?api=2&destination=x",
    "https://www.google.com/search?q=x",
    "https://open.spotify.com/search/..",                    // walks out of /search/
    "https://open.spotify.com/search/%2e%2E",
    "https://open.spotify.com/search/.",
    "https://open.spotify.com/search/a/b",
    "https://open.spotify.com/search/a?si=1",
    "https://mail.google.com/mail/?view=om&to=a",
    "https://mail.google.com/mail/u/0/",
    "mailto:a@b.com?attach=/etc/passwd",
    "mailto:",
    "tel:*21*9876543210%23",                                  // call forwarding, not a call
    "tel:+91 98765",
    "tel:12",
    "sms:+919876543210?body=hi&to=x",
    "sms:+919876543210",
    "upi://pay?pa=x@ybl&pn=X&am=1.00&cu=INR&mode=04",          // a parameter it never writes
    "upi://pay?pa=x@ybl&pn=X&am=1.00&cu=INR&url=https://evil.example",
    "upi://pay?pa=x@ybl&pn=X&am=1&cu=INR",
    "upi://pay?pa=x@ybl&am=1.00&cu=INR",
    "upi://pay?pa=x@ybl&pn=X&am=1.00&cu=USD",
    "UPI://pay?pa=x@ybl&pn=X&am=1.00&cu=INR",
    "upi://mandate?pa=x@ybl",
    "tulmi://anything", "app-settings:", "javascript:alert(1)", "intent://x#Intent;end",
    `https://wa.me/?text=${"x".repeat(8000)}`,
    "", null, undefined, 42,
  ]) assert.equal(isHandoffUrl(bad), false, JSON.stringify(bad)?.slice(0, 80));
});

test("the in-app browser and downloads are web pages only", () => {
  assert.equal(isWebUrl("https://x0bot.com"), true);
  assert.equal(isWebUrl("http://example.com/a.pdf"), true);
  assert.equal(isWebUrl("file:///etc/hosts"), false);
  assert.equal(isWebUrl("javascript:alert(1)"), false);
});

test("the WebView node shows our pages and nothing else", () => {
  assert.equal(isTailzuPage("https://x0bot.com/help"), true);
  assert.equal(isTailzuPage("https://app.x0bot.com/x"), true);
  assert.equal(isTailzuPage("https://tailzu.space/help"), true);
  assert.equal(isTailzuPage("https://app.tailzu.space/x"), true);
  assert.equal(isTailzuPage("http://x0bot.com/help"), false);
  assert.equal(isTailzuPage("https://x0bot.com.evil.example/"), false);
  assert.equal(isTailzuPage("https://evilx0bot.com/"), false);
  assert.equal(isTailzuPage("https://evil.example/?x0bot.com"), false);
  assert.equal(isTailzuPage("https://tailzu.space.evil.example/"), false);
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
