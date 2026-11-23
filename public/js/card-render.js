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
    },
    rect: function (a) { return '<rect x="1" y="1" width="98" height="98" ' + a + '/>'; },
    diamond: function (a) { return '<path d="M50 2L98 50L50 98L2 50Z" ' + a + '/>'; },
    dots: function (a) { var o=''; for(var y=12;y<=88;y+=25) for(var x=12;x<=88;x+=25) o+='<circle cx="'+x+'" cy="'+y+'" r="3" '+a+'/>'; return o; },
    rings: function (a) { var o=''; for(var y=18;y<=82;y+=32) for(var x=18;x<=82;x+=32) o+='<circle cx="'+x+'" cy="'+y+'" r="10" '+a+'/>'; return o; },
    rays: function (a) { var o=''; for(var i=0;i<12;i++){var q=i*Math.PI/6,x1=50+18*Math.cos(q),y1=50+18*Math.sin(q),x2=50+47*Math.cos(q),y2=50+47*Math.sin(q);o+='<path d="M'+x1.toFixed(1)+' '+y1.toFixed(1)+'L'+x2.toFixed(1)+' '+y2.toFixed(1)+'" '+a+'/>'; } return o; },
    hexgrid: function (a) { var o=''; for(var y=8;y<100;y+=28) for(var x=8+(Math.round(y/28)%2)*16;x<100;x+=32) o+='<path d="M'+(x-8)+' '+y+'l8 -5l8 5v10l-8 5l-8 -5Z" '+a+'/>'; return o; },
    glow: function (a) { return '<ellipse cx="50" cy="50" rx="48" ry="34" '+a+'/>'; },
    beam: function (a) { return '<path d="M0 20L100 0L100 80L0 100Z" '+a+'/>'; }
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
    var draw = SHAPES[kind];
    if (typeof draw !== 'function') return '<g opacity="0" aria-label="Desteklenmeyen şekil"></g>';
    return draw(a);
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


  function qrMarkup(cardToken, P, x, y, size) {
    if (!cardToken || !root.FNXQRCode) return '';
    try {
      var qr = new root.FNXQRCode(0, (root.FNXQRErrorCorrectLevel || {}).M || 0);
      qr.addData('FNX1|' + String(cardToken)); qr.make();
      var n = qr.getModuleCount(), quiet = 3, unit = size / (n + quiet * 2);
      var out = '<g data-sys="card-qr" aria-label="Kart QR kodu"><rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" rx="5" fill="#fff"/>';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c))
        out += '<rect x="' + (x + (c + quiet) * unit).toFixed(2) + '" y="' + (y + (r + quiet) * unit).toFixed(2) + '" width="' + (unit + 0.08).toFixed(2) + '" height="' + (unit + 0.08).toFixed(2) + '" fill="#101116"/>';
      return out + '</g>';
    } catch (_) { return ''; }
  }

  function renderCard(d, sys, o) {
    o = o || {};
    var cv = R.canvasOf(d && d.orientation); W = cv.width; H = cv.height;
    sys = sys || {}; var se = sys.layout || d.sys || R.sysDefaults(d.orientation);
    function pos(k) { var v = se[k] || R.sysDefaults(d.orientation)[k], m = R.SYS[k]; return { x:v.x, y:v.y, s:v.scale || 1, w:m.w*(v.scale||1), h:m.h*(v.scale||1) }; }
    var P = o.prefix || 'c', t = tone(d), bg = bgLayer(d), bp = bg.properties;
    // Market kart yüzeyi (skin): takılıysa kullanıcının katmanları/yüzeyi yerine skin çizilir; yazı rengi skin'e kilitlenir.
    var sk = sys && sys.skin && root.FNXSkins ? root.FNXSkins.get(sys.skin) : null;
    var sp = sk ? sk.build(P, { animate: o.animate !== false, serial: sys.skinSerial ? String(sys.skinSerial).replace(/[^0-9\/]/g, '') : '' }) : null;
    if (sp) { t.brand = sk.brand; t.name = sk.brand; t.plate = false; t.nameFallback = false; }
    var zonePath = 'M0 0H' + W + 'V' + H + 'H0Z';
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
      (sp ? sp.defs : '') + '</defs>';

    var bgFill = bp.mode === 'solid' || bp.colors.length < 2 ? bp.colors[0] : 'url(#' + P + 'bg)';
    var body = sp ? '<g data-id="bg" data-skin="' + esc(sk.id) + '">' + sp.under + '</g>' : '<rect data-id="bg" width="' + W + '" height="' + H + '" fill="' + bgFill + '"/>';
    if (!sp) d.layers.forEach(function (l) {
      if (l.type !== 'background' && l.visible) body += layerMarkup(l, P, o.interactive);
    });
    var fin = sp ? sp.over : finishMarkup(bp.finish, P);
    if (fin) body += '<g pointer-events="none">' + fin + '</g>';

    // Sistem katmanları (Grup D): banka adı/logosu, çip, sistem bilgileri.
    var bp0 = pos('brand'), cp0 = pos('chip'), code0 = pos('code'), num0 = pos('number'), name0 = pos('name'), qr0 = pos('qr');
    var ix = bp0.x, iy = bp0.y, brandH = 54 * bp0.s, brandW = 300 * bp0.s, iw = brandH * ICON_VB[2] / ICON_VB[3], ih = brandH;
    var wh = 42 * bp0.s, ww = wh * WORDMARK.ratio, wx = ix + iw + 14 * bp0.s, wy = iy + (ih - wh) / 2;
    var brand = '<g data-sys="brand">' +
      '<svg x="' + ix + '" y="' + iy + '" width="' + iw + '" height="' + ih + '" viewBox="' + ICON_VB.join(' ') + '" fill="' + t.brand + '">' +
      ICON.map(function (dd) { return '<path d="' + dd + '"/>'; }).join('') + '</svg>' +
      '<mask id="' + P + 'wm" maskUnits="userSpaceOnUse" x="' + wx + '" y="' + wy + '" width="' + ww + '" height="' + wh + '"><image href="' + WORDMARK.src + '" x="' + wx + '" y="' + wy + '" width="' + ww + '" height="' + wh + '"/></mask>' +
      '<rect x="' + wx + '" y="' + wy + '" width="' + ww + '" height="' + wh + '" fill="' + t.brand + '" mask="url(#' + P + 'wm)"/></g>';
    var cardToken = sys && sys.cardToken ? String(sys.cardToken) : '';
    var last4 = sys && sys.last4 ? String(sys.last4).replace(/[^A-Za-z0-9•]/g, '').slice(-4) : String((sys && sys.cardNumber) || '0000').replace(/\D/g, '').slice(-4);
    var codeText = cardToken || (sys && sys.cardCode) || '';
    var maskedNumber = sys && sys.cardNumber ? String(sys.cardNumber).replace(/\s/g,'').replace(/(\d{4})(?=\d)/g,'$1 ').trim() : '•••• •••• •••• ' + last4;
    var fontBase = Math.max(13, Math.min(22 * num0.s, num0.w / (0.62 * Math.max(1, Array.from(maskedNumber).length)))), codeFont = Math.max(12, 19 * code0.s);
    var info = '<g data-sys="info">' +
      (codeText ? '<text x="' + code0.x + '" y="' + (code0.y + 16 * code0.s) + '" font-family="' + FONT + '" font-size="' + (12*code0.s) + '" letter-spacing="1.8" fill="' + t.brand + '" opacity=".78">NEXUS KART KODU</text><text x="' + code0.x + '" y="' + (code0.y + 40 * code0.s) + '" font-family="' + FONT + '" font-size="' + codeFont + '" letter-spacing="1.2" font-weight="600" fill="' + t.brand + '">' + esc(codeText) + '</text>' : '') +
      '<text x="' + num0.x + '" y="' + (num0.y + 25 * num0.s) + '" font-family="' + FONT + '" font-size="' + fontBase + '" letter-spacing="1.5" font-weight="600" fill="' + t.brand + '">' + esc(maskedNumber) + '</text>' +
      '<text x="' + (W - 28) + '" y="' + (H - 24) + '" text-anchor="end" font-family="' + FONT + '" font-size="16" letter-spacing="2" fill="' + t.brand + '" opacity=".75">•••• ' + esc(last4) + '</text></g>';

    // Hiçbir renk logoya yeterli kontrast veremiyorsa (ör. çok renkli/orta tonlu zemin) sistem, markanın arkasına kendi yarı saydam zeminini koyar.
    if (t.plate) {
      body += '<rect data-sys="brand-plate" x="' + bp0.x + '" y="' + (bp0.y - 4) + '" width="' + (brandW + 8) + '" height="' + (brandH + 8) + '" rx="18" fill="' + (t.dark ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.6)') + '"/>';
    }
    body += brand + chipMarkup((sp && sk.chip) || d.chipStyle || 'gold', cp0.x, cp0.y, 100 * cp0.s, 78 * cp0.s, P) + info + qrMarkup(cardToken, P, qr0.x, qr0.y, R.sysDims('qr', d.qrStyle).w * qr0.s);

    // Kart sahibi adı: editördeki sistem kutusu koordinatlarını kullanır.
    var nm = String(d.userDisplayName || '').toLocaleUpperCase('tr-TR');
    var len = Math.max(1, Array.from(nm).length);
    var nameSize = Math.min(28 * name0.s, name0.w / (0.95 * len));
    body += '<text data-id="name" x="' + name0.x + '" y="' + (name0.y + 27 * name0.s) + '" font-family="' + FONT + '" font-weight="600" font-size="' + nameSize.toFixed(1) +
      '" letter-spacing="' + (nameSize * 0.12).toFixed(1) + '" fill="' + t.name + '">' + esc(nm) + '</text>';

    var edge = '<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" rx="35" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="2" pointer-events="none"/>';
    return defs + '<g clip-path="url(#' + P + 'cc)">' + body + '</g>' + (sp ? sp.edge : edge);
  }

  function cardSvg(d, sys, o) {
    var cv = R.canvasOf(d && d.orientation); W = cv.width; H = cv.height;
    return '<svg class="card-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Forevye Nexus sanal kartı">' + renderCard(d, sys, o) + '</svg>';
  }
  function iconSvg(cls) {
    return '<svg class="' + (cls || '') + '" viewBox="' + ICON_VB.join(' ') + '" fill="currentColor" aria-hidden="true">' +
      ICON.map(function (dd) { return '<path d="' + dd + '"/>'; }).join('') + '</svg>';
  }

  root.FNXRender = { renderCard: renderCard, cardSvg: cardSvg, iconSvg: iconSvg, shapeInner: shapeInner, tone: tone,
    contrast: contrast, minContrast: minContrast, relLum: relLum, esc: esc, bgLayer: bgLayer, chipMarkup: chipMarkup, WORDMARK: WORDMARK };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FNXRender;
})(typeof window !== 'undefined' ? window : globalThis);
