@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  FOREVYE NEXUS - KART BAKIYESI VERITABANI DUZELTMESI
echo  =====================================================
echo.

if not exist "wrangler.toml" (
  echo [HATA] wrangler.toml bulunamadi.
  echo Bu ZIP'in icerigini forevye-nexus-main klasorunun icine cikartin.
  echo Bu BAT dosyasi package.json ve wrangler.toml ile ayni klasorde olmali.
  goto :fail
)
if not exist "package.json" (
  echo [HATA] package.json bulunamadi. Yanlis klasordesiniz.
  goto :fail
)
if not exist "migrations\0010_card_balances.sql" (
  echo [HATA] migrations\0010_card_balances.sql bulunamadi.
  echo ZIP icerigini proje kokune dogru cikartin.
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

echo [1/5] Proje bagimliliklari hazirlaniyor...
call npm install
if errorlevel 1 (
  echo [HATA] npm install basarisiz. Yukaridaki hatayi kontrol edin.
  goto :fail
)

echo.
echo [2/5] Cloudflare oturumu kontrol ediliyor...
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
echo [3/5] Uzak forevye-nexus D1 veritabanina migration uygulaniyor...
call npx wrangler d1 migrations apply forevye-nexus --remote
if errorlevel 1 (
  echo.
  echo [HATA] Migration uygulanamadi. Hata metnini silmeyin veya veritabanini sifirlamayin.
  echo Yanlis Cloudflare hesabi, D1 yetkisi veya mevcut migration kaydi soz konusu olabilir.
  goto :fail
)

echo.
echo [4/5] Canli D1 semasi dogrulaniyor...
call npx wrangler d1 execute forevye-nexus --remote --command "SELECT balance FROM cards LIMIT 0" --json
if errorlevel 1 (
  echo [HATA] cards.balance sutunu dogrulanamadi. Deploy yapilmadi.
  goto :fail
)
call npx wrangler d1 execute forevye-nexus --remote --command "SELECT id, tx_ref, user_id, card_id, type, amount, balance_after, counterparty_id, idempotency_key, description, created_at FROM card_ledger LIMIT 0" --json
if errorlevel 1 (
  echo [HATA] card_ledger tablosu dogrulanamadi. Deploy yapilmadi.
  goto :fail
)

echo.
echo [5/5] Nexus Worker yayinlaniyor...
call npm run deploy
if errorlevel 1 (
  echo [HATA] Migration tamamlandi ancak Worker deploy basarisiz oldu.
  goto :fail
)

echo.
echo [BASARILI] Kart bakiyesi semasi canli D1 uzerinde dogrulandi ve Worker deploy edildi.
echo Tarayiciyi Ctrl+Shift+R ile yenileyip karta tekrar para yuklemeyi deneyin.
echo.
pause
exit /b 0

:fail
echo.
echo Islem tamamlanamadi. Yukaridaki ilk [HATA] mesajini ve terminal ciktisini paylasin.
echo Veritabanini silmeyin, sifirlamayin ve migration dosyasinin numarasini degistirmeyin.
echo.
pause
exit /b 1
