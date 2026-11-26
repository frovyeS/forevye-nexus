# Kristal Borsası Oynaklık Düzeltmesi

Kristal fiyatı 24 saat sabit kalıyordu çünkü kaynak ZIP'te dış altın API adresi tanımlanmamışken BIST API adresi de boş kalıyordu. `refreshPrice()` bu durumda fiyatı değiştirmeden bırakıyordu.

Bu overlay iki dosyayı günceller:
- `src/lib/market.js`: dış piyasa kaynakları yoksa etkinleştirilen sanal piyasa fallback'inde sınırlı dalgalanma + son 6 saat alış/satış akışının küçük etkisi.
- `wrangler.toml`: fallback'i etkinleştiren ayar ve oynaklık (5 dakikalık adımda en fazla ±%0,85).

## GitHub üzerinden
1. ZIP'i aç.
2. `src/lib/market.js` ve `wrangler.toml` dosyalarını ana `forevye-nexus` Worker reposunda aynı yolların üzerine yükle.
3. Commit et. GitHub Actions/otomatik deploy yapılandırman varsa Worker deploy'un tamamlanmasını bekle.
4. Borsa ekranını yenile. Cron Trigger zaten `*/5 * * * *` olarak tanımlıdır; fallback devreye girdiğinde fiyat Cron adımlarında hareket eder.

D1 migration yok; veri silmez veya bakiye/işlem kayıtlarına dokunmaz.

## Kontrol
Bu overlay ile JS syntax kontrolü başarılı. Paket hazırlanırken `npm test` çalıştırıldı: 107 test başarılı, 3 test başarısız. Üç başarısız test bu patch'ten bağımsız, kaynak ZIP'te önceden bulunan katalog sayısı / 100 KB migration / shop migration üretim uyuşmazlıklarıdır. Bu yama fiyat fallback testlerini değiştirmeden bu 3 mevcut test hatası dışında tüm testlerden geçti.
