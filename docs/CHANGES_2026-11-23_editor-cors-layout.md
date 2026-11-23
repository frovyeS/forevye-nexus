# 23 Kasım 2026 — Card Studio bağlantısı ve kart numarası yerleşimi

## Worker bağlantısı
- `wrangler.toml` içine `EDITOR_URL=https://mhaforevye.github.io/forevye_nexus_bank/` ve `EDITOR_ORIGINS=https://mhaforevye.github.io` eklendi.
- Worker'daki `editorOrigins()` bu değerlerden tam editör adresini ve izin verilen tarayıcı origin'ini üretir.
- Böylece editörün `POST /api/editor/exchange`, `GET /api/editor/card` ve `PUT /api/editor/card` istekleri için CORS origin allowlist'i yapılandırılmış olur.

## Kart numarası görünümü
- `SYS.number` kutusu 230×34 olarak güncellendi.
- Yatay varsayılan numara alanı x=594, y=450 konumuna alındı; çip/QR/kart sahibi/kod kutularıyla çakışma kontrolünde çakışma yok.
- Kart numarası metin üst sınırı 18'den 22'ye, Nexus kart kodu etiketi 13'ten 15'e ve kod satırı 23'ten 25'e çıkarıldı.
- İstemci ve Worker'daki kart kuralları/çizici dosyaları birebir senkronlandı.

## Doğrulama
- Worker projesi testleri: 72/72 geçti.
- Projedeki JS dosyaları `node --check` ile kontrol edildi.
- Yatay ve dikey varsayılan sistem alanları için çakışma kontrolü boş liste döndürdü.

## Dağıtım
Bu kaynakları canlıya almak için Worker projesi `forevye-nexus-main/` içinden `npx wrangler deploy` ile deploy edilmeli; editör projesi `forevye_nexus_bank-main/` GitHub Pages'e ayrı yayınlanmalıdır. Bu çalışma sırasında canlı Cloudflare hesabına deploy yapılmadı.
