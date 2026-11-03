import * as THREE from 'three';

// Ball-and-stick UDMH, (CH3)2N-NH2, and N2O4, O2N-NO2 (planar), with a faint van der Waals
// electron-density shell. Bond lengths in angstroms, scaled for the scene; muted CPK colours.
const COLORS = { C: 0x2a2d32, H: 0xd8dce1, N: 0x3552c4, O: 0xb8372d };
const RADII = { C: 0.3, H: 0.19, N: 0.3, O: 0.29 };
const VDW = { C: 1.7, H: 1.2, N: 1.55, O: 1.52 };
const SHELL = { C: 0x9fb0c8, H: 0x9fb0c8, N: 0x9fb4e0, O: 0xc8a8b0 };

const mats = {};
function atomMat(el) {
  if (!mats[el]) mats[el] = new THREE.MeshPhysicalMaterial({ color: COLORS[el], roughness: 0.22, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.8 });
  return mats[el];
}
const bondMat = new THREE.MeshPhysicalMaterial({ color: 0x9aa1ab, roughness: 0.28, metalness: 0.85 });
const shellMats = {};
function shellMat(el) {
  if (!shellMats[el]) {
    shellMats[el] = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(SHELL[el]) } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float a = 0.008 + 0.1 * pow(f, 3.0); gl_FragColor = vec4(uColor, a); }`,
    });
  }
  return shellMats[el];
}

// three tetrahedral substituent directions around an atom given the direction to the atom it hangs from
function tetra(back, twist = 0) {
  const b = back.clone().normalize();
  const ref = Math.abs(b.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(b, ref).normalize();
  const w = new THREE.Vector3().crossVectors(b, u).normalize();
  const out = [];
  const cosT = Math.cos((109.5 * Math.PI) / 180);
  const sinT = Math.sin((109.5 * Math.PI) / 180);
  for (let i = 0; i < 3; i++) {
    const a = twist + (i * Math.PI * 2) / 3;
    out.push(b.clone().multiplyScalar(cosT).add(u.clone().multiplyScalar(sinT * Math.cos(a))).add(w.clone().multiplyScalar(sinT * Math.sin(a))));
  }
  return out;
}

function build(atoms, bonds, scale = 0.62) {
  const g = new THREE.Group();
  const sphere = new THREE.SphereGeometry(1, 32, 20);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
  const shellGeo = new THREE.SphereGeometry(1, 40, 24);
  for (const a of atoms) {
    const m = new THREE.Mesh(sphere, atomMat(a.el));
    m.position.copy(a.p).multiplyScalar(scale);
    m.scale.setScalar(RADII[a.el] * scale);
    g.add(m);
    const sh = new THREE.Mesh(shellGeo, shellMat(a.el));
    sh.position.copy(m.position);
    sh.scale.setScalar(VDW[a.el] * scale * 0.7);
    sh.renderOrder = 2;
    g.add(sh);
  }
  const up = new THREE.Vector3(0, 1, 0);
  for (const [i, j, order = 1] of bonds) {
    const p1 = atoms[i].p.clone().multiplyScalar(scale);
    const p2 = atoms[j].p.clone().multiplyScalar(scale);
    const d = p2.clone().sub(p1);
    const len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize());
    const side = new THREE.Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(0.07 * scale);
    const offsets = order === 2 ? [side, side.clone().negate()] : [new THREE.Vector3()];
    for (const o of offsets) {
      const c = new THREE.Mesh(cyl, bondMat);
      c.position.copy(p1).add(p2).multiplyScalar(0.5).add(o);
      c.quaternion.copy(q);
      c.scale.set((order === 2 ? 0.034 : 0.05) * scale, len, (order === 2 ? 0.034 : 0.05) * scale);
      g.add(c);
    }
  }
  // centre on bounding box
  const box = new THREE.Box3().setFromObject(g);
  const ctr = box.getCenter(new THREE.Vector3());
  g.children.forEach((c) => c.position.sub(ctr));
  return g;
}

function udmh() {
  const atoms = [];
  const bonds = [];
  const add = (el, p) => atoms.push({ el, p }) - 1;
  const n1 = add('N', new THREE.Vector3(0, 0, 0));
  const n2 = add('N', new THREE.Vector3(1.45, 0, 0));
  const dirs = tetra(new THREE.Vector3(1, 0, 0), 0.3);
  const c1 = add('C', dirs[0].clone().multiplyScalar(1.46));
  const c2 = add('C', dirs[1].clone().multiplyScalar(1.46));
  bonds.push([n1, n2], [n1, c1], [n1, c2]);
  for (const c of [c1, c2]) {
    const back = atoms[n1].p.clone().sub(atoms[c].p);
    for (const hd of tetra(back, 0.9)) bonds.push([c, add('H', atoms[c].p.clone().add(hd.multiplyScalar(1.09)))]);
  }
  const nb = tetra(new THREE.Vector3(-1, 0, 0), 1.2);
  for (let i = 0; i < 2; i++) bonds.push([n2, add('H', atoms[n2].p.clone().add(nb[i].multiplyScalar(1.01)))]);
  return build(atoms, bonds);
}

function n2o4() {
  const atoms = [];
  const bonds = [];
  const add = (el, p) => atoms.push({ el, p }) - 1;
  const a = (67 * Math.PI) / 180;
  const n1 = add('N', new THREE.Vector3(-0.89, 0, 0));
  const n2 = add('N', new THREE.Vector3(0.89, 0, 0));
  bonds.push([n1, n2]);
  for (const s of [1, -1]) {
    bonds.push([n1, add('O', new THREE.Vector3(-0.89 - 1.19 * Math.cos(a), s * 1.19 * Math.sin(a), 0)), s > 0 ? 2 : 1]);
    bonds.push([n2, add('O', new THREE.Vector3(0.89 + 1.19 * Math.cos(a), s * 1.19 * Math.sin(a), 0)), s > 0 ? 1 : 2]);
  }
  return build(atoms, bonds);
}

export function createMolecules() {
  const root = new THREE.Group();
  root.name = 'molecules';
  const a = udmh();
  const b = n2o4();
  a.position.set(-1.25, 0.15, 0);
  b.position.set(1.35, -0.1, 0);
  b.rotation.set(0.5, 0.3, 0.2);
  root.add(a, b);
  const anchorA = new THREE.Object3D(); anchorA.position.set(-1.25, -1.15, 0); root.add(anchorA);
  const anchorB = new THREE.Object3D(); anchorB.position.set(1.35, -1.15, 0); root.add(anchorB);
  const hotspots = [
    { id: 'udmh', label: 'UDMH · fuel', kicker: 'SECTION 3.1', pos: new THREE.Vector3(-1.25, 0.95, 0.3), text: 'Unsymmetrical dimethylhydrazine, (CH₃)₂NNH₂: density 0.793 g/cc, freezing point −57 °C. Classified by IARC in Group 2B (possibly carcinogenic to humans), the property that helped close the project.' },
    { id: 'n2o4', label: 'N₂O₄ · oxidizer', kicker: 'SECTION 3.1', pos: new THREE.Vector3(1.35, 0.9, 0.3), text: 'Dinitrogen tetroxide, a non-oxygen oxidizer: density 1.450 g/cc, freezing point −11 °C. It is hypergolic with UDMH: the two ignite on contact, so no ignition system is needed.' },
  ];
  return {
    root, a, b, anchorA, anchorB, hotspots, center: new THREE.Vector3(0, 0, 0),
    update(time) {
      a.rotation.y = time * 0.35;
      a.rotation.x = Math.sin(time * 0.3) * 0.25;
      b.rotation.y = -time * 0.3;
      b.rotation.z = 0.2 + Math.sin(time * 0.25) * 0.2;
    },
  };
}
