import { api, onUnauth } from './api.js';
import { h, mount, toast, money, dt, load, field, pwField, busy, empty, icon, back } from './ui.js';
import { renderCard } from './cardview.js';
import { defaultDesign, validateDesign } from './card-contract.js';

const root = document.getElementById('app');
let admin = null;
const isSuper = () => admin?.role === 'superadmin';

function ask(msg) { const r = prompt(msg); return r && r.trim().length >= 3 ? r.trim() : null; }

function loginGate() {
  const email = h('input', { type: 'email', required: true, autocomplete: 'username' }); const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const err = h('p', { class: 'err-text', role: 'alert' }); const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Giriş yap' });
  mount(root, h('div', { class: 'auth' }, h('h1', { text: 'Yönetim girişi' }), h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => { try { await api.post('/api/auth/login', { email: email.value, password: pw.value }); init(); } catch (ex) { err.textContent = ex.message; } }); } }, field('E-posta', email), pwField('Şifre', pw), err, btn)));
}

async function init() {
  try { admin = await api.get('/api/admin/me'); } catch (e) {
    if (e.status === 401) return loginGate();
    return mount(root, h('div', { class: 'auth' }, h('div', { class: 'notice bad', role: 'alert', text: 'Bu sayfaya erişim yetkiniz yok.' }), h('a', { class: 'btn block', href: '/', text: 'Uygulamaya dön' })));
  }
  const tabs = [['users', 'Kullanıcılar'], ['announce', 'Duyurular'], ['templates', 'Kart şablonları'], ['audit', 'Denetim kaydı'], ['gift', 'Entegrasyon']];
  if (isSuper()) tabs.push(['roles', 'Yetkililer']);
  const body = h('div'); let current = 'users';
  const bar = h('div', { class: 'seg' });
  const show = (k) => { current = k; for (const b of bar.children) b.setAttribute('aria-pressed', String(b.dataset.k === k)); ({ users: usersTab, announce: announceTab, templates: templatesTab, audit: auditTab, gift: giftTab, roles: rolesTab })[k](body); };
  tabs.forEach(([k, l]) => bar.append(h('button', { type: 'button', 'data-k': k, 'aria-pressed': 'false', text: l, onClick: () => show(k) })));
  mount(root, h('div', { class: 'shell' }, h('main', { class: 'screen' }, h('div', { class: 'topbar' }, h('h1', { text: 'FOREVYE NEXUS • Yönetim' }), h('span', { class: 'chip', text: `${admin.username} (${admin.role})` })), bar, body, h('p', { class: 'virtual' }, back('/', 'Uygulamaya dön')))));
  show('users');
}

function usersTab(body) {
  const q = h('input', { type: 'search', placeholder: 'Kullanıcı adı veya e-posta (en az 2 karakter)' }); const res = h('div'); const detail = h('div');
  mount(body, h('form', { class: 'panel', onSubmit: async (e) => { e.preventDefault(); load(res, () => api.get(`/api/admin/users?q=${encodeURIComponent(q.value)}`), (d) => d.users.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Kullanıcı', 'E-posta', 'Rol', 'Durum', ''].map((x) => h('th', { text: x })))), h('tbody', {}, d.users.map((u) => h('tr', {}, h('td', { text: u.username }), h('td', { text: u.email }), h('td', { text: u.role }), h('td', { text: u.status }), h('td', {}, h('button', { class: 'btn small', type: 'button', text: 'Aç', onClick: () => openUser(u.id, detail) }))))))) : empty('Sonuç yok')); } }, field('Ara', q), h('button', { class: 'btn primary', type: 'submit', text: 'Ara' })), res, detail);
}

function openUser(id, holder) {
  load(holder, () => api.get(`/api/admin/users/${id}`), (d) => {
    const u = d.user;
    const act = (label, fn, danger) => h('button', { class: `btn small ${danger ? 'danger' : ''}`, type: 'button', text: label, onClick: (e) => busy(e.currentTarget, async () => { try { await fn(); openUser(id, holder); } catch (ex) { toast(ex.message, 'error'); } }) });
    return h('div', { class: 'panel' }, h('h2', { text: `@${u.username}` }),
      h('dl', { class: 'kv' }, h('dt', { text: 'ID' }), h('dd', { text: u.id }), h('dt', { text: 'E-posta' }), h('dd', { text: u.email }), h('dt', { text: 'Rol' }), h('dd', { text: u.role }), h('dt', { text: 'Durum' }), h('dd', { text: d.suspended ? `Askıda${u.suspended_until ? ` (→ ${dt(u.suspended_until)})` : ''}` : 'Aktif' }), h('dt', { text: 'Bakiye' }), h('dd', { text: money(d.balance) }), h('dt', { text: 'Kart sayısı' }), h('dd', { text: String(d.card_count) })),
      h('div', { class: 'row wrap', style: { margin: '12px 0' } },
        d.suspended ? act('Askıyı kaldır', async () => { const r = ask('Gerekçe (en az 3 karakter):'); if (!r) throw new Error('Gerekçe zorunlu'); await api.post(`/api/admin/users/${id}/unsuspend`, { reason: r }); toast('Askı kaldırıldı', 'ok'); })
          : act('Askıya al', async () => { const r = ask('Gerekçe (en az 3 karakter):'); if (!r) throw new Error('Gerekçe zorunlu'); const hrs = prompt('Süre (saat). Süresiz için boş bırakın:'); await api.post(`/api/admin/users/${id}/suspend`, { reason: r, ...(hrs ? { hours: Number(hrs) } : {}) }); toast('Hesap askıya alındı', 'ok'); }, true),
        isSuper() ? act('Bakiye düzeltmesi (+/−)', async () => { const a = prompt('Tutar (örn. 25.00 veya -10.50):'); if (!a) return; const r = ask('Gerekçe:'); if (!r) throw new Error('Gerekçe zorunlu'); const x = await api.post('/api/admin/ledger/adjust', { user_id: id, amount: a, reason: r }); toast(`Kayıt: ${x.ref}`, 'ok'); }, true) : null),
      h('h3', { text: 'Son hareketler' }), d.recent.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Zaman', 'Tür', 'Tutar', 'Bakiye', 'Ref', ''].map((x) => h('th', { text: x })))), h('tbody', {}, d.recent.map((t) => h('tr', {}, h('td', { text: dt(t.created_at) }), h('td', { text: t.type }), h('td', { text: money(t.amount) }), h('td', { text: money(t.balance_after) }), h('td', { text: t.tx_ref }),
        h('td', {}, isSuper() && !['reversal', 'refund'].includes(t.type) ? h('button', { class: 'btn small danger', type: 'button', text: 'Ters kayıt', onClick: async (e) => { const r = ask(`${t.tx_ref} için ters kayıt gerekçesi:`); if (!r) return; await busy(e.currentTarget, async () => { try { const x = await api.post('/api/admin/ledger/reverse', { ref: t.tx_ref, reason: r }); toast(`Ters kayıt: ${x.reversal_ref}`, 'ok'); openUser(id, holder); } catch (ex) { toast(ex.message, 'error'); } }); } }) : null)))))) : empty('Hareket yok'));
  });
}

function announceTab(body) {
  const list = h('div'); const title = h('input', { type: 'text', maxlength: '80' }); const text = h('textarea', { maxlength: '500', rows: '3' });
  const refresh = () => load(list, () => api.get('/api/admin/announcements'), (d) => d.items.length ? h('ul', { class: 'list' }, d.items.map((a) => h('li', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't', text: a.title }), h('div', { class: 'muted small', text: `${a.body} • ${dt(a.created_at)}` })), a.active ? h('button', { class: 'btn small danger', type: 'button', text: 'Kapat', onClick: async () => { await api.post(`/api/admin/announcements/${a.id}/deactivate`); refresh(); } }) : h('span', { class: 'chip', text: 'Kapalı' })))) : empty('Duyuru yok'));
  mount(body, h('form', { class: 'panel', onSubmit: async (e) => { e.preventDefault(); try { await api.post('/api/admin/announcements', { title: title.value, body: text.value }); title.value = ''; text.value = ''; toast('Yayınlandı', 'ok'); refresh(); } catch (ex) { toast(ex.message, 'error'); } } }, field('Başlık', title), field('Metin', text), h('button', { class: 'btn primary', type: 'submit', text: 'Yayınla' })), h('div', { class: 'panel' }, list)); refresh();
}

function templatesTab(body) {
  const list = h('div'); const name = h('input', { type: 'text', maxlength: '40' }); const json = h('textarea', { rows: '8', spellcheck: 'false' }); json.value = JSON.stringify(defaultDesign(), null, 2);
  const until = h('input', { type: 'datetime-local' }); const prev = h('div');
  const showPrev = () => { try { const v = validateDesign(JSON.parse(json.value)); prev.replaceChildren(v.ok ? renderCard(v.design, { display_name: name.value || 'ÖNİZLEME' }) : h('div', { class: 'err-text', text: v.errors.join(' • ') })); } catch { prev.replaceChildren(h('div', { class: 'err-text', text: 'Geçersiz JSON' })); } };
  json.addEventListener('input', showPrev); name.addEventListener('input', showPrev); showPrev();
  const refresh = () => load(list, () => api.get('/api/admin/templates'), (d) => d.items.length ? h('div', { class: 'cards-grid' }, d.items.map((t) => h('div', {}, renderCard(t.design, { display_name: t.name }), h('div', { class: 'row between' }, h('span', { text: `${t.name}${t.limited_until ? ` • ${dt(t.limited_until)}` : ''}` }), h('button', { class: 'btn small', type: 'button', text: t.active ? 'Kapat' : 'Aç', onClick: async () => { await api.post(`/api/admin/templates/${t.id}/active`, { active: !t.active }); refresh(); } }))))) : empty('Şablon yok'));
  mount(body, h('form', { class: 'panel', onSubmit: async (e) => { e.preventDefault(); try { await api.post('/api/admin/templates', { name: name.value, design: JSON.parse(json.value), limited_until: until.value ? new Date(until.value).getTime() : null }); toast('Şablon eklendi', 'ok'); refresh(); } catch (ex) { toast(ex.message, 'error'); } } }, h('h3', { text: 'Yeni şablon / sınırlı süreli tema' }), prev, field('Ad', name), field('Tasarım JSON (sunucu doğrular)', json), field('Bitiş (opsiyonel)', until), h('button', { class: 'btn primary', type: 'submit', text: 'Ekle' })), h('div', { class: 'panel' }, list)); refresh();
}

function auditTab(body) {
  mount(body, h('div', { class: 'panel' }, h('h3', { text: 'Denetim kaydı (son 100)' }), h('div', { id: 'au' })));
  load(body.querySelector('#au'), () => api.get('/api/admin/audit'), (d) => h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Zaman', 'Yönetici', 'Eylem', 'Hedef', 'Gerekçe', 'Sonuç', 'Ayrıntı'].map((x) => h('th', { text: x })))), h('tbody', {}, d.items.map((a) => h('tr', {}, [dt(a.created_at), a.admin_id.slice(0, 8), a.action, (a.target || '').slice(0, 16), a.reason || '', a.result, a.detail || ''].map((x) => h('td', { text: x }))))))));
}

function giftTab(body) {
  mount(body, h('div', { class: 'panel' }, h('h3', { text: 'Hediye kartı modülü' }), h('div', { id: 'gs' })));
  load(body.querySelector('#gs'), () => api.get('/api/admin/giftcard'), (s) => h('div', { class: `notice ${s.connected ? '' : 'warn'}`, text: s.detail }));
}

function rolesTab(body) {
  const list = h('div'); const uid = h('input', { type: 'text', placeholder: 'Kullanıcı ID' }); const role = h('select', {}, ['user', 'admin', 'superadmin'].map((r) => h('option', { value: r, text: r })));
  const refresh = () => load(list, () => api.get('/api/admin/admins'), (d) => h('ul', { class: 'list' }, d.admins.map((a) => h('li', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't', text: a.username }), h('div', { class: 'muted small', text: `${a.email} • ${a.id}` })), h('span', { class: 'chip', text: a.role })))));
  mount(body, h('form', { class: 'panel', onSubmit: async (e) => { e.preventDefault(); const r = ask('Gerekçe:'); if (!r) return toast('Gerekçe zorunlu', 'error'); try { await api.post('/api/admin/roles', { user_id: uid.value.trim(), role: role.value, reason: r }); toast('Rol güncellendi', 'ok'); refresh(); } catch (ex) { toast(ex.message, 'error'); } } }, h('h3', { text: 'Rol ata' }), field('Kullanıcı ID', uid), field('Rol', role), h('button', { class: 'btn primary', type: 'submit', text: 'Güncelle' })), h('div', { class: 'panel' }, list)); refresh();
}

onUnauth(() => loginGate());
init();
