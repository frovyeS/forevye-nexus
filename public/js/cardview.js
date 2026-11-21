// Kartı SVG olarak çizer. Korunan alanlar (marka, çip, kimlik, ad, etiket) HER ZAMAN en üstte çizilir;
// süs nesneleri bunların altında kalır. Bu dosya yalnızca görüntüler; doğrulama sunucudadır.
import { CARD_W, CARD_H, PROTECTED } from './card-contract.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(k);
  return el;
};
let uid = 0;

function pattern(kind, color) {
  const g = s('g', { opacity: '0.18', stroke: color, fill: 'none', 'stroke-width': '1' });
  if (kind === 'grid') { for (let x = 0; x <= CARD_W; x += 20) g.append(s('line', { x1: x, y1: 0, x2: x, y2: CARD_H })); for (let y = 0; y <= CARD_H; y += 20) g.append(s('line', { x1: 0, y1: y, x2: CARD_W, y2: y })); }
  if (kind === 'dots') { g.setAttribute('fill', color); for (let x = 10; x < CARD_W; x += 20) for (let y = 10; y < CARD_H; y += 20) g.append(s('circle', { cx: x, cy: y, r: 1.6 })); }
  if (kind === 'waves') for (let y = 20; y < CARD_H; y += 22) g.append(s('path', { d: `M0 ${y} Q 40 ${y - 12} 80 ${y} T 160 ${y} T 240 ${y} T 320 ${y}` }));
  if (kind === 'circuit') { g.append(s('path', { d: 'M0 40 H90 V90 H170 V30 H250 V120 H320 M0 160 H60 V120 H140 M200 200 V150 H280 V200' })); [[90, 90], [170, 30], [250, 120], [60, 120], [280, 150]].forEach(([x, y]) => g.append(s('circle', { cx: x, cy: y, r: 3 }))); }
  return g;
}

function decorShape(o, color) {
  const r = o.size / 2;
  const g = s('g', { transform: `translate(${o.x} ${o.y})`, fill: color, opacity: '0.85' });
  if (o.id === 'star') g.append(s('polygon', { points: [0, 1, 2, 3, 4].map((i) => { const a = (i * 72 - 90) * Math.PI / 180, b = a + 36 * Math.PI / 180; return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)} ${(r * 0.45 * Math.cos(b)).toFixed(1)},${(r * 0.45 * Math.sin(b)).toFixed(1)}`; }).join(' ') }));
  if (o.id === 'bolt') g.append(s('polygon', { points: `${0.2 * r},${-r} ${-0.6 * r},${0.1 * r} ${-0.05 * r},${0.1 * r} ${-0.25 * r},${r} ${0.7 * r},${-0.2 * r} ${0.1 * r},${-0.2 * r}` }));
  if (o.id === 'orb') { g.append(s('circle', { r, opacity: '0.55' })); g.append(s('circle', { r: r * 0.55, opacity: '0.9' })); }
  if (o.id === 'planet') { g.append(s('circle', { r: r * 0.62 })); g.append(s('ellipse', { rx: r, ry: r * 0.28, fill: 'none', stroke: color, 'stroke-width': '2', transform: 'rotate(-20)' })); }
  if (o.id === 'leaf') g.append(s('path', { d: `M${-r} ${r} C ${-r} ${-r * 0.4}, ${r * 0.3} ${-r}, ${r} ${-r} C ${r} ${r * 0.3}, ${-r * 0.4} ${r}, ${-r} ${r} Z` }));
  return g;
}

// Resmî logo (ikon + yazı logosu). Marka bölgesinin (PROTECTED.brand) içine sabittir; kullanıcı verisinden etkilenmez.
const ICON_PATHS = ['M35 72 L105 28 L228 100 L228 148 L105 76 L68 98 L68 205 L35 205Z', 'M292 178 L222 222 L99 150 L99 102 L222 174 L259 152 L259 45 L292 45Z'];
function brandMark(maskId, color) {
  const b = PROTECTED.find((p) => p.id === 'brand');
  const ih = 26, iw = ih * 267 / 202, wh = 22, ww = wh * 1422 / 303;
  const iy = b.y + (b.h - ih) / 2, wx = b.x + iw + 8, wy = b.y + (b.h - wh) / 2;
  const g = s('g', { 'data-sys': 'brand' });
  const icon = s('svg', { x: b.x, y: iy, width: iw, height: ih, viewBox: '30 24 267 202', fill: color });
  ICON_PATHS.forEach((d) => icon.append(s('path', { d })));
  const mask = s('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: wx, y: wy, width: ww, height: wh }, s('image', { href: '/assets/wordmark.png', x: wx, y: wy, width: ww, height: wh }));
  g.append(icon, mask, s('rect', { x: wx, y: wy, width: ww, height: wh, fill: color, mask: `url(#${maskId})` }));
  return g;
}

export function renderCard(design, { display_name = '', card_token = '', status = 'active' } = {}, { showZones = false } = {}) {
  const id = `c${uid++}`;
  const svg = s('svg', { viewBox: `0 0 ${CARD_W} ${CARD_H}`, class: `card-svg${status === 'disabled' ? ' disabled' : ''}`, role: 'img', 'aria-label': `Sanal kart: ${display_name}` });
  const bg = design.background;
  const defs = s('defs');
  let fill;
  if (bg.type === 'gradient') {
    const a = (bg.angle ?? 135) * Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    defs.append(s('linearGradient', { id: `${id}g`, x1: 0.5 - dx / 2, y1: 0.5 - dy / 2, x2: 0.5 + dx / 2, y2: 0.5 + dy / 2 }, s('stop', { offset: '0', 'stop-color': bg.colors[0] }), s('stop', { offset: '1', 'stop-color': bg.colors[1] })));
    fill = `url(#${id}g)`;
  } else fill = bg.colors[0];
  defs.append(s('clipPath', { id: `${id}c` }, s('rect', { width: CARD_W, height: CARD_H, rx: 16 })));
  svg.append(defs);
  const body = s('g', { 'clip-path': `url(#${id}c)` });
  body.append(s('rect', { width: CARD_W, height: CARD_H, fill }));
  if (design.pattern !== 'none') body.append(pattern(design.pattern, design.textColor));
  for (const o of design.decor || []) body.append(decorShape(o, design.accent));

  // --- Korunan katman (en üstte) ---
  const t = design.textColor;
  body.append(brandMark(`${id}w`, t));
  body.append(s('text', { x: 306, y: 30, fill: design.accent, 'font-size': 10, 'font-weight': 700, 'letter-spacing': 1.5, 'text-anchor': 'end', 'font-family': 'system-ui, sans-serif' }, document.createTextNode('SANAL KART')));
  body.append(s('rect', { x: 16, y: 70, width: 46, height: 36, rx: 6, fill: '#d9b95b' }));
  body.append(s('path', { d: 'M16 82 H62 M16 94 H62 M31 70 V106 M47 70 V106', stroke: '#8a6d1d', 'stroke-width': 1, fill: 'none' }));
  const tok = card_token ? card_token.replace(/^(NXC-)[A-Z0-9]{4}(-[A-Z0-9]{4})$/, '$1••••$2') : 'NXC-••••-••••';
  body.append(s('text', { x: 16, y: 136, fill: t, 'font-size': 15, 'letter-spacing': 2.5, 'font-family': 'ui-monospace, Menlo, monospace' }, document.createTextNode(tok)));
  // Ad: ayrılan alana (236 birim) sığacak şekilde ölçeklenir; çok uzunsa kontrollü kısaltılır.
  const name = display_name.length > 24 ? `${display_name.slice(0, 23)}…` : display_name;
  const fs = Math.max(11, Math.min(18, 232 / Math.max(1, name.length * 0.62)));
  body.append(s('text', { x: 16, y: 172, fill: t, 'font-size': fs.toFixed(1), 'font-weight': 600, 'letter-spacing': 0.5, 'font-family': 'system-ui, sans-serif' }, document.createTextNode(name.toUpperCase())));
  if (showZones) for (const p of PROTECTED) body.append(s('rect', { x: p.x, y: p.y, width: p.w, height: p.h, fill: 'rgba(255,80,80,.12)', stroke: '#ff5a5a', 'stroke-dasharray': '3 3', 'stroke-width': 1 }));
  if (status === 'disabled') body.append(s('rect', { width: CARD_W, height: CARD_H, fill: 'rgba(0,0,0,.55)' }), s('text', { x: 160, y: 108, fill: '#fff', 'font-size': 18, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'system-ui, sans-serif' }, document.createTextNode('DEVRE DIŞI')));
  svg.append(body);
  return svg;
}
