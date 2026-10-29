// Shared geometry for the X0 Bot icon concepts. Everything is drawn in a 1000 x 1000 square.
// Paths are plain `d` strings; numbers are rounded to 0.1 so the files stay small.

export const f = (n) => (Math.round(n * 10) / 10).toString();
export const P = (pts) => "M" + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join("L") + "Z";

/** A superellipse (|x/a|^n + |y/b|^n = 1) as a closed path; n = 2 is an ellipse, higher is squarer. */
export function superellipse(cx, cy, a, b, n = 2, steps = 160, reverse = false) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = ((reverse ? -i : i) / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([cx + a * Math.sign(c) * Math.abs(c) ** (2 / n), cy + b * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return P(pts);
}

/** A ring: an outer superellipse with an inner one cut out (use fill-rule="evenodd"). */
export function ring(cx, cy, a, b, t, n = 2, nIn = n) {
  return superellipse(cx, cy, a, b, n) + superellipse(cx, cy, a - t, b - t, nIn, 160, true);
}

/** A circle as a path. */
export function circle(cx, cy, r) {
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
}
export const circles = (list) => list.map(([x, y, r]) => circle(x, y, r)).join("");

/** A capsule (stadium) from p to q with radius r: a stroke with round caps, as a filled path. */
export function capsule([x1, y1], [x2, y2], r) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * r, ny = (dx / L) * r;
  return `M${f(x1 + nx)} ${f(y1 + ny)}L${f(x2 + nx)} ${f(y2 + ny)}A${f(r)} ${f(r)} 0 0 0 ${f(x2 - nx)} ${f(y2 - ny)}L${f(x1 - nx)} ${f(y1 - ny)}A${f(r)} ${f(r)} 0 0 0 ${f(x1 + nx)} ${f(y1 + ny)}Z`;
}

/**
 * A typographic stroke from (x1, top) to (x2, bottom) with horizontal cut ends, horizontal thickness w
 * (so a diagonal looks as heavy as a vertical of width ~w*sin).
 */
export function diag(x1, top, x2, bottom, w) {
  return P([[x1 - w / 2, top], [x1 + w / 2, top], [x2 + w / 2, bottom], [x2 - w / 2, bottom]]);
}

/** Rounded-rectangle path. */
export function rrect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

/** A continuous-corner (squircle-ish) rounded square, like the iOS mask, as a superellipse of n. */
export const squircle = (cx, cy, a, b, n = 5) => superellipse(cx, cy, a, b, n, 220);

/** Arc stroke (centre line) as a filled band with round caps: from angle a0 to a1 (radians), radius R, half-width r. */
export function arcBand(cx, cy, R, a0, a1, r, ry = R) {
  const steps = 64, out = [], inn = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps, c = Math.cos(t), s = Math.sin(t);
    // normal of an ellipse point (R c, ry s) is (ry c, R s)
    const nx = ry * c, ny = R * s, nl = Math.hypot(nx, ny);
    out.push([cx + R * c + (nx / nl) * r, cy + ry * s + (ny / nl) * r]);
    inn.push([cx + R * c - (nx / nl) * r, cy + ry * s - (ny / nl) * r]);
  }
  const e = (p) => `${f(p[0])} ${f(p[1])}`;
  const end = inn[inn.length - 1], start = out[0];
  return "M" + out.map(e).join("L") + `A${f(r)} ${f(r)} 0 0 1 ${e(end)}` + "L" + inn.reverse().map(e).join("L") + `A${f(r)} ${f(r)} 0 0 1 ${e(start)}Z`;
}

/** Quadratic-bezier band with round caps (for smiles): samples the curve and offsets it. */
export function curveBand(p0, c, p1, r, steps = 48) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
  }
  return polyBand(pts, r);
}

/** A thick polyline with round caps and joins approximated by offsetting sampled points (smooth input only). */
export function polyBand(pts, r) {
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    L.push([pts[i][0] + nx * r, pts[i][1] + ny * r]);
    R.push([pts[i][0] - nx * r, pts[i][1] - ny * r]);
  }
  const e = (p) => `${f(p[0])} ${f(p[1])}`;
  return "M" + L.map(e).join("L") + `A${f(r)} ${f(r)} 0 0 0 ${e(R[R.length - 1])}L` + R.reverse().map(e).join("L") + `A${f(r)} ${f(r)} 0 0 0 ${e(L[0])}Z`;
}

/** The SVG shell: a full-bleed 1000 square. */
export const svg = (body, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>\n`;
