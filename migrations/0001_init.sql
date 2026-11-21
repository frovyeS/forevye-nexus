-- FOREVYE NEXUS v1.0 - ilk şema. Tüm zamanlar sunucu saatiyle epoch milisaniyedir.
-- Para birimi: tamsayı "minor unit" (1 FN = 100). Gerçek para yoktur.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified_at INTEGER,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','superadmin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  suspended_until INTEGER,
  suspend_reason TEXT,
  avatar_key TEXT,
  last_username_change_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  CONSTRAINT wallet_nonneg CHECK (balance >= 0)
);

-- Denetlenebilir defter: yalnızca ekleme yapılır (aşağıdaki tetikleyiciler UPDATE/DELETE'i engeller).
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  tx_ref TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('transfer_out','transfer_in','topup','purchase','refund','adjustment','reversal')),
  amount INTEGER NOT NULL,            -- işaretli: + giriş, - çıkış
  balance_after INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('pending','success','failed','cancelled')),
  counterparty_id TEXT REFERENCES users(id),
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ledger_user_time ON ledger_entries(user_id, created_at DESC, id DESC);
CREATE INDEX idx_ledger_ref ON ledger_entries(tx_ref);

CREATE TABLE transfers (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  created_at INTEGER NOT NULL,
  CONSTRAINT transfer_idem UNIQUE (sender_id, idempotency_key),
  CONSTRAINT transfer_not_self CHECK (sender_id <> recipient_id)
);

-- Günlük limit atomik uygulanır: total <= cap ihlali tüm işlemi geri alır.
CREATE TABLE daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  total INTEGER NOT NULL,
  cap INTEGER NOT NULL,
  PRIMARY KEY (user_id, day),
  CONSTRAINT daily_cap CHECK (total <= cap)
);

-- Aynı harici kaynak (hediye kodu referansı, oyun içi alışveriş) iki kez işlenemez.
CREATE TABLE external_ops (
  external_ref TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  tx_ref TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Bir kayıt yalnızca bir kez ters kayıtla düzeltilebilir.
CREATE TABLE reversals (
  original_ref TEXT PRIMARY KEY,
  reversal_ref TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                -- oturum jetonunun SHA-256 özeti
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT,
  device_hash TEXT NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE email_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register','reset')),
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_codes_email ON email_codes(email, purpose, created_at DESC);

CREATE TABLE reg_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE username_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  old_name TEXT NOT NULL,
  new_name TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX idx_unhist_user ON username_history(user_id, changed_at);
CREATE INDEX idx_unhist_old ON username_history(lower(old_name), changed_at);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL DEFAULT '',     -- kullanıcının verdiği özel ad
  display_name TEXT NOT NULL,         -- kartta görünen serbest isim (benzersiz değil)
  card_token TEXT NOT NULL UNIQUE,    -- sistem atar, değiştirilemez, gerçek kart numarası DEĞİLDİR
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  is_default INTEGER NOT NULL DEFAULT 0,
  design_json TEXT NOT NULL,
  design_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_cards_user ON cards(user_id);

CREATE TABLE card_design_history (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  design_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (card_id, version)
);

CREATE TABLE card_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  design_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  limited_until INTEGER,              -- Nexus Collection: sınırlı süreli tema (ücretli mekanik YOK)
  created_at INTEGER NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notif_user ON notifications(user_id, created_at DESC);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  earned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  reason TEXT,
  result TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);

-- Değiştirilemez kayıtlar
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON admin_audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON admin_audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER unhist_no_update BEFORE UPDATE ON username_history BEGIN SELECT RAISE(ABORT, 'history is append-only'); END;
CREATE TRIGGER unhist_no_delete BEFORE DELETE ON username_history BEGIN SELECT RAISE(ABORT, 'history is append-only'); END;
