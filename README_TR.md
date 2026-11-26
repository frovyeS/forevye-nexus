# FOREVYE NEXUS – Transfer sunucu hatası kontrol/düzeltme paketi

Kaynak kod incelemesinde transfer kayıtlarının `transfers.description` sütununa yazıldığı, bu sütunun `0013_bank_access_and_transfer_notes.sql` migration'ında eklendiği görüldü. Canlı D1'de bu migration uygulanmamışsa transfer uçları SQL hatası verebilir.

## Güvenli uygulama
1. Cloudflare D1 veritabanının yedeğini alın.
2. **Önce** Cloudflare Worker projesinin terminalinde `npx wrangler d1 migrations list <DB_ADI> --remote` ile migration durumunu kontrol edin. `<DB_ADI>` yerine wrangler.toml'deki gerçek D1 database adını yazın.
3. `0013_bank_access_and_transfer_notes.sql` uygulanmamış görünüyorsa, ana `forevye-nexus-main` projesindeki migrations klasöründe bulunan bu dosyanın aynısını kullanarak `npx wrangler d1 migrations apply <DB_ADI> --remote` komutunu çalıştırın. Komut bütün bekleyen migration'ları uygulayabilir; listede başka bekleyen migration varsa önce onları inceleyin.
4. Bu pakette migration dosyası kopya referans olarak verilmiştir. **Migration zaten uygulanmışsa tekrar çalıştırmayın.** `ALTER TABLE ... ADD COLUMN` tekrar çalıştırıldığında hata verir.
5. Mevcut Worker kaynak kodunu deploy edin. Migration uygulanmışsa, kod değişikliği gerekmiyorsa transfer için sırf bu paket adına yeni deploy zorunlu değildir.

## Not
Bu olası kök nedeni hedefleyen bir kontrol/düzeltme paketidir; canlı D1 üzerinde doğrulanmadı. Transfer sorununu başka bir SQL hatası, token/CORS/Worker sürüm uyuşmazlığı da oluşturabilir. Gerçek hata Cloudflare Worker Logs üzerinden doğrulanmalıdır.
