import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { makeEnv, register, fund, one } from './helpers.mjs';

const SHOP_ORIGIN = 'https://shop.example';
const NEXUS = 'https://nexus.test';
const ticketOf = (url) => new URL(url).hash.replace(/^#t=/, '');
async function tokenFor(env, user) {
  const ticket = await user.cl.post('/api/shop/ticket');
  assert.equal(ticket.status, 200, JSON.stringify(ticket.data));
  const res = await worker.fetch(new Request(`${NEXUS}/api/shop/exchange`, {
    method: 'POST', headers: { origin: SHOP_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ ticket: ticketOf(ticket.data.url) }),
  }), env, {});
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  return data.token;
}
async function shop(env, method, path, token, body) {
  const headers = { origin: SHOP_ORIGIN, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const res = await worker.fetch(new Request(`${NEXUS}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, {});
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const wallet = async (env, id) => Number((await one(env, 'SELECT balance FROM wallets WHERE user_id = ?', id)).balance);

test('topluluk pazarı: özel kart tek sahipte devredilir, %30 komisyon ve %70 satıcı ödemesi, idempotent', async () => {
  const env = makeEnv({ SHOP_URL: `${SHOP_ORIGIN}/nexus-market/` });
  const seller = await register(env, 'community-seller@example.com', 'community_seller');
  const buyer = await register(env, 'community-buyer@example.com', 'community_buyer');
  const sellerToken = await tokenFor(env, seller);
  const buyerToken = await tokenFor(env, buyer);
  const cardRes = await seller.cl.post('/api/cards', { display_name: 'AURORA CUSTOM' });
  assert.equal(cardRes.status, 201, JSON.stringify(cardRes.data));
  const cardId = cardRes.data.id;

  const defaultCard = (await seller.cl.get('/api/cards')).data.cards.find((c) => c.is_default);
  const blockedDefault = await shop(env, 'POST', '/api/shop/community/list', sellerToken, {
    card_id: defaultCard.id, title: 'Varsayılan kart', price: '100.00',
  });
  assert.equal(blockedDefault.status, 409);

  const listed = await shop(env, 'POST', '/api/shop/community/list', sellerToken, {
    card_id: cardId, title: 'Aurora Minimal', description: 'Ücretsiz editör araçlarıyla tasarlandı.', price: '120.00',
  });
  assert.equal(listed.status, 201, JSON.stringify(listed.data));
  assert.equal(listed.data.listing.commission_minor, 3600);
  assert.equal(listed.data.listing.seller_proceeds_minor, 8400);
  const market = await shop(env, 'GET', '/api/shop/community', buyerToken);
  assert.equal(market.status, 200);
  const item = market.data.items.find((x) => x.id === listed.data.listing.id);
  assert.ok(item);
  assert.equal(item.card.display_name, 'AURORA CUSTOM');

  await fund(env, buyer.me.user.id, 20000);
  const beforeBuyer = await wallet(env, buyer.me.user.id);
  const beforeSeller = await wallet(env, seller.me.user.id);
  const idem = 'community-buy-card-0001';
  const bought = await shop(env, 'POST', `/api/shop/community/${item.id}/buy`, buyerToken, { idem });
  assert.equal(bought.status, 201, JSON.stringify(bought.data));
  assert.equal(bought.data.sale.gross_minor, 12000);
  assert.equal(bought.data.sale.commission_minor, 3600);
  assert.equal(bought.data.sale.seller_minor, 8400);
  assert.equal(await wallet(env, buyer.me.user.id), beforeBuyer - 12000);
  assert.equal(await wallet(env, seller.me.user.id), beforeSeller + 8400);

  const owner = await one(env, 'SELECT user_id, deleted_at FROM cards WHERE id = ?', cardId);
  assert.equal(owner.user_id, buyer.me.user.id, 'kart satıcıdan alıcıya kopyalanmadan devredilmeli');
  assert.equal(owner.deleted_at, null);
  assert.equal((await seller.cl.get('/api/cards')).data.cards.some((c) => c.id === cardId), false);
  assert.equal((await buyer.cl.get('/api/cards')).data.cards.some((c) => c.id === cardId), true);
  const history = await one(env, 'SELECT user_id, version FROM card_design_history WHERE card_id = ?', cardId);
  assert.equal(history.user_id, buyer.me.user.id, 'tasarım geçmişi yeni sahibin hesabına bağlanmalı');

  const replay = await shop(env, 'POST', `/api/shop/community/${item.id}/buy`, buyerToken, { idem });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.equal(await wallet(env, buyer.me.user.id), beforeBuyer - 12000, 'aynı işlem ikinci kez ücret almamalı');
  const second = await shop(env, 'POST', `/api/shop/community/${item.id}/buy`, sellerToken, { idem: 'community-buy-card-0002' });
  assert.equal(second.status, 404, 'satılmış ilan tekrar satın alınamamalı');
  const sale = await one(env, 'SELECT gross_minor, commission_minor, seller_minor FROM card_market_sales WHERE listing_id = ?', item.id);
  assert.deepEqual([sale.gross_minor, sale.commission_minor, sale.seller_minor], [12000, 3600, 8400]);
});

test('resmî Market kartı anında FN iade edilir; özel kart silme soft-delete yapar', async () => {
  const env = makeEnv({ SHOP_URL: `${SHOP_ORIGIN}/nexus-market/` });
  const user = await register(env, 'community-return@example.com', 'community_return');
  const token = await tokenFor(env, user);
  await fund(env, user.me.user.id, 200000);
  const before = await wallet(env, user.me.user.id);
  const purchaseRes = await shop(env, 'POST', '/api/shop/purchase', token, { pid: 'skin_onyx', idem: 'community-return-purchase-01' });
  assert.equal(purchaseRes.status, 201, JSON.stringify(purchaseRes.data));
  const deliveredCardId = purchaseRes.data.delivery.card.id;
  assert.equal(await wallet(env, user.me.user.id), before - 180000);
  const cards = await user.cl.get('/api/cards');
  const returnedCard = cards.data.cards.find((c) => c.id === deliveredCardId);
  assert.equal(returnedCard.market_return.refund_minor, 180000);

  const returned = await user.cl.post(`/api/cards/${deliveredCardId}/market-return`, {});
  assert.equal(returned.status, 201, JSON.stringify(returned.data));
  assert.equal(returned.data.refund_minor, 180000);
  assert.equal(await wallet(env, user.me.user.id), before);
  assert.equal((await one(env, 'SELECT status FROM shop_purchases WHERE id = ?', purchaseRes.data.purchase.id)).status, 'refunded');
  assert.equal((await one(env, 'SELECT deleted_at FROM cards WHERE id = ?', deliveredCardId)).deleted_at !== null, true);
  assert.equal((await user.cl.get('/api/cards')).data.cards.some((c) => c.id === deliveredCardId), false);
  const twice = await user.cl.post(`/api/cards/${deliveredCardId}/market-return`, {});
  assert.equal(twice.status, 404);

  const custom = await user.cl.post('/api/cards', { display_name: 'DELETE ME' });
  assert.equal(custom.status, 201);
  const deleted = await user.cl.post(`/api/cards/${custom.data.id}/delete`, {});
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  assert.equal((await one(env, 'SELECT deleted_at FROM cards WHERE id = ?', custom.data.id)).deleted_at !== null, true);
  assert.equal((await user.cl.get('/api/cards')).data.cards.some((c) => c.id === custom.data.id), false);
});

test('topluluk ilanı iptal edilebilir; satıştaki kart düzenleme ve karttan harcama engellenir', async () => {
  const env = makeEnv({ SHOP_URL: `${SHOP_ORIGIN}/nexus-market/` });
  const user = await register(env, 'community-cancel@example.com', 'community_cancel');
  const token = await tokenFor(env, user);
  const card = await user.cl.post('/api/cards', { display_name: 'LISTED CARD' });
  const listed = await shop(env, 'POST', '/api/shop/community/list', token, { card_id: card.data.id, title: 'Listede', price: '10.00' });
  assert.equal(listed.status, 201, JSON.stringify(listed.data));
  const edit = await user.cl.patch(`/api/cards/${card.data.id}`, { label: 'Yeni etiket' });
  assert.equal(edit.status, 409);
  const cancelled = await shop(env, 'POST', `/api/shop/community/${listed.data.listing.id}/cancel`, token, {});
  assert.equal(cancelled.status, 200);
  const editAfter = await user.cl.patch(`/api/cards/${card.data.id}`, { label: 'Yeni etiket' });
  assert.equal(editAfter.status, 200, JSON.stringify(editAfter.data));
});
