# 2026-11-25 — "Beklenmeyen bir hata oluştu": e-posta ve FOREVYE ID girişi 500 veriyordu

## Belirti
Hem e-posta/şifre hem "FOREVYE ID ile giriş" çalışmıyordu; formda "Beklenmeyen/Beklenmedik bir hata oluştu" görünüyordu.
FOREVYE ID tarafı sağlamdı: ID dönüşünde oturum açılıyor, ardından `/api/me` 500 verdiği için kullanıcı giriş ekranına geri düşüyordu.

## Kök neden
İki giriş yolu da `meSummary` → `limitsFor` → `perksOf` → **`ensureShopSchema`** zincirinden geçer.
`ensureShopSchema`, 329 ürünlük Market kataloğunu **tek bir ~254 KB'lık `INSERT`** olarak çalıştırıyordu.
Cloudflare D1 tek SQL ifadesini **100 KB** ile sınırlar → her soğuk başlangıçta hata → login ve `/api/me` 500.
Testler geçiyordu çünkü sahte D1 (`test/d1-shim.mjs`) bu sınırı uygulamıyordu.
Aynı sebeple `migrations/0007_shop.sql` (254 KB) ve `0012_nexus_280_catalog.sql` (237 KB) `wrangler d1 migrations apply` ile de uygulanamıyordu.

## Düzeltme
- `src/lib/shop.js`: tohum 25 satırlık parçalara bölündü (`seedStatements`, en büyük parça ~35 KB). Tohumlama "en iyi çaba"dır: başarısız olursa
  loglanır, girişi düşürmez; yalnızca katalog eksikse (`COUNT(*) < SEED.length`) çalışır ve isolate başına bir kez denenir.
- `migrations/0007_shop.sql`, `0012_nexus_280_catalog.sql`: aynı satırlar (280 + tohum), ama küçük INSERT'ler halinde. İçerik/ürün kimlikleri değişmedi.
- `src/routes/misc.js`: `meSummary` içinde perk ve kart yüzeyi okuması try/catch içine alındı; mağaza verisi bozuksa temel limitlerle devam eder.
- `GET /api/health` (yeni): tabloların `ok/eksik/hata` durumunu ve ID/mail yapılandırmasının var/yok bilgisini verir; sır ya da kullanıcı verisi içermez.
- `test/d1-shim.mjs`: 100 KB ifade sınırı taklit edilir. `test/d1-limits.test.mjs` (yeni, `npm test`'e eklendi): migration ifade boyutu, parçalı tohum,
  boş veritabanında ilk giriş, bozuk mağaza şemasında giriş, `/api/health`.

## Dağıtım
Kodu deploy etmek yeterlidir (GitHub Actions ya da `npx wrangler deploy`). Ardından
`https://forevye-nexus.forevyenexus.workers.dev/api/health` açılıp `"ok": true` görülmelidir.
