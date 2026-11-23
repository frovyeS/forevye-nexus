// Hediye kartı entegrasyon katmanı.
//
// Kart sistemi Mikro-Klima Worker'ında durur (kristal kartı: 8 haneli no + 3 haneli CVV + AA/YY).
// Kod doğrulama / süre / tek kullanım orada kalır; burası yalnızca ince bir bağdaştırıcıdır.
//   GET  {GIFTCARD_API_URL}/api/ext/giftcard/health
//   POST {GIFTCARD_API_URL}/api/ext/giftcard/redeem
//   Başlıklar: x-nx-timestamp (ms), x-nx-signature = HMAC-SHA256(GIFTCARD_API_SECRET, `${timestamp}.${gövde}`)
//   Gövde: { user_id, code, idempotency_key }
//   Yanıt 200: { ok: true, amount, unit: 'kristal', reference }   (unit yoksa amount zaten FN minor unit sayılır)
//   Yanıt 4xx: { ok: false, error: "invalid" | "used" | "expired" | "rate_limited" }
// Kristal -> FN dönüşümü GIFTCARD_MINOR_PER_KRISTAL ile yapılır (varsayılan 100 = 1 kristal 1 FN).
// Bakiye yükleme (defter kaydı) bu uygulamada reference ile tekrar-güvenli yapılır.
import { hmacHex } from '../lib/crypto.js';
import { HttpError, now } from '../lib/util.js';
import { mikroFetch } from '../lib/upstream.js';

const baseUrl = (env) => String(env.GIFTCARD_API_URL || '').trim().replace(/\/+$/, '');
const urlOk = (env) => /^https:\/\/[^\s/]+/i.test(baseUrl(env));

export function giftcardConfigured(env) {
  return Boolean(urlOk(env) && env.GIFTCARD_API_SECRET);
}

// Kullanıcıya gösterilen genel mesaja kısa bir neden kodu eklenir (gizli bilgi içermez); asıl ayrıntı loglardadır.
//   GC-URL  : GIFTCARD_API_URL tanımsız ya da https:// ile başlamıyor
//   GC-KEY  : GIFTCARD_API_SECRET tanımsız
//   GC-NET  : Mikro-Klima Worker'ına ulaşılamadı / zaman aşımı (adres yanlış olabilir)
//   GC-AUTH : imza reddedildi (iki taraftaki gizli değer aynı değil)
//   GC-SRV  : Mikro-Klima'da NEXUS_SECRET tanımsız ya da sunucu hatası
//   GC-PATH : adres yanlış (404/405/HTML yanıt): GIFTCARD_API_URL Mikro-Klima Worker'ını göstermiyor
const unavailable = (code) => new HttpError(503, 'giftcard_unavailable', `Hediye kartı hizmeti şu an kullanılamıyor. (Kod: ${code})`);

function missingReason(env) {
  if (!urlOk(env)) return 'GC-URL';
  if (!env.GIFTCARD_API_SECRET) return 'GC-KEY';
  return null;
}

export async function giftcardStatus(env) {
  const miss = missingReason(env);
  if (miss) return { connected: false, reason: miss, detail: miss === 'GC-URL' ? 'GIFTCARD_API_URL tanımlı değil ya da https:// ile başlamıyor.' : 'GIFTCARD_API_SECRET tanımlı değil (npx wrangler secret put GIFTCARD_API_SECRET).' };
  try {
    const res = await mikroFetch(env, `${baseUrl(env)}/api/ext/giftcard/health`, { method: 'GET' }, 6000);
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok === true) return { connected: true, detail: 'Modül erişilebilir.' };
    return { connected: false, reason: 'GC-PATH', detail: `Adres Mikro-Klima Worker'ını göstermiyor olabilir (yanıt: ${res.status}).` };
  } catch (e) {
    console.log('[giftcard:health]', String(e && e.message || e).slice(0, 200));
    return { connected: false, reason: 'GC-NET', detail: 'Modüle ulaşılamadı (adres yanlış ya da Worker kapalı).' };
  }
}

export async function redeemViaExistingModule(env, { userId, code, idempotencyKey }) {
  const miss = missingReason(env);
  if (miss) { console.log('[giftcard:redeem] yapılandırma eksik', miss); throw unavailable(miss); }
  const body = JSON.stringify({ user_id: userId, code, idempotency_key: idempotencyKey });
  const ts = String(now(env));
  const sig = await hmacHex(env.GIFTCARD_API_SECRET, `${ts}.${body}`);
  let res;
  try {
    res = await mikroFetch(env, `${baseUrl(env)}/api/ext/giftcard/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nx-timestamp': ts, 'x-nx-signature': sig },
      body,
    }, 10000);
  } catch (e) {
    console.log('[giftcard:redeem] ulaşılamadı:', String(e && e.message || e).slice(0, 200));
    throw unavailable('GC-NET');
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data && data.ok && Number.isSafeInteger(data.amount) && data.amount > 0 && typeof data.reference === 'string') {
    const perKristal = Number(env.GIFTCARD_MINOR_PER_KRISTAL) > 0 ? Number(env.GIFTCARD_MINOR_PER_KRISTAL) : 100;
    const amount = data.unit === 'kristal' ? data.amount * perKristal : data.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw unavailable('GC-SRV');
    return { amount, reference: data.reference };
  }
  const msgs = { invalid: 'Kod geçersiz.', used: 'Bu kod daha önce kullanılmış.', expired: 'Kodun süresi dolmuş.', rate_limited: 'Çok fazla deneme. Biraz sonra tekrar deneyin.' };
  // Yalnızca Mikro-Klima'nın tanıdığı bir ret nedeni geldiyse kod reddedilmiştir; diğer her şey bir bağlantı/yapılandırma sorunudur.
  if (data && msgs[data.error] && res.status >= 400 && res.status < 500 && res.status !== 401) throw new HttpError(400, 'giftcard_rejected', msgs[data.error]);
  console.log('[giftcard:redeem] beklenmeyen yanıt', res.status, data && data.error);
  if (res.status === 401 || (data && data.error === 'bad_signature')) throw unavailable('GC-AUTH');
  if (!data) throw unavailable('GC-PATH');
  throw unavailable('GC-SRV');
}
