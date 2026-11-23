import { api } from './api.js';
import { h, mount, toast, dt, load, field, busy, empty, icon, back, money } from './ui.js';
import { state, refreshMe, cur } from './state.js';
import { renderCard } from './cardview.js';
import { skinPanel } from './views-shop.js';
import { validateLabel, LABEL_MAX } from './card-contract.js';

// Kart tasarımı banka kart editöründe (ayrı site) yapılır. Burada: sunucudan tek kullanımlık bilet alınır, tarayıcı editöre gider.
// Editörde "Kaydet" doğrudan bu sunucuya yazar; çıkınca kullanıcı buraya (#/cards/<id>) döner.
export async function openEditor(cardId, label) {
  const r = await api.post('/api/editor/ticket', cardId ? { card_id: cardId } : { label: label || '' });
  location.href = r.url;
}

export function cardsList(screen) {
  const holder = h('div');
  mount(screen, h('div', { class: 'topbar' }, h('h1', { text: 'Kartlarım' }), h('div', { class: 'row wrap' }, h('a', { class: 'btn small', href: '#/scan' }, icon('qrcode', 18), 'QR okut'), h('a', { class: 'btn small', href: '#/cards/pay' }, icon('send', 18), 'Kartla ödeme'), h('a', { class: 'btn small primary', href: '#/cards/new' }, icon('plus', 18), 'Yeni kart'))), holder,
    h('p', { class: 'virtual', text: 'Bunlar yalnızca oyun içi sanal kartlardır; gerçek ödeme kartı değildir.' }));
  load(holder, () => api.get('/api/cards'), (d) => {
    if (!d.cards.length) return empty('Henüz kartın yok', 'İlk sanal kartını oluştur.');
    return h('div', { class: 'cards-grid' }, d.cards.map((c) => h('a', { class: 'card-tile', href: `#/cards/${c.id}`, style: { textDecoration: 'none', color: 'inherit' } },
      renderCard(c.design, c),
      h('div', { class: 'row between', style: { padding: '8px 4px 0' } }, h('span', { class: 'strong', text: c.label || c.display_name }),
        h('span', {}, c.is_default ? h('span', { class: 'chip ok', text: 'Varsayılan' }) : null, ' ', c.status === 'disabled' ? h('span', { class: 'chip bad', text: 'Devre dışı' }) : null)),
      h('div', { class: 'muted small', style: { padding: '2px 4px 4px' }, text: `Kart bakiyesi: ${money(c.balance || 0, cur())}` }))));
  });
}

// Yeni kart: isteğe bağlı özel ad sorulur, kart ilk kayıtta editörden oluşur (terk edilirse boş kart kalmaz).
export function cardNew(screen) {
  const label = h('input', { type: 'text', maxlength: String(LABEL_MAX), placeholder: 'Örn. Oyun harcamaları' });
  const err = h('p', { class: 'err-text', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Kart editörünü aç' });
  mount(screen, back('#/cards', 'Kartlarım'), h('h1', { text: 'Yeni kart' }),
    h('div', { class: 'panel' }, h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      err.textContent = '';
      const v = validateLabel(label.value); if (!v.ok) { err.textContent = v.error; return; }
      try { await openEditor(null, v.value); } catch (ex) { err.textContent = ex.message; }
    }); } }, field('Kartıma özel ad (isteğe bağlı, yalnızca sana görünür)', label), err, btn),
    h('p', { class: 'muted small', text: 'Tasarım, kart editöründe yapılır. Kaydettiğinde kart buraya eklenir.' })));
}

// Banka editöründen "giriş gerekli" ile gelen kullanıcı buraya düşer: (gerekirse FOREVYE ID ile giriş yaptıktan sonra) bilet alınır ve editöre dönülür.
export async function editorLaunch(screen, arg) {
  const box = h('div', { class: 'panel center' }, h('p', { class: 'muted', text: 'Kart editörü açılıyor…' }));
  mount(screen, box);
  try { await openEditor(arg && arg !== 'new' ? arg : null, ''); }
  catch (e) { mount(box, h('p', { class: 'err-text', role: 'alert', text: e.message }), h('a', { class: 'btn', href: '#/cards', text: 'Kartlarıma dön' })); }
}

export async function cardDetail(screen, id) {
  const holder = h('div');
  mount(screen, back('#/cards', 'Kartlarım'), holder);
  await load(holder, () => api.get(`/api/cards/${id}`), (card) => buildDetail(card));
}

function buildDetail(card) {
  const labelIn = h('input', { type: 'text', maxlength: String(LABEL_MAX), value: card.label, placeholder: 'Örn. Oyun harcamaları' });
  const lerr = h('p', { class: 'err-text', role: 'alert' });
  const lbtn = h('button', { class: 'btn small', type: 'submit', text: 'Özel adı kaydet' });
  const designBtn = h('button', { class: 'btn primary block', type: 'button', onClick: (e) => busy(e.currentTarget, async () => { try { await openEditor(card.id); } catch (ex) { toast(ex.message, 'error'); } }) }, icon('edit', 18), 'Kartını tasarla');

  const manage = h('div', { class: 'panel' }, h('h3', { text: 'Kart yönetimi' }), h('p', { class: 'muted small', text: 'Kart numarası/kimliği sistem tarafından atanır ve değiştirilemez.' }),
    h('div', { class: 'row wrap' },
      !card.is_default && card.status === 'active' ? h('button', { class: 'btn small', type: 'button', text: 'Varsayılan yap', onClick: async () => { try { await api.post(`/api/cards/${card.id}/default`); await refreshMe(); toast('Varsayılan kart güncellendi', 'ok'); location.reload(); } catch (e) { toast(e.message, 'error'); } } }) : null,
      h('button', { class: `btn small ${card.status === 'active' ? 'danger' : ''}`, type: 'button', text: card.status === 'active' ? 'Geçici olarak devre dışı bırak' : 'Yeniden etkinleştir', onClick: async () => { try { await api.post(`/api/cards/${card.id}/status`, { status: card.status === 'active' ? 'disabled' : 'active' }); location.reload(); } catch (e) { toast(e.message, 'error'); } } }),
      h('a', { class: 'btn small primary', href: '#/cards/pay' }, icon('send', 16), 'Kartla ödeme')));

  const hist = h('div', { class: 'panel' }, h('h3', { text: 'Tasarım geçmişi' }));
  const body = h('div'); hist.append(body);
  load(body, () => api.get(`/api/cards/${card.id}/history`), (r) => h('ul', { class: 'list' }, r.versions.map((v) => h('li', { class: 'item' },
    h('div', { style: { width: '96px', flex: 'none' } }, renderCard(v.design, { display_name: v.display_name, card_token: card.card_token })),
    h('div', { class: 'grow' }, h('div', { class: 't', text: `Sürüm ${v.version}` }), h('div', { class: 'muted small', text: dt(v.created_at) })),
    v.version === card.version ? h('span', { class: 'chip', text: 'Güncel' }) : h('button', { class: 'btn small', type: 'button', text: 'Geri dön', onClick: async (e) => busy(e.currentTarget, async () => { try { await api.post(`/api/cards/${card.id}/revert`, { version: v.version }); toast('Önceki tasarıma dönüldü', 'ok'); location.reload(); } catch (er) { toast(er.message, 'error'); } }) })))));

  const fundAmount = h('input', { type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', placeholder: 'Örn. 250.00', required: true });
  const fundErr = h('p', { class: 'err-text', role: 'alert' });
  const fundKeys = { load: null, withdraw: null };
  const changeFund = () => { fundKeys.load = null; fundKeys.withdraw = null; };
  fundAmount.addEventListener('input', changeFund);
  async function moveCardMoney(direction, btn) {
    fundErr.textContent = '';
    const val = fundAmount.value.trim();
    if (!val || !Number.isFinite(Number(val)) || Number(val) <= 0) { fundErr.textContent = 'Sıfırdan büyük geçerli bir tutar girin.'; return; }
    if (!fundKeys[direction]) fundKeys[direction] = crypto.randomUUID();
    try {
      await api.post(`/api/cards/${card.id}/fund`, { amount: val, direction, idempotency_key: fundKeys[direction] });
      fundKeys[direction] = null;
      await refreshMe();
      toast(direction === 'load' ? 'Para karta aktarıldı' : 'Kart bakiyesi cüzdana aktarıldı', 'ok');
      location.reload();
    } catch (e) { fundErr.textContent = e.message; }
  }
  const moneyPanel = h('div', { class: 'panel' }, h('h3', { text: 'Kart bakiyesi' }),
    h('div', { class: 'row between' }, h('span', { class: 'muted', text: 'Bu kartta kullanılabilir' }), h('strong', { class: 'amount', text: money(card.balance || 0, cur()) })),
    h('p', { class: 'muted small', text: `Ana cüzdan bakiyesi: ${money(state.me.balance || 0, cur())}. Yükleme cüzdandan karta aktarılır; nakit/gerçek para yüklemesi değildir.` }),
    field('Tutar (FN)', fundAmount), fundErr,
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', type: 'button', onClick: (e) => busy(e.currentTarget, () => moveCardMoney('load', e.currentTarget)) }, icon('arrow-down', 18), 'Karta para yükle'),
      h('button', { class: 'btn', type: 'button', onClick: (e) => busy(e.currentTarget, () => moveCardMoney('withdraw', e.currentTarget)) }, icon('arrow-up', 18), 'Cüzdana geri aktar')));

  const cardActivity = h('div', { class: 'panel' }, h('h3', { text: 'Kart hareketleri' }));
  const cardActivityBody = h('div', { class: 'muted small', text: 'Hareketler yükleniyor…' }); cardActivity.append(cardActivityBody);
  api.get(`/api/cards/${card.id}/transactions`).then((d) => {
    if (!d.items.length) return mount(cardActivityBody, h('p', { class: 'muted small', text: 'Bu kartta henüz işlem yok.' }));
    mount(cardActivityBody, h('ul', { class: 'list' }, d.items.map((t) => h('li', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't', text: t.description || (t.type === 'payment' ? 'Kartla ödeme' : t.type === 'fund_in' ? 'Karta yükleme' : 'Cüzdana aktarım') }),
        h('div', { class: 'muted small', text: `${dt(t.created_at)} • ${t.counterparty ? '@' + t.counterparty : t.tx_ref}` })),
      h('strong', { class: t.amount >= 0 ? 'pos' : 'neg', text: `${t.amount >= 0 ? '+' : '−'}${money(Math.abs(t.amount), cur())}` })))));
  }).catch((e) => mount(cardActivityBody, h('p', { class: 'muted small', text: e.message || 'Kart hareketleri yüklenemedi.' })));

  const cardCode = h('div', { class: 'panel' }, h('h3', { text: 'Sanal kart kodu' }),
    h('p', { class: 'strong', text: card.card_token }),
    h('p', { class: 'muted small', text: 'Bu kod yalnızca Forevye Nexus oyun içi kart kimliğidir; gerçek banka kartı numarası değildir.' }),
    h('button', { class: 'btn small', type: 'button', onClick: async () => { try { await navigator.clipboard.writeText(`FOREVYE NEXUS • ${card.display_name}\nKart kodu: ${card.card_token}`); toast('Kart bilgileri kopyalandı', 'ok'); } catch { toast('Kopyalama izni verilemedi', 'error'); } } }, icon('copy', 18), 'Kart bilgilerini kopyala'));
  return h('div', {}, h('h1', { text: card.label || card.display_name }), renderCard(card.design, card),
    moneyPanel, cardActivity,
    h('div', { style: { margin: '14px 0' } }, designBtn),
    cardCode,
    skinPanel(card),
    h('div', { class: 'panel' }, h('form', { onSubmit: (e) => { e.preventDefault(); busy(lbtn, async () => {
      lerr.textContent = '';
      const v = validateLabel(labelIn.value); if (!v.ok) { lerr.textContent = v.error; return; }
      try { await api.patch(`/api/cards/${card.id}`, { label: v.value }); toast('Kaydedildi', 'ok'); } catch (ex) { lerr.textContent = ex.message; }
    }); } }, field('Kartıma özel ad (yalnızca sana görünür)', labelIn), lerr, lbtn),
    h('p', { class: 'muted small', text: `Kartta görünen isim: ${card.display_name}. Tasarımı ve kart üstündeki ismi kart editöründe değiştirirsin.` })),
    manage, hist,
    h('p', { class: 'virtual', text: 'Çip, marka ve kart kimliği sistem tarafından çizilir; tasarımda silinemez veya taşınamaz.' }));
}


export async function cardPayView(screen) {
  const holder = h('div');
  mount(screen, back('#/cards', 'Kartlarım'), h('h1', { text: 'Kartla ödeme' }),
    h('p', { class: 'muted', text: 'Ödemeyi hangi karttan göndereceğini seç. Tutar seçilen kartın bakiyesinden düşer; alıcıya aynı işlemde FN olarak geçer.' }), holder);
  await load(holder, () => api.get('/api/cards'), (d) => {
    const cards = d.cards.filter((c) => c.status === 'active');
    if (!cards.length) return empty('Aktif kart yok', 'Ödeme yapmadan önce bir sanal kart oluşturup etkinleştir.');
    const cardSelect = h('select', { required: true }, cards.map((c) => h('option', { value: c.id, text: `${c.label || c.display_name} · ${money(c.balance || 0, cur())}` })));
    const selectedBalance = h('p', { class: 'muted small', text: `Kullanılabilir kart bakiyesi: ${money(cards[0].balance || 0, cur())}` });
    cardSelect.addEventListener('change', () => { const c = cards.find((x) => x.id === cardSelect.value); selectedBalance.textContent = `Kullanılabilir kart bakiyesi: ${money(c ? c.balance : 0, cur())}`; });
    const recipient = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', maxlength: '20', placeholder: 'Örn. forevye_user', required: true });
    const amount = h('input', { type: 'number', inputmode: 'decimal', min: '0.01', step: '0.01', placeholder: 'Örn. 125.00', required: true });
    const description = h('input', { type: 'text', maxlength: '80', value: 'Kartla ödeme', placeholder: 'Ödeme açıklaması' });
    const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Yüksek tutarlı ödemeler için şifre' });
    const err = h('p', { class: 'err-text', role: 'alert' });
    const submit = h('button', { class: 'btn primary block', type: 'submit', text: 'Ödemeyi gönder' });
    let idem = null;
    [recipient, amount, description, password, cardSelect].forEach((el) => el.addEventListener('input', () => { idem = null; }));
    const form = h('form', { onSubmit: (e) => { e.preventDefault(); busy(submit, async () => {
      err.textContent = '';
      if (!/^[A-Za-z0-9_.]{3,20}$/.test(recipient.value.trim())) { err.textContent = 'Geçerli bir alıcı kullanıcı adı gir.'; return; }
      if (!amount.value || Number(amount.value) <= 0) { err.textContent = 'Geçerli bir ödeme tutarı gir.'; return; }
      const card = cards.find((c) => c.id === cardSelect.value);
      if (!card) { err.textContent = 'Ödeme kartını seç.'; return; }
      if (!idem) idem = crypto.randomUUID(); // ağ hatasında aynı işlem anahtarı korunur
      try {
        const r = await api.post(`/api/cards/${card.id}/pay`, { recipient: recipient.value.trim(), amount: amount.value.trim(), description: description.value.trim() || 'Kartla ödeme', idempotency_key: idem, ...(password.value ? { password: password.value } : {}) });
        idem = null;
        toast(`${r.recipient} kullanıcısına ${money(r.amount, cur())} gönderildi`, 'ok');
        location.hash = `#/cards/${card.id}`;
      } catch (ex) { err.textContent = ex.message; }
    }); } }, field('Ödeme kartı', cardSelect), selectedBalance, field('Alıcı kullanıcı adı', recipient), field('Tutar (FN)', amount), field('Açıklama', description), field('Şifre (yüksek tutarlı ödemelerde gerekli)', password), err, submit);
    return h('div', { class: 'panel' }, form,
      h('p', { class: 'muted small', text: 'Kart bakiyesi yetmezse ödeme reddedilir; ana cüzdanından otomatik para çekilmez. Önce kart detayından karta para yükleyebilirsin.' }));
  });
}

export function scanView(screen) {
  const video = h('video', { class: 'qr-video', autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  const status = h('p', { class: 'muted small', text: 'Kamerayı açıp bir Forevye Nexus kart QR kodunu kadraja getir.' });
  const result = h('div');
  const token = h('input', { type: 'text', placeholder: 'NXC-XXXX-XXXX', autocomplete: 'off', autocapitalize: 'characters', maxlength: '13' });
  const manualErr = h('p', { class: 'err-text', role: 'alert' });
  const cameraBtn = h('button', { class: 'btn primary', type: 'button', text: 'Kamerayı aç' });
  let stream = null, frame = 0, detector = null, busyScan = false;
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; busyScan = false; video.srcObject = null; cameraBtn.disabled = false; cameraBtn.textContent = 'Kamerayı aç';
  };
  const showCard = async (raw) => {
    const match = /^FNX1\|(NXC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})$/i.exec(String(raw || '').trim());
    const code = match ? match[1].toUpperCase() : String(raw || '').trim().toUpperCase();
    if (!/^NXC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code)) { manualErr.textContent = 'Geçerli bir Forevye Nexus QR kodu veya kart kodu okutun.'; return false; }
    stop(); manualErr.textContent = ''; status.textContent = 'Kart bilgileri doğrulanıyor…';
    try {
      const d = await api.get(`/api/cards/resolve?token=${encodeURIComponent(code)}`);
      const copyText = `FOREVYE NEXUS • SANAL KART\nKart sahibi: @${d.username}\nKartta görünen isim: ${d.display_name}\nKart kodu: ${d.card_token}`;
      mount(result, h('div', { class: 'panel' }, h('h3', { text: 'Kart bulundu' }),
        h('p', { class: 'strong', text: d.display_name }), h('p', { class: 'muted', text: `@${d.username}` }),
        h('p', { class: 'strong', text: d.card_token }),
        h('button', { class: 'btn primary block', type: 'button', onClick: async () => { try { await navigator.clipboard.writeText(copyText); toast('Kart bilgileri kopyalandı', 'ok'); } catch { toast('Kopyalama izni verilemedi', 'error'); } } }, icon('copy', 18), 'Kart bilgilerini kopyala')));
      status.textContent = 'Kart bilgileri hazır. Kopyalayabilir veya başka bir QR okutabilirsin.';
    } catch (e) { status.textContent = e.message; }
    return true;
  };
  const scanFrame = async () => {
    if (!stream || busyScan) return;
    if (video.readyState >= 2) {
      busyScan = true;
      try {
        const codes = await detector.detect(video);
        if (codes.length && await showCard(codes[0].rawValue)) return;
      } catch { /* sonraki karede tekrar dene */ }
      busyScan = false;
    }
    frame = requestAnimationFrame(scanFrame);
  };
  cameraBtn.addEventListener('click', async () => {
    manualErr.textContent = '';
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Bu tarayıcı QR kamerayı desteklemiyor. Aşağıya kart kodunu elle girerek devam edebilirsin.';
      return;
    }
    try {
      detector = new BarcodeDetector({ formats: ['qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream; await video.play();
      cameraBtn.disabled = true; cameraBtn.textContent = 'Kamera açık';
      status.textContent = 'QR kod aranıyor…'; scanFrame();
    } catch (e) { stop(); status.textContent = 'Kamera açılamadı. Tarayıcı kamera iznini kontrol et veya kart kodunu elle gir.'; }
  });
  const manualBtn = h('button', { class: 'btn', type: 'button', text: 'Kart kodunu doğrula', onClick: () => showCard(token.value) });
  mount(screen, back('#/cards', 'Kartlarım'), h('h1', { text: 'Kart QR okuyucu' }),
    h('div', { class: 'panel' }, video, cameraBtn, status, h('button', { class: 'btn small', type: 'button', text: 'Kamerayı durdur', onClick: stop })),
    h('div', { class: 'panel' }, h('h3', { text: 'Elle kart kodu gir' }), field('Kart kodu', token), manualErr, manualBtn), result,
    h('p', { class: 'virtual', text: 'QR yalnızca sanal kart kimliğini taşır. Gerçek banka kartı, ödeme veya gizli güvenlik bilgisi içermez.' }));
  window.addEventListener('pagehide', stop, { once: true });
  window.addEventListener('hashchange', stop, { once: true });
}

export function vaultView(screen) {
  const holder = h('div');
  mount(screen, back('#/profile', 'Profil'), h('h1', { text: 'Nexus Vault' }), holder);
  load(holder, () => api.get('/api/vault'), (v) => h('div', {},
    h('div', { class: 'panel' }, h('h3', { text: 'Rozetler (Nexus Achievements)' }), h('ul', { class: 'list' }, v.badges.map((b) => h('li', { class: 'item' },
      h('div', { class: 'avatar' }, icon('star', 20, b.earned_at ? 'fill' : '')), h('div', { class: 'grow' }, h('div', { class: 't', text: b.title }), h('div', { class: 'muted small', text: b.earned_at ? `Kazanıldı: ${dt(b.earned_at)}` : b.desc })))))),
    h('div', { class: 'panel' }, h('h3', { text: 'Kart temaları (Nexus Collection)' }), v.themes.length ? h('div', { class: 'cards-grid' }, v.themes.map((t) => h('div', {}, renderCard(t.design, { display_name: t.name }), h('div', { class: 'muted small', text: t.limited_until ? `Sınırlı süre: ${dt(t.limited_until)}` : 'Kalıcı tema' })))) : empty('Şu an tema yok')),
    h('div', { class: 'panel' }, h('h3', { text: 'Kayıtlı tasarımlar' }), v.saved_designs.length ? h('div', { class: 'cards-grid' }, v.saved_designs.map((s) => h('a', { href: `#/cards/${s.card_id}`, style: { textDecoration: 'none', color: 'inherit' } }, renderCard(s.design, { display_name: s.display_name }), h('div', { class: 'muted small', text: `Sürüm ${s.version} • ${dt(s.created_at)}` })))) : empty('Kayıtlı tasarım yok'))));
}
