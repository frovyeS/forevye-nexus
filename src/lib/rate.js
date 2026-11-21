import { HttpError, now } from './util.js';

// Sabit pencereli, atomik sayaç. Limit aşılırsa 429 döner.
export async function rateLimit(env, key, limit, windowMs, message = 'Çok fazla deneme. Lütfen biraz bekleyin.') {
  const t = now(env);
  const start = t - windowMs;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END
     RETURNING count`,
  ).bind(key, t, start, start, t).first();
  if (row.count > limit) throw new HttpError(429, 'rate_limited', message);
}
