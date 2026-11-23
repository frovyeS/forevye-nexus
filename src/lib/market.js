// Kristal borsası: bağımsız oyun içi piyasa simülasyonu. Harici emtia/altın fiyatı kullanılmaz.
// Fiyat her piyasa güncellemesinde sınırlı volatiliteyle değişir; geçmiş D1 snapshot'larından çizilir.
import { HttpError, now, newRef, cfgNum, isConstraint, MIN } from './util.js';
import { notifyStmt } from './auth.js';
import { entryStmts, guardActiveStmt, fmtMinor } from './ledger.js';
import { perksOf, spreadFor } from './shop.js';

export const QTY_SCALE = 10000;        // 1 kristal = 10.000 birim (4 ondalık)
export const PRICE_SCALE = 1000000;    // 1 FN = 1.000.000 mikro
const COST_DIV = 100000000n;           // qty * price_micro / 1e8 = FN minor
export const ASSET = { name: 'Kristal', code: 'KRS' };

export const cfg = (env) => ({
  refreshMs: cfgNum(env, 'MARKET_REFRESH_SEC', 60) * 1000,
  snapshotMs: cfgNum(env, 'MARKET_SNAPSHOT_SEC', 300) * 1000,
  staleMs: cfgNum(env, 'MARKET_STALE_SEC', 900) * 1000,
  spreadBps: cfgNum(env, 'MARKET_SPREAD_BPS', 50),            // her iki yön için orta fiyattan sapma
  maxTradeMinor: cfgNum(env, 'MARKET_MAX_TRADE_MINOR', 1000000),
  slipBps: cfgNum(env, 'MARKET_SLIPPAGE_BPS', 100),           // istemcinin gördüğü fiyattan en fazla %1 sapma
  volatilityBps: cfgNum(env, 'MARKET_VOLATILITY_BPS', 45),   // güncelleme başına azami ±%0,45
  initialPriceMicro: cfgNum(env, 'MARKET_INITIAL_PRICE_MICRO', 25000000), // başlangıç: 25,0000 FN/KRS
  reversionBps: cfgNum(env, 'MARKET_REVERSION_BPS', 200),    // başlangıç fiyatından sapmanın güncelleme başına %2'si geri çekilir (fiyat sonsuza kaçmaz)
  retentionDays: cfgNum(env, 'MARKET_RETENTION_DAYS', 35),
});

// ---------- Oyun içi fiyat modeli ----------
function randomInt(max) {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % (max + 1);
}

const stateGet = async (env, key) => (await env.DB.prepare('SELECT value FROM market_state WHERE key = ?').bind(key).first())?.value ?? null;
const stateSet = (env, key, value, t) => env.DB.prepare(
  'INSERT INTO market_state (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
).bind(key, String(value), t).run();

// Her güncellemede önceki fiyata küçük ve sınırlı bir piyasa hareketi uygulanır.
// İlk fiyat sabit ve açıkça tanımlıdır; 1 FN varsayımı veya dış fiyat referansı yoktur.
export async function refreshPrice(env) {
  const c = cfg(env);
  const t = now(env);
  const prev = await readLast(env);
  const validPrev = prev && prev.model === 'nexus-market-v2' && Number.isSafeInteger(prev.price_micro) && prev.price_micro > 0;
  const previous = validPrev ? prev.price_micro : c.initialPriceMicro;
  const maxBps = Math.max(1, Math.min(500, c.volatilityBps));
  const base = Math.max(10000, c.initialPriceMicro);
  // Rastgele adım + başlangıç fiyatına doğru hafif geri çekim: fiyat serbestçe dolaşır ama sonsuza kaçmaz.
  let moveBps = validPrev ? randomInt(maxBps * 2) - maxBps : 0;
  if (validPrev) {
    const gapBps = ((base - previous) / previous) * 10000;
    moveBps += Math.max(-maxBps, Math.min(maxBps, Math.round((gapBps * Math.max(0, c.reversionBps)) / 10000)));
  }
  // Sürekli aynı değere takılmaması için sıfır hareket nadiren küçük bir adımla değiştirilir.
  if (validPrev && moveBps === 0) moveBps = randomInt(1) ? 1 : -1;
  const floor = Math.max(10000, Math.round(base / 10)), ceil = Math.min(1000000000000, base * 10);
  const price_micro = Math.max(floor, Math.min(ceil, Math.round(previous * (10000 + moveBps) / 10000)));
  const last = { model: 'nexus-market-v2', ts: t, price_micro, source: 'Nexus oyun piyasası', move_bps: moveBps };
  await stateSet(env, 'last_price', JSON.stringify(last), t);
  const lastSnap = await env.DB.prepare('SELECT ts FROM market_prices ORDER BY ts DESC LIMIT 1').first();
  if (!lastSnap || t - lastSnap.ts >= c.snapshotMs) {
    await env.DB.prepare('INSERT INTO market_prices (ts, gold_usd, price_micro, source) VALUES (?,?,?,?)').bind(t, 0, price_micro, 'Nexus oyun piyasası').run();
  }
  return last;
}

async function readLast(env) {
  const raw = await stateGet(env, 'last_price');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Güncel fiyat: önbellek tazeyse onu, değilse yeni simülasyon adımını üretir. Yenileme altyapısı hata verirse son fiyat korunur.
export async function currentPrice(env, { refresh = true, spreadBps } = {}) {
  const c = cfg(env);
  const t = now(env);
  let last = await readLast(env);
  if (refresh && (!last || t - last.ts >= c.refreshMs)) {
    try { last = await refreshPrice(env); } catch (e) { console.error('market refresh failed', e && e.message); }
  }
  if (!last) return null;
  const mid = last.price_micro;
  const half = spreadBps ?? c.spreadBps;
  const buy = Math.ceil((mid * (10000 + half)) / 10000);
  const sell = Math.max(1, Math.floor((mid * (10000 - half)) / 10000));
  return { ...last, mid_micro: mid, buy_micro: buy, sell_micro: sell, spread_bps: half, stale: t - last.ts > c.staleMs, age_ms: t - last.ts };
}

export async function pruneOld(env) {
  const cutoff = now(env) - cfg(env).retentionDays * 24 * 60 * MIN;
  await env.DB.prepare('DELETE FROM market_prices WHERE ts < ?').bind(cutoff).run();
}

// Cron (her 5 dk): fiyatı yeniler, eski kayıtları temizler.
export async function cronTick(env) {
  try { await refreshPrice(env); } catch (e) { console.error('cron refresh failed', e && e.message); }
  await pruneOld(env).catch(() => {});
}

export async function history(env, rangeKey) {
  const spans = { '1d': 24, '7d': 24 * 7, '30d': 24 * 30 };
  const hours = spans[rangeKey];
  if (!hours) throw new HttpError(400, 'invalid_range', 'Geçersiz aralık.');
  const since = now(env) - hours * 60 * MIN;
  const rows = (await env.DB.prepare('SELECT ts, price_micro FROM market_prices WHERE ts >= ? ORDER BY ts ASC').bind(since).all()).results;
  const step = Math.max(1, Math.ceil(rows.length / 180)); // en fazla ~180 nokta
  const pts = rows.filter((_, i) => i % step === 0 || i === rows.length - 1).map((r) => [r.ts, r.price_micro]);
  return pts;
}

export async function stats24h(env, mid) {
  const since = now(env) - 24 * 60 * MIN;
  const ref = (await env.DB.prepare('SELECT price_micro FROM market_prices WHERE ts <= ? ORDER BY ts DESC LIMIT 1').bind(since).first())
    || (await env.DB.prepare('SELECT price_micro FROM market_prices ORDER BY ts ASC LIMIT 1').first());
  const hl = await env.DB.prepare('SELECT MAX(price_micro) AS hi, MIN(price_micro) AS lo FROM market_prices WHERE ts >= ?').bind(since).first();
  const open = ref?.price_micro ?? mid;
  return {
    change_pct: open ? Math.round(((mid - open) / open) * 10000) / 100 : 0,
    high_micro: Math.max(hl?.hi ?? mid, mid), low_micro: Math.min(hl?.lo ?? mid, mid),
  };
}

// ---------- Tutar hesapları (BigInt: taşma yok) ----------
export const costBuy = (qty, priceMicro) => Number((BigInt(qty) * BigInt(priceMicro) + COST_DIV - 1n) / COST_DIV);   // alıcı aşağı yuvarlanmaz
export const proceedsSell = (qty, priceMicro) => Number((BigInt(qty) * BigInt(priceMicro)) / COST_DIV);               // satıcıya aşağı yuvarlanır
export const qtyForSpend = (minor, priceMicro) => Number((BigInt(minor) * COST_DIV) / BigInt(priceMicro));
export const qtyForProceeds = (minor, priceMicro) => Number((BigInt(minor) * COST_DIV + BigInt(priceMicro) - 1n) / BigInt(priceMicro));

// "1.2345" -> 12345 (en fazla 4 ondalık)
export function parseQty(v) {
  const s = typeof v === 'number' ? String(v) : v;
  if (typeof s !== 'string' || !/^\d{1,6}(\.\d{1,4})?$/.test(s.trim())) throw new HttpError(400, 'invalid_qty', 'Geçersiz kristal miktarı (en fazla 4 ondalık).');
  const [i, f = ''] = s.trim().split('.');
  const q = Number(i) * QTY_SCALE + Number(f.padEnd(4, '0'));
  if (!Number.isSafeInteger(q) || q <= 0) throw new HttpError(400, 'invalid_qty', 'Miktar sıfırdan büyük olmalı.');
  return q;
}
export const fmtQty = (q) => (q / QTY_SCALE).toFixed(4);

export async function holdingOf(env, userId) {
  const r = await env.DB.prepare('SELECT qty, cost_basis FROM crystal_holdings WHERE user_id = ?').bind(userId).first();
  return r || { qty: 0, cost_basis: 0 };
}

export async function getTradeByKey(env, userId, key) {
  return env.DB.prepare('SELECT ref, side, qty, price_micro, total FROM crystal_trades WHERE user_id = ? AND idempotency_key = ?').bind(userId, key).first();
}

// Tek atomik işlem: cüzdan + defter + kristal bakiyesi + işlem kaydı birlikte yazılır ya da hiç yazılmaz.
export async function trade(env, user, { side, qty: qtyIn, amountMinor, key, expectedMicro }) {
  const c = cfg(env);
  const t = now(env);
  const p = await currentPrice(env, { spreadBps: spreadFor(env, await perksOf(env, user.id)) });   // Platin/Black kartı: daha dar alış-satış farkı
  if (!p) throw new HttpError(503, 'market_unavailable', 'Borsa şu an kullanılamıyor.');
  if (p.stale) throw new HttpError(503, 'market_stale', 'Fiyat verisi güncel değil; işlemler geçici olarak durduruldu.');
  const price = side === 'buy' ? p.buy_micro : p.sell_micro;
  if (expectedMicro !== undefined && expectedMicro !== null) {
    const dev = (Math.abs(price - expectedMicro) * 10000) / expectedMicro;
    if (dev > c.slipBps) throw new HttpError(409, 'price_moved', 'Fiyat değişti. Yeni fiyatı kontrol edip tekrar onaylayın.', { price_micro: price });
  }
  let qty = qtyIn;
  if (qty === undefined) qty = side === 'buy' ? qtyForSpend(amountMinor, price) : qtyForProceeds(amountMinor, price);
  if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 1e9) throw new HttpError(400, 'invalid_qty', 'Miktar çok küçük veya geçersiz.');
  const total = side === 'buy' ? costBuy(qty, price) : proceedsSell(qty, price);
  if (total < 1) throw new HttpError(400, 'too_small', 'İşlem tutarı çok küçük.');
  if (total > c.maxTradeMinor) throw new HttpError(400, 'limit_exceeded', `İşlem başına en fazla ${fmtMinor(c.maxTradeMinor)} FN değerinde işlem yapabilirsiniz.`);

  const ref = newRef('NXM');
  const stmts = [
    guardActiveStmt(env, user.id),
    env.DB.prepare('INSERT INTO crystal_trades (id, ref, user_id, side, qty, price_micro, mid_micro, total, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), ref, user.id, side, qty, price, p.mid_micro, total, key, t),
  ];
  if (side === 'buy') {
    stmts.push(
      ...entryStmts(env, { ref, userId: user.id, type: 'market_buy', amount: -total, desc: `Kristal alımı • ${fmtQty(qty)} KRS` }),
      env.DB.prepare(`INSERT INTO crystal_holdings (user_id, qty, cost_basis, updated_at) VALUES (?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET qty = qty + excluded.qty, cost_basis = cost_basis + excluded.cost_basis, updated_at = excluded.updated_at`).bind(user.id, qty, total, t),
      notifyStmt(env, user.id, 'market_buy', 'Kristal alındı', `${fmtQty(qty)} kristal ${fmtMinor(total)} FN karşılığında alındı. Ref: ${ref}`),
    );
  } else {
    // Yeterli kristal yoksa SQL hatası üretip tüm işlemi geri alır (satılmayan kristal için FN yüklenemez).
    stmts.push(
      env.DB.prepare(`SELECT json_extract(CASE WHEN EXISTS (SELECT 1 FROM crystal_holdings WHERE user_id = ? AND qty >= ?) THEN '{}' ELSE 'x' END, '$')`).bind(user.id, qty),
      env.DB.prepare(`UPDATE crystal_holdings SET cost_basis = cost_basis - CAST(cost_basis * 1.0 * ? / qty AS INTEGER), qty = qty - ?, updated_at = ? WHERE user_id = ?`).bind(qty, qty, t, user.id),
      ...entryStmts(env, { ref, userId: user.id, type: 'market_sell', amount: total, desc: `Kristal satışı • ${fmtQty(qty)} KRS` }),
      notifyStmt(env, user.id, 'market_sell', 'Kristal satıldı', `${fmtQty(qty)} kristal ${fmtMinor(total)} FN karşılığında satıldı. Ref: ${ref}`),
    );
  }
  try {
    await env.DB.batch(stmts);
  } catch (err) {
    if (isConstraint(err, 'wallet_nonneg')) throw new HttpError(400, 'insufficient_funds', 'Yetersiz bakiye.');
    if (isConstraint(err, 'crystal_nonneg')) throw new HttpError(400, 'insufficient_crystal', 'Yeterli kristaliniz yok.');
    if (isConstraint(err, 'trade_idem')) {
      const prior = await getTradeByKey(env, user.id, key);
      if (prior) return { ref: prior.ref, side: prior.side, qty: prior.qty, price_micro: prior.price_micro, total: prior.total, replayed: true };
    }
    if (String(err.message || err).includes('malformed JSON')) {
      throw side === 'sell'
        ? new HttpError(400, 'insufficient_crystal', 'Yeterli kristaliniz yok veya hesap askıda.')
        : new HttpError(409, 'account_state_changed', 'Hesap durumu değişti; işlem yapılamadı.');
    }
    throw err;
  }
  return { ref, side, qty, price_micro: price, total, replayed: false };
}

// Hediye kartı: kullanıcının KRİSTAL bakiyesine doğrudan ekler (FN defterine dokunmaz). `ref` (Mikro-Klima referansı) başına bir kez işlenir.
// Tablo migration (0008_crystal_gifts.sql) uygulanmadıysa ilk çağrıda kendiliğinden kurulur.
const GIFT_SCHEMA_OK = new WeakSet();
async function ensureGiftSchema(env) {
  if (GIFT_SCHEMA_OK.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS crystal_gifts (ref TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), qty INTEGER NOT NULL CHECK (qty > 0), created_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_crystal_gifts_user ON crystal_gifts(user_id, created_at DESC)'),
    env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS crystal_gifts_no_update BEFORE UPDATE ON crystal_gifts BEGIN SELECT RAISE(ABORT, 'crystal_gifts are append-only'); END`),
    env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS crystal_gifts_no_delete BEFORE DELETE ON crystal_gifts BEGIN SELECT RAISE(ABORT, 'crystal_gifts are append-only'); END`),
  ]);
  GIFT_SCHEMA_OK.add(env.DB);
}

export async function creditGiftCrystals(env, { userId, kristal, ref }) {
  if (!Number.isSafeInteger(kristal) || kristal <= 0 || kristal > 1000000) throw new HttpError(503, 'giftcard_unavailable', 'Hediye kartı hizmeti şu an kullanılamıyor. (Kod: GC-SRV)');
  const qty = kristal * QTY_SCALE;
  await ensureGiftSchema(env);
  const done = async () => {
    const row = await env.DB.prepare('SELECT user_id, qty FROM crystal_gifts WHERE ref = ?').bind(ref).first();
    if (!row) return null;
    if (row.user_id !== userId) throw new HttpError(400, 'giftcard_rejected', 'Bu kod daha önce kullanılmış.');
    return { replayed: true, qty: row.qty };
  };
  const prior = await done();
  if (prior) return prior;
  const t = now(env);
  try {
    await env.DB.batch([
      guardActiveStmt(env, userId),
      env.DB.prepare('INSERT INTO crystal_gifts (ref, user_id, qty, created_at) VALUES (?,?,?,?)').bind(ref, userId, qty, t),
      env.DB.prepare(`INSERT INTO crystal_holdings (user_id, qty, cost_basis, updated_at) VALUES (?,?,0,?)
        ON CONFLICT(user_id) DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at`).bind(userId, qty, t),
      notifyStmt(env, userId, 'gift_crystal', 'Hediye kristal yüklendi', `${kristal} kristal hesabına eklendi.`),
    ]);
  } catch (err) {
    if (isConstraint(err, 'crystal_gifts.ref')) { const again = await done(); if (again) return again; }
    throw err;
  }
  return { replayed: false, qty };
}
