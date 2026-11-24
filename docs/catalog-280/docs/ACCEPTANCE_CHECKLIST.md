# Kabul Kontrol Listesi — 280 Kart

## Katalog ve stok
- [ ] Tam 280 benzersiz ürün ID'si
- [ ] Her ürün yalnızca bir orientation içeriyor
- [ ] Her üründe stock_total=2 ve max_qty_per_user=1
- [ ] 15 Türk + 15 yabancı futbol kulübü mevcut
- [ ] 15 Türk + 15 yabancı basketbol kulübü mevcut
- [ ] 30 halı-kilim motifi katalogda mevcut
- [ ] Reddedilen Performans Otomotiv / Havacılık / Mimari kategorileri yok

## Kulüp kartları
- [ ] Oyuncu portresi, oyuncu adı, forma numarası veya istatistik yok
- [ ] Kulüp arması doğru, net ve oranları korunmuş
- [ ] Kulüp renkleri doğru
- [ ] Arma varlıklarının ticari kullanım izni kayıtlı
- [ ] Arma ile sistem logosu/QR/çip/numara birbirine karışmıyor

## Halı-kilim
- [ ] Her motif adı kaynakla doğrulandı
- [ ] Bölgesel adlandırmalar doğru notlandı
- [ ] Motif geometrisi referansa uygun
- [ ] Kaynağı olmayan sembolik anlam iddiaları çıkarıldı
- [ ] Düz dokuma kilim ile düğümlü halı dokusu karıştırılmadı

## Render ve işleyiş
- [ ] Yatay 856×540 / dikey 540×856 gerçek proje şablonuyla doğrulandı
- [ ] QR iki yönde taranıyor ve gerçek hedefe gidiyor
- [ ] Logo, çip, QR, kart kodu, numara ve kullanıcı adı çakışmıyor
- [ ] 2 farklı kullanıcı birer kopya alabiliyor
- [ ] Aynı kullanıcı ikinci kopyayı alamıyor
- [ ] 3. toplam alıcı alamıyor
- [ ] Eşzamanlı satın alma testinde yalnızca 2 başarı
- [ ] Idempotency çift ücret/teslimatı önlüyor
- [ ] FN ledger, stok, entitlement, purchase ve teslimat tutarlı
- [ ] Satın alınan kart Kartlarım'da görünüyor
- [ ] Mevcut skin ve kullanıcı tasarımları geriye uyumlu
- [ ] Mobil Market ve tükenmiş ürün durumu test edildi
