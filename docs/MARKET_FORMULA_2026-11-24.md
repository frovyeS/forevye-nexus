# FOREVYE NEXUS — Dinamik KRS fiyat modeli (v5)

25 FN yalnızca başlangıç fiyatıdır. Fiyatın 25'e geri dönmesi veya 20–30/22.5–27.5 gibi mutlak aralıkta kalması zorlanmaz. Rastgele hareket kaldırılmıştır. Fiyat pozitif olmak dışında mutlak alt/üst sınıra sahip değildir.

## Referans formülü

Hedef fiyat, başlangıçta kaydedilen altın ve BIST/FX referanslarına göre hesaplanır:

- Çeyrek altın: 0.35 üs
- Gram altın: 0.15 üs
- USD/TRY: 0.10 üs
- Çeyrek/gram sarrafiye primi: 0.05 üs
- Gram altın / gümüş oranı: 0.05 üs
- BIST100: 0.30 üs
- BIST30: 0.18 üs
- XBANK: 0.12 üs
- XUSIN: 0.10 üs
- USD/TRY BIST sinyali: 0.15 üs
- Alış/satış akış baskısı: maksimum hedef çarpanı ±2.5%
- 30 günlük hediye kodu ve günlük ödül emisyonu: `(1 + minted / circulating supply)^(-0.65)`

Kümülatif BIST/FX verisi başlangıç referansına göre ölçülür; günlük değişim aynı yenilemede tekrar tekrar bileşiklenmez.

## Hareket

Hedefle mevcut fiyat arasındaki farkın %45'i her güncellemede uygulanır. Normal adım limiti en az %12; sert endeks hareketi veya hedef farkı %12'yi aşarsa tek adımda %30'a kadar izin verilir. Bu limitler hedef fiyata sabit tavan/taban değildir, yalnızca tek güncellemenin hızını sınırlar. Fiyat sıfırın altına inmez.

Veri kaynakları kullanılamazsa rastgele fiyat üretilmez; mevcut fiyat korunur. Hediye/emisyon tabloları yoksa emisyon faktörü 1 kabul edilir.
