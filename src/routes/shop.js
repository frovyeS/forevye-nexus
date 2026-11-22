// Nexus Market: FN ile satılan tasarım ve fonksiyonel kartlar.
//  1) POST /api/shop/ticket    (Nexus oturumu)  tek kullanımlık 5 dk'lık bilet; Market sitesine # ile eklenir.
//  2) POST /api/shop/exchange  (CORS: Market sitesi) bileti jetona çevirir (30 dk kayan, en çok 8 saat).
//  3) GET  /api/shop/me | products | product | purchases, POST /api/shop/purchase | wishlist | equip   (Bearer jeton)
// Jeton yalnızca /api/shop/* uçlarında geçerlidir; transfer/profil/şifre uçlarını açmaz. Fiyat, stok, sahiplik ve perk sunucuda doğrulanır.
import { HttpError, json, readJson, str, parseAmount, now, newRef, isConstraint, MIN, HOUR, clientIp } from '../lib/util.js';
import { randomToken, sha256hex } from '../lib/crypto.js';
import { rateLimit } from '../lib/rate.js';
import { entryStmts, guardActiveStmt } from '../lib/ledger.js';
import { notifyStmt } from '../lib/auth.js';
import { balanceOf } from './wallet.js';
import { auditStmt } from './admin.js';
import { grantAchievement } from './misc.js';
import { ownCard, shape as cardShape } from './cards.js';
import { ensureShopSchema, parseData, cleanData, limitsFor, skinsOf, RARITIES, KINDS } from '../lib/shop.js';

const TICKET_TTL = 5 * MIN, TOKEN_SLIDE = 30 * MIN, TOKEN_MAX = 8 * HOUR;
export const shopUrl = (env) => String(env.SHOP_URL || '').trim();
export function shopOrigins(env) {
  const out = [];
  for (const u of [shopUrl(env), ...String(env.SHOP_ORIGINS || '').split(',')]) {
    try { if (u.trim()) out.push(new URL(u.trim()).origin); } catch { /* geçersiz adres yok sayılır */ }
  }
  return out;
}

const shapeProduct = (p) => {
  const d = parseData(p.data);
  return {
    id: p.id, kind: p.kind, rarity: p.rarity, name: p.name, tagline: p.tagline, desc: p.descr, price: p.price,
    stock_total: p.stock_total, stock_left: p.stock_total == null ? null : Math.max(0, p.stock_total - p.stock_sold),
    max_qty: p.max_qty, skin: d.skin || null, perks: d.perks || null, is_new: !!p.is_new, status: p.status,
  };
};
const serialText = (e, p) => (p.stock_total && e.serial ? `${String(e.serial).padStart(3, '0')}/${String(p.stock_total).padStart(3, '0')}` : '');
const shapeEnt = (e, p) => ({ product_id: e.product_id, qty: e.qty, serial: serialText(e, p), acquired_at: e.acquired_at, tx_ref: e.tx_ref });

async function useToken(env, req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,80})$/.exec(req.headers.get('authorization') || '');
  const bad = () => new HttpError(401, 'shop_token', 'Market oturumu geçersiz veya süresi dolmuş. Nexus’tan yeniden açın.');
  if (!m) throw bad();
  await ensureShopSchema(env);
  const t = now(env), th = await sha256hex(m[1]);
  const tok = await env.DB.prepare('SELECT * FROM shop_tokens WHERE token_hash = ? AND expires_at > ?').bind(th, t).first();
  if (!tok) throw bad();
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(tok.user_id).first();
  if (!user) throw bad();
  const exp = Math.min(t + TOKEN_SLIDE, tok.created_at + TOKEN_MAX);
  if (exp > tok.expires_at + MIN) await env.DB.prepare('UPDATE shop_tokens SET expires_at = ? WHERE token_hash = ?').bind(exp, th).run();
  return { user };
}

async function wishlistOf(env, userId) {
  return (await env.DB.prepare('SELECT product_id FROM shop_wishlist WHERE user_id = ?').bind(userId).all()).results.map((r) => r.product_id);
}
async function entitlementsOf(env, userId) {
  const rows = (await env.DB.prepare(
    'SELECT e.*, p.stock_total AS stock_total FROM shop_entitlements e JOIN shop_products p ON p.id = e.product_id WHERE e.user_id = ? ORDER BY e.acquired_at DESC',
  ).bind(userId).all()).results;
  return rows.map((e) => shapeEnt(e, e));
}
async function cardsOf(env, userId) {
  const rows = (await env.DB.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY is_default DESC, created_at ASC').bind(userId).all()).results;
  const skins = await skinsOf(env, userId);
  return rows.map((c) => { const s = cardShape(c); return { id: s.id, label: s.label, display_name: s.display_name, card_token: s.card_token, status: s.status, is_default: s.is_default, design: s.design, skin: skins[c.id] || null }; });
}

async function purchaseResult(env, ref, replayed) {
  const x = await env.DB.prepare('SELECT * FROM shop_purchases WHERE id = ?').bind(ref).first();
  if (!x) return { ok: true, replayed: true };
  const p = await env.DB.prepare('SELECT * FROM shop_products WHERE id = ?').bind(x.product_id).first();
  const e = await env.DB.prepare('SELECT * FROM shop_entitlements WHERE user_id = ? AND product_id = ?').bind(x.user_id, x.product_id).first();
  return {
    ok: true, replayed,
    purchase: { id: x.id, name: x.name, kind: x.kind, price: x.price, serial: p ? serialText(x, p) : '', status: x.status, at: x.created_at },
    entitlement: e && p ? shapeEnt(e, p) : null, balance: await balanceOf(env, x.user_id),
  };
}

// Kart yüzeyi takma/çıkarma. Nexus oturumu (kart ekranı) ve Market jetonu aynı fonksiyonu kullanır.
export async function equipSkin(env, user, cardId, productId) {
  await ensureShopSchema(env);
  const card = await ownCard(env, user.id, cardId);
  if (productId === null || productId === undefined) {
    await env.DB.prepare('DELETE FROM shop_card_skins WHERE card_id = ? AND user_id = ?').bind(card.id, user.id).run();
    return null;
  }
  const pid = str(productId, { min: 1, max: 64, name: 'product_id' });
  const own = await env.DB.prepare('SELECT 1 AS x FROM shop_entitlements WHERE user_id = ? AND product_id = ?').bind(user.id, pid).first();
  const p = await env.DB.prepare('SELECT * FROM shop_products WHERE id = ?').bind(pid).first();
  if (!own || !p) throw new HttpError(403, 'not_owned', 'Bu kart tasarımına sahip değilsin.');
  if (!parseData(p.data).skin) throw new HttpError(400, 'no_skin', 'Bu ürün bir kart yüzeyi içermiyor.');
  await env.DB.prepare('INSERT INTO shop_card_skins (card_id, user_id, product_id, equipped_at) VALUES (?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET product_id = excluded.product_id, equipped_at = excluded.equipped_at')
    .bind(card.id, user.id, pid, now(env)).run();
  return (await skinsOf(env, user.id))[card.id] || null;
}

export const shopRoutes = {
  // Nexus oturumuyla çağrılır.
  async ticket(req, env, ctx, { user }) {
    const url = shopUrl(env);
    if (!url) throw new HttpError(503, 'shop_unavailable', 'Nexus Market bu sunucuda ayarlı değil.');
    await ensureShopSchema(env);
    await rateLimit(env, `shopticket:${user.id}`, 30, 10 * MIN);
    const t = now(env), ticket = randomToken(32);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM shop_tickets WHERE expires_at < ?').bind(t - HOUR),
      env.DB.prepare('DELETE FROM shop_tokens WHERE expires_at < ?').bind(t - HOUR),
      env.DB.prepare('INSERT INTO shop_tickets (token_hash, user_id, expires_at) VALUES (?,?,?)').bind(await sha256hex(ticket), user.id, t + TICKET_TTL),
    ]);
    return json({ url: `${url}${url.includes('#') ? '' : '#'}t=${ticket}`, expires_in: TICKET_TTL / 1000 });
  },

  // Nexus içinde: sahip olunanlar, etkin avantajlar ve limitler.
  async mine(req, env, ctx, { user }) {
    await ensureShopSchema(env);
    const [ent, lim] = await Promise.all([env.DB.prepare('SELECT e.*, p.name AS name, p.rarity AS rarity, p.kind AS kind, p.stock_total AS stock_total, p.data AS data FROM shop_entitlements e JOIN shop_products p ON p.id = e.product_id WHERE e.user_id = ? ORDER BY e.acquired_at DESC').bind(user.id).all(), limitsFor(env, user.id)]);
    return json({
      items: ent.results.map((e) => ({ product_id: e.product_id, name: e.name, kind: e.kind, rarity: e.rarity, qty: e.qty, serial: serialText(e, e), skin: parseData(e.data).skin || null, perks: parseData(e.data).perks || null, acquired_at: e.acquired_at })),
      perks: lim.perks, limits: { max_transfer: lim.max_transfer, daily_limit: lim.daily_limit, max_cards: lim.max_cards },
    });
  },

  async exchange(req, env) {
    const b = await readJson(req);
    await ensureShopSchema(env);
    await rateLimit(env, `shopex:ip:${clientIp(req)}`, 40, 10 * MIN);
    const bad = () => new HttpError(400, 'invalid_ticket', 'Bilet geçersiz veya süresi dolmuş. Nexus’tan yeniden açın.');
    if (typeof b.ticket !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(b.ticket)) throw bad();
    const t = now(env), th = await sha256hex(b.ticket);
    const row = await env.DB.prepare('UPDATE shop_tickets SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING user_id').bind(t, th, t).first();
    if (!row) throw bad();
    const user = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(row.user_id).first();
    if (!user) throw bad();
    const token = randomToken(32);
    await env.DB.prepare('INSERT INTO shop_tokens (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').bind(await sha256hex(token), row.user_id, t, t + TOKEN_SLIDE).run();
    return json({ token, user: { username: user.username }, expires_at: t + TOKEN_SLIDE });
  },

  async me(req, env) {
    const { user } = await useToken(env, req);
    const [balance, entitlements, wishlist, cards, lim] = await Promise.all([balanceOf(env, user.id), entitlementsOf(env, user.id), wishlistOf(env, user.id), cardsOf(env, user.id), limitsFor(env, user.id)]);
    return json({ balance, currency: env.CURRENCY_CODE || 'FN', user: { username: user.username }, entitlements, wishlist, cards, perks: lim.perks, limits: { max_transfer: lim.max_transfer, daily_limit: lim.daily_limit, max_cards: lim.max_cards } });
  },

  async products(req, env) {
    await useToken(env, req);
    const rows = (await env.DB.prepare(`SELECT * FROM shop_products WHERE status = 'on' ORDER BY sort, name`).all()).results;
    return json({ products: rows.map(shapeProduct) });
  },

  async product(req, env, url) {
    await useToken(env, req);
    const id = str(url.searchParams.get('id') || '', { min: 1, max: 64, name: 'id' });
    const p = await env.DB.prepare(`SELECT * FROM shop_products WHERE id = ? AND status = 'on'`).bind(id).first();
    return json({ product: p ? shapeProduct(p) : null });
  },

  async purchases(req, env, url) {
    const { user } = await useToken(env, req);
    const page = Math.min(Math.max(parseInt(url.searchParams.get('page') || '0', 10) || 0, 0), 1000);
    const size = Math.min(Math.max(parseInt(url.searchParams.get('size') || '8', 10) || 8, 1), 30);
    const rows = (await env.DB.prepare(
      'SELECT x.*, p.stock_total AS stock_total FROM shop_purchases x LEFT JOIN shop_products p ON p.id = x.product_id WHERE x.user_id = ? ORDER BY x.created_at DESC, x.id DESC LIMIT ? OFFSET ?',
    ).bind(user.id, size + 1, page * size).all()).results;
    return json({ items: rows.slice(0, size).map((x) => ({ id: x.id, product_id: x.product_id, name: x.name, kind: x.kind, price: x.price, serial: serialText(x, x), status: x.status === 'refunded' ? 'refunded' : 'success', at: x.created_at })), more: rows.length > size });
  },

  async purchase(req, env) {
    const { user } = await useToken(env, req);
    const b = await readJson(req);
    const pid = str(b.pid, { min: 1, max: 64, name: 'pid' });
    const idem = str(b.idem, { min: 8, max: 80, name: 'idem' });
    if (!/^[A-Za-z0-9_-]+$/.test(idem)) throw new HttpError(400, 'invalid_idem', 'Geçersiz işlem anahtarı.');
    await rateLimit(env, `shopbuy:${user.id}`, 20, 10 * MIN);
    const externalRef = `shop:${user.id}:${idem}`;
    const prior = await env.DB.prepare('SELECT tx_ref FROM external_ops WHERE external_ref = ?').bind(externalRef).first();
    if (prior) return json(await purchaseResult(env, prior.tx_ref, true));

    const p = await env.DB.prepare(`SELECT * FROM shop_products WHERE id = ? AND status = 'on'`).bind(pid).first();
    if (!p) return json({ ok: false, code: 'unavailable' });
    const own = await env.DB.prepare('SELECT qty FROM shop_entitlements WHERE user_id = ? AND product_id = ?').bind(user.id, pid).first();
    if (own && own.qty >= p.max_qty) return json({ ok: false, code: 'already_owned' });
    if (p.stock_total != null && p.stock_sold >= p.stock_total) return json({ ok: false, code: 'sold_out' });
    const balance = await balanceOf(env, user.id);
    if (balance < p.price) return json({ ok: false, code: 'insufficient', balance, missing: p.price - balance });

    const t = now(env), ref = newRef('NXM');
    const serialSql = '(SELECT CASE WHEN stock_total IS NOT NULL THEN stock_sold END FROM shop_products WHERE id = ?)';
    try {
      await env.DB.batch([
        guardActiveStmt(env, user.id),
        env.DB.prepare(`INSERT INTO shop_guard (on_sale, stock_ok, qty_ok) VALUES (
          (SELECT CASE WHEN status = 'on' THEN 1 ELSE 0 END FROM shop_products WHERE id = ?),
          (SELECT CASE WHEN stock_total IS NULL OR stock_sold < stock_total THEN 1 ELSE 0 END FROM shop_products WHERE id = ?),
          (SELECT CASE WHEN COALESCE((SELECT qty FROM shop_entitlements WHERE user_id = ? AND product_id = ?), 0) < (SELECT max_qty FROM shop_products WHERE id = ?) THEN 1 ELSE 0 END))`)
          .bind(pid, pid, user.id, pid, pid),
        env.DB.prepare('DELETE FROM shop_guard'),
        env.DB.prepare('UPDATE shop_products SET stock_sold = stock_sold + 1, updated_at = ? WHERE id = ?').bind(t, pid),
        env.DB.prepare('INSERT INTO external_ops (external_ref, kind, user_id, tx_ref, created_at) VALUES (?,?,?,?,?)').bind(externalRef, 'purchase', user.id, ref, t),
        ...entryStmts(env, { ref, userId: user.id, type: 'purchase', amount: -p.price, desc: `Nexus Market: ${p.name}` }),
        env.DB.prepare(`INSERT INTO shop_purchases (id, user_id, product_id, name, kind, price, serial, status, created_at) VALUES (?,?,?,?,?,?,${serialSql},'success',?)`).bind(ref, user.id, p.id, p.name, p.kind, p.price, pid, t),
        env.DB.prepare(`INSERT INTO shop_entitlements (id, user_id, product_id, qty, serial, acquired_at, tx_ref) VALUES (?,?,?,1,${serialSql},?,?)
          ON CONFLICT(user_id, product_id) DO UPDATE SET qty = qty + 1`).bind(`ent_${randomToken(9)}`, user.id, p.id, pid, t, ref),
        env.DB.prepare('DELETE FROM shop_wishlist WHERE user_id = ? AND product_id = ?').bind(user.id, p.id),
        notifyStmt(env, user.id, 'purchase', 'Market alışverişi tamamlandı', `${p.name} koleksiyonuna eklendi. Ref: ${ref}`),
      ]);
    } catch (err) {
      if (isConstraint(err, 'shop_not_on_sale')) return json({ ok: false, code: 'unavailable' });
      if (isConstraint(err, 'shop_sold_out') || isConstraint(err, 'shop_stock_bounds')) return json({ ok: false, code: 'sold_out' });
      if (isConstraint(err, 'shop_max_owned')) return json({ ok: false, code: 'already_owned' });
      if (isConstraint(err, 'wallet_nonneg')) { const bal = await balanceOf(env, user.id); return json({ ok: false, code: 'insufficient', balance: bal, missing: p.price - bal }); }
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

  async wishlist(req, env) {
    const { user } = await useToken(env, req);
    const b = await readJson(req);
    const pid = str(b.pid, { min: 1, max: 64, name: 'pid' });
    await rateLimit(env, `shopwish:${user.id}`, 120, 10 * MIN);
    const p = await env.DB.prepare(`SELECT id, max_qty FROM shop_products WHERE id = ? AND status = 'on'`).bind(pid).first();
    if (!p) throw new HttpError(404, 'not_found', 'Ürün bulunamadı.');
    const has = await env.DB.prepare('SELECT 1 AS x FROM shop_wishlist WHERE user_id = ? AND product_id = ?').bind(user.id, pid).first();
    if (has) await env.DB.prepare('DELETE FROM shop_wishlist WHERE user_id = ? AND product_id = ?').bind(user.id, pid).run();
    else {
      const own = await env.DB.prepare('SELECT qty FROM shop_entitlements WHERE user_id = ? AND product_id = ?').bind(user.id, pid).first();
      if (own && own.qty >= p.max_qty) throw new HttpError(409, 'already_owned', 'Bu ürüne zaten sahipsin; istek listesine eklenemez.');
      await env.DB.prepare('INSERT OR IGNORE INTO shop_wishlist (user_id, product_id, created_at) VALUES (?,?,?)').bind(user.id, pid, now(env)).run();
    }
    return json({ wishlist: await wishlistOf(env, user.id) });
  },

  async equip(req, env) {
    const { user } = await useToken(env, req);
    const b = await readJson(req);
    await rateLimit(env, `shopequip:${user.id}`, 60, 10 * MIN);
    const skin = await equipSkin(env, user, str(b.card_id, { min: 8, max: 64, name: 'card_id' }), b.product_id === null ? null : b.product_id);
    return json({ ok: true, skin });
  },
};

// Nexus oturumuyla (kart ekranı) yüzey takma: PUT/POST /api/cards/:id/skin  { product_id | null }
export async function cardSkinRoute(req, env, ctx, { user }, params) {
  const b = await readJson(req);
  await rateLimit(env, `shopequip:${user.id}`, 60, 10 * MIN);
  return json({ ok: true, skin: await equipSkin(env, user, params.id, b.product_id === undefined ? null : b.product_id) });
}

// Yönetim: katalog. Okuma admin, yazma süper yönetici (para etkisi olduğu için).
export const shopAdminRoutes = {
  async list(req, env) {
    await ensureShopSchema(env);
    const rows = (await env.DB.prepare('SELECT * FROM shop_products ORDER BY sort, name').all()).results;
    return json({ products: rows.map(shapeProduct) });
  },
  async save(req, env, ctx, { user }) {
    await ensureShopSchema(env);
    const b = await readJson(req);
    const id = str(b.id, { min: 3, max: 64, name: 'id' });
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new HttpError(400, 'invalid', 'id yalnızca küçük harf, rakam, _ ve - içerebilir.');
    if (!KINDS.includes(b.kind)) throw new HttpError(400, 'invalid', 'Geçersiz tür.');
    if (!RARITIES.includes(b.rarity)) throw new HttpError(400, 'invalid', 'Geçersiz seviye.');
    const price = parseAmount(b.price);
    const cd = cleanData(b.data);
    if (cd.error) throw new HttpError(400, 'invalid', cd.error);
    let stockTotal = null;
    if (b.stock_total !== undefined && b.stock_total !== null && b.stock_total !== '') {
      stockTotal = Math.trunc(Number(b.stock_total));
      if (!Number.isSafeInteger(stockTotal) || stockTotal < 1 || stockTotal > 1000000) throw new HttpError(400, 'invalid', 'Stok 1 ile 1.000.000 arasında olmalı.');
    }
    const maxQty = Math.trunc(Number(b.max_qty ?? 1));
    if (!Number.isSafeInteger(maxQty) || maxQty < 1 || maxQty > 20) throw new HttpError(400, 'invalid', 'Azami adet 1-20 olmalı.');
    const t = now(env);
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO shop_products (id, kind, rarity, name, tagline, descr, price, stock_total, stock_sold, max_qty, data, status, is_new, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, rarity = excluded.rarity, name = excluded.name, tagline = excluded.tagline, descr = excluded.descr, price = excluded.price, stock_total = excluded.stock_total, max_qty = excluded.max_qty, data = excluded.data, status = excluded.status, is_new = excluded.is_new, sort = excluded.sort, updated_at = excluded.updated_at`)
          .bind(id, b.kind, b.rarity, str(b.name, { min: 2, max: 60, name: 'name' }), String(b.tagline || '').slice(0, 120), String(b.desc || '').slice(0, 400), price, stockTotal, maxQty, JSON.stringify(cd.data), b.status === 'off' ? 'off' : 'on', b.is_new ? 1 : 0, Math.trunc(Number(b.sort) || 0), t, t),
        auditStmt(env, user.id, 'shop.product.save', id, String(b.reason || 'katalog güncellemesi').slice(0, 300), 'success', `price=${price}`),
      ]);
    } catch (err) {
      if (isConstraint(err, 'shop_stock_bounds')) throw new HttpError(400, 'invalid', 'Stok, satılan adetten az olamaz.');
      throw err;
    }
    return json({ ok: true });
  },
};
