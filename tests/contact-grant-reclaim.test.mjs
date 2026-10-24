// Wargame M3 (2026-10-23): revoked or expired contact parents must not count toward the 1,000-parent cap forever.
// Only active, unexpired parents count; dead parents are reclaimed (with their contact-name/ and contact-url/ rows)
// once their receipts and replay fences pass retainUntil, and the parent ID is tombstoned.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {collectDeadParents,collectLinkState,DEAD_PARENT_HOLD_MS} from '../packages/links/audience.mjs';
import {key} from '../packages/messaging/store.mjs';
import {authored} from './link-helpers.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function account(t){
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());const stored=new Map();
 const blobs={put:async(k,b)=>{stored.set(k,new Uint8Array(b));},get:async k=>stored.has(k)?{arrayBuffer:async()=>stored.get(k).buffer}:null,delete:async k=>stored.delete(k)};
 const c=new AccountController({metadata:db,gate:new SerialGate(),blobs,archives:{},config:{APP_ORIGIN:'https://provider.example',KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')},sql:db.sql});
 await c.touch(OWNER);c.config.IDENTITY_ACCOUNT=async()=>({status:'active',handle:'person'});
 const make=(expiresAt=Date.now()+3600000)=>c.createContactLink(OWNER,'person',{name:'rotate',mimeTypes:['text/plain'],expiresAt,maxMessages:5});
 return {c,db,make};
}

test('revoked contact links stop counting toward the active-parent cap',{timeout:600000},async t=>{
 const {c,make}=await account(t);
 // Fill the store directly to keep the test fast: 1,000 revoked parents plus one active one.
 const first=await make();
 await c.metadata.transaction(async tx=>{const grant=await tx.get(key('contact-grant',first.id));for(let i=0;i<1000;i++){const id=crypto.randomUUID();await tx.put(key('contact-grant',id),{...grant,id,active:false,revokedAt:Date.now(),claims:{...grant.claims,jti:id}});}});
 await assert.doesNotReject(make(),'revoked parents still count toward the cap');
 // Active parents still count: fill to 1,000 live parents and the next one is refused.
 await c.metadata.transaction(async tx=>{const grant=await tx.get(key('contact-grant',first.id));for(let i=0;i<998;i++){const id=crypto.randomUUID();await tx.put(key('contact-grant',id),{...grant,id,claims:{...grant.claims,jti:id}});}});
 await assert.rejects(make(),{code:'grant_limit'});
});

test('a dead parent is reclaimed only after its receipts pass retainUntil, then is tombstoned and never verifies',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,13,12)});
 // Links outlive the test's clock advance, so only revocation and reclamation can stop them verifying.
 const {c,db,make}=await account(t),link=await make(Date.now()+30*86400000),keep=await make(Date.now()+30*86400000);
 const m=await authored(input=>c.authorLinkEnvelope(OWNER,input),link.url,{text:'before revocation'});
 await c.deliverLink(OWNER,{url:link.url},{envelope:m.envelope,body:m.body});
 assert.ok((await db.list({prefix:key('contact-delivery-receipt',OWNER,link.id)})).size);
 await assert.doesNotReject(c.endpoints.inspect(link.url));const original=await db.get(key('contact-grant',link.id));
 await c.revokeContact(OWNER,link.id);
 const rows=async()=>({grant:await db.get(key('contact-grant',link.id)),name:await db.get(`contact-name/${link.id}`),url:await db.get(`contact-url/${link.id}`),receipts:(await db.list({prefix:key('contact-delivery-receipt',OWNER,link.id)})).size,tombstone:await db.get(key('contact-grant-tombstone',link.id))});
 await collectDeadParents(c,OWNER);
 assert.ok((await rows()).grant,'a freshly revoked parent is kept through the receipt retention window');
 t.mock.timers.tick(DEAD_PARENT_HOLD_MS-60000);
 await collectDeadParents(c,OWNER,{now:Date.now()});assert.ok((await rows()).grant,'reclaimed before the hold elapsed');
 t.mock.timers.tick(120000);
 // Receipt retention is max(admittedAt, createdAt+24h)+48h, which also elapses at the same moment here.
 const result=await collectDeadParents(c,OWNER,{now:Date.now()});
 const after=await rows();
 assert.equal(result.reclaimed,1);assert.equal(after.grant,undefined);assert.equal(after.name,undefined);assert.equal(after.url,undefined);assert.equal(after.receipts,0);assert.ok(after.tombstone);
 assert.ok(await db.get(key('contact-grant',keep.id)),'an active parent is untouched');
 // Even if the parent row were restored, the tombstoned ID never verifies again.
 await assert.rejects(c.endpoints.inspect(link.url));
 await db.put(key('contact-grant',link.id),original);
 await assert.rejects(c.endpoints.inspect(link.url),'a tombstoned parent verified again');
});

test('an expired parent is reclaimed after the hold by the alarm link-state sweep',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,13,12)});
 const {c,db,make}=await account(t),link=await make(Date.now()+60000);
 t.mock.timers.tick(60000+DEAD_PARENT_HOLD_MS+1000);
 await collectLinkState(c,OWNER);
 assert.equal(await db.get(key('contact-grant',link.id)),undefined);assert.ok(await db.get(key('contact-grant-tombstone',link.id)));
});

test('dead parents still count toward a hard stored-row bound until reclaimed',async t=>{
 const {c,make}=await account(t);const first=await make();
 const {MAX_STORED_GRANTS}=await import('../packages/messaging/contact-tokens.mjs');assert.equal(MAX_STORED_GRANTS,2000);
 await c.metadata.transaction(async tx=>{const grant=await tx.get(key('contact-grant',first.id));for(let i=0;i<MAX_STORED_GRANTS-1;i++){const id=crypto.randomUUID();await tx.put(key('contact-grant',id),{...grant,id,active:false,revokedAt:Date.now(),claims:{...grant.claims,jti:id}});}});
 await assert.rejects(make(),{code:'grant_limit'},'revoked rows are unbounded again');
});

test('the dead-parent sweep reclaims a large backlog in few alarm runs',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,13,12)});
 const {c,db,make}=await account(t),first=await make(Date.now()+30*86400000);
 await c.metadata.transaction(async tx=>{const grant=await tx.get(key('contact-grant',first.id));for(let i=0;i<300;i++){const id=crypto.randomUUID();await tx.put(key('contact-grant',id),{...grant,id,active:false,revokedAt:Date.now(),claims:{...grant.claims,jti:id}});}});
 t.mock.timers.tick(DEAD_PARENT_HOLD_MS+1000);
 for(let i=0;i<6;i++)await collectLinkState(c,OWNER);
 assert.equal((await db.list({prefix:key('contact-grant')})).size,1,'backlog not reclaimed in six runs');
});

test('replay purge and developer daily cleanup reach parents beyond the first 1,001 rows',async t=>{
 const {c,db}=await account(t),{cleanupDailyDeveloperGrants}=await import('../packages/runtime/developer-contact.mjs');
 const late='ffffffff-ffff-4fff-8fff-ffffffffffff',daily='fffffffe-ffff-4fff-8fff-ffffffffffff',past=Math.floor(Date.now()/1000)-60;
 await db.transaction(async tx=>{for(let i=0;i<1100;i++){const id=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;await tx.put(key('contact-grant',id),{id,owner:OWNER,active:true,claims:{exp:past+86400*30}});}
  await tx.put(key('contact-grant',late),{id:late,owner:OWNER,active:true,claims:{exp:past+86400*30},endpoint:{claims:{audience:{policy:'x'}}}});
  await tx.put(`link-replay/${late}/e/${String(Date.now()-1000).padStart(16,'0')}/h`,{hash:'h',principal:'p',expiresAt:Date.now()-1000});await tx.put(`link-replay/${late}/count`,1);
  await tx.put(key('contact-grant',daily),{id:daily,owner:OWNER,active:true,internalKind:'developer-contact/v1',claims:{exp:past}});});
 for(let i=0;i<25;i++)await collectLinkState(c,OWNER);
 assert.equal((await db.list({prefix:`link-replay/${late}/e/`})).size,0,'replay rows of a late parent were never purged');
 let cleaned=0;for(let i=0;i<12&&!cleaned;i++)cleaned=await cleanupDailyDeveloperGrants(c,OWNER);
 assert.equal(cleaned,1);assert.equal(await db.get(key('contact-grant',daily)),undefined);
});
