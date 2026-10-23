import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {createAppEngine,perform,read,AppQuery} from '../packages/app/engine.mjs';
import {memoryAudit} from '../packages/app/providers.mjs';
import {fakeClock,seededRandom,createRandom} from '../packages/app/memory-providers.mjs';
import {MembershipService} from '../packages/orgs/memberships.mjs';
import {ORG_RECORD} from '../packages/orgs/organizations.mjs';
import {accountActor} from '../packages/orgs/authority.mjs';
import {principalKey,memberPowers,effectiveAuthority,effectiveMethods,memberResourceProjection,organizationFederationPort} from '../packages/orgs/grants.mjs';
import {organizationsProvider,ORG_OPERATIONS,ORG_SYSTEM_OPERATIONS} from '../packages/app/domains/orgs.mjs';
import {forEachSeed,createScheduler} from './helpers/chaos.mjs';
const ISS='https://orgs.example',ORG='dddddddd-dddd-4ddd-8ddd-dddddddddddd',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',C='cccccccc-cccc-4ccc-8ccc-cccccccccccc',DAY=86400000;
const p=sub=>({iss:ISS,sub}),OPS=Object.fromEntries([...ORG_OPERATIONS,...ORG_SYSTEM_OPERATIONS].map(O=>[O.operation,O]));
async function world(seed=1){
 const metadata=new SqliteMetadata(':memory:'),clock=fakeClock(100*DAY),random=seededRandom(createRandom(seed)),flag={on:true};await metadata.put('owner',ORG);
 const service=new MembershipService({metadata,clock,random,issuer:ISS,flags:{for:()=>({enabled:()=>flag.on})}}),engine=createAppEngine({providers:{clock,random,audit:memoryAudit({clock}),organizations:organizationsProvider(service)}});
 await perform(engine,new OPS['orgs.initialize']({actor:{kind:'system',owner:ORG},input:{request:'test-request-00001',creator:p(A),name:'Acme',plan:{source:'test',plan:'test'}}}));
 const act=(sub,extra={})=>({kind:'owner',owner:ORG,principal:p(sub),entity:{kind:'organization',id:ORG},powers:[],authTime:clock.now(),epoch:0,aep:0,addedUnder:{kid:'identity-key',publicKey:{kty:'EC'},certificationKid:null,authentication:'same-host-session'},...extra});
 // Deliberately bypass adapter serial gates: transactions must enforce live powers even with stale actors.
 const run=(op,sub,input={},extra={})=>{const action=new OPS[op]({actor:sub==='system'?{kind:'system',owner:ORG}:act(sub,extra),input});return action instanceof AppQuery?read(engine,action):perform(engine,action);};
 const record=()=>metadata.get(ORG_RECORD),member=async sub=>(await record()).memberships[principalKey(p(sub))];
 const join=async(sub,grants=[])=>{const invite=await run('orgs.invite',A,{invitee:p(sub),grants});await run('orgs.accept',sub,{invitation:invite.invitation},{addedUnder:{kid:'identity-key',publicKey:{kty:'EC'},certificationKid:'cert-key'}});return member(sub);};
 return {metadata,service,engine,clock,flag,act,run,record,member,join,close:async()=>{await engine.dispose();metadata.close();}};
}
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code);
test('ORG-2 bound invitations, single consumption, stable membership IDs and provenance',async()=>{const w=await world();try{
 await rejects(w.run('orgs.invite',A,{grants:[{power:'admin'}]}),'invalid_invitation');
 const i=await w.run('orgs.invite',A,{invitee:p(B),grants:[]});await rejects(w.run('orgs.accept',C,{invitation:i.invitation}),'invitation_invalid');
 await w.run('orgs.accept',B,{invitation:i.invitation},{addedUnder:{kid:'key-one',publicKey:{kty:'EC'},certificationKid:'cert-one'}});const first=await w.member(B);assert.equal(first.addedUnder.kid,'key-one');await rejects(w.run('orgs.accept',B,{invitation:i.invitation}),'invitation_invalid');
 await w.run('orgs.member-context',B,{client:'https://app.example'});await w.run('orgs.leave',B);const r=await w.record();assert.equal(r.memberOutbox.filter(e=>e.type==='member-removed').length,1);assert.equal((await w.member(B)).state,'ended');
 const second=await w.join(B);assert.equal(first.id,second.id);assert.ok(second.generation>first.generation);
 await rejects(w.run('orgs.members',C),'not_found');
 }finally{await w.close();}});
test('ORG-2 delay, subject first, explicit elevation, no timeout decisions and last-admin guard',async()=>{const w=await world();try{
 await rejects(w.run('orgs.leave',A),'owner_must_be_member');const b=await w.join(B,[{power:'admin'}]);assert.deepEqual(memberPowers(b,w.clock.now()),[]);w.clock.advance(3*DAY);assert.deepEqual(memberPowers(await w.member(B),w.clock.now()),['admin']);
 const {request:q}=await w.run('orgs.member-grants',A,{membership:b.id,grants:[],reason:'Reduce authority'});
 await rejects(w.run('orgs.decide-grants',A,{request:q.id,decision:'accept'}),'invalid_decision');await rejects(w.run('orgs.decide-grants',A,{request:q.id,decision:'elevate'}),'invalid_decision');
 await w.run('orgs.decide-grants',B,{request:q.id,decision:'reject'});await w.run('orgs.decide-grants',A,{request:q.id,decision:'elevate'});w.clock.advance(400*DAY);await w.run('orgs.membership-sweep','system');assert.equal((await w.record()).grantRequests[q.id].state,'elevated');
 await rejects(w.run('orgs.decide-grants',A,{request:q.id,decision:'accept'}),'tight_verification_required');
 await w.run('orgs.decide-grants',B,{request:q.id,decision:'accept'});assert.deepEqual((await w.member(B)).grants,[]);
 await rejects(w.run('orgs.member-grants',A,{membership:(await w.member(A)).id,grants:[]}),'last_admin');w.clock.advance(1000*1000);await rejects(w.run('orgs.member-grants',A,{membership:b.id,grants:[{power:'admin'}],reason:'Restore'}),'bound_invitation_required');
 }finally{await w.close();}});
test('ORG-2 response period is configurable, owner accepts with trusted tight verification',async()=>{const w=await world();try{
 const b=await w.join(B,[{power:'admin'}]);w.clock.advance(3*DAY);await w.run('orgs.membership-policy',A,{responsePeriodMs:DAY});const {request:q}=await w.run('orgs.remove-member',A,{membership:b.id,reason:'Offboarding'});w.clock.advance(DAY);await w.run('orgs.decide-grants',A,{request:q.id,decision:'elevate'});
 await w.run('orgs.decide-grants',A,{request:q.id,decision:'accept'},{verification:{enrolledAt:0,securityChangedAt:0,stepUpAt:w.clock.now()}});assert.equal((await w.member(B)).state,'ended');
 }finally{await w.close();}});
test('ORG-2 reset holds are epoch bound; self cannot reconfirm; notices can be objected to',async()=>{const w=await world();try{
 const b=await w.join(B,[{power:'admin'}]);w.clock.advance(3*DAY);await w.service.observeAuthority(p(B),{aep:1});assert.deepEqual(memberPowers(await w.member(B),w.clock.now()),[]);
 await rejects(w.service.observeAuthority(p(B),{aep:0}),'authority_epoch_stale');await rejects(w.run('orgs.reconfirm',B,{membership:b.id,aep:1,decision:'approve'}),'invalid_decision');
 await w.run('orgs.reconfirm',B,{membership:b.id,aep:1,decision:'notice'});await w.run('orgs.reconfirm',A,{membership:b.id,aep:1,decision:'object'});w.clock.advance(4*DAY);await w.run('orgs.membership-sweep','system');assert.ok((await w.member(B)).hold);
 await w.service.observeAuthority(p(B),{aep:2});await rejects(w.run('orgs.reconfirm',A,{membership:b.id,aep:1,decision:'approve'}),'authority_epoch_stale');await w.run('orgs.reconfirm',A,{membership:b.id,aep:2,decision:'approve'});assert.equal((await w.member(B)).hold,null);
 await w.service.observeAuthority(p(A),{aep:1});await rejects(w.run('orgs.rename',A,{name:'Attacker'}),'not_found');
 }finally{await w.close();}});
test('ORG-2 expiry sweep and flag ramp-down preserve leave and cleanup',async()=>{const w=await world();try{
 const i=await w.run('orgs.invite',A,{invitee:p(B),grants:[],expiresAt:w.clock.now()+1000});w.clock.advance(1000);await rejects(w.run('orgs.accept',B,{invitation:i.invitation}),'invitation_invalid');await w.run('orgs.membership-sweep','system');assert.equal((await w.record()).invitations[i.invitation].state,'expired');
 await w.join(B);w.flag.on=false;await rejects(w.run('orgs.invite',A,{grants:[]}),'not_found');await w.run('orgs.leave',B);assert.equal((await w.member(B)).state,'ended');
 }finally{await w.close();}});
test('ORG-2 seeded concurrent invitations, removals, elevations, last-admin races and resets',async()=>forEachSeed(12,async random=>{const w=await world(random.seed);try{
 const scheduler=createScheduler(random),original=w.service.metadata;w.service.metadata=scheduler.wrap(original,'org-store');
 const invitations=await scheduler.run([()=>w.run('orgs.invite',A,{invitee:p(B),grants:[{power:'admin'}]}),()=>w.run('orgs.invite',A,{invitee:p(C),grants:[{power:'admin'}]})]);assert.ok(invitations.every(r=>r.status==='fulfilled'));
 const accepted=await scheduler.run(invitations.map((r,i)=>()=>w.run('orgs.accept',i?C:B,{invitation:r.value.invitation})));assert.ok(accepted.every(r=>r.status==='fulfilled'));w.clock.advance(3*DAY);
 const a=await w.member(A),b=await w.member(B),c=await w.member(C);const requests=await scheduler.run([()=>w.run('orgs.remove-member',A,{membership:b.id,reason:'Offboard B'}),()=>w.run('orgs.remove-member',A,{membership:c.id,reason:'Offboard C'})]);assert.ok(requests.every(r=>r.status==='fulfilled'));
 w.clock.advance(7*DAY);const elevation=await scheduler.run(requests.map(r=>()=>w.run('orgs.decide-grants',A,{request:r.value.request.id,decision:'elevate'})));assert.ok(elevation.every(r=>r.status==='fulfilled'));
 await scheduler.run([()=>w.run('orgs.decide-grants',B,{request:requests[0].value.request.id,decision:'accept'}),()=>w.run('orgs.decide-grants',C,{request:requests[1].value.request.id,decision:'accept'}),()=>w.run('orgs.member-grants',A,{membership:a.id,grants:[]}),()=>w.service.observeAuthority(p(B),{aep:2}),()=>w.service.observeAuthority(p(B),{aep:1})]);
 assert.equal((await w.member(A)).state,'live');const r=await w.record();assert.ok(Object.values(r.memberships).some(m=>memberPowers(m,w.clock.now()).includes('admin')));
 w.service.metadata=original;
 }finally{await w.close();}}));
test('ORG-3 pure intersection, expiry, generation and projection privacy',()=>{
 const member={state:'live',grants:[{resource:'r',methods:{c:['read','write','delete']},expires_at:20},{power:'admin'}]},input={member,application:{c:['read','write']},resource:{id:'r',contracts:{c:['read','delete']}},connections:[{state:'connected',generation:1,expectedGeneration:1}],now:10000};
 assert.deepEqual(effectiveAuthority(input),{c:['read']});assert.deepEqual(effectiveMethods(input),['read']);assert.deepEqual(memberResourceProjection(input,{id:'scoped-r'}),{id:'scoped-r',contracts:['c'],effective_methods:['read']});assert.deepEqual(effectiveAuthority({...input,now:20000}),{});assert.deepEqual(effectiveAuthority({...input,connections:[{state:'disconnected'}]}),{});assert.deepEqual(effectiveAuthority({...input,imported:{c:[]}}),{});assert.deepEqual(effectiveAuthority({...input,member:{...member,hold:{aep:2}}}),{c:['read']},'holds affect governance, not resources');
});
test('ORG-2 engine ports, existing-member admin invitations, muted requests, expiry and outbox retries',async()=>{const w=await world();try{
 const b=await w.join(B),i=await w.run('orgs.invite',A,{invitee:p(B),grants:[{power:'admin'}]});await w.run('orgs.accept',B,{invitation:i.invitation});assert.equal((await w.member(B)).id,b.id);w.clock.advance(3*DAY);
 await w.run('orgs.mute-requests',B,{requester:p(A),muted:true});const {request:q}=await w.run('orgs.remove-member',A,{membership:b.id,reason:'Remove'});assert.equal(q.subjectRejected,true);await w.run('orgs.decide-grants',A,{request:q.id,decision:'elevate'});await w.run('orgs.decide-grants',A,{request:q.id,decision:'retract'});
 const lookup=await w.run('orgs.member-lookup','system',{principal:p(B)});assert.equal(lookup.id,b.id);await w.run('orgs.observe-authority','system',{principal:p(B),aep:1});assert.ok((await w.member(B)).hold);
 const snapshot=await w.run('orgs.member-snapshot','system',{principal:p(B),membership_id:b.id,generation:b.generation,client:'https://app.example'});assert.equal(snapshot.member.id,b.id);await rejects(w.run('orgs.member-snapshot','system',{principal:p(C),membership_id:b.id,generation:b.generation}),'not_found');
 const invite=await w.run('orgs.invite',A,{invitee:p(C),grants:[],expires_at:Math.floor(w.clock.now()/1000)+1});await w.run('orgs.accept',C,{invitation:invite.invitation});await w.run('orgs.member-context',C,{client:'https://app.example'});w.clock.advance(1000);await w.run('orgs.membership-sweep','system');assert.equal((await w.member(C)).state,'ended');
 let attempts=0;w.service.memberEvents=async()=>++attempts>1;await w.run('orgs.member-outbox-drain','system');assert.ok((await w.record()).memberOutbox.some(e=>!e.deliveredAt));await w.run('orgs.member-outbox-drain','system');assert.ok((await w.record()).memberOutbox.every(e=>e.deliveredAt));
 const rows=[...(await w.metadata.list({prefix:'org/audit/'})).values()];for(let n=1;n<rows.length;n++)assert.equal(rows[n].previous,rows[n-1].hash);
 }finally{await w.close();}});
test('ORG-2 signed invitation uses the common envelope and only accepts its exact signed proposal',async()=>{const w=await world();try{
 const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);w.service.invitationSigner=async()=>({alg:'ES256',kid:'invitation-key',privateKey:key.privateKey});const i=await w.run('orgs.invite',A,{invitee:p(B),grants:[]});
 const {parseLinkMeta,verifyLinkSignature}=await import('../packages/links/envelope.mjs');const parsed=parseLinkMeta(i.meta);assert.equal(parsed.claims.type,i.type);assert.equal(parsed.claims.aud,ISS+'/identity/'+ORG);assert.deepEqual(parsed.claims.invitee,p(B));assert.equal(await verifyLinkSignature(crypto,parsed,{alg:'ES256',publicJwk:await crypto.subtle.exportKey('jwk',key.publicKey)}),true);
 await rejects(w.run('orgs.accept',B,{invitation:i.invitation}),'invitation_invalid');await rejects(w.run('orgs.accept',B,{invitation:i.meta+'x'}),'invitation_invalid');await w.run('orgs.accept',B,{invitation:i.meta});
 }finally{await w.close();}});
test('ORG-3 authority query and pure evaluator obey every randomized ceiling',async()=>{await forEachSeed(32,async random=>{
 const methods=['get','put','delete','list'],subset=()=>methods.filter(()=>random.chance(.5)),member={state:'live',grants:[{resource:'r',methods:{c:subset()}}]},application={c:subset()},resource={id:'r',contracts:{c:subset()}},imported={c:subset()},out=effectiveAuthority({member,application,resource,imported,now:0});for(const m of out.c??[])assert.ok(member.grants[0].methods.c.includes(m)&&application.c.includes(m)&&resource.contracts.c.includes(m)&&imported.c.includes(m));
 });const w=await world();try{const b=await w.join(B,[{resource:'r',methods:{c:['get']}}]);const input={membership:b.id,generation:b.generation,application:{c:['get','put']},resource:{id:'r',contracts:{c:['get','put']}}};assert.deepEqual(await w.run('orgs.member-authority',A,input),{c:['get']});assert.equal((await w.run('orgs.members',A)).members.length,2);assert.deepEqual(await w.run('orgs.member-authority',A,{...input,generation:999}),{});}finally{await w.close();}});
test('ORG-2 non-GM changes are immediate even for admins; self narrowing and future no-operator guards',async()=>{const w=await world();try{
 const b=await w.join(B,[{power:'admin'}]);w.clock.advance(3*DAY);assert.deepEqual(await w.run('orgs.member-grants',A,{membership:b.id,grants:[{power:'admin'},{resource:'r',methods:{c:['get','put']}}]}),{changed:true});assert.equal(Object.keys((await w.record()).grantRequests).length,0);
 await w.run('orgs.member-grants',B,{membership:b.id,grants:[{power:'admin'},{resource:'r',methods:{c:['get']}}]});assert.deepEqual((await w.member(B)).grants.find(g=>g.resource==='r').methods,{c:['get']});
 const {request:q}=await w.run('orgs.member-grants',A,{membership:b.id,reason:'Time-bound admin',grants:[{power:'admin',expires_at:Math.floor(w.clock.now()/1000)+1000}]});await w.run('orgs.decide-grants',B,{request:q.id,decision:'accept'});await rejects(w.run('orgs.member-grants',A,{membership:(await w.member(A)).id,grants:[]}),'last_admin');w.clock.advance(1000*1000);await rejects(w.run('orgs.member-grants',A,{membership:b.id,grants:[{power:'admin'}],reason:'Restore'}),'bound_invitation_required');
 }finally{await w.close();}});
test('ORG-2 seeded duplicate invitation acceptance consumes exactly one proposal for one origin principal',async()=>forEachSeed(12,async random=>{const w=await world(random.seed);try{
 const scheduler=createScheduler(random),original=w.service.metadata;w.service.metadata=scheduler.wrap(original,'org-store');const proposed=await scheduler.run([()=>w.run('orgs.invite',A,{invitee:p(B),grants:[{resource:'r',methods:{c:['get']}}]}),()=>w.run('orgs.invite',A,{invitee:p(B),grants:[{resource:'r',methods:{c:['put']}}]})]);assert.ok(proposed.every(r=>r.status==='fulfilled'));
 const results=await scheduler.run(proposed.map(r=>()=>w.run('orgs.accept',B,{invitation:r.value.invitation})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'invitation_invalid');assert.equal(Object.values((await w.record()).invitations).filter(i=>i.state==='accepted').length,1);assert.equal((await w.member(B)).generation,1);w.service.metadata=original;
 }finally{await w.close();}}));
// Security review regressions (organizations phase A, findings M1, M2, M3, L1).
const tight=w=>({verification:{enrolledAt:0,securityChangedAt:0,stepUpAt:w.clock.now()}});
test('review M1: response period floor is one day; lowering notifies admins and applies only to new requests',async()=>{const w=await world();try{
 const b=await w.join(B,[{power:'admin'}]);w.clock.advance(3*DAY);
 for(const responsePeriodMs of [0,1,DAY-1,-1])await rejects(w.run('orgs.membership-policy',A,{responsePeriodMs}),'invalid_request');
 const {request:old}=await w.run('orgs.member-grants',A,{membership:b.id,grants:[{power:'admin'},{resource:'r',methods:{c:['m']}}].slice(1),reason:'Before the change'});
 const outbox=(await w.record()).memberOutbox.length;
 await w.run('orgs.membership-policy',A,{responsePeriodMs:DAY});
 const r=await w.record(),notice=r.memberOutbox.slice(outbox).find(e=>e.type==='member-response-period-lowered');
 assert.ok(notice,'admins are notified when the period is lowered');assert.deepEqual(new Set(notice.recipients),new Set([(await w.member(A)).id,b.id]));
 assert.equal(r.grantRequests[old.id].elevateAt,old.createdAt+7*DAY,'requests created before the change keep the old period');
 await w.run('orgs.membership-policy',A,{responsePeriodMs:2*DAY});assert.equal((await w.record()).memberOutbox.filter(e=>e.type==='member-response-period-lowered').length,1,'raising does not notify as lowering');
 await w.run('orgs.membership-policy',A,{responsePeriodMs:DAY});
 const {request:q}=await w.run('orgs.remove-member',A,{membership:b.id,reason:'purge'});
 await rejects(w.run('orgs.decide-grants',A,{request:q.id,decision:'elevate'}),'invalid_decision');
 await rejects(w.run('orgs.decide-grants',A,{request:q.id,decision:'accept'},tight(w)),'invalid_decision');
 assert.equal((await w.member(B)).state,'live','the subject cannot be removed at t+0 without a chance to respond');
 w.clock.advance(DAY);await w.run('orgs.decide-grants',A,{request:q.id,decision:'elevate'});await w.run('orgs.decide-grants',A,{request:q.id,decision:'accept'},tight(w));assert.equal((await w.member(B)).state,'ended');
 }finally{await w.close();}});
test('review M2: a held owner cannot reject through mute, and mute requires fresh authentication',async()=>{const w=await world();try{
 await w.join(B,[{power:'admin'}]);const c=await w.join(C,[{power:'admin'}]),d=await w.join('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',[{power:'admin'}]);w.clock.advance(3*DAY);
 const {request:q}=await w.run('orgs.remove-member',B,{membership:c.id,reason:'rogue admin C'});
 await w.run('orgs.decide-grants',C,{request:q.id,decision:'reject'});await w.run('orgs.decide-grants',B,{request:q.id,decision:'elevate'});
 await rejects(w.run('orgs.mute-requests',A,{requester:p(B),muted:true},{authTime:0}),'reauthentication_required');
 assert.equal((await w.record()).grantRequests[q.id].state,'elevated');
 await w.service.observeAuthority(p(A),{aep:1});assert.ok((await w.member(A)).hold);
 await rejects(w.run('orgs.decide-grants',A,{request:q.id,decision:'reject'},{aep:1}),'authority_held');
 await rejects(w.run('orgs.mute-requests',A,{requester:p(B),muted:true},{aep:1,authTime:0}),'reauthentication_required');
 await w.run('orgs.mute-requests',A,{requester:p(B),muted:true},{aep:1});
 const r=await w.record();assert.equal(r.grantRequests[q.id].state,'elevated','held owner mute closes nothing');assert.ok(r.memberships[principalKey(p(A))].mutedRequesters.some(x=>x.sub===B),'the preference is recorded');
 // The recorded preference does not auto-reject later elevations while the owner is still held.
 const {request:q2}=await w.run('orgs.remove-member',B,{membership:d.id,reason:'second'});w.clock.advance(7*DAY);await w.run('orgs.decide-grants',B,{request:q2.id,decision:'elevate'});
 assert.equal((await w.record()).grantRequests[q2.id].state,'elevated');
 }finally{await w.close();}});
test('review M3: membership operations honour the deletion fence; exit paths stay open',async()=>{const w=await world();try{
 const b=await w.join(B,[{resource:'r1',methods:{c:['m']}}]),i=await w.run('orgs.invite',A,{invitee:p(C),grants:[]});
 await w.run('orgs.schedule-deletion',A,{});
 for(const scheduled of [true,false]){
  if(!scheduled){w.clock.advance(31*DAY);await w.run('orgs.tick','system');assert.equal((await w.record()).state,'deletion-due');}
  await rejects(w.run('orgs.invite',A,{invitee:p(C),grants:[]}),'organization_deletion_pending');
  await rejects(w.run('orgs.accept',C,{invitation:i.invitation}),'organization_deletion_pending');
  await rejects(w.run('orgs.member-grants',A,{membership:b.id,grants:[{resource:'r2',methods:{c:['m']}}]}),'organization_deletion_pending');
  await rejects(w.run('orgs.membership-policy',A,{responsePeriodMs:DAY}),'organization_deletion_pending');
  await rejects(w.run('orgs.member-context',B,{client:'https://app.example'}),'organization_deletion_pending');
  await rejects(w.run('orgs.remove-member',A,{membership:b.id,reason:'x'}),'organization_deletion_pending');
 }
 await w.run('orgs.mute-requests',B,{requester:p(A),muted:true});
 await w.run('orgs.leave',B);assert.equal((await w.member(B)).state,'ended','members can still exit');
 }finally{await w.close();}});
test('review L1: a held sole admin does not block a not-yet-effective admin from leaving',async()=>{const w=await world();try{
 await w.join(B,[{power:'admin'}]);await w.service.observeAuthority(p(A),{aep:1});
 await w.run('orgs.leave',B);assert.equal((await w.member(B)).state,'ended');
 }finally{await w.close();}});
