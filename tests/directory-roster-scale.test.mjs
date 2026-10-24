// Wargame 2026-10-23 F5 (provisional): foreign member keys are cache-only on the request path and capped at 300 s, so
// the directory scales its per-site budget and cache with the roster (MemberContextService discovery reports the size)
// and members are refreshed ahead of expiry (less than half the freshness left). 200 members at one foreign issuer stay
// verifiable at every instant of the steady state.
import test from 'node:test';
import assert from 'node:assert/strict';

const {SqliteMetadata}=await import('../apps/node/resources.mjs');
const {MemoryMessagingStore}=await import('../packages/core/records.mjs');
const {createAppEngine,perform}=await import('../packages/app/engine.mjs');
const {memoryAudit}=await import('../packages/app/providers.mjs');
const {IdentityDirectory}=await import('../packages/federation/directory.mjs');
const {MemberContextService,memberContextProvider,directoryIssuerKeys,cachedIssuerKeys,memberPrincipalKey,MemberKeyRefresh}=await import('../packages/orgs/certificates.mjs');
const {fakeClock}=await import('../tests/helpers/chaos.mjs');
const {secondIssuer}=await import('../tests/helpers/second-issuer.mjs');
const HOST='https://3sln.example',ORG='dddddddd-dddd-4ddd-8ddd-dddddddddddd',AUD=`${HOST}/identity/${ORG}`;
test('an organization with 200 members at one foreign issuer keeps them all verifiable',async()=>{
 const clock=fakeClock(1800000000000),second=await secondIssuer({clock:clock.now});
 const directory=new IdentityDirectory({store:new MemoryMessagingStore(),fetch:second.fetch,enabled:true,issuers:[second.origin],clock:clock.now});
 const metadata=new SqliteMetadata(':memory:'),subs=Array.from({length:200},()=>crypto.randomUUID());for(const s of subs)await second.person(s);
 const roster=subs.map(sub=>({iss:second.origin,sub}));
 const members={async roster(){return roster.map(p=>({...p}));},async lookup(p){return roster.some(r=>memberPrincipalKey(r)===memberPrincipalKey(p))?{id:'m'.repeat(20),generation:1,aep:0}:null;},async observe(){},async context(){}};
 const service=new MemberContextService({metadata,organization:{id:ORG,identity:AUD},issuer:HOST,members,local:cachedIssuerKeys({metadata,issuer:HOST,read:async()=>null,clock:clock.now}),foreign:directoryIssuerKeys(directory),connections:{check:async()=>true},flags:{organizations:()=>true,foreign:()=>true},foreignIssuers:[second.origin],clock:clock.now});
 const engine=createAppEngine({providers:{clock:{now:clock.now},random:{uuid:()=>crypto.randomUUID()},audit:memoryAudit({clock:{now:clock.now}}),memberContext:memberContextProvider(service)}});
 let worst=Infinity,margin=Infinity;
 for(let t=0;t<30*60000;t+=5000){clock.advance(5000);await perform(engine,new MemberKeyRefresh({actor:{kind:'system',owner:ORG}})).catch(()=>{});
  if(t>15*60000){let warm=0;for(const s of subs){const e=directory.cache.get(second.origin+'\n'+s);if(e?.document&&e.until>clock.now())warm++;if(e?.document)margin=Math.min(margin,e.until-clock.now());}worst=Math.min(worst,warm);}}
 
 assert.equal(worst,200);
 // Refresh-ahead: members are refetched well before expiry, not at the instant it lapses (discovery jitter margin).
 assert.ok(margin>=30000,`least freshness left in the steady state: ${margin} ms`);
});
