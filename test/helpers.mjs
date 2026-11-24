import worker from '../src/worker.js';
import { makeD1 } from './d1-shim.mjs';

export const T0 = Date.UTC(2026, 10, 20, 8, 0, 0); // 2026-11-20 08:00 UTC
export const H = 3600 * 1000;
export const D = 24 * H;

let ipSeq = 1;

export function makeEnv(extra = {}) {
  return {
    DB: makeD1(),
    ASSETS: { fetch: async () => new Response('asset') },
    ENVIRONMENT: 'test',
    DEV_EXPOSE_CODES: 'true',
    EMAIL_PROVIDER: 'console',
    CODE_PEPPER: 'test-pepper',
    INTERNAL_API_KEY: 'internal-test-key',
    CURRENCY_CODE: 'FN',
    SESSION_TTL_DAYS: '400',
    __NOW: T0,
    ...extra,
  };
}

export function client(env, { ua = 'TestAgent/1.0', ip } = {}) {
  let cookie = '';
  const myIp = ip || `10.0.0.${ipSeq++}`;
  const call = async (method, path, body, headers = {}) => {
    const h = { 'content-type': 'application/json', 'x-nx-csrf': '1', 'user-agent': ua, 'cf-connecting-ip': myIp, ...headers };
    if (cookie) h.cookie = cookie;
    const res = await worker.fetch(new Request(`https://nexus.test${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, {});
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.startsWith('nx_session=;') ? '' : sc.split(';')[0];
    let data = null;
    try { data = await res.clone().json(); } catch { /* not json */ }
    return { status: res.status, data, res };
  };
  call.get = (p, h) => call('GET', p, undefined, h);
  call.post = (p, b, h) => call('POST', p, b ?? {}, h);
  call.patch = (p, b, h) => call('PATCH', p, b ?? {}, h);
  call.hasSession = () => Boolean(cookie);
  call.ip = myIp;
  return call;
}

export const PW = 'Sup3rSecretPw!';

export async function register(env, email, username, { card = 'Test Kişi', pw = PW, c, keepWelcomeCrystals = false } = {}) {
  const cl = c || client(env);
  const s = await cl.post('/api/auth/register/start', { email });
  if (s.status !== 200) throw new Error('start failed ' + JSON.stringify(s.data));
  const v = await cl.post('/api/auth/register/verify', { email, code: s.data.dev_code });
  if (v.status !== 200) throw new Error('verify failed ' + JSON.stringify(v.data));
  const r = await cl.post('/api/auth/register/complete', { token: v.data.token, username, password: pw, card_display_name: card });
  if (r.status !== 201) throw new Error('complete failed ' + JSON.stringify(r.data));
  // Çoğu test başlangıç ekonomisini sıfırdan sınar; hoş geldin ödülü ayrı testte korunur.
  if (!keepWelcomeCrystals) await env.DB.prepare('UPDATE crystal_holdings SET qty=0,cost_basis=0 WHERE user_id=?').bind(r.data.user.id).run();
  return { cl, me: r.data };
}

// Test tohumlama: bakiyeyi tutarlı bir defter kaydıyla yükler (uygulama kodu dışında, doğrudan SQL).
export async function fund(env, userId, minor) {
  const t = env.__NOW;
  env.__NOW += 1000; // sonraki işlemler farklı milisaniyede olsun (sıralama deterministik)
  await env.DB.batch([
    env.DB.prepare('UPDATE wallets SET balance = balance + ? WHERE user_id = ?').bind(minor, userId),
    env.DB.prepare(`INSERT INTO ledger_entries (id, tx_ref, user_id, type, amount, balance_after, status, description, created_at)
      VALUES (?, ?, ?, 'topup', ?, (SELECT balance FROM wallets WHERE user_id = ?), 'success', 'test seed', ?)`).bind(crypto.randomUUID(), 'NXL-SEED' + Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, 'A'), userId, minor, userId, t),
  ]);
}

export const sql = async (env, q, ...p) => (await env.DB.prepare(q).bind(...p).all()).results;
export const one = async (env, q, ...p) => env.DB.prepare(q).bind(...p).first();
