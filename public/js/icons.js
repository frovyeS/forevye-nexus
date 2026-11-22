// FOREVYE NEXUS ikon ailesi — tek kaynak.
// Kural: 24x24 ızgara, 1.75 çizgi, kare uç, sivri birleşim, tek renk (currentColor).
// Aynı çizimler /icons/*.svg olarak da dışa aktarılır (scripts/build-icons.mjs).
const NS = 'http://www.w3.org/2000/svg';

export const ICONS = {
  home: 'M3 11 12 4l9 7M5 9.5V20h14V9.5M10 20v-6h4v6',
  wallet: 'M3 5h15v4M3 5v15h18V9H3M16 14.5h2',
  cards: 'M3 6h18v12H3zM3 10h18M6 15h4',
  transfer: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4',
  history: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v5l3 2',
  market: 'M6 4h12l4 6-10 11L2 10zM2 10h20M9 4l-2 6 5 11M15 4l2 6-5 11',
  profile: 'M8 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0M4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6h4V4zM7 14v6h4v-6z',
  security: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  bell: 'M6 17v-6a6 6 0 0 1 12 0v6M4 17h16M10 20.5h4',
  logout: 'M10 4H4v16h6M9 12h11M16 8l4 4-4 4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  eyeOff: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4 4l16 16',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  send: 'M7 17 17 7M8 7h9v9',
  receive: 'M17 7 7 17M16 17H7V8',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  check: 'M4 12.5l5 5L20 6.5',
  x: 'M5 5l14 14M19 5 5 19',
  gift: 'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7 8 4M12 7l4-4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  cart: 'M3 4h3l2.5 11h10L21 8H7M10 20h.01M17 20h.01',
  undo: 'M9 6 4 11l5 5M4 11h11a5 5 0 0 1 0 10h-4',
  alert: 'M12 3 2.5 20h19zM12 10v5M12 18h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
  star: 'M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  copy: 'M8 8h12v13H8zM4 16H3V3h13v2',
  qrcode: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14h2v2h-2zM19 19h2v2h-2zM14 19h3v2h-3z',
};

export function icon(name, size = 20, cls = '') {
  const d = ICONS[name];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', `ic${cls ? ` ${cls}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d || ICONS.info);
  svg.append(p);
  return svg;
}
