// packages/signaling/turn.mjs and packages/signaling/relay-credentials.mjs: the TURN adapter and the relay credential lifecycle
// kept from Beam (wargame round 3 D1/D2 and review follow-ups) as building blocks for the built-in ice-relay resource (signaling §16.7; DEVLOG 2026-10-26).
// Ported from the deleted tests/beam-turn-lifecycle.test.mjs and tests/beam-ice-retry.test.mjs; renamed from
// rtc-relay-credentials.test.mjs for signaling rev 3.2 (packages/signaling, RtcError renamed TurnError).
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {CloudflareTurnAdapter,TurnError,TURN_MAX_TTL_SECONDS} from '../packages/signaling/turn.mjs';
import {issueRelayCredentials,revokeRelayCredentials,sweepRelayCredentials,RELAY_LEASE_MS,RELAY_MAX_ISSUES,RELAY_RESERVATION_FACTOR} from '../packages/signaling/relay-credentials.mjs';

test('TURN adapter uses the real credential endpoint, a short TTL and validates the response without leaking secrets',async()=>{
 let call;const adapter=new CloudflareTurnAdapter({keyId:'key_example',apiToken:'server-secret',fetch:async(url,options)=>{call={url,options};return new Response(JSON.stringify({iceServers:[{urls:['turn:turn.cloudflare.com:3478?transport=udp'],username:'short',credential:'temporary'}]}),{status:201});}});
 const result=await adapter.issue({ttl:120});assert.equal(result.expiresIn,120);assert.equal(call.options.headers.Authorization,'Bearer server-secret');assert.deepEqual(JSON.parse(call.options.body),{ttl:120});assert(call.url.endsWith('/key_example/credentials/generate-ice-servers'));assert(!JSON.stringify(result).includes('server-secret'));
 await assert.rejects(()=>adapter.issue({ttl:TURN_MAX_TTL_SECONDS+1}),e=>e instanceof TurnError&&e.name==='TurnError'&&e.code==='turn_unconfigured'&&e.status===503,'TurnError (renamed from RtcError)');
 const hostile=new CloudflareTurnAdapter({keyId:'k',apiToken:'t',fetch:async()=>new Response(JSON.stringify({iceServers:[{urls:['turn:attacker.example:3478'],username:'u',credential:'c'}]}),{status:201})});
 await assert.rejects(()=>hostile.issue(),{code:'turn_invalid'});
 let revoked;const revoker=new CloudflareTurnAdapter({keyId:'k',apiToken:'t',fetch:async url=>{revoked=String(url);return new Response(null,{status:204});}});await revoker.revoke('user/1');assert(revoked.endsWith('/credentials/user%2F1/revoke'));
 await assert.rejects(()=>new CloudflareTurnAdapter({keyId:'k',apiToken:'t',fetch:async()=>new Response(null,{status:500})}).revoke('u'),{code:'turn_unavailable'});
});

const PATH='sig/session/s1';
let counter=0;
function mockTurn({failRevoke=()=>false,failIssue=()=>false}={}){const issued=[],revoked=[];return {issued,revoked,issue:async({ttl})=>{if(failIssue())throw Object.assign(new Error('provider down'),{code:'turn_unavailable'});const username='user-'+(++counter);issued.push(username);return {iceServers:[{urls:['turn:turn.cloudflare.com:3478?transport=udp'],username,credential:'c'}],expiresIn:ttl};},revoke:async username=>{if(failRevoke(username))throw new Error('revoke failed');revoked.push(username);}};}
function budgetLog(overrides={}){const events=[];return {events,reserve:async input=>{events.push(['reserve',input.maxBytes]);return {enforced:true};},commit:async()=>{events.push(['commit']);},release:async()=>{events.push(['release']);},...overrides};}
async function fixture(t,{lifetime=900000}={}){
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());let offset=0;const now=()=>Date.now()+offset;
 await db.put(PATH,{id:'s1',state:'accepted',expiresAt:now()+lifetime,relay:{},relayReserved:0});
 const check=record=>{if(record.state!=='accepted')throw Object.assign(new Error('closed'),{code:'session_closed'});};
 return {db,now,advance:ms=>{offset+=ms;},check,issue:(leg,adapter,budget,bytes=72)=>issueRelayCredentials({store:db,path:PATH,leg,bytes,check,budget,adapter,now})};
}

test('credentials are recorded per leg and revoked when the session ends',async t=>{
 const f=await fixture(t),turn=mockTurn(),budget=budgetLog();
 for(const leg of ['initiator','recipient'])assert.equal((await f.issue(leg,turn,budget)).issued.iceServers[0].username,turn.issued.at(-1));
 assert.equal(turn.issued.length,2);
 await f.db.transaction(async tx=>{const r=await tx.get(PATH);r.state='ended';await tx.put(PATH,r);});
 assert.deepEqual(await revokeRelayCredentials({store:f.db,path:PATH,adapter:turn,now:f.now}),{pending:0,retryAt:null});
 assert.deepEqual(turn.revoked.sort(),[...turn.issued].sort());
 await assert.rejects(f.issue('initiator',turn,budget),{code:'session_closed'});
});

test('a live credential cannot be re-issued; after expiry a re-issue revokes the old username and takes a new reservation',async t=>{
 const f=await fixture(t),turn=mockTurn(),budget=budgetLog();
 const first=await f.issue('initiator',turn,budget);await assert.rejects(f.issue('initiator',turn,budget),{code:'relay_already_issued'});
 f.advance((first.issued.expiresIn+1)*1000);const second=await f.issue('initiator',turn,budget);
 assert.equal(budget.events.filter(([e])=>e==='reserve').length,2);assert.deepEqual(turn.revoked,[turn.issued[0]],'the expired username is revoked on re-issue');
 const raw=await f.db.get(PATH);assert.ok(second.issued.expiresIn*1000<=raw.expiresAt-f.now()+1000,'a credential never outlives the session');
 assert.deepEqual(raw.relay.initiator.usernames.map(u=>u.username),[turn.issued[1]]);
 for(let i=0;i<RELAY_MAX_ISSUES;i++){f.advance(301000);await f.issue('initiator',turn,budget).catch(()=>{});}
 assert.ok(turn.issued.length<=RELAY_MAX_ISSUES,`${turn.issued.length} issues for one leg`);
});

test('a failed revocation is kept for the sweep, which retries it once the session is over',async t=>{
 const f=await fixture(t);let failing=true;const turn=mockTurn({failRevoke:()=>failing}),budget=budgetLog();
 await f.issue('initiator',turn,budget);await f.db.transaction(async tx=>{const r=await tx.get(PATH);r.state='ended';await tx.put(PATH,r);});
 const first=await revokeRelayCredentials({store:f.db,path:PATH,adapter:turn,now:f.now});assert.equal(first.pending,1);assert.ok(first.retryAt>f.now());
 assert.equal((await f.db.get(PATH)).relay.initiator.usernames.length,1,'an unrevoked username is kept for the sweep');
 failing=false;const swept=await sweepRelayCredentials({store:f.db,prefix:'sig/session/',adapter:turn,terminal:r=>r.state==='ended',now:f.now});
 assert.deepEqual(swept,{swept:1,retryAt:null});assert.deepEqual(turn.revoked,turn.issued);assert.equal((await f.db.get(PATH)).relay.initiator.usernames.length,0);
 // An expired username whose revocation keeps failing is dropped: the credential is dead anyway.
 failing=true;f.advance(0);await f.db.transaction(async tx=>{const r=await tx.get(PATH);r.relay.initiator.usernames=[{username:'dead',expiresAt:f.now()-1}];await tx.put(PATH,r);});
 assert.equal((await revokeRelayCredentials({store:f.db,path:PATH,adapter:turn,now:f.now})).pending,0);
});

test('a crash mid-issuance leaves only a lease, never a permanent issuing marker',async t=>{
 const f=await fixture(t),turn=mockTurn(),budget=budgetLog();
 await f.db.transaction(async tx=>{const r=await tx.get(PATH);r.relay.initiator={state:'issuing',at:f.now(),count:1,usernames:[]};r.relay.recipient='issuing';await tx.put(PATH,r);});
 await assert.rejects(f.issue('initiator',turn,budget),{code:'relay_already_issued'});
 f.advance(RELAY_LEASE_MS+1000);assert.ok((await f.issue('initiator',turn,budget)).issued);
 assert.ok((await f.issue('recipient',turn,budget)).issued,'the bare pre-round-3 marker is not a wedge');
});

test('a transient provider failure releases the reservation and returns the leg to idle; an unfunded reservation does too',async t=>{
 const f=await fixture(t);let failing=true;const turn=mockTurn({failIssue:()=>failing}),budget=budgetLog();
 await assert.rejects(f.issue('initiator',turn,budget),{code:'turn_unavailable'});
 assert.deepEqual(budget.events.map(([e])=>e),['reserve','release']);
 const raw=await f.db.get(PATH);assert.deepEqual(raw.relay.initiator,{state:'idle',count:0,usernames:[]});assert.equal(raw.relayReserved,0);
 failing=false;assert.ok((await f.issue('initiator',turn,budget)).issued);await assert.rejects(f.issue('initiator',turn,budget),{code:'relay_already_issued'});
 const unfunded=budgetLog({reserve:async()=>({enforced:false})});await assert.rejects(f.issue('recipient',turn,unfunded),{code:'relay_unfunded'});
 assert.equal((await f.db.get(PATH)).relay.recipient.state,'idle');
});

test('the reservation is kept when credentials that could not be recorded also cannot be revoked',async t=>{
 const f=await fixture(t),turn=mockTurn({failRevoke:()=>true}),budget=budgetLog({commit:async()=>{budget.events.push(['commit']);throw new Error('commit failed');}});
 await assert.rejects(f.issue('initiator',turn,budget));
 assert.deepEqual(budget.events.map(([e])=>e),['reserve','commit'],'a reservation backing still-usable credentials must not be released');
 const raw=await f.db.get(PATH);assert.deepEqual(raw.relay.initiator.usernames.map(u=>u.username),[turn.issued[0]]);assert.equal(raw.relayReserved,72);
});

test('the total reservation of one session is capped across legs and re-issues',async t=>{
 const f=await fixture(t),turn=mockTurn(),budget=budgetLog();
 for(let round=0;round<4;round++){for(const leg of ['initiator','recipient'])await f.issue(leg,turn,budget).catch(error=>assert.ok(['relay_limit','relay_session_expired'].includes(error.code),error.code));f.advance(301000);}
 const reserved=budget.events.filter(([e])=>e==='reserve').map(([,b])=>b);assert.ok(reserved.reduce((n,b)=>n+b,0)<=72*RELAY_RESERVATION_FACTOR,`${reserved.length} reservations`);
});

test('the success write requires the issuing lease, and the TTL is computed after the reservation',async t=>{
 const f=await fixture(t),turn=mockTurn();
 const slow=budgetLog({reserve:async()=>{f.advance(RELAY_LEASE_MS+1000);await f.db.transaction(async tx=>{const r=await tx.get(PATH);r.relay.initiator={...r.relay.initiator,at:f.now()};await tx.put(PATH,r);});return {enforced:true};}});
 await assert.rejects(f.issue('initiator',turn,slow),{code:'relay_lease_lost'});
 assert.deepEqual(turn.revoked,turn.issued,'credentials from a superseded issuance are revoked');assert.equal((await f.db.get(PATH)).relay.initiator.state,'issuing','the new lease holder keeps its marker');
 const raw=await f.db.get(PATH),late=budgetLog({reserve:async()=>{f.advance(raw.expiresAt-f.now()-100000);return {enforced:true};}});
 const issued=await f.issue('recipient',turn,late);assert.ok(issued.issued.expiresIn<=100,`credential TTL ${issued.issued.expiresIn}s exceeds the remaining ~100s`);
});
