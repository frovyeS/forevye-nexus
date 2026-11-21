import { api } from './api.js';
import { h, mount, toast, dt, load, field, busy, empty, icon, back } from './ui.js';
import { state, refreshMe } from './state.js';
import { renderCard } from './cardview.js';
import { validateLabel, LABEL_MAX } from './card-contract.js';

// Kart tasarımı banka kart editöründe (ayrı site) yapılır. Burada: sunucudan tek kullanımlık bilet alınır, tarayıcı editöre gider.
// Editörde "Kaydet" doğrudan bu sunucuya yazar; çıkınca kullanıcı buraya (#/cards/<id>) döner.
export async function openEditor(cardId, label) {
  const r = await api.post('/api/editor/ticket', cardId ? { card_id: cardId } : { label: label || '' });
  location.href = r.url;
}

export function cardsList(screen) {
  const holder = h('div');
  mount(screen, h('div', { class: 'topbar' }, h('h1', { text: 'Kartlarım' }), h('a', { class: 'btn small primary', href: '#/cards/new' }, icon('plus', 18), 'Yeni kart')), holder,
    h('p', { class: 'virtual', text: 'Bunlar yalnızca oyun içi sanal kartlardır; gerçek ödeme kartı değildir.' }));
  load(holder, () => api.get('/api/cards'), (d) => {
    if (!d.cards.length) return empty('Henüz kartın yok', 'İlk sanal kartını oluştur.');
    return h('div', { class: 'cards-grid' }, d.cards.map((c) => h('a', { class: 'card-tile', href: `#/cards/${c.id}`, style: { textDecoration: 'none', color: 'inherit' } },
      renderCard(c.design, c),
      h('div', { class: 'row between', style: { padding: '8px 4px 0' } }, h('span', { class: 'strong', text: c.label || c.display_name }),
        h('span', {}, c.is_default ? h('span', { class: 'chip ok', text: 'Varsayılan' }) : null, ' ', c.status === 'disabled' ? h('span', { class: 'chip bad', text: 'Devre dışı' }) : null)))));
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
      h('button', { class: `btn small ${card.status === 'active' ? 'danger' : ''}`, type: 'button', text: card.status === 'active' ? 'Geçici olarak devre dışı bırak' : 'Yeniden etkinleştir', onClick: async () => { try { await api.post(`/api/cards/${card.id}/status`, { status: card.status === 'active' ? 'disabled' : 'active' }); location.reload(); } catch (e) { toast(e.message, 'error'); } } })));

  const hist = h('div', { class: 'panel' }, h('h3', { text: 'Tasarım geçmişi' }));
  const body = h('div'); hist.append(body);
  load(body, () => api.get(`/api/cards/${card.id}/history`), (r) => h('ul', { class: 'list' }, r.versions.map((v) => h('li', { class: 'item' },
    h('div', { style: { width: '96px', flex: 'none' } }, renderCard(v.design, { display_name: v.display_name, card_token: card.card_token })),
    h('div', { class: 'grow' }, h('div', { class: 't', text: `Sürüm ${v.version}` }), h('div', { class: 'muted small', text: dt(v.created_at) })),
    v.version === card.version ? h('span', { class: 'chip', text: 'Güncel' }) : h('button', { class: 'btn small', type: 'button', text: 'Geri dön', onClick: async (e) => busy(e.currentTarget, async () => { try { await api.post(`/api/cards/${card.id}/revert`, { version: v.version }); toast('Önceki tasarıma dönüldü', 'ok'); location.reload(); } catch (er) { toast(er.message, 'error'); } }) })))));

  return h('div', {}, h('h1', { text: card.label || card.display_name }), renderCard(card.design, card),
    h('div', { style: { margin: '14px 0' } }, designBtn),
    h('div', { class: 'panel' }, h('form', { onSubmit: (e) => { e.preventDefault(); busy(lbtn, async () => {
      lerr.textContent = '';
      const v = validateLabel(labelIn.value); if (!v.ok) { lerr.textContent = v.error; return; }
      try { await api.patch(`/api/cards/${card.id}`, { label: v.value }); toast('Kaydedildi', 'ok'); } catch (ex) { lerr.textContent = ex.message; }
    }); } }, field('Kartıma özel ad (yalnızca sana görünür)', labelIn), lerr, lbtn),
    h('p', { class: 'muted small', text: `Kartta görünen isim: ${card.display_name}. Tasarımı ve kart üstündeki ismi kart editöründe değiştirirsin.` })),
    manage, hist,
    h('p', { class: 'virtual', text: 'Çip, marka ve kart kimliği sistem tarafından çizilir; tasarımda silinemez veya taşınamaz.' }));
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
