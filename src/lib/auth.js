import { HttpError, DAY, cfgNum, now, isSuspended, MIN } from './util.js';
import { randomToken, sha256hex } from './crypto.js';

export const COOKIE = 'nx_session';

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// SameSite=Lax (Strict DEĞİL): "FOREVYE ID ile giriş" dönüşü başka siteden (github.io) gelen bir yönlendirmedir; Strict çerez bu zincirde
// kaydedilmez/gönderilmez ve kullanıcı giriş sayfasına geri düşerdi. Lax, çapraz-site POST/fetch isteklerinde yine gönderilmez (CSRF koruması
// ayrıca src/worker.js'de özel başlık + Origin denetimiyle sürer).
export function cookieHeader(token, maxAgeSec) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
export const clearCookie = () => cookieHeader('', 0);

export async function createSession(env, req, userId) {
  const t = now(env);
  const ttl = cfgNum(env, 'SESSION_TTL_DAYS', 14) * DAY;
  const token = randomToken(32);
  const ua = (req.headers.get('user-agent') || '').slice(0, 200);
  const device = await sha256hex(ua);
  const prev = await env.DB.prepare('SELECT 1 AS x FROM sessions WHERE user_id = ? AND device_hash = ? LIMIT 1').bind(userId, device).first();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, device_hash) VALUES (?,?,?,?,?,?,?)',
  ).bind(await sha256hex(token), userId, t, t + ttl, t, ua, device).run();
  return { token, newDevice: !prev, cookie: cookieHeader(token, Math.floor(ttl / 1000)) };
}

// Oturumu ve kullanıcıyı HER istekte veritabanından okur; rol/durum istemciden alınmaz.
export async function authenticate(env, req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const sid = await sha256hex(token);
  const t = now(env);
  const row = await env.DB.prepare(
    `SELECT s.id AS sid, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
  ).bind(sid, t).first();
  if (!row) return null;
  if (t - row.last_seen_at > 5 * MIN) await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(t, sid).run();
  const { sid: sessionId, last_seen_at, ...user } = row;
  user.suspended = isSuspended(user, t);
  return { user, sessionId };
}

export async function requireAuth(env, req) {
  const a = await authenticate(env, req);
  if (!a) throw new HttpError(401, 'unauthenticated', 'Oturum gerekli.');
  return a;
}

export async function requireAdmin(env, req, { superOnly = false } = {}) {
  const a = await requireAuth(env, req);
  const ok = superOnly ? a.user.role === 'superadmin' : ['admin', 'superadmin'].includes(a.user.role);
  if (!ok || a.user.suspended) throw new HttpError(403, 'forbidden', 'Bu işlem için yetkiniz yok.');
  return a;
}

export async function notify(env, userId, type, title, body = '') {
  const t = now(env);
  await env.DB.prepare('INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), userId, type, title, body, t).run();
}
export function notifyStmt(env, userId, type, title, body = '') {
  return env.DB.prepare('INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), userId, type, title, body, now(env));
}
