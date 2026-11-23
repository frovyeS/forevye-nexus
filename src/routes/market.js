import { HttpError, json, readJson, parseAmount, str, MIN } from '../lib/util.js';
import { rateLimit } from '../lib/rate.js';
import { currentPrice, stats24h, history, holdingOf, parseQty, trade, getTradeByKey, ASSET, cfg, QTY_SCALE, PRICE_SCALE } from '../lib/market.js';
import { balanceOf } from './wallet.js';
import { grantAchievement } from './misc.js';
import { perksOf, spreadFor } from '../lib/shop.js';

const publicPrice = (env, p) => ({
  price_micro: p.mid_micro, buy_micro: p.buy_micro, sell_micro: p.sell_micro, spread_bps: p.spread_bps,
  updated_at: p.ts, stale: p.stale, source: p.source, move_bps: p.move_bps,
});

function position(h, p) {
  // Değerleme satış fiyatıyla yapılır (gerçekte elde edilecek tutar).
  const value = Number((BigInt(h.qty) * BigInt(p.sell_micro)) / 100000000n);
  return { qty: h.qty, cost_minor: h.cost_basis, value_minor: value, pnl_minor: value - h.cost_basis,
    avg_cost_micro: h.qty ? Math.round((h.cost_basis * 100000000) / h.qty) : 0 };
}

export const marketRoutes = {
  async overview(req, env, url, { user }) {
    const p = await currentPrice(env, { spreadBps: spreadFor(env, await perksOf(env, user.id)) });
    const c = cfg(env);
    const meta = { asset: ASSET, currency: env.CURRENCY_CODE || 'FN', qty_scale: QTY_SCALE, price_scale: PRICE_SCALE, max_trade_minor: c.maxTradeMinor };
    if (!p) return json({ ...meta, available: false });
    const [st, h] = await Promise.all([stats24h(env, p.mid_micro), holdingOf(env, user.id)]);
    return json({ ...meta, available: true, tradable: !p.stale, ...publicPrice(env, p), ...st, you: position(h, p), balance: await balanceOf(env, user.id) });
  },

  async history(req, env, url) {
    const pts = await history(env, url.searchParams.get('range') || '1d');
    return json({ range: url.searchParams.get('range') || '1d', points: pts });
  },

  async trades(req, env, url, { user }) {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);
    const rows = (await env.DB.prepare('SELECT ref, side, qty, price_micro, total, created_at FROM crystal_trades WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').bind(user.id, limit).all()).results;
    return json({ items: rows });
  },

  // Kullanıcı yalnızca yön + miktar (kristal) YA DA tutar (FN) gönderir; fiyatı SUNUCU belirler.
  async trade(req, env, url, { user }) {
    const b = await readJson(req);
    await rateLimit(env, `trade:${user.id}`, 30, 10 * MIN);
    const key = b.idempotency_key;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw new HttpError(400, 'invalid_key', 'İşlem anahtarı eksik veya geçersiz.');
    if (b.side !== 'buy' && b.side !== 'sell') throw new HttpError(400, 'invalid_side', 'İşlem yönü geçersiz.');
    const cardId = b.card_id ? str(b.card_id, { min: 8, max: 64, name: 'card_id' }) : null;
    if (cardId && b.side !== 'buy') throw new HttpError(400, 'invalid_card_source', 'Kart yalnızca kristal alımında ödeme kaynağı olabilir.');
    if ((b.qty === undefined) === (b.amount === undefined)) throw new HttpError(400, 'invalid', 'Miktar (qty) ya da tutar (amount) girin; ikisini birden değil.');
    const args = { side: b.side, key };
    if (b.qty !== undefined) args.qty = parseQty(b.qty); else args.amountMinor = parseAmount(b.amount);
    if (b.expected_price_micro !== undefined) {
      const e = Number(b.expected_price_micro);
      if (!Number.isSafeInteger(e) || e <= 0) throw new HttpError(400, 'invalid', 'Beklenen fiyat geçersiz.');
      args.expectedMicro = e;
    }
    // Aynı anahtarla tekrar: aynı sonucu döndür (çift işlem olmaz).
    const prior = await getTradeByKey(env, user.id, key);
    if (prior) {
      if (prior.side !== b.side) throw new HttpError(409, 'key_reuse', 'Bu işlem anahtarı farklı bir istek için kullanılmış.');
      const priorCard = await env.DB.prepare("SELECT card_id FROM card_ledger WHERE tx_ref = ? AND user_id = ? AND type = 'payment' AND amount < 0").bind(prior.ref, user.id).first();
      if ((priorCard?.card_id || null) !== cardId) throw new HttpError(409, 'key_reuse', 'Bu işlem anahtarı farklı bir ödeme kaynağı için kullanılmış.');
      return json({ ok: true, ...prior, price_micro: prior.price_micro, replayed: true, balance: await balanceOf(env, user.id), ...(priorCard ? { payment_method: 'card', card_id: priorCard.card_id } : { payment_method: 'wallet' }) });
    }
    if (cardId) args.cardId = cardId;
    const r = await trade(env, user, args);
    if (!r.replayed && r.side === 'buy') await grantAchievement(env, user.id, 'first_crystal');
    return json({ ok: true, ...r, balance: await balanceOf(env, user.id) }, r.replayed ? 200 : 201);
  },
};
