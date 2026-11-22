// Nexus Pass (süreli üyelik) arka ucu. Arayüz ayrı sitedir (nexus-pass deposu); fiyat, süre, bakiye düşümü, idempotency ve çift üyelik denetimi BURADA yapılır.
//
//  1) POST /api/pass/ticket     (Nexus oturumu)      tek kullanımlık 5 dk'lık bilet üretir; adres PASS_URL#t=<bilet>
//  2) POST /api/pass/exchange   (CORS: Pass sitesi)  bileti jetona çevirir (30 dk kayan, en çok 8 saat)
//  3) GET  /api/pass/products | /product?id= | /me | /purchases?page=&size=   (Bearer jeton)
//  4) POST /api/pass/purchase   (Bearer jeton)       { pid, idem } → FN bakiyesinden düşer, üyelik açar
//  5) POST /api/internal/entitlement (INTERNAL_API_KEY) başka sistemler üyeliğin aktif olup olmadığını sorar
//
// Jeton yalnızca /api/pass/* uçlarında geçerlidir; transfer, profil, kart gibi hiçbir ucu açmaz. İş sonuçları (yetersiz bakiye vb.) 200 + { ok:false, code } döner.
import { HttpError, json, readJson, now, MIN, HOUR, clientIp, isConstraint, newRef, parseAmount, str } from '../lib/util.js';
import { randomToken, sha256hex } from '../lib/crypto.js';
import { rateLimit } from '../lib/rate.js';
import { entryStmts, guardActiveStmt, fmtMinor } from '../lib/ledger.js';
import { notifyStmt } from '../lib/auth.js';
import { balanceOf } from './wallet.js';
import { grantAchievement } from './misc.js';
import { auditStmt } from './admin.js';

const TICKET_TTL = 5 * MIN, TOKEN_SLIDE = 30 * MIN, TOKEN_MAX = 8 * HOUR;

// 0006_pass.sql canlı D1'e uygulanmadıysa "no such table" → 500 olurdu. Tablolar eksikse (IF NOT EXISTS, migration'la aynı şema) kendiliğinden kurulur.
const SCHEMA_OK = new WeakSet();
async function ensurePassSchema(env) {
  if (!env.DB || SCHEMA_OK.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pass_products (id TEXT PRIMARY KEY, app TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', features_json TEXT NOT NULL DEFAULT '[]', price INTEGER NOT NULL CHECK (price > 0), duration_sec INTEGER NOT NULL CHECK (duration_sec >= 3600), status TEXT NOT NULL DEFAULT 'on' CHECK (status IN ('on','off')), sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pass_purchases (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL, app TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, duration_sec INTEGER NOT NULL, idem TEXT NOT NULL, starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, CONSTRAINT pass_idem UNIQUE (user_id, idem))`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_pass_purch_user ON pass_purchases(user_id, created_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_pass_purch_prod ON pass_purchases(user_id, product_id, expires_at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS pass_tickets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, consumed_at INTEGER)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_pass_tickets_exp ON pass_tickets(expires_at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS pass_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_pass_tokens_exp ON pass_tokens(expires_at)'),
  ]);
  SCHEMA_OK.add(env.DB);
}

export const passUrl = (env) => String(env.PASS_URL || '').trim();
export function passOrigins(env) {
  const out = [];
  for (const u of [passUrl(env), ...String(env.PASS_ORIGINS || '').split(',')]) {
    try { if (u.trim()) out.push(new URL(u.trim()).origin); } catch { /* geçersiz adres yok sayılır */ }
  }
  return out;
}

// Üyelik "aktif" = süresi dolmamış VE ters kayıtla (iade/düzeltme) kapatılmamış.
const NOT_REVERSED = 'NOT EXISTS (SELECT 1 FROM reversals r WHERE r.original_ref = p.id)';
const parseFeatures = (j) => { try { const a = JSON.parse(j); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };
const shapeProduct = (r) => ({ id: r.id, app: r.app, name: r.name, price: r.price, dur: r.duration_sec, desc: r.description, features: parseFeatures(r.features_json), status: r.status });
function shapeEnt(r, t) {
  const status = r.reversed ? 'cancelled' : r.expires_at > t ? 'active' : 'expired';
  return { id: r.id, pid: r.product_id, status, starts: r.starts_at, expires: r.expires_at, product: { app: r.app, name: r.name }, snap: { id: r.id, price: r.price } };
}
const ENT_COLS = `p.*, (NOT ${NOT_REVERSED}) AS reversed`;

// Kullanıcının aktif üyelikleri (başka sistemlerin sorgusu için de kullanılır).
export async function activeEntitlements(env, userId, { app, productId } = {}) {
  const t = now(env);
  const where = ['p.user_id = ?', 'p.expires_at > ?', NOT_REVERSED], binds = [userId, t];
  if (app) { where.push('p.app = ?'); binds.push(app); }
  if (productId) { where.push('p.product_id = ?'); binds.push(productId); }
  const rows = (await env.DB.prepare(`SELECT p.* FROM pass_purchases p WHERE ${where.join(' AND ')} ORDER BY p.expires_at DESC`).bind(...binds).all()).results;
  return rows.map((r) => ({ product_id: r.product_id, app: r.app, name: r.name, starts_at: r.starts_at, expires_at: r.expires_at }));
}

// Bearer jetonu doğrular, süresini kaydırır. Kullanıcı başına istek sınırı vardır (arayüzde "RATE" olarak görünür).
async function useToken(env, req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,80})$/.exec(req.headers.get('authorization') || '');
  const bad = () => new HttpError(401, 'pass_token', 'Pass oturumu geçersiz veya süresi dolmuş. Nexus’tan Nexus Pass’i yeniden açın.');
  if (!m) throw bad();
  await ensurePassSchema(env);
  const t = now(env), th = await sha256hex(m[1]);
  const tok = await env.DB.prepare('SELECT * FROM pass_tokens WHERE token_hash = ? AND expires_at > ?').bind(th, t).first();
  if (!tok) throw bad();
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(tok.user_id).first();
  if (!user) throw bad();
  const exp = Math.min(t + TOKEN_SLIDE, tok.created_at + TOKEN_MAX);
  if (exp > tok.expires_at + MIN) await env.DB.prepare('UPDATE pass_tokens SET expires_at = ? WHERE token_hash = ?').bind(exp, th).run();
  await rateLimit(env, `passapi:${user.id}`, 300, 10 * MIN);
  return { user };
}

const replayResult = (prior, balance) => ({
  ok: true, replayed: true, balance,
  purchase: { id: prior.id, app: prior.app, name: prior.name, dur: prior.duration_sec, price: prior.price },
  entitlement: { starts: prior.starts_at, expires: prior.expires_at },
});

export const passRoutes = {
  async ticket(req, env, ctx, { user }) {
    const url = passUrl(env);
    if (!url) throw new HttpError(503, 'pass_unavailable', 'Nexus Pass bu sunucuda ayarlı değil.');
    await readJson(req);
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

  async exchange(req, env) {
    const b = await readJson(req);
    await ensurePassSchema(env);
    await rateLimit(env, `passex:ip:${clientIp(req)}`, 40, 10 * MIN);
    const bad = () => new HttpError(400, 'invalid_ticket', 'Bilet geçersiz veya süresi dolmuş. Nexus’tan Nexus Pass’i yeniden açın.');
    if (typeof b.ticket !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(b.ticket)) throw bad();
    const t = now(env), th = await sha256hex(b.ticket);
    const row = await env.DB.prepare('UPDATE pass_tickets SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING user_id').bind(t, th, t).first();
    if (!row) throw bad();
    const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(row.user_id).first();
    if (!user) throw bad();
    const token = randomToken(32);
    await env.DB.prepare('INSERT INTO pass_tokens (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').bind(await sha256hex(token), user.id, t, t + TOKEN_SLIDE).run();
    return json({ token, expires_at: t + TOKEN_SLIDE });
  },

  async products(req, env) {
    await useToken(env, req);
    const rows = (await env.DB.prepare("SELECT * FROM pass_products WHERE status = 'on' ORDER BY app, sort, price, id").all()).results;
    return json({ products: rows.map(shapeProduct) });
  },

  // Bilinmeyen paket 404 değil { product: null } döner (arayüz "artık satışta değil" gösterir).
  async product(req, env, url) {
    await useToken(env, req);
    const id = url.searchParams.get('id') || '';
    const row = /^[a-z0-9][a-z0-9-]{1,63}$/.test(id) ? await env.DB.prepare('SELECT * FROM pass_products WHERE id = ?').bind(id).first() : null;
    return json({ product: row ? shapeProduct(row) : null });
  },

  async me(req, env) {
    const { user } = await useToken(env, req);
    const t = now(env);
    const rows = (await env.DB.prepare(`SELECT ${ENT_COLS} FROM pass_purchases p WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT 100`).bind(user.id).all()).results;
    return json({ balance: await balanceOf(env, user.id), username: user.username, entitlements: rows.map((r) => shapeEnt(r, t)) });
  },

  async purchases(req, env, url) {
    const { user } = await useToken(env, req);
    const page = Math.min(Math.max(parseInt(url.searchParams.get('page') || '0', 10) || 0, 0), 1000);
    const size = Math.min(Math.max(parseInt(url.searchParams.get('size') || '5', 10) || 5, 1), 20);
    const rows = (await env.DB.prepare(`SELECT ${ENT_COLS} FROM pass_purchases p WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`).bind(user.id, size + 1, page * size).all()).results;
    return json({
      items: rows.slice(0, size).map((r) => ({ id: r.id, app: r.app, name: r.name, status: r.reversed ? 'cancelled' : 'success', at: r.created_at, price: r.price, dur: r.duration_sec })),
      more: rows.length > size,
    });
  },

  async purchase(req, env) {
    const { user } = await useToken(env, req);
    const b = await readJson(req);
    await rateLimit(env, `passbuy:${user.id}`, 20, 10 * MIN);
    if (typeof b.idem !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(b.idem)) throw new HttpError(400, 'invalid_key', 'İşlem anahtarı eksik veya geçersiz.');
    if (typeof b.pid !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(b.pid)) throw new HttpError(400, 'invalid_product', 'Geçersiz paket.');
    const t = now(env);
    const fail = async (code, extra = {}) => json({ ok: false, code, balance: await balanceOf(env, user.id), ...extra });

    // Tekrar isteği: aynı anahtar aynı sonucu döner, ikinci kez düşmez.
    const prior = await env.DB.prepare('SELECT * FROM pass_purchases WHERE user_id = ? AND idem = ?').bind(user.id, b.idem).first();
    if (prior) {
      if (prior.product_id !== b.pid) throw new HttpError(409, 'key_reuse', 'Bu işlem anahtarı farklı bir istek için kullanılmış.');
      return json(replayResult(prior, await balanceOf(env, user.id)));
    }

    const p = await env.DB.prepare('SELECT * FROM pass_products WHERE id = ?').bind(b.pid).first();
    if (!p || p.status !== 'on') return fail('unavailable');
    if (user.status === 'suspended' && !(user.suspended_until && t >= user.suspended_until)) throw new HttpError(403, 'account_suspended', 'Hesabınız askıda; satın alma yapılamaz.');
    const owned = async () => env.DB.prepare(`SELECT 1 AS x FROM pass_purchases p WHERE p.user_id = ? AND p.product_id = ? AND p.expires_at > ? AND ${NOT_REVERSED} LIMIT 1`).bind(user.id, p.id, t).first();
    if (await owned()) return fail('already_active');
    const balance = await balanceOf(env, user.id);
    if (balance < p.price) return fail('insufficient', { missing: p.price - balance });

    const ref = newRef('NXP'), starts = t, expires = t + p.duration_sec * 1000;
    // Son savunma: hesap aktif, paket hâlâ aynı fiyat/süreyle satışta, aktif üyelik yok. Biri bozulursa tüm işlem geri alınır ("malformed JSON").
    const guard = env.DB.prepare(`SELECT json_extract(CASE WHEN EXISTS (SELECT 1 FROM pass_products WHERE id = ? AND status = 'on' AND price = ? AND duration_sec = ?)
      AND NOT EXISTS (SELECT 1 FROM pass_purchases p WHERE p.user_id = ? AND p.product_id = ? AND p.expires_at > ? AND ${NOT_REVERSED}) THEN '{}' ELSE 'x' END, '$')`)
      .bind(p.id, p.price, p.duration_sec, user.id, p.id, t);
    try {
      await env.DB.batch([
        guardActiveStmt(env, user.id),
        guard,
        env.DB.prepare('INSERT INTO pass_purchases (id, user_id, product_id, app, name, price, duration_sec, idem, starts_at, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .bind(ref, user.id, p.id, p.app, p.name, p.price, p.duration_sec, b.idem, starts, expires, t),
        ...entryStmts(env, { ref, userId: user.id, type: 'purchase', amount: -p.price, desc: `Nexus Pass · ${p.app} · ${p.name}`.slice(0, 80) }),
        notifyStmt(env, user.id, 'purchase', 'Nexus Pass etkinleştirildi', `${p.app} · ${p.name} (${fmtMinor(p.price)} FN). Ref: ${ref}`),
      ]);
    } catch (err) {
      if (isConstraint(err, 'wallet_nonneg')) { const bal = await balanceOf(env, user.id); return fail('insufficient', { missing: Math.max(0, p.price - bal) }); }
      if (isConstraint(err, 'pass_idem')) {
        const again = await env.DB.prepare('SELECT * FROM pass_purchases WHERE user_id = ? AND idem = ?').bind(user.id, b.idem).first();
        if (again && again.product_id === p.id) return json(replayResult(again, await balanceOf(env, user.id)));
      }
      if (String(err.message || err).includes('malformed JSON')) {
        const fresh = await env.DB.prepare('SELECT status, suspended_until FROM users WHERE id = ?').bind(user.id).first();
        if (fresh && fresh.status === 'suspended' && !(fresh.suspended_until && now(env) >= fresh.suspended_until)) throw new HttpError(403, 'account_suspended', 'Hesabınız askıda; satın alma yapılamaz.');
        const pp = await env.DB.prepare('SELECT status, price, duration_sec FROM pass_products WHERE id = ?').bind(p.id).first();
        if (!pp || pp.status !== 'on' || pp.price !== p.price || pp.duration_sec !== p.duration_sec) return fail('unavailable');
        return fail('already_active');
      }
      throw err;
    }
    await grantAchievement(env, user.id, 'first_purchase');
    return json({
      ok: true, replayed: false, balance: await balanceOf(env, user.id),
      purchase: { id: ref, app: p.app, name: p.name, dur: p.duration_sec, price: p.price },
      entitlement: { starts, expires },
    }, 201);
  },
};

// ---------- Yönetici: katalog ----------
export const passAdminRoutes = {
  async list(req, env) {
    await ensurePassSchema(env);
    const rows = (await env.DB.prepare('SELECT * FROM pass_products ORDER BY app, sort, price, id').all()).results;
    return json({ products: rows.map(shapeProduct) });
  },

  // Süper yönetici: paket ekler/günceller. Fiyat "50.00" (FN) biçiminde; süre gün (duration_days) veya saat (duration_hours) olarak verilir.
  async upsert(req, env, ctx, { user }) {
    await ensurePassSchema(env);
    const b = await readJson(req);
    const id = typeof b.id === 'string' ? b.id.trim() : '';
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) throw new HttpError(400, 'invalid', 'Paket kimliği küçük harf, rakam ve - içermeli (2-64 karakter).');
    const app = str(b.app, { min: 2, max: 60, name: 'Uygulama' });
    const name = str(b.name, { min: 2, max: 80, name: 'Ad' });
    const description = b.description == null ? '' : str(b.description, { max: 300, name: 'Açıklama' });
    const features = Array.isArray(b.features) ? b.features.map((f) => str(f, { min: 1, max: 120, name: 'Özellik' })).slice(0, 12) : [];
    const price = parseAmount(b.price);
    const hours = b.duration_days != null ? Number(b.duration_days) * 24 : Number(b.duration_hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 366) throw new HttpError(400, 'invalid', 'Süre 1 saat ile 366 gün arasında olmalı.');
    const status = b.status === 'off' ? 'off' : 'on';
    const sort = Number.isInteger(b.sort) ? b.sort : 0;
    const reason = str(b.reason, { min: 3, max: 300, name: 'Gerekçe' });
    const t = now(env);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO pass_products (id, app, name, description, features_json, price, duration_sec, status, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET app = excluded.app, name = excluded.name, description = excluded.description, features_json = excluded.features_json,
          price = excluded.price, duration_sec = excluded.duration_sec, status = excluded.status, sort = excluded.sort, updated_at = excluded.updated_at`)
        .bind(id, app, name, description, JSON.stringify(features), price, hours * 3600, status, sort, t, t),
      auditStmt(env, user.id, 'pass.product.upsert', id, reason, 'success', `price=${price};dur_h=${hours};status=${status}`),
    ]);
    const row = await env.DB.prepare('SELECT * FROM pass_products WHERE id = ?').bind(id).first();
    return json({ ok: true, product: shapeProduct(row) });
  },
};
