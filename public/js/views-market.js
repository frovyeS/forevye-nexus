// Kristal borsası ekranı. Fiyat ve tutarlar SUNUCUDAN gelir; istemci yalnızca gösterir ve niyet (yön + miktar) gönderir.
import { api } from './api.js';
import { h, mount, toast, money, dt, load, busy, empty, icon } from './ui.js';
import { refreshMe, cur } from './state.js';

const NS = 'http://www.w3.org/2000/svg';
export const fnPrice = (micro) => `${(micro / 1e6).toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} FN`;
const fnPriceExact = (micro) => `${(micro / 1e6).toLocaleString('tr-TR', { minimumFractionDigits: 6, maximumFractionDigits: 6 })} FN`;
export const qtyFmt = (q) => (q / 1e4).toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const pct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const deltaEl = (v) => h('span', { class: `delta ${cls(v)}` }, v > 0 ? icon('up', 16) : v < 0 ? icon('down', 16) : null, pct(v));
const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

function sparkline(points) {
  if (points.length < 2) return h('p', { class: 'muted small center', text: 'Grafik için henüz yeterli veri yok.' });
  const width = 640, height = 220, left = 14, right = width - 14, top = 12, bottom = height - 14;
  const values = points.map((p) => Number(p[1]));
  const low = Math.min(...values), high = Math.max(...values), span = high - low || Math.max(1, high * 0.0001);
  const firstTs = Number(points[0][0]), lastTs = Number(points[points.length - 1][0]) || firstTs + 1;
  const xy = points.map(([ts, value]) => {
    const x = left + ((Number(ts) - firstTs) / (lastTs - firstTs || 1)) * (right - left);
    const y = bottom - ((Number(value) - low) / span) * (bottom - top);
    return { x, y, ts: Number(ts), value: Number(value) };
  });
  const mk = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'chart interactive-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Kristal fiyat grafiği. Kesin fiyat, saat ve değişim için grafiğin üzerinde gezinin.');
  const coords = xy.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const defs = mk('defs', {});
  const grad = mk('linearGradient', { id: 'chartFill', x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(mk('stop', { offset: '0%', class: 'g-top' }), mk('stop', { offset: '100%', class: 'g-bot' }));
  defs.append(grad);
  svg.append(defs);
  for (let i = 0; i < 4; i += 1) { const gy = top + ((bottom - top) * i) / 3; svg.append(mk('line', { class: 'chart-grid', x1: left, x2: right, y1: gy, y2: gy })); }
  svg.append(
    mk('polygon', { class: 'area', points: `${left},${bottom + 6} ${coords} ${right},${bottom + 6}` }),
    mk('polyline', { class: 'line', points: coords }),
  );
  if (values[values.length - 1] < values[0]) svg.classList.add('down');
  const vertical = mk('line', { class: 'chart-crosshair', x1: left, x2: left, y1: top, y2: bottom, visibility: 'hidden' });
  const horizontal = mk('line', { class: 'chart-crosshair', x1: left, x2: right, y1: top, y2: top, visibility: 'hidden' });
  const marker = h('div', { class: 'chart-dot', hidden: true });
  svg.append(vertical, horizontal);
  const tooltip = h('div', { class: 'chart-tooltip', hidden: true, role: 'status', 'aria-live': 'polite' });
  const hiLabel = h('span', { class: 'chart-axis hi', text: fnPriceExact(high) }), loLabel = h('span', { class: 'chart-axis lo', text: fnPriceExact(low) });
  const wrap = h('div', { class: 'chart-wrap' }, svg, hiLabel, loLabel, marker, tooltip);
  const hide = () => {
    vertical.setAttribute('visibility', 'hidden');
    horizontal.setAttribute('visibility', 'hidden');
    marker.hidden = true;
    tooltip.hidden = true;
  };
  svg.addEventListener('pointermove', (event) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const targetX = Math.max(left, Math.min(right, ((event.clientX - rect.left) / rect.width) * width));
    let nearest = 0, distance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < xy.length; i += 1) {
      const d = Math.abs(xy[i].x - targetX);
      if (d < distance) { nearest = i; distance = d; }
    }
    const point = xy[nearest];
    vertical.setAttribute('x1', point.x); vertical.setAttribute('x2', point.x); vertical.setAttribute('visibility', 'visible');
    horizontal.setAttribute('y1', point.y); horizontal.setAttribute('y2', point.y); horizontal.setAttribute('visibility', 'visible');
    marker.hidden = false; marker.style.left = `${(point.x / width) * wrap.clientWidth}px`; marker.style.top = `${(point.y / height) * svg.clientHeight}px`;
    const change = values[0] ? ((point.value - values[0]) / values[0]) * 100 : 0;
    tooltip.replaceChildren(
      h('strong', { text: fnPriceExact(point.value) }),
      h('span', { text: new Date(point.ts).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'medium' }) }),
      h('span', { class: change > 0 ? 'pos' : change < 0 ? 'neg' : '', text: `Dönem başına göre ${pct(change)}` }),
    );
    tooltip.hidden = false;
    const localX = (point.x / width) * wrap.clientWidth;
    const localY = (point.y / height) * svg.clientHeight;
    tooltip.style.left = `${Math.max(8, Math.min(wrap.clientWidth - 184, localX + 12))}px`;
    tooltip.style.top = `${Math.max(4, Math.min(svg.clientHeight - 82, localY - 72))}px`;
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointercancel', hide);
  return wrap;
}

export function marketView(screen) {
  const holder = h('div');
  let range = '1d', timer;
  // Bankadaki Kristal cüzdanından gelen kullanıcı için dönüş: tek kullanımlık banka bileti + r=wallet (banka cüzdan sekmesinde açılır).
  const toBankWallet = h('a', { class: 'back', href: '#', onClick: async (e) => {
    e.preventDefault();
    try { const r = await api.post('/api/bank/ticket'); location.href = r.url + (r.url.includes('#') ? '&' : '#') + 'r=wallet'; } catch (err) { toast(err.message, 'error'); }
  } }, icon('back', 18), 'Kristal cüzdanı (Sanal Banka)');
  mount(screen, toBankWallet, h('div', { class: 'topbar' }, h('h1', { text: 'Kristal Borsası' })), holder);

  async function draw() {
    let m, hist, cardData;
    try { [m, hist, cardData] = await Promise.all([api.get('/api/market'), api.get(`/api/market/history?range=${range}`), api.get('/api/cards').catch(() => ({ cards: [] }))]); }
    catch (e) { return mount(holder, h('div', { class: 'notice bad', role: 'alert' }, icon('alert', 18), e.message)); }
    if (!m.available) return mount(holder, h('div', { class: 'notice warn' }, icon('alert', 18), 'Borsa şu an fiyat alamıyor. Birkaç dakika sonra tekrar deneyin.'));

    const tabs = h('div', { class: 'seg', role: 'group', 'aria-label': 'Grafik aralığı' }, [['1d', '24 saat'], ['7d', '7 gün'], ['30d', '30 gün']].map(([v, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(range === v), text: l, onClick: () => { range = v; draw(); } })));
    const upd = Math.max(0, Math.round((Date.now() - m.updated_at) / 60000));
    const you = m.you;
    const flow = m.flow_stats || { hour: {}, day: {} };
    const hour = flow.hour || {}, day = flow.day || {};
    const index = m.admin_index || { effective_average: 50, last7_average: 50, long_term_average: 50 };
    const pressurePct = (Number(m.flow_pressure || 0) * 100);
    const pressureLabel = pressurePct > 0.05 ? `Alış baskısı +${pressurePct.toFixed(1).replace('.', ',')}%`
      : pressurePct < -0.05 ? `Satış baskısı ${pressurePct.toFixed(1).replace('.', ',')}%`
      : 'Alış / satış dengesi nötr';
    const transparency = h('div', { class: 'panel market-transparency' },
      h('h3', { text: 'Piyasa şeffaflığı' }),
      h('div', { class: 'market-facts' },
        h('div', { class: 'market-fact' }, h('span', { class: 'muted small', text: 'Son 1 saat hacmi' }), h('strong', { text: money(hour.volume_minor || 0, 'FN') }), h('small', { class: 'muted', text: `${hour.trade_count || 0} işlem` })),
        h('div', { class: 'market-fact' }, h('span', { class: 'muted small', text: 'Son 24 saat hacmi' }), h('strong', { text: money(day.volume_minor || 0, 'FN') }), h('small', { class: 'muted', text: `${day.trade_count || 0} işlem` })),
        h('div', { class: 'market-fact' }, h('span', { class: 'muted small', text: 'Alış / satış dengesi' }), h('strong', { class: pressurePct > 0 ? 'pos' : pressurePct < 0 ? 'neg' : '', text: pressureLabel }), h('small', { class: 'muted', text: `Makası etkileyen ek baskı: +${m.spread_pressure_bps || 0} baz puan` })),
        h('div', { class: 'market-fact' }, h('span', { class: 'muted small', text: 'Yönetici endeksi' }), h('strong', { text: `${Number(index.effective_average ?? 50).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} / 100` }), h('small', { class: 'muted', text: `Bugün: ${index.today_score == null ? 'girilmedi' : `${index.today_score}/100`} • 7 gün: ${Number(index.last7_average ?? 50).toLocaleString('tr-TR')} • uzun vade: ${Number(index.long_term_average ?? 50).toLocaleString('tr-TR')}` })),
      ),
      h('p', { class: 'muted small market-source', text: `Fiyat kaynakları: ${m.source || 'Nexus piyasa modeli'}` }),
      h('p', { class: 'muted small market-source', text: `Son fiyat güncellemesi: ${new Date(m.updated_at).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'medium' })} • ${upd < 1 ? 'az önce' : `${upd} dk önce`}` }),
      h('p', { class: 'muted small market-source', text: `Alış-satış makası: ${((Number(m.spread_bps || 0) * 2) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% toplam • temel makas ${m.base_spread_bps ?? m.spread_bps} baz puan` }),
    );
    mount(holder,
      m.tradable ? null : h('div', { class: 'notice warn', role: 'alert' }, icon('alert', 18), 'Fiyat verisi güncel değil; işlemler geçici olarak durduruldu.'),
      h('div', { class: 'market-hero' },
        h('div', { class: 'row between' }, h('span', { class: 'row muted' }, icon('market', 18), 'Kristal / FN'), deltaEl(m.change_pct)),
        h('div', { class: 'price', text: fnPrice(m.price_micro) }),
        sparkline(hist.points), tabs,
        h('div', { class: 'stats' },
          h('div', {}, 'Alış', h('b', { text: fnPrice(m.buy_micro) })), h('div', {}, 'Satış', h('b', { text: fnPrice(m.sell_micro) })),
          h('div', {}, '24s aralık', h('b', { text: `${(m.low_micro / 1e6).toFixed(3)}–${(m.high_micro / 1e6).toFixed(3)}` }))),
        h('p', { class: 'muted small chart-instruction', text: 'Grafikte fareyi gezdir veya dokun: seçtiğin andaki kesin fiyatı, tarih-saat ve dönem değişimini gör.' })),
      transparency,
      h('div', { class: 'panel' }, h('h3', { text: 'Varlığın' }),
        h('dl', { class: 'kv', style: { marginTop: '8px' } },
          h('dt', { text: 'Kristal' }), h('dd', { class: 'strong', text: `${qtyFmt(you.qty)} KRS` }),
          h('dt', { text: 'Değer (satış fiyatıyla)' }), h('dd', { text: money(you.value_minor, cur()) }),
          h('dt', { text: 'Ortalama maliyet' }), h('dd', { text: you.qty ? fnPrice(you.avg_cost_micro) : '—' }),
          h('dt', { text: 'Kâr / zarar' }), h('dd', { class: `strong ${cls(you.pnl_minor)}`, text: you.qty ? `${you.pnl_minor > 0 ? '+' : you.pnl_minor < 0 ? '−' : ''}${money(Math.abs(you.pnl_minor), cur())}` : '—' }),
          h('dt', { text: 'FN bakiyen' }), h('dd', { text: money(m.balance, cur()) }))),
      tradePanel(m, draw, cardData.cards || []),
      tradesPanel(),
      h('p', { class: 'virtual', text: 'Kristal, Forevye Nexus oyun ekonomisine ait sanal bir varlıktır. Fiyatı bağımsız oyun piyasası simülasyonuyla oluşur; gerçek para veya finansal varlık değildir.' }));
  }

  draw();
  timer = setInterval(() => { if (!location.hash.startsWith('#/market')) return clearInterval(timer); if (!document.hidden && !holder.querySelector('input:focus')) draw(); }, 60000);
}

function tradePanel(m, redraw, allCards = []) {
  let side = 'buy';
  let cardChoice = '';
  let inputValue = '';
  let key = null;
  const cards = allCards.filter((c) => c.status === 'active');
  const box = h('div', { class: 'panel trade-panel' });

  const render = () => {
    const price = side === 'buy' ? m.buy_micro : m.sell_micro;
    const input = h('input', {
      type: 'text', inputmode: 'decimal', autocomplete: 'off', value: inputValue,
      placeholder: 'Örn. 2,5000', 'aria-label': 'Kristal miktarı (KRS)',
    });
    const error = h('p', { class: 'err-text', role: 'alert' });
    const quote = h('div', { class: 'trade-quote', 'aria-live': 'polite' });
    const available = () => cardChoice
      ? Number(cards.find((c) => c.id === cardChoice)?.balance || 0)
      : Number(m.balance || 0);
    const parse = () => {
      const value = input.value.trim().replace(',', '.');
      if (!value) return null;
      if (!/^\d{1,6}(\.\d{1,4})?$/.test(value) || Number(value) <= 0) {
        return { bad: 'Kristal miktarını 0,0001 ile 999999,9999 arasında gir (en fazla 4 ondalık).' };
      }
      const [whole, fraction = ''] = value.split('.');
      const qty = Number(whole) * 10000 + Number(fraction.padEnd(4, '0'));
      if (!Number.isSafeInteger(qty) || qty <= 0) return { bad: 'Geçerli bir kristal miktarı gir.' };
      const product = BigInt(qty) * BigInt(price);
      const div = 100000000n;
      const minor = Number(side === 'buy' ? (product + div - 1n) / div : product / div);
      return { qty, minor, body: { qty: (qty / 10000).toFixed(4) } };
    };
    const updateQuote = () => {
      inputValue = input.value;
      const parsed = parse();
      mount(quote);
      if (!parsed) {
        quote.append(h('p', { class: 'muted small', text: side === 'buy'
          ? 'Almak istediğin kristal miktarını yaz. Ödenecek FN tutarı otomatik hesaplanır.'
          : 'Satmak istediğin kristal miktarını yaz. Cüzdanına geçecek FN otomatik hesaplanır.' }));
        return;
      }
      if (parsed.bad) {
        quote.append(h('p', { class: 'err-text', text: parsed.bad }));
        return;
      }
      const hasEnough = side === 'buy' ? parsed.minor <= available() : parsed.qty <= Number(m.you.qty || 0);
      quote.append(
        h('div', { class: 'trade-quote-head' }, h('strong', { text: 'İşlem özeti' }), h('span', { class: 'chip', text: 'TAHMİNİ' })),
        h('div', { class: 'trade-quote-row' }, h('span', { text: side === 'buy' ? 'Alacağın miktar' : 'Satacağın miktar' }), h('strong', { text: `${qtyFmt(parsed.qty)} KRS` })),
        h('div', { class: 'trade-quote-row' }, h('span', { text: side === 'buy' ? 'Birim alış fiyatı' : 'Birim satış fiyatı' }), h('strong', { text: fnPrice(price) })),
        h('div', { class: 'trade-quote-total' }, h('span', { text: side === 'buy' ? 'Ödeyeceğin toplam' : 'Cüzdanına geçecek' }), h('strong', { text: money(parsed.minor, cur()) })),
      );
      if (!hasEnough) {
        quote.append(h('p', { class: 'trade-quote-warning', text: side === 'buy'
          ? (cardChoice ? 'Bu kartın bakiyesi yetmiyor. Kartlarım bölümünden karta FN aktarabilirsin.' : 'Ana cüzdan bakiyen bu alış için yetersiz.')
          : 'Bu miktarda kristalin yok. Elindeki miktarı aşağıdan kontrol et.' }));
      }
    };

    const paymentSelect = side === 'buy' ? h('select', { 'aria-label': 'Ödeme kaynağı' },
      h('option', { value: '', text: `Ana cüzdan • ${money(m.balance, cur())}` }),
      cards.map((c) => h('option', { value: c.id, text: `${c.label || c.display_name} • ${money(c.balance || 0, cur())}` }))) : null;
    if (paymentSelect) {
      paymentSelect.value = cardChoice;
      paymentSelect.addEventListener('change', () => {
        cardChoice = paymentSelect.value;
        key = null;
        updateQuote();
        const balance = h('span', { text: money(available(), cur()) });
        const hint = box.querySelector('[data-payment-available]');
        if (hint) hint.replaceChildren('Bu kaynaktan kullanılabilir: ', balance);
      });
    }
    const balanceHint = side === 'buy'
      ? h('p', { class: 'trade-available', 'data-payment-available': '', text: `Bu kaynaktan kullanılabilir: ${money(available(), cur())}` })
      : h('p', { class: 'trade-available', text: `Elindeki kristal: ${qtyFmt(m.you.qty)} KRS` });

    const setAmount = (value) => {
      input.value = value;
      inputValue = value;
      key = null;
      updateQuote();
    };
    const shortcuts = side === 'buy'
      ? [
          ['1 KRS', () => setAmount('1,0000')],
          ['5 KRS', () => setAmount('5,0000')],
          ['Maksimum', () => {
            const cap = Math.min(available(), m.max_trade_minor);
            const maxQty = Number((BigInt(Math.max(0, cap)) * 100000000n) / BigInt(price));
            setAmount((maxQty / 10000).toFixed(4).replace('.', ','));
          }],
        ]
      : [
          ['%25', () => setAmount((Math.floor(Number(m.you.qty || 0) * 0.25) / 10000).toFixed(4).replace('.', ','))],
          ['%50', () => setAmount((Math.floor(Number(m.you.qty || 0) * 0.50) / 10000).toFixed(4).replace('.', ','))],
          ['Tümü', () => {
            const maxByLimit = Number((BigInt(m.max_trade_minor) * 100000000n) / BigInt(price));
            setAmount((Math.min(Number(m.you.qty || 0), maxByLimit) / 10000).toFixed(4).replace('.', ','));
          }],
        ];
    const shortcutRow = h('div', { class: 'chips trade-shortcuts' }, shortcuts.map(([label, run]) => h('button', { type: 'button', text: label, onClick: run })));
    const submit = h('button', { class: 'btn primary block', type: 'submit', text: side === 'buy' ? 'Alışı onayla' : 'Satışı onayla', disabled: !m.tradable });

    input.addEventListener('input', () => { key = null; updateQuote(); });
    const form = h('form', { onSubmit: (event) => {
      event.preventDefault();
      const parsed = parse();
      if (!parsed) { error.textContent = 'Önce almak veya satmak istediğin kristal miktarını gir.'; return; }
      if (parsed.bad) { error.textContent = parsed.bad; return; }
      if (parsed.minor < 1) { error.textContent = 'İşlem tutarı çok küçük. Biraz daha fazla kristal gir.'; return; }
      if (parsed.minor > m.max_trade_minor) { error.textContent = `Tek işlem sınırı ${money(m.max_trade_minor, cur())}. Daha düşük miktar gir.`; return; }
      if (side === 'buy' && parsed.minor > available()) { error.textContent = cardChoice ? 'Seçtiğin kartta yeterli FN yok. Önce karta para yükle.' : 'Ana cüzdanında yeterli FN yok.'; return; }
      if (side === 'sell' && parsed.qty > Number(m.you.qty || 0)) { error.textContent = 'Elindeki kristal miktarı bu satış için yeterli değil.'; return; }
      const sourceName = side === 'buy' && cardChoice
        ? (cards.find((c) => c.id === cardChoice)?.label || cards.find((c) => c.id === cardChoice)?.display_name || 'Seçilen kart')
        : 'Ana cüzdan';
      const summary = side === 'buy'
        ? `KRİSTAL ALIŞI\n\nAlacağın: ${qtyFmt(parsed.qty)} KRS\nÖdeyeceğin: ${money(parsed.minor, cur())}\nBirim alış fiyatı: ${fnPrice(price)}\nÖdeme kaynağı: ${sourceName}\n\nİşlemi onaylıyor musun?`
        : `KRİSTAL SATIŞI\n\nSatacağın: ${qtyFmt(parsed.qty)} KRS\nCüzdanına geçecek: ${money(parsed.minor, cur())}\nBirim satış fiyatı: ${fnPrice(price)}\n\nİşlemi onaylıyor musun?`;
      if (!confirm(summary)) return;
      key ||= crypto.randomUUID();
      busy(submit, async () => {
        error.textContent = '';
        try {
          const result = await api.post('/api/market/trade', {
            side, ...parsed.body, expected_price_micro: price, idempotency_key: key,
            ...(side === 'buy' && cardChoice ? { card_id: cardChoice } : {}),
          });
          key = null;
          await refreshMe().catch(() => {});
          toast(`${side === 'buy' ? 'Alış tamamlandı' : 'Satış tamamlandı'} • ${qtyFmt(result.qty)} KRS • ${money(result.total, cur())}`, 'ok');
          redraw();
        } catch (ex) {
          error.textContent = ex.message || 'İşlem tamamlanamadı.';
          if (ex.code === 'price_moved') { key = null; redraw(); }
        }
      });
    } },
      paymentSelect ? h('div', { class: 'field' }, h('label', { text: 'Ödemeyi nereden yapacaksın?' }), paymentSelect, balanceHint) : null,
      h('div', { class: 'field' }, h('label', { text: 'Kristal miktarı (KRS)' }), input,
        h('small', { class: 'muted', text: side === 'buy' ? 'Ödeme, seçtiğin cüzdan veya kart bakiyesinden düşer.' : 'Satış bedeli ana FN cüzdanına aktarılır.' })),
      shortcutRow, quote, error, submit,
    );

    mount(box,
      h('div', { class: 'sidetabs', role: 'tablist', 'aria-label': 'İşlem yönü' },
        h('button', { class: 'buy', role: 'tab', type: 'button', 'aria-selected': String(side === 'buy'), text: 'KRİSTAL AL', onClick: () => { if (side !== 'buy') { side = 'buy'; inputValue = ''; key = null; render(); } } }),
        h('button', { class: 'sell', role: 'tab', type: 'button', 'aria-selected': String(side === 'sell'), text: 'KRİSTAL SAT', onClick: () => { if (side !== 'sell') { side = 'sell'; inputValue = ''; key = null; render(); } } }),
      ),
      h('p', { class: 'trade-intro', text: side === 'buy'
        ? 'Kaç kristal almak istediğini yaz. Toplam FN tutarını ve ödeme kaynağını onaylamadan işlem yapılmaz.'
        : 'Kaç kristal satmak istediğini yaz. Satıştan alacağın FN doğrudan ana cüzdanına eklenir.' }),
      form,
      h('p', { class: 'trade-footnote', text: 'Bu, FOREVYE NEXUS içindeki sanal oyun piyasasıdır; gerçek para veya gerçek yatırım değildir.' }),
    );
    updateQuote();
  };
  render();
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
