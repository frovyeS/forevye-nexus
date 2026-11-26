-- Kullanıcıların kendi ürettikleri (resmî Market ürünü/ücretli yüzey içermeyen) kartları
-- birbirlerine devredebilmeleri için topluluk pazarı. Kart silme soft-delete ile yapılır.
ALTER TABLE cards ADD COLUMN deleted_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_cards_user_active ON cards(user_id, deleted_at, is_default, created_at);

CREATE TABLE IF NOT EXISTS card_market_listings (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  seller_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_minor INTEGER NOT NULL CHECK (price_minor > 0),
  commission_minor INTEGER NOT NULL CHECK (commission_minor >= 0),
  seller_proceeds_minor INTEGER NOT NULL CHECK (seller_proceeds_minor > 0),
  status TEXT NOT NULL CHECK (status IN ('active','sold','cancelled')),
  buyer_id TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sold_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_market_one_active_per_card
  ON card_market_listings(card_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_card_market_active_time
  ON card_market_listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_market_seller
  ON card_market_listings(seller_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS card_market_sales (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL UNIQUE REFERENCES card_market_listings(id),
  buyer_id TEXT NOT NULL REFERENCES users(id),
  seller_id TEXT NOT NULL REFERENCES users(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  gross_minor INTEGER NOT NULL CHECK (gross_minor > 0),
  commission_minor INTEGER NOT NULL CHECK (commission_minor >= 0),
  seller_minor INTEGER NOT NULL CHECK (seller_minor > 0),
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (buyer_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_card_market_sales_seller
  ON card_market_sales(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_market_sales_buyer
  ON card_market_sales(buyer_id, created_at DESC);

-- İşlem içi koşul kilidi. Batch başarısız olursa tüm insert/delete geri alınır.
CREATE TABLE IF NOT EXISTS card_market_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
