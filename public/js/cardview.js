// Kartı çizer. Çizim kodu banka kart editörüyle AYNI dosyadır (card-render.js + card-rules.js); Nexus'ta bir kart editörde göründüğü gibi görünür.
// Marka, çip ve kart kimliği çizimde sistemden eklenir; kullanıcının tasarımında yer almaz. Bu dosya yalnızca görüntüler; doğrulama sunucudadır.
import './card-rules.js';
import './card-render.js';

const X = window.FNXRender;
let uid = 0;

export function renderCard(design, { display_name = '', card_token = '', status = 'active' } = {}) {
  const wrap = document.createElement('div');
  try {
    wrap.innerHTML = X.cardSvg(design, { last4: card_token ? card_token.slice(-4) : '••••' }, { prefix: `n${uid++}` });
  } catch { wrap.innerHTML = '<svg class="card-svg" viewBox="0 0 856 540" xmlns="http://www.w3.org/2000/svg"><rect width="856" height="540" rx="36" fill="#14161B"/></svg>'; }
  const svg = wrap.firstElementChild;
  svg.setAttribute('aria-label', `Sanal kart: ${display_name}`);
  // Katı CSP satır içi style özniteliğini engeller: karışım kipi (folyo/holografik yüzey) DOM üzerinden uygulanır.
  svg.querySelectorAll('[data-blend]').forEach((el) => { el.style.mixBlendMode = el.dataset.blend; });
  if (status === 'disabled') {
    svg.classList.add('disabled');
    svg.insertAdjacentHTML('beforeend', '<rect width="856" height="540" rx="36" fill="rgba(0,0,0,.55)"/><text x="428" y="290" fill="#fff" font-size="48" font-weight="700" text-anchor="middle" font-family="system-ui, sans-serif">DEVRE DIŞI</text>');
  }
  return svg;
}
