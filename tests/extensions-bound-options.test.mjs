// RTC-c: AMD-X1 bound consumer options (docs/spec/extensions.md §2.1 `bind`, §5.2; rtc-signaling §3.5). Engine-level
// through FederationService and its ngin operations; provisional and unsigned.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {federationMetadata} from '../packages/federation/runtime.mjs';
import {configuredArtefacts,reviewedSchemaFetcher} from '../packages/runtime/artefact-pins.mjs';
import {FederationService,NarrowBoundOptions,BoundApproval,PinGrantRequests} from '../packages/federation/service.mjs';
import {validateSlotManifest,boundSlot,validateBoundRequest,approveBoundOptions,boundCovers,narrowBoundOptions,boundVersionUsable,boundAllows,boundSchema} from '../packages/federation/extensions.mjs';
import {createAppEngine,perform,read} from '../packages/app/engine.mjs';
import {versionRecord,versionDigest} from '../packages/core/artefacts.mjs';
import {RTC_SIGNALING_SLOT,RTC_SIGNALING_SLOT_MANIFEST,RTC_BOUND_ARTEFACTS} from '../packages/rtc/extension.mjs';
import {RTC_PURPOSE_REFERENCES,validatePurpose,purposeDisclosure,REGISTERED_PURPOSES} from '../packages/rtc/purposes.mjs';
import {forEachSeed} from './helpers/chaos.mjs';

const issuer='https://provider.example',subject=issuer+'/entities/alice',authority={session:'owner'};
const A='https://a.example/client',B='https://b.example/client';
const [CALL,SCREEN,FILES,SYNC]=RTC_PURPOSE_REFERENCES.map(r=>r.artefact);
const SLOT=RTC_SIGNALING_SLOT,slotManifest=()=>structuredClone(RTC_SIGNALING_SLOT_MANIFEST);
const clients=[A,B].map(id=>({id,origin:new URL(id).origin,name:new URL(id).host,redirectUris:[new URL(id).origin+'/callback']}));
const challenge='A'.repeat(43);
// A synthetic purpose line with two versions (v2 adds a context property: additive but widening).
const TEST_LINE='https://spec.bindle.example/rtc-purposes/test-v/v1';
async function testLine(){
 const v1={...structuredClone(REGISTERED_PURPOSES[0].versions[0].body),id:TEST_LINE,context:{data:{type:'object',properties:{n:{type:'integer',minimum:0,maximum:9}},required:[]},disclosure:{categories:[],fields:{n:{title:{en:'N'},categories:[],display:'value'}}}}};
 const v2=structuredClone(v1);v2.context.data.properties.m={type:'boolean'};v2.context.disclosure.fields.m={title:{en:'M'},categories:[],display:'value'};
 const e1={version:1,prev:null,body:v1},d1=await versionDigest(versionRecord({id:TEST_LINE,kind:'rtc-purpose'},e1)),e2={version:2,prev:d1,body:v2},d2=await versionDigest(versionRecord({id:TEST_LINE,kind:'rtc-purpose'},e2));
 return {envelope:{bindle_artefact:1,id:TEST_LINE,kind:'rtc-purpose',versions:[e1,e2]},refs:[{artefact:TEST_LINE,version:1,digest:d1},{artefact:TEST_LINE,version:2,digest:d2}]};
}
async function harness(t,{bound=true,schema=slotManifest()}={}){
 const db=new SqliteMetadata(':memory:'),line=await testLine(),config={ARTEFACT_VERSIONS_ENABLED:'true',FEDERATION_SCHEMAS:{[SLOT]:schema,[TEST_LINE]:line.envelope,[TEST_LINE+'/envelope']:line.envelope}};
 const artefacts=configuredArtefacts({config,store:db});config.ARTEFACTS=artefacts;
 // The provider-held reviewed reference of the synthetic line is switchable (an operator reviewing v2).
 const held={version:1};const spec={...RTC_BOUND_ARTEFACTS[SLOT].purposes,reference:value=>value===TEST_LINE?line.refs[held.version-1]:RTC_BOUND_ARTEFACTS[SLOT].purposes.reference(value)};
 const service=new FederationService({issuer,store:federationMetadata(db),schemaHosts:['spec.bindle.example'],schemaFetcher:reviewedSchemaFetcher(config),authenticateOwner:async()=>({subject,epoch:'epoch'}),clients,boundOptions:bound,boundArtefacts:{[SLOT]:{purposes:spec}}});
 const engine=createAppEngine({providers:{federation:service,clock:{now:()=>Date.now()},random:{},audit:{record(){}}}});
 t.after(async()=>{await engine.dispose();await artefacts.engine.dispose();db.close();});
 const request=(options,extra={})=>({fragment:SLOT,required:true,purpose:'Ring you',fields:['signaling'],...options===undefined?{}:{options},...extra});
 const begin=async(clientId,options,extra)=>(await service.beginAuthorization({clientId,redirectUri:new URL(clientId).origin+'/callback',challenge,challengeMethod:'S256',state:'s',requests:[request(options,extra)]})).requestId;
 const inspect=id=>service.inspect(id,authority);
 const configure=async()=>{const prefs=await service.store.transaction(tx=>tx.get(`federation/preferences/${subject}|${SLOT}`));if(!prefs)await service.configure(authority,{fragment:SLOT,values:{}});};
 const approve=async(id,options,{fields=['signaling']}={})=>{await configure();const view=await inspect(id),r=view.requests[0];return service.approve(authority,{requestId:id,approved:[{fragment:SLOT,fields,resources:{signaling:[]},methods:{},revision:r.revision,...options===undefined?{}:{options}}]});};
 const grantsOf=async clientId=>(await service.store.transaction(tx=>tx.list('federation/grant/'))).map(row=>row.value).filter(g=>g.clientId===clientId&&g.active);
 // Review L6: occupant reads take the verified token's grant ids; here, all of the consumer's active grants.
 const ids=async clientId=>{const list=(await grantsOf(clientId)).map(g=>g.id);return list.length?list:['no-grant'];};
 return {db,config,service,engine,begin,inspect,approve,configure,grantsOf,ids,held,line};
}

test('AMD-X1 slot member: `bind` needs `crit`, names options.consumer members, and is unrecognized without support',()=>{
 assert.equal(validateSlotManifest(slotManifest()).status,'valid');assert.deepEqual(boundSlot(slotManifest()).bind,['purposes']);
 const edit=fn=>{const s=slotManifest();fn(s.slot);return validateSlotManifest(s);};
 assert.equal(edit(s=>{s.crit=[];}).status,'invalid','bind outside crit');assert.equal(edit(s=>{delete s.crit;}).status,'invalid');
 assert.equal(edit(s=>{s.bind=['nope'];}).status,'invalid','bind names a non-member');assert.equal(edit(s=>{s.bind=[];}).status,'invalid');
 assert.equal(edit(s=>{s.bind=['purposes','purposes'];}).status,'invalid');assert.equal(edit(s=>{delete s.options.consumer.purposes;}).status,'invalid');
 assert.equal(edit(s=>{s.bind='purposes';}).status,'invalid');assert.equal(edit(s=>{delete s.bind;}).status,'invalid','crit names an absent member');
 // A processor without AMD-X1: `crit` makes the slot unrecognized, so it is an ordinary fragment with no binding.
 const old=validateSlotManifest(slotManifest(),SLOT,{boundOptions:false});assert.equal(old.status,'unrecognized');assert.equal(old.reason,'unsupported_critical_member');assert.equal(boundSlot(slotManifest(),SLOT,{boundOptions:false}),null);
 // Unlisted unknown members stay ignored; a slot without bind has no binding.
 const plain=slotManifest();delete plain.slot.bind;plain.slot.crit=[];assert.equal(validateSlotManifest(plain).status,'valid');assert.equal(boundSlot(plain),null);
});

test('AMD-X1 requests: bound slots need valid options (only bound members); others may not carry them',async t=>{
 const h=await harness(t);
 for(const bad of [undefined,{},{purposes:[]},{purposes:'x'},{purposes:[CALL,CALL]},{purposes:[CALL],extra:1},{purposes:['http://spec.bindle.example/rtc-purposes/call/v1']},{purposes:Array.from({length:17},(_,i)=>`https://spec.bindle.example/p/${i}`)}])await assert.rejects(h.begin(A,bad),{code:'invalid_request'},JSON.stringify(bad));
 await assert.rejects(h.begin(A,{purposes:['https://spec.bindle.example/rtc-purposes/unregistered/v1']}),{code:'invalid_request'},'unregistered line is never resolved by URL');
 const id=await h.begin(A,{purposes:[FILES,CALL]}),view=await h.inspect(id),r=view.requests[0];
 assert.deepEqual(r.options,{purposes:[FILES,CALL]});assert.deepEqual(Object.keys(r.bound.versions).sort(),[CALL,FILES].sort());
 assert.deepEqual(r.bound.versions[CALL],{version:1,digest:RTC_PURPOSE_REFERENCES[0].digest});assert.equal(r.bound.disclosure[FILES].host,'spec.bindle.example');assert.deepEqual(r.bound.disclosure[FILES].context,['bytes','files']);
 assert.deepEqual(r.bound.schema,{purposes:RTC_SIGNALING_SLOT_MANIFEST.slot.options.consumer.purposes});
 // Pinned at request time as exact provider-held references (never "latest"), so the line head never advances.
 const pin=await h.db.get('artefacts/line/'+CALL);assert.equal(pin.head,0);
 // A non-bound fragment refuses options, and with AMD-X1 off the member is unknown.
 const plain=slotManifest();delete plain.slot.bind;plain.slot.crit=[];const p=await harness(t,{schema:plain});await assert.rejects(p.begin(A,{purposes:[CALL]}),{code:'invalid_request'});
 const off=await harness(t,{bound:false});await assert.rejects(off.begin(A,{purposes:[CALL]}),{code:'invalid_args'});
 const legacy=await off.begin(A);assert.equal((await off.inspect(legacy)).requests[0].options,undefined,'without AMD-X1 the slot is an ordinary fragment');
});

test('AMD-X1 consent: the owner approves a subset; values and versions are recorded in that consumer’s grant',async t=>{
 const h=await harness(t),id=await h.begin(A,{purposes:[CALL,FILES,SCREEN]});
 await assert.rejects(h.approve(id,undefined),{code:'invalid_grant'},'options are required for a bound request');
 await assert.rejects(h.approve(id,{purposes:[SYNC]}),{code:'invalid_grant'},'beyond the request');
 await assert.rejects(h.approve(id,{purposes:[]}),{code:'invalid_grant'},'below the minimum: decline instead');
 await assert.rejects(h.approve(id,{purposes:[CALL],other:[1]}),{code:'invalid_grant'});
 await h.approve(id,{purposes:[FILES]});
 const [grant]=await h.grantsOf(A);assert.deepEqual(grant.bound.values,{purposes:[FILES]});assert.deepEqual(Object.keys(grant.bound.versions),[FILES]);assert.equal(grant.bound.versions[FILES].version,1);assert.match(grant.bound.revision,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(await h.service.checkBound({subject,clientId:A,fragment:SLOT,grants:await h.ids(A),member:'purposes',value:FILES,reference:grant.bound.versions[FILES]}),true);
 assert.equal(await h.service.checkBound({subject,clientId:A,fragment:SLOT,grants:await h.ids(A),member:'purposes',value:CALL,reference:{version:1,digest:RTC_PURPOSE_REFERENCES[0].digest}}),false,'requested but not approved');
 // A non-bound selection may not smuggle options.
 const plain=slotManifest();delete plain.slot.bind;plain.slot.crit=[];const p=await harness(t,{schema:plain}),pid=await p.begin(A);await assert.rejects(p.approve(pid,{purposes:[CALL]}),{code:'invalid_grant'});
});

test('AMD-X1 an app cannot widen beyond its approval: wider requests need consent again, and the occupant check refuses',async t=>{
 const h=await harness(t);await h.approve(await h.begin(A,{purposes:[CALL]}),{purposes:[CALL]});
 // The same or a narrower request is already approved (and the resubmitted selection stays within the approval).
 const approvedFor=async options=>{const id=await h.begin(A,{purposes:options});const r=(await h.inspect(id)).requests[0];return h.service.store.transaction(tx=>h.service.priorApproval(tx,subject,'epoch',A,[r]));};
 const covered=await approvedFor([CALL]);assert.deepEqual(covered[0].options,{purposes:[CALL]});
 assert.equal(await approvedFor([CALL,SCREEN]),null,'a widening request is not already approved');
 assert.equal(await approvedFor([SCREEN]),null);
 for(const value of [SCREEN,FILES,SYNC,'https://evil.example/rtc-purposes/call/v1'])assert.equal(await h.service.checkBound({subject,clientId:A,fragment:SLOT,grants:await h.ids(A),member:'purposes',value,reference:{version:1,digest:RTC_PURPOSE_REFERENCES[0].digest}}),false,value);
 assert.equal(await h.service.checkBound({subject,clientId:A,fragment:SLOT,grants:await h.ids(A),member:'other',value:CALL}),false);
 // Approving a widening request needs an explicit owner selection of the new value; nothing is preselected server-side.
 const wide=await h.begin(A,{purposes:[CALL,SCREEN]});await h.approve(wide,{purposes:[CALL]});
 assert.equal(await h.service.checkBound({subject,clientId:A,fragment:SLOT,grants:await h.ids(A),member:'purposes',value:SCREEN,reference:{version:1,digest:RTC_PURPOSE_REFERENCES[1].digest}}),false);
});

test('AMD-X1 versions: only the approved version is usable; a new version needs re-approval',async t=>{
 const h=await harness(t);await h.approve(await h.begin(A,{purposes:[TEST_LINE]}),{purposes:[TEST_LINE]});
 const [v1,v2]=h.line.refs,check=async reference=>h.service.checkBound({subject,clientId:A,fragment:SLOT,grants:await h.ids(A),member:'purposes',value:TEST_LINE,reference});
 assert.equal(await check(v1),true);assert.equal(await check(v2),false,'v2 unusable under the v1 approval');assert.equal(await check({version:1,digest:v2.digest}),false,'digest mismatch');assert.equal(await check(undefined),false);
 // The operator reviews v2; the app asks again: the recorded version differs, so it is not already approved.
 h.held.version=2;const id=await h.begin(A,{purposes:[TEST_LINE]}),r=(await h.inspect(id)).requests[0];assert.deepEqual(r.bound.versions[TEST_LINE],{version:2,digest:v2.digest});
 assert.equal(await h.service.store.transaction(tx=>h.service.priorApproval(tx,subject,'epoch',A,[r])),null);
 await h.approve(id,{purposes:[TEST_LINE]});assert.equal(await check(v2),true,'usable after re-approval');
 // Pure rule: a later version is usable only when verified additive and not widening (no signed table yet → never).
 assert.equal(boundVersionUsable(v1,v2),false);assert.equal(boundVersionUsable(v1,v2,{verify:()=>'additive'}),true);assert.equal(boundVersionUsable(v1,v2,{verify:()=>'widening'}),false);assert.equal(boundVersionUsable(v2,v1,{verify:()=>'additive'}),false,'no rollback');
});

test('AMD-X1 bound values are per app, never shared; owner narrowing is immediate and cannot widen',async t=>{
 const h=await harness(t);await h.approve(await h.begin(A,{purposes:[CALL,FILES]}),{purposes:[CALL,FILES]});await h.approve(await h.begin(B,{purposes:[CALL]}),{purposes:[CALL]});
 const approval=async clientId=>read(h.engine,new BoundApproval({actor:{kind:'system'},input:{subject,clientId,fragment:SLOT,grants:await h.ids(clientId)}}));
 assert.deepEqual((await approval(A)).values,{purposes:[CALL,FILES]});assert.deepEqual((await approval(B)).values,{purposes:[CALL]});
 assert.equal(await h.service.checkBound({subject,clientId:B,fragment:SLOT,grants:await h.ids(B),member:'purposes',value:FILES,reference:{version:1,digest:RTC_PURPOSE_REFERENCES[2].digest}}),false,'B never gains A’s purposes');
 // Shared preference values (every consumer of the slot field sees them) never contain bound values.
 const prefs=await h.service.store.transaction(tx=>tx.get(`federation/preferences/${subject}|${SLOT}`));assert.equal(JSON.stringify(prefs).includes(FILES),false);
 const before=(await approval(A)).revision;
 await assert.rejects(perform(h.engine,new NarrowBoundOptions({authority,input:{clientId:A,fragment:SLOT,options:{purposes:[CALL,SCREEN]}}})),{code:'bound_options_widening'});
 await assert.rejects(perform(h.engine,new NarrowBoundOptions({authority,input:{clientId:A,fragment:SLOT,options:{purposes:[]}}})),{code:'invalid_args'});
 const narrowed=await perform(h.engine,new NarrowBoundOptions({authority,input:{clientId:A,fragment:SLOT,options:{purposes:[CALL]}}}));assert.deepEqual(narrowed.values,{purposes:[CALL]});
 const after=await approval(A);assert.deepEqual(after.values,{purposes:[CALL]});assert.deepEqual(Object.keys(after.versions),[CALL]);assert.notEqual(after.revision,before,'the approval revision changes');
 assert.equal(await h.service.checkBound({subject,clientId:A,fragment:SLOT,grants:await h.ids(A),member:'purposes',value:FILES,reference:{version:1,digest:RTC_PURPOSE_REFERENCES[2].digest}}),false,'narrowing applies at once');
 assert.deepEqual((await approval(B)).values,{purposes:[CALL]},'B untouched');
 await assert.rejects(perform(h.engine,new NarrowBoundOptions({authority,input:{clientId:'https://c.example/client',fragment:SLOT,options:{purposes:[CALL]}}})),{code:'not_found'});
 // Approvals accumulate per app; narrowing reaches every active grant (an older, wider grant cannot keep a value alive).
 const h2=await harness(t);await h2.approve(await h2.begin(A,{purposes:[CALL,FILES]}),{purposes:[CALL,FILES]});await h2.approve(await h2.begin(A,{purposes:[FILES,SCREEN]}),{purposes:[FILES,SCREEN]});
 assert.deepEqual((await h2.service.boundApproval({subject,clientId:A,fragment:SLOT,grants:await h2.ids(A)})).values.purposes.sort(),[CALL,FILES,SCREEN].sort());
 await perform(h2.engine,new NarrowBoundOptions({authority,input:{clientId:A,fragment:SLOT,options:{purposes:[CALL,SCREEN]}}}));
 const grants=await h2.grantsOf(A);assert.equal(grants.length,2);assert.ok(grants.every(g=>!g.bound.values.purposes.includes(FILES)));assert.deepEqual(grants.map(g=>g.bound.values.purposes.length).sort(),[1,1]);
 assert.deepEqual((await h2.service.boundApproval({subject,clientId:A,fragment:SLOT,grants:await h2.ids(A)})).values.purposes.sort(),[CALL,SCREEN].sort());
 // A token's own grants bound its approval.
 assert.deepEqual((await h2.service.boundApproval({subject,clientId:A,fragment:SLOT,grants:[grants.find(g=>g.bound.values.purposes.includes(CALL)).id]})).values.purposes,[CALL]);
});

test('AMD-X1 kill switch: with EXTENSIONS_ENABLED off a pending bound request cannot be approved',async t=>{
 const h=await harness(t),id=await h.begin(A,{purposes:[CALL]});h.service.boundOptions=false;
 await assert.rejects(h.approve(id,{purposes:[CALL]}),{code:'unsupported_fragment'});assert.equal((await h.grantsOf(A)).length,0);
});

test('AMD-X1 engine: PinGrantRequests resolves bound purposes through the same pinned path',async t=>{
 const h=await harness(t),[r]=await perform(h.engine,new PinGrantRequests({input:[{fragment:SLOT,required:false,purpose:'x',fields:['signaling'],options:{purposes:[SYNC]}}]}));
 assert.deepEqual(r.options,{purposes:[SYNC]});assert.equal(r.bound.disclosure[SYNC].alert,false);assert.equal(r.bound.disclosure[SYNC].parties,'self');
});

test('AMD-X1 seeded property: approval ⊆ request, coverage is exact, narrowing never widens',async()=>{
 const slot=boundSlot(slotManifest()),schema=boundSchema(slot),pool=Array.from({length:20},(_,i)=>`https://spec.bindle.example/rtc-purposes/p${i}/v1`);
 await forEachSeed(40,async random=>{
  const pick=(from,min=0)=>{const out=random.shuffle([...from]).slice(0,min+random.int(Math.max(1,Math.min(16,from.length)-min+1)));return out.slice(0,16);};
  const requested=pick(pool,1),req=validateBoundRequest(slot,{purposes:requested});
  for(let i=0;i<10;i++){
   const attempt=pick(random.chance(0.3)?pool:requested);let approved=null;try{approved=approveBoundOptions(schema,req,{purposes:attempt});}catch(e){assert.equal(e.code,'invalid_grant');}
   const legal=attempt.length>=1&&attempt.length<=16&&attempt.every(v=>requested.includes(v));assert.equal(approved!==null,legal,JSON.stringify({requested,attempt}));
   if(!approved)continue;assert.ok(boundCovers(req,approved));assert.equal(boundCovers(approved,req),requested.every(v=>attempt.includes(v)));
   const next=pick(random.chance(0.5)?attempt:pool);let narrowed=null;try{narrowed=narrowBoundOptions(schema,approved,{purposes:next});}catch(e){assert.ok(['bound_options_widening','invalid_args'].includes(e.code));}
   if(narrowed){assert.ok(boundCovers(approved,narrowed));for(const v of pool)if(boundAllows({values:narrowed},'purposes',v))assert.ok(boundAllows({values:approved},'purposes',v));}
  }
 });
});

test('candidate purposes validate and disclose plain facts for consent',()=>{for(const e of REGISTERED_PURPOSES){const b=validatePurpose(e.versions[0].body),d=purposeDisclosure(b);assert.equal(d.host,'spec.bindle.example');assert.deepEqual(d.media,b.media);}});

test('AMD-X1 is generic: a bound enum member without artefact lines is approved, covered and narrowed the same way',async t=>{
 const ID='https://spec.bindle.example/slots/test-bound/v1',schema={id:ID,title:'Test bound slot',description:'A slot binding an enum per consumer.',publisher:'https://spec.bindle.example',fields:{target:{title:'Target',type:'resource',cardinality:{min:0,max:1},contracts:['https://spec.bindle.example/contracts/test/v1']}},slot:{v:1,crit:['bind'],field:'target',selection:'exclusive',consumers:['application'],bind:['modes'],options:{occupant:{},consumer:{modes:{title:'Modes',type:'enum',values:['a','b','c'],cardinality:{min:1,max:3}}}}}};
 const db=new SqliteMetadata(':memory:'),config={ARTEFACT_VERSIONS_ENABLED:'true',FEDERATION_SCHEMAS:{[ID]:schema}},artefacts=configuredArtefacts({config,store:db});config.ARTEFACTS=artefacts;
 const service=new FederationService({issuer,store:federationMetadata(db),schemaHosts:['spec.bindle.example'],schemaFetcher:reviewedSchemaFetcher(config),authenticateOwner:async()=>({subject,epoch:'epoch'}),clients,boundOptions:true,boundArtefacts:RTC_BOUND_ARTEFACTS});
 t.after(async()=>{await artefacts.engine.dispose();db.close();});
 const begin=async modes=>(await service.beginAuthorization({clientId:A,redirectUri:'https://a.example/callback',challenge,challengeMethod:'S256',state:'s',requests:[{fragment:ID,required:true,purpose:'x',fields:['target'],options:{modes}}]})).requestId;
 await assert.rejects(begin(['d']),{code:'invalid_request'});await assert.rejects(begin(['a','a']),{code:'invalid_request'});
 await service.configure(authority,{fragment:ID,values:{}});const approve=async(id,modes)=>{const r=(await service.inspect(id,authority)).requests[0];assert.deepEqual(r.bound.versions,{});return service.approve(authority,{requestId:id,approved:[{fragment:ID,fields:['target'],resources:{target:[]},methods:{},revision:r.revision,options:{modes}}]});};
 await approve(await begin(['a','b']),['a']);
 const prior=async modes=>{const id=await begin(modes),r=(await service.inspect(id,authority)).requests[0];return service.store.transaction(tx=>service.priorApproval(tx,subject,'epoch',A,[r]));};
 assert.deepEqual((await prior(['a']))[0].options,{modes:['a']});assert.equal(await prior(['a','b']),null,'b was requested but never approved');assert.equal(await prior(['c']),null);
 const grants=(await service.store.transaction(tx=>tx.list('federation/grant/'))).map(row=>row.value.id);
 assert.equal(await service.checkBound({subject,clientId:A,fragment:ID,grants,member:'modes',value:'a'}),true);assert.equal(await service.checkBound({subject,clientId:A,fragment:ID,grants,member:'modes',value:'b'}),false);
 assert.equal(await service.checkBound({subject,clientId:A,fragment:ID,grants,member:'modes',value:'a',reference:{version:1,digest:'sha256-'+'A'.repeat(43)}}),false,'a plain value carries no version');
});

// ---- independent security review follow-ups (DEVLOG "RTC-a/b/c", "Review follow-ups"; provisional) -------------------
test('review L6: the bound-approval read is system-only and needs the verified token grants; dead connections and other epochs do not count',async t=>{
 const h=await harness(t);await h.approve(await h.begin(A,{purposes:[CALL]}),{purposes:[CALL]});const ids=await h.ids(A),input={subject,clientId:A,fragment:SLOT,grants:ids};
 for(const actor of [undefined,{kind:'owner',owner:'0b5f2a52-5b8e-4f3e-9a51-0c1d2e3f4a5b'},{kind:'app'},{kind:'untrusted'}])await assert.rejects(read(h.engine,new BoundApproval({actor,input})),{code:'forbidden'},JSON.stringify(actor));
 assert.deepEqual((await read(h.engine,new BoundApproval({actor:{kind:'system'},input}))).values,{purposes:[CALL]});
 for(const grants of [undefined,[],'x',[1],Array(257).fill('g')])await assert.rejects(h.service.boundApproval({...input,grants}),{code:'invalid_args'},JSON.stringify(grants)?.slice(0,30));
 await assert.rejects(h.service.checkBound({subject,clientId:A,fragment:SLOT,member:'purposes',value:CALL,reference:{version:1,digest:RTC_PURPOSE_REFERENCES[0].digest}}),{code:'invalid_args'},'no all-grants fallback');
 assert.equal(await h.service.boundApproval({...input,grants:['someone-else']}),null,'only the named grants count');
 assert.equal(await h.service.boundApproval({...input,epoch:'other-epoch'}),null,'a grant from another epoch does not count');assert.ok(await h.service.boundApproval({...input,epoch:'epoch'}));
 // With connections mounted, a grant whose connection is no longer live does not count (as in priorApproval).
 const [grant]=await h.grantsOf(A);grant.connection={id:'c1',generation:1};await h.service.store.transaction(tx=>tx.set('federation/grant/'+grant.id,grant));
 let live=true;h.service.connections={check:async()=>live};assert.ok(await h.service.boundApproval(input));live=false;assert.equal(await h.service.boundApproval(input),null);
 h.service.connections={check:async()=>{throw Object.assign(new Error('gone'),{code:'not_found'});}};assert.equal(await h.service.boundApproval(input),null);
});

test('review L7: grant-more refuses fragments whose slot binds options, with a clear error',async()=>{
 const {fixture,grantMoreInput,SCHEMAS}=await import('./incremental-authorization-helpers.mjs');
 const f=fixture({schemas:{...SCHEMAS,[SLOT]:slotManifest()}});
 await assert.rejects(f.incremental.admit(grantMoreInput([{fragment:SLOT,purpose:'Ring you',fields:['signaling'],methods:{}}]).input),e=>e.code==='unsupported_fragment'&&/full authorization/.test(e.message));
 const plain=slotManifest();delete plain.slot.bind;plain.slot.crit=[];const g=fixture({schemas:{...SCHEMAS,[SLOT]:plain}});
 assert.deepEqual(await g.incremental.admit(grantMoreInput([{fragment:SLOT,purpose:'Ring you',fields:['signaling'],methods:{}}]).input),{admitted:true},'an unbound slot is unaffected');
 // The owner-shard commit refuses it too (a backstop if an entry ever reached it): no unbound grant for a bound slot.
 const {incrementalPort}=await import('../packages/federation/incremental-ports.mjs'),owner='0b5f2a52-5b8e-4f3e-9a51-0c1d2e3f4a5b',rows=new Map();
 const tx={get:async k=>rows.get(k),set:async(k,v)=>rows.set(k,v),list:async p=>[...rows].filter(([k])=>k.startsWith(p)).map(([key,value])=>({key,value})),delete:async k=>rows.delete(k)};
 const shard=schema=>({issuer,routingKey:owner,ensureClients:async()=>{},incrementalIdentity:async()=>({epoch:'e'}),active:async()=>{},connections:{binding:async()=>({id:'c',generation:1}),check:async()=>true},clients:new Map([[A,{origin:'https://a.example'}]]),syncResources:async()=>{},schema:async()=>({schema,digest:'d'}),artefactVersions:false,store:{transaction:fn=>fn(tx)},random:()=>'g'+rows.size,bounded:async()=>{},clock:()=>1,url:v=>v});
 rows.set(`federation/preferences/${issuer}/entities/${owner}|${SLOT}`,{digest:'d',values:{signaling:issuer+'/resources/r1'}});
 const commit=(schema,decision)=>incrementalPort(shard(schema),'commit',{subject:`${issuer}/entities/${owner}`,clientId:A,decision,changes:[{fragment:SLOT,digest:'d',fields:['signaling'],methods:{},resources:{}}]});
 await assert.rejects(commit(slotManifest(),'d1'),{code:'unsupported_fragment'});assert.equal([...rows.keys()].some(k=>k.startsWith('federation/grant/')),false,'no grant written');
 await commit(plain,'d2');assert.equal([...rows.keys()].filter(k=>k.startsWith('federation/grant/')).length,1,'an unbound slot commits');
});

test('review L8: an "already approved" bound selection is re-checked against live grants inside approve',async t=>{
 const h=await harness(t);await h.approve(await h.begin(A,{purposes:[CALL,FILES]}),{purposes:[CALL,FILES]});
 let n=0;const entry=async options=>{const requestId=String(++n).padStart(43,'R');const out=await h.service.beginEntryAuthorization(authority,{requestId,entry:{entryHash:String(n).padStart(43,'E'),clientId:A,redirectUri:'https://a.example/callback',challenge,state:'s',requests:[{fragment:SLOT,required:true,purpose:'Ring you',fields:['signaling'],options}],intent:'login',delivery:'redirect'}});return {requestId,approved:out.approved};};
 // Untouched: the same-click resubmission succeeds.
 const ok=await entry({purposes:[CALL,FILES]});assert.deepEqual(ok.approved[0].options,{purposes:[CALL,FILES]});await h.service.approve(authority,{requestId:ok.requestId,approved:ok.approved},{entry:true});
 // The owner narrows between the offer and the click: the resubmission must not restore FILES.
 const offer=await entry({purposes:[CALL,FILES]});assert.ok(offer.approved);
 await perform(h.engine,new NarrowBoundOptions({authority,input:{clientId:A,fragment:SLOT,options:{purposes:[CALL]}}}));
 const before=(await h.grantsOf(A)).length;
 await assert.rejects(h.service.approve(authority,{requestId:offer.requestId,approved:offer.approved},{entry:true}),{code:'stale_consent'});
 assert.equal((await h.grantsOf(A)).length,before,'no grant was written');assert.equal(await h.service.checkBound({subject,clientId:A,fragment:SLOT,grants:await h.ids(A),member:'purposes',value:FILES,reference:{version:1,digest:RTC_PURPOSE_REFERENCES[2].digest}}),false);
 // The refusal sends the owner to the consent review; an explicit approval there is an ordinary new consent.
 await h.service.approve(authority,{requestId:offer.requestId,approved:offer.approved},{entry:true});
 assert.equal(await h.service.checkBound({subject,clientId:A,fragment:SLOT,grants:await h.ids(A),member:'purposes',value:FILES,reference:{version:1,digest:RTC_PURPOSE_REFERENCES[2].digest}}),true);
});

test('review L8: the live re-check also compares recorded versions (a re-approval at another version does not cover the offer)',async t=>{
 const h=await harness(t),[v1,v2]=h.line.refs;await h.approve(await h.begin(A,{purposes:[CALL,TEST_LINE]}),{purposes:[CALL,TEST_LINE]});
 const requestId='V'.repeat(43),out=await h.service.beginEntryAuthorization(authority,{requestId,entry:{entryHash:'V'.repeat(43),clientId:A,redirectUri:'https://a.example/callback',challenge,state:'s',requests:[{fragment:SLOT,required:true,purpose:'Ring you',fields:['signaling'],options:{purposes:[TEST_LINE]}}],intent:'login',delivery:'redirect'}});
 assert.deepEqual(out.approved[0].options,{purposes:[TEST_LINE]},'offered at v1');
 // The owner removes the line, then approves it again at v2 through another request.
 await perform(h.engine,new NarrowBoundOptions({authority,input:{clientId:A,fragment:SLOT,options:{purposes:[CALL]}}}));h.held.version=2;await h.approve(await h.begin(A,{purposes:[TEST_LINE]}),{purposes:[TEST_LINE]});
 await assert.rejects(h.service.approve(authority,{requestId,approved:out.approved},{entry:true}),{code:'stale_consent'},'the v1 offer is not covered by the v2 approval');
 const check=async reference=>h.service.checkBound({subject,clientId:A,fragment:SLOT,grants:await h.ids(A),member:'purposes',value:TEST_LINE,reference});assert.equal(await check(v1),false);assert.equal(await check(v2),true);
});

test('review: the federation composition resolves RTC purposes only while RTC_SIGNALING_ENABLED is on',async()=>{
 const {federationControllerOptions}=await import('../packages/runtime/federation.mjs');
 const options=config=>federationControllerOptions({config:{APP_ORIGIN:issuer,...config},repository:{get:async()=>null},accounts:{get:()=>({invoke:async()=>null})},owner:'0b5f2a52-5b8e-4f3e-9a51-0c1d2e3f4a5b'}).boundArtefacts[SLOT].purposes;
 assert.equal(options({EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true'}).reference(CALL),null,'extensions alone do not enable RTC purposes');
 assert.deepEqual(options({EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',RTC_SIGNALING_ENABLED:'true'}).reference(CALL),RTC_BOUND_ARTEFACTS[SLOT].purposes.reference(CALL));
});

test('review: RTC bound artefacts resolve only while RTC_SIGNALING_ENABLED is on (as well as EXTENSIONS_ENABLED)',async t=>{
 const {rtcBoundArtefacts}=await import('../packages/rtc/extension.mjs');let on=false;const gated=rtcBoundArtefacts(()=>on)[SLOT].purposes;
 assert.equal(gated.reference(CALL),null,'off: no provider-held reference, so the request is refused');on=true;assert.deepEqual(gated.reference(CALL),RTC_BOUND_ARTEFACTS[SLOT].purposes.reference(CALL));
 const h=await harness(t);h.service.boundArtefacts=rtcBoundArtefacts(()=>false);await assert.rejects(h.begin(A,{purposes:[CALL]}),{code:'invalid_request'});
 h.service.boundArtefacts=rtcBoundArtefacts(()=>true);assert.ok(await h.begin(A,{purposes:[CALL]}));
});
