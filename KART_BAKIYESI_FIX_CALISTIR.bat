@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  FOREVYE NEXUS - CANLI KART VERITABANI BAGLANTI DUZELTMESI
echo  ==========================================================
echo.

if not exist "wrangler.toml" (
  echo [HATA] wrangler.toml bulunamadi. Bu dosyayi Nexus ana proje klasorunde calistirin.
  goto :fail
)
if not exist "package.json" (
  echo [HATA] package.json bulunamadi. Yanlis klasordesiniz.
  goto :fail
)
if not exist "migrations\0010_card_balances.sql" (
  echo [HATA] migrations\0010_card_balances.sql bulunamadi.
  goto :fail
)
if not exist "migrations\0011_shop_card_deliveries.sql" (
  echo [HATA] migrations\0011_shop_card_deliveries.sql bulunamadi.
  goto :fail
)

where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi. Node.js LTS kurup tekrar deneyin.
  goto :fail
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [HATA] npm bulunamadi. Node.js LTS kurup tekrar deneyin.
  goto :fail
)

echo [HEDEF] forevye-nexus (production D1)
echo Database ID, wrangler.toml icindeki production [[d1_databases]] bolumunden okunur.
echo DIKKAT: Devam etmeden once Cloudflare hesabinizin dogru oldugunu kontrol edin.
echo.

if not exist "node_modules\wrangler\bin\wrangler.js" (
  echo [1/6] Proje bagimliliklari hazirlaniyor...
  call npm install
  if errorlevel 1 (
    echo [HATA] npm install basarisiz. Yukaridaki hatayi kontrol edin.
    goto :fail
  )
) else (
  echo [1/6] Wrangler bagimliligi mevcut; kurulum atlaniyor.
)

echo.
echo [2/6] Cloudflare oturumu kontrol ediliyor...
call npx wrangler whoami
if errorlevel 1 (
  echo.
  echo Cloudflare oturumu acik degil. Simdi giris penceresini aciyoruz.
  call npx wrangler login
  if errorlevel 1 goto :fail
  call npx wrangler whoami
  if errorlevel 1 goto :fail
)

echo.
echo [3/6] Uzak D1 migration durumlari okunuyor...
call npx wrangler d1 migrations list forevye-nexus --remote
if errorlevel 1 (
  echo [HATA] Uzak D1 migration listesi okunamadi. Hesap, yetki veya veritabani baglantisini kontrol edin.
  goto :fail
)

echo.
echo [4/6] Bekleyen veritabani guncellemeleri uygulanuyor...
call npm run db:migrate:remote
if errorlevel 1 (
  echo [HATA] Uzak migration uygulanamadi. Veritabani sifirlanmadi; mevcut veriler korunuyor.
  goto :fail
)

echo.
echo [5/6] Canli D1 semasi dogrulaniyor...
call npx wrangler d1 execute forevye-nexus --remote --command "SELECT balance FROM cards LIMIT 0" --json
if errorlevel 1 (
  echo [HATA] cards.balance sutunu yok veya okunamiyor. Worker deploy edilmeyecek.
  echo Migration listesinde 0010_card_balances.sql uygulanmis gorunuyor ama bu kontrol basarisizsa migration kaydi ile gercek sema uyusmuyor olabilir.
  echo Migration kayitlarini veya tablolarini elle silmeyin; terminal ciktisini destek icin saklayin.
  goto :fail
)
call npx wrangler d1 execute forevye-nexus --remote --command "SELECT id, tx_ref, user_id, card_id, type, amount, balance_after, counterparty_id, idempotency_key, description, created_at FROM card_ledger LIMIT 0" --json
if errorlevel 1 (
  echo [HATA] card_ledger tablosu veya sutunlari yok. Worker deploy edilmeyecek.
  echo Migration kaydini elle silmeyin; terminal ciktisini destek icin saklayin.
  goto :fail
)
call npx wrangler d1 execute forevye-nexus --remote --command "SELECT purchase_id, user_id, card_id, product_id, created_at FROM shop_card_deliveries LIMIT 0" --json
if errorlevel 1 (
  echo [HATA] shop_card_deliveries tablosu yok. Kart teslimati eksik kalacagi icin Worker deploy edilmeyecek.
  echo migrations\0011_shop_card_deliveries.sql dosyasinin uygulandigini kontrol edin.
  goto :fail
)

echo.
echo [6/6] Nexus Worker yayinlaniyor...
call npm run deploy
if errorlevel 1 (
  echo [HATA] Veritabani guncellendi ancak Worker deploy basarisiz oldu.
  goto :fail
)

echo.
echo [BASARILI] Canli D1 semasi ve otomatik kart teslimati dogrulandi; Worker deploy edildi.
echo Nexus sayfasini Ctrl+Shift+R ile yenileyip kart detayini kontrol edin.
echo.
pause
exit /b 0

:fail
echo.
echo Islem tamamlanamadi. Yukaridaki ilk [HATA] mesajini ve tum terminal ciktisini saklayin.
echo Veritabanini silmeyin, sifirlamayin veya migration kayitlarini elle degistirmeyin.
echo.
pause
exit /b 1
