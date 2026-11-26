import { HttpError, json, readJson, now, HOUR, isSuspended, str } from '../lib/util.js';
import { notifyStmt } from '../lib/auth.js';
import { reverseRef, runBatch, entryStmts } from '../lib/ledger.js';
import { newRef } from '../lib/util.js';
import { validateDesign, readStoredDesign } from '../../shared/card-contract.js';
import { giftcardStatus } from '../integrations/giftcard.js';
import { balanceOf } from './wallet.js';
import { shopRevokeStmts } from '../lib/shop.js';

// Değiştirilemez denetim kaydı: yönetici ID'si, eylem, hedef, zaman, gerekçe, sonuç.
export function auditStmt(env, adminId, action, target, reason, result = 'success', detail = null) {
  return env.DB.prepare('INSERT INTO admin_audit (id, admin_id, action, target, reason, result, detail, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), adminId, action, target, reason, result, detail, now(env));
}

const reasonOf = (b) => str(b.reason, { min: 3, max: 300, name: 'Gerekçe' });

async function targetUser(env, id) {
  const u = await env.DB.prepare('SELECT id, email, username, role, status, suspended_until, suspend_reason, created_at FROM users WHERE id = ?').bind(id).first();
  if (!u) throw new HttpError(404, 'not_found', 'Kullanıcı bulunamadı.');
  return u;
}

// Kullanıcı bakiyesine "işaretli tutar" ayrıştırma ("-5.50" / "12")
function signedAmount(v) {
  const s = String(v ?? '').trim();
  const m = /^([+-])?(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new HttpError(400, 'invalid_amount', 'Geçersiz tutar.');
  const n = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'));
  if (n <= 0) throw new HttpError(400, 'invalid_amount', 'Tutar sıfırdan büyük olmalı.');
  return m[1] === '-' ? -n : n;
}

export const adminRoutes = {
  async me(req, env, ctx, { user }) { return json({ id: user.id, username: user.username, role: user.role }); },

  async searchUsers(req, env, url, { user }) {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (q.length < 2) throw new HttpError(400, 'invalid', 'En az 2 karakter girin.');
    const like = `${q.replace(/[%_\\]/g, '')}%`;
    const rows = (await env.DB.prepare(
      `SELECT id, username, email, role, status, created_at FROM users WHERE username_lower LIKE ? OR email LIKE ? ORDER BY username_lower LIMIT 20`,
    ).bind(like, like).all()).results;
    await auditStmt(env, user.id, 'user.search', null, null, 'success', `q=${q.slice(0, 40)}`).run();
    return json({ users: rows });
  },

  async userDetail(req, env, ctx, { user }, p) {
    const u = await targetUser(env, p.id);
    const [balance, cards, recent] = await Promise.all([
      balanceOf(env, u.id),
      env.DB.prepare('SELECT COUNT(*) AS c FROM cards WHERE user_id = ?').bind(u.id).first(),
      env.DB.prepare('SELECT tx_ref, type, amount, balance_after, description, created_at FROM ledger_entries WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 20').bind(u.id).all(),
    ]);
    await auditStmt(env, user.id, 'user.view', u.id, null).run();
    return json({ user: u, suspended: isSuspended(u, now(env)), balance, card_count: cards.c, recent: recent.results });
  },

  async suspend(req, env, ctx, { user }, p) {
    const b = await readJson(req);
    const reason = reasonOf(b);
    const u = await targetUser(env, p.id);
    if (u.id === user.id) throw new HttpError(400, 'invalid', 'Kendi hesabınızı askıya alamazsınız.');
    if (u.role === 'superadmin' && user.role !== 'superadmin') throw new HttpError(403, 'forbidden', 'Bu işlem için yetkiniz yok.');
    const hours = b.hours === undefined || b.hours === null ? null : Number(b.hours);
    if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 365)) throw new HttpError(400, 'invalid', 'Süre geçersiz.');
    const until = hours ? now(env) + hours * HOUR : null;
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET status = 'suspended', suspended_until = ?, suspend_reason = ? WHERE id = ?`).bind(until, reason, u.id),
      notifyStmt(env, u.id, 'suspended', 'Hesabınız askıya alındı', 'Hesabınız güvenlik kontrolü için askıya alındı.'),
      auditStmt(env, user.id, 'user.suspend', u.id, reason, 'success', until ? `until=${until}` : 'indefinite'),
    ]);
    return json({ ok: true });
  },

  async unsuspend(req, env, ctx, { user }, p) {
    const reason = reasonOf(await readJson(req));
    const u = await targetUser(env, p.id);
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET status = 'active', suspended_until = NULL, suspend_reason = NULL WHERE id = ?`).bind(u.id),
      notifyStmt(env, u.id, 'unsuspended', 'Hesabınız yeniden etkinleştirildi', ''),
      auditStmt(env, user.id, 'user.unsuspend', u.id, reason),
    ]);
    return json({ ok: true });
  },

  async userLedger(req, env, url, { user }, p) {
    const u = await targetUser(env, p.id);
    const rows = (await env.DB.prepare('SELECT id, tx_ref, type, amount, balance_after, status, counterparty_id, description, created_at FROM ledger_entries WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').bind(u.id).all()).results;
    await auditStmt(env, user.id, 'ledger.view', u.id, null).run();
    return json({ items: rows });
  },

  // Şüpheli/hatalı işlem: kayıt silinmez; ters kayıt oluşturulur. Yalnızca superadmin.
  async reverse(req, env, ctx, { user }) {
    const b = await readJson(req);
    const reason = reasonOf(b);
    if (typeof b.ref !== 'string' || !/^NX[A-Z]-[A-Z2-9]{12}$/.test(b.ref)) throw new HttpError(400, 'invalid', 'Geçersiz işlem referansı.');
    try {
      const { ref, stmts } = await reverseRef(env, { originalRef: b.ref, actor: user.id, reason });
      await runBatch(env, [...stmts, ...(await shopRevokeStmts(env, b.ref)), auditStmt(env, user.id, 'ledger.reverse', b.ref, reason, 'success', `reversal=${ref}`)]);
      return json({ ok: true, reversal_ref: ref });
    } catch (err) {
      await auditStmt(env, user.id, 'ledger.reverse', b.ref, reason, 'failed', String(err.code || err.message).slice(0, 100)).run().catch(() => {});
      throw err;
    }
  },

  async adjust(req, env, ctx, { user }) {
    const b = await readJson(req);
    const reason = reasonOf(b);
    const u = await targetUser(env, String(b.user_id || ''));
    const amount = signedAmount(b.amount);
    const ref = newRef('NXA');
    try {
      await runBatch(env, [
        ...entryStmts(env, { ref, userId: u.id, type: 'adjustment', amount, desc: 'Yönetici düzeltmesi' }),
        notifyStmt(env, u.id, 'adjustment', 'Bakiye düzeltmesi', `Hesabınıza bir düzeltme kaydı işlendi. Ref: ${ref}`),
        auditStmt(env, user.id, 'ledger.adjust', u.id, reason, 'success', `ref=${ref};amount=${amount}`),
      ]);
    } catch (err) {
      await auditStmt(env, user.id, 'ledger.adjust', u.id, reason, 'failed', String(err.code || err.message).slice(0, 100)).run().catch(() => {});
      throw err;
    }
    return json({ ok: true, ref });
  },

  async listAnnouncements(req, env) {
    return json({ items: (await env.DB.prepare('SELECT id, title, body, active, created_at FROM announcements ORDER BY created_at DESC LIMIT 50').all()).results });
  },
  async createAnnouncement(req, env, ctx, { user }) {
    const b = await readJson(req);
    const title = str(b.title, { min: 3, max: 80, name: 'Başlık' });
    const body = str(b.body, { min: 3, max: 500, name: 'Metin' });
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO announcements (id, title, body, active, created_by, created_at) VALUES (?,?,?,1,?,?)').bind(id, title, body, user.id, now(env)),
      auditStmt(env, user.id, 'announcement.create', id, null),
    ]);
    return json({ ok: true, id }, 201);
  },
  async deactivateAnnouncement(req, env, ctx, { user }, p) {
    await env.DB.batch([
      env.DB.prepare('UPDATE announcements SET active = 0 WHERE id = ?').bind(p.id),
      auditStmt(env, user.id, 'announcement.deactivate', p.id, null),
    ]);
    return json({ ok: true });
  },

  async listTemplates(req, env) {
    const rows = (await env.DB.prepare('SELECT id, name, design_json, active, limited_until, created_at FROM card_templates ORDER BY created_at DESC LIMIT 100').all()).results;
    return json({ items: rows.map((r) => ({ ...r, design: readStoredDesign(r.design_json, 'NEXUS'), design_json: undefined })) });
  },
  async createTemplate(req, env, ctx, { user }) {
    const b = await readJson(req, 96 * 1024);
    const name = str(b.name, { min: 2, max: 40, name: 'Ad' });
    const v = validateDesign(b.design);
    if (!v.ok) throw new HttpError(400, 'invalid_design', v.errors[0], { errors: v.errors });
    const limited = b.limited_until == null ? null : Number(b.limited_until);
    if (limited !== null && !Number.isFinite(limited)) throw new HttpError(400, 'invalid', 'Bitiş zamanı geçersiz.');
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO card_templates (id, name, design_json, active, limited_until, created_at) VALUES (?,?,?,1,?,?)').bind(id, name, JSON.stringify(v.design), limited, now(env)),
      auditStmt(env, user.id, 'template.create', id, null),
    ]);
    return json({ ok: true, id }, 201);
  },
  async setTemplateActive(req, env, ctx, { user }, p) {
    const b = await readJson(req);
    await env.DB.batch([
      env.DB.prepare('UPDATE card_templates SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, p.id),
      auditStmt(env, user.id, 'template.set_active', p.id, null, 'success', String(Boolean(b.active))),
    ]);
    return json({ ok: true });
  },

  async audit(req, env) {
    const rows = (await env.DB.prepare('SELECT id, admin_id, action, target, reason, result, detail, created_at FROM admin_audit ORDER BY created_at DESC, id DESC LIMIT 100').all()).results;
    return json({ items: rows });
  },


  // Günlük yönetici piyasa değerlendirmesi: her yönetici günde bir kez puan verebilir.
  async marketSentiment(req, env, ctx, { user }) {
    const day = new Date(now(env) + 3 * HOUR).toISOString().slice(0, 10); // Türkiye günü
    const today = await env.DB.prepare('SELECT score, created_at FROM market_admin_sentiment WHERE day = ?').bind(day).first();
    const stats = await env.DB.prepare(`SELECT ROUND(AVG(score), 1) AS average, COUNT(*) AS count
      FROM (SELECT score FROM market_admin_sentiment ORDER BY day DESC LIMIT 7)`).first();
    const history = (await env.DB.prepare('SELECT day, score, created_at FROM market_admin_sentiment ORDER BY day DESC LIMIT 30').all()).results;
    return json({ day, submitted: Boolean(today), today: today || null, average: Number(stats?.average ?? 50), count: Number(stats?.count || 0), history });
  },

  async submitMarketSentiment(req, env, ctx, { user }) {
    const b = await readJson(req);
    const score = Number(b.score);
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      throw new HttpError(400, 'invalid_score', 'Puan 0 ile 100 arasında tam sayı olmalı.');
    }
    const day = new Date(now(env) + 3 * HOUR).toISOString().slice(0, 10);
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO market_admin_sentiment (day, score, admin_id, created_at) VALUES (?,?,?,?)')
          .bind(day, score, user.id, now(env)),
        auditStmt(env, user.id, 'market.sentiment', day, null, 'success', `score=${score}`),
      ]);
    } catch (err) {
      if (String(err?.message || err).includes('UNIQUE')) {
        throw new HttpError(409, 'already_submitted', 'Bugünün piyasa puanını zaten verdiniz.');
      }
      throw err;
    }
    return json({ ok: true, day, score });
  },

  async giftcard(req, env) { return json(await giftcardStatus(env)); },

  async listAdmins(req, env) {
    return json({ admins: (await env.DB.prepare(`SELECT id, username, email, role FROM users WHERE role != 'user' ORDER BY role, username_lower`).all()).results });
  },

  // Rol yönetimi: yalnızca superadmin. Kendi rolünü düşüremez; son superadmin korunur.
  async setRole(req, env, ctx, { user }) {
    const b = await readJson(req);
    const reason = reasonOf(b);
    if (!['user', 'admin', 'superadmin'].includes(b.role)) throw new HttpError(400, 'invalid', 'Geçersiz rol.');
    const u = await targetUser(env, String(b.user_id || ''));
    if (u.id === user.id) throw new HttpError(400, 'invalid', 'Kendi rolünüzü değiştiremezsiniz.');
    if (u.role === 'superadmin' && b.role !== 'superadmin') {
      const c = (await env.DB.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'superadmin'`).first()).c;
      if (c <= 1) throw new HttpError(400, 'last_superadmin', 'Son süper yönetici düşürülemez.');
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(b.role, u.id),
      env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now(env), u.id), // yetki değişince oturumlar yenilenir
      auditStmt(env, user.id, 'role.set', u.id, reason, 'success', `${u.role}->${b.role}`),
    ]);
    return json({ ok: true });
  },
};
