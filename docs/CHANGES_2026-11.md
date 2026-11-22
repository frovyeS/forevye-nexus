# Forevye Nexus — 22.11.2026 değişiklik notları

## Kristal piyasası
- Kristal fiyatı artık harici altın/XAU/USD verisi kullanmaz.
- Başlangıç fiyatı `MARKET_INITIAL_PRICE_MICRO` ile ayarlanır (varsayılan 25 FN/KRS).
- Her fiyat yenilemesinde `MARKET_VOLATILITY_BPS` sınırları içinde küçük bir hareket uygulanır.
- Cron her 5 dakikada bir snapshot yazar; API yenilemesi `MARKET_REFRESH_SEC` ile çalışır.
- 0005 migration eski altın bazlı fiyat snapshot/cache kayıtlarını temizler. Cüzdan bakiyeleri, defter ve Kristal miktarları silinmez.
- Yeni hesapların bakiyesi zaten kayıt sırasında 0 oluşturuluyordu; mevcut kullanıcı bakiyeleri bilerek sıfırlanmadı.

## Kart ve QR
- Kartın ön yüzünde tam sanal kart kodu ve sağ alt köşede QR bulunur.
- QR içeriği `FNX1|NXC-XXXX-XXXX` biçimindedir; gerçek ödeme verisi veya gizli kart sırrı içermez.
- Kartlarım ekranındaki QR okutucu kamera ile tarar (BarcodeDetector destekleyen tarayıcılarda) veya kodu elle kabul eder.
- Okutma sonrası sunucu aktif kartı doğrular; kart sahibi, görünen ad ve sanal kart kodu gösterilir, tek tıkla kopyalanır.
- Kamera izni yalnızca kullanıcı “Kamerayı aç” düğmesine bastığında istenir. Tarayıcı desteği/izin yoksa elle giriş çalışır.

## Önemli güvenlik sınırı
Web sayfasındaki bir QR kodu görünmez olamaz; kamera onu optik olarak okuyabilmek için ekranda/kağıtta görünür kareleri görmelidir. Temassız, görünmeyen çip işlevi QR değildir; bunun için fiziksel NFC donanımı ve desteklenen cihaz/uygulama gerekir. Bu projede gerçek banka/NFC ödeme kartı üretilmez.

## Gözden geçirme düzeltmeleri
- Fiyat modeli: `MARKET_REVERSION_BPS` (varsayılan 200) ile başlangıç fiyatına doğru hafif geri çekim eklendi; fiyat başlangıcın 1/10'u – 10 katı aralığında kalır. Test eklendi.
- Kart yüzü: sağ alttaki "•••• XXXX" metni özgün konumuna (x=830) döndürüldü; uzun kart adlarıyla çakışması önlendi.
- QR okuyucu: ilk başarılı taramadan sonra kamera yeniden açıldığında taramanın durması hatası düzeltildi.
- Not: 0005 migration geçmiş fiyatları siler ama mevcut kristal envanterini korur; eski fiyatla (~1 FN) alınmış kristaller yeni fiyattan (25 FN) satılabilir. Canlı veri varsa MARKET_INITIAL_PRICE_MICRO'yu buna göre seçin.

## Nexus Pass entegrasyonu
- Yeni: `migrations/0006_pass.sql`, `src/routes/pass.js`, `src/lib/pass.js`, `test/pass.test.mjs`, `public/js/views-pass.js`.
- Üyelik ödemesi artık Nexus cüzdanından (FN) yapılır; eski Mikro-Klima `/api/npass/*` ve ayrı "kristal hesabı" akışı yerine Nexus oturumu + bilet kullanılır.
- Diğer sistemler için `POST /api/internal/entitlement`; iade/ters kayıt üyeliği kapatır.
- Nexus arayüzü: İşlemler → Nexus Pass (üyeliklerim + Pass'i aç).
- Pass sitesinde `[hidden]` CSS hatası düzeltildi (gizli onay katmanı tıklamaları engelliyordu).
- Dikkat: Mikro-Klima tarafındaki eski `/api/npass/*` üyelikleri bu sisteme otomatik taşınmaz; eski üyelikler gerekiyorsa elle aktarılmalıdır.

## Card Studio (sözleşme v3)
- Yatay/dikey kartlar (`orientation`), serbest yerleşen dekoratif katmanlar, her zaman üstte çizilen korumalı sistem öğeleri (`sys`), `qrStyle`.
- `rules.js`/`card-rules.js` ve `render.js`/`card-render.js` iki depoda BİREBİR aynı olmalıdır (`npm run sync-shared`).
- v1/v2 tasarımlar okunurken v3'e dönüştürülür; mevcut kartlar bozulmaz.
- Kartlarım: varsayılan kart rozeti, devre dışı kart görünümü, QR'a tıklayınca büyütme penceresi.
