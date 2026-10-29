// node --test --experimental-strip-types src/sdui/mediaCore.test.ts
//
// What a screen is told while a file goes, a voice is heard and a sound plays (media.ts).

import test from "node:test";
import assert from "node:assert";
import {
  clock, cleanName, every, fillPath, isApiPath, joinWords, levelOf, nameFor, pctOf, playStateOf, progressOf, refusalWords, sizeWords,
  soundSource, tooBigWords,
} from "./mediaCore.ts";

const WORDS = { fallback: "Couldn't send that file. Try again.", signedOut: "Sign in again.", tooMany: "Wait a moment.", off: "Sending files isn't on yet." };

test("a size and a time, written for a person", () => {
  assert.equal(sizeWords(820), "820 B");
  assert.equal(sizeWords(412 * 1024), "412 KB");
  assert.equal(sizeWords(3.4 * 1024 * 1024), "3.4 MB");
  assert.equal(sizeWords(3 * 1024 * 1024), "3 MB");
  assert.equal(sizeWords(48.6 * 1024 * 1024), "49 MB");
  assert.equal(sizeWords(Number.NaN), "0 B");
  assert.equal(clock(2.7), "0:02");
  assert.equal(clock(65), "1:05");
  assert.equal(clock(-1), "0:00");
});

test("how far, never past the end and never not a number", () => {
  assert.equal(pctOf(42, 100), 42);
  assert.equal(pctOf(150, 100), 100);
  assert.equal(pctOf(5, 0), 0);
  assert.equal(pctOf(Number.NaN, 10), 0);
  assert.deepEqual(progressOf("Price list.pdf", "file", 512 * 1024, 1024 * 1024), { name: "Price list.pdf", kind: "file", pct: 50, percent: "50%", size: "1 MB" });
});

test("a sound that plays says which, how far and how long", () => {
  assert.deepEqual(playStateOf("sage", 2.2, 5.1), { id: "sage", pct: 43, at: "0:02", of: "0:05", time: "0:02 / 0:05" });
  // Not loaded yet: no length to show.
  assert.deepEqual(playStateOf("sage", 0, 0), { id: "sage", pct: 0, at: "0:00", of: "0:00", time: "0:00" });
});

test("a picked file keeps its name, without a folder or a trick in it", () => {
  assert.equal(cleanName("Price list.pdf", "file"), "Price list.pdf");
  assert.equal(cleanName("../../etc/passwd", "file"), "passwd");
  assert.equal(cleanName("C:\\Users\\a\\bill?.pdf", "file"), "bill.pdf");
  assert.equal(cleanName(".hidden", "file"), "hidden");
  assert.equal(cleanName("", "file"), "file");
  assert.equal(cleanName("मेरा बिल.pdf", "file"), "मेरा बिल.pdf");
  assert.equal(nameFor("photo", null, "file:///cache/ImagePicker/1A2B.jpeg"), "photo.jpg");
  assert.equal(nameFor("video", undefined, "file:///cache/x", "video/quicktime"), "recording.mov");
  assert.equal(nameFor("screenshot", "IMG_0042.PNG", "file:///x.png"), "IMG_0042.PNG");
  assert.equal(nameFor("file", "", "content://doc"), "file");
});

test("a refusal is said in the server's words only where they are written for a person", () => {
  assert.equal(refusalWords(413, JSON.stringify({ code: "too_big", message: "That pdf is over 25 MB, which is the most I read of its kind." }), WORDS),
    "That pdf is over 25 MB, which is the most I read of its kind.");
  assert.equal(refusalWords(422, JSON.stringify({ code: "password", message: "That PDF is password-protected." }), WORDS), "That PDF is password-protected.");
  assert.equal(refusalWords(401, JSON.stringify({ message: "Missing or invalid token" }), WORDS), "Sign in again.");
  assert.equal(refusalWords(429, "", WORDS), "Wait a moment.");
  assert.equal(refusalWords(404, JSON.stringify({ code: "media_off", message: "Reading files is not switched on." }), WORDS), "Sending files isn't on yet.");
  assert.equal(refusalWords(400, JSON.stringify({ code: "no_file", message: "Send the file as a multipart form with one `file` part." }), WORDS), WORDS.fallback);
  assert.equal(refusalWords(502, "<html>Bad gateway</html>", WORDS), WORDS.fallback);
  assert.equal(refusalWords(503, "not json", WORDS), WORDS.fallback);
  assert.equal(tooBigWords(50 * 1024 * 1024), "That file is over 50 MB, the most Tailzu takes.");
});

test("a sound's address: the app's own path, or https; state filled in", () => {
  const state: Record<string, unknown> = { "read.speed": "1.25", "who": "a b" };
  assert.equal(fillPath("/v1/keybot/voices/sage/sample?speed=$state.read.speed", (p) => state[p]), "/v1/keybot/voices/sage/sample?speed=1.25");
  assert.equal(fillPath("/x/$state.who/$state.none", (p) => state[p]), "/x/a%20b/");
  assert.deepEqual(soundSource("/v1/keybot/voices/sage/sample"), { path: "/v1/keybot/voices/sage/sample" });
  assert.deepEqual(soundSource("https://cdn.x0bot.com/a.mp3"), { web: "https://cdn.x0bot.com/a.mp3" });
  assert.equal(soundSource("//evil.com/x"), null);
  assert.equal(soundSource("http://evil.com/x"), null);
  assert.equal(soundSource("/v1/../../x"), null);
  assert.equal(soundSource("file:///etc/passwd"), null);
  assert.equal(isApiPath("/v1/files"), true);
  assert.equal(isApiPath("https://x/v1/files"), false);
});

test("how loud: silence is nothing, speech fills it, in tenths", () => {
  assert.equal(levelOf(-160), 0);
  assert.equal(levelOf(-50), 0);
  assert.equal(levelOf(-31), 0.5);
  assert.equal(levelOf(-5), 1);
  assert.equal(levelOf(undefined), 0);
});

test("the words said go after what was typed", () => {
  assert.equal(joinWords("Book a cab", "to the airport"), "Book a cab to the airport");
  assert.equal(joinWords("", " kal 7 baje "), "kal 7 baje");
  assert.equal(joinWords(undefined, "hi"), "hi");
  assert.equal(joinWords("hi ", ""), "hi");
});

test("progress is written a few times a second, and the last one always", () => {
  let t = 0;
  const ok = every(150, () => t);
  assert.equal(ok(), true);
  t = 100; assert.equal(ok(), false);
  t = 160; assert.equal(ok(), true);
  t = 170; assert.equal(ok(true), true);
});
