import { HttpError } from './util.js';

const CARD_SCHEMA_HINT = 'Kart bakiyesi veritabanı güncellemesi eksik. Nexus ana proje klasöründe npm run db:migrate:remote komutunu, ardından npm run deploy komutunu çalıştırın.';

// Kart listesi/detayı da bu kontrolü kullanır: eski D1 şemasında balance alanı
// bulunmuyorsa Number(undefined || 0) ile kullanıcıya sahte 0 FN gösterilmez.
export async function requireCardMoneySchema(env) {
  try {
    await env.DB.prepare('SELECT balance FROM cards LIMIT 0').all();
  } catch (err) {
    if (/no such column: balance/i.test(String(err?.message || err))) {
      throw new HttpError(503, 'card_schema_missing', CARD_SCHEMA_HINT);
    }
    throw err;
  }

  try {
    await env.DB.prepare('SELECT id, tx_ref, user_id, card_id, type, amount, balance_after, counterparty_id, idempotency_key, description, created_at FROM card_ledger LIMIT 0').all();
  } catch (err) {
    if (/no such table: card_ledger/i.test(String(err?.message || err))) {
      throw new HttpError(503, 'card_schema_missing', CARD_SCHEMA_HINT);
    }
    throw err;
  }
}
