// Contacts-and-links spike CR-C0 (H5, CL-25; provisional, unsigned): the KEY_DELEGATION_ENABLED gate. Its retained state
// comes from live `key-delegation/` rows only, never from `link/` rows; until CR-C7 the gate also honours LINKS_ENABLED,
// except a LINKS_ENABLED retention that link rows alone could justify. Engine level: the AccountFeatureState Query, the
// pure gate, and the real AccountController issuance path under a writer pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {createAppEngine,read} from '../packages/app/engine.mjs';
import {FlagsRuntime,flagWriter} from '../packages/runtime/flags.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';
import {FLAGS} from '../packages/flags/registry.mjs';
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

test('gate: KEY_DELEGATION_ENABLED decides when configured; LINKS_ENABLED is the transitional fallback only when it is not',()=>{
 const on=record({fallthrough:true}),off=record({on:false});
 // Configured KEY_DELEGATION_ENABLED (record or env) decides alone.
 assert.equal(keyDelegationAdmits(port({KEY_DELEGATION_ENABLED:on})),true);
 assert.equal(keyDelegationAdmits(port({KEY_DELEGATION_ENABLED:on,LINKS_ENABLED:off})),true,'LINKS_ENABLED off does not close a configured gate');
 assert.equal(keyDelegationAdmits(port({KEY_DELEGATION_ENABLED:off,LINKS_ENABLED:on})),false,'a console-off record closes it');
 assert.equal(keyDelegationAdmits(port({LINKS_ENABLED:on},{KEY_DELEGATION_ENABLED:'false'})),false,'the env kill closes it');
 assert.equal(keyDelegationAdmits(port({},{KEY_DELEGATION_ENABLED:'true'})),true,'legacy env force-on before console adoption');
 assert.equal(keyDelegationAdmits(port({KEY_DELEGATION_ENABLED:record({rules:[{when:{accounts:[other]},serve:{value:true}}]}),LINKS_ENABLED:on})),false,'targeting another account');
 // Unconfigured: LINKS_ENABLED, exactly as before CR-C0.
 assert.equal(keyDelegationAdmits(port({LINKS_ENABLED:on})),true);
 assert.equal(keyDelegationAdmits(port({})),false);
 assert.equal(keyDelegationAdmits(port({},{LINKS_ENABLED:'true'})),true);
 assert.equal(keyDelegationAdmits(port({LINKS_ENABLED:on},{LINKS_ENABLED:'false'})),false);
 assert.equal(keyDelegationAdmits(createFlags({snapshot:null,env:{KEY_DELEGATION_ENABLED:'true',LINKS_ENABLED:'true'}}).for({subject:{kind:'account',owner}})),false,'an unusable snapshot fails closed');
 // delegationsEnabled is the same gate over a config.
 assert.equal(delegationsEnabled({KEY_DELEGATION_ENABLED:'true'},{subject:{kind:'account',owner}}),true);
 assert.equal(delegationsEnabled({KEY_DELEGATION_ENABLED:'false',LINKS_ENABLED:'true'},{subject:{kind:'account',owner}}),false);
 assert.equal(delegationsEnabled({LINKS_ENABLED:'true'},{subject:{kind:'account',owner}}),true);
});

test('gate: a LINKS_ENABLED retention counts only with key-delegation state behind it',()=>{
 const flags={LINKS_ENABLED:record({retainExisting:true})};
 const retained=port(flags,{},{hasState:name=>name==='LINKS_ENABLED'});assert.equal(retained.evaluate('LINKS_ENABLED').reason,'retained');
 assert.equal(keyDelegationAdmits(retained),false,'no account state: a link-row retention is not enough');
 assert.equal(keyDelegationAdmits(retained,name=>name==='LINKS_ENABLED'),false,'link rows alone');
 assert.equal(keyDelegationAdmits(retained,name=>name==='KEY_DELEGATION_ENABLED'),true,'live delegation rows');
 // KEY_DELEGATION_ENABLED's own retention.
 const own=port({KEY_DELEGATION_ENABLED:record({retainExisting:true})},{},{hasState:name=>name==='KEY_DELEGATION_ENABLED'});
 assert.equal(own.evaluate('KEY_DELEGATION_ENABLED').reason,'retained');assert.equal(keyDelegationAdmits(own),true);
 assert.equal(keyDelegationAdmits(port({KEY_DELEGATION_ENABLED:record({retainExisting:true})},{},{hasState:()=>false})),false);
});

async function account(t,{flags={},env={}}={}){
 const db=new SqliteMetadata(':memory:'),clock=fakeClock(start),runtime=new FlagsRuntime({env,clock:clock.now,store:{flagsSnapshot:async()=>snapshot(flags)}}),config={APP_ORIGIN:'https://host.example',LOCAL_DEVELOPMENT:'true',KEY_ENCRYPTION_KEY:'local-only-key',...env},bucket={get:async()=>null,put:async()=>{},delete:async()=>{}};
 const controller=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,config,sql:db.sql});await controller.warm(owner);flagWriter(controller,runtime);await runtime.pin();t.after(()=>db.close());
 // The internal app entry under a real writer pin (the trusted adapter's path); `not_found` is the gate, anything later
 // (here `forbidden`: no messaging-ingress occupant) means the gate admitted the request.
 const issue=()=>withWriterFlags(controller,controller.flagConfig,()=>controller.delegationOperation(owner,{actor:{kind:'app',owner,clientId:client},operation:'delegations.issue',input:{}})).then(()=>'issued',error=>error.code);
 return {db,issue};
}

test('AccountController: a LINKS_ENABLED ramp-down retains issuance for delegation rows, never for link rows',async t=>{
 const flags={LINKS_ENABLED:record({retainExisting:true})};
 const links=await account(t,{flags});await links.db.put('link/one',{owner,state:'active'});
 assert.equal(await links.issue(),'not_found','link rows alone no longer keep key delegation open');
 const delegated=await account(t,{flags});await delegated.db.put(`key-delegation/${owner}/live`,{owner,state:'active'});
 assert.equal(await delegated.issue(),'forbidden','a live delegation row keeps it open, as before');
 const fresh=await account(t,{flags});assert.equal(await fresh.issue(),'not_found');
});

test('AccountController: KEY_DELEGATION_ENABLED opens issuance without LINKS_ENABLED and retains it by delegation rows',async t=>{
 assert.equal(await (await account(t,{flags:{KEY_DELEGATION_ENABLED:record({fallthrough:true})}})).issue(),'forbidden');
 assert.equal(await (await account(t,{flags:{KEY_DELEGATION_ENABLED:record({fallthrough:true}),LINKS_ENABLED:record({on:false})}})).issue(),'forbidden');
 assert.equal(await (await account(t,{flags:{KEY_DELEGATION_ENABLED:record({fallthrough:true})},env:{KEY_DELEGATION_ENABLED:'false'}})).issue(),'not_found','env kill');
 const retained=await account(t,{flags:{KEY_DELEGATION_ENABLED:record({retainExisting:true}),LINKS_ENABLED:record({on:false})}});
 assert.equal(await retained.issue(),'not_found');
 await retained.db.put('link/one',{owner,state:'active'});assert.equal(await retained.issue(),'not_found','link rows never retain it');
 await retained.db.put(`key-delegation/${owner}/live`,{owner,state:'active'});assert.equal(await retained.issue(),'forbidden');
});

test('seeded: the gate verdict depends on delegation rows and flags, never on link rows',async()=>{
 await forEachSeed(40,async random=>{
  const pick=list=>random.pick(list);
  const kd=pick([undefined,record({fallthrough:true}),record({on:false}),record({retainExisting:true})]),lk=pick([undefined,record({fallthrough:true}),record({on:false}),record({retainExisting:true})]);
  const env=pick([{},{KEY_DELEGATION_ENABLED:'false'},{LINKS_ENABLED:'false'},{LINKS_ENABLED:'true'}]),delegationRows=random.chance(0.5),linkRows=random.chance(0.5);
  const flags=Object.fromEntries(Object.entries({KEY_DELEGATION_ENABLED:kd,LINKS_ENABLED:lk}).filter(([,v])=>v));
  // AccountFeatureState as CR-C0 computes it: delegation rows for KEY_DELEGATION_ENABLED, either for LINKS_ENABLED.
  const state={KEY_DELEGATION_ENABLED:delegationRows,LINKS_ENABLED:delegationRows||linkRows};
  const verdict=rows=>keyDelegationAdmits(port(flags,env,{hasState:name=>rows[name]===true}),name=>rows[name]===true);
  const withoutLinks=verdict({KEY_DELEGATION_ENABLED:delegationRows,LINKS_ENABLED:delegationRows});
  assert.equal(verdict(state),withoutLinks,`link rows changed the verdict: ${JSON.stringify({kd,lk,env,delegationRows,linkRows})}`);
 });
});
