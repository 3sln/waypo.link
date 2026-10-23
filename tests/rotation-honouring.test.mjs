// PORT-9, old-key honouring (identity portability P11; docs/spec/identity-portability.md §7.1, AMD-P10/P11):
// bearers minted from a link recorded under a retired key are signed and verified with the CURRENT key; retired keys
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
import {localAuthorResolver} from '../packages/messaging/contact-delivery.mjs';
import {signContactToken} from '../packages/messaging/contact-tokens.mjs';
import {encryptSecret,decryptSecret} from '../packages/runtime/secrets.mjs';
import {authored} from './link-helpers.mjs';
import {forEachSeed,createScheduler,fakeClock} from './helpers/chaos.mjs';

const origin='https://honour.example',owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bucket={get:async()=>null,put:async()=>({}),delete:async()=>{}};
const KEK=Buffer.alloc(32,9).toString('base64'),sealing={seal:value=>encryptSecret(value,KEK),open:value=>decryptSecret(value,KEK)};
const decoded=segment=>JSON.parse(Buffer.from(segment,'base64url').toString('utf8'));
const headerOf=token=>decoded(token.split('.')[0]);
const metaOf=url=>new URL(url).searchParams.get('bindle_meta');
const linkInput={name:'Friends',mimeTypes:['text/plain'],expiresAt:Date.now()+86400000,maxMessages:50,maxBytes:65536,maxMessageBytes:4096};

async function account(t){
 const db=new SqliteMetadata(':memory:'),controller=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,sql:db.sql,config:{APP_ORIGIN:origin,KEY_ENCRYPTION_KEY:KEK,IDENTITY_ACCOUNT:async id=>({id,status:'active',handle:'person'})}});
 t.after(async()=>{await controller.engine.dispose();db.close();});await controller.warm(owner);
 const deliver=async(credential,text='Hello')=>{const message=await authored(input=>controller.authorLinkEnvelope(owner,input),credential.url??credential.link,{text});return controller.deliverLink(owner,credential.token?{token:credential.token}:{url:credential.url},{envelope:message.envelope,body:message.body});};
 return {db,controller,deliver};
}
const rotate=(c,always=true)=>c.invoke({method:'recoveryKeychain',args:[owner,{rotation:always?{always:true}:null,keep:[]}]});

test('links recorded before a rotation keep verifying; their bearers are signed and verified with the current key; deliveries are accepted', async t => {
 const {controller:c,deliver}=await account(t);
 const link=await c.createContactLink(owner,'person',linkInput),k0=headerOf(metaOf(link.url)).kid;
 const collection=(await c.messages.collections(owner))[0].id,legacy=await c.createContact(owner,'person',{name:'Legacy',collections:[collection],mimeTypes:['text/plain'],expiresAt:Date.now()+86400000});
 const before=await c.endpoints.mintDelivery(link.url);assert.equal(headerOf(before.token).kid,k0);
 const rotated=await rotate(c);assert.equal(rotated.rotation.rotated,true);const k1=rotated.rotation.kid;assert.notEqual(k1,k0);
 assert.equal((await c.endpoints.inspect(link.url)).form,'link','a link recorded under the retired key still verifies');
 assert.equal((await c.endpoints.inspect(legacy.url)).form,'legacy','a legacy ?sig= parent too');
 await assert.rejects(c.endpoints.verifyDelivery(before.token),{code:'unauthorized'},'a bearer still signed by the retired key is not honoured after rotation');
 const bearer=await c.endpoints.mintDelivery(link.url);
 assert.deepEqual(headerOf(bearer.token),{alg:'ES256',kid:k1,typ:'bindle-contact-delivery+jwt'},'bearer is new issuance under the current key');
 assert.equal((await c.endpoints.verifyDelivery(bearer.token)).claims.parent,link.id);
 const viaToken=await deliver({token:bearer.token,link:link.url}),viaURL=await deliver({url:link.url},'Second');
 for(const result of [viaToken,viaURL])assert.equal(result?.$fault,undefined,'delivery accepted');
 const inbox=await c.endpoints.mint(legacy.url);assert.equal(headerOf(inbox.token).kid,k1,'legacy inbox bearers move to the current key too');
 const received=await c.receive(owner,inbox.token,{collection,mimeType:'text/plain',bytes:[...textEncoder.encode('hi')],idempotencyKey:'legacy-1'});assert.ok(received);
 // A second rotation: the same link mints under the newest key; the previous bearer stops verifying.
 const k2=(await rotate(c)).rotation.kid;await assert.rejects(c.endpoints.verifyDelivery(bearer.token),{code:'unauthorized'});
 assert.equal(headerOf((await c.endpoints.mintDelivery(link.url)).token).kid,k2);
 // Revoking the retired key the link was recorded under ends the link (spec §7.1 last row).
 await c.revokeIdentityKey(owner,{purpose:'signing',kid:k0,reason:'compromise'});
 await assert.rejects(c.endpoints.inspect(link.url),{code:'link_invalid'});await assert.rejects(c.endpoints.mintDelivery(link.url),{code:'link_invalid'});
});

test('a bare retired-key signature on anything minted after the rotation is never honoured, whatever its iat', async t => {
 const {controller:c}=await account(t);
 const link=await c.createContactLink(owner,'person',linkInput),old=await c.signingKey(owner),k0=old.kid;
 const grant=await c.metadata.get(key('contact-grant',link.id)),rotatedAt=Math.floor(Date.now()/1000);
 await rotate(c);
 // Bearer with exact expected claims, signed by the retired key, iat before the rotation (but within the parent's life).
 const claims=c.endpoints.deliveryClaims(grant,{jti:crypto.randomUUID(),iat:Math.max(grant.claims.iat,rotatedAt-1),exp:Math.max(grant.claims.iat,rotatedAt-1)+300});
 const forged=await signContactToken({header:{alg:'ES256',kid:k0,typ:'bindle-contact-delivery+jwt'},claims,privateKey:old.privateKey});
 await assert.rejects(c.endpoints.verifyDelivery(forged),{code:'unauthorized'});
 await assert.rejects(c.deliverLink(owner,{token:forged},{envelope:{},body:new Uint8Array(),idempotencyKey:'x'}),error=>error.status===401||error.code==='unauthorized');
 // A new link meta under the retired key that the host never stored is link_invalid, even for the same parent.
 const [h,p]=metaOf(link.url).split('.'),meta=decoded(p);
 const signed=async payload=>{const input=`${base64url(textEncoder.encode(canonical(decoded(h))))}.${base64url(textEncoder.encode(canonical(payload)))}`;return `${input}.${base64url(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},old.privateKey,textEncoder.encode(input))))}`;};
 await assert.rejects(c.endpoints.inspect(`${link.url.split('?')[0]}?bindle_meta=${await signed({...meta,maxMessages:999})}`),{code:'link_invalid'});
 // Author proofs and other fresh signatures resolve the retired key as inactive.
 const resolver=localAuthorResolver({issuer:origin,lookup:(subject,kid)=>c.identityKey(subject,kid)});
 assert.equal((await resolver({subject:owner,keyId:`${origin}/identity/${owner}#${k0}`})).active,false);
 assert.equal((await resolver({subject:owner,keyId:`${origin}/identity/${owner}#${(await c.signingKey(owner)).kid}`})).active,true);
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
 const grant=(kid,{who=owner,active=true,exp=clock.now()/1000+86400,form='link'}={})=>store.transaction(tx=>tx.set(key('contact-grant',crypto.randomUUID()),{id:'g',owner:who,active,header:{alg:'ES256',kid,typ:'contact+jwt'},claims:{exp:Math.floor(exp)},...form==='link'?{endpoint:{form,header:{alg:'ES256',kid,typ:'bindle-link-meta+jwt'}}}:{}}));
 const link=(kid,{revoked=false,exp=clock.now()/1000+86400}={})=>{const jti=crypto.randomUUID();return store.transaction(tx=>tx.set(key('link',jti),{version:1,jti,owner,header:{alg:'ES256',kid,typ:'bindle-link-meta+jwt'},claims:{exp:Math.floor(exp)},revoked}));};
 return {store,clock,engine,act,ask,grant,link};
}
const code=c=>({code:c});

test('retired keys referenced by live stored records are never pruned; a full history of referenced keys refuses rotation (16-key cap)', async () => {
 const f=registry();let {kid}=await f.act(EnsureIdentityKey,{purpose:'signing'});const kids=[kid];
 // Fill the history: each outgoing key is referenced by a live record of one kind or another.
 for(let i=1;i<KEY_HISTORY_LIMIT;i++){if(i%2)await f.grant(kid,{form:i%4===1?'link':'legacy'});else await f.link(kid);({kid}=await f.act(RotateIdentityKey,{purpose:'signing',expectedKid:kid}));kids.push(kid);}
 assert.equal((await f.ask(IdentityKeyHistory,{purpose:'signing'})).length,KEY_HISTORY_LIMIT);
 const before=await f.store.transaction(tx=>tx.list(''));
 await assert.rejects(f.act(RotateIdentityKey,{purpose:'signing',expectedKid:kid}),code('key_history_full'));
 assert.deepEqual(await f.act(RotateSigningKeyForRecovery,{rotateIf:[kid]}),{rotated:false,kid,previous:null,skipped:'key_history_full'},'issuance proceeds without rotating');
 assert.equal((await f.ask(IdentityKeyHistory,{purpose:'signing'})).length,KEY_HISTORY_LIMIT,'nothing was pruned');
 assert.deepEqual((await f.store.transaction(tx=>tx.list(''))).filter(row=>!row.key.startsWith('identity-key-recovery/')).map(row=>row.key),before.map(row=>row.key));
 // References that no longer verify protect nothing: another owner's, inactive, expired or revoked records.
 const g=registry();let gk=(await g.act(EnsureIdentityKey,{purpose:'signing'})).kid;
 const variants=[k=>g.grant(k,{who:OTHER}),k=>g.grant(k,{active:false}),k=>g.grant(k,{exp:g.clock.now()/1000-1}),k=>g.link(k,{revoked:true}),k=>g.link(k,{exp:g.clock.now()/1000-1})];
 for(let i=1;i<KEY_HISTORY_LIMIT;i++){await variants[i%variants.length](gk);({kid:gk}=await g.act(RotateIdentityKey,{purpose:'signing',expectedKid:gk}));}
 const first=(await g.ask(IdentityKeyHistory,{purpose:'signing'}))[0].kid;
 ({kid:gk}=await g.act(RotateIdentityKey,{purpose:'signing',expectedKid:gk}));
 assert.equal(await g.ask(IdentityKeyByKid,{purpose:'signing',kid:first}),null,'the oldest unreferenced retired key was pruned');
 // Expiry frees a referenced key: advance past one grant's exp, then the oldest unreferenced one goes.
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

test('seeded chaos: rotations racing bearer minting, delivery and inspection never break recorded links or honour a superseded bearer', async t => {
 await forEachSeed(10,async random=>{
  const {controller:c,deliver}=await account(t),link=await c.createContactLink(owner,'person',linkInput),k0=headerOf(metaOf(link.url)).kid,minted=[];
  const scheduler=createScheduler(random),ports=scheduler.wrap({
   rotate:()=>rotate(c,random.chance(0.7)),
   mint:async()=>{const bearer=await c.endpoints.mintDelivery(link.url);minted.push(bearer.token);return bearer;},
   verify:async()=>{const token=minted.at(-1);return token?c.endpoints.verifyDelivery(token):null;},
   inspect:()=>c.endpoints.inspect(link.url),
   deliver:()=>deliver({url:link.url}),
  },'account');
  const work=random.shuffle([()=>ports.rotate(),()=>ports.rotate(),()=>ports.mint(),()=>ports.mint(),()=>ports.verify(),()=>ports.inspect(),()=>ports.deliver(),()=>ports.mint().then(()=>ports.verify())]);
  const results=await scheduler.run(work);
  for(const result of results)if(result.status==='rejected')assert.equal(result.reason?.code,'unauthorized',`only a superseded bearer may fail: ${result.reason?.code} ${scheduler.trace.join(' | ')}`);
  assert.equal((await c.endpoints.inspect(link.url)).form,'link','the recorded link survives every schedule');
  const current=(await c.signingKey(owner)).kid,history=(await c.identityKeyHistory(owner,{purpose:'signing'})).map(k=>k.kid);
  assert.ok(history.includes(k0),'the referenced retired key was never pruned');
  for(const token of minted){const kid=headerOf(token).kid;assert.ok(history.includes(kid),'minted only under a registry key');
   if(kid===current)assert.ok(await c.endpoints.verifyDelivery(token));else await assert.rejects(c.endpoints.verifyDelivery(token),code('unauthorized'));}
  const fresh=await c.endpoints.mintDelivery(link.url);assert.equal(headerOf(fresh.token).kid,current);assert.ok(await c.endpoints.verifyDelivery(fresh.token));
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
