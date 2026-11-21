// E-posta gönderimi. EMAIL_PROVIDER: "resend" (RESEND_API_KEY gerekir) veya "console" (yalnızca geliştirme).
export async function sendMail(env, { to, subject, text }) {
  const provider = env.EMAIL_PROVIDER || 'console';
  if (provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`mail_failed_${res.status}`);
    return;
  }
  if (env.ENVIRONMENT !== 'production') console.log(`[mail:console] to=${to} subject=${subject}\n${text}`);
}
