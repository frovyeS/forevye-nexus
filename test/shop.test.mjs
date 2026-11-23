import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../src/worker.js';
import { makeEnv, register, fund, sql, one, PW, D } from './helpers.mjs';
import { SEED, MIGRATION_SQL, cleanData } from '../src/lib/shop.js';
import '../shared/card-skins.js';
import '../shared/card-rules.js';
import '../public/js/qrcode.js';
import '../public/js/card-render.js';
import { defaultDesign } from '../shared/card-contract.js';

const SHOP = 'https://shop.example/nexus-market/';
const ORIGIN = 'https://shop.example';
const NEXUS = 'https://nexus.test';
const KEY = { authorization: 'Bearer internal-test-key', 'content-type': 'application/json' };
const FN = (n) => n * 100;

// Market sitesi gibi davranır: çerez yok, Origin var, Bearer jeton.
async function asShop(env, method, path, { body, token, origin = ORIGIN } = {}) {
  const h = { 'content-type': 'application/json', origin, 'cf-connecting-ip': '7.7.7.7' };
  if (token) h.authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(NEXUS + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, {});
  let data = null; try { data = await res.clone().json(); } catch { /* json değil */ }
  return { status: res.status, data, res };
}
const ticketOf = (url) => new URL(url).hash.replace(/^#t=/, '');
const tokenFor = async (env, u) => {
  const t = await u.cl.post('/api/shop/ticket');
  return (await asShop(env, 'POST', '/api/shop/exchange', { body: { ticket: ticketOf(t.data.url) } })).data.token;
};
let n = 0, mail = 0;
async function setup(extra = {}, name = 'shop_one') {
  const env = makeEnv({ SHOP_URL: SHOP, ...extra });
  const u = await mk(env, name);
  return { env, u, token: u.token, uid: u.uid };
}
async function mk(env, name) {
  const u = await register(env, `${name}${++mail}@example.com`, name);
  u.uid = u.me.user.id; u.token = await tokenFor(env, u);
  return u;
}
const buy = (env, token, pid, idem) => asShop(env, 'POST', '/api/shop/purchase', { token, body: { pid, idem: idem || `idem-shop-${++n}-abcdefgh` } });
const bal = async (env, uid) => (await one(env, 'SELECT balance FROM wallets WHERE user_id = ?', uid)).balance;
const post = (env, path, body, headers = KEY) => worker.fetch(new Request(NEXUS + path, { method: 'POST', headers, body: JSON.stringify(body) }), env, {}).then(async (r) => ({ status: r.status, data: await r.json() }));

test('market: bilet tek kullanımlık, jeton yalnızca /api/shop uçlarında geçerli, CORS yalnızca SHOP_URL kaynağı', async () => {
  const { env, u, token } = await setup();
  const t = await u.cl.post('/api/shop/ticket');
  assert.ok(t.data.url.startsWith(SHOP + '#t='));
  const ex = await asShop(env, 'POST', '/api/shop/exchange', { body: { ticket: ticketOf(t.data.url) } });
  assert.equal(ex.status, 200);
  assert.equal((await asShop(env, 'POST', '/api/shop/exchange', { body: { ticket: ticketOf(t.data.url) } })).status, 400, 'bilet tek kullanımlık');
  assert.equal((await asShop(env, 'GET', '/api/shop/me')).status, 401);
  assert.equal((await asShop(env, 'GET', '/api/wallet', { token })).status, 401, 'jeton cüzdan ucunu açmaz');
  assert.equal((await asShop(env, 'GET', '/api/pass/me', { token })).status, 401, 'Pass ucunu da açmaz');
  const ok = await asShop(env, 'GET', '/api/shop/me', { token });
  assert.equal(ok.status, 200); assert.equal(ok.res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await asShop(env, 'GET', '/api/shop/me', { token, origin: 'https://evil.example' })).res.headers.get('access-control-allow-origin'), null);
  assert.equal((await asShop(env, 'OPTIONS', '/api/shop/purchase')).status, 204);
  assert.equal((await asShop(env, 'OPTIONS', '/api/shop/purchase', { origin: 'https://evil.example' })).status, 403);
});

test('market: SHOP_URL yoksa bilet 503; katalog tohumu ve fiyatlar sunucudan gelir', async () => {
  const env = makeEnv();
  const u = await register(env, 'nourl@example.com', 'no_url');
  assert.equal((await u.cl.post('/api/shop/ticket')).status, 503);
  const { env: e2, token } = await setup();
  const list = (await asShop(e2, 'GET', '/api/shop/products', { token })).data.products;
  assert.equal(list.length, SEED.length);
  const black = list.find((p) => p.id === 'card_black');
  assert.equal(black.price, FN(40000)); assert.equal(black.stock_left, 50); assert.equal(black.skin, 'royal'); assert.equal(black.perks.limit_mult, 3);
  assert.ok(list.some((p) => p.kind === 'design') && list.some((p) => p.kind === 'function'));
  assert.equal(list.filter((p) => p.kind === 'design').length, 45, 'Market vitrini 45 satın alınabilir tasarım sunar');
  const imperial = list.find((p) => p.id === 'skin_imperial');
  assert.equal(imperial.skin, 'imperial'); assert.equal(imperial.price, FN(16500));
  assert.equal(imperial.stock_left, 28); assert.equal(imperial.stock_total, 28);
});

test('market: satın alma FN düşer, defterde görünür; çift sahiplik ve çift gönderim engellenir', async () => {
  const { env, token, uid } = await setup();
  const poor = (await buy(env, token, 'skin_onyx')).data;
  assert.equal(poor.code, 'insufficient'); assert.equal(poor.missing, FN(1800));
  await fund(env, uid, FN(5000));
  await asShop(env, 'POST', '/api/shop/wishlist', { token, body: { pid: 'skin_onyx' } });
  const key = 'idem-stable-shop-1';
  const r1 = await buy(env, token, 'skin_onyx', key);
  assert.equal(r1.status, 201); assert.equal(r1.data.ok, true); assert.equal(r1.data.balance, FN(3200));
  const led = await one(env, 'SELECT type, amount, description FROM ledger_entries WHERE tx_ref = ?', r1.data.purchase.id);
  assert.equal(led.type, 'purchase'); assert.equal(led.amount, -FN(1800)); assert.match(led.description, /Nexus Market: Oniks Mat/);
  const r2 = await buy(env, token, 'skin_onyx', key);                    // aynı anahtar: tekrar düşmez
  assert.equal(r2.data.replayed, true); assert.equal(await bal(env, uid), FN(3200));
  assert.equal((await buy(env, token, 'skin_onyx')).data.code, 'already_owned');
  assert.equal(await bal(env, uid), FN(3200));
  const me = (await asShop(env, 'GET', '/api/shop/me', { token })).data;
  assert.equal(me.entitlements.length, 1); assert.deepEqual(me.wishlist, [], 'satın alınan ürün istek listesinden düşer');
  assert.equal((await asShop(env, 'POST', '/api/shop/wishlist', { token, body: { pid: 'skin_onyx' } })).status, 409);
  const w = await asShop(env, 'POST', '/api/shop/wishlist', { token, body: { pid: 'skin_carbon' } });
  assert.deepEqual(w.data.wishlist, ['skin_carbon']);
  assert.deepEqual((await asShop(env, 'POST', '/api/shop/wishlist', { token, body: { pid: 'skin_carbon' } })).data.wishlist, []);
  const hist = (await asShop(env, 'GET', '/api/shop/purchases', { token })).data;
  assert.equal(hist.items.length, 1); assert.equal(hist.items[0].price, FN(1800));
  assert.equal((await buy(env, token, 'yok_boyle_urun')).data.code, 'unavailable');
});

test('market: yeni 45 tasarımlı katalogtan alış, seri numarası ve kart editöründe uygulama', async () => {
  const { env, u, token, uid } = await setup({}, 'newskin');
  await fund(env, uid, FN(20000));
  const products = (await asShop(env, 'GET', '/api/shop/products', { token })).data.products;
  const item = products.find((p) => p.id === 'skin_imperial');
  assert.equal(item.skin, 'imperial'); assert.equal(item.stock_total, 28);
  const bought = await buy(env, token, item.id);
  assert.equal(bought.status, 201); assert.equal(bought.data.purchase.serial, '001/028');
  const card = (await u.cl.post('/api/cards', { display_name: 'IMPERIAL TEST' })).data;
  const equipped = await asShop(env, 'POST', '/api/shop/equip', { token, body: { card_id: card.id, product_id: item.id } });
  assert.equal(equipped.status, 200); assert.equal(equipped.data.skin.skin, 'imperial');
  assert.equal(equipped.data.skin.serial, '001/028');
});

test('market: sınırlı seri numaralanır, tükenince satılmaz, son adet için yarışta yalnızca biri alır', async () => {
  const { env, u, token, uid } = await setup({}, 'ltd_a');
  const b = await mk(env, 'ltd_b'), c = await mk(env, 'ltd_c');
  await env.DB.prepare(`UPDATE shop_products SET stock_total = 2 WHERE id = 'skin_prism'`).run();
  for (const x of [u, b, c]) await fund(env, x.uid, FN(9000));
  const [ra, rb] = await Promise.all([buy(env, u.token, 'skin_prism'), buy(env, b.token, 'skin_prism')]);
  assert.equal(ra.data.ok, true); assert.equal(rb.data.ok, true);
  assert.deepEqual([ra.data.purchase.serial, rb.data.purchase.serial].sort(), ['001/002', '002/002']);
  const [rc] = await Promise.all([buy(env, c.token, 'skin_prism'), buy(env, c.token, 'skin_prism')]);
  assert.equal(rc.data.code, 'sold_out'); assert.equal(await bal(env, c.uid), FN(9000), 'başarısız alımda bakiye değişmez');
  assert.equal((await one(env, `SELECT stock_sold FROM shop_products WHERE id = 'skin_prism'`)).stock_sold, 2);
  const list = (await asShop(env, 'GET', '/api/shop/products', { token })).data.products.find((p) => p.id === 'skin_prism');
  assert.equal(list.stock_left, 0);
  // Aynı anda iki kullanıcı son adedi almaya çalışır (DB koruması): biri alır, diğeri sold_out
  await env.DB.prepare(`UPDATE shop_products SET stock_total = 3 WHERE id = 'skin_prism'`).run();
  const d = await mk(env, 'ltd_d'), e = await mk(env, 'ltd_e');
  for (const x of [d, e]) await fund(env, x.uid, FN(9000));
  const res = await Promise.all([buy(env, d.token, 'skin_prism'), buy(env, e.token, 'skin_prism')]);
  assert.equal(res.filter((r) => r.data.ok).length, 1); assert.equal(res.filter((r) => r.data.code === 'sold_out').length, 1);
  assert.equal(await one(env, 'SELECT COUNT(*) AS c FROM shop_entitlements WHERE product_id = ?', 'skin_prism').then((r) => r.c), 3);
});

test('market: kart yüzeyi takılır/çıkarılır; sahip olunmayan, başkasının kartı ve iade sonrası düşer', async () => {
  const { env, u, token, uid } = await setup();
  const other = await mk(env, 'other_eq');
  await fund(env, uid, FN(5000));
  const card = (await u.cl.post('/api/cards', { display_name: 'ALI VELI' })).data;
  assert.equal((await asShop(env, 'POST', '/api/shop/equip', { token, body: { card_id: card.id, product_id: 'skin_onyx' } })).status, 403, 'sahip değil');
  const bought = (await buy(env, token, 'skin_onyx')).data;
  const eq = await asShop(env, 'POST', '/api/shop/equip', { token, body: { card_id: card.id, product_id: 'skin_onyx' } });
  assert.equal(eq.status, 200); assert.equal(eq.data.skin.skin, 'onyx');
  assert.equal((await u.cl.get('/api/cards')).data.cards.find((c) => c.id === card.id).skin.skin, 'onyx');
  assert.equal((await u.cl.get(`/api/cards/${card.id}`)).data.skin.product_id, 'skin_onyx');
  const defId = (await u.cl.get('/api/me')).data.default_card.id;
  await u.cl.post(`/api/cards/${defId}/skin`, { product_id: 'skin_onyx' });
  assert.equal((await u.cl.get('/api/me')).data.default_card.skin.skin, 'onyx', 'ana ekrandaki varsayılan kart da yüzeyi taşır');
  assert.equal((await asShop(env, 'POST', '/api/shop/equip', { token: other.token, body: { card_id: card.id, product_id: 'skin_onyx' } })).status, 404, 'başkasının kartı');
  assert.equal((await u.cl.post(`/api/cards/${card.id}/skin`, { product_id: null })).status, 200, 'Nexus oturumuyla çıkarılır');
  assert.equal((await u.cl.get(`/api/cards/${card.id}`)).data.skin, null);
  await u.cl.post(`/api/cards/${card.id}/skin`, { product_id: 'skin_onyx' });
  const refund = await post(env, '/api/internal/refund', { ref: bought.purchase.id });
  assert.equal(refund.status, 201);
  assert.equal((await u.cl.get(`/api/cards/${card.id}`)).data.skin, null, 'iade yüzeyi karttan çıkarır');
  assert.equal(await bal(env, uid), FN(5000));
  assert.equal((await buy(env, token, 'skin_onyx')).data.ok, true, 'iade sonrası yeniden alınabilir');
});

test('fonksiyonel kart: Titanyum işlem ve günlük limiti gerçekten artırır; iade geri alır', async () => {
  const { env, u, token, uid } = await setup();
  const rcp = await mk(env, 'rcp_one');
  await fund(env, uid, FN(30000));
  const xfer = (amt) => u.cl.post('/api/transfers', { recipient: 'rcp_one', amount: amt, idempotency_key: `k${++n}-aaaaaaaaaaaa`, password: PW });
  assert.equal((await xfer('6000.00')).data.error?.code, 'limit_exceeded', 'temel limit 5.000 FN');
  assert.equal((await u.cl.get('/api/me')).data.config.max_transfer, FN(5000));
  const b = (await buy(env, token, 'card_titan')).data; assert.equal(b.ok, true);
  const cfg = (await u.cl.get('/api/me')).data.config;
  assert.equal(cfg.max_transfer, FN(10000)); assert.equal(cfg.daily_limit, FN(30000)); assert.equal(cfg.perks.limit_mult, 2);
  assert.equal((await xfer('6000.00')).status, 201);
  assert.equal((await u.cl.get('/api/transfers/recent')).data.daily_limit, FN(30000));
  assert.equal((await xfer('10000.01')).data.error?.code, 'limit_exceeded');
  await post(env, '/api/internal/refund', { ref: b.purchase.id });
  assert.equal((await u.cl.get('/api/me')).data.config.max_transfer, FN(5000));
  assert.equal(rcp.uid.length > 0, true);
});

test('fonksiyonel kart: Platin borsa farkını daraltır, ek kart hakkı kart sınırını artırır (adetle, en çok 5)', async () => {
  const { env, u, token, uid } = await setup();
  await fund(env, uid, FN(50000));
  const spread = async () => (await u.cl.get('/api/market')).data.spread_bps;
  assert.equal(await spread(), 50);
  assert.equal((await buy(env, token, 'card_platinum')).data.ok, true);
  assert.equal(await spread(), 20, '%60 indirim: 50 → 20 baz puan');
  assert.equal((await u.cl.get('/api/cards')).data.max_cards, 6, 'Platin +1 kart hakkı verir');
  for (let i = 0; i < 5; i++) assert.equal((await buy(env, token, 'slot_extra')).data.ok, true);
  assert.equal((await buy(env, token, 'slot_extra')).data.code, 'already_owned', 'en çok 5 adet');
  assert.equal((await u.cl.get('/api/cards')).data.max_cards, 11);
  // Kayıtta varsayılan kart zaten oluşur (1/11); 10 tane daha açılabilir.
  for (let i = 0; i < 10; i++) assert.equal((await u.cl.post('/api/cards', { display_name: `KART ${i}A` })).status, 201);
  assert.equal((await u.cl.post('/api/cards', { display_name: 'FAZLA KART' })).data.error?.code, 'card_limit');
});

test('fonksiyonel kart: Nexus Black tüm avantajları verir; iade yalnızca o satın almayı geri alır', async () => {
  const { env, u, token, uid } = await setup();
  await fund(env, uid, FN(60000));
  const slot = (await buy(env, token, 'slot_extra')).data;
  const black = (await buy(env, token, 'card_black')).data;
  assert.equal(black.purchase.serial, '001/050');
  const cfg = (await u.cl.get('/api/me')).data.config;
  assert.equal(cfg.max_transfer, FN(15000)); assert.equal(cfg.daily_limit, FN(45000)); assert.equal(cfg.max_cards, 8);
  assert.equal((await u.cl.get('/api/market')).data.spread_bps, 5, 'en az 5 baz puan');
  await post(env, '/api/internal/refund', { ref: slot.purchase.id });
  assert.equal((await u.cl.get('/api/me')).data.config.max_cards, 7);
  assert.equal((await one(env, 'SELECT status FROM shop_purchases WHERE id = ?', slot.purchase.id)).status, 'refunded');
  assert.equal((await asShop(env, 'GET', '/api/shop/mine', { token })).status, 401, 'Nexus oturum ucu jetonla çağrılamaz');
  const mine = (await u.cl.get('/api/shop/mine')).data;
  assert.equal(mine.items.length, 1); assert.equal(mine.items[0].product_id, 'card_black'); assert.equal(mine.perks.limit_mult, 3);
});

test('market yönetimi: katalog yazma yalnızca süper yönetici; skin/perk/stok doğrulanır', async () => {
  const { env, u } = await setup();
  const body = { id: 'skin_test_x', kind: 'design', rarity: 'rare', name: 'Deneme Kartı', price: '12.50', stock_total: 5, data: { skin: 'onyx' }, reason: 'test' };
  assert.equal((await u.cl.post('/api/admin/shop/products', body)).status, 403);
  await env.DB.prepare(`UPDATE users SET role = 'superadmin' WHERE username = 'shop_one'`).run();
  assert.equal((await u.cl.post('/api/admin/shop/products', { ...body, data: { skin: 'yok_boyle_skin' } })).status, 400);
  assert.equal((await u.cl.post('/api/admin/shop/products', { ...body, data: {} })).status, 400);
  assert.equal((await u.cl.post('/api/admin/shop/products', { ...body, price: '-1' })).status, 400);
  assert.equal((await u.cl.post('/api/admin/shop/products', { ...body, rarity: 'ultra' })).status, 400);
  assert.equal((await u.cl.post('/api/admin/shop/products', body)).status, 200);
  const row = await one(env, `SELECT price, stock_total FROM shop_products WHERE id = 'skin_test_x'`);
  assert.equal(row.price, 1250); assert.equal(row.stock_total, 5);
  assert.equal((await u.cl.post('/api/admin/shop/products', { ...body, data: { perks: { limit_mult: 99, spread_discount_pct: 500 } } })).status, 200);
  const stored = JSON.parse((await one(env, `SELECT data FROM shop_products WHERE id = 'skin_test_x'`)).data);
  assert.equal(stored.perks.limit_mult, 5); assert.equal(stored.perks.spread_discount_pct, 95);
  await env.DB.prepare(`UPDATE shop_products SET stock_sold = 3 WHERE id = 'skin_test_x'`).run();
  assert.equal((await u.cl.post('/api/admin/shop/products', { ...body, stock_total: 2 })).status, 400, 'stok satılandan az olamaz');
  assert.ok((await u.cl.get('/api/admin/shop/products')).data.products.some((p) => p.id === 'skin_test_x'));
});

test('kart yüzeyleri: tohum ürünleri geçerli skin kullanır, yazı rengi okunaklı, kullanıcı katmanları gizlenir', () => {
  const S = globalThis.FNXSkins, X = globalThis.FNXRender;
  assert.equal(S.IDS.length, 48, '45 tasarım yüzeyi + 3 fonksiyonel kart yüzeyi');
  assert.equal(SEED.filter((p) => p.kind === 'design').length, 45);
  for (const p of SEED.filter((x) => x.kind === 'design')) {
    const item = S.list.find((x) => x.productId === p.id);
    assert.ok(item, `${p.id}: editör ve Market kataloğunda görünmeli`);
    assert.equal(item.price, p.price / 100, `${p.id}: editör ve Market fiyatları eşleşmeli`);
  }
  for (const p of SEED) { const c = cleanData(p.data); assert.ok(c.data, `${p.id}: ${c.error}`); if (p.data.skin) assert.ok(S.has(p.data.skin), p.id); }
  for (const id of S.IDS) {
    const m = S.meta(id);
    for (const bg of m.bg) assert.ok(X.contrast(m.brand, bg) >= 4.5, `${id}: ${m.brand} / ${bg} kontrastı düşük`);
    const out = S.get(id).build('t', { animate: true, serial: '007/100' });
    const all = out.defs + out.under + out.over + out.edge;
    assert.ok(!/<script|href=|javascript:|onload=|onerror=|<image|<foreignObject/i.test(all), `${id}: güvensiz içerik`);
    const svg = X.cardSvg(defaultDesign('MARKET TEST'), { last4: 'NX01', cardToken: 'NXC-TEST-NX01', skin: id, skinSerial: '001/028' }, { prefix: 'test' + id, animate: false });
    assert.ok(svg.includes(`data-skin=\"${id}\"`), `${id}: tam kart SVG önizlemesi çizilmeli`);
  }
  const R = globalThis.FNXRules;
  const design = { designId: 'd', ownerId: 'o', template: 'classic', canvas: { width: 856, height: 540 }, userDisplayName: 'ALI VELI', nameStyle: { color: 'auto' }, chipStyle: 'rose', version: 1,
    layers: [{ id: 'bg', type: 'background', name: 'z', locked: true, visible: true, zIndex: 0, properties: { mode: 'solid', colors: ['#334455'], angle: 0, finish: 'matte' } },
      { id: 'mine1', type: 'shape', name: 's', locked: false, visible: true, zIndex: 1, properties: { kind: 'circle', x: 300, y: 200, width: 60, height: 60, rotation: 0, opacity: 1, fill: '#FFFFFF', stroke: 'none', strokeWidth: 0, flipX: false, flipY: false, lockRatio: false, effects: [] } }] };
  const plain = X.cardSvg(design, { last4: 'EF23', cardToken: 'NXC-ABCD-EF23' }, { prefix: 'a' });
  const skinned = X.cardSvg(design, { last4: 'EF23', cardToken: 'NXC-ABCD-EF23', skin: 'guilloche', skinSerial: '007/100' }, { prefix: 'a' });
  assert.ok(plain.includes('data-id="mine1"')); assert.ok(!skinned.includes('data-id="mine1"'), 'skin takılıyken kullanıcı katmanı çizilmez');
  assert.ok(skinned.includes('data-skin="guilloche"') && skinned.includes('No. 007/100') && skinned.includes('NXC-ABCD-EF23') && skinned.includes('data-sys="card-qr"'));
  assert.ok(!X.cardSvg(design, { skin: 'yok_boyle' }, { prefix: 'a' }).includes('data-skin'), 'bilinmeyen skin yok sayılır');
  assert.ok(R.validateDesign(design).ok);
});

test('migration 0007 kod şemasıyla birebir aynı ve boş veritabanına uygulanır', () => {
  assert.equal(fs.readFileSync(new URL('../migrations/0007_shop.sql', import.meta.url), 'utf8'), MIGRATION_SQL(), 'node scripts/gen-shop-migration.mjs çalıştırın');
  assert.equal(D, 86400000);
});
