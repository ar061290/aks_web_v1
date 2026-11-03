// Scroll choreography. Every <section data-shot="..."> maps its local scroll progress p (0..1) to a
// flat state of numbers; the director blends neighbouring shots around section boundaries.

export const DEFAULT_STATE = {
  camX: 0, camY: 1.5, camZ: 14, tgtX: 0, tgtY: 1.5, tgtZ: 0, fov: 42, ptX: 0, ptY: 0, portraitPull: 1.45, pKeepX: 0,
  earth: 1, earthX: 0, earthY: -60, earthZ: -80, earthScale: 1, earthTilt: 0, earthSpin: 0,
  sky: 1, stars: 1,
  rockoon: 0, rkScale: 1, rkX: 0, rkY: 0, rkZ: 0, rkRotY: 0, rkTilt: 0, inflate: 1, burst: 0, flame: 0, sep: 0, rocketOnly: 0,
  mol: 0, molX: 0, molY: 0,
  rs25: 0, rsX: 0, rsY: 0, rsRotY: 0, rsExplode: 0,
  tp: 0, tpX: 0, tpY: 0, tpRotY: 0, tpTilt: 0, tpExplode: 0,
};

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ---------------------------------------------------------------- flight profile
// Four phases over the flight section: ascent, ignition, burst + burn, coast to the Karman line.
export const PHASES = [
  { title: 'BALLOON ASCENT', desc: 'HYDROGEN BALLOON CARRIES THE 301.27 KG ROCKET UPWARD' },
  { title: 'IGNITION', desc: 'AT ~29 KM A BAROMETRIC ALTIMETER TRIGGERS THE SHOWERHEAD INJECTORS' },
  { title: 'BURST & BURN', desc: 'AT 30 KM THE BALLOON POPS AS THE HYPERGOLIC ENGINE DRIVES THE ROCKET UP' },
  { title: 'KÁRMÁN LINE', desc: 'TARGET APOGEE: 100 KM, THE INTERNATIONALLY RECOGNISED EDGE OF SPACE' },
];

export function flightAlt(p) {
  if (p < 0.25) return 29 * easeInOut(p / 0.25);
  if (p < 0.5) return 29 + 1 * ((p - 0.25) / 0.25);
  if (p < 0.75) return 30 + 34 * easeIn((p - 0.5) / 0.25);
  return 64 + 36 * easeOut((p - 0.75) / 0.25);
}
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function easeIn(t) { return t * t; }

const R = 40;
// ground sits just under the gondola at 0 km; the planet recedes and slides forward with altitude
const earthBelow = (altKm) => -(R + 2.05 + 7 * Math.pow(Math.max(altKm, 0) / 100, 0.8));
const earthAhead = (altKm) => -0.34 * altKm;

// ---------------------------------------------------------------- shots
// Rockoon geometry (local units): rocket -1.6..1.6, gondola -1.9..0.56, parachute 2.6..4.0,
// balloon base 4.62, float apex 10.6 (launch apex 14.2).
export const SHOTS = {
  hero: (p) => ({
    camX: -2.6 + p * 0.8, camY: 2.2 + p * 0.8, camZ: 23 - p * 1.6, tgtX: -4.6, tgtY: 4.3, tgtZ: 0, fov: 42,
    ptY: -5.0, portraitPull: 1.45,
    earth: 1, earthX: 24, earthY: -40, earthZ: -64, earthTilt: 0.55, earthSpin: -0.35 + p * 0.05,
    sky: 1, stars: 1,
    rockoon: 1, rkRotY: -0.5 + p * 0.7, rkTilt: 0.02, inflate: 1,
  }),
  rockoon: (p) => ({
    camX: 7.6 + p * 0.8, camY: 2.4 + p * 0.6, camZ: 12.5, tgtX: 2.6, tgtY: 2.6 + p * 0.6, tgtZ: 0, fov: 42,
    ptY: -4.2, portraitPull: 2.5,
    earth: 1, earthX: -18, earthY: -50, earthZ: -86, earthTilt: 0.6, earthSpin: -0.2,
    rockoon: 1, rkRotY: 0.25 + p * 1.5, inflate: 1,
  }),
  quote: (p) => ({
    camX: -15 + p * 3, camY: 14 + p * 4, camZ: 31 + p * 5, tgtX: -7.5, tgtY: 3 - p * 2, tgtZ: -2, fov: 42,
    ptY: -1, portraitPull: 1.25,
    earth: 1, earthX: 6, earthY: -60, earthZ: -24, earthTilt: 0.15, earthSpin: 0.1 + p * 0.1,
    rockoon: 1, rkRotY: 1.75 + p * 0.5, inflate: 1,
  }),
  rocket: (p) => ({
    camX: 0.2, camY: 0.7 - p * 0.9, camZ: 5.4, tgtX: 0, tgtY: 0.3 - p * 0.45, tgtZ: 0, fov: 38,
    ptY: -1.1, portraitPull: 1.6,
    earth: 1, earthX: 0, earthY: -70, earthZ: -60, earthTilt: 0.2, earthSpin: 0.4,
    rockoon: 1, rkRotY: 0.6 + p * 2.6, rocketOnly: 1, inflate: 1,
  }),
  propellant: (p) => ({
    camX: 0.4, camY: 0.4, camZ: 8.4 - p * 0.6, tgtX: 0.1, tgtY: 0, tgtZ: 0, fov: 40,
    ptX: 0, ptY: -1.4, portraitPull: 2.2,
    earth: 0, mol: 1, molX: 1.2, molY: 0.1,
  }),
  advantages: (p) => ({
    camX: 0, camY: 0.2, camZ: 9 + p * 1.5, tgtX: 0, tgtY: 0, tgtZ: 0, fov: 40,
    earth: 0, mol: 0.9, molX: 0, molY: 0.2,
  }),
  engine: (p) => ({
    camX: 1.3, camY: 0.7 - p * 0.4, camZ: 6.5 - p * 0.4, tgtX: 0.95, tgtY: 0.1, tgtZ: 0, fov: 40,
    ptY: -1.4, portraitPull: 1.6,
    earth: 0, rs25: 1, rsX: 2.0, rsY: 0, rsRotY: -0.7 + p * 1.8, rsExplode: 0,
  }),
  turbopump: (p) => ({
    camX: -1.5, camY: 1.3, camZ: 6.6 - ss(0.1, 0.7, p) * 0.4, tgtX: -1.0, tgtY: 0.25, tgtZ: 0, fov: 40,
    ptY: -1.5, portraitPull: 1.6,
    earth: 0, tp: 1, tpX: -1.9, tpY: 0.15, tpRotY: 0.55 + p * 0.9, tpTilt: 0.32, tpExplode: ss(0.15, 0.6, p),
  }),
  'flight-intro': (p) => ({
    camX: 7, camY: -0.4, camZ: 19, tgtX: -1.5, tgtY: 5.6, tgtZ: 0, fov: 44,
    ptY: 0.4, portraitPull: 1.35,
    earth: 1, earthX: 0, earthY: earthBelow(0), earthZ: 0, earthTilt: 0, earthSpin: 0,
    sky: 0, stars: 0.4,
    rockoon: 1, rkRotY: 0.6, inflate: 0,
  }),
  flight: (p) => {
    const alt = flightAlt(p);
    const burst = ss(0.52, 0.66, p);
    const flame = ss(0.3, 0.42, p) * (1 - ss(0.86, 0.95, p));
    const sep = ss(0.5, 1, p) * 3.2;
    const follow = ss(0.5, 0.7, p); // from framing the whole train to following the rocket
    const look = ss(0.7, 0.95, p); // then look down past it to the planet
    const wide = { cx: lerp(7, 7.6, ss(0, 0.5, p)), cy: lerp(-0.4, 2.4, ss(0, 0.5, p)), cz: 19, tx: -1.5, ty: lerp(5.6, 4.6, ss(0, 0.5, p)) };
    const near = { cx: lerp(4.6, 4.4, look), cy: lerp(1.4, 3.4, look) + sep, cz: lerp(10, 12.5, look), tx: lerp(-0.8, -1.2, look), ty: lerp(0.2, -2.6, look) + sep };
    return {
      camX: lerp(wide.cx, near.cx, follow), camY: lerp(wide.cy, near.cy, follow), camZ: lerp(wide.cz, near.cz, follow),
      tgtX: lerp(wide.tx, near.tx, follow), tgtY: lerp(wide.ty, near.ty, follow), tgtZ: 0, fov: 44,
      ptY: lerp(0.4, 0.6 - look * 1.5, follow), portraitPull: lerp(1.35, 1.3, follow),
      earth: 1, earthX: 0, earthY: earthBelow(alt), earthZ: earthAhead(alt), earthTilt: 0, earthSpin: p * 0.08,
      sky: clamp(alt / 100), stars: clamp(0.4 + alt / 60),
      rockoon: 1, rkRotY: 0.6 + p * 0.6, inflate: clamp(alt / 30),
      burst, flame, sep,
    };
  },
  apogee: (p) => ({
    camX: 1.8 + p * 0.8, camY: 6.4 + p * 0.4, camZ: 12.5 - p * 1.0, tgtX: -2.6, tgtY: 0.2 - p * 0.3, tgtZ: 0, fov: 44,
    ptX: 0, ptY: -1.2, portraitPull: 1.3,
    earth: 1, earthX: 0, earthY: earthBelow(100), earthZ: earthAhead(100), earthTilt: 0, earthSpin: 0.08 + p * 0.05,
    sky: 1, stars: 1,
    rockoon: 1, rkX: 0, rkRotY: 1.2 + p * 0.6, inflate: 1, burst: 1, flame: 0, sep: 3.2,
  }),
  dossier: (p) => ({
    camX: 0, camY: 2, camZ: 26, tgtX: 0, tgtY: 1.2 - p * 1.5, tgtZ: 0, fov: 44,
    portraitPull: 1,
    earth: 0.75, earthX: 0, earthY: -57, earthZ: -34, earthTilt: 0.35 + p * 0.3, earthSpin: 0.5 + p * 1.8,
    sky: 1, stars: 0.85,
  }),
  why: (p) => ({
    camX: -11 + p * 3, camY: 1.5, camZ: 40 - p * 6, tgtX: -5, tgtY: 5, tgtZ: 0, fov: 40,
    ptY: -1, portraitPull: 1.25,
    earth: 1, earthX: 0, earthY: -56, earthZ: -14, earthTilt: 0.5, earthSpin: 2.2 + p * 0.2,
    rockoon: 1, rkX: 7, rkY: 0, rkRotY: p * 1.2, inflate: 1, pKeepX: 1,
  }),
  end: (p) => ({
    camX: -8 + p * 1.6, camY: 3 + p * 0.8, camZ: 21, tgtX: -3.0, tgtY: 4.3, tgtZ: 0, fov: 42,
    ptY: -3.6, portraitPull: 1.5,
    earth: 1, earthX: -26, earthY: -44, earthZ: -74, earthTilt: 0.5, earthSpin: 0.9 + p * 0.1,
    rockoon: 1, rkX: 1.6, rkRotY: 2.4 + p * 0.6, inflate: 1,
  }),
};

export function mix(a, b, t) {
  const out = {};
  for (const k in DEFAULT_STATE) out[k] = lerp(a[k], b[k], t);
  return out;
}

// ---------------------------------------------------------------- director
export class Director {
  constructor() {
    this.sections = [];
  }

  measure() {
    const els = [...document.querySelectorAll('[data-shot], [data-shot-region]')];
    const y = window.scrollY;
    this.vh = window.innerHeight;
    this.sections = els
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, key: el.dataset.shot || el.dataset.shotRegion, top: r.top + y, height: Math.max(1, r.height) };
      })
      .filter((s) => SHOTS[s.key]);
  }

  stateAt(scrollY) {
    const S = this.sections;
    if (!S.length) return { ...DEFAULT_STATE };
    const c = scrollY + this.vh * 0.5;
    const ev = (i) => {
      const s = S[i];
      const p = clamp((c - s.top) / s.height);
      return { ...DEFAULT_STATE, ...SHOTS[s.key](p) };
    };
    let i = S.findIndex((s) => c < s.top + s.height);
    if (i === -1) i = S.length - 1;
    const s = S[i];
    // blend with the previous / next section around boundaries
    const W = Math.min(this.vh * 0.55, s.height * 0.5);
    const distTop = c - s.top;
    const distBottom = s.top + s.height - c;
    if (i > 0 && distTop < W) {
      const prevW = Math.min(this.vh * 0.55, S[i - 1].height * 0.5);
      const ww = Math.min(W, prevW);
      const t = ss(-ww, ww, distTop);
      if (t < 1) return mix(ev(i - 1), ev(i), t);
    }
    if (i < S.length - 1 && distBottom < W) {
      const nextW = Math.min(this.vh * 0.55, S[i + 1].height * 0.5);
      const ww = Math.min(W, nextW);
      const t = ss(-ww, ww, -distBottom);
      if (t > 0) return mix(ev(i), ev(i + 1), t);
    }
    return ev(i);
  }

  progressOf(el) {
    const s = this.sections.find((x) => x.el === el);
    if (!s) return 0;
    return clamp((window.scrollY + this.vh * 0.5 - s.top) / s.height);
  }
}
