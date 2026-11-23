import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEnv, register, fund, sql, one, PW } from './helpers.mjs';

const key = () => 'card_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24);

async function getDefaultCard(cl) {
  const r = await cl.get('/api/cards');
  assert.equal(r.status, 200);
  assert.ok(r.data.cards.length);
  return r.data.cards[0];
}

test('kart bakiyesi: cüzdandan yükleme ve cüzdana geri aktarma atomik, tekrar-güvenli', async () => {
  const env = makeEnv();
  const a = await register(env, 'cardfund@example.com', 'card_funder');
  await fund(env, a.me.user.id, 50000); // 500 FN ana cüzdan
  const card = await getDefaultCard(a.cl);
  assert.equal(card.balance, 0);

  const idem = key();
  const load = await a.cl.post(`/api/cards/${card.id}/fund`, { amount: '125.50', direction: 'load', idempotency_key: idem });
  assert.equal(load.status, 201, JSON.stringify(load.data));
  assert.equal(load.data.card_balance, 12550);
  assert.equal((await a.cl.get('/api/wallet')).data.balance, 37450);
  const replay = await a.cl.post(`/api/cards/${card.id}/fund`, { amount: '125.50', direction: 'load', idempotency_key: idem });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.ref, load.data.ref);
  assert.equal((await a.cl.get('/api/wallet')).data.balance, 37450, 'idempotent tekrar ikinci kez düşmemeli');

  const withdraw = await a.cl.post(`/api/cards/${card.id}/fund`, { amount: '25.50', direction: 'withdraw', idempotency_key: key() });
  assert.equal(withdraw.status, 201);
  assert.equal(withdraw.data.card_balance, 10000);
  assert.equal((await a.cl.get('/api/wallet')).data.balance, 40000);

  const poor = await a.cl.post(`/api/cards/${card.id}/fund`, { amount: '1000.00', direction: 'load', idempotency_key: key() });
  assert.equal(poor.status, 400);
  assert.equal(poor.data.error.code, 'insufficient_wallet');
  const tooMuch = await a.cl.post(`/api/cards/${card.id}/fund`, { amount: '100.01', direction: 'withdraw', idempotency_key: key() });
  assert.equal(tooMuch.status, 400);
  assert.equal(tooMuch.data.error.code, 'insufficient_card_funds');

  const currentCard = await a.cl.get(`/api/cards/${card.id}`);
  assert.equal(currentCard.data.balance, 10000);
  const entries = await sql(env, 'SELECT type, amount FROM card_ledger WHERE card_id = ? ORDER BY type', card.id);
  assert.deepEqual(entries.map((x) => [x.type, x.amount]), [['fund_in', 12550], ['fund_out', -2550]]);
  const wallet = await one(env, 'SELECT balance FROM wallets WHERE user_id = ?', a.me.user.id);
  const walletSum = await one(env, 'SELECT COALESCE(SUM(amount),0) AS s FROM ledger_entries WHERE user_id = ?', a.me.user.id);
  assert.equal(wallet.balance, walletSum.s, 'cüzdan defteri tutarlı olmalı');
  assert.throws(() => env.DB.raw.exec('UPDATE card_ledger SET amount = 1'), /append-only/);
});

test('kartla ödeme: seçilen karttan düşer, alıcı cüzdanına geçer, idempotent ve limitli', async () => {
  const env = makeEnv();
  const sender = await register(env, 'cardpay@example.com', 'card_payer');
  const receiver = await register(env, 'cardrecv@example.com', 'card_receiver');
  await fund(env, sender.me.user.id, 30000);
  const card = await getDefaultCard(sender.cl);
  const loaded = await sender.cl.post(`/api/cards/${card.id}/fund`, { amount: '200.00', direction: 'load', idempotency_key: key() });
  assert.equal(loaded.status, 201);

  env.__NOW += 1000;
  const idem = key();
  const pay = await sender.cl.post(`/api/cards/${card.id}/pay`, { recipient: 'CARD_RECEIVER', amount: '35.25', description: 'Oyun içi ödeme', idempotency_key: idem });
  assert.equal(pay.status, 201, JSON.stringify(pay.data));
  assert.equal(pay.data.recipient, 'card_receiver');
  assert.equal(pay.data.card_balance, 16475);
  assert.equal((await receiver.cl.get('/api/wallet')).data.balance, 3525);

  const replay = await sender.cl.post(`/api/cards/${card.id}/pay`, { recipient: 'card_receiver', amount: '35.25', description: 'Oyun içi ödeme', idempotency_key: idem });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.ref, pay.data.ref);
  assert.equal((await receiver.cl.get('/api/wallet')).data.balance, 3525);

  const changed = await sender.cl.post(`/api/cards/${card.id}/pay`, { recipient: 'card_receiver', amount: '36.00', idempotency_key: idem });
  assert.equal(changed.status, 409);

  const wrong = await sender.cl.post(`/api/cards/${card.id}/pay`, { recipient: 'nobody_here', amount: '1', idempotency_key: key() });
  assert.equal(wrong.status, 404);
  const self = await sender.cl.post(`/api/cards/${card.id}/pay`, { recipient: 'card_payer', amount: '1', idempotency_key: key() });
  assert.equal(self.status, 400);

  const items = (await sender.cl.get(`/api/cards/${card.id}/transactions`)).data.items;
  assert.equal(items[0].type, 'payment');
  assert.equal(items[0].amount, -3525);
  assert.equal((await receiver.cl.get('/api/notifications')).data.items.some((n) => n.type === 'card_payment_received'), true);

  const tooMuch = await sender.cl.post(`/api/cards/${card.id}/pay`, { recipient: 'card_receiver', amount: '1000.00', idempotency_key: key(), password: PW });
  assert.equal(tooMuch.status, 400);
  assert.equal(tooMuch.data.error.code, 'insufficient_card_funds');

  const disabled = await sender.cl.post(`/api/cards/${card.id}/status`, { status: 'disabled' });
  assert.equal(disabled.status, 200);
  const blocked = await sender.cl.post(`/api/cards/${card.id}/pay`, { recipient: 'card_receiver', amount: '1.00', idempotency_key: key() });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.data.error.code, 'card_disabled');

  const cardRow = await one(env, 'SELECT balance FROM cards WHERE id = ?', card.id);
  const cardSum = await one(env, 'SELECT COALESCE(SUM(amount),0) AS s FROM card_ledger WHERE card_id = ?', card.id);
  assert.equal(cardRow.balance, cardSum.s, 'kart bakiyesi kart defteriyle tutarlı olmalı');
  const recvBal = await one(env, 'SELECT balance FROM wallets WHERE user_id = ?', receiver.me.user.id);
  const recvSum = await one(env, 'SELECT COALESCE(SUM(amount),0) AS s FROM ledger_entries WHERE user_id = ?', receiver.me.user.id);
  assert.equal(recvBal.balance, recvSum.s, 'alıcı cüzdan defteri tutarlı olmalı');
});

test('yüksek tutarlı kart ödemesi yeniden parola ister; korumalı kart bakiyesi API dışından değiştirilemez', async () => {
  const env = makeEnv();
  const sender = await register(env, 'reauth-card@example.com', 'reauth_card');
  const receiver = await register(env, 'reauth-rec@example.com', 'reauth_recv');
  await fund(env, sender.me.user.id, 250000);
  const card = await getDefaultCard(sender.cl);
  assert.equal((await sender.cl.post(`/api/cards/${card.id}/fund`, { amount: '2000.00', direction: 'load', idempotency_key: key() })).status, 201);

  const body = { recipient: 'reauth_recv', amount: '1000.00', idempotency_key: key() };
  const noPw = await sender.cl.post(`/api/cards/${card.id}/pay`, body);
  assert.equal(noPw.status, 403);
  assert.equal(noPw.data.error.code, 'reauth_required');
  const wrongPw = await sender.cl.post(`/api/cards/${card.id}/pay`, { ...body, idempotency_key: key(), password: 'incorrect-Password1' });
  assert.equal(wrongPw.status, 403);
  const ok = await sender.cl.post(`/api/cards/${card.id}/pay`, { ...body, password: PW });
  assert.equal(ok.status, 201);

  const tamper = await sender.cl.patch(`/api/cards/${card.id}`, { balance: 999999 });
  assert.equal(tamper.status, 400, 'kart bakiyesi API üzerinden değiştirilememeli');
  const nonOwner = receiver.cl.get(`/api/cards/${card.id}/transactions`);
  assert.equal((await nonOwner).status, 404);
});

test('kart bakiyesi migration eksikse anlaşılır 503 verir; migration sonrası yükleme çalışır', async () => {
  const env = makeEnv();
  const a = await register(env, 'cardledger-repair@example.com', 'cardledger_fix');
  await fund(env, a.me.user.id, 10000);
  const card = await getDefaultCard(a.cl);

  // Yüklenen eski kaynakta bulunan durum: balance sütunu ve card_ledger tablosu henüz yok.
  env.DB.raw.exec('DROP TABLE card_ledger');
  env.DB.raw.exec('ALTER TABLE cards DROP COLUMN balance');
  const historyBefore = await a.cl.get(`/api/cards/${card.id}/transactions`);
  assert.equal(historyBefore.status, 503);
  assert.equal(historyBefore.data.error.code, 'card_schema_missing');
  const fundBefore = await a.cl.post(`/api/cards/${card.id}/fund`, {
    amount: '31.00', direction: 'load', idempotency_key: key(),
  });
  assert.equal(fundBefore.status, 503);
  assert.match(fundBefore.data.error.message, /db:migrate:remote/);

  env.DB.raw.exec(readFileSync(new URL('../migrations/0010_card_balances.sql', import.meta.url), 'utf8'));
  const historyAfter = await a.cl.get(`/api/cards/${card.id}/transactions`);
  assert.equal(historyAfter.status, 200, JSON.stringify(historyAfter.data));
  const loaded = await a.cl.post(`/api/cards/${card.id}/fund`, {
    amount: '31.00', direction: 'load', idempotency_key: key(),
  });
  assert.equal(loaded.status, 201, JSON.stringify(loaded.data));
  assert.equal(loaded.data.card_balance, 3100);
  assert.equal((await a.cl.get(`/api/cards/${card.id}/transactions`)).data.items.length, 1);
});
