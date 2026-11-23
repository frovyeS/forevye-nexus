-- Her sanal kartın kendi FN bakiyesi ve denetlenebilir işlem defteri.
-- Kart bakiyesi yalnızca Worker üzerinden, atomik D1 batch işlemleriyle değişir.
ALTER TABLE cards ADD COLUMN balance INTEGER NOT NULL DEFAULT 0
  CONSTRAINT card_balance_nonneg CHECK (balance >= 0);

CREATE TABLE card_ledger (
  id TEXT PRIMARY KEY,
  tx_ref TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  type TEXT NOT NULL CHECK (type IN ('fund_in','fund_out','payment')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  counterparty_id TEXT REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  CONSTRAINT card_ledger_idempotency UNIQUE (user_id, idempotency_key)
);
CREATE INDEX idx_card_ledger_card_time ON card_ledger(card_id, created_at DESC, id DESC);
CREATE INDEX idx_card_ledger_ref ON card_ledger(tx_ref);

CREATE TRIGGER card_ledger_no_update BEFORE UPDATE ON card_ledger BEGIN SELECT RAISE(ABORT, 'card ledger is append-only'); END;
CREATE TRIGGER card_ledger_no_delete BEFORE DELETE ON card_ledger BEGIN SELECT RAISE(ABORT, 'card ledger is append-only'); END;
