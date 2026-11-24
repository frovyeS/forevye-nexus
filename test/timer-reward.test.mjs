import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { makeEnv, register, one } from './helpers.mjs';
import { hmacHex } from '../src/lib/crypto.js';

const SECRET = 'shared-nexus-giftcard-secret-for-tests';
const ID_UID = 'usr_0123456789abcdef';
const EMAIL = 'timer.reward@example.com';

async function signedCall(env, path, body, { secret = SECRET, timestamp = env.__NOW } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(timestamp);
  const signature = await hmacHex(secret, `${ts}.${raw}`);
  const res = await worker.fetch(new Request(`https://nexus.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nx-timestamp': ts,
      'x-nx-signature': signature,
    },
    body: raw,
  }), env, {});
  return { status: res.status, data: await res.json() };
}

async function bankWithLinkedId() {
  const env = makeEnv({ GIFTCARD_API_SECRET: SECRET });
  const { me } = await register(env, EMAIL, 'timer_reward');
  await env.DB.prepare('UPDATE crystal_holdings SET qty=0,cost_basis=0 WHERE user_id=?').bind(me.user.id).run();
  await env.DB.prepare('INSERT INTO id_links(user_id,id_user_id,linked_at) VALUES(?,?,?)')
    .bind(me.user.id, ID_UID, env.__NOW).run();
  return { env, userId: me.user.id };
}

test('timer reward: FOREVYE ID finds existing Nexus bank account and reads live crystal balance', async () => {
  const { env, userId } = await bankWithLinkedId();
  await env.DB.prepare('UPDATE crystal_holdings SET qty=?,cost_basis=?,updated_at=? WHERE user_id=?')
    .bind(123456, 777, env.__NOW, userId).run();
  const r = await signedCall(env, '/api/ext/timer-reward/account', {
    id_user_id: ID_UID, email: EMAIL, email_verified: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.crystals, 12.3456);
  assert.equal(r.data.qty, 123456);
});

test('timer reward: verified matching email auto-links legacy bank account without user action', async () => {
  const { env, userId } = await bankWithLinkedId();
  await env.DB.prepare('DELETE FROM id_links WHERE user_id=?').bind(userId).run();
  const r = await signedCall(env, '/api/ext/timer-reward/account', {
    id_user_id: ID_UID, email: EMAIL, email_verified: true,
  });
  assert.equal(r.status, 200);
  const link = await one(env, 'SELECT user_id,id_user_id FROM id_links WHERE id_user_id=?', ID_UID);
  assert.deepEqual(link, { user_id: userId, id_user_id: ID_UID });
});

test('timer reward: daily credit goes directly to bank crystal_holdings once; retries never double-credit', async () => {
  const { env, userId } = await bankWithLinkedId();
  const body = {
    id_user_id: ID_UID, email: EMAIL, email_verified: true,
    source: 'zamanlayici_daily', day: '2026-11-20', qty: 400000,
    ref: 'timer_0123456789abcdef0123456789abcdef0123_20261120',
  };
  const first = await signedCall(env, '/api/ext/timer-reward/credit', body);
  assert.equal(first.status, 200);
  assert.equal(first.data.credited, true);
  assert.equal(first.data.crystals, 40);
  const second = await signedCall(env, '/api/ext/timer-reward/credit', body);
  assert.equal(second.status, 200);
  assert.equal(second.data.replayed, true);
  const holding = await one(env, 'SELECT qty,cost_basis FROM crystal_holdings WHERE user_id=?', userId);
  assert.deepEqual(holding, { qty: 400000, cost_basis: 0 });
  const claims = await one(env, 'SELECT COUNT(*) AS n FROM crystal_reward_credits WHERE id_user_id=?', ID_UID);
  assert.equal(claims.n, 1);
});

test('timer reward: rejects bad signature, unverified identity, malformed amount and a second daily claim', async () => {
  const { env } = await bankWithLinkedId();
  const base = { id_user_id: ID_UID, email: EMAIL, email_verified: true };
  const badSig = await signedCall(env, '/api/ext/timer-reward/account', base, { secret: 'wrong-secret-value-with-enough-length' });
  assert.equal(badSig.status, 401);
  const unverified = await signedCall(env, '/api/ext/timer-reward/account', { ...base, email_verified: false });
  assert.equal(unverified.status, 400);
  const invalidQty = await signedCall(env, '/api/ext/timer-reward/credit', {
    ...base, source: 'zamanlayici_daily', day: '2026-11-20', qty: 400001,
    ref: 'timer_0123456789abcdef0123456789abcdef0123_20261120',
  });
  assert.equal(invalidQty.status, 400);
  const body = {
    ...base, source: 'zamanlayici_daily', day: '2026-11-20', qty: 100000,
    ref: 'timer_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_20261120',
  };
  assert.equal((await signedCall(env, '/api/ext/timer-reward/credit', body)).status, 200);
  const conflicting = await signedCall(env, '/api/ext/timer-reward/credit', {
    ...body, qty: 200000, ref: 'timer_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_20261120',
  });
  assert.equal(conflicting.status, 409);
});
