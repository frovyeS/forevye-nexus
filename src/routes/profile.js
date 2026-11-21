import { HttpError, json, readJson, now, DAY, HOUR, cfgNum } from '../lib/util.js';
import { verifyPassword, hashPassword } from '../lib/crypto.js';
import { rateLimit } from '../lib/rate.js';
import { validateUsername, validatePassword } from '../lib/validate.js';
import { notifyStmt } from '../lib/auth.js';
import { isConstraint } from '../lib/util.js';

const WINDOW = 48 * HOUR;
const COOLDOWN = 15 * DAY;

// Yönetim kuralı: Bir kullanıcı adı bırakıldıktan sonra OLD_NAME_RESERVE_DAYS (varsayılan 30) gün
// boyunca yalnızca önceki sahibi için ayrılmış kalır; sonra herkese açılır.
export async function usernameTaken(env, name, exceptUserId) {
  const lower = name.toLowerCase();
  const cur = await env.DB.prepare('SELECT id FROM users WHERE username_lower = ?').bind(lower).first();
  if (cur && cur.id !== exceptUserId) return true;
  const reserve = cfgNum(env, 'OLD_NAME_RESERVE_DAYS', 30) * DAY;
  const old = await env.DB.prepare(
    'SELECT 1 AS x FROM username_history WHERE lower(old_name) = ? AND changed_at > ? AND (? IS NULL OR user_id != ?) LIMIT 1',
  ).bind(lower, now(env) - reserve, exceptUserId, exceptUserId).first();
  return Boolean(old);
}

export async function usernameChangeStatus(env, user) {
  const t = now(env);
  const windowEnd = user.created_at + WINDOW;
  const cnt = (await env.DB.prepare('SELECT COUNT(*) AS c FROM username_history WHERE user_id = ? AND changed_at <= ?').bind(user.id, windowEnd).first()).c;
  const last = user.last_username_change_at;
  if (t < windowEnd) {
    if (cnt < 2) return { allowed: true, phase: 'initial', initial_left: 2 - cnt, window_ends_at: windowEnd, next_change_at: null };
    return { allowed: false, phase: 'initial', initial_left: 0, window_ends_at: windowEnd, next_change_at: last + COOLDOWN };
  }
  if (last && t < last + COOLDOWN) return { allowed: false, phase: 'cooldown', initial_left: 0, window_ends_at: windowEnd, next_change_at: last + COOLDOWN };
  return { allowed: true, phase: 'cooldown', initial_left: 0, window_ends_at: windowEnd, next_change_at: null };
}

function sniffImage(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  return null;
}

export const profileRoutes = {
  async get(req, env, ctx, { user }) {
    const status = await usernameChangeStatus(env, user);
    const hist = (await env.DB.prepare('SELECT old_name, new_name, changed_at FROM username_history WHERE user_id = ? ORDER BY changed_at DESC LIMIT 50').bind(user.id).all()).results;
    return json({
      id: user.id, username: user.username, email: user.email, email_verified: Boolean(user.email_verified_at),
      created_at: user.created_at, has_avatar: Boolean(user.avatar_key), status: user.suspended ? 'suspended' : 'active',
      username_change: status, username_history: hist,
    });
  },

  async changeUsername(req, env, ctx, { user }) {
    const b = await readJson(req);
    await rateLimit(env, `unchg:${user.id}`, 10, HOUR);
    if (user.suspended) throw new HttpError(403, 'account_suspended', 'Hesabınız askıda.');
    const name = validateUsername(b.username);
    if (name.toLowerCase() === user.username.toLowerCase()) throw new HttpError(400, 'same_username', 'Yeni ad mevcut adınızla aynı.');
    const st = await usernameChangeStatus(env, user);
    if (!st.allowed) {
      throw new HttpError(429, 'username_cooldown', st.phase === 'initial'
        ? 'İlk 48 saatteki 2 değiştirme hakkınızı kullandınız.' : 'Kullanıcı adını yeniden değiştirmek için beklemeniz gerekiyor.', { next_change_at: st.next_change_at });
    }
    if (await usernameTaken(env, name, user.id)) throw new HttpError(409, 'username_taken', 'Bu kullanıcı adı kullanılamıyor.');
    const t = now(env);
    try {
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET username = ?, username_lower = ?, last_username_change_at = ? WHERE id = ?').bind(name, name.toLowerCase(), t, user.id),
        env.DB.prepare('INSERT INTO username_history (id, user_id, old_name, new_name, changed_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), user.id, user.username, name, t),
        notifyStmt(env, user.id, 'username_changed', 'Kullanıcı adı değişti', `Yeni kullanıcı adınız: ${name}`),
      ]);
    } catch (err) {
      if (isConstraint(err, 'users.username_lower')) throw new HttpError(409, 'username_taken', 'Bu kullanıcı adı kullanılamıyor.');
      throw err;
    }
    return json({ ok: true, username: name });
  },

  async changePassword(req, env, ctx, { user, sessionId }) {
    const b = await readJson(req);
    await rateLimit(env, `pwchg:${user.id}`, 6, 15 * 60 * 1000);
    if (typeof b.current_password !== 'string' || !(await verifyPassword(b.current_password, user.password_hash)))
      throw new HttpError(403, 'bad_password', 'Mevcut şifre hatalı.');
    const pw = await hashPassword(validatePassword(b.new_password, { email: user.email, username: user.username }));
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(pw, user.id),
      env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL').bind(now(env), user.id, sessionId),
      notifyStmt(env, user.id, 'password_changed', 'Şifre değiştirildi', 'Şifreniz değiştirildi; diğer oturumlar kapatıldı.'),
    ]);
    return json({ ok: true });
  },

  async sessions(req, env, ctx, { user, sessionId }) {
    const rows = (await env.DB.prepare(
      'SELECT id, created_at, last_seen_at, user_agent FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC',
    ).bind(user.id, now(env)).all()).results;
    return json({ sessions: rows.map((r) => ({ id: r.id.slice(0, 12), current: r.id === sessionId, created_at: r.created_at, last_seen_at: r.last_seen_at, device: (r.user_agent || 'Bilinmeyen cihaz').slice(0, 80) })) });
  },

  async revokeOthers(req, env, ctx, { user, sessionId }) {
    const r = await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL').bind(now(env), user.id, sessionId).run();
    return json({ ok: true, revoked: r.meta?.changes ?? 0 });
  },

  async putAvatar(req, env, ctx, { user }) {
    if (!env.AVATARS) throw new HttpError(503, 'storage_unavailable', 'Görsel depolama yapılandırılmamış.');
    await rateLimit(env, `avatar:${user.id}`, 10, HOUR);
    const buf = await req.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > 512 * 1024) throw new HttpError(413, 'too_large', 'Görsel 512 KB’tan küçük olmalı.');
    const type = sniffImage(new Uint8Array(buf.slice(0, 12)));
    if (!type) throw new HttpError(415, 'bad_type', 'Yalnızca PNG, JPEG veya WebP yüklenebilir.');
    const key = `avatars/${user.id}`;
    await env.AVATARS.put(key, buf, { httpMetadata: { contentType: type } });
    await env.DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(key, user.id).run();
    return json({ ok: true });
  },

  async getAvatar(req, env, ctx, { user }) {
    if (!env.AVATARS || !user.avatar_key) throw new HttpError(404, 'not_found', 'Görsel yok.');
    const obj = await env.AVATARS.get(user.avatar_key);
    if (!obj) throw new HttpError(404, 'not_found', 'Görsel yok.');
    return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' } });
  },

  async deleteAvatar(req, env, ctx, { user }) {
    if (env.AVATARS && user.avatar_key) await env.AVATARS.delete(user.avatar_key);
    await env.DB.prepare('UPDATE users SET avatar_key = NULL WHERE id = ?').bind(user.id).run();
    return json({ ok: true });
  },
};
