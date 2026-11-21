// Küçük DOM yardımcıları. Kullanıcı verisi HİÇBİR ZAMAN innerHTML ile basılmaz (XSS koruması).
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') Object.assign(el.style, v); // CSSOM: CSP ile uyumlu
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (root, ...nodes) => { clear(root); root.append(...nodes.flat().filter(Boolean)); };

let toastTimer;
export function toast(msg, kind = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
}

export const money = (minor, cur = 'FN') => `${(minor / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
export const dt = (ms) => new Date(ms).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

export function spinner(label = 'Yükleniyor…') { return h('div', { class: 'state', role: 'status' }, h('div', { class: 'spin' }), h('p', { text: label })); }
export function empty(title, hint) { return h('div', { class: 'state' }, h('div', { class: 'state-ico', text: '∅' }), h('p', { class: 'strong', text: title }), hint && h('p', { class: 'muted', text: hint })); }
export function errorBox(err, retry) {
  return h('div', { class: 'state err', role: 'alert' }, h('p', { class: 'strong', text: err.offline ? 'Bağlantı yok' : 'Bir sorun oluştu' }), h('p', { class: 'muted', text: err.message || 'Bilinmeyen hata' }), retry && h('button', { class: 'btn', onClick: retry, text: 'Tekrar dene' }));
}

// Yükleniyor → içerik / boş / hata + tekrar dene durumlarını tek yerde yönetir.
export async function load(root, loader, render) {
  const run = async () => {
    mount(root, spinner());
    try { mount(root, await render(await loader())); } catch (e) { if (e.status === 401) return; mount(root, errorBox(e, run)); }
  };
  await run();
}

export function field(label, input, hint) {
  const id = `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint && h('small', { class: 'muted', text: hint }));
}

// Bir butonu işlem sürerken kilitler (çift tıklamayı önler).
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true; btn.classList.add('loading');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('loading'); }
}
