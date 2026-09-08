import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/store.mjs';

const PASSWORD = 'Synthetic test password 2026!';
const sample = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
async function start(options = {}) {
  const app = await createApp(options);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  app.base = `http://127.0.0.1:${app.server.address().port}`;
  return app;
}
function client(app) {
  const jar = new Map();
  const c = { csrf: '', org: '', async call(path, data, method = data === undefined ? 'GET' : 'POST', headers = {}) {
    const response = await fetch(app.base + path, { method, headers: { cookie: [...jar].map(([key,value]) => `${key}=${value}`).join('; '), ...(data === undefined ? {} : { origin: app.base, 'content-type': 'application/json', 'x-omniscout-csrf': c.csrf }), ...(c.org ? { 'x-omniscout-organization': c.org } : {}), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    for (const line of response.headers.getSetCookie()) { const [entry] = line.split(';'), index = entry.indexOf('='); jar.set(entry.slice(0,index),entry.slice(index+1)); }
    const raw = await response.text(); let body; try { body = JSON.parse(raw); } catch { body = raw; }
    if (body?.csrf) c.csrf = body.csrf;
    return { status: response.status, body, headers: response.headers };
  }, async boot() { return c.call('/api/session'); }, async login(username='owner') { await c.boot(); return c.call('/api/auth/login',{username,password:PASSWORD}); } };
  return c;
}
async function owner(app) {
  const c=client(app); await c.boot();
  const created=await c.call('/api/auth/setup',{username:'owner',password:PASSWORD,displayName:'Testbeheerder',organizationName:'Fictieve Club A'});
  assert.equal(created.status,201,JSON.stringify(created.body)); c.org=created.body.organizations[0].id; return c;
}
async function importData(c) {
  const preview=await c.call('/api/import/preview',sample);assert.equal(preview.status,200);assert.equal(preview.body.valid,true);
  const result=await c.call('/api/import/confirm',{payload:sample,digest:preview.body.digest});assert.equal(result.status,202,JSON.stringify(result.body));
  return result.body.job.id;
}

test('default app gates all club data and every setup mutation uses same-origin preauth CSRF',async()=>{
 const app=await start();try{
   const c=client(app),boot=await c.boot();assert.equal(boot.body.mode,'local_accounts');assert.equal(boot.body.setupRequired,true);
   for(const path of ['/api/state','/api/catalog','/api/players','/api/export','/api/import/jobs','/api/coverage','/api/workspace/stats'])assert.equal((await c.call(path)).status,401,path);
   const data={username:'owner',password:PASSWORD,displayName:'Testbeheerder',organizationName:'Club'};
   assert.equal((await c.call('/api/auth/setup',data,'POST',{'x-omniscout-csrf':''})).status,403);
   assert.equal((await c.call('/api/auth/setup',data,'POST',{origin:'https://other.invalid'})).status,403);
   assert.equal((await c.boot()).body.setupRequired,true);
   const setup=await c.call('/api/auth/setup',data);assert.equal(setup.status,201);assert.equal('token' in setup.body,false);
   assert.match(setup.headers.getSetCookie().join(';'),/HttpOnly/);assert.match(setup.headers.getSetCookie().join(';'),/SameSite=Strict/);
   assert.match(setup.body.csrf,/^[a-f0-9]{64}$/);
   assert.equal((await c.call('/api/state')).status,400,'Organization is mandatory');
   c.org=setup.body.organizations[0].id;
   assert.equal((await c.call('/api/decisions',{playerId:'p01',action:'follow',reason:'positive'})).status,201);
   assert.equal((await c.call('/api/auth/setup',data)).status,409);
   assert.equal((await c.call('/.local/accounts.json')).status,404);
 }finally{await app.close();}
});

test('two clubs isolate matching player IDs, import hashes, job IDs, research IDs, exports and roles',async()=>{
 const app=await start();try{
   const a=await owner(app);const invitation=await a.call('/api/auth/invites',{role:'viewer'});assert.equal(invitation.status,201);
   const b=client(app);await b.boot();const registered=await b.call('/api/auth/register',{inviteToken:invitation.body.token,username:'reader',displayName:'Lezer',password:PASSWORD});assert.equal(registered.status,201);
   b.org=a.org;assert.equal((await b.call('/api/state')).status,200);
   assert.equal((await b.call('/api/import/preview',sample)).status,403);
   assert.equal((await b.call('/api/auth/invites',{role:'owner'})).status,403);
   const orgB=await b.call('/api/auth/organizations',{name:'Fictieve Club B'});assert.equal(orgB.status,201);b.org=orgB.body.id;
   assert.equal((await a.call('/api/state',undefined,'GET',{'x-omniscout-organization':b.org})).status,403);
   const jobA=await importData(a),jobB=await importData(b);assert.notEqual(jobA,jobB);await app.organizationManager.idle();
   assert.equal((await a.call('/api/import/jobs')).body.jobs.length,1);assert.equal((await b.call('/api/import/jobs')).body.jobs.length,1);
   assert.equal((await b.call(`/api/import/jobs/${jobA}/retry`,{})).status,404);
   assert.equal((await a.call('/api/decisions?dataset=import',{dataset:'import',playerId:sample.players[0].id,action:'follow',reason:'positive',note:'CLUB_A_PRIVATE_SYNTHETIC'})).status,201);
   assert.equal((await b.call('/api/state?dataset=import')).body.decisions.length,0);
   assert.equal((await b.call('/api/export/state?dataset=import')).body.audit.length,0);
   const taskA=await a.call('/api/tasks?dataset=import',{dataset:'import',playerId:sample.players[0].id,requestId:'same-request',question:'Club A question'});
   const taskB=await b.call('/api/tasks?dataset=import',{dataset:'import',playerId:sample.players[0].id,requestId:'same-request',question:'Club B question'});
   assert.notEqual(taskA.body.id,taskB.body.id);
   assert.equal((await b.call('/api/tasks/'+taskA.body.id+'?dataset=import',{status:'done',result:'Not authorized'},'PATCH')).status,404);
   assert.equal((await a.call('/api/state?dataset=import')).body.audit[0].actor,(await a.boot()).body.user.id);
   const members=(await a.call('/api/auth/members')).body.members,reader=members.find(m=>m.username==='reader');
   assert.equal((await a.call('/api/auth/members/'+reader.id,{},'DELETE')).status,200);
   assert.equal((await b.call('/api/state',undefined,'GET',{'x-omniscout-organization':a.org})).status,403);
   assert.equal((await b.call('/api/state')).status,200);
 }finally{await app.close();}
});

test('password rotation and logout revoke old cookies without affecting another account',async()=>{
 const app=await start();try{
   const a=await owner(app),other=client(app);assert.equal((await other.login()).status,200);other.org=a.org;
   const changed=await a.call('/api/auth/password',{currentPassword:PASSWORD,newPassword:'New synthetic password 2026!'});assert.equal(changed.status,200);
   assert.equal((await other.call('/api/state')).status,401);assert.equal((await a.call('/api/state')).status,200);
   assert.equal((await a.call('/api/auth/logout',{})).status,200);assert.equal((await a.call('/api/state')).status,401);
   await a.boot();assert.equal((await a.call('/api/auth/login',{username:'owner',password:PASSWORD})).status,401);
 }finally{await app.close();}
});

test('first setup preserves legacy bytes and restart requires login while retaining club state',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'omniscout-account-api-')),legacy=join(dir,'state.json');let app;
 const old=emptyState();old.decisions.push({id:'legacy-decision',playerId:'p01',action:'follow',reason:'positive',note:'Synthetic legacy'});
 const original=JSON.stringify(old);await writeFile(legacy,original);
 try{
   app=await start({dataDir:dir,legacyStatePath:legacy});const a=await owner(app),org=a.org;
   assert.equal((await a.call('/api/state')).body.decisions.length,1);assert.equal(await readFile(legacy,'utf8'),original);
   await app.close();app=await start({dataDir:dir,legacyStatePath:legacy});
   const b=client(app);assert.equal((await b.boot()).body.authenticated,false);assert.equal((await b.login()).status,200);b.org=org;
   assert.equal((await b.call('/api/state')).body.decisions.length,1);
   const disk=await readFile(join(dir,'accounts.json'),'utf8');assert.equal(disk.includes(PASSWORD),false);
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});
