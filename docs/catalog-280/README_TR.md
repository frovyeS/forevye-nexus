# FOREVYE NEXUS — 280 Kartlık Market Koleksiyonu

Bu paket, mevcut 250 kartlık kataloğun onaylanmayan üç kategorisini çıkarıp futbol/basketbol kulüp taraftar kartları ve doğrulanmış Anadolu/Türk halı-kilim motifleriyle günceller. **Toplam ürün: 280.**

## Kategori dağılımı
- Cars — Piston Cup: 30
- Adventure Time: 20
- The Amazing World of Gumball: 20
- Gaming Legends: 20
- Executive Materials: 20
- Luxury Craft: 20
- Precision & Engineering: 20
- Finance & Heritage: 20
- Modern Surface Lab: 20
- Futbol taraftar kartları: 15 Türk + 15 yabancı = 30
- Basketbol taraftar kartları: 15 Türk + 15 yabancı = 30
- Anadolu/Türk halı-kilim motifleri: 30

## Yeni kulüp kartlarının tasarım kuralı
Futbol ve basketbol kartları **oyuncu kartı değildir**. Oyuncu fotoğrafı, oyuncu adı, forma numarası veya oyuncu istatistiği kullanılmayacak. Kartın ana odağı kulübün resmî arması ve kulüp renkleridir. Tribün/arena dokusu yalnızca arka planı destekler. Arma oranları, renkleri ve okunabilirliği korunur; logo dosyası lisanslı/izinli kaynaktan temin edilir.

## Halı-kilim koleksiyonu
30 ürün, Anadolu/Türk halı-kilim geleneğinde belgelenmiş motif adları ve biçim ailelerinden oluşturuldu. Motiflerin anlamları yöreye ve dokuyucuya göre değişebildiğinden katalog, her motife kesin ve tek bir sembolik anlam yüklemez. Özgün motif geometrisi korunmalı; uydurma motifler “Türk motifi” diye etiketlenmemelidir.

## Dosyalar
- `CATALOG_280.json`: ürün kataloğu
- `CATALOG_280.csv`: ekip inceleme tablosu
- `docs/TEAM_WORK_ORDER.md`: ortak ekip çalışma şartnamesi
- `docs/ACCEPTANCE_CHECKLIST.md`: kabul testleri
- `docs/ASSET_GUIDE.md`: varlık, logo ve motif kaynağı kuralları
- `TEAM_WORK_ORDER.pdf`: paylaşılabilir PDF görev emri
- `SOURCES.md`: halı-kilim motifleri için araştırma kaynakları

## Uygulama notu
Bu paket ürün kataloğu ve ekip şartnamesidir; hazır kart illüstrasyonlarını veya uygulama kodu değişikliklerini içermez. `price_fn` değerleri katalog önerisidir. Backend'e aktarılmadan önce mevcut fiyat alanının birimi ve minor-unit dönüşümü doğrulanmalıdır.
