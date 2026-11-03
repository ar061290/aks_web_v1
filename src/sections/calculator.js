import { isa } from '../lib/isa.js';

const G = 9.81; // the paper's g0
const fmt = (x, d = 0) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

function slider({ id, label, min, max, step, value, unit, digits = 0 }) {
  return `<label class="field"><div class="field__top"><span>${label}</span><output id="${id}-o">${fmt(value, digits)} ${unit}</output></div>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" data-digits="${digits}" data-unit="${unit}" /></label>`;
}

function readout(id, label, note = '', cls = '') {
  return `<div class="readout ${cls}"><span>${label}${note ? `<em>${note}</em>` : ''}</span><b id="${id}">–</b></div>`;
}

export function mountRocketCalc(el) {
  el.innerHTML = `
    <div class="calc__inputs">
      ${slider({ id: 'rc-isp', label: 'Specific impulse', min: 200, max: 460, step: 0.1, value: 317.6, unit: 's', digits: 1 })}
      ${slider({ id: 'rc-ms', label: 'Structural (dry) mass', min: 50, max: 300, step: 0.5, value: 150, unit: 'kg', digits: 1 })}
      ${slider({ id: 'rc-mp', label: 'Propellant mass', min: 0, max: 500, step: 0.01, value: 151.27, unit: 'kg', digits: 2 })}
      <div class="presets">
        <button class="btn btn--ghost btn--sm" data-preset="paper">THE PAPER’S MASSES</button>
        <button class="btn btn--ghost btn--sm" data-preset="need">WHAT REACHES 2,854.72 M/S?</button>
      </div>
    </div>
    <div class="readouts">
      ${readout('rc-mr', 'Mass ratio m₀ / m_f')}
      ${readout('rc-dv', 'Δv from these masses', 'Iₛₚ · g₀ · ln(m₀/m_f)')}
      ${readout('rc-paper', 'Δv quoted in the paper', 'Equation (14)', 'is-paper')}
      ${readout('rc-coast', 'Ideal coast height', 'Δv² / 2g: no drag, no gravity loss')}
      ${readout('rc-need', 'Δv to coast 71 km', '√(2gh): a lower bound, Appendix A (j)')}
    </div>
    <p class="calc__note">With the paper’s own masses (150 kg dry, 151.27 kg propellant) the mass ratio is 2.0085, giving about 2,172 m/s rather than the 2,854.72 m/s of Equation (14), as Appendix A (i) notes. A real trajectory also loses velocity to gravity during the burn and to drag in the 29–50 km band.</p>`;
  const $ = (id) => el.querySelector('#' + id);
  const isp = $('rc-isp'), ms = $('rc-ms'), mp = $('rc-mp');
  const update = () => {
    for (const i of [isp, ms, mp]) $(i.id + '-o').textContent = `${fmt(+i.value, +i.dataset.digits)} ${i.dataset.unit}`;
    const m0 = +ms.value + +mp.value;
    const mr = m0 / +ms.value;
    const dv = +isp.value * G * Math.log(mr);
    $('rc-mr').textContent = fmt(mr, 4);
    $('rc-dv').innerHTML = `${fmt(dv)}<small>m/s</small>`;
    $('rc-paper').innerHTML = `2,854.72<small>m/s</small>`;
    $('rc-coast').innerHTML = `${fmt((dv * dv) / (2 * G) / 1000, 0)}<small>km</small>`;
    $('rc-need').innerHTML = `${fmt(Math.sqrt(2 * G * 71000))}<small>m/s</small>`;
  };
  el.addEventListener('input', update);
  el.querySelector('[data-preset="paper"]').addEventListener('click', () => { isp.value = 317.6; ms.value = 150; mp.value = 151.27; update(); });
  el.querySelector('[data-preset="need"]').addEventListener('click', () => {
    // propellant needed for 2854.72 m/s with 150 kg dry mass and Isp 317.6 s
    isp.value = 317.6; ms.value = 150;
    mp.value = (150 * (Math.exp(2854.72 / (317.6 * G)) - 1)).toFixed(2);
    update();
  });
  update();
}

export function mountBalloonCalc(el) {
  el.innerHTML = `
    <div class="calc__inputs">
      ${slider({ id: 'bc-alt', label: 'Float altitude', min: 0, max: 40, step: 0.1, value: 30, unit: 'km', digits: 1 })}
      ${slider({ id: 'bc-m', label: 'Lifted mass (rocket)', min: 20, max: 600, step: 0.01, value: 301.27, unit: 'kg', digits: 2 })}
      ${slider({ id: 'bc-env', label: 'Envelope mass', min: 0, max: 1500, step: 1, value: 0, unit: 'kg', digits: 0 })}
      <p class="calc__note" style="margin:0">Densities come from the International Standard Atmosphere at the chosen altitude, with hydrogen at the same temperature and pressure. The paper did not budget an envelope mass; try adding one.</p>
    </div>
    <div class="readouts">
      ${readout('bc-rho', 'Air density at altitude', 'ISA')}
      ${readout('bc-rhoh', 'Hydrogen density at altitude')}
      ${readout('bc-v', 'Envelope volume needed', 'V = m / (ρ_air − ρ_H₂)')}
      ${readout('bc-d', 'Equivalent sphere diameter')}
      ${readout('bc-h2', 'Hydrogen inventory')}
      ${readout('bc-paper', 'The paper: volume · hydrogen', 'Eq. (51)–(52), ρ_air taken as 1.03 kg/m³', 'is-paper')}
    </div>`;
  const $ = (id) => el.querySelector('#' + id);
  const alt = $('bc-alt'), m = $('bc-m'), env = $('bc-env');
  const update = () => {
    for (const i of [alt, m, env]) $(i.id + '-o').textContent = `${fmt(+i.value, +i.dataset.digits)} ${i.dataset.unit}`;
    const a = isa(+alt.value * 1000);
    const net = a.rho - a.rhoH2;
    const V = (+m.value + +env.value) / net;
    const D = Math.cbrt((6 * V) / Math.PI);
    $('bc-rho').innerHTML = `${a.rho < 0.1 ? a.rho.toFixed(4) : a.rho.toFixed(3)}<small>kg/m³</small>`;
    $('bc-rhoh').innerHTML = `${a.rhoH2 < 0.01 ? a.rhoH2.toFixed(5) : a.rhoH2.toFixed(4)}<small>kg/m³</small>`;
    $('bc-v').innerHTML = `${fmt(V)}<small>m³</small>`;
    $('bc-d').innerHTML = `${fmt(D, 1)}<small>m</small>`;
    $('bc-h2').innerHTML = `${fmt(V * a.rhoH2, 1)}<small>kg</small>`;
    $('bc-paper').innerHTML = `2,870<small>m³</small> · 258.42<small>kg</small>`;
  };
  el.addEventListener('input', update);
  update();
}
