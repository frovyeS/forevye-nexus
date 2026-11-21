// Kristal borsası ekranı. Fiyat ve tutarlar SUNUCUDAN gelir; istemci yalnızca gösterir ve niyet (yön + miktar) gönderir.
import { api } from './api.js';
import { h, mount, toast, money, dt, load, field, busy, empty, icon } from './ui.js';
import { state, refreshMe, cur } from './state.js';

const NS = 'http://www.w3.org/2000/svg';
export const fnPrice = (micro) => `${(micro / 1e6).toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} FN`;
export const qtyFmt = (q) => (q / 1e4).toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const pct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}%${Math.abs(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const deltaEl = (v) => h('span', { class: `delta ${cls(v)}` }, v > 0 ? icon('up', 16) : v < 0 ? icon('down', 16) : null, pct(v));
const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

function sparkline(points) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 100'); svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Kristal fiyat grafiği');
  if (points.length < 2) return h('p', { class: 'muted small center', text: 'Grafik için henüz yeterli veri yok.' });
  const ys = points.map((p) => p[1]); const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const t0 = points[0][0], t1 = points[points.length - 1][0] || t0 + 1;
  const xy = points.map(([t, v]) => `${(((t - t0) / (t1 - t0 || 1)) * 300).toFixed(1)},${(92 - ((v - lo) / span) * 84).toFixed(1)}`);
  const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
  svg.append(mk('polygon', { class: 'area', points: `0,100 ${xy.join(' ')} 300,100` }), mk('polyline', { class: 'line', points: xy.join(' ') }));
  if (ys[ys.length - 1] < ys[0]) svg.classList.add('down');
  return svg;
}

export function marketView(screen) {
  const holder = h('div');
  let range = '1d', timer;
  mount(screen, h('div', { class: 'topbar' }, h('h1', { text: 'Kristal Borsası' })), holder);

  async function draw() {
    let m, hist;
    try { [m, hist] = await Promise.all([api.get('/api/market'), api.get(`/api/market/history?range=${range}`)]); }
    catch (e) { return mount(holder, h('div', { class: 'notice bad', role: 'alert' }, icon('alert', 18), e.message)); }
    if (!m.available) return mount(holder, h('div', { class: 'notice warn' }, icon('alert', 18), 'Borsa şu an fiyat alamıyor. Birkaç dakika sonra tekrar deneyin.'));

    const tabs = h('div', { class: 'seg', role: 'group', 'aria-label': 'Grafik aralığı' }, [['1d', '24 saat'], ['7d', '7 gün'], ['30d', '30 gün']].map(([v, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(range === v), text: l, onClick: () => { range = v; draw(); } })));
    const upd = Math.max(0, Math.round((Date.now() - m.updated_at) / 60000));
    const you = m.you;
    mount(holder,
      m.tradable ? null : h('div', { class: 'notice warn', role: 'alert' }, icon('alert', 18), 'Fiyat verisi güncel değil; işlemler geçici olarak durduruldu.'),
      h('div', { class: 'market-hero' },
        h('div', { class: 'row between' }, h('span', { class: 'row muted' }, icon('market', 18), 'Kristal / FN'), deltaEl(m.change_pct)),
        h('div', { class: 'price', text: fnPrice(m.price_micro) }),
        sparkline(hist.points), tabs,
        h('div', { class: 'stats' },
          h('div', {}, 'Alış', h('b', { text: fnPrice(m.buy_micro) })), h('div', {}, 'Satış', h('b', { text: fnPrice(m.sell_micro) })),
          h('div', {}, '24s aralık', h('b', { text: `${(m.low_micro / 1e6).toFixed(3)}–${(m.high_micro / 1e6).toFixed(3)}` }))),
        h('p', { class: 'muted small', style: { margin: '10px 0 0' }, text: `Kristal, gerçek altının hareketini izler; baz altın fiyatı = 1 FN. Güncel altın: ${m.gold_usd.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} $/ons • ${upd < 1 ? 'az önce' : `${upd} dk önce`} güncellendi.` })),
      h('div', { class: 'panel' }, h('h3', { text: 'Varlığın' }),
        h('dl', { class: 'kv', style: { marginTop: '8px' } },
          h('dt', { text: 'Kristal' }), h('dd', { class: 'strong', text: `${qtyFmt(you.qty)} KRS` }),
          h('dt', { text: 'Değer (satış fiyatıyla)' }), h('dd', { text: money(you.value_minor, cur()) }),
          h('dt', { text: 'Ortalama maliyet' }), h('dd', { text: you.qty ? fnPrice(you.avg_cost_micro) : '—' }),
          h('dt', { text: 'Kâr / zarar' }), h('dd', { class: `strong ${cls(you.pnl_minor)}`, text: you.qty ? `${you.pnl_minor > 0 ? '+' : you.pnl_minor < 0 ? '−' : ''}${money(Math.abs(you.pnl_minor), cur())}` : '—' }),
          h('dt', { text: 'FN bakiyen' }), h('dd', { text: money(m.balance, cur()) }))),
      tradePanel(m, draw),
      tradesPanel(),
      h('p', { class: 'virtual', text: 'Kristal borsası oyun içi bir simülasyondur; gerçek altın veya para alım satımı değildir. Fiyatlar yalnızca gerçek altın fiyatını örnek alır.' }));
  }

  draw();
  timer = setInterval(() => { if (!location.hash.startsWith('#/market')) return clearInterval(timer); if (!document.hidden && !holder.querySelector('input:focus')) draw(); }, 60000);
}

function tradePanel(m, redraw) {
  let side = 'buy', mode = 'amount';
  const box = h('div', { class: 'panel' });
  let key = null;
  const paint = () => {
    const price = side === 'buy' ? m.buy_micro : m.sell_micro;
    const inp = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: mode === 'amount' ? '0,00' : '0,0000' });
    const err = h('p', { class: 'err-text', role: 'alert' });
    const est = h('p', { class: 'muted small', style: { margin: '0 0 12px' } });
    const parse = () => {
      const v = inp.value.trim().replace(',', '.');
      if (!v) return null;
      if (mode === 'amount') { if (!/^\d{1,9}(\.\d{1,2})?$/.test(v) || Number(v) <= 0) return { bad: 'Geçerli bir FN tutarı girin (en fazla 2 ondalık).' }; const minor = Math.round(Number(v) * 100); return { body: { amount: v }, minor, qty: side === 'buy' ? Math.floor(minor * 1e8 / price) : Math.ceil(minor * 1e8 / price) }; }
      if (!/^\d{1,6}(\.\d{1,4})?$/.test(v) || Number(v) <= 0) return { bad: 'Geçerli bir kristal miktarı girin (en fazla 4 ondalık).' };
      const qty = Math.round(Number(v) * 1e4); const minor = side === 'buy' ? Math.ceil(qty * price / 1e8) : Math.floor(qty * price / 1e8); return { body: { qty: v }, minor, qty };
    };
    const refresh = () => { const p = parse(); err.textContent = ''; est.textContent = !p ? '' : p.bad ? p.bad : `≈ ${qtyFmt(p.qty)} KRS • ${money(p.minor, cur())} • birim fiyat ${fnPrice(price)}`; };
    inp.addEventListener('input', () => { key = null; refresh(); });
    const quick = h('div', { class: 'chips' }, (side === 'buy' ? [['25%', 0.25], ['50%', 0.5], ['Tümü', 1]] : [['25%', 0.25], ['50%', 0.5], ['Tümü', 1]]).map(([l, f]) => h('button', { type: 'button', text: l, onClick: () => {
      if (side === 'buy') { mode = 'amount'; const cap = Math.min(m.balance, m.max_trade_minor); paint(); const i = box.querySelector('input'); i.value = (Math.floor(cap * f) / 100).toFixed(2); i.dispatchEvent(new Event('input')); }
      else { mode = 'qty'; paint(); const i = box.querySelector('input'); const q = f === 1 ? m.you.qty : Math.floor(m.you.qty * f); i.value = (q / 1e4).toFixed(4); i.dispatchEvent(new Event('input')); }
    } })));
    const btn = h('button', { class: 'btn primary block', type: 'submit', text: side === 'buy' ? 'Kristal al' : 'Kristal sat', disabled: !m.tradable });
    const form = h('form', { onSubmit: (e) => { e.preventDefault(); const p = parse(); if (!p) { err.textContent = 'Bir değer girin.'; return; } if (p.bad) { err.textContent = p.bad; return; }
      if (p.minor > m.max_trade_minor) { err.textContent = `İşlem başına en fazla ${money(m.max_trade_minor, cur())} değerinde işlem yapabilirsiniz.`; return; }
      if (side === 'buy' && p.minor > m.balance) { err.textContent = 'Yetersiz FN bakiyesi.'; return; }
      if (side === 'sell' && p.qty > m.you.qty) { err.textContent = 'Yeterli kristalin yok.'; return; }
      if (!confirm(`${side === 'buy' ? 'Alınacak' : 'Satılacak'}: ≈ ${qtyFmt(p.qty)} KRS\n${side === 'buy' ? 'Ödenecek' : 'Alınacak'}: ≈ ${money(p.minor, cur())}\nBirim fiyat: ${fnPrice(price)}\n\nOnaylıyor musun?`)) return;
      key ||= crypto.randomUUID();
      busy(btn, async () => {
        try {
          const r = await api.post('/api/market/trade', { side, ...p.body, expected_price_micro: price, idempotency_key: key });
          key = null; await refreshMe().catch(() => {});
          toast(`${side === 'buy' ? 'Alındı' : 'Satıldı'}: ${qtyFmt(r.qty)} KRS • ${money(r.total, cur())}`, 'ok'); redraw();
        } catch (ex) { err.textContent = ex.message; if (ex.code === 'price_moved') { key = null; redraw(); } }
      }); } },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Giriş türü' }, [['amount', 'FN tutarı'], ['qty', 'Kristal miktarı']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(mode === v), text: l, onClick: () => { mode = v; key = null; paint(); } }))),
      field(mode === 'amount' ? `Tutar (${cur()})` : 'Miktar (KRS)', inp, side === 'buy' ? `Kullanılabilir: ${money(m.balance, cur())}` : `Elindeki: ${qtyFmt(m.you.qty)} KRS`), quick, est, err, btn);
    mount(box, h('div', { class: 'sidetabs', role: 'tablist' },
      h('button', { class: 'buy', role: 'tab', type: 'button', 'aria-selected': String(side === 'buy'), text: 'Al', onClick: () => { side = 'buy'; key = null; paint(); } }),
      h('button', { class: 'sell', role: 'tab', type: 'button', 'aria-selected': String(side === 'sell'), text: 'Sat', onClick: () => { side = 'sell'; key = null; paint(); } })), form);
  };
  paint();
  return box;
}

function tradesPanel() {
  const holder = h('div');
  const box = h('div', { class: 'panel' }, h('h3', { text: 'Borsa işlemlerin' }), holder);
  load(holder, () => api.get('/api/market/trades?limit=8'), (d) => d.items.length ? h('ul', { class: 'list' }, d.items.map((t) => h('li', { class: 'item' },
    h('div', { class: 'avatar', 'aria-hidden': 'true' }, icon(t.side === 'buy' ? 'plus' : 'minus', 20)),
    h('div', { class: 'grow' }, h('div', { class: 't', text: `${t.side === 'buy' ? 'Alış' : 'Satış'} • ${qtyFmt(t.qty)} KRS` }), h('div', { class: 'muted small', text: `${dt(t.created_at)} • ${fnPrice(t.price_micro)}` })),
    h('div', { class: `strong ${t.side === 'buy' ? 'neg' : 'pos'}`, text: `${t.side === 'buy' ? '−' : '+'}${money(t.total, cur())}` })))) : empty('Henüz borsa işlemin yok', 'İlk kristalini yukarıdan alabilirsin.'));
  return box;
}

// Ana sayfa için küçük özet kartı
export function marketMini() {
  const box = h('a', { class: 'panel mini-market', href: '#/market', style: { textDecoration: 'none' } }, h('div', { class: 'gem', 'aria-hidden': 'true' }, icon('market', 22)), h('div', { class: 'grow' }, h('div', { class: 'muted small', text: 'Kristal Borsası' }), h('div', { class: 'strong', text: 'Yükleniyor…' })));
  api.get('/api/market').then((m) => {
    if (!m.available) { box.querySelector('.strong').textContent = 'Fiyat alınamıyor'; return; }
    const kids = [h('div', { class: 'muted small', text: 'Kristal Borsası' }), h('div', { class: 'strong', text: fnPrice(m.price_micro) })];
    if (m.you.qty) kids.push(h('div', { class: 'muted small', text: `${qtyFmt(m.you.qty)} KRS • ${money(m.you.value_minor, cur())}` }));
    box.querySelector('.grow').replaceChildren(...kids);
    box.append(deltaEl(m.change_pct));
  }).catch(() => { box.querySelector('.strong').textContent = 'Bağlantı yok'; });
  return box;
}
