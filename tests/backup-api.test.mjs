import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, join } from 'node:path';
import { createApp } from '../src/server.mjs';

const PASSWORD = 'Synthetisch accountwachtwoord 2026!', PHRASE = 'Synthetische reservekopie wachtzin!';
const sample = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'omniscout-backup-api-'));
  let time = Date.parse('2026-09-08T12:00:00.000Z');
  const app = await createApp({ dataDir: dir, now: () => new Date(time).toISOString() });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); const inside = relative(resolve(tmpdir()),resolve(dir)); assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside)); await rm(dir,{recursive:true,force:true}); });
  function client() {
    const jar = new Map();
    const c = { csrf:'',org:'', async call(path,data,method=data===undefined?'GET':'POST',extra={}) {
      const response=await fetch(base+path,{method,headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(c.org?{'X-Omniscout-Organization':c.org}:{}),...(data===undefined?{}:{origin:base,'Content-Type':'application/json','X-Omniscout-CSRF':c.csrf}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
      for(const cookie of response.headers.getSetCookie()){const entry=cookie.split(';')[0],i=entry.indexOf('=');jar.set(entry.slice(0,i),entry.slice(i+1));}
      const body=await response.json();if(body.csrf)c.csrf=body.csrf;return{status:response.status,body,headers:response.headers};
    }}; return c;
  }
  const owner=client();await owner.call('/api/session');const setup=await owner.call('/api/auth/setup',{username:'backupowner',password:PASSWORD,organizationName:'Fictieve herstelclub'});
  assert.equal(setup.status,201);owner.org=setup.body.organizations[0].id;
  async function member(role) {const invite=await owner.call('/api/auth/invites',{role});const c=client();await c.call('/api/session');const r=await c.call('/api/auth/register',{inviteToken:invite.body.token,username:`member${role}`,password:PASSWORD});assert.equal(r.status,201);c.org=owner.org;return c;}
  async function importData(payload=sample) {const p=await owner.call('/api/import/preview',payload);assert.equal(p.body.valid,true,JSON.stringify(p.body));const c=await owner.call('/api/import/confirm',{payload,digest:p.body.digest});assert.equal(c.status,202);await app.organizationManager.idle();}
  return {app,dir,owner,client,member,importData,advance:ms=>{time+=ms;}};
}
test('backup and retention API require current owner, organization and CSRF; no full-server route is exposed',async t=>{
  const f=await fixture(t),stranger=f.client();
  assert.equal((await stranger.call('/api/retention/preview')).status,401);
  for(const role of ['viewer','scout']){const member=await f.member(role);for(const path of ['/api/backup/create','/api/backup/preview','/api/backup/restore'])assert.equal((await member.call(path,{})).status,403);assert.equal((await member.call('/api/retention/preview')).status,403);}
  assert.equal((await f.owner.call('/api/backup/create',{passphrase:PHRASE},'POST',{'X-Omniscout-CSRF':''})).status,403);
  assert.equal((await f.owner.call('/api/backup/server',{passphrase:PHRASE})).status,404);
  assert.equal((await f.owner.call('/api/retention/preview?days=0')).status,400);
});
test('encrypted club backup previews without writes, rejects stale/cross-club plans, restores once and keeps durable recovery copy',async t=>{
  const f=await fixture(t),c=f.owner;await f.importData();
  await c.call('/api/decisions?dataset=import',{dataset:'import',playerId:'import-p01',action:'follow',reason:'positive',note:'Synthetic before backup'});
  const saved=await c.call('/api/backup/create',{passphrase:PHRASE});assert.equal(saved.status,200,JSON.stringify(saved.body));assert.match(saved.headers.get('content-disposition'),/osbackup/);
  assert.equal(JSON.stringify(saved.body).includes('Synthetic before backup'),false);
  const store=(await f.app.organizationManager.get(c.org)).store,before=await store.read();
  assert.equal((await c.call('/api/backup/preview',{envelope:saved.body,passphrase:'Een foutieve synthetische wachtzin'})).status,400);
  assert.deepEqual(await store.read(),before);
  let preview=await c.call('/api/backup/preview',{envelope:saved.body,passphrase:PHRASE});assert.equal(preview.status,200,JSON.stringify(preview.body));assert.deepEqual(await store.read(),before);
  await c.call('/api/decisions',{playerId:'p01',action:'follow',reason:'positive',note:'Change after preview'});
  assert.equal((await c.call('/api/backup/restore',{previewId:preview.body.previewId,confirm:true})).status,409);
  const orgA=c.org,club=await c.call('/api/auth/organizations',{name:'Fictieve andere club'});c.org=club.body.id;
  assert.ok([400,403,409].includes((await c.call('/api/backup/preview',{envelope:saved.body,passphrase:PHRASE})).status));c.org=orgA;
  preview=await c.call('/api/backup/preview',{envelope:saved.body,passphrase:PHRASE});assert.equal(preview.status,200,JSON.stringify(preview.body));
  assert.equal((await c.call('/api/backup/restore',{previewId:preview.body.previewId,confirm:false})).status,400);
  const restored=await c.call('/api/backup/restore',{previewId:preview.body.previewId,confirm:true});assert.equal(restored.status,200,JSON.stringify(restored.body));assert.equal(restored.body.restored,true);
  assert.equal((await c.call('/api/backup/restore',{previewId:preview.body.previewId,confirm:true})).status,409);
  assert.equal((await c.call('/api/state')).body.decisions.length,0);
  assert.equal((await c.call('/api/state?dataset=import')).body.decisions.length,1);
  assert.equal((await c.call('/api/auth/members')).body.members.length,1);
  assert.ok((await readdir(join(f.dir,'organizations',orgA))).some(name=>/recover|restore/.test(name)));
  assert.equal((await c.call('/api/catalog?dataset=import')).body.players.length,sample.players.length);
});
test('restore previews expire and are bound to session/user, survive no logout/password rotation, and cannot be reused by a second owner',async t=>{
  const f=await fixture(t),c=f.owner,other=await f.member('owner');
  const backup=(await c.call('/api/backup/create',{passphrase:PHRASE})).body;
  const preview=async()=>{const r=await c.call('/api/backup/preview',{envelope:backup,passphrase:PHRASE});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.previewId;};
  let id=await preview();assert.equal((await other.call('/api/backup/restore',{previewId:id,confirm:true})).status,409);
  f.advance(300001);assert.equal((await c.call('/api/backup/restore',{previewId:id,confirm:true})).status,409);
  id=await preview();const changed=await c.call('/api/auth/password',{currentPassword:PASSWORD,newPassword:'Een nieuw synthetisch accountwachtwoord!'});assert.equal(changed.status,200);
  assert.equal((await c.call('/api/backup/restore',{previewId:id,confirm:true})).status,409);
  id=await preview();await c.call('/api/auth/logout',{});assert.equal((await c.call('/api/backup/restore',{previewId:id,confirm:true})).status,401);
});
test('backup copy and restore obey current rights while retention preview can still report blocked retained data',async t=>{
  const f=await fixture(t),payload=structuredClone(sample);payload.source.expiresAt='2026-09-08T12:01:00.000Z';await f.importData(payload);
  const backup=await f.owner.call('/api/backup/create',{passphrase:PHRASE});assert.equal(backup.status,200,JSON.stringify(backup.body));
  f.advance(120000);
  assert.ok([400,403,409].includes((await f.owner.call('/api/backup/create',{passphrase:PHRASE})).status));
  assert.ok([400,403,409].includes((await f.owner.call('/api/backup/preview',{envelope:backup.body,passphrase:PHRASE})).status));
  const store=(await f.app.organizationManager.get(f.owner.org)).store,before=await store.read();
  const report=await f.owner.call('/api/retention/preview?days=1');assert.equal(report.status,200,JSON.stringify(report.body));assert.equal(report.body.destructive,false);
  assert.deepEqual(await store.read(),before);
});
test('existing-account invitation HTTP preview and acceptance preserve account identity and owner-only invite administration',async t=>{
  const f=await fixture(t),member=await f.member('viewer'),c=f.owner;
  const club=await member.call('/api/auth/organizations',{name:'Fictieve tweede club'});member.org=club.body.id;
  const invite=await member.call('/api/auth/invites',{role:'scout'});assert.equal(invite.status,201);
  const preview=await c.call('/api/auth/invite-preview',{inviteToken:invite.body.token});assert.equal(preview.status,200);assert.equal(preview.body.role,'scout');
  const accepted=await c.call('/api/auth/accept-invite',{inviteToken:invite.body.token,role:'owner'});assert.equal(accepted.status,200);assert.equal(accepted.body.organization.role,'scout');
  assert.equal((await c.call('/api/session')).body.organizations.length,2);
  assert.equal((await c.call('/api/auth/accept-invite',{inviteToken:invite.body.token})).status,400);
  const next=await member.call('/api/auth/invites',{role:'viewer'});const list=await member.call('/api/auth/invitations');assert.equal(list.status,200);assert.equal(JSON.stringify(list.body).includes(next.body.token),false);
  c.org=member.org;assert.equal((await c.call('/api/auth/invitations')).status,403);
  assert.equal((await member.call('/api/auth/invitations/'+next.body.id,{},'DELETE')).status,200);
  assert.equal((await c.call('/api/auth/invite-preview',{inviteToken:next.body.token})).status,400);
});
