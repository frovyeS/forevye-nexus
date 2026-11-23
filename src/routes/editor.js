// Kart editörü devri.  Nexus (cookie oturumu) → bilet → banka editörü (ayrı site) → jeton → Nexus'a kayıt.
//
//  1) POST /api/editor/ticket     (Nexus oturumu)   tek kullanımlık 5 dk'lık bilet üretir, editör adresini döner. Bilet URL'nin # kısmında taşınır.
//  2) POST /api/editor/exchange   (CORS: editör)    bileti jetona çevirir (2 saat kayan, en çok 12 saat); kart + sistem bilgisini döner.
//  3) GET  /api/editor/card       (Bearer jeton)    sayfa yenilenirse aynı bilgiyi tekrar verir.
//  4) PUT  /api/editor/card       (Bearer jeton)    tasarımı kaydeder: sunucu `card-rules.js` ile doğrular (editörle aynı kod), sürümü ve geçmişi Nexus yazar.
//
// Jeton yalnızca bu uçlarda geçerlidir; para, transfer, profil gibi hiçbir ucu açmaz. Kullanıcı kimliği istemciden alınmaz.
import { HttpError, json, readJson, now, cfgNum, MIN, HOUR, clientIp } from '../lib/util.js';
import { randomToken, sha256hex } from '../lib/crypto.js';
import { rateLimit } from '../lib/rate.js';
import { validateLabel, suggestDisplayName, defaultDesign } from '../../shared/card-contract.js';
import { shape, ownCard, createCard, updateCard } from './cards.js';

const TICKET_TTL = 5 * MIN, TOKEN_SLIDE = 2 * HOUR, TOKEN_MAX = 12 * HOUR;   // editör açık kalıp düşünülürken oturum kopmasın

// 0004_editor.sql canlı D1'e uygulanmadıysa "no such table: editor_tickets" → 500 "Beklenmeyen bir hata oluştu" olurdu.
// Tablolar eksikse (IF NOT EXISTS ile, migration'la birebir aynı şema) burada kendiliğinden kurulur; isolate başına bir kez çalışır.
const SCHEMA_OK = new WeakSet();
async function ensureEditorSchema(env) {
  if (!env.DB || SCHEMA_OK.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS editor_tickets (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), card_id TEXT,
      label TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL, consumed_at INTEGER)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_editor_tickets_exp ON editor_tickets(expires_at)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS editor_tokens (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), card_id TEXT,
      label TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_editor_tokens_exp ON editor_tokens(expires_at)'),
  ]);
  SCHEMA_OK.add(env.DB);
}

export const editorUrl = (env) => String(env.EDITOR_URL || '').trim();
export function editorOrigins(env) {
  const out = [];
  for (const u of [editorUrl(env), ...String(env.EDITOR_ORIGINS || '').split(',')]) {
    try { if (u.trim()) out.push(new URL(u.trim()).origin); } catch { /* geçersiz adres yok sayılır */ }
  }
  return out;
}

async function sessionPayload(env, tok, user) {
  const card = tok.card_id ? shape(await ownCard(env, user.id, tok.card_id)) : null;
  const max = cfgNum(env, 'MAX_CARDS', 5);
  return {
    mode: card ? 'edit' : 'new', card, label: tok.label || '',
    suggested_name: suggestDisplayName(user.username), base_design: card ? null : defaultDesign(suggestDisplayName(user.username)),
    max_cards: max, user: { username: user.username }, expires_at: tok.expires_at,
  };
}

// Bearer jetonu doğrular, süresini kaydırır. Askıdaki hesap da kart tasarlayabilir (eski kart API'siyle aynı davranış).
async function useToken(env, req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,80})$/.exec(req.headers.get('authorization') || '');
  const bad = () => new HttpError(401, 'editor_token', 'Editör oturumu geçersiz veya süresi dolmuş. Nexus’tan yeniden açın.');
  if (!m) throw bad();
  await ensureEditorSchema(env);
  const t = now(env), th = await sha256hex(m[1]);
  const tok = await env.DB.prepare('SELECT * FROM editor_tokens WHERE token_hash = ? AND expires_at > ?').bind(th, t).first();
  if (!tok) throw bad();
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(tok.user_id).first();
  if (!user) throw bad();
  const exp = Math.min(t + TOKEN_SLIDE, tok.created_at + TOKEN_MAX);
  if (exp > tok.expires_at + MIN) { await env.DB.prepare('UPDATE editor_tokens SET expires_at = ? WHERE token_hash = ?').bind(exp, th).run(); tok.expires_at = exp; }
  return { tok, th, user };
}

export const editorRoutes = {
  async ticket(req, env, ctx, { user }) {
    const url = editorUrl(env);
    if (!url) throw new HttpError(503, 'editor_unavailable', 'Kart editörü bu sunucuda ayarlı değil.');
    const b = await readJson(req);
    await ensureEditorSchema(env);
    await rateLimit(env, `edticket:${user.id}`, 30, 10 * MIN);
    let cardId = null;
    if (b.card_id !== undefined && b.card_id !== null) cardId = (await ownCard(env, user.id, String(b.card_id))).id;
    const lb = validateLabel(b.label);
    if (!lb.ok) throw new HttpError(400, 'invalid_label', lb.error);
    const t = now(env), ticket = randomToken(32);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM editor_tickets WHERE expires_at < ?').bind(t - HOUR),
      env.DB.prepare('DELETE FROM editor_tokens WHERE expires_at < ?').bind(t - HOUR),
      env.DB.prepare('INSERT INTO editor_tickets (token_hash, user_id, card_id, label, expires_at) VALUES (?,?,?,?,?)').bind(await sha256hex(ticket), user.id, cardId, cardId ? '' : lb.value, t + TICKET_TTL),
    ]);
    return json({ url: `${url}${url.includes('#') ? '' : '#'}t=${ticket}`, expires_in: TICKET_TTL / 1000 });
  },

  async exchange(req, env) {
    const b = await readJson(req);
    await ensureEditorSchema(env);
    await rateLimit(env, `edex:ip:${clientIp(req)}`, 40, 10 * MIN);
    const bad = () => new HttpError(400, 'invalid_ticket', 'Bilet geçersiz veya süresi dolmuş. Nexus’tan yeniden açın.');
    if (typeof b.ticket !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(b.ticket)) throw bad();
    const t = now(env), th = await sha256hex(b.ticket);
    const row = await env.DB.prepare('UPDATE editor_tickets SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING user_id, card_id, label').bind(t, th, t).first();
    if (!row) throw bad();
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first();
    if (!user) throw bad();
    const token = randomToken(32);
    const tok = { user_id: user.id, card_id: row.card_id, label: row.label, created_at: t, expires_at: t + TOKEN_SLIDE };
    await env.DB.prepare('INSERT INTO editor_tokens (token_hash, user_id, card_id, label, created_at, expires_at) VALUES (?,?,?,?,?,?)').bind(await sha256hex(token), tok.user_id, tok.card_id, tok.label, tok.created_at, tok.expires_at).run();
    return json({ token, ...(await sessionPayload(env, tok, user)) });
  },

  async card(req, env) {
    const { tok, user } = await useToken(env, req);
    return json(await sessionPayload(env, tok, user));
  },

  async save(req, env) {
    const { tok, th, user } = await useToken(env, req);
    const b = await readJson(req, 96 * 1024);
    for (const k of Object.keys(b)) if (!['design', 'label'].includes(k)) throw new HttpError(400, 'protected_field', `“${k}” alanı değiştirilemez.`);
    if (!b.design) throw new HttpError(400, 'invalid_design', 'Tasarım gerekli.');
    await rateLimit(env, `cardedit:${user.id}`, 60, 10 * MIN);
    let card, created = false;
    if (tok.card_id) {
      card = await updateCard(env, user, await ownCard(env, user.id, tok.card_id), { design: b.design, label: b.label });
    } else {
      await rateLimit(env, `cardnew:${user.id}`, 20, 60 * MIN);
      card = await createCard(env, user, { label: b.label ?? tok.label, design: b.design });
      created = true;
      await env.DB.prepare('UPDATE editor_tokens SET card_id = ? WHERE token_hash = ?').bind(card.id, th).run();   // sonraki kayıtlar aynı kartı günceller
    }
    return json({ ok: true, created, card: shape(card), return_path: `/#/cards/${card.id}` }, created ? 201 : 200);
  },
};
