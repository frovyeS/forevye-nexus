import { api } from './api.js';
import { h, mount, toast, dt, load, busy, empty, icon, back } from './ui.js';

// Nexus içinden Pass sitesini açar: sunucu tek kullanımlık bilet üretir, Pass sitesi bileti jetona çevirir (kart editörüyle aynı yöntem).
export async function openPass() {
  const r = await api.post('/api/pass/ticket', {});
  location.href = r.url;
}

const left = (t) => { const m = Math.max(0, Math.floor((t - Date.now()) / 6e4)), d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60); return d ? `${d} gün ${hh} sa kaldı` : hh ? `${hh} sa ${m % 60} dk kaldı` : `${m} dk kaldı`; };

// Durum yalnızca sunucu yanıtından gelir: active | expired | cancelled.
const STATUS = {
  active: { chip: 'chip ok', label: 'Aktif', line: (e) => `${left(e.expires)} • bitiş ${dt(e.expires)}` },
  expired: { chip: 'chip', label: 'Süresi doldu', line: (e) => `Süresi doldu • ${dt(e.expires)}` },
  cancelled: { chip: 'chip warn', label: 'İptal edildi', line: () => 'Üyelik iade/ters kayıtla kapatıldı. Ayrıntı için İşlem geçmişine bak.' },
};

function passErr(ex) {
  if (ex.offline) return 'Bağlantı yok. İnternetini kontrol edip tekrar dene.';
  if (ex.status === 503) return 'Nexus Pass şu anda kullanılamıyor. Bakiye ve üyelik kayıtların korunuyor.';
  return ex.message || 'Nexus Pass şu anda açılamadı.';
}

export function passView(screen) {
  const holder = h('div');
  const openBtn = h('button', { class: 'btn primary block', type: 'button', onClick: (e) => busy(e.currentTarget, async () => { try { await openPass(); } catch (ex) { toast(passErr(ex), 'error'); } }) }, icon('star', 18), 'Paketlere göz at / Nexus Pass’i aç');
  mount(screen, back('#/ops', 'İşlemler'), h('h1', { text: 'Nexus Pass' }),
    h('p', { class: 'muted', text: 'FOREVYE uygulamalarındaki süreli üyeliklerin.' }), holder, openBtn,
    h('p', { class: 'virtual', text: 'Üyelikler sanal FN bakiyenle alınır; otomatik yenilenmez, gerçek para içermez.' }));
  load(holder, () => api.get('/api/pass/mine'), (d) => {
    if (!d.entitlements.length) return empty('Henüz üyeliğin yok', 'Nexus Pass’te paketlere göz atabilirsin.');
    return h('div', { class: 'panel' }, h('h3', { text: 'Üyeliklerim' }), h('ul', { class: 'list' }, d.entitlements.map((e) => {
      const s = STATUS[e.status] || STATUS.expired;
      return h('li', { class: 'item' },
        h('div', { class: 'grow' }, h('div', { class: 't', text: `${e.product.app} · ${e.product.name}` }), h('div', { class: 'muted small', text: s.line(e) })),
        h('span', { class: s.chip, text: s.label }));
    })));
  });
}
