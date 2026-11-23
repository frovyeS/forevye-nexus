import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../src/worker.js';
import { makeEnv, client, register, sql, one } from './helpers.mjs';
import { defaultDesign, validateDesign } from '../shared/card-contract.js';

const EDITOR = 'https://bank.example/editor/';
const ORIGIN = 'https://bank.example';
const NEXUS = 'https://nexus.test';

// Editör (ayrı site) gibi davranır: çerez yok, Origin başlığı var, Bearer jeton.
async function asEditor(env, method, path, { body, token, origin = ORIGIN } = {}) {
  const headers = { 'content-type': 'application/json', origin, 'cf-connecting-ip': '5.5.5.5' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(NEXUS + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, {});
  let data = null; try { data = await res.clone().json(); } catch { /* json değil */ }
  return { status: res.status, data, res };
}
const ticketOf = (url) => new URL(url).hash.replace(/^#t=/, '');
const circle = (x, y) => ({ id: 'u1', type: 'shape', name: 'Daire', locked: false, visible: true, zIndex: 0, properties: { kind: 'circle', x, y, width: 60, height: 60, rotation: 0, opacity: 1, fill: '#336699', stroke: 'none', strokeWidth: 0, flipX: false, flipY: false, lockRatio: false, effects: [] } });

async function setup(extra = {}) {
  const env = makeEnv({ EDITOR_URL: EDITOR, MAX_CARDS: '3', ...extra });
  const u = await register(env, 'e@example.com', 'editor_one', { card: 'Ada Lovelace' });
  return { env, u, card: (await u.cl.get('/api/cards')).data.cards[0] };
}

test('editör: bilet → jeton → kayıt; tasarım Nexus kartına işlenir, sürüm ve geçmiş sunucuda artar', async () => {
  const { env, u, card } = await setup();
  const t = await u.cl.post('/api/editor/ticket', { card_id: card.id });
  assert.equal(t.status, 200);
  assert.ok(t.data.url.startsWith(EDITOR + '#t='), 'bilet URL’nin # kısmında (sunucuya/yönlendirene gitmez)');
  const ticket = ticketOf(t.data.url);

  const ex = await asEditor(env, 'POST', '/api/editor/exchange', { body: { ticket } });
  assert.equal(ex.status, 200);
  assert.equal(ex.res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(ex.data.mode, 'edit'); assert.equal(ex.data.card.id, card.id); assert.equal(ex.data.user.username, 'editor_one');
  assert.ok(ex.data.token.length >= 40);
  assert.equal((await asEditor(env, 'POST', '/api/editor/exchange', { body: { ticket } })).status, 400, 'bilet tek kullanımlık');

  const d = ex.data.card.design; d.layers.push(circle(620, 250)); d.userDisplayName = 'Ada L.';
  const sv = await asEditor(env, 'PUT', '/api/editor/card', { token: ex.data.token, body: { design: d } });
  assert.equal(sv.status, 200); assert.equal(sv.data.card.version, 2); assert.equal(sv.data.card.display_name, 'Ada L.');
  assert.equal(sv.data.return_path, `/#/cards/${card.id}`);
  const fromNexus = (await u.cl.get(`/api/cards/${card.id}`)).data;
  assert.equal(fromNexus.design.layers.length, d.layers.length, 'editörde yapılan Nexus’ta görünür');
  assert.equal(fromNexus.design.designId, card.id); assert.equal(fromNexus.design.version, 2);
  assert.equal((await sql(env, 'SELECT * FROM card_design_history WHERE card_id = ?', card.id)).length, 2);
  // aynı tasarımı tekrar kaydetmek sürümü artırmaz
  const again = await asEditor(env, 'PUT', '/api/editor/card', { token: ex.data.token, body: { design: sv.data.card.design } });
  assert.equal(again.data.card.version, 2);
});

test('editör: sunucu kuralları — serbest yerleşim, sistem katmanı, korunan alan, kimlik sahteciliği', async () => {
  const { env, u, card } = await setup();
  const ex = await asEditor(env, 'POST', '/api/editor/exchange', { body: { ticket: ticketOf((await u.cl.post('/api/editor/ticket', { card_id: card.id })).data.url) } });
  const tok = ex.data.token, base = ex.data.card.design;
  const put = (design, extra = {}) => asEditor(env, 'PUT', '/api/editor/card', { token: tok, body: { design, ...extra } });
  const onChip = JSON.parse(JSON.stringify(base)); onChip.layers.push(circle(60, 190));
  assert.equal((await put(onChip)).status, 200, 'dekoratif nesne çipin üstüne konabilir (v3 serbest yerleşim)');
  const sys = JSON.parse(JSON.stringify(base)); sys.layers.push({ id: 's1', type: 'system_chip', properties: {} });
  assert.equal((await put(sys)).status, 400);
  assert.equal((await put(base, { card_token: 'NXC-HACK-HACK' })).data.error.code, 'protected_field');
  const forged = JSON.parse(JSON.stringify(base)); forged.designId = 'baskasinin'; forged.ownerId = 'baskasi'; forged.version = 999;
  const r = await put(forged);
  assert.equal(r.status, 200); assert.equal(r.data.card.design.designId, card.id); assert.equal(r.data.card.design.ownerId, u.me.user.id); assert.notEqual(r.data.card.version, 999);
});

test('editör: yeni kart modu; ilk kayıtta oluşur, sonrakiler aynı kartı günceller; kart sınırı', async () => {
  const { env, u } = await setup();
  const t = await u.cl.post('/api/editor/ticket', { label: 'Oyun harcamaları' });
  const ex = await asEditor(env, 'POST', '/api/editor/exchange', { body: { ticket: ticketOf(t.data.url) } });
  assert.equal(ex.data.mode, 'new'); assert.equal(ex.data.card, null); assert.equal(ex.data.label, 'Oyun harcamaları');
  assert.equal(validateDesign(ex.data.base_design).ok, true);
  const design = ex.data.base_design; design.userDisplayName = 'Yeni Kart';
  const c1 = await asEditor(env, 'PUT', '/api/editor/card', { token: ex.data.token, body: { design } });
  assert.equal(c1.status, 201); assert.equal(c1.data.created, true); assert.equal(c1.data.card.label, 'Oyun harcamaları');
  design.userDisplayName = 'Yeni Kart 2';
  const c2 = await asEditor(env, 'PUT', '/api/editor/card', { token: ex.data.token, body: { design } });
  assert.equal(c2.status, 200); assert.equal(c2.data.card.id, c1.data.card.id); assert.equal(c2.data.card.version, 2);
  assert.equal((await u.cl.get('/api/cards')).data.cards.length, 2);
  // sınır: MAX_CARDS=3 → bir yenisi daha olur, sonrası olmaz
  for (const code of [201, 400]) {
    const tx = await asEditor(env, 'POST', '/api/editor/exchange', { body: { ticket: ticketOf((await u.cl.post('/api/editor/ticket', {})).data.url) } });
    const r = await asEditor(env, 'PUT', '/api/editor/card', { token: tx.data.token, body: { design: tx.data.base_design } });
    assert.equal(r.status, code);
    if (code === 400) assert.equal(r.data.error.code, 'card_limit');
  }
});

test('editör: başkasının kartı için bilet alınamaz; jeton yalnızca editör uçlarında geçer; süre dolunca düşer', async () => {
  const { env, u, card } = await setup();
  const other = await register(env, 'o@example.com', 'other_one');
  assert.equal((await other.cl.post('/api/editor/ticket', { card_id: card.id })).status, 404);
  assert.equal((await client(env).post('/api/editor/ticket', {})).status, 401, 'oturumsuz bilet alınamaz');
  const ex = await asEditor(env, 'POST', '/api/editor/exchange', { body: { ticket: ticketOf((await u.cl.post('/api/editor/ticket', { card_id: card.id })).data.url) } });
  // jeton para/profil uçlarını açmaz (onlar çerez ister)
  for (const p of ['/api/wallet', '/api/me', '/api/cards']) assert.equal((await asEditor(env, 'GET', p, { token: ex.data.token })).status, 401, p);
  // biletin süresi 5 dk
  const t2 = ticketOf((await u.cl.post('/api/editor/ticket', { card_id: card.id })).data.url);
  env.__NOW += 6 * 60 * 1000;
  assert.equal((await asEditor(env, 'POST', '/api/editor/exchange', { body: { ticket: t2 } })).status, 400, 'bilet süresi doldu');
  // jeton 2 saat kayar; kullanılmazsa düşer
  env.__NOW += 121 * 60 * 1000;
  assert.equal((await asEditor(env, 'GET', '/api/editor/card', { token: ex.data.token })).data.error.code, 'editor_token');
  // veritabanında yalnızca özet saklanır
  assert.ok(!(await sql(env, 'SELECT token_hash FROM editor_tokens')).some((r) => r.token_hash === ex.data.token));
});

test('editör: CORS yalnızca EDITOR_URL kaynağına açık; adres ayarsızsa bilet verilmez', async () => {
  const { env, u } = await setup();
  const ok = await asEditor(env, 'OPTIONS', '/api/editor/card');
  assert.equal(ok.status, 204); assert.equal(ok.res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(ok.res.headers.get('access-control-allow-headers'), /authorization/);
  assert.equal((await asEditor(env, 'OPTIONS', '/api/editor/card', { origin: 'https://evil.example' })).status, 403);
  const evil = await asEditor(env, 'POST', '/api/editor/exchange', { body: { ticket: 'x'.repeat(30) }, origin: 'https://evil.example' });
  assert.equal(evil.res.headers.get('access-control-allow-origin'), null);
  // /ticket çerezli uçtur: CORS yok
  assert.notEqual((await asEditor(env, 'OPTIONS', '/api/editor/ticket')).status, 204);
  const env2 = makeEnv({ EDITOR_URL: '' });
  const u2 = await register(env2, 'x@example.com', 'no_editor');
  assert.equal((await u2.cl.post('/api/editor/ticket', {})).data.error.code, 'editor_unavailable');
});

test('eski (sürüm 1) kartlar okunurken sürüm 2’ye çevrilir; geri dönüş çalışır; veri satırı bozulmaz', async () => {
  const { env, u, card } = await setup();
  const v1 = { v: 1, background: { type: 'gradient', colors: ['#0b1020', '#1b2a6b'], angle: 135 }, pattern: 'dots', accent: '#4de2c5', textColor: '#ffffff', decor: [{ id: 'star', x: 272, y: 108, size: 24 }] };
  await env.DB.prepare('UPDATE cards SET design_json = ? WHERE id = ?').bind(JSON.stringify(v1), card.id).run();
  await env.DB.prepare('UPDATE card_design_history SET design_json = ? WHERE card_id = ?').bind(JSON.stringify(v1), card.id).run();
  const got = (await u.cl.get(`/api/cards/${card.id}`)).data;
  assert.ok(Array.isArray(got.design.layers) && got.design.layers[0].type === 'background');
  assert.equal(got.design.userDisplayName, 'Ada Lovelace');
  assert.equal(got.design.layers[0].properties.mode, 'gradient');
  assert.equal(JSON.parse((await one(env, 'SELECT design_json FROM cards WHERE id = ?', card.id)).design_json).v, 1, 'ham kayıt değişmedi');
  assert.equal((await u.cl.get('/api/me')).data.default_card.design.layers.length >= 1, true);
  const rv = await u.cl.post(`/api/cards/${card.id}/revert`, { version: 1 });
  assert.equal(rv.status, 200); assert.ok(Array.isArray(rv.data.design.layers));
  assert.equal(validateDesign(rv.data.design).ok, true, 'geri dönen tasarım güncel kurallara uyar');
});

// ---- Ortak posta (Mikro-Klima Worker üzerinden Brevo) ----
test('posta: relay sağlayıcısı imzalı isteği Mikro-Klima’ya gönderir (Nexus’ta Brevo anahtarı gerekmez)', async () => {
  const env = makeEnv({ EMAIL_PROVIDER: 'relay', MAIL_RELAY_URL: 'https://mikro.example/', GIFTCARD_API_SECRET: 's'.repeat(32) });
  const real = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{"ok":true}', { status: 200 }); };
  try {
    const r = await client(env).post('/api/auth/register/start', { email: 'posta@example.com' });
    assert.equal(r.status, 200);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://mikro.example/api/ext/mail');
    const raw = calls[0].init.body, ts = calls[0].init.headers['x-nx-timestamp'];
    assert.equal(calls[0].init.headers['x-nx-signature'], createHmac('sha256', 's'.repeat(32)).update(`${ts}.${raw}`).digest('hex'));
    const sent = JSON.parse(raw);
    assert.equal(sent.to, 'posta@example.com'); assert.match(sent.subject, /doğrulama kodu/); assert.match(sent.text, /Kodunuz: \d{6}/);
  } finally { globalThis.fetch = real; }
});

test('posta: röle çökerse ve doğrudan Brevo da yoksa kayıt 503 verir (sessiz başarı yok); Brevo varsa yedeğe düşer', async () => {
  const real = globalThis.fetch; const hosts = [];
  globalThis.fetch = async (url) => { hosts.push(new URL(url).host); return new Response('x', { status: new URL(url).host === 'mikro.example' ? 500 : 201 }); };
  try {
    const bare = makeEnv({ EMAIL_PROVIDER: 'relay', MAIL_RELAY_URL: 'https://mikro.example', GIFTCARD_API_SECRET: 's'.repeat(32) });
    const r = await client(bare).post('/api/auth/register/start', { email: 'a@example.com' });
    assert.equal(r.status, 503); assert.equal(r.data.error.code, 'mail_unavailable');
    hosts.length = 0;
    const backup = makeEnv({ EMAIL_PROVIDER: 'relay', MAIL_RELAY_URL: 'https://mikro.example', GIFTCARD_API_SECRET: 's'.repeat(32), BREVO_API_KEY: 'k', EMAIL_FROM: 'Nexus <n@example.com>' });
    assert.equal((await client(backup).post('/api/auth/register/start', { email: 'b@example.com' })).status, 200);
    assert.deepEqual(hosts, ['mikro.example', 'api.brevo.com']);
  } finally { globalThis.fetch = real; }
});

test('editör: 0004 migration canlı DB\'ye uygulanmamış olsa da bilet üretilir (tablolar kendiliğinden kurulur)', async () => {
  const { env, u } = await setup();
  env.DB.raw.exec('DROP TABLE editor_tickets; DROP TABLE editor_tokens;');
  const t = await u.cl.post('/api/editor/ticket', { label: 'gg' });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const ex = await asEditor(env, 'POST', '/api/editor/exchange', { body: { ticket: ticketOf(t.data.url) } });
  assert.equal(ex.status, 200);
});

// ---- Sözleşme sürüm 3: yön, sistem düzeni, katman önceliği, geriye dönük uyum ----
import { readStoredDesign, defaultPortraitDesign } from '../shared/card-contract.js';
const R = globalThis.FNXRules;

test('v3: yatay ve dikey tuval; dikey kart geçerli, sistem düzeni dikey varsayılanlara yerleşir', () => {
  const p = defaultPortraitDesign('Ada Lovelace');
  const v = validateDesign(p);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.design.canvas, { width: 540, height: 856 });
  assert.equal(v.design.orientation, 'portrait');
  assert.deepEqual(v.design.sys, R.sysDefaults('portrait'));
  const bad = { ...p, canvas: { width: 856, height: 540 } };
  assert.equal(validateDesign(bad).ok, false, 'yön ile tuval boyutu uyuşmalı');
  assert.equal(validateDesign({ ...p, orientation: 'diagonal' }).ok, false);
});

test('v3: dekoratif katmanlar serbest (üst üste, kart dışına taşan); sistem öğeleri katman olarak gönderilemez', () => {
  const d = defaultDesign('Test');
  const big = (id, x, y) => ({ id, type: 'shape', name: 'Büyük', locked: false, visible: true, zIndex: 0, properties: { kind: 'circle', x, y, width: 900, height: 900, rotation: 0, opacity: 1, fill: '#FFD700', stroke: 'none', strokeWidth: 0, flipX: false, flipY: false, lockRatio: false, effects: [] } });
  d.layers.push(big('a1', -300, -300), big('a2', 100, 100), big('a3', 2000, 2000));   // logo/çip/QR üstünde, birbirinin üstünde, kart dışında
  const v = validateDesign(d);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  for (const t of ['system_chip', 'system_brand', 'system_qr', 'user_name']) {
    const x = defaultDesign('Test'); x.layers.push({ id: 'zz', type: t, properties: {} });
    assert.equal(validateDesign(x).ok, false, t + ' reddedilir');
  }
});

test('v3: sistem öğeleri kart sınırına kırpılır, birbirini kapatamaz; sistem rengi kontrastı denetlenir', () => {
  const d = defaultDesign('Test');
  d.sys = { chip: { x: -500, y: 9999, scale: 5 }, qr: { x: 100, y: 100, scale: 1 } };
  const v = validateDesign(d);
  const c = v.design.sys.chip, cvs = R.canvasOf('landscape');
  assert.ok(c.x >= R.MARGIN && c.y + 78 * c.scale <= cvs.height - R.MARGIN + 0.5 && c.scale <= 1.6, 'çip kart içine kırpıldı');
  const d2 = defaultDesign('Test'); d2.sys = { name: { x: 48, y: 322, scale: 1 } };       // adı kod alanının üstüne taşı
  const v2 = validateDesign(d2);
  assert.equal(v2.ok, false); assert.match(v2.errors.join(' '), /birbirini kapatıyor/);
  assert.deepEqual(R.sysConflicts(v2.design.sys, v2.design.qrStyle), [], 'doğrulanan tasarımda çakışma kalmaz');
  const d3 = defaultDesign('Test'); d3.layers[0].properties.colors = ['#101010', '#202020']; d3.sysStyle = { color: '#181818' };
  assert.equal(validateDesign(d3).ok, false, 'okunmayan sistem yazı rengi reddedilir');
});

test('v3: v2 (yönsüz, sys\'siz, effects:[shadow]) tasarım geriye dönük uyumlu okunur ve kaydedilebilir', () => {
  const v2 = defaultDesign('Eski Kart'); delete v2.orientation; delete v2.sys; delete v2.qrStyle;
  v2.layers.push({ id: 'o1', type: 'shape', name: 'Eski', locked: false, visible: true, zIndex: 0, properties: { kind: 'roundrect', x: 600, y: 200, width: 100, height: 80, rotation: 0, opacity: 1, fill: '#336699', stroke: 'none', strokeWidth: 0, flipX: false, flipY: false, lockRatio: false, effects: ['shadow', 'frost'] } });
  const out = readStoredDesign(JSON.stringify(v2), 'Eski Kart', 7);
  assert.equal(out.orientation, 'landscape'); assert.equal(out.version, 7); assert.equal(out.userDisplayName, 'Eski Kart');
  assert.deepEqual(out.sys, R.sysDefaults('landscape'));
  const l = out.layers.find((x) => x.id === 'o1').properties;
  assert.ok(l.shadow > 0 && !l.effects.includes('shadow') && l.effects.includes('frost'), 'gölge sayısal alana taşındı');
  assert.equal(l.radius, 44, 'yumuşak blok varsayılan yarıçapı korunur');
  assert.equal(validateDesign(out).ok, true);
});

test('v3: yeni tasarımlar (dikey, sys, QR simgesi, yeni şekiller) editör jetonuyla kaydedilir ve Nexus’ta aynen okunur', async () => {
  const { env, u, card } = await setup();
  const ex = await asEditor(env, 'POST', '/api/editor/exchange', { body: { ticket: ticketOf((await u.cl.post('/api/editor/ticket', { card_id: card.id })).data.url) } });
  const p = defaultPortraitDesign('Ada L.');
  p.qrStyle = 'icon'; p.chipStyle = 'titanium'; p.sys.chip = { x: 60, y: 300, scale: 1.2 };
  p.layers.push({ id: 'g1', type: 'light', name: 'Işık', locked: false, visible: true, zIndex: 0, properties: { kind: 'glow', x: 100, y: 100, width: 400, height: 400, rotation: 0, opacity: 0.8, fill: '#9EDBFF', stroke: 'none', strokeWidth: 0, glow: 12, glowColor: '#FFFFFF', shadow: 8, flipX: false, flipY: false, lockRatio: false, effects: [] } });
  const sv = await asEditor(env, 'PUT', '/api/editor/card', { token: ex.data.token, body: { design: p } });
  assert.equal(sv.status, 200, JSON.stringify(sv.data));
  const got = (await u.cl.get(`/api/cards/${card.id}`)).data.design;
  assert.equal(got.orientation, 'portrait'); assert.equal(got.qrStyle, 'icon'); assert.equal(got.chipStyle, 'titanium');
  assert.deepEqual(got.sys.chip, { x: 60, y: 300, scale: 1.2 });
  const g = got.layers.find((l) => l.id === 'g1'); assert.equal(g.type, 'light'); assert.equal(g.properties.glow, 12);
  // çakışan sistem düzeni sunucuda reddedilir
  const bad = JSON.parse(JSON.stringify(got)); bad.sys.name = { x: 40, y: 652, scale: 1 };
  const r = await asEditor(env, 'PUT', '/api/editor/card', { token: ex.data.token, body: { design: bad } });
  assert.equal(r.status, 400); assert.equal(r.data.error.code, 'invalid_design');
});
