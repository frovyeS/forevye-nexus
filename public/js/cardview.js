// Kartı çizer. Çizim kodu banka kart editörüyle AYNI dosyadır (card-render.js + card-rules.js); Nexus'ta bir kart editörde göründüğü gibi görünür.
// Marka, çip ve kart kimliği çizimde sistemden eklenir; kullanıcının tasarımında yer almaz. Bu dosya yalnızca görüntüler; doğrulama sunucudadır.
// Sözleşme sürüm 3: yatay ve dikey kartlar; sistem öğeleri her zaman dekoratif katmanların üstünde çizilir.
import './card-rules.js';
import './qrcode.js';
import './card-render.js';

const X = window.FNXRender;
let uid = 0;

// QR'ı büyütülmüş, taranabilir (düz siyah-beyaz) biçimde ayrı pencerede açar. CSP'ye uygun: yalnızca DOM + CSS dosyası.
export function openQrModal(token, name = '') {
  const prev = document.activeElement;
  const back = document.createElement('div');
  back.className = 'qr-back'; back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true'); back.setAttribute('aria-label', 'Kart QR kodu');
  const box = document.createElement('div'); box.className = 'qr-box';
  const holder = document.createElement('div'); holder.innerHTML = X.qrSvg(token, { size: 300 });
  const title = document.createElement('p'); title.className = 'strong'; title.textContent = name || 'Sanal kart';
  const code = document.createElement('p'); code.className = 'qr-code'; code.textContent = token;
  const note = document.createElement('p'); note.className = 'muted small'; note.textContent = 'QR yalnızca sanal kart kimliğini taşır; gerçek ödeme bilgisi içermez.';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'btn primary block'; close.textContent = 'Kapat';
  box.append(holder.firstElementChild || holder, title, code, note, close); back.append(box);
  const done = () => { document.removeEventListener('keydown', onKey, true); back.remove(); if (prev && prev.focus) prev.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
  close.addEventListener('click', done);
  back.addEventListener('click', (e) => { if (e.target === back) done(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back); close.focus();
}

// opts.qrOpen: kart üstündeki QR'a tıklanınca büyütme penceresi açılır (kart detayında). Liste kutucuklarında kapalı: kutucuğun tamamı bağlantıdır.
export function renderCard(design, { display_name = '', card_token = '', status = 'active' } = {}, opts = {}) {
  const wrap = document.createElement('div');
  const portrait = design && design.orientation === 'portrait';
  try {
    wrap.innerHTML = X.cardSvg(design, { last4: card_token ? card_token.slice(-4) : '••••', cardToken: card_token }, { prefix: `n${uid++}`, qrOpen: !!opts.qrOpen });
  } catch {
    wrap.innerHTML = portrait
      ? '<svg class="card-svg" viewBox="0 0 540 856" xmlns="http://www.w3.org/2000/svg"><rect width="540" height="856" rx="36" fill="#14161B"/></svg>'
      : '<svg class="card-svg" viewBox="0 0 856 540" xmlns="http://www.w3.org/2000/svg"><rect width="856" height="540" rx="36" fill="#14161B"/></svg>';
  }
  const svg = wrap.firstElementChild;
  svg.setAttribute('aria-label', `Sanal kart: ${display_name}`);
  svg.dataset.o = portrait ? 'portrait' : 'landscape';
  X.applyBlend(svg);   // katı CSP satır içi style özniteliğini engeller: karışım kipi (folyo/holografik/doku) DOM üzerinden uygulanır
  // Devre dışı kart: tasarım ayrıntıları korunur (siyah katman yok); CSS yalnızca doygunluğu düşürür.
  if (status === 'disabled') svg.classList.add('disabled');
  if (opts.qrOpen && card_token) {
    const open = (e) => { const q = e.target.closest && e.target.closest('[data-qr-open]'); if (!q) return; e.preventDefault(); e.stopPropagation(); openQrModal(card_token, display_name); };
    svg.addEventListener('click', open);
    svg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  }
  return svg;
}
