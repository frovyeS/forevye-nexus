-- FOREVYE NEXUS v1.1 - Kristal borsası.
-- 1) ledger_entries.type CHECK kısıtına 'market_buy' ve 'market_sell' eklenir (SQLite'ta CHECK değiştirilemez; tablo yeniden kurulur).
-- 2) Borsa tabloları: fiyat anlık görüntüleri, kullanıcı kristal bakiyesi, işlem kayıtları.
-- Birimler: FN bakiyesi "minor" (1 FN = 100); kristal miktarı 1/10000 kristal; fiyat 1/1.000.000 FN.

CREATE TABLE ledger_entries_new (
  id TEXT PRIMARY KEY,
  tx_ref TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('transfer_out','transfer_in','topup','purchase','refund','adjustment','reversal','market_buy','market_sell')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('pending','success','failed','cancelled')),
  counterparty_id TEXT REFERENCES users(id),
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
INSERT INTO ledger_entries_new SELECT id, tx_ref, user_id, type, amount, balance_after, status, counterparty_id, description, created_at FROM ledger_entries;
DROP TABLE ledger_entries;
ALTER TABLE ledger_entries_new RENAME TO ledger_entries;
CREATE INDEX idx_ledger_user_time ON ledger_entries(user_id, created_at DESC, id DESC);
CREATE INDEX idx_ledger_ref ON ledger_entries(tx_ref);
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

-- Borsa durumu: gold_base_usd (1 FN'ye karşılık gelen baz altın fiyatı), last_price (JSON önbellek).
CREATE TABLE market_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Grafik için fiyat geçmişi (en fazla 5 dakikada bir satır; 35 günden eskisi temizlenir).
CREATE TABLE market_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  gold_usd REAL NOT NULL,
  price_micro INTEGER NOT NULL CHECK (price_micro > 0),
  source TEXT NOT NULL
);
CREATE INDEX idx_market_prices_ts ON market_prices(ts);

CREATE TABLE crystal_holdings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  qty INTEGER NOT NULL DEFAULT 0,
  cost_basis INTEGER NOT NULL DEFAULT 0,   -- ortalama maliyet için toplam FN (minor)
  updated_at INTEGER NOT NULL,
  CONSTRAINT crystal_nonneg CHECK (qty >= 0)
);

CREATE TABLE crystal_trades (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  qty INTEGER NOT NULL CHECK (qty > 0),
  price_micro INTEGER NOT NULL,            -- uygulanan fiyat (spread dahil)
  mid_micro INTEGER NOT NULL,              -- işlem anındaki orta fiyat
  total INTEGER NOT NULL CHECK (total > 0),-- FN (minor)
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CONSTRAINT trade_idem UNIQUE (user_id, idempotency_key)
);
CREATE INDEX idx_trades_user ON crystal_trades(user_id, created_at DESC, id DESC);
CREATE TRIGGER trades_no_update BEFORE UPDATE ON crystal_trades BEGIN SELECT RAISE(ABORT, 'trades are append-only'); END;
CREATE TRIGGER trades_no_delete BEFORE DELETE ON crystal_trades BEGIN SELECT RAISE(ABORT, 'trades are append-only'); END;
