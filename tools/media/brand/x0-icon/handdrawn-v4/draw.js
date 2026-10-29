/* X0 Bot, hand-drawn icons (v2): the drawing library (shared with v1, plus stroke width profiles). Runs in the browser (headless Chromium).
 *
 * Space: everything is drawn in a 1000 x 1000 square and rasterised at N px (2048 for the masters,
 * averaged down to 1024 at the end).
 *
 * Media model: a mark is first drawn as "pressure" (white, with alpha) into a scratch canvas, then
 * deposited on the picture through the paper's tooth (a height map). A crayon at low pressure only
 * catches the paper's peaks, so its strokes break up into grain; ink lands almost solid with a
 * slightly dry edge. Lines are stamped along wobbled, resampled paths with tapering, slightly uneven
 * width, and an overshoot where a closed line meets itself, like a pen drawn in one go.
 *
 * Every random choice comes from a seeded generator: the same spec always gives the same picture.
 */
(function () {
  "use strict";
  const TAU = Math.PI * 2;

  // ---------- randomness ----------
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    const r = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (lo, hi) => lo + (hi - lo) * r();
    r.pm = (v) => (r() * 2 - 1) * v;
    return r;
  }

  /** Seeded 2D gradient noise, about -1..1, with fbm. */
  function perlin(seed) {
    const r = rng(seed * 7919 + 13), perm = new Uint16Array(512), base = [];
    for (let i = 0; i < 256; i++) base.push(i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = base[i]; base[i] = base[j]; base[j] = t; }
    for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
    const gx = new Float32Array(256), gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const a = r() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    function n(x, y) {
      const X = Math.floor(x), Y = Math.floor(y), fx = x - X, fy = y - Y, xi = X & 255, yi = Y & 255;
      const h00 = perm[perm[xi] + yi], h10 = perm[perm[xi + 1] + yi], h01 = perm[perm[xi] + yi + 1], h11 = perm[perm[xi + 1] + yi + 1];
      const d00 = gx[h00] * fx + gy[h00] * fy, d10 = gx[h10] * (fx - 1) + gy[h10] * fy;
      const d01 = gx[h01] * fx + gy[h01] * (fy - 1), d11 = gx[h11] * (fx - 1) + gy[h11] * (fy - 1);
      const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      const a = d00 + u * (d10 - d00), b = d01 + u * (d11 - d01);
      return (a + v * (b - a)) * 1.41;
    }
    n.fbm = (x, y, oct = 4, lac = 2.03, gain = 0.5) => {
      let s = 0, amp = 1, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) { s += amp * n(x * f + i * 17.3, y * f - i * 9.1); norm += amp; amp *= gain; f *= lac; }
      return s / norm;
    };
    return n;
  }

  // ---------- colour ----------
  function rgb(c) {
    if (Array.isArray(c)) return c;
    const h = c.replace("#", "");
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

  // ---------- geometry (point lists in the 1000 space) ----------
  const G = {};
  /** Superellipse outline, clockwise on screen, starting at angle `start` (radians, 0 = right). */
  G.squircle = (cx, cy, a, b, n = 3, count = 720, start = -Math.PI / 2) => {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const t = start + (i / count) * TAU, c = Math.cos(t), s = Math.sin(t);
      pts.push([cx + a * Math.sign(c) * Math.abs(c) ** (2 / n), cy + b * Math.sign(s) * Math.abs(s) ** (2 / n)]);
    }
    return G.resample(pts, 1.2, true);
  };
  G.ellipse = (cx, cy, rx, ry, count = 360, start = -Math.PI / 2) => {
    const pts = [];
    for (let i = 0; i < count; i++) { const t = start + (i / count) * TAU; pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
    return G.resample(pts, 1.2, true);
  };
  /** Quadratic bezier, sampled. */
  G.quad = (a, c, b, count = 200) => {
    const pts = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count, u = 1 - t;
      pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
    return G.resample(pts, 1.0, false);
  };
  G.cubic = (a, c1, c2, b, count = 240) => {
    const pts = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count, u = 1 - t;
      pts.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
                u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
    }
    return G.resample(pts, 1.0, false);
  };
  G.arc = (cx, cy, rx, ry, a0, a1, count = 160) => {
    const pts = [];
    for (let i = 0; i <= count; i++) { const t = a0 + ((a1 - a0) * i) / count; pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
    return G.resample(pts, 1.0, false);
  };
  G.line = (a, b) => G.resample([a, b], 1.0, false);
  /** Rounded rectangle (a stadium when r = w / 2), clockwise from the top centre. */
  G.rrect = (cx, cy, w, h, r) => {
    r = Math.min(r, w / 2, h / 2);
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, pts = [];
    const corner = (ox, oy, a0) => { for (let i = 0; i <= 24; i++) { const a = a0 + (Math.PI / 2) * (i / 24); pts.push([ox + r * Math.cos(a), oy + r * Math.sin(a)]); } };
    pts.push([cx, y0]); corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
    return G.resample(pts, 1.0, true);
  };
  /** Evenly spaced points along a polyline. */
  G.resample = (pts, step, closed) => {
    const src = closed ? pts.concat([pts[0]]) : pts, out = [src[0].slice()];
    let carry = 0;
    for (let i = 1; i < src.length; i++) {
      const [ax, ay] = src[i - 1], [bx, by] = src[i], L = Math.hypot(bx - ax, by - ay);
      let d = step - carry;
      while (d <= L) { out.push([ax + ((bx - ax) * d) / L, ay + ((by - ay) * d) / L]); d += step; }
      carry = L - (d - step);
    }
    if (closed && out.length > 2 && Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]) < step * 0.5) out.pop();
    if (!closed) out.push(src[src.length - 1].slice());
    return out;
  };
  /** Rotate by `rot` around (ox, oy), then move by (dx, dy). */
  G.xf = (pts, rot = 0, ox = 0, oy = 0, dx = 0, dy = 0) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return pts.map(([x, y]) => [ox + (x - ox) * c - (y - oy) * s + dx, oy + (x - ox) * s + (y - oy) * c + dy]);
  };
  G.pt = (p, rot, ox, oy) => G.xf([p], rot, ox, oy)[0];
  G.area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  /** Unit normals; for a closed shape they point outward. */
  G.normals = (pts, closed) => {
    const n = pts.length, out = [], sign = closed && G.area(pts) < 0 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      out.push([(dy / L) * sign, (-dx / L) * sign]);
    }
    return out;
  };
  G.lengths = (pts, closed) => {
    const s = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = closed ? s[s.length - 1] + Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) : s[s.length - 1];
    return { s, total };
  };
  /** Displace along the normal by low-frequency noise: the hand's wobble. Seamless on closed shapes. */
  G.wobble = (pts, closed, amp, wl, noise, phase = 0) => {
    if (!amp) return pts.map((p) => p.slice());
    const nr = G.normals(pts, closed), { s, total } = G.lengths(pts, closed), R = total / (TAU * wl);
    return pts.map((p, i) => {
      let d;
      if (closed) { const t = (s[i] / total) * TAU; d = noise.fbm(phase + R * Math.cos(t), phase * 0.7 + R * Math.sin(t), 2); }
      else d = noise.fbm(s[i] / wl + phase, phase * 1.3 + 0.5, 2);
      return [p[0] + nr[i][0] * d * amp, p[1] + nr[i][1] * d * amp];
    });
  };
  /** Push a closed outline outward (positive) or inward by d. */
  G.offset = (pts, d) => { const nr = G.normals(pts, true); return pts.map((p, i) => [p[0] + nr[i][0] * d, p[1] + nr[i][1] * d]); };
  G.path = (c, pts, closed = true) => {
    if (Array.isArray(pts[0][0])) { // several closed parts (e.g. two eye windows): one path, union
      c.beginPath();
      for (const part of pts) { c.moveTo(part[0][0], part[0][1]); for (let i = 1; i < part.length; i++) c.lineTo(part[i][0], part[i][1]); c.closePath(); }
      return;
    }
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (closed) c.closePath();
  };
  G.bbox = (pts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1 };
  };
  /** A closed loop opened at its start and carried a little past it (the pen overshoots where it began). */
  G.overshoot = (pts, over, drift) => {
    const n = pts.length, extra = Math.round(n * over), nr = G.normals(pts, true), out = pts.map((p) => p.slice());
    for (let k = 0; k < extra; k++) {
      const i = k % n, f = (k + 1) / extra;
      out.push([pts[i][0] + nr[i][0] * drift * f * f, pts[i][1] + nr[i][1] * drift * f * f]);
    }
    return out;
  };

  // ---------- the picture ----------
  class Art {
    constructor(N, seed) {
      this.N = N; this.k = N / 1000; this.seed = seed;
      this.rgb = new Float32Array(N * N * 3);
      this.cv = document.createElement("canvas"); this.cv.width = this.cv.height = N;
      this.ctx = this.cv.getContext("2d", { willReadFrequently: true });
      this.noise = perlin(seed); this.n2 = perlin(seed + 77); this.r = rng(seed);
      this.tooth = { fine: this.makeTooth(seed + 1, 0.85), coarse: this.makeTooth(seed + 2, 2.1) };
    }
    /** Paper height map, equalised to a flat 0..1 distribution so coverage follows pressure. */
    makeTooth(seed, size) {
      const N = this.N, n = perlin(seed), m = perlin(seed + 101), T = new Float32Array(N * N), u = 1000 / N, r = rng(seed + 5);
      let lo = Infinity, hi = -Infinity;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const ux = x * u, uy = y * u;
          const v = 0.62 * n(ux / (size * 1.3), uy / size) + 0.3 * n(ux / (size * 0.48) + 40, uy / (size * 0.44)) +
            0.28 * m(ux / (size * 3.2), uy / (size * 2.6)) + 0.12 * (r() - 0.5);
          T[y * N + x] = v; if (v < lo) lo = v; if (v > hi) hi = v;
        }
      }
      const B = 4096, hist = new Uint32Array(B), sc = (B - 1) / (hi - lo);
      for (let i = 0; i < T.length; i++) hist[((T[i] - lo) * sc) | 0]++;
      const cdf = new Float32Array(B); let acc = 0;
      for (let i = 0; i < B; i++) { acc += hist[i]; cdf[i] = acc / T.length; }
      for (let i = 0; i < T.length; i++) T[i] = cdf[((T[i] - lo) * sc) | 0];
      return T;
    }
    /** A smooth low-frequency field f(ux, uy), sampled coarsely and interpolated. */
    field(f, step = 8) {
      const N = this.N, g = Math.ceil(N / step) + 2, grid = new Float32Array(g * g), u = 1000 / N, out = new Float32Array(N * N);
      for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) grid[j * g + i] = f(i * step * u, j * step * u);
      for (let y = 0; y < N; y++) {
        const gy = y / step, j = gy | 0, fy = gy - j;
        for (let x = 0; x < N; x++) {
          const gx = x / step, i = gx | 0, fx = gx - i, a = grid[j * g + i], b = grid[j * g + i + 1], c = grid[(j + 1) * g + i], d = grid[(j + 1) * g + i + 1];
          out[y * N + x] = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
        }
      }
      return out;
    }
    /** Lay down the paper: base colour, soft mottling, the tooth catching light, a faint vignette. */
    paper({ color, mottle = 0.03, grain = 0.05, warm = 0.0, vignette = 0.05, scale = 260 }) {
      const N = this.N, c = rgb(color), n = this.noise, T = this.tooth.fine, Tc = this.tooth.coarse, u = 1000 / N;
      const M = this.field((x, y) => n.fbm(x / scale, y / scale, 4));
      const W = this.field((x, y) => this.n2.fbm(x / (scale * 1.7) + 9, y / (scale * 1.7), 3));
      for (let y = 0, i = 0; y < N; y++) {
        for (let x = 0; x < N; x++, i++) {
          const dx = x * u - 500, dy = y * u - 500, vg = 1 - vignette * Math.pow((dx * dx + dy * dy) / 500000, 1.6);
          const v = (1 + M[i] * mottle + (T[i] - 0.5) * grain + (Tc[i] - 0.5) * grain * 0.6) * vg, w = W[i] * warm;
          this.rgb[i * 3] = c[0] * v * (1 + w); this.rgb[i * 3 + 1] = c[1] * v; this.rgb[i * 3 + 2] = c[2] * v * (1 - w);
        }
      }
    }
    /**
     * Draw pressure with `draw(ctx, art)` (white, alpha = pressure; coordinates in the 1000 space), then
     * deposit `color` through the tooth. Options: tooth (0 = plain alpha, 1 = all grain), soft (threshold
     * softness), gain (pressure multiplier), opacity, blend (normal | multiply | screen), paper (fine | coarse).
     * `color` may be a function (ux, uy) -> [r, g, b] for gradients.
     */
    mark(color, o, draw) {
      const N = this.N, c = this.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "source-over"; c.globalAlpha = 1; c.clearRect(0, 0, N, N);
      c.setTransform(this.k, 0, 0, this.k, 0, 0);
      c.fillStyle = "#fff"; c.strokeStyle = "#fff"; c.lineCap = "round"; c.lineJoin = "round"; c.filter = "none";
      c.save(); draw(c, this); c.restore();
      c.setTransform(1, 0, 0, 1, 0, 0);
      const d = c.getImageData(0, 0, N, N).data;
      const T = this.tooth[o.paper || "fine"], g = o.tooth ?? 0.4, soft = o.soft ?? 0.18, gain = o.gain ?? 1, op = o.opacity ?? 1;
      const blend = o.blend || "normal", fn = typeof color === "function" ? color : null, col = fn ? null : rgb(color), u = 1000 / N;
      const dens = o.density ?? 0, P = this.rgb;
      for (let i = 0, y = 0, x = 0; i < N * N; i++, x++) {
        if (x === N) { x = 0; y++; }
        const p0 = d[i * 4 + 3]; if (p0 === 0) continue;
        const p = Math.min(1, (p0 / 255) * gain), t = T[i];
        const th = smooth(-soft, soft, p - (1 - t));
        let a = ((1 - g) * p + g * th) * op;
        if (dens) a *= 1 - dens * (1 - t);
        if (a <= 0) continue;
        const k = fn ? fn(x * u, y * u) : col, j = i * 3;
        if (blend === "multiply") { P[j] *= 1 - a * (1 - k[0]); P[j + 1] *= 1 - a * (1 - k[1]); P[j + 2] *= 1 - a * (1 - k[2]); }
        else if (blend === "screen") { P[j] = 1 - (1 - P[j]) * (1 - a * k[0]); P[j + 1] = 1 - (1 - P[j + 1]) * (1 - a * k[1]); P[j + 2] = 1 - (1 - P[j + 2]) * (1 - a * k[2]); }
        else { P[j] += (k[0] - P[j]) * a; P[j + 1] += (k[1] - P[j + 1]) * a; P[j + 2] += (k[2] - P[j + 2]) * a; }
      }
    }
    /** Average down by an integer factor and return 8-bit RGB. */
    rgb8(out) {
      const N = this.N, f = N / out, o = new Uint8Array(out * out * 3), P = this.rgb, w = 1 / (f * f);
      for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) {
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) { const q = ((y * f + j) * N + x * f + i) * 3; r += P[q]; g += P[q + 1]; b += P[q + 2]; }
        const q = (y * out + x) * 3;
        o[q] = Math.round(clamp(r * w) * 255); o[q + 1] = Math.round(clamp(g * w) * 255); o[q + 2] = Math.round(clamp(b * w) * 255);
      }
      return o;
    }
  }

  // ---------- marks drawn into the pressure canvas ----------
  const M = {};
  /**
   * An ink line: circles stamped along the path, width varying a little and tapering at the ends.
   * o: w, jit (width noise), taper [start, end] in units, noise, phase, p (pressure).
   */
  M.ink = (c, pts, o) => {
    const { s, total } = G.lengths(pts, false), n = o.noise, ph = o.phase || 0, ts = (o.taper && o.taper[0]) || 0, te = (o.taper && o.taper[1]) || 0;
    c.globalAlpha = o.p ?? 1; c.beginPath();
    for (let i = 0; i < pts.length; i++) {
      let w = o.w * (1 + (o.jit ?? 0.14) * n.fbm(s[i] / 55 + ph, ph * 2.1, 2)) * (o.wmul ? o.wmul[i] : 1) * (o.profile ? o.profile(s[i] / total) : 1);
      if (ts) w *= 0.25 + 0.75 * smooth(0, ts, s[i]);
      if (te) w *= 0.15 + 0.85 * smooth(0, te, total - s[i]);
      if (w <= 0.1) continue;
      c.moveTo(pts[i][0] + w / 2, pts[i][1]); c.arc(pts[i][0], pts[i][1], w / 2, 0, TAU);
    }
    c.fill(); c.globalAlpha = 1;
  };
  /** A closed shape outlined in one go: wobbled, opened at a start point, overshooting a little. */
  M.outline = (c, pts, o) => {
    const w = G.wobble(pts, true, o.amp ?? 3.2, o.wl ?? 70, o.noise, o.phase || 0);
    const k = Math.round(((o.start ?? 0) % 1) * w.length), rot = w.slice(k).concat(w.slice(0, k));
    const path = G.overshoot(rot, o.over ?? 0.05, o.drift ?? 6);
    let wmul = null;
    if (o.weight) { // brush weight: heavier where the outline faces away from the light (down and right)
      const nr = G.normals(rot, true), lx = 0.42, ly = 0.91;
      wmul = path.map((_, i) => { const q = nr[i % rot.length]; return 1 + o.weight * (q[0] * lx + q[1] * ly); });
    }
    M.ink(c, path, { ...o, wmul, taper: o.taper || [22, 60] });
  };
  /** Crayon strokes filling a shape: parallel, slightly wavy strokes at `angle`, with pressure varying. */
  M.hatch = (c, clipPts, o) => {
    const r = o.r, n = o.noise, ang = o.angle ?? -0.6, gap = o.gap ?? 9, bb = clipPts ? G.bbox(clipPts) : { x0: -50, y0: -50, x1: 1050, y1: 1050 };
    c.save();
    if (clipPts) { G.path(c, clipPts); c.clip(); }
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, R = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2 + 20;
    const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
    for (let d = -R; d <= R; d += gap * (0.75 + 0.5 * r())) {
      const ext = R + r.pm(o.ragged ?? 0);
      const pts = [];
      for (let t = -ext; t <= ext; t += 6) {
        const wv = n((d + t * 0.01) / 37, t / 90 + d * 0.013) * (o.wave ?? 2.5);
        pts.push([cx + ux * t + vx * (d + wv), cy + uy * t + vy * (d + wv)]);
      }
      c.globalAlpha = clamp((o.p ?? 0.7) * (1 + r.pm(o.pjit ?? 0.25)));
      c.lineWidth = (o.w ?? gap * 1.3) * (0.8 + 0.4 * r());
      G.path(c, pts, false); c.stroke();
    }
    c.restore(); c.globalAlpha = 1;
  };
  /** A loosely scribbled disc (strokes run past the edge a little, unevenly). */
  M.scribbleDisc = (c, cx, cy, rad, o) => {
    const r = o.r, ang = o.angle ?? -0.5, gap = o.gap ?? 10, ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
    for (let d = -rad; d <= rad; d += gap * (0.7 + 0.6 * r())) {
      const half = Math.sqrt(Math.max(0, rad * rad - d * d)), a = -half + r.pm(o.ragged ?? 10), b = half + r.pm(o.ragged ?? 10);
      if (b - a < 6) continue;
      const pts = G.line([cx + ux * a + vx * d, cy + uy * a + vy * d], [cx + ux * b + vx * d, cy + uy * b + vy * d]);
      c.globalAlpha = clamp((o.p ?? 0.6) * (1 + r.pm(0.3))); c.lineWidth = (o.w ?? gap * 1.4) * (0.8 + 0.4 * r());
      G.path(c, pts, false); c.stroke();
    }
    c.globalAlpha = 1;
  };
  /** A four-point sparkle as a filled shape. */
  M.sparkle = (cx, cy, R, rot = 0, pinch = 0.26) => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4 - Math.PI / 2, rr = i % 2 ? R * pinch : R;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    // soften: quadratic through the pinch points
    const out = [];
    for (let i = 0; i < 8; i += 2) {
      const tip = pts[i], mid = pts[(i + 1) % 8], next = pts[(i + 2) % 8];
      const ctrl = [cx + (mid[0] - cx) * 0.5, cy + (mid[1] - cy) * 0.5];
      out.push(...G.quad(tip, ctrl, next, 30).slice(0, -1));
    }
    return out;
  };

  window.HD = { rng, perlin, rgb, mix, clamp, smooth, G, M, Art, TAU };
})();
