import { api } from './api.js';
import { h, mount, toast, dt, load, field, busy, empty } from './ui.js';
import { state, refreshMe } from './state.js';
import { renderCard } from './cardview.js';
import { validateDesign, validateDisplayName, validateLabel, PATTERNS, DECOR_IDS, MAX_DECOR, DISPLAY_NAME_MAX } from './card-contract.js';

const DECOR_NAMES = { star: 'Yıldız', bolt: 'Şimşek', orb: 'Küre', planet: 'Gezegen', leaf: 'Yaprak' };
const PATTERN_NAMES = { none: 'Yok', grid: 'Izgara', dots: 'Nokta', waves: 'Dalga', circuit: 'Devre' };

export function cardsList(screen) {
  const holder = h('div');
  mount(screen, h('div', { class: 'topbar' }, h('h1', { text: 'Kartlarım' }), h('a', { class: 'btn small primary', href: '#/cards/new', text: '+ Yeni kart' })), holder,
    h('p', { class: 'virtual', text: 'Bunlar yalnızca oyun içi sanal kartlardır; gerçek ödeme kartı değildir.' }));
  load(holder, () => api.get('/api/cards'), (d) => {
    if (!d.cards.length) return empty('Henüz kartın yok', 'İlk sanal kartını oluştur.');
    return h('div', { class: 'cards-grid' }, d.cards.map((c) => h('a', { class: 'card-tile', href: `#/cards/${c.id}`, style: { textDecoration: 'none', color: 'inherit' } },
      renderCard(c.design, c),
      h('div', { class: 'row between', style: { padding: '8px 4px 0' } }, h('span', { class: 'strong', text: c.label || c.display_name }),
        h('span', {}, c.is_default ? h('span', { class: 'chip ok', text: 'Varsayılan' }) : null, ' ', c.status === 'disabled' ? h('span', { class: 'chip bad', text: 'Devre dışı' }) : null)))));
  });
}

export async function cardEditor(screen, id) {
  const isNew = id === 'new';
  const holder = h('div');
  mount(screen, h('a', { class: 'back', href: '#/cards', text: '‹ Kartlarım' }), holder);
  await load(holder, async () => {
    const [tpl, card] = await Promise.all([api.get('/api/card-templates'), isNew ? null : api.get(`/api/cards/${id}`)]);
    return { tpl: tpl.templates, card };
  }, ({ tpl, card }) => buildEditor(isNew, card, tpl, holder));
}

function buildEditor(isNew, card, templates, holder) {
  const base = card || { label: '', display_name: state.me.user.username, status: 'active', is_default: false, card_token: '', design: { v: 1, background: { type: 'gradient', colors: ['#0b1020', '#1b2a6b'], angle: 135 }, pattern: 'grid', accent: '#4de2c5', textColor: '#ffffff', decor: [] } };
  const d = { label: base.label, display_name: base.display_name, design: JSON.parse(JSON.stringify(base.design)) };
  let showZones = false;
  const preview = h('div');
  const errBox = h('div', { class: 'err-text', role: 'alert' });
  const saveBtn = h('button', { class: 'btn primary grow', type: 'button', text: isNew ? 'Kartı oluştur' : 'Kaydet' });

  function validate() {
    const errs = [];
    const dn = validateDisplayName(d.display_name); if (!dn.ok) errs.push(dn.error);
    const lb = validateLabel(d.label); if (!lb.ok) errs.push(lb.error);
    const dv = validateDesign(d.design); if (!dv.ok) errs.push(...dv.errors);
    errBox.replaceChildren(...errs.map((e) => h('div', { text: `• ${e}` })));
    saveBtn.disabled = errs.length > 0;
    return errs.length === 0;
  }
  function redraw() { preview.replaceChildren(renderCard(d.design, { display_name: d.display_name, card_token: base.card_token, status: base.status }, { showZones })); validate(); }
  const set = (fn) => (e) => { fn(e.target.value); redraw(); };

  const bg = d.design.background;
  const nameIn = h('input', { type: 'text', maxlength: String(DISPLAY_NAME_MAX), value: d.display_name, onInput: set((v) => { d.display_name = v; }) });
  const labelIn = h('input', { type: 'text', maxlength: '30', value: d.label, placeholder: 'Örn. Oyun harcamaları', onInput: set((v) => { d.label = v; }) });
  const typeSel = h('select', { onChange: set((v) => { bg.type = v; bg.colors = v === 'solid' ? [bg.colors[0]] : [bg.colors[0], bg.colors[1] || '#1b2a6b']; if (v === 'gradient') bg.angle ??= 135; else delete bg.angle; rebuildColors(); }) },
    h('option', { value: 'solid', text: 'Düz renk' }), h('option', { value: 'gradient', text: 'Gradyan' }));
  typeSel.value = bg.type;
  const colorWrap = h('div', { class: 'zone-row' });
  const angle = h('input', { type: 'range', min: '0', max: '360', value: String(bg.angle ?? 135), onInput: set((v) => { bg.angle = Number(v); }) });
  const angleField = field('Gradyan açısı', angle);
  function rebuildColors() {
    colorWrap.replaceChildren(...bg.colors.map((c, i) => field(`Zemin rengi ${i + 1}`, h('input', { type: 'color', value: c, onInput: set((v) => { bg.colors[i] = v; }) }))));
    angleField.hidden = bg.type !== 'gradient';
  }
  rebuildColors();
  const patSel = h('select', { onChange: set((v) => { d.design.pattern = v; }) }, PATTERNS.map((p) => h('option', { value: p, text: PATTERN_NAMES[p] })));
  patSel.value = d.design.pattern;
  const accent = h('input', { type: 'color', value: d.design.accent, onInput: set((v) => { d.design.accent = v; }) });
  const txt = h('input', { type: 'color', value: d.design.textColor, onInput: set((v) => { d.design.textColor = v; }) });

  const decorWrap = h('div');
  const addBtn = h('button', { class: 'btn small', type: 'button', text: '+ Süs ekle', onClick: () => { if (d.design.decor.length >= MAX_DECOR) return toast(`En fazla ${MAX_DECOR} süs`, 'error'); d.design.decor.push({ id: 'star', x: 272, y: 108, size: 24 }); drawDecor(); redraw(); } });
  function drawDecor() {
    decorWrap.replaceChildren(...d.design.decor.map((o, i) => h('div', { class: 'decor-row' },
      h('div', { class: 'row between' },
        h('select', { 'aria-label': 'Süs türü', onChange: (e) => { o.id = e.target.value; redraw(); } }, DECOR_IDS.map((k) => h('option', { value: k, text: DECOR_NAMES[k], selected: k === o.id }))),
        h('button', { class: 'btn small danger', type: 'button', text: 'Sil', onClick: () => { d.design.decor.splice(i, 1); drawDecor(); redraw(); } })),
      ...[['x', 'Yatay', 0, 320], ['y', 'Dikey', 0, 200], ['size', 'Boyut', 12, 44]].map(([k, l, mn, mx]) =>
        field(l, h('input', { type: 'range', min: String(mn), max: String(mx), value: String(o[k]), onInput: (e) => { o[k] = Number(e.target.value); redraw(); } }))))));
  }
  drawDecor();

  const zonesBtn = h('button', { class: 'btn small', type: 'button', text: 'Korunan alanları göster', onClick: () => { showZones = !showZones; zonesBtn.textContent = showZones ? 'Korunan alanları gizle' : 'Korunan alanları göster'; redraw(); } });

  saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
    if (!validate()) return;
    try {
      if (isNew) {
        const c = await api.post('/api/cards', { display_name: d.display_name, label: d.label, design: d.design });
        toast('Kart oluşturuldu', 'ok'); location.hash = `#/cards/${c.id}`;
      } else {
        await api.patch(`/api/cards/${card.id}`, { display_name: d.display_name, label: d.label, design: d.design });
        await refreshMe().catch(() => {}); toast('Kart kaydedildi', 'ok');
      }
    } catch (e) { toast(e.message, 'error'); }
  }));

  const tplRow = templates.length ? h('div', {}, h('h3', { text: 'Şablonlar' }), h('div', { class: 'seg' }, templates.map((t) => h('button', { type: 'button', text: t.name, onClick: () => { const clone = JSON.parse(JSON.stringify(t.design)); mount(holder, buildEditor(isNew, { ...(card || base), design: clone }, templates, holder)); } })))) : null;

  const manage = !isNew ? h('div', { class: 'panel' }, h('h3', { text: 'Kart yönetimi' }), h('p', { class: 'muted small', text: 'Kart numarası/kimliği sistem tarafından atanır ve değiştirilemez.' }),
    h('div', { class: 'row wrap' },
      !card.is_default && card.status === 'active' ? h('button', { class: 'btn small', type: 'button', text: 'Varsayılan yap', onClick: async () => { try { await api.post(`/api/cards/${card.id}/default`); await refreshMe(); toast('Varsayılan kart güncellendi', 'ok'); location.reload(); } catch (e) { toast(e.message, 'error'); } } }) : null,
      h('button', { class: `btn small ${card.status === 'active' ? 'danger' : ''}`, type: 'button', text: card.status === 'active' ? 'Geçici olarak devre dışı bırak' : 'Yeniden etkinleştir', onClick: async () => { try { await api.post(`/api/cards/${card.id}/status`, { status: card.status === 'active' ? 'disabled' : 'active' }); location.reload(); } catch (e) { toast(e.message, 'error'); } } }))) : null;

  const hist = h('div', { class: 'panel' });
  if (!isNew) {
    hist.append(h('h3', { text: 'Tasarım geçmişi' }));
    const body = h('div'); hist.append(body);
    load(body, () => api.get(`/api/cards/${card.id}/history`), (r) => h('ul', { class: 'list' }, r.versions.map((v) => h('li', { class: 'item' },
      h('div', { style: { width: '96px', flex: 'none' } }, renderCard(v.design, { display_name: v.display_name, card_token: card.card_token })),
      h('div', { class: 'grow' }, h('div', { class: 't', text: `Sürüm ${v.version}` }), h('div', { class: 'muted small', text: dt(v.created_at) })),
      v.version === card.version ? h('span', { class: 'chip', text: 'Güncel' }) : h('button', { class: 'btn small', type: 'button', text: 'Geri dön', onClick: async (e) => busy(e.currentTarget, async () => { try { await api.post(`/api/cards/${card.id}/revert`, { version: v.version }); toast('Önceki tasarıma dönüldü', 'ok'); location.reload(); } catch (er) { toast(er.message, 'error'); } }) })))));
  }

  redraw();
  return h('div', {}, h('h1', { text: isNew ? 'Yeni kart' : (card.label || card.display_name) }), preview,
    h('div', { class: 'row', style: { margin: '10px 0 14px' } }, zonesBtn),
    h('div', { class: 'panel' }, field('Kartta görünen isim', nameIn, 'Serbest metin; başkalarıyla aynı olabilir ve kullanıcı adınızı etkilemez.'), field('Kartıma özel ad (yalnızca sana görünür)', labelIn)),
    h('div', { class: 'panel' }, h('h3', { text: 'Tasarım' }), tplRow, field('Zemin', typeSel), colorWrap, angleField, field('Desen', patSel), h('div', { class: 'zone-row' }, field('Vurgu rengi', accent), field('Yazı rengi', txt)),
      h('h3', { text: 'Süsler' }), decorWrap, addBtn),
    errBox, h('div', { class: 'row', style: { margin: '10px 0 16px' } }, saveBtn), manage, hist,
    h('p', { class: 'virtual', text: 'Çip, marka, sistem kimliği ve kart adı alanları korunur; üzerlerine nesne bindirilemez.' }));
}

export function vaultView(screen) {
  const holder = h('div');
  mount(screen, h('a', { class: 'back', href: '#/profile', text: '‹ Profil' }), h('h1', { text: 'Nexus Vault' }), holder);
  load(holder, () => api.get('/api/vault'), (v) => h('div', {},
    h('div', { class: 'panel' }, h('h3', { text: 'Rozetler (Nexus Achievements)' }), h('ul', { class: 'list' }, v.badges.map((b) => h('li', { class: 'item' },
      h('div', { class: 'avatar', text: b.earned_at ? '★' : '☆' }), h('div', { class: 'grow' }, h('div', { class: 't', text: b.title }), h('div', { class: 'muted small', text: b.earned_at ? `Kazanıldı: ${dt(b.earned_at)}` : b.desc })))))),
    h('div', { class: 'panel' }, h('h3', { text: 'Kart temaları (Nexus Collection)' }), v.themes.length ? h('div', { class: 'cards-grid' }, v.themes.map((t) => h('div', {}, renderCard(t.design, { display_name: t.name }), h('div', { class: 'muted small', text: t.limited_until ? `Sınırlı süre: ${dt(t.limited_until)}` : 'Kalıcı tema' })))) : empty('Şu an tema yok')),
    h('div', { class: 'panel' }, h('h3', { text: 'Kayıtlı tasarımlar' }), v.saved_designs.length ? h('div', { class: 'cards-grid' }, v.saved_designs.map((s) => h('a', { href: `#/cards/${s.card_id}`, style: { textDecoration: 'none', color: 'inherit' } }, renderCard(s.design, { display_name: s.display_name }), h('div', { class: 'muted small', text: `Sürüm ${s.version} • ${dt(s.created_at)}` })))) : empty('Kayıtlı tasarım yok'))));
}
