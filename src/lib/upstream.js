// Mikro-Klima Worker'ına (hediye kartı + ortak posta rölesi) giden istekler.
// Mikro-Klima ayrı bir Cloudflare hesabında çalıştığı için servis bağlantısı (service binding) KULLANILMAZ;
// istekler herkese açık adrese (GIFTCARD_API_URL / MAIL_RELAY_URL) normal fetch ile gider.
// Her istekte zaman aşımı vardır, istek asılı kalmaz.
export function mikroFetch(env, url, init = {}, timeoutMs = 8000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
