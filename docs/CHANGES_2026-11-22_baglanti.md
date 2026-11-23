# 22.11.2026 — Mail kopması, hediye kartı yanıtsızlığı

## Sorun
- Her deploy `wrangler.toml`'da olmayan panel değişkenlerini (mail, ID adresi) siliyordu → mail/ID "sürekli kopuyordu".
- `wrangler.toml` e-postayı `resend` + `no-reply@example.com` ile bırakıyordu; kod ise Mikro-Klima rölesini (`relay`) bekliyordu.
- Nexus → Mikro-Klima çağrıları workers.dev adresiyle yapılıyordu; aynı hesaptaki Worker'lar arası bu çağrı koparak asılı kalıyordu (zaman aşımı da yoktu).

## Değişenler
- `wrangler.toml`: `keep_vars = true`, `EMAIL_PROVIDER="relay"`, `MAIL_RELAY_URL`.
- `src/lib/upstream.js` (yeni): servis bağlantısı varsa onunla, yoksa fetch + zaman aşımı.
- `src/lib/mail.js`, `src/integrations/giftcard.js`: bu yardımcıyı kullanır, hata nedenlerini loglar.
