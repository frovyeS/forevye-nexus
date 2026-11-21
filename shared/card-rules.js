/* Forevye Nexus — kart tasarım kuralları.
 * Bu dosya DOM'a bağımlı değildir: aynı kod Cloudflare Worker'da sunucu doğrulaması için
 * olduğu gibi kullanılabilir (module.exports ile). İstemci kontrolü yalnızca deneyim içindir;
 * asıl güvenlik kontrolü sunucuda aynı validateDesign ile yapılmalıdır. */
(function (root) {
  'use strict';

  var CANVAS = { width: 856, height: 540 };

  // Korumalı bölgeler (çip bölgesi görünür sınırdan biraz büyüktür).
  var ZONES = [
    { id: 'brand', label: 'banka adı ve logosu', x: 40, y: 32, w: 440, h: 100 },
    { id: 'chip', label: 'çip', x: 38, y: 162, w: 140, h: 116 },
    { id: 'info_top', label: 'sistem bilgisi', x: 726, y: 40, w: 100, h: 44, noclip: true },
    { id: 'info_bottom', label: 'sistem bilgisi', x: 640, y: 466, w: 190, h: 56, noclip: true }
  ];
  var NAME_AREA = { x: 52, y: 446, w: 560, h: 64 };
  var NAME_LIMITS = { min: 2, max: 18 };

  var KINDS = ['circle', 'ring', 'line', 'arc', 'triangle', 'hexagon', 'roundrect',
    'wave', 'wavelines', 'mountain', 'stars', 'grid', 'diagonals', 'nexus'];
  var TEXTURE_KINDS = ['stars', 'grid', 'diagonals', 'wavelines'];
  var STROKE_ONLY = { ring: 1, line: 1, arc: 1, wavelines: 1, grid: 1, diagonals: 1 };
  STROKE_ONLY.has = function (k) { return Object.prototype.hasOwnProperty.call(STROKE_ONLY, k) && k !== 'has'; };

  var TEMPLATES = ['classic', 'signature', 'creative', 'mountain'];
  var CHIP_STYLES = ['gold', 'silver', 'rose'];
  var FINISHES = ['matte', 'glossy', 'foil', 'holo'];
  var OBJ_EFFECTS = ['shadow', 'emboss', 'frost'];
  var MAX_LAYERS = 40;
  var LARGE_RATIO = 0.35; // Kartın %35'inden büyük nesneler çevresindeki korumalı alanlardan kırpılır.

  var HEX = /^#[0-9a-fA-F]{6}$/;
  var ID = /^[A-Za-z0-9_\-]{1,64}$/;

  function num(v, min, max, def) {
    v = Number(v);
    if (!isFinite(v)) return def;
    return Math.min(max, Math.max(min, v));
  }

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
  function hits(b, z) { return b.l < z.x + z.w && b.r > z.x && b.t < z.y + z.h && b.b > z.y; }
  function isLarge(b) { return b.w * b.h > CANVAS.width * CANVAS.height * LARGE_RATIO; }

  // Küçük/orta nesneler korumalı alanla kesişemez. Büyük nesneler serbesttir;
  // onlar çizim aşamasında korumalı alanlar kesilerek (clip) çizilir.
  function violation(layer) {
    if (layer.type === 'background') return null;
    var p = layer.properties, b = bbox(p);
    if (b.cx < 0 || b.cx > CANVAS.width || b.cy < 0 || b.cy > CANVAS.height) return { id: 'canvas', label: 'kart dışı' };
    if (isLarge(b)) return null;
    for (var i = 0; i < ZONES.length; i++) if (hits(b, ZONES[i])) return ZONES[i];
    return null;
  }

  // Nesneyi en yakın güvenli konuma iter. Başarılıysa true.
  function pushOut(layer) {
    var p = layer.properties;
    for (var n = 0; n < 6; n++) {
      var b = bbox(p), z = null;
      if (isLarge(b)) return true;
      for (var i = 0; i < ZONES.length; i++) if (hits(b, ZONES[i])) { z = ZONES[i]; break; }
      if (!z) return !violation(layer);
      var opts = [
        { dx: z.x - b.r, dy: 0 }, { dx: z.x + z.w - b.l, dy: 0 },
        { dx: 0, dy: z.y - b.b }, { dx: 0, dy: z.y + z.h - b.t }
      ].sort(function (a, c) { return (Math.abs(a.dx) + Math.abs(a.dy)) - (Math.abs(c.dx) + Math.abs(c.dy)); });
      p.x += opts[0].dx; p.y += opts[0].dy;
    }
    return !violation(layer);
  }

  function color(v, errors, label, allowNone) {
    if (allowNone && v === 'none') return 'none';
    if (typeof v === 'string' && HEX.test(v)) return v.toUpperCase();
    errors.push(label + ' için geçersiz renk.');
    return allowNone ? 'none' : '#FFFFFF';
  }

  // İstemciden gelen tasarımı izin listesine göre yeniden kurar. Bilinmeyen alanlar atılır;
  // sistem katmanları (çip, marka, kart bilgisi) istemciden asla kabul edilmez.
  function validateDesign(d) {
    var errors = [];
    if (!d || typeof d !== 'object' || !Array.isArray(d.layers)) {
      return { ok: false, errors: ['Geçersiz tasarım verisi.'] };
    }
    var out = {
      designId: ID.test(d.designId || '') ? d.designId : 'design_local',
      ownerId: ID.test(d.ownerId || '') ? d.ownerId : 'local',
      template: TEMPLATES.indexOf(d.template) >= 0 ? d.template : null,
      canvas: { width: CANVAS.width, height: CANVAS.height },
      layers: [],
      userDisplayName: '',
      nameStyle: { color: 'auto' },
      chipStyle: 'gold',
      version: Math.max(1, Math.floor(num(d.version, 1, 1e9, 1)))
    };
    if (!out.template) errors.push('Geçersiz şablon.');
    if (d.canvas && (d.canvas.width !== CANVAS.width || d.canvas.height !== CANVAS.height)) {
      errors.push('Kart boyutu değiştirilemez.');
    }
    var nm = validateName(d.userDisplayName);
    out.userDisplayName = nm.value;
    if (!nm.ok) errors.push(nm.error);
    var nc = d.nameStyle && d.nameStyle.color;
    if (nc === undefined || nc === 'auto') out.nameStyle.color = 'auto';
    else out.nameStyle.color = color(nc, errors, 'Ad rengi', false);
    if (d.chipStyle === undefined) out.chipStyle = 'gold';
    else if (CHIP_STYLES.indexOf(d.chipStyle) >= 0) out.chipStyle = d.chipStyle;
    else errors.push('Geçersiz çip görünümü.');

    if (d.layers.length < 1 || d.layers.length > MAX_LAYERS + 1) errors.push('Katman sayısı sınırı aşıldı (en fazla ' + MAX_LAYERS + ').');
    var seen = {}, bg = null, rest = [];
    d.layers.slice(0, MAX_LAYERS + 1).forEach(function (l, idx) {
      if (!l || typeof l !== 'object') { errors.push('Geçersiz katman.'); return; }
      var t = l.type;
      if (typeof t === 'string' && (t.indexOf('system_') === 0 || t === 'user_name')) {
        errors.push('Sistem katmanları istemciden kabul edilmez.'); return;
      }
      if (t !== 'background' && t !== 'shape' && t !== 'texture') { errors.push('Desteklenmeyen katman türü.'); return; }
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
        var colors = Array.isArray(p.colors) ? p.colors.slice(0, 3) : [];
        if (colors.length < 1) { errors.push('Zemin rengi eksik.'); colors = ['#101010']; }
        base.properties = {
          mode: p.mode === 'solid' ? 'solid' : 'gradient',
          colors: colors.map(function (c) { return color(c, errors, 'Zemin', false); }),
          angle: num(p.angle, 0, 360, 135),
          finish: FINISHES.indexOf(p.finish) >= 0 ? p.finish : 'matte'
        };
        if (base.properties.mode === 'gradient' && base.properties.colors.length < 2) base.properties.mode = 'solid';
        if (bg) { errors.push('Yalnızca bir kart zemini olabilir.'); return; }
        bg = base;
      } else {
        if (KINDS.indexOf(p.kind) < 0) { errors.push('Geçersiz şekil türü.'); return; }
        var fx = Array.isArray(p.effects) ? p.effects.filter(function (e, i, a) { return OBJ_EFFECTS.indexOf(e) >= 0 && a.indexOf(e) === i; }) : [];
        base.type = TEXTURE_KINDS.indexOf(p.kind) >= 0 ? 'texture' : 'shape';
        base.properties = {
          kind: p.kind,
          x: num(p.x, -1500, 2500, 0), y: num(p.y, -1500, 2500, 0),
          width: num(p.width, 6, 1500, 100), height: num(p.height, 6, 1500, 100),
          rotation: num(p.rotation, -360, 360, 0), opacity: num(p.opacity, 0, 1, 1),
          fill: color(p.fill === undefined ? 'none' : p.fill, errors, 'Dolgu', true),
          stroke: color(p.stroke === undefined ? 'none' : p.stroke, errors, 'Çizgi', true),
          strokeWidth: num(p.strokeWidth, 0, 40, 0),
          flipX: p.flipX === true, flipY: p.flipY === true, lockRatio: p.lockRatio === true,
          effects: fx
        };
        rest.push(base);
      }
    });
    if (!bg) { errors.push('Kart zemini katmanı eksik.'); }
    else {
      out.layers.push(bg);
      rest.forEach(function (l) {
        var v = violation(l);
        if (v) errors.push('"' + l.name + '" korumalı alanla çakışıyor (' + v.label + ').');
        out.layers.push(l);
      });
    }
    // Okunabilirlik: özel ad rengi zemindeki her renge karşı en az 3:1 olmalı (aksi halde ad görünmez olur).
    if (bg && out.nameStyle.color !== 'auto') {
      var worst = Math.min.apply(null, bg.properties.colors.map(function (c) { return ratio(out.nameStyle.color, c); }));
      if (worst < 3) errors.push('Ad rengi zeminle yeterli kontrast sağlamıyor (en az 3:1).');
    }
    out.layers.forEach(function (l, i) { l.zIndex = i * 10; });
    return { ok: errors.length === 0, errors: errors, design: out };
  }

  var api = {
    CANVAS: CANVAS, ZONES: ZONES, NAME_AREA: NAME_AREA, NAME_LIMITS: NAME_LIMITS, KINDS: KINDS,
    TEXTURE_KINDS: TEXTURE_KINDS, STROKE_ONLY: STROKE_ONLY, TEMPLATES: TEMPLATES, CHIP_STYLES: CHIP_STYLES,
    FINISHES: FINISHES, OBJ_EFFECTS: OBJ_EFFECTS, MAX_LAYERS: MAX_LAYERS,
    sanitizeName: sanitizeName, validateName: validateName, bbox: bbox, violation: violation,
    pushOut: pushOut, isLarge: isLarge, contrastRatio: ratio, validateDesign: validateDesign
  };
  root.FNXRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
