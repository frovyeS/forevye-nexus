// Kart tasarımı ortak veri sözleşmesi — SÜRÜM 2 (banka kart editörünün modeli: 856x540, katmanlar).
// Kurallar ve doğrulama `card-rules.js` dosyasındadır (forevye_nexus_bank/js/rules.js ile BİREBİR aynı dosya).
// Sunucu (Worker) ve tarayıcı bu dosyayı kullanır; asıl güvenlik kontrolü sunucuda yapılır.
// Marka, çip ve kart bilgisi veri modelinde YOKTUR: çizimde sistemden eklenir, kullanıcı silemez/taşıyamaz.
import './card-rules.js';

const R = globalThis.FNXRules;
export const CONTRACT_VERSION = 2;
export const CARD_W = R.CANVAS.width;
export const CARD_H = R.CANVAS.height;
export const DISPLAY_NAME_MIN = R.NAME_LIMITS.min;
export const DISPLAY_NAME_MAX = R.NAME_LIMITS.max;
export const LABEL_MAX = 30;
export const ZONES = R.ZONES;
export const TEMPLATES = R.TEMPLATES;

// Kartta görünen ad: editörle aynı kural (2-18 karakter). Editör geçersiz karakteri sessizce temizler;
// API ise temizlemek yerine REDDEDER (yanlışlıkla başka bir ad kaydedilmesin).
export function validateDisplayName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Kart adı metin olmalı.' };
  const cleaned = R.sanitizeName(raw);
  const asTyped = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (cleaned !== asTyped) return { ok: false, error: 'Kart adı yalnızca harf, rakam, boşluk ve . \' - _ içerebilir.' };
  const v = R.validateName(cleaned);
  if (!v.ok) return { ok: false, error: `Kart adı ${DISPLAY_NAME_MIN}-${DISPLAY_NAME_MAX} karakter olmalı.` };
  return { ok: true, value: v.value };
}

export function validateLabel(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false, error: 'Özel ad metin olmalı.' };
  const s = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (s.length > LABEL_MAX) return { ok: false, error: `Özel ad en fazla ${LABEL_MAX} karakter olmalı.` };
  if (!/^[\p{L}\p{N} .'\-_]*$/u.test(s)) return { ok: false, error: 'Özel ad geçersiz karakter içeriyor.' };
  return { ok: true, value: s };
}

// İstemciden gelen tasarımı izin listesine göre yeniden kurar (editörle aynı kod). { ok, errors, design }
export function validateDesign(d) {
  return R.validateDesign(d);
}

const shape = (id, name, kind, x, y, w, h, p) => {
  const so = R.STROKE_ONLY.has(kind);
  return {
    id, type: R.TEXTURE_KINDS.includes(kind) ? 'texture' : 'shape', name, locked: false, visible: true, zIndex: 0,
    properties: { kind, x, y, width: w, height: h, rotation: 0, opacity: 1, fill: so ? 'none' : '#FFFFFF', stroke: so ? '#FFFFFF' : 'none', strokeWidth: so ? 3 : 0, flipX: false, flipY: false, lockRatio: false, effects: [], ...p },
  };
};
const bgLayer = (mode, colors, angle, finish) => ({ id: 'bg', type: 'background', name: 'Kart zemini', locked: true, visible: true, zIndex: 0, properties: { mode, colors, angle, finish } });

// Yeni kartların başlangıç tasarımı: editördeki "Classic" şablonu.
export function defaultDesign(displayName = 'NEXUS') {
  const layers = [
    bgLayer('gradient', ['#ECEEF5', '#C7CBD8'], 135, 'glossy'),
    shape('c1', 'Işık bandı', 'line', 300, 250, 760, 20, { rotation: -40, stroke: '#FFFFFF', strokeWidth: 44, opacity: 0.28 }),
    shape('c2', 'İnce band', 'line', 390, 300, 760, 20, { rotation: -40, stroke: '#FFFFFF', strokeWidth: 10, opacity: 0.4 }),
    shape('c3', 'Gümüş çizgi', 'line', 210, 360, 760, 20, { rotation: -40, stroke: '#AEB3C2', strokeWidth: 3, opacity: 0.55 }),
    shape('c4', 'Nexus', 'nexus', 505, 205, 300, 227, { fill: '#9097A6', opacity: 0.55, lockRatio: true }),
  ];
  layers.forEach((l, i) => { l.zIndex = i * 10; });
  return { designId: 'design_local', ownerId: 'local', template: 'classic', canvas: { width: CARD_W, height: CARD_H }, layers, userDisplayName: displayName, nameStyle: { color: 'auto' }, chipStyle: 'gold', version: 1 };
}

// Kullanıcı adından kart adı önerisi (2-18 karakter, izinli karakterler).
export function suggestDisplayName(username) {
  let s = R.sanitizeName(String(username || '').replace(/[._]+/g, ' '));
  if (Array.from(s).length < DISPLAY_NAME_MIN) s = 'NEXUS';
  return s;
}

// ---- Eski (sürüm 1: 320x200, desen + süs listesi) tasarımları sürüm 2'ye çevirir. Veritabanı satırlarına dokunulmaz; okurken çevrilir. ----
const K = CARD_W / 320;                       // 2.675
const DECOR_KIND = { star: 'stars', bolt: 'triangle', orb: 'circle', planet: 'ring', leaf: 'roundrect' };
const PATTERN_KIND = { grid: 'grid', dots: 'stars', waves: 'wavelines', circuit: 'diagonals' };

export function convertV1(old, displayName) {
  const bg = old.background || { type: 'solid', colors: ['#0b1020'] };
  const grad = bg.type === 'gradient' && bg.colors.length >= 2;
  const layers = [bgLayer(grad ? 'gradient' : 'solid', grad ? bg.colors.slice(0, 2).map((c) => c.toUpperCase()) : [String(bg.colors[0]).toUpperCase()], grad ? ((Number(bg.angle ?? 135) + 90) % 360) : 135, 'matte')];
  const ink = String(old.textColor || '#ffffff').toUpperCase();
  const accent = String(old.accent || '#4de2c5').toUpperCase();
  if (PATTERN_KIND[old.pattern]) {
    const kind = PATTERN_KIND[old.pattern];
    layers.push(shape('cv_pat', 'Desen', kind, 0, 0, CARD_W, CARD_H, kind === 'stars' ? { fill: ink, opacity: 0.45 } : { stroke: ink, strokeWidth: 2, opacity: 0.18 }));
  }
  (old.decor || []).forEach((o, i) => {
    const kind = DECOR_KIND[o.id]; if (!kind) return;
    const w = Math.round(o.size * K * (kind === 'stars' ? 2 : 1));
    const l = shape(`cv_d${i + 1}`, 'Süs', kind, Math.round(o.x * K - w / 2), Math.round(o.y * K - w / 2), w, w, R.STROKE_ONLY.has(kind) ? { stroke: accent, strokeWidth: 4, opacity: 0.85 } : { fill: accent, opacity: 0.85 });
    if (R.pushOut(l)) layers.push(l);         // yeni korumalı bölgelerle çakışan süs kaydırılır; kaydırılamazsa atılır
  });
  const name = R.sanitizeName(displayName || 'NEXUS') || 'NEXUS';
  const res = R.validateDesign({ template: 'classic', canvas: { width: CARD_W, height: CARD_H }, layers, userDisplayName: name, nameStyle: { color: ink }, chipStyle: 'gold', version: 1 });
  return res.design;
}

// Veritabanından okunan tasarım JSON'unu (sürüm 1 veya 2) her zaman geçerli sürüm 2 nesnesine çevirir. Kayıtlı veri bile yeniden kurulur (sanitize).
export function readStoredDesign(json, displayName, version) {
  let d;
  try { d = typeof json === 'string' ? JSON.parse(json) : json; } catch { d = null; }
  let out;
  if (d && Array.isArray(d.layers)) out = R.validateDesign({ ...d, userDisplayName: displayName ?? d.userDisplayName }).design;
  else if (d && typeof d === 'object') out = convertV1(d, displayName);
  else out = R.validateDesign(defaultDesign(displayName || 'NEXUS')).design;
  if (version) out.version = version;
  return out;
}
