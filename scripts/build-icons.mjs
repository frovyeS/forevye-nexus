// public/js/icons.js içindeki ikon ailesini public/icons/*.svg dosyalarına yazar.
import { writeFileSync, mkdirSync } from 'node:fs';
import { ICONS } from '../public/js/icons.js';
mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const [name, d] of Object.entries(ICONS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter"><path d="${d}"/></svg>\n`;
  writeFileSync(new URL(`../public/icons/${name}.svg`, import.meta.url), svg);
}
console.log(`${Object.keys(ICONS).length} ikon yazıldı`);
