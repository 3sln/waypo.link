// PORT-9, old-key honouring (identity portability P11; docs/spec/identity-portability.md §7.1, AMD-P10/P11): retired
// keys an issued recovery file references are never pruned, and a full history of referenced keys refuses rotation.
// Contact-link records (`link/<jti>`) used to reference keys too; contact links left the core in contacts phase 4
// (2026-10-28), so such records no longer protect a key (keys pinned only by them become prunable, rethink §9); published keys carry `created`/`retired` (Unix seconds); a bare retired-key signature on
// anything newly minted is never honoured. Engine level: a real AccountController over in-memory SQLite, plus the
// registry over the memory store, plus seeded chaos schedules (tests/helpers/chaos.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {MemoryMessagingStore,key,base64url,textEncoder,canonical} from '../packages/core/records.mjs';
import {IdentityKeyRegistry,createIdentityKeyEngine,performKeyAction,readKeyQuery,EnsureIdentityKey,RotateIdentityKey,RevokeIdentityKey,RotateSigningKeyForRecovery,IdentityKeyHistory,IdentityKeyByKid,KEY_HISTORY_LIMIT,RECOVERY_ISSUANCE_ROTATION,RECOVERY_BINDING_LIMIT,referencedSigningKids} from '../packages/identity/keys.mjs';
import {encryptSecret,decryptSecret} from '../packages/runtime/secrets.mjs';
import {forEachSeed,createScheduler,fakeClock} from './helpers/chaos.mjs';

const origin='https://honour.example',owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bucket={get:async()=>null,put:async()=>({}),delete:async()=>{}};
const KEK=Buffer.alloc(32,9).toString('base64'),sealing={seal:value=>encryptSecret(value,KEK),open:value=>decryptSecret(value,KEK)};
const decoded=segment=>JSON.parse(Buffer.from(segment,'base64url').toString('utf8'));
const headerOf=token=>decoded(token.split('.')[0]);

async function account(t){
 const db=new SqliteMetadata(':memory:'),controller=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,sql:db.sql,config:{APP_ORIGIN:origin,KEY_ENCRYPTION_KEY:KEK,IDENTITY_ACCOUNT:async id=>({id,status:'active',handle:'person'})}});
 t.after(async()=>{await controller.engine.dispose();db.close();});await controller.warm(owner);
 return {db,controller};
}
const rotate=(c,always=true)=>c.invoke({method:'recoveryKeychain',args:[owner,{rotation:always?{always:true}:null,keep:[]}]});

test('contacts phase 4: a leftover link record no longer protects its key; the account rotates and prunes as if it were absent', async t => {
 const {db,controller:c}=await account(t),k0=(await c.signingKey(owner)).kid,jti=crypto.randomUUID();
 // A live, unrevoked contact-link row from before the change (the reset deletes such rows; here it is planted).
 await db.put(key('link',jti),{version:1,jti,owner,header:{alg:'ES256',kid:k0,typ:'bindle-link-meta+jwt'},claims:{exp:Math.floor(Date.now()/1000)+86400},revoked:false});
 for(let i=0;i<KEY_HISTORY_LIMIT+1;i++)await c.invoke({method:'recoveryKeychain',args:[owner,{rotation:{always:true},keep:[]}]});
 const history=(await c.identityKeyHistory(owner,{purpose:'signing'})).map(k=>k.kid);
 assert.equal(history.includes(k0),false,'the key pinned only by a link record was pruned');assert.ok(history.length<=KEY_HISTORY_LIMIT);
 assert.equal((await db.transaction(tx=>referencedSigningKids({list:prefix=>tx.list({prefix}).then(rows=>[...rows].map(([key,value])=>({key,value}))),get:k=>tx.get(k)},owner,Date.now()))).has(k0),false);
});

test('published signing keys carry created and retired in Unix seconds; the current key has no retired member', async t => {
 const {controller:c}=await account(t);
 const k0=(await c.signingKey(owner)).kid,{rotation}=await rotate(c);
 const history=await c.identityKeyHistory(owner,{purpose:'signing'}),[old,current]=history;
 assert.equal(old.retired,Math.floor(old.retiredAt/1000));assert.equal(old.created,Math.floor(old.createdAt/1000));assert.equal(current.retired,null);
 assert.equal(current.rotation,RECOVERY_ISSUANCE_ROTATION,'an issuance rotation is tagged');
 const published=await c.identitySigningKey(owner,k0),now=await c.identitySigningKey(owner,rotation.kid);
 assert.deepEqual([published.state,published.active,published.retired,published.created],['retired',false,old.retired,old.created]);
 assert.equal(Object.hasOwn(now,'retired'),false);assert.equal(now.created,current.created);
});

function registry(){
 const store=new MemoryMessagingStore(),clock=fakeClock(1800000000000),engine=createIdentityKeyEngine({store,...sealing,clock:clock.now});
 const act=(Action,input,who=owner)=>performKeyAction(engine,new Action({owner:who,input})),ask=(Query,input,who=owner)=>readKeyQuery(engine,new Query({owner:who,input}));
 // A planted recovery binding naming `kids` (issuance writes at most a few; planting more reaches the full-history edge).
 const bind=(kids,who=owner)=>store.transaction(tx=>tx.set(key('identity-key-recovery',who),{kids:[...kids]}));
 const link=(kid,{who=owner,revoked=false,exp=clock.now()/1000+86400}={})=>{const jti=crypto.randomUUID();return store.transaction(tx=>tx.set(key('link',jti),{version:1,jti,owner:who,header:{alg:'ES256',kid,typ:'bindle-link-meta+jwt'},claims:{exp:Math.floor(exp)},revoked}));};
 return {store,clock,engine,act,ask,link,bind};
}
const code=c=>({code:c});

test('retired keys referenced by the recovery binding are never pruned; a full history of referenced keys refuses rotation (16-key cap)', async () => {
 const f=registry();let {kid}=await f.act(EnsureIdentityKey,{purpose:'signing'});const kids=[kid];
 // Fill the history with every outgoing key referenced (a planted binding: real issuance binds far fewer keys).
 for(let i=1;i<KEY_HISTORY_LIMIT;i++){await f.bind(kids);({kid}=await f.act(RotateIdentityKey,{purpose:'signing',expectedKid:kid}));kids.push(kid);await f.bind(kids);}
 assert.equal((await f.ask(IdentityKeyHistory,{purpose:'signing'})).length,KEY_HISTORY_LIMIT);
 const before=await f.store.transaction(tx=>tx.list(''));
 await assert.rejects(f.act(RotateIdentityKey,{purpose:'signing',expectedKid:kid}),code('key_history_full'));
 assert.deepEqual(await f.act(RotateSigningKeyForRecovery,{rotateIf:[kid]}),{rotated:false,kid,previous:null,skipped:'key_history_full'},'issuance proceeds without rotating');
 assert.equal((await f.ask(IdentityKeyHistory,{purpose:'signing'})).length,KEY_HISTORY_LIMIT,'nothing was pruned');
 assert.deepEqual((await f.store.transaction(tx=>tx.list(''))).filter(row=>!row.key.startsWith('identity-key-recovery/')).map(row=>row.key),before.filter(row=>!row.key.startsWith('identity-key-recovery/')).map(row=>row.key));
 // Link records protect nothing any more (contacts phase 4), whatever their state; another owner's binding neither.
 const g=registry();let gk=(await g.act(EnsureIdentityKey,{purpose:'signing'})).kid;const gkids=[gk];
 const variants=[k=>g.link(k),k=>g.link(k,{who:OTHER}),k=>g.bind([k],OTHER)];
 for(let i=1;i<KEY_HISTORY_LIMIT;i++){await variants[i%variants.length](gk);({kid:gk}=await g.act(RotateIdentityKey,{purpose:'signing',expectedKid:gk}));gkids.push(gk);}
 const first=(await g.ask(IdentityKeyHistory,{purpose:'signing'}))[0].kid;
 ({kid:gk}=await g.act(RotateIdentityKey,{purpose:'signing',expectedKid:gk}));
 assert.equal(await g.ask(IdentityKeyByKid,{purpose:'signing',kid:first}),null,'the oldest retired key was pruned despite its link record');
 assert.equal((await g.store.transaction(tx=>referencedSigningKids(tx,owner,g.clock.now()))).size,0,'no link record counts as a reference');
 // Unbinding frees a referenced key: drop the binding, then the oldest one goes.
 await f.store.transaction(tx=>tx.delete(key('identity-key-recovery',owner)));({kid}=await f.act(RotateIdentityKey,{purpose:'signing',expectedKid:kid}));
 assert.equal(await f.ask(IdentityKeyByKid,{purpose:'signing',kid:kids[0]}),null);
});

test('recovery bindings protect their keys from pruning; revocation unbinds; a rotation outside issuance clears the binding', async () => {
 const f=registry();const k0=(await f.act(EnsureIdentityKey,{purpose:'signing'})).kid;
 assert.deepEqual(await f.act(RotateSigningKeyForRecovery,{}),{rotated:false,kid:k0,previous:null,skipped:null},'a first issuance adopts the signer');
 const r1=await f.act(RotateSigningKeyForRecovery,{rotateIf:[k0],keep:[k0]});assert.equal(r1.rotated,true);assert.equal(r1.previous,k0);
 const binding=()=>f.store.transaction(tx=>tx.get(key('identity-key-recovery',owner)));
 assert.deepEqual((await binding()).kids,[k0,r1.kid]);
 assert.deepEqual(await f.act(RotateSigningKeyForRecovery,{rotateIf:[k0],keep:[k0]}),{rotated:false,kid:r1.kid,previous:null,skipped:null},'a key in no issued file is not rotated again');
 // Fill to the cap with unreferenced keys: the bound k0 survives pruning while the unbound ones go first.
 let kid=r1.kid;for(let i=0;i<KEY_HISTORY_LIMIT;i++)({kid}=await f.act(RotateSigningKeyForRecovery,{always:true,keep:[k0]}));
 assert.equal((await f.ask(IdentityKeyByKid,{purpose:'signing',kid:k0})).state,'retired','bound key kept');
 await assert.rejects(f.act(RotateSigningKeyForRecovery,{rotateIf:['not-a-kid'.repeat(40)]}),code('invalid_key'));
 await f.act(RevokeIdentityKey,{purpose:'signing',kid:k0,reason:'compromise'});assert.equal((await binding()).kids.includes(k0),false);
 await f.act(RotateIdentityKey,{purpose:'signing',expectedKid:kid});assert.equal(await binding(),undefined,'an out-of-band rotation makes older files unusable');
});

test('seeded chaos: ordinary and issuance rotations racing each other never prune a bound key and always leave one current key', async t => {
 await forEachSeed(10,async random=>{
  const f=registry(),k0=(await f.act(EnsureIdentityKey,{purpose:'signing'})).kid;await f.act(RotateSigningKeyForRecovery,{});
  const bound=await f.act(RotateSigningKeyForRecovery,{always:true,keep:[k0]});
  const scheduler=createScheduler(random),ports=scheduler.wrap({
   issuance:()=>f.act(RotateSigningKeyForRecovery,{always:random.chance(0.6),keep:[k0]}),
   current:()=>f.ask(IdentityKeyHistory,{purpose:'signing'}),
  },'keys');
  const work=random.shuffle([...Array.from({length:4+random.int(4)},()=>()=>ports.issuance()),()=>ports.current(),()=>ports.current()]);
  const results=await scheduler.run(work);
  for(const result of results)if(result.status==='rejected')assert.equal(result.reason?.code,'key_conflict',`only a stale rotation may refuse: ${result.reason?.code} ${scheduler.trace.join(' | ')}`);
  const history=await f.ask(IdentityKeyHistory,{purpose:'signing'}),binding=await f.store.transaction(tx=>tx.get(key('identity-key-recovery',owner)));
  assert.ok(history.length<=KEY_HISTORY_LIMIT);assert.equal(history.filter(k=>k.state==='active').length,1,'exactly one current key');
  for(const kid of binding?.kids??[])assert.ok(history.some(k=>k.kid===kid),'a bound key was pruned: '+kid);
  assert.ok(bound.kid);
 });
});

test('review M1/M2: issuance merges the binding (outgoing and stale keep included) and trims only the oldest beyond the limit', async () => {
 const f=registry(),binding=async()=>(await f.store.transaction(tx=>tx.get(key('identity-key-recovery',owner))))?.kids??[];
 const k0=(await f.act(EnsureIdentityKey,{purpose:'signing'})).kid;
 const legacy=await f.act(RotateSigningKeyForRecovery,{always:true});assert.deepEqual(await binding(),[k0,legacy.kid],'the legacy branch binds the key it rotated out');
 const k2=(await f.act(RotateSigningKeyForRecovery,{rotateIf:[legacy.kid],keep:[legacy.kid]})).kid;
 await f.act(RotateSigningKeyForRecovery,{keep:[k0]});
 assert.deepEqual(new Set(await binding()),new Set([k0,legacy.kid,k2]),'a stale keep never drops a kid already bound');
 let kid=k2;const issued=[k0,legacy.kid,k2];for(let i=0;i<RECOVERY_BINDING_LIMIT+2;i++){({kid}=await f.act(RotateSigningKeyForRecovery,{always:true}));issued.push(kid);}
 const now=await binding();assert.equal(now.length,RECOVERY_BINDING_LIMIT);assert.deepEqual(now,issued.slice(-RECOVERY_BINDING_LIMIT),'oldest trimmed first, newest kept');
});
