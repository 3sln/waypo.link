// Wargame 4 L5 CI guard: a flag can leave the registry only by moving to RETIRED_FLAGS, because deployments may still
// store a console record for it. Such a record is quarantined until an operator runs the audited `flags.retire`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FLAGS,RETIRED_FLAGS} from '../packages/flags/registry.mjs';
import {validateSnapshot} from '../packages/flags/snapshot.mjs';

const lock=JSON.parse(readFileSync(new URL('./fixtures/flag-registry-names.json',import.meta.url),'utf8'));

test('every flag name ever locked is still registered or explicitly retired',()=>{
 const missing=lock.filter(name=>!Object.hasOwn(FLAGS,name)&&!Object.hasOwn(RETIRED_FLAGS,name));
 assert.deepEqual(missing,[],'Removed from the registry without a RETIRED_FLAGS entry (stored console records would be orphaned): '+missing.join(', '));
 for(const [name,entry]of Object.entries(RETIRED_FLAGS)){assert.equal(Object.hasOwn(FLAGS,name),false,`${name} is both registered and retired`);assert.match(String(entry?.retiredOn??''),/^\d{4}-\d\d-\d\d$/,`${name} needs a retiredOn date`);}
});

test('the lock lists every registered flag (update tests/fixtures/flag-registry-names.json when adding one)',()=>{
 const unlocked=Object.keys(FLAGS).filter(name=>!lock.includes(name));
 assert.deepEqual(unlocked,[],'Add new flags to the lock: '+unlocked.join(', '));
});

test('a stored record for a retired flag is quarantined, not fatal',()=>{
 const name=Object.keys(RETIRED_FLAGS)[0]??'RETIRED_EXAMPLE_ENABLED';
 const snapshot=validateSnapshot({v:1,version:1,issuedAt:0,flags:{[name]:{rev:1,on:true,onValue:true,fallthrough:true,salt:'s'}}},{quarantine:true});
 assert.deepEqual(snapshot.quarantined,[name]);assert.deepEqual(Object.keys(snapshot.flags),[]);
});

test('the Beam flags are retired with a date and gone from the registry',()=>{
 for(const name of ['BEAM_ENABLED','BEAM_TURN_ENABLED','BEAM_STUN_ENABLED']){
  assert.equal(Object.hasOwn(FLAGS,name),false,`${name} is still registered`);assert.equal(lock.includes(name),true,`${name} stays in the name lock`);
  assert.equal(RETIRED_FLAGS[name]?.retiredOn,'2026-10-26',`${name} needs its retirement date`);assert.equal(typeof RETIRED_FLAGS[name].reason,'string');
 }
 assert.ok(Object.isFrozen(RETIRED_FLAGS)&&Object.isFrozen(RETIRED_FLAGS.BEAM_ENABLED));
 assert.equal(Object.values(FLAGS).some(f=>f.requires.some(dep=>Object.hasOwn(RETIRED_FLAGS,dep))),false,'no registered flag requires a retired one');
});

test('contacts phase 4 (CR-C7): LINKS_ENABLED and its BINDLEBOX_ENABLED alias are retired; neither env name nor a stored record reaches any flag',async()=>{
 const {parseEnv}=await import('../packages/flags/env.mjs');
 const {createFlags}=await import('../packages/flags/evaluate.mjs');
 for(const name of ['LINKS_ENABLED','BINDLEBOX_ENABLED']){assert.equal(Object.hasOwn(FLAGS,name),false,name);assert.equal(lock.includes(name),true,`${name} stays in the name lock`);assert.equal(RETIRED_FLAGS[name].replacement,undefined,`${name} has no replacement`);}
 assert.equal(RETIRED_FLAGS.LINKS_ENABLED.retiredOn,'2026-10-28');assert.equal(RETIRED_FLAGS.BINDLEBOX_ENABLED.retiredOn,'2026-10-26');
 // No registered flag declares an env alias any more (the BINDLEBOX_ENABLED alias went with LINKS_ENABLED).
 assert.deepEqual(Object.values(FLAGS).filter(f=>f.envAlias!==null).map(f=>f.name),[]);
 // The retired env names never open key delegation (it reads KEY_DELEGATION_ENABLED alone) nor any other flag.
 for(const env of [{LINKS_ENABLED:'true'},{BINDLEBOX_ENABLED:'true'},{LINKS_ENABLED:'true',BINDLEBOX_ENABLED:'true'}]){
  const port=createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}},env}).for({});
  for(const name of Object.keys(FLAGS))assert.equal(port.evaluate(name).value,createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}},env:{}}).for({}).evaluate(name).value,`${name} ignores ${JSON.stringify(env)}`);
  assert.equal(parseEnv('KEY_DELEGATION_ENABLED',env).state,parseEnv('KEY_DELEGATION_ENABLED',{}).state);
 }
 // A stored console record under either retired name is quarantined, never applied elsewhere.
 const snapshot=validateSnapshot({v:1,version:1,issuedAt:0,flags:{LINKS_ENABLED:{rev:1,on:true,onValue:true,fallthrough:true,salt:'s'},BINDLEBOX_ENABLED:{rev:1,on:true,onValue:true,fallthrough:true,salt:'s'}}},{quarantine:true});
 assert.deepEqual([...snapshot.quarantined].sort(),['BINDLEBOX_ENABLED','LINKS_ENABLED']);assert.equal(Object.hasOwn(snapshot.flags,'KEY_DELEGATION_ENABLED'),false);
});

test('flags.retire of LINKS_ENABLED drops its record and carries it nowhere (no replacement)',async t=>{
 const {SqliteMetadata}=await import('../apps/node/resources.mjs');
 const {AdminStorage}=await import('../packages/identity/admin-store.mjs');
 const {FlagService}=await import('../packages/flags/service.mjs');
 const start=1792000000000,boot={actor:{kind:'boot',expect:{'boot/principal':null}},stepUpAt:start,stepUpMethod:'passkey'};
 const raw=new SqliteMetadata(':memory:'),storage=new AdminStorage(raw);t.after(()=>raw.close());
 await raw.transaction(async tx=>{await tx.put('admin/flags-head',{version:2,issuedAt:start});await tx.put('admin/flag/LINKS_ENABLED',{rev:4,on:true,onValue:true,fallthrough:true,salt:'s'});});
 const service=new FlagService({store:storage,env:{LINKS_ENABLED:'true'},clock:()=>start,randomId:()=>'salt-1',onCommit:()=>{}});
 const result=await service.retire({name:'LINKS_ENABLED',expectedVersion:2,reason:'Contact links removed from the core.',typedName:'LINKS_ENABLED'},boot);
 assert.equal(result.carriedTo,undefined);const snapshot=await storage.flagsSnapshot();
 assert.equal(Object.hasOwn(snapshot.flags,'LINKS_ENABLED'),false);assert.equal(Object.hasOwn(snapshot.flags,'KEY_DELEGATION_ENABLED'),false);
});
