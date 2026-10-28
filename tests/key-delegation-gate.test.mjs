// Contacts-and-links spike CR-C0 (H5, CL-25; provisional, unsigned): the KEY_DELEGATION_ENABLED gate. Its retained state
// comes from live `key-delegation/` rows only, never from `link/` rows. Contacts phase 4 (CR-C7) retired LINKS_ENABLED, so
// the gate's transitional LINKS_ENABLED fallback is gone: KEY_DELEGATION_ENABLED decides alone. Engine level: the AccountFeatureState Query, the
// pure gate, and the real AccountController issuance path under a writer pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {createAppEngine,read} from '../packages/app/engine.mjs';
import {FlagsRuntime,flagWriter} from '../packages/runtime/flags.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';
import {FLAGS,RETIRED_FLAGS} from '../packages/flags/registry.mjs';
import {validateSnapshot} from '../packages/flags/snapshot.mjs';
import {AccountFeatureState,withWriterFlags} from '../packages/runtime/account/flags.mjs';
import {keyDelegationAdmits,delegationsEnabled} from '../packages/identity/delegation.mjs';
import {fakeClock,forEachSeed} from './helpers/chaos.mjs';

const owner='00000000-0000-4000-8000-0000000000a1',other='00000000-0000-4000-8000-0000000000a2',client='https://app.example/client.json',start=Date.UTC(2026,9,28,12);
const record=(patch={})=>({rev:1,on:true,onValue:true,fallthrough:false,salt:'kd-gate',...patch}),snapshot=(flags={},version=1)=>({v:1,version,issuedAt:start,flags});
const port=(flags,env={},options={})=>createFlags({snapshot:snapshot(flags),env,clock:()=>start,...options}).for({subject:{kind:'account',owner}});
const engine=store=>createAppEngine({providers:{accountStore:store,clock:fakeClock(start),random:{uuid:()=>other,bytes:n=>new Uint8Array(n)},audit:{record(){}}}});
const stateOf=async store=>{const e=engine(store);try{return await read(e,new AccountFeatureState({actor:{kind:'system',owner}}));}finally{await e.dispose();}};

test('registry: KEY_DELEGATION_ENABLED is an account-placed, stateful, retained, default-off boolean flag',()=>{
 const f=FLAGS.KEY_DELEGATION_ENABLED;
 assert.equal(f.class,'a');assert.deepEqual(f.dimensions,['G','A','S','P']);assert.equal(f.stateful,true);assert.equal(f.placement,'account');
 assert.equal(f.retainExisting,true);assert.equal(f.hasState,'KEY_DELEGATION_ENABLED');assert.equal(f.envParse,'boolean');assert.equal(f.safe,false);
 assert.deepEqual(f.requires,[]);assert.equal(f.envAlias,null);
 assert.equal(port({}).enabled('KEY_DELEGATION_ENABLED'),false);
});

test('retained state: live key-delegation rows only; link rows, revoked, foreign and other-owner rows never count',async t=>{
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());await db.put('owner',owner);
 // Live link rows (and a live contact parent) alone: delegation is not retained, the links contract still is not by them.
 for(let i=0;i<3;i++)await db.put(`link/${i}`,{owner,state:'active'});
 let state=await stateOf(db);assert.equal(state.KEY_DELEGATION_ENABLED,false,'link rows never retain key delegation');
 // Inactive and foreign delegation rows, more than one page of them.
 for(let i=0;i<70;i++)await db.put(`key-delegation/${owner}/${String(i).padStart(3,'0')}`,{owner,state:'revoked',revoked:true});
 await db.put(`key-delegation/${owner}/foreign`,{owner:other,state:'active'});await db.put(`key-delegation/${other}/live`,{owner:other,state:'active'});
 state=await stateOf(db);assert.equal(state.KEY_DELEGATION_ENABLED,false,'revoked, foreign and other-owner rows');
 await db.put(`key-delegation/${owner}/zzz-live`,{owner,state:'active'});
 state=await stateOf(db);assert.equal(state.KEY_DELEGATION_ENABLED,true,'a live row past the first page');
 // Removing every link row changes nothing for key delegation (the §9 reset deletes them).
 for(let i=0;i<3;i++)await db.delete(`link/${i}`);
 state=await stateOf(db);assert.equal(state.KEY_DELEGATION_ENABLED,true);
 // Another owner's query never reads this account.
 const e=engine(db);try{assert.deepEqual(await read(e,new AccountFeatureState({actor:{kind:'system',owner:other}})),{});}finally{await e.dispose();}
});

test('gate: KEY_DELEGATION_ENABLED decides alone; the retired LINKS_ENABLED (record or env) has no effect',()=>{
 const on=record({fallthrough:true}),off=record({on:false});
 assert.equal(Object.hasOwn(FLAGS,'LINKS_ENABLED'),false);assert.ok(RETIRED_FLAGS.LINKS_ENABLED);
 assert.equal(keyDelegationAdmits(port({KEY_DELEGATION_ENABLED:on})),true);
 assert.equal(keyDelegationAdmits(port({KEY_DELEGATION_ENABLED:off})),false,'a console-off record closes it');
 assert.equal(keyDelegationAdmits(port({},{KEY_DELEGATION_ENABLED:'false'})),false,'the env kill closes it');
 assert.equal(keyDelegationAdmits(port({},{KEY_DELEGATION_ENABLED:'true'})),true,'legacy env force-on before console adoption');
 assert.equal(keyDelegationAdmits(port({KEY_DELEGATION_ENABLED:record({rules:[{when:{accounts:[other]},serve:{value:true}}]})})),false,'targeting another account');
 // Unconfigured stays closed whatever the retired names say (no fallback since CR-C7).
 assert.equal(keyDelegationAdmits(port({})),false);
 for(const env of [{LINKS_ENABLED:'true'},{BINDLEBOX_ENABLED:'true'}])assert.equal(keyDelegationAdmits(port({},env)),false,JSON.stringify(env));
 assert.equal(keyDelegationAdmits(port({KEY_DELEGATION_ENABLED:on},{LINKS_ENABLED:'false'})),true,'a retired env kill closes nothing');
 // A stored LINKS_ENABLED console record is quarantined by snapshot validation, never applied to key delegation.
 const validated=validateSnapshot(snapshot({LINKS_ENABLED:on}),{quarantine:true});assert.deepEqual(validated.quarantined,['LINKS_ENABLED']);
 assert.equal(keyDelegationAdmits(createFlags({snapshot:validated,env:{},clock:()=>start}).for({subject:{kind:'account',owner}})),false);
 assert.equal(keyDelegationAdmits(createFlags({snapshot:null,env:{KEY_DELEGATION_ENABLED:'true'}}).for({subject:{kind:'account',owner}})),false,'an unusable snapshot fails closed');
 // delegationsEnabled is the same gate over a config.
 assert.equal(delegationsEnabled({KEY_DELEGATION_ENABLED:'true'},{subject:{kind:'account',owner}}),true);
 assert.equal(delegationsEnabled({KEY_DELEGATION_ENABLED:'false'},{subject:{kind:'account',owner}}),false);
 assert.equal(delegationsEnabled({LINKS_ENABLED:'true'},{subject:{kind:'account',owner}}),false,'the retired fallback is gone');
});

test('gate: KEY_DELEGATION_ENABLED retention comes from its own state only',()=>{
 const own=port({KEY_DELEGATION_ENABLED:record({retainExisting:true})},{},{hasState:name=>name==='KEY_DELEGATION_ENABLED'});
 assert.equal(own.evaluate('KEY_DELEGATION_ENABLED').reason,'retained');assert.equal(keyDelegationAdmits(own),true);
 assert.equal(keyDelegationAdmits(port({KEY_DELEGATION_ENABLED:record({retainExisting:true})},{},{hasState:()=>false})),false);
 assert.equal(keyDelegationAdmits(port({KEY_DELEGATION_ENABLED:record({retainExisting:true})},{},{hasState:name=>name==='LINKS_ENABLED'})),false,'no retired state counts');
});

async function account(t,{flags={},env={}}={}){
 const db=new SqliteMetadata(':memory:'),clock=fakeClock(start),runtime=new FlagsRuntime({env,clock:clock.now,store:{flagsSnapshot:async()=>snapshot(flags)}}),config={APP_ORIGIN:'https://host.example',LOCAL_DEVELOPMENT:'true',KEY_ENCRYPTION_KEY:'local-only-key',...env},bucket={get:async()=>null,put:async()=>{},delete:async()=>{}};
 const controller=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,config,sql:db.sql});await controller.warm(owner);flagWriter(controller,runtime);await runtime.pin();t.after(()=>db.close());
 // The internal app entry under a real writer pin (the trusted adapter's path); `not_found` is the gate, anything later
 // (here `forbidden`: no messaging-ingress occupant) means the gate admitted the request.
 const issue=()=>withWriterFlags(controller,controller.flagConfig,()=>controller.delegationOperation(owner,{actor:{kind:'app',owner,clientId:client},operation:'delegations.issue',input:{}})).then(()=>'issued',error=>error.code);
 return {db,issue};
}

test('AccountController: with the retired LINKS_ENABLED set in env and no KEY_DELEGATION_ENABLED, issuance stays closed',async t=>{
 const links=await account(t,{env:{LINKS_ENABLED:'true'}});await links.db.put('link/one',{owner,state:'active'});
 assert.equal(await links.issue(),'not_found','neither the retired env name nor link rows open key delegation');
 const delegated=await account(t,{env:{LINKS_ENABLED:'true'}});await delegated.db.put(`key-delegation/${owner}/live`,{owner,state:'active'});
 assert.equal(await delegated.issue(),'not_found','delegation rows retain only a configured KEY_DELEGATION_ENABLED');
});

test('AccountController: KEY_DELEGATION_ENABLED opens issuance and retains it by delegation rows',async t=>{
 assert.equal(await (await account(t,{flags:{KEY_DELEGATION_ENABLED:record({fallthrough:true})}})).issue(),'forbidden');
 assert.equal(await (await account(t,{flags:{KEY_DELEGATION_ENABLED:record({fallthrough:true})},env:{KEY_DELEGATION_ENABLED:'false'}})).issue(),'not_found','env kill');
 const retained=await account(t,{flags:{KEY_DELEGATION_ENABLED:record({retainExisting:true})}});
 assert.equal(await retained.issue(),'not_found');
 await retained.db.put('link/one',{owner,state:'active'});assert.equal(await retained.issue(),'not_found','link rows never retain it');
 await retained.db.put(`key-delegation/${owner}/live`,{owner,state:'active'});assert.equal(await retained.issue(),'forbidden');
});

test('seeded: the gate verdict depends on KEY_DELEGATION_ENABLED and its delegation rows only, never on link rows or retired names',async()=>{
 await forEachSeed(40,async random=>{
  const pick=list=>random.pick(list);
  const kd=pick([undefined,record({fallthrough:true}),record({on:false}),record({retainExisting:true})]);
  const env=pick([{},{KEY_DELEGATION_ENABLED:'false'},{KEY_DELEGATION_ENABLED:'true'}]),retired=pick([{},{LINKS_ENABLED:'false'},{LINKS_ENABLED:'true'},{BINDLEBOX_ENABLED:'true'}]),delegationRows=random.chance(0.5),linkRows=random.chance(0.5);
  const flags=kd?{KEY_DELEGATION_ENABLED:kd}:{};
  const verdict=(extraEnv,rows)=>keyDelegationAdmits(port(flags,{...env,...extraEnv},{hasState:name=>rows[name]===true}),name=>rows[name]===true);
  const clean=verdict({},{KEY_DELEGATION_ENABLED:delegationRows});
  assert.equal(verdict(retired,{KEY_DELEGATION_ENABLED:delegationRows,LINKS_ENABLED:delegationRows||linkRows}),clean,`retired inputs changed the verdict: ${JSON.stringify({kd,env,retired,delegationRows,linkRows})}`);
 });
});
