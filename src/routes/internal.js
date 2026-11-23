// Sunucudan sunucuya uçlar (oyun içi alışveriş / iade). Tarayıcıdan ÇAĞRILAMAZ: INTERNAL_API_KEY gerekir.
import { HttpError, json, readJson, parseAmount, str, now, newRef, isConstraint } from '../lib/util.js';
import { safeEqual } from '../lib/crypto.js';
import { purchase, reverseRef, runBatch } from '../lib/ledger.js';
import { grantAchievement } from './misc.js';
import { balanceOf } from './wallet.js';
import { auditStmt } from './admin.js';
import { shopRevokeStmts } from '../lib/shop.js';

function requireKey(req, env) {
  const h = req.headers.get('authorization') || '';
  if (!env.INTERNAL_API_KEY || !h.startsWith('Bearer ') || !safeEqual(h.slice(7), env.INTERNAL_API_KEY)) throw new HttpError(401, 'unauthorized', 'Yetkisiz.');
}

export const internalRoutes = {
  async purchase(req, env) {
    requireKey(req, env);
    const b = await readJson(req);
    const amount = parseAmount(b.amount);
    const externalRef = str(b.external_ref, { min: 8, max: 80, name: 'external_ref' });
    const userId = str(b.user_id, { min: 8, max: 64, name: 'user_id' });
    const u = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
    if (!u) throw new HttpError(404, 'not_found', 'Kullanıcı bulunamadı.');
    const r = await purchase(env, { userId, amount, externalRef: `purchase:${externalRef}`, desc: typeof b.description === 'string' ? b.description.slice(0, 80) : 'Oyun içi alışveriş' });
    if (!r.replayed) await grantAchievement(env, userId, 'first_purchase');
    return json({ ok: true, ref: r.ref, replayed: r.replayed, balance: await balanceOf(env, userId) }, r.replayed ? 200 : 201);
  },

  async refund(req, env) {
    requireKey(req, env);
    const b = await readJson(req);
    const ref = str(b.ref, { min: 8, max: 40, name: 'ref' });

    // Market alışverişi kart bakiyesinden ödenmişse iade aynı karta döner.
    const marketPurchase = await env.DB.prepare(`SELECT user_id, price, status FROM shop_purchases WHERE id = ?`).bind(ref).first();
    const cardPayment = marketPurchase && await env.DB.prepare(`SELECT card_id FROM card_ledger WHERE tx_ref = ? AND user_id = ? AND type = 'payment' AND amount < 0`).bind(ref, marketPurchase.user_id).first();
    if (marketPurchase && marketPurchase.status === 'success' && cardPayment) {
      const rref = newRef('NXR'), t = now(env), refundKey = `shop_refund_${ref}`;
      try {
        await runBatch(env, [
          env.DB.prepare(`SELECT json_extract(CASE WHEN EXISTS (
            SELECT 1 FROM shop_purchases WHERE id = ? AND status = 'success'
          ) THEN '{}' ELSE 'x' END, '$')`).bind(ref),
          env.DB.prepare('UPDATE cards SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
            .bind(marketPurchase.price, t, cardPayment.card_id, marketPurchase.user_id),
          env.DB.prepare(`INSERT INTO card_ledger
            (id, tx_ref, user_id, card_id, type, amount, balance_after, counterparty_id, idempotency_key, description, created_at)
            VALUES (?, ?, ?, ?, 'fund_in', ?, (SELECT balance FROM cards WHERE id = ? AND user_id = ?), NULL, ?, ?, ?)`)
            .bind(crypto.randomUUID(), rref, marketPurchase.user_id, cardPayment.card_id, marketPurchase.price, cardPayment.card_id, marketPurchase.user_id, refundKey, `Nexus Market iadesi: ${ref}`, t),
          ...(await shopRevokeStmts(env, ref)),
          auditStmt(env, 'internal-api', 'purchase.refund', ref, 'kart bakiyesine oyun içi iade', 'success', `refund=${rref}; card=${cardPayment.card_id}`),
        ]);
      } catch (err) {
        if (isConstraint(err, 'card_ledger.user_id') || String(err.message || err).includes('malformed JSON')) {
          throw new HttpError(409, 'not_refundable', 'Bu alışveriş daha önce iade edilmiş veya iade edilemiyor.');
        }
        throw err;
      }
      const card = await env.DB.prepare('SELECT balance FROM cards WHERE id = ? AND user_id = ?').bind(cardPayment.card_id, marketPurchase.user_id).first();
      return json({ ok: true, ref: rref, balance: await balanceOf(env, marketPurchase.user_id), card_balance: Number(card?.balance || 0), refunded_to: 'card' }, 201);
    }

    const orig = await env.DB.prepare('SELECT type, user_id FROM ledger_entries WHERE tx_ref = ?').bind(ref).first();
    if (!orig || orig.type !== 'purchase') throw new HttpError(400, 'not_refundable', 'Yalnızca alışveriş kayıtları iade edilebilir.');
    const { ref: rref, stmts } = await reverseRef(env, { originalRef: ref, type: 'refund', actor: 'internal-api' });
    await runBatch(env, [...stmts, ...(await shopRevokeStmts(env, ref)), auditStmt(env, 'internal-api', 'purchase.refund', ref, 'oyun içi iade', 'success', `refund=${rref}`)]);
    return json({ ok: true, ref: rref, balance: await balanceOf(env, orig.user_id) }, 201);
  },
};
