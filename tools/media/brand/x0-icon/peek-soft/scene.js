// X0 Bot icon, soft-matte Peek-a-bot (three.js, runs in the browser; render.mjs drives it).
//
// One big head peeking up into the tile from the bottom edge, cropped by the tile.
//   head    = a superquadric (soft rounded box) in a matte, slightly velvety material
//   visor   = a satin dark-glass pillow on the face; the eyes are its emissive map
//   antenna = a short rounded rod; its tip is a small warm glowing cap (no ball)
// Light = a hand-built studio environment (big soft boxes) + a soft key whose position is jittered
// every frame (soft shadows) + a rim that separates the silhouette from the ground. Per-vertex
// ambient occlusion from the same analytic shapes. Frames are sub-pixel jittered and averaged,
// composited over a flat 2D ground and box-downsampled. Units: head half-width ~0.56, y up.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const lin = (hex) => new THREE.Color(hex); // sRGB hex -> linear working colour

// ---------------------------------------------------------------- superquadric
// (|x/a|^p + |y/b|^p)^(q/p) + |z/c|^q = 1. p squares the front outline, q the depth profile.
function sqF(x, y, z, s) {
  const S = Math.pow(Math.abs(x / s.a), s.p) + Math.pow(Math.abs(y / s.b), s.p);
  return Math.pow(S, s.q / s.p) + Math.pow(Math.abs(z / s.c), s.q);
}
function sqGrad(x, y, z, s) {
  const ax = Math.abs(x / s.a), ay = Math.abs(y / s.b), az = Math.abs(z / s.c);
  const S = Math.max(Math.pow(ax, s.p) + Math.pow(ay, s.p), 1e-14);
  const k = Math.pow(S, s.q / s.p - 1);
  return [(s.q * k * Math.pow(ax, s.p - 1) * Math.sign(x)) / s.a, (s.q * k * Math.pow(ay, s.p - 1) * Math.sign(y)) / s.b, (s.q * Math.pow(az, s.q - 1) * Math.sign(z)) / s.c];
}
function sqDist(x, y, z, s) {
  const F = Math.max(sqF(x, y, z, s), 1e-12), g = Math.pow(F, 1 / s.q) - 1;
  const G = sqGrad(x, y, z, s), dg = Math.pow(F, 1 / s.q - 1) / s.q;
  return g / Math.max(Math.hypot(G[0], G[1], G[2]) * dg, 1e-6);
}
function sqGeometry(s, seg = 96) {
  const g = new THREE.BoxGeometry(2, 2, 2, seg, seg, seg);
  const P = g.attributes.position, N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const L = Math.hypot(x, y, z); x /= L; y /= L; z /= L;
    const r = Math.pow(sqF(x, y, z, s), -1 / s.q); x *= r; y *= r; z *= r;
    P.setXYZ(i, x, y, z);
    const G = sqGrad(x, y, z, s), gl = Math.hypot(G[0], G[1], G[2]) || 1;
    N.setXYZ(i, G[0] / gl, G[1] / gl, G[2] / gl);
  }
  return g;
}

// ---------------------------------------------------------------- the bot's geometry, from a spec
function makeShapes(o) {
  const HEAD = { a: 0.56, b: 0.47, c: 0.44, p: 3.0, q: 2.4, ...(o.head || {}) };
  const VIS = { A: 0.405, B: 0.2, R: 0.19, cy: -0.02, h: 0.028, E: 0.05, sink: 0.004, bulge: 0.008, ...(o.visor || {}) };
  const ANT = { x: 0.0, len: 0.17, r: 0.034, tilt: 0.0, tipLen: 0.06, ...(o.antenna || {}) };
  const headZ = (x, y) => {
    const S = Math.pow(Math.abs(x / HEAD.a), HEAD.p) + Math.pow(Math.abs(y / HEAD.b), HEAD.p);
    const t = 1 - Math.pow(S, HEAD.q / HEAD.p);
    return t <= 0 ? 0 : HEAD.c * Math.pow(t, 1 / HEAD.q);
  };
  const sdRR = (x, y) => {
    const qx = Math.abs(x) - (VIS.A - VIS.R), qy = Math.abs(y - VIS.cy) - (VIS.B - VIS.R);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - VIS.R;
  };
  const lift = (d) => { const pr = d >= VIS.E ? 1 : Math.sin(Math.acos(1 - d / VIS.E)); return VIS.h * pr - VIS.sink * (1 - pr); };
  const bulge = (x, y) => { const u = x / VIS.A, v = (y - VIS.cy) / VIS.B; return VIS.bulge * Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v); };
  const visorZ = (x, y) => { const d = Math.max(0, -sdRR(x, y)); return headZ(x, y) + lift(d) + bulge(x, y) * Math.min(1, d / VIS.E); };
  // antenna: a rod from inside the head's top, tilted in the x-y plane
  const t = ANT.tilt, base = [ANT.x, HEAD.b - 0.05, 0], dir = [Math.sin(t), Math.cos(t), 0];
  const top = [base[0] + dir[0] * (ANT.len + 0.05), base[1] + dir[1] * (ANT.len + 0.05), 0];
  // a bent antenna: a quadratic curve that leaves the head along dir and turns by ANT.bend (radians, + = to the right)
  let curve = null;
  if (ANT.bend) {
    const L = ANT.len + 0.05, b = t + ANT.bend, d2 = [Math.sin(b), Math.cos(b), 0];
    const p1 = [base[0] + dir[0] * L * 0.6, base[1] + dir[1] * L * 0.6, 0];
    const p2 = [p1[0] + d2[0] * L * 0.55, p1[1] + d2[1] * L * 0.55, 0];
    curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...base), new THREE.Vector3(...p1), new THREE.Vector3(...p2));
  }
  return { HEAD, VIS, ANT, headZ, sdRR, visorZ, lift, bulge, base, dir, top, curve };
}

function visorGeometry(S) {
  const { VIS, sdRR, visorZ, headZ, bulge } = S;
  const NT = 360, band = 30, inner = 28;
  const rayR = (cx, cy, d) => { let lo = 0, hi = VIS.A + 0.2; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; sdRR(m * cx, VIS.cy + m * cy) < -d ? (lo = m) : (hi = m); } return lo; };
  const pos = [], uv = [], idx = [], nrm = [];
  const put = (x, y, d) => {
    pos.push(x, y, visorZ(x, y)); uv.push((x + VIS.A) / (2 * VIS.A), (y - VIS.cy + VIS.B) / (2 * VIS.B));
    const e = 1e-4, base = (X, Y) => headZ(X, Y) + bulge(X, Y) * Math.min(1, d / VIS.E);
    const zx = (base(x + e, y) - base(x - e, y)) / (2 * e), zy = (base(x, y + e) - base(x, y - e)) / (2 * e);
    let nb = [-zx, -zy, 1]; const lb = Math.hypot(...nb); nb = nb.map((v) => v / lb);
    let ox = (sdRR(x + e, y) - sdRR(x - e, y)) / (2 * e), oy = (sdRR(x, y + e) - sdRR(x, y - e)) / (2 * e);
    const lo = Math.hypot(ox, oy) || 1; ox /= lo; oy /= lo;
    const phi = Math.acos(1 - Math.min(d, VIS.E) / VIS.E), co = VIS.h * Math.cos(phi), si = VIS.E * Math.sin(phi);
    const n = [ox * co + nb[0] * si, oy * co + nb[1] * si, nb[2] * si], ln = Math.hypot(...n);
    nrm.push(n[0] / ln, n[1] / ln, n[2] / ln);
  };
  const dirs = []; for (let j = 0; j < NT; j++) { const th = (j / NT) * Math.PI * 2; dirs.push([Math.cos(th), Math.sin(th)]); }
  let rows = 0;
  for (let k = 0; k <= band; k++, rows++) { const d = VIS.E * (1 - Math.cos((Math.PI / 2) * (k / band))); for (const [cx, cy] of dirs) { const r = rayR(cx, cy, d); put(r * cx, VIS.cy + r * cy, d); } }
  const rE = dirs.map(([cx, cy]) => rayR(cx, cy, VIS.E));
  for (let k = 1; k < inner; k++, rows++) { const f = 1 - k / inner; dirs.forEach(([cx, cy], j) => put(rE[j] * f * cx, VIS.cy + rE[j] * f * cy, VIS.E)); }
  const centre = pos.length / 3; put(0, VIS.cy, VIS.E);
  for (let k = 0; k < rows - 1; k++) for (let j = 0; j < NT; j++) {
    const a = k * NT + j, b = k * NT + ((j + 1) % NT), c = (k + 1) * NT + j, d = (k + 1) * NT + ((j + 1) % NT);
    idx.push(a, b, c, b, d, c);
  }
  const last = (rows - 1) * NT;
  for (let j = 0; j < NT; j++) idx.push(last + j, last + ((j + 1) % NT), centre);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- ambient occlusion (per vertex)
function makeSDF(S, withVisor) {
  const { HEAD, ANT, sdRR, visorZ, base, top, curve } = S;
  const pts = curve ? curve.getPoints(32).map((p) => [p.x, p.y]) : [base, top];
  const seg = (x, y, z) => {
    let best = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], bx = b[0] - a[0], by = b[1] - a[1], px = x - a[0], py = y - a[1];
      const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by)));
      best = Math.min(best, Math.hypot(px - bx * t, py - by * t, z));
    }
    return best - ANT.r;
  };
  return (x, y, z) => {
    let d = sqDist(x, y, z, HEAD);
    if (withVisor) { const rr = sdRR(x, y); if (rr < 0.2 && z > 0) d = Math.min(d, Math.max(z - visorZ(x, y), rr)); }
    if (y > HEAD.b - 0.2) d = Math.min(d, seg(x, y, z));
    return d;
  };
}
function bakeAO(geom, sdf, toLocal, strength) {
  const P = geom.attributes.position, N = geom.attributes.normal, ao = new Float32Array(P.count);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(toLocal);
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i).applyMatrix4(toLocal);
    n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
    let occ = 0, sca = 1;
    for (let k = 1; k <= 6; k++) {
      const h = 0.012 + 0.2 * Math.pow(k / 6, 1.6);
      occ += Math.max(0, h - sdf(p.x + n.x * h, p.y + n.y * h, p.z + n.z * h)) * sca; sca *= 0.8;
    }
    ao[i] = Math.max(0, Math.min(1, 1 - strength * occ));
  }
  geom.setAttribute("aoV", new THREE.BufferAttribute(ao, 1));
}
// Per-vertex AO into three's AO slot; a "wrap" term softens the terminator (light seems to soak into
// the material a little, like a soft rubber or clay), which is most of what reads as subsurface.
function matte(mat, { directToo = 0.4, wrap = 0.35 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aoV;\nvarying float vAoV;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAoV = aoV;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vAoV;")
      .replace("#include <lights_physical_pars_fragment>", THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        "vec3 irradiance = dotNL * directLight.color;",
        `vec3 irradiance = saturate( ( dot( geometryNormal, directLight.direction ) + ${wrap.toFixed(3)} ) / ${(1 + wrap).toFixed(3)} ) * directLight.color;`))
      .replace("#include <aomap_fragment>", `
        float ambientOcclusion = vAoV;
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, ${directToo.toFixed(2)});
        #if defined( USE_ENVMAP ) && defined( STANDARD )
          float dotNVao = saturate( dot( geometryNormal, geometryViewDir ) );
          reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNVao, ambientOcclusion, material.roughness );
        #endif
      `);
  };
  mat.customProgramCacheKey = () => "matte" + directToo + "/" + wrap;
  return mat;
}

// ---------------------------------------------------------------- the face (visor emissive map)
function faceTexture(S, sd, o = {}, dim = null) {
  const { VIS } = S;
  const W = 2048, H = Math.round((W * VIS.B) / VIS.A), px = (2 * VIS.A) / W;
  const core = lin(o.core ?? "#FFF1D6"), halo = lin(o.halo ?? "#ffb36e");
  const data = new Uint16Array(W * H * 4), toH = THREE.DataUtils.toHalfFloat;
  const near = o.near ?? 0.07, far = o.far ?? 0.008;
  for (let j = 0; j < H; j++) {
    const y = VIS.cy - VIS.B + (j + 0.5) * px;
    for (let i = 0; i < W; i++) {
      const x = -VIS.A + (i + 0.5) * px, d = sd(x, y);
      const c = Math.max(0, Math.min(1, 0.5 - d / px)), e = Math.max(0, d);
      const inner = Math.max(0, Math.min(1, -d / 0.03));      // a hotter middle
      let h = (near * Math.exp(-((e / 0.018) ** 2)) + far * Math.exp(-e / 0.05)) * (1 - c);
      const k = (j * W + i) * 4;
      let m = c * (0.8 + 0.35 * inner);
      if (dim) {
        const d2 = dim.sd(x, y), c2 = Math.max(0, Math.min(1, 0.5 - d2 / px)) * (1 - c);
        m += c2 * dim.k; h += near * 0.6 * dim.k * Math.exp(-((Math.max(0, d2) / 0.014) ** 2)) * (1 - c) * (1 - c2);
      }
      data[k] = toH(core.r * m + halo.r * h); data[k + 1] = toH(core.g * m + halo.g * h); data[k + 2] = toH(core.b * m + halo.b * h); data[k + 3] = toH(1);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.colorSpace = THREE.LinearSRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
const sdPill = (x, y, cx, cy, w, h, rot = 0) => {
  const c = Math.cos(rot), s = Math.sin(rot), X = (x - cx) * c + (y - cy) * s, Y = -(x - cx) * s + (y - cy) * c;
  const r = Math.min(w, h) / 2, qx = Math.abs(X) - (w / 2 - r), qy = Math.abs(Y) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdArc = (x, y, cx, cy, R, a0, a1) => { // arc from a0 to a1 (radians, counter-clockwise, y up)
  const a = Math.atan2(y - cy, x - cx); let t = a - a0; while (t < 0) t += Math.PI * 2;
  if (t <= a1 - a0) return Math.abs(Math.hypot(x - cx, y - cy) - R);
  return Math.min(Math.hypot(x - cx - R * Math.cos(a0), y - cy - R * Math.sin(a0)), Math.hypot(x - cx - R * Math.cos(a1), y - cy - R * Math.sin(a1)));
};
// small eye, bigger rounder eye, both glancing up and to the right (toward the antenna)
const curiousEyes = ({ gap = 0.165, look = 0.055, up = 0.02, small = [0.098, 0.15], big = [0.128, 0.182] } = {}) => (S) => (x, y) =>
  Math.min(sdPill(x, y, -gap + look, S.VIS.cy + up - 0.004, small[0], small[1]), sdPill(x, y, gap + look, S.VIS.cy + up + 0.006, big[0], big[1]));
export const FACES = {
  curious: curiousEyes,
  // two bright rounds of different sizes, glancing up and right
  rounds: ({ gap = 0.165, look = 0.06, up = 0.02, r1 = 0.058, r2 = 0.08 } = {}) => (S) => (x, y) =>
    Math.min(Math.hypot(x - (-gap + look), y - (S.VIS.cy + up)) - r1, Math.hypot(x - (gap + look), y - (S.VIS.cy + up + 0.012)) - r2),
  // a lid / brow line of light lifted above the bigger eye (drawn dimmer than the eyes)
  brow: ({ gap = 0.165, look = 0.055, up = 0.02, R = 0.118, t = 0.022, a0 = 0.32, a1 = 0.74, dx = 0.004, dy = 0.0, k = 0.55 } = {}) => (S) => ({
    k, sd: (x, y) => sdArc(x, y, gap + look + dx, S.VIS.cy + up + 0.006 + dy, R, Math.PI * a0, Math.PI * a1) - t / 2,
  }),
  // two open eyes (tall pills); dy lifts them, look shifts them sideways
  pills: ({ w = 0.105, h = 0.17, gap = 0.17, dy = 0, look = 0 } = {}) => (S) => (x, y) =>
    Math.min(sdPill(x, y, -gap + look, S.VIS.cy + dy, w, h), sdPill(x, y, gap + look, S.VIS.cy + dy, w, h)),
  // wink: left eye a closed smiling arc, right eye open
  wink: ({ w = 0.105, h = 0.17, gap = 0.17, R = 0.072, t = 0.034, dy = 0 } = {}) => (S) => (x, y) =>
    Math.min(sdArc(x, y, -gap, S.VIS.cy + dy - R * 0.55, R, Math.PI * 0.2, Math.PI * 0.8) - t / 2, sdPill(x, y, gap, S.VIS.cy + dy, w, h)),
  // content: both eyes closed in smiling arcs
  happy: ({ gap = 0.17, R = 0.072, t = 0.034, dy = 0 } = {}) => (S) => (x, y) =>
    Math.min(sdArc(x, y, -gap, S.VIS.cy + dy - R * 0.55, R, Math.PI * 0.2, Math.PI * 0.8), sdArc(x, y, gap, S.VIS.cy + dy - R * 0.55, R, Math.PI * 0.2, Math.PI * 0.8)) - t / 2,
};

// ---------------------------------------------------------------- studio environment (for soft reflections and fill)
function studioEnv(renderer, e = {}) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(e.room ?? 0x0b0b0b), side: THREE.BackSide })));
  const box = (w, h, pos, intensity, tint = [1, 0.97, 0.93]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint[0] * intensity, tint[1] * intensity, tint[2] * intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  box(12, 8, [0, 10, 3], e.top ?? 1.6);              // huge overhead softbox
  box(9, 9, [-8, 5, 7], e.key ?? 1.6);               // key, upper left front
  box(9, 6, [7, 1, 8], e.fill ?? 0.55, [0.96, 0.97, 1.0]); // fill, right front
  box(2.5, 10, [9, 3, -5], e.rimR ?? 1.4);           // rim strips behind
  box(2.5, 10, [-9, 3, -5], e.rimL ?? 0.9);
  box(14, 14, [0, -10, 2], e.floor ?? 0.25, e.floorTint ?? [1.0, 0.85, 0.7]);
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(env, 0.02); pm.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------- the bot
function buildBot(o) {
  const S = makeShapes(o);
  const group = new THREE.Group();
  const shellMat = matte(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: o.rough ?? 0.62, metalness: 0,
    sheen: o.sheen ?? 0.6, sheenRoughness: 0.55, sheenColor: lin(o.sheenColor ?? "#ffe2c4"),
    envMapIntensity: o.env ?? 0.9, specularIntensity: o.spec ?? 0.45,
    emissive: lin(o.sss ?? "#d07a45"), emissiveIntensity: o.sssI ?? 0.035,
  }), { wrap: o.wrap ?? 0.35 });
  const sdf = makeSDF(S, o.visor !== false);
  const add = (geom, mat, setup) => {
    const m = new THREE.Mesh(geom, mat); setup?.(m); m.updateMatrix();
    bakeAO(geom, sdf, m.matrix, o.ao ?? 2.4); m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
  };
  const vcol = (geom, f) => { const c = []; const P = geom.attributes.position; for (let i = 0; i < P.count; i++) { const k = f(P.getX(i), P.getY(i), P.getZ(i)); c.push(k.r, k.g, k.b); } geom.setAttribute("color", new THREE.Float32BufferAttribute(c, 3)); };
  // head: a gentle top-to-bottom gradient in the vertex colours
  const top = lin(o.colorTop ?? "#FBF0DE"), bot = lin(o.colorBottom ?? "#EAD6B6");
  const hg = sqGeometry(S.HEAD, 144);
  vcol(hg, (x, y) => bot.clone().lerp(top, THREE.MathUtils.smoothstep(y, -S.HEAD.b * 0.9, S.HEAD.b * 0.9)));
  add(hg, shellMat);
  if (o.visor !== false) {
    const visorMat = matte(new THREE.MeshPhysicalMaterial({
      color: lin(o.visorColor ?? "#121110"), roughness: o.visorRough ?? 0.3, metalness: 0, clearcoat: o.visorCoat ?? 0.55, clearcoatRoughness: o.visorCoatRough ?? 0.16,
      specularIntensity: 0.8, envMapIntensity: o.visorEnv ?? 1.0,
      emissive: new THREE.Color(1, 1, 1), emissiveMap: faceTexture(S, (o.face ?? FACES.pills())(S), o.faceOpt, o.faceDim ? o.faceDim(S) : null), emissiveIntensity: o.eyeGlow ?? 4.5,
    }), { wrap: 0.0, directToo: 0.2 });
    add(visorGeometry(S), visorMat);
  }
  if (o.antenna !== false && S.curve) {
    const tube = new THREE.TubeGeometry(S.curve, 96, S.ANT.r, 40, false);
    vcol(tube, () => bot.clone().lerp(top, 0.55));
    add(tube, shellMat);
    const tipMat = matte(new THREE.MeshPhysicalMaterial({
      color: lin(o.tipColor ?? "#C9683F"), roughness: 0.5, sheen: 0.4, sheenColor: lin("#ffc79a"),
      emissive: lin(o.tipGlowColor ?? "#ff7a3d"), emissiveIntensity: o.tipGlow ?? 0.6,
    }), { wrap: 0.3 });
    const tipLen = S.ANT.tipLen, tr = S.ANT.r * 1.08, end = S.curve.getPoint(1), tan = S.curve.getTangent(1).normalize();
    add(new THREE.CapsuleGeometry(tr, tipLen, 16, 48), tipMat, (m) => {
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
      m.position.copy(end).addScaledVector(tan, tipLen / 2 + tr - S.ANT.r * 0.9);
    });
  } else if (o.antenna !== false) {
    const len = Math.hypot(S.top[0] - S.base[0], S.top[1] - S.base[1]);
    const rod = new THREE.CapsuleGeometry(S.ANT.r, len, 16, 48);
    vcol(rod, () => bot.clone().lerp(top, 0.55));
    add(rod, shellMat, (m) => { m.position.set((S.base[0] + S.top[0]) / 2, (S.base[1] + S.top[1]) / 2, 0); m.rotation.z = -S.ANT.tilt; });
    // the tip: a short warm cap that glows a little, same radius as the rod (no ball)
    const tipMat = matte(new THREE.MeshPhysicalMaterial({
      color: lin(o.tipColor ?? "#C9683F"), roughness: 0.5, sheen: 0.4, sheenColor: lin("#ffc79a"),
      emissive: lin(o.tipGlowColor ?? "#ff7a3d"), emissiveIntensity: o.tipGlow ?? 0.6,
    }), { wrap: 0.3 });
    const tipLen = S.ANT.tipLen, tr = S.ANT.r * 1.08;
    const tip = new THREE.CapsuleGeometry(tr, tipLen, 16, 48);
    add(tip, tipMat, (m) => {
      const k = len / 2 + S.ANT.r - tr - tipLen / 2 + 0.002; // flush with the rod's end
      m.position.set((S.base[0] + S.top[0]) / 2 + S.dir[0] * (k - 0.0), (S.base[1] + S.top[1]) / 2 + S.dir[1] * k, 0); m.rotation.z = -S.ANT.tilt;
    });
  }
  // ear pods: a soft clay disc on each side of the head, level with the visor
  if (o.ears) {
    const earMat = matte(new THREE.MeshPhysicalMaterial({ color: lin(o.earColor ?? "#D9774A"), roughness: 0.6, sheen: 0.35, sheenColor: lin("#ffc9a3"), envMapIntensity: 0.8 }), { wrap: 0.3 });
    for (const side of [-1, 1]) {
      const g = new THREE.SphereGeometry(1, 64, 32);
      add(g, earMat, (m) => { m.scale.set(0.05, 0.12, 0.1); m.position.set(side * (S.HEAD.a - 0.004), S.VIS.cy, 0); });
    }
  }
  // eyes as objects on the head: a satin white disc that sits on the curved surface and a glossy
  // black pupil (its catchlight is what makes the eyes look alive); an optional brow tick
  if (o.eyes) {
    const whiteMat = new THREE.MeshPhysicalMaterial({ color: lin(o.eyeWhite ?? "#FFFFFF"), roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.25, envMapIntensity: 0.9 });
    const pupilMat = new THREE.MeshPhysicalMaterial({ color: lin(o.pupil ?? "#0B0B0B"), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 });
    const onSurface = (x, y) => {
      const z = S.headZ(x, y), G = sqGrad(x, y, z, S.HEAD), n = new THREE.Vector3(...G).normalize();
      return { p: new THREE.Vector3(x, y, z), n, q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n) };
    };
    for (const e of o.eyes) {
      const { p, n, q } = onSurface(e.x, e.y);
      const rx = e.r, ry = e.r * (e.tall ?? 1.06), rz = e.r * (e.depth ?? 0.34);
      const g = new THREE.Group(); g.position.copy(p).addScaledVector(n, -rz * 0.42); g.quaternion.copy(q);
      const w = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), whiteMat); w.scale.set(rx, ry, rz); g.add(w);
      const pr = e.pr ?? e.r * 0.5, reach = e.reach ?? 0.62, lx = (e.look?.[0] ?? 0) * (rx - pr) * reach, ly = (e.look?.[1] ?? -1) * (ry - pr) * reach;
      const pz = rz * Math.sqrt(Math.max(0, 1 - (lx / rx) ** 2 - (ly / ry) ** 2));
      const pm = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), pupilMat); pm.scale.set(pr, pr, pr * 0.32); pm.position.set(lx, ly, pz - pr * 0.12); g.add(pm);
      for (const m of [w, pm]) { m.castShadow = true; m.receiveShadow = true; }
      group.add(g);
    }
    for (const b of [].concat(o.brow ?? [])) {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const a = b.a0 + (b.a1 - b.a0) * (i / 24), x = b.x + b.R * Math.cos(a), y = b.y + b.R * Math.sin(a);
        const { p, n } = onSurface(x, y); pts.push(p.addScaledVector(n, 0.004));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, b.t ?? 0.013, 16, false), whiteMat);
      group.add(tube);
      for (const end of [pts[0], pts[pts.length - 1]]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(b.t ?? 0.013, 24, 12), whiteMat); cap.position.copy(end); group.add(cap); }
    }
  }
  return group;
}

// ---------------------------------------------------------------- render
function sampleDisc(i, n) { const r = Math.sqrt((i + 0.5) / n), a = i * 2.399963; return [r * Math.cos(a), r * Math.sin(a)]; }
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

export async function renderIcon(V, { size = 2048, samples = 40 } = {}) {
  const t0 = performance.now();
  const W = size, H = size;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = V.exposure ?? 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  scene.environment = studioEnv(renderer, V.env ?? {});
  scene.environmentIntensity = V.envIntensity ?? 1.0;
  const bot = buildBot(V.bot ?? {});
  bot.rotation.set(V.pitch ?? 0, V.yaw ?? 0, V.roll ?? 0, "YXZ");
  bot.position.set(...(V.botPos ?? [0, 0, 0]));
  scene.add(bot);

  const cam = new THREE.PerspectiveCamera(V.fov ?? 22, 1, 0.1, 50);
  cam.position.set(...V.cam); cam.lookAt(...V.target); cam.updateMatrixWorld();

  const key = new THREE.DirectionalLight(lin(V.keyColor ?? "#fff4e8"), V.keyI ?? 1.9);
  const keyPos = new THREE.Vector3(...(V.keyPos ?? [-1.6, 3.2, 2.4]));
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.4, right: 1.4, top: 1.4, bottom: -1.4, near: 0.5, far: 12 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 2;
  scene.add(key, key.target);
  for (const [p, i, c] of V.rims ?? [[[2.4, 1.6, -2.4], 1.6, "#ffffff"], [[-2.6, 1.0, -2.2], 0.9, "#ffe6cc"]]) {
    const l = new THREE.DirectionalLight(lin(c), i); l.position.set(...p); scene.add(l);
  }
  const fill = new THREE.DirectionalLight(lin(V.fillColor ?? "#ffe9d6"), V.fillI ?? 0.35); fill.position.set(1.4, -0.4, 2.6); scene.add(fill);

  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1); composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), V.bloom ?? 0.0, V.bloomRadius ?? 0.1, V.bloomThreshold ?? 2.5);
  if (V.bloom) composer.addPass(bloom); // off by default: it spills haze off bright edges; the face map has its own glow
  composer.addPass(new OutputPass());
  const dither = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, seed: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform sampler2D tDiffuse; uniform float seed; varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
      void main() { vec4 c = texture2D(tDiffuse, vUv); float n = h(gl_FragCoord.xy) + h(gl_FragCoord.yx + 17.0) - 1.0; gl_FragColor = vec4(c.rgb + n / 255.0, 1.0); }`,
  });
  composer.addPass(dither);

  const gl = renderer.getContext();
  const px = new Uint8Array(W * H * 4), acc = new Float32Array(W * H * 3), mAcc = new Float32Array(W * H);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const lightR = V.keySoft ?? 0.7, kDir = keyPos.clone().normalize();
  const kU = new THREE.Vector3(0, 1, 0).cross(kDir).normalize(), kV = kDir.clone().cross(kU).normalize();
  for (let s = 0; s < samples; s++) {
    const jx = (halton(s + 1, 2) - 0.5) * 1.2, jy = (halton(s + 1, 3) - 0.5) * 1.2;
    cam.setViewOffset(W, H, jx, jy, W, H);
    const [dx, dy] = sampleDisc(s, samples);
    key.position.copy(keyPos).addScaledVector(kU, dx * lightR * keyPos.length() * 0.25).addScaledVector(kV, dy * lightR * keyPos.length() * 0.25);
    scene.overrideMaterial = null; dither.uniforms.seed.value = (s * 7.31) % 97;
    renderer.shadowMap.needsUpdate = true;
    composer.render();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) { acc[i * 3] += px[j]; acc[i * 3 + 1] += px[j + 1]; acc[i * 3 + 2] += px[j + 2]; }
    scene.overrideMaterial = white;
    const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(null); renderer.render(scene, cam); renderer.toneMapping = tm;
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) mAcc[i] += px[j];
    await new Promise((r) => setTimeout(r, 0));
  }
  scene.overrideMaterial = null;

  // composite over the ground (display space); the head can cast a soft shadow onto it
  const inv = 1 / (samples * 255), bg = V.background, shade = V.groundShade;
  const out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const srcRow = H - 1 - y, v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const i = srcRow * W + x, o = (y * W + x) * 3, u = (x + 0.5) / W, m = mAcc[i] * inv;
      const b = bg(u, v);
      for (let k = 0; k < 3; k++) out[o + k] = b[k] * (1 - m) + acc[i * 3 + k] * inv;
    }
  }
  if (shade) { // a soft halo of shade around the silhouette (the head lifts off a light ground)
    const mask = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = mAcc[(H - 1 - y) * W + x] * inv;
    let src2 = mask;
    if (shade.dy) { const s = Math.round(shade.dy * H); src2 = new Float32Array(W * H); for (let y = s; y < H; y++) for (let x = 0; x < W; x++) src2[y * W + x] = mask[(y - s) * W + x]; }
    const blurred = boxBlur(src2, W, H, Math.round(W * shade.r));
    for (let i = 0; i < W * H; i++) { const s = 1 - shade.k * blurred[i] * (1 - mask[i]); for (let k = 0; k < 3; k++) out[i * 3 + k] *= s; }
  }
  const half = (src, w) => {
    const h2 = w / 2, dst = new Float32Array(h2 * h2 * 3);
    for (let y = 0; y < h2; y++) for (let x = 0; x < h2; x++) for (let k = 0; k < 3; k++) {
      const a = ((2 * y) * w + 2 * x) * 3 + k, b = a + w * 3; dst[(y * h2 + x) * 3 + k] = (src[a] + src[a + 3] + src[b] + src[b + 3]) / 4;
    }
    return dst;
  };
  const toB64 = (img, w) => {
    const bytes = new Uint8Array(w * w * 3); let seed = 12345;
    for (let i = 0; i < bytes.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; bytes[i] = Math.max(0, Math.min(255, Math.round((img[i] + (seed / 4294967296 - 0.5) / 255) * 255))); }
    let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const a = half(out, W), b = half(a, W / 2);
  renderer.dispose(); rt.dispose();
  return { w1: W / 2, img1: toB64(a, W / 2), w2: W / 4, img2: toB64(b, W / 4), ms: Math.round(performance.now() - t0) };
}
function boxBlur(src, W, H, r) { // three passes of a box blur ~ a Gaussian
  let a = Float32Array.from(src); const b = new Float32Array(W * H), n = 2 * r + 1;
  const cl = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) {
      let s = 0; for (let x = -r; x <= r; x++) s += a[y * W + cl(x, W - 1)];
      for (let x = 0; x < W; x++) { b[y * W + x] = s / n; s += a[y * W + cl(x + r + 1, W - 1)] - a[y * W + cl(x - r, W - 1)]; }
    }
    for (let x = 0; x < W; x++) {
      let s = 0; for (let y = -r; y <= r; y++) s += b[cl(y, H - 1) * W + x];
      for (let y = 0; y < H; y++) { a[y * W + x] = s / n; s += b[cl(y + r + 1, H - 1) * W + x] - b[cl(y - r, H - 1) * W + x]; }
    }
  }
  return a;
}

// ---------------------------------------------------------------- grounds
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const mixA = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
export function ground(top, bottom, { glow = null, at = [0.5, 0.3], r = 0.5, k = 0.0 } = {}) {
  const T = hexRGB(top), B = hexRGB(bottom), G = glow ? hexRGB(glow) : null;
  return (u, v) => {
    let c = mixA(T, B, Math.min(1, Math.max(0, v)));
    if (G) { const d = Math.hypot(u - at[0], v - at[1]) / r; c = mixA(c, G, k * Math.exp(-d * d)); }
    return c;
  };
}

// ---------------------------------------------------------------- variants
// Materials
const CREAM = { colorTop: "#FBF0DE", colorBottom: "#EED9B8", sheen: 0.22, rough: 0.64, spec: 0.38, sssI: 0.06 };
const CORAL = { colorTop: "#FF8A6B", colorBottom: "#E0573F", sheen: 0.3, sheenColor: "#ffd0c0", rough: 0.7, spec: 0.3, sss: "#ff4a3a", sssI: 0.05 };
const CLAY = { colorTop: "#E4804F", colorBottom: "#BF5631", sheen: 0.3, sheenColor: "#ffc9a3", rough: 0.7, spec: 0.3, sss: "#ff6a2a", sssI: 0.05 };
const INK = { colorTop: "#3A3633", colorBottom: "#232120", sheen: 0.25, sheenColor: "#d9cbbb", rough: 0.6, spec: 0.3, env: 0.5, sssI: 0.0, visorColor: "#050505", visorRough: 0.12, visorCoat: 1.0, visorCoatRough: 0.05 };
// Light: one big soft key from the top left, a dim studio around it, faint rims to keep the edge
const SOFT_RIMS = [[[2.4, 1.8, -2.6], 0.3, "#ffffff"], [[-2.6, 1.2, -2.4], 0.15, "#ffe6cc"]];
const LIGHT = { rims: SOFT_RIMS, keyPos: [-1.6, 2.6, 2.6], keyI: 3.0, keySoft: 1.4, fillI: 0.06, fillColor: "#ffd9b8", envIntensity: 0.32, exposure: 1.05,
  env: { fill: 0.25, key: 1.4, top: 1.4, rimR: 0.4, rimL: 0.3, floor: 0.45, floorTint: [1.0, 0.8, 0.6] } };
// Shape: our wide rounded head, the visor band low on the face, a short antenna with a warm tip
const HEAD = { a: 0.6, b: 0.62, c: 0.62, p: 3.2, q: 2.0 };   // tall enough that its chin is well below the tile
const VISOR = { A: 0.45, B: 0.2, R: 0.19, cy: 0.07 };
const ANT = { len: 0.12, r: 0.042, tipLen: 0.03 };
// Framing: the head fills ~90% of the width, its chin below the bottom edge
const PEEK = { ...LIGHT, yaw: -0.16, pitch: 0.06, cam: [0, -0.05, 3.43], target: [0, 0.0, 0], fov: 22, botPos: [0, -0.32, 0] };
const bot = (m, extra = {}) => ({ ...m, head: HEAD, visor: VISOR, antenna: ANT, face: FACES.pills(), ...extra });

// Black on coral, with a curious face
const BLACK = { colorTop: "#131313", colorBottom: "#0B0B0B", sheen: 0.3, sheenColor: "#e9e6e3", rough: 0.56, spec: 0.3, env: 0.5, sssI: 0.0,
  visorColor: "#040404", visorRough: 0.07, visorCoat: 1.0, visorCoatRough: 0.03, visorEnv: 1.25, eyeGlow: 5.2,
  tipColor: "#FFE6C4", tipGlowColor: "#FFBF85", tipGlow: 1.1 };
const CORAL_GROUND = ground("#FF8567", "#E1553B", { glow: "#FFA88C", at: [0.5, 0.16], r: 0.62, k: 0.45 });
const EDGE_RIMS = [[[2.4, 1.8, -2.6], 1.8, "#ffffff"], [[-2.6, 1.4, -2.4], 1.2, "#ffffff"]];
// neutral light on the black head (warm light turns a dark matte brown); the warmth lives in the eyes, the tip and the ground
const ON_CORAL = { background: CORAL_GROUND, groundShade: { r: 0.03, k: 0.18 }, rims: EDGE_RIMS, keyI: 3.0, keyColor: "#ffffff", fillColor: "#ffffff", fillI: 0.04,
  envIntensity: 0.5, env: { ...LIGHT.env, rimR: 1.5, rimL: 1.1, floor: 0.15, floorTint: [1, 1, 1] } };
const TILT = { yaw: -0.34, roll: 0.17, pitch: -0.02, cam: [0, -0.28, 3.4], target: [0, -0.02, 0], botPos: [0.05, -0.36, 0] };

// Half-peek, upside down: the black head hangs into a white tile from the top edge and looks down at you
const WHITE_GROUND = ground("#FFFFFF", "#ECEAE6");
const HANG = { ...PEEK, yaw: 0.0, pitch: 0.0, cam: [0, 0.0, 3.43], target: [0, 0.0, 0], botPos: [0, 0.66, 0], background: WHITE_GROUND,
  groundShade: { r: 0.03, k: 0.22, dy: 0.03 }, rims: [[[2.4, 1.0, -2.6], 0.9, "#ffffff"], [[-2.6, 0.8, -2.4], 0.7, "#ffffff"]],
  keyI: 3.0, keyColor: "#ffffff", keyPos: [-1.2, 1.6, 3.0], fillColor: "#ffffff", fillI: 0.12, envIntensity: 0.55,
  env: { ...LIGHT.env, floor: 0.35, floorTint: [1, 1, 1], rimR: 1.0, rimL: 0.8 } };
const HEAD_HANG = { a: 0.6, b: 0.62, c: 0.55, p: 3.2, q: 2.6 };
const hangBot = (eyes, extra = {}) => ({ ...BLACK, head: HEAD_HANG, visor: false, antenna: false, eyes, ...extra });
// the face tips down toward you (as anyone peeking over an edge does)
const TIP = { pitch: -0.17, botPos: [0, 0.74, -0.05] };
const EY = -0.5;
const EYES_DOWN = [{ x: -0.195, y: EY, r: 0.115, look: [0.18, -1] }, { x: 0.195, y: EY, r: 0.135, look: [-0.14, -1] }];
const EYES_SIDE = [{ x: -0.195, y: EY, r: 0.115, look: [-0.8, -0.6] }, { x: 0.195, y: EY, r: 0.135, look: [-0.8, -0.6] }];

// Hanging upside down and peeking at you: the same head swung in from the top edge, its pupils on you
const AT_YOU = [{ x: -0.195, y: EY, r: 0.115, look: [0.14, -0.32] }, { x: 0.195, y: EY, r: 0.135, look: [-0.14, -0.32] }];
const BROW_UP = { x: 0.2, y: EY - 0.01, R: 0.172, a0: Math.PI * 0.34, a1: Math.PI * 0.56, t: 0.015 };
const SWING = (roll, extra = {}) => ({ ...HANG, ...TIP, roll, ...extra });

// The Curious Peek-bot (cream head, dark visor, two warm eyes of different sizes, clay ear pods), hanging upside
// down from the top edge and peeking at you. No antenna, no brow (flipped, it reads as a smile under the eye).
const CURIOUS_FACE = { face: FACES.curious({ look: 0, up: 0 }) };
const curiousBot = (shell, extra = {}) => ({ ...shell, head: HEAD, visor: VISOR, antenna: false, ears: true, ...CURIOUS_FACE, ...extra });
const UPSIDE = (swing, extra = {}) => ({ ...HANG, roll: Math.PI + swing, pitch: -0.2, botPos: [0, 0.4, -0.75], ...extra });

export const VARIANTS = {
  "curious-hang-cream": () => ({ ...UPSIDE(-0.2), bot: curiousBot(CREAM) }),
  "curious-hang-black": () => ({ ...UPSIDE(-0.2), bot: curiousBot(BLACK) }),
  "curious-hang-cream-big": () => ({ ...UPSIDE(-0.16, { botPos: [0, 0.56, -0.1] }), bot: curiousBot(CREAM) }),
  "curious-hang-cream-other": () => ({ ...UPSIDE(0.2), bot: curiousBot(CREAM) }),
  "soft-swing": () => ({ ...SWING(-0.2), bot: hangBot(AT_YOU, { brow: BROW_UP }) }),
  "soft-swing-plain": () => ({ ...SWING(0.2), bot: hangBot(AT_YOU) }),
  "soft-swing-little": () => ({ ...SWING(-0.22, { botPos: [0, 0.5, -0.75], pitch: -0.26 }), bot: hangBot(AT_YOU, { brow: BROW_UP }) }),
  "soft-swing-little-plain": () => ({ ...SWING(0.22, { botPos: [0, 0.5, -0.75], pitch: -0.26 }), bot: hangBot(AT_YOU) }),
  "soft-swing-deep": () => ({ ...SWING(-0.14, { botPos: [0, 0.62, -0.05], pitch: -0.24 }), bot: hangBot(AT_YOU.map((e, i) => ({ ...e, r: e.r * 1.08 })), { brow: BROW_UP }) }),
  "soft-drop": () => ({ ...HANG, ...TIP, bot: hangBot(EYES_DOWN) }),
  "soft-sideways": () => ({ ...HANG, ...TIP, bot: hangBot(EYES_SIDE, { brow: { x: 0.2, y: EY - 0.01, R: 0.172, a0: Math.PI * 0.34, a1: Math.PI * 0.56, t: 0.015 } }) }),
  "black-coral-peek": () => ({ ...PEEK, ...ON_CORAL, bot: bot(BLACK, { face: FACES.curious(), faceDim: FACES.brow() }) }),
  "black-coral-tilt": () => ({ ...PEEK, ...ON_CORAL, ...TILT, bot: bot(BLACK, { face: FACES.curious(), faceDim: FACES.brow() }) }),
  "black-coral-bent": () => ({ ...PEEK, ...ON_CORAL, ...TILT,
    bot: bot(BLACK, { antenna: { ...ANT, len: 0.15, bend: 0.75 }, face: FACES.curious({ look: 0.075, up: 0.03 }), faceDim: FACES.brow({ look: 0.075, up: 0.03, a0: 0.3, a1: 0.72, dy: 0.008 }) }) }),
  "black-coral-rounds": () => ({ ...PEEK, ...ON_CORAL, ...TILT, bot: bot(BLACK, { face: FACES.rounds() }) }),
  "cream-black": () => ({ ...PEEK, background: ground("#161413", "#0B0A0A"), bot: bot(CREAM) }),
  "cream-clay": () => ({ ...PEEK, background: ground("#D0714A", "#B9532F"), groundShade: { r: 0.03, k: 0.35 }, envIntensity: 0.4,
    bot: bot(CREAM, { tipColor: "#211E1C", tipGlowColor: "#000000", tipGlow: 0.0 }) }),
  "ink-cream": () => ({ ...PEEK, background: ground("#F6EAD5", "#EAD7B8"), groundShade: { r: 0.035, k: 0.3 }, keyI: 3.4, envIntensity: 0.7,
    bot: bot(INK, { eyeGlow: 5.0, tipGlow: 0.5 }) }),
  "curious": () => ({ ...PEEK, yaw: -0.34, roll: 0.17, pitch: -0.02, cam: [0, -0.28, 3.4], target: [0, -0.02, 0], botPos: [0.05, -0.36, 0],
    background: ground("#161413", "#0B0A0A"), bot: bot(CREAM, { face: FACES.pills({ look: 0.035, dy: 0.012 }) }) }),
  "coral-black": () => ({ ...PEEK, background: ground("#161413", "#0B0A0A"), bot: bot(CORAL, { tipColor: "#FBF0DE", tipGlowColor: "#ffd9a8", tipGlow: 0.25 }) }),
  "wink": () => ({ ...PEEK, background: ground("#161413", "#0B0A0A"), bot: bot(CREAM, { face: FACES.wink({ R: 0.078, t: 0.05 }) }) }),
};
export { THREE };
