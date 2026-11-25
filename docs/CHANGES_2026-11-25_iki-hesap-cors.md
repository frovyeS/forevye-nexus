# 2026-11-25 — İki GitHub / iki Cloudflare hesabı: site adresleri koda gömüldü

## Sorun
Banka / Kart editörü / Market / Pass sitelerinin CORS izni yalnızca Cloudflare değişkenlerinden (`BANK_URL`, `EDITOR_URL`, `SHOP_URL`,
`PASS_URL`, `*_ORIGINS`) geliyordu. Forevye iki GitHub hesabında (`mhaforevye`, `frovyes`) ve iki Cloudflare hesabında (Mikro-Klima ↔ Nexus)
çalıştığı için; panelde silinen/yanlış değer, yanlış hesaba deploy ya da sitenin diğer GitHub hesabına taşınması CORS'u kapatıp
bankada "ulaşılamadı" gibi hatalar üretebiliyordu.

## Çözüm
- `src/lib/origins.js` (yeni): `PINNED_SITE_ORIGINS` = `https://mhaforevye.github.io`, `https://frovyes.github.io`.
- `src/routes/bank.js`, `shop.js`, `pass.js`, `editor.js`: `bankOrigins / shopOrigins / passOrigins / editorOrigins` artık
  `siteOrigins(<*_URL>, <*_ORIGINS>)` döndürür → sabit iki adres **her zaman** + değişkenlerdeki ek adresler. Değişken boş/yanlış olsa da çalışır.
- Joker yok; yalnızca tam origin eşleşir. Listede olmayan origin `403` alır.
- `wrangler.toml`: `account_id` koruması (yorum olarak hazır; kendi hesap kimliğini yazıp aç) ve sabit adres notu.
- Aynı liste Mikro-Klima deposunda `worker/origins.js` içindedir; yeni site eklerken **iki dosyaya birden** yazılır.

## Test
`test/origins.test.mjs` (yeni, `npm test`'e eklendi): değişken yokken / yanlışken iki hesap için tüm site uçlarında `OPTIONS 204` ve hata
yanıtlarında CORS başlığı; yabancı origin'lerin reddi; ek adres desteği; Mikro-Klima listesiyle tutarlılık.
