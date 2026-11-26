// Kart bakiyeleri: cüzdan -> kart yükleme, kart -> cüzdan iade ve seçilen kartla kullanıcı ödemesi.
// Tüm bakiye değişimleri D1 batch içinde atomiktir; kart bakiyesi asla istemciden kabul edilmez.
import { HttpError, json, readJson, parseAmount, str, now, newRef, dayKey, cfgNum, isConstraint, isSuspended, MIN } from '../lib/util.js';
import { verifyPassword } from '../lib/crypto.js';
import { rateLimit } from '../lib/rate.js';
import { entryStmts, guardActiveStmt } from '../lib/ledger.js';
import { notifyStmt } from '../lib/auth.js';
import { ownCard, ensureCardNotListed } from './cards.js';
import { limitsFor } from '../lib/shop.js';
import { requireCardMoneySchema } from '../lib/card-money-schema.js';

const money = (minor) => (minor / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function priorOperation(env, userId, key, { cardId, type, amount, counterpartyId = null }) {
  const old = await env.DB.prepare('SELECT tx_ref, card_id, type, amount, counterparty_id, balance_after FROM card_ledger WHERE user_id = ? AND idempotency_key = ?').bind(userId, key).first();
  if (!old) return null;
  if (old.card_id !== cardId || old.type !== type || old.amount !== amount || (counterpartyId && old.counterparty_id !== counterpartyId)) {
    throw new HttpError(409, 'key_reuse', 'Bu işlem anahtarı farklı bir istek için kullanılmış.');
  }
  return { ok: true, ref: old.tx_ref, card_balance: old.balance_after, replayed: true };
}

function ledgerInsert(env, { ref, userId, cardId, type, amount, counterpartyId = null, key, description }) {
  return env.DB.prepare(`INSERT INTO card_ledger
    (id, tx_ref, user_id, card_id, type, amount, balance_after, counterparty_id, idempotency_key, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, (SELECT balance FROM cards WHERE id = ? AND user_id = ?), ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), ref, userId, cardId, type, amount, cardId, userId, counterpartyId, key, description, now(env));
}

function validateKey(value) {
  const key = str(value, { min: 8, max: 80, name: 'İşlem anahtarı' });
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new HttpError(400, 'invalid_key', 'İşlem anahtarı geçersiz.');
  return key;
}

export const cardMoneyRoutes = {
  async fund(req, env, url, { user }, params) {
    await requireCardMoneySchema(env);
    const b = await readJson(req);
    await rateLimit(env, `cardfund:${user.id}`, 30, 10 * MIN);
    const card = await ownCard(env, user.id, params.id);
    await ensureCardNotListed(env, card.id);
    const amount = parseAmount(b.amount);
    const key = validateKey(b.idempotency_key);
    const direction = b.direction === undefined ? 'load' : b.direction;
    if (!['load', 'withdraw'].includes(direction)) throw new HttpError(400, 'invalid_direction', 'Yön load veya withdraw olmalı.');
    const type = direction === 'load' ? 'fund_in' : 'fund_out';
    const signed = direction === 'load' ? amount : -amount;
    const replay = await priorOperation(env, user.id, key, { cardId: card.id, type, amount: signed });
    if (replay) return json(replay);
    if (direction === 'load' && card.status !== 'active') throw new HttpError(400, 'card_disabled', 'Devre dışı karta para yüklenemez.');

    const ref = newRef('NXC');
    const desc = direction === 'load' ? `Kart yükleme: ${card.label || card.display_name}` : `Karttan cüzdana aktarım: ${card.label || card.display_name}`;
    const stmts = [guardActiveStmt(env, user.id)];
    if (direction === 'load') {
      stmts.push(env.DB.prepare(`SELECT json_extract(CASE WHEN EXISTS (
        SELECT 1 FROM cards WHERE id = ? AND user_id = ? AND status = 'active'
      ) THEN '{}' ELSE 'x' END, '$')`).bind(card.id, user.id));
      stmts.push(env.DB.prepare(`UPDATE cards SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'active'`).bind(amount, now(env), card.id, user.id));
      stmts.push(...entryStmts(env, { ref, userId: user.id, type: 'purchase', amount: -amount, desc }));
    } else {
      stmts.push(env.DB.prepare('UPDATE cards SET balance = balance - ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(amount, now(env), card.id, user.id));
      stmts.push(...entryStmts(env, { ref, userId: user.id, type: 'refund', amount, desc }));
    }
    stmts.push(ledgerInsert(env, { ref, userId: user.id, cardId: card.id, type, amount: signed, key, description: desc }));
    stmts.push(notifyStmt(env, user.id, direction === 'load' ? 'card_funded' : 'card_withdrawn', direction === 'load' ? 'Karta para yüklendi' : 'Kart bakiyesi cüzdana aktarıldı', `${money(amount)} FN • ${card.label || card.display_name} • Ref: ${ref}`));
    try {
      await env.DB.batch(stmts);
    } catch (err) {
      if (isConstraint(err, 'wallet_nonneg')) throw new HttpError(400, 'insufficient_wallet', 'Ana cüzdanda bu yükleme için yeterli bakiye yok.');
      if (isConstraint(err, 'card_balance_nonneg')) throw new HttpError(400, 'insufficient_card_funds', 'Kartında bu tutarı geri aktaracak kadar bakiye yok.');
      if (isConstraint(err, 'card_ledger.user_id')) {
        const again = await priorOperation(env, user.id, key, { cardId: card.id, type, amount: signed });
        if (again) return json(again);
      }
      if (String(err.message || err).includes('malformed JSON')) {
        const latest = await ownCard(env, user.id, card.id);
        if (direction === 'load' && latest.status !== 'active') throw new HttpError(400, 'card_disabled', 'Devre dışı karta para yüklenemez.');
        if (direction === 'withdraw' && latest.balance < amount) throw new HttpError(400, 'insufficient_card_funds', 'Kartında bu tutarı geri aktaracak kadar bakiye yok.');
        throw new HttpError(409, 'account_state_changed', 'Hesap durumu değişti; işlem yapılamadı.');
      }
      throw err;
    }
    const after = await ownCard(env, user.id, card.id);
    return json({ ok: true, ref, direction, amount, card_balance: after.balance, replayed: false }, 201);
  },

  async pay(req, env, url, { user }, params) {
    await requireCardMoneySchema(env);
    const b = await readJson(req);
    await rateLimit(env, `cardpay:${user.id}`, 20, 10 * MIN);
    const card = await ownCard(env, user.id, params.id);
    await ensureCardNotListed(env, card.id);
    if (card.status !== 'active') throw new HttpError(400, 'card_disabled', 'Devre dışı kartla ödeme yapılamaz.');
    const amount = parseAmount(b.amount);
    const key = validateKey(b.idempotency_key);
    const recipientName = str(b.recipient, { min: 3, max: 20, name: 'Alıcı kullanıcı adı' });
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(recipientName)) throw new HttpError(400, 'invalid_username', 'Geçerli bir kullanıcı adı girin.');
    const recipient = await env.DB.prepare('SELECT * FROM users WHERE username_lower = ?').bind(recipientName.toLowerCase()).first();
    if (!recipient || isSuspended(recipient, now(env))) throw new HttpError(404, 'recipient_not_found', 'Alıcı bulunamadı.');
    if (recipient.id === user.id) throw new HttpError(400, 'self_transfer', 'Kendi hesabınıza ödeme yapamazsınız.');
    const replay = await priorOperation(env, user.id, key, { cardId: card.id, type: 'payment', amount: -amount, counterpartyId: recipient.id });
    if (replay) return json({ ...replay, recipient: recipient.username });

    const limits = await limitsFor(env, user.id);
    if (amount > limits.max_transfer) throw new HttpError(400, 'limit_exceeded', `İşlem başına en fazla ${money(limits.max_transfer)} FN gönderebilirsiniz.`);
    if (amount >= cfgNum(env, 'REAUTH_THRESHOLD_MINOR', 100000)) {
      if (typeof b.password !== 'string' || !(await verifyPassword(b.password, user.password_hash))) throw new HttpError(403, 'reauth_required', 'Bu tutar için şifrenizi yeniden girmelisiniz.');
    }
    const t = now(env), day = dayKey(t);
    const used = await env.DB.prepare('SELECT total FROM daily_usage WHERE user_id = ? AND day = ?').bind(user.id, day).first();
    if ((used?.total || 0) + amount > limits.daily_limit) throw new HttpError(400, 'daily_limit', 'Günlük ödeme limitinizi aşıyorsunuz.');
    const keyDesc = str(b.description || 'Kartla ödeme', { min: 1, max: 80, name: 'Açıklama' });
    const ref = newRef('NXP');
    const desc = `${keyDesc} • ${card.label || card.display_name}`;
    const cardGuard = env.DB.prepare(`SELECT json_extract(CASE WHEN EXISTS (
      SELECT 1 FROM cards WHERE id = ? AND user_id = ? AND status = 'active' AND balance >= ?
    ) THEN '{}' ELSE 'x' END, '$')`).bind(card.id, user.id, amount);
    const stmts = [
      guardActiveStmt(env, user.id, recipient.id),
      cardGuard,
      env.DB.prepare(`INSERT INTO daily_usage (user_id, day, total, cap) VALUES (?,?,?,?)
        ON CONFLICT(user_id, day) DO UPDATE SET total = total + excluded.total, cap = excluded.cap`).bind(user.id, day, amount, limits.daily_limit),
      env.DB.prepare('UPDATE cards SET balance = balance - ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = \'active\'').bind(amount, t, card.id, user.id),
      ledgerInsert(env, { ref, userId: user.id, cardId: card.id, type: 'payment', amount: -amount, counterpartyId: recipient.id, key, description: desc }),
      ...entryStmts(env, { ref, userId: recipient.id, type: 'transfer_in', amount, counterparty: user.id, desc: `Kart ödemesi • @${user.username}` }),
      notifyStmt(env, user.id, 'card_payment_sent', 'Kartla ödeme gönderildi', `${recipient.username} kullanıcısına ${money(amount)} FN • ${ref}`),
      notifyStmt(env, recipient.id, 'card_payment_received', 'Kartla ödeme aldınız', `@${user.username} size ${money(amount)} FN gönderdi • ${ref}`),
    ];
    try {
      await env.DB.batch(stmts);
    } catch (err) {
      if (isConstraint(err, 'card_balance_nonneg')) throw new HttpError(400, 'insufficient_card_funds', 'Seçtiğiniz kartta yeterli bakiye yok. Önce karta para yükleyin.');
      if (isConstraint(err, 'daily_cap')) throw new HttpError(400, 'daily_limit', 'Günlük ödeme limitinizi aşıyorsunuz.');
      if (isConstraint(err, 'card_ledger.user_id')) {
        const again = await priorOperation(env, user.id, key, { cardId: card.id, type: 'payment', amount: -amount, counterpartyId: recipient.id });
        if (again) return json({ ...again, recipient: recipient.username });
      }
      if (String(err.message || err).includes('malformed JSON')) {
        const latest = await ownCard(env, user.id, card.id);
        if (latest.status !== 'active') throw new HttpError(400, 'card_disabled', 'Ödeme sırasında kart devre dışı bırakıldı.');
        if (latest.balance < amount) throw new HttpError(400, 'insufficient_card_funds', 'Seçtiğiniz kartta yeterli bakiye yok. Önce karta para yükleyin.');
        throw new HttpError(409, 'account_state_changed', 'Hesap durumu değişti; ödeme yapılamadı.');
      }
      throw err;
    }
    const after = await ownCard(env, user.id, card.id);
    return json({ ok: true, ref, amount, recipient: recipient.username, card_balance: after.balance, replayed: false }, 201);
  },

  async transactions(req, env, url, { user }, params) {
    await requireCardMoneySchema(env);
    await ownCard(env, user.id, params.id);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);
    const rows = (await env.DB.prepare(`SELECT l.id, l.tx_ref, l.type, l.amount, l.balance_after, l.counterparty_id, u.username AS counterparty, l.description, l.created_at
      FROM card_ledger l LEFT JOIN users u ON u.id = l.counterparty_id
      WHERE l.user_id = ? AND l.card_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT ?`).bind(user.id, params.id, limit).all()).results;
    return json({ items: rows, currency: env.CURRENCY_CODE || 'FN' });
  },
};
