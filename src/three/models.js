import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import rs25Hotspots from '../data/rs25-hotspots.json';

// Concise, project-linked descriptions for the RS-25 parts. Positions come from the generator.
const RS25_TEXT = {
  Nozzle: ['SECTION 9 · COOLING', 'Regeneratively cooled bell nozzle. Its wall is a bundle of brazed tubes carrying cold liquid hydrogen before it is burned. Regenerative cooling was one of the five strategies Project AKS investigated.'],
  MainCombustionChamber: ['SECTION 4.2', 'Main combustion chamber. For their own engine the team chose graphite for the chamber and nozzle instead of SS 301, because of the high temperature of the reaction.'],
  Powerhead: ['SECTION 7 · INJECTOR', 'Powerhead with the main injector and hot-gas manifold. Project AKS chose a showerhead injector for mixing efficiency, combustion stability and thrust control.'],
  HPFTP: ['SECTION 14', 'High-pressure fuel turbopump, driven by the fuel-rich preburner above it. The AKS bill of materials lists two high-pressure turbopumps and one fuel-rich preburner.'],
  HPOTP: ['SECTION 14', 'High-pressure oxidizer turbopump with its oxidizer preburner. The AKS parts list includes one oxidizer-rich preburner.'],
  LPFTP: ['FIGURE 3A', 'Low-pressure fuel turbopump, a boost pump that stops the high-pressure pump cavitating. The team’s own feed diagram shows low-pressure fuel-rich and oxidizer-rich turbopumps.'],
  LPOTP: ['FIGURE 3A', 'Low-pressure oxidizer turbopump, the oxidizer-side boost pump that also appears in the team’s feed-system concept.'],
  PogoAccumulator: ['RS-25', 'POGO suppression accumulator: a gas-filled sphere on the oxidizer line that damps pressure oscillations between engine and vehicle.'],
  FuelDucts: ['RS-25', 'Fuel ducts, including the line that feeds hydrogen into the nozzle coolant manifold (labelled in Figure 8a).'],
  OxidizerDucts: ['RS-25', 'Oxidizer ducts: the low-pressure discharge duct and the high-pressure line to the main oxidizer valve and injector.'],
  Valves: ['SECTION 14', 'Main fuel and oxidizer valves and the chamber coolant valve. The AKS parts list calls for main fuel and oxidizer valves plus isolation, check, vent and relief valves.'],
  GimbalBearing: ['SECTION 14', 'Gimbal bearing, the thrust mount the engine swivels on. The AKS bill of materials lists a huge gimbal, gimballing motors and gimballing stands.'],
  EngineController: ['RS-25', 'Engine controller: the electronics box that sequences valves and monitors the engine. AKS planned valves “controlled by an application or program”.'],
};

const TP_TEXT = {
  inducer: 'The first blades the propellant meets: they raise inlet pressure enough to stop the main impeller from cavitating.',
  impeller: 'Two-stage pump impeller. It flings propellant outward into the volute, turning shaft power into pressure.',
  shaft: 'The common shaft that couples turbine to pump. The AKS parts list calls for “multiple gas turbine shafts”.',
  turbine: 'Two-stage turbine driven by hot preburner gas. The AKS bill of materials lists “turbines (high psi, high hp)”.',
  spin_start: 'Spin-start injectors: a burst of gas spins the rotor up before the preburner takes over.',
  valves: 'Ports and plugs for helium purge and cold-propellant bleed lines.',
  inlet: 'Pump inlet duct, where propellant arrives from the tank at tank pressure.',
  pump_housing: 'Pump housing and volute. They collect the high-pressure flow leaving the impeller and send it to the engine.',
  turbine_housing: 'Turbine housing, which contains the hot drive gas.',
  other: 'Turbine-end casing.',
};

export function createLoader(manager) {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

function prepMaterials(root, envBoost = 1) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      const m = o.material;
      if (m && m.isMeshStandardMaterial && !m.userData.prepped) {
        m.userData.prepped = true;
        m.envMapIntensity = envBoost;
        m.color.multiplyScalar(0.82);
        m.roughness = Math.min(1, m.roughness + 0.08);
        m.needsUpdate = true;
      }
    }
  });
}

export function setupRS25(gltf) {
  const root = new THREE.Group();
  root.name = 'rs25';
  const model = gltf.scene;
  prepMaterials(model, 0.85);
  root.add(model);
  const engine = model.getObjectByName('RS25') || model;
  const parts = [];
  for (const c of engine.children) {
    const dir = c.userData.explodeDir || [0, 0, 0];
    parts.push({ node: c, base: c.position.clone(), dir: new THREE.Vector3(...dir) });
  }
  const hotspots = rs25Hotspots.hotspots.map((h) => {
    const t = RS25_TEXT[h.node];
    return { id: h.node, node: engine.getObjectByName(h.node), label: h.label, kicker: t ? t[0] : 'RS-25', pos: new THREE.Vector3(...h.position), text: t ? t[1] : h.description };
  });
  return {
    root, hotspots, center: new THREE.Vector3(0, 0, 0), explodable: true,
    title: 'RS-25 · SPACE SHUTTLE MAIN ENGINE',
    setExplode(e) {
      for (const p of parts) p.node.position.copy(p.base).addScaledVector(p.dir, e * 0.55);
      // hotspots follow their part
      for (const h of hotspots) {
        if (!h.base) h.base = h.pos.clone();
        const part = parts.find((p) => p.node === h.node);
        if (part) h.pos.copy(h.base).addScaledVector(part.dir, e * 0.55);
      }
    },
    update() {},
  };
}

export function setupTurbopump(gltf) {
  const root = new THREE.Group();
  root.name = 'turbopump';
  const model = gltf.scene;
  prepMaterials(model, 0.85);
  root.add(model);
  const rotor = model.getObjectByName('rotor');
  const groups = [];
  model.traverse((o) => {
    const u = o.userData;
    if (u && u.explode && u.group && o.parent && (o.parent.name === 'rotor' || o.parent.name === 'stator')) {
      groups.push({ node: o, base: o.position.clone(), dir: new THREE.Vector3(...u.explode), dist: u.explodeDistance || 0.4, u });
    }
  });
  const hotspots = groups
    .filter((g) => g.u.hotspot)
    .map((g) => {
      // hotspot stored in model space; convert to the group's parent space offset
      const pos = new THREE.Vector3(...g.u.hotspot);
      return { id: g.u.group, groupRef: g, label: g.u.group === 'other' ? 'Turbine-end casing' : g.u.label, kicker: g.u.rotating ? 'ROTATING ASSEMBLY' : 'STATIC STRUCTURE', pos, base: pos.clone(), text: TP_TEXT[g.u.group] || '' };
    });
  let explode = 0;
  return {
    root, rotor, hotspots, center: new THREE.Vector3(0, 0, 0), explodable: true,
    title: 'TURBOPUMP',
    setExplode(e) {
      explode = e;
      for (const g of groups) {
        const k = g.u.rotating ? 1.0 : 0.65;
        g.node.position.copy(g.base).addScaledVector(g.dir, e * g.dist * k * 0.8);
        // lift the rotating assembly out of the cut housing
        if (g.u.rotating) g.node.position.y += 0;
      }
      if (rotor) rotor.position.y = -0.0035 + e * 0.42;
      for (const h of hotspots) {
        const g = h.groupRef;
        const k = g.u.rotating ? 1.0 : 0.65;
        h.pos.copy(h.base).addScaledVector(g.dir, e * g.dist * k * 0.8);
        if (g.u.rotating) h.pos.y += e * 0.42;
      }
    },
    update(time, spin = 1) {
      if (rotor) rotor.rotation.x = time * 2.4 * spin;
    },
    get explode() { return explode; },
  };
}
