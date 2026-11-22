import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { makeEnv, register, fund, sql, one, D } from './helpers.mjs';

const PASS = 'https://pass.example/nexus-pass/';
const ORIGIN = 'https://pass.example';
const NEXUS = 'https://nexus.test';
const ticketOf = (url) => new URL(url).hash.replace(/^#t=/, '');

// Pass sitesi gibi davranır: çerez yok, Origin başlığı var, Bearer jeton.
async function asPass(env, method, path, { body, token, origin = ORIGIN } = {}) {
  const headers = { 'content-type': 'application/json', origin, 'cf-connecting-ip': '7.7.7.7' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(NEXUS + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, {});
  let data = null; try { data = await res.clone().json(); } catch { /* json değil */ }
  return { status: res.status, data, res };
}

async function setup(extra = {}) {
  const env = makeEnv({ PASS_URL: PASS, ...extra });
  const u = await register(env, 'p@example.com', 'pass_one');
  const uid = (await one(env, 'SELECT id FROM users WHERE username = ?', 'pass_one')).id;
  const t = env.__NOW;
  await env.DB.prepare(`INSERT INTO nxp_products (id, app, name, description, features_json, price, duration_sec, status, sort, created_at, updated_at) VALUES ('weather-premium-30','Mikro-Klima Hava','Premium · 30 gün','Hava premium','["Reklamsız","Gelişmiş tahmin"]',5000,${30 * 86400},'on',0,${t},${t})`).run();
  return { env, u, uid };
}
async function login(env, u) {
  const tk = await u.cl.post('/api/pass/ticket');
  assert.equal(tk.status, 200);
  const ex = await asPass(env, 'POST', '/api/pass/exchange', { body: { ticket: ticketOf(tk.data.url) } });
  assert.equal(ex.status, 200);
  return ex.data.token;
}

test('pass: bilet → jeton; bilet tek kullanımlık, adres PASS_URL#t=…', async () => {
  const { env, u } = await setup();
  const tk = await u.cl.post('/api/pass/ticket');
  assert.ok(tk.data.url.startsWith(PASS + '#t='));
  const t = ticketOf(tk.data.url);
  const a = await asPass(env, 'POST', '/api/pass/exchange', { body: { ticket: t } });
  assert.equal(a.status, 200); assert.ok(a.data.token);
  assert.equal(a.res.headers.get('access-control-allow-origin'), ORIGIN);
  const b = await asPass(env, 'POST', '/api/pass/exchange', { body: { ticket: t } });
  assert.equal(b.status, 400);
  assert.equal((await asPass(env, 'POST', '/api/pass/exchange', { body: { ticket: 'x'.repeat(30) } })).status, 400);
});

test('pass: oturumsuz bilet alınamaz; PASS_URL yoksa 503', async () => {
  const { env, u } = await setup();
  const anon = await asPass(env, 'POST', '/api/pass/ticket', {});
  assert.equal(anon.status, 403);   // CSRF başlığı yok
  const { env: e2, u: u2 } = await setup({ PASS_URL: '' });
  assert.equal((await u2.cl.post('/api/pass/ticket')).status, 503);
  void env; void u;
});

test('pass: CORS yalnızca PASS_URL kaynağına açık; preflight çalışır', async () => {
  const { env } = await setup();
  const ok = await worker.fetch(new Request(NEXUS + '/api/pass/purchase', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } }), env, {});
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await worker.fetch(new Request(NEXUS + '/api/pass/purchase', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env, {});
  assert.equal(bad.status, 403);
  const r = await asPass(env, 'GET', '/api/pass/products', { origin: 'https://evil.example', token: 'a'.repeat(43) });
  assert.equal(r.res.headers.get('access-control-allow-origin'), null);
});

test('pass: jeton yalnızca /api/pass/* için geçerli (para, profil, kart açılmaz); jetonsuz 401', async () => {
  const { env, u } = await setup();
  const tok = await login(env, u);
  assert.equal((await asPass(env, 'GET', '/api/pass/products')).status, 401);
  assert.equal((await asPass(env, 'GET', '/api/pass/products', { token: 'b'.repeat(43) })).status, 401);
  for (const p of ['/api/wallet', '/api/profile', '/api/cards', '/api/me']) assert.equal((await asPass(env, 'GET', p, { token: tok })).status, 401, p);
  assert.equal((await asPass(env, 'POST', '/api/transfers', { token: tok, body: {} })).status, 403);
});

test('pass: katalog, satın alma → bakiye düşer, üyelik açılır, defter ve geçmiş doğru', async () => {
  const { env, u, uid } = await setup();
  await fund(env, uid, 20000);
  const tok = await login(env, u);
  const list = await asPass(env, 'GET', '/api/pass/products', { token: tok });
  assert.equal(list.data.products.length, 1);
  assert.deepEqual(list.data.products[0], { id: 'weather-premium-30', app: 'Mikro-Klima Hava', name: 'Premium · 30 gün', price: 5000, dur: 30 * 86400, desc: 'Hava premium', features: ['Reklamsız', 'Gelişmiş tahmin'], status: 'on' });
  assert.equal((await asPass(env, 'GET', '/api/pass/product?id=weather-premium-30', { token: tok })).data.product.id, 'weather-premium-30');
  assert.equal((await asPass(env, 'GET', '/api/pass/product?id=yok-boyle-paket', { token: tok })).data.product, null);

  const r = await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: 'weather-premium-30', idem: 'idem_abcdefgh1234' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.balance, 15000);
  assert.equal(r.data.entitlement.expires - r.data.entitlement.starts, 30 * 86400 * 1000);
  const led = await sql(env, "SELECT type, amount, tx_ref FROM ledger_entries WHERE user_id = ? AND type = 'purchase'", uid);
  assert.equal(led.length, 1); assert.equal(led[0].amount, -5000); assert.equal(led[0].tx_ref, r.data.purchase.id);

  const me = await asPass(env, 'GET', '/api/pass/me', { token: tok });
  assert.equal(me.data.balance, 15000);
  assert.equal(me.data.entitlements.length, 1);
  assert.equal(me.data.entitlements[0].status, 'active');
  assert.equal(me.data.entitlements[0].pid, 'weather-premium-30');
  assert.equal(me.data.entitlements[0].snap.price, 5000);
  const h = await asPass(env, 'GET', '/api/pass/purchases?page=0&size=5', { token: tok });
  assert.equal(h.data.items.length, 1); assert.equal(h.data.items[0].status, 'success'); assert.equal(h.data.more, false);
});

test('pass: aynı idem anahtarı tekrar gönderilince ikinci kez düşmez; başka pakete anahtar yeniden kullanılamaz', async () => {
  const { env, u, uid } = await setup();
  await fund(env, uid, 20000);
  const tok = await login(env, u);
  const body = { pid: 'weather-premium-30', idem: 'idem_replay0001' };
  const a = await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body });
  const b = await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body });
  assert.equal(b.status, 200); assert.equal(b.data.ok, true); assert.equal(b.data.replayed, true);
  assert.equal(b.data.purchase.id, a.data.purchase.id);
  assert.equal((await sql(env, "SELECT COUNT(*) AS c FROM ledger_entries WHERE type = 'purchase'"))[0].c, 1);
  const t = env.__NOW;
  await env.DB.prepare(`INSERT INTO nxp_products (id, app, name, price, duration_sec, created_at, updated_at) VALUES ('other-pack','Diğer','Paket',100,86400,${t},${t})`).run();
  assert.equal((await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: 'other-pack', idem: 'idem_replay0001' } })).status, 409);
});

test('pass: çift üyelik engellenir (already_active); süre dolunca yeniden alınabilir', async () => {
  const { env, u, uid } = await setup();
  await fund(env, uid, 30000);
  const tok = await login(env, u);
  assert.equal((await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: 'weather-premium-30', idem: 'idem_first00001' } })).data.ok, true);
  const dup = await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: 'weather-premium-30', idem: 'idem_second0002' } });
  assert.equal(dup.status, 200); assert.equal(dup.data.ok, false); assert.equal(dup.data.code, 'already_active');
  assert.equal((await sql(env, "SELECT COUNT(*) AS c FROM ledger_entries WHERE type = 'purchase'"))[0].c, 1);
  env.__NOW += 31 * D;
  const tok2 = await login(env, u);
  const again = await asPass(env, 'POST', '/api/pass/purchase', { token: tok2, body: { pid: 'weather-premium-30', idem: 'idem_third00003' } });
  assert.equal(again.data.ok, true);
  const me = await asPass(env, 'GET', '/api/pass/me', { token: tok2 });
  assert.deepEqual(me.data.entitlements.map((e) => e.status).sort(), ['active', 'expired']);
});

test('pass: yetersiz bakiye → ok:false/insufficient, bakiye değişmez; kapalı paket → unavailable', async () => {
  const { env, u, uid } = await setup();
  await fund(env, uid, 1200);
  const tok = await login(env, u);
  const r = await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: 'weather-premium-30', idem: 'idem_poor00001' } });
  assert.equal(r.status, 200); assert.equal(r.data.ok, false); assert.equal(r.data.code, 'insufficient');
  assert.equal(r.data.balance, 1200); assert.equal(r.data.missing, 3800);
  assert.equal((await sql(env, 'SELECT COUNT(*) AS c FROM nxp_purchases'))[0].c, 0);
  await env.DB.prepare("UPDATE nxp_products SET status = 'off'").run();
  const off = await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: 'weather-premium-30', idem: 'idem_off000001' } });
  assert.equal(off.data.code, 'unavailable');
  assert.equal((await asPass(env, 'GET', '/api/pass/products', { token: tok })).data.products.length, 0);
});

test('pass: istemci fiyat/süre dayatamaz; geçersiz anahtar ve paket kimliği reddedilir', async () => {
  const { env, u, uid } = await setup();
  await fund(env, uid, 20000);
  const tok = await login(env, u);
  const r = await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: 'weather-premium-30', idem: 'idem_cheat0001', price: 1, dur: 99999999 } });
  assert.equal(r.data.balance, 15000);
  assert.equal(r.data.purchase.dur, 30 * 86400);
  assert.equal((await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: 'weather-premium-30', idem: 'kisa' } })).status, 400);
  assert.equal((await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: "x'; DROP TABLE users;--", idem: 'idem_inject001' } })).status, 400);
});

test('pass: askıdaki hesap satın alamaz', async () => {
  const { env, u, uid } = await setup();
  await fund(env, uid, 20000);
  const tok = await login(env, u);
  await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(uid).run();
  const r = await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: 'weather-premium-30', idem: 'idem_susp00001' } });
  assert.equal(r.status, 403);
  assert.equal((await sql(env, "SELECT COUNT(*) AS c FROM ledger_entries WHERE type = 'purchase'"))[0].c, 0);
});

test('pass: jeton süresi kayar ve 8 saatte kesin biter', async () => {
  const { env, u } = await setup();
  const tok = await login(env, u);
  env.__NOW += 20 * 60 * 1000;
  assert.equal((await asPass(env, 'GET', '/api/pass/me', { token: tok })).status, 200);
  env.__NOW += 20 * 60 * 1000;   // son kullanımdan 20 dk: kaydığı için hâlâ geçerli
  assert.equal((await asPass(env, 'GET', '/api/pass/me', { token: tok })).status, 200);
  env.__NOW += 9 * 3600 * 1000;
  assert.equal((await asPass(env, 'GET', '/api/pass/me', { token: tok })).status, 401);
});

test('pass: internal/entitlement — anahtar şart; user_id ve id_user_id ile sorgulanır; iade üyeliği kapatır', async () => {
  const { env, u, uid } = await setup();
  await fund(env, uid, 20000);
  const tok = await login(env, u);
  const buy = await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: 'weather-premium-30', idem: 'idem_ent000001' } });
  const call = (body, key = 'internal-test-key') => asPass(env, 'POST', '/api/internal/entitlement', { body, token: key });
  assert.equal((await call({ user_id: uid }, 'yanlis-anahtar-yanlis')).status, 401);
  const q = await call({ user_id: uid });
  assert.equal(q.data.active, true);
  assert.equal(q.data.entitlements[0].product_id, 'weather-premium-30');
  assert.equal((await call({ user_id: uid, app: 'Mikro-Klima Hava', product_id: 'weather-premium-30' })).data.active, true);
  assert.equal((await call({ user_id: uid, app: 'Başka Uygulama' })).data.active, false);
  await env.DB.prepare("INSERT INTO id_links (user_id, id_user_id, linked_at) VALUES (?, 'id-user-42', 1)").bind(uid).run();
  assert.equal((await call({ id_user_id: 'id-user-42' })).data.active, true);
  assert.equal((await call({ user_id: 'bilinmeyen-kullanici-id' })).data.active, false);
  assert.equal((await call({})).status, 400);

  // İade (yönetici ters kaydı / internal refund) üyeliği hemen kapatır.
  const rf = await asPass(env, 'POST', '/api/internal/refund', { body: { ref: buy.data.purchase.id }, token: 'internal-test-key' });
  assert.equal(rf.status, 201);
  assert.equal((await call({ user_id: uid })).data.active, false);
  const me = await asPass(env, 'GET', '/api/pass/me', { token: tok });
  assert.equal(me.data.entitlements[0].status, 'cancelled');
  assert.equal(me.data.balance, 20000);
  assert.equal((await asPass(env, 'GET', '/api/pass/purchases', { token: tok })).data.items[0].status, 'cancelled');
  // iadeden sonra yeniden alınabilir
  assert.equal((await asPass(env, 'POST', '/api/pass/purchase', { token: tok, body: { pid: 'weather-premium-30', idem: 'idem_ent000002' } })).data.ok, true);
});

test('pass yönetici: katalog yalnızca süper yönetici tarafından değiştirilir; denetim kaydı düşer', async () => {
  const { env, u, uid } = await setup();
  const body = { id: 'store-premium-7', app: 'Mağaza', name: 'Premium · 7 gün', price: '12.50', duration_days: 7, features: ['Öncelikli destek'], reason: 'yeni paket' };
  assert.equal((await u.cl.post('/api/admin/pass/products', body)).status, 403);
  await env.DB.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").bind(uid).run();
  const r = await u.cl.post('/api/admin/pass/products', body);
  assert.equal(r.status, 200);
  assert.equal(r.data.product.price, 1250); assert.equal(r.data.product.dur, 7 * 86400);
  assert.equal((await u.cl.post('/api/admin/pass/products', { ...body, price: '-1' })).status, 400);
  assert.equal((await u.cl.post('/api/admin/pass/products', { ...body, id: 'Kötü Kimlik' })).status, 400);
  assert.equal((await u.cl.get('/api/admin/pass/products')).data.products.length, 2);
  assert.equal((await sql(env, "SELECT COUNT(*) AS c FROM admin_audit WHERE action = 'pass.product.upsert'"))[0].c, 1);
});

test('pass: migration uygulanmamış D1\'de tablolar kendiliğinden kurulur (500 vermez)', async () => {
  const { env, u } = await setup();
  for (const t of ['nxp_tokens', 'nxp_tickets', 'nxp_purchases', 'nxp_products']) env.DB.raw.exec(`DROP TABLE ${t}`);
  const tk = await u.cl.post('/api/pass/ticket');
  assert.equal(tk.status, 200);
  const ex = await asPass(env, 'POST', '/api/pass/exchange', { body: { ticket: ticketOf(tk.data.url) } });
  assert.equal(ex.status, 200);
  assert.equal((await asPass(env, 'GET', '/api/pass/products', { token: ex.data.token })).status, 200);
});
