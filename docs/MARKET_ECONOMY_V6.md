# Dinamik Kristal Piyasası v6

## Fiyatın bileşenleri

Piyasa fiyatı mevcut canlı veri yollarını korur. Çeyrek altın / gram altın / USD-TRY referansı bulunabildiğinde BIST100, BIST30, XBANK ve XUSIN sinyalleri ile birlikte kullanılır. BIST fiyat yolu veya dış veri bulunmadığı durumlarda iç piyasa yedeği çalışır. Güncelleme kaynağı ve zamanı `/api/market` yanıtında, banka ekranında da şeffaflık alanında yer alır.

`MARKET_INITIAL_PRICE_MICRO` yalnızca henüz fiyat kaydı olmayan kurulumun başlangıç referansıdır. Güncel fiyatı 32 FN'ye çeken bir geri dönüş kuralı, sabit tavan veya sabit taban değildir. Fiyatın alt sınırı yalnızca sıfırdan büyük olmasını sağlayan teknik korumadır.

## Alış / satış baskısı

`crystal_trades` kayıtlarından son 1 saat ve son 24 saatin alım-satım KRS miktarları ve FN hacimleri ayrı hesaplanır. Dengesizlik:

`imbalance = (alış KRS - satış KRS) / (alış KRS + satış KRS)`

Kısa ve uzun pencere birlikte kullanılır:

`pressure = 0.65 × imbalance_1h + 0.35 × imbalance_24h`

`pressure` -1 ile +1 arasında tutulur. Pozitif değer FN→KRS net alış talebini; negatif değer KRS→FN net satış arzını gösterir. Altın hedef fiyatı yolunda akış çarpanı `1 + 0.025 × pressure` olarak uygulanır. BIST ve yedek piyasa yollarında da yönlü akış güncelleme hareketine eklenir.

Alış-satış makasının temel değeri mevcut `MARKET_SPREAD_BPS` ve kullanıcı kart avantajlarından gelir. Akış baskısı makasa `abs(pressure) × MARKET_SPREAD_PRESSURE_BPS` ekler. Her yön için makas `MARKET_MAX_SPREAD_BPS` ile sınırlandırılır; böylece yoğun tek yönlü talep veya arz daha geniş bir işlem makası oluşturur. Ekranda hacim FN cinsindendir; işlem adedi ayrıca gösterilir.

## Yönetici güven endeksi

`market_admin_sentiment` mevcut tablosu ve günlük tek puan kuralı korunur. Kısa vade ortalaması Türkiye yerel tarihine göre bugün dâhil son yedi takvim günündeki puanlardan hesaplanır; bu aralığın dışında kalan eski puanlar kısa vadeye karışmaz. Uzun vade ortalaması mevcut tablodaki bütün günlük puanların ortalamasıdır.

`effective_average = 0.70 × last7_average + 0.30 × long_term_average`

Kısa vadede henüz puan yoksa uzun vade ortalaması kullanılır; hiç kayıt yoksa nötr değer 50 kabul edilir. 50 nötrdür. Endeks, altın hedef fiyatı yolunda `1.2 ^ ((effective_average - 50) / 50)` çarpanını etkiler. Şeffaflık alanı bugünün puanını, 7 günlük ortalamayı, uzun dönem ortalamasını ve birleşik endeksi gösterir.

## Grafik

Grafik aynı etkileşimi 24 saat, 7 gün ve 30 gün pencerelerinde kullanır. Fare veya dokunma hareketi en yakın kayıtlı fiyat örneğini seçer; dikey ve yatay kılavuz ile nokta işaretçisi gösterilir. Bilgi kutusunda veri saklama hassasiyeti olan altı ondalıklı FN fiyatı, örnek zaman damgasının Türkiye yerel tarih/saat karşılığı ve seçili pencerenin ilk örneğine göre yüzde değişim gösterilir. Grafik aralıkları API'nin mevcut geçmiş örneklerinden beslenir.

## Değişiklik ve uyumluluk

Bu sürüm yeni tablo veya yeni SQL migration eklemez. Mevcut günlük yönetici endeksi tablosunu silmez, sıfırlamaz ya da yeniden adlandırmaz. Mevcut API ve kullanıcı bazlı makas avantajları korunur. `0014_bank_access_and_transfer_notes.sql` içindeki yinelenen sütun ekleme ifadesi kaldırılarak temiz kurulumlarda göç sırası çakışması önlenmiştir.
