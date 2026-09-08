import { lstat, realpath, open, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePublicProfiles } from '../src/providers/wikidata.mjs';
import { renderStandalone } from './standalone.mjs';
const fail = message => Object.assign(new Error(message), { status: 400 });
export async function buildPublicProfiles(args) {
  if (!args.length || args.includes('--help')) { console.log('node tools/build-public-profiles.mjs --input PROFIELEN_JSON --output NIEUW_HTML_BESTAND\nBouwt een zelfstandige alleen-lezen weergave van gevalideerde openbare profielen; geen netwerkverzoek.'); return; }
  const options = {};
  for (let i=0; i<args.length; i+=2) {
    if (!['--input','--output'].includes(args[i]) || options[args[i]] || !args[i+1] || args[i+1].startsWith('--')) throw fail('Ongeldige of dubbele optie.');
    options[args[i]] = args[i+1];
  }
  if (!options['--input'] || !options['--output']) throw fail('--input en --output zijn vereist.');
  const input=resolve(options['--input']), target=resolve(options['--output']);
  let dir=dirname(target);
  const canonical=await realpath(dir);
  if(process.platform==='win32' ? canonical.toLowerCase()!==dir.toLowerCase() : canonical!==dir) throw fail('Koppelingen in het uitvoerpad zijn niet toegestaan.');
  while (true) {
    try { await lstat(join(dir,'.git')); throw fail('Bewaar de weergave met opgehaalde spelersgegevens buiten Git.'); } catch (error) { if (error.code!=='ENOENT') throw error; }
    const parent=dirname(dir); if(parent===dir) break; dir=parent;
  }
  const info=await lstat(input); if(!info.isFile() || info.isSymbolicLink() || info.size>1024*1024) throw fail('Gebruik een profielbestand van maximaal 1 MiB.');
  const bytes=await readFile(input); if(bytes.length>1024*1024) throw fail('Profielbestand te groot.');
  let data; try { data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw fail('Ongeldig profielbestand.'); }
  const profiles=validatePublicProfiles(data);
  if(Date.parse(profiles.retrievedAt)>Date.now()) throw fail('Een profielkopie uit de toekomst is niet toegestaan.');
  const html=await renderStandalone({profiles});
  const handle=await open(target,'wx',0o600);
  try { await handle.writeFile(html); await handle.sync(); } finally { await handle.close(); }
  console.log(JSON.stringify({created:true,profiles:profiles.profiles.length,output:target,offline:true}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) buildPublicProfiles(process.argv.slice(2)).catch(error=>{console.error(error.status?error.message:'De profielweergave kon niet worden gebouwd; kies een nieuw uitvoerbestand.');process.exitCode=1;});
