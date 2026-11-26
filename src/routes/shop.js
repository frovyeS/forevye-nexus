// Nexus Market: FN ile satılan tasarım ve fonksiyonel kartlar.
//  1) POST /api/shop/ticket    (Nexus oturumu)  tek kullanımlık 5 dk'lık bilet; Market sitesine # ile eklenir.
//  2) POST /api/shop/exchange  (CORS: Market sitesi) bileti jetona çevirir (30 dk kayan, en çok 8 saat).
//  3) GET  /api/shop/me | products | product | purchases, POST /api/shop/purchase | wishlist | equip   (Bearer jeton)
// Jeton yalnızca /api/shop/* uçlarında geçerlidir; transfer/profil/şifre uçlarını açmaz. Fiyat, stok, sahiplik ve perk sunucuda doğrulanır.
import { HttpError, json, readJson, str, parseAmount, now, newRef, randomBase32, isConstraint, MIN, HOUR, clientIp } from '../lib/util.js';
import { randomToken, sha256hex } from '../lib/crypto.js';
import { rateLimit } from '../lib/rate.js';
import { entryStmts, guardActiveStmt } from '../lib/ledger.js';
import { notifyStmt } from '../lib/auth.js';
import { balanceOf } from './wallet.js';
import { auditStmt } from './admin.js';
import { grantAchievement } from './misc.js';
import { ownCard, shape as cardShape, prepareCardCreation, ensureMarketCardDeliveries, ensureCardNotListed } from './cards.js';
import { suggestDisplayName } from '../../shared/card-contract.js';
import { ensureShopSchema, parseData, cleanData, limitsFor, skinsOf, RARITIES, KINDS } from '../lib/shop.js';
import { requireCardMoneySchema } from '../lib/card-money-schema.js';
import { ensureCommunityMarketSchema } from '../lib/community-market-schema.js';
import { siteOrigins } from '../lib/origins.js';

const TICKET_TTL = 5 * MIN, TOKEN_SLIDE = 30 * MIN, TOKEN_MAX = 8 * HOUR;
export const shopUrl = (env) => String(env.SHOP_URL || '').trim();
// İki GitHub hesabı koda gömülü (src/lib/origins.js); SHOP_URL / SHOP_ORIGINS ek adres ekler.
export const shopOrigins = (env) => siteOrigins(shopUrl(env), env.SHOP_ORIGINS);

const shapeProduct = (p) => {
  const d = parseData(p.data);
  return {
    id: p.id, kind: p.kind, rarity: p.rarity, name: p.name, tagline: p.tagline, desc: p.descr, price: p.price,
    stock_total: p.stock_total, stock_left: p.stock_total == null ? null : Math.max(0, p.stock_total - p.stock_sold),
    max_qty: p.max_qty, skin: d.skin || null, perks: d.perks || null, is_new: !!p.is_new, status: p.status,
    collection: d.collection || null, collection_id: d.collection_id || null, collection_type: d.collection_type || null,
    orientation: d.orientation || null, art_direction: d.art_direction || null, asset_status: d.asset_status || null,
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
async function cardsOf(env, user) {
  await ensureCommunityMarketSchema(env);
  await requireCardMoneySchema(env);
  await ensureMarketCardDeliveries(env, user);
  const rows = (await env.DB.prepare('SELECT * FROM cards WHERE user_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, created_at ASC').bind(user.id).all()).results;
  const skins = await skinsOf(env, user.id);
  return Promise.all(rows.map(async (c) => {
    const listing = await env.DB.prepare("SELECT id, title, price_minor FROM card_market_listings WHERE card_id = ? AND status = 'active'").bind(c.id).first();
    const delivery = await env.DB.prepare(`SELECT d.purchase_id, p.price FROM shop_card_deliveries d JOIN shop_purchases p ON p.id = d.purchase_id
      WHERE d.card_id = ? AND d.user_id = ? AND p.status = 'success' LIMIT 1`).bind(c.id, user.id).first();
    const s = cardShape(c);
    return { id: s.id, label: s.label, display_name: s.display_name, card_token: s.card_token, status: s.status, balance: s.balance, is_default: s.is_default, design: s.design, skin: skins[c.id] || null,
      market_listing: listing || null, market_return: delivery ? { purchase_id: delivery.purchase_id, refund_minor: Number(delivery.price || 0) } : null,
      can_sell: !listing && !delivery && !skins[c.id] && !c.is_default && c.status === 'active' && Number(c.balance || 0) === 0 };
  }));
}

async function purchaseResult(env, ref, replayed) {
  await requireCardMoneySchema(env);
  const x = await env.DB.prepare('SELECT * FROM shop_purchases WHERE id = ?').bind(ref).first();
  if (!x) return { ok: true, replayed: true };
  const p = await env.DB.prepare('SELECT * FROM shop_products WHERE id = ?').bind(x.product_id).first();
  const e = await env.DB.prepare('SELECT * FROM shop_entitlements WHERE user_id = ? AND product_id = ?').bind(x.user_id, x.product_id).first();
  const cardPayment = await env.DB.prepare(`SELECT l.card_id, l.balance_after, c.label, c.display_name
    FROM card_ledger l LEFT JOIN cards c ON c.id = l.card_id
    WHERE l.tx_ref = ? AND l.user_id = ? AND l.type = 'payment' AND l.amount < 0`).bind(ref, x.user_id).first();
  const delivered = await env.DB.prepare(`SELECT c.* FROM shop_card_deliveries d
    JOIN cards c ON c.id = d.card_id AND c.user_id = d.user_id
    WHERE d.purchase_id = ? AND d.user_id = ?`).bind(ref, x.user_id).first();
  const deliverySkin = delivered ? (await skinsOf(env, x.user_id))[delivered.id] || null : null;
  return {
    ok: true, replayed,
    purchase: { id: x.id, name: x.name, kind: x.kind, price: x.price, serial: p ? serialText(x, p) : '', status: x.status, at: x.created_at },
    entitlement: e && p ? shapeEnt(e, p) : null, balance: await balanceOf(env, x.user_id),
    delivery: delivered ? { card: { ...cardShape(delivered), skin: deliverySkin } } : null,
    payment: cardPayment ? { method: 'card', card_id: cardPayment.card_id, card_label: cardPayment.label || cardPayment.display_name, card_balance: Number(cardPayment.balance_after || 0) }
      : { method: 'wallet' },
  };
}

// Kart yüzeyi takma/çıkarma. Nexus oturumu (kart ekranı) ve Market jetonu aynı fonksiyonu kullanır.
export async function equipSkin(env, user, cardId, productId) {
  await ensureShopSchema(env);
  const card = await ownCard(env, user.id, cardId);
  await ensureCardNotListed(env, card.id);
  if (productId === null || productId === undefined) {
    await env.DB.prepare('DELETE FROM shop_card_skins WHERE card_id = ? AND user_id = ?').bind(card.id, user.id).run();
    return null;
  }
  const pid = str(productId, { min: 1, max: 64, name: 'product_id' });
  const own = await env.DB.prepare('SELECT 1 AS x FROM shop_entitlements WHERE user_id = ? AND product_id = ?').bind(user.id, pid).first();
  const p = await env.DB.prepare('SELECT * FROM shop_products WHERE id = ?').bind(pid).first();
  if (!own || !p) throw new HttpError(403, 'not_owned', 'Bu kart tasarımına sahip değilsin.');
  const productData = parseData(p.data);
  if (!productData.skin) throw new HttpError(400, 'no_skin', 'Bu ürün bir kart yüzeyi içermiyor.');
  if (productData.orientation) {
    let cardDesign = {};
    try { cardDesign = JSON.parse(card.design_json || '{}'); } catch {}
    if (cardDesign.orientation && cardDesign.orientation !== productData.orientation) {
      throw new HttpError(400, 'orientation_mismatch', `Bu koleksiyon kartı ${productData.orientation === 'portrait' ? 'dikey' : 'yatay'} yönünde tasarlandı. Kartının yönünü aynı şekilde ayarlayıp tekrar dene.`);
    }
  }
  await env.DB.prepare('INSERT INTO shop_card_skins (card_id, user_id, product_id, equipped_at) VALUES (?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET product_id = excluded.product_id, equipped_at = excluded.equipped_at')
    .bind(card.id, user.id, pid, now(env)).run();
  return (await skinsOf(env, user.id))[card.id] || null;
}

export async function createShopTicket(env, user, productId = null) {
  const base = shopUrl(env);
  if (!base) throw new HttpError(503, 'shop_unavailable', 'Nexus Market bu sunucuda ayarlı değil.');
  await ensureShopSchema(env);
  await rateLimit(env, `shopticket:${user.id}`, 30, 10 * MIN);
  const t = now(env), ticket = randomToken(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM shop_tickets WHERE expires_at < ?').bind(t - HOUR),
    env.DB.prepare('DELETE FROM shop_tokens WHERE expires_at < ?').bind(t - HOUR),
    env.DB.prepare('INSERT INTO shop_tickets (token_hash, user_id, expires_at) VALUES (?,?,?)').bind(await sha256hex(ticket), user.id, t + TICKET_TTL),
  ]);
  const target = new URL(base);
  if (productId) target.searchParams.set('product_id', String(productId));
  target.hash = `t=${ticket}`;
  return { url: target.toString(), expires_in: TICKET_TTL / 1000 };
}

const listingShape = (row) => ({
  id: row.id, card_id: row.card_id, title: row.title, description: row.description,
  price: Number(row.price_minor) / 100, price_minor: Number(row.price_minor),
  commission_minor: Number(row.commission_minor), seller_proceeds_minor: Number(row.seller_proceeds_minor),
  status: row.status, created_at: row.created_at, seller: { username: row.seller_username },
  card: { display_name: row.display_name, label: row.label, design: cardShape(row).design },
});

async function communityRows(env, where = "l.status = 'active'", binds = []) {
  await ensureCommunityMarketSchema(env);
  const rows = (await env.DB.prepare(`SELECT l.*, c.label, c.display_name, c.design_json, c.design_version, c.card_token, c.status AS card_status,
      c.balance, c.is_default, c.user_id, c.updated_at, u.username AS seller_username
    FROM card_market_listings l JOIN cards c ON c.id = l.card_id JOIN users u ON u.id = l.seller_id
    WHERE ${where} AND c.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 100`).bind(...binds).all()).results;
  return rows.map(listingShape);
}

export const shopRoutes = {
  // Market jetonuyla tek kullanımlık, kapsamı sınırlı Banka dönüş bileti üretir.
  async bankTicket(req, env) {
    const { user } = await useToken(env, req);
    const base = String(env.BANK_URL || '').trim();
    if (!base) throw new HttpError(503, 'bank_unavailable', 'Banka uygulaması adresi sunucuda ayarlı değil.');
    await env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS bank_tickets (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS bank_tokens (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_bank_tickets_exp ON bank_tickets(expires_at)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_bank_tokens_exp ON bank_tokens(expires_at)'),
    ]);
    await rateLimit(env, `bankticket:${user.id}`, 20, 10 * MIN);
    const t = now(env), ticket = randomToken(32);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM bank_tickets WHERE expires_at < ?').bind(t - HOUR),
      env.DB.prepare('DELETE FROM bank_tokens WHERE expires_at < ?').bind(t - HOUR),
      env.DB.prepare('INSERT INTO bank_tickets (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').bind(await sha256hex(ticket), user.id, t, t + 5 * MIN),
    ]);
    const target = new URL(base); target.hash = `bank=${ticket}`;
    return json({ url: target.toString(), expires_in: 5 * MIN / 1000 });
  },

  // Nexus oturumuyla çağrılır.
  async ticket(req, env, ctx, { user }) {
    const b = await readJson(req).catch(() => ({}));
    return json(await createShopTicket(env, user, b.product_id || null));
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
    const [balance, entitlements, wishlist, cards, lim] = await Promise.all([balanceOf(env, user.id), entitlementsOf(env, user.id), wishlistOf(env, user.id), cardsOf(env, user), limitsFor(env, user.id)]);
    return json({ balance, currency: env.CURRENCY_CODE || 'FN', user: { username: user.username }, entitlements, wishlist, cards, perks: lim.perks, limits: { max_transfer: lim.max_transfer, daily_limit: lim.daily_limit, max_cards: lim.max_cards } });
  },

  async products(req, env) {
    await useToken(env, req);
    const rows = (await env.DB.prepare(`SELECT * FROM shop_products WHERE status = 'on' ORDER BY sort, name`).all()).results;
    return json({ products: rows.map(shapeProduct) });
  },

  async community(req, env) {
    const { user } = await useToken(env, req);
    await requireCardMoneySchema(env);
    const items = await communityRows(env);
    return json({ items, commission_pct: 30, current_user: user.username });
  },

  async communityMine(req, env) {
    const { user } = await useToken(env, req);
    await requireCardMoneySchema(env);
    await ensureMarketCardDeliveries(env, user);
    const items = await communityRows(env, 'l.seller_id = ?', [user.id]);
    const rows = (await env.DB.prepare('SELECT * FROM cards WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').bind(user.id).all()).results;
    const skins = await skinsOf(env, user.id);
    const cards = await Promise.all(rows.map(async (c) => {
      const listing = await env.DB.prepare("SELECT id, title, price_minor, status FROM card_market_listings WHERE card_id = ? AND status = 'active'").bind(c.id).first();
      const delivery = await env.DB.prepare(`SELECT d.purchase_id FROM shop_card_deliveries d JOIN shop_purchases p ON p.id = d.purchase_id
        WHERE d.card_id = ? AND d.user_id = ? AND p.status = 'success' LIMIT 1`).bind(c.id, user.id).first();
      const s = cardShape(c);
      return { id: s.id, label: s.label, display_name: s.display_name, balance: s.balance, status: s.status, is_default: s.is_default,
        design: s.design, skin: skins[c.id] || null, market_listing: listing || null,
        can_sell: !listing && !delivery && !skins[c.id] && !c.is_default && c.status === 'active' && Number(c.balance || 0) === 0 };
    }));
    return json({ listings: items, cards, commission_pct: 30 });
  },

  async communityList(req, env) {
    const { user } = await useToken(env, req);
    await requireCardMoneySchema(env);
    const b = await readJson(req);
    const cardId = str(b.card_id, { min: 8, max: 64, name: 'card_id' });
    const title = str(b.title, { min: 2, max: 60, name: 'title' });
    const description = typeof b.description === 'string' ? b.description.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 260) : '';
    const price = parseAmount(b.price);
    const fee = Math.floor(price * 30 / 100), proceeds = price - fee;
    if (proceeds < 1) throw new HttpError(400, 'price_too_low', 'Satış fiyatı komisyon sonrası en az 0,01 FN bırakmalı.');
    await rateLimit(env, `communitylist:${user.id}`, 15, 10 * MIN);
    const card = await ownCard(env, user.id, cardId);
    await ensureCardNotListed(env, card.id);
    if (card.status !== 'active') throw new HttpError(400, 'card_disabled', 'Yalnızca aktif kartlar satışa çıkarılabilir.');
    if (card.is_default) throw new HttpError(409, 'default_card', 'Önce başka bir kartı varsayılan yap.');
    if (Number(card.balance || 0) !== 0) throw new HttpError(409, 'card_has_balance', 'Satıştan önce kart bakiyesini sıfırla.');
    const delivered = await env.DB.prepare(`SELECT 1 AS x FROM shop_card_deliveries d JOIN shop_purchases p ON p.id = d.purchase_id
      WHERE d.card_id = ? AND d.user_id = ? AND p.status = 'success' LIMIT 1`).bind(card.id, user.id).first();
    const paidSkin = await env.DB.prepare('SELECT 1 AS x FROM shop_card_skins WHERE card_id = ? AND user_id = ? LIMIT 1').bind(card.id, user.id).first();
    if (delivered || paidSkin) throw new HttpError(409, 'not_community_card', 'Topluluk pazarında yalnızca kendi oluşturduğun ve ücretli yüzey takılı olmayan kartları satabilirsin.');
    const t = now(env), id = `NXCML-${randomBase32(10)}`;
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO card_market_guard (ok) SELECT CASE WHEN EXISTS (
          SELECT 1 FROM cards c WHERE c.id = ? AND c.user_id = ? AND c.deleted_at IS NULL AND c.status = 'active'
            AND c.is_default = 0 AND c.balance = 0
            AND NOT EXISTS (SELECT 1 FROM shop_card_deliveries d JOIN shop_purchases p ON p.id = d.purchase_id WHERE d.card_id = c.id AND p.status = 'success')
            AND NOT EXISTS (SELECT 1 FROM shop_card_skins s WHERE s.card_id = c.id)
        ) THEN 1 ELSE 0 END`).bind(card.id, user.id),
        env.DB.prepare(`INSERT INTO card_market_listings (id, card_id, seller_id, title, description, price_minor, commission_minor, seller_proceeds_minor, status, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,'active',?,?)`).bind(id, card.id, user.id, title, description, price, fee, proceeds, t, t),
        env.DB.prepare('DELETE FROM card_market_guard'),
        notifyStmt(env, user.id, 'community_card_listed', 'Kartın topluluk pazarında', `${title} ilanı ${ (price / 100).toFixed(2) } FN fiyatla yayınlandı. Satışta %30 komisyon uygulanır.`),
      ]);
    } catch (err) {
      if (isConstraint(err, 'idx_card_market_one_active_per_card') || isConstraint(err, 'card_market_listings.card_id') || String(err.message || err).includes('UNIQUE constraint failed: card_market_listings.card_id'))
        throw new HttpError(409, 'already_listed', 'Bu kart zaten satışta.');
      if (isConstraint(err, 'card_market_guard.ok') || String(err.message || err).includes('CHECK constraint failed') || String(err.message || err).includes('malformed JSON'))
        throw new HttpError(409, 'card_state_changed', 'Kartın satış koşulları değişti; yeniden kontrol et.');
      throw err;
    }
    return json({ ok: true, listing: { id, title, price_minor: price, commission_minor: fee, seller_proceeds_minor: proceeds } }, 201);
  },

  async communityCancel(req, env, url, auth, params) {
    await ensureCommunityMarketSchema(env);
    const { user } = await useToken(env, req);
    const listingId = str(params.id, { min: 8, max: 64, name: 'listing_id' });
    const listing = await env.DB.prepare("SELECT * FROM card_market_listings WHERE id = ? AND seller_id = ? AND status = 'active'").bind(listingId, user.id).first();
    if (!listing) throw new HttpError(404, 'listing_not_found', 'Aktif ilan bulunamadı.');
    await env.DB.batch([
      env.DB.prepare("UPDATE card_market_listings SET status = 'cancelled', updated_at = ? WHERE id = ? AND seller_id = ? AND status = 'active'").bind(now(env), listingId, user.id),
    ]);
    return json({ ok: true, cancelled: true });
  },

  async communityBuy(req, env, url, auth, params) {
    await ensureCommunityMarketSchema(env);
    const { user } = await useToken(env, req);
    await requireCardMoneySchema(env);
    const b = await readJson(req);
    const idem = str(b.idem, { min: 8, max: 80, name: 'idem' });
    if (!/^[A-Za-z0-9_-]+$/.test(idem)) throw new HttpError(400, 'invalid_idem', 'Geçersiz işlem anahtarı.');
    const listingId = str(params.id, { min: 8, max: 64, name: 'listing_id' });
    const prior = await env.DB.prepare('SELECT * FROM card_market_sales WHERE buyer_id = ? AND idempotency_key = ?').bind(user.id, idem).first();
    if (prior) {
      if (prior.listing_id !== listingId) throw new HttpError(409, 'key_reuse', 'Bu işlem anahtarı başka bir ilan için kullanılmış.');
      return json({ ok: true, replayed: true, sale: prior, balance: await balanceOf(env, user.id) });
    }
    await rateLimit(env, `communitybuy:${user.id}`, 25, 10 * MIN);
    const listing = await env.DB.prepare("SELECT l.*, c.design_json, c.design_version, c.display_name, c.label, c.balance AS card_balance, c.status AS card_status, c.is_default, c.deleted_at, c.user_id AS card_owner, u.username AS seller_username FROM card_market_listings l JOIN cards c ON c.id = l.card_id JOIN users u ON u.id = l.seller_id WHERE l.id = ? AND l.status = 'active'").bind(listingId).first();
    if (!listing || listing.deleted_at != null || listing.card_owner !== listing.seller_id) throw new HttpError(404, 'listing_not_found', 'Bu ilan artık satışta değil.');
    if (listing.seller_id === user.id) throw new HttpError(400, 'own_listing', 'Kendi ilanını satın alamazsın.');
    if (listing.card_status !== 'active' || Number(listing.card_balance) !== 0 || listing.is_default) throw new HttpError(409, 'listing_unavailable', 'İlanın kart koşulları artık uygun değil.');
    const maxCards = (await limitsFor(env, user.id)).max_cards;
    const count = Number((await env.DB.prepare('SELECT COUNT(*) AS c FROM cards WHERE user_id = ? AND deleted_at IS NULL').bind(user.id).first())?.c || 0);
    if (count >= maxCards) throw new HttpError(409, 'card_limit', `Kart alanın dolu. En fazla ${maxCards} kartın olabilir.`);
    const balance = await balanceOf(env, user.id);
    if (balance < listing.price_minor) throw new HttpError(400, 'insufficient', 'Ana cüzdanında bu alışveriş için yeterli FN yok.');
    const fee = Number(listing.commission_minor), proceeds = Number(listing.seller_proceeds_minor), gross = Number(listing.price_minor);
    const ref = newRef('NXCM'), t = now(env), card = await ownCard(env, listing.seller_id, listing.card_id);
    const design = { ...cardShape(card).design, designId: card.id, ownerId: user.id, version: 1 };
    const statements = [
      guardActiveStmt(env, user.id, listing.seller_id),
      env.DB.prepare(`INSERT INTO card_market_guard (ok) SELECT CASE WHEN EXISTS (
        SELECT 1 FROM card_market_listings l JOIN cards c ON c.id = l.card_id
        WHERE l.id = ? AND l.status = 'active' AND l.seller_id = ? AND c.user_id = l.seller_id
          AND c.deleted_at IS NULL AND c.status = 'active' AND c.balance = 0 AND c.is_default = 0
          AND (SELECT balance FROM wallets WHERE user_id = ?) >= ?
          AND (SELECT COUNT(*) FROM cards WHERE user_id = ? AND deleted_at IS NULL) < ?
      ) THEN 1 ELSE 0 END`).bind(listingId, listing.seller_id, user.id, gross, user.id, maxCards),
      env.DB.prepare("UPDATE card_market_listings SET status = 'sold', buyer_id = ?, sold_at = ?, updated_at = ? WHERE id = ? AND status = 'active'").bind(user.id, t, t, listingId),
      env.DB.prepare(`INSERT INTO card_market_sales (id, listing_id, buyer_id, seller_id, card_id, gross_minor, commission_minor, seller_minor, idempotency_key, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(ref, listingId, user.id, listing.seller_id, listing.card_id, gross, fee, proceeds, idem, t),
      ...entryStmts(env, { ref, userId: user.id, type: 'purchase', amount: -gross, counterparty: listing.seller_id, desc: `Nexus Topluluk Pazarı: ${listing.title}` }),
      ...entryStmts(env, { ref, userId: listing.seller_id, type: 'transfer_in', amount: proceeds, counterparty: user.id, desc: `Kart satışı (%30 komisyon): ${listing.title}` }),
      env.DB.prepare('DELETE FROM card_design_history WHERE card_id = ?').bind(listing.card_id),
      env.DB.prepare('UPDATE cards SET user_id = ?, card_token = ?, design_json = ?, design_version = 1, is_default = 0, status = \'active\', updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
        .bind(user.id, `NXC-${randomBase32(4)}-${randomBase32(4)}`, JSON.stringify(design), t, listing.card_id, listing.seller_id),
      env.DB.prepare('INSERT INTO card_design_history (id, card_id, user_id, version, display_name, design_json, created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), listing.card_id, user.id, 1, card.display_name, JSON.stringify(design), t),
      env.DB.prepare('DELETE FROM shop_card_skins WHERE card_id = ?').bind(listing.card_id),
      env.DB.prepare('DELETE FROM card_market_guard'),
      notifyStmt(env, user.id, 'community_card_bought', 'Topluluk kartı satın alındı', `${listing.title} kartı koleksiyonuna eklendi. Satıcı: @${listing.seller_username}.`),
      notifyStmt(env, listing.seller_id, 'community_card_sold', 'Kartın satıldı', `${listing.title} kartın satıldı. %30 komisyon kesildi; ${ (proceeds / 100).toFixed(2) } FN bakiyene aktarıldı.`),
    ];
    try { await env.DB.batch(statements); }
    catch (err) {
      if (isConstraint(err, 'wallet_nonneg')) throw new HttpError(400, 'insufficient', 'Ana cüzdanında bu alışveriş için yeterli FN yok.');
      if (isConstraint(err, 'card_market_sales.buyer_id') || isConstraint(err, 'card_market_sales.listing_id')) {
        const again = await env.DB.prepare('SELECT * FROM card_market_sales WHERE buyer_id = ? AND idempotency_key = ?').bind(user.id, idem).first();
        if (again?.listing_id === listingId) return json({ ok: true, replayed: true, sale: again, balance: await balanceOf(env, user.id) });
      }
      if (isConstraint(err, 'card_market_guard.ok') || String(err.message || err).includes('CHECK constraint failed') || String(err.message || err).includes('malformed JSON'))
        throw new HttpError(409, 'listing_changed', 'İlan bu sırada satılmış veya kart koşulları değişmiş. Listeyi yenile.');
      throw err;
    }
    const sale = await env.DB.prepare('SELECT * FROM card_market_sales WHERE id = ?').bind(ref).first();
    return json({ ok: true, replayed: false, sale, balance: await balanceOf(env, user.id) }, 201);
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
    const cardId = b.card_id ? str(b.card_id, { min: 8, max: 64, name: 'card_id' }) : null;
    if (cardId) await requireCardMoneySchema(env);
    await rateLimit(env, `shopbuy:${user.id}`, 20, 10 * MIN);
    const externalRef = `shop:${user.id}:${idem}`;
    const prior = await env.DB.prepare('SELECT tx_ref FROM external_ops WHERE external_ref = ?').bind(externalRef).first();
    if (prior) return json(await purchaseResult(env, prior.tx_ref, true));

    const p = await env.DB.prepare(`SELECT * FROM shop_products WHERE id = ? AND status = 'on'`).bind(pid).first();
    if (!p) return json({ ok: false, code: 'unavailable' });
    const own = await env.DB.prepare('SELECT qty FROM shop_entitlements WHERE user_id = ? AND product_id = ?').bind(user.id, pid).first();
    if (own && own.qty >= p.max_qty) return json({ ok: false, code: 'already_owned' });
    if (p.stock_total != null && p.stock_sold >= p.stock_total) return json({ ok: false, code: 'sold_out' });

    let card = null;
    if (cardId) {
      card = await ownCard(env, user.id, cardId);
      await ensureCardNotListed(env, card.id);
      if (card.status !== 'active') return json({ ok: false, code: 'card_disabled' });
      if (card.balance < p.price) return json({ ok: false, code: 'insufficient_card', card_balance: card.balance, missing: p.price - card.balance });
    } else {
      const balance = await balanceOf(env, user.id);
      if (balance < p.price) return json({ ok: false, code: 'insufficient', balance, missing: p.price - balance });
    }

    const t = now(env), ref = newRef('NXM');
    const productData = parseData(p.data);
    const isDeliverableCard = !!productData.skin;
    const preparedCard = isDeliverableCard ? await prepareCardCreation(env, user, {
      label: p.name,
      displayName: suggestDisplayName(user.username),
      additionalSlots: Number(productData.perks?.extra_cards || 0),
      orientation: productData.orientation || 'landscape',
    }) : null;
    const serialSql = '(SELECT CASE WHEN stock_total IS NOT NULL THEN stock_sold END FROM shop_products WHERE id = ?)';
    const stmts = [
      guardActiveStmt(env, user.id),
      env.DB.prepare(`INSERT INTO shop_guard (on_sale, stock_ok, qty_ok) VALUES (
        (SELECT CASE WHEN status = 'on' THEN 1 ELSE 0 END FROM shop_products WHERE id = ?),
        (SELECT CASE WHEN stock_total IS NULL OR stock_sold < stock_total THEN 1 ELSE 0 END FROM shop_products WHERE id = ?),
        (SELECT CASE WHEN COALESCE((SELECT qty FROM shop_entitlements WHERE user_id = ? AND product_id = ?), 0) < (SELECT max_qty FROM shop_products WHERE id = ?) THEN 1 ELSE 0 END))`)
        .bind(pid, pid, user.id, pid, pid),
      env.DB.prepare('DELETE FROM shop_guard'),
      env.DB.prepare('UPDATE shop_products SET stock_sold = stock_sold + 1, updated_at = ? WHERE id = ?').bind(t, pid),
      env.DB.prepare('INSERT INTO external_ops (external_ref, kind, user_id, tx_ref, created_at) VALUES (?,?,?,?,?)').bind(externalRef, 'purchase', user.id, ref, t),
    ];
    if (card) {
      const marketCardKey = `market_${idem}`;
      stmts.push(env.DB.prepare(`SELECT json_extract(CASE WHEN EXISTS (
        SELECT 1 FROM cards WHERE id = ? AND user_id = ? AND status = 'active' AND balance >= ?
      ) THEN '{}' ELSE 'x' END, '$')`).bind(card.id, user.id, p.price));
      stmts.push(env.DB.prepare(`UPDATE cards SET balance = balance - ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'active'`).bind(p.price, t, card.id, user.id));
      stmts.push(env.DB.prepare(`INSERT INTO card_ledger
        (id, tx_ref, user_id, card_id, type, amount, balance_after, counterparty_id, idempotency_key, description, created_at)
        VALUES (?, ?, ?, ?, 'payment', ?, (SELECT balance FROM cards WHERE id = ? AND user_id = ?), NULL, ?, ?, ?)`)
        .bind(crypto.randomUUID(), ref, user.id, card.id, -p.price, card.id, user.id, marketCardKey, `Nexus Market: ${p.name}`, t));
    } else {
      stmts.push(...entryStmts(env, { ref, userId: user.id, type: 'purchase', amount: -p.price, desc: `Nexus Market: ${p.name}` }));
    }
    stmts.push(
      env.DB.prepare(`INSERT INTO shop_purchases (id, user_id, product_id, name, kind, price, serial, status, created_at) VALUES (?,?,?,?,?,?,${serialSql},'success',?)`).bind(ref, user.id, p.id, p.name, p.kind, p.price, pid, t),
      env.DB.prepare(`INSERT INTO shop_entitlements (id, user_id, product_id, qty, serial, acquired_at, tx_ref) VALUES (?,?,?,1,${serialSql},?,?)
        ON CONFLICT(user_id, product_id) DO UPDATE SET qty = qty + 1`).bind(`ent_${randomToken(9)}`, user.id, p.id, pid, t, ref),
      env.DB.prepare('DELETE FROM shop_wishlist WHERE user_id = ? AND product_id = ?').bind(user.id, p.id),
      notifyStmt(env, user.id, 'purchase', 'Market alışverişi tamamlandı', `${p.name} koleksiyonuna eklendi. Ref: ${ref}`),
    );
    if (preparedCard) {
      stmts.push(...preparedCard.statements);
      stmts.push(
        env.DB.prepare('INSERT INTO shop_card_skins (card_id, user_id, product_id, equipped_at) VALUES (?,?,?,?)').bind(preparedCard.id, user.id, p.id, t),
        env.DB.prepare('INSERT INTO shop_card_deliveries (purchase_id, user_id, card_id, product_id, created_at) VALUES (?,?,?,?,?)').bind(ref, user.id, preparedCard.id, p.id, t),
      );
    }
    try {
      await env.DB.batch(stmts);
    } catch (err) {
      if (isConstraint(err, 'shop_not_on_sale')) return json({ ok: false, code: 'unavailable' });
      if (isConstraint(err, 'shop_sold_out') || isConstraint(err, 'shop_stock_bounds')) return json({ ok: false, code: 'sold_out' });
      if (isConstraint(err, 'shop_max_owned')) return json({ ok: false, code: 'already_owned' });
      if (isConstraint(err, 'wallet_nonneg')) { const bal = await balanceOf(env, user.id); return json({ ok: false, code: 'insufficient', balance: bal, missing: p.price - bal }); }
      if (isConstraint(err, 'card_balance_nonneg')) { const latest = await ownCard(env, user.id, cardId); return json({ ok: false, code: 'insufficient_card', card_balance: latest.balance, missing: p.price - latest.balance }); }
      if (isConstraint(err, 'external_ops')) {
        const again = await env.DB.prepare('SELECT tx_ref FROM external_ops WHERE external_ref = ?').bind(externalRef).first();
        return json(await purchaseResult(env, again?.tx_ref, true));
      }
      if (isConstraint(err, 'card_ledger.user_id')) {
        const again = await env.DB.prepare('SELECT tx_ref FROM external_ops WHERE external_ref = ?').bind(externalRef).first();
        if (again) return json(await purchaseResult(env, again.tx_ref, true));
      }
      if (String(err.message || err).includes('malformed JSON')) {
        if (cardId) {
          const latest = await ownCard(env, user.id, cardId);
          if (latest.status !== 'active') return json({ ok: false, code: 'card_disabled' });
          if (latest.balance < p.price) return json({ ok: false, code: 'insufficient_card', card_balance: latest.balance, missing: p.price - latest.balance });
        }
        throw new HttpError(409, 'account_state_changed', 'Hesap veya kart durumu değişti; işlem yapılamadı.');
      }
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
