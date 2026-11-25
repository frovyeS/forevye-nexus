// REGRESYON: "FOREVYE ID ile de, e-posta ile de girilmiyor — Beklenmeyen bir hata oluştu".
// Kök neden: Market kataloğunun tohumu TEK bir ~254 KB'lık INSERT idi; D1 tek SQL ifadesini 100 KB ile sınırlar.
// ensureShopSchema her soğuk başlangıçta patladı → meSummary/limitsFor → login ve /api/me 500.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { makeEnv, register, client, PW } from './helpers.mjs';
import { seedStatements, SEED } from '../src/lib/shop.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 100000;

test('hiçbir migration ifadesi D1 100 KB sınırını aşmaz', () => {
  for (const f of readdirSync(join(root, 'migrations')).filter((x) => x.endsWith('.sql'))) {
    const stmts = readFileSync(join(root, 'migrations', f), 'utf8').split(/;\s*\n/).filter((s) => s.trim());
    for (const s of stmts) assert.ok(Buffer.byteLength(s) < LIMIT, `${f}: ${Buffer.byteLength(s)} bayt (${s.slice(0, 60).replace(/\n/g, ' ')}…)`);
  }
});

test('katalog tohumu parçalıdır, her parça sınırın çok altındadır ve tüm ürünleri kapsar', () => {
  const parts = seedStatements();
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(Buffer.byteLength(p) < LIMIT / 2);
  assert.equal(parts.join('\n').match(/^ {2}\('/gm).length, SEED.length);
});

test('boş (eski) bir veritabanında ilk giriş 500 vermez; katalog kendiliğinden tohumlanır', async () => {
  const env = makeEnv();
  await env.DB.batch(['shop_card_skins', 'shop_entitlements', 'shop_purchases', 'shop_wishlist', 'shop_card_deliveries', 'shop_products'].map((t) => env.DB.prepare(`DROP TABLE IF EXISTS ${t}`)));
  const { cl } = await register(env, 'heal@example.com', 'heal_user');
  const c2 = client(env);
  const r = await c2.post('/api/auth/login', { email: 'heal@example.com', password: PW });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const me = await c2.get('/api/me');
  assert.equal(me.status, 200, JSON.stringify(me.data));
  const n = (await env.DB.prepare('SELECT COUNT(*) AS c FROM shop_products').first()).c;
  assert.equal(n, SEED.length);
  assert.ok(cl.hasSession());
});

test('mağaza şeması tamamen bozuk olsa bile giriş ve /api/me çalışır (temel sınırlarla)', async () => {
  const env = makeEnv();
  await register(env, 'broken@example.com', 'broken_user');
  const real = env.DB;
  env.DB = { ...real, prepare: (q) => { if (/shop_/.test(q)) throw new Error('D1_ERROR: no such table: shop_entitlements'); return real.prepare(q); }, batch: (s) => real.batch(s) };
  const cl = client(env);
  const r = await cl.post('/api/auth/login', { email: 'broken@example.com', password: PW });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.config.max_transfer, 500000);
  assert.equal(r.data.config.perks.limit_mult, 1);
});

test('/api/health tablo durumunu sır içermeden bildirir', async () => {
  const env = makeEnv();
  const r = await client(env).get('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.checks.users, 'ok');
  assert.ok(!JSON.stringify(r.data).includes('pepper'));
});
