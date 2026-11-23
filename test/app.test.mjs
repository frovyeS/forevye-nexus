import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client, register, fund, sql, one, PW, T0, H, D } from './helpers.mjs';
import { validateDesign, defaultDesign } from '../shared/card-contract.js';

async function assertLedgerConsistent(env) {
  const rows = await sql(env, `SELECT w.user_id, w.balance, COALESCE((SELECT SUM(amount) FROM ledger_entries e WHERE e.user_id = w.user_id), 0) AS s FROM wallets w`);
  for (const r of rows) assert.equal(r.balance, r.s, `defter ile bakiye uyuşmuyor: ${r.user_id}`);
}
const key = () => 'k' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);

test('kayıt, giriş, oturum ve hesap varlığı ifşa edilmez', async () => {
  const env = makeEnv();
  const { cl, me } = await register(env, 'ada@example.com', 'ada_l');
  assert.equal(me.user.username, 'ada_l');
  assert.equal(me.balance, 0);
  assert.equal(me.default_card.display_name, 'Test Kişi');
  assert.equal((await cl.get('/api/me')).status, 200);

  // Parola düz metin saklanmaz
  const row = await one(env, 'SELECT password_hash FROM users WHERE email = ?', 'ada@example.com');
  assert.match(row.password_hash, /^pbkdf2\$100000\$/);
  assert.ok(!row.password_hash.includes(PW));

  // Var olan e-posta için yanıt aynı, kod üretilmez
  const dup = await client(env).post('/api/auth/register/start', { email: 'ada@example.com' });
  assert.equal(dup.status, 200);
  assert.equal(dup.data.dev_code, undefined);

  // Giriş: hatalı parola ve olmayan hesap aynı genel mesaj
  const a = await client(env).post('/api/auth/login', { email: 'ada@example.com', password: 'yanlis-parola-1' });
  const b = await client(env).post('/api/auth/login', { email: 'yok@example.com', password: 'yanlis-parola-1' });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.data.error.message, b.data.error.message);
  const ok = await client(env, { ua: 'Other/2' }).post('/api/auth/login', { email: 'ada@example.com', password: PW });
  assert.equal(ok.status, 200);
  const n = await sql(env, `SELECT type FROM notifications WHERE type = 'new_device'`);
  assert.equal(n.length, 1, 'yeni cihaz bildirimi');
});

test('kayıt kodu: yanlış kod 5 denemeden sonra yanar; çıkış oturumu kapatır', async () => {
  const env = makeEnv();
  const c = client(env);
  const s = await c.post('/api/auth/register/start', { email: 'x@example.com' });
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/register/verify', { email: 'x@example.com', code: '000000' })).status, 400);
  assert.equal((await c.post('/api/auth/register/verify', { email: 'x@example.com', code: s.data.dev_code })).status, 400);
  const { cl } = await register(env, 'y@example.com', 'yy_user');
  assert.equal((await cl.post('/api/auth/logout')).status, 200);
  assert.equal((await cl.get('/api/me')).status, 401);
});

test('giriş hız sınırı', async () => {
  const env = makeEnv();
  await register(env, 'rl@example.com', 'rl_user');
  const c = client(env);
  let last;
  for (let i = 0; i < 10; i++) last = await c.post('/api/auth/login', { email: 'rl@example.com', password: 'hatali-parola-9' });
  assert.equal(last.status, 429);
  const good = await c.post('/api/auth/login', { email: 'rl@example.com', password: PW });
  assert.equal(good.status, 429, 'kilit sırasında doğru şifre de reddedilir');
});

test('CSRF: özel başlık olmadan değiştirme isteği reddedilir; yabancı Origin reddedilir', async () => {
  const env = makeEnv();
  const { cl } = await register(env, 'c@example.com', 'csrf_user');
  assert.equal((await cl.post('/api/cards', { display_name: 'A' }, { 'x-nx-csrf': '0' })).status, 403);
  assert.equal((await cl.post('/api/cards', { display_name: 'A' }, { origin: 'https://evil.example' })).status, 403);
});

test('kullanıcı adı: ilk 48 saatte 2 hak, sonra 15 gün bekleme (sunucu saatiyle)', async () => {
  const env = makeEnv();
  const { cl } = await register(env, 'u@example.com', 'first_name');
  assert.equal((await cl.post('/api/profile/username', { username: 'second_name' })).status, 200);
  assert.equal((await cl.post('/api/profile/username', { username: 'third_name' })).status, 200);
  const blocked = await cl.post('/api/profile/username', { username: 'fourth_name' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error.code, 'username_cooldown');

  // 48 saat dolduktan sonra: son değişimden 15 gün dolmadan izin yok
  env.__NOW = T0 + 3 * D;
  assert.equal((await cl.post('/api/profile/username', { username: 'fourth_name' })).status, 429);
  env.__NOW = T0 + 15 * D + 1000;
  assert.equal((await cl.post('/api/profile/username', { username: 'fourth_name' })).status, 200);
  // Her başarılı değişiklikten sonra 15 gün
  env.__NOW += 14 * D;
  assert.equal((await cl.post('/api/profile/username', { username: 'fifth_name' })).status, 429);
  env.__NOW += 1 * D + 1000;
  assert.equal((await cl.post('/api/profile/username', { username: 'fifth_name' })).status, 200);

  // Geçmiş saklanır
  const hist = await sql(env, 'SELECT old_name, new_name, changed_at FROM username_history ORDER BY changed_at');
  assert.equal(hist.length, 4);
  assert.equal(hist[0].old_name, 'first_name');
});

test('kullanıcı adı: kullanılmayan başlangıç hakları 48 saat sonra biter; eski ad ayrılır; benzersizlik büyük/küçük harfe duyarsız', async () => {
  const env = makeEnv();
  const { cl } = await register(env, 'a@example.com', 'alpha_one');
  const other = await register(env, 'b@example.com', 'beta_two');
  assert.equal((await other.cl.post('/api/profile/username', { username: 'ALPHA_ONE' })).status, 409);

  env.__NOW = T0 + 49 * H; // pencere kapandı, hiç değişiklik yapılmadı: ilk değişiklik serbest
  assert.equal((await cl.post('/api/profile/username', { username: 'alpha_new' })).status, 200);
  assert.equal((await cl.post('/api/profile/username', { username: 'alpha_newer' })).status, 429);

  // Eski ad, ayrılma süresi boyunca başkasına verilmez; süre sonunda verilir
  assert.equal((await other.cl.post('/api/profile/username', { username: 'alpha_one' })).status, 409);
  env.__NOW += 31 * D;
  assert.equal((await other.cl.post('/api/profile/username', { username: 'alpha_one' })).status, 200);
});

test('transfer: atomik, iki taraflı defter, eşleşen referans', async () => {
  const env = makeEnv();
  const a = await register(env, 'a@example.com', 'sender_a');
  const b = await register(env, 'b@example.com', 'recv_b');
  await fund(env, a.me.user.id, 100000); // 1000.00

  const lk = await a.cl.post('/api/transfers/lookup', { username: 'RECV_B' });
  assert.equal(lk.data.username, 'recv_b');

  const r = await a.cl.post('/api/transfers', { recipient: 'recv_b', amount: '25.50', idempotency_key: key() });
  assert.equal(r.status, 201);
  assert.equal(r.data.balance, 100000 - 2550);
  assert.equal((await b.cl.get('/api/wallet')).data.balance, 2550);

  const e = await sql(env, 'SELECT user_id, type, amount, tx_ref FROM ledger_entries WHERE tx_ref = ?', r.data.ref);
  assert.equal(e.length, 2);
  assert.deepEqual(e.map((x) => x.amount).sort((x, y) => x - y), [-2550, 2550]);

  const ha = await a.cl.get('/api/transactions');
  const hb = await b.cl.get('/api/transactions');
  assert.equal(ha.data.items[0].tx_ref, r.data.ref);
  assert.equal(hb.data.items[0].tx_ref, r.data.ref);
  assert.equal(ha.data.items[0].counterparty, 'recv_b');
  assert.equal((await b.cl.get('/api/notifications')).data.items.some((n) => n.type === 'transfer_received'), true);
  await assertLedgerConsistent(env);
});

test('transfer: geçersiz tutarlar, yetersiz bakiye, kendine gönderme, limitler', async () => {
  const env = makeEnv({ MAX_TRANSFER_MINOR: '300000', DAILY_TRANSFER_LIMIT_MINOR: '400000' });
  const a = await register(env, 'a@example.com', 'sender_a');
  await register(env, 'b@example.com', 'recv_b');
  await fund(env, a.me.user.id, 1000000);
  const send = (amount, extra = {}) => a.cl.post('/api/transfers', { recipient: 'recv_b', amount, idempotency_key: key(), ...extra });

  for (const bad of ['-5', '0', '0.00', 'abc', '1e3', '1.234', '', null, 12345678901]) assert.equal((await send(bad)).status, 400, `reddedilmeli: ${bad}`);
  assert.equal((await a.cl.post('/api/transfers', { recipient: 'sender_a', amount: '1', idempotency_key: key() })).status, 400);
  assert.equal((await a.cl.post('/api/transfers', { recipient: 'yok_kimse', amount: '1', idempotency_key: key() })).status, 404);
  assert.equal((await send('3000.01', { password: PW })).data.error.code, 'limit_exceeded');
  assert.equal((await send('999.99')).status, 201);
  assert.equal((await send('1000')).status, 403, 'eşik: şifre yeniden doğrulanmalı');
  assert.equal((await send('1000', { password: 'yanlis-sifre-1' })).status, 403);
  assert.equal((await send('1000', { password: PW })).status, 201);
  assert.equal((await send('1000', { password: PW })).status, 201);
  assert.equal((await send('1000', { password: PW })).status, 201);
  const day = await send('1000', { password: PW });
  assert.equal(day.status, 400);
  assert.equal(day.data.error.code, 'daily_limit');

  const poor = await register(env, 'p@example.com', 'poor_one');
  const r = await poor.cl.post('/api/transfers', { recipient: 'recv_b', amount: '1.00', idempotency_key: key() });
  assert.equal(r.data.error.code, 'insufficient_funds');
  await assertLedgerConsistent(env);
});

test('transfer: tekrar isteği ve eşzamanlı çift gönderim yalnızca bir kez işlenir', async () => {
  const env = makeEnv();
  const a = await register(env, 'a@example.com', 'sender_a');
  const b = await register(env, 'b@example.com', 'recv_b');
  await fund(env, a.me.user.id, 50000);
  const k = key();
  const body = { recipient: 'recv_b', amount: '10.00', idempotency_key: k };
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => a.cl.post('/api/transfers', body)));
  assert.ok(rs.every((r) => r.status === 200 || r.status === 201), JSON.stringify(rs.map((r) => r.status)));
  assert.equal(new Set(rs.map((r) => r.data.ref)).size, 1);
  assert.equal((await sql(env, 'SELECT * FROM transfers')).length, 1);
  assert.equal((await b.cl.get('/api/wallet')).data.balance, 1000);
  const again = await a.cl.post('/api/transfers', body);
  assert.equal(again.data.replayed, true);
  assert.equal((await a.cl.post('/api/transfers', { ...body, amount: '11.00' })).status, 409, 'aynı anahtar farklı istek');
  await assertLedgerConsistent(env);
});

test('askıdaki hesap transfer yapamaz/alamaz; süreli askı kendiliğinden biter', async () => {
  const env = makeEnv();
  const a = await register(env, 'a@example.com', 'sender_a');
  const b = await register(env, 'b@example.com', 'recv_b');
  await fund(env, a.me.user.id, 50000);
  await env.DB.prepare(`UPDATE users SET status='suspended', suspended_until = ? WHERE id = ?`).bind(T0 + 2 * H, b.me.user.id).run();
  assert.equal((await a.cl.post('/api/transfers', { recipient: 'recv_b', amount: '1', idempotency_key: key() })).data.error.code, 'invalid_recipient');
  assert.equal((await a.cl.post('/api/transfers/lookup', { username: 'recv_b' })).status, 404);
  env.__NOW += 3 * H;
  assert.equal((await a.cl.post('/api/transfers', { recipient: 'recv_b', amount: '1', idempotency_key: key() })).status, 201);
  await env.DB.prepare(`UPDATE users SET status='suspended', suspended_until = NULL WHERE id = ?`).bind(a.me.user.id).run();
  assert.equal((await a.cl.post('/api/transfers', { recipient: 'recv_b', amount: '1', idempotency_key: key() })).status, 403);
  assert.equal((await a.cl.get('/api/me')).data.user.suspended, true);
});

test('defter değiştirilemez; bakiye istemciden değiştirilemez', async () => {
  const env = makeEnv();
  const a = await register(env, 'a@example.com', 'sender_a');
  await fund(env, a.me.user.id, 1000);
  await assert.rejects(env.DB.prepare('UPDATE ledger_entries SET amount = 999999').run(), /append-only/);
  await assert.rejects(env.DB.prepare('DELETE FROM ledger_entries').run(), /append-only/);
  await a.cl.post('/api/profile/username', { username: 'renamed_a' });
  await assert.rejects(env.DB.prepare('DELETE FROM username_history').run(), /append-only/);
  await assert.rejects(env.DB.prepare('UPDATE wallets SET balance = -1').run(), /wallet_nonneg/);
  assert.equal((await a.cl.post('/api/wallet', { balance: 999999 })).status, 405, 'bakiye yazma ucu yok');
});

test('kartlar: oluşturma, korunan alanlar, sahiplik, limit, geri dönüş', async () => {
  const env = makeEnv({ MAX_CARDS: '3' });
  const a = await register(env, 'a@example.com', 'card_a');
  const b = await register(env, 'b@example.com', 'card_b');
  const list = await a.cl.get('/api/cards');
  const main = list.data.cards[0];
  assert.equal(main.is_default, true);
  assert.match(main.card_token, /^NXC-/);

  // Sistem alanları değiştirilemez
  for (const f of [{ card_token: 'NXC-HACK-HACK' }, { status: 'disabled' }, { user_id: 'x' }, { is_default: true }]) {
    assert.equal((await a.cl.patch(`/api/cards/${main.id}`, f)).data.error.code, 'protected_field');
  }
  // Geçersiz şablon / zemin rengi reddedilir
  const d = defaultDesign();
  d.template = 'evil';
  assert.equal((await a.cl.patch(`/api/cards/${main.id}`, { design: d })).data.error.code, 'invalid_design');
  d.template = 'classic';
  const ok = await a.cl.patch(`/api/cards/${main.id}`, { design: d, display_name: 'Ada L.' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.version, 2);
  assert.equal((await a.cl.patch(`/api/cards/${main.id}`, { display_name: '<script>' })).status, 400);
  assert.equal((await a.cl.patch(`/api/cards/${main.id}`, { display_name: 'x'.repeat(40) })).status, 400);

  // Kart adı benzersiz değil; kullanıcı adından bağımsız
  assert.equal((await b.cl.post('/api/cards', { display_name: 'Ada L.' })).status, 201);
  // Başkasının kartı yok sayılır
  assert.equal((await b.cl.get(`/api/cards/${main.id}`)).status, 404);
  assert.equal((await b.cl.patch(`/api/cards/${main.id}`, { label: 'x' })).status, 404);

  // Geri dön
  const rv = await a.cl.post(`/api/cards/${main.id}/revert`, { version: 1 });
  assert.equal(rv.data.display_name, 'Test Kişi');
  assert.equal(rv.data.version, 3);

  // Limit, devre dışı bırakma, varsayılan kart
  assert.equal((await a.cl.post('/api/cards', { display_name: 'İkinci' })).status, 201);
  assert.equal((await a.cl.post('/api/cards', { display_name: 'Üçüncü' })).status, 201);
  assert.equal((await a.cl.post('/api/cards', { display_name: 'Dördüncü' })).data.error.code, 'card_limit');
  const second = (await a.cl.get('/api/cards')).data.cards[1];
  await a.cl.post(`/api/cards/${second.id}/status`, { status: 'disabled' });
  assert.equal((await a.cl.post(`/api/cards/${second.id}/default`)).status, 400);
  await a.cl.post(`/api/cards/${main.id}/status`, { status: 'disabled' });
  const after = (await a.cl.get('/api/cards')).data.cards;
  assert.equal(after.filter((c) => c.is_default).length, 1);
});

test('kart sözleşmesi: bilinmeyen alan ve geçersiz renk reddedilir', () => {
  // Bilinmeyen alan reddedilmez ama izin listesiyle yeniden kurulduğu için çıktıya geçmez
  const x = validateDesign({ ...defaultDesign(), extra: 1 });
  assert.equal(x.ok, true);
  assert.equal('extra' in x.design, false);
  const bad = defaultDesign();
  bad.layers[0].properties.colors = ['red', 'blue'];
  assert.equal(validateDesign(bad).ok, false);
  assert.equal(validateDesign({ ...defaultDesign(), template: 'evil' }).ok, false);
  assert.equal(validateDesign({ ...defaultDesign(), chipStyle: 'evil' }).ok, false);
  assert.equal(validateDesign(defaultDesign()).ok, true);
});

test('yönetici: yetkisiz erişim, rol yönetimi, askı, ters kayıt, denetim kaydı', async () => {
  const env = makeEnv();
  const u = await register(env, 'u@example.com', 'normal_u');
  const adm = await register(env, 'adm@example.com', 'admin_a');
  const sup = await register(env, 'sup@example.com', 'super_s');
  assert.equal((await client(env).get('/api/admin/users?q=nor')).status, 401);
  assert.equal((await u.cl.get('/api/admin/users?q=nor')).status, 403);
  assert.equal((await u.cl.get('/api/admin/audit')).status, 403);
  // İstemci tarafında gelen "rol" alanı etkisizdir
  assert.equal((await u.cl.post('/api/admin/roles', { user_id: u.me.user.id, role: 'superadmin', reason: 'deneme' })).status, 403);

  await env.DB.prepare(`UPDATE users SET role='admin' WHERE id = ?`).bind(adm.me.user.id).run();
  await env.DB.prepare(`UPDATE users SET role='superadmin' WHERE id = ?`).bind(sup.me.user.id).run();

  const found = await adm.cl.get('/api/admin/users?q=normal');
  assert.equal(found.status, 200);
  assert.equal(found.data.users[0].username, 'normal_u');
  assert.equal(found.data.users[0].password_hash, undefined);
  assert.equal((await adm.cl.post('/api/admin/roles', { user_id: u.me.user.id, role: 'admin', reason: 'deneme' })).status, 403, 'admin rol veremez');
  assert.equal((await adm.cl.post(`/api/admin/users/${u.me.user.id}/suspend`, { reason: '' })).status, 400, 'gerekçe zorunlu');
  assert.equal((await adm.cl.post(`/api/admin/users/${u.me.user.id}/suspend`, { reason: 'şüpheli hareket', hours: 24 })).status, 200);
  assert.equal((await u.cl.get('/api/me')).data.user.suspended, true);
  assert.equal((await adm.cl.post(`/api/admin/users/${u.me.user.id}/unsuspend`, { reason: 'inceleme bitti' })).status, 200);

  // Ters kayıt: silme yok
  const rcv = await register(env, 'r@example.com', 'recv_r');
  await fund(env, u.me.user.id, 10000);
  const t = await u.cl.post('/api/transfers', { recipient: 'recv_r', amount: '40.00', idempotency_key: key() });
  assert.equal((await adm.cl.post('/api/admin/ledger/reverse', { ref: t.data.ref, reason: 'hatalı' })).status, 403, 'admin düzeltme yapamaz');
  const rev = await sup.cl.post('/api/admin/ledger/reverse', { ref: t.data.ref, reason: 'hatalı transfer' });
  assert.equal(rev.status, 200);
  assert.equal((await sup.cl.post('/api/admin/ledger/reverse', { ref: t.data.ref, reason: 'tekrar' })).status, 409);
  assert.equal((await u.cl.get('/api/wallet')).data.balance, 10000);
  assert.equal((await rcv.cl.get('/api/wallet')).data.balance, 0);
  assert.equal((await sql(env, 'SELECT * FROM ledger_entries WHERE tx_ref = ?', t.data.ref)).length, 2, 'orijinal kayıtlar durur');
  await assertLedgerConsistent(env);

  // Yetersiz bakiyeli düzeltme tüm işlemi geri alır
  const t2 = await u.cl.post('/api/transfers', { recipient: 'recv_r', amount: '60.00', idempotency_key: key() });
  await rcv.cl.post('/api/transfers', { recipient: 'normal_u', amount: '60.00', idempotency_key: key() });
  const fail = await sup.cl.post('/api/admin/ledger/reverse', { ref: t2.data.ref, reason: 'yetersiz bakiye denemesi' });
  assert.equal(fail.data.error.code, 'insufficient_funds');
  await assertLedgerConsistent(env);

  // Yönetici rolü düşürülünce son süper yönetici korunur, kendi rolü değişmez
  assert.equal((await sup.cl.post('/api/admin/roles', { user_id: sup.me.user.id, role: 'user', reason: 'kendi' })).status, 400);

  const audit = await sql(env, 'SELECT action, result FROM admin_audit');
  const actions = audit.map((a) => a.action);
  for (const need of ['user.search', 'user.suspend', 'user.unsuspend', 'ledger.reverse']) assert.ok(actions.includes(need), need);
  assert.ok(audit.some((a) => a.result === 'failed'), 'başarısız eylemler de loglanır');
  await assert.rejects(env.DB.prepare('DELETE FROM admin_audit').run(), /append-only/);
});

test('dahili uçlar: alışveriş/iade anahtarsız çağrılamaz ve tekrar-güvenlidir', async () => {
  const env = makeEnv();
  const a = await register(env, 'a@example.com', 'buyer_a');
  await fund(env, a.me.user.id, 5000);
  const call = (path, body, token = 'internal-test-key') => client(env).post(path, body, token ? { authorization: `Bearer ${token}` } : {});
  assert.equal((await call('/api/internal/purchase', { user_id: a.me.user.id, amount: '10.00', external_ref: 'order-0001' }, null)).status, 401);
  assert.equal((await call('/api/internal/purchase', { user_id: a.me.user.id, amount: '10.00', external_ref: 'order-0001' }, 'wrong')).status, 401);
  const p = await call('/api/internal/purchase', { user_id: a.me.user.id, amount: '10.00', external_ref: 'order-0001' });
  assert.equal(p.status, 201);
  assert.equal(p.data.balance, 4000);
  const p2 = await call('/api/internal/purchase', { user_id: a.me.user.id, amount: '10.00', external_ref: 'order-0001' });
  assert.equal(p2.data.replayed, true);
  assert.equal(p2.data.balance, 4000);
  assert.equal((await call('/api/internal/purchase', { user_id: a.me.user.id, amount: '900.00', external_ref: 'order-0002' })).data.error.code, 'insufficient_funds');
  const rf = await call('/api/internal/refund', { ref: p.data.ref });
  assert.equal(rf.status, 201);
  assert.equal(rf.data.balance, 5000);
  assert.equal((await call('/api/internal/refund', { ref: p.data.ref })).status, 409);
  await assertLedgerConsistent(env);
});

test('hediye kartı: modül bağlı değilken güvenli hata; bağlıyken yalnızca bir kez yükler', async () => {
  const env = makeEnv();
  const a = await register(env, 'a@example.com', 'gift_a');
  assert.equal((await a.cl.get('/api/giftcard/status')).data.available, false);
  assert.equal((await a.cl.post('/api/giftcard/redeem', { code: 'ABCD-1234' })).status, 503);

  env.GIFTCARD_API_URL = 'https://gift.internal.test';
  env.GIFTCARD_API_SECRET = 'shh';
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    const sig = init.headers['x-nx-signature'];
    assert.ok(sig && init.headers['x-nx-timestamp']);
    const body = JSON.parse(init.body);
    assert.ok(String(url).startsWith('https://gift.internal.test/api/ext/giftcard/'), 'Mikro-Klima uç adresi');
    if (body.code === 'BAD-CODE') return new Response(JSON.stringify({ ok: false, error: 'used' }), { status: 409 });
    return new Response(JSON.stringify({ ok: true, amount: 2500, reference: 'GC-777' }), { status: 200 });
  };
  try {
    assert.equal((await a.cl.post('/api/giftcard/redeem', { code: 'BAD-CODE' })).data.error.code, 'giftcard_rejected');
    const r1 = await a.cl.post('/api/giftcard/redeem', { code: 'GOOD-CODE' });
    assert.equal(r1.status, 200);
    assert.equal(r1.data.balance, 2500);
    const r2 = await a.cl.post('/api/giftcard/redeem', { code: 'GOOD-CODE' });
    assert.equal(r2.data.replayed, true);
    assert.equal(r2.data.balance, 2500, 'aynı kaynak referansı iki kez yüklenmez');
  } finally { globalThis.fetch = realFetch; }
  assert.ok(calls >= 3);
  await assertLedgerConsistent(env);
});

test('hediye kartı: kristal tutarı FN minor unit\'e çevrilir', async () => {
  const env = makeEnv();
  env.GIFTCARD_API_URL = 'https://gift.internal.test/';
  env.GIFTCARD_API_SECRET = 'shh';
  const a = await register(env, 'k@example.com', 'gift_k');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, amount: 7, unit: 'kristal', reference: 'mkgc:12345678' }), { status: 200 });
  try {
    const r = await a.cl.post('/api/giftcard/redeem', { code: '12345678 123 05/28' });
    assert.equal(r.status, 200);
    assert.equal(r.data.amount, 700);
    assert.equal(r.data.balance, 700);
  } finally { globalThis.fetch = realFetch; }
  await assertLedgerConsistent(env);
});

test('şifre sıfırlama oturumları kapatır; şifre değiştirme diğer oturumları kapatır', async () => {
  const env = makeEnv();
  const a = await register(env, 'a@example.com', 'reset_a');
  const other = client(env, { ua: 'Second/1' });
  assert.equal((await other.post('/api/auth/login', { email: 'a@example.com', password: PW })).status, 200);

  const ch = await a.cl.post('/api/profile/password', { current_password: PW, new_password: 'N3wPassw0rd!!' });
  assert.equal(ch.status, 200);
  assert.equal((await other.get('/api/me')).status, 401);
  assert.equal((await a.cl.get('/api/me')).status, 200);
  assert.equal((await a.cl.post('/api/profile/password', { current_password: 'yanlis', new_password: 'N3wPassw0rd!!2' })).status, 403);

  const c = client(env);
  const f = await c.post('/api/auth/forgot', { email: 'a@example.com' });
  const r = await c.post('/api/auth/reset', { email: 'a@example.com', code: f.data.dev_code, new_password: 'Res3tPassw0rd!' });
  assert.equal(r.status, 200);
  assert.equal((await a.cl.get('/api/me')).status, 401);
  assert.equal((await client(env).post('/api/auth/login', { email: 'a@example.com', password: 'Res3tPassw0rd!' })).status, 200);
  const unknown = await c.post('/api/auth/forgot', { email: 'kimse@example.com' });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.dev_code, undefined);
});

test('bildirimler okundu durumu ve rozetler sunucuda hesaplanır', async () => {
  const env = makeEnv();
  const a = await register(env, 'a@example.com', 'notif_a');
  const b = await register(env, 'b@example.com', 'notif_b');
  await fund(env, a.me.user.id, 5000);
  await a.cl.post('/api/transfers', { recipient: 'notif_b', amount: '1.00', idempotency_key: key() });
  const me = await b.cl.get('/api/me');
  assert.ok(me.data.unread >= 2);
  await b.cl.post('/api/notifications/read', { all: true });
  assert.equal((await b.cl.get('/api/me')).data.unread, 0);
  const vault = await b.cl.get('/api/vault');
  assert.ok(vault.data.badges.find((x) => x.key === 'first_transfer_received').earned_at);
  assert.equal(vault.data.badges.find((x) => x.key === 'anniversary_1y').earned_at, null);
  env.__NOW = T0 + 366 * D;
  assert.ok((await b.cl.get('/api/vault')).data.badges.find((x) => x.key === 'anniversary_1y').earned_at);
});
