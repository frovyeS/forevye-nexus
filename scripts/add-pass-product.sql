-- Nexus Pass kataloğuna paket ekler / günceller. Fiyat minor unit'tir (1 FN = 100): 5000 = 50,00 FN. Süre saniyedir: 30 gün = 2592000.
-- Çalıştır: npx wrangler d1 execute forevye-nexus --remote --file=scripts/add-pass-product.sql
INSERT INTO nxp_products (id, app, name, description, features_json, price, duration_sec, status, sort, created_at, updated_at)
VALUES ('weather-premium-30', 'Mikro-Klima Hava', 'Premium · 30 gün', 'Gelişmiş hava özellikleri 30 gün açık.',
        '["Reklamsız deneyim","Gelişmiş tahmin ekranları"]', 5000, 2592000, 'on', 0,
        CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000)
ON CONFLICT(id) DO UPDATE SET app = excluded.app, name = excluded.name, description = excluded.description,
  features_json = excluded.features_json, price = excluded.price, duration_sec = excluded.duration_sec,
  status = excluded.status, updated_at = excluded.updated_at;
