/* Forevye Nexus — kart tasarım kuralları (SÖZLEŞME SÜRÜM 3).
 * Bu dosya DOM'a bağımlı değildir: aynı kod Cloudflare Worker'da sunucu doğrulaması için
 * olduğu gibi kullanılabilir (module.exports ile). İstemci kontrolü yalnızca deneyim içindir;
 * asıl güvenlik kontrolü sunucuda aynı validateDesign ile yapılır.
 *
 * Tasarım felsefesi (v3):
 *  - Dekoratif katmanlar SERBESTTİR: üst üste binebilir, kart dışına taşabilir (çıktıda kırpılır), çakışma engeli yoktur.
 *  - Sistem öğeleri (banka logosu, çip, kart sahibi, kart numarası, kart kodu, QR) veri modelinde KATMAN DEĞİLDİR.
 *    Çizimde her zaman en üstte çizilirler; dekoratif hiçbir katman onları kapatamaz, gizleyemez, silemez.
 *    Kullanıcı yalnızca konum/ölçek verir (design.sys); sistem bunu kart sınırına ve birbirlerine göre sınırlar.
 *  - v1/v2 tasarımlar (orientation/sys yok) olduğu gibi geçerlidir: yatay + varsayılan sistem düzeni.
 */
(function (root) {
  'use strict';

  // ---------- tuval (yatay / dikey) ----------
  var SIZE = { landscape: { width: 856, height: 540 }, portrait: { width: 540, height: 856 } };
  var ORIENTATIONS = ['landscape', 'portrait'];
  var CANVAS = SIZE.landscape;                       // eski API: varsayılan (yatay) tuval
  function canvasOf(o) { return SIZE[o === 'portrait' ? 'portrait' : 'landscape']; }
  var CORNER = 36;                                   // kart köşe yarıçapı
  var MARGIN = 14;                                   // sistem öğesinin karta uzaklığı (en az)
  var GAP = 4;                                       // sistem öğeleri arası en az boşluk

  // ---------- sistem öğeleri ----------
  // w/h: ölçek 1'deki kutu. group: katman panelindeki grup.
  var SYS_KEYS = ['brand', 'chip', 'code', 'number', 'name', 'qr'];
  var SYS = {
    brand: { label: 'Banka logosu', group: 'brand', w: 300, h: 54, min: 0.7, max: 1.5 },
    chip: { label: 'EMV çip', group: 'chipqr', w: 100, h: 78, min: 0.7, max: 1.6 },
    code: { label: 'Sanal kart kodu', group: 'info', w: 250, h: 48, min: 0.7, max: 1.5 },
    number: { label: 'Kart numarası', group: 'info', w: 230, h: 34, min: 0.7, max: 1.5 },
    name: { label: 'Kart sahibi', group: 'info', w: 400, h: 34, min: 0.6, max: 1.3 },
    qr: { label: 'QR kod', group: 'chipqr', w: 84, h: 84, min: 0.7, max: 1.8 }
  };
  var SYS_GROUPS = [
    { id: 'brand', label: 'Marka ve logo' },
    { id: 'info', label: 'Sistem bilgileri' },
    { id: 'chipqr', label: 'Çip ve QR' }
  ];
  var QR_STYLES = ['tint', 'icon'];
  var NAME_AREA = { x: 48, y: 448, w: 400, h: 34 };   // eski API (yatay varsayılan ad kutusu)
  var NAME_LIMITS = { min: 2, max: 18 };

  function sysDefaults(o) {
    if (o === 'portrait') {
      return {
        brand: { x: 40, y: 44, scale: 1 }, qr: { x: 416, y: 44, scale: 1 }, chip: { x: 40, y: 176, scale: 1 },
        code: { x: 40, y: 652, scale: 1 }, number: { x: 40, y: 718, scale: 1 }, name: { x: 40, y: 768, scale: 1 }
      };
    }
    return {
      brand: { x: 48, y: 44, scale: 1 }, qr: { x: 724, y: 44, scale: 1 }, chip: { x: 48, y: 196, scale: 1 },
      code: { x: 48, y: 322, scale: 1 }, number: { x: 594, y: 450, scale: 1 }, name: { x: 48, y: 448, scale: 1 }
    };
  }
  function sysDims(key, qrStyle) {
    var m = SYS[key];
    if (key === 'qr' && qrStyle === 'icon') return { w: 40, h: 40 };
    return { w: m.w, h: m.h };
  }
  function sysBox(key, e, qrStyle) {
    var d = sysDims(key, qrStyle), s = e.scale;
    return { x: e.x, y: e.y, w: d.w * s, h: d.h * s, r: e.x + d.w * s, b: e.y + d.h * s };
  }

  var KINDS_FILL = ['circle', 'triangle', 'hexagon', 'roundrect', 'rect', 'diamond', 'wave', 'mountain', 'stars', 'dots', 'nexus'];
  var KINDS = ['circle', 'ring', 'line', 'arc', 'triangle', 'hexagon', 'roundrect', 'rect', 'diamond',
    'wave', 'wavelines', 'mountain', 'stars', 'grid', 'diagonals', 'nexus', 'dots', 'rings', 'rays', 'hexgrid', 'glow', 'beam'];
  var TEXTURE_KINDS = ['stars', 'grid', 'diagonals', 'wavelines', 'dots', 'rings', 'rays', 'hexgrid'];
  var LIGHT_KINDS = ['glow', 'beam'];
  var STROKE_ONLY = { ring: 1, line: 1, arc: 1, wavelines: 1, grid: 1, diagonals: 1, rings: 1, rays: 1, hexgrid: 1 };
  STROKE_ONLY.has = function (k) { return Object.prototype.hasOwnProperty.call(STROKE_ONLY, k) && k !== 'has'; };
  var RADIUS_KINDS = ['roundrect', 'rect'];

  var TEMPLATES = ['classic', 'signature', 'creative', 'obsidian', 'carbon', 'aurora', 'minimal', 'royal', 'titanium', 'phantom', 'mountain'];
  var CHIP_STYLES = ['gold', 'silver', 'rose', 'titanium', 'onyx', 'emerald'];
  var FINISHES = ['matte', 'glossy', 'foil', 'holo', 'satin', 'chrome'];
  var TEXTURES = ['none', 'carbon', 'brushed', 'grain', 'mesh'];
  var OBJ_EFFECTS = ['shadow', 'emboss', 'frost'];
  var MAX_LAYERS = 60;
  var MAX_BG_COLORS = 5;
  var LARGE_RATIO = 0.35;

  var HEX = /^#[0-9a-fA-F]{6}$/;
  var ID = /^[A-Za-z0-9_\-]{1,64}$/;

  function num(v, min, max, def) {
    v = Number(v);
    if (!isFinite(v)) return def;
    return Math.min(max, Math.max(min, v));
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  // Görünmez / kontrol karakterleri ve izin listesi dışındaki her şeyi temizler.
  function sanitizeText(raw, max, keepEdge) {
    var s = String(raw == null ? '' : raw);
    try { s = s.normalize('NFKC'); } catch (e) {}
    s = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, '');
    s = s.replace(/[^\p{L}\p{N} .\-_']/gu, '');
    s = s.replace(/ {2,}/g, ' ');
    if (!keepEdge) s = s.trim();
    else s = s.replace(/^ +/, '');
    return Array.from(s).slice(0, max).join('');
  }
  function sanitizeName(raw, keepEdge) { return sanitizeText(raw, NAME_LIMITS.max, keepEdge); }
  function validateName(raw) {
    var v = sanitizeName(raw);
    if (Array.from(v).length < NAME_LIMITS.min) {
      return { ok: false, value: v, error: 'Ad en az ' + NAME_LIMITS.min + ' karakter olmalı.' };
    }
    return { ok: true, value: v };
  }

  function lum(h) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(h.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  function bbox(p) {
    var a = (p.rotation || 0) * Math.PI / 180;
    var c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    var hw = (p.width * c + p.height * s) / 2, hh = (p.width * s + p.height * c) / 2;
    var cx = p.x + p.width / 2, cy = p.y + p.height / 2;
    return { l: cx - hw, t: cy - hh, r: cx + hw, b: cy + hh, cx: cx, cy: cy, w: hw * 2, h: hh * 2 };
  }
  function isLarge(b, o) { var c = canvasOf(o); return b.w * b.h > c.width * c.height * LARGE_RATIO; }

  // ---- Sistem düzeni ----
  function sysFix(key, e, o, qrStyle) {
    var c = canvasOf(o), m = SYS[key], d = sysDims(key, qrStyle), df = sysDefaults(o)[key];
    e = e || {};
    var maxS = Math.min(m.max, (c.width - 2 * MARGIN) / d.w, (c.height - 2 * MARGIN) / d.h);
    var s = num(e.scale, m.min, maxS, df.scale);
    var x = num(e.x, MARGIN, c.width - MARGIN - d.w * s, df.x);
    var y = num(e.y, MARGIN, c.height - MARGIN - d.h * s, df.y);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, scale: Math.round(s * 100) / 100 };
  }
  function overlap(a, b) { return a.x < b.r + GAP && a.r + GAP > b.x && a.y < b.b + GAP && a.b + GAP > b.y; }
  // Birbirini kapatan sistem öğesi çiftleri: [[anahtarA, anahtarB], ...]
  function sysConflicts(sys, qrStyle) {
    var out = [], boxes = {};
    SYS_KEYS.forEach(function (k) { boxes[k] = sysBox(k, sys[k], qrStyle); });
    for (var i = 0; i < SYS_KEYS.length; i++) for (var j = i + 1; j < SYS_KEYS.length; j++) {
      if (overlap(boxes[SYS_KEYS[i]], boxes[SYS_KEYS[j]])) out.push([SYS_KEYS[i], SYS_KEYS[j]]);
    }
    return out;
  }
  // Çakışmayı gösteren kılavuz bölgeleri (editörde "korumalı alanlar" olarak çizilir; engel değil, rehberdir).
  function zonesOf(design) {
    var o = design.orientation, sys = design.sys || sysDefaults(o), q = design.qrStyle;
    return SYS_KEYS.map(function (k) {
      var b = sysBox(k, sys[k], q);
      return { id: k, label: SYS[k].label, x: b.x, y: b.y, w: b.w, h: b.h };
    });
  }

  // Eski API (v2): yatay varsayılan düzenin bölgeleri.
  var ZONES = (function () {
    var d = sysDefaults('landscape');
    return ['brand', 'chip'].map(function (k) { var b = sysBox(k, d[k], 'tint'); return { id: k, label: SYS[k].label, x: b.x, y: b.y, w: b.w, h: b.h }; });
  })();
  // v3'te serbest yerleştirme: dekoratif katman hiçbir bölgeyle "çakışma hatası" vermez.
  function violation() { return null; }
  function pushOut() { return true; }

  function color(v, errors, label, allowNone) {
    if (allowNone && v === 'none') return 'none';
    if (typeof v === 'string' && HEX.test(v)) return v.toUpperCase();
    errors.push(label + ' için geçersiz renk.');
    return allowNone ? 'none' : '#FFFFFF';
  }

  // İstemciden gelen tasarımı izin listesine göre yeniden kurar. Bilinmeyen alanlar atılır;
  // sistem katmanları (çip, marka, kart bilgisi) istemciden asla katman olarak kabul edilmez.
  function validateDesign(d) {
    var errors = [];
    if (!d || typeof d !== 'object' || !Array.isArray(d.layers)) {
      return { ok: false, errors: ['Geçersiz tasarım verisi.'] };
    }
    var orient = 'landscape';
    if (d.orientation !== undefined) {
      if (ORIENTATIONS.indexOf(d.orientation) >= 0) orient = d.orientation;
      else errors.push('Geçersiz kart yönü.');
    }
    var cv = canvasOf(orient);
    var out = {
      designId: ID.test(d.designId || '') ? d.designId : 'design_local',
      ownerId: ID.test(d.ownerId || '') ? d.ownerId : 'local',
      template: TEMPLATES.indexOf(d.template) >= 0 ? d.template : null,
      orientation: orient,
      canvas: { width: cv.width, height: cv.height },
      layers: [],
      userDisplayName: '',
      nameStyle: { color: 'auto' },
      sysStyle: { color: 'auto' },
      chipStyle: 'gold',
      qrStyle: 'tint',
      sys: {},
      version: Math.max(1, Math.floor(num(d.version, 1, 1e9, 1)))
    };
    if (!out.template) errors.push('Geçersiz şablon.');
    if (d.canvas && (d.canvas.width !== cv.width || d.canvas.height !== cv.height)) {
      errors.push('Kart boyutu değiştirilemez.');
    }
    var nm = validateName(d.userDisplayName);
    out.userDisplayName = nm.value;
    if (!nm.ok) errors.push(nm.error);
    var nc = d.nameStyle && d.nameStyle.color;
    if (nc === undefined || nc === 'auto') out.nameStyle.color = 'auto';
    else out.nameStyle.color = color(nc, errors, 'Ad rengi', false);
    var sc = d.sysStyle && d.sysStyle.color;
    if (sc === undefined || sc === 'auto') out.sysStyle.color = 'auto';
    else out.sysStyle.color = color(sc, errors, 'Sistem yazı rengi', false);
    if (d.chipStyle === undefined) out.chipStyle = 'gold';
    else if (CHIP_STYLES.indexOf(d.chipStyle) >= 0) out.chipStyle = d.chipStyle;
    else errors.push('Geçersiz çip görünümü.');
    if (d.qrStyle === undefined) out.qrStyle = 'tint';
    else if (QR_STYLES.indexOf(d.qrStyle) >= 0) out.qrStyle = d.qrStyle;
    else errors.push('Geçersiz QR görünümü.');

    // Sistem düzeni: konum/ölçek kart sınırına kırpılır; birbirini kapatan öğeler varsayılana döner (hata bildirilir).
    var sin = d.sys && typeof d.sys === 'object' ? d.sys : {}, defs = sysDefaults(orient);
    SYS_KEYS.forEach(function (k) { out.sys[k] = sysFix(k, sin[k], orient, out.qrStyle); });
    sysConflicts(out.sys, out.qrStyle).forEach(function (pair) {
      errors.push('"' + SYS[pair[0]].label + '" ile "' + SYS[pair[1]].label + '" birbirini kapatıyor.');
      out.sys[pair[1]] = sysFix(pair[1], defs[pair[1]], orient, out.qrStyle);
    });

    if (d.layers.length < 1 || d.layers.length > MAX_LAYERS + 1) errors.push('Katman sayısı sınırı aşıldı (en fazla ' + MAX_LAYERS + ').');
    var seen = {}, bg = null, rest = [];
    d.layers.slice(0, MAX_LAYERS + 1).forEach(function (l) {
      if (!l || typeof l !== 'object') { errors.push('Geçersiz katman.'); return; }
      var t = l.type;
      if (typeof t === 'string' && (t.indexOf('system_') === 0 || t === 'user_name')) {
        errors.push('Sistem katmanları istemciden kabul edilmez.'); return;
      }
      if (t !== 'background' && t !== 'shape' && t !== 'texture' && t !== 'light') { errors.push('Desteklenmeyen katman türü.'); return; }
      if (!ID.test(l.id || '') || seen[l.id]) { errors.push('Katman kimliği geçersiz veya tekrar ediyor.'); return; }
      seen[l.id] = 1;
      var p = l.properties || {};
      var base = {
        id: l.id, type: t,
        name: sanitizeText(l.name, 24) || (t === 'background' ? 'Kart zemini' : 'Katman'),
        locked: t === 'background' ? true : l.locked === true,
        visible: l.visible !== false, zIndex: 0, properties: {}
      };
      if (t === 'background') {
        var colors = Array.isArray(p.colors) ? p.colors.slice(0, MAX_BG_COLORS) : [];
        if (colors.length < 1) { errors.push('Zemin rengi eksik.'); colors = ['#101010']; }
        base.properties = {
          mode: p.mode === 'solid' ? 'solid' : 'gradient',
          colors: colors.map(function (c) { return color(c, errors, 'Zemin', false); }),
          angle: num(p.angle, 0, 360, 135),
          finish: FINISHES.indexOf(p.finish) >= 0 ? p.finish : 'matte',
          texture: TEXTURES.indexOf(p.texture) >= 0 ? p.texture : 'none',
          textureOpacity: num(p.textureOpacity, 0, 1, 0.5)
        };
        if (base.properties.mode === 'gradient' && base.properties.colors.length < 2) base.properties.mode = 'solid';
        if (bg) { errors.push('Yalnızca bir kart zemini olabilir.'); return; }
        bg = base;
      } else {
        if (KINDS.indexOf(p.kind) < 0) { errors.push('Geçersiz şekil türü.'); return; }
        var fx = Array.isArray(p.effects) ? p.effects.filter(function (e, i, a) { return OBJ_EFFECTS.indexOf(e) >= 0 && a.indexOf(e) === i; }) : [];
        // v2 uyumu: effects:['shadow'] sayısal gölgeye çevrilir.
        var shadow = p.shadow === undefined ? (fx.indexOf('shadow') >= 0 ? 10 : 0) : num(p.shadow, 0, 40, 0);
        fx = fx.filter(function (e) { return e !== 'shadow'; });
        base.type = TEXTURE_KINDS.indexOf(p.kind) >= 0 ? 'texture' : LIGHT_KINDS.indexOf(p.kind) >= 0 ? 'light' : 'shape';
        base.properties = {
          kind: p.kind,
          x: num(p.x, -1500, 2500, 0), y: num(p.y, -1500, 2500, 0),
          width: num(p.width, 6, 1500, 100), height: num(p.height, 6, 1500, 100),
          rotation: num(p.rotation, -360, 360, 0), opacity: num(p.opacity, 0, 1, 1),
          fill: color(p.fill === undefined ? 'none' : p.fill, errors, 'Dolgu', true),
          stroke: color(p.stroke === undefined ? 'none' : p.stroke, errors, 'Çizgi', true),
          strokeWidth: num(p.strokeWidth, 0, 40, 0),
          radius: num(p.radius, 0, 100, p.kind === 'roundrect' ? 44 : 0),
          shadow: shadow,
          glow: num(p.glow, 0, 40, 0),
          glowColor: p.glowColor === undefined || p.glowColor === 'auto' ? 'auto' : color(p.glowColor, errors, 'Parlama', false),
          flipX: p.flipX === true, flipY: p.flipY === true, lockRatio: p.lockRatio === true,
          effects: fx
        };
        rest.push(base);
      }
    });
    if (!bg) { errors.push('Kart zemini katmanı eksik.'); }
    else {
      out.layers.push(bg);
      rest.forEach(function (l) { out.layers.push(l); });   // v3: dekoratif katmanlar serbest; alan çakışması hata değildir
    }
    // Okunabilirlik: özel renkler zemindeki her renge karşı en az 3:1 olmalı (aksi halde sistem bilgisi görünmez olur).
    if (bg) {
      [['nameStyle', 'Ad rengi'], ['sysStyle', 'Sistem yazı rengi']].forEach(function (pair) {
        var cc = out[pair[0]].color;
        if (cc === 'auto') return;
        var worst = Math.min.apply(null, bg.properties.colors.map(function (c) { return ratio(cc, c); }));
        if (worst < 3) errors.push(pair[1] + ' zeminle yeterli kontrast sağlamıyor (en az 3:1).');
      });
    }
    out.layers.forEach(function (l, i) { l.zIndex = i * 10; });
    return { ok: errors.length === 0, errors: errors, design: out };
  }

  var api = {
    CANVAS: CANVAS, SIZE: SIZE, ORIENTATIONS: ORIENTATIONS, canvasOf: canvasOf, CORNER: CORNER, MARGIN: MARGIN, GAP: GAP,
    ZONES: ZONES, NAME_AREA: NAME_AREA, NAME_LIMITS: NAME_LIMITS, KINDS: KINDS, KINDS_FILL: KINDS_FILL,
    TEXTURE_KINDS: TEXTURE_KINDS, LIGHT_KINDS: LIGHT_KINDS, RADIUS_KINDS: RADIUS_KINDS, STROKE_ONLY: STROKE_ONLY,
    TEMPLATES: TEMPLATES, CHIP_STYLES: CHIP_STYLES, FINISHES: FINISHES, TEXTURES: TEXTURES, OBJ_EFFECTS: OBJ_EFFECTS,
    MAX_LAYERS: MAX_LAYERS, MAX_BG_COLORS: MAX_BG_COLORS, QR_STYLES: QR_STYLES,
    SYS_KEYS: SYS_KEYS, SYS: SYS, SYS_GROUPS: SYS_GROUPS, sysDefaults: sysDefaults, sysDims: sysDims, sysBox: sysBox,
    sysFix: sysFix, sysConflicts: sysConflicts, zonesOf: zonesOf,
    sanitizeName: sanitizeName, validateName: validateName, bbox: bbox, violation: violation,
    pushOut: pushOut, isLarge: isLarge, contrastRatio: ratio, validateDesign: validateDesign
  };
  root.FNXRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
