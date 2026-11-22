/* Forevye Nexus — Market kart yüzeyleri (skin). Kart editöründe BULUNMAYAN premium tasarımlar.
 * DOM'a bağımlı değildir: hem tarayıcıda (çizim) hem Worker'da (geçerli skin kimlikleri) kullanılır.
 * Bir skin takılı kartta kullanıcının kendi katmanları/yüzeyi çizilmez (kayıtlı tasarım silinmez; skin çıkarılınca geri gelir);
 * kart adı, çip, QR ve kart kimliği sistemden çizilmeye devam eder. Yazı renkleri her skin'in zeminine göre kontrast için sabitlenmiştir. */
(function (root) {
  'use strict';
  var W = 856, H = 540;
  var ICON = ['M35 72 L105 28 L228 100 L228 148 L105 76 L68 98 L68 205 L35 205Z', 'M292 178 L222 222 L99 150 L99 102 L222 174 L259 152 L259 45 L292 45Z'];

  function lg(id, c, stops, x1, y1, x2, y2) {
    return '<linearGradient id="' + id + '" x1="' + (x1 || 0) + '" y1="' + (y1 || 0) + '" x2="' + (x2 === undefined ? 1 : x2) + '" y2="' + (y2 === undefined ? 1 : y2) + '">' +
      stops.map(function (s, i) { return '<stop offset="' + (s[0]) + '" stop-color="' + s[1] + '"' + (s[2] !== undefined ? ' stop-opacity="' + s[2] + '"' : '') + '/>'; }).join('') + '</linearGradient>';
  }
  function full(fill, extra) { return '<rect width="' + W + '" height="' + H + '" fill="' + fill + '"' + (extra || '') + '/>'; }
  function edge(P, a, b) {
    return '<defs>' + lg(P + 'sk_e', 0, [[0, a], [1, b]]) + '</defs><rect x="1.5" y="1.5" width="' + (W - 3) + '" height="' + (H - 3) + '" rx="34.5" fill="none" stroke="url(#' + P + 'sk_e)" stroke-width="3" pointer-events="none"/>';
  }
  // Sabit tohumlu sözde-rastgele (her çizimde aynı yıldız/parça deseni).
  function rng(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  // Sağ üstte skin adı ve (sınırlı üretimse) seri numarası; sistem bilgisi bölgesinin altında, QR/çip/ad alanlarıyla çakışmaz.
  function tag(label, serial, color) {
    var out = '<g data-sys="skin-tag" font-family="Jost, \'Segoe UI\', Arial, sans-serif" text-anchor="end" fill="' + color + '">' +
      '<text x="830" y="112" font-size="15" letter-spacing="3.5" opacity=".85">' + label + '</text>';
    if (serial) out += '<text x="830" y="136" font-size="14" letter-spacing="2" opacity=".7">No. ' + serial + '</text>';
    return out + '</g>';
  }
  function sweep(P, anim, color, op, dur) {
    var g = '<defs>' + lg(P + 'sk_sw', 0, [[0, color, 0], [0.5, color, op], [1, color, 0]], 0, 0, 1, 0) + '</defs>' +
      '<g data-sys="skin-sweep" pointer-events="none" data-blend="overlay" style="mix-blend-mode:overlay"><rect x="-300" y="-60" width="260" height="660" fill="url(#' + P + 'sk_sw)" transform="skewX(-22)">';
    if (anim) g += '<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0; 1500 0; 1500 0" keyTimes="0;.55;1" dur="' + dur + 's" repeatCount="indefinite"/>';
    return g + '</rect></g>';
  }

  var SKINS = {};
  function def(id, o) { o.id = id; SKINS[id] = o; }

  def('onyx', {
    name: 'Oniks Mat', label: 'ONİKS', brand: '#EBDDB4', chip: 'gold', bg: ['#0E0F12', '#1B1D23'],
    build: function (P, o) {
      return {
        defs: lg(P + 'sk_a', 0, [[0, '#0C0D10'], [1, '#1D2027']]) + '<pattern id="' + P + 'sk_p" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V9" stroke="#fff" stroke-width=".8" opacity=".045"/></pattern>' +
          '<radialGradient id="' + P + 'sk_r" cx=".2" cy=".1" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>',
        under: full('url(#' + P + 'sk_a)') + full('url(#' + P + 'sk_p)') + full('url(#' + P + 'sk_r)'),
        over: '<rect x="16" y="16" width="' + (W - 32) + '" height="' + (H - 32) + '" rx="24" fill="none" stroke="#C9A24B" stroke-opacity=".55" stroke-width="1.5"/>' + tag('ONİKS', o.serial, '#EBDDB4'),
        edge: edge(P, '#E9D18F', '#8C6B23')
      };
    }
  });

  def('carbon', {
    name: 'Karbon Fiber', label: 'KARBON', brand: '#F2F4F8', chip: 'silver', bg: ['#232427', '#0D0D0E'],
    build: function (P, o) {
      return {
        defs: '<pattern id="' + P + 'sk_w" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#0D0D0F"/><rect width="5" height="5" fill="#26272B"/><rect x="5" y="5" width="5" height="5" fill="#26272B"/><path d="M0 0L5 5M5 5L10 10" stroke="#fff" stroke-opacity=".05"/></pattern>' +
          lg(P + 'sk_s', 0, [[0, '#fff', 0], [0.45, '#fff', 0.14], [0.6, '#fff', 0], [1, '#fff', 0]]),
        under: full('url(#' + P + 'sk_w)') + full('url(#' + P + 'sk_s)') + '<path d="M470 540L856 150" stroke="#E4002B" stroke-width="7" opacity=".95"/><path d="M500 540L856 180" stroke="#E4002B" stroke-width="2" opacity=".7"/>',
        over: tag('KARBON', o.serial, '#F2F4F8'),
        edge: edge(P, '#8D9099', '#3A3C42')
      };
    }
  });

  def('aurora', {
    name: 'Aurora', label: 'AURORA', brand: '#F6FAFF', chip: 'silver', bg: ['#0B1F2C', '#150E2A'],
    build: function (P, o) {
      return {
        defs: '<filter id="' + P + 'sk_b" filterUnits="userSpaceOnUse" x="-300" y="-300" width="1500" height="1200"><feGaussianBlur stdDeviation="70"/></filter>',
        under: full('#070B1A') + '<g filter="url(#' + P + 'sk_b)">' +
          '<ellipse cx="170" cy="120" rx="260" ry="150" fill="#00E5B0" opacity=".42"/><ellipse cx="620" cy="60" rx="260" ry="130" fill="#4F7BFF" opacity=".5"/>' +
          '<ellipse cx="760" cy="420" rx="240" ry="170" fill="#B04BFF" opacity=".45"/><ellipse cx="260" cy="470" rx="230" ry="110" fill="#FF4FA3" opacity=".3"/></g>' +
          '<g opacity=".55" fill="none" stroke="#fff" stroke-width="1.2"><path d="M0 330C200 250 360 420 560 330S780 260 856 300" opacity=".5"/><path d="M0 360C200 280 360 450 560 360S780 290 856 330" opacity=".3"/></g>',
        over: tag('AURORA', o.serial, '#F6FAFF'),
        edge: edge(P, '#7FFFE0', '#C07BFF')
      };
    }
  });

  def('nebula', {
    name: 'Nebula', label: 'NEBULA', brand: '#FFFFFF', chip: 'silver', bg: ['#1A0B2E', '#0A0620'],
    build: function (P, o) {
      var r = rng(7), stars = '';
      for (var i = 0; i < 70; i++) {
        var x = (r() * W).toFixed(0), y = (r() * H).toFixed(0), s = (0.5 + r() * 1.5).toFixed(1);
        stars += '<circle cx="' + x + '" cy="' + y + '" r="' + s + '" fill="#fff" opacity="' + (0.25 + r() * 0.65).toFixed(2) + '"/>';
      }
      return {
        defs: '<filter id="' + P + 'sk_n1" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".006 .009" numOctaves="4" seed="11"/><feColorMatrix values="0 0 0 0 .55  0 0 0 0 .18  0 0 0 0 .95  0 0 0 1.9 -.78"/></filter>' +
          '<filter id="' + P + 'sk_n2" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".008 .006" numOctaves="3" seed="29"/><feColorMatrix values="0 0 0 0 .95  0 0 0 0 .25  0 0 0 0 .55  0 0 0 1.7 -.8"/></filter>',
        under: full('#07051A') + '<rect width="' + W + '" height="' + H + '" filter="url(#' + P + 'sk_n1)" opacity=".85"/><rect width="' + W + '" height="' + H + '" filter="url(#' + P + 'sk_n2)" opacity=".7"/>' + stars,
        over: tag('NEBULA', o.serial, '#FFFFFF'),
        edge: edge(P, '#B58CFF', '#FF7AB8')
      };
    }
  });

  def('prism', {
    name: 'Prizma Cam', label: 'PRİZMA', brand: '#FFFFFF', chip: 'silver', bg: ['#10131C', '#273049'],
    build: function (P, o) {
      var facets = [['0,0 380,0 210,300', '#6EC8FF', .16], ['380,0 856,0 640,230', '#B06EFF', .18], ['0,540 260,260 520,540', '#FF6EC7', .14], ['856,540 856,200 560,540', '#6EFFB5', .14], ['210,300 640,230 520,540', '#FFD86E', .1], ['0,0 210,300 0,420', '#fff', .08]]
        .map(function (f) { return '<polygon points="' + f[0] + '" fill="' + f[1] + '" opacity="' + f[2] + '" data-blend="screen" style="mix-blend-mode:screen"/>'; }).join('');
      return {
        defs: lg(P + 'sk_a', 0, [[0, '#0E111A'], [1, '#2A3350']]),
        under: full('url(#' + P + 'sk_a)') + facets + '<g fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="1"><path d="M0 0L210 300L640 230L856 0M210 300L520 540M640 230L856 200M0 420L210 300"/></g>',
        over: sweep(P, o.animate, '#ffffff', 0.55, 7) + tag('PRİZMA', o.serial, '#FFFFFF'),
        edge: edge(P, '#E2F3FF', '#8FA6FF')
      };
    }
  });

  def('guilloche', {
    name: 'Altın Gilyoş', label: 'ALTIN GİLYOŞ', brand: '#F6E4AE', chip: 'gold', bg: ['#0B0B0D', '#3A2D12'],
    build: function (P, o) {
      var rose = '';
      for (var i = 0; i < 40; i++) rose += '<ellipse cx="640" cy="300" rx="250" ry="70" transform="rotate(' + (i * 4.5) + ' 640 300)"/>';
      var rose2 = '';
      for (var j = 0; j < 36; j++) rose2 += '<ellipse cx="640" cy="300" rx="96" ry="26" transform="rotate(' + (j * 5) + ' 640 300)"/>';
      return {
        defs: lg(P + 'sk_g', 0, [[0, '#F9E7A8'], [0.5, '#C9993F'], [1, '#F2D27E']]) + lg(P + 'sk_f', 0, [[0, '#fff', .55], [0.4, '#fff', 0], [1, '#fff', .35]]) +
          '<radialGradient id="' + P + 'sk_r" cx=".75" cy=".55" r=".7"><stop offset="0" stop-color="#6B4E16" stop-opacity=".9"/><stop offset="1" stop-color="#0B0B0D" stop-opacity="0"/></radialGradient>',
        under: full('#0B0B0D') + full('url(#' + P + 'sk_r)') + '<g fill="none" stroke="url(#' + P + 'sk_g)" stroke-width=".9" opacity=".6">' + rose + '</g><g fill="none" stroke="url(#' + P + 'sk_g)" stroke-width=".8" opacity=".35">' + rose2 + '</g>',
        over: '<rect width="' + W + '" height="' + H + '" fill="url(#' + P + 'sk_f)" opacity=".5" data-blend="overlay" style="mix-blend-mode:overlay" pointer-events="none"/>' + sweep(P, o.animate, '#FFE9A8', 0.6, 8) + tag('ALTIN GİLYOŞ', o.serial, '#F6E4AE'),
        edge: edge(P, '#F9E7A8', '#9C7424')
      };
    }
  });

  def('titan', {
    name: 'Titanyum', label: 'TİTANYUM', brand: '#14161B', chip: 'silver', bg: ['#8B909C', '#C8CCD5'],
    build: function (P, o) {
      return {
        defs: lg(P + 'sk_a', 0, [[0, '#8E93A0'], [0.5, '#C9CDD6'], [1, '#8A8F9B']]) +
          '<filter id="' + P + 'sk_br" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0018 .95" numOctaves="2" seed="5"/><feColorMatrix type="saturate" values="0"/></filter>',
        under: full('url(#' + P + 'sk_a)') + '<rect width="' + W + '" height="' + H + '" filter="url(#' + P + 'sk_br)" opacity=".38" data-blend="overlay" style="mix-blend-mode:overlay"/>',
        over: sweep(P, o.animate, '#ffffff', 0.5, 9) + '<rect x="16" y="16" width="' + (W - 32) + '" height="' + (H - 32) + '" rx="24" fill="none" stroke="#14161B" stroke-opacity=".25" stroke-width="1.5"/>' + tag('TİTANYUM', o.serial, '#14161B'),
        edge: edge(P, '#FFFFFF', '#6C717D')
      };
    }
  });

  def('platinum', {
    name: 'Platin', label: 'PLATİN', brand: '#14161B', chip: 'silver', bg: ['#F3F5FA', '#CDD3E0'],
    build: function (P, o) {
      var rings = '';
      for (var i = 1; i <= 26; i++) rings += '<circle cx="700" cy="120" r="' + (i * 22) + '"/>';
      return {
        defs: lg(P + 'sk_a', 0, [[0, '#F6F8FC'], [1, '#CBD1DF']]),
        under: full('url(#' + P + 'sk_a)') + '<g fill="none" stroke="#8E98AE" stroke-width=".8" opacity=".55">' + rings + '</g>' + '<path d="M0 470C220 420 420 520 856 440V540H0Z" fill="#fff" opacity=".35"/>',
        over: '<rect x="16" y="16" width="' + (W - 32) + '" height="' + (H - 32) + '" rx="24" fill="none" stroke="#14161B" stroke-opacity=".22" stroke-width="1.5"/>' + tag('PLATİN', o.serial, '#14161B'),
        edge: edge(P, '#FFFFFF', '#9AA3B6')
      };
    }
  });

  def('royal', {
    name: 'Nexus Black', label: 'NEXUS BLACK', brand: '#F6E4AE', chip: 'gold', bg: ['#050506', '#2C2210'],
    build: function (P, o) {
      var mark = ICON.map(function (d) { return '<path d="' + d + '"/>'; }).join('');
      return {
        defs: lg(P + 'sk_g', 0, [[0, '#FBEBB4'], [0.45, '#C9993F'], [1, '#F2D27E']]) + lg(P + 'sk_a', 0, [[0, '#040405'], [1, '#17130A']]),
        under: full('url(#' + P + 'sk_a)') +
          '<g transform="translate(470 120) scale(1.5)" fill="url(#' + P + 'sk_g)" opacity=".16">' + mark + '</g>' +
          '<g transform="translate(470 120) scale(1.5)" fill="none" stroke="url(#' + P + 'sk_g)" stroke-width="1.2" opacity=".55">' + mark + '</g>',
        over: '<rect x="14" y="14" width="' + (W - 28) + '" height="' + (H - 28) + '" rx="26" fill="none" stroke="url(#' + P + 'sk_g)" stroke-width="1.6" opacity=".8"/><rect x="24" y="24" width="' + (W - 48) + '" height="' + (H - 48) + '" rx="18" fill="none" stroke="url(#' + P + 'sk_g)" stroke-width=".8" opacity=".45"/>' +
          sweep(P, o.animate, '#FFE9A8', 0.6, 6) + tag('NEXUS BLACK', o.serial, '#F6E4AE'),
        edge: edge(P, '#FBEBB4', '#8A641C')
      };
    }
  });

  var api = {
    IDS: Object.keys(SKINS),
    has: function (id) { return Object.prototype.hasOwnProperty.call(SKINS, id); },
    get: function (id) { return api.has(id) ? SKINS[id] : null; },
    // build(P, { animate, serial }) → { defs, under, over, edge }
    meta: function (id) { var s = api.get(id); return s ? { id: s.id, name: s.name, label: s.label, brand: s.brand, chip: s.chip, bg: s.bg } : null; }
  };
  root.FNXSkins = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
