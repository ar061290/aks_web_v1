import 'katex/dist/katex.min.css';
import './styles/main.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { Stage } from './three/stage.js';
import { Director, PHASES, flightAlt } from './three/shots.js';
import { renderDossier, fillStoryText, figInfo, FIG_VIEWS } from './sections/dossier.js';
import { mountRocketCalc, mountBalloonCalc } from './sections/calculator.js';
import { bindFeed } from './sections/feed.js';
import { isa, formatPressure } from './lib/isa.js';
import { rich, esc } from './lib/rich.js';
import { Ambience } from './ui/audio.js';

gsap.registerPlugin(ScrollTrigger);
const asset = (p) => import.meta.env.BASE_URL + p;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
if (reduced) document.documentElement.classList.add('reduced');

// ------------------------------------------------------------------ content
renderDossier($('#dossier-body'), $('#dossier-toc'));
fillStoryText();
mountRocketCalc($('#calc-rocket'));
mountBalloonCalc($('#calc-balloon'));
bindFeed(document);

// ------------------------------------------------------------------ split text
function splitChars(el) {
  const text = el.textContent;
  el.setAttribute('aria-label', text);
  el.innerHTML = text
    .split(' ')
    .map((w) => `<span class="split-wordwrap">${[...w].map((ch) => `<span class="split-char" aria-hidden="true">${esc(ch)}</span>`).join('')}</span>`)
    .join(' ');
}
function splitWords(el) {
  const text = el.textContent.trim();
  el.setAttribute('aria-label', text);
  el.innerHTML = text.split(/\s+/).map((w) => `<span class="split-word" aria-hidden="true">${esc(w)}</span>`).join(' ');
}
$$('[data-split]').forEach(splitChars);
$$('[data-split-words]').forEach(splitWords);

// ------------------------------------------------------------------ loader
const loaderPct = $('#loader-pct');
const loaderBar = $('#loader-bar');
const loadState = { shown: 0, target: 0 };
function setProgress(p) { loadState.target = Math.max(loadState.target, p); }
const loaderTick = () => {
  loadState.shown += (loadState.target - loadState.shown) * 0.12;
  loaderPct.textContent = Math.round(loadState.shown * 100);
  loaderBar.style.transform = `scaleX(${loadState.shown})`;
};
gsap.ticker.add(loaderTick);

// ------------------------------------------------------------------ smooth scroll
const lenis = new Lenis({ lerp: reduced ? 1 : 0.085, smoothWheel: !reduced, wheelMultiplier: 0.9, touchMultiplier: 1.4 });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
lenis.stop();
window.scrollTo(0, 0);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const id = a.getAttribute('href');
  const el = id.length > 1 ? $(id) : null;
  if (!el) return;
  e.preventDefault();
  lenis.scrollTo(el, { offset: 0, duration: 1.6 });
});

// ------------------------------------------------------------------ stage
const director = new Director();
let stage = null;
try {
  stage = new Stage($('#stage'), { onProgress: (p) => setProgress(p * 0.95) });
} catch (err) {
  console.warn('WebGL unavailable', err);
  $('#stage').style.display = 'none';
}

// hotspot info card
const card = document.createElement('div');
card.className = 'hs-card';
card.innerHTML = '<button class="hs-card__x" aria-label="Close">×</button><div class="hs-card__k"></div><div class="hs-card__t"></div><p class="hs-card__d"></p>';
document.body.appendChild(card);
let cardFor = null;
const hideCard = () => { card.classList.remove('is-on'); $$('.hs.is-active').forEach((b) => b.classList.remove('is-active')); cardFor = null; };
card.querySelector('.hs-card__x').addEventListener('click', hideCard);

function showHotspot(key, h, btn) {
  if (stage?.exploring) {
    showExploreCard(h);
    $$('.hs.is-active').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    return;
  }
  if (cardFor === h) return hideCard();
  $$('.hs.is-active').forEach((b) => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  card.querySelector('.hs-card__k').textContent = h.kicker || '';
  card.querySelector('.hs-card__t').textContent = h.label;
  card.querySelector('.hs-card__d').innerHTML = rich(h.text || '');
  const r = btn.getBoundingClientRect();
  const w = Math.min(300, innerWidth - 32);
  let x = r.left + 24;
  if (x + w > innerWidth - 16) x = r.left - w - 12;
  x = Math.max(16, x);
  let y = Math.min(Math.max(70, r.top - 20), innerHeight - 200);
  card.style.left = x + 'px';
  card.style.top = y + 'px';
  card.classList.add('is-on');
  cardFor = h;
}

stage?.bindHotspots($('#hotspots'), showHotspot);

// ------------------------------------------------------------------ explore mode
const explore = $('#explore');
const exploreCard = $('#explore-card');
function showExploreCard(h) {
  exploreCard.hidden = false;
  $('#explore-card-k').textContent = h.kicker || '';
  $('#explore-card-t').textContent = h.label;
  $('#explore-card-d').innerHTML = rich(h.text || '');
  $$('#explore-parts button').forEach((b) => b.classList.toggle('is-active', b.dataset.id === h.id));
}
const TITLES = { rockoon: 'ROCKOON · FIGURE 2', molecules: 'UDMH + N₂O₄', rs25: 'RS-25 · SSME', turbopump: 'TURBOPUMP' };
function openExplore(key) {
  if (!stage) return;
  hideCard();
  lenis.stop();
  document.body.classList.add('is-exploring');
  explore.hidden = false;
  $('#explore-title').textContent = TITLES[key];
  stage.enterExplore(key);
  const obj = stage.objects[key];
  $('#explore-explode-wrap').hidden = !obj.explodable;
  $('#explore-explode').value = 0;
  $('#explore-spin').setAttribute('aria-pressed', String(stage.controls.autoRotate));
  exploreCard.hidden = true;
  $('#explore-parts').innerHTML = obj.hotspots.map((h) => `<button type="button" data-id="${esc(h.id)}">${esc(h.label)}</button>`).join('');
  $$('#explore-parts button').forEach((b, i) => b.addEventListener('click', () => {
    showExploreCard(obj.hotspots[i]);
    $$('.hs').forEach((el, j) => el.classList.toggle('is-active', j === i));
  }));
  gsap.fromTo(explore.children, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.06, ease: 'expo.out' });
  $('#explore-close').focus();
}
function closeExplore() {
  if (!stage?.exploring) return;
  stage.exitExplore();
  document.body.classList.remove('is-exploring');
  explore.hidden = true;
  lenis.start();
}
$$('[data-explore]').forEach((b) => b.addEventListener('click', () => openExplore(b.dataset.explore)));
$('#explore-close').addEventListener('click', closeExplore);
$('#explore-reset').addEventListener('click', () => stage?.resetExplore());
$('#explore-spin').addEventListener('click', (e) => {
  const on = !stage.controls.autoRotate;
  stage.controls.autoRotate = on;
  e.currentTarget.setAttribute('aria-pressed', String(on));
});
$('#explore-explode').addEventListener('input', (e) => {
  const obj = stage.objects[stage.exploring];
  if (obj?.explodable) obj.setExplode(+e.target.value);
});

// ------------------------------------------------------------------ lightbox
const lb = $('#lightbox');
function openLightbox(key) {
  const id = key.replace(/^fig/, '');
  const f = figInfo(id);
  const src = id === '2' ? 'figures/fig2.png' : `figures/fig${id}.webp`;
  $('#lightbox-imgs').innerHTML = `<img src="${asset(src)}" alt="${esc(f.label)}" />`;
  $('#lightbox-cap').innerHTML = `<b>${esc(f.label.toUpperCase())}</b>${rich(f.caption)}${f.source ? ` <span style="opacity:.6">Source: ${rich(f.source)}</span>` : ''}`;
  lb.hidden = false;
  lenis.stop();
  $('#lightbox-close').focus();
}
function closeLightbox() { if (lb.hidden) return; lb.hidden = true; if (!stage?.exploring) lenis.start(); }
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-lightbox]');
  if (t) openLightbox(t.dataset.lightbox);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeLightbox(); closeExplore(); hideCard(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('figure[data-lightbox]')) { e.preventDefault(); openLightbox(e.target.dataset.lightbox); }
});
$('#lightbox-close').addEventListener('click', closeLightbox);
lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
void FIG_VIEWS;

// ------------------------------------------------------------------ touch pads (drag to rotate in-page)
$$('.touchpad').forEach((pad) => {
  let id = null, lastX = 0;
  pad.addEventListener('pointerdown', (e) => { id = e.pointerId; lastX = e.clientX; });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id || !stage) return;
    stage.nudge(pad.dataset.model, e.clientX - lastX);
    lastX = e.clientX;
  });
  const end = () => { id = null; };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  pad.addEventListener('pointerleave', end);
});

// ------------------------------------------------------------------ space background input ("Space Journey")
// Mouse movement steers the vanishing point; press and hold anywhere that is not a control boosts to
// warp speed. Touch: a held finger boosts and steers; starting to scroll cancels it (pointercancel).
const NOT_SPACE = 'a, button, input, select, textarea, label, summary, details, .hs, .hs-card, .touchpad, [data-lightbox], .explore, .lightbox, .rail, .topbar, .calc, .feed, .toc';
let warpPointer = null;
window.addEventListener('pointermove', (e) => {
  if (!stage) return;
  if (e.pointerType === 'mouse' || e.pointerId === warpPointer) stage.warp.aim(e.clientX, e.clientY);
}, { passive: true });
window.addEventListener('pointerdown', (e) => {
  if (!stage || stage.exploring || e.button > 0 || e.target.closest(NOT_SPACE)) return;
  warpPointer = e.pointerId;
  stage.warp.aim(e.clientX, e.clientY);
  stage.warp.boost(true);
}, { passive: true });
const endWarp = (e) => {
  if (!stage || (e && e.pointerId !== undefined && e.pointerId !== warpPointer)) return;
  stage.warp.boost(false);
  if (e && e.pointerType && e.pointerType !== 'mouse') stage.warp.recentre();
  warpPointer = null;
};
window.addEventListener('pointerup', endWarp, { passive: true });
window.addEventListener('pointercancel', endWarp, { passive: true });
window.addEventListener('blur', () => endWarp());

// ------------------------------------------------------------------ audio
const amb = new Ambience();
const audioBtn = $('#audio-toggle');
async function toggleAudio(force) {
  const on = await amb.toggle(force);
  audioBtn.setAttribute('aria-pressed', String(on));
  $('#audio-init').textContent = on ? 'AUDIO ON' : 'INITIATE AUDIO';
}
audioBtn.addEventListener('click', () => toggleAudio());
$('#audio-init').addEventListener('click', () => toggleAudio(true));

// ------------------------------------------------------------------ chapters: rail + top label
const storySections = $$('main > [data-chapter]');
const chapterNames = [];
storySections.forEach((s) => { if (!chapterNames.includes(s.dataset.chapter)) chapterNames.push(s.dataset.chapter); });
$('#rail').innerHTML = chapterNames.map((n) => {
  const first = storySections.find((s) => s.dataset.chapter === n);
  return `<a href="#${first.id}" data-chapter="${n}"><span>${n}</span><i></i></a>`;
}).join('');
const railLinks = $$('#rail a');
const chapterLabel = $('#chapter-label');
let lastLabel = '';

// ------------------------------------------------------------------ reveals
function setupReveals() {
  $$('[data-reveal]').forEach((el) => {
    gsap.to(el, {
      opacity: 1, y: 0, duration: reduced ? 0.01 : 1.1, ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 92%', once: true },
      delay: (el.parentElement ? [...el.parentElement.children].indexOf(el) : 0) * 0.05,
    });
  });
  $$('[data-split]').forEach((el) => {
    gsap.fromTo(el.querySelectorAll('.split-char'), { yPercent: 110, opacity: 0 }, {
      yPercent: 0, opacity: 1, duration: reduced ? 0.01 : 1.2, stagger: 0.045, ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
  });
  $$('[data-split-words]').forEach((el) => {
    gsap.fromTo(el.querySelectorAll('.split-word'), { opacity: 0.08 }, {
      opacity: 1, stagger: 0.08, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top 80%', end: 'bottom 45%', scrub: reduced ? false : 0.6 },
    });
  });
  // panel titles + spec rows
  $$('.panel').forEach((panel) => {
    const items = panel.querySelectorAll('.title, .subtitle, .body, .specs > div, .actions, .hint, .credit');
    gsap.fromTo(items, { opacity: 0, y: 22 }, {
      opacity: 1, y: 0, duration: reduced ? 0.01 : 1, stagger: 0.06, ease: 'expo.out',
      scrollTrigger: { trigger: panel, start: 'top 82%', toggleActions: 'play none none reverse' },
    });
  });
}

// ------------------------------------------------------------------ per-frame UI
const hud = $('#hud');
const hudAlt = $('#hud-alt'), hudP = $('#hud-p'), hudPhase = $('#hud-phase'), hudTitle = $('#hud-title'), hudDesc = $('#hud-desc'), hudArc = $('#hud-arc');
const hudIcon = $('#hud-icon');
const flightRun = $('#flight-run');
const marqueeRows = () => $$('.marquee__row');
const molA = $('#mol-label-a'), molB = $('#mol-label-b');
const touchSections = $$('[data-touch]');
const TOUCH_STATE = { rockoon: 'rockoon', molecules: 'mol', rs25: 'rs25', turbopump: 'tp' };
const dossierChapters = $$('#dossier-body .chapter');
let lastPhase = -1;
let time = 0;
const proj = { x: 0, y: 0, visible: false };

function frameUI(st) {
  const vh = innerHeight;
  const c = scrollY + vh * 0.5;

  // chapter label + rail
  let active = storySections[0];
  for (const s of storySections) { const r = s.getBoundingClientRect(); if (r.top + scrollY <= c) active = s; }
  let label = active.dataset.chapter;
  if (active.id === 'dossier' || (active.id === 'why' && false)) {
    for (const ch of dossierChapters) { const r = ch.getBoundingClientRect(); if (r.top < vh * 0.5) label = ch.dataset.dossierTitle.toUpperCase(); }
  }
  const dossierBody = $('#dossier-body').getBoundingClientRect();
  if (dossierBody.top < vh * 0.5 && dossierBody.bottom > vh * 0.5) {
    label = 'DOSSIER';
    for (const ch of dossierChapters) { const r = ch.getBoundingClientRect(); if (r.top < vh * 0.5) label = ch.dataset.dossierTitle.toUpperCase(); }
  }
  const idx = chapterNames.indexOf(active.dataset.chapter);
  const text = `${String(Math.max(0, idx)).padStart(2, '0')} / ${label}`;
  if (text !== lastLabel) {
    chapterLabel.textContent = text;
    railLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.chapter === active.dataset.chapter));
    lastLabel = text;
  }

  // HUD for the flight profile
  const fr = flightRun.getBoundingClientRect();
  const inFlight = fr.top < vh * 0.5 && fr.bottom > vh * 0.5;
  hud.classList.toggle('is-on', inFlight);
  if (inFlight) {
    const p = Math.min(1, Math.max(0, (vh * 0.5 - fr.top) / fr.height));
    const alt = flightAlt(p);
    const phase = Math.min(3, Math.floor(p * 4));
    hudAlt.textContent = `${alt.toFixed(1)} KM`;
    hudP.textContent = formatPressure(isa(alt * 1000).P);
    if (phase !== lastPhase) {
      hudPhase.textContent = `PHASE ${phase + 1}`;
      hudTitle.textContent = PHASES[phase].title;
      hudDesc.textContent = PHASES[phase].desc;
      gsap.fromTo([hudPhase, hudTitle, hudDesc], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.06, ease: 'expo.out' });
      lastPhase = phase;
    }
    hudArc.setAttribute('stroke-dasharray', `${(p * 500).toFixed(1)} 1000`);
    hudIcon.querySelector('.i-balloon').style.opacity = st.burst > 0.05 ? 0 : 1;
    hudIcon.querySelector('.i-string').style.opacity = st.burst > 0.05 ? 0 : 1;
    hudIcon.querySelector('.i-flame').style.opacity = st.flame > 0.05 ? 1 : 0;
    hudIcon.querySelector('.i-rocket').style.transform = `translateY(${-st.sep * 4}px)`;
    amb.setFlight(st.flame, alt / 100);
  } else {
    amb.setFlight(0, 0);
  }

  // advantages marquee drift
  const adv = $('#advantages').getBoundingClientRect();
  if (adv.bottom > 0 && adv.top < vh) {
    const p = 1 - (adv.bottom / (adv.height + vh));
    const rows = marqueeRows();
    rows.forEach((r, i) => {
      const base = (p * 36 + time * (reduced ? 0 : 0.9)) % 50;
      r.style.transform = `translate3d(${i % 2 ? -50 + base : -base}%,0,0)`;
    });
  }

  if (!stage) return;

  // hotspots for the section under the viewport centre
  let touchKey = null;
  for (const s of touchSections) {
    const r = s.getBoundingClientRect();
    if (r.top < vh * 0.5 && r.bottom > vh * 0.5) touchKey = s.dataset.touch;
  }
  if (!stage.exploring) {
    stage.setHotspotSet(touchKey);
    stage.hotspotsEnabled = !!touchKey && st[TOUCH_STATE[touchKey]] > 0.97;
    if (!touchKey && cardFor) hideCard();
    stage.resetNudges(touchKey);
  }

  // molecule labels
  const molOn = st.mol > 0.9 && !stage.exploring;
  for (const [el, anchor] of [[molA, stage.molecules.anchorA], [molB, stage.molecules.anchorB]]) {
    if (molOn) {
      stage.project(anchor, proj);
      el.style.transform = `translate3d(${proj.x}px, ${proj.y}px, 0) translate(-50%, 0)`;
    }
    el.classList.toggle('is-on', molOn);
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  const minDelay = new Promise((r) => setTimeout(r, reduced ? 200 : 1400));
  const fonts = document.fonts?.ready ?? Promise.resolve();
  try {
    if (stage) await stage.load();
  } catch (err) {
    console.error(err);
  }
  await Promise.all([fonts, minDelay]);
  setProgress(1);

  director.measure();
  setupReveals();
  ScrollTrigger.addEventListener('refresh', () => director.measure());
  ScrollTrigger.refresh();
  window.addEventListener('resize', () => { director.measure(); });
  // images in the dossier change layout as they load
  $$('#dossier-body img').forEach((img) => img.addEventListener('load', () => ScrollTrigger.refresh(), { once: true }));

  gsap.ticker.add((t, deltaMs) => {
    const dt = Math.min(deltaMs / 1000, 0.05);
    time += dt;
    const st = director.stateAt(scrollY);
    frameUI(st);
    if (stage && !document.hidden) {
      stage.setState(st);
      stage.render(dt);
    }
  });

  await new Promise((r) => setTimeout(r, 450));
  gsap.ticker.remove(loaderTick);
  loaderPct.textContent = '100';
  loaderBar.style.transform = 'scaleX(1)';
  $('#loader').classList.add('is-done');
  document.body.classList.remove('is-loading');
  lenis.start();
  window.__aks = { lenis, director, stage, ScrollTrigger };
  // hero intro
  const hc = $('#hero');
  gsap.fromTo(hc.querySelectorAll('.split-char'), { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.4, stagger: 0.06, ease: 'expo.out', delay: 0.15 });
  const n = { v: 0 };
  gsap.to(n, { v: 100, duration: 2.2, ease: 'expo.out', delay: 0.3, onUpdate: () => { $('.counter--hero .counter__num').textContent = Math.round(n.v); } });
  if (location.hash && $(location.hash)) setTimeout(() => lenis.scrollTo($(location.hash), { immediate: true }), 50);
}

boot();
