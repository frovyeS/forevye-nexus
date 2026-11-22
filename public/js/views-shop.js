import { api } from './api.js';
import { h, mount, toast, dt, load, busy, empty, icon, back } from './ui.js';

// Nexus içinden Market sitesini açar: sunucu tek kullanımlık bilet üretir, Market bileti jetona çevirir (kart editörü ve Pass ile aynı yöntem).
export async function openShop() {
  const r = await api.post('/api/shop/ticket', {});
  location.href = r.url;
}

const RARITY = { common: 'Yaygın', rare: 'Nadir', epic: 'Epik', legendary: 'Efsanevi', mythic: 'Mitik' };
const money = (m) => `${(m / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} FN`;

function perkLines(p) {
  const out = [];
  if (p.limit_mult > 1) out.push(`Günlük transfer limiti ×${p.limit_mult}`);
  if (p.transfer_mult > 1) out.push(`İşlem başına limit ×${p.transfer_mult}`);
  if (p.spread_discount_pct > 0) out.push(`Kristal borsası farkı −%${p.spread_discount_pct}`);
  if (p.extra_cards > 0) out.push(`+${p.extra_cards} kart hakkı`);
  return out;
}

export function shopView(screen) {
  const holder = h('div');
  const openBtn = h('button', { class: 'btn primary block', type: 'button', onClick: (e) => busy(e.currentTarget, async () => { try { await openShop(); } catch (ex) { toast(ex.message, 'error'); } }) }, icon('cart', 18), 'Nexus Market’i aç');
  mount(screen, back('#/ops', 'İşlemler'), h('h1', { text: 'Nexus Market' }),
    h('p', { class: 'muted', text: 'Editörde bulunmayan premium kart tasarımları ve gerçek avantaj sağlayan fonksiyonel kartlar. FN bakiyenle satın al.' }), openBtn, holder,
    h('p', { class: 'virtual', text: 'Market ürünleri oyun içi sanal öğelerdir; gerçek para içermez.' }));
  load(holder, () => api.get('/api/shop/mine'), (d) => {
    const perks = perkLines(d.perks);
    return h('div', {},
      h('div', { class: 'panel' }, h('h3', { text: 'Etkin avantajların' }),
        perks.length ? h('ul', { class: 'list' }, perks.map((t) => h('li', { class: 'item' }, h('div', { class: 'grow', text: t }))))
          : h('p', { class: 'muted small', text: 'Henüz fonksiyonel kartın yok. Titanyum, Platin ve Nexus Black kartları limitlerini artırır, borsada fark indirimi ve ek kart hakkı verir.' }),
        h('p', { class: 'muted small', text: `Şu anki limitler: işlem başına ${money(d.limits.max_transfer)} • günlük ${money(d.limits.daily_limit)} • en fazla ${d.limits.max_cards} kart` })),
      d.items.length ? h('div', { class: 'panel' }, h('h3', { text: 'Koleksiyonum' }), h('ul', { class: 'list' }, d.items.map((e) => h('li', { class: 'item' },
        h('div', { class: 'grow' }, h('div', { class: 't', text: `${e.name}${e.qty > 1 ? ` ×${e.qty}` : ''}` }),
          h('div', { class: 'muted small', text: `${RARITY[e.rarity] || ''} • ${e.kind === 'function' ? 'Fonksiyonel' : 'Tasarım'}${e.serial ? ` • No. ${e.serial}` : ''} • ${dt(e.acquired_at)}` })),
        e.skin ? h('span', { class: 'chip', text: 'Kart yüzeyi' }) : null))))
        : empty('Koleksiyonun boş', 'Market’te tasarım ve fonksiyonel kartlara göz at.'));
  });
}

// Kart ekranında: sahip olunan kart yüzeylerini bu karta tak/çıkar.
export function skinPanel(card) {
  const body = h('div');
  const panel = h('div', { class: 'panel' }, h('h3', { text: 'Kart yüzeyi' }), body);
  load(body, () => api.get('/api/shop/mine'), (d) => {
    const skins = d.items.filter((e) => e.skin);
    const cur = card.skin && card.skin.product_id;
    const apply = (pid) => async (e) => busy(e.currentTarget, async () => {
      try { await api.post(`/api/cards/${card.id}/skin`, { product_id: pid }); toast(pid ? 'Kart yüzeyi uygulandı' : 'Standart tasarıma dönüldü', 'ok'); location.reload(); } catch (er) { toast(er.message, 'error'); }
    });
    return h('div', {},
      h('p', { class: 'muted small', text: 'Market’ten aldığın premium yüzeyler kartının tasarımının yerine geçer. Kayıtlı tasarımın silinmez; yüzeyi kaldırınca geri gelir.' }),
      skins.length ? h('ul', { class: 'list' }, skins.map((e) => h('li', { class: 'item' },
        h('div', { class: 'grow' }, h('div', { class: 't', text: e.name }), h('div', { class: 'muted small', text: e.serial ? `No. ${e.serial}` : (RARITY[e.rarity] || '') })),
        cur === e.product_id ? h('span', { class: 'chip ok', text: 'Takılı' }) : h('button', { class: 'btn small', type: 'button', text: 'Uygula', onClick: apply(e.product_id) }))))
        : h('p', { class: 'muted small', text: 'Henüz kart yüzeyin yok.' }),
      cur ? h('button', { class: 'btn small', type: 'button', text: 'Standart tasarıma dön', onClick: apply(null) }) : null,
      h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn small primary', type: 'button', onClick: (e) => busy(e.currentTarget, async () => { try { await openShop(); } catch (ex) { toast(ex.message, 'error'); } }) }, icon('cart', 16), 'Market’te yeni yüzeylere bak')));
  });
  return panel;
}
