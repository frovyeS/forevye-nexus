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

const baseUrl = (env) => String(env.GIFTCARD_API_URL || '').trim().replace(/\/+$/, '');

export function giftcardConfigured(env) {
  return Boolean(env.GIFTCARD_API_URL && env.GIFTCARD_API_SECRET);
}

export async function giftcardStatus(env) {
  if (!giftcardConfigured(env)) return { connected: false, detail: 'Hediye kartı modülü bağlı değil (GIFTCARD_API_URL ve GIFTCARD_API_SECRET tanımlı olmalı).' };
  try {
    const res = await fetch(`${baseUrl(env)}/api/ext/giftcard/health`, { method: 'GET' });
    return { connected: res.ok, detail: res.ok ? 'Modül erişilebilir.' : `Modül yanıtı: ${res.status}` };
  } catch {
    return { connected: false, detail: 'Modüle ulaşılamadı.' };
  }
}

export async function redeemViaExistingModule(env, { userId, code, idempotencyKey }) {
  if (!giftcardConfigured(env)) throw new HttpError(503, 'giftcard_unavailable', 'Hediye kartı hizmeti şu an kullanılamıyor.');
  const body = JSON.stringify({ user_id: userId, code, idempotency_key: idempotencyKey });
  const ts = String(now(env));
  const sig = await hmacHex(env.GIFTCARD_API_SECRET, `${ts}.${body}`);
  let res;
  try {
    res = await fetch(`${baseUrl(env)}/api/ext/giftcard/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nx-timestamp': ts, 'x-nx-signature': sig },
      body,
    });
  } catch {
    throw new HttpError(503, 'giftcard_unavailable', 'Hediye kartı hizmeti şu an kullanılamıyor.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok && Number.isSafeInteger(data.amount) && data.amount > 0 && typeof data.reference === 'string') {
    const perKristal = Number(env.GIFTCARD_MINOR_PER_KRISTAL) > 0 ? Number(env.GIFTCARD_MINOR_PER_KRISTAL) : 100;
    const amount = data.unit === 'kristal' ? data.amount * perKristal : data.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(503, 'giftcard_unavailable', 'Hediye kartı hizmeti şu an kullanılamıyor.');
    return { amount, reference: data.reference };
  }
  const msgs = { invalid: 'Kod geçersiz.', used: 'Bu kod daha önce kullanılmış.', expired: 'Kodun süresi dolmuş.', rate_limited: 'Çok fazla deneme. Biraz sonra tekrar deneyin.' };
  if (res.status >= 400 && res.status < 500) throw new HttpError(400, 'giftcard_rejected', msgs[data.error] || 'Kod kabul edilmedi.');
  throw new HttpError(503, 'giftcard_unavailable', 'Hediye kartı hizmeti şu an kullanılamıyor.');
}
