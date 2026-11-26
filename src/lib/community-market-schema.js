// Topluluk kart pazarı şeması.
// Migration 0014'ün canlı D1'e henüz uygulanmadığı veya migration geçmişinin
// eski bir dağıtımda eksik kaldığı durumlarda mevcut kullanıcı/kart verisine
// dokunmadan gerekli kolon ve tabloları idempotent biçimde tamamlar.
const READY = new WeakSet();
const IN_FLIGHT = new WeakMap();

const SCHEMA = [
  'CREATE INDEX IF NOT EXISTS idx_cards_user_active ON cards(user_id, deleted_at, is_default, created_at)',
  `CREATE TABLE IF NOT EXISTS card_market_listings (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id),
    seller_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_minor INTEGER NOT NULL CHECK (price_minor > 0),
    commission_minor INTEGER NOT NULL CHECK (commission_minor >= 0),
    seller_proceeds_minor INTEGER NOT NULL CHECK (seller_proceeds_minor > 0),
    status TEXT NOT NULL CHECK (status IN ('active','sold','cancelled')),
    buyer_id TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sold_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_card_market_one_active_per_card
    ON card_market_listings(card_id) WHERE status = 'active'`,
  `CREATE INDEX IF NOT EXISTS idx_card_market_active_time
    ON card_market_listings(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_card_market_seller
    ON card_market_listings(seller_id, status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS card_market_sales (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL UNIQUE REFERENCES card_market_listings(id),
    buyer_id TEXT NOT NULL REFERENCES users(id),
    seller_id TEXT NOT NULL REFERENCES users(id),
    card_id TEXT NOT NULL REFERENCES cards(id),
    gross_minor INTEGER NOT NULL CHECK (gross_minor > 0),
    commission_minor INTEGER NOT NULL CHECK (commission_minor >= 0),
    seller_minor INTEGER NOT NULL CHECK (seller_minor > 0),
    idempotency_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (buyer_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_card_market_sales_seller
    ON card_market_sales(seller_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_card_market_sales_buyer
    ON card_market_sales(buyer_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS card_market_guard (
    ok INTEGER NOT NULL CHECK (ok = 1)
  )`,
];

function messageOf(err) { return String(err?.message || err || ''); }

async function addDeletedAtIfMissing(db) {
  try {
    await db.prepare('SELECT deleted_at FROM cards LIMIT 0').all();
  } catch (err) {
    const message = messageOf(err);
    if (!/no such column:\s*deleted_at/i.test(message)) throw err;
    try {
      await db.prepare('ALTER TABLE cards ADD COLUMN deleted_at INTEGER').run();
    } catch (alterErr) {
      // Aynı anda başlayan başka bir Worker izolatı kolonu eklemiş olabilir.
      if (!/duplicate column name:\s*deleted_at/i.test(messageOf(alterErr))) throw alterErr;
    }
  }
  // Kolonun gerçekten kullanılabilir olduğunu doğrula.
  await db.prepare('SELECT deleted_at FROM cards LIMIT 0').all();
}

async function install(db) {
  await addDeletedAtIfMissing(db);
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  // Worker'ın daha sonra hata vermesini beklemek yerine şemayı burada doğrula.
  await db.prepare('SELECT id, card_id, seller_id, price_minor, status FROM card_market_listings LIMIT 0').all();
  await db.prepare('SELECT id, listing_id, buyer_id, seller_id, card_id FROM card_market_sales LIMIT 0').all();
  await db.prepare('SELECT ok FROM card_market_guard LIMIT 0').all();
}

export async function ensureCommunityMarketSchema(env) {
  const db = env?.DB;
  if (!db) throw new Error('Nexus D1 bağlantısı bulunamadı.');
  if (READY.has(db)) return;
  let pending = IN_FLIGHT.get(db);
  if (!pending) {
    pending = install(db).then(() => { READY.add(db); });
    IN_FLIGHT.set(db, pending);
  }
  try {
    await pending;
  } finally {
    if (IN_FLIGHT.get(db) === pending) IN_FLIGHT.delete(db);
  }
}
