# 23 Kasım 2026 — Nexus Pass banka entegrasyonu (Faz 4–5)

## Düzeltme (hata)
- `src/worker.js` `GET /api/pass/mine` rotasını `passRoutes.mine` işleyicisine bağlıyordu ama işleyici yoktu → banka içindeki **#/pass** ekranı 500 veriyordu. `src/routes/pass.js`'e `mine` eklendi (Nexus oturumuyla, `shapeEnt` ile active/expired/cancelled; Pass Bearer jetonuyla açılmaz).

## Arayüz
- `public/js/views-ops.js`: İşlemler menüsüne **Nexus Pass** satırı.
- `public/js/views-pass.js`: aktif / süresi doldu / **iptal edildi** rozetleri, ayrı yükleme-boş-hata durumları, 503 ve çevrimdışı için açıklayıcı mesaj, sanal FN + otomatik yenilenmez notu.
- `public/js/admin.js`: **Nexus Pass** sekmesi (paket listesi herkes-yönetici, ekle/güncelle yalnızca süper yönetici; gerekçe zorunlu). Yetki ve doğrulama sunucudaki mevcut `/api/admin/pass/products` uçlarındadır.

## Dokunulmayanlar
Cüzdan, defter, satın alma batch'i, iade, ID giriş akışı, migration'lar (yeni migration YOK), CORS ve CSRF kuralları.

## Test
`npm test`: 72/72 (71 mevcut + `pass: /api/pass/mine ...`).
