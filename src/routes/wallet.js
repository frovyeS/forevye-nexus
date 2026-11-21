import { HttpError, json, readJson, parseAmount, cfgNum, now, MIN, isSuspended, dayKey } from '../lib/util.js';
import { verifyPassword } from '../lib/crypto.js';
import { rateLimit } from '../lib/rate.js';
import { transfer, getTransferByKey } from '../lib/ledger.js';
import { grantAchievement } from './misc.js';

const KINDS = {
  transfer: "type IN ('transfer_in','transfer_out')",
  topup: "type = 'topup'",
  purchase: "type = 'purchase'",
  refund: "type IN ('refund','reversal','adjustment')",
  market: "type IN ('market_buy','market_sell')",
};

export async function balanceOf(env, userId) {
  const r = await env.DB.prepare('SELECT balance FROM wallets WHERE user_id = ?').bind(userId).first();
  return r ? r.balance : 0;
}

export const walletRoutes = {
  async balance(req, env, ctx, { user }) {
    return json({ balance: await balanceOf(env, user.id), currency: env.CURRENCY_CODE || 'FN' });
  },

  // Filtrelenebilir işlem geçmişi / bakiye hareketleri. Anahtar tabanlı sayfalama (created_at,id).
  async transactions(req, env, url, { user }) {
    const kind = url.searchParams.get('kind');
    const dir = url.searchParams.get('dir');
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);
    const where = ['e.user_id = ?'];
    const binds = [user.id];
    if (kind) {
      if (!KINDS[kind]) throw new HttpError(400, 'invalid_filter', 'Geçersiz filtre.');
      where.push(KINDS[kind].replace(/\btype\b/g, 'e.type'));
    }
    if (dir === 'in') where.push('e.amount > 0'); else if (dir === 'out') where.push('e.amount < 0');
    else if (dir) throw new HttpError(400, 'invalid_filter', 'Geçersiz filtre.');
    for (const [p, op] of [['from', '>='], ['to', '<=']]) {
      const v = url.searchParams.get(p);
      if (v) { const n = Number(v); if (!Number.isFinite(n)) throw new HttpError(400, 'invalid_filter', 'Geçersiz tarih.'); where.push(`e.created_at ${op} ?`); binds.push(n); }
    }
    const cur = url.searchParams.get('cursor');
    if (cur) {
      const [c, id] = cur.split('|');
      if (!Number.isFinite(Number(c)) || !id) throw new HttpError(400, 'invalid_cursor', 'Geçersiz imleç.');
      where.push('(e.created_at < ? OR (e.created_at = ? AND e.id < ?))'); binds.push(Number(c), Number(c), id);
    }
    const rows = (await env.DB.prepare(
      `SELECT e.id, e.tx_ref, e.type, e.amount, e.balance_after, e.status, e.description, e.created_at, c.username AS counterparty
       FROM ledger_entries e LEFT JOIN users c ON c.id = e.counterparty_id
       WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
    ).bind(...binds, limit + 1).all()).results;
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return json({ items, next_cursor: more && last ? `${last.created_at}|${last.id}` : null, currency: env.CURRENCY_CODE || 'FN' });
  },

  // Son gönderilen kişiler (hızlı seçim). Askıdaki hesaplar listelenmez.
  async recent(req, env, ctx, { user }) {
    const t = now(env);
    const rows = (await env.DB.prepare(
      `SELECT u.username AS username, MAX(tr.created_at) AS last_at FROM transfers tr JOIN users u ON u.id = tr.recipient_id
       WHERE tr.sender_id = ? AND tr.status = 'success' AND NOT (u.status = 'suspended' AND (u.suspended_until IS NULL OR u.suspended_until > ?))
       GROUP BY u.id ORDER BY last_at DESC LIMIT 6`,
    ).bind(user.id, t).all()).results;
    const used = await env.DB.prepare('SELECT total FROM daily_usage WHERE user_id = ? AND day = ?').bind(user.id, dayKey(t)).first();
    const cap = cfgNum(env, 'DAILY_TRANSFER_LIMIT_MINOR', 1500000);
    return json({ recipients: rows.map((r) => r.username), daily_used: used?.total || 0, daily_limit: cap, daily_left: Math.max(0, cap - (used?.total || 0)) });
  },

  async lookup(req, env, ctx, { user }) {
    const b = await readJson(req);
    await rateLimit(env, `lookup:${user.id}`, 30, 10 * MIN);
    if (typeof b.username !== 'string' || !/^[A-Za-z0-9_.]{3,20}$/.test(b.username.trim())) throw new HttpError(400, 'invalid_username', 'Geçerli bir kullanıcı adı girin.');
    const u = await env.DB.prepare('SELECT username, status, suspended_until FROM users WHERE username_lower = ?').bind(b.username.trim().toLowerCase()).first();
    if (!u || isSuspended(u, now(env))) throw new HttpError(404, 'recipient_not_found', 'Alıcı bulunamadı.');
    return json({ username: u.username, is_self: u.username.toLowerCase() === user.username.toLowerCase() });
  },

  async transfer(req, env, ctx, { user }) {
    const b = await readJson(req);
    await rateLimit(env, `xfer:${user.id}`, 30, 10 * MIN);
    const key = b.idempotency_key;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw new HttpError(400, 'invalid_key', 'İşlem anahtarı eksik veya geçersiz.');
    const amount = parseAmount(b.amount);
    if (typeof b.recipient !== 'string' || !/^[A-Za-z0-9_.]{3,20}$/.test(b.recipient.trim())) throw new HttpError(400, 'invalid_username', 'Geçerli bir alıcı kullanıcı adı girin.');
    const recipient = await env.DB.prepare('SELECT * FROM users WHERE username_lower = ?').bind(b.recipient.trim().toLowerCase()).first();

    // Tekrar isteği: aynı anahtar aynı sonucu döndürür, çift işlem oluşturmaz.
    const prior = await getTransferByKey(env, user.id, key);
    if (prior) {
      if (!recipient || prior.recipient_id !== recipient.id || prior.amount !== amount) throw new HttpError(409, 'key_reuse', 'Bu işlem anahtarı farklı bir istek için kullanılmış.');
      return json({ ok: true, ref: prior.ref, amount: prior.amount, replayed: true, balance: await balanceOf(env, user.id) });
    }
    if (!recipient) throw new HttpError(404, 'recipient_not_found', 'Alıcı bulunamadı.');

    // Hassas işlem: eşik üstü transferlerde şifre yeniden doğrulanır.
    if (amount >= cfgNum(env, 'REAUTH_THRESHOLD_MINOR', 100000)) {
      if (typeof b.password !== 'string' || !(await verifyPassword(b.password, user.password_hash))) throw new HttpError(403, 'reauth_required', 'Bu tutar için şifrenizi yeniden girmelisiniz.');
    }
    const r = await transfer(env, user, recipient, amount, key);
    await grantAchievement(env, user.id, 'first_transfer_sent');
    await grantAchievement(env, recipient.id, 'first_transfer_received');
    return json({ ok: true, ref: r.ref, amount: r.amount, replayed: r.replayed, balance: await balanceOf(env, user.id) }, r.replayed ? 200 : 201);
  },
};
