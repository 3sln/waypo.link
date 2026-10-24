// Red-team round 3, links (DEVLOG 2026-10-23 "Links, Beam, device and directory wargame fixes"): L1 limiter oracle,
// L3 beam redemption index, L4 revoked app-link growth, L5 tombstone collection, and two plausible findings (owner GET
// of an unknown contact, quarantine read inside the redemption transaction).
import test from 'node:test';
import assert from 'node:assert/strict';
import application from '../packages/runtime/http.mjs';
import {CONTACT_LINK_TYPE,MESSAGING_CONTACT_LINK_TYPE} from '../packages/links/types.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {MemoryMessagingStore} from '../packages/messaging/index.mjs';
import {IdentityKeyRegistry} from '../packages/identity/keys.mjs';
import {LinkService} from '../packages/links/issuance.mjs';
import {fakeClock} from './helpers/chaos.mjs';
import {key as recordKey} from '../packages/core/records.mjs';
import {collectLinkState,DEAD_PARENT_HOLD_MS} from '../packages/links/audience.mjs';
import {key} from '../packages/messaging/store.mjs';

const ORIGIN='https://provider.example',OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',PEER='cccccccc-cccc-4ccc-8ccc-cccccccccccc',DAY=86400000;
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
function controller(t){
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());
 const c=new AccountController({metadata:db,gate:new SerialGate(),blobs:{put:async()=>{},get:async()=>null,delete:async()=>{}},archives:{},config:{APP_ORIGIN:ORIGIN,KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')},sql:db.sql});
 return {db,c};
}
async function owned(t){const f=controller(t);await f.c.touch(OWNER);f.c.config.IDENTITY_ACCOUNT=async()=>({status:'active',handle:'person'});return f;}
const link=(c,ttl=3600000)=>c.createContactLink(OWNER,'person',{name:'beam',mimeTypes:['text/plain'],expiresAt:Date.now()+ttl,maxMessages:5});

// L1: the caller's own budgets run before the identity lookup, so a limited caller gets 429 whatever the target.
{
 const ACTIVE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',SUSPENDED='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const forged=(handle,sub,data)=>{const jti=crypto.randomUUID(),aud=`${ORIGIN}/users/${handle}/contact/${jti}`,now=Math.floor(Date.now()/1000);
  const meta=`${b64({alg:'ES256',kid:'k',typ:'bindle-link-meta+jwt'})}.${b64({bindle:'link-meta',v:1,type:CONTACT_LINK_TYPE,iss:ORIGIN,aud,jti,iat:now,exp:now+3600,sub})}.${Buffer.alloc(64,1).toString('base64url')}`;
  return `${aud}?bindle_meta=${meta}${data?`&bindle_data=${data}`:''}`;};
 const identities={[ACTIVE]:{id:ACTIVE,status:'active',handle:'person'},[SUSPENDED]:{id:SUSPENDED,status:'suspended',handle:'gone'}};
 const environment=consume=>({APP_ORIGIN:ORIGIN,ABUSE_HASH_KEY:'k',ABUSE:{consume},IDENTITY_REPOSITORY:{get:async id=>identities[id]??null},ACCOUNTS:{get:()=>({invoke:async()=>({$fault:{code:'link_invalid',status:401}})})}});
 for(const accept of ['application/vnd.bindle.contact-profile+json','application/json']){
  test(`L1: rate-limited ${accept} answers do not reveal whether the named identity is active`,async()=>{
   const env=environment(async()=>false),send=url=>application.fetch(new Request(url,{headers:{Accept:accept,'CF-Connecting-IP':'198.51.100.7'}}),env);
   const a=await send(forged('person',ACTIVE)),s=await send(forged('gone',SUSPENDED)),u=await send(forged('nobody',crypto.randomUUID()));
   assert.equal(a.status,429);assert.equal(s.status,a.status,`active ${a.status} vs suspended ${s.status}`);assert.equal(u.status,a.status,`active ${a.status} vs unknown ${u.status}`);
  });
 }
 test('L1: the claimed-principal link-audience limit also runs before the identity lookup',async()=>{
  const operations=[];const env=environment(async input=>{const op=JSON.stringify(input);operations.push(op);return !op.includes('link-audience');});
  const data=`${b64({alg:'ES256',kid:'k',typ:'bindle-link-data+jwt'})}.${b64({iss:'https://other.example',sub:crypto.randomUUID()})}.${Buffer.alloc(64,1).toString('base64url')}`;
  const send=url=>application.fetch(new Request(url,{headers:{Accept:'application/json','CF-Connecting-IP':'198.51.100.8'}}),env);
  const a=await send(forged('person',ACTIVE,data)),u=await send(forged('nobody',crypto.randomUUID(),data));
  assert.equal(a.status,429);assert.equal(u.status,a.status);
 });
}

// L3: permission() finds a peer's binding through the peer-keyed index, however many other bindings exist.
test('L3: a redeemed beam-enabled contact keeps permission when the owner has more than 1,000 bindings',async t=>{
 const {db,c}=await owned(t),l=await link(c);
 await c.beamContacts.enable(OWNER,l.id,{beamEnabled:true});await c.beamContacts.redeem(OWNER,l.url,PEER);
 assert.deepEqual(await c.beamContacts.permission(OWNER,PEER),{kind:'contact',id:l.id});
 await db.transaction(async tx=>{for(let i=0;i<1000;i++){const id=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;await tx.put('beam/redeemed/'+id,{peer:crypto.randomUUID(),grantId:id,owner:OWNER,expiresAt:Date.now()+3600000});}});
 assert.deepEqual(await c.beamContacts.permission(OWNER,PEER),{kind:'contact',id:l.id});
 await assert.rejects(c.beamContacts.permission(OWNER,crypto.randomUUID()),{code:'beam_contact_required'});
});

// Plausible: quarantine is read inside the redemption transaction, not from the pre-transaction inspection snapshot.
test('redemption does not persist a binding for a link quarantined after inspection',async t=>{
 const {db,c}=await owned(t),l=await link(c),inspect=c.beamContacts.endpoints.inspect.bind(c.beamContacts.endpoints);
 c.beamContacts.endpoints={inspect:async url=>{const result=await inspect(url);await c.quarantineContact(OWNER,l.id,true);return result;}};
 const binding=await c.beamContacts.redeem(OWNER,l.url,PEER);assert.equal(binding.peer,PEER);
 assert.equal(await db.get('beam/redeemed/'+l.id),undefined,'a binding was persisted for a link quarantined before the transaction');
 assert.equal((await db.list({prefix:'beam/redeemed-peer/'})).size,0);
});

// Plausible: an owner read of an unknown contact is a 404 fault, never a plain Error (500).
test('an owner URL read of an unknown contact is not_found 404',async t=>{
 const {c}=await owned(t);await assert.rejects(c.contactURL(OWNER,crypto.randomUUID()),error=>error.status===404&&error.code==='not_found');
});

// L4: revoked app-declared links are purged past PURGE_AFTER on every issue, even far below the cap.
test('L4: revoked app links are reclaimed after the 30-day retention even when the owner never reaches the cap',async()=>{
 const clock=fakeClock(1800000000000),store=new MemoryMessagingStore(),registry=new IdentityKeyRegistry({store,clock:clock.now,seal:v=>structuredClone(v),open:v=>v});
 await registry.ensure(OWNER,'signing');
 const service=new LinkService({store,issuer:'https://3sln.example',keys:registry,clock:clock.now,maxLinks:10,signingKey:o=>registry.privateKey(o,'signing')});
 const claims={resource:'parent-1',kinds:['one-off'],mimeTypes:['text/plain'],maxMessages:5,maxBytes:65536,maxMessageBytes:16384};
 const issue=()=>service.issue(OWNER,{type:MESSAGING_CONTACT_LINK_TYPE,claims,expiresAt:clock.now()+DAY,handle:'alice'},{kind:'app',clientId:'https://box.example/app'});
 for(let day=0;day<40;day++){for(let i=0;i<5;i++){const {jti}=await issue();await service.revoke(OWNER,jti);}clock.advance(DAY);}
 const rows=await store.transaction(async tx=>(await tx.list(recordKey('link'))).length);
 assert.ok(rows<=31*5,`${rows} link records kept; revoked records older than 30 days must be reclaimed below the cap`);
 // Records inside the retention window are still listed (list/changes contract unchanged).
 assert.ok((await service.list(OWNER,{limit:100})).links.length>0);
});

// L5: a tombstone carries the reclaimed parent's signed exp and is collected once exp (plus skew) has passed.
test('L5: a tombstone is collected once the reclaimed parent could no longer verify on expiry alone',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,13,12)});
 const {db,c}=await owned(t);
 // Parents live 300 days, so their signed exp is still ahead when they are reclaimed after revocation.
 for(let i=0;i<20;i++){const l=await link(c,300*DAY);await c.revokeContact(OWNER,l.id);}
 t.mock.timers.tick(DEAD_PARENT_HOLD_MS+1000);await collectLinkState(c,OWNER);
 assert.equal((await db.list({prefix:key('contact-grant')})).size,0);
 const stones=[...(await db.list({prefix:key('contact-grant-tombstone')})).values()];
 assert.equal(stones.length,20);assert.ok(stones.every(row=>Number.isSafeInteger(row.exp)),'tombstones record the signed exp');
 await collectLinkState(c,OWNER);assert.equal((await db.list({prefix:key('contact-grant-tombstone')})).size,20,'a tombstone whose parent could still verify is kept');
 t.mock.timers.tick(400*DAY);for(let i=0;i<3;i++)await collectLinkState(c,OWNER);
 assert.equal((await db.list({prefix:key('contact-grant-tombstone')})).size,0);
});
