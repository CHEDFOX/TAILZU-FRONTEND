// X0 Bot icon: the Peek-a-bot head as a soft 3D render (three.js, runs in the browser; render.mjs drives it).
//
// Everything is built from analytic shapes so the surfaces are perfectly smooth:
//   head  = a superquadric (soft rounded box), cream, lighter on top
//   visor = a glossy black glass "pillow" laid on the head's front, the eyes are its emissive map
//   ears  = clay pucks, antenna = a short curved tube with a clay ball that glows a little
// Lighting = a hand-built studio environment (softboxes, for the reflections) + a key light whose
// position is jittered every frame (soft shadows) + rim lights; per-vertex ambient occlusion is
// computed from the same analytic shapes (signed-distance estimate) and fed into three's AO slot.
// Each frame is jittered by a sub-pixel amount and averaged (supersampling), then composited over
// a dark background and box-downsampled. Units follow the 2D reference (head width 1.12), y up.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const COL = {
  shellTop: "#FBF0DE", shellBottom: "#E9D0A8", visor: "#1d1c1b", glow: "#FFF1D6", clay: "#C9683F",
};
const lin = (hex) => new THREE.Color(hex); // three converts sRGB hex to linear working space

// ---------------------------------------------------------------- shapes
// Superquadric: (|x/a|^p + |y/b|^p)^(q/p) + |z/c|^q = 1. p squares the front outline, q the depth.
const HEAD = { a: 0.56, b: 0.43, c: 0.4, p: 3.0, q: 2.5 };
// Visor: a rounded rectangle (half sizes A, B, corner R) centred at y = cy on the head's front,
// raised by h with a rounded lip E wide, sunk `sink` into the shell at its edge.
const VIS = { A: 0.415, B: 0.235, R: 0.2, cy: 0.045, h: 0.034, E: 0.06, sink: 0.008, bulge: 0.012 };
const EAR = { a: 0.115, b: 0.115, c: 0.05, p: 2, q: 3.2, x: 0.575, y: 0.02 };
const ANT = { base: [0, 0.395, 0], ctrl: [-0.005, 0.585, 0.0], tip: [0.085, 0.668, 0.0], r: 0.025, ball: 0.078 };
const COLLAR = { a: 0.06, b: 0.06, c: 0.026, p: 2, q: 3 };

function sqF(x, y, z, s) {
  const S = Math.pow(Math.abs(x / s.a), s.p) + Math.pow(Math.abs(y / s.b), s.p);
  return Math.pow(S, s.q / s.p) + Math.pow(Math.abs(z / s.c), s.q);
}
function sqGrad(x, y, z, s) {
  const ax = Math.abs(x / s.a), ay = Math.abs(y / s.b), az = Math.abs(z / s.c);
  const S = Math.max(Math.pow(ax, s.p) + Math.pow(ay, s.p), 1e-14);
  const k = Math.pow(S, s.q / s.p - 1);
  return [
    (s.q * k * Math.pow(ax, s.p - 1) * Math.sign(x)) / s.a,
    (s.q * k * Math.pow(ay, s.p - 1) * Math.sign(y)) / s.b,
    (s.q * Math.pow(az, s.q - 1) * Math.sign(z)) / s.c,
  ];
}
// Distance estimate to a superquadric: g = F^(1/q) - 1, d ~ g / |grad g|.
function sqDist(x, y, z, s) {
  const F = Math.max(sqF(x, y, z, s), 1e-12);
  const g = Math.pow(F, 1 / s.q) - 1;
  const G = sqGrad(x, y, z, s), dg = (Math.pow(F, 1 / s.q - 1) / s.q);
  const len = Math.hypot(G[0], G[1], G[2]) * dg;
  return g / Math.max(len, 1e-6);
}
// The head's front surface height at (x, y).
function headZ(x, y) {
  const S = Math.pow(Math.abs(x / HEAD.a), HEAD.p) + Math.pow(Math.abs(y / HEAD.b), HEAD.p);
  const t = 1 - Math.pow(S, HEAD.q / HEAD.p);
  return t <= 0 ? 0 : HEAD.c * Math.pow(t, 1 / HEAD.q);
}
function sdRR(x, y) {
  const qx = Math.abs(x) - (VIS.A - VIS.R), qy = Math.abs(y - VIS.cy) - (VIS.B - VIS.R);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - VIS.R;
}
function visorLift(d) { // d = inset distance from the visor's edge (>= 0)
  const prof = d >= VIS.E ? 1 : Math.sin(Math.acos(1 - d / VIS.E));
  return VIS.h * prof - VIS.sink * (1 - prof);
}
function visorBulge(x, y) {
  const u = x / VIS.A, v = (y - VIS.cy) / VIS.B;
  return VIS.bulge * Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v);
}
function visorZ(x, y) { const d = Math.max(0, -sdRR(x, y)); return headZ(x, y) + visorLift(d) + visorBulge(x, y) * Math.min(1, d / VIS.E); }

// Superquadric mesh from a subdivided cube, pushed onto the surface, with analytic normals.
function sqGeometry(s, seg = 96) {
  const g = new THREE.BoxGeometry(2, 2, 2, seg, seg, seg);
  const P = g.attributes.position, N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    // spread the cube grid a little toward the edges (where the curvature is)
    const L = Math.hypot(x, y, z); x /= L; y /= L; z /= L;
    const r = Math.pow(sqF(x, y, z, s), -1 / s.q);
    x *= r; y *= r; z *= r;
    P.setXYZ(i, x, y, z);
    const G = sqGrad(x, y, z, s), gl = Math.hypot(G[0], G[1], G[2]) || 1;
    N.setXYZ(i, G[0] / gl, G[1] / gl, G[2] / gl);
  }
  return g;
}

function visorGeometry() {
  // The lip: rings inset from the edge (exact for a rounded rectangle); the top: homothetic copies of
  // the innermost lip ring shrinking to the centre, so no triangle is ever degenerate.
  const NT = 360, band = 30, inner = 28;
  const rayR = (cx, cy, d) => { let lo = 0, hi = VIS.A + 0.2; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; sdRR(m * cx, VIS.cy + m * cy) < -d ? (lo = m) : (hi = m); } return lo; };
  const pos = [], uv = [], idx = [];
  const nrm = [];
  // Analytic normals (glossy black glass shows every interpolation wobble): the base surface's
  // normal, tipped outward along the lip by the lip's quarter-ellipse profile.
  const put = (x, y, d) => {
    pos.push(x, y, visorZ(x, y)); uv.push((x + VIS.A) / (2 * VIS.A), (y - VIS.cy + VIS.B) / (2 * VIS.B));
    const e = 1e-4, base = (X, Y) => headZ(X, Y) + visorBulge(X, Y) * Math.min(1, d / VIS.E);
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
  for (let k = 0; k <= band; k++, rows++) {
    const d = VIS.E * (1 - Math.cos((Math.PI / 2) * (k / band)));
    for (const [cx, cy] of dirs) { const r = rayR(cx, cy, d); put(r * cx, VIS.cy + r * cy, d); }
  }
  const rE = dirs.map(([cx, cy]) => rayR(cx, cy, VIS.E));
  for (let k = 1; k < inner; k++, rows++) {
    const f = 1 - k / inner;
    dirs.forEach(([cx, cy], j) => put(rE[j] * f * cx, VIS.cy + rE[j] * f * cy, VIS.E));
  }
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

const v3 = (a) => new THREE.Vector3(...a);
function antennaCurve() { return new THREE.QuadraticBezierCurve3(v3(ANT.base), v3(ANT.ctrl), v3(ANT.tip)); }

// ---------------------------------------------------------------- ambient occlusion (per vertex)
function makeSDF(extra = []) {
  const curve = antennaCurve(), pts = curve.getPoints(48);
  const segD = (x, y, z) => {
    let best = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z, px = x - a.x, py = y - a.y, pz = z - a.z;
      const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)));
      const d = Math.hypot(px - bx * t, py - by * t, pz - bz * t);
      if (d < best) best = d;
    }
    return best - ANT.r;
  };
  const tip = ANT.tip;
  return (x, y, z) => {
    let d = sqDist(x, y, z, HEAD);
    // visor: below its height field and inside its outline
    const rr = sdRR(x, y);
    if (rr < 0.2 && z > 0) d = Math.min(d, Math.max(z - visorZ(x, y), rr));
    for (const sx of [-1, 1]) d = Math.min(d, sqDist(z, y - EAR.y, sx * (x - sx * EAR.x), EAR));
    d = Math.min(d, sqDist(x, z, y - HEAD.b, COLLAR));
    if (y > 0.25) d = Math.min(d, segD(x, y, z), Math.hypot(x - tip[0], y - tip[1], z - tip[2]) - ANT.ball);
    for (const f of extra) d = Math.min(d, f(x, y, z));
    return d;
  };
}
function bakeAO(geom, sdf, toLocal, strength = 2.6) {
  const P = geom.attributes.position, N = geom.attributes.normal, ao = new Float32Array(P.count);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(toLocal);
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i).applyMatrix4(toLocal);
    n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
    let occ = 0, sca = 1;
    for (let k = 1; k <= 6; k++) {
      const h = 0.012 + 0.2 * Math.pow(k / 6, 1.6);
      const d = sdf(p.x + n.x * h, p.y + n.y * h, p.z + n.z * h);
      occ += Math.max(0, h - d) * sca; sca *= 0.8;
    }
    ao[i] = Math.max(0, Math.min(1, 1 - strength * occ));
  }
  geom.setAttribute("aoV", new THREE.BufferAttribute(ao, 1));
}
// Feed the per-vertex AO into three's ambient occlusion (indirect diffuse + specular occlusion).
// Direct lights keep only a fraction of their (point-like, sparkly) specular: the softbox
// reflections from the environment draw the highlights.
function withVertexAO(mat, directToo = 0.35, directSpec = 0.25) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aoV;\nvarying float vAoV;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAoV = aoV;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vAoV;")
      .replace("#include <aomap_fragment>", `
        float ambientOcclusion = vAoV;
        reflectedLight.directSpecular *= ${directSpec.toFixed(2)};
        #if defined( USE_CLEARCOAT )
          clearcoatSpecularDirect *= ${directSpec.toFixed(2)};
        #endif
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, ${directToo.toFixed(2)});
        #if defined( USE_CLEARCOAT )
          clearcoatSpecularIndirect *= ambientOcclusion;
        #endif
        #if defined( USE_ENVMAP ) && defined( STANDARD )
          float dotNVao = saturate( dot( geometryNormal, geometryViewDir ) );
          reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNVao, ambientOcclusion, material.roughness );
        #endif
      `);
  };
  mat.customProgramCacheKey = () => "vao" + directToo + "/" + directSpec;
  return mat;
}

// ---------------------------------------------------------------- the face (visor emissive map)
// A face is a signed distance (visor units, y up) to its glowing glyphs. The map is computed in
// floating point (an 8-bit canvas bands the faint halo tails into visible contours on black glass):
// a crisp anti-aliased core plus two smooth falloffs for the light scattered in the glass.
function faceTexture(sd, o = {}) {
  const W = 2048, H = Math.round((W * VIS.B) / VIS.A), px = (2 * VIS.A) / W;
  const core = lin(o.core ?? COL.glow), halo = lin(o.halo ?? "#ffc48a");
  const data = new Uint16Array(W * H * 4), toH = THREE.DataUtils.toHalfFloat;
  const near = o.near ?? 0.06, far = o.far ?? 0.006;
  for (let j = 0; j < H; j++) {
    const y = VIS.cy - VIS.B + (j + 0.5) * px;
    for (let i = 0; i < W; i++) {
      const x = -VIS.A + (i + 0.5) * px, d = sd(x, y);
      const c = Math.max(0, Math.min(1, 0.5 - d / px)), e = Math.max(0, d);
      const h = (near * Math.exp(-((e / 0.016) ** 2)) + far * Math.exp(-e / 0.05)) * (1 - c);
      const k = (j * W + i) * 4;
      data[k] = toH(core.r * c + halo.r * h); data[k + 1] = toH(core.g * c + halo.g * h);
      data[k + 2] = toH(core.b * c + halo.b * h); data[k + 3] = toH(1);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.colorSpace = THREE.LinearSRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
const sdPill = (x, y, cx, cy, w, h) => { // rounded box with fully round ends
  const r = Math.min(w, h) / 2, qx = Math.abs(x - cx) - (w / 2 - r), qy = Math.abs(y - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdSeg = (x, y, ax, ay, bx, by) => {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t);
};
const sdEllipse = (x, y, rx, ry) => { const k1 = Math.hypot(x / rx, y / ry), k2 = Math.hypot(x / (rx * rx), y / (ry * ry)); return k2 > 0 ? (k1 * (k1 - 1)) / k2 : -Math.min(rx, ry); };
const sdArc = (x, y, cx, cy, R, a0, a1) => { // arc from angle a0 to a1 (counter-clockwise, y up)
  const a = Math.atan2(y - cy, x - cx); let t = a - a0; while (t < 0) t += Math.PI * 2;
  if (t <= a1 - a0) return Math.abs(Math.hypot(x - cx, y - cy) - R);
  return Math.min(Math.hypot(x - cx - R * Math.cos(a0), y - cy - R * Math.sin(a0)), Math.hypot(x - cx - R * Math.cos(a1), y - cy - R * Math.sin(a1)));
};
const FACES = {
  pills: (eyeW = 0.118, eyeH = 0.19, eyeX = 0.185, y = VIS.cy) => (x, yy) =>
    Math.min(sdPill(x, yy, -eyeX, y, eyeW, eyeH), sdPill(x, yy, eyeX, y, eyeW, eyeH)),
  x0: (o = {}) => {
    const y = o.y ?? VIS.cy, ex = o.eyeX ?? 0.19, s = o.size ?? 0.078, lw = o.lw ?? 0.05;
    const rx = o.rx ?? 0.072, ry = o.ry ?? 0.088, sw = o.smileW ?? 0.034;
    return (x, yy) => {
      let d = Math.min(sdSeg(x, yy, -ex - s, y - s, -ex + s, y + s), sdSeg(x, yy, -ex - s, y + s, -ex + s, y - s)) - lw / 2;
      d = Math.min(d, Math.abs(sdEllipse(x - ex, yy - y, rx, ry)) - lw / 2);
      if (o.smile) d = Math.min(d, sdArc(x, yy, 0, y - (o.smileY ?? 0.035), o.smile, Math.PI * 1.22, Math.PI * 1.78) - sw / 2);
      return d;
    };
  },
};

// ---------------------------------------------------------------- studio environment
function studioEnv(renderer, opt = {}) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(opt.room ?? 0x050505), side: THREE.BackSide }));
  env.add(room);
  const box = (w, h, pos, intensity, tint = [1, 0.97, 0.92]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint[0] * intensity, tint[1] * intensity, tint[2] * intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m); return m;
  };
  // overhead softbox, key from upper left front, two rim strips behind, a faint front card
  box(7, 5, [0, 9, 1.5], opt.top ?? 3.2);
  box(4.5, 4.5, [-7, 5, 6], opt.key ?? 5.0);
  box(1.4, 9, [8, 2.5, -4], opt.rimR ?? 6.0, [0.95, 0.97, 1.0]);
  box(1.4, 9, [-8, 1.5, -4], opt.rimL ?? 3.5, [1.0, 0.95, 0.9]);
  box(10, 3, [0, -5.5, 8.5], opt.front ?? 0.35);
  box(12, 12, [0, -9, 0], opt.floor ?? 0.45, [1.0, 0.78, 0.55]); // warm bounce from below
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.015);
  pm.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------- the robot
function buildBot(o) {
  const group = new THREE.Group();
  const shellMat = withVertexAO(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: o.shellRough ?? 0.42, clearcoat: 1, clearcoatRoughness: o.coatRough ?? 0.1,
    sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color("#ffd2a6"), envMapIntensity: o.shellEnv ?? 1.0,
    emissive: lin("#c46a32"), emissiveIntensity: o.shellWarm ?? 0.05,
  }));
  const clayMat = withVertexAO(new THREE.MeshPhysicalMaterial({
    color: lin(COL.clay), roughness: 0.34, clearcoat: 0.9, clearcoatRoughness: 0.14, envMapIntensity: 1.0,
  }));
  const visorMat = withVertexAO(new THREE.MeshPhysicalMaterial({
    color: lin(o.visorColor ?? "#141312"), roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.025, ior: 1.6,
    specularIntensity: 1, envMapIntensity: o.visorEnv ?? 1.25,
    emissive: new THREE.Color(1, 1, 1), emissiveMap: faceTexture(o.face ?? FACES.pills()), emissiveIntensity: o.eyeGlow ?? 5.5,
  }), 0.2);
  const ballMat = withVertexAO(new THREE.MeshPhysicalMaterial({
    color: lin(COL.clay), roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08,
    emissive: lin(o.ballGlowColor ?? "#ff7a3d"), emissiveIntensity: o.ballGlow ?? 0.55,
  }));

  const sdf = makeSDF(o.extraSDF ?? []);
  const add = (geom, mat, setup) => {
    const m = new THREE.Mesh(geom, mat);
    setup?.(m);
    m.updateMatrix();
    bakeAO(geom, sdf, m.matrix, o.aoStrength ?? 2.6);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); return m;
  };

  // head with a top-to-bottom cream gradient in its vertex colours
  const hg = sqGeometry(HEAD, 128);
  const top = lin(COL.shellTop), bot = lin(COL.shellBottom), cols = [];
  for (let i = 0; i < hg.attributes.position.count; i++) {
    const y = hg.attributes.position.getY(i), t = THREE.MathUtils.smoothstep(y, -HEAD.b * 0.9, HEAD.b * 0.85);
    const c = bot.clone().lerp(top, t); cols.push(c.r, c.g, c.b);
  }
  hg.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  add(hg, shellMat);
  add(visorGeometry(), visorMat);
  for (const sx of [-1, 1]) add(sqGeometry(EAR, 48), clayMat, (m) => { m.rotation.y = (sx * Math.PI) / 2; m.position.set(sx * EAR.x, EAR.y, 0); });
  // antenna: collar, stalk, ball
  const colG = sqGeometry(COLLAR, 32);
  const cc = []; for (let i = 0; i < colG.attributes.position.count; i++) cc.push(bot.r, bot.g, bot.b);
  colG.setAttribute("color", new THREE.Float32BufferAttribute(cc, 3));
  add(colG, shellMat, (m) => { m.rotation.x = -Math.PI / 2; m.position.set(0, HEAD.b - 0.004, 0); });
  const stalk = new THREE.TubeGeometry(antennaCurve(), 96, ANT.r, 32, false);
  const sc = []; for (let i = 0; i < stalk.attributes.position.count; i++) sc.push(bot.r, bot.g, bot.b);
  stalk.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3));
  add(stalk, shellMat);
  add(new THREE.SphereGeometry(ANT.ball, 96, 64), ballMat, (m) => m.position.set(...ANT.tip));
  for (const extra of o.extraMeshes ?? []) {
    const { geom, mat } = extra(shellMat, clayMat);
    add(geom, mat);
  }
  return group;
}

// ---------------------------------------------------------------- render
function sampleDisc(i, n) { // golden-angle spiral, uniform on a disc
  const r = Math.sqrt((i + 0.5) / n), a = i * 2.399963;
  return [r * Math.cos(a), r * Math.sin(a)];
}
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

export async function renderIcon(V, { size = 2048, samples = 40 } = {}) {
  const t0 = performance.now();
  const W = size, H = size;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.toneMapping = V.toneMapping ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = V.exposure ?? 1.12;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  scene.environment = studioEnv(renderer, V.env ?? {});
  scene.environmentIntensity = V.envIntensity ?? 1.0;
  const bot = buildBot(V.bot ?? {});
  bot.rotation.set(V.pitch ?? 0, V.yaw ?? 0, V.roll ?? 0, "YXZ");
  bot.position.set(...(V.botPos ?? [0, 0, 0]));
  scene.add(bot);

  const cam = new THREE.PerspectiveCamera(V.fov ?? 24, 1, 0.1, 50);
  cam.position.set(...V.cam); cam.lookAt(...V.target); cam.updateMatrixWorld();

  const key = new THREE.DirectionalLight(new THREE.Color("#fff3e4"), V.keyI ?? 1.6);
  const keyPos = new THREE.Vector3(...(V.keyPos ?? [-2.2, 3.0, 2.6]));
  key.castShadow = !V.noShadow; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.3, right: 1.3, top: 1.3, bottom: -1.3, near: 0.5, far: 12 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 2;
  scene.add(key, key.target);
  const rims = (V.rims ?? [[[2.6, 1.2, -2.2], 3.4, "#ffb07a"], [[-2.8, 0.4, -2.0], 1.6, "#dfe8ff"]]).map(([p, i, c]) => {
    const l = new THREE.DirectionalLight(new THREE.Color(c), i); l.position.set(...p); scene.add(l); return l;
  });
  const fill = new THREE.DirectionalLight(new THREE.Color("#ffd9b8"), V.fillI ?? 0.45); fill.position.set(0.8, -1.6, 2.2); scene.add(fill);
  void rims;

  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1); composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), V.bloom ?? 0.28, V.bloomRadius ?? 0.0, V.bloomThreshold ?? 4.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Each frame is read back as 8 bits; a fresh +-1 LSB of noise per frame lets the average keep the
  // smooth gradients in the black glass (otherwise they band into contours).
  const dither = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, seed: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform sampler2D tDiffuse; uniform float seed; varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
      void main() { vec4 c = texture2D(tDiffuse, vUv); float n = h(gl_FragCoord.xy) + h(gl_FragCoord.yx + 17.0) - 1.0;
        gl_FragColor = vec4(c.rgb + n / 255.0, 1.0); }`,
  });
  composer.addPass(dither);

  const gl = renderer.getContext();
  const px = new Uint8Array(W * H * 4);
  const acc = new Float32Array(W * H * 3), mAcc = new Float32Array(W * H);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const lightR = V.keySoft ?? 0.55;
  const kDir = keyPos.clone().normalize();
  const kU = new THREE.Vector3(0, 1, 0).cross(kDir).normalize(), kV = kDir.clone().cross(kU).normalize();

  for (let s = 0; s < samples; s++) {
    // sub-pixel jitter (tent-ish, 0.6 px radius) and a point on the key light's disc
    const jx = (halton(s + 1, 2) - 0.5) * 1.2, jy = (halton(s + 1, 3) - 0.5) * 1.2;
    cam.setViewOffset(W, H, jx, jy, W, H);
    const [dx, dy] = sampleDisc(s, samples);
    key.position.copy(keyPos).addScaledVector(kU, dx * lightR * keyPos.length() * 0.25).addScaledVector(kV, dy * lightR * keyPos.length() * 0.25);
    scene.overrideMaterial = null; bloom.enabled = true; dither.uniforms.seed.value = (s * 7.31) % 97;
    renderer.shadowMap.needsUpdate = true;
    composer.render();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) { acc[i * 3] += px[j]; acc[i * 3 + 1] += px[j + 1]; acc[i * 3 + 2] += px[j + 2]; }
    // coverage mask with the same jitter
    scene.overrideMaterial = white;
    const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(null); renderer.render(scene, cam);
    renderer.toneMapping = tm;
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) mAcc[i] += px[j];
    await new Promise((r) => setTimeout(r, 0));
  }
  scene.overrideMaterial = null;

  // composite over the background (display space), flip rows, then 2x box downsamples
  const inv = 1 / (samples * 255);
  const bg = V.background, fade = V.fade;
  const out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const srcRow = H - 1 - y, v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const i = srcRow * W + x, o = (y * W + x) * 3, u = (x + 0.5) / W;
      const m = mAcc[i] * inv;
      const b = bg(u, v), f = fade ? fade(u, v) : 0;
      for (let k = 0; k < 3; k++) {
        const c = b[k] * (1 - m) + acc[i * 3 + k] * inv;
        out[o + k] = c + (b[k] - c) * f;
      }
    }
  }
  const half = (src, w) => {
    const h2 = w / 2, dst = new Float32Array(h2 * h2 * 3);
    for (let y = 0; y < h2; y++) for (let x = 0; x < h2; x++) for (let k = 0; k < 3; k++) {
      const a = ((2 * y) * w + 2 * x) * 3 + k, b = a + w * 3;
      dst[(y * h2 + x) * 3 + k] = (src[a] + src[a + 3] + src[b] + src[b + 3]) / 4;
    }
    return dst;
  };
  const toB64 = (img, w) => {
    const bytes = new Uint8Array(w * w * 3);
    let seed = 12345;
    for (let i = 0; i < bytes.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const dither = (seed / 4294967296 - 0.5) / 255;
      bytes[i] = Math.max(0, Math.min(255, Math.round((img[i] + dither) * 255)));
    }
    let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const a = half(out, W), b = half(a, W / 2);
  renderer.dispose(); rt.dispose();
  return { w1: W / 2, img1: toB64(a, W / 2), w2: W / 4, img2: toB64(b, W / 4), ms: Math.round(performance.now() - t0) };
}

// ---------------------------------------------------------------- background helpers
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export function darkBackground({ base = "#0d0b0a", glow = "#2a1f18", edge = "#060505", cx = 0.5, cy = 0.44, r = 0.62, vignette = 0.85 } = {}) {
  const B = hexRGB(base), G = hexRGB(glow), E = hexRGB(edge);
  return (u, v) => {
    const d = Math.hypot(u - cx, (v - cy) * 1.05) / r;
    const g = Math.exp(-d * d * 2.2);
    let c = mix(B, G, g);
    const vd = Math.hypot(u - 0.5, v - 0.5) / 0.7071;
    c = mix(c, E, sstep(0.45, 1.05, vd) * vignette);
    return c;
  };
}

// ---------------------------------------------------------------- variants
export const VARIANTS = {
  // 1. front 3/4, soft pill eyes, warm near-black with a glow behind
  "1-glow": () => ({
    yaw: -0.36, pitch: 0.06, cam: [0, 0.32, 3.95], target: [0, 0.145, 0], fov: 24,
    background: darkBackground({ glow: "#2b2019", cy: 0.43 }),
    bot: { face: FACES.pills() },
  }),
  // 2. the same bot with an x and a 0 for eyes (X0 Bot), a small smile and a slight head tilt so it stays friendly
  "2-x0": () => ({
    yaw: -0.3, pitch: 0.06, roll: 0.07, cam: [0, 0.32, 3.95], target: [0, 0.145, 0], fov: 24,
    background: darkBackground({ glow: "#2b2019", cy: 0.43 }),
    bot: { face: FACES.x0({ smile: 0.085, smileY: 0.075, smileW: 0.03, y: VIS.cy + 0.04, size: 0.066, rx: 0.064, ry: 0.078, lw: 0.046 }) },
  }),
  // 3. front and big: symmetric, the head fills the icon, the glass reflections do the work
  "3-front": () => ({
    yaw: -0.05, pitch: 0.05, cam: [0, 0.3, 3.2], target: [0, 0.15, 0], fov: 24,
    background: darkBackground({ glow: "#241b16", cy: 0.45 }),
    bot: { face: FACES.pills() },
  }),
  // 4. hero: seen from a little below, the head rising out of soft darkness at the bottom edge
  "4-rise": () => ({
    yaw: -0.26, pitch: 0.12, botPos: [0, -0.24, 0], cam: [0, -0.3, 3.38], target: [0, 0.05, 0], fov: 24,
    keyPos: [-1.6, 3.6, 1.2], fillI: 0.0,
    background: darkBackground({ glow: "#33241a", cy: 0.34, r: 0.62 }),
    fade: (u, v) => 0.96 * sstep(0.74, 0.99, v),
    bot: { face: FACES.pills(0.118, 0.19, 0.185, VIS.cy + 0.025), ballGlow: 0.9 },
  }),
};
export { FACES, THREE };
