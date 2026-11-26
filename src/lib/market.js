// Kristal borsası: çeyrek altın endeksi + döviz/gram/premium + oyun içi arz-talep.
// Harici veri referans olarak kullanılır; baz fiyatı ve geçiş hızı yumuşatılarak ani sıçramalar önlenir.
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
  initialPriceMicro: cfgNum(env, 'MARKET_INITIAL_PRICE_MICRO', 32000000), // başlangıç: 32,0000 FN/KRS
  reversionBps: cfgNum(env, 'MARKET_REVERSION_BPS', 200),    // eski simülasyon için geri çekim
  goldApiUrl: env.MARKET_GOLD_API_URL || '',
  goldRefreshMs: cfgNum(env, 'MARKET_GOLD_REFRESH_SEC', 300) * 1000,
  maxStepBps: cfgNum(env, 'MARKET_MAX_STEP_BPS', 150),      // normalde en fazla %1,50; BIST şoklarında dinamik yükselir
  shockStepBps: cfgNum(env, 'MARKET_SHOCK_STEP_BPS', 500),  // sert piyasa hareketlerinde en fazla %5
  bistApiUrl: env.MARKET_BIST_API_URL || (env.MARKET_GOLD_API_URL ? 'https://query1.finance.yahoo.com/v8/finance/chart/' : ''),
  retentionDays: cfgNum(env, 'MARKET_RETENTION_DAYS', 35),
});

// ---------- Altın + BIST verileriyle deterministik fiyat modeli ----------

const stateGet = async (env, key) => (await env.DB.prepare('SELECT value FROM market_state WHERE key = ?').bind(key).first())?.value ?? null;
const stateSet = (env, key, value, t) => env.DB.prepare(
  'INSERT INTO market_state (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
).bind(key, String(value), t).run();

function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function extractGoldQuote(json) {
  const k = json?.kurlar || {}, z = json?.ziynet_ve_diger || {};
  const quarter = num(z['Çeyrek (Yeni)']?.satis ?? z['Yeni Çeyrek']?.satis ?? z['Çeyrek']?.satis);
  const gram = num(k.ALTIN?.satis ?? k.GRAM?.satis ?? k['GRAM ALTIN']?.satis);
  const usd = num(k.USD?.satis ?? k['USD/TRY']?.satis ?? k.DOLAR?.satis);
  const silver = num(k.GUMUS?.satis ?? k.GÜMÜŞ?.satis ?? z['Gram Gümüş']?.satis);
  if (!quarter || !gram) return null;
  return { quarter, gram, usd, silver, ts: Date.now(), provider: json?.meta?.yayin_sahibi || 'Gramhane' };
}
async function getGoldQuote(env, c, t) {
  let cached = null;
  try { cached = JSON.parse(await stateGet(env, 'gold_quote') || 'null'); } catch {}
  if (c.goldApiUrl && (!cached || t - (cached.ts || 0) >= c.goldRefreshMs)) {
    try {
      const res = await fetch(c.goldApiUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'ForevyeNexus/1.0' }, signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const quote = extractGoldQuote(await res.json());
        if (quote) { quote.ts = t; cached = quote; await stateSet(env, 'gold_quote', JSON.stringify(quote), t); }
      }
    } catch (e) { console.warn('gold quote fetch failed', e?.message || e); }
  }
  return cached && cached.quarter && cached.gram ? cached : null;
}
async function getYahooDaily(symbol, c) {
  try {
    const url = `${c.bistApiUrl}${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'ForevyeNexus/1.0' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const j = await res.json(), result = j?.chart?.result?.[0], q = result?.indicators?.quote?.[0];
    const closes = (q?.close || []).filter((x) => Number.isFinite(x) && x > 0);
    const volumes = (q?.volume || []).filter((x) => Number.isFinite(x) && x > 0);
    if (closes.length < 2) return null;
    const ret = closes[closes.length - 1] / closes[closes.length - 2] - 1;
    const volumeRatio = volumes.length >= 2 ? volumes[volumes.length - 1] / volumes[volumes.length - 2] : 1;
    return { ret, volumeRatio, symbol, last: closes.at(-1) };
  } catch { return null; }
}
async function getBistSignals(env, c, t) {
  if (!c.bistApiUrl) return null;
  let cached = null;
  try { cached = JSON.parse(await stateGet(env, 'bist_signals') || 'null'); } catch {}
  if (!cached || t - (cached.ts || 0) >= c.goldRefreshMs) {
    const symbols = ['XU100.IS', 'XU030.IS', 'XBANK.IS', 'XUSIN.IS', 'USDTRY=X'];
    const data = await Promise.all(symbols.map((symbol) => getYahooDaily(symbol, c)));
    if (data.some(Boolean)) {
      cached = { ts: t, xu100: data[0], xu030: data[1], xbank: data[2], xusin: data[3], usdtry: data[4] };
      await stateSet(env, 'bist_signals', JSON.stringify(cached), t);
    }
  }
  return cached && t - cached.ts <= 24 * 60 * MIN ? cached : null;
}
function bistFactor(signals) {
  if (!signals) return { factor: 1, shockBps: 0, detail: 'BIST verisi bulunamadı' };
  const ret = (x) => Math.max(-0.12, Math.min(0.12, Number(x?.ret || 0)));
  const vol = (x) => Math.max(-0.5, Math.min(2, Number(x?.volumeRatio || 1) - 1));
  // Endeks getirileri doğrudan etkiler: BIST100 20%, BIST30 12%, Banka 8%, Sanayi 6%.
  // USD/TRY artışı altın/TL etkisi olarak +10%; hacim şişmesi yönlü hareketi güçlendirir.
  const impact = ret(signals.xu100) * 0.20 + ret(signals.xu030) * 0.12
    + ret(signals.xbank) * 0.08 + ret(signals.xusin) * 0.06
    + ret(signals.usdtry) * 0.10 + vol(signals.xu100) * 0.015;
  const shock = Math.max(Math.abs(ret(signals.xu100)), Math.abs(ret(signals.xbank)), Math.abs(ret(signals.xusin)));
  return { factor: Math.max(0.90, Math.min(1.10, 1 + impact)), shockBps: Math.round(shock * 10000), detail: `BIST endeksleri: ${(impact * 100).toFixed(2)}%` };
}

async function marketFlowFactor(env, t) {
  // Son 6 saatteki alış/satış miktarı; işlem yönü baskısı fiyat hedefine küçük etki eder.
  const since = t - 6 * 60 * MIN;
  try {
    const r = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN side='buy' THEN qty ELSE 0 END),0) AS buys,
      COALESCE(SUM(CASE WHEN side='sell' THEN qty ELSE 0 END),0) AS sells FROM crystal_trades WHERE created_at >= ?`).bind(since).first();
    const buys = Number(r?.buys || 0), sells = Number(r?.sells || 0), total = buys + sells;
    const imbalance = total ? Math.max(-1, Math.min(1, (buys - sells) / total)) : 0;
    return 1 + imbalance * 0.025; // %2,5 maksimum hedef etkisi
  } catch { return 1; }
}
function goldTargetMicro(quote, base, bist, supplyFactor = 1) {
  // 32 FN yalnızca başlangıç ankrajıdır. Fiyatın 25'e dönmesi veya belirli aralıkta kalması zorlanmaz.
  const q = quote.quarter / base.quarter;
  const g = quote.gram / base.gram;
  const usd = quote.usd && base.usd ? quote.usd / base.usd : 1;
  const premiumNow = quote.quarter / (quote.gram * 1.75);
  const premiumBase = base.quarter / (base.gram * 1.75);
  const silverRatioNow = quote.silver ? quote.gram / quote.silver : 1;
  const silverRatioBase = base.silver ? base.gram / base.silver : 1;
  // Metal/FX kümülatif sinyali: toplam altın ağırlığı %55; BIST/FX eklenir.
  const goldFactor = Math.pow(q, 0.35) * Math.pow(g, 0.15) * Math.pow(usd, 0.10)
    * Math.pow(premiumNow / premiumBase, 0.05) * Math.pow(silverRatioNow / silverRatioBase, 0.05);
  return Math.round(32000000 * goldFactor * (bist?.factor || 1) * supplyFactor);
}

async function giftEmissionFactor(env, t) {
  // Dolaşımdaki KRS + hediye kodu/ödül kaynaklı mint. Hediye kaydı varsa; yoksa güvenli 1.0.
  try {
    const supplyRow = await env.DB.prepare('SELECT COALESCE(SUM(qty),0) AS supply FROM crystal_holdings').first();
    const supply = Math.max(0, Number(supplyRow?.supply || 0));
    const giftRow = await env.DB.prepare(`SELECT COALESCE(SUM(qty),0) AS minted FROM crystal_gifts WHERE created_at >= ?`).bind(t - 30 * 24 * 60 * MIN).first();
    const rewardRow = await env.DB.prepare(`SELECT COALESCE(SUM(qty),0) AS minted FROM crystal_reward_credits WHERE created_at >= ? AND applied_at IS NOT NULL`).bind(t - 30 * 24 * 60 * MIN).first().catch(() => ({ minted: 0 }));
    const minted = Math.max(0, Number(giftRow?.minted || 0) + Number(rewardRow?.minted || 0));
    // 30 günlük yeni arzın mevcut dolaşıma oranı; logaritmik etki, büyük mint olayları hissedilir ama fiyat sıfırlanmaz.
    const ratio = supply > 0 ? minted / supply : 0;
    return Math.pow(1 + ratio, -0.65);
  } catch { return 1; }
}

async function adminSentimentFactor(env, t) {
  try {
    const rows = (await env.DB.prepare('SELECT score FROM market_admin_sentiment ORDER BY day DESC LIMIT 7').all()).results;
    if (!rows.length) return { factor: 1, pressureBps: 0, average: 50 };
    const average = rows.reduce((sum, row) => sum + Number(row.score), 0) / rows.length;
    // 0 puan yaklaşık -%16,7; 100 puan +%20 denge hedefi etkisi.
    const factor = Math.pow(1.2, (average - 50) / 50);
    // Dış veri olmayan adımlarda hissedilen küçük yön baskısı; puan tek başına fiyatı kilitlemez.
    const pressureBps = Math.round((average - 50) * 0.35);
    return { factor, pressureBps, average: Math.round(average * 10) / 10 };
  } catch {
    // Migration uygulanmamışsa mevcut piyasa davranışı bozulmasın.
    return { factor: 1, pressureBps: 0, average: 50 };
  }
}

export async function refreshPrice(env) {
  const c = cfg(env), t = now(env), prev = await readLast(env);
  const validPrev = prev && Number.isSafeInteger(prev.price_micro) && prev.price_micro > 0;
  const previous = validPrev ? prev.price_micro : c.initialPriceMicro;
  const quote = await getGoldQuote(env, c, t);
  const signals = await getBistSignals(env, c, t);
  const bist = bistFactor(signals);
  let moveBps = 0, price_micro = previous, source = 'Nexus piyasası: dış veri geçici olarak yok';
  if (quote) {
    let base = null;
    try { base = JSON.parse(await stateGet(env, 'gold_baseline') || 'null'); } catch {}
    if (!base || !base.quarter || !base.gram) {
      base = { quarter: quote.quarter, gram: quote.gram, usd: quote.usd, silver: quote.silver, set_at: t };
      await stateSet(env, 'gold_baseline', JSON.stringify(base), t);
    }
    let bistBase = null;
    try { bistBase = JSON.parse(await stateGet(env, 'bist_baseline') || 'null'); } catch {}
    if (signals && !bistBase) {
      bistBase = { xu100: signals.xu100?.last, xu030: signals.xu030?.last, xbank: signals.xbank?.last, xusin: signals.xusin?.last, usdtry: signals.usdtry?.last, set_at: t };
      await stateSet(env, 'bist_baseline', JSON.stringify(bistBase), t);
    }
    // Endeksleri başlangıçtan beri olan hareketleriyle hesaba kat; günlük getiri her yenilemede tekrar birikmez.
    let bistCumulative = 1;
    if (signals && bistBase) {
      const ret = (x, b) => x?.last && b ? Math.max(0.05, x.last / b) : 1;
      bistCumulative = Math.pow(ret(signals.xu100, bistBase.xu100), 0.30)
        * Math.pow(ret(signals.xu030, bistBase.xu030), 0.18)
        * Math.pow(ret(signals.xbank, bistBase.xbank), 0.12)
        * Math.pow(ret(signals.xusin, bistBase.xusin), 0.10)
        * Math.pow(ret(signals.usdtry, bistBase.usdtry), 0.15);
    }
    const flow = await marketFlowFactor(env, t);
    const emission = await giftEmissionFactor(env, t);
    const target = Math.round(goldTargetMicro(quote, base, { factor: bistCumulative }, emission) * flow * sentiment.factor);
    // Dinamik fiyat keşfi: sabit 25'e geri dönüş, mutlak fiyat tavanı/tabanı yok. Hareket limiti yalnız tek adım içindir.
    const diffBps = ((target - previous) / previous) * 10000;
    const volatility = Math.max(150, Math.min(3000, Math.abs(diffBps)));
    const stepCap = (bist.shockBps >= 250 || Math.abs(diffBps) >= 1200) ? 3000 : Math.max(c.maxStepBps, 1200);
    moveBps = Math.round(diffBps * 0.45);
    moveBps = Math.max(-stepCap, Math.min(stepCap, moveBps));
    price_micro = Math.max(1, Math.round(previous * (10000 + moveBps) / 10000));
    source = `Çeyrek altın + BIST + USD/TRY + arz/talep + hediye emisyonu + yönetici güven endeksi (${sentiment.average}/100) (${quote.provider || 'altın verisi'})`;
  } else if (signals && validPrev) {
    // Altın servisi yokken de BIST/FX ve akış, fiyatı aşağı/yukarı taşıyabilir.
    const impactBps = Math.round((bist.factor - 1) * 10000);
    moveBps = Math.max(-3000, Math.min(3000, Math.round(impactBps * 0.45) + sentiment.pressureBps));
    price_micro = Math.max(1, Math.round(previous * (10000 + moveBps) / 10000));
    source = `BIST + USD/TRY + alım/satım akışı + yönetici güven endeksi (${sentiment.average}/100)`;
  } else if (env.MARKET_FALLBACK_ENABLED === 'true') {
    // Dış piyasa sağlayıcıları tanımlı/erişilebilir değilse borsa donmasın:
    // 5 dakikalık Cron adımlarında sanal piyasa dalgalanması + işlem akışı yön etkisi.
    // Güncelleme başına sınırlandırılmış oynaklık; fiyat sıfıra düşmez ve eski fiyat korunur.
    const fallbackVol = Math.max(10, Math.min(2500, cfgNum(env, 'MARKET_FALLBACK_VOLATILITY_BPS', 85)));
    const flow = await marketFlowFactor(env, t);
    const flowBps = Math.round((flow - 1) * 10000);
    const noiseBps = Math.round((Math.random() * 2 - 1) * fallbackVol);
    // Dış veri yokken 32 FN yalnızca yumuşak referans noktasıdır; puan bu dengeyi ± yönde değiştirir.
    // Yaklaşma hızı küçük tutulur; 1 veya 200 gibi fiyatlar da mümkündür, sert bir taban/tavan yoktur.
    const softAnchor = 32000000 * sentiment.factor;
    const anchorDriftBps = Math.round(Math.max(-fallbackVol, Math.min(fallbackVol, ((softAnchor - previous) / previous) * 10000 * 0.025)));
    moveBps = Math.max(-fallbackVol, Math.min(fallbackVol, noiseBps + anchorDriftBps + Math.max(-250, Math.min(250, flowBps)) + sentiment.pressureBps));
    price_micro = Math.max(1, Math.round(previous * (10000 + moveBps) / 10000));
    source = `Nexus sanal piyasa + alım/satım akışı + yönetici güven endeksi (${sentiment.average}/100) (dış fiyat kaynağı yok)`;
  }
  const last = { model: quote ? 'nexus-dynamic-market-v5' : signals ? 'nexus-dynamic-bist-v5' : 'nexus-market-stable-v3', ts: t, price_micro, source, move_bps: moveBps, gold_quote_ts: quote?.ts || null, bist_ts: signals?.ts || null };
  await stateSet(env, 'last_price', JSON.stringify(last), t);
  const lastSnap = await env.DB.prepare('SELECT ts FROM market_prices ORDER BY ts DESC LIMIT 1').first();
  if (!lastSnap || t - lastSnap.ts >= c.snapshotMs) {
    await env.DB.prepare('INSERT INTO market_prices (ts, gold_usd, price_micro, source) VALUES (?,?,?,?)').bind(t, quote?.quarter || 0, price_micro, source).run();
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
export async function trade(env, user, { side, qty: qtyIn, amountMinor, key, expectedMicro, cardId = null }) {
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

  let paymentCard = null;
  if (cardId) {
    if (side !== 'buy') throw new HttpError(400, 'invalid_card_source', 'Kart yalnızca kristal alımında ödeme kaynağı olabilir.');
    paymentCard = await env.DB.prepare('SELECT id, status, balance FROM cards WHERE id = ? AND user_id = ?').bind(cardId, user.id).first();
    if (!paymentCard) throw new HttpError(404, 'card_not_found', 'Seçilen kart bulunamadı.');
    if (paymentCard.status !== 'active') throw new HttpError(400, 'card_disabled', 'Devre dışı kartla borsa alımı yapılamaz.');
    if (paymentCard.balance < total) throw new HttpError(400, 'insufficient_card_funds', 'Seçilen kartta yeterli FN yok. Önce karta para yükleyin.');
  }

  const ref = newRef('NXM');
  const stmts = [
    guardActiveStmt(env, user.id),
    env.DB.prepare('INSERT INTO crystal_trades (id, ref, user_id, side, qty, price_micro, mid_micro, total, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), ref, user.id, side, qty, price, p.mid_micro, total, key, t),
  ];
  if (side === 'buy') {
    if (paymentCard) {
      stmts.push(
        env.DB.prepare(`SELECT json_extract(CASE WHEN EXISTS (
          SELECT 1 FROM cards WHERE id = ? AND user_id = ? AND status = 'active' AND balance >= ?
        ) THEN '{}' ELSE 'x' END, '$')`).bind(paymentCard.id, user.id, total),
        env.DB.prepare(`UPDATE cards SET balance = balance - ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'active'`).bind(total, t, paymentCard.id, user.id),
        env.DB.prepare(`INSERT INTO card_ledger
          (id, tx_ref, user_id, card_id, type, amount, balance_after, counterparty_id, idempotency_key, description, created_at)
          VALUES (?, ?, ?, ?, 'payment', ?, (SELECT balance FROM cards WHERE id = ? AND user_id = ?), NULL, ?, ?, ?)`)
          .bind(crypto.randomUUID(), ref, user.id, paymentCard.id, -total, paymentCard.id, user.id, `krs_${key}`, `Kristal alımı • ${fmtQty(qty)} KRS`, t),
      );
    } else {
      stmts.push(...entryStmts(env, { ref, userId: user.id, type: 'market_buy', amount: -total, desc: `Kristal alımı • ${fmtQty(qty)} KRS` }));
    }
    stmts.push(
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
    if (isConstraint(err, 'card_balance_nonneg')) throw new HttpError(400, 'insufficient_card_funds', 'Seçilen kartta yeterli FN yok. Önce karta para yükleyin.');
    if (isConstraint(err, 'crystal_nonneg')) throw new HttpError(400, 'insufficient_crystal', 'Yeterli kristaliniz yok.');
    if (isConstraint(err, 'trade_idem')) {
      const prior = await getTradeByKey(env, user.id, key);
      if (prior) return { ref: prior.ref, side: prior.side, qty: prior.qty, price_micro: prior.price_micro, total: prior.total, replayed: true };
    }
    if (String(err.message || err).includes('malformed JSON')) {
      if (paymentCard) {
        const latest = await env.DB.prepare('SELECT status, balance FROM cards WHERE id = ? AND user_id = ?').bind(paymentCard.id, user.id).first();
        if (!latest || latest.status !== 'active') throw new HttpError(400, 'card_disabled', 'Borsa alımı sırasında kart devre dışı bırakıldı.');
        if (latest.balance < total) throw new HttpError(400, 'insufficient_card_funds', 'Seçilen kartta yeterli FN yok. Önce karta para yükleyin.');
      }
      throw side === 'sell'
        ? new HttpError(400, 'insufficient_crystal', 'Yeterli kristaliniz yok veya hesap askıda.')
        : new HttpError(409, 'account_state_changed', 'Hesap durumu değişti; işlem yapılamadı.');
    }
    throw err;
  }
  const cardBalance = paymentCard ? Number((await env.DB.prepare('SELECT balance FROM cards WHERE id = ? AND user_id = ?').bind(paymentCard.id, user.id).first())?.balance || 0) : null;
  return { ref, side, qty, price_micro: price, total, replayed: false, ...(paymentCard ? { payment_method: 'card', card_id: paymentCard.id, card_balance: cardBalance } : { payment_method: 'wallet' }) };
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
