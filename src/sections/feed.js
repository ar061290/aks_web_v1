// Interactive redraw of Figure 3a: helium-pressurised feed system.
export function feedDiagram() {
  const node = (id, shape, label, sub) => `<g class="node" data-node="${id}" tabindex="0">${shape}${label}${sub || ''}</g>`;
  return `<svg class="feed" viewBox="0 0 760 450" role="img" aria-label="Helium-pressurised feed system: a 5000 psi helium vessel feeds a pressure regulator that pressurises the UDMH and N2O4 tanks at 3000 psi, which feed low-pressure fuel-rich and oxidizer-rich turbopumps and the showerhead injector.">
    <defs>
      <marker id="arw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="rgba(243,251,251,.55)"/></marker>
    </defs>
    <!-- pipes -->
    <path class="pipe" d="M380 112 V150"/>
    <path class="pipe" d="M330 168 H165 V205"/>
    <path class="pipe" d="M430 168 H595 V205"/>
    <path class="pipe" d="M165 295 V330"/>
    <path class="pipe" d="M595 295 V330"/>
    <path class="pipe" d="M240 353 H310"/>
    <path class="pipe" d="M520 353 H450"/>
    <!-- flows -->
    <path class="flow flow--he" d="M380 112 V150" marker-end="url(#arw)"/>
    <path class="flow flow--he" d="M330 168 H165 V205" marker-end="url(#arw)"/>
    <path class="flow flow--he" d="M430 168 H595 V205" marker-end="url(#arw)"/>
    <path class="flow flow--fu" d="M165 295 V330" marker-end="url(#arw)"/>
    <path class="flow flow--ox" d="M595 295 V330" marker-end="url(#arw)"/>
    <path class="flow flow--fu" d="M240 353 H310" marker-end="url(#arw)"/>
    <path class="flow flow--ox" d="M520 353 H450" marker-end="url(#arw)"/>
    ${node('he', '<circle cx="380" cy="66" r="46"/>', '<text x="380" y="62" text-anchor="middle">HELIUM</text>', '<text class="sm" x="380" y="80" text-anchor="middle">5000 psi</text>')}
    ${node('reg', '<rect x="330" y="150" width="100" height="36" rx="2"/>', '<text x="380" y="172" text-anchor="middle">REGULATOR</text>')}
    ${node('fuel', '<rect x="90" y="205" width="150" height="90" rx="2"/>', '<text x="165" y="243" text-anchor="middle">FUEL TANK</text>', '<text class="sm" x="165" y="262" text-anchor="middle">UDMH · 3000 psi</text>')}
    ${node('ox', '<rect x="520" y="205" width="150" height="90" rx="2"/>', '<text x="595" y="243" text-anchor="middle">OXIDIZER TANK</text>', '<text class="sm" x="595" y="262" text-anchor="middle">N₂O₄ · 3000 psi</text>')}
    ${node('pumps', '<rect x="90" y="330" width="150" height="46" rx="2"/><rect x="520" y="330" width="150" height="46" rx="2"/>', '<text x="165" y="350" text-anchor="middle">LOW-PRESSURE</text><text x="595" y="350" text-anchor="middle">LOW-PRESSURE</text>', '<text class="sm" x="165" y="366" text-anchor="middle">fuel-rich turbopump</text><text class="sm" x="595" y="366" text-anchor="middle">oxidizer-rich turbopump</text>')}
    ${node('inj', '<rect x="310" y="326" width="140" height="56" rx="2"/>', '<text x="380" y="350" text-anchor="middle">SHOWERHEAD</text>', '<text class="sm" x="380" y="366" text-anchor="middle">injector → chamber</text>')}
    <g class="step"><circle cx="440" cy="34" r="10"/><text x="440" y="34">1</text></g>
    <g class="step"><circle cx="446" cy="152" r="10"/><text x="446" y="152">2</text></g>
    <g class="step"><circle cx="80" cy="208" r="10"/><text x="80" y="208">3</text></g>
    <g class="step"><circle cx="680" cy="208" r="10"/><text x="680" y="208">4</text></g>
    <g class="step"><circle cx="80" cy="333" r="10"/><text x="80" y="333">5</text></g>
    <g class="step"><circle cx="380" cy="402" r="10"/><text x="380" y="402">6</text></g>
    <text class="sm" x="380" y="440" text-anchor="middle">Hypergolic: UDMH and N₂O₄ ignite on contact, no igniter</text>
  </svg>`;
}

export function bindFeed(root) {
  const steps = [...root.querySelectorAll('#feed-steps li')];
  const nodes = [...root.querySelectorAll('.feed .node')];
  const set = (id) => {
    nodes.forEach((n) => n.classList.toggle('is-on', n.dataset.node === id));
    steps.forEach((s) => s.classList.toggle('is-on', s.dataset.step === id));
  };
  steps.forEach((s) => {
    s.addEventListener('mouseenter', () => set(s.dataset.step));
    s.addEventListener('click', () => set(s.dataset.step));
  });
  nodes.forEach((n) => {
    n.addEventListener('mouseenter', () => set(n.dataset.node));
    n.addEventListener('click', () => set(n.dataset.node));
    n.addEventListener('focus', () => set(n.dataset.node));
  });
  set('he');
}
