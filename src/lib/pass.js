// Nexus Pass ortak yardımcıları (şema güvencesi, iade/düzeltmede üyeliği kapatma). Hem rotalar hem admin/internal iade yolları kullanır.
import { now } from './util.js';

// migrations/0006_pass.sql canlı D1'e uygulanmadıysa "no such table" → 500 olmasın: tablolar eksikse kendiliğinden kurulur (migration'la birebir aynı şema).
const SCHEMA_OK = new WeakSet();
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pass_products (id TEXT PRIMARY KEY, app TEXT NOT NULL, name TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '', features TEXT NOT NULL DEFAULT '[]', price INTEGER NOT NULL CHECK (price > 0), duration_s INTEGER NOT NULL CHECK (duration_s >= 3600), status TEXT NOT NULL DEFAULT 'on' CHECK (status IN ('on','off')), sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pass_purchases (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL, app TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, duration_s INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','refunded')), created_at INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_pass_purchases_user ON pass_purchases(user_id, created_at DESC)',
  `CREATE TABLE IF NOT EXISTS pass_entitlements (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL, purchase_id TEXT NOT NULL, starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, UNIQUE (user_id, product_id))`,
  'CREATE INDEX IF NOT EXISTS idx_pass_ent_user ON pass_entitlements(user_id)',
  'CREATE TABLE IF NOT EXISTS pass_guard (ok INTEGER NOT NULL, CONSTRAINT pass_not_active CHECK (ok = 1))',
  'CREATE TABLE IF NOT EXISTS pass_tickets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, consumed_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS pass_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_pass_tokens_exp ON pass_tokens(expires_at)',
  `INSERT OR IGNORE INTO pass_products (id, app, name, descr, features, price, duration_s, status, sort, created_at, updated_at) VALUES
    ('weather-premium-30', 'Mikro-Klima Hava', 'Premium', 'Gelişmiş hava özellikleri.', '["Gelişmiş tahminler","Reklamsız deneyim","Öncelikli güncellemeler"]', 500, 2592000, 'on', 10, 0, 0),
    ('store-plus-30', 'Nexus Mağaza', 'Plus', 'Mağazada ayrıcalıklar.', '["Özel mağaza ürünleri","Erken erişim"]', 300, 2592000, 'on', 20, 0, 0)`,
];
export async function ensurePassSchema(env) {
  if (!env.DB || SCHEMA_OK.has(env.DB)) return;
  await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
  SCHEMA_OK.add(env.DB);
}

// Üyelik iade/düzeltme edilirse (yönetici ters kaydı veya iç iade) üyelik hemen kapanır.
export async function passRevokeStmts(env, txRef) {
  await ensurePassSchema(env);
  const t = now(env);
  return [
    env.DB.prepare('UPDATE pass_entitlements SET expires_at = MIN(expires_at, ?) WHERE purchase_id = ?').bind(t, txRef),
    env.DB.prepare(`UPDATE pass_purchases SET status = 'refunded' WHERE id = ?`).bind(txRef),
  ];
}

