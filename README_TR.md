# FOREVYE NEXUS – Transfer migration numarası düzeltmesi

## Bu düzeltme neden gerekli?
Kaynak projede `0013_nexus_rug_pack_2.sql` zaten mevcut. Önceki paketteki `0013_bank_access_and_transfer_notes.sql` aynı migration numarasını kullandığı için Wrangler migration sıralaması/uygulaması çakışabilir. Bu paket transfer migration'ını `0014` olarak yeniden numaralandırır.

## GitHub dosya işlemi
1. Nexus Worker deposundaki **`migrations/0013_bank_access_and_transfer_notes.sql`** dosyasını sil.
2. Bu ZIP içindeki **`migrations/0014_bank_access_and_transfer_notes.sql`** dosyasını aynı `migrations/` klasörüne ekle.
3. `0013_nexus_rug_pack_2.sql` dosyasına dokunma.
4. Commit et.

## ÖNEMLİ: GitHub'a commit tek başına D1 migration'ını çalıştırmaz ve Worker deploy etmez.

Cloudflare Worker projesi terminalinde önce D1 yedeği al. `wrangler.toml` içindeki D1 database adına göre migration listesini kontrol et:

```bash
npx wrangler d1 migrations list forevye-nexus --remote
```

Listeyi kontrol et; 0014 beklemede görünüyorsa uygulama:

```bash
npx wrangler d1 migrations apply forevye-nexus --remote
```

Sonra Worker kodunu deploy et:

```bash
npx wrangler deploy
```

Komutlar gerçek Worker projesinin kök klasöründe çalıştırılmalıdır. Hesap kimliğini ve canlı DB'yi doğrulamadan başka DB'ye işlem uygulama. Yedek almadan migration çalıştırma. `0014` zaten uygulanmışsa tekrar uygulama.

Bu migration transfer/banka token tablolarını ve transfers.description alanını oluşturmayı amaçlar; canlı transferin başarıyla çalıştığı henüz doğrulanmamıştır.
