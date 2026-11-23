import test from 'node:test';
import assert from 'node:assert/strict';
import '../shared/card-rules.js';
import { defaultDesign, defaultPortraitDesign } from '../shared/card-contract.js';
import '../public/js/card-skins.js';
import '../public/js/qrcode.js';
import '../public/js/card-render.js';

test('kart çizici: yatay/dikey doğru SVG tuvali ve sistem alanlarını kullanır', () => {
  for (const orientation of ['landscape', 'portrait']) {
    const d = orientation === 'portrait' ? defaultPortraitDesign('MUSTAFA HAKAN') : defaultDesign('MUSTAFA HAKAN');
    d.userDisplayName = 'MUSTAFA HAKAN';
    const svg = globalThis.FNXRender.cardSvg(d, { cardToken: 'NXC-6TQT-3U4K', last4: '3U4K' });
    const expected = orientation === 'portrait' ? '0 0 540 856' : '0 0 856 540';
    assert.ok(svg.includes(`viewBox="${expected}"`));
    assert.ok(svg.includes('NEXUS KART KODU'));
    assert.ok(svg.includes('NXC-6TQT-3U4K'));
    assert.ok(svg.includes('•••• •••• •••• 3U4K'));
    assert.ok(svg.includes('MUSTAFA HAKAN'));
    assert.ok(svg.includes('data-sys="card-qr"'));
  }
});

test('kart çizici: kütüphanedeki 22 şekil türünün hepsi çökmeksizin çizilir', () => {
  for (const kind of globalThis.FNXRules.KINDS) {
    const svg = globalThis.FNXRender.shapeInner(kind, { fill: '#C08A32', stroke: '#FFFFFF', strokeWidth: 2, effects: [] });
    assert.equal(typeof svg, 'string');
    assert.ok(svg.length > 0, kind);
  }
});
