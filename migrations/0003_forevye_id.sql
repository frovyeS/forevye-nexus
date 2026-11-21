-- FOREVYE ID ile giriş: Nexus hesabı ↔ ID kullanıcısı bağı, giriş akışı (PKCE) durumu ve yeni kullanıcı için bekleyen kayıt.
CREATE TABLE id_links (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  id_user_id TEXT NOT NULL UNIQUE,
  linked_at INTEGER NOT NULL
);
CREATE TABLE id_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE id_pending (
  token_hash TEXT PRIMARY KEY,
  id_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
