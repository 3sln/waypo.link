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

test('BINDLEBOX_ENABLED is retired in favour of LINKS_ENABLED; its raw env value is still honoured as an alias',async()=>{
 const {parseEnv,legacyValue}=await import('../packages/flags/env.mjs');
 const {createFlags}=await import('../packages/flags/evaluate.mjs');
 assert.equal(Object.hasOwn(FLAGS,'BINDLEBOX_ENABLED'),false);assert.equal(lock.includes('BINDLEBOX_ENABLED'),true,'the old name stays in the lock');
 assert.equal(RETIRED_FLAGS.BINDLEBOX_ENABLED?.retiredOn,'2026-10-26');assert.equal(RETIRED_FLAGS.BINDLEBOX_ENABLED.replacement,'LINKS_ENABLED');
 assert.equal(FLAGS.LINKS_ENABLED.envAlias,'BINDLEBOX_ENABLED');assert.equal(FLAGS.LINKS_ENABLED.stateful,true);assert.deepEqual(FLAGS.EMAIL_BRIDGE_ENABLED.requires,[]);
 // The alias is read only while the new name is unset; the new name always wins.
 assert.equal(parseEnv('LINKS_ENABLED',{BINDLEBOX_ENABLED:'true'}).state,'force-on-legacy');
 assert.equal(parseEnv('LINKS_ENABLED',{BINDLEBOX_ENABLED:'false'}).state,'kill');
 assert.equal(parseEnv('LINKS_ENABLED',{BINDLEBOX_ENABLED:'true',LINKS_ENABLED:'false'}).state,'kill');
 assert.equal(parseEnv('LINKS_ENABLED',{BINDLEBOX_ENABLED:'false',LINKS_ENABLED:'true'}).state,'force-on-legacy');
 assert.equal(legacyValue('LINKS_ENABLED',{BINDLEBOX_ENABLED:'true'}),true);assert.equal(legacyValue('LINKS_ENABLED',{}),false);
 const evaluate=env=>createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}},env}).for({}).evaluate('LINKS_ENABLED');
 assert.deepEqual(evaluate({BINDLEBOX_ENABLED:'true'}),{value:true,reason:'legacy-env'});assert.equal(evaluate({}).value,false);
 // No other flag declares an alias, and an alias never names a registered flag.
 for(const f of Object.values(FLAGS))if(f.envAlias!==null){assert.equal(f.name,'LINKS_ENABLED');assert.equal(Object.hasOwn(FLAGS,f.envAlias),false);assert.equal(Object.hasOwn(RETIRED_FLAGS,f.envAlias),true);}
 // A stored console record under the retired name is quarantined, never applied to the new name.
 const snapshot=validateSnapshot({v:1,version:1,issuedAt:0,flags:{BINDLEBOX_ENABLED:{rev:1,on:true,onValue:true,fallthrough:true,salt:'s'}}},{quarantine:true});
 assert.deepEqual(snapshot.quarantined,['BINDLEBOX_ENABLED']);assert.equal(Object.hasOwn(snapshot.flags,'LINKS_ENABLED'),false);
});

// Review F1 (2026-10-27): a console kill or allowlist stored under the retired name must never be widened by the old
// env name. Regression for the review PoC poc-flag-alias.mjs.
test('a quarantined record under the alias name keeps LINKS_ENABLED on its outage path, never legacy-env',async()=>{
 const {createFlags}=await import('../packages/flags/evaluate.mjs');
 const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const rec=over=>({rev:3,on:true,onValue:true,fallthrough:false,salt:'s',retainExisting:false,deny:{accounts:[],clients:[]},rules:[],experiment:null,...over});
 for(const [label,r] of [['console off',rec({on:false})],['allowlist A',rec({rules:[{when:{accounts:[A]},serve:{value:true}}]})]]){
  const snapshot={v:1,version:4,issuedAt:0,flags:{BINDLEBOX_ENABLED:r}};
  for(const env of [{BINDLEBOX_ENABLED:'true'},{LINKS_ENABLED:'true'},{}]){
   const ev=createFlags({snapshot,env}).for({subject:{kind:'account',owner:B}}).evaluate('LINKS_ENABLED');
   assert.deepEqual({...ev},{value:false,reason:'outage'},`${label} ${JSON.stringify(env)}`);
  }
 }
 // An own record for the new name wins over the quarantined alias record.
 const own={v:1,version:5,issuedAt:0,flags:{BINDLEBOX_ENABLED:rec({on:false}),LINKS_ENABLED:rec({fallthrough:true})}};
 assert.deepEqual({...createFlags({snapshot:own,env:{BINDLEBOX_ENABLED:'true'}}).for({subject:{kind:'account',owner:B}}).evaluate('LINKS_ENABLED')},{value:true,reason:'fallthrough'});
 // Without any stored alias record the env alias keeps its pre-console meaning.
 assert.equal(createFlags({snapshot:{v:1,version:1,issuedAt:0,flags:{}},env:{BINDLEBOX_ENABLED:'true'}}).for({}).evaluate('LINKS_ENABLED').reason,'legacy-env');
});

test('flags.retire carries a retired alias record to its replacement, so retiring never re-opens the env alias',async t=>{
 const {SqliteMetadata}=await import('../apps/node/resources.mjs');
 const {AdminStorage}=await import('../packages/identity/admin-store.mjs');
 const {FlagService}=await import('../packages/flags/service.mjs');
 const {createFlags}=await import('../packages/flags/evaluate.mjs');
 const start=1792000000000,boot={actor:{kind:'boot',expect:{'boot/principal':null}},stepUpAt:start,stepUpMethod:'passkey'},B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const run=async(stored,env)=>{
  const raw=new SqliteMetadata(':memory:'),storage=new AdminStorage(raw);t.after(()=>raw.close());
  await raw.transaction(async tx=>{await tx.put('admin/flags-head',{version:2,issuedAt:start});await tx.put('admin/flag/BINDLEBOX_ENABLED',stored);});
  const commits=[],service=new FlagService({store:storage,env,clock:()=>start,randomId:()=>'salt-1',onCommit:s=>commits.push(s)});
  const result=await service.retire({name:'BINDLEBOX_ENABLED',expectedVersion:2,reason:'Renamed to LINKS_ENABLED.',typedName:'BINDLEBOX_ENABLED'},boot);
  return {result,commits,storage,snapshot:await storage.flagsSnapshot(),eval:s=>createFlags({snapshot:s,env}).for({subject:{kind:'account',owner:B}}).evaluate('LINKS_ENABLED')};
 };
 // A valid kill record is carried as is (rev 1), and the env alias stays ignored.
 const killed=await run({rev:4,on:false,onValue:true,fallthrough:false,salt:'s'},{BINDLEBOX_ENABLED:'true'});
 assert.equal(killed.result.carriedTo,'LINKS_ENABLED');assert.equal(killed.result.carried.on,false);assert.equal(killed.result.carried.rev,1);
 assert.equal(killed.result.audit.carriedTo,'LINKS_ENABLED');assert.equal(killed.snapshot.flags.LINKS_ENABLED.on,false);
 assert.deepEqual({...killed.eval(killed.commits.at(-1))},{value:false,reason:'console-off'});
 assert.deepEqual({...killed.eval(killed.snapshot)},{value:false,reason:'console-off'});
 assert.equal(killed.commits.at(-1).quarantined,undefined);assert.deepEqual(await killed.storage.verifyAudit(),{valid:true,seq:1});
 // A record whose shape no longer fits the new flag is replaced by the off record, never dropped.
 const odd=await run({rev:2,on:true,onValue:true,fallthrough:true,salt:'s',rules:[{when:{countries:['NZ']},serve:{value:true}}]},{BINDLEBOX_ENABLED:'true'});
 assert.equal(odd.result.carried.on,false);assert.equal(odd.result.carried.fallthrough,false);
 assert.deepEqual({...odd.eval(odd.snapshot)},{value:false,reason:'console-off'});
});
