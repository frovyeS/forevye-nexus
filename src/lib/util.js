export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Süre hesapları HER ZAMAN sunucu saatine göre yapılır. Yalnızca test ortamında saat sabitlenebilir.
export const now = (env) => (env.ENVIRONMENT === 'test' && env.__NOW ? env.__NOW : Date.now());

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function cfgNum(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export async function readJson(req, max = 32 * 1024) {
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'too_large', 'İstek çok büyük.');
  if (!text) return {};
  let body;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, 'bad_json', 'Geçersiz istek gövdesi.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json', 'Geçersiz istek gövdesi.');
  return body;
}

export function str(v, { min = 0, max = 200, name = 'Alan' } = {}) {
  if (typeof v !== 'string') throw new HttpError(400, 'invalid', `${name} metin olmalı.`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpError(400, 'invalid', `${name} ${min}-${max} karakter olmalı.`);
  return s;
}

// "12.50" -> 1250 (minor unit). Negatif, sıfır, fazla ondalık veya geçersiz değerler reddedilir.
export function parseAmount(v) {
  const s = typeof v === 'number' ? String(v) : v;
  if (typeof s !== 'string' || !/^\d{1,9}(\.\d{1,2})?$/.test(s.trim())) throw new HttpError(400, 'invalid_amount', 'Geçersiz tutar.');
  const [i, f = ''] = s.trim().split('.');
  const minor = Number(i) * 100 + Number(f.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new HttpError(400, 'invalid_amount', 'Tutar sıfırdan büyük olmalı.');
  return minor;
}

export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

export function clientIp(req) {
  return req.headers.get('cf-connecting-ip') || 'unknown';
}

export function isSuspended(user, nowMs) {
  return user.status === 'suspended' && !(user.suspended_until && nowMs >= user.suspended_until);
}

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomBase32(len) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += B32[b % 32];
  return out;
}

export const newRef = (prefix) => `${prefix}-${randomBase32(12)}`;

export function isConstraint(err, name) {
  const m = String(err && (err.message || err));
  return m.includes('constraint failed') && (!name || m.includes(name));
}
