// node --test --experimental-strip-types src/sdui/theme/paintCore.test.ts
import test from "node:test";
import assert from "node:assert";
import { PAINT_LIMITS, isPaintKey, paintBlend, paintBlur, paintFilter, paintGradient, paintShadows, resolvePaint, safeColor } from "./paintCore.ts";

test("linear gradient string: direction words become degrees, stops are clamped", () => {
  assert.equal(paintGradient("linear-gradient(to right, #fff 0%, rgba(0,0,0,0.5) 150%)"), "linear-gradient(90deg, #fff 0%, rgba(0,0,0,0.5) 100%)");
});
test("gradient object and radial", () => {
  assert.equal(paintGradient({ kind: "linear", angle: 45, stops: [{ color: "red", at: 0 }, { color: "#00f", at: 1 }] }), "linear-gradient(45deg, red 0%, #00f 100%)");
  assert.equal(paintGradient("radial-gradient(circle, #fff, #000)"), "radial-gradient(circle, #fff, #000)");
});
test("a gradient with a url or var colour, or one stop, is dropped", () => {
  assert.equal(paintGradient("linear-gradient(url(x), #000)"), null);
  assert.equal(paintGradient("linear-gradient(90deg, #fff)"), null);
  assert.equal(paintGradient("url(http://x/y.png)"), null);
});
test("layers and stops are capped", () => {
  const layer = "linear-gradient(red, blue)";
  const many = Array(9).fill(layer).join(", ");
  assert.equal(paintGradient(many)!.split("), ").length, PAINT_LIMITS.layers);
  const stops = Array(20).fill("red").join(", ");
  assert.equal(paintGradient(`linear-gradient(${stops})`)!.split(",").length, PAINT_LIMITS.stops);
});
test("box shadow string and clamping", () => {
  assert.deepEqual(paintShadows("0 4px 12px 0 rgba(0, 0, 0, 0.2)"), [{ offsetX: 0, offsetY: 4, blurRadius: 12, spreadDistance: 0, color: "rgba(0, 0, 0, 0.2)" }]);
  const s = paintShadows([{ offsetX: 999, offsetY: -999, blurRadius: 999, spreadDistance: 999, color: "#000", inset: true }])![0];
  assert.deepEqual([s.offsetX, s.offsetY, s.blurRadius, s.spreadDistance, s.inset], [100, -100, 80, 50, true]);
  assert.equal(paintShadows(Array(9).fill("1 1 1 #000"))!.length, PAINT_LIMITS.shadows);
  assert.equal(paintShadows("nonsense"), null);
});
test("filter keeps only the functions both platforms draw, clamped", () => {
  assert.deepEqual(paintFilter("brightness(5) blur(4px) hue-rotate(90deg) opacity(0.5)"), [{ brightness: 3 }, { opacity: 0.5 }]);
  assert.deepEqual(paintFilter([{ grayscale: "50%" }, { sepia: 9 }, { opacity: "50%" }]), [{ opacity: 0.5 }]);
  assert.equal(paintFilter("blur(4px)"), null);
});
test("adversarial filter string is fast", () => {
  const t = Date.now();
  paintFilter("a(" + " ".repeat(2040));
  paintFilter("a(" + " ".repeat(200));
  assert.ok(Date.now() - t < 50);
});
test("colour names are RN's own; tokens resolve through the callback", () => {
  assert.equal(safeColor("bananas"), null);
  assert.equal(safeColor("inherit"), null);
  assert.equal(safeColor("red"), "red");
  assert.equal(safeColor("transparent"), "transparent");
  const r = resolvePaint({ backgroundImage: { kind: "linear", stops: ["$c", "#000"] }, boxShadow: { offsetX: 0, offsetY: 2, color: "$c" } }, (v) => (v === "$c" ? "#ff5500" : undefined));
  assert.equal(r.style.experimental_backgroundImage, "linear-gradient(180deg, #ff5500, #000)");
  assert.equal((r.style.boxShadow as any)[0].color, "#ff5500");
});
test("prototype names are not gradient directions; px stops are ignored", () => {
  assert.equal(paintGradient("linear-gradient(constructor, red, blue)"), null);
  assert.equal(paintGradient("linear-gradient(__proto__, red, blue)"), null);
  assert.equal(paintGradient({ kind: "linear", stops: [{ color: "red", at: "10px" }, "blue"] }), "linear-gradient(180deg, red, blue)");
});
test("blend and blur", () => {
  assert.equal(paintBlend("multiply"), "multiply");
  assert.equal(paintBlend("javascript"), null);
  assert.deepEqual(paintBlur(500), { intensity: 100, tint: "light" });
  assert.deepEqual(paintBlur({ intensity: 20, tint: "dark" }), { intensity: 20, tint: "dark" });
  assert.deepEqual(paintBlur({ intensity: 20, tint: "evil" }), { intensity: 20, tint: "light" });
  assert.equal(paintBlur(0), null);
});
test("resolvePaint ignores unknown keys, renames the gradient, and never throws", () => {
  const r = resolvePaint({ backgroundImage: "linear-gradient(red, blue)", boxShadow: "0 2 4 #000", color: "red", wat: 1, blur: 10 });
  assert.deepEqual(Object.keys(r.style).sort(), ["boxShadow", "experimental_backgroundImage"]);
  assert.equal(r.blur?.intensity, 10);
  assert.deepEqual(resolvePaint(null).style, {});
  assert.deepEqual(resolvePaint({ get backgroundImage(): string { throw new Error("x"); } } as any).style, {});
});
test("safeColor", () => {
  assert.equal(safeColor("#abc"), "#abc");
  assert.equal(safeColor("url(x)"), null);
  assert.equal(safeColor(5), null);
});
test("the passthrough gate covers every paint key and RN's experimental_ ones", () => {
  for (const k of ["backgroundImage", "boxShadow", "filter", "mixBlendMode", "blur", "experimental_backgroundImage"]) assert.equal(isPaintKey(k), true, k);
  assert.equal(isPaintKey("transform"), false);
});
