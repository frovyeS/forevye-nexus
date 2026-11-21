-- Kart editörü devri: Nexus → (bilet) → banka editörü → (jeton) → Nexus.
-- Bilet: Nexus'ta oturum açmış kullanıcı için tek kullanımlık, 5 dakikalık anahtar (editör adresine # ile taşınır, sunucuya gitmez).
-- Jeton: bilet değişiminden doğan, yalnızca kart editörü uçlarında geçerli, kayan süreli (30 dk, en çok 4 saat) erişim anahtarı.
-- İkisi de yalnızca SHA-256 özetiyle saklanır.
CREATE TABLE editor_tickets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  card_id TEXT,                 -- NULL = yeni kart oluşturulacak
  label TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_editor_tickets_exp ON editor_tickets(expires_at);
CREATE TABLE editor_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  card_id TEXT,                 -- yeni kart ilk kayıtta oluşunca buraya bağlanır
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_editor_tokens_exp ON editor_tokens(expires_at);
