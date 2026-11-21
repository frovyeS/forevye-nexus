import { api, onUnauth } from './api.js';
import { h, mount, toast, money, dt, load, field, busy, empty } from './ui.js';
import { state, refreshMe, setHide, cur, initial } from './state.js';
import { renderCard } from './cardview.js';
import { opsMenu, txList, txRow, sendFlow, giftFlow } from './views-ops.js';
import { cardsList, cardNew, cardDetail, editorLaunch, vaultView } from './views-cards.js';
import { marketView, marketMini } from './views-market.js';

const root = document.getElementById('app');
const LOGO = '/assets/logo.svg';

// ---------- Çevrimdışı göstergesi ----------
const off = document.getElementById('offline');
const syncOnline = () => { off.hidden = navigator.onLine; };
addEventListener('online', syncOnline); addEventListener('offline', syncOnline); syncOnline();

// ---------- Giriş sonrası hedef ----------
// Banka editörü "giriş gerekli" diyerek #/editor-launch/<kart|new> adresine yollar. FOREVYE ID girişi sayfadan çıkıp geri döndüğü için hedef oturum belleğinde (yalnızca bu sekme) tutulur.
const NEXT_OK = /^#\/(editor-launch\/[A-Za-z0-9-]{1,40}|cards(\/[A-Za-z0-9-]{1,40})?)$/;
function rememberNext() { try { if (NEXT_OK.test(location.hash)) sessionStorage.setItem('nx_next', location.hash); } catch { /* depolama yok */ } }
function takeNext() { try { const n = sessionStorage.getItem('nx_next'); sessionStorage.removeItem('nx_next'); return n && NEXT_OK.test(n) ? n : ''; } catch { return ''; } }

// ---------- Giriş / Kayıt / Şifre sıfırlama ----------
function authView(initialMode = 'login') {
  let mode = initialMode;
  const box = h('div', { class: 'auth' });
  const draw = () => {
    const tabs = h('div', { class: 'tabs', role: 'tablist' },
      h('button', { role: 'tab', 'aria-selected': String(mode === 'login'), text: 'Giriş yap', onClick: () => { mode = 'login'; draw(); } }),
      h('button', { role: 'tab', 'aria-selected': String(mode === 'register'), text: 'Hesap oluştur', onClick: () => { mode = 'register'; draw(); } }));
    mount(box, h('div', { class: 'brand' }, h('img', { src: LOGO, alt: 'FOREVYE NEXUS' })),
      h('p', { class: 'muted center', text: 'Sanal oyun ekonomisi hesabın' }), idNotice(),
      mode === 'idreg' ? idRegForm() : h('div', {}, idButton(), h('p', { class: 'muted center', text: 'veya e-posta ile' })),
      mode === 'forgot' || mode === 'idreg' ? null : tabs,
      mode === 'idreg' ? null : mode === 'login' ? loginForm() : mode === 'register' ? registerWizard() : forgotWizard(),
      h('p', { class: 'virtual', text: 'FOREVYE NEXUS gerçek bir banka veya ödeme kuruluşu değildir. Tüm bakiye ve kartlar oyun içi sanal öğelerdir.' }));
  };
  // FOREVYE ID ile giriş: sunucu ID sitesinin adresini (PKCE ile) hazırlar; parola Nexus'a hiç gelmez.
  const ID_ERR = { id_unavailable: 'FOREVYE ID şu an kullanılamıyor.', id_state: 'Giriş oturumu süresi doldu. Tekrar deneyin.', id_failed: 'FOREVYE ID girişi tamamlanamadı.', id_unverified: 'FOREVYE ID e-postanız doğrulanmamış.', id_conflict: 'Bu Nexus hesabı başka bir FOREVYE ID ile birleşmiş.', rate_limited: 'Çok fazla deneme. Biraz bekleyin.' };
  const idNotice = () => { const c = new URLSearchParams(location.search).get('id_error'); if (!c) return null; history.replaceState(null, '', location.pathname + location.hash); return h('div', { class: 'notice warn', role: 'alert', text: ID_ERR[c] || 'FOREVYE ID girişi başarısız.' }); };
  const idButton = () => h('button', { class: 'btn primary block', type: 'button', text: 'FOREVYE ID ile giriş', onClick: (e) => busy(e.currentTarget, async () => { try { rememberNext(); const r = await api.post('/api/auth/id/start'); location.href = r.url; } catch (ex) { toast(ex.message, 'err'); } }) });
  const idRegForm = () => {
    const token = decodeURIComponent((location.hash.split('/')[2] || '').trim());
    const un = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '20', required: true });
    const hint = h('small', { class: 'muted', text: '3-20 karakter: harf, rakam, _ ve .' });
    let t; un.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { if (!/^[A-Za-z0-9_.]{3,20}$/.test(un.value)) return; try { const r = await api.get(`/api/auth/username-available?name=${encodeURIComponent(un.value)}`); hint.textContent = r.available ? '✓ Kullanılabilir' : '✗ Bu ad alınmış'; } catch { /* sunucu kontrol eder */ } }, 400); });
    const cn = h('input', { type: 'text', maxlength: '18', required: true });
    const err = h('p', { class: 'err-text', role: 'alert' }); const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Hesabı oluştur' });
    return h('div', {}, h('h2', { text: 'FOREVYE ID bağlandı' }), h('p', { class: 'muted', text: 'Son adım: Nexus kullanıcı adını ve kartta görünecek ismi seç. Şifre gerekmez.' }),
      h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => { err.textContent = ''; try { await api.post('/api/auth/id/complete', { token, username: un.value, card_display_name: cn.value }); location.hash = '#/home'; await start(); } catch (ex) { err.textContent = ex.message; } }); } },
        h('div', { class: 'field' }, h('label', { text: 'Hesap kullanıcı adı' }), un, hint),
        field('Kartta görünecek isim', cn, 'Serbest isim; kullanıcı adından farklıdır ve sonra değiştirilebilir.'), err, btn));
  };
  const loginForm = () => {
    const email = h('input', { type: 'email', autocomplete: 'username', inputmode: 'email', autocapitalize: 'none', required: true });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const err = h('p', { class: 'err-text', role: 'alert' });
    const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Giriş yap' });
    return h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      err.textContent = '';
      try { await api.post('/api/auth/login', { email: email.value, password: pw.value }); await start(); } catch (ex) { err.textContent = ex.message; }
    }); } }, field('E-posta', email), field('Şifre', pw), err, btn,
      h('p', { class: 'center' }, h('button', { class: 'back', type: 'button', text: 'Şifremi unuttum', onClick: () => { mode = 'forgot'; draw(); } })));
  };
  const registerWizard = () => {
    const w = h('div'); const s = { step: 1, email: '', token: '' };
    const dots = () => h('div', { class: 'pill-step' }, [1, 2, 3].map((i) => h('i', { class: i <= s.step ? 'on' : '' })));
    const paint = () => {
      if (s.step === 1) {
        const email = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', required: true, value: s.email });
        const err = h('p', { class: 'err-text', role: 'alert' }); const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Doğrulama kodu gönder' });
        mount(w, dots(), h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => { err.textContent = ''; try { const r = await api.post('/api/auth/register/start', { email: email.value }); s.email = email.value.trim().toLowerCase(); s.dev = r.dev_code; s.step = 2; paint(); } catch (ex) { err.textContent = ex.message; } }); } }, field('E-posta adresin', email), err, btn));
      } else if (s.step === 2) {
        const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', required: true });
        const err = h('p', { class: 'err-text', role: 'alert' }); const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Doğrula' });
        mount(w, dots(), h('p', { class: 'muted', text: `${s.email} adresine 6 haneli bir kod gönderdik (10 dk geçerli).` }), s.dev ? h('div', { class: 'notice warn', text: `Geliştirme ortamı kodu: ${s.dev}` }) : null,
          h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => { err.textContent = ''; try { const r = await api.post('/api/auth/register/verify', { email: s.email, code: code.value.trim() }); s.token = r.token; s.step = 3; paint(); } catch (ex) { err.textContent = ex.message; } }); } }, field('Doğrulama kodu', code), err, btn),
          h('button', { class: 'back', type: 'button', text: '‹ E-postayı değiştir', onClick: () => { s.step = 1; paint(); } }));
      } else {
        const un = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '20', required: true });
        const hint = h('small', { class: 'muted', text: '3-20 karakter: harf, rakam, _ ve .' });
        let t; un.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { if (!/^[A-Za-z0-9_.]{3,20}$/.test(un.value)) return; try { const r = await api.get(`/api/auth/username-available?name=${encodeURIComponent(un.value)}`); hint.textContent = r.available ? '✓ Kullanılabilir' : '✗ Bu ad alınmış'; } catch { /* sunucu kontrol eder */ } }, 400); });
        const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '10' });
        const cn = h('input', { type: 'text', maxlength: '18', required: true });
        const err = h('p', { class: 'err-text', role: 'alert' }); const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Hesabı oluştur' });
        mount(w, dots(), h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => { err.textContent = ''; try { await api.post('/api/auth/register/complete', { token: s.token, username: un.value, password: pw.value, card_display_name: cn.value }); await start(); } catch (ex) { err.textContent = ex.message; } }); } },
          h('div', { class: 'field' }, h('label', { text: 'Hesap kullanıcı adı' }), un, hint),
          field('Şifre', pw, 'En az 10 karakter, harf ve rakam içermeli.'),
          field('Kartta görünecek isim', cn, 'Serbest isim; kullanıcı adından farklıdır ve sonra değiştirilebilir.'), err, btn));
      }
    };
    paint(); return w;
  };
  const forgotWizard = () => {
    const w = h('div'); const s = { step: 1, email: '' };
    const paint = () => {
      const err = h('p', { class: 'err-text', role: 'alert' });
      if (s.step === 1) {
        const email = h('input', { type: 'email', required: true, autocapitalize: 'none' }); const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Kod gönder' });
        mount(w, h('h2', { text: 'Şifre sıfırlama' }), h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => { try { const r = await api.post('/api/auth/forgot', { email: email.value }); s.email = email.value.trim().toLowerCase(); s.dev = r.dev_code; s.step = 2; paint(); } catch (ex) { err.textContent = ex.message; } }); } }, field('E-posta', email), err, btn), h('button', { class: 'back', type: 'button', text: '‹ Girişe dön', onClick: () => { mode = 'login'; draw(); } }));
      } else {
        const code = h('input', { type: 'text', inputmode: 'numeric', maxlength: '6', required: true }); const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '10' }); const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Şifreyi sıfırla' });
        mount(w, h('h2', { text: 'Yeni şifre' }), h('p', { class: 'muted', text: 'Bu e-posta ile bir hesap varsa, kod gönderildi.' }), s.dev ? h('div', { class: 'notice warn', text: `Geliştirme ortamı kodu: ${s.dev}` }) : null,
          h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => { try { await api.post('/api/auth/reset', { email: s.email, code: code.value.trim(), new_password: pw.value }); toast('Şifre sıfırlandı. Giriş yapabilirsin.', 'ok'); mode = 'login'; draw(); } catch (ex) { err.textContent = ex.message; } }); } }, field('Kod', code), field('Yeni şifre', pw), err, btn));
      }
    };
    paint(); return w;
  };
  draw();
  mount(root, box);
}

// ---------- Kabuk + gezinme ----------
const NAV = [['#/home', '⌂', 'Ana Sayfa'], ['#/ops', '⇄', 'İşlemler'], ['#/market', '💎', 'Borsa'], ['#/cards', '▭', 'Kartlarım'], ['#/profile', '☺', 'Profil']];
function shell(activeHash) {
  const screen = h('main', { class: 'screen', id: 'screen' });
  const nav = h('nav', { class: 'nav', 'aria-label': 'Ana gezinme' }, h('div', { class: 'nav-in' }, NAV.map(([href, ic, label]) =>
    h('a', { href, 'aria-current': activeHash === href ? 'page' : null }, h('span', { class: 'ic', 'aria-hidden': 'true', text: ic }), label))));
  mount(root, h('div', { class: 'shell' }, screen), nav);
  return screen;
}
const topbar = (extra) => h('div', { class: 'topbar' }, h('img', { class: 'logo', src: LOGO, alt: 'FOREVYE NEXUS' }),
  h('a', { class: 'bell', href: '#/notifications', 'aria-label': `Bildirimler${state.me.unread ? ` (${state.me.unread} okunmamış)` : ''}`, style: { textDecoration: 'none', color: 'inherit' } }, '🔔', state.me.unread ? h('span', { class: 'dot', text: String(Math.min(state.me.unread, 99)) }) : null), extra);

// ---------- Ana sayfa ----------
function homeView(screen) {
  const me = state.me;
  const amt = h('div', { class: 'amt', 'aria-live': 'polite' });
  const eye = h('button', { class: 'btn small', type: 'button' });
  const paintBal = () => { amt.textContent = state.hideBalance ? '•••••• ' + cur() : money(me.balance, cur()); eye.textContent = state.hideBalance ? 'Göster' : 'Gizle'; eye.setAttribute('aria-pressed', String(state.hideBalance)); };
  eye.addEventListener('click', () => { setHide(!state.hideBalance); paintBal(); });
  paintBal();
  const recent = h('div');
  const q = (href, ic, label) => h('a', { class: 'quick', href }, h('span', { class: 'ic', 'aria-hidden': 'true', text: ic }), label);
  mount(screen, topbar(),
    h('h2', { text: `Merhaba, ${me.user.username}` }), h('div', { style: { height: '10px' } }),
    me.user.suspended ? h('div', { class: 'notice bad', role: 'alert', text: 'Hesabınız askıda. Transfer ve yükleme yapılamaz. Ayrıntı için destekle iletişime geçin.' }) : null,
    h('div', { class: 'balance' }, h('div', { class: 'row between' }, h('span', { class: 'muted', text: 'FN bakiyesi' }), eye), amt, h('span', { class: 'chip', text: 'FN • oyun içi para birimi' })),
    me.default_card ? h('a', { href: `#/cards/${me.default_card.id}`, style: { display: 'block', marginBottom: '14px' } }, renderCard(me.default_card.design, me.default_card)) : null,
    h('div', { class: 'grid4' }, q('#/ops/send', '↗', 'Para gönder'), q('#/market', '💎', 'Borsa'), q('#/ops', '⇄', 'İşlemler'), q('#/cards', '▭', 'Kartlarım')),
    marketMini(),
    me.announcements.length ? h('div', { class: 'panel' }, h('h3', { text: 'Duyurular' }), me.announcements.map((a) => h('div', { class: 'item', style: { display: 'block' } }, h('div', { class: 'strong', text: a.title }), h('div', { class: 'muted small', text: a.body })))) : null,
    h('div', { class: 'panel' }, h('div', { class: 'row between' }, h('h3', { text: 'Son işlemler' }), h('a', { href: '#/ops/history', text: 'Tümünü gör' })), recent),
    h('p', { class: 'virtual', text: 'Sanal oyun ekonomisi • gerçek para değildir' }));
  load(recent, () => api.get('/api/transactions?limit=5'), (d) => d.items.length ? h('ul', { class: 'list' }, d.items.map(txRow)) : empty('Henüz işlem yok', 'İlk transferin burada görünecek.'));
}

// ---------- Profil ----------
function profileView(screen) {
  const holder = h('div');
  mount(screen, topbar(), holder);
  load(holder, () => api.get('/api/profile'), (p) => {
    const av = h('div', { class: 'avatar big', text: initial(p.username) });
    if (p.has_avatar) api.blob('/api/profile/avatar').then((b) => { av.replaceChildren(h('img', { src: URL.createObjectURL(b), alt: 'Profil fotoğrafı' })); }).catch(() => {});
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onChange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 512 * 1024) return toast('Görsel 512 KB’tan küçük olmalı', 'error');
      try { await api.putRaw('/api/profile/avatar', await f.arrayBuffer(), f.type); toast('Fotoğraf güncellendi', 'ok'); route(); } catch (er) { toast(er.message, 'error'); }
    } });
    const uc = p.username_change;
    const ucText = uc.allowed ? (uc.phase === 'initial' ? `İlk 48 saatte ${uc.initial_left} değiştirme hakkın kaldı.` : 'Kullanıcı adını şimdi değiştirebilirsin; sonrasında 15 gün beklemen gerekir.') : `Bir sonraki değiştirme: ${dt(uc.next_change_at)}`;
    const un = h('input', { type: 'text', maxlength: '20', autocapitalize: 'none', spellcheck: 'false', placeholder: 'yeni_kullanici_adi', disabled: !uc.allowed });
    const ubtn = h('button', { class: 'btn primary block', type: 'submit', text: 'Kullanıcı adını değiştir', disabled: !uc.allowed });
    const uerr = h('p', { class: 'err-text', role: 'alert' });
    const unForm = h('form', { onSubmit: (e) => { e.preventDefault(); if (!confirm('Kullanıcı adını değiştirmek istediğine emin misin?')) return; busy(ubtn, async () => { uerr.textContent = ''; try { await api.post('/api/profile/username', { username: un.value }); await refreshMe(); toast('Kullanıcı adı değişti', 'ok'); route(); } catch (ex) { uerr.textContent = ex.message; } }); } }, field('Yeni kullanıcı adı', un, ucText), uerr, ubtn);
    return h('div', {},
      h('div', { class: 'panel center' }, h('div', { class: 'row', style: { justifyContent: 'center' } }, av), h('h2', { text: `@${p.username}` }),
        h('div', { class: 'row wrap', style: { justifyContent: 'center' } }, h('button', { class: 'btn small', type: 'button', text: 'Fotoğraf yükle', onClick: () => file.click() }), p.has_avatar ? h('button', { class: 'btn small danger', type: 'button', text: 'Kaldır', onClick: async () => { await api.del('/api/profile/avatar'); route(); } }) : null), file),
      h('div', { class: 'panel' }, h('dl', { class: 'kv' },
        h('dt', { text: 'Hesap ID' }), h('dd', { text: p.id }), h('dt', { text: 'Üyelik' }), h('dd', { text: dt(p.created_at) }),
        h('dt', { text: 'E-posta' }), h('dd', {}, p.email, ' ', h('span', { class: `chip ${p.email_verified ? 'ok' : 'warn'}`, text: p.email_verified ? 'Doğrulandı' : 'Doğrulanmadı' })),
        h('dt', { text: 'Durum' }), h('dd', {}, h('span', { class: `chip ${p.status === 'active' ? 'ok' : 'bad'}`, text: p.status === 'active' ? 'Aktif' : 'Askıda' })))),
      h('div', { class: 'panel' }, h('h3', { text: 'Kullanıcı adı' }), unForm,
        p.username_history.length ? h('details', {}, h('summary', { text: 'Değişiklik geçmişi' }), h('ul', { class: 'list' }, p.username_history.map((x) => h('li', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't', text: `${x.old_name} → ${x.new_name}` }), h('div', { class: 'muted small', text: dt(x.changed_at) })))))) : null),
      h('div', { class: 'panel' }, h('ul', { class: 'list' },
        navItem('#/cards', '▭', 'Kartta görünen isim', 'Kart editöründen değiştir'), navItem('#/profile/security', '🔒', 'Güvenlik', 'Şifre, oturumlar'),
        navItem('#/vault', '★', 'Nexus Vault', 'Rozetler, temalar, kayıtlı tasarımlar'), navItem('#/notifications', '🔔', 'Bildirim merkezi', state.me.unread ? `${state.me.unread} okunmamış` : 'Hepsi okundu'),
        state.me.user.is_admin ? navItem('/admin.html', '⚙', 'Yönetim paneli', 'Yetkili hesaplar için') : null)),
      h('button', { class: 'btn danger block', type: 'button', text: 'Çıkış yap', onClick: async () => { try { await api.post('/api/auth/logout'); } finally { state.me = null; authView(); } } }),
      h('p', { class: 'virtual', text: 'FOREVYE NEXUS gerçek finansal hizmet sunmaz; tüm öğeler sanal oyun ekonomisidir.' }));
  });
}
const navItem = (href, ic, t, sub) => h('a', { class: 'item', href, style: { textDecoration: 'none', color: 'inherit' } }, h('div', { class: 'avatar', text: ic }), h('div', { class: 'grow' }, h('div', { class: 't', text: t }), h('div', { class: 'muted small', text: sub })), h('span', { class: 'muted', text: '›' }));

function securityView(screen) {
  const cur_ = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const nw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '10' });
  const err = h('p', { class: 'err-text', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Şifreyi değiştir' });
  const sessions = h('div');
  mount(screen, h('a', { class: 'back', href: '#/profile', text: '‹ Profil' }), h('h1', { text: 'Güvenlik' }),
    h('div', { class: 'panel' }, h('h3', { text: 'Şifre değiştir' }), h('form', { onSubmit: (e) => { e.preventDefault(); busy(btn, async () => { err.textContent = ''; try { await api.post('/api/profile/password', { current_password: cur_.value, new_password: nw.value }); toast('Şifre değişti; diğer oturumlar kapatıldı', 'ok'); cur_.value = ''; nw.value = ''; loadSessions(); } catch (ex) { err.textContent = ex.message; } }); } }, field('Mevcut şifre', cur_), field('Yeni şifre', nw, 'En az 10 karakter, harf ve rakam.'), err, btn)),
    h('div', { class: 'panel' }, h('h3', { text: 'Açık oturumlar' }), sessions));
  function loadSessions() {
    load(sessions, () => api.get('/api/profile/sessions'), (d) => h('div', {}, h('ul', { class: 'list' }, d.sessions.map((s) => h('li', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't', text: s.device }), h('div', { class: 'muted small', text: `Son etkinlik: ${dt(s.last_seen_at)}` })), s.current ? h('span', { class: 'chip ok', text: 'Bu cihaz' }) : null))),
      d.sessions.length > 1 ? h('button', { class: 'btn danger block', type: 'button', text: 'Diğer oturumları kapat', onClick: async (e) => busy(e.currentTarget, async () => { try { await api.post('/api/profile/sessions/revoke-others'); toast('Diğer oturumlar kapatıldı', 'ok'); loadSessions(); } catch (er) { toast(er.message, 'error'); } }) }) : null));
  }
  loadSessions();
}

function notificationsView(screen) {
  const holder = h('div');
  mount(screen, h('div', { class: 'topbar' }, h('h1', { text: 'Bildirimler' }), h('button', { class: 'btn small', type: 'button', text: 'Hepsini okundu yap', onClick: async () => { try { await api.post('/api/notifications/read', { all: true }); await refreshMe(); route(); } catch (e) { toast(e.message, 'error'); } } })), holder);
  load(holder, () => api.get('/api/notifications'), (d) => d.items.length ? h('div', { class: 'panel' }, h('ul', { class: 'list' }, d.items.map((n) => h('li', { class: 'item' }, h('div', { class: 'avatar', text: n.read_at ? '○' : '●' }), h('div', { class: 'grow', style: { whiteSpace: 'normal' } }, h('div', { class: n.read_at ? '' : 'strong', text: n.title }), n.body ? h('div', { class: 'muted small', text: n.body }) : null, h('div', { class: 'muted small', text: dt(n.created_at) })))))) : empty('Bildirim yok', 'Yeni bildirimler burada görünecek.'));
}

// ---------- Yönlendirici ----------
async function route() {
  if (!state.me) return;
  try { await refreshMe(); } catch (e) { if (e.status === 401) return; }
  const hash = location.hash || '#/home';
  const parts = hash.slice(2).split('/');
  const top = parts[0];
  const active = { home: '#/home', ops: '#/ops', market: '#/market', cards: '#/cards', 'editor-launch': '#/cards', profile: '#/profile', notifications: '#/profile', vault: '#/profile' }[top] || '#/home';
  const screen = shell(active);
  scrollTo(0, 0);
  if (top === 'ops') {
    if (parts[1] === 'send') return sendFlow(screen);
    if (parts[1] === 'history') return txList(screen, { moves: false });
    if (parts[1] === 'moves') return txList(screen, { moves: true });
    if (parts[1] === 'gift') return giftFlow(screen);
    return opsMenu(screen);
  }
  if (top === 'market') return marketView(screen);
  if (top === 'cards') return parts[1] === 'new' ? cardNew(screen) : parts[1] ? cardDetail(screen, parts[1]) : cardsList(screen);
  if (top === 'editor-launch') return editorLaunch(screen, parts[1]);
  if (top === 'profile') return parts[1] === 'security' ? securityView(screen) : profileView(screen);
  if (top === 'notifications') return notificationsView(screen);
  if (top === 'vault') return vaultView(screen);
  return homeView(screen);
}

async function start() {
  try { await refreshMe(); } catch { rememberNext(); return authView(location.hash.startsWith('#/id-kayit/') ? 'idreg' : 'login'); }
  const next = takeNext(); if (next) { if (location.hash === next) return route(); location.hash = next; return; }   // hashchange → route()
  if (!location.hash || location.hash.startsWith('#/id-kayit/')) location.hash = '#/home';
  route();
}
addEventListener('hashchange', route);
onUnauth(() => { state.me = null; authView(); toast('Oturumun sona erdi. Lütfen tekrar giriş yap.', 'error'); });
start();
