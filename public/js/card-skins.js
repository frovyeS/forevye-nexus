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



  // Yeni koleksiyon: her yüzey deterministik SVG ile çizilir; harici görsel dosyası gerektirmez.
  def('singularity', {
    name: 'Singularity', label: 'SINGULARITY', brand: '#E7E4FF', chip: 'silver', bg: ['#05050D', '#211044'],
    build: function (P, o) {
      var rings = '', stars = '', r = rng(421);
      for (var i = 0; i < 24; i++) rings += '<ellipse cx="638" cy="274" rx="' + (70 + i * 13) + '" ry="' + (28 + i * 6) + '" transform="rotate(' + (i * 7.5) + ' 638 274)"/>';
      for (var j = 0; j < 90; j++) stars += '<circle cx="' + (r()*W).toFixed(1) + '" cy="' + (r()*H).toFixed(1) + '" r="' + (0.6+r()*1.6).toFixed(1) + '" fill="#DCCBFF" opacity="' + (.2+r()*.65).toFixed(2) + '"/>';
      return { defs: lg(P+'sk_a',0,[[0,'#03040A'],[.48,'#17102D'],[1,'#080713']]) + '<radialGradient id="'+P+'sk_v"><stop offset="0" stop-color="#020207"/><stop offset=".24" stop-color="#080613"/><stop offset=".38" stop-color="#8A4CFF" stop-opacity=".9"/><stop offset=".53" stop-color="#16D9E5" stop-opacity=".3"/><stop offset="1" stop-color="#05050D" stop-opacity="0"/></radialGradient>' + '<filter id="'+P+'sk_bl"><feGaussianBlur stdDeviation="18"/></filter>',
        under: full('url(#'+P+'sk_a)') + stars + '<ellipse cx="638" cy="274" rx="340" ry="190" fill="url(#'+P+'sk_v)" filter="url(#'+P+'sk_bl)"/><g fill="none" stroke="#BCA0FF" stroke-width="1.2" opacity=".52">'+rings+'</g><ellipse cx="638" cy="274" rx="105" ry="38" fill="#020208" stroke="#A77BFF" stroke-width="3"/><ellipse cx="638" cy="274" rx="160" ry="58" fill="none" stroke="#54E8F3" stroke-opacity=".55" stroke-width="2" transform="rotate(-23 638 274)"/>',
        over: sweep(P,o.animate,'#BCA0FF',.58,7)+tag('SINGULARITY',o.serial,'#E7E4FF'), edge: edge(P,'#BDA3FF','#18D8D8') };
    }
  });

  def('lunar', {
    name: 'Lunar Pearl', label: 'LUNAR PEARL', brand: '#202A43', chip: 'silver', bg: ['#E8EDF7', '#AAB8D1'],
    build: function (P, o) {
      var craters = '', r = rng(77);
      for (var i=0;i<34;i++) { var x=80+r()*690, y=70+r()*400, z=4+r()*22; craters += '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+z.toFixed(1)+'" fill="none" stroke="#73839F" stroke-opacity=".22" stroke-width="2"/><ellipse cx="'+(x-3).toFixed(1)+'" cy="'+(y-3).toFixed(1)+'" rx="'+(z*.65).toFixed(1)+'" ry="'+(z*.35).toFixed(1)+'" fill="#fff" opacity=".36"/>'; }
      return { defs: lg(P+'sk_a',0,[[0,'#F7FAFF'],[.45,'#DCE4F1'],[1,'#9BAAC4']]) + '<radialGradient id="'+P+'sk_m" cx=".3" cy=".18" r=".85"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#DCE4F2"/><stop offset="1" stop-color="#6C7D9B"/></radialGradient>',
        under: full('url(#'+P+'sk_a)') + '<circle cx="640" cy="274" r="285" fill="url(#'+P+'sk_m)" opacity=".84"/>' + craters + '<g fill="none" stroke="#FDFEFF" stroke-width="3" opacity=".8"><path d="M-40 430C190 120 470 100 900 250"/><path d="M-30 466C210 160 520 145 900 292" opacity=".38"/></g><path d="M0 0H856V120C590 45 310 70 0 180Z" fill="#fff" opacity=".16"/>',
        over: tag('LUNAR PEARL',o.serial,'#202A43'), edge: edge(P,'#FFFFFF','#7787A5') };
    }
  });

  def('aether', {
    name: 'Aether Glass', label: 'AETHER GLASS', brand: '#E8FFFF', chip: 'silver', bg: ['#06212A', '#102E45'],
    build: function (P, o) {
      var facets = [['0,0 340,0 180,250','#42F5D7',.18],['340,0 856,0 650,230','#61A8FF',.22],['0,540 0,270 360,540','#38D9D0',.13],['180,250 650,230 500,540','#C4F5FF',.12],['650,230 856,190 856,540 500,540','#3974E8',.2],['0,270 180,250 500,540 0,540','#2BFFCA',.1]].map(function(f){return '<polygon points="'+f[0]+'" fill="'+f[1]+'" opacity="'+f[2]+'"/>';}).join('');
      return { defs: lg(P+'sk_a',0,[[0,'#04141F'],[.55,'#0C4050'],[1,'#081B35']]) + '<filter id="'+P+'sk_g"><feGaussianBlur stdDeviation="24"/></filter>',
        under: full('url(#'+P+'sk_a)')+facets+'<g filter="url(#'+P+'sk_g)" opacity=".48"><path d="M-40 440L400 10L550 620" stroke="#75FFF0" stroke-width="44" fill="none"/><path d="M300 -50L900 430" stroke="#7C9DFF" stroke-width="36" fill="none"/></g><g fill="none" stroke="#C7FFFF" stroke-opacity=".34"><path d="M0 0L180 250L650 230L856 0M180 250L500 540M650 230L856 190"/><path d="M0 270L180 250L340 0" opacity=".5"/></g>',
        over: sweep(P,o.animate,'#A9FFF5',.58,8)+tag('AETHER GLASS',o.serial,'#E8FFFF'), edge: edge(P,'#8CFFF1','#5B8BFF') };
    }
  });

  def('phoenix', {
    name: 'Phoenix Ember', label: 'PHOENIX', brand: '#FFF0D8', chip: 'gold', bg: ['#180609', '#42100C'],
    build: function (P, o) {
      var feathers='';
      for (var i=0;i<15;i++) { var y=90+i*25; feathers += '<path d="M'+(30+i*8)+' '+(y+90)+' C'+(230+i*7)+' '+(y-100)+' '+(470+i*12)+' '+(y+100)+' '+(840)+' '+(y-55)+'" fill="none" stroke="'+(i%3===0?'#FFD37B':i%3===1?'#FF743A':'#B92726')+'" stroke-width="'+(2+i%4)+'" opacity=".55"/>'; }
      return { defs: lg(P+'sk_a',0,[[0,'#100408'],[.5,'#4A100D'],[1,'#17060A']]) + '<radialGradient id="'+P+'sk_f" cx=".62" cy=".48" r=".68"><stop offset="0" stop-color="#FFB54A" stop-opacity=".58"/><stop offset=".5" stop-color="#E33A19" stop-opacity=".18"/><stop offset="1" stop-color="#13040A" stop-opacity="0"/></radialGradient>' + '<filter id="'+P+'sk_b"><feGaussianBlur stdDeviation="16"/></filter>',
        under: full('url(#'+P+'sk_a)')+full('url(#'+P+'sk_f)')+'<g>'+feathers+'</g><path d="M60 440C210 80 430 30 800 95C545 205 400 330 240 510Z" fill="#FF7B2D" opacity=".12" filter="url(#'+P+'sk_b)"/><path d="M70 430C270 180 460 115 790 125" fill="none" stroke="#FFE4A1" stroke-width="2" opacity=".72"/>',
        over: sweep(P,o.animate,'#FFD18B',.6,6)+tag('PHOENIX',o.serial,'#FFF0D8'), edge: edge(P,'#FFD48A','#8E2117') };
    }
  });

  def('deepsea', {
    name: 'Abyssal Bio', label: 'ABYSSAL', brand: '#D9FFFF', chip: 'silver', bg: ['#03151E', '#052E42'],
    build: function (P, o) {
      var bubbles='', r=rng(911);
      for(var i=0;i<65;i++){var x=r()*W,y=r()*H,z=2+r()*8;bubbles+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+z.toFixed(1)+'" fill="none" stroke="#6FFFE2" stroke-opacity=".48" stroke-width="1.5"/>';}
      var coral=''; for(var j=0;j<9;j++) coral+='<path d="M'+(70+j*90)+' 540 C'+(30+j*90)+' 420 '+(150+j*80)+' 360 '+(100+j*90)+' 210 M'+(100+j*90)+' 370 Q'+(20+j*90)+' 300 '+(30+j*90)+' 250 M'+(110+j*90)+' 330 Q'+(200+j*80)+' 290 '+(190+j*80)+' 220" fill="none" stroke="#31D8C7" stroke-width="4" opacity=".38"/>';
      return { defs: lg(P+'sk_a',0,[[0,'#020C15'],[.5,'#063449'],[1,'#020C20']]) + '<radialGradient id="'+P+'sk_d"><stop offset="0" stop-color="#2FE9D0" stop-opacity=".42"/><stop offset="1" stop-color="#001522" stop-opacity="0"/></radialGradient>' + '<filter id="'+P+'sk_bl"><feGaussianBlur stdDeviation="32"/></filter>',
        under: full('url(#'+P+'sk_a)')+'<ellipse cx="600" cy="330" rx="400" ry="230" fill="url(#'+P+'sk_d)" filter="url(#'+P+'sk_bl)"/>'+bubbles+'<g>'+coral+'</g><path d="M0 145C180 80 360 210 540 135S760 90 856 130" fill="none" stroke="#B6FFF4" stroke-width="2" opacity=".28"/>',
        over: sweep(P,o.animate,'#4DFFE4',.52,9)+tag('ABYSSAL',o.serial,'#D9FFFF'), edge: edge(P,'#60F5DB','#1374A4') };
    }
  });

  def('chronos', {
    name: 'Chronos Engraved', label: 'CHRONOS', brand: '#F8E8C4', chip: 'gold', bg: ['#101014', '#3A2A1B'],
    build: function (P, o) {
      var ticks='', rings='';
      for(var i=0;i<120;i++){var a=i*Math.PI/60, x1=620+Math.cos(a)*150,y1=270+Math.sin(a)*150,x2=620+Math.cos(a)*(i%5===0?178:164),y2=270+Math.sin(a)*(i%5===0?178:164);ticks+='<path d="M'+x1.toFixed(1)+' '+y1.toFixed(1)+'L'+x2.toFixed(1)+' '+y2.toFixed(1)+'" stroke="#E8C98F" stroke-width="'+(i%5===0?3:1)+'" opacity=".72"/>'; }
      for(var j=1;j<16;j++) rings+='<circle cx="620" cy="270" r="'+(j*19)+'"/>';
      return { defs: lg(P+'sk_a',0,[[0,'#0D0D12'],[.48,'#29211D'],[1,'#0B0C10']]) + lg(P+'sk_g',0,[[0,'#FFE7AE'],[.5,'#A76A34'],[1,'#F1D39A']]),
        under: full('url(#'+P+'sk_a)')+'<g fill="none" stroke="url(#'+P+'sk_g)" opacity=".38">'+rings+'</g><g>'+ticks+'</g><path d="M80 500L390 190M120 540L440 220" stroke="#B88250" stroke-width="1.2" opacity=".35"/><circle cx="620" cy="270" r="26" fill="#17120F" stroke="#F1D39A" stroke-width="2"/><path d="M620 270L690 205M620 270L580 330" stroke="#F1D39A" stroke-width="3"/>',
        over: tag('CHRONOS',o.serial,'#F8E8C4'), edge: edge(P,'#F9E3AE','#996037') };
    }
  });

  def('eclipse', {
    name: 'Solar Eclipse', label: 'ECLIPSE', brand: '#FFF2D1', chip: 'gold', bg: ['#090A12', '#1B1B2A'],
    build: function (P, o) {
      var rays=''; for(var i=0;i<72;i++){var a=i*Math.PI/36,x1=625+Math.cos(a)*152,y1=265+Math.sin(a)*152,x2=625+Math.cos(a)*245,y2=265+Math.sin(a)*245;rays+='<path d="M'+x1.toFixed(1)+' '+y1.toFixed(1)+'L'+x2.toFixed(1)+' '+y2.toFixed(1)+'" stroke="#F8C96C" stroke-width="'+(i%3===0?2:1)+'" opacity=".55"/>';}
      return { defs: '<radialGradient id="'+P+'sk_e" cx=".74" cy=".45" r=".6"><stop offset="0" stop-color="#FFDA84" stop-opacity=".75"/><stop offset=".45" stop-color="#A96C3E" stop-opacity=".25"/><stop offset="1" stop-color="#080912" stop-opacity="0"/></radialGradient><filter id="'+P+'sk_gl"><feGaussianBlur stdDeviation="22"/></filter>' + lg(P+'sk_a',0,[[0,'#05060C'],[1,'#1D1C2B']]),
        under: full('url(#'+P+'sk_a)')+'<ellipse cx="625" cy="265" rx="330" ry="255" fill="url(#'+P+'sk_e)" filter="url(#'+P+'sk_gl)"/><g>'+rays+'</g><circle cx="625" cy="265" r="125" fill="#090912" stroke="#F7D18A" stroke-width="4"/><circle cx="625" cy="265" r="139" fill="none" stroke="#FFE8B8" stroke-width="1.5" opacity=".62"/><path d="M0 470C250 370 400 430 856 300" stroke="#8E79C9" stroke-width="1.4" fill="none" opacity=".35"/>',
        over: sweep(P,o.animate,'#FFD991',.55,8)+tag('ECLIPSE',o.serial,'#FFF2D1'), edge: edge(P,'#FFE8B0','#7655A8') };
    }
  });

  def('celestial', {
    name: 'Celestial Atlas', label: 'CELESTIAL', brand: '#EAF2FF', chip: 'silver', bg: ['#071326', '#111E3C'],
    build: function (P, o) {
      var stars='',lines='',r=rng(1207),pts=[];
      for(var i=0;i<48;i++){pts.push([40+r()*770,45+r()*440]);}
      pts.forEach(function(p,i){stars+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="'+(1+r()*2).toFixed(1)+'" fill="#F6E6B5" opacity=".86"/>';if(i%2===0&&pts[i+1])lines+='<path d="M'+p[0].toFixed(1)+' '+p[1].toFixed(1)+'L'+pts[i+1][0].toFixed(1)+' '+pts[i+1][1].toFixed(1)+'" stroke="#8BB7FF" stroke-width="1" opacity=".34"/>';});
      return { defs: lg(P+'sk_a',0,[[0,'#040B19'],[.5,'#11284A'],[1,'#080D22']]) + '<radialGradient id="'+P+'sk_c" cx=".72" cy=".3" r=".75"><stop offset="0" stop-color="#355D9B" stop-opacity=".5"/><stop offset="1" stop-color="#061020" stop-opacity="0"/></radialGradient>',
        under: full('url(#'+P+'sk_a)')+full('url(#'+P+'sk_c)')+'<g>'+lines+stars+'</g><path d="M30 430C180 300 300 340 430 210S680 130 820 40" fill="none" stroke="#D9C38C" stroke-width="1.3" stroke-dasharray="5 8" opacity=".58"/><circle cx="620" cy="210" r="108" fill="none" stroke="#D9C38C" stroke-width="1.3" opacity=".45"/><circle cx="620" cy="210" r="94" fill="none" stroke="#D9C38C" stroke-width=".7" opacity=".28"/>',
        over: sweep(P,o.animate,'#A8C9FF',.42,10)+tag('CELESTIAL ATLAS',o.serial,'#EAF2FF'), edge: edge(P,'#D5C38E','#668ED1') };
    }
  });

  var PRODUCT_META = {
    onyx:['skin_onyx','Oniks Mat','Saten matlık ve şampanya altını çerçeve.','rare',180000],
    carbon:['skin_carbon','Karbon Fiber','Katmanlı karbon örgü ve yarış şeridi.','rare',240000],
    aurora:['skin_aurora','Aurora','Kuzey ışıkları gibi akan renk katmanları.','epic',450000],
    nebula:['skin_nebula','Nebula','Prosedürel yıldız alanı ve kozmik bulutlar.','epic',480000],
    prism:['skin_prism','Prizma Cam','Kırılan ışık ve hareketli cam yüzey.','legendary',800000],
    guilloche:['skin_guilloche','Altın Gilyoş','Mikro çizgili banknot gravürü ve altın folyo.','legendary',950000],
    titan:['card_titan','Titanyum','Fırçalanmış metal ve çift limit avantajı.','epic',750000],
    platinum:['card_platinum','Platin','İnce halkalı platin ve borsa avantajı.','legendary',1200000],
    royal:['card_black','Nexus Black','Siyah-altın imza yüzey, en üst seviye avantajlar.','mythic',4000000],
    singularity:['skin_singularity','Singularity','Karanlık tekillik, yıldız alanı ve ışık yörüngeleri.','mythic',1800000],
    lunar:['skin_lunar','Lunar Pearl','Ay yüzeyi gravürü ve sedefli seramik katman.','legendary',1250000],
    aether:['skin_aether','Aether Glass','Turkuaz kristal kırılımları ve cam katmanlar.','legendary',1400000],
    phoenix:['skin_phoenix','Phoenix Ember','Alev tüyleri, sıcak metalik parıltı.','mythic',2200000],
    deepsea:['skin_deepsea','Abyssal Bio','Biyolüminesans ve derin deniz dokusu.','epic',980000],
    chronos:['skin_chronos','Chronos Engraved','Mekanik saat gravürü ve mikro kadran.','legendary',1600000],
    eclipse:['skin_eclipse','Solar Eclipse','Altın korona, tutulma halkası ve gece göğü.','mythic',2000000],
    celestial:['skin_celestial','Celestial Atlas','Takımyıldız haritası ve safir gece yüzeyi.','legendary',1500000]
  };

  // 31 yeni koleksiyon yüzeyi. Her biri parametrik ama kendine ait motif/renk/gravür bileşimiyle SVG olarak çizilir.
  // Aynı katalog hem Market vitrininde hem Banka kart editöründe hem de Worker skin doğrulamasında kullanılır.
  var GALLERY = [
    {id:'imperial',productId:'skin_imperial',name:'Imperial Lacquer',label:'IMPERIAL',desc:'Bordo lake, altın yelpaze gravürü ve el işçiliği hissi veren katmanlı çerçeve.',rarity:'mythic',price:1650000,stock:28,sort:18,motif:'fan',colors:['#10070D','#381321','#6A2631'],accent:'#F0C77B',ink:'#FFF0D2'},
    {id:'rose',productId:'skin_rose',name:'Rose Obsidian',label:'ROSE OBSIDIAN',desc:'Vişne siyahı obsidyen, gül altını damarlar ve saten parlaklık.',rarity:'legendary',price:1180000,stock:54,sort:19,motif:'cracks',colors:['#100910','#32172B','#572A47'],accent:'#E9A7B8',ink:'#FFE9EF'},
    {id:'sapphire',productId:'skin_sapphire',name:'Sapphire Sovereign',label:'SAPPHIRE',desc:'Derin safir kristali, mikro yıldızlar ve çift katmanlı mücevher çerçeve.',rarity:'legendary',price:1320000,stock:48,sort:20,motif:'stars',colors:['#061126','#102B58','#173D70'],accent:'#8BC8FF',ink:'#E8F5FF'},
    {id:'jade',productId:'skin_jade',name:'Jade Dynasty',label:'JADE DYNASTY',desc:'Yeşim taşı damarları, altın mühür ve doğu esintili geometrik gravür.',rarity:'legendary',price:1250000,stock:50,sort:21,motif:'contour',colors:['#061B18','#0D4037','#176052'],accent:'#D9C27E',ink:'#F3F5D8'},
    {id:'arctic',productId:'skin_arctic',name:'Arctic Halo',label:'ARCTIC HALO',desc:'Buzlu safir cam, kristal kırılmaları ve kutup ışığı halkası.',rarity:'epic',price:820000,stock:92,sort:22,motif:'crystal',colors:['#071A2A','#123C56','#1A5A73'],accent:'#A8ECFF',ink:'#E8FBFF'},
    {id:'volcanic',productId:'skin_volcanic',name:'Volcanic Glass',label:'VOLCANIC',desc:'Bazalt siyahı üzerinde lav damarları ve erimiş bakır parıltısı.',rarity:'mythic',price:1720000,stock:24,sort:23,motif:'cracks',colors:['#100A0A','#33110D','#4A1B0D'],accent:'#FF8A45',ink:'#FFE6C9'},
    {id:'amethyst',productId:'skin_amethyst',name:'Amethyst Vault',label:'AMETHYST',desc:'Mor jeot kristalleri, menekşe ışık ve keskin faset yansımaları.',rarity:'epic',price:940000,stock:76,sort:24,motif:'crystal',colors:['#100B20','#2B174D','#493078'],accent:'#D7B7FF',ink:'#F7ECFF'},
    {id:'monarch',productId:'skin_monarch',name:'Monarch Wings',label:'MONARCH',desc:'Altın kelebek kanadı simetrisi, ince damar çizgileri ve mücevher merkezi.',rarity:'legendary',price:1450000,stock:40,sort:25,motif:'wing',colors:['#120D09','#352315','#594022'],accent:'#EBC779',ink:'#FFF3D4'},
    {id:'vortex',productId:'skin_vortex',name:'Vortex Prime',label:'VORTEX PRIME',desc:'Merkezine çeken enerji girdabı, ince ışık halkaları ve derin uzay.',rarity:'mythic',price:1850000,stock:22,sort:26,motif:'spiral',colors:['#090B18','#1B1C43','#30245E'],accent:'#B8A0FF',ink:'#F2EDFF'},
    {id:'quantum',productId:'skin_quantum',name:'Quantum Flux',label:'QUANTUM FLUX',desc:'Kuantum devre yolları, neon düğümler ve çok katmanlı veri akışı.',rarity:'epic',price:990000,stock:68,sort:27,motif:'circuit',colors:['#041418','#063B40','#07545A'],accent:'#62F5DA',ink:'#E1FFFA'},
    {id:'mech',productId:'skin_mech',name:'Mechano Royale',label:'MECHANO',desc:'Saat mekanizması dişlileri, fırçalanmış pirinç ve mikro kadranlar.',rarity:'legendary',price:1380000,stock:44,sort:28,motif:'gear',colors:['#11100D','#30271B','#51412A'],accent:'#E8C27A',ink:'#FFF1D2'},
    {id:'topo',productId:'skin_topo',name:'Atlas Topography',label:'ATLAS TOPO',desc:'Dağ sırtı topografyası, kontur gravürü ve pusula merkez rozeti.',rarity:'epic',price:880000,stock:84,sort:29,motif:'contour',colors:['#0A1719','#16353B','#24505A'],accent:'#C5D4B1',ink:'#F0F6E9'},
    {id:'kintsugi',productId:'skin_kintsugi',name:'Kintsugi Nocturne',label:'KINTSUGI',desc:'Gece seramiği üzerinde altın onarım damarları; her kırık ayrı bir imza.',rarity:'mythic',price:1780000,stock:20,sort:30,motif:'cracks',colors:['#08090D','#191B22','#302C31'],accent:'#F0C86D',ink:'#FFF0C6'},
    {id:'marble',productId:'skin_marble',name:'Nero Marble',label:'NERO MARBLE',desc:'Siyah mermer, beyaz kuvars damarları ve minimal platin hat.',rarity:'legendary',price:1120000,stock:56,sort:31,motif:'contour',colors:['#090B0D','#1A2025','#30363A'],accent:'#D9E0E4',ink:'#F7F9FA'},
    {id:'opal',productId:'skin_opal',name:'Opaline Mirage',label:'OPALINE',desc:'Opal taşından esinlenen katmanlı sedef, pembe-mavi ışık kırılması.',rarity:'legendary',price:1260000,stock:46,sort:32,motif:'facets',colors:['#101426','#25294B','#3B3560'],accent:'#E8BFFF',ink:'#FFF0FF'},
    {id:'lotus',productId:'skin_lotus',name:'Lotus Nocturne',label:'LOTUS NOCTURNE',desc:'Gece nilüferi, simetrik yaprak gravürü ve ay ışığında gümüş merkez.',rarity:'epic',price:920000,stock:72,sort:33,motif:'petal',colors:['#08151A','#12313B','#224B55'],accent:'#B7DAD4',ink:'#EFFFFB'},
    {id:'tiger',productId:'skin_tiger',name:'Tiger Eye Reserve',label:'TIGER EYE',desc:'Kaplan gözü taşının kehribar lifleri, optik derinlik ve bronz kenar.',rarity:'legendary',price:1190000,stock:52,sort:34,motif:'waves',colors:['#160D08','#3C2110','#694018'],accent:'#F3B85E',ink:'#FFF0D2'},
    {id:'seraph',productId:'skin_seraph',name:'Seraphim Gold',label:'SERAPHIM',desc:'Melek kanadı tüy gravürü, altın ışık ve kutsal geometri rozeti.',rarity:'mythic',price:1980000,stock:18,sort:35,motif:'wing',colors:['#111018','#302B3B','#51465D'],accent:'#F0D9A0',ink:'#FFF7E3'},
    {id:'glacier',productId:'skin_glacier',name:'Glacier Bloom',label:'GLACIER BLOOM',desc:'Buz çiçeği kristalleri, donmuş cam katmanları ve soğuk gümüş.',rarity:'epic',price:860000,stock:88,sort:36,motif:'petal',colors:['#081927','#173A51','#285D76'],accent:'#B5E8F7',ink:'#ECFAFF'},
    {id:'solstice',productId:'skin_solstice',name:'Solstice 24',label:'SOLSTICE',desc:'Güneş ve ayın tek yüzeyde buluştuğu, astronomik halka gravürü.',rarity:'legendary',price:1420000,stock:38,sort:37,motif:'sun',colors:['#100C1B','#31203F','#59402F'],accent:'#E9BD75',ink:'#FFF0D6'},
    {id:'tesseract',productId:'skin_tesseract',name:'Tesseract',label:'TESSERACT',desc:'Dört boyutlu geometri illüzyonu, perspektif küpler ve lazer hatlar.',rarity:'mythic',price:1900000,stock:16,sort:38,motif:'facets',colors:['#080E1B','#142B45','#284C69'],accent:'#8EE8EE',ink:'#E8FFFF'},
    {id:'geode',productId:'skin_geode',name:'Geode Sovereign',label:'GEODE',desc:'Kristal mağara iç katmanları, ametist uçlar ve mineral damarları.',rarity:'legendary',price:1350000,stock:42,sort:39,motif:'crystal',colors:['#100B1B','#2A183B','#49315E'],accent:'#D8A6F2',ink:'#F8EFFF'},
    {id:'silk',productId:'skin_silk',name:'Silk Dynasty',label:'SILK DYNASTY',desc:'Akışkan ipek kıvrımları, saten yüzey ve zarif altın dikiş.',rarity:'epic',price:970000,stock:70,sort:40,motif:'waves',colors:['#141018','#392039','#60324E'],accent:'#E8B9CE',ink:'#FFF0F5'},
    {id:'velvet',productId:'skin_velvet',name:'Velvet Noir',label:'VELVET NOIR',desc:'Kadife bordo dokusu, siyah krom ve derin yakut parıltısı.',rarity:'legendary',price:1280000,stock:44,sort:41,motif:'arches',colors:['#12080E','#36101E','#5C1F32'],accent:'#E2A0B0',ink:'#FFEAF0'},
    {id:'neoncity',productId:'skin_neoncity',name:'Tokyo Afterglow',label:'TOKYO AFTERGLOW',desc:'Gece şehri silueti, neon tabelalar ve yağmur sonrası yansımalar.',rarity:'epic',price:1050000,stock:64,sort:42,motif:'city',colors:['#080B1B','#191A3C','#2D2450'],accent:'#F29EDB',ink:'#FFF0FC'},
    {id:'matrix',productId:'skin_matrix',name:'Matrix Cipher',label:'MATRIX CIPHER',desc:'Dijital kod yağmuru, mikro ızgara ve yeşil fosforik izler.',rarity:'rare',price:520000,stock:180,sort:43,motif:'circuit',colors:['#020F0B','#06301D','#0C4A2B'],accent:'#65F59B',ink:'#E3FFEC'},
    {id:'mosaic',productId:'skin_mosaic',name:'Celadon Mosaic',label:'CELADON',desc:'El yapımı mozaik parçaları, seramik sır ve ince metal birleşimler.',rarity:'epic',price:890000,stock:82,sort:44,motif:'mosaic',colors:['#0A1717','#17403A','#286157'],accent:'#C5DDAE',ink:'#F0F8E6'},
    {id:'circuit',productId:'skin_circuit',name:'Aurum Circuit',label:'AURUM CIRCUIT',desc:'Altın devre şeması, hassas bağlantı düğümleri ve siyah titanyum.',rarity:'legendary',price:1470000,stock:36,sort:45,motif:'circuit',colors:['#0C0D10','#25221A','#3E3520'],accent:'#E5C26E',ink:'#FFF4D5'},
    {id:'plasma',productId:'skin_plasma',name:'Plasma Crown',label:'PLASMA CROWN',desc:'Mor plazma koronu, iyon halkaları ve elektrik arkı katmanları.',rarity:'mythic',price:2050000,stock:14,sort:46,motif:'rings',colors:['#0B0819','#25113F','#421D65'],accent:'#CB9AFF',ink:'#F9EFFF'},
    {id:'monsoon',productId:'skin_monsoon',name:'Monsoon Noire',label:'MONSOON',desc:'Fırtına bulutları, gümüş yağmur çizgileri ve elektrik mavisi ufuk.',rarity:'epic',price:930000,stock:74,sort:47,motif:'waves',colors:['#070F1A','#142C42','#1F465B'],accent:'#A6DDF5',ink:'#EAF8FF'},
    {id:'artdeco',productId:'skin_artdeco',name:'Art Deco 1928',label:'ART DECO',desc:'1920’ler mimarisinden altın yelpazeler, dikey çizgiler ve siyah lake.',rarity:'legendary',price:1510000,stock:34,sort:48,motif:'arches',colors:['#0D0D12','#27232A','#48382A'],accent:'#E6C27A',ink:'#FFF2D4'}
  ];

  function gallerySkin(item) {
    return {
      name:item.name, label:item.label, brand:item.ink, chip:item.rarity==='mythic'?'gold':'silver', bg:item.colors,
      build:function(P,o) {
        var c=item.colors, a=item.accent, r=rng(item.sort*7919+item.id.length*313), motif='', defs=lg(P+'sk_a',0,[[0,c[0]],[.55,c[1]],[1,c[2]]],0,0,1,1)+
          '<radialGradient id="'+P+'sk_r" cx=".72" cy=".26" r=".82"><stop offset="0" stop-color="'+a+'" stop-opacity=".32"/><stop offset=".56" stop-color="'+a+'" stop-opacity=".07"/><stop offset="1" stop-color="'+c[0]+'" stop-opacity="0"/></radialGradient>'+
          '<pattern id="'+P+'sk_p" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V24" stroke="'+a+'" stroke-width=".7" opacity=".055"/><circle cx="12" cy="12" r="1" fill="'+a+'" opacity=".12"/></pattern>'+
          '<linearGradient id="'+P+'sk_g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="'+a+'" stop-opacity=".7"/><stop offset=".48" stop-color="'+a+'" stop-opacity=".05"/><stop offset="1" stop-color="'+a+'" stop-opacity=".55"/></linearGradient>';
        if(item.motif==='rings' || item.motif==='sun') {
          var cx=item.motif==='sun'?630:610, cy=item.motif==='sun'?265:260;
          for(var i=0;i<15;i++){var rr=58+i*19; motif+='<circle cx="'+cx+'" cy="'+cy+'" r="'+rr+'" fill="none" stroke="'+(i%3===0?a:'#EAF2FF')+'" stroke-width="'+(i%3===0?2.1:.8)+'" opacity="'+(i%3===0?.38:.13)+'"/>';}
          for(var j=0;j<48;j++){var an=j*Math.PI/24, x1=cx+150*Math.cos(an),y1=cy+150*Math.sin(an),x2=cx+(item.motif==='sun'?270:245)*Math.cos(an),y2=cy+(item.motif==='sun'?270:245)*Math.sin(an);motif+='<path d="M'+x1.toFixed(1)+' '+y1.toFixed(1)+'L'+x2.toFixed(1)+' '+y2.toFixed(1)+'" stroke="'+a+'" stroke-width="1" opacity=".28"/>';}
          if(item.motif==='sun') motif+='<circle cx="630" cy="265" r="92" fill="'+a+'" fill-opacity=".12" stroke="'+a+'" stroke-width="3"/>';
        } else if(item.motif==='waves') {
          for(var i=0;i<15;i++){var y=65+i*31, amp=30+r()*48, phase=r()*150; motif+='<path d="M-30 '+y+' C170 '+(y-amp-phase*.12)+' 210 '+(y+amp)+' 420 '+y+' S680 '+(y-amp)+' 890 '+(y+phase*.15)+'" fill="none" stroke="'+(i%4===0?a:'#D7E8F2')+'" stroke-width="'+(i%4===0?2.4:1)+'" opacity="'+(i%4===0?.42:.16)+'"/>';}
        } else if(item.motif==='facets' || item.motif==='crystal') {
          for(var y=30;y<560;y+=76) for(var x=-20;x<900;x+=116){var dx=18+r()*60,dy=12+r()*48,flip=r()>.5;var p1=(x+dx)+','+(y-dy),p2=(x+105)+','+(y+38),p3=(x+dx-20)+','+(y+78),p4=(x-10)+','+(y+36);motif+='<polygon points="'+(flip?p1+' '+p2+' '+p3:p4+' '+p1+' '+p3)+'" fill="'+a+'" fill-opacity="'+(.025+r()*.07).toFixed(3)+'" stroke="'+a+'" stroke-opacity=".28" stroke-width="1.2"/>';}
          motif+='<path d="M420 80L570 210L510 390L340 430L270 245Z" fill="url(#'+P+'sk_g)" fill-opacity=".28" stroke="'+a+'" stroke-opacity=".7" stroke-width="2"/><path d="M420 80L420 280L570 210M420 280L510 390M420 280L270 245" fill="none" stroke="'+a+'" stroke-opacity=".5"/>';
        } else if(item.motif==='circuit') {
          for(var i=0;i<20;i++){var x=30+r()*790,y=35+r()*460,dx=50+r()*130,dy=(r()>.5?1:-1)*(24+r()*100);motif+='<path d="M'+x.toFixed(1)+' '+y.toFixed(1)+'h'+dx.toFixed(1)+'v'+dy.toFixed(1)+'h'+(35+r()*90).toFixed(1)+'" fill="none" stroke="'+a+'" stroke-width="'+(i%4===0?2.4:1.1)+'" opacity="'+(i%4===0?.58:.25)+'"/><circle cx="'+(x+dx+35+r()*90).toFixed(1)+'" cy="'+(y+dy).toFixed(1)+'" r="'+(2+r()*4).toFixed(1)+'" fill="'+a+'" opacity=".7"/>';}
        } else if(item.motif==='petal' || item.motif==='wing' || item.motif==='fan') {
          var cx=430,cy=280;
          for(var i=0;i<(item.motif==='fan'?19:16);i++){var ang=(i*360/(item.motif==='fan'?19:16)),rx=item.motif==='wing'?220:150,ry=item.motif==='wing'?58:110;motif+='<ellipse cx="'+cx+'" cy="'+(cy-ry)+'" rx="'+(item.motif==='wing'?20:34)+'" ry="'+ry+'" transform="rotate('+ang+' '+cx+' '+cy+')" fill="url(#'+P+'sk_g)" fill-opacity=".13" stroke="'+a+'" stroke-width="1.35" stroke-opacity=".48"/>';motif+='<path d="M'+cx+' '+cy+'Q'+(cx+rx*Math.cos(ang*Math.PI/180)).toFixed(1)+' '+(cy+ry*Math.sin(ang*Math.PI/180)).toFixed(1)+' '+(cx+rx*1.35*Math.cos(ang*Math.PI/180)).toFixed(1)+' '+(cy+ry*1.35*Math.sin(ang*Math.PI/180)).toFixed(1)+'" stroke="'+a+'" stroke-width="1" opacity=".25" fill="none"/>';}
          motif+='<circle cx="430" cy="280" r="38" fill="url(#'+P+'sk_g)" stroke="'+a+'" stroke-width="2" opacity=".8"/>';
        } else if(item.motif==='contour') {
          for(var i=0;i<22;i++){var yy=35+i*24,off=r()*100;motif+='<path d="M-20 '+yy+' C130 '+(yy-80+off)+' 250 '+(yy+100-off)+' 390 '+(yy-10)+' S650 '+(yy-100+off)+' 880 '+(yy+35)+'" fill="none" stroke="'+(i%5===0?a:'#D7E6E2')+'" stroke-width="'+(i%5===0?1.9:.85)+'" opacity="'+(i%5===0?.42:.16)+'"/>';}
          motif+='<circle cx="620" cy="230" r="92" fill="none" stroke="'+a+'" stroke-width="1.5" opacity=".6"/><circle cx="620" cy="230" r="76" fill="none" stroke="'+a+'" stroke-width=".8" opacity=".4"/>';
        } else if(item.motif==='gear') {
          for(var k=0;k<3;k++){var cx=590-k*210,cy=240+k*45,rad=95-k*18;motif+='<circle cx="'+cx+'" cy="'+cy+'" r="'+rad+'" fill="none" stroke="'+a+'" stroke-width="4" opacity=".45"/><circle cx="'+cx+'" cy="'+cy+'" r="'+(rad-16)+'" fill="none" stroke="'+a+'" stroke-width="1.4" opacity=".35"/>';for(var j=0;j<24;j++){var an=j*Math.PI/12;motif+='<path d="M'+(cx+(rad-5)*Math.cos(an)).toFixed(1)+' '+(cy+(rad-5)*Math.sin(an)).toFixed(1)+'L'+(cx+(rad+12)*Math.cos(an)).toFixed(1)+' '+(cy+(rad+12)*Math.sin(an)).toFixed(1)+'" stroke="'+a+'" stroke-width="5" opacity=".4"/>';}}
        } else if(item.motif==='arches') {
          for(var i=0;i<16;i++){var x=40+i*53;motif+='<path d="M'+x+' 520V'+(170-i*5)+' Q'+(x+22)+' '+(70-i*3)+' '+(x+44)+' '+(170-i*5)+'V520" fill="none" stroke="'+(i%3===0?a:'#D9C6A4')+'" stroke-width="'+(i%3===0?2.8:1)+'" opacity="'+(i%3===0?.56:.17)+'"/>';}
        } else if(item.motif==='city') {
          for(var i=0;i<24;i++){var x=i*39-8,w=18+r()*16,h=55+r()*180,y=510-h;motif+='<rect x="'+x+'" y="'+y.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+h.toFixed(1)+'" fill="'+a+'" fill-opacity=".055" stroke="'+a+'" stroke-opacity=".33"/><path d="M'+(x+5)+' '+(y+15)+'v'+(h-20)+'" stroke="'+a+'" stroke-width="2" stroke-dasharray="3 9" opacity=".36"/>';}
          motif+='<path d="M0 485Q210 430 420 485T856 475" fill="none" stroke="'+a+'" stroke-width="2" opacity=".8"/>';
        } else if(item.motif==='mosaic') {
          for(var y=28;y<560;y+=68) for(var x=-20;x<900;x+=76){var jx=r()*28-14,jy=r()*22-11;motif+='<polygon points="'+(x+jx)+','+(y+jy)+' '+(x+64+jx)+','+(y-8+jy)+' '+(x+72+jx)+','+(y+54+jy)+' '+(x+7+jx)+','+(y+65+jy)+'" fill="'+a+'" fill-opacity="'+(.025+r()*.085).toFixed(3)+'" stroke="'+a+'" stroke-opacity=".3" stroke-width="1"/>';}
        } else if(item.motif==='spiral') {
          for(var i=0;i<9;i++){var rad=34+i*24;motif+='<path d="M'+(450-rad)+' 275 C'+(390-rad)+' '+(60+i*10)+' '+(780-rad)+' '+(40+i*18)+' '+(710-rad*.4)+' 280 S'+(430+rad)+' '+(500-i*9)+' '+(440+rad*.7)+' 280" fill="none" stroke="'+(i%2===0?a:'#A9A7FF')+'" stroke-width="'+(i%3===0?2.8:1.1)+'" opacity=".42"/>';}
        } else if(item.motif==='cracks') {
          for(var i=0;i<18;i++){var x=40+r()*760,y=30+r()*470,dx=(r()-.5)*260,dy=90+r()*170;motif+='<path d="M'+x.toFixed(1)+' '+y.toFixed(1)+'l'+(dx*.42).toFixed(1)+' '+(dy*.35).toFixed(1)+'l'+(dx*.58).toFixed(1)+' '+(dy*.65).toFixed(1)+'m'+(-dx*.25).toFixed(1)+' '+(-dy*.3).toFixed(1)+'l'+(-dx*.22).toFixed(1)+' '+(dy*.12).toFixed(1)+'m'+(dx*.42).toFixed(1)+' '+(dy*.53).toFixed(1)+'l'+(-dx*.15).toFixed(1)+' '+(dy*.22).toFixed(1)+'" fill="none" stroke="'+a+'" stroke-width="'+(i%4===0?2.4:1)+'" opacity="'+(i%4===0?.56:.27)+'"/>';}
        } else if(item.motif==='stars') {
          for(var i=0;i<120;i++){var x=20+r()*816,y=20+r()*500,rr=.6+r()*2.7;motif+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+rr.toFixed(1)+'" fill="'+(i%7===0?a:'#F3F7FF')+'" opacity="'+(.25+r()*.62).toFixed(2)+'"/>';if(i%13===0)motif+='<path d="M'+(x-12)+' '+y+'h24M'+x+' '+(y-12)+'v24" stroke="'+a+'" stroke-width="1" opacity=".46"/>';}
        }
        var under=full('url(#'+P+'sk_a)')+full('url(#'+P+'sk_r)')+full('url(#'+P+'sk_p)')+'<g>'+motif+'</g>'+
          '<path d="M20 430C210 350 300 500 500 385S730 340 836 210" fill="none" stroke="url(#'+P+'sk_g)" stroke-width="2" opacity=".45"/>'+
          '<path d="M25 468H831" stroke="'+a+'" stroke-width=".8" opacity=".18"/>';
        return {defs:defs,under:under,over:sweep(P,o.animate,a,.42,11)+tag(item.label,o.serial,item.ink),edge:edge(P,a,c[1])};
      }
    };
  }
  GALLERY.forEach(function(item){
    def(item.id,gallerySkin(item));
    PRODUCT_META[item.id]=[item.productId,item.name,item.desc,item.rarity,item.price];
  });

  var api = {
    IDS: Object.keys(SKINS),
    catalog: GALLERY.map(function(x){return {id:x.id,productId:x.productId,name:x.name,tagline:x.desc,desc:x.desc,rarity:x.rarity,price:x.price,stock:x.stock,sort:x.sort};}),
    list: Object.keys(SKINS).map(function(id){var m=PRODUCT_META[id]||[],s=SKINS[id];return {id:id,n:m[1]||s.name,d:m[2]||'Özel kart yüzeyi.',price:(m[4]||1000)/100,brand:s.brand,chip:s.chip,rarity:m[3]||'rare',productId:m[0]||('skin_'+id),build:s.build};}),
    has: function (id) { return Object.prototype.hasOwnProperty.call(SKINS, id); },
    get: function (id) { return api.has(id) ? SKINS[id] : null; },
    // build(P, { animate, serial }) → { defs, under, over, edge }
    meta: function (id) { var s = api.get(id); return s ? { id: s.id, name: s.name, label: s.label, brand: s.brand, chip: s.chip, bg: s.bg } : null; }
  };
  root.FNXSkins = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
