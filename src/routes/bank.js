// FOREVYE NEXUS Banka uygulaması için kısa ömürlü, kapsamı banka API'leriyle sınırlı oturum.
import { HttpError, json, readJson, now, MIN, HOUR } from '../lib/util.js';
import { randomToken, sha256hex } from '../lib/crypto.js';
import { rateLimit } from '../lib/rate.js';
import { createShopTicket } from './shop.js';
import { siteOrigins } from '../lib/origins.js';

const TICKET_TTL = 5 * MIN, TOKEN_SLIDE = 30 * MIN, TOKEN_MAX = 8 * HOUR;
export const bankUrl = (env) => String(env.BANK_URL || '').trim();
// İki GitHub hesabı koda gömülü (src/lib/origins.js); BANK_URL / BANK_ORIGINS ek adres ekler.
export const bankOrigins = (env) => siteOrigins(bankUrl(env), env.BANK_ORIGINS);
async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS bank_tickets (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS bank_tokens (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_bank_tickets_exp ON bank_tickets(expires_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_bank_tokens_exp ON bank_tokens(expires_at)'),
  ]);
}
export async function useBankToken(env, req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,80})$/.exec(req.headers.get('authorization') || '');
  const bad = () => new HttpError(401, 'bank_token', 'Banka oturumu geçersiz veya süresi dolmuş. Nexus hesabından yeniden açın.');
  if (!m) throw bad();
  await ensureSchema(env);
  const t = now(env), th = await sha256hex(m[1]);
  const tok = await env.DB.prepare('SELECT * FROM bank_tokens WHERE token_hash = ? AND expires_at > ?').bind(th, t).first();
  if (!tok) throw bad();
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(tok.user_id).first();
  if (!user) throw bad();
  const exp = Math.min(t + TOKEN_SLIDE, tok.created_at + TOKEN_MAX);
  if (exp > tok.expires_at + MIN) await env.DB.prepare('UPDATE bank_tokens SET expires_at = ? WHERE token_hash = ?').bind(exp, th).run();
  return { user };
}

export async function createBankTicket(env, user) {
  const base = bankUrl(env);
  if (!base) throw new HttpError(503, 'bank_unavailable', 'Banka uygulaması adresi sunucuda ayarlı değil.');
  await ensureSchema(env);
  await rateLimit(env, `bankticket:${user.id}`, 20, 10 * MIN);
  const t = now(env), ticket = randomToken(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bank_tickets WHERE expires_at < ?').bind(t - HOUR),
    env.DB.prepare('DELETE FROM bank_tokens WHERE expires_at < ?').bind(t - HOUR),
    env.DB.prepare('INSERT INTO bank_tickets (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').bind(await sha256hex(ticket), user.id, t, t + TICKET_TTL),
  ]);
  const target = new URL(base); target.hash = 'bank=' + ticket;
  return { url: target.toString(), expires_in: TICKET_TTL / 1000 };
}

export const bankRoutes = {
  async ticket(req, env, ctx, { user }) {
    return json(await createBankTicket(env, user));
  },
  async exchange(req, env) {
    await ensureSchema(env);
    const b = await readJson(req);
    if (typeof b.ticket !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(b.ticket)) throw new HttpError(400, 'invalid_ticket', 'Banka giriş bileti geçersiz.');
    const t = now(env), th = await sha256hex(b.ticket), tok = randomToken(32);
    const row = await env.DB.prepare('UPDATE bank_tickets SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING user_id').bind(t, th, t).first();
    if (!row) throw new HttpError(401, 'ticket_expired', 'Banka giriş bağlantısının süresi doldu. Nexus’tan yeniden açın.');
    await env.DB.prepare('INSERT INTO bank_tokens (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').bind(await sha256hex(tok), row.user_id, t, t + TOKEN_SLIDE).run();
    return json({ token: tok, expires_at: t + TOKEN_SLIDE });
  },
  async marketTicket(req, env, ctx, { user }) {
    const b = await readJson(req).catch(() => ({}));
    return json(await createShopTicket(env, user, b.product_id || null));
  },
};
