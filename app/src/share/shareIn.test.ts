// node --test --experimental-strip-types src/share/shareIn.test.ts
//
// Each case is a thing someone shares into Tailzu from another app.

import test from "node:test";
import assert from "node:assert";
import { planShare, runShareIn, shareParams, type ShareIO, type SharedFile } from "./shareIn.ts";

const file = (name: string, uri = `file:///cache/share-in/b/${name}`): SharedFile => ({ type: "file", uri, name, mime: "application/pdf", bytes: 1000 });

test("a web address on its own is a link; words stay words", () => {
  assert.deepStrictEqual(planShare({ items: [{ type: "text", text: "  https://maps.app.goo.gl/x1 " }] }), { text: "", url: "https://maps.app.goo.gl/x1", files: [], skipped: 0 });
  // Chrome on Android: the page's title (SUBJECT) and its address (TEXT).
  const p = planShare({ items: [{ type: "text", text: "Kavya's new place" }, { type: "text", text: "https://maps.app.goo.gl/x1" }] });
  assert.strictEqual(p.url, "https://maps.app.goo.gl/x1");
  assert.strictEqual(p.text, "Kavya's new place");
  // A sentence with an address in it is a sentence.
  assert.deepStrictEqual(planShare({ items: [{ type: "text", text: "Book this https://irctc.co.in for Friday" }] }).url, "");
});

test("one link is the link, the rest go with the words; the same words twice are said once", () => {
  const p = planShare({ items: [
    { type: "url", url: "https://a.in/1" }, { type: "url", url: "https://a.in/1" }, { type: "url", url: "https://b.in/2" },
    { type: "text", text: "Look" }, { type: "text", text: "Look" }, { type: "url", url: "javascript:alert(1)" },
  ] });
  assert.strictEqual(p.url, "https://a.in/1");
  assert.strictEqual(p.text, "Look\n\nhttps://b.in/2");
});

test("at most five files; the rest, and any the phone couldn't take, are counted", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g"].map((n) => file(`${n}.pdf`));
  const p = planShare({ items, skipped: 2 });
  assert.strictEqual(p.files.length, 5);
  assert.strictEqual(p.skipped, 4);
});

test("the screen's params: the first file, all of them when several, the words and the link", () => {
  assert.deepStrictEqual(shareParams({ text: "", url: "" }, ["f1"]), { file: "f1" });
  assert.deepStrictEqual(shareParams({ text: "Hi", url: "https://x.in" }, ["f1", "f2"]), { file: "f1", files: "f1,f2", text: "Hi", url: "https://x.in" });
  assert.deepStrictEqual(shareParams({ text: "Hi", url: "" }, []), { text: "Hi" });
});

function rig(o: { batch?: ReturnType<ShareIO["consume"]>; enabled?: boolean; upload?: ShareIO["upload"] } = {}) {
  const log: string[] = [];
  const opened: Array<Record<string, string>> = [];
  const io: ShareIO = {
    consume: () => o.batch ?? null,
    enabled: () => o.enabled ?? true,
    upload: o.upload ?? (async (f) => ({ id: `id-${f.name}` })),
    discard: async (f) => { log.push(`discard ${f.name}`); },
    open: (p) => { opened.push(p); },
    toast: (m, tone) => { log.push(`toast${tone ? `:${tone}` : ""} ${m}`); },
    words: { adding: "Adding it…", failed: "Couldn't add that.", partly: "Some of it couldn't be added.", off: "Not on yet." },
  };
  return { io, log, opened };
}

test("nothing waiting: nothing happens", async () => {
  const r = rig();
  assert.strictEqual(await runShareIn(r.io), "none");
  assert.deepStrictEqual(r.log, []);
});

test("files go up one by one, their copies are dropped, and the screen opens with every id", async () => {
  const r = rig({ batch: { items: [file("Ticket.pdf"), file("IMG_2041.jpg"), { type: "text", text: "For Goa" }] } });
  assert.strictEqual(await runShareIn(r.io), "opened");
  assert.deepStrictEqual(r.log, ["toast Adding it…", "discard Ticket.pdf", "discard IMG_2041.jpg"]);
  assert.deepStrictEqual(r.opened, [{ file: "id-Ticket.pdf", files: "id-Ticket.pdf,id-IMG_2041.jpg", text: "For Goa" }]);
});

test("a file the server refuses: its words are shown, and the rest still opens", async () => {
  const r = rig({
    batch: { items: [file("IMG_1.heic"), file("Ticket.pdf")] },
    upload: async (f) => (f.name.endsWith(".heic") ? { error: "HEIC pictures are not supported yet." } : { id: "f9" }),
  });
  assert.strictEqual(await runShareIn(r.io), "opened");
  assert.ok(r.log.includes("toast:error HEIC pictures are not supported yet."));
  assert.deepStrictEqual(r.opened, [{ file: "f9" }]);
});

test("nothing could be added: say so, open nothing, keep nothing", async () => {
  const r = rig({ batch: { items: [file("a.pdf")] }, upload: async () => { throw new Error("offline"); } });
  assert.strictEqual(await runShareIn(r.io), "failed");
  assert.deepStrictEqual(r.log, ["toast Adding it…", "discard a.pdf", "toast:error Couldn't add that."]);
  assert.deepStrictEqual(r.opened, []);
});

test("words alone open the screen at once, with no upload", async () => {
  let uploads = 0;
  const r = rig({ batch: { items: [{ type: "text", text: "Dinner with Mom, Thursday 7" }] }, upload: async () => { uploads++; return { id: "x" }; } });
  assert.strictEqual(await runShareIn(r.io), "opened");
  assert.strictEqual(uploads, 0);
  assert.deepStrictEqual(r.opened, [{ text: "Dinner with Mom, Thursday 7" }]);
});

test("too many files: the first five open, and the person is told some were left", async () => {
  const r = rig({ batch: { items: ["a", "b", "c", "d", "e", "f"].map((n) => file(`${n}.pdf`)) } });
  await runShareIn(r.io);
  assert.strictEqual(r.opened[0]!.files!.split(",").length, 5);
  assert.ok(r.log.includes("toast:error Some of it couldn't be added."));
});

test("the Bots app is off: nothing is sent, the copies go, and the person is told", async () => {
  const r = rig({ batch: { items: [file("a.pdf")] }, enabled: false, upload: async () => { throw new Error("must not upload"); } });
  assert.strictEqual(await runShareIn(r.io), "off");
  assert.deepStrictEqual(r.log, ["discard a.pdf", "toast Not on yet."]);
});

test("the server's limits: fewer files and less text when it says so, never more than the screen takes", () => {
  const items = [1, 2, 3, 4].map((i) => file(`f${i}.pdf`));
  const lowered = planShare({ items: [...items, { type: "text", text: "x".repeat(50) }] }, { files: 2, text: 10 });
  assert.equal(lowered.files.length, 2);
  assert.equal(lowered.skipped, 2);
  assert.equal(lowered.text.length, 10);
  const raised = planShare({ items: [...items, ...items.map((f) => ({ ...f, uri: f.uri + "2" }))] }, { files: 50 });
  assert.equal(raised.files.length, 5, "five is the most, whatever it is told");
});
