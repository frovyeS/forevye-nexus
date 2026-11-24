# FOREVYE NEXUS — 280 kart koleksiyonu entegrasyonu

## Kapsam

- Kaynak katalog: `docs/catalog-280/CATALOG_280.json` (280 benzersiz ürün / 14 koleksiyon).
- Her ürün tek bir `portrait` veya `landscape` yönüne sahiptir.
- Her ürün `stock_total=2`, `max_qty=1` olarak sunucu kataloğuna aktarılır.
- Stok ve sahiplik denetimi mevcut `shop_guard` + D1 atomik satın alma batch'i üzerinden yapılır.
- Seri numarası mevcut altyapı tarafından `001/002` ve `002/002` olarak atanır.
- Fiyat `price_fn` alanından gelir ve mevcut cüzdan/ledger minor-unit yapısında saklanır.
- Koleksiyon adı, kategori kimliği, ürün türü, yön, sanat yönlendirmesi ve varlık durumu `shop_products.data` içinde korunur.

## Görsel işleme

`shared/card-skins.js` içine 280 ürüne özel, deterministik SVG yüzeyleri eklendi. Her yüzey koleksiyon paleti, ürün tipine uygun motif, metalik kenar, foil yansıması ve hareketli ışık taraması kullanır. Editör, yalnızca mevcut kartın yönüyle eşleşen ürünleri listeler; Worker ayrıca yön eşleşmesini sunucuda doğrular. Renderer gerçek tuval ölçülerini alır; dikey ve yatay önizlemeler kendi en-boy oranlarında çizilir.

Bu ürünler mevcut mimaride kalıcı kart yüzeyidir: satın alma koleksiyona sahiplik ekler; yeni banka kartı oluşturmaz. Sahip olunan yüzey, yönü eşleşen mevcut kartına editörden uygulanır. Bu SVG'ler nihai karakter portresi veya resmî kulüp arması değildir. Kaynak katalogdaki `asset_status` alanı korunur:

- `commission_or_original_art_required`: 90 karakter ürünü için özgün illüstrasyon bekleniyor.
- `licensed_or_original_art_required`: 60 kulüp ürünü için lisanslı/izinli resmî arma; 30 Anadolu motif ürünü için kaynakla doğrulanmış özgün motif çizimi bekleniyor.
- `procedural_or_original_material_art`: malzeme yüzeyi prosedürel olarak çizilebilir veya özgün materyal görseliyle değiştirilebilir.

Kulüp armaları yapay zekâ ile yeniden çizilmez. Lisans/izin kaydı olmadan ticari kullanım için resmî arma dosyası eklenmemelidir. Halı-kilim desenlerinde katalogdaki kaynak notları ve motif biçimi korunmalıdır.

## Güncelleme ve dağıtım

- `src/lib/shop.js` içindeki `SEED`, yeni ürünleri `INSERT OR IGNORE` ile yeni veritabanına ekler; mevcut yönetici fiyatı/stoku üzerine yazmaz.
- `migrations/0012_nexus_280_catalog.sql`, mevcut D1 kurulumlarına katalog satırlarını idempotent biçimde eklemek için oluşturuldu.
- `shared/card-skins.js`, `public/js/card-skins.js`, `bank/js/skins.js` ve `market/js/card/skins.js` aynı katalog yüzeylerini kullanır.
- Worker, banka/editör ve market projeleri ayrı ayrı dağıtılmalıdır. Kaynak dosyaların değiştirilmesi canlı siteleri kendiliğinden güncellemez.
- Dağıtım öncesi: `npm run db:migrate:remote`, ardından Worker deploy; banka/editör ve market dosyaları kendi statik hosting depolarına aktarılmalıdır.

## Doğrulama

`npm test`: 90/90 test geçmeli. Testler katalog adedini, ürün benzersizliğini, stok=2 / kullanıcı başına=1 kuralını, seri numaralarını, üçüncü alıcının reddedilmesini, yatay/dikey renderer tuvalini ve migration eşleşmesini denetler.


## Özgün koleksiyon vitrinleri (2026-11-24)

- 14 koleksiyon için üçüncü taraf karakter/arma/logo içermeyen özgün SVG vitrin görselleri eklendi.
- 280 ürünün yönüne göre kart yüzeyi oluşturması otomatik testte doğrulandı; yıldız temalı 45 kartta özgün takımyıldız geometrisi kullanılır.
- Market ana sayfası bu görselleri responsive koleksiyon kartlarında gösterir; kart bağlantıları ilgili ürün grubunu filtreler.
- Karakter/klüp ürün notları resmî karakter görseli veya arma kullanılmadığını belirtir.
- Görsel sınırlar ve isim/marka kullanımıyla ilgili kalan kontrol `ASSET_POLICY_TR.md` içindedir.
