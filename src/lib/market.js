// Kristal borsası. Kristal, oyun dünyasının "altın"ıdır; fiyatı şimdilik GERÇEK ALTIN (XAU/USD) takip eder.
// Baz: ilk başarılı fiyat çekiminde (veya GOLD_BASE_USD ile sabitlenen) altın fiyatı = 1 FN.
//   kristal_fiyatı(FN) = güncel_altın_USD / baz_altın_USD
// Gerçek para yoktur; bu bir oyun içi ekonomi simülasyonudur.
import { HttpError, now, newRef, cfgNum, isConstraint, MIN } from './util.js';
import { notifyStmt } from './auth.js';
import { entryStmts, guardActiveStmt, fmtMinor } from './ledger.js';

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
  maxJumpPct: cfgNum(env, 'MARKET_MAX_JUMP_PCT', 25),         // tek adımda bundan büyük sıçrama anomali sayılır
  retentionDays: cfgNum(env, 'MARKET_RETENTION_DAYS', 35),
});

// ---------- Fiyat kaynağı ----------
function pickNumber(j) {
  const cands = [j?.price, j?.priceUsd, j?.rate, j?.ask, j?.chart?.result?.[0]?.meta?.regularMarketPrice];
  for (const c of cands) { const n = Number(c); if (Number.isFinite(n)) return n; }
  return NaN;
}

async function fetchGold(env) {
  if (env.ENVIRONMENT === 'test') {
    if (env.__GOLD === undefined) throw new Error('test: altın fiyatı yok');
    const v = typeof env.__GOLD === 'function' ? await env.__GOLD() : env.__GOLD;
    return { usd: Number(v), source: 'test' };
  }
  const urls = [env.GOLD_API_URL || 'https://api.gold-api.com/price/XAU', env.GOLD_API_URL_2 || 'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=1d&interval=5m'];
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'forevye-nexus/1.1' }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const usd = pickNumber(await res.json());
      if (!Number.isFinite(usd) || usd < 100 || usd > 100000) throw new Error('geçersiz fiyat');
      return { usd, source: new URL(url).hostname };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('altın fiyatı alınamadı');
}

const stateGet = async (env, key) => (await env.DB.prepare('SELECT value FROM market_state WHERE key = ?').bind(key).first())?.value ?? null;
const stateSet = (env, key, value, t) => env.DB.prepare(
  'INSERT INTO market_state (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
).bind(key, String(value), t).run();

// Baz fiyat: sabitlenmişse onu, değilse ilk görülen fiyatı kalıcı yazar (yarış durumunda ilk yazan kazanır).
export async function getBase(env, spotUsd) {
  const pinned = Number(env.GOLD_BASE_USD);
  if (Number.isFinite(pinned) && pinned > 0) return pinned;
  let v = await stateGet(env, 'gold_base_usd');
  if (v === null && spotUsd) {
    await env.DB.prepare('INSERT OR IGNORE INTO market_state (key, value, updated_at) VALUES (?,?,?)').bind('gold_base_usd', String(spotUsd), now(env)).run();
    v = await stateGet(env, 'gold_base_usd');
  }
  return v === null ? null : Number(v);
}

const toMicro = (spot, base) => Math.max(1, Math.round((spot / base) * PRICE_SCALE));

async function readLast(env) {
  const raw = await stateGet(env, 'last_price');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Yeni fiyat çeker, önbelleği günceller, gerekirse geçmişe satır ekler. Hata olursa eski fiyatı korur.
export async function refreshPrice(env) {
  const c = cfg(env);
  const t = now(env);
  const prev = await readLast(env);
  const { usd, source } = await fetchGold(env);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error('geçersiz fiyat');
  if (prev && Math.abs(usd - prev.gold_usd) / prev.gold_usd * 100 > c.maxJumpPct) {
    throw new Error(`anomali: ${prev.gold_usd} -> ${usd}`); // yanlış birim/bozuk veri koruması
  }
  const base = await getBase(env, usd);
  const last = { ts: t, gold_usd: usd, price_micro: toMicro(usd, base), source };
  await stateSet(env, 'last_price', JSON.stringify(last), t);
  const lastSnap = await env.DB.prepare('SELECT ts FROM market_prices ORDER BY ts DESC LIMIT 1').first();
  if (!lastSnap || t - lastSnap.ts >= c.snapshotMs) {
    await env.DB.prepare('INSERT INTO market_prices (ts, gold_usd, price_micro, source) VALUES (?,?,?,?)').bind(t, usd, last.price_micro, source).run();
  }
  return last;
}

// Güncel fiyat: önbellek tazeyse onu, değilse yenisini döndürür. Kaynak çökerse son bilinen fiyat "bayat" işaretiyle döner.
export async function currentPrice(env, { refresh = true } = {}) {
  const c = cfg(env);
  const t = now(env);
  let last = await readLast(env);
  if (refresh && (!last || t - last.ts >= c.refreshMs)) {
    try { last = await refreshPrice(env); } catch (e) { console.error('market refresh failed', e && e.message); }
  }
  if (!last) return null;
  const base = await getBase(env, null);
  const mid = last.price_micro;
  const half = c.spreadBps;
  const buy = Math.ceil((mid * (10000 + half)) / 10000);
  const sell = Math.max(1, Math.floor((mid * (10000 - half)) / 10000));
  return { ...last, base_usd: base, mid_micro: mid, buy_micro: buy, sell_micro: sell, spread_bps: half, stale: t - last.ts > c.staleMs, age_ms: t - last.ts };
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
  const p = await currentPrice(env);
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
