export class ApiError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; this.offline = status === 0; }
}

const listeners = new Set();
export const onUnauth = (fn) => listeners.add(fn);

async function request(method, path, body, { raw, headers } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'x-nx-csrf': '1', ...(raw ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError(0, 'offline', 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const e = new ApiError(res.status, data?.error?.code || 'error', data?.error?.message || 'İşlem tamamlanamadı.', data?.error);
    if (res.status === 401 && !path.startsWith('/api/auth/')) listeners.forEach((f) => f(e));
    throw e;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b ?? {}),
  del: (p) => request('DELETE', p),
  putRaw: (p, buf, type) => request('PUT', p, buf, { raw: true, headers: { 'content-type': type } }),
  blob: async (p) => {
    const res = await fetch(p, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, 'error', 'Görsel yüklenemedi.');
    return res.blob();
  },
};
