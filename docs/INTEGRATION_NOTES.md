# Entegrasyon notları

## 1. Hediye kartı sistemi (mevcut ZIP) — ÖNEMLİ
Şartname, mevcut hediye kartı sisteminin yeniden yazılmamasını istiyor. Bu teslimat sırasında o ZIP dosyaları
konuşmaya eklenmemişti (yalnızca şartname PDF'i geldi), bu yüzden mevcut modülün gerçek API'si bilinmiyor.
`src/integrations/giftcard.js` bu yüzden ÖNERİLEN bir sözleşmeyle yazılmış ince bağdaştırıcıdır:

    POST {GIFTCARD_API_URL}/redeem
    x-nx-timestamp, x-nx-signature = HMAC-SHA256(GIFTCARD_API_SECRET, "<timestamp>.<gövde>")
    gövde: { user_id, code, idempotency_key }
    200: { ok:true, amount:<minor unit>, reference:"<benzersiz>" }   4xx: { ok:false, error:"invalid|used|expired" }

Yapılacak: ZIP'teki modülü inceleyip bu dosyadaki tek fonksiyonu (`redeemViaExistingModule`) gerçek API'ye göre uyarlayın.
Kod doğrulama/süre/kullanım kontrolü o modülde kalır. Bu uygulama yalnızca `reference` ile bakiyeyi
tekrar-güvenli (aynı referans ikinci kez yüklenmez) yükler. `GIFTCARD_API_URL` boşsa özellik "bağlı değil" görünür.

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
