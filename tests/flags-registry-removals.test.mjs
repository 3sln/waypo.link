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
