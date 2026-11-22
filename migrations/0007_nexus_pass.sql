-- Nexus Pass: süreli üyelikler (FN bakiyesiyle alınır). Arayüz ayrı sitede (nexus-pass), tüm kurallar burada.
-- Fiyat/süre/çift üyelik denetimi sunucudadır; istemciden gelen tutar kullanılmaz.
CREATE TABLE IF NOT EXISTS nxp_products (
  id TEXT PRIMARY KEY,
  app TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  features_json TEXT NOT NULL DEFAULT '[]',
  price INTEGER NOT NULL CHECK (price > 0),            -- minor unit (1 FN = 100)
  duration_sec INTEGER NOT NULL CHECK (duration_sec >= 3600),
  status TEXT NOT NULL DEFAULT 'on' CHECK (status IN ('on','off')),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Her satır bir satın alma ve onun doğurduğu üyeliktir. id = defter işlem referansı (NXP-...).
-- Ters kayıt (reversals.original_ref = id) olursa üyelik hemen kapanır.
CREATE TABLE IF NOT EXISTS nxp_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  app TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL,
  idem TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CONSTRAINT nxp_idem UNIQUE (user_id, idem)
);
CREATE INDEX IF NOT EXISTS idx_nxp_purch_user ON nxp_purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nxp_purch_prod ON nxp_purchases(user_id, product_id, expires_at);

-- Bilet: Nexus oturumundan tek kullanımlık (5 dk). Jeton: yalnızca /api/pass/* için, 30 dk kayan, en çok 8 saat. İkisi de yalnızca SHA-256 özetiyle saklanır.
CREATE TABLE IF NOT EXISTS nxp_tickets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_nxp_tickets_exp ON nxp_tickets(expires_at);
CREATE TABLE IF NOT EXISTS nxp_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nxp_tokens_exp ON nxp_tokens(expires_at);
