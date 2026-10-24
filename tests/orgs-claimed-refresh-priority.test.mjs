// Wargame 2026-10-23, unconfirmed degradation (claimed-refresh starvation): request-path 'claimed' refreshes must not
// crowd out member refreshes. Member rows run before claimed rows, a rate-limited refresh is not a failed attempt (the
// member row is retried, never dropped), and the directory lets 'claimed' refreshes use at most a third of its per-site
// budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {MemoryMessagingStore} from '../packages/core/records.mjs';
import {MemberContextService,memberPrincipalKey} from '../packages/orgs/certificates.mjs';
import {enqueueMemberKeyRefresh,MEMBER_REFRESH_INDEX} from '../packages/orgs/key-refresh.mjs';
import {IdentityDirectory} from '../packages/federation/directory.mjs';
import {fakeClock} from './helpers/chaos.mjs';
import {secondIssuer} from './helpers/second-issuer.mjs';

const HOST='https://3sln.example',X='https://x.example',ORG='dddddddd-dddd-4ddd-8ddd-dddddddddddd',MEMBER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function service(t,foreign,clock){
 const metadata=new SqliteMetadata(':memory:');t.after(()=>metadata.close());
 const members={async roster(){return [];},async lookup(){return null;},async observe(){},async context(){}};
 return {metadata,service:new MemberContextService({metadata,organization:{id:ORG,identity:`${HOST}/identity/${ORG}`},issuer:HOST,members,local:null,foreign,connections:{check:async()=>false},flags:{organizations:()=>true,foreign:()=>true},foreignIssuers:[X],clock:clock.now})};
}
const row=async(metadata,principal)=>{const key=await metadata.get(MEMBER_REFRESH_INDEX+memberPrincipalKey(principal));return typeof key==='string'?metadata.get(key):undefined;};
test('a rate-limited member refresh is retried with its attempts unchanged, never dropped',async t=>{
 const clock=fakeClock(1800000000000);let limited=true,calls=0;
 const foreign={resolve:async()=>null,needsRefresh:async()=>true,refresh:async()=>{calls++;if(limited)throw Object.assign(new Error('limited'),{code:'rate_limited'});return true;}};
 const {metadata,service:s}=service(t,foreign,clock),who={iss:X,sub:MEMBER};
 await metadata.transaction(tx=>enqueueMemberKeyRefresh(tx,who,{now:clock.now()}));
 for(let i=0;i<8;i++){await s.refreshDue();clock.advance(61000);}
 const kept=await row(metadata,who);assert.ok(kept,'the member row survives repeated rate limiting');assert.equal(kept.attempts,0);assert.ok(calls>=8);
 limited=false;await s.refreshDue();assert.equal(await row(metadata,who),undefined,'it completes once the budget allows');
});
test('member rows run before request-path claimed rows in the same due batch',async t=>{
 const clock=fakeClock(1800000000000),order=[];
 const foreign={resolve:async()=>null,needsRefresh:async()=>true,refresh:async({subject,source})=>{order.push([subject,source]);return true;}};
 const {metadata,service:s}=service(t,foreign,clock),claimed={iss:X,sub:crypto.randomUUID()};
 await metadata.transaction(tx=>enqueueMemberKeyRefresh(tx,claimed,{now:clock.now()-1000,source:'claimed'}));
 await metadata.transaction(tx=>enqueueMemberKeyRefresh(tx,{iss:X,sub:MEMBER},{now:clock.now()}));
 await s.refreshDue({limit:2});
 assert.deepEqual(order.map(([sub])=>sub),[MEMBER,claimed.sub]);assert.equal(order[1][1],'claimed');
});
test('the directory gives claimed refreshes at most a third of the per-site budget',async()=>{
 const clock=fakeClock(1800000000000),second=await secondIssuer({origin:X,clock:clock.now});
 const directory=new IdentityDirectory({store:new MemoryMessagingStore(),fetch:second.fetch,enabled:true,issuers:[X],clock:clock.now});
 await directory.refresh({issuer:X,subject:crypto.randomUUID()}).catch(()=>{}); // warms the manifest
 let claimed=0;for(let i=0;i<40;i++)await directory.refresh({issuer:X,subject:crypto.randomUUID(),priority:'claimed'}).then(()=>claimed++,e=>assert.equal(e.code,'rate_limited'));
 assert.ok(claimed<=10,`claimed refreshes admitted: ${claimed}`);
 const subject=crypto.randomUUID();await second.person(subject);
 assert.equal((await directory.refresh({issuer:X,subject}))?.sub,subject,'member refreshes keep the rest');
});
