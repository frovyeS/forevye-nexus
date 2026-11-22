/* Kart çizici (sözleşme sürüm 3): tasarım + sistem kaydı → SVG metni. DOM'a bağımlı değildir.
 * Katman önceliği (alttan üste): A) arka plan + doku → B) dekoratif katmanlar (serbest) → yüzey cilası →
 * C) SİSTEM ÖĞELERİ (logo, çip, kod, numara, ad, QR). Sistem öğeleri her zaman en üsttedir. */
(function (root) {
  'use strict';
  var R = root.FNXRules;
  var FONT = "Jost, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

  // Banka logosu ikonu (vektör). viewBox: 30 24 267 202
  var ICON = ['M35 72 L105 28 L228 100 L228 148 L105 76 L68 98 L68 205 L35 205Z',
              'M292 178 L222 222 L99 150 L99 102 L222 174 L259 152 L259 45 L292 45Z'];
  var ICON_VB = [30, 24, 267, 202];
  var WORDMARK = { src: 'assets/wordmark.png', ratio: 1422 / 303 };
  var uidc = 0;
  function uid(p) { return (p || 'u') + (uidc++).toString(36); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function hex(c) { return '#' + c.map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(''); }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return hex(x.map(function (v, i) { return v + (y[i] - v) * t; })); }
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
    return hex(t);
  }
  // Sistem öğelerinin rengi, zemindeki HER rengi gözeterek en okunaklı seçeneğe kilitlenir (marka her temada yeterli kontrasta sahip olmalı).
  var MIN_BRAND = 4.5, MIN_NAME = 3;
  function minContrast(c, d) {
    return Math.min.apply(null, bgLayer(d).properties.colors.map(function (b) { return contrast(c, b); }));
  }
  function tone(d) {
    var avg = bgAvgColor(d), light = '#F2F4F8', dark = '#14161B', gold = '#D8B36A';
    var brand = minContrast(light, d) >= minContrast(dark, d) ? light : dark;
    if ((d.template === 'signature' || d.template === 'royal') && minContrast(gold, d) >= MIN_BRAND) brand = gold;
    var sw = d.sysStyle && d.sysStyle.color !== 'auto' ? d.sysStyle.color : null;
    if (sw && minContrast(sw, d) >= MIN_NAME) brand = sw;
    var bc = minContrast(brand, d);
    var want = d.nameStyle && d.nameStyle.color !== 'auto' ? d.nameStyle.color : null;
    var fallback = !!want && minContrast(want, d) < MIN_NAME;   // okunmayan özel ad rengi uygulanmaz
    var nm = want && !fallback ? want : brand;
    var isLight = relLum(brand) > 0.4;
    return { dark: isLight, brand: brand, name: nm, avg: avg, brandContrast: bc, plate: bc < 3, nameFallback: fallback, halo: isLight ? '#000000' : '#FFFFFF' };
  }

  // ---- Şekil çizimleri (100x100 kutu) ----
  function rrect(a, p) {
    var w = p.width || 100, h = p.height || 100;
    var rp = (p.radius == null ? (p.kind === 'roundrect' ? 44 : 0) : p.radius) / 100 * Math.min(w, h) / 2;
    return '<rect x="1" y="1" width="98" height="98" rx="' + (rp * 100 / w).toFixed(2) + '" ry="' + (rp * 100 / h).toFixed(2) + '" ' + a + '/>';
  }
  function hexPath(cx, cy, r) {
    var pts = [];
    for (var i = 0; i < 6; i++) { var an = Math.PI / 180 * (60 * i - 30); pts.push((cx + r * Math.cos(an)).toFixed(1) + ' ' + (cy + r * Math.sin(an)).toFixed(1)); }
    return 'M' + pts.join('L') + 'Z';
  }
  var SHAPES = {
    circle: function (a) { return '<ellipse cx="50" cy="50" rx="50" ry="50" ' + a + '/>'; },
    ring: function (a) { return '<ellipse cx="50" cy="50" rx="48" ry="48" ' + a + '/>'; },
    line: function (a) { return '<path d="M0 50H100" ' + a + '/>'; },
    arc: function (a) { return '<path d="M3 97A94 94 0 0 1 97 3" ' + a + '/>'; },
    triangle: function (a) { return '<path d="M50 2L98 98H2Z" ' + a + '/>'; },
    hexagon: function (a) { return '<path d="M25 3H75L100 50L75 97H25L0 50Z" ' + a + '/>'; },
    diamond: function (a) { return '<path d="M50 1L99 50L50 99L1 50Z" ' + a + '/>'; },
    roundrect: function (a, p) { return rrect(a, p); },
    rect: function (a, p) { return rrect(a, p); },
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
    dots: function (a) {
      var o = '';
      for (var i = 0; i < 9; i++) for (var j = 0; j < 9; j++) o += '<circle cx="' + (6 + j * 11) + '" cy="' + (6 + i * 11) + '" r="1.3" ' + a + '/>';
      return o;
    },
    rings: function (a) { return [47, 37, 27, 17, 7].map(function (r) { return '<ellipse cx="50" cy="50" rx="' + r + '" ry="' + r + '" ' + a + '/>'; }).join(''); },
    rays: function (a) {
      var o = '';
      for (var i = 0; i < 18; i++) { var an = Math.PI * 2 * i / 18, c = Math.cos(an), s = Math.sin(an); o += '<path d="M' + (50 + c * 8).toFixed(1) + ' ' + (50 + s * 8).toFixed(1) + 'L' + (50 + c * 49).toFixed(1) + ' ' + (50 + s * 49).toFixed(1) + '" ' + a + '/>'; }
      return o;
    },
    hexgrid: function (a) {
      var o = '', r = 9, dx = r * 1.732, dy = r * 1.5;
      for (var i = 0; i < 9; i++) for (var j = 0; j < 8; j++) {
        var cx = j * dx + (i % 2 ? dx / 2 : 0), cy = i * dy;
        if (cx <= 106 && cy <= 106) o += '<path d="' + hexPath(cx, cy, r - 0.6) + '" ' + a + '/>';
      }
      return o;
    },
    nexus: function (a) {
      var vb = ICON_VB;
      return '<g transform="scale(' + (100 / vb[2]) + ' ' + (100 / vb[3]) + ') translate(' + (-vb[0]) + ' ' + (-vb[1]) + ')">' +
        ICON.map(function (d) { return '<path d="' + d + '" ' + a + '/>'; }).join('') + '</g>';
    }
  };

  function lightInner(kind, col) {
    var id = uid('lg');
    if (kind === 'glow') {
      return '<defs><radialGradient id="' + id + '"><stop offset="0" stop-color="' + col + '" stop-opacity="1"/><stop offset=".45" stop-color="' + col + '" stop-opacity=".42"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></radialGradient></defs>' +
        '<ellipse cx="50" cy="50" rx="50" ry="50" fill="url(#' + id + ')"/>';
    }
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + col + '" stop-opacity="0"/><stop offset=".5" stop-color="' + col + '" stop-opacity="1"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="' + id + 'h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".12" stop-color="#fff" stop-opacity="1"/><stop offset=".88" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<mask id="' + id + 'm" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="url(#' + id + 'h)"/></mask></defs>' +
      '<rect width="100" height="100" fill="url(#' + id + ')" mask="url(#' + id + 'm)"/>';
  }

  function shapeInner(kind, p) {
    p = p || {};
    if (R.LIGHT_KINDS.indexOf(kind) >= 0) return lightInner(kind, p.fill && p.fill !== 'none' ? p.fill : (p.stroke && p.stroke !== 'none' ? p.stroke : '#FFFFFF'));
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
    return SHAPES[kind](a, Object.assign({ kind: kind }, p));
  }

  /* ---------- EMV çip (yerel kutu 100x78) ---------- */
  var CHIP_STOPS = {
    gold: ['#FBE9B0', '#D9AE52', '#97701F', '#F3DA8E'], silver: ['#F7F8FC', '#BCC2CF', '#7C8394', '#E8EBF2'],
    rose: ['#F8D9BE', '#CB8D60', '#8A5431', '#EFC3A1'], titanium: ['#E8EBEF', '#A0A7B1', '#5C626D', '#D0D5DB'],
    onyx: ['#6A6E7B', '#32353F', '#121318', '#4C505C'], emerald: ['#A8E8CD', '#42A97F', '#1B6648', '#86D6B1']
  };
  function chipDefs(style, P) {
    var s = CHIP_STOPS[style] || CHIP_STOPS.gold, id = P + 'chip_' + style;
    var g = function (i, a, b, rev) {
      var st = rev ? [s[3], s[2], s[1], s[0]] : s;
      return '<linearGradient id="' + i + '" x1="' + a + '" y1="0" x2="' + b + '" y2="1">' +
        '<stop offset="0" stop-color="' + st[0] + '"/><stop offset=".38" stop-color="' + st[1] + '"/><stop offset=".72" stop-color="' + st[2] + '"/><stop offset="1" stop-color="' + st[3] + '"/></linearGradient>';
    };
    return g(id, 0, 1, false) + g(id + 'b', 1, 0, true) +
      '<linearGradient id="' + P + 'chipedge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".5" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>' +
      '<linearGradient id="' + P + 'chipsheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="' + P + 'chipshade" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>' +
      '<clipPath id="' + P + 'chipclip"><rect width="100" height="78" rx="12"/></clipPath>';
  }
  function chipMarkup(style, P) {
    var id = P + 'chip_' + style;
    var grooves = 'M0 26H33M0 39H33M0 52H33M67 26H100M67 39H100M67 52H100M50 0V20M50 58V78';
    var brushed = '';
    for (var i = 0; i < 9; i++) brushed += 'M35 ' + (23 + i * 4) + 'H65';
    return '<g>' +
      '<rect x="0" y="1.2" width="100" height="78" rx="12" fill="#000" opacity=".28"/>' +
      '<rect width="100" height="78" rx="12" fill="url(#' + id + ')"/>' +
      '<g clip-path="url(#' + P + 'chipclip)">' +
      '<rect x="0" y="0" width="33" height="26" fill="#fff" opacity=".06"/><rect x="67" y="26" width="33" height="13" fill="#000" opacity=".06"/><rect x="0" y="52" width="33" height="26" fill="#000" opacity=".07"/><rect x="67" y="0" width="33" height="26" fill="#fff" opacity=".05"/>' +
      '<rect x="33" y="20" width="34" height="38" rx="7" fill="url(#' + id + 'b)"/>' +
      '<path d="' + brushed + '" stroke="#fff" stroke-opacity=".16" stroke-width=".45" fill="none"/>' +
      '<g transform="translate(.9 .9)"><path d="' + grooves + '" stroke="#fff" stroke-opacity=".42" stroke-width=".8" fill="none"/><rect x="33" y="20" width="34" height="38" rx="7" stroke="#fff" stroke-opacity=".42" stroke-width=".8" fill="none"/></g>' +
      '<path d="' + grooves + '" stroke="#000" stroke-opacity=".5" stroke-width="1.2" fill="none"/><rect x="33" y="20" width="34" height="38" rx="7" stroke="#000" stroke-opacity=".5" stroke-width="1.2" fill="none"/>' +
      '<rect width="100" height="78" fill="url(#' + P + 'chipshade)"/>' +
      '<path d="M-6 44L44 -6H68L-6 68Z" fill="url(#' + P + 'chipsheen)" opacity=".7"/>' +
      '<path d="M-4 58L52 -4" stroke="#fff" stroke-opacity=".38" stroke-width=".9" fill="none"/>' +
      '</g>' +
      '<rect x=".75" y=".75" width="98.5" height="76.5" rx="11.3" fill="none" stroke="url(#' + P + 'chipedge)" stroke-width="1.5"/></g>';
  }
  function chipSvg(style, cls) {
    var P = uid('cs');
    return '<svg class="' + (cls || '') + '" viewBox="-2 -2 104 84" aria-hidden="true"><defs>' + chipDefs(style, P) + '</defs>' + chipMarkup(style, P) + '</svg>';
  }

  /* ---------- QR ---------- */
  function qrModules(token) {
    if (!token || !root.FNXQRCode) return null;
    try {
      var qr = new root.FNXQRCode(0, (root.FNXQRErrorCorrectLevel || {}).M || 0);
      qr.addData('FNX1|' + String(token));
      qr.make();
      return qr;
    } catch (e) { return null; }
  }
  function qrRects(qr, x, y, size, quiet, fg) {
    var n = qr.getModuleCount(), unit = size / (n + quiet * 2), out = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (qr.isDark(r, c)) out += '<rect x="' + (x + (c + quiet) * unit).toFixed(2) + '" y="' + (y + (r + quiet) * unit).toFixed(2) + '" width="' + (unit + 0.08).toFixed(2) + '" height="' + (unit + 0.08).toFixed(2) + '" fill="' + fg + '"/>';
    }
    return out;
  }
  // Büyük, taranabilir QR (pencere/modal için): düz siyah-beyaz, sessiz bölgeli.
  function qrSvg(token, o) {
    o = o || {};
    var qr = qrModules(token); if (!qr) return '';
    var size = o.size || 256;
    return '<svg class="' + (o.cls || '') + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Kart QR kodu" shape-rendering="crispEdges">' +
      '<rect width="' + size + '" height="' + size + '" rx="12" fill="' + (o.bg || '#FFFFFF') + '"/>' + qrRects(qr, 0, 0, size, 4, o.fg || '#101116') + '</svg>';
  }
  function qrColors(t) {
    var plate = mix(t.avg, '#FFFFFF', t.dark ? 0.86 : 0.55), ink = mix(t.avg, '#000000', 0.9);
    if (contrast(plate, ink) < 7) { plate = '#F4F5F8'; ink = '#101116'; }
    return { plate: plate, ink: ink };
  }
  function qrIcon(col) {
    var f = 'fill="none" stroke="' + col + '" stroke-width="2.6" rx="3.4"';
    return '<rect x="1.3" y="1.3" width="13.4" height="13.4" ' + f + '/><rect x="25.3" y="1.3" width="13.4" height="13.4" ' + f + '/><rect x="1.3" y="25.3" width="13.4" height="13.4" ' + f + '/>' +
      '<rect x="5.6" y="5.6" width="4.8" height="4.8" rx="1" fill="' + col + '"/><rect x="29.6" y="5.6" width="4.8" height="4.8" rx="1" fill="' + col + '"/><rect x="5.6" y="29.6" width="4.8" height="4.8" rx="1" fill="' + col + '"/>' +
      '<rect x="25" y="25" width="5.4" height="5.4" rx="1" fill="' + col + '"/><rect x="33.4" y="25" width="5.4" height="5.4" rx="1" fill="' + col + '"/><rect x="25" y="33.4" width="5.4" height="5.4" rx="1" fill="' + col + '"/><rect x="33.4" y="33.4" width="5.4" height="5.4" rx="1" fill="' + col + '"/>';
  }

  /* ---------- zemin, yüzey, doku ---------- */
  function bgGrad(P, bp) {
    if (bp.mode === 'solid' || bp.colors.length < 2) return '';
    var a = bp.angle * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    var st = bp.colors.map(function (c, i) {
      return '<stop offset="' + (i / (bp.colors.length - 1)) + '" stop-color="' + c + '"/>';
    }).join('');
    return '<linearGradient id="' + P + 'bg" x1="' + (0.5 - dx / 2) + '" y1="' + (0.5 - dy / 2) + '" x2="' + (0.5 + dx / 2) + '" y2="' + (0.5 + dy / 2) + '">' + st + '</linearGradient>';
  }
  function textureDefs(tx, P) {
    if (tx === 'carbon') {
      return '<linearGradient id="' + P + 'cg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a4d55"/><stop offset=".5" stop-color="#1b1c20"/><stop offset="1" stop-color="#08090b"/></linearGradient>' +
        '<linearGradient id="' + P + 'cg2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3c3f46"/><stop offset=".5" stop-color="#141519"/><stop offset="1" stop-color="#050506"/></linearGradient>' +
        '<pattern id="' + P + 'carbon" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#0a0a0c"/>' +
        '<rect x=".4" y=".4" width="4.2" height="4.2" rx=".8" fill="url(#' + P + 'cg1)"/><rect x="5.4" y="5.4" width="4.2" height="4.2" rx=".8" fill="url(#' + P + 'cg1)"/>' +
        '<rect x="5.4" y=".4" width="4.2" height="4.2" rx=".8" fill="url(#' + P + 'cg2)"/><rect x=".4" y="5.4" width="4.2" height="4.2" rx=".8" fill="url(#' + P + 'cg2)"/></pattern>';
    }
    if (tx === 'mesh') {
      return '<pattern id="' + P + 'mesh" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="none"/><path d="M0 0H7" stroke="#fff" stroke-opacity=".5" stroke-width=".7"/></pattern>';
    }
    if (tx === 'brushed') {
      return '<filter id="' + P + 'brush" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".004 .9" numOctaves="2" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .9 .9 .9 0 -.55"/></filter>';
    }
    if (tx === 'grain') {
      return '<filter id="' + P + 'grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="3"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.2 1.2 1.2 0 -.7"/></filter>';
    }
    return '';
  }
  function textureMarkup(bp, P, W, H) {
    var tx = bp.texture, op = bp.textureOpacity == null ? 0.5 : bp.textureOpacity;
    if (!tx || tx === 'none') return '';
    var r = '<rect width="' + W + '" height="' + H + '"';
    if (tx === 'carbon') return '<g pointer-events="none">' + r + ' fill="url(#' + P + 'carbon)" opacity="' + op + '"/></g>';
    if (tx === 'mesh') return '<g pointer-events="none">' + r + ' fill="url(#' + P + 'mesh)" opacity="' + (op * 0.35).toFixed(3) + '"/></g>';
    if (tx === 'brushed') return '<g pointer-events="none">' + r + ' fill="#fff" filter="url(#' + P + 'brush)" opacity="' + (op * 0.6).toFixed(3) + '" data-blend="overlay"/></g>';
    return '<g pointer-events="none">' + r + ' fill="#fff" filter="url(#' + P + 'grain)" opacity="' + (op * 0.5).toFixed(3) + '" data-blend="overlay"/></g>';
  }
  function finishMarkup(f, P, W, H) {
    var r = '<rect width="' + W + '" height="' + H + '"';
    if (f === 'glossy') return r + ' fill="url(#' + P + 'gloss)"/>';
    if (f === 'satin') return r + ' fill="url(#' + P + 'satin)"/>';
    if (f === 'chrome') return r + ' fill="url(#' + P + 'chrome)"/>';
    if (f === 'foil') return r + ' fill="url(#' + P + 'foil)" data-blend="soft-light"/>';
    if (f === 'holo') return r + ' fill="url(#' + P + 'holo)" opacity="0.5" data-blend="overlay"/>';
    return '';
  }

  /* ---------- dekoratif katman ---------- */
  function buildFilter(p, id, W, H) {
    var sh = p.shadow || 0, gl = p.glow || 0, emb = (p.effects || []).indexOf('emboss') >= 0;
    if (!sh && !gl && !emb) return null;
    var f = '', mg = [];
    if (sh) { f += '<feGaussianBlur in="SourceAlpha" stdDeviation="' + (sh / 2).toFixed(1) + '" result="shb"/><feOffset in="shb" dx="0" dy="' + (sh * 0.6).toFixed(1) + '" result="sho"/><feFlood flood-color="#000" flood-opacity=".55"/><feComposite in2="sho" operator="in" result="sh"/>'; mg.push('sh'); }
    if (emb) {
      f += '<feGaussianBlur in="SourceAlpha" stdDeviation="2" result="eb"/><feOffset in="eb" dx="2.5" dy="3.5" result="eo"/><feFlood flood-color="#000" flood-opacity=".55"/><feComposite in2="eo" operator="in" result="ed"/>' +
        '<feOffset in="eb" dx="-1.5" dy="-1.5" result="eo2"/><feFlood flood-color="#fff" flood-opacity=".55"/><feComposite in2="eo2" operator="in" result="eh"/>';
      mg.push('ed', 'eh');
    }
    if (gl) {
      var gc = p.glowColor && p.glowColor !== 'auto' ? p.glowColor : (p.fill && p.fill !== 'none' ? p.fill : (p.stroke && p.stroke !== 'none' ? p.stroke : '#FFFFFF'));
      f += '<feGaussianBlur in="SourceAlpha" stdDeviation="' + (gl / 2).toFixed(1) + '" result="glb"/><feFlood flood-color="' + gc + '" flood-opacity=".95"/><feComposite in2="glb" operator="in" result="gl"/>';
      mg.push('gl', 'gl');
    }
    mg.push('SourceGraphic');
    return '<filter id="' + id + '" filterUnits="userSpaceOnUse" x="-300" y="-300" width="' + (W + 600) + '" height="' + (H + 600) + '">' + f +
      '<feMerge>' + mg.map(function (n) { return '<feMergeNode in="' + n + '"/>'; }).join('') + '</feMerge></filter>';
  }
  function layerParts(l, P, idx, o, W, H) {
    var p = l.properties, cx = p.width / 2, cy = p.height / 2;
    var tr = 'translate(' + p.x + ' ' + p.y + ') rotate(' + p.rotation + ' ' + cx + ' ' + cy + ') ' +
      'translate(' + cx + ' ' + cy + ') scale(' + (p.flipX ? -1 : 1) + ' ' + (p.flipY ? -1 : 1) + ') translate(' + (-cx) + ' ' + (-cy) + ') ' +
      'scale(' + (p.width / 100) + ' ' + (p.height / 100) + ')';
    var fid = P + 'f' + idx, ft = buildFilter(p, fid, W, H);
    var filter = ft ? ' filter="url(#' + fid + ')"' : '';
    var hit = o.interactive && (R.STROKE_ONLY.has(p.kind) || R.TEXTURE_KINDS.indexOf(p.kind) >= 0) ? '<rect width="100" height="100" fill="transparent"/>' : '';
    var inner = shapeInner(p.kind, p.kind === 'nexus' && p.fill === 'none' ? Object.assign({}, p, { fill: '#ffffff' }) : p);
    return { defs: ft || '', body: '<g class="dl" data-id="' + esc(l.id) + '" opacity="' + p.opacity + '"' + filter + '><g transform="' + tr + '">' + hit + inner + '</g></g>' };
  }

  /* ---------- sistem öğeleri (yerel kutular, ölçekle yerleştirilir) ---------- */
  function sysG(key, e, inner, extra) {
    return '<g data-sys="' + (key === 'qr' ? 'card-qr' : key) + '" data-sk="' + key + '" transform="translate(' + e.x + ' ' + e.y + ') scale(' + e.scale + ')"' + (extra || '') + '>' + inner + '</g>';
  }

  function renderCard(d, sys, o) {
    o = o || {};
    var P = o.prefix || 'c', t = tone(d), bg = bgLayer(d), bp = bg.properties;
    var orient = d.orientation === 'portrait' ? 'portrait' : 'landscape', cv = R.canvasOf(orient), W = cv.width, H = cv.height;
    var layout = {}, defs0 = R.sysDefaults(orient);
    R.SYS_KEYS.forEach(function (k) { layout[k] = R.sysFix(k, (d.sys || {})[k] || defs0[k], orient, d.qrStyle); });
    var qrStyle = d.qrStyle === 'icon' ? 'icon' : 'tint';

    var layerDefs = '', deco = '', ghost = '';
    d.layers.forEach(function (l, i) {
      if (l.type === 'background' || !l.visible) return;
      var parts = layerParts(l, P, i, o, W, H);
      layerDefs += parts.defs; deco += parts.body;
      if (o.ghost) ghost += parts.body;
    });

    var defs = '<defs>' +
      '<clipPath id="' + P + 'cc"><rect width="' + W + '" height="' + H + '" rx="' + R.CORNER + '"/></clipPath>' +
      bgGrad(P, bp) + textureDefs(bp.texture, P) + chipDefs(d.chipStyle || 'gold', P) + layerDefs +
      '<linearGradient id="' + P + 'gloss" x1="0" y1="0" x2="1" y2="1"><stop offset=".22" stop-color="#fff" stop-opacity="0"/><stop offset=".4" stop-color="#fff" stop-opacity=".26"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="' + P + 'satin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".6" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".1"/></linearGradient>' +
      '<linearGradient id="' + P + 'chrome" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".18" stop-color="#fff" stop-opacity=".04"/><stop offset=".3" stop-color="#000" stop-opacity=".22"/><stop offset=".48" stop-color="#fff" stop-opacity=".42"/><stop offset=".62" stop-color="#000" stop-opacity=".16"/><stop offset=".8" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>' +
      '<linearGradient id="' + P + 'foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".25" stop-color="#8a8f9e" stop-opacity=".3"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset=".75" stop-color="#8a8f9e" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity=".5"/></linearGradient>' +
      '<linearGradient id="' + P + 'holo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6ec7"/><stop offset=".2" stop-color="#ffd86e"/><stop offset=".4" stop-color="#6effb5"/><stop offset=".6" stop-color="#6ec8ff"/><stop offset=".8" stop-color="#b06eff"/><stop offset="1" stop-color="#ff6ec7"/></linearGradient>' +
      '<linearGradient id="' + P + 'rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".45" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity=".22"/></linearGradient>' +
      '</defs>';

    // A) arka plan + doku
    var bgFill = bp.mode === 'solid' || bp.colors.length < 2 ? bp.colors[0] : 'url(#' + P + 'bg)';
    var body = '<rect data-id="bg" width="' + W + '" height="' + H + '" fill="' + bgFill + '"/>' + textureMarkup(bp, P, W, H);
    // B) dekoratif katmanlar (serbest; sırayla) + yüzey cilası
    body += deco;
    var fin = finishMarkup(bp.finish, P, W, H);
    if (fin) body += '<g pointer-events="none">' + fin + '</g>';

    // C) sistem öğeleri: daima en üstte.
    var token = sys && sys.cardToken ? String(sys.cardToken) : '';
    var ph = !token && o.placeholder;
    var shownToken = token || (ph ? 'NXC-••••-••••' : '');
    var last4 = sys && sys.last4 ? String(sys.last4).replace(/[^A-Za-z0-9•]/g, '').slice(-4) : String((sys && sys.cardNumber) || '0000').replace(/\D/g, '').slice(-4);
    var halo = 'stroke="' + t.halo + '" stroke-opacity=".28" stroke-width="2.6" stroke-linejoin="round" paint-order="stroke"';
    var plate = function (w, h) { return t.plate ? '<rect x="-8" y="-6" width="' + (w + 16) + '" height="' + (h + 12) + '" rx="14" fill="' + (t.dark ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.6)') + '"/>' : ''; };

    var ih = 54, iw = ih * ICON_VB[2] / ICON_VB[3], wh = 44, ww = wh * WORDMARK.ratio, wx = iw + 16, wy = (ih - wh) / 2;
    var brand = plate(300, 54) +
      '<svg x="0" y="0" width="' + iw.toFixed(2) + '" height="' + ih + '" viewBox="' + ICON_VB.join(' ') + '" fill="' + t.brand + '">' + ICON.map(function (dd) { return '<path d="' + dd + '"/>'; }).join('') + '</svg>' +
      '<mask id="' + P + 'wm" maskUnits="userSpaceOnUse" x="' + wx.toFixed(2) + '" y="' + wy + '" width="' + ww.toFixed(2) + '" height="' + wh + '"><image href="' + WORDMARK.src + '" x="' + wx.toFixed(2) + '" y="' + wy + '" width="' + ww.toFixed(2) + '" height="' + wh + '"/></mask>' +
      '<rect x="' + wx.toFixed(2) + '" y="' + wy + '" width="' + ww.toFixed(2) + '" height="' + wh + '" fill="' + t.brand + '" mask="url(#' + P + 'wm)"/>';

    var code = shownToken
      ? plate(250, 48) + '<text x="0" y="11" font-family="' + FONT + '" font-size="10.5" letter-spacing="2.4" fill="' + t.brand + '" opacity=".68" ' + halo + '>NEXUS KART KODU</text>' +
        '<text x="0" y="39" font-family="' + FONT + '" font-size="22" letter-spacing="1.8" font-weight="500" fill="' + t.brand + '" ' + halo + '>' + esc(shownToken) + '</text>'
      : '';

    var endAlign = orient === 'landscape';
    var number = plate(200, 26) + '<text x="' + (endAlign ? 200 : 0) + '" y="21" text-anchor="' + (endAlign ? 'end' : 'start') + '" font-family="' + FONT + '" font-size="20" letter-spacing="3" fill="' + t.brand + '" opacity=".88" ' + halo + '>•••• ' + esc(last4) + '</text>';

    var nm = String(d.userDisplayName || '').toLocaleUpperCase('tr-TR');
    var len = Math.max(1, Array.from(nm).length);
    var nsize = Math.min(28, 400 / (0.95 * len));
    var name = '<text x="0" y="27" font-family="' + FONT + '" font-weight="500" font-size="' + nsize.toFixed(1) + '" letter-spacing="' + (nsize * 0.16).toFixed(1) + '" fill="' + t.name + '" ' + halo + '>' + esc(nm) + '</text>';

    var qr = '';
    if (shownToken) {
      var qopen = o.qrOpen && token ? ' role="button" tabindex="0" cursor="pointer" data-qr-open="' + esc(token) + '" aria-label="Kart QR kodunu büyüt"' : '';
      if (qrStyle === 'icon') {
        qr = sysG('qr', layout.qr, '<rect width="40" height="40" fill="transparent"/><g opacity=".9">' + qrIcon(t.brand) + '</g>', qopen);
      } else {
        var m = qrModules(token || 'NXC-PREVIEW1'), qc = qrColors(t);
        if (m) {
          qr = sysG('qr', layout.qr, '<rect width="84" height="84" rx="10" fill="' + qc.plate + '" stroke="rgba(0,0,0,.18)" stroke-width="1"/>' + qrRects(m, 0, 0, 84, 2.2, qc.ink), qopen);
        }
      }
    }

    body += sysG('brand', layout.brand, brand) + sysG('chip', layout.chip, chipMarkup(d.chipStyle || 'gold', P)) +
      (code ? sysG('code', layout.code, code) : '') + sysG('number', layout.number, number) + sysG('name', layout.name, name) + qr;

    var edge = '<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" rx="' + (R.CORNER - 1) + '" fill="none" stroke="url(#' + P + 'rim)" stroke-width="2" pointer-events="none"/>';
    var ghostG = o.ghost && ghost ? '<g class="gh" opacity=".32">' + ghost + '</g>' : '';
    return defs + ghostG + '<g clip-path="url(#' + P + 'cc)">' + body + '</g>' + edge;
  }

  function cardSvg(d, sys, o) {
    var cv = R.canvasOf(d.orientation);
    return '<svg class="card-svg" viewBox="0 0 ' + cv.width + ' ' + cv.height + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Forevye Nexus sanal kartı">' +
      renderCard(d, sys, o) + '</svg>';
  }
  function iconSvg(cls) {
    return '<svg class="' + (cls || '') + '" viewBox="' + ICON_VB.join(' ') + '" fill="currentColor" aria-hidden="true">' +
      ICON.map(function (dd) { return '<path d="' + dd + '"/>'; }).join('') + '</svg>';
  }
  // Karışım kipi CSP altında satır içi style ile verilemez; çizimden sonra DOM üzerinden uygulanır.
  function applyBlend(svg) {
    if (!svg || !svg.querySelectorAll) return;
    svg.querySelectorAll('[data-blend]').forEach(function (el) { el.style.mixBlendMode = el.getAttribute('data-blend'); });
  }

  root.FNXRender = { renderCard: renderCard, cardSvg: cardSvg, iconSvg: iconSvg, shapeInner: shapeInner, tone: tone,
    contrast: contrast, minContrast: minContrast, relLum: relLum, esc: esc, bgLayer: bgLayer, chipMarkup: chipMarkup,
    chipSvg: chipSvg, qrSvg: qrSvg, applyBlend: applyBlend, mix: mix, WORDMARK: WORDMARK };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FNXRender;
})(typeof window !== 'undefined' ? window : globalThis);
