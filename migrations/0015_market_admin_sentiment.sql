-- Günlük yönetici piyasa güven puanı (Türkiye takvim gününe göre, tek kayıt/gün).
CREATE TABLE IF NOT EXISTS market_admin_sentiment (
  day TEXT PRIMARY KEY,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  admin_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_admin_sentiment_created
  ON market_admin_sentiment(created_at DESC);
