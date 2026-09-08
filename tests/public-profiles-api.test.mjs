import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
const NOW = '2026-09-08T16:00:00.000Z', PASSWORD = 'Synthetic profile account password 2026';
function snapshot(id='Q999001') {
  return {format:'omniscout-public-profiles',version:1,provider:'wikidata',license:{name:'CC0-1.0',url:'https://creativecommons.org/publicdomain/zero/1.0/'},retrievedAt:NOW,requestedIds:[id],profiles:[{id,name:'SYNTHETIC metadata test adult',dob:'2000-01-01',sourceUrl:'https://www.wikidata.org/wiki/'+id,revisionUrl:'https://www.wikidata.org/w/index.php?title='+id+'&oldid=1',revision:1,sourceModifiedAt:NOW,retrievedAt:NOW,positions:[],teams:[],currentClub:null,competition:null,stats:{minutes:null,matches:null},synthetic:false}],excluded:[],warnings:[]};
}
async function fixture(t, provider) {
  const app=await createApp({now:()=>NOW,publicProfileProvider:provider});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r)); t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const owner=await app.auth.setup({username:'profileowner',password:PASSWORD,organizationName:'Synthetic Club A'});
  const org=owner.organizations[0].id, invite=await app.auth.invite(owner.token,org,{role:'viewer'});
  const viewer=await app.auth.register({username:'profileviewer',password:PASSWORD,inviteToken:invite.token});
  const other=(await app.auth.createOrganization(owner.token,{name:'Synthetic Club B'})).id;
  async function call(session,path,{data,organization=org,csrf=true}={}) {
    const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(session?{cookie:'omniscout_session='+session.token}:{}),'x-omniscout-organization':organization,...(data===undefined?{}:{origin:base,'content-type':'application/json',...(csrf?{'x-omniscout-csrf':session?.csrf}:{})})},...(data===undefined?{}:{body:JSON.stringify(data)})});
    return {status:r.status,headers:r.headers,body:await r.json()};
  }
  return {app,owner,viewer,org,other,call};
}
test('public profile requests are gated by accounts, club membership, write role and CSRF before provider calls',async t=>{
  let calls=0;
  const f=await fixture(t,{search:async()=>{calls++;return{provider:'wikidata',results:[]};},load:async()=>{calls++;return snapshot();}});
  assert.equal((await f.call(null,'/api/public-profiles')).status,401);
  assert.equal((await f.call(f.viewer,'/api/public-profiles',{organization:f.other})).status,403);
  assert.equal((await f.call(f.viewer,'/api/public-profiles/load',{data:{ids:['Q999001']}})).status,403);
  assert.equal((await f.call(f.owner,'/api/public-profiles/load',{data:{ids:['Q999001']},csrf:false})).status,403);
  assert.equal(calls,0);
  assert.equal((await f.call(f.viewer,'/api/public-profiles/search?q=Test')).status,200);
  assert.equal(calls,1);
});
test('validated public snapshot is isolated by club, remains read-only and upstream errors retain prior data',async t=>{
  let reject=false;
  const f=await fixture(t,{search:async()=>({provider:'wikidata',results:[]}),load:async()=>{if(reject)throw Object.assign(new Error('Synthetic source unavailable'),{status:503});return snapshot();}});
  assert.equal((await f.call(f.owner,'/api/public-profiles')).body.snapshot,null);
  const before=(await f.call(f.owner,'/api/state')).body;
  assert.equal((await f.call(f.owner,'/api/public-profiles/load',{data:{ids:['Q999001'],url:'https://untrusted.invalid'}})).status,400);
  const loaded=await f.call(f.owner,'/api/public-profiles/load',{data:{ids:['Q999001']}}); assert.equal(loaded.status,200); assert.equal(loaded.headers.get('cache-control'),'no-store');
  assert.deepEqual((await f.call(f.viewer,'/api/public-profiles')).body.snapshot,snapshot());
  assert.equal((await f.call(f.owner,'/api/public-profiles',{organization:f.other})).body.snapshot,null);
  assert.deepEqual((await f.call(f.owner,'/api/state')).body,before);
  reject=true; assert.equal((await f.call(f.owner,'/api/public-profiles/load',{data:{ids:['Q999001']}})).status,503);
  assert.deepEqual((await f.call(f.owner,'/api/public-profiles')).body.snapshot,snapshot());
});
test('revoking the fetching member while upstream is pending prevents result and cache write',async t=>{
  let entered,release;
  const waiting=new Promise(r=>entered=r), blocked=new Promise(r=>release=r);
  const f=await fixture(t,{search:async()=>({provider:'wikidata',results:[]}),load:async()=>{entered();await blocked;return snapshot();}});
  await f.app.auth.setRole(f.owner.token,f.org,f.viewer.user.id,{role:'scout'});
  const response=f.call(f.viewer,'/api/public-profiles/load',{data:{ids:['Q999001']}});
  await waiting; await f.app.auth.removeMember(f.owner.token,f.org,f.viewer.user.id);release();
  assert.equal((await response).status,403);
  assert.equal((await f.call(f.owner,'/api/public-profiles')).body.snapshot,null);
});
test('HTTP provider work is bounded and released after failures; invalid snapshots are never cached',async t=>{
  let entered=0, release;
  const blocked=new Promise(r=>release=r);
  const f=await fixture(t,{search:async()=>({provider:'wikidata',results:[]}),load:async()=>{entered++;await blocked;return {...snapshot(),extra:'not allowed'};}});
  const pending=Array.from({length:4},()=>f.call(f.owner,'/api/public-profiles/load',{data:{ids:['Q999001']}}));
  while(entered<4) await new Promise(r=>setTimeout(r,5));
  assert.equal((await f.call(f.owner,'/api/public-profiles/load',{data:{ids:['Q999001']}})).status,429);
  release(); assert.ok((await Promise.all(pending)).every(r=>r.status===400));
  assert.equal((await f.call(f.owner,'/api/public-profiles')).body.snapshot,null);
  assert.equal((await f.call(f.owner,'/api/public-profiles/search?q=Test')).status,200);
});
test('future-dated profiles cannot grant adulthood or populate the club cache',async t=>{
  const future=snapshot(); future.retrievedAt='2036-09-08T16:00:00.000Z';future.profiles[0].retrievedAt=future.retrievedAt;future.profiles[0].dob='2015-01-01';
  const f=await fixture(t,{search:async()=>({provider:'wikidata',results:[]}),load:async()=>future});
  assert.equal((await f.call(f.owner,'/api/public-profiles/load',{data:{ids:['Q999001']}})).status,400);
  assert.equal((await f.call(f.owner,'/api/public-profiles')).body.snapshot,null);
});
