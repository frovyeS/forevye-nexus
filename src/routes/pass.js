// Nexus Pass: süreli üyelikler (Pass Service + Entitlement Service). Ödeme FN bakiyesinden, Nexus defteriyle aynı atomik toplu işlemde yapılır.
//
//  1) POST /api/pass/ticket      (Nexus oturumu)   tek kullanımlık 5 dk'lık bilet üretir; Pass sitesinin adresine # ile eklenir.
//  2) POST /api/pass/exchange    (CORS: Pass sitesi) bileti jetona çevirir (30 dk kayan, en çok 8 saat).
//  3) GET  /api/pass/me | products | product | purchases, POST /api/pass/purchase   (Bearer jeton)
//  4) POST /api/internal/entitlement  (INTERNAL_API_KEY)  diğer sistemler (Hava, Mağaza, …) kullanıcının aktif üyeliğini sorar.
//
// Jeton yalnızca /api/pass/* uçlarında geçerlidir; transfer, profil, kart gibi hiçbir ucu açmaz. Fiyat, süre ve kullanıcı kimliği istemciden alınmaz.
import { HttpError, json, readJson, str, parseAmount, now, newRef, cfgNum, isConstraint, MIN, HOUR, DAY, clientIp } from '../lib/util.js';
import { randomToken, sha256hex, safeEqual } from '../lib/crypto.js';
import { rateLimit } from '../lib/rate.js';
import { entryStmts, guardActiveStmt } from '../lib/ledger.js';
import { notifyStmt } from '../lib/auth.js';
import { balanceOf } from './wallet.js';
import { auditStmt } from './admin.js';
import { grantAchievement } from './misc.js';
import { ensurePassSchema } from '../lib/pass.js';

const TICKET_TTL = 5 * MIN, TOKEN_SLIDE = 30 * MIN, TOKEN_MAX = 8 * HOUR;

export const passUrl = (env) => String(env.PASS_URL || '').trim();
export function passOrigins(env) {
  const out = [];
  for (const u of [passUrl(env), ...String(env.PASS_ORIGINS || '').split(',')]) {
    try { if (u.trim()) out.push(new URL(u.trim()).origin); } catch { /* geçersiz adres yok sayılır */ }
  }
  return out;
}

const parseFeatures = (s) => { try { const a = JSON.parse(s); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };
const shapeProduct = (p) => ({ id: p.id, app: p.app, name: p.name, price: p.price, dur: p.duration_s, desc: p.descr, features: parseFeatures(p.features), status: p.status });
const shapePurchase = (x) => ({ id: x.id, app: x.app, name: x.name, price: x.price, dur: x.duration_s, status: x.status === 'refunded' ? 'cancelled' : 'success', at: x.created_at });
const shapeEnt = (e, t) => ({
  id: e.id, pid: e.product_id, status: e.expires_at > t ? 'active' : 'expired', starts: e.starts_at, expires: e.expires_at,
  product: { app: e.app, name: e.name }, snap: { price: e.price, id: e.purchase_id },
});

const ENT_SQL = `SELECT e.*, p.app AS app, p.name AS name, b.price AS price FROM pass_entitlements e
  JOIN pass_products p ON p.id = e.product_id JOIN pass_purchases b ON b.id = e.purchase_id`;

async function entitlementsOf(env, userId) {
  const t = now(env);
  const rows = (await env.DB.prepare(`${ENT_SQL} WHERE e.user_id = ? ORDER BY e.expires_at DESC`).bind(userId).all()).results;
  return rows.map((e) => shapeEnt(e, t));
}

async function useToken(env, req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,80})$/.exec(req.headers.get('authorization') || '');
  const bad = () => new HttpError(401, 'pass_token', 'Pass oturumu geçersiz veya süresi dolmuş. Nexus’tan yeniden açın.');
  if (!m) throw bad();
  await ensurePassSchema(env);
  const t = now(env), th = await sha256hex(m[1]);
  const tok = await env.DB.prepare('SELECT * FROM pass_tokens WHERE token_hash = ? AND expires_at > ?').bind(th, t).first();
  if (!tok) throw bad();
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(tok.user_id).first();
  if (!user) throw bad();
  const exp = Math.min(t + TOKEN_SLIDE, tok.created_at + TOKEN_MAX);
  if (exp > tok.expires_at + MIN) await env.DB.prepare('UPDATE pass_tokens SET expires_at = ? WHERE token_hash = ?').bind(exp, th).run();
  return { user };
}

async function purchaseResult(env, ref, replayed) {
  const t = now(env);
  const x = await env.DB.prepare('SELECT * FROM pass_purchases WHERE id = ?').bind(ref).first();
  if (!x) return { ok: true, replayed: true };
  const e = await env.DB.prepare(`${ENT_SQL} WHERE e.purchase_id = ?`).bind(ref).first();
  return { ok: true, replayed, purchase: shapePurchase(x), entitlement: e ? shapeEnt(e, t) : null, balance: await balanceOf(env, x.user_id) };
}

export const passRoutes = {
  // Nexus oturumuyla çağrılır.
  async ticket(req, env, ctx, { user }) {
    const url = passUrl(env);
    if (!url) throw new HttpError(503, 'pass_unavailable', 'Nexus Pass bu sunucuda ayarlı değil.');
    await ensurePassSchema(env);
    await rateLimit(env, `passticket:${user.id}`, 30, 10 * MIN);
    const t = now(env), ticket = randomToken(32);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM pass_tickets WHERE expires_at < ?').bind(t - HOUR),
      env.DB.prepare('DELETE FROM pass_tokens WHERE expires_at < ?').bind(t - HOUR),
      env.DB.prepare('INSERT INTO pass_tickets (token_hash, user_id, expires_at) VALUES (?,?,?)').bind(await sha256hex(ticket), user.id, t + TICKET_TTL),
    ]);
    return json({ url: `${url}${url.includes('#') ? '' : '#'}t=${ticket}`, expires_in: TICKET_TTL / 1000 });
  },

  // Nexus içinde kullanıcının kendi üyelikleri.
  async mine(req, env, ctx, { user }) {
    await ensurePassSchema(env);
    return json({ entitlements: await entitlementsOf(env, user.id) });
  },

  async exchange(req, env) {
    const b = await readJson(req);
    await ensurePassSchema(env);
    await rateLimit(env, `passex:ip:${clientIp(req)}`, 40, 10 * MIN);
    const bad = () => new HttpError(400, 'invalid_ticket', 'Bilet geçersiz veya süresi dolmuş. Nexus’tan yeniden açın.');
    if (typeof b.ticket !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(b.ticket)) throw bad();
    const t = now(env), th = await sha256hex(b.ticket);
    const row = await env.DB.prepare('UPDATE pass_tickets SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING user_id').bind(t, th, t).first();
    if (!row) throw bad();
    const user = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(row.user_id).first();
    if (!user) throw bad();
    const token = randomToken(32);
    await env.DB.prepare('INSERT INTO pass_tokens (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').bind(await sha256hex(token), row.user_id, t, t + TOKEN_SLIDE).run();
    return json({ token, user: { username: user.username }, expires_at: t + TOKEN_SLIDE });
  },

  async me(req, env) {
    const { user } = await useToken(env, req);
    return json({ balance: await balanceOf(env, user.id), currency: env.CURRENCY_CODE || 'FN', user: { username: user.username }, entitlements: await entitlementsOf(env, user.id) });
  },

  async products(req, env) {
    await useToken(env, req);
    const rows = (await env.DB.prepare(`SELECT * FROM pass_products WHERE status = 'on' ORDER BY sort, app, name`).all()).results;
    return json({ products: rows.map(shapeProduct) });
  },

  async product(req, env, url) {
    await useToken(env, req);
    const id = str(url.searchParams.get('id') || '', { min: 1, max: 64, name: 'id' });
    const p = await env.DB.prepare('SELECT * FROM pass_products WHERE id = ?').bind(id).first();
    return json({ product: p ? shapeProduct(p) : null });
  },

  async purchases(req, env, url) {
    const { user } = await useToken(env, req);
    const page = Math.min(Math.max(parseInt(url.searchParams.get('page') || '0', 10) || 0, 0), 1000);
    const size = Math.min(Math.max(parseInt(url.searchParams.get('size') || '5', 10) || 5, 1), 20);
    const rows = (await env.DB.prepare('SELECT * FROM pass_purchases WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').bind(user.id, size + 1, page * size).all()).results;
    return json({ items: rows.slice(0, size).map(shapePurchase), more: rows.length > size });
  },

  async purchase(req, env) {
    const { user } = await useToken(env, req);
    const b = await readJson(req);
    const pid = str(b.pid, { min: 1, max: 64, name: 'pid' });
    const idem = str(b.idem, { min: 8, max: 80, name: 'idem' });
    if (!/^[A-Za-z0-9_-]+$/.test(idem)) throw new HttpError(400, 'invalid_idem', 'Geçersiz işlem anahtarı.');
    await rateLimit(env, `passbuy:${user.id}`, 20, 10 * MIN);
    const externalRef = `pass:${user.id}:${idem}`;
    const prior = await env.DB.prepare('SELECT tx_ref FROM external_ops WHERE external_ref = ?').bind(externalRef).first();
    if (prior) return json(await purchaseResult(env, prior.tx_ref, true));

    const p = await env.DB.prepare(`SELECT * FROM pass_products WHERE id = ? AND status = 'on'`).bind(pid).first();
    if (!p) return json({ ok: false, code: 'unavailable' });
    const t = now(env);
    const active = await env.DB.prepare('SELECT 1 AS x FROM pass_entitlements WHERE user_id = ? AND product_id = ? AND expires_at > ?').bind(user.id, pid, t).first();
    if (active) return json({ ok: false, code: 'already_active' });
    const balance = await balanceOf(env, user.id);
    if (balance < p.price) return json({ ok: false, code: 'insufficient', balance, missing: p.price - balance });

    const ref = newRef('NXP');
    try {
      await env.DB.batch([
        guardActiveStmt(env, user.id),
        env.DB.prepare('INSERT INTO pass_guard (ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM pass_entitlements WHERE user_id = ? AND product_id = ? AND expires_at > ?) THEN 0 ELSE 1 END').bind(user.id, pid, t),
        env.DB.prepare('DELETE FROM pass_guard'),
        env.DB.prepare('INSERT INTO external_ops (external_ref, kind, user_id, tx_ref, created_at) VALUES (?,?,?,?,?)').bind(externalRef, 'purchase', user.id, ref, t),
        ...entryStmts(env, { ref, userId: user.id, type: 'purchase', amount: -p.price, desc: `Nexus Pass: ${p.app} · ${p.name}` }),
        env.DB.prepare('INSERT INTO pass_purchases (id, user_id, product_id, app, name, price, duration_s, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(ref, user.id, p.id, p.app, p.name, p.price, p.duration_s, 'success', t),
        env.DB.prepare(`INSERT INTO pass_entitlements (id, user_id, product_id, purchase_id, starts_at, expires_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(user_id, product_id) DO UPDATE SET purchase_id = excluded.purchase_id, starts_at = excluded.starts_at, expires_at = excluded.expires_at`)
          .bind(`ent_${randomToken(9)}`, user.id, p.id, ref, t, t + p.duration_s * 1000),
        notifyStmt(env, user.id, 'purchase', 'Üyelik etkinleştirildi', `${p.app} · ${p.name} aktif. Ref: ${ref}`),
      ]);
    } catch (err) {
      if (isConstraint(err, 'pass_not_active')) return json({ ok: false, code: 'already_active' });
      if (isConstraint(err, 'wallet_nonneg')) return json({ ok: false, code: 'insufficient', balance: await balanceOf(env, user.id), missing: p.price - (await balanceOf(env, user.id)) });
      if (isConstraint(err, 'external_ops')) {
        const again = await env.DB.prepare('SELECT tx_ref FROM external_ops WHERE external_ref = ?').bind(externalRef).first();
        return json(await purchaseResult(env, again?.tx_ref, true));
      }
      if (String(err.message || err).includes('malformed JSON')) throw new HttpError(409, 'account_state_changed', 'Hesap askıda; işlem yapılamadı.');
      throw err;
    }
    await grantAchievement(env, user.id, 'first_purchase').catch(() => {});
    return json(await purchaseResult(env, ref, false), 201);
  },
};

function requireKey(req, env) {
  const h = req.headers.get('authorization') || '';
  if (!env.INTERNAL_API_KEY || !h.startsWith('Bearer ') || !safeEqual(h.slice(7), env.INTERNAL_API_KEY)) throw new HttpError(401, 'unauthorized', 'Yetkisiz.');
}

// Diğer sistemler (Hava, Mağaza, …): kullanıcının aktif üyeliği var mı? Tarayıcıdan çağrılamaz.
// Gövde: { user_id | id_user_id (FOREVYE ID kimliği), app?, product_id? }
export const passInternalRoutes = {
  async entitlement(req, env) {
    requireKey(req, env);
    await ensurePassSchema(env);
    const b = await readJson(req);
    let userId = null;
    if (b.user_id !== undefined) userId = str(b.user_id, { min: 8, max: 64, name: 'user_id' });
    else if (b.id_user_id !== undefined) {
      const l = await env.DB.prepare('SELECT user_id FROM id_links WHERE id_user_id = ?').bind(str(b.id_user_id, { min: 1, max: 80, name: 'id_user_id' })).first().catch(() => null);
      userId = l?.user_id || null;
    } else throw new HttpError(400, 'invalid', 'user_id veya id_user_id gerekli.');
    const u = userId && await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
    if (!u) throw new HttpError(404, 'not_found', 'Kullanıcı bulunamadı.');
    const t = now(env);
    let list = (await entitlementsOf(env, u.id)).filter((e) => e.status === 'active');
    if (b.app !== undefined) list = list.filter((e) => e.product.app === String(b.app));
    if (b.product_id !== undefined) list = list.filter((e) => e.pid === String(b.product_id));
    return json({ user_id: u.id, active: list.length > 0, checked_at: t, entitlements: list.map((e) => ({ product_id: e.pid, app: e.product.app, name: e.product.name, starts_at: e.starts, expires_at: e.expires })) });
  },
};

// Yönetim: katalog. Okuma admin, yazma süper yönetici (para etkisi olduğu için).
export const passAdminRoutes = {
  async list(req, env) {
    await ensurePassSchema(env);
    const rows = (await env.DB.prepare('SELECT * FROM pass_products ORDER BY sort, app, name').all()).results;
    return json({ products: rows.map(shapeProduct) });
  },
  async save(req, env, ctx, { user }) {
    await ensurePassSchema(env);
    const b = await readJson(req);
    const id = str(b.id, { min: 3, max: 64, name: 'id' });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new HttpError(400, 'invalid', 'id yalnızca küçük harf, rakam ve tire içerebilir.');
    const price = parseAmount(b.price);
    const days = Number(b.duration_days);
    if (!Number.isFinite(days) || days < 1 / 24 || days > 3650) throw new HttpError(400, 'invalid', 'Süre en az 1 saat, en çok 3650 gün olabilir.');
    const features = Array.isArray(b.features) ? b.features.slice(0, 12).map((f) => String(f).slice(0, 100)) : [];
    const status = b.status === 'off' ? 'off' : 'on';
    const t = now(env);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO pass_products (id, app, name, descr, features, price, duration_s, status, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET app = excluded.app, name = excluded.name, descr = excluded.descr, features = excluded.features, price = excluded.price, duration_s = excluded.duration_s, status = excluded.status, sort = excluded.sort, updated_at = excluded.updated_at`)
        .bind(id, str(b.app, { min: 2, max: 60, name: 'app' }), str(b.name, { min: 2, max: 60, name: 'name' }), String(b.desc || '').slice(0, 200), JSON.stringify(features), price, Math.round(days * DAY / 1000), status, Math.trunc(Number(b.sort) || 0), t, t),
      auditStmt(env, user.id, 'pass.product.save', id, String(b.reason || 'katalog güncellemesi').slice(0, 300), 'success', `price=${price}`),
    ]);
    return json({ ok: true });
  },
};
