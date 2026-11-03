import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Realistic rockoon after Figure 2 of the paper: a zero-pressure polyethylene hydrogen balloon, an
// inline recovery parachute and load line, heavy-load bridle lines, and the rocket held upright in an
// open launch gondola. Rocket details from the text: SS 301 airframe with a polyurethane coat, a
// 5-6 kg payload chamber with cameras at three angles, SS 316 grid fins, composite carbon-fibre fins,
// an aerospike nozzle, barometric altimeter and GPS.

const R = 0.13; // body radius
const AFT = -1.38; // bottom of the aft skirt
const BODY_TOP = 0.86; // start of the nose cone
const NOSE_TIP = 1.62;
const FRAME_W = 0.5; // half width of the gondola
const FRAME_BOT = -1.56;
const FRAME_TOP = 0.56;
const BRIDLE_Y = 2.15;
const CHUTE_BOT = 2.62;
const CHUTE_TOP = 3.95;
const BALLOON_BASE = 4.62;
const FLOAT_H = 6.0;
const FLOAT_R = 3.1;
const LAUNCH_H = 9.6;

const rand = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Body livery: white polyurethane coat, rivet rows, roll-pattern quadrants, lettering and a flag.
function bodyTexture() {
  const len = BODY_TOP - AFT;
  const W = 1024;
  const H = Math.round((W * len) / (2 * Math.PI * R) / 16) * 16;
  const yToPx = (y) => H - ((y - AFT) / len) * H;
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#d6d9dd';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '150,155,160'},${0.02 + rand() * 0.03})`;
      g.fillRect(rand() * W, rand() * H, 2 + rand() * 40, 1 + rand() * 3);
    }
    for (const y of [-1.3, -0.84, 0.36, 0.58, 0.84]) {
      for (const d of [-9, 9]) {
        const py = yToPx(y) + d;
        if (py < 0 || py > H) continue;
        for (let x = 6; x < W; x += 17) {
          g.fillStyle = 'rgba(120,124,130,0.85)';
          g.beginPath(); g.arc(x, py, 2.1, 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.7)';
          g.beginPath(); g.arc(x - 0.6, py - 0.6, 0.9, 0, Math.PI * 2); g.fill();
        }
      }
    }
    g.fillStyle = 'rgba(140,145,150,0.35)';
    g.fillRect(W / 2 - 1, yToPx(0.36), 2, yToPx(-0.84) - yToPx(0.36));
    const pTop = yToPx(BODY_TOP);
    const pBot = yToPx(0.58);
    for (let q = 0; q < 4; q++) {
      g.fillStyle = q % 2 ? '#0d0f12' : '#d6d9dd';
      g.fillRect((q * W) / 4, pTop, W / 4, pBot - pTop);
    }
    g.fillStyle = '#0d0f12';
    g.fillRect(0, yToPx(-0.7), W, 10);
    g.fillRect(0, yToPx(-0.66), W, 4);
    // lettering, written twice so it wraps across the seam at u = 0 (which faces +Z)
    const drawText = (cx) => {
      g.save();
      g.translate(cx, yToPx(-0.1));
      g.rotate(-Math.PI / 2);
      g.fillStyle = '#0d0f12';
      g.font = '700 74px Orbitron, "Arial Black", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('PROJECT AKS', 0, 0);
      g.font = '400 30px Orbitron, Arial, sans-serif';
      g.fillText('CHIREC · HYDERABAD', 0, 62);
      g.restore();
      const fx = cx - 46;
      const fy = yToPx(0.3);
      const fw = 92, fh = 62;
      g.fillStyle = '#ff9933'; g.fillRect(fx, fy, fw, fh / 3);
      g.fillStyle = '#ffffff'; g.fillRect(fx, fy + fh / 3, fw, fh / 3);
      g.fillStyle = '#138808'; g.fillRect(fx, fy + (2 * fh) / 3, fw, fh / 3);
      g.strokeStyle = '#000080'; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, fy + fh / 2, 8, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.strokeRect(fx, fy, fw, fh);
    };
    drawText(0);
    drawText(W);
  });
}

function twillTexture() {
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = '#16181b';
    g.fillRect(0, 0, 256, 256);
    const s = 16;
    for (let y = 0; y < 256; y += s) {
      for (let x = 0; x < 256; x += s) {
        const k = ((x / s) + (y / s)) % 4 < 2;
        const grd = k ? g.createLinearGradient(x, y, x + s, y) : g.createLinearGradient(x, y, x, y + s);
        grd.addColorStop(0, k ? '#25282d' : '#111316');
        grd.addColorStop(0.5, k ? '#33373d' : '#1b1e22');
        grd.addColorStop(1, k ? '#1f2226' : '#0f1113');
        g.fillStyle = grd;
        g.fillRect(x + 0.5, y + 0.5, s - 1, s - 1);
      }
    }
  });
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  return t;
}

// Balloon film: 24 gores with load tapes, film creases and slight sheen variation.
function filmTexture() {
  return canvasTex(2048, 1024, (g, W, H) => {
    g.fillStyle = '#e8ecef';
    g.fillRect(0, 0, W, H);
    const gores = 24;
    for (let i = 0; i < gores; i++) {
      const x0 = (i / gores) * W;
      const gw = W / gores;
      g.fillStyle = `rgba(${200 + Math.floor(rand() * 40)},${205 + Math.floor(rand() * 40)},${210 + Math.floor(rand() * 40)},0.35)`;
      g.fillRect(x0, 0, gw, H);
      for (let k = 0; k < 7; k++) {
        const cx = x0 + rand() * gw;
        g.fillStyle = `rgba(255,255,255,${0.06 + rand() * 0.1})`;
        g.fillRect(cx, 0, 1 + rand() * 3, H);
        g.fillStyle = `rgba(120,130,140,${0.05 + rand() * 0.08})`;
        g.fillRect(cx + 3, 0, 1, H);
      }
      g.fillStyle = 'rgba(250,250,245,0.95)';
      g.fillRect(x0 - 3, 0, 6, H);
      g.fillStyle = 'rgba(150,150,140,0.35)';
      g.fillRect(x0 + 3, 0, 1.5, H);
    }
  });
}

function fabricTexture() {
  return canvasTex(512, 512, (g, W, H) => {
    const cols = ['#e8642a', '#f2f2ef'];
    for (let i = 0; i < 12; i++) {
      g.fillStyle = cols[i % 2];
      g.fillRect((i / 12) * W, 0, W / 12 + 1, H);
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.08})`;
      g.fillRect(rand() * W, 0, 1 + rand() * 3, H);
    }
  });
}

// ---------------------------------------------------------------- geometry helpers
function lathe(points, seg = 64) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0005), y)), seg);
}
function tube(a, b, r, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
function lineGeo(points, r = 0.005) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.1);
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 12), r, 5, false);
}

// Balloon profiles share one topology, so the launch shape is a morph target of the float shape.
const B_SEG = 72;
const B_PTS = 80;
function balloonProfile(kind) {
  const pts = [];
  for (let i = 0; i <= B_PTS; i++) {
    const t = i / B_PTS;
    let r, y;
    if (kind === 'float') {
      y = t * FLOAT_H;
      if (t < 0.64) r = FLOAT_R * Math.pow(Math.sin((Math.PI / 2) * (t / 0.64)), 0.82);
      else r = FLOAT_R * Math.pow(Math.cos((Math.PI / 2) * ((t - 0.64) / 0.36)), 0.5);
    } else {
      y = t * LAUNCH_H;
      const split = 0.74;
      if (t < split) r = 0.1 + 0.26 * Math.pow(t / split, 1.4);
      else {
        const u = (t - split) / (1 - split);
        r = 1.45 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.5 + 0.5)), 0.5) * Math.min(1, u * 3 + 0.35);
      }
    }
    pts.push([r, y]);
  }
  pts[B_PTS][0] = 0.0005;
  return pts;
}

function balloonGeometry() {
  const float = lathe(balloonProfile('float'), B_SEG);
  const launch = lathe(balloonProfile('launch'), B_SEG);
  const p = launch.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = v.y / LAUNCH_H;
    if (t < 0.8) {
      const phi = Math.atan2(v.x, v.z);
      const fold = 1 + 0.32 * Math.sin(phi * 9 + t * 6) * (1 - t / 0.8) + 0.12 * Math.sin(phi * 23 + t * 17);
      v.x *= fold; v.z *= fold;
      p.setXYZ(i, v.x, v.y, v.z);
    }
  }
  launch.computeVertexNormals();
  float.computeVertexNormals();
  float.morphAttributes.position = [launch.attributes.position];
  float.morphAttributes.normal = [launch.attributes.normal];
  return float;
}

function gridFin() {
  const parts = [];
  const w = 0.11, h = 0.1, t = 0.005, d = 0.018;
  const bar = (sx, sy, x, y) => { const g = new THREE.BoxGeometry(sx, sy, d); g.translate(x, y, 0); parts.push(g); };
  bar(w, t, 0, h / 2); bar(w, t, 0, -h / 2); bar(t, h, w / 2, 0); bar(t, h, -w / 2, 0);
  for (let i = 1; i < 6; i++) bar(t * 0.5, h, -w / 2 + (i * w) / 6, 0);
  for (let i = 1; i < 5; i++) bar(w, t * 0.5, 0, -h / 2 + (i * h) / 5);
  const arm = new THREE.BoxGeometry(0.012, 0.03, 0.012); arm.translate(0, -h / 2 - 0.015, 0); parts.push(arm);
  return mergeGeometries(parts);
}

function finGeometry() {
  const span = 0.24;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0, 0.5);
  s.lineTo(span, 0.24);
  s.lineTo(span, 0.07);
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 2 });
  g.translate(0, 0, -0.007);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 2, p.getY(i) * 2);
  return g;
}

// ---------------------------------------------------------------- plume
function createPlume() {
  const uniforms = { uTime: { value: 0 }, uI: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uI; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float y = 1.0 - vUv.y;
        float x = (vUv.x - 0.5) * 2.0;
        float width = mix(0.14, 1.0, pow(y, 0.55));
        float n = noise(vec2(x * 4.0, y * 9.0 - uTime * 11.0)) * 0.55 + noise(vec2(x * 9.0, y * 21.0 - uTime * 23.0)) * 0.45;
        float core = exp(-pow(x / (width * 0.32), 2.0));
        float body = exp(-pow(x / width, 2.0));
        float len = smoothstep(0.0, 0.03, y) * pow(1.0 - y, 1.6);
        float diamonds = mix(1.0, 0.55 + 0.45 * cos(y * 60.0), smoothstep(0.02, 0.06, y) * (1.0 - smoothstep(0.18, 0.32, y)));
        // hypergolic UDMH / N2O4: hot pale core, thin orange-pink body, reddish-brown NO2 tail
        vec3 hot = vec3(1.0, 0.93, 0.84);
        vec3 mid = vec3(1.0, 0.58, 0.38);
        vec3 tail = vec3(0.55, 0.22, 0.14);
        vec3 col = mix(hot, mid, smoothstep(0.0, 0.25, y));
        col = mix(col, tail, smoothstep(0.25, 1.0, y));
        float a = (core * 1.3 + body * 0.35) * len * (0.6 + n * 0.6) * diamonds * uI;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.5, 2.8, 1, 1);
  geo.translate(0, -1.4, 0);
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(geo, mat);
    p.rotation.y = (i * Math.PI) / 3;
    p.frustumCulled = false;
    group.add(p);
  }
  const glareMat = new THREE.SpriteMaterial({ color: 0xffd2a8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false });
  glareMat.map = canvasTex(128, 128, (g) => {
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.2, 'rgba(255,210,170,0.55)'); rg.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  });
  const glare = new THREE.Sprite(glareMat);
  glare.scale.set(0.9, 0.9, 1);
  glare.position.y = -0.08;
  group.add(glare);
  return { group, uniforms, glare };
}

// ---------------------------------------------------------------- balloon burst: film shreds
function createShreds(material) {
  const COUNT = 140;
  const geo = new THREE.PlaneGeometry(0.11, 0.75, 1, 8);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setZ(i, Math.sin(y * 4.2) * 0.06 + Math.sin(y * 9.0) * 0.015);
    p.setX(i, p.getX(i) * (0.55 + 0.45 * Math.cos(y * 2.3)));
  }
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, material, COUNT);
  mesh.frustumCulled = false;
  const seeds = [];
  for (let i = 0; i < COUNT; i++) {
    const theta = rand() * Math.PI * 2;
    const t = 0.25 + rand() * 0.7;
    const r = FLOAT_R * Math.sin(Math.PI * t) * 0.95;
    const y = BALLOON_BASE + t * FLOAT_H;
    const dir = new THREE.Vector3(Math.sin(theta), (t - 0.5) * 0.8, Math.cos(theta)).normalize();
    seeds.push({ p0: new THREE.Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r), dir, speed: 0.6 + rand() * 1.4, spin: new THREE.Vector3(rand() * 4 - 2, rand() * 6 - 3, rand() * 4 - 2), flutter: rand() * 6.28, size: 0.6 + rand() * 1.1 });
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), s = new THREE.Vector3();
  return {
    mesh,
    update(b, time) {
      mesh.visible = b > 0.001 && b < 0.995;
      if (!mesh.visible) return;
      for (let i = 0; i < COUNT; i++) {
        const sd = seeds[i];
        pos.copy(sd.p0).addScaledVector(sd.dir, b * 3.2 * sd.speed);
        pos.y -= b * b * 9.0 * (0.6 + sd.speed * 0.3);
        pos.x += Math.sin(time * 1.3 + sd.flutter) * 0.15 * b;
        e.set(sd.spin.x * b * 2 + Math.sin(time * 2 + sd.flutter) * 0.4 * b, sd.spin.y * b * 2, sd.spin.z * b * 2);
        q.setFromEuler(e);
        s.setScalar(sd.size);
        m4.compose(pos, q, s);
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- the rockoon
export function createRockoon() {
  const root = new THREE.Group();
  root.name = 'rockoon';

  const paint = new THREE.MeshPhysicalMaterial({ map: bodyTexture(), roughness: 0.5, metalness: 0.0, clearcoat: 0.3, clearcoatRoughness: 0.3, envMapIntensity: 0.7 });
  const nosePaint = new THREE.MeshPhysicalMaterial({ color: 0xd6d9dd, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.3, envMapIntensity: 0.7 });
  const stainless = new THREE.MeshPhysicalMaterial({ color: 0xb9bdc3, metalness: 1, roughness: 0.24, anisotropy: 0.6 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x5c6168, metalness: 0.9, roughness: 0.42 });
  const carbon = new THREE.MeshPhysicalMaterial({ map: twillTexture(), roughness: 0.32, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x2c2c2f, metalness: 0.25, roughness: 0.68 });
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x06080b, metalness: 0.1, roughness: 0.04, clearcoat: 1 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xa9adb3, metalness: 0.92, roughness: 0.38 });
  const foam = new THREE.MeshStandardMaterial({ color: 0xe6e6e1, roughness: 0.9, metalness: 0 });
  const line = new THREE.MeshStandardMaterial({ color: 0xd9d9d3, roughness: 0.8, metalness: 0, transparent: true });
  const film = new THREE.MeshPhysicalMaterial({
    map: filmTexture(), color: 0xf4f6f8, roughness: 0.3, metalness: 0, clearcoat: 0.65, clearcoatRoughness: 0.18,
    iridescence: 0.55, iridescenceIOR: 1.3, iridescenceThicknessRange: [180, 520], sheen: 0.35, sheenColor: new THREE.Color(0xdde8ff), sheenRoughness: 0.4,
    transparent: true, opacity: 0.9, side: THREE.FrontSide,
  });
  const shredMat = film.clone();
  shredMat.side = THREE.DoubleSide;
  shredMat.opacity = 0.7;
  const fabric = new THREE.MeshPhysicalMaterial({ map: fabricTexture(), roughness: 0.85, sheen: 0.5, sheenColor: new THREE.Color(0xffffff), transparent: true });

  // ---------------- rocket
  const rocket = new THREE.Group();
  rocket.name = 'rocket';
  root.add(rocket);

  const bodyPts = [];
  for (let i = 0; i <= 80; i++) {
    const y = AFT + (i / 80) * (BODY_TOP - AFT);
    const r = y < AFT + 0.09 ? R - 0.012 * (1 - (y - AFT) / 0.09) : R;
    bodyPts.push([r, y]);
  }
  rocket.add(new THREE.Mesh(lathe(bodyPts, 96), paint));
  const cap = new THREE.Mesh(new THREE.CircleGeometry(R - 0.012, 48), darkSteel);
  cap.rotation.x = Math.PI / 2; cap.position.y = AFT;
  rocket.add(cap);

  // von Karman nose
  const L = NOSE_TIP - BODY_TOP;
  const nosePts = [];
  for (let i = 0; i <= 40; i++) {
    const x = (i / 40) * L;
    const th = Math.acos(1 - (2 * x) / L);
    const r = (R / Math.sqrt(Math.PI)) * Math.sqrt(th - Math.sin(2 * th) / 2);
    nosePts.push([r, NOSE_TIP - x]);
  }
  nosePts.reverse();
  rocket.add(new THREE.Mesh(lathe(nosePts, 96), nosePaint));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), stainless);
  tip.position.y = NOSE_TIP;
  rocket.add(tip);

  for (const y of [-1.3, -0.84, 0.36, 0.58, 0.84]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.002, R + 0.002, 0.022, 96, 1, true), stainless);
    band.position.y = y;
    rocket.add(band);
  }

  // three flush camera windows on the payload chamber
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.35;
    const win = new THREE.Group();
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 24), darkSteel);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 24), lens);
    bezel.rotation.x = glass.rotation.x = Math.PI / 2;
    win.add(bezel, glass);
    win.position.set(Math.sin(a) * R, 0.72, Math.cos(a) * R);
    win.rotation.y = a;
    rocket.add(win);
  }
  // GPS patch antennas on the avionics band
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.006), darkSteel);
    patch.position.set(Math.sin(a) * (R + 0.002), 0.47, Math.cos(a) * (R + 0.002));
    patch.rotation.y = a;
    rocket.add(patch);
  }

  // SS 316 grid fins, stowed
  const gf = gridFin();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const f = new THREE.Mesh(gf, stainless);
    f.position.set(Math.sin(a) * (R + 0.012), 0.26, Math.cos(a) * (R + 0.012));
    f.rotation.y = a;
    f.rotation.x = -0.08;
    rocket.add(f);
  }

  // carbon fins at 45 degrees (clear of the gondola faces)
  const finGeo = finGeometry();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const f = new THREE.Mesh(finGeo, carbon);
    f.position.set(Math.sin(a) * (R - 0.004), AFT + 0.04, Math.cos(a) * (R - 0.004));
    f.rotation.y = a - Math.PI / 2;
    rocket.add(f);
  }

  // launch lugs on the rail side (-X)
  for (const y of [-0.9, 0.1]) {
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), darkSteel);
    lug.position.set(-R - 0.012, y, 0);
    rocket.add(lug);
  }

  // aerospike: annular combustor + truncated graphite spike
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.022, 16, 48), graphite);
  ring.rotation.x = Math.PI / 2; ring.position.y = AFT - 0.012;
  rocket.add(ring);
  rocket.add(new THREE.Mesh(lathe([[0, AFT], [0.084, AFT - 0.002], [0.07, AFT - 0.06], [0.05, AFT - 0.13], [0.034, AFT - 0.19], [0.026, AFT - 0.22], [0, AFT - 0.225]], 48), graphite));

  const plume = createPlume();
  plume.group.position.y = AFT - 0.2;
  rocket.add(plume.group);
  const engineLight = new THREE.PointLight(0xffa070, 0, 6, 1.6);
  engineLight.position.y = AFT - 0.4;
  rocket.add(engineLight);

  // ---------------- flight train: gondola, bridles, load line, parachute
  const train = new THREE.Group();
  train.name = 'train';
  root.add(train);
  const corners = [[-FRAME_W, -FRAME_W], [FRAME_W, -FRAME_W], [FRAME_W, FRAME_W], [-FRAME_W, FRAME_W]];
  {
    const parts = [];
    for (const [x, z] of corners) parts.push(tube(new THREE.Vector3(x, FRAME_BOT, z), new THREE.Vector3(x, FRAME_TOP, z), 0.012));
    const levels = [FRAME_BOT, -0.5, FRAME_TOP];
    for (const y of levels) {
      for (let i = 0; i < 4; i++) {
        const [x1, z1] = corners[i]; const [x2, z2] = corners[(i + 1) % 4];
        parts.push(tube(new THREE.Vector3(x1, y, z1), new THREE.Vector3(x2, y, z2), 0.01));
      }
    }
    for (let l = 0; l < 2; l++) {
      for (let i = 0; i < 4; i++) {
        const [x1, z1] = corners[i]; const [x2, z2] = corners[(i + 1) % 4];
        parts.push(tube(new THREE.Vector3(x1, levels[l], z1), new THREE.Vector3(x2, levels[l + 1], z2), 0.006));
        parts.push(tube(new THREE.Vector3(x2, levels[l], z2), new THREE.Vector3(x1, levels[l + 1], z1), 0.006));
      }
    }
    const railX = -R - 0.035;
    const railGeo = new THREE.BoxGeometry(0.02, FRAME_TOP - FRAME_BOT + 0.2, 0.03);
    railGeo.translate(railX, (FRAME_TOP + FRAME_BOT) / 2 + 0.05, 0);
    parts.push(railGeo);
    for (const y of [FRAME_BOT + 0.1, -0.5, FRAME_TOP - 0.05]) parts.push(tube(new THREE.Vector3(railX, y, 0), new THREE.Vector3(-FRAME_W, y, 0), 0.008));
    train.add(new THREE.Mesh(mergeGeometries(parts), alu));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.42), foam);
    box.position.set(0.12, FRAME_BOT - 0.1, 0.02);
    train.add(box);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.32, 6), darkSteel);
    antenna.position.set(0.32, FRAME_BOT - 0.32, 0.18);
    train.add(antenna);
    const blast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 32), darkSteel);
    blast.position.set(0, FRAME_BOT + 0.02, 0);
    train.add(blast);
  }
  const bridleTop = new THREE.Vector3(0, BRIDLE_Y, 0);
  const lines = [];
  for (const [x, z] of corners) {
    const a = new THREE.Vector3(x, FRAME_TOP, z);
    lines.push(lineGeo([a, a.clone().lerp(bridleTop, 0.5), bridleTop], 0.004));
  }
  lines.push(lineGeo([bridleTop, new THREE.Vector3(0, CHUTE_BOT, 0)], 0.005));
  lines.push(lineGeo([new THREE.Vector3(0, CHUTE_TOP, 0), new THREE.Vector3(0.01, (CHUTE_TOP + BALLOON_BASE) / 2, 0), new THREE.Vector3(0, BALLOON_BASE, 0)], 0.005));
  train.add(new THREE.Mesh(mergeGeometries(lines), line));
  const swivel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 16), darkSteel);
  swivel.position.y = BRIDLE_Y + 0.08;
  train.add(swivel);
  const cutdown = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.05), foam);
  cutdown.position.y = BRIDLE_Y + 0.26;
  train.add(cutdown);
  // inline recovery parachute, collapsed in the flight train
  const chutePts = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    chutePts.push([0.015 + 0.17 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.7) * (0.55 + 0.45 * t), CHUTE_BOT + t * (CHUTE_TOP - CHUTE_BOT)]);
  }
  const chuteGeo = lathe(chutePts, 40);
  {
    const p = chuteGeo.attributes.position; const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const phi = Math.atan2(v.x, v.z);
      const k = 1 + 0.18 * Math.sin(phi * 12) + 0.06 * Math.sin(phi * 31 + v.y * 9);
      p.setXYZ(i, v.x * k, v.y, v.z * k);
    }
    chuteGeo.computeVertexNormals();
  }
  train.add(new THREE.Mesh(chuteGeo, fabric));

  // ---------------- balloon
  const balloon = new THREE.Group();
  balloon.name = 'balloon';
  root.add(balloon);
  const envelope = new THREE.Mesh(balloonGeometry(), film);
  envelope.position.y = BALLOON_BASE;
  envelope.morphTargetInfluences = [0];
  balloon.add(envelope);
  const baseFitting = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.12, 24), stainless);
  baseFitting.position.y = BALLOON_BASE - 0.02;
  balloon.add(baseFitting);
  const apex = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 24), stainless);
  balloon.add(apex);

  const shreds = createShreds(shredMat);
  root.add(shreds.mesh);

  const hotspots = [
    { id: 'balloon', label: 'Hydrogen balloon', kicker: 'FIGURE 2 · SECTION 4.1', pos: new THREE.Vector3(2.2, BALLOON_BASE + 3.4, 1.7), text: 'A zero-pressure research balloon of thin polyethylene film, filled with hydrogen, the lightest lift gas. It launches part-inflated and swells as the air thins. The proposal calculated 258.42 kg of hydrogen to lift the 301.27 kg rocket to about 30 km, where the balloon bursts.' },
    { id: 'chute', label: 'Recovery parachute', kicker: 'SECTION 10', pos: new THREE.Vector3(0.18, 3.3, 0.12), text: 'The team planned to predict where the rocket and parachute would come down using thrust-to-weight formulae and GPS, so the hardware could be recovered and reused.' },
    { id: 'string', label: 'Heavy-load string', kicker: 'FIGURE 2 · SECTION 14', pos: new THREE.Vector3(0.24, 1.42, 0.24), text: 'Heavy-load lines tie the rocket beneath the balloon. The bill of materials lists carbon-fibre string and high-grade nylon string.' },
    { id: 'gondola', label: 'Launch gondola', kicker: 'INTERPRETATION', pos: new THREE.Vector3(FRAME_W, -0.5, FRAME_W), text: 'The sketch ties the strings straight to the fins. Here the rocket rides in an open truss frame with a launch rail, the way balloon-launched rockets have flown since the rockoons of the 1950s.' },
    { id: 'avionics', label: 'Altimeter + GPS', kicker: 'SECTIONS 4.2 · 14', pos: new THREE.Vector3(0.3, FRAME_BOT - 0.1, 0.24), text: 'A barometric altimeter detects about 29 km and triggers the showerhead injectors. The bill of materials lists four GPS units.' },
    { id: 'rocket', label: 'Rocket', kicker: 'FIGURE 2', pos: new THREE.Vector3(R * 0.72, -0.25, R * 0.72), text: 'A reusable hypergolic sounding rocket: 150 kg of structure and 151.27 kg of UDMH and N₂O₄. The airframe is SS 301 stainless steel with a polyurethane coat against heating.' },
    { id: 'payload', label: 'Payload chamber', kicker: 'SECTION 4.3', pos: new THREE.Vector3(0, 0.74, R + 0.02), text: 'A 5–6 kg chamber at the top of the rocket for equipment the school would like to send to space, with cameras fitted at three different angles to film the launch.' },
    { id: 'gridfin', label: 'Grid fins · SS 316', kicker: 'SECTION 14', pos: new THREE.Vector3(Math.sin(Math.PI / 4) * 0.2, 0.28, Math.cos(Math.PI / 4) * 0.2), text: 'SS 316 grid fins, part of the steering and recovery hardware in the bill of materials, alongside a landing mechanism.' },
    { id: 'fin', label: 'Composite fins', kicker: 'SECTION 14', pos: new THREE.Vector3(Math.sin(Math.PI / 4) * 0.3, AFT + 0.25, Math.cos(Math.PI / 4) * 0.3), text: 'Composite carbon-fibre fins for stability through the climb.' },
    { id: 'nozzle', label: 'Aerospike nozzle', kicker: 'SECTION 8', pos: new THREE.Vector3(0, AFT - 0.16, 0.07), text: 'The team planned to use an aerospike, the late-1990s altitude-compensating nozzle, with a graphite chamber and nozzle because of the reaction temperature. The bill of materials gives its expansion ratio as 35:5.' },
  ];

  const state = { inflate: 1, burst: 0, flame: 0, sep: 0, rocketOnly: 0 };

  return {
    root, rocket, balloon, train, plume, hotspots, envelope,
    center: new THREE.Vector3(0, 1.0, 0),
    setState(s) { Object.assign(state, s); },
    update(time) {
      const b = state.burst;
      const ro = state.rocketOnly;
      // inflation: launch bubble -> full natural shape
      const inf = THREE.MathUtils.clamp(state.inflate, 0, 1);
      envelope.morphTargetInfluences[0] = 1 - inf;
      apex.position.y = BALLOON_BASE + THREE.MathUtils.lerp(LAUNCH_H, FLOAT_H, inf);
      envelope.rotation.y = time * 0.02;
      balloon.visible = b < 0.004 && ro < 0.999;
      balloon.position.y = ro * 6;
      film.opacity = 0.9 * (1 - ro);
      shreds.update(b, time);
      // the train falls away after the burst and lifts away for the rocket-only shot
      train.position.y = -b * b * 7.5 + ro * 4;
      train.rotation.z = b * 0.35;
      train.visible = b < 0.97 && ro < 0.999;
      line.opacity = 1 - ro;
      fabric.opacity = 1 - ro;
      // flight
      rocket.position.y = state.sep;
      const f = state.flame;
      plume.uniforms.uI.value = f;
      plume.uniforms.uTime.value = time;
      plume.group.visible = f > 0.01;
      plume.group.scale.set(1 + f * 0.25, 0.55 + f * 0.65 + Math.sin(time * 40) * 0.02 * f, 1 + f * 0.25);
      plume.glare.material.opacity = f * 0.8;
      engineLight.intensity = f * 9 * (0.85 + Math.sin(time * 33) * 0.1);
    },
  };
}
