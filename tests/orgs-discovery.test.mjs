// ORG-5 engine APIs: the member's own view, role-filtered grant-management requests, the organization-context power
// check, and person discovery. Every organization call is resolved with the production ORG-0 `accountActor`, exactly as
// AccountController#orgsDispatch does, against real MembershipService writers over SQLite. Disclosure tests compare
// refusals byte for byte: a non-member, an ended member, a member of another organization and an unknown organization
// must be indistinguishable (ORG-D9).
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {createAppEngine,perform,read,AppQuery} from '../packages/app/engine.mjs';
import {memoryAudit} from '../packages/app/providers.mjs';
import {fakeClock,seededRandom,createRandom} from '../packages/app/memory-providers.mjs';
import {MembershipService,requestDecisions} from '../packages/orgs/memberships.mjs';
import {ORG_RECORD,ORG_JOINED_LIMIT} from '../packages/orgs/organizations.mjs';
import {readOrganization,loadOrganization} from '../packages/orgs/roster.mjs';
import {accountActor,personActor} from '../packages/orgs/authority.mjs';
import {principalKey} from '../packages/orgs/grants.mjs';
import {organizationsProvider,ORG_OPERATIONS,ORG_SYSTEM_OPERATIONS} from '../packages/app/domains/orgs.mjs';
import {OrganizationDiscovery,organizationDiscoveryProvider,DiscoverOrganizations,AcceptOrganizationInvitation,LeaveOrganizationEverywhere} from '../packages/orgs/discovery.mjs';
import {AppFault} from '../packages/app/faults.mjs';
import {forEachSeed,createScheduler} from './helpers/chaos.mjs';

const ISS='https://orgs.example',DAY=86400000;
const ORG1='d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',ORG2='d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',GHOST='d9d9d9d9-d9d9-4d9d-8d9d-d9d9d9d9d9d9';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',C='cccccccc-cccc-4ccc-8ccc-cccccccccccc',D='dddddddd-dddd-4ddd-8ddd-dddddddddddd',E='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OPS=Object.fromEntries([...ORG_OPERATIONS,...ORG_SYSTEM_OPERATIONS].map(O=>[O.operation,O]));
const p=sub=>({iss:ISS,sub});
const refusal=async promise=>{try{await promise;}catch(error){return {code:error.code,status:error.status,message:error.message};}assert.fail('expected a refusal');};

/** One account single writer (an organization or a person) behind the production actor resolution. */
async function writer({owner,clock,seed,flag,org=null}){
 const metadata=new SqliteMetadata(':memory:');await metadata.put('owner',owner);
 const service=new MembershipService({metadata,clock,random:seededRandom(createRandom(seed)),issuer:ISS,flags:{for:()=>({enabled:()=>flag.on})}});
 const engine=createAppEngine({providers:{clock,random:seededRandom(createRandom(seed+1)),audit:memoryAudit({clock}),organizations:organizationsProvider(service)}});
 const run=operation=>operation instanceof AppQuery?read(engine,operation):perform(engine,operation);
 if(org)await run(new OPS['orgs.initialize']({actor:{kind:'system',owner},input:{request:'discovery-request-'+String(seed).padStart(4,'0'),creator:p(org.creator),name:org.name,plan:{source:'test',plan:'test'}}}));
 // The same steps as AccountController#orgsDispatch: resolve inside the writer, never trust caller powers.
 const dispatch=async(operation,requested,input)=>{const Operation=OPS[operation];if(!Operation)throw new AppFault('not_found','Not found.',404);const actor=await accountActor({owner,requested,Operation,issuer:ISS,organization:principal=>loadOrganization(metadata,[principal])});return run(new Operation({actor,...input===undefined?{}:{input:structuredClone(input)}}));};
 return {owner,metadata,service,engine,run,dispatch,record:()=>readOrganization(metadata),close:async()=>{await engine.dispose();metadata.close();}};
}

async function world(seed=1,{orgs=[[ORG1,A,'Alpha'],[ORG2,E,'Beta']],people=[A,B,C,D,E]}={}){
 const clock=fakeClock(100*DAY),flag={on:true},O={},P={};
 for(const [i,[id,creator,name]]of orgs.entries())O[id]=await writer({owner:id,clock,seed:seed*100+i*7,flag,org:{creator,name}});
 for(const [i,sub]of people.entries())P[sub]=await writer({owner:sub,clock,seed:seed*100+50+i,flag});
 const request=(sub,extra={})=>({principal:p(sub),entity:{kind:'person',id:sub},authTime:clock.now(),epoch:0,aep:0,...extra});
 const as=(sub,org,extra={})=>({principal:p(sub),entity:{kind:'organization',id:org},authTime:clock.now(),epoch:0,aep:0,...extra});
 // An unknown organization id reaches a writer with no organization record: the actor resolution refuses it.
 const orgWriter=org=>O[org]??{dispatch:async(operation,requested)=>{const Operation=OPS[operation];await accountActor({owner:org,requested,Operation,issuer:ISS,organization:async()=>undefined});}};
 const ports={
  person:{candidates:r=>P[r.principal.sub].dispatch('orgs.candidates',r),remember:(r,input)=>P[r.principal.sub].dispatch('orgs.remember-membership',r,input),forget:(r,input)=>P[r.principal.sub].dispatch('orgs.forget-membership',r,input)},
  org:{membership:(org,r)=>orgWriter(org).dispatch('orgs.membership',r),accept:(org,r,input)=>orgWriter(org).dispatch('orgs.accept',{...r,addedUnder:{kid:'identity-key',publicKey:{kty:'EC'},certificationKid:null,authentication:'same-host-session'}},input),leave:(org,r,input)=>orgWriter(org).dispatch('orgs.leave',r,input)},
 };
 const discovery=new OrganizationDiscovery(ports),edge=createAppEngine({providers:{clock,random:seededRandom(createRandom(seed+999)),audit:memoryAudit({clock}),organizationDiscovery:organizationDiscoveryProvider(discovery)}});
 const person=sub=>personActor({owner:sub,iss:ISS,authTime:clock.now()});
 const discover=sub=>read(edge,new DiscoverOrganizations({actor:person(sub)}));
 const accept=(sub,org,invitation)=>perform(edge,new AcceptOrganizationInvitation({actor:person(sub),input:{org,invitation}}));
 const leave=(sub,org)=>perform(edge,new LeaveOrganizationEverywhere({actor:person(sub),input:{org}}));
 const invite=async(org,by,sub,grants=[])=>(await O[org].dispatch('orgs.invite',as(by,org),{invitee:p(sub),grants})).invitation;
 const join=async(org,by,sub,grants=[])=>{await accept(sub,org,await invite(org,by,sub,grants));return (await O[org].record()).memberships[principalKey(p(sub))];};
 return {clock,flag,O,P,request,as,ports,discovery,discover,accept,leave,invite,join,orgWriter,close:async()=>{await edge.dispose();for(const w of [...Object.values(O),...Object.values(P)])await w.close();}};
}
const verified=w=>({verification:{stepUpAt:w.clock.now(),enrolledAt:w.clock.now()-8*DAY,securityChangedAt:w.clock.now()-31*DAY}});

test('ORG-5 membership view: the member sees only their own record, without other members\' provenance',async()=>{const w=await world();try{
 const b=await w.join(ORG1,A,B,[{resource:'https://orgs.example/r/1',methods:{'https://contract.example/v1':['get']}}]);
 const view=await w.O[ORG1].dispatch('orgs.membership',w.as(B,ORG1));
 assert.equal(view.membership.id,b.id);assert.deepEqual(view.powers,[]);assert.equal(view.organization.name,'Alpha');assert.equal(view.organization.ownerOfRecord,false);
 assert.equal(JSON.stringify(view).includes(A),false,'no grantor or other member principal reaches a plain member');
 assert.equal(view.membership.grants[0].grantedBy,undefined);assert.equal(typeof view.membership.grants[0].grantedAt,'number');
 const owner=await w.O[ORG1].dispatch('orgs.membership',w.as(A,ORG1));assert.equal(owner.organization.ownerOfRecord,true);assert.deepEqual(owner.powers,['admin','owner-of-record']);
 // A plain member still cannot read the admin surfaces.
 assert.equal((await refusal(w.O[ORG1].dispatch('orgs.get',w.as(B,ORG1)))).code,'not_found');
 assert.equal((await refusal(w.O[ORG1].dispatch('orgs.members',w.as(B,ORG1)))).code,'not_found');
 // The flag gates exposure of the view (leave stays open; covered by the ORG-2 tests).
 w.flag.on=false;assert.equal((await refusal(w.O[ORG1].dispatch('orgs.membership',w.as(B,ORG1)))).code,'not_found');
 }finally{await w.close();}});

test('ORG-5 requests: subject, requester and owner each see only their requests, with exactly the decisions decide accepts',async()=>{const w=await world();try{
 const b=await w.join(ORG1,A,B,[{power:'admin'}]),c=await w.join(ORG1,A,C,[{power:'admin'}]);await w.join(ORG1,A,D);w.clock.advance(3*DAY);
 // C asks to remove B's admin grant: B is the subject, C the requester; A (owner) is not asked yet, D sees nothing.
 const {request:q}=await w.O[ORG1].dispatch('orgs.member-grants',w.as(C,ORG1),{membership:b.id,grants:[],reason:'Rotate duties'});
 const list=async sub=>(await w.O[ORG1].dispatch('orgs.requests',w.as(sub,ORG1))).requests;
 assert.deepEqual((await list(B)).map(r=>[r.id,r.roles,r.decisions]),[[q.id,['subject'],['accept','reject']]]);
 assert.deepEqual((await list(C)).map(r=>[r.roles,r.decisions]),[[['requester'],['retract']]]);
 assert.deepEqual(await list(A),[],'subject first: the owner is not asked before elevation');
 assert.deepEqual(await list(D),[],'an uninvolved member learns nothing');
 assert.equal((await list(B))[0].reason,'Rotate duties');assert.deepEqual((await list(B))[0].requester,p(C));
 // Admins still see every request through the admin listing.
 assert.equal((await w.O[ORG1].dispatch('orgs.members',w.as(A,ORG1))).requests.length,1);
 await w.O[ORG1].dispatch('orgs.decide-grants',w.as(B,ORG1),{request:q.id,decision:'reject'});
 assert.deepEqual((await list(B))[0].decisions,['accept'],'a subject may still accept after rejecting');
 assert.deepEqual((await list(C))[0].decisions,['elevate','retract']);
 await w.O[ORG1].dispatch('orgs.decide-grants',w.as(C,ORG1),{request:q.id,decision:'elevate'});
 assert.deepEqual((await list(A)).map(r=>[r.roles,r.decisions]),[[['owner'],['accept','reject']]]);
 assert.deepEqual((await list(C))[0].decisions,['retract']);
 await w.O[ORG1].dispatch('orgs.decide-grants',w.as(A,ORG1,verified(w)),{request:q.id,decision:'accept'});
 for(const sub of [A,B,C,D])assert.deepEqual(await list(sub),[],'accepted requests leave every listing');
 assert.equal((await w.O[ORG1].record()).memberships[principalKey(p(B))].grants.length,0);
 // The response period alone unlocks elevation for the requester.
 const {request:r}=await w.O[ORG1].dispatch('orgs.member-grants',w.as(A,ORG1),{membership:c.id,grants:[],reason:'Owner asks'});
 assert.deepEqual((await list(A))[0].decisions,['retract']);w.clock.advance(7*DAY);assert.deepEqual((await list(A))[0].decisions,['elevate','retract']);
 assert.deepEqual((await list(C))[0].roles,['subject']);assert.equal(r.target,c.id);
 }finally{await w.close();}});

test('ORG-5 acting authority: the single writer requires admin, and widening needs the flag and an active organization',async()=>{const w=await world();try{
 await w.join(ORG1,A,B);const check=(sub,input)=>w.O[ORG1].dispatch('orgs.acting-authority',w.as(sub,ORG1),input);
 assert.deepEqual((await check(A,{power:'admin',widen:true})).powers,['admin','owner-of-record']);
 assert.equal((await refusal(check(B,{power:'admin'}))).code,'not_found');assert.equal((await refusal(check(C,{power:'admin'}))).code,'not_found');
 assert.equal((await refusal(check(A,{power:'owner',widen:false}))).code,'invalid_request');
 // Caller-supplied powers are ignored by the resolver.
 assert.equal((await refusal(w.O[ORG1].dispatch('orgs.acting-authority',{...w.as(B,ORG1),powers:['admin']},{power:'admin'}))).code,'not_found');
 // Ramp-down: reducing operations stay available, widening ones look absent.
 w.flag.on=false;assert.equal((await check(A,{power:'admin',widen:false})).state,'active');assert.equal((await refusal(check(A,{power:'admin',widen:true}))).code,'not_found');w.flag.on=true;
 // A pending deletion refuses widening only.
 await w.O[ORG1].dispatch('orgs.schedule-deletion',w.as(A,ORG1),{});
 assert.equal((await check(A,{power:'admin',widen:false})).state,'deletion-scheduled');
 assert.equal((await refusal(check(A,{power:'admin',widen:true}))).code,'organization_deletion_pending');
 // A stale security epoch is refused once a newer one was seen.
 await check(A,{power:'admin'}).then(()=>w.O[ORG1].dispatch('orgs.acting-authority',w.as(A,ORG1,{epoch:5}),{power:'admin'}));
 assert.equal((await refusal(check(A,{power:'admin'}))).code,'authority_epoch_stale');
 }finally{await w.close();}});

test('ORG-5 M3 fence: the admin member listing is refused while deletion is pending; self view and requests still answer',async()=>{const w=await world();try{
 const b=await w.join(ORG1,A,B,[{power:'admin'}]);w.clock.advance(3*DAY);await w.O[ORG1].dispatch('orgs.member-grants',w.as(A,ORG1),{membership:b.id,grants:[],reason:'Before deletion'});
 await w.O[ORG1].dispatch('orgs.schedule-deletion',w.as(A,ORG1),{});
 assert.equal((await refusal(w.O[ORG1].dispatch('orgs.members',w.as(A,ORG1)))).code,'organization_deletion_pending');
 const view=await w.O[ORG1].dispatch('orgs.membership',w.as(A,ORG1));assert.equal(view.organization.state,'deletion-scheduled');assert.equal(typeof view.organization.deletion.notBefore,'number');
 assert.equal((await w.O[ORG1].dispatch('orgs.requests',w.as(B,ORG1))).requests.length,1);
 assert.equal((await w.O[ORG1].dispatch('orgs.get',w.as(A,ORG1))).state,'deletion-scheduled');
 await w.O[ORG1].dispatch('orgs.cancel-deletion',w.as(B,ORG1),{});assert.equal((await w.O[ORG1].dispatch('orgs.members',w.as(A,ORG1))).members.length,2);
 }finally{await w.close();}});

test('ORG-5 disclosure: a non-member, an ended member, another organization\'s member and an unknown organization are indistinguishable',async()=>{const w=await world();try{
 await w.join(ORG1,A,B);await w.join(ORG2,E,D);const ended=await w.join(ORG1,A,C);await w.O[ORG1].dispatch('orgs.leave',w.as(C,ORG1),{});assert.equal(ended.state,'live');
 for(const operation of ['orgs.membership','orgs.requests','orgs.acting-authority','orgs.get','orgs.members','orgs.audit']){
  const input=operation==='orgs.acting-authority'?{power:'admin'}:undefined;
  const ghost=await refusal(w.orgWriter(GHOST).dispatch(operation,w.as(D,GHOST),input));
  const outcomes=[await refusal(w.O[ORG1].dispatch(operation,w.as(D,ORG1),input)),await refusal(w.O[ORG1].dispatch(operation,w.as(C,ORG1),input)),await refusal(w.O[ORG1].dispatch(operation,w.as(E,ORG1),input))];
  for(const outcome of outcomes)assert.deepEqual(outcome,ghost,operation);
  assert.equal(ghost.code,'not_found');
 }
 // Discovery with invented hints: D adds ORG1 and an unknown id to its own hints; neither appears, nothing else leaks.
 await w.P[D].dispatch('orgs.remember-membership',w.request(D),{org:ORG1});await w.P[D].dispatch('orgs.remember-membership',w.request(D),{org:GHOST});
 const listed=await w.discover(D);assert.deepEqual(listed.organizations.map(o=>o.id),[ORG2]);assert.equal(JSON.stringify(listed).includes(ORG1),false);
 // Hints belong to the person: another person (or an organization actor) cannot read or write them.
 assert.equal((await refusal(w.P[D].dispatch('orgs.candidates',w.request(B)))).code,'forbidden');
 assert.equal((await refusal(w.P[D].dispatch('orgs.candidates',{principal:p(D),entity:{kind:'organization',id:D}}))).code,'not_found');
 }finally{await w.close();}});

test('ORG-5 discovery: only organization-confirmed live memberships are listed, in neutral order, and leaving forgets the hint',async()=>{const w=await world();try{
 assert.deepEqual((await w.discover(B)).organizations,[]);
 await w.join(ORG2,E,B);await w.join(ORG1,A,B,[]);
 let listed=await w.discover(B);assert.deepEqual(listed.organizations.map(o=>[o.name,o.role,o.available]),[['Alpha','member',true],['Beta','member',true]]);
 // The owner-of-record index (written by creation's confirm step) is a candidate source too.
 await w.P[A].metadata.put('orgs/owned/'+ORG1,{v:1,org:ORG1,handle:null,role:'owner-of-record',createdAt:0});
 assert.deepEqual((await w.discover(A)).organizations.map(o=>[o.id,o.role,o.powers]),[[ORG1,'owner-of-record',['admin','owner-of-record']]]);
 // Removal by an admin: the hint is stale, the organization no longer confirms it, nothing is shown.
 const b=(await w.O[ORG1].record()).memberships[principalKey(p(B))];await w.O[ORG1].dispatch('orgs.remove-member',w.as(A,ORG1),{membership:b.id});
 listed=await w.discover(B);assert.deepEqual(listed.organizations.map(o=>o.id),[ORG2]);
 // Leaving through the edge drops the hint; a second leave is a uniform not_found.
 await w.leave(B,ORG2);assert.deepEqual((await w.discover(B)).organizations,[]);assert.deepEqual((await w.P[B].dispatch('orgs.candidates',w.request(B))).joined.map(j=>j.id),[ORG1]);
 assert.equal((await refusal(w.leave(B,ORG1))).code,'not_found');assert.deepEqual((await w.P[B].dispatch('orgs.candidates',w.request(B))).joined,[],'a not_found leave also forgets the hint');
 // A transient organization failure marks the row unavailable instead of failing the whole list or hiding a membership.
 await w.join(ORG1,A,B);const failing=new OrganizationDiscovery({...w.ports,org:{...w.ports.org,membership:async()=>{throw new AppFault('temporarily_unavailable','Try again.',503);}}});
 assert.deepEqual((await failing.discover(personActor({owner:B,iss:ISS,authTime:w.clock.now()}))).organizations.map(o=>[o.id,o.available,o.name]),[[ORG1,false,null]]);
 // Only the person acting as themselves can discover.
 await assert.rejects(w.discovery.discover({kind:'owner',owner:B,entity:{kind:'organization',id:ORG1},powers:['admin']}),{code:'unauthorized'});
 // Hints are bounded per person.
 for(let i=0;i<ORG_JOINED_LIMIT+3;i++)await w.P[C].dispatch('orgs.remember-membership',w.request(C),{org:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`});
 assert.equal((await w.P[C].dispatch('orgs.candidates',w.request(C))).joined.length,ORG_JOINED_LIMIT);
 }finally{await w.close();}});

test('ORG-5 seeded chaos: every advertised decision succeeds, and listings show exactly the member\'s own roles',async()=>{
 await forEachSeed(12,async random=>{const w=await world(random.seed,{orgs:[[ORG1,A,'Alpha']],people:[A,B,C,D]});try{
  for(const sub of [B,C])await w.join(ORG1,A,sub,[{power:'admin'}]);await w.join(ORG1,A,D);w.clock.advance(3*DAY);
  const members=async()=>Object.values((await w.O[ORG1].record()).memberships).filter(m=>m.state==='live');
  let decided=0;
  for(let step=0;step<90;step++){
   const kind=random.int(9),actor=random.pick([A,B,C,D]);
   try{
    // Requests arise when an admin (or the owner) changes or removes another admin's governance grant.
    if(kind<=1){const live=await members(),admins=live.filter(m=>m.grants.some(g=>g.power==='admin')),target=random.pick(admins.length?admins:live),remove=random.chance(0.4);await w.O[ORG1].dispatch(remove?'orgs.remove-member':'orgs.member-grants',w.as(actor,ORG1),{membership:target.id,...remove?{}:{grants:[]},reason:'Chaos '+step});}
    else if(kind===2)w.clock.advance(random.int(4)*DAY);
    else if(kind===3){const others=[A,B,C,D].filter(x=>x!==actor);await w.O[ORG1].dispatch('orgs.mute-requests',w.as(actor,ORG1),{requester:p(random.pick(others)),muted:random.chance(0.5)});}
    else if(kind===4&&!(await members()).some(m=>m.principal.sub===actor)){await w.join(ORG1,A,actor,random.chance(0.5)?[{power:'admin'}]:[]);}
    else{
     // Pick an advertised decision and require it to succeed with fresh (and, for an owner, tight) verification.
     const listed=(await w.O[ORG1].dispatch('orgs.requests',w.as(actor,ORG1)).catch(e=>{if(e.code==='not_found')return {requests:[]};throw e;})).requests,choices=listed.flatMap(q=>q.decisions.map(d=>[q,d]));
     if(choices.length){const [q,decision]=random.pick(choices);await assert.doesNotReject(w.O[ORG1].dispatch('orgs.decide-grants',w.as(actor,ORG1,verified(w)),{request:q.id,decision}),`advertised ${decision} for ${q.roles}`);decided++;}
    }
   }catch(error){if(error.code==='ERR_ASSERTION')throw error;/* refused chaos steps are expected */}
   // Listing invariants against the authoritative record.
   const r=await w.O[ORG1].record(),now=w.clock.now();
   for(const sub of [A,B,C,D]){
    const own=r.memberships[principalKey(p(sub))];let listed;try{listed=(await w.O[ORG1].dispatch('orgs.requests',w.as(sub,ORG1))).requests;}catch(error){assert.equal(error.code,'not_found');assert.notEqual(own?.state,'live');continue;}
    const expected=Object.values(r.grantRequests).filter(q=>['subject','elevated'].includes(q.state)&&(q.target===own.id||q.requester.sub===sub||q.state==='elevated'&&r.ownerOfRecord.sub===sub&&Object.values(r.memberships).find(m=>m.id===q.target)?.principal.sub!==sub));
    assert.deepEqual(listed.map(q=>q.id).sort(),expected.map(q=>q.id).sort(),'listing equals the member\'s own open requests');
    for(const q of listed)assert.deepEqual(q.decisions,requestDecisions(r,r.grantRequests[q.id],p(sub),now));
   }
  }
  globalThis.__orgDecisions=(globalThis.__orgDecisions??0)+decided;
 }finally{await w.close();}});
 assert.ok(globalThis.__orgDecisions>=40,`the schedule exercised ${globalThis.__orgDecisions} advertised decisions`);
});

test('ORG-5 seeded chaos: concurrent accept, leave, remove and discover converge on the live memberships',async()=>{
 await forEachSeed(12,async random=>{const w=await world(random.seed);try{
  const scheduler=createScheduler(random),orgOf={[ORG1]:A,[ORG2]:E},ever=new Set();
  const tasks=[];
  for(const org of [ORG1,ORG2])for(const sub of [B,C]){
   const invitation=await w.invite(org,orgOf[org],sub);
   tasks.push(async()=>{try{await scheduler.wrap({accept:()=>w.accept(sub,org,invitation)},'edge').accept();ever.add(sub+org);}catch{}});
   if(random.chance(0.5))tasks.push(async()=>{try{await scheduler.wrap({leave:()=>w.leave(sub,org)},'edge').leave();}catch{}});
   if(random.chance(0.3))tasks.push(async()=>{try{const m=(await w.O[org].record()).memberships[principalKey(p(sub))];if(m)await scheduler.wrap({remove:()=>w.O[org].dispatch('orgs.remove-member',w.as(orgOf[org],org),{membership:m.id})},'org').remove();}catch{}});
  }
  for(const sub of [B,C,D])tasks.push(async()=>{const listed=await scheduler.wrap({discover:()=>w.discover(sub)},'edge').discover();for(const o of listed.organizations)assert.ok(ever.has(sub+o.id)||(await w.O[o.id].record()).memberships[principalKey(p(sub))],'never lists an organization the person did not join');});
  const results=await scheduler.run(tasks);for(const result of results)if(result.status==='rejected')throw result.reason;
  for(const sub of [B,C,D]){
   const live=[];for(const org of [ORG1,ORG2]){const m=(await w.O[org].record()).memberships[principalKey(p(sub))];if(m?.state==='live')live.push(org);}
   const listed=(await w.discover(sub)).organizations;assert.deepEqual(listed.map(o=>o.id).sort(),live.sort(),'after quiescence discovery equals the live set');
   for(const o of listed)assert.equal(o.role,'member');
  }
 }finally{await w.close();}});
});
