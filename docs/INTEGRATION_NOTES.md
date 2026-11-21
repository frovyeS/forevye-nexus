# Entegrasyon notları

## 1. Hediye kartı sistemi = Mikro-Klima kristal kartları (BAĞLANDI)
Mevcut hediye kartı sistemi Mikro-Klima Worker'ındaki `gcards`'tır (kristal kartı: no + CVV + SKT). Yeniden yazılmadı;
Mikro-Klima'ya sunucudan sunucuya bir uç eklendi (`worker/nexus.js`) ve `src/integrations/giftcard.js` ona bağlandı:

    POST {GIFTCARD_API_URL}/redeem      GET {GIFTCARD_API_URL}/health
    x-nx-timestamp, x-nx-signature = HMAC-SHA256(GIFTCARD_API_SECRET, "<timestamp>.<gövde>")
    gövde: { user_id, code: "NNNNNNNN CVV AA/YY", idempotency_key }
    200: { ok:true, amount:<kristal>, unit:"kristal", reference:"mkgc:<kart no>" }   4xx: { ok:false, error:"invalid|used|expired" }

- Kart kodu tek metindir (`12345674 123 05/27`); Nexus arayüzündeki kod kutusu değişmeden çalışır.
- Kristal → FN kuru `GIFTCARD_MINOR_PER_KRISTAL` (wrangler.toml, varsayılan 100: 1 kristal = 1,00 FN). Bu bir ekonomi kararıdır; kuru sen belirle.
- `GIFTCARD_API_SECRET` (Nexus) = `NEXUS_SECRET` (Mikro-Klima): `npx wrangler secret put ...` ile her iki tarafa AYNI değer (en az 16 karakter).
- Aynı kullanıcı aynı kartı tekrar gönderirse aynı `reference` döner; defter referansla tekrar-güvenlidir. Kart başka kullanıcıdaysa `used`.

## 1b. Giriş = FOREVYE ID (BAĞLANDI)
`POST /api/auth/id/start` (PKCE adresi), `GET /api/auth/id/callback` (kod değişimi → çerez oturumu), `POST /api/auth/id/complete` (ilk girişte kullanıcı adı + kart ismi).
Tablolar: `id_links` (Nexus kullanıcısı ↔ ID kullanıcısı), `id_states`, `id_pending` (migrations/0002_forevye_id.sql). Ayarlar: `ID_URL`, `ID_API_URL`; Mikro-Klima tarafında `ID_REDIRECTS`'e `sanal-banka=<site>/api/auth/id/callback`.
Eski e-posta hesabı, aynı doğrulanmış e-posta ile ID'ye ilk girişte otomatik bağlanır. `LEGACY_LOGIN="off"` e-posta/şifre kayıt ve girişini (410) kapatır; önce herkesin ID ile bağlandığından emin ol.

## 2. Oyun içi alışveriş (sunucudan sunucuya)
`POST /api/internal/purchase` { user_id, amount:"10.00", external_ref } — `Authorization: Bearer INTERNAL_API_KEY`.
Aynı `external_ref` tekrar gönderilirse ikinci kez düşülmez. İade: `POST /api/internal/refund` { ref }.
Mevcut oyun/mağaza sistemini bu uçlara bağlayın; kullanıcı kimliği olarak `user_id` (UUID) kullanılır.

## 3. Ayrı kart editörü
Veri sözleşmesi `shared/card-contract.js` (sürüm 1) dosyasındadır; sunucu da istemci de aynı dosyayı kullanır
(`npm run sync-shared` ile `public/js/` altına kopyalanır). Alan seti, renk biçimi, süs sınırları ve korunan bölgeler orada.
Ayrı editör bu dosyayı içe aktarıp `validateDesign` kullanmalı; kaydetme `PATCH /api/cards/:id` ile yapılır.

## 3b. Logo
`public/assets/logo.svg` YER TUTUCUDUR. Resmî logoyu aynı dosya adıyla koyun.

## 3c. Kart editörü ile bağlama planı (sonraki aşama)
Bugün iki ayrı kart modeli var: bu depodaki sözleşme v1 (320×200, `decor` listesi) ve `forevye_nexus_bank` editörünün modeli (856×540, `layers[]`, `userDisplayName`, `chipStyle`, `nameStyle`).
Önerilen yol: editörün `js/rules.js` dosyası (DOM'suz, `module.exports` var) Worker'da `validateDesign` olarak kullanılır; `cards.design_json` bu şemayı taşır, `design_version` aynen kalır. Marka/çip/kart bilgisi **veri modelinde yoktur**, çizimde sistemden eklenir; bu yüzden kullanıcı bunları silemez/taşıyamaz. Geçişte `shared/card-contract.js` yerine editör kuralları + `FNXRender` kullanılır, eski v1 kartlar için bir kerelik dönüştürücü yazılır.

## 4. Kristal borsası
Altın fiyat kaynağı ve parametreler için README'deki "Para birimi ve Kristal Borsası" bölümüne bakın. Oyun içi mağaza kristalle ödeme isterse `POST /api/internal/purchase` FN düşer; kristal→FN dönüşümü kullanıcı tarafından borsadan yapılır.
