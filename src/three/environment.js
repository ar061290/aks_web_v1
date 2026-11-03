import * as THREE from 'three';

// ------------------------------------------------------------------ sky dome (altitude-aware atmosphere colour)
export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    transparent: true,
    uniforms: {
      uAlt: { value: 1 }, // 0 = ground, 1 = space
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uHorizon: { value: 0 }, // horizon elevation (sin) for the current altitude
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlt; uniform vec3 uSun; uniform float uHorizon;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float e = d.y - uHorizon;
        float up = clamp(e, 0.0, 1.0);
        float a = clamp(uAlt, 0.0, 1.0);
        vec3 zenithG = vec3(0.015, 0.075, 0.28);
        vec3 horizG = vec3(0.16, 0.30, 0.55);
        vec3 zenithS = vec3(0.004, 0.010, 0.035);
        vec3 horizS = vec3(0.10, 0.28, 0.62);
        float k = smoothstep(0.0, 0.55, a);
        vec3 zen = mix(zenithG, zenithS, k);
        vec3 hor = mix(horizG, horizS, k);
        vec3 col = mix(hor, zen, pow(up, 0.42));
        // thin bright band right at the horizon, strongest at mid altitude
        float band = exp(-abs(e) * mix(18.0, 60.0, k)) * mix(0.18, 0.7, k);
        col += vec3(0.35, 0.6, 1.0) * band;
        // sun glow
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.85, 0.6) * pow(s, 64.0) * (1.0 - k * 0.5) * 0.5;
        float alpha = 1.0 - smoothstep(0.32, 0.9, a);
        alpha = max(alpha, band * (1.0 - smoothstep(0.85, 1.0, a)));
        if (e < -0.02) alpha *= 0.0;
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(850, 48, 24), mat);
  mesh.renderOrder = -9;
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------ Earth
const LAT_HYD = 17.39 * (Math.PI / 180);
const LON_HYD = 78.49 * (Math.PI / 180);

// Unit direction of a lat/lon on a three.js SphereGeometry with an equirectangular map.
export function latLonDir(lat, lon) {
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

export function createEarth(tex, { radius = 40, segments = 128 } = {}) {
  for (const k of ['day', 'night']) tex[k].colorSpace = THREE.SRGBColorSpace;
  for (const k of Object.keys(tex)) { tex[k].anisotropy = 8; tex[k].wrapS = THREE.RepeatWrapping; }

  const group = new THREE.Group();
  group.name = 'earth';
  const spin = new THREE.Group(); // oriented so Hyderabad points +Y, then tilted / spun per shot
  group.add(spin);

  const uniforms = {
    uDay: { value: tex.day }, uNight: { value: tex.night }, uClouds: { value: tex.clouds }, uSpec: { value: tex.spec },
    uSun: { value: new THREE.Vector3(1, 0.3, 0.4).normalize() },
    uCloudShift: { value: 0 },
    uOpacity: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDay, uNight, uClouds, uSpec; uniform vec3 uSun; uniform float uCloudShift; uniform float uOpacity;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vP);
        vec3 sun = normalize(uSun);
        float nd = dot(n, sun);
        float day = smoothstep(-0.12, 0.22, nd);
        vec3 dayC = texture2D(uDay, vUv).rgb;
        vec3 nightC = texture2D(uNight, vUv).rgb;
        float cl = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0)).r;
        cl = smoothstep(0.12, 0.95, cl);
        float water = texture2D(uSpec, vUv).r;
        float lit = max(nd, 0.0);
        vec3 col = dayC * (lit * 1.35 + 0.015);
        col = mix(col, vec3(0.95, 0.97, 1.0) * (lit * 1.25 + 0.01), cl * 0.9);
        vec3 h = normalize(sun + v);
        col += vec3(1.0, 0.93, 0.8) * water * (1.0 - cl) * pow(max(dot(n, h), 0.0), 70.0) * 0.9 * day;
        vec3 lights = nightC * nightC * vec3(1.0, 0.72, 0.42) * 2.2;
        col += lights * (1.0 - day) * (1.0 - cl * 0.85);
        float fr = pow(1.0 - max(dot(n, v), 0.0), 2.6);
        float twilight = smoothstep(-0.3, 0.35, nd);
        col += vec3(0.22, 0.5, 1.0) * fr * (0.08 + 0.9 * twilight);
        // warm terminator
        col += vec3(1.0, 0.45, 0.15) * exp(-pow(nd * 6.0, 2.0)) * 0.06 * (1.0 - cl);
        gl_FragColor = vec4(col, uOpacity);
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments / 2), mat);
  earth.name = 'earthMesh';
  // align Hyderabad with +Y
  earth.quaternion.setFromUnitVectors(latLonDir(LAT_HYD, LON_HYD), new THREE.Vector3(0, 1, 0));
  spin.add(earth);

  // atmosphere halo (back side, analytic ray distance so it hugs the limb)
  const haloUniforms = { uCenter: { value: new THREE.Vector3() }, uR: { value: radius }, uRh: { value: radius * 1.09 }, uSun: uniforms.uSun, uOpacity: { value: 1 } };
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.09, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: haloUniforms,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vP;
        void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uCenter; uniform float uR; uniform float uRh; uniform vec3 uSun; uniform float uOpacity;
        varying vec3 vP;
        void main() {
          vec3 rd = normalize(vP - cameraPosition);
          vec3 oc = uCenter - cameraPosition;
          float t = dot(oc, rd);
          float d = length(oc - rd * t);
          float x = clamp((uRh - d) / (uRh - uR), 0.0, 1.0);
          float g = pow(x, 2.6);
          vec3 sideDir = normalize((cameraPosition + rd * t) - uCenter);
          float sunF = smoothstep(-0.55, 0.45, dot(sideDir, normalize(uSun)));
          vec3 col = mix(vec3(0.15, 0.4, 1.0), vec3(0.55, 0.8, 1.0), g) * g * (0.15 + 1.25 * sunF);
          gl_FragColor = vec4(col * uOpacity, 1.0);
        }`,
    })
  );
  halo.name = 'halo';
  group.add(halo);

  return {
    group, spin, earth, halo, uniforms, haloUniforms, radius,
    update(time) {
      uniforms.uCloudShift.value = (time * 0.0012) % 1;
      group.getWorldPosition(haloUniforms.uCenter.value);
      const s = group.scale.x;
      haloUniforms.uR.value = radius * s;
      haloUniforms.uRh.value = radius * 1.09 * s;
    },
  };
}
