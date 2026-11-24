import { HttpError } from './util.js';

const CARD_SCHEMA_HINT = 'Kart altyapısı otomatik hazırlanamadı. GitHub Actions bölümünde FOREVYE NEXUS Worker dağıtımının başarılı olduğunu doğrulayın. Dağıtım başarısızsa ilk hata satırını kontrol edin.';

const messageOf = (err) => String(err?.message || err || '');
const missingBalance = (err) => /no such column:\s*balance/i.test(messageOf(err));
const missingLedger = (err) => /no such table:\s*(?:main\.)?card_ledger/i.test(messageOf(err));
const duplicateBalance = (err) => /duplicate column name:\s*balance/i.test(messageOf(err));

const LEDGER_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS card_ledger (
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
  )`,
  'CREATE INDEX IF NOT EXISTS idx_card_ledger_card_time ON card_ledger(card_id, created_at DESC, id DESC)',
  'CREATE INDEX IF NOT EXISTS idx_card_ledger_ref ON card_ledger(tx_ref)',
  `CREATE TRIGGER IF NOT EXISTS card_ledger_no_update
    BEFORE UPDATE ON card_ledger BEGIN
      SELECT RAISE(ABORT, 'card ledger is append-only');
    END`,
  `CREATE TRIGGER IF NOT EXISTS card_ledger_no_delete
    BEFORE DELETE ON card_ledger BEGIN
      SELECT RAISE(ABORT, 'card ledger is append-only');
    END`,
];

async function ensureBalanceColumn(env) {
  try {
    await env.DB.prepare('SELECT balance FROM cards LIMIT 0').all();
    return;
  } catch (err) {
    if (!missingBalance(err)) throw err;
  }

  // Eski D1'lerde 0010 migration'ı hiç uygulanmamış olabilir. ALTER işlemi
  // güvenlidir ve mevcut kart satırlarına başlangıç bakiyesi 0 ekler.
  try {
    await env.DB.prepare(`ALTER TABLE cards ADD COLUMN balance INTEGER NOT NULL DEFAULT 0
      CONSTRAINT card_balance_nonneg CHECK (balance >= 0)`).run();
  } catch (err) {
    // Aynı anda iki Worker izolatı ilk isteği işlerse biri sütunu eklemiş olabilir.
    if (!duplicateBalance(err)) throw err;
  }

  await env.DB.prepare('SELECT balance FROM cards LIMIT 0').all();
}

async function ensureLedgerTable(env) {
  try {
    await env.DB.prepare('SELECT id, tx_ref, user_id, card_id, type, amount, balance_after, counterparty_id, idempotency_key, description, created_at FROM card_ledger LIMIT 0').all();
    return;
  } catch (err) {
    if (!missingLedger(err)) throw err;
  }

  // CREATE IF NOT EXISTS sayesinde tekrar çağrılar ve eşzamanlı ilk istekler güvenlidir.
  for (const statement of LEDGER_SCHEMA) {
    await env.DB.prepare(statement).run();
  }

  await env.DB.prepare('SELECT id, tx_ref, user_id, card_id, type, amount, balance_after, counterparty_id, idempotency_key, description, created_at FROM card_ledger LIMIT 0').all();
}

/**
 * Kart bakiye şemasını canlı D1 üzerinde kendiliğinden tamamlar.
 * Önceden doldurulmuş D1'lerde migration geçmişi eksik/farklı olsa bile
 * eski migration dosyalarını baştan çalıştırmaya veya veriyi sıfırlamaya gerek yoktur.
 */
export async function requireCardMoneySchema(env) {
  if (!env?.DB) throw new HttpError(503, 'card_schema_missing', CARD_SCHEMA_HINT);

  try {
    await ensureBalanceColumn(env);
    await ensureLedgerTable(env);
  } catch (err) {
    // Şema dışındaki bağlantı/izin hatalarını sessizce gizleme.
    const message = messageOf(err);
    if (/no such table:\s*(?:main\.)?cards/i.test(message)
      || /no such column:\s*balance/i.test(message)
      || /no such table:\s*(?:main\.)?card_ledger/i.test(message)
      || /duplicate column name:\s*balance/i.test(message)) {
      throw new HttpError(503, 'card_schema_missing', CARD_SCHEMA_HINT);
    }
    throw err;
  }
}
