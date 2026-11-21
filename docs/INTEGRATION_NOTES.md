# Entegrasyon notları

## 1. Hediye kartı sistemi = Mikro-Klima kristal kartları (BAĞLANDI)
Mevcut hediye kartı sistemi Mikro-Klima Worker'ındaki `gcards`'tır (kristal kartı: no + CVV + SKT). Yeniden yazılmadı;
Mikro-Klima'ya sunucudan sunucuya bir uç eklendi (`worker/nexus.js`) ve `src/integrations/giftcard.js` ona bağlandı:

    POST {GIFTCARD_API_URL}/redeem      GET {GIFTCARD_API_URL}/health
    x-nx-timestamp, x-nx-signature = HMAC-SHA256(GIFTCARD_API_SECRET, "<timestamp>.<gövde>")
    gövde: { user_id, code: "NNNNNNNN CVV AA/YY", idempotency_key }
    200: { ok:true, amount:<kristal>, unit:"kristal", reference:"mkgc:<kart no>" }   4xx: { ok:false, error:"invalid|used|expired" }

- Kart kodu tek metindir (`12345674 123 05/27`); Nexus arayüzündeki kod kutusu değişmeden çalışır.
- Kristal → FN kuru `GIFTCARD_MINOR_PER_KRISTAL` (wrangler.toml, varsayılan 100: 1 kristal = 1,00 FN). Bu bir ekonomi kararıdır; kuru sen belirle.
- `GIFTCARD_API_SECRET` (Nexus) = `NEXUS_SECRET` (Mikro-Klima): `npx wrangler secret put ...` ile her iki tarafa AYNI değer (en az 16 karakter).
- Aynı kullanıcı aynı kartı tekrar gönderirse aynı `reference` döner; defter referansla tekrar-güvenlidir. Kart başka kullanıcıdaysa `used`.

## 1b. Giriş = FOREVYE ID (BAĞLANDI)
`POST /api/auth/id/start` (PKCE adresi), `GET /api/auth/id/callback` (kod değişimi → çerez oturumu), `POST /api/auth/id/complete` (ilk girişte kullanıcı adı + kart ismi).
Tablolar: `id_links` (Nexus kullanıcısı ↔ ID kullanıcısı), `id_states`, `id_pending` (migrations/0002_forevye_id.sql). Ayarlar: `ID_URL`, `ID_API_URL`; Mikro-Klima tarafında `ID_REDIRECTS`'e `sanal-banka=<site>/api/auth/id/callback`.
Eski e-posta hesabı, aynı doğrulanmış e-posta ile ID'ye ilk girişte otomatik bağlanır. `LEGACY_LOGIN="off"` e-posta/şifre kayıt ve girişini (410) kapatır; önce herkesin ID ile bağlandığından emin ol.

## 2. Oyun içi alışveriş (sunucudan sunucuya)
`POST /api/internal/purchase` { user_id, amount:"10.00", external_ref } — `Authorization: Bearer INTERNAL_API_KEY`.
Aynı `external_ref` tekrar gönderilirse ikinci kez düşülmez. İade: `POST /api/internal/refund` { ref }.
Mevcut oyun/mağaza sistemini bu uçlara bağlayın; kullanıcı kimliği olarak `user_id` (UUID) kullanılır.

## 3. Kart editörü = forevye_nexus_bank (BAĞLANDI)
Kart tasarımı artık yalnızca banka editöründe (ayrı site) yapılır; Nexus'taki eski süs/desen editörü kaldırıldı.
- Akış: Nexus → **Kartını tasarla** → `POST /api/editor/ticket` (tek kullanımlık, 5 dk, URL'nin `#t=` kısmında) → editör `POST /api/editor/exchange` ile bileti jetona çevirir (30 dk kayan, en çok 4 saat) → **Kaydet** = `PUT /api/editor/card` → **Çık** = `NEXUS/#/cards/<id>`.
- Doğrulama: `shared/card-rules.js` = editörün `js/rules.js` dosyasının BİREBİR kopyası (iki depoda aynı kalmalı). Sunucu istemciye güvenmez: `designId/ownerId/version` ve kart adını kendisi yazar; çip/marka/kart bilgisi veri modelinde yoktur.
- Sözleşme sürümü 2 (856×540, katmanlar). Eski sürüm 1 kartlar (320×200) veritabanında olduğu gibi durur, okunurken `convertV1` ile çevrilir; editörde ilk kayıtta sürüm 2 olarak yazılır.
- Kart adı (2–18 karakter) = tasarımın `userDisplayName` alanı; kayıt/ID kayıt formları da aynı kuralı kullanır.
- Ayar: `EDITOR_URL` (editörün yayın adresi; CORS yalnızca bu kaynağa açılır), isteğe bağlı `EDITOR_ORIGINS`. Migration: `0004_editor.sql`.
- Giriş: editör açıkken oturum yoksa kapı gösterilir → `NEXUS/#/editor-launch/<kart|new>` → (FOREVYE ID ile) giriş → bilet → editör. FOREVYE ID girişi sayfadan çıkıp döndüğü için hedef sekme belleğinde (`sessionStorage.nx_next`) tutulur.
- Dosyaları eşitle: `npm run sync-shared` (`shared/*.js` → `public/js/`). Çizici `public/js/card-render.js` = editörün `js/render.js` dosyası.

## 3b. Logo
`public/assets/logo.svg` YER TUTUCUDUR. Resmî logoyu aynı dosya adıyla koyun. Kart üzerindeki logo `wordmark.png` ile çizilir.

## 4. Kristal borsası
Altın fiyat kaynağı ve parametreler için README'deki "Para birimi ve Kristal Borsası" bölümüne bakın. Oyun içi mağaza kristalle ödeme isterse `POST /api/internal/purchase` FN düşer; kristal→FN dönüşümü kullanıcı tarafından borsadan yapılır.

## 5. Ortak e-posta (Brevo) ve yük aktarımı — Mikro-Klima Worker
Mikro-Klima, FOREVYE ID ve Nexus için ortak hizmetleri üstlenir; Nexus Worker'ı bu işlerle yorulmaz:
- **Posta:** `POST {MAIL_RELAY_URL}/api/ext/mail` (imza: hediye kartıyla aynı HMAC). FOREVYE ID de aynı `worker/mail.js` modülünü kullanır → tek Brevo hesabı, tek gönderen adresi. Nexus'ta `EMAIL_PROVIDER="relay"`; `BREVO_API_KEY`/`EMAIL_FROM` yalnızca Mikro-Klima'da gerekir (Nexus'ta isteğe bağlı yedek). Alıcı başına 10 dk'da 5, toplam 10 dk'da 80 posta sınırı vardır.
- **Altın fiyatı:** `GET /api/ext/gold` Mikro-Klima'da 60 sn önbelleklenir; Nexus `GOLD_API_URL` ile oradan okur (çökerse doğrudan yedek kaynağa düşer).
- Gizli anahtar: `GIFTCARD_API_SECRET` (Nexus) = `NEXUS_SECRET` (Mikro-Klima), aynı değer.
