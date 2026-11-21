import { HttpError, json, readJson, now, MIN, HOUR, clientIp, isConstraint } from '../lib/util.js';
import { hashPassword, verifyPassword, dummyVerify, sha256hex, randomToken, randomCode6, safeEqual, b64url } from '../lib/crypto.js';
import { rateLimit } from '../lib/rate.js';
import { sendMail } from '../lib/mail.js';
import { normEmail, validateUsername, validatePassword } from '../lib/validate.js';
import { createSession, clearCookie, notify, notifyStmt } from '../lib/auth.js';
import { validateDisplayName, defaultDesign } from '../../shared/card-contract.js';
import { newRef, randomBase32 } from '../lib/util.js';
import { usernameTaken } from './profile.js';
import { meSummary } from './misc.js';

// LEGACY_LOGIN=off → e-posta kodu/şifre ile kayıt ve giriş kapanır; yalnızca FOREVYE ID ile giriş kalır.
function legacyGuard(env) {
  if (env.LEGACY_LOGIN === 'off') throw new HttpError(410, 'legacy_login_off', 'E-posta ile giriş kapatıldı. FOREVYE ID ile giriş yapın.');
}
const idConfigured = (env) => Boolean(env.ID_URL && env.ID_API_URL);
const idCallbackUrl = (url) => `${url.origin}/api/auth/id/callback`;
const ID_APP = 'sanal-banka';

// 0003_forevye_id.sql canlı D1'e uygulanmadıysa "no such table: id_states" → 500 "Beklenmeyen bir hata oluştu" olurdu.
// Tablolar eksikse (IF NOT EXISTS, migration'la birebir aynı şema) burada kendiliğinden kurulur; isolate başına bir kez çalışır.
const ID_SCHEMA_OK = new WeakSet();
async function ensureIdSchema(env) {
  if (!env.DB || ID_SCHEMA_OK.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS id_links (user_id TEXT PRIMARY KEY REFERENCES users(id), id_user_id TEXT NOT NULL UNIQUE, linked_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS id_states (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS id_pending (token_hash TEXT PRIMARY KEY, id_user_id TEXT NOT NULL, email TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER)'),
  ]);
  ID_SCHEMA_OK.add(env.DB);
}

const CODE_TTL = 10 * MIN;
const MAX_ATTEMPTS = 5;

async function issueCode(env, email, purpose) {
  const code = randomCode6();
  const t = now(env);
  const hash = await sha256hex(`${env.CODE_PEPPER || ''}:${email}:${purpose}:${code}`);
  await env.DB.batch([
    env.DB.prepare('UPDATE email_codes SET consumed_at = ? WHERE email = ? AND purpose = ? AND consumed_at IS NULL').bind(t, email, purpose),
    env.DB.prepare('INSERT INTO email_codes (id, email, purpose, code_hash, expires_at, created_at) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), email, purpose, hash, t + CODE_TTL, t),
  ]);
  return code;
}

// Kod doğrular; deneme sayısı atomik artırılır, aşılınca kod yanar.
async function checkCode(env, email, purpose, code) {
  const t = now(env);
  const bad = () => new HttpError(400, 'invalid_code', 'Kod geçersiz veya süresi dolmuş.');
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw bad();
  const row = await env.DB.prepare(
    'SELECT id, code_hash FROM email_codes WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
  ).bind(email, purpose, t).first();
  if (!row) throw bad();
  const upd = await env.DB.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ? RETURNING attempts')
    .bind(row.id, MAX_ATTEMPTS).first();
  if (!upd) throw bad();
  const hash = await sha256hex(`${env.CODE_PEPPER || ''}:${email}:${purpose}:${code}`);
  if (!safeEqual(hash, row.code_hash)) throw bad();
  const res = await env.DB.prepare('UPDATE email_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(t, row.id).run();
  if (!res.meta?.changes) throw bad();
}

async function deliverCode(env, email, purpose) {
  const code = await issueCode(env, email, purpose);
  const subject = purpose === 'register' ? 'FOREVYE NEXUS doğrulama kodu' : 'FOREVYE NEXUS şifre sıfırlama kodu';
  await sendMail(env, { to: email, subject, text: `Kodunuz: ${code}\nBu kod 10 dakika geçerlidir. Siz istemediyseniz bu e-postayı yok sayın.` });
  return code;
}

export const authRoutes = {
  async registerStart(req, env) {
    legacyGuard(env);
    const { email: raw } = await readJson(req);
    const email = normEmail(raw);
    await rateLimit(env, `reg:ip:${clientIp(req)}`, 10, HOUR);
    await rateLimit(env, `reg:email:${email}`, 5, HOUR);
    const exists = await env.DB.prepare('SELECT 1 AS x FROM users WHERE email = ?').bind(email).first();
    let dev;
    if (!exists) dev = await deliverCode(env, email, 'register');
    // Hesap varlığı ifşa edilmez: yanıt her durumda aynıdır.
    return json({ ok: true, expires_in: CODE_TTL / 1000, ...(env.DEV_EXPOSE_CODES === 'true' && dev ? { dev_code: dev } : {}) });
  },

  async registerVerify(req, env) {
    legacyGuard(env);
    const { email: raw, code } = await readJson(req);
    const email = normEmail(raw);
    await rateLimit(env, `regv:ip:${clientIp(req)}`, 30, HOUR);
    await checkCode(env, email, 'register', code);
    const token = randomToken(32);
    await env.DB.prepare('INSERT INTO reg_tokens (token_hash, email, expires_at) VALUES (?,?,?)')
      .bind(await sha256hex(token), email, now(env) + 30 * MIN).run();
    return json({ ok: true, token });
  },

  async usernameAvailable(req, env, url) {
    await rateLimit(env, `uname:ip:${clientIp(req)}`, 60, 10 * MIN);
    const name = validateUsername(url.searchParams.get('name') || '');
    return json({ available: !(await usernameTaken(env, name, null)) });
  },

  async registerComplete(req, env) {
    legacyGuard(env);
    const b = await readJson(req);
    await rateLimit(env, `regc:ip:${clientIp(req)}`, 20, HOUR);
    if (typeof b.token !== 'string') throw new HttpError(400, 'invalid_token', 'Kayıt oturumu geçersiz. Baştan başlayın.');
    const t = now(env);
    const th = await sha256hex(b.token);
    const tok = await env.DB.prepare('SELECT email FROM reg_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?').bind(th, t).first();
    if (!tok) throw new HttpError(400, 'invalid_token', 'Kayıt oturumu geçersiz veya süresi dolmuş. Baştan başlayın.');
    const username = validateUsername(b.username);
    const password = validatePassword(b.password, { email: tok.email, username });
    const dn = validateDisplayName(b.card_display_name);
    if (!dn.ok) throw new HttpError(400, 'invalid_display_name', dn.error);
    if (await usernameTaken(env, username, null)) throw new HttpError(409, 'username_taken', 'Bu kullanıcı adı alınmış.');

    const id = crypto.randomUUID();
    const cardId = crypto.randomUUID();
    const design = JSON.stringify({ ...defaultDesign(dn.value), designId: cardId, ownerId: id });
    const pw = await hashPassword(password);
    try {
      await env.DB.batch([
        env.DB.prepare('UPDATE reg_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL').bind(t, th),
        env.DB.prepare('INSERT INTO users (id, email, email_verified_at, username, username_lower, password_hash, created_at) VALUES (?,?,?,?,?,?,?)')
          .bind(id, tok.email, t, username, username.toLowerCase(), pw, t),
        env.DB.prepare('INSERT INTO wallets (user_id, balance, updated_at) VALUES (?,0,?)').bind(id, t),
        env.DB.prepare(
          `INSERT INTO cards (id, user_id, label, display_name, card_token, status, is_default, design_json, design_version, created_at, updated_at)
           VALUES (?,?,?,?,?,'active',1,?,1,?,?)`,
        ).bind(cardId, id, 'Ana kart', dn.value, `NXC-${randomBase32(4)}-${randomBase32(4)}`, design, t, t),
        env.DB.prepare('INSERT INTO card_design_history (id, card_id, user_id, version, display_name, design_json, created_at) VALUES (?,?,?,?,?,?,?)')
          .bind(crypto.randomUUID(), cardId, id, 1, dn.value, design, t),
        notifyStmt(env, id, 'welcome', 'Hoş geldiniz', 'FOREVYE NEXUS bir sanal oyun ekonomisidir; gerçek para içermez.'),
      ]);
    } catch (err) {
      if (isConstraint(err, 'users.username_lower')) throw new HttpError(409, 'username_taken', 'Bu kullanıcı adı alınmış.');
      if (isConstraint(err, 'users.email')) throw new HttpError(409, 'register_failed', 'Kayıt tamamlanamadı. Baştan başlayın.');
      throw err;
    }
    const s = await createSession(env, req, id);
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    return json({ ok: true, ...(await meSummary(env, user)) }, 201, { 'set-cookie': s.cookie });
  },

  async login(req, env) {
    legacyGuard(env);
    const { email: raw, password } = await readJson(req);
    const ip = clientIp(req);
    await rateLimit(env, `login:ip:${ip}`, 30, 10 * MIN);
    const generic = new HttpError(401, 'bad_credentials', 'E-posta veya şifre hatalı.');
    let email;
    try { email = normEmail(raw); } catch { throw generic; }
    if (typeof password !== 'string' || password.length > 128) throw generic;
    await rateLimit(env, `login:email:${email}`, 8, 15 * MIN, 'Çok fazla başarısız deneme. 15 dakika sonra tekrar deneyin.');
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!user) { await dummyVerify(password); throw generic; }
    if (!(await verifyPassword(password, user.password_hash))) throw generic;
    const s = await createSession(env, req, user.id);
    if (s.newDevice) await notify(env, user.id, 'new_device', 'Yeni cihazdan giriş', 'Hesabınıza yeni bir cihazdan giriş yapıldı. Siz değilseniz şifrenizi değiştirin.');
    return json({ ok: true, ...(await meSummary(env, user)) }, 200, { 'set-cookie': s.cookie });
  },

  async logout(req, env, ctx, auth) {
    await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').bind(now(env), auth.sessionId).run();
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  },

  async forgot(req, env) {
    legacyGuard(env);
    const { email: raw } = await readJson(req);
    const email = normEmail(raw);
    await rateLimit(env, `forgot:ip:${clientIp(req)}`, 10, HOUR);
    await rateLimit(env, `forgot:email:${email}`, 5, HOUR);
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    let dev;
    if (user) dev = await deliverCode(env, email, 'reset');
    return json({ ok: true, ...(env.DEV_EXPOSE_CODES === 'true' && dev ? { dev_code: dev } : {}) });
  },

  async reset(req, env) {
    legacyGuard(env);
    const b = await readJson(req);
    const email = normEmail(b.email);
    await rateLimit(env, `reset:ip:${clientIp(req)}`, 20, HOUR);
    await checkCode(env, email, 'reset', b.code);
    const user = await env.DB.prepare('SELECT id, username FROM users WHERE email = ?').bind(email).first();
    if (!user) throw new HttpError(400, 'invalid_code', 'Kod geçersiz veya süresi dolmuş.');
    const pw = await hashPassword(validatePassword(b.new_password, { email, username: user.username }));
    const t = now(env);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(pw, user.id),
      env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(t, user.id),
      notifyStmt(env, user.id, 'password_reset', 'Şifre sıfırlandı', 'Şifreniz sıfırlandı ve tüm oturumlar kapatıldı.'),
    ]);
    return json({ ok: true });
  },

  // ---------- FOREVYE ID ile giriş (kod + PKCE) ----------
  // start → ID sitesi (izin) → callback (kod değişimi, sunucudan sunucuya) → oturum çerezi. ID parolayı hiç Nexus'a vermez.
  async idStart(req, env, url) {
    if (!idConfigured(env)) throw new HttpError(503, 'id_unavailable', 'FOREVYE ID ile giriş bu sunucuda ayarlı değil.');
    await ensureIdSchema(env);
    await rateLimit(env, `idstart:ip:${clientIp(req)}`, 20, 10 * MIN);
    const verifier = randomToken(32), state = randomToken(18), t = now(env);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM id_states WHERE expires_at < ?').bind(t),
      env.DB.prepare('INSERT INTO id_states (state_hash, verifier, expires_at) VALUES (?,?,?)').bind(await sha256hex(state), verifier, t + 10 * MIN),
    ]);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const q = new URLSearchParams({ app: ID_APP, redirect: idCallbackUrl(url), state, challenge });
    return json({ url: `${env.ID_URL.replace(/\/+$/, '')}/#/baglan?${q}` });
  },

  async idCallback(req, env, url) {
    const fail = (code) => new Response(null, { status: 302, headers: { location: `/?id_error=${code}` } });
    if (!idConfigured(env)) return fail('id_unavailable');
    try { await ensureIdSchema(env); } catch { return fail('id_failed'); }
    try { await rateLimit(env, `idcb:ip:${clientIp(req)}`, 30, 10 * MIN); } catch { return fail('rate_limited'); }
    const code = url.searchParams.get('code') || '', state = url.searchParams.get('state') || '';
    if (!code || !state) return fail('id_failed');
    const t = now(env);
    const st = await env.DB.prepare('DELETE FROM id_states WHERE state_hash = ? AND expires_at > ? RETURNING verifier').bind(await sha256hex(state), t).first();
    if (!st) return fail('id_state');
    let data;
    try {
      const res = await fetch(`${env.ID_API_URL.replace(/\/+$/, '')}/identity/token/exchange`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, verifier: st.verifier, app: ID_APP, redirect: idCallbackUrl(url), tokens: false }),
      });
      data = await res.json();
      if (!res.ok || !data.user) return fail('id_failed');
    } catch { return fail('id_unavailable'); }
    const idu = data.user;
    if (!idu.emailVerified || typeof idu.email !== 'string') return fail('id_unverified');
    let email; try { email = normEmail(idu.email); } catch { return fail('id_failed'); }

    let user = await env.DB.prepare('SELECT u.* FROM id_links l JOIN users u ON u.id = l.user_id WHERE l.id_user_id = ?').bind(idu.userId).first();
    if (!user) {
      // Aynı doğrulanmış e-postalı mevcut Nexus hesabı varsa (eski e-posta girişi) ona bağlanır; her iki taraf da e-postayı doğrulamıştır.
      const old = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND email_verified_at IS NOT NULL').bind(email).first();
      if (old) {
        const has = await env.DB.prepare('SELECT 1 AS x FROM id_links WHERE user_id = ?').bind(old.id).first();
        if (has) return fail('id_conflict');
        await env.DB.batch([
          env.DB.prepare('INSERT INTO id_links (user_id, id_user_id, linked_at) VALUES (?,?,?)').bind(old.id, idu.userId, t),
          notifyStmt(env, old.id, 'id_linked', 'FOREVYE ID bağlandı', 'Hesabınız FOREVYE ID ile birleştirildi. Artık ID ile giriş yapabilirsiniz.'),
        ]);
        user = old;
      }
    }
    if (!user) {
      const token = randomToken(32);
      await env.DB.prepare('INSERT INTO id_pending (token_hash, id_user_id, email, expires_at) VALUES (?,?,?,?)').bind(await sha256hex(token), idu.userId, email, t + 30 * MIN).run();
      return new Response(null, { status: 302, headers: { location: `/#/id-kayit/${token}` } });
    }
    const s = await createSession(env, req, user.id);
    if (s.newDevice) await notify(env, user.id, 'new_device', 'Yeni cihazdan giriş', 'Hesabınıza yeni bir cihazdan giriş yapıldı. Siz değilseniz şifrenizi değiştirin.');
    return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': s.cookie } });
  },

  // İlk kez ID ile gelen kullanıcı: Nexus kullanıcı adı + kart ismi seçer (şifre yok; kimlik ID'dedir).
  async idComplete(req, env) {
    await ensureIdSchema(env);
    const b = await readJson(req);
    await rateLimit(env, `idc:ip:${clientIp(req)}`, 20, HOUR);
    if (typeof b.token !== 'string') throw new HttpError(400, 'invalid_token', 'Kayıt oturumu geçersiz. Baştan başlayın.');
    const t = now(env), th = await sha256hex(b.token);
    const tok = await env.DB.prepare('SELECT id_user_id, email FROM id_pending WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?').bind(th, t).first();
    if (!tok) throw new HttpError(400, 'invalid_token', 'Kayıt oturumu geçersiz veya süresi dolmuş. ID ile yeniden giriş yapın.');
    const username = validateUsername(b.username);
    const dn = validateDisplayName(b.card_display_name);
    if (!dn.ok) throw new HttpError(400, 'invalid_display_name', dn.error);
    if (await usernameTaken(env, username, null)) throw new HttpError(409, 'username_taken', 'Bu kullanıcı adı alınmış.');
    const id = crypto.randomUUID(), cardId = crypto.randomUUID(), design = JSON.stringify({ ...defaultDesign(dn.value), designId: cardId, ownerId: id });
    const pw = await hashPassword(randomToken(32));   // kullanılamaz parola: giriş yalnızca ID ile
    try {
      await env.DB.batch([
        env.DB.prepare('UPDATE id_pending SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL').bind(t, th),
        env.DB.prepare('INSERT INTO users (id, email, email_verified_at, username, username_lower, password_hash, created_at) VALUES (?,?,?,?,?,?,?)')
          .bind(id, tok.email, t, username, username.toLowerCase(), pw, t),
        env.DB.prepare('INSERT INTO id_links (user_id, id_user_id, linked_at) VALUES (?,?,?)').bind(id, tok.id_user_id, t),
        env.DB.prepare('INSERT INTO wallets (user_id, balance, updated_at) VALUES (?,0,?)').bind(id, t),
        env.DB.prepare(
          `INSERT INTO cards (id, user_id, label, display_name, card_token, status, is_default, design_json, design_version, created_at, updated_at)
           VALUES (?,?,?,?,?,'active',1,?,1,?,?)`,
        ).bind(cardId, id, 'Ana kart', dn.value, `NXC-${randomBase32(4)}-${randomBase32(4)}`, design, t, t),
        env.DB.prepare('INSERT INTO card_design_history (id, card_id, user_id, version, display_name, design_json, created_at) VALUES (?,?,?,?,?,?,?)')
          .bind(crypto.randomUUID(), cardId, id, 1, dn.value, design, t),
        notifyStmt(env, id, 'welcome', 'Hoş geldiniz', 'FOREVYE NEXUS bir sanal oyun ekonomisidir; gerçek para içermez.'),
      ]);
    } catch (err) {
      if (isConstraint(err, 'users.username_lower')) throw new HttpError(409, 'username_taken', 'Bu kullanıcı adı alınmış.');
      if (isConstraint(err, 'users.email') || isConstraint(err, 'id_links')) throw new HttpError(409, 'register_failed', 'Kayıt tamamlanamadı. ID ile yeniden giriş yapın.');
      throw err;
    }
    const s = await createSession(env, req, id);
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    return json({ ok: true, ...(await meSummary(env, user)) }, 201, { 'set-cookie': s.cookie });
  },
};
