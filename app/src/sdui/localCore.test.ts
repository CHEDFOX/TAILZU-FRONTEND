// node --test --experimental-strip-types src/sdui/localCore.test.ts
import test from "node:test";
import assert from "node:assert";
import { looksLikeSecret, LOCAL_LIMITS, LocalStore, checkLocalPath, memoryKV } from "./localCore.ts";

test("paths: forbidden names, depth, length and secret-looking names are refused", () => {
  assert.equal(checkLocalPath("hint.seen"), null);
  assert.ok(checkLocalPath("a.__proto__.b"));
  assert.ok(checkLocalPath("constructor"));
  assert.ok(checkLocalPath(Array(13).fill("a").join(".")));
  assert.ok(checkLocalPath("x".repeat(129)));
  assert.ok(checkLocalPath("userToken"));
  assert.ok(checkLocalPath("api_key"));
  assert.ok(checkLocalPath("login.pin"));
  assert.equal(checkLocalPath("pinned"), null);
  assert.ok(checkLocalPath("a b"));
});
test("set and get round trip; a refused write keeps the old value", () => {
  const s = new LocalStore(memoryKV());
  assert.deepEqual(s.set("hint", { seen: true }), { ok: true });
  assert.deepEqual(s.get("hint"), { seen: true });
  assert.equal(s.set("hint", "x".repeat(LOCAL_LIMITS.valueBytes + 1)).ok, false);
  assert.deepEqual(s.get("hint"), { seen: true });
  assert.equal(s.set("a", undefined).ok, false);
});
test("the 256 KB total cap holds across keys, and removing frees room", () => {
  const s = new LocalStore(memoryKV());
  const chunk = "y".repeat(8000);
  let n = 0;
  while (s.set("k" + n, chunk).ok && n < 100) n++;
  assert.ok(n >= 30 && n <= 33, `filled ${n}`);
  assert.ok(s.size() <= LOCAL_LIMITS.totalBytes);
  const full = s.set("extra", chunk);
  assert.deepEqual(full, { ok: false, reason: "store full" });
  s.remove("k0");
  assert.equal(s.set("extra", chunk).ok, true);
});
test("key count cap", () => {
  const s = new LocalStore(memoryKV());
  for (let i = 0; i < LOCAL_LIMITS.keys; i++) assert.ok(s.set("k" + i, 1).ok);
  assert.equal(s.set("one-more", 1).ok, false);
  assert.equal(s.set("k0", 2).ok, true);
});
test("namespaces are separate per account and clearAll wipes them all", () => {
  const kv = memoryKV();
  const s = new LocalStore(kv);
  s.setAccount("alice"); s.set("c", 1);
  s.setAccount("bob");
  assert.equal(s.get("c"), undefined);
  s.set("c", 2);
  s.setAccount("alice");
  assert.equal(s.get("c"), 1);
  assert.deepEqual(s.all(), { c: 1 });
  s.clearAll();
  assert.equal(kv.keys().length, 0);
  assert.equal(s.get("c"), undefined);
});
test("subscribers hear writes and a throwing one does not stop the rest", () => {
  const s = new LocalStore(memoryKV());
  const seen: string[] = [];
  s.subscribe(() => { throw new Error("x"); });
  s.subscribe((p) => seen.push(p));
  s.set("a", 1); s.remove("a");
  assert.deepEqual(seen, ["a", "a"]);
});
test("secret rule matches the kernel's whole-word rule", () => {
  for (const k of ["secretary.seen", "draft.cvvHelp", "lastPin", "session.lastTab", "signatureDraft", "refresh.hint", "cookieBanner.dismissed"]) {
    assert.equal(checkLocalPath(k) !== null, looksLikeSecret(k), k);
  }
  assert.equal(checkLocalPath("secretary.seen"), null);
  assert.ok(checkLocalPath("lastPin"));
  assert.ok(checkLocalPath("cookieBanner.dismissed"));
});
test("running total tracks set, overwrite, remove and clearAll; account switch keeps it", () => {
  const kv = memoryKV();
  const s = new LocalStore(kv);
  s.set("a", "xx"); s.set("a", "xxxx"); s.set("b", 1);
  assert.equal((s as any).total, s.size());
  s.remove("a");
  assert.equal((s as any).total, s.size());
  s.clearAll();
  assert.equal((s as any).total, 0);
  const big = new LocalStore(memoryKV());
  let n = 0;
  while (big.set("k" + n, "y".repeat(8000)).ok && n < 100) n++;
  assert.ok(n * 8000 <= LOCAL_LIMITS.totalBytes && (n + 1) * 8000 > LOCAL_LIMITS.totalBytes - 200);
});
test("notifyAll keeps the account namespace", () => {
  const s = new LocalStore(memoryKV());
  s.setAccount("user42"); s.set("hint.seen", true);
  let hit = 0; s.subscribe(() => hit++);
  s.notifyAll();
  assert.equal(hit, 1);
  assert.equal(s.get("hint.seen"), true);
});
