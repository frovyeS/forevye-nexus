-- Hediye kartıyla kullanıcıya doğrudan KRİSTAL verilir (FN değil). Her kart (Mikro-Klima referansı) bir kez işlenir; kayıt silinmez/değişmez.
-- qty: kristal birimi (1 kristal = 10.000 birim), crystal_holdings ile aynı ölçek.
CREATE TABLE IF NOT EXISTS crystal_gifts (
  ref TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crystal_gifts_user ON crystal_gifts(user_id, created_at DESC);
CREATE TRIGGER IF NOT EXISTS crystal_gifts_no_update BEFORE UPDATE ON crystal_gifts BEGIN SELECT RAISE(ABORT, 'crystal_gifts are append-only'); END;
CREATE TRIGGER IF NOT EXISTS crystal_gifts_no_delete BEFORE DELETE ON crystal_gifts BEGIN SELECT RAISE(ABORT, 'crystal_gifts are append-only'); END;
