-- Nexus Pass: FN ile alınan süreli üyelikler (Pass Service + Entitlement Service).
-- Fiyat ve süre yalnızca burada (sunucuda) belirlenir; istemciden gelen tutar kullanılmaz.
CREATE TABLE IF NOT EXISTS pass_products (
  id TEXT PRIMARY KEY,
  app TEXT NOT NULL,
  name TEXT NOT NULL,
  descr TEXT NOT NULL DEFAULT '',
  features TEXT NOT NULL DEFAULT '[]',
  price INTEGER NOT NULL CHECK (price > 0),            -- minor birim (100 = 1,00 FN)
  duration_s INTEGER NOT NULL CHECK (duration_s >= 3600),
  status TEXT NOT NULL DEFAULT 'on' CHECK (status IN ('on','off')),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pass_purchases (
  id TEXT PRIMARY KEY,                                  -- = defter işlem referansı (NXP-…)
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  app TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  duration_s INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','refunded')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pass_purchases_user ON pass_purchases(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS pass_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_pass_ent_user ON pass_entitlements(user_id);
-- Çift aktif üyeliğe karşı atomik koruma: aktif üyelik varken satın alma toplu işlemi bu CHECK'e takılıp geri alınır.
CREATE TABLE IF NOT EXISTS pass_guard (ok INTEGER NOT NULL, CONSTRAINT pass_not_active CHECK (ok = 1));
CREATE TABLE IF NOT EXISTS pass_tickets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS pass_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pass_tokens_exp ON pass_tokens(expires_at);
INSERT OR IGNORE INTO pass_products (id, app, name, descr, features, price, duration_s, status, sort, created_at, updated_at) VALUES
  ('weather-premium-30', 'Mikro-Klima Hava', 'Premium', 'Gelişmiş hava özellikleri.', '["Gelişmiş tahminler","Reklamsız deneyim","Öncelikli güncellemeler"]', 500, 2592000, 'on', 10, 0, 0),
  ('store-plus-30', 'Nexus Mağaza', 'Plus', 'Mağazada ayrıcalıklar.', '["Özel mağaza ürünleri","Erken erişim"]', 300, 2592000, 'on', 20, 0, 0);
