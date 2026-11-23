# 23.11.2026 — Editör ↔ Nexus bağlantı kopması

- Editör jetonu boşta 30 dk'da düşüyordu (kaydırma 30 dk, üst sınır 4 saat). Tasarım yaparken 30 dk sunucuya istek gitmeyince "Kaydedilemedi / oturum geçersiz" çıkıyordu.
  → `src/routes/editor.js`: kayan süre 2 saat, üst sınır 12 saat. `test/editor.test.mjs` buna uyarlandı.
- Editör tarafı (forevye_nexus_bank): `js/connect.js` açıkken 4 dakikada bir jetonu tazeler, istekler 20 sn'de zaman aşımına uğrar, GET ağ hatasında bir kez yeniden denenir, süresi dolan oturum açık bir mesajla bildirilir (taslak korunur).
- Hâlâ gereken ayar: Nexus'ta `EDITOR_URL` = editör sitesinin adresi (Cloudflare panel → Variables ya da wrangler.toml). Yoksa CORS engeller.
