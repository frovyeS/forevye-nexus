# 22.11.2026 — Nexus Pass arka ucu ve giriş düzeltmeleri

## Sorun
`nexus-pass` arayüzü `/api/pass/*`, `0006_pass.sql`, `PASS_URL` ve Nexus'taki "Nexus Pass" düğmesini bekliyordu; bunların hiçbiri Nexus deposunda yoktu.
Sonuç: Pass'te her istek 404 → "Bağlantı kurulamadı"; Pass'teki "Nexus'u aç" (`#/pass`) Nexus'ta karşılıksızdı; giriş (FOREVYE ID) sonrası hedef kayboluyordu.

## Nexus
- `src/routes/pass.js` (yeni), `migrations/0006_pass.sql` (yeni; tablolar yoksa kendiliğinden de kurulur), `scripts/add-pass-product.sql` (yeni).
- `src/worker.js`: pass uçları, `pass` erişim türü (CSRF çerezi yok, Bearer), CORS yalnızca `PASS_URL` kaynağına.
- `src/routes/internal.js`: `/api/internal/entitlement`.
- `wrangler.toml`: `PASS_URL`.
- Arayüz: İşlemler'e **Nexus Pass** satırı, `#/pass` yönlendirmesi; giriş sonrası hedef (`NEXT_OK`) listesine `#/pass` eklendi.
- `start()`: `/api/me` sunucu/ağ hatası verirse artık giriş formu değil "tekrar dene" gösterilir (yalnızca 401 giriş formu açar).
- Testler: `test/pass.test.mjs` (14 test). Toplam 58 test geçiyor.

## Nexus Pass
- `refreshBal` hataları yutuyordu → ekranlar TypeError ile "Bağlantı kurulamadı" diyordu; düzeltildi.
- Satın almada kesin sunucu reddi (4xx) ile belirsiz ağ hatası ayrıldı.
- Sunucudan gelen metinler HTML kaçışından geçiyor; iade edilen üyelik "kapatıldı" olarak gösteriliyor.
