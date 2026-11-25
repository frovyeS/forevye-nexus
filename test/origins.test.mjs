// İki GitHub hesabı (mhaforevye + frovyes) için CORS GARANTİSİ — Nexus tarafı.
// BANK_URL / EDITOR_URL / SHOP_URL / PASS_URL ve *_ORIGINS değişkenleri boş, yanlış ya da eski olsa bile siteler çalışmalı.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { makeEnv, client } from './helpers.mjs';
import { PINNED_SITE_ORIGINS, siteOrigins } from '../src/lib/origins.js';

const MH = 'https://mhaforevye.github.io', FR = 'https://frovyes.github.io';
const PATHS = ['/api/bank/exchange', '/api/wallet', '/api/editor/exchange', '/api/editor/card', '/api/shop/exchange', '/api/pass/exchange'];
const pre = (env, path, origin) => worker.fetch(new Request('https://nexus.test' + path, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } }), env, {});

test('sabit liste: iki GitHub hesabı koda gömülü; siteOrigins() geçersiz değeri yok sayar, yolu origin\'e indirger, tekrarı atar', () => {
  assert.deepEqual([...PINNED_SITE_ORIGINS], [MH, FR]);
  assert.deepEqual(siteOrigins(), [MH, FR]);
  assert.deepEqual(siteOrigins('https://mhaforevye.github.io/forevye_nexus_bank/', 'not a url', undefined, null, ' https://ek.example/x , https://frovyes.github.io'), [MH, FR, 'https://ek.example']);
});

for (const origin of [MH, FR]) {
  test(`değişken yokken ${origin}: tüm site uçlarında OPTIONS 204 + doğru CORS başlıkları`, async () => {
    const env = makeEnv();   // BANK_URL/EDITOR_URL/SHOP_URL/PASS_URL hiç yok
    for (const p of PATHS) {
      const r = await pre(env, p, origin);
      assert.equal(r.status, 204, p);
      assert.equal(r.headers.get('access-control-allow-origin'), origin, p);
      assert.match(r.headers.get('access-control-allow-headers'), /authorization/i);
      assert.equal(r.headers.get('vary'), 'Origin');
    }
  });
  test(`değişkenler YANLIŞ olsa da ${origin} gerçek yanıtı (hata dahil) okuyabilir`, async () => {
    const env = makeEnv({ BANK_URL: 'https://yanlis.example/', EDITOR_URL: 'https://yanlis.example/', SHOP_URL: 'https://yanlis.example/', PASS_URL: 'https://yanlis.example/' });
    const r = await client(env).post('/api/bank/exchange', { ticket: 'gecersiz' }, { origin });
    assert.ok(r.status >= 400 && r.status < 500, 'geçersiz bilet 4xx');
    assert.equal(r.res.headers.get('access-control-allow-origin'), origin, 'hata yanıtında da CORS başlığı olmalı');
  });
}

test('GÜVENLİK: sabit listede/ayarda olmayan origin reddedilir (joker, alt alan adı, http, sonek tuzağı yok)', async () => {
  const env = makeEnv({ BANK_URL: MH + '/forevye_nexus_bank/' });
  for (const evil of ['https://kotu.example', 'https://evil.github.io', 'https://mhaforevye.github.io.kotu.example', 'http://mhaforevye.github.io', 'https://sub.frovyes.github.io', 'null']) {
    for (const p of PATHS) {
      const r = await pre(env, p, evil);
      assert.equal(r.status, 403, `${evil} ${p}`);
      assert.equal(r.headers.get('access-control-allow-origin'), null);
    }
  }
});

test('değişken sabit listeye EK adres ekler (eskisi gibi çalışır)', async () => {
  const env = makeEnv({ BANK_ORIGINS: 'https://ek.example', SHOP_URL: 'https://baska.example/market/' });
  assert.equal((await pre(env, '/api/bank/exchange', 'https://ek.example')).status, 204);
  assert.equal((await pre(env, '/api/shop/exchange', 'https://baska.example')).status, 204);
  assert.equal((await pre(env, '/api/bank/exchange', MH)).status, 204, 'sabit adres yine de izinli');
});

test('MikroKlimaKontrolMerkezi/worker/origins.js ile aynı liste (kardeş depo yanındaysa karşılaştırılır)', () => {
  let mk = null;
  for (const p of ['../../MikroKlimaKontrolMerkezi-main/worker/origins.js', '../MikroKlimaKontrolMerkezi/worker/origins.js', '../MikroKlimaKontrolMerkezi-main/worker/origins.js', '../../MikroKlimaKontrolMerkezi/worker/origins.js']) {
    try { mk = readFileSync(new URL(p, import.meta.url), 'utf8'); break; } catch { /* sıradaki */ }
  }
  if (!mk) return;   // tek başına çalışırken atla
  for (const o of PINNED_SITE_ORIGINS) assert.ok(mk.includes(`'${o}'`), `Mikro-Klima origins.js içinde ${o} yok`);
});
