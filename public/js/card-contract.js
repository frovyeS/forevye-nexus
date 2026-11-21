// Kart tasarımı ortak veri sözleşmesi (sunucu + istemci + ayrı kart editörü aynı kuralları kullanır).
// Sürüm: 1. Kart 320x200 birimlik bir tuval üzerinde çizilir.
export const CONTRACT_VERSION = 1;
export const CARD_W = 320;
export const CARD_H = 200;

// Korunan bölgeler: marka, çip, sistem kimliği, kart adı, "SANAL KART" etiketi.
// Dekoratif nesneler bu dikdörtgenlerle kesişemez; istemci bu alanları en üstte çizer.
export const PROTECTED = [
  { id: 'brand', x: 16, y: 14, w: 150, h: 28 },
  { id: 'label', x: 226, y: 14, w: 80, h: 22 },
  { id: 'chip', x: 16, y: 70, w: 46, h: 36 },
  { id: 'token', x: 16, y: 118, w: 200, h: 24 },
  { id: 'name', x: 16, y: 150, w: 236, h: 36 },
];

export const PATTERNS = ['none', 'grid', 'dots', 'waves', 'circuit'];
export const DECOR_IDS = ['star', 'bolt', 'orb', 'planet', 'leaf'];
export const BG_TYPES = ['solid', 'gradient'];
export const MAX_DECOR = 6;
export const DISPLAY_NAME_MAX = 24;
export const LABEL_MAX = 30;

const HEX = /^#[0-9a-fA-F]{6}$/;
// Marka, kart kimliği ve ad yazısı her zeminde okunabilir kalmalı (şartname bölüm 6): yazı rengi her zemin rengine karşı >= 3:1 olmalı.
export const MIN_CONTRAST = 3;
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h) => 0.2126 * lin(parseInt(h.slice(1, 3), 16)) + 0.7152 * lin(parseInt(h.slice(3, 5), 16)) + 0.0722 * lin(parseInt(h.slice(5, 7), 16));
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

export function defaultDesign() {
  return {
    v: CONTRACT_VERSION,
    background: { type: 'gradient', colors: ['#0b1020', '#1b2a6b'], angle: 135 },
    pattern: 'grid',
    accent: '#4de2c5',
    textColor: '#ffffff',
    decor: [],
  };
}

function intersectsProtected(cx, cy, size) {
  const half = size / 2;
  const l = cx - half, r = cx + half, t = cy - half, b = cy + half;
  return PROTECTED.some((p) => l < p.x + p.w && r > p.x && t < p.y + p.h && b > p.y);
}

export function validateDisplayName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Kart adı metin olmalı.' };
  const s = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (s.length < 1 || s.length > DISPLAY_NAME_MAX) return { ok: false, error: `Kart adı 1-${DISPLAY_NAME_MAX} karakter olmalı.` };
  if (!/^[\p{L}\p{N} .'\-_]+$/u.test(s)) return { ok: false, error: 'Kart adı yalnızca harf, rakam, boşluk ve . \' - _ içerebilir.' };
  return { ok: true, value: s };
}

export function validateLabel(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false, error: 'Özel ad metin olmalı.' };
  const s = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (s.length > LABEL_MAX) return { ok: false, error: `Özel ad en fazla ${LABEL_MAX} karakter olmalı.` };
  if (!/^[\p{L}\p{N} .'\-_]*$/u.test(s)) return { ok: false, error: 'Özel ad geçersiz karakter içeriyor.' };
  return { ok: true, value: s };
}

// Sıkı beyaz liste: bilinmeyen anahtarlar reddedilir, yalnızca temiz bir kopya döner.
export function validateDesign(d) {
  const errors = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, errors: ['Tasarım nesne olmalı.'] };
  const allowed = new Set(['v', 'background', 'pattern', 'accent', 'textColor', 'decor']);
  for (const k of Object.keys(d)) if (!allowed.has(k)) errors.push(`Bilinmeyen alan: ${k}`);

  const bg = d.background;
  if (!bg || typeof bg !== 'object' || !BG_TYPES.includes(bg.type)) errors.push('Geçersiz zemin türü.');
  else {
    const need = bg.type === 'solid' ? 1 : 2;
    if (!Array.isArray(bg.colors) || bg.colors.length !== need || !bg.colors.every((c) => typeof c === 'string' && HEX.test(c)))
      errors.push('Zemin renkleri #rrggbb biçiminde olmalı.');
    if (bg.type === 'gradient' && !(isNum(bg.angle) && bg.angle >= 0 && bg.angle <= 360)) errors.push('Gradyan açısı 0-360 olmalı.');
  }
  if (!PATTERNS.includes(d.pattern)) errors.push('Geçersiz desen.');
  if (typeof d.accent !== 'string' || !HEX.test(d.accent)) errors.push('Vurgu rengi geçersiz.');
  if (typeof d.textColor !== 'string' || !HEX.test(d.textColor)) errors.push('Yazı rengi geçersiz.');

  if (bg && Array.isArray(bg.colors) && typeof d.textColor === 'string' && HEX.test(d.textColor)
    && bg.colors.every((c) => typeof c === 'string' && HEX.test(c))
    && bg.colors.some((c) => contrast(d.textColor, c) < MIN_CONTRAST)) {
    errors.push('Yazı rengi zeminle yeterli kontrast sağlamıyor; marka ve kart bilgileri okunamaz hale gelir. Daha açık veya daha koyu bir yazı rengi seçin.');
  }

  const decor = d.decor ?? [];
  if (!Array.isArray(decor) || decor.length > MAX_DECOR) errors.push(`En fazla ${MAX_DECOR} süs nesnesi eklenebilir.`);
  else {
    decor.forEach((o, i) => {
      if (!o || typeof o !== 'object' || !DECOR_IDS.includes(o.id) || !isNum(o.x) || !isNum(o.y) || !isNum(o.size)) {
        errors.push(`Süs #${i + 1} geçersiz.`); return;
      }
      if (Object.keys(o).some((k) => !['id', 'x', 'y', 'size'].includes(k))) errors.push(`Süs #${i + 1} bilinmeyen alan içeriyor.`);
      if (o.size < 12 || o.size > 44) errors.push(`Süs #${i + 1} boyutu 12-44 olmalı.`);
      else if (o.x < 0 || o.x > CARD_W || o.y < 0 || o.y > CARD_H) errors.push(`Süs #${i + 1} kart dışında.`);
      else if (intersectsProtected(o.x, o.y, o.size)) errors.push(`Süs #${i + 1} korumalı bölgeyle (çip, marka, kimlik, ad) çakışıyor.`);
    });
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    design: {
      v: CONTRACT_VERSION,
      background: { type: bg.type, colors: [...bg.colors], ...(bg.type === 'gradient' ? { angle: Math.round(bg.angle) } : {}) },
      pattern: d.pattern,
      accent: d.accent.toLowerCase(),
      textColor: d.textColor.toLowerCase(),
      decor: decor.map((o) => ({ id: o.id, x: Math.round(o.x), y: Math.round(o.y), size: Math.round(o.size) })),
    },
  };
}
