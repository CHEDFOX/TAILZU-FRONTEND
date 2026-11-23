// node --test --experimental-strip-types src/sdui/components/siteViewCore.test.ts
//
// SiteView: the props it will accept, where the page may go, how a server script is run and answered, what a
// message from the page may say, and the walk to a site's sign-in — including noticing, carefully, that it is done.
import test from "node:test";
import assert from "node:assert";
import {
  CLEAR_LOOKS, freshSignIn, hostAllowed, parseSiteMessage, pressed, readOf, signInStep, siteViewOf, wrapScript,
  type PageShape, type SignInState,
} from "./siteViewCore.ts";

const SCRIPTS = { shape: "({signIn:false})", findLogin: "({clicked:null})", read: "({text:''})" };
const PROPS = { mode: "signin", url: "https://www.swiggy.com/auth", site: "www.swiggy.com", hosts: ["swiggy.com", "accounts.google.com"], scripts: SCRIPTS };

test("props: a whole one is taken, and anything missing is no SiteView at all", () => {
  assert.deepStrictEqual(siteViewOf(PROPS)?.mode, "signin");
  assert.strictEqual(siteViewOf({ ...PROPS, url: "javascript:alert(1)" }), null);
  assert.strictEqual(siteViewOf({ ...PROPS, mode: "browse" }), null);
  assert.strictEqual(siteViewOf({ ...PROPS, hosts: [] }), null);
  assert.strictEqual(siteViewOf({ ...PROPS, scripts: { ...SCRIPTS, read: "" } }), null);
  assert.strictEqual(siteViewOf({ ...PROPS, hosts: ["swiggy.com", "<script>"] })?.hosts.length, 1);
  assert.strictEqual(siteViewOf({ ...PROPS, home: "https://www.swiggy.com/" })?.home, "https://www.swiggy.com/");
});

test("props: https only, and the page, the name shown and every host are one site (a sign-in may also hand off to Google or Apple)", () => {
  assert.strictEqual(siteViewOf({ ...PROPS, url: "http://www.swiggy.com/auth" }), null, "http is refused");
  assert.strictEqual(siteViewOf({ ...PROPS, home: "http://www.swiggy.com/" })?.home, undefined, "an http home is dropped");
  assert.strictEqual(siteViewOf({ ...PROPS, home: "https://bank.example/" })?.home, undefined, "a home on another site is dropped");
  // A read of one site's page with another site's hosts: the injected script would run in the bank's signed-in session.
  const READ = { mode: "read", url: "https://bank.example/", site: "shop.example", hosts: ["bank.example"], scripts: SCRIPTS };
  assert.strictEqual(siteViewOf(READ), null, "the name shown is not the page's site");
  assert.strictEqual(siteViewOf({ ...READ, site: "bank.example", url: "https://shop.example/" }), null, "the page is not on its hosts");
  assert.strictEqual(siteViewOf({ ...PROPS, hosts: ["swiggy.com", "mail.google.com"] }), null, "a host that is neither the site nor a sign-in hand-off");
  assert.strictEqual(siteViewOf({ mode: "read", url: "https://www.swiggy.com/orders", site: "swiggy.com", hosts: ["swiggy.com", "accounts.google.com"], scripts: SCRIPTS }), null, "a read never hands off");
  assert.strictEqual(siteViewOf({ ...PROPS, url: "https://www.swiggy.co.in/", site: "www.swiggy.co.in", hosts: ["co.in"] }), null, "a public suffix is not a site");
  assert.strictEqual(siteViewOf({ ...PROPS, hosts: ["com"] }), null);
  // What the server sends today still opens.
  assert.ok(siteViewOf({ mode: "read", url: "https://www.swiggy.com/orders", site: "swiggy.com", hosts: ["swiggy.com"], scripts: SCRIPTS }));
  assert.ok(siteViewOf({ ...PROPS, hosts: ["swiggy.com", "accounts.google.com", "appleid.apple.com"] }));
  assert.ok(siteViewOf({ mode: "read", url: "https://www.flipkart.co.in/x", site: "flipkart.co.in", hosts: ["flipkart.co.in"], scripts: SCRIPTS }));
  assert.ok(!hostAllowed("http://www.swiggy.com/", ["swiggy.com"]), "the page may not go to http either");
});

test("where the page may go: the site and its sign-in hand-offs, and nowhere else", () => {
  const h = ["swiggy.com", "accounts.google.com"];
  assert.ok(hostAllowed("https://www.swiggy.com/auth", h));
  assert.ok(hostAllowed("https://swiggy.com/", h));
  assert.ok(hostAllowed("https://accounts.google.com/o/oauth2", h));
  assert.ok(hostAllowed("about:blank", h));
  // The tricks this is here for.
  assert.ok(!hostAllowed("https://swiggy.com.evil.net/", h));
  assert.ok(!hostAllowed("https://evilswiggy.com/", h));
  assert.ok(!hostAllowed("file:///etc/passwd", h));
  assert.ok(!hostAllowed("intent://x", h));
  assert.ok(!hostAllowed("not a url", h));
});

test("a server script is run as an expression and answers with its kind", () => {
  const js = wrapScript("shape", "({signIn:true})");
  const posted: string[] = [];
  // Run it the way the WebView would, with the bridge it posts to.
  new Function("window", js)({ ReactNativeWebView: { postMessage: (s: string) => posted.push(s) } });
  assert.deepStrictEqual(JSON.parse(posted[0]!), { k: "shape", v: { signIn: true } });
  // One that throws says so, rather than going quiet.
  const bad: string[] = [];
  new Function("window", wrapScript("read", "(function(){throw new Error('nope')})()"))({ ReactNativeWebView: { postMessage: (s: string) => bad.push(s) } });
  assert.deepStrictEqual(JSON.parse(bad[0]!), { k: "read", e: "nope" });
  assert.ok(js.endsWith("true;"));
});

test("messages from the page are checked: unknown kinds and oversized ones go nowhere", () => {
  assert.deepStrictEqual(parseSiteMessage(JSON.stringify({ k: "shape", v: { url: "u", title: "t", signIn: 1, loginLink: true } })),
    { k: "shape", v: { url: "u", title: "t", signIn: false, loginLink: true } });
  assert.deepStrictEqual(parseSiteMessage(JSON.stringify({ k: "login", v: { clicked: "Sign in" } })), { k: "login", v: { clicked: "Sign in" } });
  assert.deepStrictEqual(parseSiteMessage(JSON.stringify({ k: "read", e: "boom" })), { k: "error", kind: "read", message: "boom" });
  assert.strictEqual(parseSiteMessage(JSON.stringify({ k: "token", v: { token: "x" } })), null);
  assert.strictEqual(parseSiteMessage("x".repeat(200_000)), null);
  assert.strictEqual(parseSiteMessage("{not json"), null);
});

test("a read is held to what the server accepts", () => {
  const r = readOf({ url: "u", title: "t", text: "w".repeat(30_000), elements: [{ id: "e1", role: "link", label: "Track" }, { role: "x" }, null] });
  assert.strictEqual(r.text.length, 20_000);
  assert.deepStrictEqual(r.elements, [{ id: "e1", role: "link", label: "Track" }]);
});

// ------------------------------------------------------------------ the walk to the sign-in

const at = (url: string, o: Partial<PageShape> = {}): PageShape => ({ url, title: "", signIn: false, loginLink: false, ...o });
function walk(steps: PageShape[], st: SignInState = freshSignIn()) {
  const nexts: string[] = [];
  for (const s of steps) { const r = signInStep(st, s); st = r.st; nexts.push(r.next); }
  return { st, nexts };
}

test("a start that is already the sign-in: wait for them, and notice when they are through", () => {
  // swiggy.com/auth, as it really answered: the form straight away.
  const { nexts } = walk([
    at("https://www.swiggy.com/auth", { signIn: true }),
    at("https://www.swiggy.com/auth", { signIn: true }),       // typing the number, then the code
    at("https://www.swiggy.com/", { loginLink: false }),       // through: one quiet look...
    at("https://www.swiggy.com/", { loginLink: false }),       // ...and a second, so it counts
  ]);
  assert.deepStrictEqual(nexts, ["wait", "wait", "wait", "signedIn"]);
});

test("a home page with a 'Sign in' on it: press it once, then wait for the drawer", () => {
  // bluedart, as it really went: its /login was not a sign-in, its home has a "Sign in" that opens one.
  const { nexts } = walk([at("https://www.bluedart.com/", { loginLink: true }), at("https://www.bluedart.com/", { loginLink: true }), at("https://www.bluedart.com/#login", { signIn: true })]);
  assert.deepStrictEqual(nexts, ["findLogin", "wait", "wait"]);
});

test("nothing to press at the start: try the site's home once, then leave it to the person", () => {
  // amazon's old /ap/signin, as it really answered: a 404 with nothing to press on it.
  let st = freshSignIn();
  st = signInStep(st, at("https://www.amazon.in/ap/signin")).st;
  let r = pressed(st, null, "https://www.amazon.in/ap/signin", "https://www.amazon.in/");
  assert.strictEqual(r.next, "goHome");
  // And at home, still nothing: no third place to try. The person is looking at the real site.
  st = signInStep(r.st, at("https://www.amazon.in/")).st;
  r = pressed(st, null, "https://www.amazon.in/", "https://www.amazon.in/");
  assert.strictEqual(r.next, "wait");
  assert.strictEqual(pressed(st, "Sign in", "https://www.amazon.in/", "https://www.amazon.in/").next, "wait");
});

// THE GUARD. A page part way through loading looks like nothing — no sign-in, no "Sign in" link — and calling that
// "signed in" would tell the server a person is connected who has done nothing at all.
test("never 'signed in' without a sign-in having been on screen first", () => {
  const { nexts, st } = walk(Array.from({ length: 6 }, () => at("https://www.swiggy.com/")));
  assert.ok(!nexts.includes("signedIn"));
  assert.ok(!st.done);
});

test("one quiet look is not enough: the blink between a number and its code does not count", () => {
  const { nexts } = walk([
    at("https://x.com/auth", { signIn: true }),
    at("https://x.com/auth"),                    // the form re-draws for the code: a single gap
    at("https://x.com/auth", { signIn: true }),  // and it is back
    at("https://x.com/"),
  ]);
  assert.ok(!nexts.includes("signedIn"));
  assert.strictEqual(CLEAR_LOOKS, 2);
});

test("a page still offering 'Sign in' is not signed in, however long the form has been gone", () => {
  const { nexts } = walk([at("https://x.com/auth", { signIn: true }), at("https://x.com/", { loginLink: true }), at("https://x.com/", { loginLink: true }), at("https://x.com/", { loginLink: true })]);
  assert.ok(!nexts.includes("signedIn"));
});

test("once signed in it stays done, whatever the page does next", () => {
  const { st } = walk([at("u", { signIn: true }), at("v"), at("v")]);
  assert.ok(st.done);
  assert.strictEqual(signInStep(st, at("u", { signIn: true })).next, "wait");
});
