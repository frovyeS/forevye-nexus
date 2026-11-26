import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { makeEnv, register } from './helpers.mjs';

const SHOP_ORIGIN = 'https://shop.example';
const NEXUS = 'https://nexus.test';
const ticketOf = (url) => new URL(url).hash.replace(/^#t=/, '');

async function shopRequest(env, method, path, token, body) {
  const headers = { origin: SHOP_ORIGIN, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const res = await worker.fetch(new Request(`${NEXUS}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env, {});
  return { status: res.status, data: await res.json() };
}

test('eski D1: 0014 migration uygulanmamış olsa bile Market /me 500 vermez; topluluk şeması güvenle tamamlanır', async () => {
  const env = makeEnv({ SHOP_URL: `${SHOP_ORIGIN}/nexus-market/` });
  const user = await register(env, 'community-schema-heal@example.com', 'schema_heal');

  // Canlı D1'deki yaygın eski durum: Worker kodu güncel, fakat 0014 migration'ı
  // henüz uygulanmamış. Aynı durumu test veritabanında taklit et.
  await env.DB.batch([
    env.DB.prepare('DROP TABLE IF EXISTS card_market_sales'),
    env.DB.prepare('DROP TABLE IF EXISTS card_market_listings'),
    env.DB.prepare('DROP TABLE IF EXISTS card_market_guard'),
    env.DB.prepare('DROP INDEX IF EXISTS idx_cards_user_active'),
  ]);
  await env.DB.prepare('ALTER TABLE cards DROP COLUMN deleted_at').run();

  const ticketRes = await user.cl.post('/api/shop/ticket');
  assert.equal(ticketRes.status, 200, JSON.stringify(ticketRes.data));
  const exchange = await worker.fetch(new Request(`${NEXUS}/api/shop/exchange`, {
    method: 'POST',
    headers: { origin: SHOP_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ ticket: ticketOf(ticketRes.data.url) }),
  }), env, {});
  const exchangeData = await exchange.json();
  assert.equal(exchange.status, 200, JSON.stringify(exchangeData));

  const me = await shopRequest(env, 'GET', '/api/shop/me', exchangeData.token);
  assert.equal(me.status, 200, JSON.stringify(me.data));
  assert.ok(Array.isArray(me.data.cards));

  // Kartlarım endpoint'i de aynı kendini onaran şemayı kullanır.
  const bankCards = await user.cl.get('/api/cards');
  assert.equal(bankCards.status, 200, JSON.stringify(bankCards.data));
  const col = await env.DB.prepare('SELECT deleted_at FROM cards LIMIT 0').all();
  assert.equal(col.success, true);
  const table = await env.DB.prepare('SELECT id FROM card_market_listings LIMIT 0').all();
  assert.equal(table.success, true);
});
