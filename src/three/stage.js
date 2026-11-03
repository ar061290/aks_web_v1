import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createSky, createEarth } from './environment.js';
import { Warpfield } from './warpfield.js';
import { createRockoon } from './rockoon.js';
import { createMolecules } from './molecules.js';
import { createLoader, setupRS25, setupTurbopump } from './models.js';
import { DEFAULT_STATE } from './shots.js';

const asset = (p) => import.meta.env.BASE_URL + p;
const isMobile = matchMedia('(max-width: 820px), (pointer: coarse)').matches;

const VignettePass = {
  uniforms: { tDiffuse: { value: null }, uDark: { value: 0.62 }, uOffset: { value: 0.9 }, uSat: { value: 1.12 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uDark; uniform float uOffset; uniform float uSat; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      vec2 uv = (vUv - 0.5) * vec2(uOffset);
      float v = clamp(1.0 - dot(uv, uv) * uDark * 2.2, 0.0, 1.0);
      gl_FragColor = vec4(c.rgb * mix(0.25, 1.0, v), c.a);
    }`,
};

export class Stage {
  constructor(canvas, { onProgress } = {}) {
    this.canvas = canvas;
    this.state = { ...DEFAULT_STATE };
    this.userRot = { rockoon: 0, molecules: 0, rs25: 0, turbopump: 0 };
    this.userRotTarget = { ...this.userRot };
    this.time = 0;
    this.exploring = null;
    this.hotspotEls = [];
    this.activeHotspotSet = null;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.6 : 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 1);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    // space background: akm2's "Space Journey" starfield, drawn to a canvas used as the scene background
    this.warp = new Warpfield({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches });
    scene.background = this.warp.texture;
    scene.backgroundIntensity = 1;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 2000);
    camera.position.set(0, 2, 12);
    this.camera = camera;
    this.lookTarget = new THREE.Vector3();

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.42;

    // lights: a hard sun, a cool rim from behind and a faint fill, like the reference's studio look
    this.sunDir = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();
    const sun = new THREE.DirectionalLight(0xfff3e2, 2.3);
    sun.position.copy(this.sunDir).multiplyScalar(50);
    scene.add(sun);
    this.sun = sun;
    const rim = new THREE.DirectionalLight(0x9cc4ff, 1.4);
    rim.position.set(6, 3, -8);
    scene.add(rim);
    const fill = new THREE.HemisphereLight(0x8fb2ff, 0x0b0c10, 0.35);
    scene.add(fill);

    // post
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.26, 0.45, 0.96);
    composer.addPass(this.bloom);
    this.vignette = new ShaderPass(VignettePass);
    composer.addPass(this.vignette);
    composer.addPass(new OutputPass());
    this.composer = composer;

    this.manager = new THREE.LoadingManager();
    if (onProgress) this.manager.onProgress = (url, loaded, total) => onProgress(loaded / total);

    this.raycaster = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  async load() {
    // the rocket livery is drawn on a canvas in Orbitron, so wait for the face first
    try { await Promise.all([document.fonts.load('700 74px Orbitron'), document.fonts.load('400 30px Orbitron')]); } catch { /* fall back to Arial */ }
    const texLoader = new THREE.TextureLoader(this.manager);
    const tl = (p) => new Promise((res, rej) => texLoader.load(asset(p), res, undefined, rej));
    const gltfLoader = createLoader(this.manager);
    const gl = (p) => new Promise((res, rej) => gltfLoader.load(asset(p), res, undefined, rej));
    const [day, night, clouds, spec, rs25, tp] = await Promise.all([
      tl('textures/earth_day.jpg'), tl('textures/earth_night.jpg'),
      tl('textures/earth_clouds.jpg'), tl('textures/earth_specular.jpg'),
      gl('models/rs25.glb'), gl('models/turbopump.glb'),
    ]);
    const s = this.scene;
    this.sky = createSky();
    s.add(this.sky);
    this.earth = createEarth({ day, night, clouds, spec }, { radius: 40, segments: isMobile ? 96 : 160 });
    this.earth.uniforms.uSun.value.copy(this.sunDir);
    this.sky.material.uniforms.uSun.value.copy(this.sunDir);
    s.add(this.earth.group);

    this.rockoon = createRockoon();
    s.add(this.rockoon.root);
    this.molecules = createMolecules();
    s.add(this.molecules.root);
    this.rs25 = setupRS25(rs25);
    s.add(this.rs25.root);
    this.turbopump = setupTurbopump(tp);
    s.add(this.turbopump.root);

    this.objects = { rockoon: this.rockoon, molecules: this.molecules, rs25: this.rs25, turbopump: this.turbopump };
    this.renderer.compile(s, this.camera);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.portrait = h > w * 1.05;
    this.warp.resize(w, h);
  }

  setState(s) { this.state = s; }

  // ----------------------------------------------------------- per-frame application of the scroll state
  applyState(dt) {
    const st = this.state;
    const cam = this.camera;
    const portrait = this.portrait;
    if (!this.exploring) {
      // portrait screens: pull back and recentre so objects stay in frame
      const pb = portrait ? (st.portraitPull ?? 1.45) : 1;
      const tx = portrait ? (st.pKeepX ? st.tgtX : (st.ptX ?? 0) + st.tgtX * 0.15) : st.tgtX;
      const ty = portrait ? st.tgtY + (st.ptY ?? 0) : st.tgtY;
      this.lookTarget.set(tx, ty, st.tgtZ);
      const off = this._v.set(st.camX - st.tgtX, st.camY - st.tgtY, st.camZ - st.tgtZ).multiplyScalar(pb);
      cam.position.set(tx, ty, st.tgtZ).add(off);
      cam.lookAt(this.lookTarget);
      if (cam.fov !== st.fov) { cam.fov = st.fov; cam.updateProjectionMatrix(); }
    }

    // user drag rotation eases toward its target
    for (const k in this.userRot) this.userRot[k] += (this.userRotTarget[k] - this.userRot[k]) * Math.min(1, dt * 8);

    const { rockoon, molecules, rs25, turbopump, earth } = this;
    // portrait screens: centre the hero object horizontally
    const ox = portrait && !st.pKeepX ? 0 : 1;
    const ex = this.exploring;
    const show = (key, amt) => (ex ? (ex === key ? 1 : 0) : amt);

    // rockoon
    const rk = show('rockoon', st.rockoon);
    rockoon.root.visible = rk > 0.002;
    rockoon.root.scale.setScalar(Math.max(rk, 0.0001) * st.rkScale);
    if (!ex) rockoon.root.position.set(st.rkX * ox, st.rkY, st.rkZ);
    else rockoon.root.position.set(0, -2.6, 0);
    rockoon.root.rotation.set(st.rkTilt, st.rkRotY + this.userRot.rockoon, 0);
    rockoon.setState({ inflate: ex ? 1 : st.inflate, burst: ex ? 0 : st.burst, strings: 1, flame: ex ? 0 : st.flame, sep: ex ? 0 : st.sep, rocketOnly: ex ? 0 : st.rocketOnly });
    rockoon.update(this.time);

    // molecules
    const mo = show('molecules', st.mol);
    molecules.root.visible = mo > 0.002;
    molecules.root.scale.setScalar(Math.max(mo, 0.0001) * 1.0);
    if (!ex) molecules.root.position.set(st.molX * ox, st.molY, 0);
    else molecules.root.position.set(0, 0, 0);
    molecules.root.rotation.y = this.userRot.molecules;
    molecules.update(this.time);

    // RS-25
    const r = show('rs25', st.rs25);
    rs25.root.visible = r > 0.002;
    rs25.root.scale.setScalar(Math.max(r, 0.0001) * 1.55);
    if (!ex) rs25.root.position.set(st.rsX * ox, st.rsY, 0); else rs25.root.position.set(0, 0, 0);
    rs25.root.rotation.set(0.0, st.rsRotY + this.userRot.rs25, 0);
    if (!ex) rs25.setExplode(st.rsExplode);

    // turbopump
    const t = show('turbopump', st.tp);
    turbopump.root.visible = t > 0.002;
    turbopump.root.scale.setScalar(Math.max(t, 0.0001) * 1.75);
    if (!ex) turbopump.root.position.set(st.tpX * ox, st.tpY, 0); else turbopump.root.position.set(0, 0, 0);
    turbopump.root.rotation.set(st.tpTilt, st.tpRotY + this.userRot.turbopump, 0);
    if (!ex) turbopump.setExplode(st.tpExplode);
    turbopump.update(this.time, 1);

    // earth
    const eo = ex ? 0 : st.earth;
    earth.group.visible = eo > 0.002;
    earth.uniforms.uOpacity.value = eo;
    earth.haloUniforms.uOpacity.value = eo;
    earth.group.position.set(st.earthX, st.earthY, st.earthZ);
    earth.group.scale.setScalar(st.earthScale);
    earth.spin.rotation.set(st.earthTilt, st.earthSpin + this.time * 0.004, 0);
    earth.update(this.time);

    // the sky dome follows the camera; the starfield is a screen-space background
    this.sky.position.copy(cam.position);
    const alt01 = ex ? 1 : st.sky;
    this.sky.material.uniforms.uAlt.value = alt01;
    this.sky.visible = alt01 < 0.999;
    // horizon dip seen from altitude above a sphere of the current earth size
    const R = 40 * st.earthScale;
    const hAbove = Math.max(0.001, cam.position.distanceTo(earth.group.position) - R);
    this.sky.material.uniforms.uHorizon.value = -Math.sqrt(Math.max(0, 1 - Math.pow(R / (R + hAbove), 2))) * 0.6;
    this.scene.backgroundIntensity = ex ? 0.85 : st.stars;
  }

  // ----------------------------------------------------------- hotspots (DOM markers projected from 3D)
  bindHotspots(container, onSelect) {
    this.hsContainer = container;
    this.onHotspotSelect = onSelect;
  }

  setHotspotSet(key) {
    if (this.activeHotspotSet === key) return;
    this.activeHotspotSet = key;
    this.hsContainer.innerHTML = '';
    this.hotspotEls = [];
    if (!key) return;
    const obj = this.objects[key];
    for (const h of obj.hotspots) {
      const b = document.createElement('button');
      b.className = 'hs is-off' + (h.sketch ? ' hs--sketch is-labelled' : '');
      b.type = 'button';
      b.setAttribute('aria-label', h.label);
      b.innerHTML = `<span class="hs__label">${h.label}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.onHotspotSelect?.(key, h, b); });
      this.hsContainer.appendChild(b);
      this.hotspotEls.push({ el: b, h, obj });
    }
  }

  updateHotspots() {
    if (!this.hotspotEls.length) return;
    const cam = this.camera;
    const v = this._v;
    const toCam = this._v2;
    for (const { el, h, obj } of this.hotspotEls) {
      const visible = obj.root.visible && obj.root.scale.x > 0.6 * (obj === this.rs25 ? 1.55 : obj === this.turbopump ? 1.75 : obj === this.rockoon ? this.state.rkScale : 1);
      v.copy(h.pos);
      obj.root.localToWorld(v);
      // hide markers on the far side of the object
      const c = (this._tmpC ||= new THREE.Vector3()).copy(obj.center);
      obj.root.localToWorld(c);
      toCam.copy(cam.position).sub(c).normalize();
      const facing = (this._tmpD ||= new THREE.Vector3()).copy(v).sub(c).normalize().dot(toCam);
      v.project(cam);
      // on portrait screens the text panel covers the lower half of the page: keep markers above it
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && (this.exploring || !this.portrait || v.y > 0.2);
      const x = (v.x * 0.5 + 0.5) * this.width;
      const y = (-v.y * 0.5 + 0.5) * this.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      // keep markers out of the top bar strip, where they could not be tapped
      el.classList.toggle('is-off', !(visible && onScreen && this.hotspotsEnabled && y > 70));
      el.classList.toggle('is-behind', facing < -0.25);
    }
  }

  // screen position of an object anchor (used for molecule labels)
  project(obj3d, out) {
    const v = this._v;
    obj3d.getWorldPosition(v);
    v.project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    out.visible = v.z < 1;
    return out;
  }

  // ----------------------------------------------------------- explore mode
  enterExplore(key) {
    this.exploring = key;
    const obj = this.objects[key];
    const cam = this.camera;
    if (!this.controls) {
      this.controls = new OrbitControls(cam, this.canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.rotateSpeed = 0.7;
      this.controls.zoomSpeed = 0.8;
      this.controls.panSpeed = 0.6;
      this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    }
    const dist = { rockoon: 19, molecules: 7.5, rs25: 6.4, turbopump: 6.2 }[key] * (this.portrait ? 1.5 : 1);
    const tgt = { rockoon: new THREE.Vector3(0, 1.8, 0), molecules: new THREE.Vector3(0, 0, 0), rs25: new THREE.Vector3(0, 0, 0), turbopump: new THREE.Vector3(0, 0.1, 0) }[key];
    this.controls.target.copy(tgt);
    this.controls.minDistance = dist * 0.3;
    this.controls.maxDistance = dist * 2.2;
    cam.fov = 38;
    cam.updateProjectionMatrix();
    cam.position.set(tgt.x + dist * 0.55, tgt.y + dist * 0.18, tgt.z + dist * 0.82);
    this.exploreHome = { pos: cam.position.clone(), tgt: tgt.clone() };
    this.controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.enabled = true;
    this.controls.update();
    if (obj.explodable) obj.setExplode(0);
    this.setHotspotSet(null);
    this.setHotspotSet(key);
    this.hotspotsEnabled = true;
  }

  resetExplore() {
    if (!this.exploreHome) return;
    this.camera.position.copy(this.exploreHome.pos);
    this.controls.target.copy(this.exploreHome.tgt);
    this.controls.update();
  }

  exitExplore() {
    this.exploring = null;
    if (this.controls) this.controls.enabled = false;
    this.setHotspotSet(null);
  }

  // ----------------------------------------------------------- drag rotation from the in-page touch pads
  nudge(key, dx) {
    if (key in this.userRotTarget) this.userRotTarget[key] += dx * 0.009;
  }
  resetNudges(except) {
    for (const k in this.userRotTarget) if (k !== except) this.userRotTarget[k] = this.userRot[k] = 0;
  }

  render(dt) {
    this.time += dt;
    this.applyState(dt);
    if (this.exploring && this.controls) this.controls.update();
    this.updateHotspots();
    if (this.scene.backgroundIntensity > 0.01) this.warp.update(dt);
    this.composer.render(dt);
  }
}
