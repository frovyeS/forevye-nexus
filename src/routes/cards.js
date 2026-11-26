import { HttpError, json, readJson, now, cfgNum, MIN } from '../lib/util.js';
import { rateLimit } from '../lib/rate.js';
import { notifyStmt } from '../lib/auth.js';
import { randomBase32 } from '../lib/util.js';
import { ensureShopSchema, limitsFor, parseData, skinsOf } from '../lib/shop.js';
import { requireCardMoneySchema } from '../lib/card-money-schema.js';
import { entryStmts, guardActiveStmt } from '../lib/ledger.js';
import { shopRevokeStmts } from '../lib/shop.js';
import { validateDesign, validateDisplayName, validateLabel, defaultDesign, defaultPortraitDesign, readStoredDesign, suggestDisplayName } from '../../shared/card-contract.js';

// Veritabanındaki tasarım (eski sürüm 1 dahil) her zaman sürüm 2 olarak sunulur.
export const shape = (c) => ({
  id: c.id, label: c.label, display_name: c.display_name, card_token: c.card_token, status: c.status,
  balance: Number(c.balance || 0), is_default: Boolean(c.is_default), version: c.design_version, design: readStoredDesign(c.design_json, c.display_name, c.design_version), updated_at: c.updated_at,
});

export async function ownCard(env, userId, id) {
  const c = await env.DB.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, userId).first();
  if (!c) throw new HttpError(404, 'not_found', 'Kart bulunamadı.'); // başkasının kartı da aynı yanıtı alır
  return c;
}

// Sunucu doğrulaması: editörle aynı kural dosyası. Kimlik/sürüm alanları istemciden alınmaz, sunucu yazar.
export function checkDesign(d) {
  const v = validateDesign(d);
  if (!v.ok) throw new HttpError(400, 'invalid_design', v.errors[0], { errors: v.errors });
  return v.design;
}
const stamp = (design, { cardId, userId, version }) => ({ ...design, designId: cardId, ownerId: userId, version });
// Aynı tasarım mı? (sürüm numarası ve kimlik alanları karşılaştırmaya girmez)
const canon = (d) => JSON.stringify({ ...d, designId: '', ownerId: '', version: 0 });

// Kart oluşturma SQL'ini tek bir hazırlık fonksiyonunda üretir. Market satın alımı,
// ödeme/entitlement/kart teslimini aynı D1 batch içinde atomik olarak tamamlayabilir.
export async function prepareCardCreation(env, user, { label = '', design, displayName, additionalSlots = 0, orientation = 'landscape' } = {}) {
  await requireCardMoneySchema(env);
  const bonus = Math.max(0, Math.min(10, Math.trunc(Number(additionalSlots) || 0)));
  const max = (await limitsFor(env, user.id)).max_cards + bonus;
  const count = Number((await env.DB.prepare('SELECT COUNT(*) AS c FROM cards WHERE user_id = ? AND deleted_at IS NULL').bind(user.id).first())?.c || 0);
  if (count >= max) throw new HttpError(400, 'card_limit', `En fazla ${max} sanal kart oluşturabilirsiniz. Önce bir kart alanı açın.`);
  const lb = validateLabel(label);
  if (!lb.ok) throw new HttpError(400, 'invalid_label', lb.error);
  const baseDesign = orientation === 'portrait' ? defaultPortraitDesign(displayName || 'NEXUS') : defaultDesign(displayName || 'NEXUS');
  let d = design ? checkDesign(design) : baseDesign;
  if (displayName !== undefined) {
    const dn = validateDisplayName(displayName);
    if (!dn.ok) throw new HttpError(400, 'invalid_display_name', dn.error);
    d = { ...d, userDisplayName: dn.value };
  }
  const t = now(env), id = crypto.randomUUID();
  const final = checkDesign(stamp(d, { cardId: id, userId: user.id, version: 1 }));
  const dj = JSON.stringify(final);
  return {
    id,
    statements: [
      env.DB.prepare(`INSERT INTO cards (id, user_id, label, display_name, card_token, status, is_default, design_json, design_version, created_at, updated_at)
        VALUES (?,?,?,?,?,'active',0,?,1,?,?)`).bind(id, user.id, lb.value, final.userDisplayName, `NXC-${randomBase32(4)}-${randomBase32(4)}`, dj, t, t),
      env.DB.prepare('INSERT INTO card_design_history (id, card_id, user_id, version, display_name, design_json, created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), id, user.id, 1, final.userDisplayName, dj, t),
      notifyStmt(env, user.id, 'card_saved', 'Kart tasarımı kaydedildi', `${final.userDisplayName} kartı oluşturuldu.`),
    ],
  };
}

export async function createCard(env, user, options = {}) {
  const prepared = await prepareCardCreation(env, user, options);
  await env.DB.batch(prepared.statements);
  return ownCard(env, user.id, prepared.id);
}

// Market'teki hem tasarım hem fonksiyon ürünlerini gerçek banka kartına dönüştürür.
// Önceden alınmış tasarım ürünleri de kart listesi açıldığında otomatik teslim edilir.
export async function ensureMarketCardDeliveries(env, user) {
  await ensureShopSchema(env);
  const entitlements = (await env.DB.prepare(`
    SELECT e.product_id, e.tx_ref AS purchase_id, p.name, p.data
    FROM shop_entitlements e
    JOIN shop_products p ON p.id = e.product_id
    JOIN shop_purchases x ON x.id = e.tx_ref AND x.user_id = e.user_id AND x.status = 'success'
    WHERE e.user_id = ?
    ORDER BY e.acquired_at ASC
  `).bind(user.id).all()).results;

  for (const item of entitlements) {
    const productData = parseData(item.data);
    const skin = productData.skin;
    if (!skin) continue; // Ek Kart Hakkı gibi kart yüzeyi olmayan ürünler.
    const exists = await env.DB.prepare('SELECT card_id FROM shop_card_deliveries WHERE purchase_id = ? AND user_id = ?').bind(item.purchase_id, user.id).first();
    if (exists) continue;

    // Kullanıcı yüzeyi daha önce bir kartına elle taktıysa aynı kartı teslim say;
    // ikinci bir fiziksel kart üretme.
    const equipped = await env.DB.prepare('SELECT card_id FROM shop_card_skins WHERE user_id = ? AND product_id = ? LIMIT 1').bind(user.id, item.product_id).first();
    if (equipped) {
      try {
        await env.DB.prepare('INSERT OR IGNORE INTO shop_card_deliveries (purchase_id, user_id, card_id, product_id, created_at) VALUES (?,?,?,?,?)')
          .bind(item.purchase_id, user.id, equipped.card_id, item.product_id, now(env)).run();
      } catch (err) {
        const raced = await env.DB.prepare('SELECT card_id FROM shop_card_deliveries WHERE purchase_id = ?').bind(item.purchase_id).first();
        if (!raced) throw err;
      }
      continue;
    }

    const max = (await limitsFor(env, user.id)).max_cards;
    const count = Number((await env.DB.prepare('SELECT COUNT(*) AS c FROM cards WHERE user_id = ? AND deleted_at IS NULL').bind(user.id).first())?.c || 0);
    if (count >= max) continue; // Limit doluysa alışverişi etkilemeden kullanıcıya alan açma fırsatı bırak.

    const prepared = await prepareCardCreation(env, user, {
      label: item.name,
      displayName: suggestDisplayName(user.username),
      orientation: productData.orientation || 'landscape',
    });
    const t = now(env);
    try {
      await env.DB.batch([
        ...prepared.statements,
        env.DB.prepare('INSERT INTO shop_card_skins (card_id, user_id, product_id, equipped_at) VALUES (?,?,?,?)')
          .bind(prepared.id, user.id, item.product_id, t),
        env.DB.prepare('INSERT INTO shop_card_deliveries (purchase_id, user_id, card_id, product_id, created_at) VALUES (?,?,?,?,?)')
          .bind(item.purchase_id, user.id, prepared.id, item.product_id, t),
      ]);
    } catch (err) {
      // Aynı anda iki banka/Market isteği eski teslimatı onarmaya çalışırsa bir tanesi kazanır.
      const raced = await env.DB.prepare('SELECT card_id FROM shop_card_deliveries WHERE purchase_id = ?').bind(item.purchase_id).first();
      if (!raced) throw err;
    }
  }
}

// Yalnızca tasarım + kartta görünen ad + özel ad değişir. Kart adı her zaman tasarımın `userDisplayName` alanıyla aynıdır.
export async function updateCard(env, user, card, { label, display_name, design }) {
  await ensureCardNotListed(env, card.id);
  let dName = card.display_name, lb = card.label, changedDesign = false;
  let current = readStoredDesign(card.design_json, card.display_name, card.design_version);
  if (label !== undefined) { const l = validateLabel(label); if (!l.ok) throw new HttpError(400, 'invalid_label', l.error); lb = l.value; }
  let next = current;
  if (design !== undefined) next = checkDesign(design);
  if (display_name !== undefined) { const d = validateDisplayName(display_name); if (!d.ok) throw new HttpError(400, 'invalid_display_name', d.error); next = { ...next, userDisplayName: d.value }; }
  if (design !== undefined || display_name !== undefined) {
    if (next.userDisplayName !== dName) { dName = next.userDisplayName; changedDesign = true; }
    if (canon(next) !== canon(current) || changedDesign) changedDesign = true;
  }
  const t = now(env);
  const version = card.design_version + (changedDesign ? 1 : 0);
  const final = checkDesign(stamp({ ...next, userDisplayName: dName }, { cardId: card.id, userId: user.id, version }));
  const dj = changedDesign ? JSON.stringify(final) : card.design_json;
  const stmts = [env.DB.prepare('UPDATE cards SET label = ?, display_name = ?, design_json = ?, design_version = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(lb, dName, dj, version, t, card.id, user.id)];
  if (changedDesign) {
    stmts.push(env.DB.prepare('INSERT INTO card_design_history (id, card_id, user_id, version, display_name, design_json, created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), card.id, user.id, version, dName, dj, t));
    stmts.push(notifyStmt(env, user.id, 'card_saved', 'Kart tasarımı kaydedildi', `${dName} kartının tasarımı güncellendi.`));
  }
  await env.DB.batch(stmts);
  return ownCard(env, user.id, card.id);
}

// İlan süresince tasarım, durum ve ödeme gibi kart mutasyonlarını durdurur.
export async function ensureCardNotListed(env, cardId) {
  const row = await env.DB.prepare("SELECT 1 AS x FROM card_market_listings WHERE card_id = ? AND status = 'active' LIMIT 1").bind(cardId).first();
  if (row) throw new HttpError(409, 'card_listed', 'Bu kart Market’te satışta. Önce ilanı geri çek.');
}

export const cardRoutes = {
  async list(req, env, ctx, { user }) {
    await requireCardMoneySchema(env);
    await ensureMarketCardDeliveries(env, user);
    const rows = (await env.DB.prepare('SELECT * FROM cards WHERE user_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, created_at ASC').bind(user.id).all()).results;
    const skins = await skinsOf(env, user.id);
    const cards = await Promise.all(rows.map(async (c) => {
      const delivery = await env.DB.prepare(`SELECT d.purchase_id, p.price, p.status AS purchase_status
        FROM shop_card_deliveries d JOIN shop_purchases p ON p.id = d.purchase_id
        WHERE d.card_id = ? AND d.user_id = ? AND p.status = 'success' LIMIT 1`).bind(c.id, user.id).first();
      const listing = await env.DB.prepare("SELECT id, title, price_minor, status FROM card_market_listings WHERE card_id = ? AND status = 'active'").bind(c.id).first();
      return { ...shape(c), skin: skins[c.id] || null, market_listing: listing || null,
        market_return: delivery ? { purchase_id: delivery.purchase_id, refund_minor: Number(delivery.price || 0) } : null,
        can_delete: Number(c.balance || 0) === 0 && !listing && !delivery };
    }));
    return json({ cards, max_cards: (await limitsFor(env, user.id)).max_cards });
  },

  async get(req, env, ctx, { user }, params) {
    await requireCardMoneySchema(env);
    const c = await ownCard(env, user.id, params.id);
    const [skinMap, delivery, listing] = await Promise.all([
      skinsOf(env, user.id),
      env.DB.prepare(`SELECT d.purchase_id, p.price FROM shop_card_deliveries d JOIN shop_purchases p ON p.id = d.purchase_id
        WHERE d.card_id = ? AND d.user_id = ? AND p.status = 'success' LIMIT 1`).bind(c.id, user.id).first(),
      env.DB.prepare("SELECT id, title, price_minor, status FROM card_market_listings WHERE card_id = ? AND status = 'active'").bind(c.id).first(),
    ]);
    return json({ ...shape(c), skin: skinMap[c.id] || null,
      market_listing: listing || null,
      market_return: delivery ? { purchase_id: delivery.purchase_id, refund_minor: Number(delivery.price || 0) } : null,
      can_delete: Number(c.balance || 0) === 0 && !listing && !delivery });
  },

  async resolve(req, env, url, { user }) {
    const token = (url.searchParams.get('token') || '').trim().toUpperCase();
    if (!/^NXC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(token)) throw new HttpError(400, 'invalid_card_code', 'QR kodundaki kart kodu geçersiz.');
    await rateLimit(env, `cardscan:${user.id}`, 30, 10 * MIN);
    const card = await env.DB.prepare(
      `SELECT c.card_token, c.display_name, c.label, c.status, u.username
       FROM cards c JOIN users u ON u.id = c.user_id
       WHERE c.card_token = ? AND c.status = 'active'`,
    ).bind(token).first();
    if (!card) throw new HttpError(404, 'card_not_found', 'Aktif sanal kart bulunamadı.');
    return json({ card_token: card.card_token, display_name: card.display_name, label: card.label, username: card.username, status: card.status });
  },

  async create(req, env, ctx, { user }) {
    await requireCardMoneySchema(env);
    const b = await readJson(req, 96 * 1024);
    await rateLimit(env, `cardnew:${user.id}`, 20, 60 * MIN);
    const card = await createCard(env, user, { label: b.label, design: b.design, displayName: b.display_name });
    return json(shape(card), 201);
  },

  // card_token/durum gibi sistem alanları yok sayılmaz, REDDEDİLİR.
  async update(req, env, ctx, { user }, params) {
    await requireCardMoneySchema(env);
    const b = await readJson(req, 96 * 1024);
    const card = await ownCard(env, user.id, params.id);
    await ensureCardNotListed(env, card.id);
    const allowed = new Set(['label', 'display_name', 'design']);
    for (const k of Object.keys(b)) if (!allowed.has(k)) throw new HttpError(400, 'protected_field', `“${k}” alanı değiştirilemez.`);
    await rateLimit(env, `cardedit:${user.id}`, 60, 10 * MIN);
    const upd = await updateCard(env, user, card, { label: b.label, display_name: b.display_name, design: b.design });
    return json(shape(upd));
  },

  async setDefault(req, env, ctx, { user }, params) {
    const card = await ownCard(env, user.id, params.id);
    await ensureCardNotListed(env, card.id);
    if (card.status !== 'active') throw new HttpError(400, 'card_disabled', 'Devre dışı kart varsayılan yapılamaz.');
    await env.DB.batch([
      env.DB.prepare('UPDATE cards SET is_default = 0 WHERE user_id = ?').bind(user.id),
      env.DB.prepare('UPDATE cards SET is_default = 1 WHERE id = ? AND user_id = ?').bind(card.id, user.id),
    ]);
    return json({ ok: true });
  },

  async setStatus(req, env, ctx, { user }, params) {
    const b = await readJson(req);
    if (!['active', 'disabled'].includes(b.status)) throw new HttpError(400, 'invalid', 'Geçersiz durum.');
    const card = await ownCard(env, user.id, params.id);
    await ensureCardNotListed(env, card.id);
    const stmts = [env.DB.prepare('UPDATE cards SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(b.status, now(env), card.id, user.id)];
    if (b.status === 'disabled' && card.is_default) {
      // Varsayılan kart devre dışı kalırsa varsayılan bayrağı başka bir aktif karta devredilir (varsa).
      stmts.push(env.DB.prepare('UPDATE cards SET is_default = 0 WHERE id = ?').bind(card.id));
      stmts.push(env.DB.prepare(`UPDATE cards SET is_default = 1 WHERE id = (SELECT id FROM cards WHERE user_id = ? AND deleted_at IS NULL AND status = 'active' AND id != ? ORDER BY created_at LIMIT 1)`).bind(user.id, card.id));
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
  },

  async delete(req, env, ctx, { user }, params) {
    await requireCardMoneySchema(env);
    const card = await ownCard(env, user.id, params.id);
    await ensureCardNotListed(env, card.id);
    if (Number(card.balance || 0) !== 0) throw new HttpError(409, 'card_has_balance', 'Kartı silmeden önce bakiyesini sıfırla.');
    const delivered = await env.DB.prepare(`SELECT d.purchase_id FROM shop_card_deliveries d JOIN shop_purchases p ON p.id = d.purchase_id
      WHERE d.card_id = ? AND d.user_id = ? AND p.status = 'success' LIMIT 1`).bind(card.id, user.id).first();
    if (delivered) throw new HttpError(409, 'market_return_required', 'Bu kart Market’ten satın alınmış. Silmeden önce Market iadesini kullan.');
    const t = now(env);
    const stmts = [
      env.DB.prepare('UPDATE cards SET deleted_at = ?, is_default = 0, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(t, t, card.id, user.id),
      env.DB.prepare('DELETE FROM shop_card_skins WHERE card_id = ? AND user_id = ?').bind(card.id, user.id),
    ];
    if (card.is_default) stmts.push(env.DB.prepare(`UPDATE cards SET is_default = 1 WHERE id = (
      SELECT id FROM cards WHERE user_id = ? AND deleted_at IS NULL AND status = 'active' AND id != ? ORDER BY created_at LIMIT 1
    )`).bind(user.id, card.id));
    stmts.push(notifyStmt(env, user.id, 'card_deleted', 'Kart silindi', `${card.display_name} kartı arşive alındı.`));
    await env.DB.batch(stmts);
    return json({ ok: true, deleted: true });
  },

  // Yalnızca Nexus Market'ten alınmış ve bakiyesi boş kartlarda anlık FN iadesi.
  async marketReturn(req, env, ctx, { user }, params) {
    await requireCardMoneySchema(env);
    await ensureShopSchema(env);
    const card = await ownCard(env, user.id, params.id);
    if (Number(card.balance || 0) !== 0) throw new HttpError(409, 'card_has_balance', 'İade için kart bakiyesini sıfırla.');
    await ensureCardNotListed(env, card.id);
    const delivery = await env.DB.prepare(`SELECT d.purchase_id, p.price, p.name, p.status
      FROM shop_card_deliveries d JOIN shop_purchases p ON p.id = d.purchase_id
      WHERE d.card_id = ? AND d.user_id = ? AND p.status = 'success' LIMIT 1`).bind(card.id, user.id).first();
    if (!delivery) throw new HttpError(404, 'not_market_card', 'Bu kart iade edilebilir bir Market satın alımı değil.');

    const purchaseRef = delivery.purchase_id;
    const payment = await env.DB.prepare(`SELECT card_id FROM card_ledger WHERE tx_ref = ? AND user_id = ? AND type = 'payment' AND amount < 0`).bind(purchaseRef, user.id).first();
    const originalPayCard = payment && await env.DB.prepare('SELECT id FROM cards WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(payment.card_id, user.id).first();
    const refundToCard = originalPayCard && payment.card_id !== card.id;
    const t = now(env), ref = `NXR-${randomBase32(12)}`;
    const stmts = [
      guardActiveStmt(env, user.id),
      env.DB.prepare(`SELECT json_extract(CASE WHEN EXISTS (
        SELECT 1 FROM shop_purchases p JOIN shop_card_deliveries d ON d.purchase_id = p.id
        JOIN cards c ON c.id = d.card_id
        WHERE p.id = ? AND p.user_id = ? AND p.status = 'success' AND d.card_id = ? AND d.user_id = ?
          AND c.user_id = ? AND c.deleted_at IS NULL AND c.balance = 0
      ) THEN '{}' ELSE 'x' END, '$')`).bind(purchaseRef, user.id, card.id, user.id, user.id),
    ];
    if (refundToCard) {
      stmts.push(
        env.DB.prepare('UPDATE cards SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(delivery.price, t, payment.card_id, user.id),
        env.DB.prepare(`INSERT INTO card_ledger
          (id, tx_ref, user_id, card_id, type, amount, balance_after, counterparty_id, idempotency_key, description, created_at)
          VALUES (?, ?, ?, ?, 'fund_in', ?, (SELECT balance FROM cards WHERE id = ? AND user_id = ?), NULL, ?, ?, ?)`).bind(
            crypto.randomUUID(), ref, user.id, payment.card_id, delivery.price, payment.card_id, user.id,
            `community_return_${purchaseRef}`, `Nexus Market kart iadesi: ${delivery.name}`, t),
      );
    } else {
      stmts.push(...entryStmts(env, { ref, userId: user.id, type: 'refund', amount: delivery.price, desc: `Nexus Market kart iadesi: ${delivery.name}` }));
    }
    stmts.push(
      ...await shopRevokeStmts(env, purchaseRef),
      env.DB.prepare('UPDATE cards SET deleted_at = ?, is_default = 0, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(t, t, card.id, user.id),
      env.DB.prepare('DELETE FROM shop_card_skins WHERE card_id = ? AND user_id = ?').bind(card.id, user.id),
      notifyStmt(env, user.id, 'market_card_return', 'Market kart iadesi tamamlandı', `${delivery.name} kartı iade edildi. ${refundToCard ? 'Tutar ödeme yaptığın karta aktarıldı.' : 'Tutar ana cüzdanına aktarıldı.'}`),
    );
    if (card.is_default) stmts.push(env.DB.prepare(`UPDATE cards SET is_default = 1 WHERE id = (
      SELECT id FROM cards WHERE user_id = ? AND deleted_at IS NULL AND status = 'active' AND id != ? ORDER BY created_at LIMIT 1
    )`).bind(user.id, card.id));
    try { await env.DB.batch(stmts); }
    catch (err) {
      if (String(err.message || err).includes('malformed JSON') || String(err.message || err).includes('card_ledger.user_id'))
        throw new HttpError(409, 'not_refundable', 'Bu kart zaten iade edilmiş veya iade koşulları değişti.');
      throw err;
    }
    return json({ ok: true, ref, refund_minor: delivery.price, refunded_to: refundToCard ? 'card' : 'wallet', balance: await env.DB.prepare('SELECT balance FROM wallets WHERE user_id = ?').bind(user.id).first().then(x => Number(x?.balance || 0)) }, 201);
  },

  async history(req, env, ctx, { user }, params) {
    const card = await ownCard(env, user.id, params.id);
    const rows = (await env.DB.prepare('SELECT version, display_name, design_json, created_at FROM card_design_history WHERE card_id = ? ORDER BY version DESC LIMIT 30').bind(card.id).all()).results;
    return json({ versions: rows.map((r) => ({ version: r.version, display_name: r.display_name, created_at: r.created_at, design: readStoredDesign(r.design_json, r.display_name, r.version) })) });
  },

  async revert(req, env, ctx, { user }, params) {
    await requireCardMoneySchema(env);
    const b = await readJson(req);
    const card = await ownCard(env, user.id, params.id);
    await ensureCardNotListed(env, card.id);
    const h = await env.DB.prepare('SELECT display_name, design_json FROM card_design_history WHERE card_id = ? AND version = ?').bind(card.id, Number(b.version)).first();
    if (!h) throw new HttpError(404, 'not_found', 'Sürüm bulunamadı.');
    const old = readStoredDesign(h.design_json, h.display_name);   // eski kayıt (sürüm 1 dahil) güncel biçime çevrilir ve yeniden kurulur
    const version = card.design_version + 1;
    const dj = JSON.stringify({ ...old, designId: card.id, ownerId: user.id, version });
    const t = now(env);
    await env.DB.batch([
      env.DB.prepare('UPDATE cards SET display_name = ?, design_json = ?, design_version = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(h.display_name, dj, version, t, card.id, user.id),
      env.DB.prepare('INSERT INTO card_design_history (id, card_id, user_id, version, display_name, design_json, created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), card.id, user.id, version, h.display_name, dj, t),
      notifyStmt(env, user.id, 'card_saved', 'Kart tasarımı kaydedildi', 'Önceki tasarıma geri dönüldü.'),
    ]);
    return json(shape(await ownCard(env, user.id, card.id)));
  },

  async templates(req, env) {
    const rows = (await env.DB.prepare('SELECT id, name, design_json, limited_until FROM card_templates WHERE active = 1 AND (limited_until IS NULL OR limited_until > ?) ORDER BY created_at DESC').bind(now(env)).all()).results;
    return json({ templates: rows.map((r) => ({ id: r.id, name: r.name, limited_until: r.limited_until, design: readStoredDesign(r.design_json, 'NEXUS') })) });
  },
};
