import { limitsFor, skinsOf, NO_PERKS } from '../lib/shop.js';
import { HttpError, json, readJson, now, cfgNum, DAY, MIN, HOUR, isSuspended } from '../lib/util.js';
import { rateLimit } from '../lib/rate.js';
import { notify } from '../lib/auth.js';
import { creditGiftCrystals, holdingOf, QTY_SCALE } from '../lib/market.js';
import { giftcardStatus, redeemViaExistingModule } from '../integrations/giftcard.js';
import { balanceOf } from './wallet.js';
import { usernameChangeStatus } from './profile.js';
import { readStoredDesign } from '../../shared/card-contract.js';

// Rozet tanımları. Koşullar SUNUCUDA değerlendirilir; kullanıcı kendine rozet atayamaz.
export const ACHIEVEMENTS = {
  account_created: { title: 'Nexus’a hoş geldin', desc: 'Hesabını oluşturdun.', reward: 20 },
  first_card_design: { title: 'İlk tasarım kartım', desc: 'İlk kart tasarımını kaydettin.', reward: 10 },
  first_transfer_sent: { title: 'İlk transfer', desc: 'İlk sanal bakiye transferini gönderdin.' },
  first_transfer_received: { title: 'İlk alım', desc: 'İlk transferini aldın.' },
  first_purchase: { title: 'İlk harcama', desc: 'Nexus Market’te ilk harcamanı yaptın.', reward: 10 },
  first_topup: { title: 'İlk yükleme', desc: 'Hediye koduyla ilk bakiye yüklemeni yaptın.' },
  first_crystal: { title: 'İlk kristal', desc: 'Borsadan ilk kristalini aldın.' },
  anniversary_1y: { title: 'Bir yıllık üye', desc: 'Üyeliğinin 1. yılını tamamladın.' },
};

export async function grantAchievement(env, userId, key) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO user_achievements (user_id, key, earned_at) VALUES (?,?,?)').bind(userId, key, now(env)).run();
  if (r.meta?.changes) {
    await notify(env, userId, 'achievement', 'Yeni rozet', ACHIEVEMENTS[key].title);
    const reward = Number(ACHIEVEMENTS[key].reward || 0);
    if (reward > 0) await creditGiftCrystals(env, { userId, kristal: reward, ref: `achievement:${key}:${userId}` });
  }
}

export async function meSummary(env, user) {
  const t = now(env);
  const [balance, unread, ann, card, uc] = await Promise.all([
    balanceOf(env, user.id),
    env.DB.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL').bind(user.id).first(),
    env.DB.prepare('SELECT id, title, body, created_at FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 3').all(),
    env.DB.prepare('SELECT id, display_name, card_token, status, design_json, design_version FROM cards WHERE user_id = ? AND is_default = 1').bind(user.id).first(),
    usernameChangeStatus(env, user),
  ]);
  // Mağaza (perk/yüzey) verisi OPSİYONELDİR: şeması ya da tohumu bozuk olsa bile giriş ve banka açılışı 500 vermemeli.
  // Perk okunamazsa en güvenli (temel) sınırlar, yüzey okunamazsa varsayılan görünüm kullanılır.
  let lim;
  try { lim = await limitsFor(env, user.id); } catch (err) {
    console.error('[me] limitsFor başarısız, temel sınırlar kullanıldı', err && err.message ? err.message : err);
    lim = { perks: { ...NO_PERKS }, max_transfer: cfgNum(env, 'MAX_TRANSFER_MINOR', 500000), daily_limit: cfgNum(env, 'DAILY_TRANSFER_LIMIT_MINOR', 1500000), max_cards: cfgNum(env, 'MAX_CARDS', 5) };
  }
  let skins = {};
  if (card) { try { skins = await skinsOf(env, user.id); } catch (err) { console.error('[me] skinsOf başarısız', err && err.message ? err.message : err); } }
  return {
    user: {
      id: user.id, username: user.username, email: user.email, created_at: user.created_at,
      suspended: isSuspended(user, t), suspend_reason: isSuspended(user, t) ? user.suspend_reason : null,
      is_admin: ['admin', 'superadmin'].includes(user.role), // yalnızca bağlantıyı göstermek için; yetki sunucuda denetlenir
    },
    balance, unread: unread.c, announcements: ann.results,
    default_card: card ? { ...card, skin: skins[card.id] || null, design: readStoredDesign(card.design_json, card.display_name, card.design_version), design_json: undefined, design_version: undefined } : null,
    config: {
      currency: env.CURRENCY_CODE || 'FN',
      max_transfer: lim.max_transfer,
      daily_limit: lim.daily_limit,
      reauth_threshold: cfgNum(env, 'REAUTH_THRESHOLD_MINOR', 100000),
      max_cards: lim.max_cards,
      perks: lim.perks,
    },
    username_change: uc,
  };
}

// Teşhis ucu (/api/health): hangi tablonun eksik olduğunu SIRRA/VERİYE dokunmadan söyler. Tarayıcıdan açıp bakılır; yalnızca tablo adı + ok/hata döner.
const HEALTH_TABLES = ['users', 'sessions', 'wallets', 'cards', 'notifications', 'announcements', 'rate_limits', 'username_history', 'id_links', 'id_states', 'id_pending',
  'shop_products', 'shop_entitlements', 'shop_card_skins', 'editor_tickets', 'bank_tickets', 'bank_tokens', 'crystal_gifts', 'card_ledger'];
async function health(req, env) {
  const checks = {};
  let ok = true;
  for (const tb of HEALTH_TABLES) {
    try { await env.DB.prepare(`SELECT 1 FROM ${tb} LIMIT 1`).all(); checks[tb] = 'ok'; } catch (err) {
      checks[tb] = /no such table/i.test(String(err && err.message)) ? 'eksik' : 'hata';
      // Yalnızca isteğe bağlı/yan tablolar (kendiliğinden kurulanlar) eksikse sorun sayılmaz.
      if (['users', 'sessions', 'wallets', 'cards', 'notifications', 'announcements', 'rate_limits', 'username_history'].includes(tb)) ok = false;
    }
  }
  let products = null;
  try { products = (await env.DB.prepare('SELECT COUNT(*) AS c FROM shop_products').first()).c; } catch { /* tablo yok */ }
  const config = { id_login: Boolean(env.ID_URL && env.ID_API_URL), legacy_login: env.LEGACY_LOGIN !== 'off', mail: env.EMAIL_PROVIDER || null };
  return json({ ok, db: Boolean(env.DB), checks, shop_products: products, config }, ok ? 200 : 503);
}

export const miscRoutes = {
  health,
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
    // Başarımlar yalnızca gerçek olay gerçekleştiğinde verilir; profil ekranı eski hesaplara geriye dönük ödül dağıtmaz.
    const earned = (await env.DB.prepare('SELECT key, earned_at FROM user_achievements WHERE user_id = ?').bind(user.id).all()).results;
    const designs = (await env.DB.prepare(
      'SELECT h.id, h.card_id, h.version, h.display_name, h.design_json, h.created_at FROM card_design_history h WHERE h.user_id = ? ORDER BY h.created_at DESC LIMIT 20',
    ).bind(user.id).all()).results.map((d) => ({ ...d, design: readStoredDesign(d.design_json, d.display_name, d.version), design_json: undefined }));
    const themes = (await env.DB.prepare('SELECT id, name, design_json, limited_until FROM card_templates WHERE active = 1 AND (limited_until IS NULL OR limited_until > ?) ORDER BY created_at DESC').bind(t).all())
      .results.map((x) => ({ ...x, design: readStoredDesign(x.design_json, 'NEXUS'), design_json: undefined }));
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
    const credit = await creditGiftCrystals(env, { userId: user.id, kristal: r.kristal, ref: `giftcard:${r.reference}` });
    if (!credit.replayed) await grantAchievement(env, user.id, 'first_topup');
    const h = await holdingOf(env, user.id);
    return json({ ok: true, kristal: credit.qty / QTY_SCALE, replayed: credit.replayed, crystal_balance: h.qty / QTY_SCALE, balance: await balanceOf(env, user.id) });
  },
};
