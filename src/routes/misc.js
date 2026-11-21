import { HttpError, json, readJson, now, cfgNum, DAY, MIN, HOUR, isSuspended } from '../lib/util.js';
import { rateLimit } from '../lib/rate.js';
import { notify } from '../lib/auth.js';
import { creditExternal } from '../lib/ledger.js';
import { giftcardStatus, redeemViaExistingModule } from '../integrations/giftcard.js';
import { balanceOf } from './wallet.js';
import { usernameChangeStatus } from './profile.js';

// Rozet tanımları. Koşullar SUNUCUDA değerlendirilir; kullanıcı kendine rozet atayamaz.
export const ACHIEVEMENTS = {
  first_transfer_sent: { title: 'İlk transfer', desc: 'İlk sanal bakiye transferini gönderdin.' },
  first_transfer_received: { title: 'İlk alım', desc: 'İlk transferini aldın.' },
  first_purchase: { title: 'İlk alışveriş', desc: 'Oyun içi ilk alışverişini yaptın.' },
  first_topup: { title: 'İlk yükleme', desc: 'Hediye koduyla ilk bakiye yüklemeni yaptın.' },
  first_crystal: { title: 'İlk kristal', desc: 'Borsadan ilk kristalini aldın.' },
  anniversary_1y: { title: 'Bir yıllık üye', desc: 'Üyeliğinin 1. yılını tamamladın.' },
};

export async function grantAchievement(env, userId, key) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO user_achievements (user_id, key, earned_at) VALUES (?,?,?)').bind(userId, key, now(env)).run();
  if (r.meta?.changes) await notify(env, userId, 'achievement', 'Yeni rozet', ACHIEVEMENTS[key].title);
}

export async function meSummary(env, user) {
  const t = now(env);
  const [balance, unread, ann, card, uc] = await Promise.all([
    balanceOf(env, user.id),
    env.DB.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL').bind(user.id).first(),
    env.DB.prepare('SELECT id, title, body, created_at FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 3').all(),
    env.DB.prepare('SELECT id, display_name, card_token, status, design_json FROM cards WHERE user_id = ? AND is_default = 1').bind(user.id).first(),
    usernameChangeStatus(env, user),
  ]);
  return {
    user: {
      id: user.id, username: user.username, email: user.email, created_at: user.created_at,
      suspended: isSuspended(user, t), suspend_reason: isSuspended(user, t) ? user.suspend_reason : null,
      is_admin: ['admin', 'superadmin'].includes(user.role), // yalnızca bağlantıyı göstermek için; yetki sunucuda denetlenir
    },
    balance, unread: unread.c, announcements: ann.results,
    default_card: card ? { ...card, design: JSON.parse(card.design_json), design_json: undefined } : null,
    config: {
      currency: env.CURRENCY_CODE || 'FN',
      max_transfer: cfgNum(env, 'MAX_TRANSFER_MINOR', 500000),
      daily_limit: cfgNum(env, 'DAILY_TRANSFER_LIMIT_MINOR', 1500000),
      reauth_threshold: cfgNum(env, 'REAUTH_THRESHOLD_MINOR', 100000),
      max_cards: cfgNum(env, 'MAX_CARDS', 5),
    },
    username_change: uc,
  };
}

export const miscRoutes = {
  async me(req, env, ctx, { user }) { return json(await meSummary(env, user)); },

  async notifications(req, env, url, { user }) {
    const rows = (await env.DB.prepare('SELECT id, type, title, body, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(user.id).all()).results;
    return json({ items: rows });
  },

  async markRead(req, env, ctx, { user }) {
    const b = await readJson(req);
    const t = now(env);
    if (b.all === true) await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(t, user.id).run();
    else if (Array.isArray(b.ids) && b.ids.length && b.ids.length <= 50 && b.ids.every((i) => typeof i === 'string')) {
      await env.DB.batch(b.ids.map((id) => env.DB.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').bind(t, id, user.id)));
    } else throw new HttpError(400, 'invalid', 'Geçersiz istek.');
    return json({ ok: true });
  },

  async vault(req, env, ctx, { user }) {
    const t = now(env);
    if (t >= user.created_at + 365 * DAY) await grantAchievement(env, user.id, 'anniversary_1y');
    const earned = (await env.DB.prepare('SELECT key, earned_at FROM user_achievements WHERE user_id = ?').bind(user.id).all()).results;
    const designs = (await env.DB.prepare(
      'SELECT h.id, h.card_id, h.version, h.display_name, h.design_json, h.created_at FROM card_design_history h WHERE h.user_id = ? ORDER BY h.created_at DESC LIMIT 20',
    ).bind(user.id).all()).results.map((d) => ({ ...d, design: JSON.parse(d.design_json), design_json: undefined }));
    const themes = (await env.DB.prepare('SELECT id, name, design_json, limited_until FROM card_templates WHERE active = 1 AND (limited_until IS NULL OR limited_until > ?) ORDER BY created_at DESC').bind(t).all())
      .results.map((x) => ({ ...x, design: JSON.parse(x.design_json), design_json: undefined }));
    return json({
      badges: Object.entries(ACHIEVEMENTS).map(([key, v]) => ({ key, ...v, earned_at: earned.find((e) => e.key === key)?.earned_at ?? null })),
      saved_designs: designs, themes,
    });
  },

  async giftcardStatus(req, env) {
    const s = await giftcardStatus(env);
    return json({ available: s.connected });
  },

  // Mevcut hediye kartı modülüne bağlanır; kod doğrulama o modülde kalır, bakiye yükleme defterle atomik yapılır.
  async giftcardRedeem(req, env, ctx, { user }) {
    const b = await readJson(req);
    if (user.suspended) throw new HttpError(403, 'account_suspended', 'Hesabınız askıda.');
    await rateLimit(env, `gift:${user.id}`, 10, HOUR, 'Çok fazla kod denemesi. Daha sonra tekrar deneyin.');
    if (typeof b.code !== 'string' || b.code.trim().length < 4 || b.code.length > 64) throw new HttpError(400, 'invalid_code', 'Kod geçersiz.');
    const idem = typeof b.idempotency_key === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.idempotency_key) ? b.idempotency_key : crypto.randomUUID();
    const r = await redeemViaExistingModule(env, { userId: user.id, code: b.code.trim(), idempotencyKey: idem });
    const credit = await creditExternal(env, { userId: user.id, amount: r.amount, externalRef: `giftcard:${r.reference}`, desc: 'Hediye kartı yüklemesi' });
    if (!credit.replayed) await grantAchievement(env, user.id, 'first_topup');
    return json({ ok: true, ref: credit.ref, amount: r.amount, replayed: credit.replayed, balance: await balanceOf(env, user.id) });
  },
};
