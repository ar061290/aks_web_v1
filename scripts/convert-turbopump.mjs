#!/usr/bin/env node
/**
 * convert-turbopump.mjs
 *
 * Turns a turbopump CAD/mesh download into the web-ready GLB used by the site
 * (public/models/turbopump.glb):
 *   - reads STEP / STP / IGES / IGS (via occt-import-js), 3MF (built-in zip + XML reader) or STL
 *   - keeps every CAD body as its own mesh node, grouped into named sub-assemblies
 *     (housing / rotor / ...) so the page can attach tap hotspots and an exploded view
 *   - orients it: Y-up, shaft axis along +X (or +Y with --upright), centred on the origin,
 *     longest dimension = 2 units
 *   - computes crease-angle normals, assigns metallic PBR materials
 *   - compresses with EXT_meshopt_compression (+ KHR_mesh_quantization)
 *   - writes per-node `extras` (label, group, explode direction, hotspot anchor) and a
 *     root `extras.turbopump` summary (shaft axis, groups, licence/source)
 *
 * Usage:
 *   node scripts/convert-turbopump.mjs [inputs...] [options]
 *
 *   inputs   files or folders (default: models-src/turbopump/). Every .step/.stp/.iges/.igs/
 *            .3mf/.stl file found is imported into one assembly.
 *
 * Options:
 *   --out <file>            output GLB (default: see licence guard below)
 *   --preset <name>         auto | grabcad-smoliar | printables-raptor   (default: auto)
 *   --axis <x|y|z|-x|-y|-z> shaft axis in source coordinates (default: preset, else longest bbox axis)
 *   --roll <deg>            extra rotation about the shaft after alignment (default: preset or 0)
 *   --upright               put the shaft along +Y instead of +X
 *   --exclude <regex>       drop bodies whose name/path matches (case-insensitive)
 *   --crease <deg>          crease angle for normals on meshes without normals (default 35)
 *   --deflection <ratio>    STEP/IGES tessellation, bounding-box ratio (default 0.0008)
 *   --max-tris <n>          simplify if the triangle count exceeds this (default 400000)
 *   --no-compress           skip meshopt compression (debugging)
 *   --author-permission     you have the uploader's written permission to publish a
 *                           GrabCAD model (required to write a STEP/IGES conversion into public/)
 *   --source-url, --author, --license, --title   recorded in the GLB's extras
 *
 * Licence guard: GrabCAD Community models are licensed to downloaders only for their own
 * "non-commercial, internal use" (GrabCAD Terms, s.6.2) and may not be uploaded to another
 * website. So when the input is STEP/IGES and --author-permission is NOT given, the output
 * defaults to models-src/turbopump/turbopump.preview.glb (not deployed). With the flag it
 * defaults to public/models/turbopump.glb. 3MF/STL inputs default to public/models/turbopump.glb.
 *
 * devDependencies: @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
 *                  meshoptimizer occt-import-js   (Node >= 18)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsClearcoat } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, simplify, weld, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPT_DIR, '..');

// ----------------------------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (!s.startsWith('--')) { a._.push(s); continue; }
    const k = s.slice(2);
    if (['upright', 'no-compress', 'author-permission', 'help'].includes(k)) a[k] = true;
    else a[k] = argv[++i];
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}

// ----------------------------------------------------------------------------------------------
// Presets: name -> group rules, orientation, metadata
// ----------------------------------------------------------------------------------------------
// Group rules are tested in order against "<path> / <name>" (case-insensitive); first match wins.
// `rotating: true` groups form the rotor sub-assembly (exploded along the shaft, spun about it).
const GENERIC_GROUPS = [
  { id: 'fasteners', label: 'Fasteners', rotating: false, re: /bolt|screw|\bnut\b|washer|\bpin\b|stud|болт|винт|гайк|шайб|шпильк|штифт|schraube|mutter/i },
  { id: 'bearings', label: 'Bearings', rotating: true, re: /bearing|подшипн|lager/i },
  { id: 'seals', label: 'Shaft seals', rotating: false, re: /seal|уплотн|dicht|o-?ring|манжет/i },
  { id: 'gears', label: 'Gear train', rotating: true, re: /gear|pinion|шестерн|зубч|редукт|zahnrad|getriebe|ritzel/i },
  { id: 'inducer', label: 'Inducer', rotating: true, re: /inducer|шнек|vorsatz/i },
  { id: 'impeller', label: 'Pump impeller', rotating: true, re: /impell|impella|крыльч|рабоч\S*\s*колес|laufrad|колесо насос/i },
  { id: 'turbine', label: 'Turbine rotor', rotating: true, re: /turbin.*(disc|disk|rotor|wheel|blade)|(disc|disk|rotor|wheel|blade).*turbin|турбин\S*\s*(колес|диск|ротор)|лопат/i },
  { id: 'shaft', label: 'Shaft', rotating: true, re: /shaft|\bвал\b|^вал|welle|rotor (mitte|ende)|ротор|\brotor\b/i },
  { id: 'turbine_housing', label: 'Turbine housing & nozzle ring', rotating: false, re: /turbin|турбин|сопл|stator|nozzle ring|leitrad/i },
  { id: 'gas_generator', label: 'Gas generator', rotating: false, re: /gas.?gen|газогенер|\bгг\b|preburner|vorbrenner/i },
  { id: 'valves', label: 'Valves & plugs', rotating: false, re: /valve|клапан|ventil|stopfen|plug|заглушк|пробк/i },
  { id: 'piping', label: 'Inlets, ducts & flanges', rotating: false, re: /pipe|tube|duct|elbow|патруб|труб|фланец|flange|rohr|verbinder|отвод|коллектор|manifold/i },
  { id: 'housing', label: 'Pump housing & volute', rotating: false, re: /volute|улитк|housing|корпус|gehäuse|gehause|body|casing|крышк|cover/i },
];

const PRESETS = {
  auto: { groups: GENERIC_GROUPS, axis: null, roll: 0, exclude: null },

  // https://grabcad.com/library/turbopump-for-liquid-rocket-engine-3  (Max Smoliar) - the model in Fig. 9.
  // STEP "Сборка3 Разрез.STEP": two pumps either side of a central turbine on one shaft, gas
  // generator on top. Body names are Russian; the generic EN/RU/DE rules above cover them.
  'grabcad-smoliar': {
    groups: GENERIC_GROUPS, axis: null, roll: 0, exclude: null,
    meta: {
      title: 'Turbopump for liquid rocket engine',
      author: 'Max Smoliar (GrabCAD: max.smoliar-1)',
      sourceUrl: 'https://grabcad.com/library/turbopump-for-liquid-rocket-engine-3',
      license: 'GrabCAD Community terms (non-commercial internal use only) - publish only with the author\'s written permission',
    },
  },

  // https://www.printables.com/model/1175221-raptor-ch4-turbopump  (3D Shuttle, CC BY-SA 4.0)
  // Fusion 360 export, assembly coordinates in mm, shaft on +Z (inlet at +Z, turbine at -Z),
  // housing is a quarter-section cutaway. Stand (display plinth) is not part of the pump.
  'printables-raptor': {
    groups: [
      { id: 'inducer', label: 'Inducer', rotating: true, re: /^rotor 1$|k.rper332/i },
      { id: 'impeller', label: 'Pump impeller (2 stages)', rotating: true, re: /impella/i },
      { id: 'shaft', label: 'Shaft', rotating: true, re: /rotor mitte|rotor ende/i },
      { id: 'turbine', label: 'Turbine rotor (2 stages)', rotating: true, re: /turbine/i },
      { id: 'spin_start', label: 'Spin-start injectors', rotating: false, re: /starter/i },
      { id: 'valves', label: 'Ports & plugs', rotating: false, re: /stopfen/i },
      { id: 'inlet', label: 'Pump inlet duct', rotating: false, re: /main body 8/i },
      { id: 'pump_housing', label: 'Pump housing & volute', rotating: false, re: /main body (5|6|7)|verbinder 2/i },
      { id: 'turbine_housing', label: 'Turbine housing', rotating: false, re: /main body (1|2|3|4)|verbinder 1/i },
    ],
    axis: 'z', roll: 0, exclude: /platte|stand/i,
    meta: {
      title: 'Raptor CH4 Turbopump',
      author: '3D Shuttle (printables.com/@3DShuttle)',
      sourceUrl: 'https://www.printables.com/model/1175221-raptor-ch4-turbopump',
      license: 'CC BY-SA 4.0',
    },
  },
};

// Materials (metallic PBR). Section cut faces get their own darker material so the cutaway reads.
const MATERIALS = {
  steel: { color: '#b9bcc2', metalness: 0.85, roughness: 0.35 },
  polished: { color: '#d3d6db', metalness: 0.9, roughness: 0.22 },
  shaft: { color: '#9fa3aa', metalness: 0.9, roughness: 0.3 },
  dark: { color: '#55595f', metalness: 0.75, roughness: 0.45 },
  bronze: { color: '#b98a5a', metalness: 0.85, roughness: 0.35 },
  section: { color: '#7b8088', metalness: 0.6, roughness: 0.55 },
};
const GROUP_MATERIAL = {
  inducer: 'polished', impeller: 'polished', turbine: 'polished', gears: 'bronze', shaft: 'shaft',
  bearings: 'shaft', seals: 'dark', fasteners: 'dark', valves: 'dark', spin_start: 'dark',
};

// ----------------------------------------------------------------------------------------------
// Small math helpers
// ----------------------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

// 4x4 column-major (glTF convention) helpers
function mat4Identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mat4Mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
  }
  return o;
}
function applyMat4(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
function applyMat3(m, x, y, z) { // rotation/linear part of a mat4, for normals (assumes no shear)
  return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
}

// ----------------------------------------------------------------------------------------------
// Readers. Each returns parts: { name, path: string[], positions: Float32Array, indices: Uint32Array,
//                                normals?: Float32Array, color?: [r,g,b] }
// ----------------------------------------------------------------------------------------------

// --- minimal ZIP reader (stored + deflate, ZIP64-aware) for 3MF -------------------------------
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) { // ZIP64 end of central directory
    const loc = eocd - 20;
    if (buf.readUInt32LE(loc) === 0x07064b50) {
      const z64 = Number(buf.readBigUInt64LE(loc + 8));
      count = Number(buf.readBigUInt64LE(z64 + 32));
      cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
    }
  }
  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    let lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    let x = p + 46 + nlen; const xend = x + xlen;
    while (x + 4 <= xend) { // ZIP64 extra field
      const id = buf.readUInt16LE(x), sz = buf.readUInt16LE(x + 2); let q = x + 4;
      if (id === 0x0001) {
        if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (lho === 0xffffffff) { lho = Number(buf.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + sz;
    }
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    entries.set(name.replace(/^\//, ''), { method, csize, start });
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name.replace(/^\//, ''));
      if (!e) return null;
      const raw = buf.subarray(e.start, e.start + e.csize);
      if (e.method === 0) return Buffer.from(raw);
      if (e.method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`unsupported zip method ${e.method} for ${name}`);
    },
  };
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? m[1] : null;
}
function hexColor(s) {
  if (!s) return null;
  const h = s.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
function mat3mf(s) { // 3MF "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32" (row vectors) -> column-major mat4
  if (!s) return mat4Identity();
  const v = s.trim().split(/\s+/).map(Number);
  return [v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, v[9], v[10], v[11], 1];
}

function read3MF(file) {
  const zip = readZip(fs.readFileSync(file));
  const rels = zip.read('_rels/.rels')?.toString('utf8') || '';
  const rootModel = (rels.match(/Target="([^"]+\.model)"/i) || [, '3D/3dmodel.model'])[1].replace(/^\//, '');
  const models = new Map(); // path -> { objects: Map(id -> obj), build: [] }

  function loadModel(mpath) {
    if (models.has(mpath)) return models.get(mpath);
    const xml = zip.read(mpath)?.toString('utf8');
    if (!xml) throw new Error(`3MF: missing ${mpath}`);
    const unit = attr(xml.match(/<model[^>]*>/)[0], 'unit') || 'millimeter';
    const colorGroups = new Map();
    for (const m of xml.matchAll(/<(?:m:)?colorgroup\s+([^>]*)>([\s\S]*?)<\/(?:m:)?colorgroup>/g)) {
      colorGroups.set(attr(m[1], 'id'), [...m[2].matchAll(/color="([^"]+)"/g)].map((c) => hexColor(c[1])));
    }
    for (const m of xml.matchAll(/<basematerials\s+([^>]*)>([\s\S]*?)<\/basematerials>/g)) {
      colorGroups.set(attr(m[1], 'id'), [...m[2].matchAll(/displaycolor="([^"]+)"/g)].map((c) => hexColor(c[1])));
    }
    const objects = new Map();
    for (const m of xml.matchAll(/<object\s+([^>]*)>([\s\S]*?)<\/object>/g)) {
      const head = m[1], body = m[2];
      const id = attr(head, 'id');
      const name = attr(head, 'name') || `object_${id}`;
      const pid = attr(head, 'pid'), pindex = attr(head, 'pindex');
      const color = pid && colorGroups.has(pid) ? colorGroups.get(pid)[Number(pindex || 0)] : null;
      const obj = { id, name, color, mesh: null, components: [] };
      const vm = body.match(/<vertices>([\s\S]*?)<\/vertices>/);
      if (vm) {
        const vs = [...vm[1].matchAll(/<vertex\s+([^>]*?)\/>/g)];
        const pos = new Float32Array(vs.length * 3);
        vs.forEach((v, i) => { pos[i * 3] = +attr(v[1], 'x'); pos[i * 3 + 1] = +attr(v[1], 'y'); pos[i * 3 + 2] = +attr(v[1], 'z'); });
        const ts = [...body.match(/<triangles>([\s\S]*?)<\/triangles>/)[1].matchAll(/<triangle\s+([^>]*?)\/>/g)];
        const idx = new Uint32Array(ts.length * 3);
        ts.forEach((t, i) => { idx[i * 3] = +attr(t[1], 'v1'); idx[i * 3 + 1] = +attr(t[1], 'v2'); idx[i * 3 + 2] = +attr(t[1], 'v3'); });
        obj.mesh = { positions: pos, indices: idx };
      }
      for (const c of body.matchAll(/<component\s+([^>]*?)\/>/g)) {
        obj.components.push({ objectid: attr(c[1], 'objectid'), path: attr(c[1], 'p:path'), transform: mat3mf(attr(c[1], 'transform')) });
      }
      objects.set(id, obj);
    }
    const build = [...xml.matchAll(/<item\s+([^>]*?)\/>/g)].map((b) => ({ objectid: attr(b[1], 'objectid'), path: attr(b[1], 'p:path'), transform: mat3mf(attr(b[1], 'transform')) }));
    const rec = { objects, build, unit };
    models.set(mpath, rec);
    return rec;
  }

  const parts = [];
  function emit(modelPath, objectid, matrix, trail) {
    const model = loadModel(modelPath);
    const obj = model.objects.get(objectid);
    if (!obj) return;
    const pathNames = [...trail, obj.name];
    if (obj.mesh) {
      const { positions, indices } = obj.mesh;
      const out = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        const p = applyMat4(matrix, positions[i], positions[i + 1], positions[i + 2]);
        out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
      }
      parts.push({ name: obj.name, path: trail, positions: out, indices, color: obj.color });
    }
    for (const c of obj.components) {
      emit(c.path ? c.path.replace(/^\//, '') : modelPath, c.objectid, mat4Mul(matrix, c.transform), pathNames);
    }
  }
  const root = loadModel(rootModel);
  for (const item of root.build) emit(item.path ? item.path.replace(/^\//, '') : rootModel, item.objectid, item.transform, [path.basename(file, path.extname(file))]);
  return parts;
}

function readSTL(file) {
  const buf = fs.readFileSync(file);
  const name = path.basename(file, path.extname(file));
  const isBinary = buf.length >= 84 && 84 + buf.readUInt32LE(80) * 50 === buf.length;
  let pos;
  if (isBinary) {
    const n = buf.readUInt32LE(80);
    pos = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) pos[i * 9 + k] = buf.readFloatLE(84 + i * 50 + 12 + k * 4);
  } else {
    const v = [...buf.toString('utf8').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
    pos = Float32Array.from(v);
  }
  const indices = new Uint32Array(pos.length / 3).map((_, i) => i);
  return [{ name, path: [], positions: pos, indices }];
}

async function readOCCT(file, kind) {
  const occt = await require('occt-import-js')();
  const content = new Uint8Array(fs.readFileSync(file));
  const params = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: Number(args.deflection || 0.0008), angularDeflection: 0.35 };
  const res = kind === 'iges' ? occt.ReadIgesFile(content, params) : occt.ReadStepFile(content, params);
  if (!res.success) throw new Error(`occt-import-js could not read ${file}`);
  const parts = [];
  (function walk(node, trail) {
    const here = node.name ? [...trail, node.name] : trail;
    for (const mi of node.meshes || []) {
      const m = res.meshes[mi];
      parts.push({
        name: m.name || node.name || `body_${mi}`,
        path: here,
        positions: Float32Array.from(m.attributes.position.array),
        normals: m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : null,
        indices: Uint32Array.from(m.index.array),
        color: m.color || null,
      });
    }
    for (const c of node.children || []) walk(c, here);
  })(res.root, []);
  return parts;
}

// ----------------------------------------------------------------------------------------------
// Geometry processing
// ----------------------------------------------------------------------------------------------
/** Weld coincident positions and compute crease-angle normals. Returns indexed geometry. */
function creaseNormals(positions, indices, creaseDeg) {
  const cosT = Math.cos((creaseDeg * Math.PI) / 180);
  // 1. weld positions (quantised key)
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], positions[i + k]); mx[k] = Math.max(mx[k], positions[i + k]); }
  const eps = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) * 1e-6 || 1e-9;
  const keyOf = new Map(); const remap = new Uint32Array(positions.length / 3); const uniq = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const k = `${Math.round(positions[i * 3] / eps)},${Math.round(positions[i * 3 + 1] / eps)},${Math.round(positions[i * 3 + 2] / eps)}`;
    let id = keyOf.get(k);
    if (id === undefined) { id = uniq.length / 3; keyOf.set(k, id); uniq.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); }
    remap[i] = id;
  }
  const nV = uniq.length / 3, nF = indices.length / 3;
  const tri = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) tri[i] = remap[indices[i]];
  // 2. face normals (area weighted) + unit
  const fn = new Float64Array(nF * 3), fu = new Float64Array(nF * 3);
  const valid = new Uint8Array(nF);
  for (let f = 0; f < nF; f++) {
    const a = tri[f * 3], b = tri[f * 3 + 1], c = tri[f * 3 + 2];
    if (a === b || b === c || a === c) continue;
    const pa = [uniq[a * 3], uniq[a * 3 + 1], uniq[a * 3 + 2]];
    const n = cross(sub([uniq[b * 3], uniq[b * 3 + 1], uniq[b * 3 + 2]], pa), sub([uniq[c * 3], uniq[c * 3 + 1], uniq[c * 3 + 2]], pa));
    const l = len(n); if (l === 0) continue;
    valid[f] = 1;
    fn[f * 3] = n[0]; fn[f * 3 + 1] = n[1]; fn[f * 3 + 2] = n[2];
    fu[f * 3] = n[0] / l; fu[f * 3 + 1] = n[1] / l; fu[f * 3 + 2] = n[2] / l;
  }
  // 3. vertex -> faces adjacency (CSR)
  const deg = new Uint32Array(nV + 1);
  for (let f = 0; f < nF; f++) if (valid[f]) for (let k = 0; k < 3; k++) deg[tri[f * 3 + k] + 1]++;
  for (let v = 0; v < nV; v++) deg[v + 1] += deg[v];
  const adj = new Uint32Array(deg[nV]); const fill = deg.slice(0, nV);
  for (let f = 0; f < nF; f++) if (valid[f]) for (let k = 0; k < 3; k++) adj[fill[tri[f * 3 + k]]++] = f;
  // 4. per-corner normals, dedupe (position id, quantised normal)
  const outPos = [], outNrm = [], outIdx = [];
  const vkey = new Map();
  for (let f = 0; f < nF; f++) {
    if (!valid[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = tri[f * 3 + k];
      let nx = 0, ny = 0, nz = 0;
      for (let j = deg[v]; j < deg[v + 1]; j++) {
        const g = adj[j];
        if (fu[f * 3] * fu[g * 3] + fu[f * 3 + 1] * fu[g * 3 + 1] + fu[f * 3 + 2] * fu[g * 3 + 2] >= cosT) { nx += fn[g * 3]; ny += fn[g * 3 + 1]; nz += fn[g * 3 + 2]; }
      }
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const key = `${v}|${Math.round(nx * 512)},${Math.round(ny * 512)},${Math.round(nz * 512)}`;
      let id = vkey.get(key);
      if (id === undefined) { id = outPos.length / 3; vkey.set(key, id); outPos.push(uniq[v * 3], uniq[v * 3 + 1], uniq[v * 3 + 2]); outNrm.push(nx, ny, nz); }
      outIdx.push(id);
    }
  }
  return { positions: Float32Array.from(outPos), normals: Float32Array.from(outNrm), indices: Uint32Array.from(outIdx) };
}

function bboxOf(positions) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { const v = positions[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  return { min: mn, max: mx, center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}
function unionBox(boxes) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.min[k]); mx[k] = Math.max(mx[k], b.max[k]); }
  return { min: mn, max: mx, center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

/** Rotation (column-major mat4) that maps source shaft axis -> target axis, then rolls about it. */
function orientationMatrix(axisSpec, rollDeg, upright) {
  const sign = axisSpec.startsWith('-') ? -1 : 1;
  const ax = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axisSpec.replace('-', '')].map((v) => v * sign);
  const target = upright ? [0, 1, 0] : [1, 0, 0];
  // Build an orthonormal source frame (a = shaft, b = reference "up", c = a x b) and map it to
  // the target frame (shaft -> target, ref up -> +Y (or -Z when upright)).
  let ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  if (!upright && Math.abs(ax[2]) > 0.9) ref = [0, 1, 0];
  const b = norm(sub(ref, ax.map((v) => v * dot(ref, ax))));
  const c = cross(ax, b);
  const tb = upright ? [0, 0, -1] : [0, 1, 0];
  const tc = cross(target, tb);
  // R = T * S^T where S columns = (a, b, c), T columns = (target, tb, tc)
  const S = [ax, b, c], T = [target, tb, tc];
  const R = new Array(9).fill(0); // row-major 3x3
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) {
    let s = 0; for (let k = 0; k < 3; k++) s += T[k][r] * S[k][col]; R[r * 3 + col] = s;
  }
  // roll about the target axis
  const t = (rollDeg * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
  const [ux, uy, uz] = target;
  const Rr = [
    cs + ux * ux * (1 - cs), ux * uy * (1 - cs) - uz * sn, ux * uz * (1 - cs) + uy * sn,
    uy * ux * (1 - cs) + uz * sn, cs + uy * uy * (1 - cs), uy * uz * (1 - cs) - ux * sn,
    uz * ux * (1 - cs) - uy * sn, uz * uy * (1 - cs) + ux * sn, cs + uz * uz * (1 - cs),
  ];
  const M = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) { let s = 0; for (let k = 0; k < 3; k++) s += Rr[r * 3 + k] * R[k * 3 + col]; M[r * 3 + col] = s; }
  return [M[0], M[3], M[6], 0, M[1], M[4], M[7], 0, M[2], M[5], M[8], 0, 0, 0, 0, 1];
}

const slug = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').toLowerCase() || 'part';

// ----------------------------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------------------------
async function main() {
  const inputsArg = args._.length ? args._ : [path.join(REPO, 'models-src', 'turbopump')];
  const files = [];
  for (const p of inputsArg) {
    if (!fs.existsSync(p)) throw new Error(`input not found: ${p}`);
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p).sort()) if (/\.(step|stp|iges|igs|3mf|stl)$/i.test(f)) files.push(path.join(p, f));
    } else files.push(p);
  }
  if (!files.length) {
    throw new Error('no .step/.stp/.iges/.igs/.3mf/.stl files found. Download the GrabCAD model into models-src/turbopump/ first (see CREDITS.turbopump.md).');
  }
  const hasCAD = files.some((f) => /\.(step|stp|iges|igs)$/i.test(f));
  const presetName = args.preset || 'auto';
  const preset = PRESETS[presetName];
  if (!preset) throw new Error(`unknown preset ${presetName}`);
  const meta = {
    title: args.title || preset.meta?.title || 'Turbopump',
    author: args.author || preset.meta?.author || 'unknown',
    sourceUrl: args['source-url'] || preset.meta?.sourceUrl || '',
    license: args.license || preset.meta?.license || 'unknown',
  };

  let out = args.out;
  if (!out) {
    out = hasCAD && !args['author-permission']
      ? path.join(REPO, 'models-src', 'turbopump', 'turbopump.preview.glb')
      : path.join(REPO, 'public', 'models', 'turbopump.glb');
  }
  if (hasCAD) {
    console.warn('[licence] GrabCAD Community models may only be used for your own non-commercial, internal use');
    console.warn('          (GrabCAD Terms s.6.2 / "License restrictions" (b)). Publishing on the website needs the');
    console.warn(`          uploader's written permission. --author-permission: ${args['author-permission'] ? 'given' : 'NOT given'} -> ${out}`);
  }

  // ---- read
  let parts = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    console.log(`reading ${f}`);
    if (ext === '.3mf') parts.push(...read3MF(f));
    else if (ext === '.stl') parts.push(...readSTL(f));
    else if (ext === '.step' || ext === '.stp') parts.push(...(await readOCCT(f, 'step')));
    else parts.push(...(await readOCCT(f, 'iges')));
  }
  const excludeRe = args.exclude ? new RegExp(args.exclude, 'i') : preset.exclude;
  const before = parts.length;
  if (excludeRe) parts = parts.filter((p) => !excludeRe.test(`${p.path.join(' / ')} / ${p.name}`) && !excludeRe.test(p.name));
  parts = parts.filter((p) => p.indices.length >= 3);
  console.log(`bodies: ${parts.length} kept (${before - parts.length} excluded)`);

  // ---- orientation
  const rawBox = unionBox(parts.map((p) => bboxOf(p.positions)));
  let axisSpec = args.axis || preset.axis;
  if (!axisSpec) { const s = rawBox.size; axisSpec = s[0] >= s[1] && s[0] >= s[2] ? 'x' : s[1] >= s[2] ? 'y' : 'z'; }
  const roll = Number(args.roll ?? preset.roll ?? 0);
  const R = orientationMatrix(axisSpec, roll, !!args.upright);
  for (const p of parts) {
    const P = p.positions;
    for (let i = 0; i < P.length; i += 3) { const v = applyMat4(R, P[i], P[i + 1], P[i + 2]); P[i] = v[0]; P[i + 1] = v[1]; P[i + 2] = v[2]; }
    if (p.normals) { const N = p.normals; for (let i = 0; i < N.length; i += 3) { const v = applyMat3(R, N[i], N[i + 1], N[i + 2]); N[i] = v[0]; N[i + 1] = v[1]; N[i + 2] = v[2]; } }
  }
  // ---- centre + scale (longest dimension -> 2 units)
  const box = unionBox(parts.map((p) => bboxOf(p.positions)));
  const scale = 2 / Math.max(...box.size);
  for (const p of parts) {
    const P = p.positions;
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) P[i + k] = (P[i + k] - box.center[k]) * scale;
  }
  const shaftDir = args.upright ? [0, 1, 0] : [1, 0, 0];
  // Shaft line: through the centre of the rotating parts' cross-section (falls back to the origin).

  // ---- classify into groups
  const groups = new Map();
  for (const p of parts) {
    const hay = `${p.path.join(' / ')} / ${p.name}`;
    const rule = preset.groups.find((g) => g.re.test(p.name)) || preset.groups.find((g) => g.re.test(hay)) || { id: 'other', label: 'Other parts', rotating: false };
    if (!groups.has(rule.id)) groups.set(rule.id, { rule, parts: [] });
    groups.get(rule.id).parts.push(p);
  }
  const rotParts = [...groups.values()].filter((g) => g.rule.rotating).flatMap((g) => g.parts);
  const rotBox = rotParts.length ? unionBox(rotParts.map((p) => bboxOf(p.positions))) : null;
  const axisPoint = rotBox ? rotBox.center.map((v, k) => (shaftDir[k] ? 0 : v)) : [0, 0, 0];

  // ---- build glTF
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('Scene');
  const mats = {};
  const matFor = (key) => {
    if (!mats[key]) {
      const d = MATERIALS[key]; const c = hexColor(d.color);
      // glTF baseColorFactor is linear
      const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      mats[key] = doc.createMaterial(key).setBaseColorFactor([...lin, 1]).setMetallicFactor(d.metalness).setRoughnessFactor(d.roughness);
    }
    return mats[key];
  };

  const root = doc.createNode('turbopump');
  scene.addChild(root);
  const ROTOR_ID = 'rotor';
  const rotorNode = rotParts.length ? doc.createNode(ROTOR_ID).setTranslation(axisPoint) : null;
  if (rotorNode) {
    rotorNode.setExtras({ label: 'Rotating assembly', group: ROTOR_ID, spinAxis: shaftDir, note: 'rotate this node about its local spinAxis to spin the rotor' });
    root.addChild(rotorNode);
  }
  const staticNode = doc.createNode('stator');
  staticNode.setExtras({ label: 'Static structure', group: 'stator' });
  root.addChild(staticNode);

  const usedNames = new Set();
  const uniqueName = (n) => { let s = n, i = 2; while (usedNames.has(s)) s = `${n}_${i++}`; usedNames.add(s); return s; };
  const crease = Number(args.crease || 35);
  let totalTris = 0;
  const summaryGroups = [];
  const order = [...preset.groups.map((g) => g.id), 'other'];
  const sortedGroups = [...groups.values()].sort((a, b) => order.indexOf(a.rule.id) - order.indexOf(b.rule.id));
  for (const { rule, parts: gp } of sortedGroups) {
    const parent = rule.rotating && rotorNode ? rotorNode : staticNode;
    const origin = rule.rotating && rotorNode ? axisPoint : [0, 0, 0];
    const gBox = unionBox(gp.map((p) => bboxOf(p.positions)));
    const gNode = doc.createNode(uniqueName(rule.id)).setTranslation(sub(gBox.center, origin));
    // explode direction: along the shaft, away from the assembly centre; static parts also move radially
    const along = gBox.center[shaftDir.indexOf(1)];
    const radial = gBox.center.map((v, k) => (shaftDir[k] ? 0 : v - axisPoint[k]));
    const radialLen = len(radial);
    let dir;
    if (rule.rotating) dir = shaftDir.map((v) => v * (along >= 0 ? 1 : -1));
    else dir = norm(shaftDir.map((v, k) => v * (along >= 0 ? 1 : -1) * 1.0 + (radialLen > 0.05 ? radial[k] / radialLen * 0.6 : 0)));
    const material = matFor(GROUP_MATERIAL[rule.id] || 'steel');
    gNode.setExtras({
      label: rule.label, group: rule.id, rotating: !!rule.rotating,
      explode: dir.map((v) => round(v)),
      explodeDistance: round(rule.rotating ? 0.25 + Math.abs(along) * 0.6 : 0.35 + Math.abs(along) * 0.5, 3),
      hotspot: gBox.center.map((v) => round(v)),
      parts: gp.map((p) => p.name),
    });
    parent.addChild(gNode);
    let gTris = 0;
    for (const p of gp) {
      let geo;
      if (p.normals && p.normals.length === p.positions.length) geo = { positions: p.positions, normals: p.normals, indices: p.indices };
      else geo = creaseNormals(p.positions, p.indices, crease);
      const pBox = bboxOf(geo.positions);
      const local = new Float32Array(geo.positions.length);
      for (let i = 0; i < local.length; i += 3) for (let k = 0; k < 3; k++) local[i + k] = geo.positions[i + k] - pBox.center[k];
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(local))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.normals)))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(geo.positions.length / 3 > 65535 ? new Uint32Array(geo.indices) : new Uint16Array(geo.indices)))
        .setMaterial(material);
      const name = uniqueName(`${rule.id}__${slug(p.name)}`);
      const mesh = doc.createMesh(name).addPrimitive(prim);
      const node = doc.createNode(name).setMesh(mesh).setTranslation(sub(pBox.center, gBox.center));
      node.setExtras({ label: p.name, group: rule.id, sourcePath: p.path.join(' / ') });
      gNode.addChild(node);
      gTris += geo.indices.length / 3;
    }
    totalTris += gTris;
    summaryGroups.push({ id: rule.id, label: rule.label, rotating: !!rule.rotating, bodies: gp.length, triangles: gTris });
  }

  root.setExtras({
    turbopump: {
      ...meta,
      generator: 'scripts/convert-turbopump.mjs',
      units: 'normalised: longest dimension = 2',
      sourceScaleToMeters: round(1 / scale / 1000, 6),
      shaftAxis: { point: axisPoint.map((v) => round(v)), direction: shaftDir },
      groups: summaryGroups,
    },
  });

  // ---- optimise
  const maxTris = Number(args['max-tris'] || 400000);
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  await doc.transform(dedup(), prune({ keepLeaves: true, keepAttributes: true }), weld());
  if (totalTris > maxTris) {
    console.log(`simplifying ${totalTris} -> ~${maxTris} triangles`);
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: maxTris / totalTris, error: 0.0005 }));
  }
  if (!args['no-compress']) {
    doc.createExtension(KHRMeshQuantization).setRequired(true);
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 10 }));
  }

  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsClearcoat]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  const b = getBounds(scene);
  const size = fs.statSync(out).size;
  console.log(`wrote ${out}  ${(size / 1024 / 1024).toFixed(2)} MB  triangles=${totalTris}`);
  console.log(`bounds min=${b.min.map((v) => v.toFixed(3))} max=${b.max.map((v) => v.toFixed(3))}`);
  console.table(summaryGroups);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
