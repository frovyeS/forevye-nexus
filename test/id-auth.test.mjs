import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, register, one } from './helpers.mjs';

const ID_URL = 'https://mhaforevye.github.io/forevye-id';
const ID_API_URL = 'https://mikroklimakontrolmerkezi.forevye.workers.dev';
const NEXUS_ORIGIN = 'https://nexus.test';

function consentParams(url) {
  const target = new URL(url);
  assert.equal(target.origin + target.pathname, ID_URL + '/');
  assert.equal(target.hash.split('?')[0], '#/baglan');
  return new URLSearchParams(target.hash.split('?')[1] || '');
}

test('FOREVYE ID: banka kimlik giriş isteği gerçek ID Pages ve sanal-banka uygulama koduyla açılır', async () => {
  const env = makeEnv({ ID_URL, ID_API_URL });
  const { cl } = await register(env, 'id-link@example.com', 'id_link_user');
  const start = await cl.post('/api/auth/id/start');
  assert.equal(start.status, 200);
  assert.ok(start.data.url);
  const q = consentParams(start.data.url);
  assert.equal(q.get('app'), 'sanal-banka');
  assert.equal(q.get('redirect'), NEXUS_ORIGIN + '/api/auth/id/callback');
  assert.ok((q.get('state') || '').length >= 24);
  assert.ok((q.get('challenge') || '').length >= 32);
  const saved = await one(env, 'SELECT state_hash, verifier, expires_at FROM id_states');
  assert.ok(saved && saved.state_hash && saved.verifier);
  assert.ok(saved.expires_at > env.__NOW);
});

test('FOREVYE ID: callback token-exchange hesabı doğrular, mevcut banka hesabıyla bağlar ve oturum açar', async () => {
  const env = makeEnv({ ID_URL, ID_API_URL });
  const { cl } = await register(env, 'id-callback@example.com', 'id_callback_user');
  const start = await cl.post('/api/auth/id/start');
  assert.equal(start.status, 200);
  const q = consentParams(start.data.url);
  const params = new URLSearchParams({ code: 'one-time-id-code', state: q.get('state') });

  const originalFetch = globalThis.fetch;
  let exchanged = null;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), ID_API_URL + '/identity/token/exchange');
    exchanged = JSON.parse(options.body);
    return new Response(JSON.stringify({ user: {
      userId: 'forevye-id-user-001', email: 'id-callback@example.com', emailVerified: true
    } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await (await import('../src/worker.js')).default.fetch(
      new Request(NEXUS_ORIGIN + '/api/auth/id/callback?' + params.toString()), env, {}
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
    assert.match(res.headers.get('set-cookie') || '', /nx_session=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(exchanged.app, 'sanal-banka');
  assert.equal(exchanged.redirect, NEXUS_ORIGIN + '/api/auth/id/callback');
  assert.equal(exchanged.tokens, false);
  const linked = await one(env, 'SELECT id_user_id FROM id_links WHERE id_user_id = ?', 'forevye-id-user-001');
  assert.ok(linked);
  const states = await one(env, 'SELECT COUNT(*) AS count FROM id_states');
  assert.equal(states.count, 0);
});

test('FOREVYE ID: yapılandırma eksikse kullanıcıya başarısız görünmeyen bir URL verilmez', async () => {
  const env = makeEnv({ ID_URL: '', ID_API_URL: '' });
  const { cl } = await register(env, 'id-missing@example.com', 'id_missing_user');
  const start = await cl.post('/api/auth/id/start');
  assert.equal(start.status, 503);
  assert.equal(start.data.error.code, 'id_unavailable');
});

test('Banka ana gezinmesinde FOREVYE ID doğrudan hesabın GitHub Pages adresine gider', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(source, /https:\/\/mhaforevye\.github\.io\/forevye-id\//);
  assert.match(source, /'FOREVYE ID', true/);
  assert.match(source, /noopener noreferrer/);
});
