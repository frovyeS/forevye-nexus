import { HttpError, json } from './lib/util.js';
import { authenticate, requireAdmin } from './lib/auth.js';
import { authRoutes } from './routes/auth.js';
import { profileRoutes } from './routes/profile.js';
import { walletRoutes } from './routes/wallet.js';
import { cardRoutes } from './routes/cards.js';
import { cardMoneyRoutes } from './routes/card-money.js';
import { miscRoutes } from './routes/misc.js';
import { adminRoutes } from './routes/admin.js';
import { internalRoutes } from './routes/internal.js';
import { marketRoutes } from './routes/market.js';
import { editorRoutes, editorOrigins } from './routes/editor.js';
import { passRoutes, passInternalRoutes, passAdminRoutes, passOrigins } from './routes/pass.js';
import { shopRoutes, shopAdminRoutes, shopOrigins, cardSkinRoute } from './routes/shop.js';
import { cronTick } from './lib/market.js';
import { externalCrystalRoutes } from './routes/external-crystal.js';

// [yöntem, yol, işleyici, erişim]  erişim: 'public' | 'user' | 'admin' | 'super' | 'internal' | 'editor'
// 'shop': Nexus Market sitesi (ayrı site), 'pass' ile aynı yöntem: Bearer jeton, CORS yalnızca SHOP_URL kaynağına açık.
// 'pass': Nexus Pass sitesi (ayrı site) Bearer jetonla gelir, CORS yalnızca PASS_URL kaynağına açıktır.
// 'editor': çerez yok; kart editörü (ayrı site) biletle/Bearer jetonla gelir, CORS yalnızca EDITOR_URL kaynağına açıktır.
const R = [];
const add = (m, path, h, access = 'user') => R.push({ m, re: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), h, access });

add('POST', '/api/auth/register/start', authRoutes.registerStart, 'public');
add('POST', '/api/auth/register/verify', authRoutes.registerVerify, 'public');
add('GET', '/api/auth/username-available', authRoutes.usernameAvailable, 'public');
add('POST', '/api/auth/register/complete', authRoutes.registerComplete, 'public');
add('POST', '/api/auth/id/start', authRoutes.idStart, 'public');
add('GET', '/api/auth/id/callback', authRoutes.idCallback, 'public');
add('POST', '/api/auth/id/complete', authRoutes.idComplete, 'public');
add('POST', '/api/auth/login', authRoutes.login, 'public');
add('POST', '/api/auth/forgot', authRoutes.forgot, 'public');
add('POST', '/api/auth/reset', authRoutes.reset, 'public');
add('POST', '/api/auth/logout', authRoutes.logout);

add('GET', '/api/me', miscRoutes.me);
add('GET', '/api/notifications', miscRoutes.notifications);
add('POST', '/api/notifications/read', miscRoutes.markRead);
add('GET', '/api/vault', miscRoutes.vault);
add('GET', '/api/giftcard/status', miscRoutes.giftcardStatus);
add('POST', '/api/giftcard/redeem', miscRoutes.giftcardRedeem);

add('GET', '/api/profile', profileRoutes.get);
add('POST', '/api/profile/username', profileRoutes.changeUsername);
add('POST', '/api/profile/password', profileRoutes.changePassword);
add('GET', '/api/profile/sessions', profileRoutes.sessions);
add('POST', '/api/profile/sessions/revoke-others', profileRoutes.revokeOthers);
add('PUT', '/api/profile/avatar', profileRoutes.putAvatar);
add('GET', '/api/profile/avatar', profileRoutes.getAvatar);
add('DELETE', '/api/profile/avatar', profileRoutes.deleteAvatar);

add('GET', '/api/wallet', walletRoutes.balance);
add('GET', '/api/transactions', walletRoutes.transactions);
add('POST', '/api/transfers/lookup', walletRoutes.lookup);
add('POST', '/api/transfers', walletRoutes.transfer);

add('GET', '/api/transfers/recent', walletRoutes.recent);

add('GET', '/api/market', marketRoutes.overview);
add('GET', '/api/market/history', marketRoutes.history);
add('GET', '/api/market/trades', marketRoutes.trades);
add('POST', '/api/market/trade', marketRoutes.trade);

add('GET', '/api/cards', cardRoutes.list);
add('GET', '/api/cards/resolve', cardRoutes.resolve);
add('POST', '/api/cards', cardRoutes.create);
add('GET', '/api/card-templates', cardRoutes.templates);
add('POST', '/api/editor/ticket', editorRoutes.ticket);
add('POST', '/api/editor/exchange', editorRoutes.exchange, 'editor');
add('GET', '/api/editor/card', editorRoutes.card, 'editor');
add('PUT', '/api/editor/card', editorRoutes.save, 'editor');
add('POST', '/api/editor/shop-ticket', editorRoutes.shopTicket, 'editor');
add('GET', '/api/cards/:id', cardRoutes.get);
add('PATCH', '/api/cards/:id', cardRoutes.update);
add('POST', '/api/cards/:id/default', cardRoutes.setDefault);
add('POST', '/api/cards/:id/status', cardRoutes.setStatus);
add('POST', '/api/cards/:id/fund', cardMoneyRoutes.fund);
add('POST', '/api/cards/:id/pay', cardMoneyRoutes.pay);
add('GET', '/api/cards/:id/transactions', cardMoneyRoutes.transactions);
add('GET', '/api/cards/:id/history', cardRoutes.history);
add('POST', '/api/cards/:id/revert', cardRoutes.revert);

add('POST', '/api/shop/ticket', shopRoutes.ticket);
add('GET', '/api/shop/mine', shopRoutes.mine);
add('POST', '/api/shop/exchange', shopRoutes.exchange, 'shop');
add('GET', '/api/shop/me', shopRoutes.me, 'shop');
add('GET', '/api/shop/products', shopRoutes.products, 'shop');
add('GET', '/api/shop/product', shopRoutes.product, 'shop');
add('GET', '/api/shop/purchases', shopRoutes.purchases, 'shop');
add('POST', '/api/shop/purchase', shopRoutes.purchase, 'shop');
add('POST', '/api/shop/wishlist', shopRoutes.wishlist, 'shop');
add('POST', '/api/shop/equip', shopRoutes.equip, 'shop');
add('POST', '/api/cards/:id/skin', cardSkinRoute);
add('POST', '/api/pass/ticket', passRoutes.ticket);
add('GET', '/api/pass/mine', passRoutes.mine);
add('POST', '/api/pass/exchange', passRoutes.exchange, 'pass');
add('GET', '/api/pass/me', passRoutes.me, 'pass');
add('GET', '/api/pass/products', passRoutes.products, 'pass');
add('GET', '/api/pass/product', passRoutes.product, 'pass');
add('GET', '/api/pass/purchases', passRoutes.purchases, 'pass');
add('POST', '/api/pass/purchase', passRoutes.purchase, 'pass');
add('POST', '/api/internal/entitlement', passInternalRoutes.entitlement, 'internal');
add('POST', '/api/internal/purchase', internalRoutes.purchase, 'internal');
add('POST', '/api/internal/refund', internalRoutes.refund, 'internal');

add('GET', '/api/admin/me', adminRoutes.me, 'admin');
add('GET', '/api/admin/users', adminRoutes.searchUsers, 'admin');
add('GET', '/api/admin/users/:id', adminRoutes.userDetail, 'admin');
add('GET', '/api/admin/users/:id/ledger', adminRoutes.userLedger, 'admin');
add('POST', '/api/admin/users/:id/suspend', adminRoutes.suspend, 'admin');
add('POST', '/api/admin/users/:id/unsuspend', adminRoutes.unsuspend, 'admin');
add('POST', '/api/admin/ledger/reverse', adminRoutes.reverse, 'super');
add('POST', '/api/admin/ledger/adjust', adminRoutes.adjust, 'super');
add('GET', '/api/admin/announcements', adminRoutes.listAnnouncements, 'admin');
add('POST', '/api/admin/announcements', adminRoutes.createAnnouncement, 'admin');
add('POST', '/api/admin/announcements/:id/deactivate', adminRoutes.deactivateAnnouncement, 'admin');
add('GET', '/api/admin/templates', adminRoutes.listTemplates, 'admin');
add('POST', '/api/admin/templates', adminRoutes.createTemplate, 'admin');
add('POST', '/api/admin/templates/:id/active', adminRoutes.setTemplateActive, 'admin');
add('GET', '/api/admin/shop/products', shopAdminRoutes.list, 'admin');
add('POST', '/api/admin/shop/products', shopAdminRoutes.save, 'super');
add('GET', '/api/admin/pass/products', passAdminRoutes.list, 'admin');
add('POST', '/api/admin/pass/products', passAdminRoutes.save, 'super');
add('GET', '/api/admin/audit', adminRoutes.audit, 'admin');
add('GET', '/api/admin/giftcard', adminRoutes.giftcard, 'admin');
add('GET', '/api/admin/admins', adminRoutes.listAdmins, 'super');
add('POST', '/api/admin/roles', adminRoutes.setRole, 'super');

const SEC = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

async function handleApi(req, env) {
  const url = new URL(req.url);
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const route = R.find((r) => r.m === method && r.re.test(url.pathname));
  if (!route) {
    if (R.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'method_not_allowed', 'Yöntem desteklenmiyor.');
    throw new HttpError(404, 'not_found', 'Bulunamadı.');
  }
  // CSRF: durum değiştiren isteklerde özel başlık + aynı kaynak (Origin) zorunlu. Çerez ayrıca SameSite=Strict'tir.
  if (method !== 'GET' && route.access !== 'internal' && route.access !== 'editor' && route.access !== 'pass' && route.access !== 'shop') {
    if (req.headers.get('x-nx-csrf') !== '1') throw new HttpError(403, 'csrf', 'Geçersiz istek.');
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'csrf', 'Geçersiz istek.');
  }
  const params = req.method === 'HEAD' ? {} : (route.re.exec(url.pathname).groups || {});
  let auth = null;
  if (route.access === 'user') {
    auth = await authenticate(env, req);
    if (!auth) throw new HttpError(401, 'unauthenticated', 'Oturum gerekli.');
  } else if (route.access === 'admin' || route.access === 'super') {
    auth = await requireAdmin(env, req, { superOnly: route.access === 'super' });
  } else if (route.access === 'public') {
    auth = await authenticate(env, req).catch(() => null); // logout için gerekli olabilir
  }
  // Tüm işleyiciler aynı imzayı alır: (req, env, url, auth, params).
  return route.h(req, env, url, auth, params);
}

// Ayrı siteler (kart editörü, Nexus Pass) için CORS: yalnızca EDITOR_URL / PASS_URL (+ *_ORIGINS) kaynağına izin verilir. Çerez gönderilmez; kimlik bilet/Bearer jetondadır.
const EDITOR_PATHS = new Set(['/api/editor/exchange', '/api/editor/card']);
const EDITOR_SHOP_PATHS = new Set(['/api/editor/shop-ticket']);
const PASS_PATHS = new Set(['/api/pass/exchange', '/api/pass/me', '/api/pass/products', '/api/pass/product', '/api/pass/purchases', '/api/pass/purchase']);
const SHOP_PATHS = new Set(['/api/shop/exchange', '/api/shop/me', '/api/shop/products', '/api/shop/product', '/api/shop/purchases', '/api/shop/purchase', '/api/shop/wishlist', '/api/shop/equip']);
const CORS_PATHS = new Set([...EDITOR_PATHS, ...EDITOR_SHOP_PATHS, ...PASS_PATHS, ...SHOP_PATHS]);
function siteCors(req, env, url) {
  if (!CORS_PATHS.has(url.pathname)) return null;
  const allowed = SHOP_PATHS.has(url.pathname) ? shopOrigins(env) : PASS_PATHS.has(url.pathname) ? passOrigins(env) : editorOrigins(env);
  const o = req.headers.get('origin') || '';
  if (!o || !allowed.includes(o)) return null;
  return { 'access-control-allow-origin': o, 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '86400', vary: 'Origin', 'cross-origin-resource-policy': 'cross-origin' };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    }
    const cors = siteCors(req, env, url);
    if (req.method === 'OPTIONS' && CORS_PATHS.has(url.pathname)) return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    try {
      const res = url.pathname.startsWith('/api/ext/timer-reward/')
        ? await externalCrystalRoutes.handle(req, env, url)
        : await handleApi(req, env);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
      if (cors) for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      if (!out.headers.has('cache-control')) out.headers.set('cache-control', 'no-store');
      return out;
    } catch (err) {
      const H = { ...SEC, ...(cors || {}) };
      if (err instanceof HttpError) {
        return json({ error: { code: err.code, message: err.message, ...(err.extra || {}) } }, err.status, H);
      }
      console.error('unhandled', err && err.stack ? err.stack : err);
      return json({ error: { code: 'server_error', message: 'Beklenmeyen bir hata oluştu.' } }, 500, H);
    }
  },
  // Cloudflare Cron Trigger (wrangler.toml [triggers]): Nexus oyun piyasasının fiyatını günceller.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cronTick(env));
  },
};
