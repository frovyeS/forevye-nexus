# 23.11.2026 — Dosya yerleşimi düzeltmesi

- Kökte kalmış yeni dosyalar yerine taşındı: `upstream.js` → `src/lib/`, `giftcard.js` → `src/integrations/` (eskisinin yerine), `mail.js` → `src/lib/` (eskisinin yerine).
- `docs /` (adı sonunda boşluklu klasör) `docs/` ile birleştirildi.
- Eski Pass sürümü kaldırıldı: `src/lib/pass.js`, `migrations/0006_pass.sql` (güncel olan `src/routes/pass.js` + `0007_nexus_pass.sql`, `nxp_*` tabloları). İade/ters kayıtta üyelik, `nxp_purchases` üzerinden ters kayıt kontrolüyle zaten kapanıyor.
- `test/app.test.mjs`: iki kart testi yeni (v3 katmanlı) tasarım sözleşmesine uyarlandı. Sonuç: 70/70 test geçiyor.
