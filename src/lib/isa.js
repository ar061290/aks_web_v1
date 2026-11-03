// International Standard Atmosphere (U.S. Standard Atmosphere 1976 layers, geopotential altitude).
// Used for live flight telemetry and the buoyancy calculator.
const G0 = 9.80665;
const R_AIR = 287.053; // J/(kg K)
const R_UNIVERSAL = 8.314462618;
const M_H2 = 0.002016; // kg/mol

// base altitude (m), base temperature (K), lapse rate (K/m), base pressure (Pa)
const LAYERS = [
  [0, 288.15, -0.0065, 101325],
  [11000, 216.65, 0, 22632.06],
  [20000, 216.65, 0.001, 5474.889],
  [32000, 228.65, 0.0028, 868.0187],
  [47000, 270.65, 0, 110.9063],
  [51000, 270.65, -0.0028, 66.93887],
  [71000, 214.65, -0.002, 3.956420],
  [84852, 186.946, 0, 0.3734],
];

export function isa(altM) {
  const h = Math.max(0, altM);
  let L = LAYERS[0];
  for (const layer of LAYERS) if (h >= layer[0]) L = layer;
  const [hb, Tb, lapse, Pb] = L;
  const dh = h - hb;
  let T, P;
  if (lapse === 0) {
    T = Tb;
    P = Pb * Math.exp((-G0 * dh) / (R_AIR * Tb));
  } else {
    T = Tb + lapse * dh;
    P = Pb * Math.pow(T / Tb, -G0 / (lapse * R_AIR));
  }
  // above 86 km the 1976 model departs from this form; keep a smooth exponential tail
  if (h > 86000) P = 0.3734 * Math.exp(-(h - 84852) / 5800);
  const rho = P / (R_AIR * T);
  const rhoH2 = (P * M_H2) / (R_UNIVERSAL * T);
  return { T, P, rho, rhoH2 };
}

export function formatPressure(P) {
  if (P >= 1000) return (P / 1000).toFixed(P >= 10000 ? 1 : 2) + ' KPA';
  if (P >= 1) return P.toFixed(P >= 100 ? 0 : 1) + ' PA';
  return P.toExponential(1).replace('e', 'E') + ' PA';
}
