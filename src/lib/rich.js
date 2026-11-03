import katex from 'katex';

export const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const tex = (src, displayMode) => {
  try {
    return katex.renderToString(src, { displayMode, throwOnError: false, strict: 'ignore', output: 'html' });
  } catch {
    return `<code>${esc(src)}</code>`;
  }
};

export const display = (src) => tex(src, true);
export const inline = (src) => tex(src, false);

// Prose with \( ... \) inline math and Unicode superscript footnote markers. Optional italic phrases.
export function rich(text = '', emphasis = []) {
  const parts = String(text).split(/(\\\(.+?\\\))/g);
  let html = parts
    .map((p) => (p.startsWith('\\(') ? inline(p.slice(2, -2)) : esc(p)))
    .join('');
  html = html.replace(/([¹²³⁴⁵⁶⁷⁸⁹])/g, '<sup class="fn-mark">$1</sup>');
  for (const e of emphasis || []) {
    if (!e) continue;
    const k = esc(e);
    html = html.split(k).join(`<em>${k}</em>`);
  }
  return html;
}

export const paras = (arr = [], cls = '', emphasis) => arr.map((p) => `<p${cls ? ` class="${cls}"` : ''}>${rich(p, emphasis)}</p>`).join('');
