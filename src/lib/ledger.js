// Sanal bakiye defteri. Bakiye yalnızca bu modüldeki toplu (atomik) D1 işlemleriyle değişir.
// D1 batch() tek bir işlemdir: herhangi bir ifade hata verirse tümü geri alınır.
import { HttpError, now, newRef, dayKey, cfgNum, isConstraint, isSuspended } from './util.js';
import { notifyStmt } from './auth.js';
import { limitsFor } from './shop.js';

const fmt = (minor) => (minor / 100).toFixed(2);
export { fmt as fmtMinor };

// Bir bakiye hareketi: cüzdanı günceller + defter kaydı ekler. amount işaretlidir.
export function entryStmts(env, { ref, userId, type, amount, counterparty = null, desc = '' }) {
  const t = now(env);
  return [
    env.DB.prepare('UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ?').bind(amount, t, userId),
    env.DB.prepare(
      `INSERT INTO ledger_entries (id, tx_ref, user_id, type, amount, balance_after, status, counterparty_id, description, created_at)
       VALUES (?,?,?,?,?, (SELECT balance FROM wallets WHERE user_id = ?), 'success', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), ref, userId, type, amount, userId, counterparty, desc, t),
  ];
}

// Hesap durumu aktif değilse SQL hatası üretip tüm işlemi geri alır (yarış koşullarına karşı son savunma).
export function guardActiveStmt(env, ...userIds) {
  const t = now(env);
  const conds = userIds.map(() => `EXISTS (SELECT 1 FROM users WHERE id = ? AND (status = 'active' OR (suspended_until IS NOT NULL AND suspended_until <= ?)))`).join(' AND ');
  const binds = userIds.flatMap((id) => [id, t]);
  // Koşul sağlanmazsa json_extract geçersiz JSON nedeniyle hata verir -> "malformed JSON".
  return env.DB.prepare(`SELECT json_extract(CASE WHEN ${conds} THEN '{}' ELSE 'x' END, '$')`).bind(...binds);
}

export async function getTransferByKey(env, senderId, key) {
  return env.DB.prepare('SELECT ref, recipient_id, amount, status, created_at FROM transfers WHERE sender_id = ? AND idempotency_key = ?')
    .bind(senderId, key).first();
}

export async function transfer(env, sender, recipient, amount, idempotencyKey, description = '') {
  const t = now(env);
  // Fonksiyonel Market kartları (ör. Titanyum) işlem ve günlük limiti artırır; hesap sunucuda yapılır.
  const lim = await limitsFor(env, sender.id);
  const maxTx = lim.max_transfer;
  const dailyCap = lim.daily_limit;

  if (sender.id === recipient.id) throw new HttpError(400, 'self_transfer', 'Kendinize transfer yapamazsınız.');
  if (isSuspended(sender, t)) throw new HttpError(403, 'account_suspended', 'Hesabınız askıda; transfer yapılamaz.');
  if (isSuspended(recipient, t)) throw new HttpError(400, 'invalid_recipient', 'Bu alıcıya transfer yapılamıyor.');
  if (amount > maxTx) throw new HttpError(400, 'limit_exceeded', `İşlem başına en fazla ${fmt(maxTx)} gönderebilirsiniz.`);

  const day = dayKey(t);
  const used = await env.DB.prepare('SELECT total FROM daily_usage WHERE user_id = ? AND day = ?').bind(sender.id, day).first();
  if ((used?.total || 0) + amount > dailyCap) throw new HttpError(400, 'daily_limit', 'Günlük transfer limitinizi aşıyorsunuz.');

  const ref = newRef('NXT');
  const stmts = [
    guardActiveStmt(env, sender.id, recipient.id),
    env.DB.prepare('INSERT INTO transfers (id, ref, sender_id, recipient_id, amount, idempotency_key, status, created_at, description) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), ref, sender.id, recipient.id, amount, idempotencyKey, 'success', t, description),
    env.DB.prepare(
      `INSERT INTO daily_usage (user_id, day, total, cap) VALUES (?,?,?,?)
       ON CONFLICT(user_id, day) DO UPDATE SET total = total + excluded.total, cap = excluded.cap`,
    ).bind(sender.id, day, amount, dailyCap),
    ...entryStmts(env, { ref, userId: sender.id, type: 'transfer_out', amount: -amount, counterparty: recipient.id, desc: description || 'Kullanıcıya transfer' }),
    ...entryStmts(env, { ref, userId: recipient.id, type: 'transfer_in', amount, counterparty: sender.id, desc: description || 'Kullanıcıdan transfer' }),
    notifyStmt(env, sender.id, 'transfer_sent', 'Transfer gönderildi', `${fmt(amount)} gönderildi. Alıcı: @${recipient.username}.${description ? ` Açıklama: ${description}` : ''} Ref: ${ref}`),
    notifyStmt(env, recipient.id, 'transfer_received', 'Transfer alındı', `${fmt(amount)} aldınız. Gönderen: @${sender.username}.${description ? ` Açıklama: ${description}` : ''} Ref: ${ref}`),
  ];
  try {
    await env.DB.batch(stmts);
  } catch (err) {
    if (isConstraint(err, 'wallet_nonneg')) throw new HttpError(400, 'insufficient_funds', 'Yetersiz bakiye.');
    if (isConstraint(err, 'daily_cap')) throw new HttpError(400, 'daily_limit', 'Günlük transfer limitinizi aşıyorsunuz.');
    if (isConstraint(err, 'transfers.idempotency_key')) {
      // Eşzamanlı tekrar: ilk isteğin sonucunu döndür (çift transfer oluşmaz).
      const prior = await getTransferByKey(env, sender.id, idempotencyKey);
      if (prior) return { ref: prior.ref, amount: prior.amount, replayed: true };
    }
    if (String(err.message || err).includes('malformed JSON')) throw new HttpError(409, 'account_state_changed', 'Hesap durumu değişti; işlem yapılamadı.');
    throw err;
  }
  return { ref, amount, replayed: false };
}

// Harici kaynaklı kredi (hediye kodu yükleme). source_ref tekrarını veritabanı engeller.
export async function creditExternal(env, { userId, amount, externalRef, kind = 'topup', desc }) {
  const t = now(env);
  const ref = newRef('NXL');
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO external_ops (external_ref, kind, user_id, tx_ref, created_at) VALUES (?,?,?,?,?)').bind(externalRef, kind, userId, ref, t),
      ...entryStmts(env, { ref, userId, type: 'topup', amount, desc }),
      notifyStmt(env, userId, 'topup', 'Bakiye yüklendi', `${fmt(amount)} bakiyenize eklendi. Ref: ${ref}`),
    ]);
  } catch (err) {
    if (isConstraint(err, 'external_ops')) {
      const prior = await env.DB.prepare('SELECT tx_ref FROM external_ops WHERE external_ref = ?').bind(externalRef).first();
      return { ref: prior?.tx_ref, replayed: true };
    }
    throw err;
  }
  return { ref, replayed: false };
}

// Oyun içi alışveriş (sunucudan sunucuya). external_ref ile tekrar-güvenli.
export async function purchase(env, { userId, amount, externalRef, desc }) {
  const t = now(env);
  const ref = newRef('NXP');
  try {
    await env.DB.batch([
      guardActiveStmt(env, userId),
      env.DB.prepare('INSERT INTO external_ops (external_ref, kind, user_id, tx_ref, created_at) VALUES (?,?,?,?,?)').bind(externalRef, 'purchase', userId, ref, t),
      ...entryStmts(env, { ref, userId, type: 'purchase', amount: -amount, desc }),
      notifyStmt(env, userId, 'purchase', 'Alışveriş yapıldı', `${fmt(amount)} harcandı. Ref: ${ref}`),
    ]);
  } catch (err) {
    if (isConstraint(err, 'wallet_nonneg')) throw new HttpError(400, 'insufficient_funds', 'Yetersiz bakiye.');
    if (isConstraint(err, 'external_ops')) {
      const prior = await env.DB.prepare('SELECT tx_ref FROM external_ops WHERE external_ref = ?').bind(externalRef).first();
      return { ref: prior?.tx_ref, replayed: true };
    }
    if (String(err.message || err).includes('malformed JSON')) throw new HttpError(409, 'account_state_changed', 'Hesap askıda; işlem yapılamadı.');
    throw err;
  }
  return { ref, replayed: false };
}

// Düzeltme/iade: eski kayıt SİLİNMEZ; her bir hareket için ters kayıt eklenir. Bir kayıt yalnızca bir kez düzeltilir.
export async function reverseRef(env, { originalRef, type = 'reversal', actor, reason = '' }) {
  const rows = (await env.DB.prepare('SELECT * FROM ledger_entries WHERE tx_ref = ? AND status = ?').bind(originalRef, 'success').all()).results;
  if (!rows.length) throw new HttpError(404, 'not_found', 'İşlem bulunamadı.');
  // Borsa işlemleri yalnızca bakiyeyi değil kristal envanterini de değiştirir; tek taraflı ters kayıt defteri bozar.
  if (rows.some((r) => r.type === 'market_buy' || r.type === 'market_sell')) throw new HttpError(400, 'not_reversible', 'Borsa işlemleri ters kayıtla düzeltilemez.');
  if (rows.some((r) => r.type === 'reversal' || r.type === 'refund')) throw new HttpError(400, 'not_reversible', 'Bu kayıt zaten bir düzeltme kaydıdır.');
  const t = now(env);
  const ref = newRef('NXR');
  const stmts = [
    env.DB.prepare('INSERT INTO reversals (original_ref, reversal_ref, actor, created_at) VALUES (?,?,?,?)').bind(originalRef, ref, actor, t),
  ];
  for (const r of rows) {
    stmts.push(...entryStmts(env, { ref, userId: r.user_id, type, amount: -r.amount, counterparty: r.counterparty_id, desc: `Düzeltme (orijinal ref: ${originalRef})` }));
    stmts.push(notifyStmt(env, r.user_id, 'reversal', 'İşlem düzeltildi', `Ref ${originalRef} için ters kayıt oluşturuldu: ${ref}`));
  }
  return { ref, stmts };
}

export async function runBatch(env, stmts) {
  try {
    await env.DB.batch(stmts);
  } catch (err) {
    if (isConstraint(err, 'wallet_nonneg')) throw new HttpError(400, 'insufficient_funds', 'Düzeltme için hesapta yeterli bakiye yok.');
    if (isConstraint(err, 'reversals')) throw new HttpError(409, 'already_reversed', 'Bu kayıt zaten düzeltildi.');
    throw err;
  }
}
