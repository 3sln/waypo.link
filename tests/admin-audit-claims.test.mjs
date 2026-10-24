// Wargame 4 admin follow-ups (owned with ORG-12d): (a) audit reads are rate limited and the full chain walk is boot-only;
// (b) claims and reservations are paged in the overview, finished claims are pruned after a grace period (their audit
// entries stay), and an administrator's outstanding claims are capped. Each test fails when its fix is reverted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {adminDeletionFixture} from './helpers/admin-deletion.mjs';
import {claimFixture} from './helpers/admin-claims.mjs';
import {CLAIM_LIMITS} from '../packages/identity/admin.mjs';

const DAY=86400000;

test('(a) audit reads are charged to the 300-per-10-minutes read window without growing the audit; verify:true is boot-only',async t=>{
 const f=await adminDeletionFixture();t.after(()=>f.close());
 await assert.rejects(f.admin.audit({verify:true},f.context),{code:'verify_boot_only'});
 const head=(await f.store.get('audit-head'))?.seq??0;let served=0;
 for(let i=0;i<301;i++){try{await f.admin.audit({},f.context);served++;}catch(e){assert.equal(e.code,'rate_limited');break;}}
 assert.equal(served,300,'the 301st read is refused');assert.equal((await f.store.get('audit-head'))?.seq??0,head,'reads write no audit entry');
 f.clock.advance(600001);await f.identity.stepUpBegin({},f.context);await f.identity.stepUp({method:'passkey',response:{id:'passkey',ok:true}},f.context);
 assert.equal((await f.admin.audit({},f.context)).verified.valid,true,'the page read is still verified (checkpointed)');
});

test('(a) boot may walk the whole chain, inside the same read window',async t=>{
 const f=claimFixture();t.after(()=>f.close());const b=await f.boot();
 assert.equal((await f.admin.audit({verify:true},b)).verified.valid,true);
 let served=1;for(let i=0;i<300;i++){try{await f.admin.audit({verify:true},b);served++;}catch(e){assert.equal(e.code,'rate_limited');break;}}
 assert.equal(served,300);
});

test('(b) every outstanding claim is reachable through overview paging, and runtime reservations page too',async t=>{
 const f=claimFixture();t.after(()=>f.close());const b=await f.boot();const nonces=[];
 for(let i=0;i<101;i++){if(i%25===0&&i){f.clock.advance(600001);await f.stepUp(b);}const name='staff-'+String(i).padStart(3,'0');await f.admin.reserve({name},b);nonces.push((await f.admin.mintClaim({name,hours:168},b)).nonce);}
 const first=await f.admin.overview({},b);assert.equal(first.claims.length,100);assert.ok(first.claimsNext);assert.equal(first.reservations.runtime.length,100);assert.ok(first.reservationsNext);
 const second=await f.admin.overview({claimsAfter:first.claimsNext,reservationsAfter:first.reservationsNext},b);
 assert.deepEqual(new Set([...first.claims,...second.claims].map(c=>c.nonce)),new Set(nonces));assert.equal(second.claimsNext,null);assert.equal(second.reservations.runtime.length,1);
 await assert.rejects(f.admin.overview({claimsAfter:'nope'},b),{code:'invalid_request'});
});

test('(b) finished claims are pruned after expiry plus grace, keeping their audit entries; redeemed claims are never pruned',async t=>{
 const f=claimFixture();t.after(()=>f.close());let b=await f.boot();
 for(const name of ['gone-revoked','gone-expired','kept-redeemed','kept-live'])await f.admin.reserve({name},b);
 const revoked=(await f.admin.mintClaim({name:'gone-revoked',hours:1},b)).nonce;await f.admin.revokeClaim({nonce:revoked},b);
 const expired=(await f.admin.mintClaim({name:'gone-expired',hours:1},b)).nonce,redeemed=(await f.admin.mintClaim({name:'kept-redeemed',hours:1},b)).nonce;
 const row=await f.store.get('claim/'+redeemed),{revision,...value}=row;await f.store.commit({expect:{['claim/'+redeemed]:revision},writes:{['claim/'+redeemed]:{...value,redeemedAt:f.clock.now()}}});
 f.clock.advance(CLAIM_LIMITS.PRUNE_GRACE_MS-DAY);b=await f.boot();await f.admin.mintClaim({name:'kept-live',hours:168},b);
 assert.ok(await f.store.get('claim/'+revoked),'not before the grace period ends');
 f.clock.advance(2*DAY);b=await f.boot();await f.admin.reserve({name:'trigger'},b);await f.admin.mintClaim({name:'trigger',hours:1},b);
 assert.equal(await f.store.get('claim/'+revoked),null);assert.equal(await f.store.get('claim/'+expired),null);assert.equal(await f.store.get('claim-name/gone-expired'),null);
 assert.ok(await f.store.get('claim/'+redeemed),'a redeemed claim is provenance and stays');
 const audit=(await f.store.list('audit/',{limit:100})).map(r=>r.value);
 assert.ok(audit.some(e=>e.action==='claim.prune'&&e.before.nonce===revoked));assert.ok(audit.some(e=>e.action==='claim.revoke'&&e.target==='gone-revoked'),'earlier audit entries stay');
 assert.equal((await f.store.verifyAudit()).valid,true);
});

test('(b) an administrator can hold at most 20 outstanding claims; boot is not capped',async t=>{
 const f=claimFixture();t.after(()=>f.close());let b=await f.boot();const ADMIN='12345678-1234-4234-8234-123456789abc',actor=f.admin.actor.bind(f.admin);
 f.admin.actor=async(context,read)=>context.actor==='test-admin'?{kind:'admin',owner:ADMIN,rate:'admin-'+ADMIN,expect:{},audit:{kind:'admin',owner:ADMIN,handle:'n.1234'}}:actor(context,read);
 const admin=f.ctx({actor:'test-admin'});
 for(let i=0;i<=CLAIM_LIMITS.OUTSTANDING_PER_ADMIN;i++){const name='cap-'+String(i).padStart(3,'0');await f.admin.reserve({name},b);if(i<CLAIM_LIMITS.OUTSTANDING_PER_ADMIN)await f.admin.mintClaim({name,hours:24},admin);else await assert.rejects(f.admin.mintClaim({name,hours:24},admin),{code:'claims_outstanding_limit'});}
 f.clock.advance(600001);await f.stepUp(b);await f.admin.mintClaim({name:'cap-020',hours:24},b);
 f.clock.advance(25*3600000);b=await f.boot();await f.admin.reserve({name:'cap-021'},b);await f.admin.mintClaim({name:'cap-021',hours:24},admin);
});
