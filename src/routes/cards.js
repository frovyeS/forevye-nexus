import { HttpError, json, readJson, now, cfgNum, MIN } from '../lib/util.js';
import { rateLimit } from '../lib/rate.js';
import { notifyStmt } from '../lib/auth.js';
import { randomBase32 } from '../lib/util.js';
import { limitsFor, skinsOf } from '../lib/shop.js';
import { requireCardMoneySchema } from '../lib/card-money-schema.js';
import { validateDesign, validateDisplayName, validateLabel, defaultDesign, readStoredDesign } from '../../shared/card-contract.js';

// Veritabanındaki tasarım (eski sürüm 1 dahil) her zaman sürüm 2 olarak sunulur.
export const shape = (c) => ({
  id: c.id, label: c.label, display_name: c.display_name, card_token: c.card_token, status: c.status,
  balance: Number(c.balance || 0), is_default: Boolean(c.is_default), version: c.design_version, design: readStoredDesign(c.design_json, c.display_name, c.design_version), updated_at: c.updated_at,
});

export async function ownCard(env, userId, id) {
  const c = await env.DB.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').bind(id, userId).first();
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

export async function createCard(env, user, { label = '', design, displayName }) {
  const max = (await limitsFor(env, user.id)).max_cards;
  const count = (await env.DB.prepare('SELECT COUNT(*) AS c FROM cards WHERE user_id = ?').bind(user.id).first()).c;
  if (count >= max) throw new HttpError(400, 'card_limit', `En fazla ${max} sanal kart oluşturabilirsiniz.`);
  const lb = validateLabel(label);
  if (!lb.ok) throw new HttpError(400, 'invalid_label', lb.error);
  let d = design ? checkDesign(design) : defaultDesign(displayName || 'NEXUS');
  if (displayName !== undefined) {
    const dn = validateDisplayName(displayName);
    if (!dn.ok) throw new HttpError(400, 'invalid_display_name', dn.error);
    d = { ...d, userDisplayName: dn.value };
  }
  const t = now(env);
  const id = crypto.randomUUID();
  const final = checkDesign(stamp(d, { cardId: id, userId: user.id, version: 1 }));
  const dj = JSON.stringify(final);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO cards (id, user_id, label, display_name, card_token, status, is_default, design_json, design_version, created_at, updated_at)
      VALUES (?,?,?,?,?,'active',0,?,1,?,?)`).bind(id, user.id, lb.value, final.userDisplayName, `NXC-${randomBase32(4)}-${randomBase32(4)}`, dj, t, t),
    env.DB.prepare('INSERT INTO card_design_history (id, card_id, user_id, version, display_name, design_json, created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), id, user.id, 1, final.userDisplayName, dj, t),
    notifyStmt(env, user.id, 'card_saved', 'Kart tasarımı kaydedildi', `${final.userDisplayName} kartı oluşturuldu.`),
  ]);
  return ownCard(env, user.id, id);
}

// Yalnızca tasarım + kartta görünen ad + özel ad değişir. Kart adı her zaman tasarımın `userDisplayName` alanıyla aynıdır.
export async function updateCard(env, user, card, { label, display_name, design }) {
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

export const cardRoutes = {
  async list(req, env, ctx, { user }) {
    await requireCardMoneySchema(env);
    const rows = (await env.DB.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY is_default DESC, created_at ASC').bind(user.id).all()).results;
    const skins = await skinsOf(env, user.id);
    return json({ cards: rows.map((c) => ({ ...shape(c), skin: skins[c.id] || null })), max_cards: (await limitsFor(env, user.id)).max_cards });
  },

  async get(req, env, ctx, { user }, params) {
    await requireCardMoneySchema(env);
    const c = await ownCard(env, user.id, params.id);
    return json({ ...shape(c), skin: (await skinsOf(env, user.id))[c.id] || null });
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
    const allowed = new Set(['label', 'display_name', 'design']);
    for (const k of Object.keys(b)) if (!allowed.has(k)) throw new HttpError(400, 'protected_field', `“${k}” alanı değiştirilemez.`);
    await rateLimit(env, `cardedit:${user.id}`, 60, 10 * MIN);
    const upd = await updateCard(env, user, card, { label: b.label, display_name: b.display_name, design: b.design });
    return json(shape(upd));
  },

  async setDefault(req, env, ctx, { user }, params) {
    const card = await ownCard(env, user.id, params.id);
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
    const stmts = [env.DB.prepare('UPDATE cards SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(b.status, now(env), card.id, user.id)];
    if (b.status === 'disabled' && card.is_default) {
      // Varsayılan kart devre dışı kalırsa varsayılan bayrağı başka bir aktif karta devredilir (varsa).
      stmts.push(env.DB.prepare('UPDATE cards SET is_default = 0 WHERE id = ?').bind(card.id));
      stmts.push(env.DB.prepare(`UPDATE cards SET is_default = 1 WHERE id = (SELECT id FROM cards WHERE user_id = ? AND status = 'active' AND id != ? ORDER BY created_at LIMIT 1)`).bind(user.id, card.id));
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
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
