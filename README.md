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
Üretim: `npm run db:migrate:remote`, sırlar için `wrangler secret put CODE_PEPPER|INTERNAL_API_KEY|GIFTCARD_API_SECRET` (e-posta Mikro-Klima'daki ortak Brevo servisinden gider; `BREVO_API_KEY` yalnızca Mikro-Klima'da gerekir),
`GIFTCARD_API_URL` için de secret/var, ardından `npm run deploy`. `wrangler.toml` içinde `EDITOR_URL` (kart editörü adresi) ve `ID_URL` (FOREVYE ID adresi) dolu olmalı.
İlk süper yönetici: kayıt olup `scripts/make-superadmin.sql` çalıştırın. Yönetim paneli: `/admin.html`.
Test için ayrı ortam: `wrangler.toml` içindeki `[env.staging]` (ayrı D1/R2).

## Testler
    npm test        # Node 22+; gerçek şemayı node:sqlite üzerinde çalıştırır (62 test)

## Para birimi ve Kristal Borsası (v1.1)
- **FN** kesin para birimidir (1 FN = 100 minor; eski "geçici" notu kalktı). Yeni hesap cüzdanı kayıt sırasında 0 FN ile açılır; mevcut hesap bakiyeleri otomatik sıfırlanmaz.
- **Kristal (KRS)** bağımsız oyun içi varlıktır; gerçek altın, döviz veya emtia fiyatı takip etmez.
- Başlangıç fiyatı `MARKET_INITIAL_PRICE_MICRO` ile belirlenir (varsayılan 25 FN/KRS); her 60 saniyelik yenilemede `MARKET_VOLATILITY_BPS` sınırları içinde simüle edilmiş fiyat hareketi oluşur. `MARKET_REVERSION_BPS` (varsayılan 200) fiyatı başlangıç değerine doğru hafifçe çeker; fiyat başlangıcın 1/10'u ile 10 katı arasında kalır.
- Cron 5 dakikada bir, ayrıca piyasa isteği geldiğinde yenileme yapılır; grafik geçmişi D1 snapshot kayıtlarından üretilir. `0005_independent_market.sql` eski altın bazlı fiyat geçmişini temizler, cüzdanları ve kullanıcı varlıklarını korur.
- Alım/satım: yön + miktar (kristal) **ya da** tutar (FN) gönderilir; **fiyatı sunucu belirler** (istemci fiyat dayatamaz). Alış/satış orta fiyattan %0,50 sapar (`MARKET_SPREAD_BPS`). Cüzdan, defter, kristal envanteri ve işlem kaydı tek atomik D1 batch'tedir; çift gönderim `idempotency_key` ile engellenir; ekranda görülen fiyat %1'den fazla değiştiyse işlem reddedilir (`price_moved`).
- Güvenlik ağları: fiyat verisi 15 dk'dan eski kalırsa işlem durur (`market_stale`); borsa işlemleri ters kayıtla düzeltilemez (envanteri bozar); askıdaki hesap işlem yapamaz.
- Uçlar: `GET /api/market`, `GET /api/market/history?range=1d|7d|30d`, `GET /api/market/trades`, `POST /api/market/trade`, `GET /api/transfers/recent`.
- Dağıtımda: `npm run db:migrate:remote` (0005 dahil bekleyen migration'ları uygular; 0005 eski piyasa fiyat geçmişini temizler, kullanıcı cüzdanlarını/varlıklarını korur), `wrangler.toml`'daki `[triggers]` cron'u deploy ile açılır.

## Kart QR ve sanal kart kodu
Kart ön yüzünde tam NXC kart kodu ve sağ altta çevrimdışı üretilen QR yer alır. Kartlarım → QR okut ekranında kamera ile (BarcodeDetector destekli tarayıcı) tarama veya elle kart kodu girişi yapılabilir. Sunucu aktif kartı doğrular ve kart sahibinin kullanıcı adı, kartta görünen adı ve sanal kart kodunu tek tıkla kopyalatır. QR gerçek banka kartı/ödeme bilgisi içermez; fiziksel NFC çipi yerine geçmez.

## Nexus Pass (üyelikler)
Süreli üyelikler FN bakiyesiyle alınır; ayrı site olan **nexus-pass** deposu arayüzdür, arka uç bu Worker'dadır (`src/routes/pass.js`).
- Akış (kart editörüyle aynı yöntem): Nexus → **İşlemler → Nexus Pass** → tek kullanımlık bilet → Pass sitesi `POST /api/pass/exchange` ile jeton alır (30 dk kayan, en çok 8 saat). Jeton yalnızca `/api/pass/*` uçlarında geçerlidir; CORS yalnızca `PASS_URL` kaynağına açıktır.
- Satın alma tek atomik D1 batch'tir: hesap aktif mi + çift aktif üyelik koruması + bakiye düşümü (defter: `purchase`) + satın alma kaydı + süre. Fiyat/süre yalnızca sunucudadır; `idem` anahtarıyla çift gönderim engellenir; aktif üyelik varken aynı paket tekrar alınamaz, süre bitince aynı kayıt yenilenir.
- **Diğer sistemler** (Hava, Mağaza, …): `POST /api/internal/entitlement` (`INTERNAL_API_KEY`) gövde `{ user_id | id_user_id (FOREVYE ID), app?, product_id? }` → `{ active, entitlements[] }`. Tarayıcıdan çağrılamaz.
- İade/düzeltme (`/api/internal/refund`, yönetici ters kaydı) üyeliği hemen kapatır ve satın almayı `refunded` yapar.
- Katalog: `pass_products` (0006 migration iki örnek paketle gelir). Yönetim: `GET /api/admin/pass/products` (admin), `POST /api/admin/pass/products` (süper yönetici, denetim kaydı tutulur); fiyat FN olarak (`"5.00"`), süre gün olarak verilir.
- Ayarlar: `PASS_URL` (Pass sitesinin adresi), `PASS_ORIGINS` (isteğe bağlı). Dağıtımda `npm run db:migrate:remote` ile 0006 uygulanır (uygulanmazsa tablolar ilk çağrıda kendiliğinden kurulur).

## Nexus Market (tasarım ve fonksiyonel kartlar)
FN ile satılan kartlar; ayrı site olan **nexus-market** deposu arayüzdür, arka uç bu Worker'dadır (`src/routes/shop.js`, `src/lib/shop.js`). Giriş yöntemi Pass/kart editörüyle aynıdır (bilet → Bearer jeton; CORS yalnızca `SHOP_URL`).
- **Tasarım kartları:** `shared/card-skins.js` içindeki premium yüzeyler (editörde yok). Takılı yüzey kartın kayıtlı tasarımının yerine çizilir; kart adı, çip, QR ve kart kimliği sistemden çizilmeye devam eder. Sınırlı seriler numaralanır.
- **Fonksiyonel kartlar:** gerçek avantaj, sunucuda uygulanır: transfer limiti çarpanları (`ledger.transfer`, `/api/me`, `/api/transfers/recent`), kristal borsası fark indirimi (`lib/market.js`), ek kart hakkı (`createCard`). En iyi çarpan geçerlidir; kart hakları adetle toplanır.
- **Satın alma** tek atomik batch: hesap aktif mi + satış durumu/stok/azami adet korumaları (`shop_guard` CHECK'leri) + stok artışı + bakiye düşümü (defter: `purchase`) + satın alma + sahiplik. `idem` ile çift gönderim engellenir; son adet için yarışta yalnızca biri alır.
- İade/düzeltme (`/api/internal/refund`, yönetici ters kaydı) hakkı geri alır, perk'i kaldırır, yüzeyi kartlardan çıkarır.
- Katalog: `shop_products` (0007 migration on ürünle gelir). Yönetim: `GET/POST /api/admin/shop/products` (yazma: süper yönetici). Migration `node scripts/gen-shop-migration.mjs` ile `src/lib/shop.js`'ten üretilir (test aynı olduğunu denetler).
- Ayarlar: `SHOP_URL`, `SHOP_ORIGINS` (isteğe bağlı). Nexus'ta İşlemler → Nexus Market ve kart ekranında "Kart yüzeyi" paneli vardır.

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
- Piyasa modelinin ilk dağıtımında `/api/market` ve `/api/market/history?range=1d` uçlarını test edin; yeni fiyat modeli harici emtia API'sine bağlı değildir.
- Gerçek Cloudflare D1/R2/Resend üzerinde test edilmedi; testler D1'i node:sqlite ile taklit eder, arayüz yerel sunucuda Chromium ile denendi.
- Tarayıcı içi çevrimdışı kuyruk yok (yalnızca çevrimdışı uyarısı); push bildirimi yok (uygulama içi bildirim var).
- Profil fotoğrafı: PNG/JPEG/WebP, ≤512 KB, dosya imzası sunucuda doğrulanır; yeniden boyutlandırma yok.
- Rate limit sayaçları D1'de tutulur (basit, tek-bölge uygunluğu); yoğun saldırı için Cloudflare WAF/Turnstile önerilir.
- Parola özeti PBKDF2-SHA256 100k tur (Workers sınırı); ileride Argon2 destekli servise geçilebilir.
- Rozetler 6 tanımlı rozetle sınırlıdır (ilk kristal eklendi).
- Kart tasarımı banka kart editöründe yapılır (sözleşme sürüm 2, 856×540); eski v1 kartlar okunurken çevrilir. Ayrıntı: docs/INTEGRATION_NOTES.md §3.
