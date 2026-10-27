// PORT-9, old-key honouring (identity portability P11; docs/spec/identity-portability.md §7.1, AMD-P10/P11):
// links recorded under a retired key keep verifying from their stored exact claims, and new issuance uses the CURRENT
// key (the legacy contact-grant bearers of this suite left the core with messaging on 2026-10-27); retired keys
// that live stored records (or an issued recovery file) reference are never pruned, and a full history of referenced
// keys refuses rotation; published keys carry `created`/`retired` (Unix seconds); a bare retired-key signature on
// anything newly minted is never honoured. Engine level: a real AccountController over in-memory SQLite, plus the
// registry over the memory store, plus seeded chaos schedules (tests/helpers/chaos.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {MemoryMessagingStore,key,base64url,textEncoder,canonical} from '../packages/core/records.mjs';
import {IdentityKeyRegistry,createIdentityKeyEngine,performKeyAction,readKeyQuery,EnsureIdentityKey,RotateIdentityKey,RevokeIdentityKey,RotateSigningKeyForRecovery,IdentityKeyHistory,IdentityKeyByKid,KEY_HISTORY_LIMIT,RECOVERY_ISSUANCE_ROTATION,RECOVERY_BINDING_LIMIT,referencedSigningKids} from '../packages/identity/keys.mjs';
import {linkService} from '../packages/runtime/account/links.mjs';
import {MESSAGING_CONTACT_LINK_TYPE} from '../packages/links/types.mjs';
import {encryptSecret,decryptSecret} from '../packages/runtime/secrets.mjs';
import {forEachSeed,createScheduler,fakeClock} from './helpers/chaos.mjs';

const origin='https://honour.example',owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bucket={get:async()=>null,put:async()=>({}),delete:async()=>{}};
const KEK=Buffer.alloc(32,9).toString('base64'),sealing={seal:value=>encryptSecret(value,KEK),open:value=>decryptSecret(value,KEK)};
const decoded=segment=>JSON.parse(Buffer.from(segment,'base64url').toString('utf8'));
const headerOf=token=>decoded(token.split('.')[0]);
const metaOf=url=>new URL(url).searchParams.get('bindle_meta');
const linkClaims={resource:'contact',kinds:['one-off'],mimeTypes:['text/plain'],maxMessages:50,maxBytes:65536,maxMessageBytes:4096};
// One contact link through the core links service (owner issuance), the type-neutral contact parent.
const issueLink=c=>linkService(c).issue(owner,{type:MESSAGING_CONTACT_LINK_TYPE,claims:linkClaims,expiresAt:Date.now()+86400000,handle:'person'}).then(r=>({...r,url:r.link}));

async function account(t){
 const db=new SqliteMetadata(':memory:'),controller=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,sql:db.sql,config:{APP_ORIGIN:origin,KEY_ENCRYPTION_KEY:KEK,IDENTITY_ACCOUNT:async id=>({id,status:'active',handle:'person'})}});
 t.after(async()=>{await controller.engine.dispose();db.close();});await controller.warm(owner);
 return {db,controller};
}
const rotate=(c,always=true)=>c.invoke({method:'recoveryKeychain',args:[owner,{rotation:always?{always:true}:null,keep:[]}]});

test('links recorded before a rotation keep verifying from their stored claims; new links are signed with the current key', async t => {
 const {controller:c}=await account(t);
 const link=await issueLink(c),k0=headerOf(metaOf(link.url)).kid;
 const {rotation}=await rotate(c);const k1=rotation.kid;assert.notEqual(k1,k0);
 const {record}=await linkService(c).verify(link.url);assert.equal(record.jti,link.jti,'the recorded link still verifies under the retired key');
 const fresh=await issueLink(c);assert.equal(headerOf(metaOf(fresh.url)).kid,k1,'new issuance uses the current key');
 const history=(await c.identityKeyHistory(owner,{purpose:'signing'})).map(k=>k.kid);assert.ok(history.includes(k0),'the referenced retired key is kept');
 // A meta re-signed under the retired key with changed claims was never stored, so it never verifies.
 const old=await c.signingKey(owner);assert.equal(old.kid,k1);
 await linkService(c).revoke(owner,link.jti);await assert.rejects(linkService(c).verify(link.url),code('link_invalid'));
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
 const link=(kid,{who=owner,revoked=false,exp=clock.now()/1000+86400}={})=>{const jti=crypto.randomUUID();return store.transaction(tx=>tx.set(key('link',jti),{version:1,jti,owner:who,header:{alg:'ES256',kid,typ:'bindle-link-meta+jwt'},claims:{exp:Math.floor(exp)},revoked}));};
 return {store,clock,engine,act,ask,link};
}
const code=c=>({code:c});

test('retired keys referenced by live stored records are never pruned; a full history of referenced keys refuses rotation (16-key cap)', async () => {
 const f=registry();let {kid}=await f.act(EnsureIdentityKey,{purpose:'signing'});const kids=[kid];
 // Fill the history: each outgoing key is referenced by a live record of one kind or another.
 for(let i=1;i<KEY_HISTORY_LIMIT;i++){await f.link(kid);({kid}=await f.act(RotateIdentityKey,{purpose:'signing',expectedKid:kid}));kids.push(kid);}
 assert.equal((await f.ask(IdentityKeyHistory,{purpose:'signing'})).length,KEY_HISTORY_LIMIT);
 const before=await f.store.transaction(tx=>tx.list(''));
 await assert.rejects(f.act(RotateIdentityKey,{purpose:'signing',expectedKid:kid}),code('key_history_full'));
 assert.deepEqual(await f.act(RotateSigningKeyForRecovery,{rotateIf:[kid]}),{rotated:false,kid,previous:null,skipped:'key_history_full'},'issuance proceeds without rotating');
 assert.equal((await f.ask(IdentityKeyHistory,{purpose:'signing'})).length,KEY_HISTORY_LIMIT,'nothing was pruned');
 assert.deepEqual((await f.store.transaction(tx=>tx.list(''))).filter(row=>!row.key.startsWith('identity-key-recovery/')).map(row=>row.key),before.map(row=>row.key));
 // References that no longer verify protect nothing: another owner's, inactive, expired or revoked records.
 const g=registry();let gk=(await g.act(EnsureIdentityKey,{purpose:'signing'})).kid;
 const variants=[k=>g.link(k,{who:OTHER}),k=>g.link(k,{revoked:true}),k=>g.link(k,{exp:g.clock.now()/1000-1})];
 for(let i=1;i<KEY_HISTORY_LIMIT;i++){await variants[i%variants.length](gk);({kid:gk}=await g.act(RotateIdentityKey,{purpose:'signing',expectedKid:gk}));}
 const first=(await g.ask(IdentityKeyHistory,{purpose:'signing'}))[0].kid;
 ({kid:gk}=await g.act(RotateIdentityKey,{purpose:'signing',expectedKid:gk}));
 assert.equal(await g.ask(IdentityKeyByKid,{purpose:'signing',kid:first}),null,'the oldest unreferenced retired key was pruned');
 // Expiry frees a referenced key: advance past one link's exp, then the oldest unreferenced one goes.
 f.clock.advance(2*86400000);({kid}=await f.act(RotateIdentityKey,{purpose:'signing',expectedKid:kid}));
 assert.equal(await f.ask(IdentityKeyByKid,{purpose:'signing',kid:kids[0]}),null);
 const referenced=await f.store.transaction(tx=>referencedSigningKids(tx,owner,f.clock.now()));
 assert.equal(referenced.size,0,'every reference has expired');
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

test('seeded chaos: rotations racing link issuance, verification and revocation never break recorded links or prune a referenced key', async t => {
 await forEachSeed(10,async random=>{
  const {controller:c}=await account(t),service=linkService(c),link=await issueLink(c),k0=headerOf(metaOf(link.url)).kid,issued=[],revoked=new Set();
  const scheduler=createScheduler(random),ports=scheduler.wrap({
   rotate:()=>rotate(c,random.chance(0.7)),
   issue:async()=>{const fresh=await issueLink(c);issued.push(fresh);return fresh;},
   verify:()=>service.verify(link.url),
   verifyLatest:async()=>{const latest=issued.at(-1);if(!latest)return null;try{return await service.verify(latest.url);}catch(error){if(error?.code==='link_invalid'&&revoked.has(latest.jti))return null;throw error;}},
   revokeOne:async()=>{const first=issued[0];if(!first)return null;revoked.add(first.jti);return service.revoke(owner,first.jti);},
  },'account');
  const work=random.shuffle([()=>ports.rotate(),()=>ports.rotate(),()=>ports.issue(),()=>ports.issue(),()=>ports.verify(),()=>ports.verifyLatest(),()=>ports.revokeOne(),()=>ports.issue().then(()=>ports.verifyLatest())]);
  const results=await scheduler.run(work);
  // Issuance racing a rotation may refuse with key_conflict (the key must still be current at commit); nothing else fails.
  for(const result of results)if(result.status==='rejected')assert.equal(result.reason?.code,'key_conflict',`only issuance may refuse: ${result.reason?.code} ${scheduler.trace.join(' | ')}`);
  assert.equal((await service.verify(link.url)).record.jti,link.jti,'the recorded link survives every schedule');
  const history=(await c.identityKeyHistory(owner,{purpose:'signing'})).map(k=>k.kid);
  assert.ok(history.includes(k0),'the referenced retired key was never pruned');
  for(const fresh of issued){const kid=headerOf(metaOf(fresh.url)).kid;assert.ok(history.includes(kid),'issued only under a registry key');}
  const latest=await issueLink(c);assert.equal(headerOf(metaOf(latest.url)).kid,(await c.signingKey(owner)).kid);
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
