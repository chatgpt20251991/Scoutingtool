import { writeFile, mkdir, cp } from 'node:fs/promises';
import { renderStandalone } from './standalone.mjs';
await writeFile(new URL('../OmniScout-preview.html', import.meta.url), await renderStandalone());
await mkdir(new URL('../dist/modules/', import.meta.url), { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.js', 'favicon.svg']) await cp(new URL('../public/' + name, import.meta.url), new URL('../dist/' + name, import.meta.url));
for (const name of ['engine.mjs', 'fixtures.mjs']) await cp(new URL('../src/' + name, import.meta.url), new URL('../dist/modules/' + name, import.meta.url));
console.log('Gebouwd: OmniScout-preview.html (offline demo) en dist/ (edge-demo assets). Geen publicatie uitgevoerd.');
