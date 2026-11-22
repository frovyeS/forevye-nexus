// E-posta gönderimi. EMAIL_PROVIDER:
//   "relay"  → (önerilen) Mikro-Klima Worker'ındaki ORTAK posta servisi (/api/ext/mail). FOREVYE ID ile aynı Brevo hesabı ve aynı gönderen adresi kullanılır;
//              Nexus'ta ayrıca BREVO_API_KEY/EMAIL_FROM gerekmez. İmza: HMAC-SHA256(GIFTCARD_API_SECRET) — Mikro-Klima'daki NEXUS_SECRET ile aynı değer.
//              Röle ulaşılamazsa ve BREVO_API_KEY tanımlıysa doğrudan Brevo'ya düşer.
//   "brevo"  → doğrudan Brevo (BREVO_API_KEY + EMAIL_FROM), "resend" (RESEND_API_KEY), "console" (yalnızca geliştirme).
// EMAIL_FROM = "Ad <adres@...>"; Brevo'da gönderen adresi doğrulanmış olmalı.
import { HttpError } from './util.js';
import { mikroFetch } from './upstream.js';

const parseFrom = (f) => {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(f || ''));
  return m ? { name: m[1].replace(/^"|"$/g, '') || undefined, email: m[2] } : { email: String(f || '').trim() };
};
const unavailable = () => new HttpError(503, 'mail_unavailable', 'E-posta servisi şu an kullanılamıyor.');

const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function hmac(secret, msg) {
  const te = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, te.encode(msg)));
}

// Ortak posta servisine gönderir. true = gönderildi.
async function viaRelay(env, { to, subject, text }) {
  const base = String(env.MAIL_RELAY_URL || env.GIFTCARD_API_URL || '').replace(/\/+$/, '');
  if (!base || !env.GIFTCARD_API_SECRET) return false;
  const raw = JSON.stringify({ to, subject, text }), ts = String(Date.now());
  try {
    const res = await mikroFetch(env, `${base}/api/ext/mail`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-nx-timestamp': ts, 'x-nx-signature': await hmac(env.GIFTCARD_API_SECRET, `${ts}.${raw}`) },
      body: raw,
    }, 8000);
    if (!res.ok) console.log('[mail:relay]', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return res.ok;
  } catch (e) { console.log('[mail:relay] ulaşılamadı:', String(e && e.message || e).slice(0, 200)); return false; }
}

export async function sendMail(env, { to, subject, text }) {
  let provider = env.EMAIL_PROVIDER || 'console';
  if (provider === 'relay') {
    if (await viaRelay(env, { to, subject, text })) return;
    if (!env.BREVO_API_KEY || !env.EMAIL_FROM) throw unavailable();   // röle yok/çöktü ve doğrudan Brevo da ayarlı değil
    provider = 'brevo';
  }
  if (provider === 'brevo') {
    if (!env.BREVO_API_KEY || !env.EMAIL_FROM) throw unavailable();
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: parseFrom(env.EMAIL_FROM), to: [{ email: to }], subject, textContent: text }),
    });
    if (!res.ok) { console.log('[mail:brevo]', res.status, (await res.text().catch(() => '')).slice(0, 200)); throw unavailable(); }
    return;
  }
  if (provider === 'resend') {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw unavailable();
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
    });
    if (!res.ok) throw unavailable();
    return;
  }
  if (env.ENVIRONMENT !== 'production') console.log(`[mail:console] to=${to} subject=${subject}\n${text}`);
}
