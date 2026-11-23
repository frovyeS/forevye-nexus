-- Nexus Market: FN ile satılan tasarım ve fonksiyonel kartlar (stok, seri no, kalıcı sahiplik).
-- Bu dosya scripts/gen-shop-migration.mjs ile src/lib/shop.js'ten üretilir.
CREATE TABLE IF NOT EXISTS shop_products (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('design','function')),
  rarity TEXT NOT NULL CHECK (rarity IN ('common','rare','epic','legendary','mythic')),
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  descr TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price > 0),
  stock_total INTEGER CHECK (stock_total IS NULL OR stock_total > 0),
  stock_sold INTEGER NOT NULL DEFAULT 0,
  max_qty INTEGER NOT NULL DEFAULT 1 CHECK (max_qty >= 1 AND max_qty <= 20),
  data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'on' CHECK (status IN ('on','off')),
  is_new INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT shop_stock_bounds CHECK (stock_total IS NULL OR stock_sold <= stock_total)
);
CREATE TABLE IF NOT EXISTS shop_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  price INTEGER NOT NULL,
  serial INTEGER,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','refunded')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shop_purchases_user ON shop_purchases(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS shop_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1),
  serial INTEGER,
  acquired_at INTEGER NOT NULL,
  tx_ref TEXT NOT NULL,
  UNIQUE (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_shop_ent_user ON shop_entitlements(user_id);
CREATE TABLE IF NOT EXISTS shop_card_skins (
  card_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  equipped_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shop_card_skins_user ON shop_card_skins(user_id);
CREATE TABLE IF NOT EXISTS shop_wishlist (
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS shop_guard (
  on_sale INTEGER NOT NULL, stock_ok INTEGER NOT NULL, qty_ok INTEGER NOT NULL,
  CONSTRAINT shop_not_on_sale CHECK (on_sale = 1),
  CONSTRAINT shop_sold_out CHECK (stock_ok = 1),
  CONSTRAINT shop_max_owned CHECK (qty_ok = 1)
);
CREATE TABLE IF NOT EXISTS shop_tickets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, consumed_at INTEGER);
CREATE TABLE IF NOT EXISTS shop_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_shop_tokens_exp ON shop_tokens(expires_at);
INSERT OR IGNORE INTO shop_products (id, kind, rarity, name, tagline, descr, price, stock_total, stock_sold, max_qty, data, status, is_new, sort, created_at, updated_at) VALUES
  ('card_black', 'function', 'mythic', 'Nexus Black', 'Her şeyin en üstü. Yalnızca 50 adet.', 'Altın çift çerçeveli, hareketli ışık süpürmeli siyah kart. Limitlerin 3 katı, borsada %90 daha dar fark ve 2 ek kart hakkı.', 4000000, 50, 0, 1, '{"skin":"royal","perks":{"limit_mult":3,"transfer_mult":3,"spread_discount_pct":90,"extra_cards":2}}', 'on', 1, 1, 0, 0),
  ('skin_guilloche', 'design', 'legendary', 'Altın Gilyoş', 'Banknot işçiliğinde altın rozet.', 'Siyah zemin üzerinde matematiksel gilyoş rozet ve altın folyo parıltısı. Numaralı, 100 adetle sınırlı seri.', 950000, 100, 0, 1, '{"skin":"guilloche"}', 'on', 1, 2, 0, 0),
  ('card_platinum', 'function', 'legendary', 'Platin Borsa Kartı', 'Kristal borsasında daha dar fark.', 'İnce kazınmış platin yüzey. Kristal alış/satışında fark %60 azalır ve +1 kart hakkı verir.', 1200000, 80, 0, 1, '{"skin":"platinum","perks":{"spread_discount_pct":60,"extra_cards":1}}', 'on', 0, 3, 0, 0),
  ('skin_prism', 'design', 'legendary', 'Prizma Cam', 'Işığı bölen, hareketli cam yüzey.', 'Renkli yüzeylere bölünmüş buzlu cam ve yavaşça süpüren ışık. Numaralı, 150 adetle sınırlı seri.', 800000, 150, 0, 1, '{"skin":"prism"}', 'on', 0, 4, 0, 0),
  ('card_titan', 'function', 'epic', 'Titanyum Limit Kartı', 'Günlük ve işlem limitin 2 katı.', 'Fırçalanmış titanyum yüzey. İşlem başına ve günlük transfer limitleri 2 katına çıkar.', 750000, 120, 0, 1, '{"skin":"titan","perks":{"limit_mult":2,"transfer_mult":2}}', 'on', 0, 5, 0, 0),
  ('skin_nebula', 'design', 'epic', 'Nebula', 'Yıldız tozu ve mor bulutlar.', 'Derin uzay zemini üzerinde prosedürel bulutlar ve yıldız alanı.', 480000, 160, 0, 1, '{"skin":"nebula"}', 'on', 0, 6, 0, 0),
  ('skin_aurora', 'design', 'epic', 'Aurora', 'Kuzey ışıkları akışı.', 'Zümrüt, mavi ve mor ışık akıntıları; renk geçişli ışıltılı kenar.', 450000, 180, 0, 1, '{"skin":"aurora"}', 'on', 0, 7, 0, 0),
  ('skin_carbon', 'design', 'rare', 'Karbon Fiber', 'Spor otomobil dokusu.', 'Gerçek karbon örgü deseni ve kırmızı hız şeridi.', 240000, 220, 0, 1, '{"skin":"carbon"}', 'on', 0, 8, 0, 0),
  ('skin_onyx', 'design', 'rare', 'Oniks Mat', 'Sade, mat, altın ince çizgili.', 'Mat siyah zemin, ince gilyoş dokusu ve şampanya altını çerçeve.', 180000, 250, 0, 1, '{"skin":"onyx"}', 'on', 0, 9, 0, 0),
  ('skin_singularity', 'design', 'mythic', 'Singularity', 'Tekillik serisi · 33 adet.', 'Prosedürel yıldız alanı, mor enerji halkaları ve karanlık tekillik. Sadece 33 kart.', 1800000, 33, 0, 1, '{"skin":"singularity"}', 'on', 1, 10, 0, 0),
  ('skin_lunar', 'design', 'legendary', 'Lunar Pearl', 'Sedefli ay yüzeyi · 64 adet.', 'Ay kraterlerinden esinlenen mikro gravür, sedefli seramik ve yörünge çizgileri.', 1250000, 64, 0, 1, '{"skin":"lunar"}', 'on', 1, 11, 0, 0),
  ('skin_aether', 'design', 'legendary', 'Aether Glass', 'Kristal cam koleksiyonu · 48 adet.', 'Katmanlı turkuaz cam, ışık kırılımları ve elde üretilmiş hissi veren geometrik fasetler.', 1400000, 48, 0, 1, '{"skin":"aether"}', 'on', 1, 12, 0, 0),
  ('skin_phoenix', 'design', 'mythic', 'Phoenix Ember', 'Anka serisi · 21 adet.', 'Alev tüyleri, ergimiş bakır damarlar ve sıcak metalik parıltı. Çok sınırlı edisyon.', 2200000, 21, 0, 1, '{"skin":"phoenix"}', 'on', 1, 13, 0, 0),
  ('skin_deepsea', 'design', 'epic', 'Abyssal Bio', 'Derin deniz · 88 adet.', 'Biyolüminesans organizmalar, derin okyanus katmanları ve organik ışık dokusu.', 980000, 88, 0, 1, '{"skin":"deepsea"}', 'on', 1, 14, 0, 0),
  ('skin_chronos', 'design', 'legendary', 'Chronos Engraved', 'Mekanik gravür · 42 adet.', 'Mikro kadran, 120 hassas saat çizgisi ve pirinç/altın gravür dokusu.', 1600000, 42, 0, 1, '{"skin":"chronos"}', 'on', 1, 15, 0, 0),
  ('skin_eclipse', 'design', 'mythic', 'Solar Eclipse', 'Tutulma edisyonu · 29 adet.', 'Altın korona, tutulma halkası ve gece göğünde yayılan sıcak ışık.', 2000000, 29, 0, 1, '{"skin":"eclipse"}', 'on', 1, 16, 0, 0),
  ('skin_celestial', 'design', 'legendary', 'Celestial Atlas', 'Takımyıldız atlası · 56 adet.', 'Safir gece yüzeyinde takımyıldız haritası, yıldız bağlantıları ve altın yörüngeler.', 1500000, 56, 0, 1, '{"skin":"celestial"}', 'on', 1, 17, 0, 0),
  ('slot_extra', 'function', 'common', 'Ek Kart Hakkı', 'Hesabına +1 sanal kart yeri.', 'Her alışta kart sınırın bir artar (en fazla 5 kez alınabilir).', 120000, NULL, 0, 5, '{"perks":{"extra_cards":1}}', 'on', 0, 10, 0, 0);
