# FOREVYE NEXUS — 280 Kartlık Market Koleksiyonu
## 10 kişilik ekip için ortak görev emri

**Çalışma modeli:** 10 kişi aynı teslimatın tamamından sorumludur. Alanlar bağımsız silolar değildir; katalog, tasarım, backend, market, teslimat ve test birlikte gözden geçirilir. Her PR ortak kontrol listesinden geçer.

## 1. Kaynak proje ve mimari
İş, ekipte bulunan şu üç kaynak ZIP ile yürütülmelidir:
- `forevye-nexus-main`: ana uygulama, Worker/D1, shop API, migration, satın alma ve kart teslimatı.
- `forevye_nexus_bank-main`: kart editörü, FNXRules/FNXRender/FNXSkins, yatay-dikey şablonlar, QR.
- `nexus-market-main`: Market arayüzü, ürün listeleme/detay/satın alma ve kart yüzeyi.

Uygulama öncesi ekip, ilgili kaynak kodu yeniden açıp mevcut tablo/alan adlarını ve renderer giriş noktalarını doğrulamalıdır. Bu paket tek başına kod tabanı değildir.

## 2. Katalog kuralları
1. Toplam 280 benzersiz ürün bulunur.
2. Her ürünün yalnızca bir `orientation` değeri vardır: `landscape` veya `portrait`. Aynı ürünün diğer yönde ikinci varyantı üretilemez.
3. Her ürünün `stock_total=2`, `max_qty_per_user=1` değerleri değişmez.
4. İki farklı kullanıcı birer kopya alabilir; aynı kullanıcı ikinci kopyayı alamaz; üçüncü alıcı stok bulamaz.
5. Satın alma yarışı, idempotency, FN bakiyesi, ledger, stok, sahiplik, purchase ve teslimat kayıtları sunucuda atomik yönetilmelidir.
6. Seri numaraları sunucu tarafından atanır: `001/002` ve `002/002`.
7. Fiyatlar FN cinsindendir; `price_fn` öneri değeridir. Backend alanının minor-unit yapısı doğrulanmadan doğrudan aktarılmamalıdır.

## 3. Futbol ve basketbol kulüp taraftar kartları
**Oyuncu kartı yapılmayacak.** Oyuncu yüzü/fotoğrafı, oyuncu adı, forma numarası, oyuncu istatistiği veya oyuncuya özel seri yoktur.

Her kartta:
- Kulübün resmî arması büyük, net ve doğru oranlarda ana odak olmalı.
- Kulübün gerçek renkleri tasarımın ana paleti olmalı.
- Kulüp adı ve branş bilgisi okunaklı olmalı.
- Metalik/folyo/emaye hissi, katmanlı kenar ve kontrollü ışıkla premium görünüm sağlanmalı.
- Tribün/arena atmosferi arka plan dokusu olarak kullanılabilir; armayı bastırmamalı.
- Armada harf, yıldız, tarih veya şekil değiştirilmemeli; AI ile logo yeniden çizilip bozulmamalı.
- Kullanılan arma ve marka varlıklarının lisans/izin kaydı tutulmalı. Resmî kaynakta bulunması tek başına ticari kullanım izni anlamına gelmez.

Katalogda 15 Türk + 15 yabancı futbol kulübü ve 15 Türk + 15 yabancı basketbol kulübü vardır.

## 4. Türk halısı ve kilim motifleri
- Koleksiyon 30 motif ailesinden oluşur.
- Motiflerin isimleri ve çizim referansları Anadolu/Türk halı-kilim literatürü ve müze yayınıyla karşılaştırılmalıdır.
- Çengel, koçboynuzu, elibelinde, hayat ağacı, mihrap, parmaklı, baklava gibi adlar kaynakta geçen biçimleriyle kullanılmalı.
- Yöresel adlandırmalar (ör. gelin kız, kral kızı) birbirinin evrensel eş anlamlısı gibi sunulmamalı; bölge notu varsa korunmalı.
- Her motife kesin anlam atfedilmemeli. Kaynaklar anlamların yöreye ve dokuyucuya göre değiştiğini belirtir.
- Motifin temel geometrisi korunmalı; sadece palet, doku, çerçeve ve kart sunumu özgünleştirilmeli.
- Halı ve kilim tekniği karıştırılmamalı: havlı düğümlü halı dokusu ile düz dokuma kilim dokusu aynı şey değildir.

## 5. Tasarım ve renderer
- Yatay tuval 856×540, dikey tuval 540×856; bunlar mevcut projedeki şablonlarla tekrar doğrulanmalıdır.
- Dikey tasarım yatayın döndürülmüş kopyası değildir; ayrı kompozisyon hazırlanır.
- Logo, çip, QR, kart kodu, numara ve kullanıcı adı gibi sistem alanları tasarım katmanlarıyla kapatılmaz.
- QR dekor değildir; gerçek, taranabilir, doğru hedefe giden ve hassas veri içermeyen kod olmalıdır.
- Kulüp arması ile sistem logosu birbirinden ayrılmalı; ikisi de doğru koruma alanında kalmalıdır.

## 6. Backend ve teslimat
- Ürün stok kontrolü sadece istemcide yapılmaz.
- Aynı ürüne eşzamanlı satın alma testinde yalnızca iki farklı kullanıcı başarılı olabilir.
- Aynı kullanıcı için ikinci kopya ve üçüncü toplam kopya reddedilir.
- Satın alma sonrası kart Kartlarım'a fonksiyonel olarak teslim edilir.
- Mevcut skin ve kullanıcı tasarımları geriye uyumlu kalır.
- İade/ters kayıt ve tükenen ürün davranışı açıkça test edilir.

## 7. Teslimat
- 280 ürün JSON ve CSV ile sisteme alınabilir.
- Her ürün için tek yön, 2 adet stok ve 1 adet/kullanıcı sınırları test edilmiştir.
- Kulüp armalarının hak/izin kaydı ve motif kaynak notları tutulmuştur.
- Mobil Market, kart önizleme, satın alma, teslimat ve QR testleri tamamlanmıştır.
