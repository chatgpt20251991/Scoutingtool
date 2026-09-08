import { lstat, realpath, open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWikidataProvider, validatePublicProfiles } from '../src/providers/wikidata.mjs';
const fail = message => Object.assign(new Error(message), { status: 400 });
async function outsideGit(path) {
  let dir = dirname(path);
  const canonical = await realpath(dir);
  if ((process.platform === 'win32' ? canonical.toLowerCase() !== dir.toLowerCase() : canonical !== dir)) throw fail('Koppelingen in het uitvoerpad zijn niet toegestaan.');
  while (true) {
    try { await lstat(join(dir, '.git')); throw fail('Bewaar opgehaalde spelersgegevens buiten de Git-werkmap.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(dir); if (parent === dir) break; dir = parent;
  }
}
export async function runFetchProfiles(args) {
  if (!args.length || args.includes('--help')) {
    console.log('node tools/fetch-public-profiles.mjs --ids Q615,Q11571 --output NIEUW_JSON_BESTAND\nnode tools/fetch-public-profiles.mjs --search "Spelersnaam"\nExpliciete openbare Wikidata-aanvraag, zonder sleutel of betaald gebruik. Data blijven buiten Git.'); return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--ids','--output','--search'].includes(args[i]) || options[args[i]] || !args[i+1] || args[i+1].startsWith('--')) throw fail('Ongeldige of dubbele optie.');
    options[args[i]] = args[i+1];
  }
  const provider = createWikidataProvider();
  if (options['--search']) {
    if (Object.keys(options).length !== 1) throw fail('Zoeken en ophalen zijn afzonderlijke commando’s.');
    console.log(JSON.stringify(await provider.search(options['--search']), null, 2)); return;
  }
  if (!options['--ids'] || !options['--output']) throw fail('--ids en --output zijn vereist.');
  const target = resolve(options['--output']); await outsideGit(target);
  const parent = await lstat(dirname(target)); if (!parent.isDirectory() || parent.isSymbolicLink()) throw fail('De uitvoermap moet een bestaande gewone map zijn.');
  try { await lstat(target); throw fail('Het uitvoerbestand bestaat al.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const snapshot = validatePublicProfiles(await provider.load(options['--ids'].split(',').map(id => id.trim())));
  if (Date.parse(snapshot.retrievedAt) > Date.now()) throw fail('Een profielkopie uit de toekomst is niet toegestaan.');
  const handle = await open(target, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(snapshot, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
  console.log(JSON.stringify({ created: true, provider: snapshot.provider, profiles: snapshot.profiles.length, excluded: snapshot.excluded.length, retrievedAt: snapshot.retrievedAt, output: target }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runFetchProfiles(process.argv.slice(2)).catch(error => { console.error(error.status ? error.message : 'De openbare bron kon niet worden opgehaald of opgeslagen.'); process.exitCode = 1; });
}
