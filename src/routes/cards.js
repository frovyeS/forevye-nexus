import { HttpError, json, readJson, now, cfgNum, MIN } from '../lib/util.js';
import { rateLimit } from '../lib/rate.js';
import { notifyStmt } from '../lib/auth.js';
import { randomBase32 } from '../lib/util.js';
import { validateDesign, validateDisplayName, validateLabel, defaultDesign } from '../../shared/card-contract.js';

const shape = (c) => ({
  id: c.id, label: c.label, display_name: c.display_name, card_token: c.card_token, status: c.status,
  is_default: Boolean(c.is_default), version: c.design_version, design: JSON.parse(c.design_json), updated_at: c.updated_at,
});

async function ownCard(env, userId, id) {
  const c = await env.DB.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').bind(id, userId).first();
  if (!c) throw new HttpError(404, 'not_found', 'Kart bulunamadı.'); // başkasının kartı da aynı yanıtı alır
  return c;
}

function checkDesign(d) {
  const v = validateDesign(d);
  if (!v.ok) throw new HttpError(400, 'invalid_design', v.errors[0], { errors: v.errors });
  return v.design;
}

export const cardRoutes = {
  async list(req, env, ctx, { user }) {
    const rows = (await env.DB.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY is_default DESC, created_at ASC').bind(user.id).all()).results;
    return json({ cards: rows.map(shape), max_cards: cfgNum(env, 'MAX_CARDS', 5) });
  },

  async get(req, env, ctx, { user }, params) {
    return json(shape(await ownCard(env, user.id, params.id)));
  },

  async create(req, env, ctx, { user }) {
    const b = await readJson(req);
    await rateLimit(env, `cardnew:${user.id}`, 20, 60 * MIN);
    const max = cfgNum(env, 'MAX_CARDS', 5);
    const count = (await env.DB.prepare('SELECT COUNT(*) AS c FROM cards WHERE user_id = ?').bind(user.id).first()).c;
    if (count >= max) throw new HttpError(400, 'card_limit', `En fazla ${max} sanal kart oluşturabilirsiniz.`);
    const dn = validateDisplayName(b.display_name);
    if (!dn.ok) throw new HttpError(400, 'invalid_display_name', dn.error);
    const lb = validateLabel(b.label);
    if (!lb.ok) throw new HttpError(400, 'invalid_label', lb.error);
    const design = checkDesign(b.design ?? defaultDesign());
    const t = now(env);
    const id = crypto.randomUUID();
    const dj = JSON.stringify(design);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO cards (id, user_id, label, display_name, card_token, status, is_default, design_json, design_version, created_at, updated_at)
        VALUES (?,?,?,?,?,'active',0,?,1,?,?)`).bind(id, user.id, lb.value, dn.value, `NXC-${randomBase32(4)}-${randomBase32(4)}`, dj, t, t),
      env.DB.prepare('INSERT INTO card_design_history (id, card_id, user_id, version, display_name, design_json, created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), id, user.id, 1, dn.value, dj, t),
      notifyStmt(env, user.id, 'card_saved', 'Kart tasarımı kaydedildi', `${dn.value} kartı oluşturuldu.`),
    ]);
    return json(shape(await ownCard(env, user.id, id)), 201);
  },

  // Yalnızca tasarım katmanı + kartta görünen ad + özel ad değiştirilebilir. card_token/durum gibi sistem alanları yok sayılmaz, REDDEDİLİR.
  async update(req, env, ctx, { user }, params) {
    const b = await readJson(req);
    const card = await ownCard(env, user.id, params.id);
    const allowed = new Set(['label', 'display_name', 'design']);
    for (const k of Object.keys(b)) if (!allowed.has(k)) throw new HttpError(400, 'protected_field', `“${k}” alanı değiştirilemez.`);
    await rateLimit(env, `cardedit:${user.id}`, 60, 10 * MIN);
    let { label, display_name: dName, design_json: dj } = card;
    let changedDesign = false;
    if ('label' in b) { const l = validateLabel(b.label); if (!l.ok) throw new HttpError(400, 'invalid_label', l.error); label = l.value; }
    if ('display_name' in b) { const d = validateDisplayName(b.display_name); if (!d.ok) throw new HttpError(400, 'invalid_display_name', d.error); if (d.value !== dName) { dName = d.value; changedDesign = true; } }
    if ('design' in b) { const nd = JSON.stringify(checkDesign(b.design)); if (nd !== dj) { dj = nd; changedDesign = true; } }
    const t = now(env);
    const version = card.design_version + (changedDesign ? 1 : 0);
    const stmts = [env.DB.prepare('UPDATE cards SET label = ?, display_name = ?, design_json = ?, design_version = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(label, dName, dj, version, t, card.id, user.id)];
    if (changedDesign) {
      stmts.push(env.DB.prepare('INSERT INTO card_design_history (id, card_id, user_id, version, display_name, design_json, created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), card.id, user.id, version, dName, dj, t));
      stmts.push(notifyStmt(env, user.id, 'card_saved', 'Kart tasarımı kaydedildi', `${dName} kartının tasarımı güncellendi.`));
    }
    await env.DB.batch(stmts);
    return json(shape(await ownCard(env, user.id, card.id)));
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
    return json({ versions: rows.map((r) => ({ version: r.version, display_name: r.display_name, created_at: r.created_at, design: JSON.parse(r.design_json) })) });
  },

  async revert(req, env, ctx, { user }, params) {
    const b = await readJson(req);
    const card = await ownCard(env, user.id, params.id);
    const h = await env.DB.prepare('SELECT display_name, design_json FROM card_design_history WHERE card_id = ? AND version = ?').bind(card.id, Number(b.version)).first();
    if (!h) throw new HttpError(404, 'not_found', 'Sürüm bulunamadı.');
    const dj = JSON.stringify(checkDesign(JSON.parse(h.design_json))); // eski veri bile mevcut sözleşmeye göre doğrulanır
    const version = card.design_version + 1;
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
    return json({ templates: rows.map((r) => ({ id: r.id, name: r.name, limited_until: r.limited_until, design: JSON.parse(r.design_json) })) });
  },
};
