-- Market'ten alınan fonksiyonel kartların gerçek banka kartlarına bağlanması.
CREATE TABLE IF NOT EXISTS shop_card_deliveries (
  purchase_id TEXT PRIMARY KEY REFERENCES shop_purchases(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  product_id TEXT NOT NULL REFERENCES shop_products(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shop_card_deliveries_user
  ON shop_card_deliveries(user_id, created_at DESC);
