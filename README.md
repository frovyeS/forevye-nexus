# FOREVYE NEXUS (v1.1)

Sanal oyun ekonomisi için mobil öncelikli, bankacılık-benzeri web uygulaması (PWA benzeri SPA).
**Gerçek para, gerçek banka veya ödeme kuruluşu yoktur.** Bakiye, kartlar ve işlemler yalnızca oyun içi sanal öğelerdir.

Yığın: Cloudflare Workers + D1 (SQLite) + R2 (profil fotoğrafı) + statik arayüz (bağımlılıksız, vanilla JS).

## Kurulum
    npm install
    cp .dev.vars.example .dev.vars
    npx wrangler d1 create forevye-nexus        # çıkan database_id'yi wrangler.toml'a yazın
    npx wrangler r2 bucket create forevye-nexus-avatars
    npm run db:migrate:local
    npm run dev                                  # http://localhost:8787
Üretim: `npm run db:migrate:remote`, sırlar için `wrangler secret put RESEND_API_KEY|CODE_PEPPER|INTERNAL_API_KEY|GIFTCARD_API_SECRET`,
`GIFTCARD_API_URL` için de secret/var, ardından `npm run deploy`. `EMAIL_FROM` alan adınızı doğrulatın (Resend).
İlk süper yönetici: kayıt olup `scripts/make-superadmin.sql` çalıştırın. Yönetim paneli: `/admin.html`.
Test için ayrı ortam: `wrangler.toml` içindeki `[env.staging]` (ayrı D1/R2).

## Testler
    npm test        # Node 22+; gerçek şemayı node:sqlite üzerinde çalıştırır (31 test)

## Para birimi ve Kristal Borsası (v1.1)
- **FN** kesin para birimidir (1 FN = 100 minor; eski "geçici" notu kalktı).
- **Kristal**, oyun dünyasının "altın"ıdır. Fiyatı **gerçek altını (XAU/USD) izler**; baz altın fiyatı = **1 FN**:
  `kristal_fiyatı = güncel_altın_USD / baz_altın_USD`. Baz, ilk başarılı fiyat çekiminde kalıcı yazılır (`GOLD_BASE_USD` ile elle sabitlenebilir). Altın %10 artarsa kristal 1,10 FN olur.
- Kaynak: `api.gold-api.com` (anahtarsız), yedek `GC=F` (Yahoo). `GOLD_API_URL` / `GOLD_API_URL_2` ile değiştirilebilir. Fiyat 60 sn önbelleklenir, cron (5 dk) ve ziyaretçiler yeniler; geçmiş grafiği için en çok 5 dk'da bir satır saklanır.
- Alım/satım: yön + miktar (kristal) **ya da** tutar (FN) gönderilir; **fiyatı sunucu belirler** (istemci fiyat dayatamaz). Alış/satış orta fiyattan %0,50 sapar (`MARKET_SPREAD_BPS`). Cüzdan, defter, kristal envanteri ve işlem kaydı tek atomik D1 batch'tedir; çift gönderim `idempotency_key` ile engellenir; ekranda görülen fiyat %1'den fazla değiştiyse işlem reddedilir (`price_moved`).
- Güvenlik ağları: fiyat 15 dk güncellenmezse işlem durur (`market_stale`); tek adımda %25'ten büyük sıçrama bozuk veri sayılıp yok sayılır; borsa işlemleri ters kayıtla düzeltilemez (envanteri bozar); askıdaki hesap işlem yapamaz.
- Uçlar: `GET /api/market`, `GET /api/market/history?range=1d|7d|30d`, `GET /api/market/trades`, `POST /api/market/trade`, `GET /api/transfers/recent`.
- Dağıtımda: `npm run db:migrate:remote` (0002 yeni migration; `ledger_entries` yeniden kurulur, veri korunur), `wrangler.toml`'daki `[triggers]` cron'u deploy ile açılır.

## Şartnameden uygulananlar
Kayıt (e-posta kodu doğrulama), giriş, şifre sıfırlama, oturum yönetimi; Ana Sayfa / İşlemler / Kartlarım / Profil;
kullanıcı adı kuralları (3-20 karakter, benzersiz, ilk 48 saatte 2 hak, sonra her değişimden 15 gün, geçmiş kaydı, eski ad 30 gün ayrılır);
kart adı ≠ kullanıcı adı; kullanıcı adıyla transfer (atomik, idempotent, değiştirilemez defter, günlük/işlem limiti, yüksek tutarda şifre yeniden doğrulama);
çoklu sanal kart + SVG kart editörü (korunan alanlar, sürüm geçmişi, şablonlar); bildirim merkezi; duyurular; Nexus Vault (rozet/tema/kayıtlı tasarım);
yönetici paneli (kullanıcı ara, askı, duyuru, şablon, rol, ters kayıt/düzeltme, değiştirilemez denetim kaydı); hediye kartı ve oyun içi alışveriş için entegrasyon uçları.

## Varsayımlar ve bilinen eksikler (dürüst liste)
- Limitler `wrangler.toml` [vars] içinde ayarlanabilir (varsayılan: işlem 5.000, günlük 15.000, şifre eşiği 1.000 FN; borsa işlemi 10.000 FN).
- **Hediye kartı ZIP'i incelenmedi**; bağdaştırıcı önerilen sözleşmeyle yazıldı (bkz. docs/INTEGRATION_NOTES.md).
- Resmî logo (ikon + yazı logosu) eklendi: `public/assets/logo.svg`, kartlarda `wordmark.png` maskesiyle çizilir. Yalnızca Türkçe arayüz.
- Altın fiyat kaynağının canlı yanıt biçimi bu ortamda doğrulanamadı (ayrıştırıcı `price/priceUsd/rate` alanlarını tolere eder); ilk dağıtımda `/api/market` ile duman testi yapın. Kaynak bozulursa fiyat bayatlar ve işlem durur.
- Gerçek Cloudflare D1/R2/Resend üzerinde test edilmedi; testler D1'i node:sqlite ile taklit eder, arayüz yerel sunucuda Chromium ile denendi.
- Tarayıcı içi çevrimdışı kuyruk yok (yalnızca çevrimdışı uyarısı); push bildirimi yok (uygulama içi bildirim var).
- Profil fotoğrafı: PNG/JPEG/WebP, ≤512 KB, dosya imzası sunucuda doğrulanır; yeniden boyutlandırma yok.
- Rate limit sayaçları D1'de tutulur (basit, tek-bölge uygunluğu); yoğun saldırı için Cloudflare WAF/Turnstile önerilir.
- Parola özeti PBKDF2-SHA256 100k tur (Workers sınırı); ileride Argon2 destekli servise geçilebilir.
- Rozetler 6 tanımlı rozetle sınırlıdır (ilk kristal eklendi).
- Kart tasarımı sözleşmesi (v1, 320×200, süs nesneleri) ayrı kart editörünün modelinden (856×540, katmanlar) farklıdır; bağlama aşamasında bkz. docs/INTEGRATION_NOTES.md §3c. Kart sözleşmesine zemin/yazı **kontrast zorunluluğu** eklendi (marka okunabilirliği).
