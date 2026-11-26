-- Banka uygulamasına kapsamlı ama kısa ömürlü token devri; tek kullanımlık giriş biletleri.
CREATE TABLE IF NOT EXISTS bank_tickets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bank_tickets_exp ON bank_tickets(expires_at);
CREATE TABLE IF NOT EXISTS bank_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_tokens_exp ON bank_tokens(expires_at);
ALTER TABLE transfers ADD COLUMN description TEXT NOT NULL DEFAULT '';
