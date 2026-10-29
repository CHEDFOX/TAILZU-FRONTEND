/* X0 Bot: marks made of the letters themselves, painted flat. No character: x and 0 are the shapes.
 * Painted the way the Claude mark is (flat colour, no lines or shading, every edge cut in short uneven
 * facets), each on its own colour field. Uses the paper and media model of ../handdrawn-v2/draw.js.
 * Space: the 1000 x 1000 icon square. */
(function () {
  "use strict";
  const { G, rng } = HD;

  // ---- geometry: closed outlines in icon units -------------------------------------------------
  const circle = (cx, cy, rx, ry, rot = 0, n = 240) => {
    const pts = [], c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, x = rx * Math.cos(a), y = ry * Math.sin(a); pts.push([cx + x * c - y * s, cy + x * s + y * c]); }
    return pts;
  };
  /** A straight stroke from a to b, half-width w, with rounded ends. */
  const stroke = ([ax, ay], [bx, by], w, n = 40) => {
    const a = Math.atan2(by - ay, bx - ax), pts = [];
    for (let i = 0; i <= n; i++) { const t = a - Math.PI / 2 + (Math.PI * i) / n; pts.push([bx + Math.cos(t) * w, by + Math.sin(t) * w]); }
    for (let i = 0; i <= n; i++) { const t = a + Math.PI / 2 + (Math.PI * i) / n; pts.push([ax + Math.cos(t) * w, ay + Math.sin(t) * w]); }
    return pts;
  };
  /** An x: two strokes crossing at (cx, cy), arms reaching rx, ry, half-width w, turned by rot. */
  const ex = (cx, cy, rx, ry, w, rot = 0) => {
    const c = Math.cos(rot), s = Math.sin(rot), p = (x, y) => [cx + x * c - y * s, cy + x * s + y * c];
    return [stroke(p(-rx, -ry), p(rx, ry), w), stroke(p(rx, -ry), p(-rx, ry), w)];
  };
  /** A four-point spark (an x of tapering rays). */
  const spark = (cx, cy, R, rot = Math.PI / 4, pinch = 0.22) => {
    const pts = [];
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2, k = Math.pow(Math.abs(Math.cos(2 * (a - rot))), 2.6);
      const r = R * (pinch + (1 - pinch) * k); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  };

  // ---- painting ----------------------------------------------------------------------------------
  /** Cut an outline into short uneven straight facets (a flat brush, or cut paper). */
  const facet = (pts, r, len = 30, jit = 3) => {
    const P = G.resample(pts, 1, true), out = [];
    for (let i = 0; i < P.length; i += Math.max(2, Math.round(len * (0.6 + 0.8 * r())))) {
      const [x, y] = P[i], q = P[(i + 1) % P.length], tx = q[0] - x, ty = q[1] - y, tl = Math.hypot(tx, ty) || 1, d = r.pm(jit);
      out.push([x - (ty / tl) * d, y + (tx / tl) * d]);
    }
    return out;
  };
  /** Paint flat colour: each entry of shapes is an outline; holes are cut with the even-odd rule. */
  const paint = (art, r, color, shapes, o = {}) => {
    const cut = o.cut ? shapes : shapes.map((s) => facet(s, r, o.len ?? 30, o.jit ?? 3));   // cut: already faceted
    art.mark(color, { tooth: 0, soft: 0.05, paper: "fine" }, (c) => {
      if (o.clip) { c.beginPath(); o.clip.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.clip(); }
      c.beginPath();
      for (const s of cut) { s.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); }
      c.fill(o.evenodd ? "evenodd" : "nonzero");
    });
  };
  const ground = (art, top, bottom) => {
    art.paper({ color: top, mottle: 0, grain: 0, vignette: 0 });
    if (bottom) art.mark(bottom, { tooth: 0, soft: 0, paper: "fine" }, (c) => {
      const g = c.createLinearGradient(0, 0, 0, 1000); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(255,255,255,1)");
      c.fillStyle = g; c.fillRect(-10, -10, 1020, 1020);
    });
  };
  const ring = (cx, cy, rx, ry, t, rot = 0) => [circle(cx, cy, rx, ry, rot), circle(cx, cy, rx - t, ry - t, rot)];

  const V = [];

  // 1 · Hug: "xo" is hugs and kisses. The x and the o hold each other, linked like a chain.
  V.push({ id: "1-hug", name: "1 · Hug", seed: 7202,
    note: "'xo' means hugs and kisses: the x and the o linked like a chain, each one over and under the other. Tomato and ink on cream.",
    paint(art, r) {
      ground(art, "#F6F0E6", "#EFE7DA");
      const C = [606, 512], R = 214, T = 80, X = [392, 512], A = 238, x = ex(X[0], X[1], A, A, 60);
      const o = ring(C[0], C[1], R, R, T).map((sh) => facet(sh, r, 34, 3));   // cut once, so both coats of the ring match
      paint(art, r, "#161412", o, { cut: true, evenodd: true });
      paint(art, r, "#FF5A3C", x, { len: 34 });
      // the x's lower-right arm goes under the ring: paint the ring again just where that arm crosses its band
      const hit = [];
      for (let t = 0; t <= 1; t += 0.005) {
        const p = [X[0] + A * t, X[1] + A * t], d = Math.hypot(p[0] - C[0], p[1] - C[1]);
        if (d > R - T - 6 && d < R + 6) hit.push(p);
      }
      const bx = (k, f) => f(...hit.map((p) => p[k]));
      const pad = 74, box = [[bx(0, Math.min) - pad, bx(1, Math.min) - pad], [bx(0, Math.max) + pad, bx(1, Math.min) - pad], [bx(0, Math.max) + pad, bx(1, Math.max) + pad], [bx(0, Math.min) - pad, bx(1, Math.max) + pad]];
      paint(art, r, "#161412", o, { cut: true, evenodd: true, clip: box });
    } });

  // 2 · Lettering: the name itself, hand-painted. A short x and a tall 0 on one baseline.
  V.push({ id: "2-lettering", name: "2 · Lettering", seed: 7303,
    note: "The name, hand-painted: a short x and a tall 0 on one baseline, tight together. Ink on acid lime.",
    paint(art, r) {
      ground(art, "#D6F25B", "#C8E64E");
      paint(art, r, "#141311", ex(330, 588, 112, 122, 54, 0.02), { len: 32 });
      paint(art, r, "#141311", ring(640, 510, 150, 206, 64, 0.03), { len: 32, evenodd: true });
    } });

  HD.HANG = V;   // the sheet (../handdrawn-v2/sheet.mjs) reads names and notes from here
  HD.MARKS = V;
  HD.markRng = (seed) => rng(seed);
})();
