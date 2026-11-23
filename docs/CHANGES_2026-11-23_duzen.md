# 23.11.2026 — Dosya yerleşimi düzeltmesi

- Kökte kalmış yeni dosyalar yerine taşındı: `upstream.js` → `src/lib/`, `giftcard.js` → `src/integrations/` (eskisinin yerine), `mail.js` → `src/lib/` (eskisinin yerine).
- `docs /` (adı sonunda boşluklu klasör) `docs/` ile birleştirildi.
- Eski Pass sürümü kaldırıldı: `src/lib/pass.js`, `migrations/0006_pass.sql` (güncel olan `src/routes/pass.js` + `0007_nexus_pass.sql`, `nxp_*` tabloları). İade/ters kayıtta üyelik, `nxp_purchases` üzerinden ters kayıt kontrolüyle zaten kapanıyor.
- `test/app.test.mjs`: iki kart testi yeni (v3 katmanlı) tasarım sözleşmesine uyarlandı. Sonuç: 70/70 test geçiyor.

## Servis bağlantısı kaldırıldı
- Mikro-Klima Worker'ı ayrı hesapta olduğu için `wrangler.toml`'daki `[[services]] MIKRO` silindi (deploy "Service binding ... not found" hatası veriyordu).
- `src/lib/upstream.js` artık yalnızca `fetch` + zaman aşımı kullanır; adresler `GIFTCARD_API_URL` ve `MAIL_RELAY_URL` değişkenlerinden gelir.

## Hediye kartı "şu an kullanılamıyor" hatası
- Sebep tek değildi; hepsi aynı genel mesajın arkasına gizleniyordu. Artık mesajın sonunda neden kodu görünür:
  `GC-URL` adres tanımsız/https değil · `GC-KEY` GIFTCARD_API_SECRET yok · `GC-NET` Worker'a ulaşılamıyor (adres yanlış) ·
  `GC-AUTH` iki taraftaki gizli değer farklı · `GC-PATH` adres Mikro-Klima'yı göstermiyor (404/HTML) · `GC-SRV` Mikro-Klima'da NEXUS_SECRET yok ya da sunucu hatası.
- Eskiden 401/404 gibi yanıtlar "Kod kabul edilmedi" diye gösterilebiliyordu; artık yalnızca Mikro-Klima'nın tanıdığı ret nedenleri (geçersiz/kullanılmış/süresi dolmuş) kod reddi sayılır.
- Yönetici durum ucu (`/api/admin/giftcard`) artık `reason` ve açıklama döner; health yanıtı gövdesiyle doğrulanır.
- `wrangler.toml`: `GIFTCARD_API_URL` dosyadaki değerden okunur (deploy panel değerini ezer); açıklaması eklendi.
- Test: `hediye kartı: hata nedeni kodu ...` (toplam 71 test geçiyor).

## Hediye kartı artık KRİSTAL veriyor (FN değil)
- Mikro-Klima'da FN yok, yalnızca kristal var; kart tutarı kristal adedidir. Önceden `GIFTCARD_MINOR_PER_KRISTAL` ile FN'ye çevrilip cüzdana yazılıyordu.
- Şimdi doğrudan `crystal_holdings` bakiyesine eklenir (1 kristal = 10.000 birim). FN bakiyesi ve defter değişmez.
- Yeni: `migrations/0008_crystal_gifts.sql` (kart referansı başına tek kayıt, değiştirilemez; migration uygulanmazsa tablo kendiliğinden kurulur), `creditGiftCrystals` (`src/lib/market.js`).
- Aynı referans ikinci kez gelirse tekrar yüklenmez (`replayed`); başka kullanıcıya ait referans reddedilir.
- Arayüz: "Kristal yükle" düğmesi ve "N kristal yüklendi" ekranı. `GIFTCARD_MINOR_PER_KRISTAL` ayarı kaldırıldı.
- Dağıtım: `npm run db:migrate:remote` ile 0008 uygulanır.
