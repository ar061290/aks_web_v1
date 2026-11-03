// Generative ambience with the Web Audio API: a slow detuned pad, a thin high-altitude wind,
// and an engine rumble that follows the plume. No audio files, nothing to license.
export class Ambience {
  constructor() {
    this.ctx = null;
    this.on = false;
  }

  _build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;

    // reverb from a generated impulse response
    const ir = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6);
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    const verbGain = ctx.createGain();
    verbGain.gain.value = 0.55;
    verb.connect(verbGain).connect(master);

    // pad: A minor add9 spread, slowly breathing low-pass
    const padBus = ctx.createGain();
    padBus.gain.value = 0.11;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.6;
    padBus.connect(lp);
    lp.connect(master);
    lp.connect(verb);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 420;
    lfo.connect(lfoAmt).connect(lp.frequency);
    lfo.start();
    const notes = [55, 110, 164.81, 220, 246.94, 329.63];
    notes.forEach((f, i) => {
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = i < 2 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = det + (i % 2 ? 3 : -2);
        const g = ctx.createGain();
        g.gain.value = i < 2 ? 0.5 : 0.18;
        // slow independent swell per voice
        const sw = ctx.createOscillator();
        sw.frequency.value = 0.03 + i * 0.011;
        const swg = ctx.createGain();
        swg.gain.value = g.gain.value * 0.6;
        sw.connect(swg).connect(g.gain);
        sw.start();
        o.connect(g).connect(padBus);
        o.start();
      }
    });

    // noise source shared by wind and rumble
    const nb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; nd[i] = last * 3.5; }
    const noise = ctx.createBufferSource();
    noise.buffer = nb;
    noise.loop = true;
    noise.start();

    const windF = ctx.createBiquadFilter();
    windF.type = 'bandpass';
    windF.frequency.value = 520;
    windF.Q.value = 0.8;
    const wind = ctx.createGain();
    wind.gain.value = 0.05;
    noise.connect(windF).connect(wind).connect(master);
    this.wind = wind;

    const rumbleF = ctx.createBiquadFilter();
    rumbleF.type = 'lowpass';
    rumbleF.frequency.value = 140;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    noise.connect(rumbleF).connect(rumble).connect(master);
    const crackleF = ctx.createBiquadFilter();
    crackleF.type = 'highpass';
    crackleF.frequency.value = 1800;
    const crackle = ctx.createGain();
    crackle.gain.value = 0;
    noise.connect(crackleF).connect(crackle).connect(master);
    this.rumble = rumble;
    this.crackle = crackle;
  }

  async toggle(force) {
    const next = force ?? !this.on;
    if (next && !this.ctx) this._build();
    if (!this.ctx) return false;
    const t = this.ctx.currentTime;
    if (next) {
      await this.ctx.resume();
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0.7, t, 0.8);
    } else {
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0, t, 0.25);
    }
    this.on = next;
    return next;
  }

  // flame 0..1, altitude 0..1 (thin air = less wind)
  setFlight(flame, alt01) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.rumble.gain.setTargetAtTime(flame * 0.9, t, 0.12);
    this.crackle.gain.setTargetAtTime(flame * 0.05, t, 0.12);
    this.wind.gain.setTargetAtTime(0.05 * (1 - Math.min(1, alt01 * 1.4)) + 0.008, t, 0.3);
  }
}
