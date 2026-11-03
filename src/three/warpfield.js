/*
 * Space background: "Space Journey" by Akimitsu Hamamuro (akm2), https://codepen.io/akm2/pen/RwQXLdP
 *
 * The MIT License (MIT)
 * Copyright (c) 2026 Akimitsu Hamamuro (https://codepen.io/akm2/pen/RwQXLdP)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
 * OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Adapted for this site: the pen's drawing loop renders into an offscreen canvas that becomes the
 * three.js scene background; it is stepped from the site's ticker (frame-rate independent) instead of
 * setInterval; input comes from the page (mouse steers, press-and-hold boosts) and touch is mapped
 * the same way (a held finger boosts and steers).
 */
import * as THREE from 'three';

const PARTICLE_NUM = 500;
const PARTICLE_BASE_RADIUS = 0.5;
const FL = 500;
const DEFAULT_SPEED = 2;
const BOOST_SPEED = 300;
const MAX_CANVAS_W = 1920;

function Particle(x, y, z) {
  this.x = x || 0;
  this.y = y || 0;
  this.z = z || 0;
  this.pastZ = 0;
}

export class Warpfield {
  constructor({ reduced = false } = {}) {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
    this.reduced = reduced;
    this.defaultSpeed = reduced ? DEFAULT_SPEED * 0.25 : DEFAULT_SPEED;
    this.boostSpeed = reduced ? DEFAULT_SPEED : BOOST_SPEED;
    this.speed = this.defaultSpeed;
    this.targetSpeed = this.defaultSpeed;
    this.particles = [];
    this.scale = 1;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.resize(window.innerWidth, window.innerHeight);
    this.mouseX = this.aimX = this.centerX;
    this.mouseY = this.aimY = this.centerY;
    for (let i = 0; i < PARTICLE_NUM; i++) {
      this.particles[i] = this.randomizeParticle(new Particle());
      this.particles[i].z -= 500 * Math.random();
    }
  }

  resize(w, h) {
    this.scale = Math.min(1, MAX_CANVAS_W / Math.max(1, w));
    this.canvasWidth = this.canvas.width = Math.max(1, Math.round(w * this.scale));
    this.canvasHeight = this.canvas.height = Math.max(1, Math.round(h * this.scale));
    this.centerX = this.canvasWidth * 0.5;
    this.centerY = this.canvasHeight * 0.5;
    this.context.fillStyle = 'rgb(255, 255, 255)';
    // the texture must be re-allocated at the new size
    this.texture.dispose();
  }

  // page coordinates (CSS px)
  aim(clientX, clientY) {
    this.mouseX = clientX * this.scale;
    this.mouseY = clientY * this.scale;
  }
  // drift the vanishing point back to the middle (used when a finger lifts)
  recentre() {
    this.mouseX = this.centerX;
    this.mouseY = this.centerY;
  }
  boost(on) {
    this.targetSpeed = on ? this.boostSpeed : this.defaultSpeed;
  }

  randomizeParticle(p) {
    p.x = Math.random() * this.canvasWidth;
    p.y = Math.random() * this.canvasHeight;
    p.z = Math.random() * 1500 + 500;
    return p;
  }

  update(dt) {
    const k = Math.min(dt * 60, 3); // the pen stepped at 60 Hz
    const context = this.context;
    const { canvasWidth, canvasHeight, centerX, centerY, particles } = this;

    context.save();
    context.fillStyle = 'rgb(0, 0, 0)';
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    context.restore();

    this.speed += (this.targetSpeed - this.speed) * (1 - Math.pow(0.99, k));
    // light easing so touch jumps do not snap the whole field
    this.aimX += (this.mouseX - this.aimX) * (1 - Math.pow(0.85, k));
    this.aimY += (this.mouseY - this.aimY) * (1 - Math.pow(0.85, k));
    const speed = this.speed * k;

    const halfPi = Math.PI * 0.5;
    const cx = centerX - (this.aimX - centerX) * 1.25;
    const cy = centerY - (this.aimY - centerY) * 1.25;

    context.beginPath();
    for (let i = 0; i < PARTICLE_NUM; i++) {
      const p = particles[i];
      p.pastZ = p.z;
      p.z -= speed;
      if (p.z <= 0) {
        this.randomizeParticle(p);
        continue;
      }
      const rx = p.x - cx;
      const ry = p.y - cy;

      const f = FL / p.z;
      const x = cx + rx * f;
      const y = cy + ry * f;
      const r = PARTICLE_BASE_RADIUS * f;

      const pf = FL / p.pastZ;
      const px = cx + rx * pf;
      const py = cy + ry * pf;
      const pr = PARTICLE_BASE_RADIUS * pf;

      const a = Math.atan2(py - y, px - x);
      const a1 = a + halfPi;
      const a2 = a - halfPi;

      context.moveTo(px + pr * Math.cos(a1), py + pr * Math.sin(a1));
      context.arc(px, py, pr, a1, a2, true);
      context.lineTo(x + r * Math.cos(a2), y + r * Math.sin(a2));
      context.arc(x, y, r, a2, a1, true);
      context.closePath();
    }
    context.fill();
    this.texture.needsUpdate = true;
  }
}
