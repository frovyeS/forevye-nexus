import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { makeEnv, register, fund, sql, one, D } from './helpers.mjs';

const PASS = 'https://pass.example/nexus-pass/';
const ORIGIN = 'https://pass.example';
const NEXUS = 'https://nexus.test';
const KEY = { authorization: 'Bearer internal-test-key', 'content-type': 'application/json' };

// Pass sitesi gibi davranır: çerez yok, Origin var, Bearer jeton.
async function asPass(env, method, path, { body, token, origin = ORIGIN, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', origin, 'cf-connecting-ip': '6.6.6.6', ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(NEXUS + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, {});
  let data = null; try { data = await res.clone().json(); } catch { /* json değil */ }
  return { status: res.status, data, res };
}
const ticketOf = (url) => new URL(url).hash.replace(/^#t=/, '');

async function setup(extra = {}) {
  const env = makeEnv({ PASS_URL: PASS, ...extra });
  const u = await register(env, 'p@example.com', 'pass_one');
  const t = await u.cl.post('/api/pass/ticket');
  const ex = await asPass(env, 'POST', '/api/pass/exchange', { body: { ticket: ticketOf(t.data.url) } });
  return { env, u, token: ex.data.token, uid: u.me.user.id, ex, t };
}
let n = 0;
const buy = (env, token, pid, idem) => asPass(env, 'POST', '/api/pass/purchase', { token, body: { pid, idem: idem || `idem-test-${++n}-abcdefgh` } });

test('pass: bilet tek kullanımlık, jeton yalnızca pass uçlarında geçerli, CORS yalnızca PASS_URL kaynağı', async () => {
  const { env, u, token, ex, t } = await setup();
  assert.equal(ex.status, 200); assert.equal(ex.data.user.username, 'pass_one');
  assert.ok(t.data.url.startsWith(PASS + '#t='));
  assert.equal((await asPass(env, 'POST', '/api/pass/exchange', { body: { ticket: ticketOf(t.data.url) } })).status, 400, 'bilet tek kullanımlık');
  assert.equal((await asPass(env, 'GET', '/api/pass/me')).status, 401);
  assert.equal((await asPass(env, 'GET', '/api/wallet', { token })).status, 401, 'jeton cüzdan ucunu açmaz');
  assert.equal((await asPass(env, 'GET', '/api/pass/me', { token })).status, 200);
  const bad = await asPass(env, 'GET', '/api/pass/me', { token, origin: 'https://evil.example' });
  assert.equal(bad.res.headers.get('access-control-allow-origin'), null);
  const ok = await asPass(env, 'GET', '/api/pass/me', { token });
  assert.equal(ok.res.headers.get('access-control-allow-origin'), ORIGIN);
  const pre = await asPass(env, 'OPTIONS', '/api/pass/purchase');
  assert.equal(pre.status, 204);
  assert.equal((await asPass(env, 'OPTIONS', '/api/pass/purchase', { origin: 'https://evil.example' })).status, 403);
  assert.equal(u.cl.hasSession(), true);
});

test('pass: PASS_URL yoksa bilet 503', async () => {
  const env = makeEnv();
  const u = await register(env, 'q@example.com', 'pass_two');
  assert.equal((await u.cl.post('/api/pass/ticket')).status, 503);
});

test('pass: satın alma FN düşer, süre sunucuda, idempotent, çift aktif üyelik engellenir, süre bitince yenilenir', async () => {
  const { env, token, uid } = await setup();
  const prods = (await asPass(env, 'GET', '/api/pass/products', { token })).data.products;
  const p = prods.find((x) => x.id === 'weather-premium-30');
  assert.equal(p.price, 500); assert.equal(p.dur, 30 * 86400);

  const poor = (await buy(env, token, p.id)).data;
  assert.equal(poor.ok, false); assert.equal(poor.code, 'insufficient'); assert.equal(poor.missing, 500);

  await fund(env, uid, 2000);
  const key = 'idem-stable-key-1';
  const r1 = await buy(env, token, p.id, key);
  assert.equal(r1.status, 201); assert.equal(r1.data.ok, true);
  assert.equal(r1.data.balance, 1500);
  assert.equal(r1.data.entitlement.status, 'active');
  assert.equal(r1.data.entitlement.expires - r1.data.entitlement.starts, 30 * 86400 * 1000);
  const led = await one(env, `SELECT type, amount FROM ledger_entries WHERE tx_ref = ?`, r1.data.purchase.id);
  assert.equal(led.type, 'purchase'); assert.equal(led.amount, -500);

  const r2 = await buy(env, token, p.id, key);          // aynı anahtar: tekrar düşmez
  assert.equal(r2.data.replayed, true); assert.equal(r2.data.balance, 1500);
  const dup = (await buy(env, token, p.id)).data;       // yeni anahtar, hâlâ aktif
  assert.equal(dup.code, 'already_active');
  assert.equal((await one(env, 'SELECT balance FROM wallets WHERE user_id = ?', uid)).balance, 1500);

  const me = (await asPass(env, 'GET', '/api/pass/me', { token })).data;
  assert.equal(me.entitlements.length, 1); assert.equal(me.entitlements[0].status, 'active');
  const hist = (await asPass(env, 'GET', '/api/pass/purchases', { token })).data;
  assert.equal(hist.items.length, 1); assert.equal(hist.more, false);

});

test('pass: süresi dolan üyelik aynı kayıt üzerinden yeniden alınabilir; katalogda kapalı ürün satılmaz', async () => {
  const { env, u, uid } = await setup();
  await fund(env, uid, 5000);
  const fresh = async () => { const t = await u.cl.post('/api/pass/ticket'); return (await asPass(env, 'POST', '/api/pass/exchange', { body: { ticket: ticketOf(t.data.url) } })).data.token; };
  let token = await fresh();
  const a = await buy(env, token, 'store-plus-30'); assert.equal(a.data.ok, true);
  const entId = a.data.entitlement.id;
  env.__NOW += 31 * D; token = await fresh();
  const me = (await asPass(env, 'GET', '/api/pass/me', { token })).data;
  assert.equal(me.entitlements[0].status, 'expired');
  const b = await buy(env, token, 'store-plus-30'); assert.equal(b.data.ok, true);
  assert.equal(b.data.entitlement.id, entId); assert.equal(b.data.entitlement.status, 'active');
  assert.equal((await sql(env, 'SELECT * FROM pass_entitlements WHERE user_id = ?', uid)).length, 1);
  await env.DB.prepare(`UPDATE pass_products SET status = 'off' WHERE id = 'weather-premium-30'`).run();
  assert.equal((await buy(env, token, 'weather-premium-30')).data.code, 'unavailable');
  assert.equal((await asPass(env, 'GET', '/api/pass/products', { token })).data.products.some((x) => x.id === 'weather-premium-30'), false);
});

test('pass: askıdaki hesap üyelik alamaz', async () => {
  const { env, token, uid } = await setup();
  await fund(env, uid, 2000);
  await env.DB.prepare(`UPDATE users SET status = 'suspended', suspended_until = NULL WHERE id = ?`).bind(uid).run();
  const r = await buy(env, token, 'store-plus-30');
  assert.equal(r.status, 409);
  assert.equal((await one(env, 'SELECT balance FROM wallets WHERE user_id = ?', uid)).balance, 2000);
});

test('entitlement: diğer sistemler INTERNAL_API_KEY ile user_id veya FOREVYE ID kimliğiyle sorar; iade üyeliği kapatır', async () => {
  const { env, token, uid } = await setup();
  await fund(env, uid, 2000);
  const post = (path, body, headers = KEY) => worker.fetch(new Request(NEXUS + path, { method: 'POST', headers, body: JSON.stringify(body) }), env, {}).then(async (r) => ({ status: r.status, data: await r.json() }));
  assert.equal((await post('/api/internal/entitlement', { user_id: uid }, { 'content-type': 'application/json' })).status, 401);
  assert.equal((await post('/api/internal/entitlement', { user_id: uid })).data.active, false);

  const bought = (await buy(env, token, 'weather-premium-30')).data;
  const byUser = (await post('/api/internal/entitlement', { user_id: uid, app: 'Mikro-Klima Hava' })).data;
  assert.equal(byUser.active, true); assert.equal(byUser.entitlements[0].product_id, 'weather-premium-30');
  assert.equal((await post('/api/internal/entitlement', { user_id: uid, app: 'Nexus Mağaza' })).data.active, false);

  await env.DB.prepare('INSERT INTO id_links (user_id, id_user_id, linked_at) VALUES (?,?,?)').bind(uid, 'idu-12345', env.__NOW).run();
  assert.equal((await post('/api/internal/entitlement', { id_user_id: 'idu-12345', product_id: 'weather-premium-30' })).data.active, true);
  assert.equal((await post('/api/internal/entitlement', { id_user_id: 'yok-yok' })).status, 404);

  const refund = await post('/api/internal/refund', { ref: bought.purchase.id });
  assert.equal(refund.status, 201);
  assert.equal((await post('/api/internal/entitlement', { user_id: uid })).data.active, false, 'iade üyeliği kapatır');
  assert.equal((await one(env, 'SELECT status FROM pass_purchases WHERE id = ?', bought.purchase.id)).status, 'refunded');
  assert.equal((await one(env, 'SELECT balance FROM wallets WHERE user_id = ?', uid)).balance, 2000);
  assert.equal((await buy(env, token, 'weather-premium-30')).data.ok, true, 'iade sonrası yeniden alınabilir');
});

test('pass yönetimi: katalog yazma yalnızca süper yönetici; fiyat/süre doğrulanır', async () => {
  const { env, u } = await setup();
  const body = { id: 'x-pro-7', app: 'Deneme', name: 'Pro · 7 gün', price: '2.50', duration_days: 7, features: ['a'], reason: 'test' };
  assert.equal((await u.cl.post('/api/admin/pass/products', body)).status, 403);
  await env.DB.prepare(`UPDATE users SET role = 'superadmin' WHERE username = 'pass_one'`).run();
  const bad = await u.cl.post('/api/admin/pass/products', { ...body, price: '-1' });
  assert.equal(bad.status, 400);
  const ok = await u.cl.post('/api/admin/pass/products', body);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const row = await one(env, 'SELECT price, duration_s FROM pass_products WHERE id = ?', 'x-pro-7');
  assert.equal(row.price, 250); assert.equal(row.duration_s, 7 * 86400);
  assert.ok((await u.cl.get('/api/admin/pass/products')).data.products.some((p) => p.id === 'x-pro-7'));
});
