# 23.11.2026 — Kart editörü düzeltmeleri

## Görünen hataların kök nedenleri
- Editör çizicisi `R.CANVAS` üzerinden sabit yatay 856×540 boyutlarını kullanıyordu. Dikey düğmesi tasarım modelini portrait yapsa da SVG çizimi hâlâ yatay tuvalde kalıyordu. Çizici artık tasarımın `orientation` alanından 540×856 veya 856×540 tuval seçiyor.
- Sistem alanları (`brand`, `chip`, `code`, `number`, `name`, `qr`) ekranda sabit koordinatlarla çiziliyordu; editördeki konum/ölçek değerleri uygulanmıyordu. Çizim artık `design.sys` koordinatlarını ve ölçeklerini kullanıyor.
- Kart kodu ve kart numarası katman listesinde bulunmasına rağmen kartın üzerinde doğru koordinatlarda gösterilmiyordu. Kod artık kart kodunu, maskelenmiş numarayı ve son dört haneyi ayrı alanlarda gösteriyor. Tam kart numarası istemciye taşınmaz.
- Şekil listesinde tanımlı 22 türün bir kısmının SVG çizicisi yoktu. Eksik `rect`, `diamond`, `dots`, `rings`, `rays`, `hexgrid`, `glow`, `beam` çizimleri eklendi; bilinmeyen türler editörü çökertmez.
- Editörün API bağlantısı için Worker tarafındaki `EDITOR_URL` / `EDITOR_ORIGINS` yapılandırması wrangler.toml içinde boş/yorum satırı durumundaydı. Gerçek GitHub Pages editör adresi ve izinli origin etkinleştirildi.

## Senkronizasyon
- Editör `js/rules.js` dosyası Worker `shared/card-rules.js` ve `public/js/card-rules.js` ile aynı hale getirildi.
- Editör `js/render.js` dosyası Worker `public/js/card-render.js` ile aynı hale getirildi.

## Kontroller
- Editör ve Worker çizici dosyaları `node --check` ile doğrulandı.
- Yatay ve dikey kartların SVG viewBox değerleri, kart kodu, maskeli kart numarası, kart sahibi ve QR çıktısı otomatik test edildi.
- 22 şekil türünün tamamı çizim testinden geçti.
- Worker test paketi: 74/74 geçti.

## Yayınlama gerekli
Kaynak dosyalar bu pakette düzeltildi; canlı GitHub Pages ve Cloudflare Worker kendiliğinden değişmez. Editör klasörünün içeriği GitHub Pages deposuna; Worker klasörü Cloudflare'a deploy edilmelidir.
