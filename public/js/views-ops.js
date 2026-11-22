import { api } from './api.js';
import { h, mount, toast, money, dt, load, field, pwField, busy, empty, spinner, errorBox, icon, back } from './ui.js';
import { state, refreshMe, cur, initial } from './state.js';

const TYPE = {
  transfer_out: (t) => ({ ico: 'send', title: `Transfer gönderildi${t.counterparty ? ` • @${t.counterparty}` : ''}` }),
  transfer_in: (t) => ({ ico: 'receive', title: `Transfer alındı${t.counterparty ? ` • @${t.counterparty}` : ''}` }),
  topup: () => ({ ico: 'plus', title: 'Hediye kartı yüklemesi' }),
  purchase: () => ({ ico: 'cart', title: 'Oyun içi alışveriş' }),
  refund: () => ({ ico: 'undo', title: 'İade' }),
  reversal: () => ({ ico: 'undo', title: 'Düzeltme kaydı' }),
  adjustment: () => ({ ico: 'settings', title: 'Bakiye düzeltmesi' }),
  market_buy: () => ({ ico: 'market', title: 'Kristal alımı' }),
  market_sell: () => ({ ico: 'market', title: 'Kristal satışı' }),
};
const STATUS = { success: 'Başarılı', pending: 'Bekliyor', failed: 'Başarısız', cancelled: 'İptal edildi' };

export function txRow(t) {
  const m = (TYPE[t.type] || (() => ({ ico: 'info', title: t.type })))(t);
  const sign = t.amount > 0 ? '+' : '−';
  return h('li', { class: 'item' },
    h('div', { class: 'avatar', 'aria-hidden': 'true' }, icon(m.ico, 20)),
    h('div', { class: 'grow' },
      h('div', { class: 't', text: m.title }),
      h('div', { class: 'muted small', text: `${dt(t.created_at)} • ${STATUS[t.status] || t.status}` }),
      h('div', { class: 'muted small', text: `Ref: ${t.tx_ref}` })),
    h('div', { class: `strong ${t.amount > 0 ? 'pos' : 'neg'}`, text: `${sign}${money(Math.abs(t.amount), cur())}` }));
}

export function opsMenu(screen) {
  const link = (href, ico, title, sub) => h('a', { class: 'item', href },
    h('div', { class: 'avatar' }, icon(ico, 22)), h('div', { class: 'grow' }, h('div', { class: 't', text: title }), h('div', { class: 'muted small', text: sub })), icon('chevron', 18));
  mount(screen, h('h1', { text: 'İşlemler' }), h('div', { class: 'panel' }, h('ul', { class: 'list' },
    link('#/ops/send', 'send', 'Para gönder', 'Başka bir kullanıcıya sanal bakiye gönder'),
    link('#/market', 'market', 'Kristal Borsası', 'Kristal al/sat; bağımsız oyun piyasası'),
    link('#/pass', 'star', 'Nexus Pass', 'Süreli üyelikler; FN ile al, uygulamalarda kullan'),
    link('#/ops/history', 'history', 'İşlem geçmişi', 'Transfer, borsa, alışveriş, iade'),
    link('#/ops/gift', 'gift', 'Hediye kartı kullan', 'Kodunu gir, bakiyene yükle'),
    link('#/ops/moves', 'list', 'Bakiye hareketleri', 'Giriş/çıkışları filtrele'))),
    h('p', { class: 'virtual', text: 'Tüm bakiye ve işlemler sanal oyun ekonomisine aittir; gerçek para değildir.' }));
}

// İşlem listesi: filtre + "daha fazla" (anahtar tabanlı sayfalama)
export function txList(screen, { moves }) {
  const f = { kind: '', dir: '' };
  const list = h('ul', { class: 'list' });
  const more = h('div', { class: 'center' });
  const holder = h('div');
  let cursor = null;

  const seg = (items, key) => {
    const wrap = h('div', { class: 'seg', role: 'group' });
    for (const [v, label] of items) {
      const b = h('button', { type: 'button', 'aria-pressed': String(f[key] === v), text: label, onClick: () => { f[key] = v; for (const x of wrap.children) x.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', 'true'); reload(); } });
      wrap.append(b);
    }
    return wrap;
  };

  async function fetchPage(append) {
    const q = new URLSearchParams({ limit: '15' });
    if (f.kind) q.set('kind', f.kind); if (f.dir) q.set('dir', f.dir); if (append && cursor) q.set('cursor', cursor);
    const d = await api.get(`/api/transactions?${q}`);
    cursor = d.next_cursor;
    if (!append) list.replaceChildren();
    d.items.forEach((t) => list.append(txRow(t)));
    if (!list.children.length) mount(holder, empty('Kayıt yok', 'Bu filtre için işlem bulunamadı.'));
    else mount(holder, h('div', { class: 'panel' }, list));
    mount(more, cursor ? h('button', { class: 'btn', text: 'Daha fazla göster', onClick: (e) => busy(e.currentTarget, () => fetchPage(true).catch((er) => toast(er.message, 'error'))) }) : null);
  }
  async function reload() {
    mount(holder, spinner()); cursor = null;
    try { await fetchPage(false); } catch (e) { mount(holder, errorBox(e, reload)); }
  }
  mount(screen,
    back('#/ops', 'İşlemler'),
    h('h1', { text: moves ? 'Bakiye hareketleri' : 'İşlem geçmişi' }),
    seg([['', 'Tümü'], ['transfer', 'Transfer'], ['topup', 'Yükleme'], ['purchase', 'Alışveriş'], ['market', 'Borsa'], ['refund', 'İade/düzeltme']], 'kind'),
    moves ? seg([['', 'Hepsi'], ['in', 'Giriş'], ['out', 'Çıkış']], 'dir') : null,
    holder, more);
  reload();
}

// Para gönder: alıcı → tutar → onay → sonuç
export function sendFlow(screen) {
  const s = { step: 1, recipient: '', amountStr: '', key: null, result: null };
  const step = (n) => { s.step = n; draw(); };
  const c = state.me.config;
  let info = { recipients: [], daily_left: c.daily_limit, daily_limit: c.daily_limit };
  api.get('/api/transfers/recent').then((d) => { info = d; if (s.step === 1) drawRecipient(); else if (s.step === 2) drawAmount(); }).catch(() => {});

  function draw() {
    if (s.step === 1) return drawRecipient();
    if (s.step === 2) return drawAmount();
    if (s.step === 3) return drawConfirm();
    return drawDone();
  }
  const head = (t) => [back('#/ops', 'İşlemler'), h('h1', { text: t }), h('div', { class: 'pill-step' }, [1, 2, 3].map((i) => h('i', { class: i <= s.step ? 'on' : '' })))];

  function drawRecipient() {
    const inp = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: 'kullanici_adi', value: s.recipient, maxlength: '20' });
    const err = h('p', { class: 'err-text', role: 'alert' });
    const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Alıcıyı bul' });
    const recent = info.recipients.length ? h('div', {}, h('p', { class: 'muted small', text: 'Son gönderdiklerin' }), h('div', { class: 'chips' }, info.recipients.map((u) => h('button', { type: 'button', text: `@${u}`, onClick: () => { inp.value = u; form.requestSubmit(); } })))) : null;
    const form = h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      err.textContent = '';
      try {
        const r = await api.post('/api/transfers/lookup', { username: inp.value.trim() });
        if (r.is_self) { err.textContent = 'Kendinize transfer yapamazsınız.'; return; }
        s.recipient = r.username; step(2);
      } catch (ex) { err.textContent = ex.message; }
    }); } }, field('Alıcının hesap kullanıcı adı', inp, 'Kart üzerindeki isim değil, benzersiz kullanıcı adı girilir.'), err, btn);
    mount(screen, head('Para gönder'), recent, form);
    inp.focus();
  }

  function drawAmount() {
    const inp = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: s.amountStr });
    const err = h('p', { class: 'err-text', role: 'alert' });
    const form = h('form', { onSubmit: (e) => { e.preventDefault();
      const v = inp.value.trim().replace(',', '.');
      if (!/^\d{1,9}(\.\d{1,2})?$/.test(v) || Number(v) <= 0) { err.textContent = 'Geçerli bir tutar girin (en fazla 2 ondalık).'; return; }
      const minor = Math.round(Number(v) * 100);
      if (minor > c.max_transfer) { err.textContent = `İşlem başına en fazla ${money(c.max_transfer, cur())} gönderebilirsiniz.`; return; }
      if (minor > state.me.balance) { err.textContent = 'Yetersiz bakiye.'; return; }
      if (minor > info.daily_left) { err.textContent = `Bugün en fazla ${money(info.daily_left, cur())} daha gönderebilirsiniz.`; return; }
      s.amountStr = v; s.key = null; step(3);
    } },
      h('div', { class: 'panel row' }, h('div', { class: 'avatar', text: initial(s.recipient) }), h('div', { class: 'grow' }, h('div', { class: 'muted small', text: 'Alıcı' }), h('div', { class: 'strong', text: `@${s.recipient}` }))),
      field(`Tutar (${cur()})`, inp, `Kullanılabilir: ${money(state.me.balance, cur())} • Bugün kalan limit: ${money(info.daily_left, cur())}`),
      h('div', { class: 'chips' }, [['10', 1000], ['50', 5000], ['100', 10000], ['Maks', Math.min(state.me.balance, c.max_transfer, info.daily_left)]].map(([l, minor]) => h('button', { type: 'button', text: l === 'Maks' ? 'Maks' : `${l} FN`, onClick: () => { inp.value = (minor / 100).toFixed(2).replace('.', ','); } }))), err,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Geri', onClick: () => step(1) }), h('button', { class: 'btn primary grow', type: 'submit', text: 'Devam' })));
    mount(screen, head('Tutar'), form);
    inp.focus();
  }

  function drawConfirm() {
    const minor = Math.round(Number(s.amountStr) * 100);
    const needPw = minor >= c.reauth_threshold;
    const pw = needPw ? h('input', { type: 'password', autocomplete: 'current-password' }) : null;
    const err = h('p', { class: 'err-text', role: 'alert' });
    s.key ||= crypto.randomUUID(); // aynı onay ekranındaki tekrar denemeler AYNI anahtarı kullanır (çift transfer olmaz)
    const btn = h('button', { class: 'btn primary grow', type: 'button', text: 'Onayla ve gönder' });
    btn.addEventListener('click', () => busy(btn, async () => {
      err.textContent = '';
      try {
        const r = await api.post('/api/transfers', { recipient: s.recipient, amount: s.amountStr, idempotency_key: s.key, ...(pw ? { password: pw.value } : {}) });
        s.result = r; await refreshMe().catch(() => {}); step(4);
      } catch (ex) { err.textContent = ex.message; }
    }));
    mount(screen, head('Onay'),
      h('div', { class: 'notice warn' }, icon('alert', 18), 'Alıcıyı dikkatle kontrol edin. Gönderilen sanal bakiye geri alınamaz.'),
      h('div', { class: 'panel' }, h('dl', { class: 'kv' },
        h('dt', { text: 'Alıcı' }), h('dd', { class: 'strong', text: `@${s.recipient}` }),
        h('dt', { text: 'Tutar' }), h('dd', { class: 'strong', text: money(minor, cur()) }),
        h('dt', { text: 'Kalan bakiye' }), h('dd', { text: money(state.me.balance - minor, cur()) }))),
      pw ? pwField('Güvenlik için şifrenizi girin', pw) : null, err,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Geri', onClick: () => step(2) }), btn));
  }

  function drawDone() {
    mount(screen, h('div', { class: 'success' }, h('div', { class: 'big' }, icon('check', 32)), h('h1', { text: s.result.replayed ? 'Bu işlem zaten tamamlanmıştı' : 'Transfer tamamlandı' }),
      h('p', { class: 'muted', text: `${money(s.result.amount, cur())} → @${s.recipient}` }), h('p', { class: 'muted small', text: `Referans: ${s.result.ref}` })),
      h('a', { class: 'btn primary block', href: '#/home', text: 'Ana sayfa' }), h('div', { style: { height: '10px' } }), h('a', { class: 'btn block', href: '#/ops/history', text: 'İşlem geçmişi' }));
  }
  draw();
}

export function giftFlow(screen) {
  const holder = h('div');
  mount(screen, back('#/ops', 'İşlemler'), h('h1', { text: 'Hediye kartı kullan' }), holder);
  load(holder, () => api.get('/api/giftcard/status'), (st) => {
    if (!st.available) return h('div', { class: 'notice warn' }, icon('alert', 18), 'Hediye kartı hizmeti şu an bağlı değil. Lütfen daha sonra tekrar deneyin.');
    const inp = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'XXXX-XXXX', maxlength: '64' });
    const err = h('p', { class: 'err-text', role: 'alert' });
    const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Bakiyeye yükle' });
    const key = crypto.randomUUID();
    return h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      err.textContent = '';
      try {
        const r = await api.post('/api/giftcard/redeem', { code: inp.value, idempotency_key: key });
        await refreshMe().catch(() => {});
        mount(holder, h('div', { class: 'success' }, h('div', { class: 'big' }, icon('check', 32)), h('h2', { text: `${money(r.amount, cur())} yüklendi` }), h('p', { class: 'muted small', text: `Referans: ${r.ref}` })), h('a', { class: 'btn primary block', href: '#/home', text: 'Ana sayfa' }));
      } catch (ex) { err.textContent = ex.message; }
    }); } }, field('Hediye kodu', inp), err, btn);
  });
}
