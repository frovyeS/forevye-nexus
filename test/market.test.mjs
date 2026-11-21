import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, register, fund, sql, one, D } from './helpers.mjs';

const key = () => 'k' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
async function consistent(env) {
  const rows = await sql(env, `SELECT w.user_id, w.balance, COALESCE((SELECT SUM(amount) FROM ledger_entries e WHERE e.user_id = w.user_id), 0) AS s FROM wallets w`);
  for (const r of rows) assert.equal(r.balance, r.s, 'defter ile bakiye uyuşmuyor');
}
const setup = async (extra = {}) => {
  const env = makeEnv({ __GOLD: 4000, ...extra });
  const u = await register(env, 'm@example.com', 'miner_one');
  await fund(env, u.me.user.id, 500000); // 5.000 FN
  return { env, u };
};

test('fiyat: ilk altın fiyatı baz = 1 FN; altın %10 artınca kristal 1,10 FN', async () => {
  const { env, u } = await setup();
  let r = await u.cl.get('/api/market');
  assert.equal(r.status, 200);
  assert.equal(r.data.price_micro, 1000000);
  assert.equal(r.data.base_usd, 4000);
  assert.equal(r.data.buy_micro, 1005000);   // %0,50 spread
  assert.equal(r.data.sell_micro, 995000);
  assert.equal(r.data.tradable, true);

  env.__NOW += 2 * 60 * 1000; env.__GOLD = 4400; // önbellek süresi doldu
  r = await u.cl.get('/api/market');
  assert.equal(r.data.price_micro, 1100000);
  assert.equal(r.data.base_usd, 4000, 'baz sabit kalır');
  // Kullanıcı kendi fiyatını dayatamaz: istek gövdesindeki fiyat yok sayılır/reddedilir
  const bad = await u.cl.post('/api/market/trade', { side: 'buy', qty: '1', price_micro: 1, idempotency_key: key() });
  assert.equal(bad.status, 201);
  assert.equal(bad.data.price_micro, 1105500);
});

test('al/sat: atomik, defter tutarlı, spread uygulanır, ortalama maliyet', async () => {
  const { env, u } = await setup();
  const buy = await u.cl.post('/api/market/trade', { side: 'buy', qty: '100', idempotency_key: key() });
  assert.equal(buy.status, 201);
  assert.equal(buy.data.total, 10050);               // 100 * 1,005 = 100,50 FN
  assert.equal(buy.data.balance, 500000 - 10050);
  let m = (await u.cl.get('/api/market')).data;
  assert.equal(m.you.qty, 1000000);
  assert.equal(m.you.cost_minor, 10050);
  assert.equal(m.you.value_minor, 9950);              // 100 * 0,995
  assert.equal(m.you.pnl_minor, -100);                // yalnızca spread kaybı

  const sell = await u.cl.post('/api/market/trade', { side: 'sell', qty: '40', idempotency_key: key() });
  assert.equal(sell.status, 201);
  assert.equal(sell.data.total, 3980);
  m = (await u.cl.get('/api/market')).data;
  assert.equal(m.you.qty, 600000);
  assert.equal(m.you.cost_minor, 6030);               // maliyetin 40%'ı düştü
  await consistent(env);
  const types = (await sql(env, `SELECT type FROM ledger_entries WHERE type LIKE 'market_%' ORDER BY created_at`)).map((x) => x.type);
  assert.deepEqual(types, ['market_buy', 'market_sell']);
  assert.equal((await u.cl.get('/api/transactions?kind=market')).data.items.length, 2);
});

test('tutarla alım: harcanan FN, girilen tutarı aşmaz', async () => {
  const { env, u } = await setup();
  const r = await u.cl.post('/api/market/trade', { side: 'buy', amount: '50.00', idempotency_key: key() });
  assert.equal(r.status, 201);
  assert.ok(r.data.total <= 5000 && r.data.total >= 4999);
  await consistent(env);
});

test('yetersiz bakiye ve kristal', async () => {
  const { env, u } = await setup({ MARKET_MAX_TRADE_MINOR: '100000000' });
  const a = await u.cl.post('/api/market/trade', { side: 'buy', qty: '6000', idempotency_key: key() });
  assert.equal(a.status, 400); assert.equal(a.data.error.code, 'insufficient_funds');
  const s = await u.cl.post('/api/market/trade', { side: 'sell', qty: '1', idempotency_key: key() });
  assert.equal(s.status, 400); assert.equal(s.data.error.code, 'insufficient_crystal');
  await u.cl.post('/api/market/trade', { side: 'buy', qty: '10', idempotency_key: key() });
  const over = await u.cl.post('/api/market/trade', { side: 'sell', qty: '10.0001', idempotency_key: key() });
  assert.equal(over.data.error.code, 'insufficient_crystal');
  assert.equal((await u.cl.get('/api/wallet')).data.balance, 500000 - 1005, 'başarısız satış bakiyeyi değiştirmez');
  await consistent(env);
});

test('tekrar isteği ve geçersiz girişler', async () => {
  const { env, u } = await setup();
  const k = key();
  const a = await u.cl.post('/api/market/trade', { side: 'buy', qty: '2', idempotency_key: k });
  const b = await u.cl.post('/api/market/trade', { side: 'buy', qty: '2', idempotency_key: k });
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(b.data.replayed, true); assert.equal(b.data.ref, a.data.ref);
  assert.equal((await sql(env, 'SELECT * FROM crystal_trades')).length, 1);
  for (const body of [{ side: 'x', qty: '1' }, { side: 'buy' }, { side: 'buy', qty: '1', amount: '1' }, { side: 'buy', qty: '-1' }, { side: 'buy', qty: '1.00001' }, { side: 'buy', qty: '0' }]) {
    assert.equal((await u.cl.post('/api/market/trade', { ...body, idempotency_key: key() })).status, 400, JSON.stringify(body));
  }
  await consistent(env);
});

test('fiyat kayması: ekranda görülen fiyat değiştiyse işlem reddedilir', async () => {
  const { env, u } = await setup();
  const seen = (await u.cl.get('/api/market')).data.buy_micro;
  env.__NOW += 2 * 60 * 1000; env.__GOLD = 4200; // +%5
  const r = await u.cl.post('/api/market/trade', { side: 'buy', qty: '1', expected_price_micro: seen, idempotency_key: key() });
  assert.equal(r.status, 409); assert.equal(r.data.error.code, 'price_moved');
  assert.equal(r.data.error.price_micro, 1050000 * 1.005);
});

test('kaynak çökerse son fiyat bayatlar; 15 dk sonra işlem durur', async () => {
  const { env, u } = await setup();
  await u.cl.get('/api/market');
  env.__GOLD = () => { throw new Error('ağ hatası'); };
  env.__NOW += 5 * 60 * 1000;
  let m = (await u.cl.get('/api/market')).data;
  assert.equal(m.tradable, true);
  env.__NOW += 11 * 60 * 1000;
  m = (await u.cl.get('/api/market')).data;
  assert.equal(m.tradable, false);
  const r = await u.cl.post('/api/market/trade', { side: 'buy', qty: '1', idempotency_key: key() });
  assert.equal(r.status, 503); assert.equal(r.data.error.code, 'market_stale');
});

test('anomali: tek adımda %25+ sıçrama reddedilir (bozuk veri koruması)', async () => {
  const { env, u } = await setup();
  await u.cl.get('/api/market');
  env.__NOW += 2 * 60 * 1000; env.__GOLD = 9000;
  const m = (await u.cl.get('/api/market')).data;
  assert.equal(m.price_micro, 1000000, 'anormal fiyat yok sayıldı');
});

test('GOLD_BASE_USD baz fiyatı sabitler', async () => {
  const { env, u } = await setup({ GOLD_BASE_USD: '2000' });
  // 4000 / 2000 = 2 FN; ancak ilk çekim anomali koruması olmadığı için kabul edilir
  assert.equal((await u.cl.get('/api/market')).data.price_micro, 2000000);
});

test('askıdaki hesap işlem yapamaz; borsa işlemleri ters kayıtla düzeltilemez', async () => {
  const { env, u } = await setup();
  const r = await u.cl.post('/api/market/trade', { side: 'buy', qty: '3', idempotency_key: key() });
  const { reverseRef } = await import('../src/lib/ledger.js');
  await assert.rejects(() => reverseRef(env, { originalRef: r.data.ref, actor: 'x' }), (e) => e.code === 'not_reversible');
  await env.DB.prepare(`UPDATE users SET status = 'suspended', suspended_until = NULL WHERE id = ?`).bind(u.me.user.id).run();
  const s = await u.cl.post('/api/market/trade', { side: 'buy', qty: '1', idempotency_key: key() });
  assert.ok([403, 409].includes(s.status), `askıda alım: ${s.status}`);
  await consistent(env);
});

test('son alıcılar ve günlük limit bilgisi', async () => {
  const { env, u } = await setup();
  const b = await register(env, 'b@example.com', 'bob_one');
  await u.cl.post('/api/transfers', { recipient: 'bob_one', amount: '10.00', idempotency_key: key() });
  const r = await u.cl.get('/api/transfers/recent');
  assert.deepEqual(r.data.recipients, ['bob_one']);
  assert.equal(r.data.daily_used, 1000);
  assert.equal(r.data.daily_left, r.data.daily_limit - 1000);
});

test('ilk kristal rozeti ve borsa geçmişi', async () => {
  const { env, u } = await setup();
  await u.cl.post('/api/market/trade', { side: 'buy', qty: '1', idempotency_key: key() });
  const v = await u.cl.get('/api/vault');
  assert.ok(v.data.badges.find((x) => x.key === 'first_crystal').earned_at);
  assert.equal((await u.cl.get('/api/market/trades')).data.items.length, 1);
  const h = await u.cl.get('/api/market/history?range=1d');
  assert.equal(h.status, 200); assert.ok(h.data.points.length >= 1);
  assert.equal((await u.cl.get('/api/market/history?range=zz')).status, 400);
});

test('kart sözleşmesi: zeminle kontrastı düşük yazı rengi reddedilir (marka okunabilirliği)', async () => {
  const { validateDesign, defaultDesign, contrast } = await import('../shared/card-contract.js');
  assert.equal(validateDesign(defaultDesign()).ok, true);
  const bad = validateDesign({ ...defaultDesign(), textColor: '#1b2a6b' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /kontrast/);
  assert.ok(contrast('#ffffff', '#000000') > 20);
  // Sunucu da aynı kuralı uygular
  const { env, u } = await setup();
  const r = await u.cl.post('/api/cards', { display_name: 'Kontrast', design: { ...defaultDesign(), textColor: '#0b1020' } });
  assert.equal(r.status, 400); assert.equal(r.data.error.code, 'invalid_design');
});
