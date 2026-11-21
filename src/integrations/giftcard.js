// Hediye kartı entegrasyon katmanı.
//
// ÖNEMLİ: Şartnameye göre mevcut hediye kartı sistemi (ZIP dosyaları) YENİDEN YAZILMAZ; bu dosya yalnızca
// ince bir bağdaştırıcıdır ve kod doğrulama / geçerlilik mantığı mevcut modülde kalır.
// Bu teslimat sırasında ZIP dosyaları görevliye ulaşmadığı için aşağıdaki sözleşme ÖNERİDİR ve
// docs/INTEGRATION_NOTES.md içinde belgelenmiştir; mevcut modülün gerçek API'sine göre eşlenmelidir.
//
// Önerilen sözleşme (mevcut modül ayrı bir Worker/servis olarak kalır):
//   POST {GIFTCARD_API_URL}/redeem
//   Başlıklar: x-nx-timestamp, x-nx-signature = HMAC-SHA256(GIFTCARD_API_SECRET, `${timestamp}.${gövde}`)
//   Gövde: { user_id, code, idempotency_key }
//   Yanıt 200: { ok: true, amount: <minor unit tamsayı>, reference: "<benzersiz kaynak kimliği>" }
//   Yanıt 4xx: { ok: false, error: "invalid" | "used" | "expired" }
// Bakiye yükleme (defter kaydı) bu uygulamada reference ile tekrar-güvenli yapılır.
import { hmacHex } from '../lib/crypto.js';
import { HttpError, now } from '../lib/util.js';

export function giftcardConfigured(env) {
  return Boolean(env.GIFTCARD_API_URL && env.GIFTCARD_API_SECRET);
}

export async function giftcardStatus(env) {
  if (!giftcardConfigured(env)) return { connected: false, detail: 'Mevcut hediye kartı modülü henüz bağlanmadı (ZIP entegrasyonu bekleniyor).' };
  try {
    const res = await fetch(`${env.GIFTCARD_API_URL}/health`, { method: 'GET' });
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
    res = await fetch(`${env.GIFTCARD_API_URL}/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nx-timestamp': ts, 'x-nx-signature': sig },
      body,
    });
  } catch {
    throw new HttpError(503, 'giftcard_unavailable', 'Hediye kartı hizmeti şu an kullanılamıyor.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok && Number.isSafeInteger(data.amount) && data.amount > 0 && typeof data.reference === 'string') {
    return { amount: data.amount, reference: data.reference };
  }
  const msgs = { invalid: 'Kod geçersiz.', used: 'Bu kod daha önce kullanılmış.', expired: 'Kodun süresi dolmuş.' };
  if (res.status >= 400 && res.status < 500) throw new HttpError(400, 'giftcard_rejected', msgs[data.error] || 'Kod kabul edilmedi.');
  throw new HttpError(503, 'giftcard_unavailable', 'Hediye kartı hizmeti şu an kullanılamıyor.');
}
