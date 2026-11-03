// Procedural RS-25 / SSME model for Project AKS (original geometry, no third-party mesh data).
// Built in metres (throat at y=0, nozzle exit at y=-3.0, gimbal top ~ +1.27, i.e. ~4.27 m overall like the real engine),
// then normalised: Y-up, bbox centred at origin, longest dimension = 2 units, nozzle pointing -Y.
// usage: node build-rs25.mjs <out.glb> [detail=1] [hotspots.json]
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'fs';

const OUT = process.argv[2];
const DETAIL = parseFloat(process.argv[3] || '1');
const HOTSPOT_OUT = process.argv[4];
const Q = (n, min = 6) => Math.max(min, Math.round(n * DETAIL));

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const toV = (p) => (p.isVector3 ? p.clone() : v3(p[0], p[1], p[2]));
const UP = v3(0, 1, 0);
const deg = Math.PI / 180;

// ---------------------------------------------------------------- registry
const groups = new Map(); // name -> { label, description, children: Map(childName -> Map(mat -> geoms[])), hotspot, explode }
function group(name, label, description) {
  if (!groups.has(name)) groups.set(name, { name, label, description, children: new Map() });
  return groups.get(name);
}
function add(gname, child, mat, geom) {
  const g = groups.get(gname);
  if (!g.children.has(child)) g.children.set(child, new Map());
  const m = g.children.get(child);
  if (!m.has(mat)) m.set(mat, []);
  m.get(mat).push(prep(geom));
}
function prep(g) {
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return g;
}

// ---------------------------------------------------------------- primitives
function orient(g, dir, pos, spin = 0) {
  if (spin) g.rotateY(spin);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, toV(dir).normalize());
  g.applyQuaternion(q);
  const p = toV(pos);
  g.translate(p.x, p.y, p.z);
  return g;
}
function cyl(p0, p1, r0, r1 = r0, seg = 40, open = false) {
  p0 = toV(p0); p1 = toV(p1);
  const d = p1.clone().sub(p0);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), Q(seg, 8), 1, open);
  return orient(g, d, p0.clone().add(p1).multiplyScalar(0.5));
}
function sphere(c, r, ws = 40, hs = 28) {
  const g = new THREE.SphereGeometry(r, Q(ws, 10), Q(hs, 8));
  const p = toV(c);
  g.translate(p.x, p.y, p.z);
  return g;
}
function torus(center, axis, R, tube, radial = 12, tubular = 96, axialScale = 1) {
  const g = new THREE.TorusGeometry(R, tube, Q(radial, 6), Q(tubular, 16));
  g.scale(1, 1, axialScale); // torus axis is +Z
  g.rotateX(-Math.PI / 2); // axis -> +Y
  return orient(g, axis, center);
}
function box(center, size, yaw = 0, pitch = 0) {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  if (pitch) g.rotateX(pitch);
  if (yaw) g.rotateY(yaw);
  const p = toV(center);
  g.translate(p.x, p.y, p.z);
  return g;
}
// Make sharp profile corners crisp: split each corner into two points a hair apart
// (three's LatheGeometry weights normals by segment length, so the tiny bevel keeps faces flat-shaded).
function crisp(profile, eps = 0.0008, thresholdDeg = 28) {
  const out = [profile[0]];
  for (let i = 1; i < profile.length - 1; i++) {
    const [ax, ay] = profile[i - 1], [bx, by] = profile[i], [cx, cy] = profile[i + 1];
    let ux = bx - ax, uy = by - ay, wx = cx - bx, wy = cy - by;
    const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
    ux /= lu; uy /= lu; wx /= lw; wy /= lw;
    const ang = Math.acos(Math.max(-1, Math.min(1, ux * wx + uy * wy)));
    if (ang > thresholdDeg * deg && lu > 3 * eps && lw > 3 * eps) {
      out.push([bx - ux * eps, by - uy * eps]);
      out.push([bx + wx * eps, by + wy * eps]);
    } else out.push(profile[i]);
  }
  out.push(profile[profile.length - 1]);
  return out;
}
// Lathe around local +Y. Profile [[r,y],...] traversed counter-clockwise (r right, y up) => outward normals.
function lathe(profile, seg = 64, pos = [0, 0, 0], dir = UP, sharp = true) {
  const pts = (sharp ? crisp(profile) : profile).map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y));
  const g = new THREE.LatheGeometry(pts, Q(seg, 12));
  return orient(g, dir, pos);
}
// Pipe through polyline with filleted corners; flanged ends.
function pipe(points, r, opts = {}) {
  const { fillet = r * 2.6, radial = 16, flangeEnds = true, flangeR = 1.35, step = null } = opts;
  const P = points.map(toV);
  const path = new THREE.CurvePath();
  let prev = P[0].clone();
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const d1 = b.clone().sub(a), d2 = c.clone().sub(b);
    const l1 = d1.length(), l2 = d2.length();
    d1.normalize(); d2.normalize();
    const ang = d1.angleTo(d2);
    if (ang < 1e-3) continue;
    const t = Math.min(fillet * Math.tan(ang / 2), 0.45 * l1, 0.45 * l2);
    const A = b.clone().addScaledVector(d1, -t), B = b.clone().addScaledVector(d2, t);
    if (prev.distanceTo(A) > 1e-5) path.add(new THREE.LineCurve3(prev.clone(), A));
    path.add(new THREE.QuadraticBezierCurve3(A, b.clone(), B));
    prev = B;
  }
  path.add(new THREE.LineCurve3(prev.clone(), P[P.length - 1].clone()));
  path.arcLengthDivisions = 4000;
  const L = path.getLength();
  const st = step || Math.min(0.02, Math.max(0.006, fillet * 0.35));
  const segs = Math.max(4, Math.ceil(L / (st / Math.max(DETAIL, 0.35))));
  const geoms = [new THREE.TubeGeometry(path, segs, r, Q(radial, 6), false)];
  if (flangeEnds) {
    for (const u of [0, 1]) {
      const p = path.getPointAt(u), tdir = path.getTangentAt(u);
      const w = r * 0.55;
      const c = p.clone().addScaledVector(tdir, u === 0 ? w * 0.3 : -w * 0.3);
      geoms.push(cyl(c.clone().addScaledVector(tdir, -w / 2), c.clone().addScaledVector(tdir, w / 2), r * flangeR, r * flangeR, radial + 8));
    }
  }
  return geoms.map(prep);
}
// collar (flange ring) somewhere along a straight direction
function collar(p, dir, r, w) {
  const d = toV(dir).normalize(), c = toV(p);
  return cyl(c.clone().addScaledVector(d, -w / 2), c.clone().addScaledVector(d, w / 2), r, r, 36);
}

// ---------------------------------------------------------------- nozzle contour (inner wall, metres)
const Rt = 0.131; // throat radius (10.3 in throat dia.)
const Rd = 0.382 * Rt; // downstream throat arc radius
const thN = 31 * deg, thE = 7.5 * deg;
const Y_EXIT = -3.0, R_EXIT = 1.15;
const N = { r: Rt + Rd - Rd * Math.cos(thN), y: -Rd * Math.sin(thN) };
const Ltot = N.y - Y_EXIT;
const dctl = (R_EXIT - Math.tan(thE) * Ltot - N.r) / (Math.tan(thN) - Math.tan(thE));
const CP = { r: N.r + Math.tan(thN) * dctl, y: N.y - dctl };
function bell(t) {
  const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
  return { r: a * N.r + b * CP.r + c * R_EXIT, y: a * N.y + b * CP.y + c * Y_EXIT };
}
function tAtY(y) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (bell(m).y > y) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
const WALL = 0.024;
const rIn = (y) => bell(tAtY(y)).r;
const rOut = (y) => rIn(y) + WALL;
const Y_JOINT = -0.22; // nozzle / MCC joint

// ================================================================= GROUPS
group('Nozzle', 'Regeneratively cooled nozzle', 'Bell nozzle (expansion ratio ~69:1). Its wall is a bundle of ~1,080 brazed tubes that carry liquid hydrogen to cool it before it is burned. The paper studies this cooling approach in Section 13.');
group('MainCombustionChamber', 'Main combustion chamber', 'Copper-alloy chamber with milled coolant channels; hydrogen and oxygen burn here at ~20 MPa before expanding through the throat.');
group('Powerhead', 'Powerhead: main injector and hot-gas manifold', 'The structural backbone: the hot-gas manifold carries turbine exhaust from both preburners into the main injector.');
group('HPFTP', 'High-pressure fuel turbopump + fuel preburner', 'Raises liquid hydrogen to ~45 MPa; driven by the fuel-rich fuel preburner mounted above it (staged-combustion cycle).');
group('HPOTP', 'High-pressure oxidizer turbopump + oxidizer preburner', 'Pumps liquid oxygen to the main injector and preburners; driven by the oxidizer preburner.');
group('LPFTP', 'Low-pressure fuel turbopump', 'Boost pump that raises hydrogen inlet pressure so the high-pressure pump does not cavitate.');
group('LPOTP', 'Low-pressure oxidizer turbopump', 'Boost pump for liquid oxygen, turbine-driven by high-pressure LOX bled from the HPOTP.');
group('PogoAccumulator', 'POGO suppression accumulator', 'Gas-filled sphere on the oxidizer line that damps pressure oscillations (POGO) between engine and vehicle.');
group('FuelDucts', 'Fuel ducts', 'Low-pressure fuel discharge duct, main fuel line and the steerhorn that feeds hydrogen into the nozzle coolant manifold.');
group('OxidizerDucts', 'Oxidizer ducts', 'Low-pressure oxidizer discharge duct and the high-pressure line to the main oxidizer valve and injector.');
group('Valves', 'Propellant valves', 'Main fuel/oxidizer valves, chamber coolant valve and the preburner oxidizer valves that throttle the engine.');
group('GimbalBearing', 'Gimbal bearing', 'Ball-and-socket thrust mount; hydraulic actuators swivel the engine about it for steering.');
group('EngineController', 'Engine controller', 'Digital controller that runs closed-loop thrust and mixture-ratio control and engine health monitoring.');

// ---------------------------------------------------------------- Nozzle
{
  // inner wall with coolant-tube ridges (dark), facing the axis
  const rows = [];
  const t0 = tAtY(Y_JOINT);
  const NR = Q(64, 20);
  for (let i = 0; i <= NR; i++) {
    const u = i / NR;
    const t = t0 + (1 - t0) * (1 - Math.pow(1 - u, 1.35));
    rows.push(bell(t));
  }
  const ridges = Q(150, 48), per = 4, seg = ridges * per;
  const pos = [], idx = [];
  for (let i = 0; i < rows.length; i++) {
    const { r, y } = rows[i];
    const a = 0.0045 * (0.6 + 0.4 * (r / R_EXIT));
    for (let j = 0; j < seg; j++) {
      const th = (2 * Math.PI * j) / seg;
      const rr = r - a * (0.5 + 0.5 * Math.cos(ridges * th));
      pos.push(rr * Math.cos(th), y, rr * Math.sin(th));
    }
  }
  for (let i = 0; i < rows.length - 1; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // ensure normals point toward the axis
  const n0 = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, Math.floor(rows.length / 2) * seg);
  const p0 = new THREE.Vector3().fromBufferAttribute(g.attributes.position, Math.floor(rows.length / 2) * seg);
  if (n0.x * p0.x + n0.z * p0.z > 0) {
    for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  add('Nozzle', 'Nozzle_TubeBundleInterior', 'NozzleInterior', g);

  // outer wall (smooth), profile bottom -> top for outward normals
  const outer = [];
  const NO = Q(70, 20);
  for (let i = NO; i >= 0; i--) {
    const u = i / NO;
    const t = t0 + (1 - t0) * (1 - Math.pow(1 - u, 1.35));
    const b = bell(t);
    outer.push([b.r + WALL, b.y]);
  }
  add('Nozzle', 'Nozzle_Bell', 'Steel', lathe(outer, 160, [0, 0, 0], UP, false));
  // exit lip (annulus facing down), inner -> outer
  add('Nozzle', 'Nozzle_Bell', 'Steel', lathe([[R_EXIT - 0.003, Y_EXIT], [R_EXIT + WALL + 0.001, Y_EXIT]], 160, [0, 0, 0], UP, false));
  // top joint flange
  const rj = rIn(Y_JOINT);
  add('Nozzle', 'Nozzle_Bell', 'Steel', lathe([[rj, Y_JOINT - 0.001], [rj + 0.11, Y_JOINT - 0.001], [rj + 0.11, Y_JOINT + 0.04], [rj + 0.02, Y_JOINT + 0.04]], 96));

  // hatbands (stiffener rings) - 11 like the figure
  const NH = 11;
  for (let k = 0; k < NH; k++) {
    const yc = -0.5 - k * ((2.82 - 0.5) / (NH - 1));
    const h = 0.034, prot = 0.03;
    const yb = yc - h / 2, yt = yc + h / 2;
    const prof = [[rOut(yb) - 0.004, yb], [rOut(yb) + prot, yb], [rOut(yt) + prot, yt], [rOut(yt) - 0.004, yt]];
    add('Nozzle', 'Nozzle_Hatbands', 'SteelSatin', lathe(prof, 144));
  }
  // aft manifold band at exit
  {
    const y0 = Y_EXIT + 0.002, y1 = Y_EXIT + 0.11;
    const prof = [[rOut(y0) - 0.004, y0], [rOut(y0) + 0.05, y0], [rOut(y1) + 0.05, y1 - 0.02], [rOut(y1) + 0.03, y1], [rOut(y1) - 0.004, y1]];
    add('Nozzle', 'Nozzle_AftManifold', 'SteelSatin', lathe(prof, 160));
    // drain/feed stubs between the last hatband and the aft manifold
    const NS = 10;
    for (let s = 0; s < NS; s++) {
      const ph = (s / NS) * 2 * Math.PI + 0.2;
      const ya = Y_EXIT + 0.1, yb2 = Y_EXIT + 0.27;
      const ra = rOut(ya) + 0.03, rb = rOut(yb2) + 0.03;
      add('Nozzle', 'Nozzle_AftManifold', 'SteelSatin', cyl([ra * Math.cos(ph), ya, ra * Math.sin(ph)], [rb * Math.cos(ph), yb2, rb * Math.sin(ph)], 0.011, 0.011, 10));
    }
  }
  // nozzle coolant inlet manifold (top torus)
  const yM = -0.31;
  add('Nozzle', 'Nozzle_InletManifold', 'SteelSatin', torus([0, yM, 0], UP, rOut(yM) + 0.045, 0.046, 14, 120));
  // coolant feed lines running down the outside of the bell (with the S-jog seen in Fig. 10)
  const lines = [
    { ph: 78 * deg, jog: 0 },
    { ph: 101 * deg, jog: -9 * deg, yj: -1.95 },
    { ph: -24 * deg, jog: 0 },
    { ph: 205 * deg, jog: 7 * deg, yj: -2.2 },
  ];
  for (const L of lines) {
    const pts = [];
    const off = 0.05;
    const P = (y, ph) => { const r = rOut(y) + off; return [r * Math.cos(ph), y, r * Math.sin(ph)]; };
    const yS = yM - 0.05, yE = Y_EXIT + 0.11;
    const step = 0.16;
    for (let y = yS; y > yE; y -= step) {
      if (L.jog && y < L.yj + step && y > L.yj - step) continue;
      if (L.jog && y <= L.yj - step) break;
      pts.push(P(y, L.ph));
    }
    if (L.jog) {
      pts.push(P(L.yj + 0.03, L.ph));
      pts.push(P(L.yj, L.ph + L.jog * 0.5));
      pts.push(P(L.yj - 0.03, L.ph + L.jog));
      for (let y = L.yj - 0.14; y > yE; y -= step) pts.push(P(y, L.ph + L.jog));
    }
    pts.push(P(yE, L.ph + (L.jog || 0)));
    for (const g of pipe(pts, 0.015, { fillet: 0.06, radial: 10, flangeR: 1.6 })) add('Nozzle', 'Nozzle_CoolantFeedLines', 'SteelBright', g);
    // clamps where the line crosses each hatband
    for (let k = 0; k < 11; k++) {
      const yc = -0.5 - k * ((2.82 - 0.5) / 10);
      const ph = L.jog && yc < L.yj ? L.ph + L.jog : L.ph;
      const r = rOut(yc) + 0.035;
      add('Nozzle', 'Nozzle_CoolantFeedLines', 'SteelBright', box([r * Math.cos(ph), yc, r * Math.sin(ph)], [0.035, 0.03, 0.05], -ph + Math.PI / 2));
    }
  }
}

// ---------------------------------------------------------------- Main combustion chamber
{
  const prof = [[0.31, -0.215], [0.31, -0.17], [0.285, -0.15], [0.262, -0.08], [0.252, 0.0], [0.262, 0.08], [0.29, 0.14], [0.3, 0.17], [0.3, 0.38], [0.335, 0.38], [0.335, 0.42]];
  add('MainCombustionChamber', 'MCC_Body', 'Steel', lathe(prof, 96));
  add('MainCombustionChamber', 'MCC_Body', 'SteelSatin', torus([0, 0.3, 0], UP, 0.305, 0.022, 10, 96));
  add('MainCombustionChamber', 'MCC_Body', 'SteelSatin', torus([0, 0.2, 0], UP, 0.303, 0.016, 10, 96));
  add('MainCombustionChamber', 'MCC_Body', 'SteelSatin', torus([0, -0.13, 0], UP, 0.285, 0.02, 10, 96));
  // interior: throat & chamber (inward-facing => profile top -> bottom)
  const inner = [[0.225, 0.42], [0.225, 0.15]];
  for (let a = 0; a <= 12; a++) {
    // converging arc into the throat (radius 1.5 Rt)
    const R = 1.5 * Rt, phi = (40 - (40 * a) / 12) * deg;
    inner.push([Rt + R - R * Math.cos(phi), R * Math.sin(phi)]);
  }
  for (let a = 1; a <= 6; a++) {
    const phi = (thN * a) / 6;
    inner.push([Rt + Rd - Rd * Math.cos(phi), -Rd * Math.sin(phi)]);
  }
  const t0 = tAtY(Y_JOINT);
  for (let a = 1; a <= 8; a++) { const b = bell((t0 * a) / 8); inner.push([b.r, b.y]); }
  add('MainCombustionChamber', 'MCC_Interior', 'NozzleInterior', lathe(inner, 96, [0, 0, 0], UP, false));
  // injector face (faces down): annulus inner -> outer, with concentric element rows
  add('MainCombustionChamber', 'MCC_Interior', 'NozzleInterior', lathe([[0.0, 0.418], [0.226, 0.418]], 96, [0, 0, 0], UP, false));
  for (const rr of [0.05, 0.09, 0.13, 0.17, 0.205]) add('MainCombustionChamber', 'MCC_Interior', 'Steel', torus([0, 0.417, 0], UP, rr, 0.006, 6, 64, 0.5));
}

// ---------------------------------------------------------------- Powerhead (main injector + hot-gas manifold)
{
  const prof = [[0.335, 0.42], [0.345, 0.42], [0.345, 0.47], [0.33, 0.47], [0.33, 0.6], [0.36, 0.62], [0.375, 0.7], [0.37, 0.8], [0.34, 0.88], [0.28, 0.95], [0.2, 0.985], [0.0, 0.995]];
  add('Powerhead', 'HotGasManifold', 'Steel', lathe(prof, 96));
  // transfer ducts to the two preburners / turbines
  add('Powerhead', 'HotGasManifold', 'Steel', cyl([0.2, 0.77, 0], [0.5, 0.77, -0.01], 0.15, 0.16, 48));
  add('Powerhead', 'HotGasManifold', 'Steel', cyl([-0.2, 0.76, 0], [-0.46, 0.76, 0.0], 0.14, 0.14, 48));
  add('Powerhead', 'HotGasManifold', 'SteelSatin', collar([0.42, 0.77, -0.01], [1, 0, 0], 0.18, 0.03));
  add('Powerhead', 'HotGasManifold', 'SteelSatin', collar([-0.4, 0.76, 0], [1, 0, 0], 0.165, 0.03));
  // bolt ring on injector flange
  for (let b = 0; b < 24; b++) {
    const ph = (b / 24) * 2 * Math.PI;
    add('Powerhead', 'HotGasManifold', 'SteelSatin', cyl([0.338 * Math.cos(ph), 0.468, 0.338 * Math.sin(ph)], [0.338 * Math.cos(ph), 0.49, 0.338 * Math.sin(ph)], 0.009, 0.009, 6));
  }
}

// ---------------------------------------------------------------- turbopump bodies
function ribbedBody(rad, yBot, yTop, ribEvery, ribProt) {
  const prof = [[0, yBot]];
  // bottom dome (quarter ellipse)
  const domeH = rad * 0.55;
  for (let a = 1; a <= 7; a++) {
    const ph = (a / 7) * (Math.PI / 2);
    prof.push([rad * Math.sin(ph), yBot + domeH * (1 - Math.cos(ph))]);
  }
  let y = yBot + domeH + 0.06;
  prof.push([rad, y - 0.04]);
  while (y + ribEvery < yTop - 0.08) {
    prof.push([rad, y - 0.012], [rad + ribProt, y - 0.012], [rad + ribProt, y + 0.012], [rad, y + 0.012]);
    y += ribEvery;
  }
  prof.push([rad, yTop - 0.05], [rad + 0.03, yTop - 0.05], [rad + 0.03, yTop], [rad * 0.6, yTop]);
  return prof;
}
// HPFTP (fuel side, +x)
{
  const c = [0.56, 0, -0.02];
  add('HPFTP', 'HPFTP_Body', 'Steel', lathe(ribbedBody(0.2, -0.36, 0.6, 0.12, 0.024), 72, [c[0], 0, c[2]]));
  add('HPFTP', 'HPFTP_Body', 'SteelSatin', collar([c[0], -0.36, c[2]], UP, 0.07, 0.05));
  // fuel preburner dome above it
  const pb = [[0.19, 0.6], [0.215, 0.6], [0.215, 0.64], [0.19, 0.64], [0.19, 0.86], [0.21, 0.86], [0.21, 0.89], [0.17, 0.95], [0.1, 0.995], [0.0, 1.005]];
  add('HPFTP', 'FuelPreburner', 'Steel', lathe(pb, 72, [c[0], 0, c[2]]));
  for (let b = 0; b < 16; b++) {
    const ph = (b / 16) * 2 * Math.PI;
    add('HPFTP', 'FuelPreburner', 'SteelSatin', cyl([c[0] + 0.205 * Math.cos(ph), 0.885, c[2] + 0.205 * Math.sin(ph)], [c[0] + 0.205 * Math.cos(ph), 0.905, c[2] + 0.205 * Math.sin(ph)], 0.008, 0.008, 6));
  }
  // discharge stub
  add('HPFTP', 'HPFTP_Body', 'Steel', cyl([c[0] + 0.12, -0.1, c[2] - 0.1], [c[0] + 0.06, -0.1, c[2] - 0.22], 0.06, 0.06, 24));
}
// HPOTP (oxidizer side, -x)
{
  const c = [-0.52, 0, 0.0];
  add('HPOTP', 'HPOTP_Body', 'Steel', lathe(ribbedBody(0.17, -0.2, 0.6, 0.13, 0.022), 72, [c[0], 0, c[2]]));
  add('HPOTP', 'HPOTP_Body', 'SteelSatin', torus([c[0], -0.02, c[2]], UP, 0.18, 0.055, 14, 72)); // boost-pump volute
  add('HPOTP', 'HPOTP_Body', 'SteelSatin', collar([c[0], -0.2, c[2]], UP, 0.065, 0.05));
  const pb = [[0.15, 0.6], [0.175, 0.6], [0.175, 0.64], [0.15, 0.64], [0.15, 0.82], [0.17, 0.82], [0.17, 0.85], [0.13, 0.9], [0.07, 0.93], [0.0, 0.94]];
  add('HPOTP', 'OxidizerPreburner', 'Steel', lathe(pb, 72, [c[0], 0, c[2]]));
  add('HPOTP', 'HPOTP_Body', 'Steel', cyl([c[0] + 0.05, 0.1, c[2] - 0.12], [c[0] + 0.05, 0.1, c[2] - 0.2], 0.05, 0.05, 24));
}
// Low-pressure pumps: cup with open inlet, recessed inducer, volute
function lpPump(gname, child, pos, dir, R, L) {
  const h = L / 2;
  const prof = [[0, -h - 0.03], [R * 0.55, -h - 0.03], [R * 0.85, -h], [R, -h + 0.04], [R, h - 0.05], [R + 0.028, h - 0.05], [R + 0.028, h], [R - 0.022, h], [R - 0.022, h - 0.075], [0.0, h - 0.075]];
  add(gname, child, 'Steel', lathe(prof, 72, pos, dir));
  add(gname, child, 'SteelSatin', torus(toV(pos).addScaledVector(toV(dir).normalize(), -h + 0.09), dir, R + 0.005, 0.05, 14, 72));
  // inducer hub + 3 blades inside the inlet
  const hub = new THREE.CylinderGeometry(0.012, 0.04, 0.05, Q(24, 8));
  hub.translate(0, h - 0.05, 0);
  add(gname, child, 'SteelBright', orient(hub, dir, pos));
  for (let b = 0; b < 3; b++) {
    const bl = new THREE.BoxGeometry(R * 0.78, 0.006, 0.035);
    bl.translate(R * 0.39, 0, 0);
    bl.rotateX(0.5);
    bl.rotateY((b * 2 * Math.PI) / 3);
    bl.translate(0, h - 0.055, 0);
    add(gname, child, 'SteelBright', orient(bl, dir, pos));
  }
  for (let b = 0; b < 12; b++) {
    const ph = (b / 12) * 2 * Math.PI;
    const bt = new THREE.CylinderGeometry(0.007, 0.007, 0.018, 6);
    bt.translate((R + 0.014) * Math.cos(ph), h + 0.006, (R + 0.014) * Math.sin(ph));
    add(gname, child, 'SteelSatin', orient(bt, dir, pos));
  }
}
const LPF = { pos: v3(0.33, 1.03, 0.43), dir: v3(0.25, 1, 0.3).normalize(), R: 0.14, L: 0.32 };
const LPO = { pos: v3(-0.31, 1.0, 0.46), dir: v3(-0.22, 1, 0.38).normalize(), R: 0.15, L: 0.3 };
lpPump('LPFTP', 'LPFTP_Body', LPF.pos, LPF.dir, LPF.R, LPF.L);
lpPump('LPOTP', 'LPOTP_Body', LPO.pos, LPO.dir, LPO.R, LPO.L);
// mounting struts from LP pumps to powerhead
for (const [gname, P, tgt] of [['LPFTP', LPF, [0.2, 0.86, 0.22]], ['LPOTP', LPO, [-0.2, 0.84, 0.24]]]) {
  const base = P.pos.clone().addScaledVector(P.dir, -P.L / 2 + 0.02);
  add(gname, gname + '_Body', 'SteelSatin', cyl(base, tgt, 0.03, 0.03, 16));
}

// ---------------------------------------------------------------- Pogo accumulator
{
  const c = v3(-0.56, 0.24, 0.44);
  add('PogoAccumulator', 'PogoAccumulator', 'Steel', sphere(c, 0.135));
  add('PogoAccumulator', 'PogoAccumulator', 'SteelSatin', torus(c, UP, 0.135, 0.012, 8, 72));
  add('PogoAccumulator', 'PogoAccumulator', 'Steel', cyl(c.clone().add(v3(-0.1, 0, -0.06)), v3(-0.82, 0.24, 0.26), 0.04, 0.04, 20));
}

// ---------------------------------------------------------------- Ducts
const Fuel = (pts, r, o) => pipe(pts, r, o).forEach((g) => add('FuelDucts', o?.child || 'FuelDucts', 'SteelBright', g));
const Ox = (pts, r, o) => pipe(pts, r, o).forEach((g) => add('OxidizerDucts', o?.child || 'OxidizerDucts', 'SteelBright', g));
{
  // LPFTP discharge -> HPFTP inlet (big angular loop on the fuel side)
  const vol = LPF.pos.clone().addScaledVector(LPF.dir, -LPF.L / 2 + 0.09);
  Fuel([vol.clone().add(v3(0.12, -0.02, 0.1)), [0.74, 0.88, 0.58], [0.95, 0.62, 0.42], [0.97, 0.05, 0.22], [0.86, -0.42, 0.04], [0.56, -0.5, -0.02], [0.56, -0.4, -0.02]], 0.058, { fillet: 0.12, radial: 20, child: 'LPFTP_DischargeDuct' });
  // LPOTP discharge -> HPOTP inlet (oxidizer loop)
  const volO = LPO.pos.clone().addScaledVector(LPO.dir, -LPO.L / 2 + 0.09);
  Ox([volO.clone().add(v3(-0.12, -0.02, 0.1)), [-0.76, 0.86, 0.58], [-0.95, 0.55, 0.36], [-0.88, 0.05, 0.24], [-0.74, -0.32, 0.06], [-0.52, -0.33, 0.0], [-0.52, -0.24, 0.0]], 0.062, { fillet: 0.12, radial: 20, child: 'LPOTP_DischargeDuct' });
  // HPOTP discharge -> main oxidizer valve -> main injector (behind)
  Ox([[-0.47, 0.1, -0.2], [-0.45, 0.12, -0.44], [-0.14, 0.3, -0.5], [0.0, 0.52, -0.42], [0.0, 0.53, -0.33]], 0.046, { fillet: 0.1, radial: 18, child: 'MainOxidizerLine' });
  // HPFTP discharge -> main fuel valve -> steerhorn -> nozzle inlet manifold
  const yM = -0.31, rM = rOut(yM) + 0.045, phM = -58 * deg;
  Fuel([[0.62, -0.1, -0.24], [0.68, -0.14, -0.46], [0.45, -0.24, -0.6], [rM * Math.cos(phM) + 0.06, yM + 0.03, rM * Math.sin(phM) - 0.12], [rM * Math.cos(phM), yM + 0.01, rM * Math.sin(phM)]], 0.05, { fillet: 0.12, radial: 18, child: 'Steerhorn' });
  // MFV -> MCC coolant inlet
  Fuel([[0.66, -0.13, -0.42], [0.52, 0.08, -0.36], [0.33, 0.27, -0.22], [0.27, 0.3, -0.14]], 0.03, { fillet: 0.08, radial: 14, child: 'MCC_CoolantLine' });
  // MCC coolant discharge -> LPFTP turbine drive (front, up to the LP fuel pump)
  Fuel([[-0.06, 0.32, 0.31], [-0.08, 0.62, 0.42], [0.06, 0.86, 0.66], [0.24, 0.92, 0.6], [0.26, 0.96, 0.52]], 0.04, { fillet: 0.09, radial: 16, child: 'LPFTP_TurbineDrive' });
  // HPOTP boost discharge -> LPOTP turbine drive
  Ox([[-0.68, 0.2, -0.08], [-0.84, 0.55, 0.02], [-0.72, 0.98, 0.26], [-0.48, 1.06, 0.4]], 0.032, { fillet: 0.09, radial: 14, child: 'LPOTP_TurbineDrive' });
  // propellant inlet ducts from the vehicle (cut off, seen at the top of Fig. 10)
  const topF = LPF.pos.clone().addScaledVector(LPF.dir, LPF.L / 2 + 0.02);
  Fuel([topF.clone().add(v3(0.08, -0.06, -0.03)), topF.clone().add(v3(0.2, 0.02, -0.05)), [0.98, 1.24, 0.22]], 0.05, { fillet: 0.08, radial: 18, child: 'FuelInletDuct' });
  const topO = LPO.pos.clone().addScaledVector(LPO.dir, LPO.L / 2 + 0.02);
  Ox([topO.clone().add(v3(-0.09, -0.06, -0.03)), topO.clone().add(v3(-0.2, 0.03, -0.04)), [-0.95, 1.28, 0.28]], 0.055, { fillet: 0.08, radial: 18, child: 'OxidizerInletDuct' });
  // small plumbing (bleed, purge, pressurisation, sensor lines)
  const small = [
    [[0.16, 0.62, 0.3], [0.22, 0.3, 0.33], [0.3, -0.2, 0.33], [0.3, -0.27, 0.3]],
    [[-0.18, 0.62, 0.3], [-0.24, 0.25, 0.3], [-0.3, -0.22, 0.32], [-0.3, -0.27, 0.29]],
    [[-0.22, 0.56, -0.3], [-0.36, 0.05, -0.36], [-0.4, -0.27, -0.24]],
    [[0.32, 0.92, -0.18], [0.3, 1.0, -0.32], [0.0, 1.02, -0.38], [-0.3, 0.95, -0.3], [-0.42, 0.9, -0.12]],
    [[0.72, 0.4, 0.12], [0.86, 0.4, 0.05], [0.88, 0.0, -0.05], [0.72, -0.25, -0.08]],
    [[-0.66, 0.5, 0.1], [-0.76, 0.3, 0.12], [-0.74, -0.05, 0.12]],
    [[0.1, 0.99, 0.2], [0.16, 1.06, 0.3], [0.26, 1.02, 0.35]],
  ];
  small.forEach((pts, i) => pipe(pts, 0.014, { fillet: 0.05, radial: 8, flangeR: 1.5 }).forEach((g) => add(i % 2 ? 'OxidizerDucts' : 'FuelDucts', 'SmallLines', 'SteelBright', g)));
}

// ---------------------------------------------------------------- Valves
function valve(child, p, along, up, rBody = 0.07, len = 0.15) {
  p = toV(p); along = toV(along).normalize(); up = toV(up).normalize();
  add('Valves', child, 'SteelSatin', cyl(p.clone().addScaledVector(along, -len / 2), p.clone().addScaledVector(along, len / 2), rBody, rBody, 32));
  const a0 = p.clone().addScaledVector(up, rBody * 0.8), a1 = p.clone().addScaledVector(up, rBody + 0.1);
  add('Valves', child, 'Steel', cyl(a0, a1, 0.035, 0.035, 20));
  add('Valves', child, 'Steel', box(a1.clone().addScaledVector(up, 0.02), [0.07, 0.04, 0.07]));
}
valve('MainOxidizerValve', [-0.32, 0.2, -0.47], [0.75, 0.45, -0.15], [0, 0.4, -1]);
valve('MainFuelValve', [0.66, -0.13, -0.38], [0.15, -0.05, -1], [1, 0.2, 0]);
valve('ChamberCoolantValve', [0.46, 0.13, -0.33], [-0.6, 0.6, 0.4], [0.4, 0.2, -1], 0.045, 0.1);
valve('FuelPreburnerOxValve', [0.56, 1.0, -0.22], [1, 0, 0], [0, 0.3, -1], 0.045, 0.12);
valve('OxPreburnerOxValve', [-0.5, 0.95, -0.2], [1, 0, 0], [0, 0.3, -1], 0.04, 0.11);
add('Valves', 'FuelPreburnerOxValve', 'SteelBright', cyl([0.56, 1.0, -0.22], [0.56, 0.98, -0.1], 0.02, 0.02, 10));
add('Valves', 'OxPreburnerOxValve', 'SteelBright', cyl([-0.5, 0.95, -0.2], [-0.5, 0.92, -0.08], 0.02, 0.02, 10));

// ---------------------------------------------------------------- Gimbal bearing + thrust cone
{
  add('GimbalBearing', 'GimbalBearing', 'Steel', lathe([[0.25, 0.975], [0.255, 0.985], [0.13, 1.12], [0.0, 1.125]], 64));
  add('GimbalBearing', 'GimbalBearing', 'Steel', cyl([0, 1.11, 0], [0, 1.2, 0], 0.11, 0.11, 48));
  add('GimbalBearing', 'GimbalBearing', 'SteelSatin', torus([0, 1.17, 0], [1, 0, 0], 0.11, 0.022, 10, 64));
  add('GimbalBearing', 'GimbalBearing', 'Steel', cyl([0, 1.2, 0], [0, 1.27, 0], 0.21, 0.21, 64));
  for (let b = 0; b < 12; b++) {
    const ph = (b / 12) * 2 * Math.PI;
    add('GimbalBearing', 'GimbalBearing', 'SteelSatin', cyl([0.18 * Math.cos(ph), 1.265, 0.18 * Math.sin(ph)], [0.18 * Math.cos(ph), 1.285, 0.18 * Math.sin(ph)], 0.012, 0.012, 6));
  }
  // actuator attach lugs
  add('GimbalBearing', 'GimbalBearing', 'SteelSatin', box([0.2, 1.05, -0.12], [0.08, 0.1, 0.05], 0.6));
  add('GimbalBearing', 'GimbalBearing', 'SteelSatin', box([-0.12, 1.05, -0.2], [0.08, 0.1, 0.05], -0.6));
}

// ---------------------------------------------------------------- Engine controller
{
  const yaw = Math.atan2(0.5, 0.42); // face outward toward +x/+z
  const c = v3(0.5, 0.12, 0.43);
  add('EngineController', 'EngineController', 'Controller', box(c, [0.3, 0.24, 0.1], yaw));
  for (let f = -3; f <= 3; f++) {
    const off = v3(f * 0.04, 0, 0.065).applyAxisAngle(UP, yaw);
    add('EngineController', 'EngineController', 'Controller', box(c.clone().add(off), [0.008, 0.2, 0.03], yaw));
  }
  for (const s of [-1, 1]) {
    const off = v3(s * 0.09, 0.14, 0).applyAxisAngle(UP, yaw);
    add('EngineController', 'EngineController', 'SteelSatin', cyl(c.clone().add(off).add(v3(0, -0.02, 0)), c.clone().add(off).add(v3(0, 0.04, 0)), 0.022, 0.022, 16));
  }
  // bracket back to the MCC
  add('EngineController', 'EngineController', 'SteelSatin', cyl(c.clone().add(v3(-0.08, 0, -0.07)), [0.24, 0.12, 0.2], 0.018, 0.018, 10));
}

// ================================================================= hotspots (metres) and explode directions
const hot = {
  Nozzle: [rOut(-1.7) * Math.cos(55 * deg) + 0.02, -1.7, rOut(-1.7) * Math.sin(55 * deg) + 0.02],
  MainCombustionChamber: [0.1, 0.05, 0.27],
  Powerhead: [0.05, 0.72, 0.37],
  HPFTP: [0.76, 0.2, 0.05],
  HPOTP: [-0.69, 0.3, 0.0],
  LPFTP: [0.42, 1.18, 0.57],
  LPOTP: [-0.42, 1.14, 0.6],
  PogoAccumulator: [-0.6, 0.28, 0.57],
  FuelDucts: [0.97, 0.35, 0.33],
  OxidizerDucts: [-0.93, 0.35, 0.32],
  Valves: [0.7, -0.08, -0.4],
  GimbalBearing: [0, 1.27, 0],
  EngineController: [0.55, 0.12, 0.49],
};
const explodeDir = {
  Nozzle: [0, -1, 0],
  MainCombustionChamber: [0, -0.35, 0],
  Powerhead: [0, 0, 0],
  HPFTP: [1, -0.1, 0],
  HPOTP: [-1, -0.1, 0],
  LPFTP: [0.45, 0.7, 0.55],
  LPOTP: [-0.45, 0.7, 0.55],
  PogoAccumulator: [-0.6, 0, 0.8],
  FuelDucts: [0.8, 0, 0.6],
  OxidizerDucts: [-0.8, 0, 0.6],
  Valves: [0, 0, -1],
  GimbalBearing: [0, 1, 0],
  EngineController: [0.6, 0, 0.8],
};

// ================================================================= assemble glTF
const box3 = new THREE.Box3();
const merged = new Map();
for (const [gname, g] of groups) {
  const gb = new THREE.Box3();
  const children = new Map();
  for (const [child, mats] of g.children) {
    const m2 = new Map();
    for (const [mat, list] of mats) {
      const geo = mergeGeometries(list, false);
      if (!geo) throw new Error('merge failed ' + gname + '/' + child + '/' + mat);
      geo.computeBoundingBox();
      gb.union(geo.boundingBox);
      m2.set(mat, geo);
    }
    children.set(child, m2);
  }
  box3.union(gb);
  merged.set(gname, { g, gb, children });
}
const size = box3.getSize(new THREE.Vector3());
const C = box3.getCenter(new THREE.Vector3());
const S = 2 / Math.max(size.x, size.y, size.z);
console.log('raw size (m)', size.toArray().map((x) => x.toFixed(3)), 'center', C.toArray().map((x) => x.toFixed(3)), 'scale', S.toFixed(5));

const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hex = (h) => [1, 3, 5].map((i) => srgb2lin(parseInt(h.slice(i, i + 2), 16) / 255));
const MATS = {
  Steel: { c: '#b9bcc2', m: 0.85, r: 0.35 },
  SteelSatin: { c: '#a3a7ae', m: 0.85, r: 0.42 },
  SteelBright: { c: '#cdd0d5', m: 0.9, r: 0.26 },
  NozzleInterior: { c: '#4a4c51', m: 0.7, r: 0.55, ds: true },
  Controller: { c: '#7c7f86', m: 0.6, r: 0.5 },
};
const doc = new Document();
doc.getRoot().getAsset().generator = 'Project AKS build-rs25.mjs (procedural, three.js geometry + glTF-Transform)';
const buffer = doc.createBuffer();
const matObj = {};
for (const [k, v] of Object.entries(MATS)) matObj[k] = doc.createMaterial(k).setBaseColorFactor([...hex(v.c), 1]).setMetallicFactor(v.m).setRoughnessFactor(v.r).setDoubleSided(!!v.ds);
const scene = doc.createScene('RS25');
const rootNode = doc.createNode('RS25').setExtras({
  title: 'RS-25 / Space Shuttle Main Engine (procedural reconstruction)',
  source: 'Original procedural model generated for Project AKS; modelled after the RS-25 renders in the paper (Fig. 10/11) and public NASA RS-25 data. No third-party mesh data.',
  license: 'CC0-1.0',
  units: 'normalised: longest dimension = 2 units (real engine ~4.27 m)',
  metresPerUnit: +(1 / S).toFixed(5),
});
scene.addChild(rootNode);
let triTotal = 0;
const hotspotsOut = [];
for (const [gname, { g, gb, children }] of merged) {
  const c = gb.getCenter(new THREE.Vector3());
  const t = c.clone().sub(C).multiplyScalar(S);
  const ed = new THREE.Vector3(...(explodeDir[gname] || [0, 0, 0]));
  if (ed.lengthSq() > 0) ed.normalize();
  const hp = hot[gname] ? toV(hot[gname]).sub(C).multiplyScalar(S) : null;
  const gnode = doc.createNode(gname).setTranslation(t.toArray()).setExtras({
    label: g.label,
    description: g.description,
    explodeDir: ed.toArray().map((x) => +x.toFixed(4)),
    hotspot: hp ? hp.toArray().map((x) => +x.toFixed(4)) : null,
  });
  rootNode.addChild(gnode);
  if (hp) hotspotsOut.push({ node: gname, label: g.label, description: g.description, position: hp.toArray().map((x) => +x.toFixed(4)), explodeDir: ed.toArray().map((x) => +x.toFixed(4)) });
  for (const [child, mats] of children) {
    const mesh = doc.createMesh(child);
    for (const [mat, geo] of mats) {
      const pos = geo.attributes.position.array;
      const out = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        out[i] = (pos[i] - c.x) * S;
        out[i + 1] = (pos[i + 1] - c.y) * S;
        out[i + 2] = (pos[i + 2] - c.z) * S;
      }
      const nrm = new Float32Array(geo.attributes.normal.array);
      for (let i = 0; i < nrm.length; i += 3) {
        const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
        nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
        if (!Number.isFinite(nrm[i])) { nrm[i] = 0; nrm[i + 1] = 1; nrm[i + 2] = 0; }
      }
      const ia = geo.index.array;
      const vcount = out.length / 3;
      const indices = vcount > 65535 ? new Uint32Array(ia) : new Uint16Array(ia);
      triTotal += indices.length / 3;
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(out).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
        .setMaterial(matObj[mat]);
      mesh.addPrimitive(prim);
    }
    gnode.addChild(doc.createNode(child).setMesh(mesh));
  }
}
console.log('triangles', triTotal);
await MeshoptEncoder.ready;
await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await io.write(OUT, doc);
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
if (HOTSPOT_OUT) fs.writeFileSync(HOTSPOT_OUT, JSON.stringify({ metresPerUnit: 1 / S, hotspots: hotspotsOut }, null, 2));
