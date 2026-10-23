import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,issuer,subject,identity,manifest} from './directory-helpers.mjs';
import {forEachSeed,createScheduler,concurrently} from './helpers/chaos.mjs';
import {MemoryMessagingStore} from '../packages/core/records.mjs';
test('seeded engine cache coalescing never multiplies concurrent egress',async()=>forEachSeed(12,async random=>{
 const f=await fixture();try{const tasks=random.shuffle(Array.from({length:8},()=>()=>f.refresh({kid:'miss-'+random.int(3)})));const results=await concurrently(tasks);assert(results.every(r=>r.status==='fulfilled'));assert(f.state.calls.length>=3&&f.state.calls.length<=4);assert(await f.resolve());}finally{f.engine.dispose();}
}));
test('seeded durable pin races never revive a superseded key, including another verifier instance cache',async()=>forEachSeed(12,async random=>{
 const store=new MemoryMessagingStore(),f=await fixture({store});await f.refresh();const old=structuredClone(f.state.document),oldKid=old.keys[0].kid;
 await f.keys.rotate(subject,{purpose:'signing',expectedKid:oldKid});await f.update();const fresh=structuredClone(f.state.document),scheduler=createScheduler(random),wrapped=scheduler.wrap(store,'pins');
 const clients=[];for(const doc of [old,fresh])clients.push(await fixture({store:wrapped,fetch:async url=>Response.json(url.endsWith('manifest.json')?manifest:url.includes('?sub=')?{iss:issuer,sub:subject,identity}:doc,{headers:{'Cache-Control':'max-age=300'}})}));
 try{
  await scheduler.run(random.shuffle(clients.map(c=>()=>c.refresh())));assert.equal(await f.resolve({kid:oldKid}),null);
  assert.equal(await clients[0].directory.resolve({issuer,subject,kid:oldKid}),null);
  const restarted=await fixture({store,fetch:async url=>Response.json(url.endsWith('identity.json')?old:manifest,{headers:{'Cache-Control':'max-age=300'}})});try{await assert.rejects(restarted.refresh(),{code:'key_rollback'});}finally{restarted.engine.dispose();}
 }finally{for(const c of [f,...clients])c.engine.dispose();}
}));
