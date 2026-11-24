import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = new URL('../public/assets/collections/', import.meta.url);
const expected = [
  'adventure-time.svg', 'anatolian-turkish-rug-motifs.svg',
  'basketball-supporters-international.svg', 'basketball-supporters-turkiye.svg',
  'cars-piston-cup.svg', 'executive-materials.svg', 'finance-heritage.svg',
  'football-supporters-international.svg', 'football-supporters-turkiye.svg',
  'gaming-legends.svg', 'luxury-craft.svg', 'modern-surface-lab.svg',
  'precision-engineering.svg', 'the-amazing-world-of-gumball.svg'
];

test('14 özgün koleksiyon SVG varlığı eksiksiz ve güvenli biçimde paketlenir', async () => {
  const files = (await readdir(dir)).filter(x => x.endsWith('.svg')).sort();
  assert.deepEqual(files, expected);
  for (const file of files) {
    const svg = await readFile(new URL(file, dir), 'utf8');
    assert.match(svg, /^<svg\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /FOREVYE NEXUS · ORIGINAL SERIES/);
    assert.doesNotMatch(svg, /<image\b/i);
  }
});

test('koleksiyon SVG vitrinleri resmî arma veya lisanslı karakter görseli içermez', async () => {
  const files = await readdir(dir);
  for (const file of files.filter(x => x.endsWith('.svg'))) {
    const svg = await readFile(new URL(file, dir), 'utf8');
    assert.doesNotMatch(svg, /Galatasaray|Fenerbahçe|Beşiktaş|Real Madrid|Barcelona|McQueen|Adventure Time|Gumball/i);
  }
});

import '../public/js/card-skins.js';

test('280 kart yüzeyinin tamamı render edilebilir; yıldız motifi özgün takımyıldız geometrisi üretir', () => {
  const entries = globalThis.FNXSkins.catalog.filter(x => /^nx(?:250|280)_/.test(x.id));
  assert.equal(entries.length, 280);
  assert.equal(new Set(entries.map(x => x.id)).size, 280);
  for (const item of entries) {
    const skin = globalThis.FNXSkins.get(item.id);
    assert.ok(skin && typeof skin.build === 'function', item.id);
    const result = skin.build('test_' + item.id + '_', { width: item.orientation === 'portrait' ? 540 : 856, height: item.orientation === 'portrait' ? 856 : 540, animate: false });
    assert.ok(result.defs && result.under && result.over && result.edge, item.id);
  }
  const star = globalThis.FNXSkins.get('nx250_001').build('star_test_', { width: 856, height: 540, animate: false });
  assert.match(star.under, /<path d="M/);
  assert.match(star.under, /<circle cx=/);
});
