// Mikro-Klima Worker'ına (hediye kartı + ortak posta rölesi) giden istekler.
// Aynı Cloudflare hesabındaki iki Worker birbirini workers.dev adresiyle çağırınca istek sıklıkla
// reddedilir/zaman aşımına uğrar (hata 1042). Bu yüzden wrangler.toml'daki servis bağlantısı (MIKRO) varsa
// onun üzerinden, yoksa normal fetch ile gidilir. Her istekte zaman aşımı vardır, istek asılı kalmaz.
export function mikroFetch(env, url, init = {}, timeoutMs = 8000) {
  const f = env.MIKRO && typeof env.MIKRO.fetch === 'function' ? env.MIKRO.fetch.bind(env.MIKRO) : fetch;
  return f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
