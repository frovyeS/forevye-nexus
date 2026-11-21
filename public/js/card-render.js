/* Kart çizici: tasarım + sistem kaydı → SVG metni. DOM'a bağımlı değildir. */
(function (root) {
  'use strict';
  var R = root.FNXRules;
  var W = R.CANVAS.width, H = R.CANVAS.height;
  var FONT = "Jost, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

  // Banka logosu ikonu (vektör). viewBox: 30 24 267 202
  var ICON = ['M35 72 L105 28 L228 100 L228 148 L105 76 L68 98 L68 205 L35 205Z',
              'M292 178 L222 222 L99 150 L99 102 L222 174 L259 152 L259 45 L292 45Z'];
  var ICON_VB = [30, 24, 267, 202];
  var WORDMARK = { src: 'assets/wordmark.png', ratio: 1422 / 303 };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function relLum(h) {
    var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    var x = relLum(a), y = relLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function bgLayer(d) { return d.layers.filter(function (l) { return l.type === 'background'; })[0]; }
  function bgAvgColor(d) {
    var cs = bgLayer(d).properties.colors, t = [0, 0, 0];
    cs.forEach(function (c) { rgb(c).forEach(function (v, i) { t[i] += v / cs.length; }); });
    return '#' + t.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
  }
  // Sistem öğelerinin (logo, banka adı, kart bilgisi) rengi, zemindeki HER rengi gözeterek en okunaklı seçeneğe kilitlenir.
  // Şartname bölüm 6: marka her temada yeterli kontrasta sahip olmalı. Kullanıcı bu rengi seçemez.
  var MIN_BRAND = 4.5, MIN_NAME = 3;
  function minContrast(c, d) {
    return Math.min.apply(null, bgLayer(d).properties.colors.map(function (b) { return contrast(c, b); }));
  }
  function tone(d) {
    var avg = bgAvgColor(d), light = '#F2F4F8', dark = '#14161B', gold = '#D8B36A';
    var brand = minContrast(light, d) >= minContrast(dark, d) ? light : dark;
    if (d.template === 'signature' && minContrast(gold, d) >= MIN_BRAND) brand = gold;
    var bc = minContrast(brand, d);
    var want = d.nameStyle && d.nameStyle.color !== 'auto' ? d.nameStyle.color : null;
    var fallback = !!want && minContrast(want, d) < MIN_NAME;   // okunmayan özel ad rengi uygulanmaz
    var nm = want && !fallback ? want : brand;
    return { dark: brand === light, brand: brand, name: nm, avg: avg, brandContrast: bc, plate: bc < 3, nameFallback: fallback };
  }

  // ---- Şekil çizimleri (100x100 kutu) ----
  var SHAPES = {
    circle: function (a) { return '<ellipse cx="50" cy="50" rx="50" ry="50" ' + a + '/>'; },
    ring: function (a) { return '<ellipse cx="50" cy="50" rx="48" ry="48" ' + a + '/>'; },
    line: function (a) { return '<path d="M0 50H100" ' + a + '/>'; },
    arc: function (a) { return '<path d="M3 97A94 94 0 0 1 97 3" ' + a + '/>'; },
    triangle: function (a) { return '<path d="M50 2L98 98H2Z" ' + a + '/>'; },
    hexagon: function (a) { return '<path d="M25 3H75L100 50L75 97H25L0 50Z" ' + a + '/>'; },
    roundrect: function (a) { return '<rect x="1" y="1" width="98" height="98" rx="22" ' + a + '/>'; },
    wave: function (a) { return '<path d="M0 55C16 25 34 25 50 50S84 78 100 45V100H0Z" ' + a + '/>'; },
    wavelines: function (a) {
      return ['M0 28C20 8 30 8 50 28S80 48 100 28', 'M0 52C20 32 30 32 50 52S80 72 100 52', 'M0 76C20 56 30 56 50 76S80 96 100 76']
        .map(function (d) { return '<path d="' + d + '" ' + a + '/>'; }).join('');
    },
    mountain: function (a) { return '<path d="M0 100V72L16 52L28 64L52 12L70 48L82 36L100 70V100Z" ' + a + '/>'; },
    stars: function (a) {
      var pts = [[8, 12, 1.6], [22, 70, 1.2], [35, 30, 2], [48, 88, 1.4], [60, 15, 1.2], [72, 55, 2.2], [85, 25, 1.4],
        [92, 80, 1.8], [15, 45, 1], [55, 45, 1.1], [78, 92, 1.2], [40, 5, 1], [28, 92, 1.1], [95, 50, 1]];
      return pts.map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (p[2] * 0.35).toFixed(2) + '" ' + a + '/>'; }).join('');
    },
    grid: function (a) {
      var o = '';
      [0, 25, 50, 75, 100].forEach(function (v) { o += '<path d="M' + v + ' 0V100M0 ' + v + 'H100" ' + a + '/>'; });
      return o;
    },
    diagonals: function (a) {
      return ['M0 100L100 0', 'M0 66L66 0', 'M33 100L100 33', 'M0 33L33 0', 'M66 100L100 66']
        .map(function (d) { return '<path d="' + d + '" ' + a + '/>'; }).join('');
    },
    nexus: function (a) {
      var vb = ICON_VB;
      return '<g transform="scale(' + (100 / vb[2]) + ' ' + (100 / vb[3]) + ') translate(' + (-vb[0]) + ' ' + (-vb[1]) + ')">' +
        ICON.map(function (d) { return '<path d="' + d + '" ' + a + '/>'; }).join('') + '</g>';
    }
  };

  function shapeInner(kind, p) {
    var so = R.STROKE_ONLY.has(kind), fx = p.effects || [];
    var frost = fx.indexOf('frost') >= 0;
    var fill = so ? 'none' : p.fill, stroke = p.stroke, sw = p.strokeWidth;
    if (so) {
      if (stroke === 'none') stroke = p.fill !== 'none' ? p.fill : '#ffffff';
      if (!sw) sw = 3;
    }
    var extra = '';
    if (frost) {
      if (so) { stroke = '#ffffff'; extra = ' stroke-opacity="0.65"'; }
      else { fill = '#ffffff'; stroke = '#ffffff'; sw = sw || 1.5; extra = ' fill-opacity="0.16" stroke-opacity="0.5"'; }
    }
    if (kind === 'nexus') { stroke = 'none'; sw = 0; }
    var a = 'fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + (sw || 0) + '"' + extra +
      ' stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"';
    return SHAPES[kind](a);
  }

  function chipMarkup(style, x, y, w, h, P) {
    var lines = 'stroke="rgba(0,0,0,.42)" stroke-width="2" fill="none" stroke-linecap="round"';
    var ix = x + 36, iy = y + 26;
    return '<g data-sys="chip">' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="15" fill="url(#' + P + 'chip_' + style + ')" stroke="rgba(0,0,0,.55)" stroke-width="2.5"/>' +
      '<rect x="' + ix + '" y="' + iy + '" width="' + (w - 72) + '" height="' + (h - 52) + '" rx="9" ' + lines + '/>' +
      '<path d="M' + x + ' ' + (y + h * 0.34) + 'H' + ix + 'M' + (x + w - 36) + ' ' + (y + h * 0.34) + 'H' + (x + w) +
      'M' + x + ' ' + (y + h * 0.66) + 'H' + ix + 'M' + (x + w - 36) + ' ' + (y + h * 0.66) + 'H' + (x + w) +
      'M' + (x + w / 2) + ' ' + y + 'V' + iy + 'M' + (x + w / 2) + ' ' + (y + h - 26) + 'V' + (y + h) + '" ' + lines + '/>' +
      '<rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="' + (w - 4) + '" height="' + (h * 0.45) + '" rx="13" fill="url(#' + P + 'chipsheen)"/>' +
      '</g>';
  }

  var CHIP_STOPS = {
    gold: ['#F6DC95', '#C9993F', '#EBCB78'], silver: ['#F1F3F8', '#A5ABBA', '#DDE1EA'], rose: ['#F3C9A7', '#B5744B', '#E7B28A']
  };

  function bgGrad(P, bp) {
    if (bp.mode === 'solid' || bp.colors.length < 2) return '';
    var a = bp.angle * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    var st = bp.colors.map(function (c, i) {
      return '<stop offset="' + (i / (bp.colors.length - 1)) + '" stop-color="' + c + '"/>';
    }).join('');
    return '<linearGradient id="' + P + 'bg" x1="' + (0.5 - dx / 2) + '" y1="' + (0.5 - dy / 2) + '" x2="' + (0.5 + dx / 2) + '" y2="' + (0.5 + dy / 2) + '">' + st + '</linearGradient>';
  }

  function layerMarkup(l, P, interactive) {
    var p = l.properties, cx = p.width / 2, cy = p.height / 2;
    var tr = 'translate(' + p.x + ' ' + p.y + ') rotate(' + p.rotation + ' ' + cx + ' ' + cy + ') ' +
      'translate(' + cx + ' ' + cy + ') scale(' + (p.flipX ? -1 : 1) + ' ' + (p.flipY ? -1 : 1) + ') translate(' + (-cx) + ' ' + (-cy) + ') ' +
      'scale(' + (p.width / 100) + ' ' + (p.height / 100) + ')';
    var fx = p.effects || [], filter = '';
    if (fx.indexOf('emboss') >= 0) filter = ' filter="url(#' + P + 'fEmboss)"';
    else if (fx.indexOf('shadow') >= 0) filter = ' filter="url(#' + P + 'fShadow)"';
    var hit = interactive && R.STROKE_ONLY.has(p.kind) ? '<rect width="100" height="100" fill="transparent"/>' : '';
    var fill = p.kind === 'nexus' ? p.fill : p.fill;
    var inner = shapeInner(p.kind, Object.assign({}, p, { fill: fill }));
    if (p.kind === 'nexus' && p.fill === 'none') inner = shapeInner('nexus', Object.assign({}, p, { fill: '#ffffff' }));
    return '<g class="dl" data-id="' + esc(l.id) + '" clip-path="url(#' + P + 'dc)" opacity="' + p.opacity + '"' + filter + '>' +
      '<g transform="' + tr + '">' + hit + inner + '</g></g>';
  }

  function finishMarkup(f, P) {
    if (f === 'glossy') return '<rect width="' + W + '" height="' + H + '" fill="url(#' + P + 'gloss)"/>';
    if (f === 'foil') return '<rect width="' + W + '" height="' + H + '" fill="url(#' + P + 'foil)" data-blend="soft-light" style="mix-blend-mode:soft-light"/>';
    if (f === 'holo') return '<rect width="' + W + '" height="' + H + '" fill="url(#' + P + 'holo)" opacity="0.5" data-blend="overlay" style="mix-blend-mode:overlay"/>';
    return '';
  }

  function renderCard(d, sys, o) {
    o = o || {};
    var P = o.prefix || 'c', t = tone(d), bg = bgLayer(d), bp = bg.properties;
    var zonePath = 'M0 0H' + W + 'V' + H + 'H0Z' + R.ZONES.filter(function (z) { return !z.noclip; }).map(function (z) {
      return 'M' + z.x + ' ' + z.y + 'h' + z.w + 'v' + z.h + 'h' + (-z.w) + 'Z';
    }).join('');
    var chips = Object.keys(CHIP_STOPS).map(function (k) {
      var s = CHIP_STOPS[k];
      return '<linearGradient id="' + P + 'chip_' + k + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + s[0] + '"/><stop offset=".5" stop-color="' + s[1] + '"/><stop offset="1" stop-color="' + s[2] + '"/></linearGradient>';
    }).join('');
    var defs = '<defs>' +
      '<clipPath id="' + P + 'cc"><rect width="' + W + '" height="' + H + '" rx="36"/></clipPath>' +
      '<clipPath id="' + P + 'dc"><path clip-rule="evenodd" d="' + zonePath + '"/></clipPath>' +
      bgGrad(P, bp) + chips +
      '<linearGradient id="' + P + 'chipsheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="' + P + 'gloss" x1="0" y1="0" x2="1" y2="1"><stop offset=".22" stop-color="#fff" stop-opacity="0"/><stop offset=".4" stop-color="#fff" stop-opacity=".26"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="' + P + 'foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".25" stop-color="#8a8f9e" stop-opacity=".3"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset=".75" stop-color="#8a8f9e" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity=".5"/></linearGradient>' +
      '<linearGradient id="' + P + 'holo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6ec7"/><stop offset=".2" stop-color="#ffd86e"/><stop offset=".4" stop-color="#6effb5"/><stop offset=".6" stop-color="#6ec8ff"/><stop offset=".8" stop-color="#b06eff"/><stop offset="1" stop-color="#ff6ec7"/></linearGradient>' +
      '<filter id="' + P + 'fShadow" filterUnits="userSpaceOnUse" x="-200" y="-200" width="1300" height="960"><feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#000" flood-opacity=".5"/></filter>' +
      '<filter id="' + P + 'fEmboss" filterUnits="userSpaceOnUse" x="-200" y="-200" width="1300" height="960"><feDropShadow dx="2.5" dy="3.5" stdDeviation="2" flood-color="#000" flood-opacity=".55" result="a"/><feDropShadow in="a" dx="-1.5" dy="-1.5" stdDeviation="1" flood-color="#fff" flood-opacity=".55"/></filter>' +
      '</defs>';

    var bgFill = bp.mode === 'solid' || bp.colors.length < 2 ? bp.colors[0] : 'url(#' + P + 'bg)';
    var body = '<rect data-id="bg" width="' + W + '" height="' + H + '" fill="' + bgFill + '"/>';
    d.layers.forEach(function (l) {
      if (l.type !== 'background' && l.visible) body += layerMarkup(l, P, o.interactive);
    });
    var fin = finishMarkup(bp.finish, P);
    if (fin) body += '<g pointer-events="none">' + fin + '</g>';

    // Sistem katmanları (Grup D): banka adı/logosu, çip, sistem bilgileri.
    var ix = 52, iy = 46, ih = 66, iw = ih * ICON_VB[2] / ICON_VB[3];
    var wh = 50, ww = wh * WORDMARK.ratio, wx = ix + iw + 24, wy = iy + (ih - wh) / 2;
    var brand = '<g data-sys="brand">' +
      '<svg x="' + ix + '" y="' + iy + '" width="' + iw + '" height="' + ih + '" viewBox="' + ICON_VB.join(' ') + '" fill="' + t.brand + '">' +
      ICON.map(function (dd) { return '<path d="' + dd + '"/>'; }).join('') + '</svg>' +
      '<mask id="' + P + 'wm" maskUnits="userSpaceOnUse" x="' + wx + '" y="' + wy + '" width="' + ww + '" height="' + wh + '">' +
      '<image href="' + WORDMARK.src + '" x="' + wx + '" y="' + wy + '" width="' + ww + '" height="' + wh + '"/></mask>' +
      '<rect x="' + wx + '" y="' + wy + '" width="' + ww + '" height="' + wh + '" fill="' + t.brand + '" mask="url(#' + P + 'wm)"/></g>';
    // Nexus'ta kart kimliği NXC-XXXX-XXXX biçimindedir (harf içerir): sys.last4 verilirse olduğu gibi gösterilir, yoksa kart numarasının son 4 hanesi.
    var last4 = sys && sys.last4 ? String(sys.last4).replace(/[^A-Za-z0-9•]/g, '').slice(-4) : String((sys && sys.cardNumber) || '0000').replace(/\D/g, '').slice(-4);
    var info = '<g data-sys="info"><path d="M748 62H800" stroke="' + t.brand + '" stroke-width="3.5" stroke-linecap="round" opacity=".9"/>' +
      '<text x="830" y="498" text-anchor="end" font-family="' + FONT + '" font-size="22" letter-spacing="3" fill="' + t.brand + '" opacity=".85">•••• ' + esc(last4) + '</text></g>';
    // Hiçbir renk logoya yeterli kontrast veremiyorsa (ör. çok renkli/orta tonlu zemin) sistem, markanın arkasına kendi yarı saydam zeminini koyar.
    if (t.plate) {
      var bz = R.ZONES.filter(function (z) { return z.id === 'brand'; })[0];
      body += '<rect data-sys="brand-plate" x="' + bz.x + '" y="' + (bz.y + 6) + '" width="' + (bz.w - 20) + '" height="' + (bz.h - 12) + '" rx="22" fill="' + (t.dark ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.6)') + '"/>';
    }
    body += brand + chipMarkup(d.chipStyle || 'gold', 52, 176, 112, 88, P) + info;

    // Kullanıcı adı (Grup E): yerleşimi sabit, boyutu otomatik sığdırılır.
    var nm = String(d.userDisplayName || '').toLocaleUpperCase('tr-TR');
    var len = Math.max(1, Array.from(nm).length);
    var size = Math.min(30, R.NAME_AREA.w / (0.95 * len));
    body += '<text data-id="name" x="52" y="488" font-family="' + FONT + '" font-weight="500" font-size="' + size.toFixed(1) +
      '" letter-spacing="' + (size * 0.16).toFixed(1) + '" fill="' + t.name + '">' + esc(nm) + '</text>';

    var edge = '<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" rx="35" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="2" pointer-events="none"/>';
    return defs + '<g clip-path="url(#' + P + 'cc)">' + body + '</g>' + edge;
  }

  function cardSvg(d, sys, o) {
    return '<svg class="card-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Forevye Nexus sanal kartı">' +
      renderCard(d, sys, o) + '</svg>';
  }
  function iconSvg(cls) {
    return '<svg class="' + (cls || '') + '" viewBox="' + ICON_VB.join(' ') + '" fill="currentColor" aria-hidden="true">' +
      ICON.map(function (dd) { return '<path d="' + dd + '"/>'; }).join('') + '</svg>';
  }

  root.FNXRender = { renderCard: renderCard, cardSvg: cardSvg, iconSvg: iconSvg, shapeInner: shapeInner, tone: tone,
    contrast: contrast, minContrast: minContrast, relLum: relLum, esc: esc, bgLayer: bgLayer, chipMarkup: chipMarkup, WORDMARK: WORDMARK };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FNXRender;
})(typeof window !== 'undefined' ? window : globalThis);
