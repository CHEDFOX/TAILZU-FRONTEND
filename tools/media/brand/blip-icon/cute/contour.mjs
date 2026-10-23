// Marching squares: iso-lines of a scalar field f(x,y) on a regular grid, chained into polylines.
// Returns [{pts:[[x,y]...], closed:bool}].
export function contours(f, x0, y0, x1, y1, step, level) {
  const nx = Math.ceil((x1 - x0) / step) + 1, ny = Math.ceil((y1 - y0) / step) + 1;
  const v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = f(x0 + i * step, y0 + j * step) - level;
  const V = (i, j) => v[j * nx + i];
  const P = (i, j) => [x0 + i * step, y0 + j * step];
  // edge ids: horizontal edge from (i,j) to (i+1,j) = 2*(j*nx+i); vertical (i,j)-(i,j+1) = 2*(j*nx+i)+1
  const pt = new Map();
  const edgePt = (id) => {
    if (pt.has(id)) return pt.get(id);
    const base = id >> 1, i = base % nx, j = (base - i) / nx, h = !(id & 1);
    const a = V(i, j), b = h ? V(i + 1, j) : V(i, j + 1), t = a / (a - b);
    const p = h ? [x0 + (i + t) * step, y0 + j * step] : [x0 + i * step, y0 + (j + t) * step];
    pt.set(id, p); return p;
  };
  const adj = new Map();
  const link = (a, b) => { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = V(i, j) > 0, b = V(i + 1, j) > 0, c = V(i + 1, j + 1) > 0, d = V(i, j + 1) > 0;
    const code = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
    if (code === 0 || code === 15) continue;
    const top = 2 * (j * nx + i), bottom = 2 * ((j + 1) * nx + i), left = 2 * (j * nx + i) + 1, right = 2 * (j * nx + i + 1) + 1;
    const segs = {
      1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]],
      6: [[top, bottom]], 7: [[left, top]], 8: [[left, top]], 9: [[top, bottom]], 11: [[top, right]],
      12: [[left, right]], 13: [[bottom, right]], 14: [[left, bottom]],
    }[code];
    if (segs) { for (const [p, q] of segs) link(p, q); continue; }
    const centre = (V(i, j) + V(i + 1, j) + V(i + 1, j + 1) + V(i, j + 1)) / 4 > 0;
    if (code === 5) { if (centre) { link(left, top); link(bottom, right); } else { link(left, bottom); link(top, right); } }
    if (code === 10) { if (centre) { link(left, bottom); link(top, right); } else { link(left, top); link(bottom, right); } }
  }
  const used = new Set(), out = [];
  const walk = (start) => {
    const chain = [start]; used.add(start);
    let cur = start;
    for (;;) {
      const nxt = (adj.get(cur) || []).find((e) => !used.has(e));
      if (nxt === undefined) break;
      used.add(nxt); chain.push(nxt); cur = nxt;
    }
    return chain;
  };
  // open chains first (endpoints have one neighbour), then loops
  for (const [e, n] of adj) if (n.length === 1 && !used.has(e)) out.push({ ids: walk(e), closed: false });
  for (const [e] of adj) if (!used.has(e)) { const ids = walk(e); out.push({ ids, closed: (adj.get(ids[ids.length - 1]) || []).includes(ids[0]) }); }
  return out.map((c) => ({ pts: c.ids.map(edgePt), closed: c.closed }));
}
