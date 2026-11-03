import C from '../data/content.json';
import { esc, rich, paras, display, inline } from '../lib/rich.js';
import { feedDiagram } from './feed.js';

const asset = (p) => import.meta.env.BASE_URL + p;

// ---------------------------------------------------------------- figures
export function figInfo(id) {
  const src = C.sources.figures.find((x) => x.id === id)?.source || '';
  for (const f of C.figures) {
    if (f.id === id) return { id, label: f.label, caption: f.caption, source: f.source || src };
    for (const p of f.panels || []) if (p.id === id) return { id, label: `Figure ${id}`, caption: p.caption, source: p.source || src, parent: f.caption };
  }
  return { id, label: `Figure ${id}`, caption: '', source: src };
}

// extra panel images exported for multi-view figures
export const FIG_VIEWS = { 9: ['9-1', '9-2', '9-3', '9-4'], 10: ['10-1', '10-2'], 11: ['11-1', '11-2', '11-3'] };

function fig(id, { dark = false } = {}) {
  const f = figInfo(id);
  return `<figure class="fig${dark ? ' fig--dark' : ''}" data-lightbox="fig${id}" tabindex="0" role="button" aria-label="Open ${esc(f.label)}">
    <img src="${asset(`figures/fig${id}.webp`)}" alt="${esc(f.label)}: ${esc(f.caption)}" loading="lazy" decoding="async" />
    <figcaption><b>${esc(f.label.toUpperCase())}</b>${rich(f.caption)}</figcaption>
  </figure>`;
}

const fns = (list = []) => list.map((f) => `<p class="footnote"><b>${esc(f.marker)}</b>${rich(f.text)}</p>`).join('');

function chapter(n, id, title, sub, body) {
  return `<section class="chapter" id="${id}" data-dossier-title="${esc(title)}">
    <header class="chapter__head" data-reveal>
      <div class="chapter__num">${String(n).padStart(2, '0')}</div>
      <h2 class="chapter__title">${esc(title)}</h2>
      <div class="chapter__sub">${esc(sub)}</div>
    </header>
    <div class="chapter__body">${body}</div>
  </section>`;
}

function eqBlock(step) {
  return `${step.text ? `<p class="eq-text">${rich(step.text)}</p>` : step.step ? `<p class="eq-text"><b>${esc(step.step)}</b></p>` : ''}
  ${step.latex ? `<div class="eq"><div class="eq__m">${display(step.latex)}</div><div class="eq__n">(${step.eq})</div></div>` : ''}`;
}

// ---------------------------------------------------------------- chapters
const COOLING_NOTES = {
  'Heat sinks': 'Thick walls soak up heat for the length of a short burn.',
  'Ablative cooling': 'A liner chars and erodes away, carrying heat with it.',
  'Regenerative cooling': 'Propellant flows through channels or tubes in the wall before it is injected.',
  'Film cooling': 'A thin layer of propellant is sprayed along the wall to shield it.',
  'Radiative cooling': 'A refractory wall glows and radiates its heat away.',
};

function feedChapter() {
  const fs = C.feedSystem;
  return chapter(1, 'd-feed', 'Feed system', `SECTION ${fs.number} · ${fs.title.toUpperCase()}`, `
    <div class="cols">
      <div class="c-7">
        <div class="box">${feedDiagram()}</div>
        <div class="feed-legend"><span><i style="background:#cfe3ff"></i>Helium pressurant</span><span><i style="background:var(--amber)"></i>UDMH (fuel)</span><span><i style="background:#ff7a45"></i>N₂O₄ (oxidizer)</span></div>
      </div>
      <div class="c-5">
        <div class="prose">${paras(fs.paragraphs)}</div>
        <ol class="feed-steps" id="feed-steps">
          <li data-step="he"><div><b>Helium vessel · 5000 psi</b><span>Stores the pressurant. Both propellants are non-reactive to helium.</span></div></li>
          <li data-step="reg"><div><b>Pressure regulator</b><span>Steps the helium down to tank pressure.</span></div></li>
          <li data-step="fuel"><div><b>UDMH tank · 3000 psi</b><span>Helium pressurises the fuel tank.</span></div></li>
          <li data-step="ox"><div><b>N₂O₄ tank · 3000 psi</b><span>…and the oxidizer tank.</span></div></li>
          <li data-step="pumps"><div><b>Low-pressure turbopumps</b><span>Fuel-rich and oxidizer-rich, downstream of the tanks.</span></div></li>
          <li data-step="inj"><div><b>Showerhead injector</b><span>Propellants meet and ignite on contact.</span></div></li>
        </ol>
        <p class="credit">Interactive redraw of Figure 3a. The step order is simplified; the original figure is below.</p>
      </div>
    </div>
    <div style="margin-top:48px">
      <h3 class="h3"><small>REFERENCE CYCLES STUDIED</small>Engine-cycle schematics from the proposal</h3>
      <div class="figs">${fs.figureRefs.map((id) => fig(id)).join('')}</div>
    </div>`);
}

function hardwareChapter() {
  const m = C.materials;
  const inj = C.injector;
  const noz = C.nozzle;
  const cool = C.cooling;
  return chapter(2, 'd-hardware', 'Materials, injector, nozzle, cooling', `SECTIONS ${m.number}–${cool.number}`, `
    <h3 class="h3"><small>SECTION ${m.number}</small>${esc(m.title)}</h3>
    <div class="prose"><p class="dim">${rich(m.intro)}</p></div>
    <div class="cards">${m.items.map((it) => `<div class="card" data-reveal><div class="card__k">${esc(it.component.toUpperCase())}</div><div class="card__t">${esc(it.material)}</div>${it.text ? `<div class="card__d">${rich(it.text)}</div>` : ''}</div>`).join('')}</div>

    <div class="cols" style="margin-top:64px">
      <div class="c-7">
        <h3 class="h3"><small>SECTION ${inj.number}</small>${esc(inj.title)}</h3>
        <div class="prose"><p>${rich(inj.intro)}</p></div>
        ${inj.qualities.map((q) => `<details class="fold"><summary>${esc(q.title.replace(/\.$/, ''))}</summary><div class="fold__body prose"><p class="dim">${rich(q.text)}</p></div></details>`).join('')}
      </div>
      <div class="c-5"><div class="figs" style="grid-template-columns:1fr">${(inj.figureRefs || ['7a']).map((id) => fig(id)).join('')}</div></div>
    </div>

    <div class="cols" style="margin-top:64px">
      <div class="c-5">
        <h3 class="h3"><small>SECTION ${noz.number}</small>${esc(noz.title)}</h3>
        <div class="prose">${paras(noz.paragraphs)}</div>
        <p class="footnote"><b>³</b>${rich(C.architecture.release.footnotes?.[0]?.text || '')}</p>
      </div>
      <div class="c-7"><div class="figs" style="grid-template-columns:1fr">${noz.figureRefs.map((id) => fig(id)).join('')}</div></div>
    </div>

    <div style="margin-top:64px">
      <h3 class="h3"><small>SECTION ${cool.number}</small>${esc(cool.title)}</h3>
      <div class="prose"><p class="dim">${rich(cool.intro)}</p></div>
      <div class="cards">${cool.methods.map((mm, i) => `<div class="card" data-reveal><div class="card__k">CANDIDATE ${i + 1} / 5</div><div class="card__t">${esc(mm)}</div><div class="card__d">${esc(COOLING_NOTES[mm] || '')}</div></div>`).join('')}</div>
      <p class="credit">One-line descriptions are explanatory additions; the proposal lists the five strategies by name.</p>
      <div class="figs" style="margin-top:22px">${cool.figureRefs.map((id) => fig(id)).join('')}</div>
    </div>`);
}

function mathChapter() {
  const k = C.calculations;
  const re = k.rocketEquation;
  const b = k.buoyancy;
  const rd = k.referenceData;
  const fv = k.finalValues;
  const head = k.headline;
  return chapter(3, 'd-math', 'Calculations', `SECTION ${k.number} · TSIOLKOVSKY + BUOYANCY`, `
    <div class="stats">${head.map((h) => `<div class="stat counter" data-reveal><div class="counter__num">${esc(h.value.split(' (')[0].replace(' of hydrogen', ''))}</div><div class="counter__lbl">${esc(h.label)}${h.footnote ? `<sup class="fn-mark">${h.footnote}</sup>` : ''}${h.value.includes('(') ? ' · ' + esc(h.value.split('(')[1].replace(')', '')) : h.value.includes('hydrogen') ? ' · hydrogen' : ''}</div></div>`).join('')}</div>
    ${fns(k.headlineFootnotes)}

    <div class="box" style="margin-top:48px">
      <h3 class="h3"><small>SECTION ${re.number} · INTERACTIVE</small>The rocket equation</h3>
      <div class="hero-eq">${display(re.formula.latex)}</div>
      <div class="calc" id="calc-rocket"></div>
    </div>

    <div class="box">
      <h3 class="h3"><small>SECTION 11.4 · INTERACTIVE</small>How big a balloon?</h3>
      <div class="calc" id="calc-balloon"></div>
    </div>

    <div style="margin-top:48px">
      <details class="fold"><summary>${esc(re.number)} ${esc(re.title)}<small>Equations 1–29</small></summary><div class="fold__body">
        <div class="prose"><p>${rich(re.intro)}</p></div>
        ${eqBlock(re.formula)}
        <div class="prose"><p class="dim">${rich(re.where)}</p><p>${rich(re.conditions)}</p></div>
        ${re.steps.map(eqBlock).join('')}
        <div class="prose" style="margin-top:16px">${paras(Array.isArray(re.conclusion) ? re.conclusion : [re.conclusion])}</div>
        ${fns(re.footnotes)}
      </div></details>
      <details class="fold"><summary>${esc(rd.number)} ${esc(rd.title)}<small>Reference data</small></summary><div class="fold__body prose">
        <p class="dim">${rich(rd.intro)}</p>
        ${(rd.paragraphs || [rd.text]).map((p) => `<p><em>${rich(p)}</em></p>`).join('')}
        ${rd.note ? `<p class="dim">${rich(rd.note)}</p>` : ''}
      </div></details>
      <details class="fold"><summary>${esc(b.number)} ${esc(b.title)}<small>Equations 30–52</small></summary><div class="fold__body">
        <div class="prose"><p>${rich(b.intro)}</p></div>
        ${b.steps.map(eqBlock).join('')}
        <h3 class="h3" style="margin-top:28px">${esc(b.workedSequenceTitle || 'Worked sequence')}</h3>
        <div class="prose"><p class="dim">${rich(b.workedSequenceIntro || '')}</p></div>
        ${b.workedSequence.map(eqBlock).join('')}
        <div class="prose" style="margin-top:16px">${paras(Array.isArray(b.conclusion) ? b.conclusion : [b.conclusion])}</div>
      </div></details>
      <details class="fold" open><summary>${esc(fv.number)} ${esc(fv.title)}<small>${esc(fv.tableLabel || 'Table 1')}</small></summary><div class="fold__body">
        <p class="eq-text">${rich(fv.caption)}</p>
        <div class="table-wrap"><table class="data"><thead><tr><th>${esc(fv.columns[0])}</th><th>${esc(fv.columns[1])}</th></tr></thead><tbody>
        ${fv.rows.map((r) => `<tr><td>${esc(r.quantity)}${r.symbolLatex ? ` (${inline(r.symbolLatex)})` : ''}</td><td class="num">${rich(r.value)}</td></tr>`).join('')}
        </tbody></table></div>
      </div></details>
    </div>`);
}

function balloonChapter() {
  const bl = C.balloon;
  const cmp = bl.comparison;
  const md = bl.medium;
  const vol = bl.volume;
  return chapter(4, 'd-balloon', 'Balloon platform', `SECTION ${bl.number} · ${bl.title.toUpperCase()}`, `
    <h3 class="h3"><small>SECTION ${cmp.number}</small>${esc(cmp.title)}</h3>
    <div class="prose"><p class="dim">${rich(cmp.intro)}</p></div>
    <div class="table-wrap"><table class="data"><thead><tr><th style="width:16%"></th><th>Research balloons</th><th>Weather balloons</th></tr></thead><tbody>
      ${cmp.rows.map((r) => `<tr><td><b>${esc(r.aspect)}</b></td><td>${rich(r.research)}</td><td>${rich(r.weather)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="prose" style="margin-top:16px"><p>${rich(cmp.summary)}</p></div>

    <div class="cols" style="margin-top:56px">
      <div class="c-6">
        <h3 class="h3"><small>SECTION ${md.number}</small>${esc(md.title)}</h3>
        <div class="prose"><p>${rich(md.intro)}</p></div>
        ${md.properties.map((p) => `<details class="fold"><summary>${esc(p.title.replace(/\.$/, ''))}</summary><div class="fold__body prose"><p class="dim">${rich(p.text)}</p></div></details>`).join('')}
      </div>
      <div class="c-6">
        <h3 class="h3"><small>${esc((md.applicationsTitle || 'Research applications').toUpperCase())}</small>Applications</h3>
        <div class="prose"><p class="dim">${rich(md.applicationsIntro || '')}</p></div>
        <div class="cards" style="grid-template-columns:1fr 1fr">${md.applications.map((a) => `<div class="card"><div class="card__t" style="margin-top:0">${esc(a.title.replace(/\.$/, ''))}</div><div class="card__d">${rich(a.text)}</div></div>`).join('')}</div>
        <h3 class="h3" style="margin-top:28px">${esc(md.launchRecoveryCostTitle || 'Launch, recovery, and cost')}</h3>
        <div class="prose">${md.launchRecoveryCost.map((x) => `<p><b>${esc(x.title)}</b> ${rich(x.text)}</p>`).join('')}<p class="dim">${rich(md.closing)}</p></div>
      </div>
    </div>

    <div style="margin-top:56px">
      <h3 class="h3"><small>SECTION ${vol.number}</small>${esc(vol.title)}</h3>
      <div class="prose">${paras(vol.paragraphs)}</div>
      ${fns(vol.footnotes)}
    </div>`);
}

function permitsChapter() {
  const p = C.permits;
  const reg = C.sources.regulatory;
  return chapter(5, 'd-permits', 'Permits required', `SECTION ${p.number} · BEFORE ANY FLIGHT ATTEMPT`, `
    <div class="prose"><p class="dim">${rich(p.intro)}</p></div>
    <ol class="permits">${p.items.map((it) => `<li data-reveal>${rich(it)}</li>`).join('')}</ol>
    <div style="margin-top:48px">
      <h3 class="h3"><small>SECTION 16.7</small>${esc(C.sources.regulatoryTitle || 'Regulatory instruments')}</h3>
      <div class="table-wrap"><table class="data"><tbody>${reg.map((r) => `<tr><td style="width:38%"><b>${esc(r.topic)}</b></td><td>${rich(r.text)}</td></tr>`).join('')}</tbody></table></div>
    </div>`);
}

function bomChapter() {
  const b = C.bom;
  return chapter(6, 'd-bom', 'Bill of materials', `SECTION ${b.number} · ${b.items.length} LINE ITEMS`, `
    <div class="prose"><p class="dim">${rich(b.intro)}</p></div>
    <ol class="bom">${b.items.map((it) => `<li>${rich(it)}</li>`).join('')}</ol>`);
}

function storyChapter() {
  const pv = C.provenance;
  const mv = C.motivation;
  const ra = C.rationale;
  return chapter(7, 'd-story', 'The story', 'SECTIONS 1, 2 AND 10 · PROVENANCE, MOTIVATION, RATIONALE', `
    <ol class="timeline">
      <li class="is-key" data-reveal><b>2022</b><span>Initiated in Stage 8, at the age of 13.</span></li>
      <li data-reveal><b>2022–23</b><span>The proposal is written: propellant, architecture, calculations, permits, parts.</span></li>
      <li data-reveal><b>Presented</b><span>Sent to the school principal, presented, and commended.</span></li>
      <li data-reveal><b>Closed</b><span>Closed during IGCSE (Stage 9/10) owing to academic priorities. It never left paper.</span></li>
      <li class="is-key" data-reveal><b>2026</b><span>Typeset in full, with an independent review added as Appendix A.</span></li>
    </ol>
    <div class="cols" style="margin-top:56px">
      <div class="c-6">
        <h3 class="h3"><small>SECTION ${pv.number}</small>${esc(pv.title)}</h3>
        <div class="prose">${paras(pv.paragraphs)}</div>
      </div>
      <div class="c-6">
        <h3 class="h3"><small>SECTION ${mv.number}</small>${esc(mv.title)}</h3>
        <div class="prose">${paras(mv.paragraphs)}</div>
      </div>
    </div>
    <div style="margin-top:40px">
      <h3 class="h3"><small>SECTION ${ra.number}</small>${esc(ra.title)}</h3>
      <div class="prose">${paras(ra.paragraphs.slice(0, 2))}</div>
      ${fns(ra.footnotes)}
    </div>`);
}

function reviewChapter() {
  const a = C.appendix;
  return chapter(8, 'd-review', 'Independent review', `APPENDIX ${a.number || 'A'} · ${a.title.toUpperCase()}`, `
    <div class="prose"><p class="dim">${rich(a.intro)}</p></div>
    ${a.sections
      .filter((s) => s.notes && s.notes.length)
      .map((s) => `<h3 class="h3" style="margin-top:32px"><small>${esc(s.id)}</small>${esc(s.title)}</h3>
        ${s.notes.map((n) => `<details class="fold"><summary><span><span class="note-id">(${esc(n.id)})</span>${esc((n.title || '').replace(/\.$/, '')) || 'Note'}</span></summary><div class="fold__body prose"><p class="dim">${rich(n.text, n.emphasis)}</p>${n.latex ? `<div class="eq"><div class="eq__m">${display(n.latex)}</div></div>` : ''}${n.textAfter ? `<p class="dim">${rich(n.textAfter, n.emphasis)}</p>` : ''}</div></details>`).join('')}`)
      .join('')}
    <div class="box review-summary" style="margin-top:40px">
      <h3 class="h3"><small>${esc(a.summary.id || 'A.6')}</small>${esc(a.summary.title)}</h3>
      <div class="prose">${paras(a.summary.paragraphs)}</div>
    </div>`);
}

function sourcesChapter() {
  const s = C.sources;
  const m = C.meta;
  const tableEq = `<div class="table-wrap"><table class="data"><thead><tr>${(s.equationsColumns || ['Equation', 'Result used', 'Source']).map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.equations.map((e) => `<tr><td>${rich(e.equation)}</td><td>${rich(e.result)}</td><td>${rich(e.source)}</td></tr>`).join('')}</tbody></table></div>`;
  const tableMat = `<div class="table-wrap"><table class="data"><thead><tr>${(s.materialsColumns || ['Material', 'Property', 'Source']).map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.materials.map((e) => `<tr><td>${rich(e.material)}</td><td>${rich(e.property)}</td><td>${rich(e.source)}</td></tr>`).join('')}</tbody></table></div>`;
  const list = (arr) => `<div class="prose">${arr.map((x) => `<p><b>${rich(x.title || x.topic || '')}</b> ${rich(x.text || '')}</p>`).join('')}</div>`;
  const figs = `<div class="table-wrap"><table class="data"><thead><tr>${(s.figuresColumns || ['Figure', 'Source']).map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.figures.map((f) => `<tr><td class="num">${esc(f.figure)}</td><td>${rich(f.source)}</td></tr>`).join('')}</tbody></table></div>`;
  return chapter(9, 'sources', 'Team & sources', 'SECTION 16 · REFERENCES · CREDITS', `
    <div class="authors">${m.authors.map((a) => `<div class="author" data-reveal><b>${esc(a)}</b><span>${esc(m.affiliation)}</span></div>`).join('')}</div>
    <div class="prose" style="margin-top:22px"><p class="dim">${esc(m.title)}. ${esc(m.affiliation)}.</p></div>

    <div style="margin-top:40px">
      <details class="fold"><summary>16.1 ${esc(s.equationsTitle || 'Equations')}</summary><div class="fold__body">${tableEq}</div></details>
      <details class="fold"><summary>16.2 ${esc(s.propellantTitle || 'Propellant and combustion data')}</summary><div class="fold__body">${list(s.propellant)}</div></details>
      <details class="fold"><summary>16.3 ${esc(s.materialsTitle || 'Material properties')}</summary><div class="fold__body">${tableMat}</div></details>
      <details class="fold"><summary>16.4 ${esc(s.engineTitle || 'Engine architecture')}</summary><div class="fold__body">${list(s.engine)}</div></details>
      <details class="fold"><summary>16.5 ${esc(s.balloonTitle || 'Balloon platform')}</summary><div class="fold__body">${list(s.balloon)}</div></details>
      <details class="fold"><summary>16.6 ${esc(s.costsTitle || 'Costs')}</summary><div class="fold__body">${list(s.costs)}</div></details>
      <details class="fold"><summary>16.8 ${esc(s.figuresTitle || 'Figures')}</summary><div class="fold__body">${figs}</div></details>
    </div>

    <h3 class="h3" style="margin-top:48px"><small>${C.references.length} ENTRIES · AIP STYLE</small>${esc(C.referencesTitle || 'References')}</h3>
    <ol class="refs">${C.references.map((r) => `<li><b>[${r.n}]</b><span>${r.html ? r.html : esc(r.text)}</span></li>`).join('')}</ol>

    <h3 class="h3" style="margin-top:48px"><small>THIS WEBSITE</small>3D models, imagery &amp; fonts</h3>
    <div class="table-wrap"><table class="data"><tbody>
      <tr><td><b>Rockoon</b></td><td>Procedural three.js model built for this site from Figure 2 and Sections 4 and 14 of the paper.</td></tr>
      <tr><td><b>RS-25 / SSME</b></td><td>Original procedural reconstruction modelled on the paper’s Figures 10–11 and public RS-25 geometry. The paper’s source model (GrabCAD Library) is licensed for the downloader’s internal use only and cannot be republished on a website.</td></tr>
      <tr><td><b>Turbopump</b></td><td>“Raptor CH4 Turbopump” by 3D Shuttle, <a href="https://www.printables.com/model/1175221-raptor-ch4-turbopump" target="_blank" rel="noopener">printables.com/model/1175221</a>, CC BY-SA 4.0. Modified: oriented, re-materialled, grouped and compressed. Stands in for the GrabCAD “Turbopump for liquid rocket engine” by Max Smoliar shown in Figure 9, which cannot be redistributed.</td></tr>
      <tr><td><b>Earth</b></td><td>NASA Blue Marble Next Generation, NASA Black Marble 2016, NASA cloud composite, GEBCO water mask. Public domain / NASA imagery.</td></tr>
      <tr><td><b>Space background</b></td><td>“Space Journey” by Akimitsu Hamamuro (akm2), <a href="https://codepen.io/akm2/pen/RwQXLdP" target="_blank" rel="noopener">codepen.io/akm2/pen/RwQXLdP</a>, MIT License. Move to steer, hold to warp.</td></tr>
      <tr><td><b>Fonts</b></td><td>Orbitron (Matt McInerney, SIL OFL 1.1). D-DIN (Datto Inc., SIL OFL 1.1).</td></tr>
      <tr><td><b>Figures</b></td><td>Reproduced from the original proposal with the credits listed in Section 16.8 above; Figure 1c is “Raptor testing”, Official SpaceX Photos, CC BY-NC 2.0.</td></tr>
      <tr><td><b>Design</b></td><td>Layout, typography and motion inspired by “Mission: Mars” (missionmars.peachworlds.com) by Peach Worlds. Built with three.js, GSAP, Lenis and KaTeX.</td></tr>
    </tbody></table></div>`);
}

export function renderDossier(root, toc) {
  const html = [feedChapter(), hardwareChapter(), mathChapter(), balloonChapter(), permitsChapter(), bomChapter(), storyChapter(), reviewChapter(), sourcesChapter()].join('');
  root.innerHTML = html;
  toc.innerHTML = [...root.querySelectorAll('.chapter')]
    .map((ch, i) => `<a href="#${ch.id}">${esc(ch.dataset.dossierTitle)}<span>${String(i + 1).padStart(2, '0')}</span></a>`)
    .join('');
}

export function fillStoryText() {
  const hz = C.propellant.hazards.paragraphs[0];
  document.getElementById('hazard-lead').innerHTML = rich(hz);
  document.getElementById('hazard-mitigation').innerHTML = rich(C.propellant.mitigation.paragraphs[0]);
  document.getElementById('why-lead').innerHTML = rich(C.rationale.paragraphs[2].split('Why? Because they can.')[0].trim());
  document.getElementById('end-cite').innerHTML = `${esc(C.meta.title)}. ${C.meta.authors.map(esc).join(', ')}. ${esc(C.meta.affiliation)}.`;
  // marquee rows
  const adv = C.propellant.advantages.map((a) => a.replace(/[¹²³⁴⁵⁶⁷]/g, '').replace(/\.$/, ''));
  const short = adv.filter((a) => a.length < 70);
  const half = Math.ceil(short.length / 2);
  const rows = [short.slice(0, half), short.slice(half)];
  document.getElementById('marquee').innerHTML = rows
    .map((r) => `<div class="marquee__row">${[...r, ...r].map((t) => `<span class="marquee__item">${esc(t)}</span>`).join('')}</div>`)
    .join('');
}

export { C as content };
