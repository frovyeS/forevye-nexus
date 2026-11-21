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
  // Korunan bölge (çip) üzerine nesne bindirilemez (sunucu, editörle aynı kural dosyasını çalıştırır)
  const blob = (x, y) => ({ id: 'x1', type: 'shape', name: 'Daire', locked: false, visible: true, zIndex: 0, properties: { kind: 'circle', x, y, width: 60, height: 60, rotation: 0, opacity: 1, fill: '#FF0000', stroke: 'none', strokeWidth: 0, flipX: false, flipY: false, lockRatio: false, effects: [] } });
  const d = defaultDesign('Test Kişi');
  d.layers.push(blob(60, 190));
  assert.equal((await a.cl.patch(`/api/cards/${main.id}`, { design: d })).data.error.code, 'invalid_design');
  d.layers[d.layers.length - 1] = blob(620, 250);
  const ok = await a.cl.patch(`/api/cards/${main.id}`, { design: d, display_name: 'Ada L.' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.version, 2);
  assert.equal(ok.data.display_name, 'Ada L.');
  assert.equal(ok.data.design.userDisplayName, 'Ada L.', 'kart adı tasarımla senkron');
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

test('kart sözleşmesi: geçersiz renk, sistem katmanı ve bilinmeyen şablon reddedilir', () => {
  const bad = defaultDesign(); bad.layers[0].properties.colors = ['red', '#000000'];
  assert.equal(validateDesign(bad).ok, false);
  const sys = defaultDesign(); sys.layers.push({ id: 'z1', type: 'system_chip', properties: {} });
  assert.equal(validateDesign(sys).ok, false, 'sistem katmanı istemciden kabul edilmez');
  assert.equal(validateDesign({ ...defaultDesign(), template: 'evil' }).ok, false);
  assert.equal(validateDesign({ ...defaultDesign(), canvas: { width: 10, height: 10 } }).ok, false);
  assert.equal(validateDesign(defaultDesign()).ok, true);
  // Bilinmeyen alanlar atılır (izin listesiyle yeniden kurulur)
  assert.equal('extra' in validateDesign({ ...defaultDesign(), extra: 1 }).design, false);
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

test('hediye kartı: Mikro-Klima kristal cinsinden döner → minor unit\'e çevrilir (varsayılan 1 kristal = 100)', async () => {
  const env = makeEnv();
  env.GIFTCARD_API_URL = 'https://mk.internal.test/api/ext/giftcard'; env.GIFTCARD_API_SECRET = 'shh';
  const a = await register(env, 'k@example.com', 'gift_k');
  const realFetch = globalThis.fetch; let n = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://mk.internal.test/api/ext/giftcard/redeem');
    assert.equal(JSON.parse(init.body).code, '12345674 123 05/27');
    return new Response(JSON.stringify({ ok: true, amount: 200, unit: 'kristal', reference: 'mkgc:' + (++n) }), { status: 200 });
  };
  try {
    const r = await a.cl.post('/api/giftcard/redeem', { code: '12345674 123 05/27' });
    assert.equal(r.status, 200); assert.equal(r.data.balance, 20000, '200 kristal = 200,00 FN');
    env.GIFTCARD_MINOR_PER_KRISTAL = '10';
    const b = await register(env, 'k2@example.com', 'gift_k2');
    const r2 = await b.cl.post('/api/giftcard/redeem', { code: '12345674 123 05/27' });
    assert.equal(r2.data.balance, 2000, 'kur değişkeni uygulanır');
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

// ---------- FOREVYE ID ile giriş ----------
import { createHash } from 'node:crypto';
function idEnv(extra = {}) { return makeEnv({ ID_URL: 'https://id.test/forevye-id/', ID_API_URL: 'https://mk.internal.test', ...extra }); }
// ID sunucusunu taklit eder: authorize'dan sonra tarayıcı callback'e döner; kod değişiminde PKCE doğrulanır.
function fakeId(users) {
  const codes = new Map(); const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://mk.internal.test/identity/token/exchange');
    const b = JSON.parse(init.body);
    const c = codes.get(b.code); codes.delete(b.code);
    if (!c || b.app !== 'sanal-banka' || b.tokens !== false || b.redirect !== 'https://nexus.test/api/auth/id/callback' || createHash('sha256').update(b.verifier).digest('base64url') !== c.challenge) return new Response(JSON.stringify({ code: 'CODE_INVALID' }), { status: 400 });
    return new Response(JSON.stringify({ user: users[c.who] }), { status: 200 });
  };
  return { restore: () => { globalThis.fetch = realFetch; }, issue: (startUrl, who) => { const q = new URLSearchParams(startUrl.split('?')[1]); const code = 'code' + codes.size + 'x'.repeat(30); codes.set(code, { challenge: q.get('challenge'), who }); return { code, state: q.get('state') }; } };
}
const IDU = { a: { userId: 'usr_aaaaaaaaaaaaaaaa', email: 'ida@example.com', emailVerified: true, username: '#IDUSER001' }, bad: { userId: 'usr_bbbbbbbbbbbbbbbb', email: 'idb@example.com', emailVerified: false } };

test('ID ile giriş: ayarlı değilse 503; start PKCE adresi üretir', async () => {
  const env = makeEnv(); const cl = client(env);
  assert.equal((await cl.post('/api/auth/id/start')).status, 503);
  const env2 = idEnv(); const r = await client(env2).post('/api/auth/id/start');
  assert.equal(r.status, 200); const u = new URL(r.data.url);
  assert.equal(u.origin + u.pathname, 'https://id.test/forevye-id/'); assert.match(u.hash, /^#\/baglan\?/);
  const q = new URLSearchParams(u.hash.split('?')[1]);
  assert.equal(q.get('app'), 'sanal-banka'); assert.equal(q.get('redirect'), 'https://nexus.test/api/auth/id/callback'); assert.match(q.get('challenge'), /^[A-Za-z0-9_-]{43}$/);
});
test('ID ile giriş: yeni kullanıcı → kayıt adımı → hesap; sonraki girişte doğrudan oturum; state tek kullanımlık', async () => {
  const env = idEnv(), id = fakeId(IDU); const cl = client(env);
  try {
    const st = (await cl.post('/api/auth/id/start')).data.url;
    const a = id.issue(st, 'a');
    const cb = await cl.get(`/api/auth/id/callback?code=${a.code}&state=${a.state}`);
    assert.equal(cb.status, 302); const loc = cb.res.headers.get('location'); assert.match(loc, /^\/#\/id-kayit\/[A-Za-z0-9_-]+$/);
    const reuse = await cl.get(`/api/auth/id/callback?code=${a.code}&state=${a.state}`);
    assert.equal(reuse.res.headers.get('location'), '/?id_error=id_state', 'state ikinci kez kullanılamaz');
    const token = loc.split('/')[3];
    assert.equal((await cl.post('/api/auth/id/complete', { token, username: 'x', card_display_name: 'Ali' })).status, 400, 'kısa kullanıcı adı');
    const done = await cl.post('/api/auth/id/complete', { token, username: 'id_ali', card_display_name: 'Ali Veli' });
    assert.equal(done.status, 201, JSON.stringify(done.data)); assert.equal((await cl.get('/api/me')).status, 200, 'oturum açıldı');
    assert.equal((await cl.post('/api/auth/id/complete', { token, username: 'id_ali2', card_display_name: 'Ali' })).status, 400, 'bekleyen kayıt tek kullanımlık');
    const row = await one(env, 'SELECT u.email, u.email_verified_at FROM id_links l JOIN users u ON u.id = l.user_id WHERE l.id_user_id = ?', IDU.a.userId);
    assert.equal(row.email, 'ida@example.com'); assert.ok(row.email_verified_at);
    // ikinci giriş (yeni tarayıcı): doğrudan oturum
    const cl2 = client(env); const a2 = id.issue((await cl2.post('/api/auth/id/start')).data.url, 'a');
    const cb2 = await cl2.get(`/api/auth/id/callback?code=${a2.code}&state=${a2.state}`);
    assert.equal(cb2.res.headers.get('location'), '/'); assert.match(cb2.res.headers.get('set-cookie'), /^nx_session=/);
    assert.equal((await cl2.get('/api/me')).status, 200);
    assert.equal((await sql(env, 'SELECT COUNT(*) AS n FROM users'))[0].n, 1, 'çift hesap açılmadı');
  } finally { id.restore(); }
});
test('ID ile giriş: aynı doğrulanmış e-postalı eski Nexus hesabına bağlanır; doğrulanmamış ID e-postası reddedilir; sahte kod reddedilir', async () => {
  const env = idEnv(), id = fakeId({ ...IDU, a: { ...IDU.a, email: 'old@example.com' } });
  try {
    const { me } = await register(env, 'old@example.com', 'eski_kul'); const cl = client(env);
    const a = id.issue((await cl.post('/api/auth/id/start')).data.url, 'a');
    const cb = await cl.get(`/api/auth/id/callback?code=${a.code}&state=${a.state}`);
    assert.equal(cb.res.headers.get('location'), '/'); assert.equal((await cl.get('/api/me')).data.user?.username ?? (await cl.get('/api/me')).data.username, 'eski_kul');
    assert.equal((await sql(env, 'SELECT COUNT(*) AS n FROM users'))[0].n, 1);
    const cl2 = client(env), b = id.issue((await cl2.post('/api/auth/id/start')).data.url, 'bad');
    assert.equal((await cl2.get(`/api/auth/id/callback?code=${b.code}&state=${b.state}`)).res.headers.get('location'), '/?id_error=id_unverified');
    const cl3 = client(env), c = await cl3.post('/api/auth/id/start'), st = new URL(c.data.url).hash.split('state=')[1].split('&')[0];
    assert.equal((await cl3.get(`/api/auth/id/callback?code=${'z'.repeat(40)}&state=${st}`)).res.headers.get('location'), '/?id_error=id_failed');
  } finally { id.restore(); }
});
test('LEGACY_LOGIN=off: e-posta ile kayıt/giriş/şifre sıfırlama kapanır', async () => {
  const env = makeEnv({ LEGACY_LOGIN: 'off' }); const cl = client(env);
  for (const [p, b] of [['/api/auth/register/start', { email: 'a@b.co' }], ['/api/auth/login', { email: 'a@b.co', password: 'x' }], ['/api/auth/forgot', { email: 'a@b.co' }]]) {
    const r = await cl.post(p, b); assert.equal(r.status, 410); assert.equal(r.data.error.code, 'legacy_login_off');
  }
});
