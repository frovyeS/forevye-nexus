// E-posta gönderimi. EMAIL_PROVIDER: "brevo" (BREVO_API_KEY), "resend" (RESEND_API_KEY) veya "console" (yalnızca geliştirme).
// EMAIL_FROM = "Ad <adres@...>"; Brevo'da gönderen adresi doğrulanmış olmalı.
import { HttpError } from './util.js';

const parseFrom = (f) => {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(f || ''));
  return m ? { name: m[1].replace(/^"|"$/g, '') || undefined, email: m[2] } : { email: String(f || '').trim() };
};
const unavailable = () => new HttpError(503, 'mail_unavailable', 'E-posta servisi şu an kullanılamıyor.');

export async function sendMail(env, { to, subject, text }) {
  const provider = env.EMAIL_PROVIDER || 'console';
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
