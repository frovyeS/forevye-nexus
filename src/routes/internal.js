// Sunucudan sunucuya uçlar (oyun içi alışveriş / iade). Tarayıcıdan ÇAĞRILAMAZ: INTERNAL_API_KEY gerekir.
import { HttpError, json, readJson, parseAmount, str } from '../lib/util.js';
import { safeEqual } from '../lib/crypto.js';
import { purchase, reverseRef, runBatch } from '../lib/ledger.js';
import { grantAchievement } from './misc.js';
import { balanceOf } from './wallet.js';
import { auditStmt } from './admin.js';
import { passRevokeStmts } from '../lib/pass.js';

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
    const orig = await env.DB.prepare('SELECT type, user_id FROM ledger_entries WHERE tx_ref = ?').bind(ref).first();
    if (!orig || orig.type !== 'purchase') throw new HttpError(400, 'not_refundable', 'Yalnızca alışveriş kayıtları iade edilebilir.');
    const { ref: rref, stmts } = await reverseRef(env, { originalRef: ref, type: 'refund', actor: 'internal-api' });
    await runBatch(env, [...stmts, ...(await passRevokeStmts(env, ref)), auditStmt(env, 'internal-api', 'purchase.refund', ref, 'oyun içi iade', 'success', `refund=${rref}`)]);
    return json({ ok: true, ref: rref, balance: await balanceOf(env, orig.user_id) }, 201);
  },
};
