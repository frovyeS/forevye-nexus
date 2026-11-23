// Nexus Market ortak yardımcıları: şema güvencesi, katalog tohumu, fonksiyonel kart (perk) hesabı, iade/düzeltmede hak geri alma.
// Hem market rotaları hem transfer/borsa/kart yolları kullanır (perk uygulaması sunucuda yapılır; istemciye güvenilmez).
import { now, cfgNum } from './util.js';
import '../../shared/card-skins.js';

export const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic'];
export const KINDS = ['design', 'function'];
const SKINS = () => globalThis.FNXSkins;

// migrations/0007_shop.sql bu dizilerden üretilir (scripts/gen-shop-migration.mjs); canlı D1'e uygulanmadıysa tablolar ilk çağrıda kendiliğinden kurulur.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shop_products (
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
)`,
  `CREATE TABLE IF NOT EXISTS shop_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  price INTEGER NOT NULL,
  serial INTEGER,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','refunded')),
  created_at INTEGER NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_shop_purchases_user ON shop_purchases(user_id, created_at DESC)',
  `CREATE TABLE IF NOT EXISTS shop_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1),
  serial INTEGER,
  acquired_at INTEGER NOT NULL,
  tx_ref TEXT NOT NULL,
  UNIQUE (user_id, product_id)
)`,
  'CREATE INDEX IF NOT EXISTS idx_shop_ent_user ON shop_entitlements(user_id)',
  `CREATE TABLE IF NOT EXISTS shop_card_skins (
  card_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  equipped_at INTEGER NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_shop_card_skins_user ON shop_card_skins(user_id)',
  `CREATE TABLE IF NOT EXISTS shop_wishlist (
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, product_id)
)`,
  // Atomik koruma: satın alma toplu işleminde stok/sahiplik/satış durumu bu CHECK'lerden birine takılırsa tüm işlem geri alınır.
  `CREATE TABLE IF NOT EXISTS shop_guard (
  on_sale INTEGER NOT NULL, stock_ok INTEGER NOT NULL, qty_ok INTEGER NOT NULL,
  CONSTRAINT shop_not_on_sale CHECK (on_sale = 1),
  CONSTRAINT shop_sold_out CHECK (stock_ok = 1),
  CONSTRAINT shop_max_owned CHECK (qty_ok = 1)
)`,
  'CREATE TABLE IF NOT EXISTS shop_tickets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, consumed_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS shop_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_shop_tokens_exp ON shop_tokens(expires_at)',
];

// Katalog tohumu (fiyatlar minor birim: 100 = 1,00 FN). Tasarım kartları editörde bulunmayan yüzeylerdir; fonksiyonel kartlar ayrıca gerçek banka avantajı verir.
// sort: vitrin sırası. INSERT OR IGNORE: canlıda yöneticinin değiştirdiği fiyat/stok yeniden başlatmada ezilmez.
export const SEED = [
  { id: 'card_black', kind: 'function', rarity: 'mythic', name: 'Nexus Black', tagline: 'Her şeyin en üstü. Yalnızca 50 adet.', descr: 'Altın çift çerçeveli, hareketli ışık süpürmeli siyah kart. Limitlerin 3 katı, borsada %90 daha dar fark ve 2 ek kart hakkı.', price: 4000000, stock_total: 50, max_qty: 1, sort: 1, is_new: 1, data: { skin: 'royal', perks: { limit_mult: 3, transfer_mult: 3, spread_discount_pct: 90, extra_cards: 2 } } },
  { id: 'skin_guilloche', kind: 'design', rarity: 'legendary', name: 'Altın Gilyoş', tagline: 'Banknot işçiliğinde altın rozet.', descr: 'Siyah zemin üzerinde matematiksel gilyoş rozet ve altın folyo parıltısı. Numaralı, 100 adetle sınırlı seri.', price: 950000, stock_total: 100, max_qty: 1, sort: 2, is_new: 1, data: { skin: 'guilloche' } },
  { id: 'card_platinum', kind: 'function', rarity: 'legendary', name: 'Platin Borsa Kartı', tagline: 'Kristal borsasında daha dar fark.', descr: 'İnce kazınmış platin yüzey. Kristal alış/satışında fark %60 azalır ve +1 kart hakkı verir.', price: 1200000, stock_total: 80, max_qty: 1, sort: 3, is_new: 0, data: { skin: 'platinum', perks: { spread_discount_pct: 60, extra_cards: 1 } } },
  { id: 'skin_prism', kind: 'design', rarity: 'legendary', name: 'Prizma Cam', tagline: 'Işığı bölen, hareketli cam yüzey.', descr: 'Renkli yüzeylere bölünmüş buzlu cam ve yavaşça süpüren ışık. Numaralı, 150 adetle sınırlı seri.', price: 800000, stock_total: 150, max_qty: 1, sort: 4, is_new: 0, data: { skin: 'prism' } },
  { id: 'card_titan', kind: 'function', rarity: 'epic', name: 'Titanyum Limit Kartı', tagline: 'Günlük ve işlem limitin 2 katı.', descr: 'Fırçalanmış titanyum yüzey. İşlem başına ve günlük transfer limitleri 2 katına çıkar.', price: 750000, stock_total: 120, max_qty: 1, sort: 5, is_new: 0, data: { skin: 'titan', perks: { limit_mult: 2, transfer_mult: 2 } } },
  { id: 'skin_nebula', kind: 'design', rarity: 'epic', name: 'Nebula', tagline: 'Yıldız tozu ve mor bulutlar.', descr: 'Derin uzay zemini üzerinde prosedürel bulutlar ve yıldız alanı.', price: 480000, stock_total: 160, max_qty: 1, sort: 6, is_new: 0, data: { skin: 'nebula' } },
  { id: 'skin_aurora', kind: 'design', rarity: 'epic', name: 'Aurora', tagline: 'Kuzey ışıkları akışı.', descr: 'Zümrüt, mavi ve mor ışık akıntıları; renk geçişli ışıltılı kenar.', price: 450000, stock_total: 180, max_qty: 1, sort: 7, is_new: 0, data: { skin: 'aurora' } },
  { id: 'skin_carbon', kind: 'design', rarity: 'rare', name: 'Karbon Fiber', tagline: 'Spor otomobil dokusu.', descr: 'Gerçek karbon örgü deseni ve kırmızı hız şeridi.', price: 240000, stock_total: 220, max_qty: 1, sort: 8, is_new: 0, data: { skin: 'carbon' } },
  { id: 'skin_onyx', kind: 'design', rarity: 'rare', name: 'Oniks Mat', tagline: 'Sade, mat, altın ince çizgili.', descr: 'Mat siyah zemin, ince gilyoş dokusu ve şampanya altını çerçeve.', price: 180000, stock_total: 250, max_qty: 1, sort: 9, is_new: 0, data: { skin: 'onyx' } },
  { id: 'skin_singularity', kind: 'design', rarity: 'mythic', name: 'Singularity', tagline: 'Tekillik serisi · 33 adet.', descr: 'Prosedürel yıldız alanı, mor enerji halkaları ve karanlık tekillik. Sadece 33 kart.', price: 1800000, stock_total: 33, max_qty: 1, sort: 10, is_new: 1, data: { skin: 'singularity' } },
  { id: 'skin_lunar', kind: 'design', rarity: 'legendary', name: 'Lunar Pearl', tagline: 'Sedefli ay yüzeyi · 64 adet.', descr: 'Ay kraterlerinden esinlenen mikro gravür, sedefli seramik ve yörünge çizgileri.', price: 1250000, stock_total: 64, max_qty: 1, sort: 11, is_new: 1, data: { skin: 'lunar' } },
  { id: 'skin_aether', kind: 'design', rarity: 'legendary', name: 'Aether Glass', tagline: 'Kristal cam koleksiyonu · 48 adet.', descr: 'Katmanlı turkuaz cam, ışık kırılımları ve elde üretilmiş hissi veren geometrik fasetler.', price: 1400000, stock_total: 48, max_qty: 1, sort: 12, is_new: 1, data: { skin: 'aether' } },
  { id: 'skin_phoenix', kind: 'design', rarity: 'mythic', name: 'Phoenix Ember', tagline: 'Anka serisi · 21 adet.', descr: 'Alev tüyleri, ergimiş bakır damarlar ve sıcak metalik parıltı. Çok sınırlı edisyon.', price: 2200000, stock_total: 21, max_qty: 1, sort: 13, is_new: 1, data: { skin: 'phoenix' } },
  { id: 'skin_deepsea', kind: 'design', rarity: 'epic', name: 'Abyssal Bio', tagline: 'Derin deniz · 88 adet.', descr: 'Biyolüminesans organizmalar, derin okyanus katmanları ve organik ışık dokusu.', price: 980000, stock_total: 88, max_qty: 1, sort: 14, is_new: 1, data: { skin: 'deepsea' } },
  { id: 'skin_chronos', kind: 'design', rarity: 'legendary', name: 'Chronos Engraved', tagline: 'Mekanik gravür · 42 adet.', descr: 'Mikro kadran, 120 hassas saat çizgisi ve pirinç/altın gravür dokusu.', price: 1600000, stock_total: 42, max_qty: 1, sort: 15, is_new: 1, data: { skin: 'chronos' } },
  { id: 'skin_eclipse', kind: 'design', rarity: 'mythic', name: 'Solar Eclipse', tagline: 'Tutulma edisyonu · 29 adet.', descr: 'Altın korona, tutulma halkası ve gece göğünde yayılan sıcak ışık.', price: 2000000, stock_total: 29, max_qty: 1, sort: 16, is_new: 1, data: { skin: 'eclipse' } },
  { id: 'skin_celestial', kind: 'design', rarity: 'legendary', name: 'Celestial Atlas', tagline: 'Takımyıldız atlası · 56 adet.', descr: 'Safir gece yüzeyinde takımyıldız haritası, yıldız bağlantıları ve altın yörüngeler.', price: 1500000, stock_total: 56, max_qty: 1, sort: 17, is_new: 1, data: { skin: 'celestial' } },
  { id: 'slot_extra', kind: 'function', rarity: 'common', name: 'Ek Kart Hakkı', tagline: 'Hesabına +1 sanal kart yeri.', descr: 'Her alışta kart sınırın bir artar (en fazla 5 kez alınabilir).', price: 120000, max_qty: 5, sort: 10, is_new: 0, data: { perks: { extra_cards: 1 } } },
];

// Yeni kart yüzeyleri doğrudan ortak FNXSkins kataloğundan tohumlanır; editör, Market ve sunucu ürün kimlikleri eşleşir.
for (const item of (SKINS().catalog || [])) {
  SEED.push({ id: item.productId, kind: 'design', rarity: item.rarity, name: item.name, tagline: item.tagline, descr: item.desc, price: item.price, stock_total: item.stock, max_qty: 1, sort: item.sort, is_new: 1, data: { skin: item.id } });
}

const seedSql = () => `INSERT OR IGNORE INTO shop_products (id, kind, rarity, name, tagline, descr, price, stock_total, stock_sold, max_qty, data, status, is_new, sort, created_at, updated_at) VALUES\n` +
  SEED.map((p) => `  ('${p.id}', '${p.kind}', '${p.rarity}', '${p.name.replace(/'/g, "''")}', '${p.tagline.replace(/'/g, "''")}', '${p.descr.replace(/'/g, "''")}', ${p.price}, ${p.stock_total ?? 'NULL'}, 0, ${p.max_qty}, '${JSON.stringify(p.data)}', 'on', ${p.is_new}, ${p.sort}, 0, 0)`).join(',\n');
export const MIGRATION_SQL = () => `-- Nexus Market: FN ile satılan tasarım ve fonksiyonel kartlar (stok, seri no, kalıcı sahiplik).\n-- Bu dosya scripts/gen-shop-migration.mjs ile src/lib/shop.js'ten üretilir.\n${SCHEMA.join(';\n')};\n${seedSql()};\n`;

const SCHEMA_OK = new WeakSet();
export async function ensureShopSchema(env) {
  if (!env.DB || SCHEMA_OK.has(env.DB)) return;
  await env.DB.batch([...SCHEMA.map((q) => env.DB.prepare(q)), env.DB.prepare(seedSql())]);
  SCHEMA_OK.add(env.DB);
}

export const parseData = (s) => { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

// Ürün verisini (yönetici girdisi dahil) güvenli biçime çevirir: bilinmeyen skin reddedilir, perk değerleri sınırlandırılır.
export function cleanData(d) {
  const out = {};
  if (d && d.skin !== undefined) {
    if (!SKINS().has(String(d.skin))) return { error: 'Bilinmeyen kart yüzeyi (skin).' };
    out.skin = String(d.skin);
  }
  if (d && d.perks && typeof d.perks === 'object') {
    const p = {};
    if (d.perks.limit_mult !== undefined) p.limit_mult = clamp(d.perks.limit_mult, 1, 5, 1);
    if (d.perks.transfer_mult !== undefined) p.transfer_mult = clamp(d.perks.transfer_mult, 1, 5, 1);
    if (d.perks.spread_discount_pct !== undefined) p.spread_discount_pct = Math.round(clamp(d.perks.spread_discount_pct, 0, 95, 0));
    if (d.perks.extra_cards !== undefined) p.extra_cards = Math.round(clamp(d.perks.extra_cards, 0, 5, 0));
    if (Object.keys(p).length) out.perks = p;
  }
  if (!out.skin && !out.perks) return { error: 'Ürün bir kart yüzeyi veya perk içermeli.' };
  return { data: out };
}

// Kullanıcının sahip olduğu fonksiyonel kartların toplam avantajı. Çarpanlar en iyisi alınır (üst üste binmez), kart hakları adetle toplanır.
export const NO_PERKS = Object.freeze({ limit_mult: 1, transfer_mult: 1, spread_discount_pct: 0, extra_cards: 0 });
export async function perksOf(env, userId) {
  await ensureShopSchema(env);
  const rows = (await env.DB.prepare(
    `SELECT e.qty AS qty, p.data AS data FROM shop_entitlements e JOIN shop_products p ON p.id = e.product_id WHERE e.user_id = ?`,
  ).bind(userId).all()).results;
  const out = { ...NO_PERKS };
  for (const r of rows) {
    const pk = parseData(r.data).perks;
    if (!pk) continue;
    out.limit_mult = Math.max(out.limit_mult, Number(pk.limit_mult) || 1);
    out.transfer_mult = Math.max(out.transfer_mult, Number(pk.transfer_mult) || 1);
    out.spread_discount_pct = Math.max(out.spread_discount_pct, Number(pk.spread_discount_pct) || 0);
    out.extra_cards += (Number(pk.extra_cards) || 0) * r.qty;
  }
  out.limit_mult = Math.min(out.limit_mult, 5); out.transfer_mult = Math.min(out.transfer_mult, 5);
  out.spread_discount_pct = Math.min(out.spread_discount_pct, 95); out.extra_cards = Math.min(out.extra_cards, 10);
  return out;
}

// Etkin sınırlar (temel yapılandırma × perk). Transfer, kart oluşturma ve borsa bu fonksiyonları kullanır.
export async function limitsFor(env, userId) {
  const p = await perksOf(env, userId);
  return {
    perks: p,
    max_transfer: cfgNum(env, 'MAX_TRANSFER_MINOR', 500000) * p.transfer_mult,
    daily_limit: cfgNum(env, 'DAILY_TRANSFER_LIMIT_MINOR', 1500000) * p.limit_mult,
    max_cards: cfgNum(env, 'MAX_CARDS', 5) + p.extra_cards,
  };
}
export function spreadFor(env, perks) {
  const base = cfgNum(env, 'MARKET_SPREAD_BPS', 50);
  return Math.max(Math.min(base, 5), Math.round(base * (100 - perks.spread_discount_pct) / 100));
}

// Takılı kart yüzeyleri: { cardId: { product_id, skin, name, serial } }. Sahipliği düşen (iade) yüzey sunulmaz.
export async function skinsOf(env, userId) {
  await ensureShopSchema(env);
  const rows = (await env.DB.prepare(
    `SELECT s.card_id AS card_id, s.product_id AS product_id, p.name AS name, p.data AS data, p.stock_total AS stock_total, e.serial AS serial
     FROM shop_card_skins s JOIN shop_entitlements e ON e.user_id = s.user_id AND e.product_id = s.product_id JOIN shop_products p ON p.id = s.product_id
     WHERE s.user_id = ?`,
  ).bind(userId).all()).results;
  const out = {};
  for (const r of rows) {
    const skin = parseData(r.data).skin;
    if (!skin || !SKINS().has(skin)) continue;
    out[r.card_id] = { product_id: r.product_id, skin, name: r.name, serial: r.stock_total && r.serial ? `${String(r.serial).padStart(3, '0')}/${String(r.stock_total).padStart(3, '0')}` : '' };
  }
  return out;
}

// Editörün kullanabileceği sahip olunan premium yüzeyler. Sahiplik Worker/D1 üzerinden doğrulanır.
export async function ownedSkinsOf(env, userId) {
  await ensureShopSchema(env);
  const rows = (await env.DB.prepare(
    `SELECT e.product_id, e.qty, e.serial, p.name, p.rarity, p.kind, p.stock_total, p.data
     FROM shop_entitlements e JOIN shop_products p ON p.id = e.product_id
     WHERE e.user_id = ? ORDER BY e.acquired_at DESC`,
  ).bind(userId).all()).results;
  return rows.map((r) => {
    const skin = parseData(r.data).skin;
    if (!skin || !SKINS().has(skin)) return null;
    return { product_id: r.product_id, skin, name: r.name, rarity: r.rarity, kind: r.kind, qty: r.qty,
      serial: r.stock_total && r.serial ? `${String(r.serial).padStart(3, '0')}/${String(r.stock_total).padStart(3, '0')}` : '' };
  }).filter(Boolean);
}

// İade/ters kayıt: satın alma 'refunded' olur, hak bir azalır (0'a inerse silinir), sahipliği kalmayan yüzeyler kartlardan çıkarılır.
export async function shopRevokeStmts(env, txRef) {
  await ensureShopSchema(env);
  const u = '(SELECT user_id FROM shop_purchases WHERE id = ? AND status = \'success\')', p = '(SELECT product_id FROM shop_purchases WHERE id = ? AND status = \'success\')';
  return [
    env.DB.prepare(`DELETE FROM shop_entitlements WHERE user_id = ${u} AND product_id = ${p} AND qty <= 1`).bind(txRef, txRef),
    env.DB.prepare(`UPDATE shop_entitlements SET qty = qty - 1 WHERE user_id = ${u} AND product_id = ${p} AND qty > 1`).bind(txRef, txRef),
    env.DB.prepare(`UPDATE shop_purchases SET status = 'refunded' WHERE id = ? AND status = 'success'`).bind(txRef),
    env.DB.prepare('DELETE FROM shop_card_skins WHERE product_id NOT IN (SELECT product_id FROM shop_entitlements WHERE shop_entitlements.user_id = shop_card_skins.user_id)'),
  ];
}
