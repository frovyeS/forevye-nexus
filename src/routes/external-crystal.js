/* Zamanlayıcı -> NEXUS Banka Kristal cüzdanı sunucudan sunucuya bağlantısı.
   Kimlik: FOREVYE ID userId -> id_links -> bank users.id.
   İstek imzası Mikro-Klima NEXUS_SECRET ile, bankadaki GIFTCARD_API_SECRET ile doğrulanır
   (bu iki secret mevcut hediye-kartı entegrasyonunda zaten ortaktır). */
import { HttpError, json, now } from '../lib/util.js';
import { hmacHex, safeEqual } from '../lib/crypto.js';

const QTY_SCALE = 10000;
const schemaReady = new WeakSet();

async function ensureSchema(env) {
  if (schemaReady.has(env.DB)) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS crystal_reward_credits (
    ref TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    id_user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    day TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK(qty > 0),
    created_at INTEGER NOT NULL,
    applied_at INTEGER,
    apply_token TEXT,
    UNIQUE(id_user_id, source, day)
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_crystal_reward_user ON crystal_reward_credits(user_id, created_at DESC)').run();
  schemaReady.add(env.DB);
}

async function verifyService(req, env, raw) {
  const secret = env.GIFTCARD_API_SECRET;
  if (!secret || secret.length < 16) throw new HttpError(503, 'service_key_unavailable', 'Banka servis anahtarı ayarlı değil.');
  const ts = req.headers.get('x-nx-timestamp') || '';
  const sig = req.headers.get('x-nx-signature') || '';
  if (!/^\d{10,16}$/.test(ts) || Math.abs(now(env) - Number(ts)) > 5 * 60e3) {
    throw new HttpError(401, 'bad_signature', 'Servis imzası geçersiz.');
  }
  const expected = await hmacHex(secret, `${ts}.${raw}`);
  if (!safeEqual(expected, sig)) throw new HttpError(401, 'bad_signature', 'Servis imzası geçersiz.');
}

async function resolveBankUser(env, idUserId, email) {
  const direct = await env.DB.prepare(`SELECT u.id,u.status,u.suspended_until
    FROM id_links l JOIN users u ON u.id=l.user_id WHERE l.id_user_id=?`).bind(idUserId).first();
  if (direct) return direct;

  // Eski banka hesabı e-posta/parola ile açılmışsa, doğrulanmış FOREVYE ID e-postası
  // aynı hesapla otomatik eşleştirilir. İstemciden hiçbir yedek/anahtar alınmaz.
  const legacy = await env.DB.prepare(`SELECT id,status,suspended_until FROM users
    WHERE email=? AND email_verified_at IS NOT NULL`).bind(email).first();
  if (!legacy) return null;

  const owner = await env.DB.prepare('SELECT id_user_id FROM id_links WHERE user_id=?').bind(legacy.id).first();
  if (owner && owner.id_user_id !== idUserId) throw new HttpError(409, 'bank_identity_conflict', 'Banka hesabı başka bir FOREVYE ID kimliğine bağlı.');
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO id_links(user_id,id_user_id,linked_at) VALUES(?,?,?)')
      .bind(legacy.id, idUserId, now(env)).run();
  } catch (_) {
    // Yarış durumunda aşağıda bağlantıyı yeniden okuyacağız.
  }
  const linked = await env.DB.prepare(`SELECT u.id,u.status,u.suspended_until
    FROM id_links l JOIN users u ON u.id=l.user_id WHERE l.id_user_id=?`).bind(idUserId).first();
  return linked || null;
}

async function account(env, body) {
  await ensureSchema(env);
  const identity = await resolveBankUser(env, body.id_user_id, body.email);
  if (!identity) throw new HttpError(409, 'bank_account_not_found', 'Bu FOREVYE ID ile eşleşen banka hesabı bulunamadı.');
  const t = now(env);
  if (identity.status === 'suspended' && !(identity.suspended_until && t >= identity.suspended_until)) {
    throw new HttpError(403, 'bank_account_suspended', 'Banka hesabı geçici olarak askıda.');
  }
  const holding = await env.DB.prepare('SELECT qty FROM crystal_holdings WHERE user_id=?').bind(identity.id).first();
  return { userId: identity.id, qty: Number(holding?.qty || 0) };
}

async function credit(env, body) {
  const identity = await account(env, body);
  const qty = Number(body.qty);
  const day = String(body.day || '');
  const ref = String(body.ref || '');
  const source = String(body.source || '');
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 400000) throw new HttpError(400, 'invalid_qty', 'Kristal ödül miktarı geçersiz.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || source !== 'zamanlayici_daily') throw new HttpError(400, 'invalid_reward', 'Ödül kaydı geçersiz.');
  if (!/^timer_[A-Za-z0-9_-]{12,100}$/.test(ref)) throw new HttpError(400, 'invalid_ref', 'Ödül referansı geçersiz.');

  const prior = await env.DB.prepare('SELECT ref,user_id,qty,applied_at FROM crystal_reward_credits WHERE id_user_id=? AND source=? AND day=?')
    .bind(body.id_user_id, source, day).first();
  if (prior) {
    if (prior.user_id !== identity.userId || prior.qty !== qty || prior.ref !== ref) {
      throw new HttpError(409, 'reward_replay_conflict', 'Bu günlük ödül daha önce farklı bir kayıtla işlendi.');
    }
    const holding = await env.DB.prepare('SELECT qty FROM crystal_holdings WHERE user_id=?').bind(identity.userId).first();
    return { credited: false, replayed: true, qty, balanceQty: Number(holding?.qty || 0), ref };
  }

  const t = now(env);
  const applyToken = crypto.randomUUID();
  // Tek D1 transaction: tek günlük claim + holdings güncellemesi atomiktir.
  // Aynı istek/aynı gün eşzamanlı yinelense bile yalnızca applyToken'ı kazanan çağrı cüzdanı artırır.
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO crystal_reward_credits
      (ref,user_id,id_user_id,source,day,qty,created_at) VALUES(?,?,?,?,?,?,?)`)
      .bind(ref, identity.userId, body.id_user_id, source, day, qty, t),
    env.DB.prepare(`UPDATE crystal_reward_credits SET applied_at=?,apply_token=?
      WHERE ref=? AND applied_at IS NULL`).bind(t, applyToken, ref),
    env.DB.prepare(`INSERT INTO crystal_holdings(user_id,qty,cost_basis,updated_at)
      SELECT ?,?,0,? WHERE EXISTS (
        SELECT 1 FROM crystal_reward_credits WHERE ref=? AND applied_at=? AND apply_token=?
      ) ON CONFLICT(user_id) DO UPDATE SET qty=crystal_holdings.qty+excluded.qty,updated_at=excluded.updated_at`)
      .bind(identity.userId, qty, t, ref, t, applyToken),
  ]);

  const saved = await env.DB.prepare('SELECT ref,user_id,qty,applied_at,apply_token FROM crystal_reward_credits WHERE id_user_id=? AND source=? AND day=?')
    .bind(body.id_user_id, source, day).first();
  if (!saved || !saved.applied_at) throw new HttpError(503, 'reward_not_applied', 'Kristal ödülü bankaya işlenemedi.');
  if (saved.user_id !== identity.userId || saved.qty !== qty || saved.ref !== ref) {
    throw new HttpError(409, 'reward_replay_conflict', 'Bu günlük ödül daha önce farklı bir kayıtla işlendi.');
  }
  const holding = await env.DB.prepare('SELECT qty FROM crystal_holdings WHERE user_id=?').bind(identity.userId).first();
  return { credited: saved.apply_token === applyToken, replayed: saved.apply_token !== applyToken, qty, balanceQty: Number(holding?.qty || 0), ref };
}

export const externalCrystalRoutes = {
  async handle(req, env, url) {
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    const raw = await req.text();
    if (raw.length > 5000) return json({ ok: false, error: 'too_large' }, 413);
    await verifyService(req, env, raw);
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'bad_json', 'Geçersiz istek.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json', 'Geçersiz istek.');
    const idUserId = String(body.id_user_id || '');
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^usr_[a-f0-9]{16}$/.test(idUserId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || body.email_verified !== true) {
      throw new HttpError(400, 'invalid_identity', 'Doğrulanmış FOREVYE ID bilgisi gerekli.');
    }
    const safeBody = { ...body, id_user_id: idUserId, email };
    if (url.pathname === '/api/ext/timer-reward/account') {
      const a = await account(env, safeBody);
      return json({ ok: true, linked: true, qty: a.qty, crystals: a.qty / QTY_SCALE });
    }
    if (url.pathname === '/api/ext/timer-reward/credit') {
      const r = await credit(env, safeBody);
      return json({ ok: true, ...r, crystals: r.balanceQty / QTY_SCALE });
    }
    return json({ ok: false, error: 'not_found' }, 404);
  },
};
