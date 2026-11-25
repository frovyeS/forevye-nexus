// FOREVYE — SABİT (KODA GÖMÜLÜ) SİTE ADRESLERİ · Nexus tarafı
// ---------------------------------------------------------------------------
// Forevye siteleri İKİ ayrı GitHub hesabında yayınlanır (mhaforevye + frovyes); sunucular da iki ayrı Cloudflare hesabındadır.
// Banka / Kart editörü / Market / Pass sitelerinin CORS izni eskiden yalnızca Cloudflare değişkenlerinden (BANK_URL, EDITOR_URL,
// SHOP_URL, PASS_URL, *_ORIGINS) geliyordu: panelde değer silinince, yanlış hesaba deploy edilince ya da site diğer GitHub
// hesabına taşınınca "ulaşılamadı" / CORS hatası oluşuyordu.
//
// ARTIK bu iki GitHub origin'i HER ZAMAN izinlidir; değişkenler bunlara EK adres ekleyebilir, kaldıramaz.
// Karşılığı: MikroKlimaKontrolMerkezi/worker/origins.js — iki dosya aynı listeyi taşımalıdır (test/origins.test.mjs denetler).
// Yeni bir GitHub hesabı eklenecekse iki dosyaya birden yazılır. Joker yok; yalnızca tam origin eşleşir. Çerez yok; kimlik bilet/Bearer'da.
export const PINNED_SITE_ORIGINS = Object.freeze([
  'https://mhaforevye.github.io',
  'https://frovyes.github.io',
]);

// Değişken değerlerini (URL ya da virgülle liste) origin'e indirger; geçersiz değer yok sayılır; sabit adresler her zaman dahildir.
export function siteOrigins(...vals) {
  const out = [...PINNED_SITE_ORIGINS];
  for (const v of vals) {
    for (const u of String(v == null ? '' : v).split(',')) {
      try { const o = u.trim() && new URL(u.trim()).origin; if (o && o !== 'null' && !out.includes(o)) out.push(o); } catch { /* geçersiz adres yok sayılır */ }
    }
  }
  return out;
}
