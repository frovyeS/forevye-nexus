import { api } from './api.js';

export const state = { me: null, hideBalance: false };
try { state.hideBalance = localStorage.getItem('nx_hide') === '1'; } catch { /* depolama yok */ }

export function setHide(v) {
  state.hideBalance = v;
  try { localStorage.setItem('nx_hide', v ? '1' : '0'); } catch { /* yoksay */ }
}

// Gösterilen bakiye/rol yalnızca sunucudan gelir; istemci tarafı güvenilir kaynak değildir.
export async function refreshMe() {
  state.me = await api.get('/api/me');
  return state.me;
}
export const cur = () => state.me?.config?.currency || 'FN';
export const initial = (name) => (name || '?').trim().slice(0, 1).toUpperCase();
