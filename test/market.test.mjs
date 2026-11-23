import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, register, fund, sql, one, D } from './helpers.mjs';

const key = () => 'k' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
async function consistent(env) {
  const rows = await sql(env, `SELECT w.user_id, w.balance, COALESCE((SELECT SUM(amount) FROM ledger_entries e WHERE e.user_id = w.user_id), 0) AS s FROM wallets w`);
  for (const r of rows) assert.equal(r.balance, r.s, 'defter ile bakiye uyuşmuyor');
}
const setup = async (extra = {}) => {
  const env = makeEnv({ __GOLD: 4000, MARKET_VOLATILITY_BPS: '0', ...extra });
  const u = await register(env, 'm@example.com', 'miner_one');
  await fund(env, u.me.user.id, 500000); // 5.000 FN
  return { env, u };
};

test('fiyat: Kristal bağımsız oyun piyasasında 25 FN başlangıç fiyatıyla açılır', async () => {
  const { env, u } = await setup();
  const r = await u.cl.get('/api/market');
  assert.equal(r.status, 200);
  assert.equal(r.data.price_micro, 25000000);
  assert.equal(r.data.base_usd, undefined);
  assert.equal(r.data.gold_usd, undefined);
  assert.equal(r.data.buy_micro, 25125000);
  assert.equal(r.data.sell_micro, 24875000);
  assert.equal(r.data.tradable, true);
  assert.equal(r.data.source, 'Nexus oyun piyasası');
});

test('al/sat: atomik, defter tutarlı, spread uygulanır, ortalama maliyet', async () => {
  const { env, u } = await setup();
  const buy = await u.cl.post('/api/market/trade', { side: 'buy', qty: '100', idempotency_key: key() });
  assert.equal(buy.status, 201);
  assert.equal(buy.data.total, 251250);              // 100 * 25,125 = 2.512,50 FN
  assert.equal(buy.data.balance, 500000 - 251250);
  let m = (await u.cl.get('/api/market')).data;
  assert.equal(m.you.qty, 1000000);
  assert.equal(m.you.cost_minor, 251250);
  assert.equal(m.you.value_minor, 248750);            // 100 * 24,875
  assert.equal(m.you.pnl_minor, -2500);               // yalnızca spread kaybı

  const sell = await u.cl.post('/api/market/trade', { side: 'sell', qty: '40', idempotency_key: key() });
  assert.equal(sell.status, 201);
  assert.equal(sell.data.total, 99500);
  m = (await u.cl.get('/api/market')).data;
  assert.equal(m.you.qty, 600000);
  assert.equal(m.you.cost_minor, 150750);             // maliyetin 40%'ı düştü
  await consistent(env);
  const types = (await sql(env, `SELECT type FROM ledger_entries WHERE type LIKE 'market_%' ORDER BY created_at`)).map((x) => x.type);
  assert.deepEqual(types, ['market_buy', 'market_sell']);
  assert.equal((await u.cl.get('/api/transactions?kind=market')).data.items.length, 2);
});

test('kristal alımı seçilen sanal karttan ödenebilir; cüzdan değişmez ve tekrar düşüm olmaz', async () => {
  const { env, u } = await setup();
  const card = (await u.cl.get('/api/cards')).data.cards[0];
  const topup = await u.cl.post(`/api/cards/${card.id}/fund`, { amount: '60.00', direction: 'load', idempotency_key: 'krs-card-topup-001' });
  assert.equal(topup.status, 201); assert.equal(topup.data.card_balance, 6000);
  const keyValue = key();
  const first = await u.cl.post('/api/market/trade', { side: 'buy', qty: '2', card_id: card.id, idempotency_key: keyValue });
  assert.equal(first.status, 201); assert.equal(first.data.total, 5025);
  assert.equal(first.data.payment_method, 'card'); assert.equal(first.data.card_balance, 975);
  assert.equal((await u.cl.get('/api/wallet')).data.balance, 494000, 'borsa alımı karttan düşünce cüzdan değişmemeli');
  const replay = await u.cl.post('/api/market/trade', { side: 'buy', qty: '2', card_id: card.id, idempotency_key: keyValue });
  assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true);
  assert.equal((await u.cl.get(`/api/cards/${card.id}`)).data.balance, 975);
  const wrongSource = await u.cl.post('/api/market/trade', { side: 'buy', qty: '2', idempotency_key: keyValue });
  assert.equal(wrongSource.status, 409, 'aynı işlem anahtarı başka ödeme kaynağına taşınamaz');
  const entries = await sql(env, 'SELECT type, amount FROM card_ledger WHERE card_id = ? ORDER BY type', card.id);
  assert.deepEqual(entries.map((x) => [x.type, x.amount]), [['fund_in', 6000], ['payment', -5025]]);
  await consistent(env);
  await u.cl.post(`/api/cards/${card.id}/status`, { status: 'disabled' });
  const blocked = await u.cl.post('/api/market/trade', { side: 'buy', qty: '1', card_id: card.id, idempotency_key: key() });
  assert.equal(blocked.status, 400); assert.equal(blocked.data.error.code, 'card_disabled');
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
  assert.equal((await u.cl.get('/api/wallet')).data.balance, 500000 - 25125, 'başarısız satış bakiyeyi değiştirmez');
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

test('fiyat hareketi: piyasa volatilitesi güncellemeyle uygulanır ve eski altın verisi okunmaz', async () => {
  const { env, u } = await setup({ MARKET_VOLATILITY_BPS: '500' });
  const first = (await u.cl.get('/api/market')).data.price_micro;
  assert.equal(first, 25000000);
  const original = crypto.getRandomValues;
  try {
    crypto.getRandomValues = (arr) => { arr[0] = 1000; return arr; }; // 1000 mod 1001 = +500 bps
    env.__NOW += 2 * 60 * 1000;
    const next = (await u.cl.get('/api/market')).data;
    assert.equal(next.price_micro, 26250000);
    assert.equal(next.source, 'Nexus oyun piyasası');
    assert.equal(next.gold_usd, undefined);
  } finally {
    crypto.getRandomValues = original;
  }
});

test('fiyat başlangıç değerine doğru hafif geri çekilir ve sınırlar içinde kalır', async () => {
  const { env, u } = await setup({ MARKET_VOLATILITY_BPS: '500' });
  await u.cl.get('/api/market');
  const put = (price) => env.DB.prepare('INSERT OR REPLACE INTO market_state (key, value, updated_at) VALUES (?,?,?)')
    .bind('last_price', JSON.stringify({ model: 'nexus-market-v2', ts: env.__NOW, price_micro: price, source: 'Nexus oyun piyasası', move_bps: 0 }), env.__NOW).run();
  const original = crypto.getRandomValues;
  try {
    crypto.getRandomValues = (arr) => { arr[0] = 500; return arr; }; // rastgele hareket = 0 bps
    await put(50000000); // başlangıcın 2 katı: gap -5000 bps, %2 geri çekim = -100 bps
    env.__NOW += 2 * 60 * 1000;
    assert.equal((await u.cl.get('/api/market')).data.price_micro, 49500000);
    await put(10000000); // başlangıcın altında: yukarı çekilir
    env.__NOW += 2 * 60 * 1000;
    assert.ok((await u.cl.get('/api/market')).data.price_micro > 10000000);
    crypto.getRandomValues = (arr) => { arr[0] = 1000; return arr; }; // +500 bps
    await put(250000000); // üst sınır = başlangıç x 10
    env.__NOW += 2 * 60 * 1000;
    assert.ok((await u.cl.get('/api/market')).data.price_micro <= 250000000);
  } finally {
    crypto.getRandomValues = original;
  }
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


test('kart QR çözümleme: yalnızca aktif sanal kart kodu oturumlu kullanıcıya döner', async () => {
  const { env, u } = await setup();
  const created = await u.cl.post('/api/cards', { display_name: 'QR Test Kartı' });
  assert.equal(created.status, 201);
  const token = created.data.card_token;
  const resolved = await u.cl.get(`/api/cards/resolve?token=${encodeURIComponent(token)}`);
  assert.equal(resolved.status, 200);
  assert.equal(resolved.data.card_token, token);
  assert.equal(resolved.data.display_name, 'QR Test Kartı');
  assert.equal(resolved.data.username, 'miner_one');
  const bad = await u.cl.get('/api/cards/resolve?token=NXC-INVALID');
  assert.equal(bad.status, 400);
  await u.cl.post(`/api/cards/${created.data.id}/status`, { status: 'disabled' });
  const disabled = await u.cl.get(`/api/cards/resolve?token=${encodeURIComponent(token)}`);
  assert.equal(disabled.status, 404);
});

test('kart sözleşmesi: zeminle kontrastı düşük ad rengi reddedilir (marka okunabilirliği)', async () => {
  const { validateDesign, defaultDesign } = await import('../shared/card-contract.js');
  assert.equal(validateDesign(defaultDesign()).ok, true);
  const bad = validateDesign({ ...defaultDesign(), nameStyle: { color: '#ECEEF5' } });   // açık zemin üstünde açık ad
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /kontrast/);
  // Sunucu da aynı kuralı uygular
  const { u } = await setup();
  const r = await u.cl.post('/api/cards', { display_name: 'Kontrast', design: { ...defaultDesign(), nameStyle: { color: '#ECEEF5' } } });
  assert.equal(r.status, 400); assert.equal(r.data.error.code, 'invalid_design');
});
