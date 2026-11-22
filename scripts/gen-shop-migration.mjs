// migrations/0007_shop.sql dosyasını src/lib/shop.js şemasından üretir:  node scripts/gen-shop-migration.mjs
import fs from 'node:fs';
import { MIGRATION_SQL } from '../src/lib/shop.js';
fs.writeFileSync(new URL('../migrations/0007_shop.sql', import.meta.url), MIGRATION_SQL());
console.log('migrations/0007_shop.sql yazıldı');
