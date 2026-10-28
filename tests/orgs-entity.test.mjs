// ORG-0 (power resolver seam) and ORG-1 (organization entity), engine level. Each account single writer is an ngin
// Engine over its own SQLite store with the organizations provider; actors are resolved by the same `accountActor`
// call the account slice makes, inside a per-writer serial gate, as AccountController does. Creation runs the real
// OrganizationCreation sequence over a real identity repository; the identity-backup port is a recording fake here
// (tests/orgs-runtime.test.mjs covers the real port, keys and file).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppEngine,perform,read,AppQuery,ownerOf} from '../packages/app/engine.mjs';
import {memoryAudit} from '../packages/app/providers.mjs';
import {fakeClock,createRandom,seededRandom} from '../packages/app/memory-providers.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {IdentityRepository} from '../packages/runtime/accounts.mjs';
import {accountActor,personActor,actingAs,organizationPowers,requireFresh} from '../packages/orgs/authority.mjs';
import {OrganizationService,ORG_RECORD,ORG_DELETION_DELAY_MS,ORG_CREATION_LIMIT,ORG_LABELS,allowlistPlanPort,organizationName} from '../packages/orgs/organizations.mjs';
import {OrganizationCreation} from '../packages/orgs/creation.mjs';
import {identityBackupPort} from '../packages/runtime/identity-backup.mjs';
import {organizationIdentityPort,interactiveIdentity} from '../packages/identity/organizations.mjs';
import {organizationsProvider,ORG_OPERATIONS,ORG_SYSTEM_OPERATIONS,InitializeOrganization,ConfirmOrganization,OrganizationTick} from '../packages/app/domains/orgs.mjs';
import {ACCOUNT_OPERATIONS} from '../packages/app/operations.mjs';
import {transferIdentityPort} from '../packages/identity/transfer-out.mjs';
import {forEachSeed,concurrently} from './helpers/chaos.mjs';

const ISSUER='https://3sln.example',MINUTE=60000,DAY=86400000;
const ALICE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',BOB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',CAROL='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OPS=Object.fromEntries([...ORG_OPERATIONS,...ORG_SYSTEM_OPERATIONS].map(O=>[O.operation,O]));

async function world({seed=1,enabled=true,paid=[ALICE,BOB],purge}={}){
 const clock=fakeClock(),random=createRandom(seed),ids=seededRandom(createRandom((seed^0x0a11)>>>0));
 const flag={on:enabled},flags={for:()=>({enabled:name=>name==='ORGANIZATIONS_ENABLED'&&flag.on})};
 const paidSet=new Set(paid),plans={async check({creator}){return paidSet.has(creator.sub)?{paid:true,plan:'organization-internal',source:'test'}:{paid:false};}};
 const writers=new Map(),opened=[];
 function writer(owner){
  if(!writers.has(owner)){
   const metadata=new SqliteMetadata(':memory:'),service=new OrganizationService({metadata,clock,random:ids,flags,plans,issuer:ISSUER,...purge?{purge}:{}});
   const engine=createAppEngine({providers:{clock,random:ids,audit:memoryAudit({clock}),organizations:organizationsProvider(service)}});
   writers.set(owner,{metadata,service,engine,gate:new SerialGate(),bound:false});opened.push(owner);
  }
  return writers.get(owner);
 }
 // AccountController.warm binds the account owner on first use; an organization is checked before warm (orgsDispatch).
 const warm=async(w,owner)=>{if(!w.bound){if(await w.metadata.get('owner')===undefined)await w.metadata.put('owner',owner);w.bound=true;}};
 const run=(w,operation)=>operation instanceof AppQuery?read(w.engine,operation):perform(w.engine,operation);
 /** The account slice's orgsDispatch: resolve the actor inside the gate, then warm, then run. */
 const dispatch=(owner,{operation,actor,input})=>{const w=writer(owner);return w.gate.run(async()=>{const Operation=ORG_OPERATIONS.find(O=>O.operation===operation);if(!Operation)throw Object.assign(new Error('Not found.'),{code:'not_found'});const resolved=await accountActor({owner,requested:actor,Operation,issuer:ISSUER,organization:()=>w.metadata.get(ORG_RECORD)});await warm(w,owner);return run(w,new Operation({actor:resolved,...input===undefined?{}:{input}}));});};
 const system=(owner,Operation,input)=>{const w=writer(owner);return w.gate.run(async()=>{await warm(w,owner);return run(w,new Operation({actor:{kind:'system',owner},...input===undefined?{}:{input}}));});};
 const repository=new IdentityRepository({metadata:new SqliteMetadata(':memory:'),config:{}}),identity=organizationIdentityPort(repository,{clock:clock.now});
 // The real v3 port (no account calls for issuance), recording every file it issued.
 const issued=[],realPort=identityBackupPort({config:{APP_ORIGIN:ISSUER},accounts:{get(){throw new Error('issuance never reaches an account writer');}}});
 const backup={async issue(account,recoveryToken){const result=await realPort.issue(account,recoveryToken,{issuedAt:clock.now()});issued.push(result.file);return result;}};
 const creation=new OrganizationCreation({issuer:ISSUER,identity,backup,
  person:{reserve:(actor,input)=>dispatch(actor.entity.id,{operation:'orgs.reserve',actor,input}),confirm:(owner,input)=>system(owner,ConfirmOrganization,input)},
  org:{initialize:(org,input)=>system(org,InitializeOrganization,input)}});
 const person=(owner,{authTime=clock.now(),epoch=0}={})=>personActor({owner,iss:ISSUER,authTime,epoch});
 const self=actor=>({principal:actor.principal,entity:actor.entity,authTime:actor.authTime,epoch:actor.epoch});
 const as=(actor,org)=>actingAs(actor,{kind:'organization',id:org});
 const create=(owner,input={},actor=person(owner))=>creation.create(actor,{request:'request-'+owner.slice(0,8)+'-0001',name:'Acme Ltd',...input});
 const record=org=>writer(org).metadata.get(ORG_RECORD);
 const close=async()=>{for(const owner of opened){const w=writers.get(owner);await w.engine.dispose();w.metadata.close();}};
 return {clock,random,flag,paidSet,writer,dispatch,system,identity,repository,backup,issued,creation,person,self,as,create,record,close};
}

test('ORG-0: a person acting as themselves resolves to the former implicit owner, with powers never taken from the caller',async()=>{
 const View=class{static entities=undefined;};
 const legacy=await accountActor({owner:ALICE,Operation:View,issuer:ISSUER});
 assert.equal(legacy.kind,'owner');assert.equal(legacy.owner,ALICE);assert.equal(ownerOf(legacy),ALICE);assert.deepEqual(legacy.powers,['owner']);assert.deepEqual(legacy.entity,{kind:'person',id:ALICE});
 const explicit=await accountActor({owner:ALICE,requested:{principal:{iss:null,sub:ALICE},entity:{kind:'person',id:ALICE},authTime:5,epoch:3,powers:['admin','owner-of-record']},Operation:View,issuer:ISSUER});
 assert.deepEqual(explicit.powers,['owner'],'caller-supplied powers are ignored');assert.equal(explicit.principal.iss,ISSUER,'same-host issuer is normalized');assert.equal(explicit.authTime,5);assert.equal(explicit.epoch,3);assert.ok(Object.isFrozen(explicit)&&Object.isFrozen(explicit.powers));
 await assert.rejects(accountActor({owner:ALICE,requested:{principal:{sub:BOB},entity:{kind:'person',id:ALICE}},Operation:View,issuer:ISSUER}),{code:'forbidden'});
 await assert.rejects(accountActor({owner:ALICE,requested:{principal:{sub:ALICE},entity:{kind:'person',id:BOB}},Operation:View,issuer:ISSUER}),{code:'forbidden'});
 await assert.rejects(accountActor({owner:ALICE,requested:{principal:{iss:'https://other.example',sub:ALICE},entity:{kind:'person',id:ALICE}},Operation:View,issuer:ISSUER}),{code:'forbidden'},'foreign principals wait for ORG-4');
 await assert.rejects(accountActor({owner:ALICE,requested:{principal:{sub:ALICE},entity:{kind:'organization',id:ALICE}},Operation:View,issuer:ISSUER,organization:async()=>({kind:'organization',id:ALICE,ownerOfRecord:{iss:ISSUER,sub:ALICE}})}),{code:'not_found'},'person-only operations refuse an organization entity');
 assert.throws(()=>ownerOf({kind:'owner',owner:ALICE,entity:{kind:'person',id:BOB}}),{code:'forbidden'});
 for(const Operation of Object.values(ACCOUNT_OPERATIONS))assert.ok(!(Operation.entities??['person']).includes('organization'),`${Operation.operation} must not accept an organization entity yet`);
 for(const Operation of ORG_SYSTEM_OPERATIONS)assert.ok(!Object.hasOwn(ACCOUNT_OPERATIONS,Operation.operation)&&!ORG_OPERATIONS.includes(Operation),'system operations are never wire-dispatchable');
});

test('ORG-0: organization powers come from the record; ownership alone is not admin; the ORG-2 membership hook replaces the fallback',()=>{
 const record={kind:'organization',id:CAROL,ownerOfRecord:{iss:ISSUER,sub:ALICE},initialAdmin:{iss:ISSUER,sub:ALICE}};
 assert.deepEqual(organizationPowers(record,{iss:ISSUER,sub:ALICE}).sort(),['admin','owner-of-record']);
 assert.deepEqual(organizationPowers(record,{iss:ISSUER,sub:BOB}),[]);
 assert.deepEqual(organizationPowers(record,{iss:'https://other.example',sub:ALICE}),[],'the issuer is part of the principal');
 assert.deepEqual(organizationPowers(record,{iss:ISSUER,sub:ALICE},{membership:()=>({powers:[]})}),['owner-of-record'],'owner of record without an admin grant (§12b.1 item 5)');
 assert.deepEqual(organizationPowers(record,{iss:ISSUER,sub:BOB},{membership:()=>({powers:['admin','owner-of-record']})}),['admin'],'membership never confers ownership');
 assert.deepEqual(organizationPowers({...record,kind:'person'},{iss:ISSUER,sub:ALICE}),[]);
 assert.throws(()=>requireFresh({authTime:null},1000),{code:'reauthentication_required'});assert.throws(()=>requireFresh({authTime:0},900000),{code:'reauthentication_required'});requireFresh({authTime:1},900000);
});

test('ORG-1: creation needs the flag, a fresh authentication and a paid plan; it creates an identity of kind organization with a recovery file',async t=>{
 const w=await world();t.after(w.close);
 w.flag.on=false;await assert.rejects(w.create(ALICE),{code:'not_found'});w.flag.on=true;
 await assert.rejects(w.create(CAROL),{code:'organization_payment_required'},'the paid check fails closed');
 await assert.rejects(w.create(ALICE,{},w.person(ALICE,{authTime:w.clock.now()-16*MINUTE})),{code:'reauthentication_required'});
 await assert.rejects(w.create(ALICE,{name:'  '}),{code:'invalid_name'});await assert.rejects(w.create(ALICE,{label:'cult'}),{code:'invalid_label'});
 const created=await w.create(ALICE,{label:'company'});
 const org=created.organization.id;assert.match(org,/^[0-9a-f-]{36}$/);assert.notEqual(org,ALICE);
 assert.equal(created.organization.name,'Acme Ltd');assert.equal(created.organization.label,'company');assert.deepEqual(created.organization.ownerOfRecord,{iss:ISSUER,sub:ALICE});
 assert.equal(created.recoveryFile.fileName,`3sln-organization-recovery-${org}.json`);assert.equal(JSON.parse(created.recoveryFile.content).entity,org);
 const identity=await w.identity.get(org);
 assert.equal(identity.kind,'organization');assert.equal(identity.status,'active');assert.equal(identity.handle,created.organization.handle);assert.ok(identity.recovery.issuedAt>0);assert.equal(identity.recovery.fileId,JSON.parse(created.recoveryFile.content).fileId);assert.equal(created.recoveryFile.content.includes('keychain'),false);
 const stored=await w.repository.get(org);assert.deepEqual([stored.credentials,stored.sessions,stored.passwordHash,stored.emailLoginEnabled],[[],[],null,false],'no interactive login');assert.equal(interactiveIdentity(stored),false);
 assert.equal((await transferIdentityPort(w.repository).get(org)).kind,'organization','portability sees the kind and keeps refusing organization moves');
 const list=await w.dispatch(ALICE,{operation:'orgs.list',actor:w.self(w.person(ALICE))});assert.deepEqual(list.organizations.map(o=>o.id),[org]);assert.deepEqual(list.pending,[]);
 const view=await w.dispatch(org,{operation:'orgs.get',actor:w.as(w.person(ALICE),org)});assert.deepEqual(view.powers,['admin','owner-of-record']);assert.equal(view.state,'active');
 // Idempotent per request key; a confirmed retry never replays the file.
 const again=await w.create(ALICE,{label:'company'});assert.equal(again.organization.id,org);assert.equal(again.recoveryFile,null);assert.equal(again.existing,true);
 await assert.rejects(w.create(ALICE,{name:'Other'}),{code:'idempotency_conflict'});
 assert.equal(w.issued.length,1);
});

test('ORG-1: an interrupted creation resumes with a replacement file, and the superseded credential is never current',async t=>{
 const w=await world();t.after(w.close);
 let crashes=1;
 w.creation.identity={...w.identity,bindRecovery:async(...args)=>{const result=await w.identity.bindRecovery(...args);if(crashes-->0)throw new Error('lost response');return result;}};
 await assert.rejects(w.create(BOB),/lost response/);
 const pending=await w.dispatch(BOB,{operation:'orgs.list',actor:w.self(w.person(BOB))});assert.equal(pending.organizations.length,0);assert.equal(pending.pending.length,1);
 const resumed=await w.create(BOB);
 assert.equal(w.issued.length,2);assert.notEqual(w.issued[0].fileId,w.issued[1].fileId,'the retry issued a new file');
 const stored=await w.repository.get(resumed.organization.id);assert.equal(stored.recoveryFileId,w.issued[1].fileId);assert.equal(stored.recoveryBackupVersion,3);
 assert.equal(JSON.parse(resumed.recoveryFile.content).recoveryToken,w.issued[1].recoveryToken);
 assert.deepEqual((await w.dispatch(BOB,{operation:'orgs.list',actor:w.self(w.person(BOB))})).pending,[]);
});

test('ORG-1: rename, kind label and delayed deletion follow powers, revisions, freshness and the delay',async t=>{
 const w=await world();t.after(w.close);
 const {organization:{id:org}}=await w.create(ALICE);const alice=()=>w.as(w.person(ALICE),org);
 await assert.rejects(w.dispatch(org,{operation:'orgs.get',actor:w.as(w.person(BOB),org)}),{code:'not_found'},'a non-member sees an unknown organization');
 await assert.rejects(w.dispatch(org,{operation:'orgs.rename',actor:w.as(w.person(BOB),org),input:{name:'Mine now'}}),{code:'not_found'});
 const renamed=await w.dispatch(org,{operation:'orgs.rename',actor:alice(),input:{name:'  Acme Holdings  ',expectedRevision:1}});assert.equal(renamed.name,'Acme Holdings');assert.equal(renamed.revision,2);
 await assert.rejects(w.dispatch(org,{operation:'orgs.rename',actor:alice(),input:{name:'Late',expectedRevision:1}}),{code:'organization_stale'});
 for(const label of ORG_LABELS)await w.dispatch(org,{operation:'orgs.set-label',actor:alice(),input:{label}});
 await assert.rejects(w.dispatch(org,{operation:'orgs.set-label',actor:alice(),input:{label:'guild'}}),{code:'invalid_label'});
 await assert.rejects(w.dispatch(org,{operation:'orgs.rename',actor:alice(),input:{name:'x',owner:BOB}}),{code:'invalid_request'},'no extra fields');
 await assert.rejects(w.dispatch(org,{operation:'orgs.schedule-deletion',actor:w.as(w.person(ALICE,{authTime:w.clock.now()-20*MINUTE}),org)}),{code:'reauthentication_required'});
 const scheduled=await w.dispatch(org,{operation:'orgs.schedule-deletion',actor:alice()});assert.equal(scheduled.state,'deletion-scheduled');assert.equal(scheduled.deletion.notBefore,w.clock.now()+ORG_DELETION_DELAY_MS);
 await assert.rejects(w.dispatch(org,{operation:'orgs.rename',actor:alice(),input:{name:'During'}}),{code:'organization_deletion_pending'});
 w.flag.on=false;assert.equal((await w.dispatch(org,{operation:'orgs.cancel-deletion',actor:alice()})).state,'active','cancel is never flag-gated');
 await assert.rejects(w.dispatch(org,{operation:'orgs.rename',actor:alice(),input:{name:'Hidden'}}),{code:'not_found'},'exposure is flag-gated');w.flag.on=true;
 await w.dispatch(org,{operation:'orgs.schedule-deletion',actor:alice()});
 assert.deepEqual(await w.system(org,OrganizationTick),{state:'deletion-scheduled',wakeAt:w.clock.now()+ORG_DELETION_DELAY_MS});
 w.clock.advance(ORG_DELETION_DELAY_MS);
 await assert.rejects(w.dispatch(org,{operation:'orgs.cancel-deletion',actor:alice()}),{code:'organization_deletion_due'});
 assert.deepEqual(await w.system(org,OrganizationTick),{state:'deletion-due',wakeAt:null,held:true},'without a purge port the deletion holds, never guesses');
 assert.equal((await w.record(org)).state,'deletion-due');
 const audit=await w.dispatch(org,{operation:'orgs.audit',actor:alice()});assert.deepEqual(audit.entries.map(e=>e.action).filter(a=>a!=='organization-label-changed'),['organization-created','organization-renamed','organization-deletion-scheduled','organization-deletion-cancelled','organization-deletion-scheduled','organization-deletion-due']);
 assert.ok(audit.entries.filter(e=>e.principal).every(e=>e.principal.sub===ALICE));
});

test('ORG-1: a due deletion is handed to the purge port when one exists; a failed hand-off retries',async t=>{
 const handed=[];let fail=true;const w=await world({purge:async org=>{if(fail){fail=false;throw new Error('busy');}handed.push(org);return {handedOff:true};}});t.after(w.close);
 const {organization:{id:org}}=await w.create(ALICE);await w.dispatch(org,{operation:'orgs.schedule-deletion',actor:w.as(w.person(ALICE),org)});w.clock.advance(ORG_DELETION_DELAY_MS);
 assert.equal((await w.system(org,OrganizationTick)).held,true);assert.equal((await w.system(org,OrganizationTick)).held,false);assert.deepEqual(handed,[org]);
});

test('ORG-1: the epoch rule refuses a request older than a security change; system steps and other entities stay apart',async t=>{
 const w=await world();t.after(w.close);
 const {organization:{id:org}}=await w.create(ALICE);
 await w.dispatch(org,{operation:'orgs.rename',actor:w.as(w.person(ALICE,{epoch:4}),org),input:{name:'Epoch four'}});
 await assert.rejects(w.dispatch(org,{operation:'orgs.rename',actor:w.as(w.person(ALICE,{epoch:3}),org),input:{name:'Stale'}}),{code:'authority_epoch_stale'});
 await assert.rejects(w.dispatch(org,{operation:'orgs.get',actor:w.as(w.person(ALICE,{epoch:2}),org)}),{code:'authority_epoch_stale'});
 assert.equal((await w.dispatch(org,{operation:'orgs.get',actor:w.as(w.person(ALICE,{epoch:5}),org)})).name,'Epoch four');
 // Person operations never run on the organization's writer, and organization operations never on a person's.
 await assert.rejects(w.dispatch(org,{operation:'orgs.list',actor:w.self(w.person(ALICE))}),{code:'forbidden'});
 await assert.rejects(w.dispatch(ALICE,{operation:'orgs.get',actor:w.as(w.person(ALICE),ALICE)}),{code:'not_found'});
 // Unknown organization UUIDs are refused before the writer is warmed (no account is bound).
 const ghost='dddddddd-dddd-4ddd-8ddd-dddddddddddd';await assert.rejects(w.dispatch(ghost,{operation:'orgs.get',actor:w.as(w.person(ALICE),ghost)}),{code:'not_found'});assert.equal(await w.writer(ghost).metadata.get('owner'),undefined);
 // A second initialize with another request, or a system call from another account's binding, refuses.
 await assert.rejects(w.system(org,InitializeOrganization,{request:'request-another-000001',creator:{iss:ISSUER,sub:BOB},name:'Takeover',label:'organization',plan:null,handle:null}),{code:'organization_conflict'});
 await assert.rejects(perform(w.writer(org).engine,new OrganizationTick({actor:{kind:'system',owner:BOB}})),{code:'forbidden'});
 assert.equal((await w.record(org)).ownerOfRecord.sub,ALICE);
});

test('ORG-1: the production paid port fails closed unless the operator allowlists the creator',async()=>{
 assert.deepEqual(await allowlistPlanPort(undefined).check({creator:{sub:ALICE}}),{paid:false,reason:'billing_unavailable'});
 assert.equal((await allowlistPlanPort(`${BOB}, not-a-uuid ,${ALICE.toUpperCase()}`).check({creator:{sub:ALICE}})).paid,true);
 assert.equal((await allowlistPlanPort('*').check({creator:{sub:ALICE}})).paid,false);
 assert.equal(organizationName('Å'),'Å');assert.throws(()=>organizationName('evil‮txt'),{code:'invalid_name'});assert.throws(()=>organizationName('x'.repeat(81)),{code:'invalid_name'});
});

test('ORG-1 chaos: concurrent creates keep one organization per request key and never exceed the per-person limit',async()=>{
 await forEachSeed(6,async random=>{
  const w=await world({seed:random.seed});
  try{
   const keys=Array.from({length:ORG_CREATION_LIMIT+4},(_,i)=>`request-chaos-${String(i).padStart(6,'0')}`);
   const attempts=random.shuffle([...keys,...keys.slice(0,4)]).map(request=>()=>w.create(ALICE,{request}).then(value=>({request,value})));
   const results=await concurrently(attempts);
   const ok=results.filter(r=>r.status==='fulfilled').map(r=>r.value),failed=results.filter(r=>r.status==='rejected');
   assert.ok(failed.every(r=>['organization_limit','organization_unavailable'].includes(r.reason.code)),failed.map(r=>r.reason.code||r.reason.message).join());
   const byRequest=new Map(),byId=new Map();
   for(const {request,value}of ok){const id=value.organization.id;if(byRequest.has(request))assert.equal(byRequest.get(request),id,'one organization per request key');byRequest.set(request,id);if(byId.has(id))assert.equal(byId.get(id),request,'distinct keys never share an organization');byId.set(id,request);}
   assert.ok(ok.length>=ORG_CREATION_LIMIT,'the limit admits exactly its number of keys');
   const list=await w.dispatch(ALICE,{operation:'orgs.list',actor:w.self(w.person(ALICE))});
   assert.ok(list.organizations.length+list.pending.length<=ORG_CREATION_LIMIT);
   assert.equal(new Set(list.organizations.map(o=>o.id)).size,list.organizations.length);
   for(const {id}of list.organizations){const identity=await w.identity.get(id);assert.equal(identity.kind,'organization');assert.equal(identity.status,'active');assert.equal((await w.record(id)).ownerOfRecord.sub,ALICE);}
   // Exactly one current file per organization: its bound kid is the newest issued for that entity.
   for(const {id}of list.organizations){const files=w.issued.filter(f=>f.entity===id);assert.equal((await w.repository.get(id)).recoveryFileId,files.at(-1)?.fileId??(await w.repository.get(id)).recoveryFileId);}
  }finally{await w.close();}
 });
});

test('ORG-1 chaos: rename, label, schedule and cancel race with person actions and epoch changes without losing an invariant',async()=>{
 await forEachSeed(8,async random=>{
  const w=await world({seed:random.seed});
  try{
   const {organization:{id:org}}=await w.create(ALICE);let epoch=0;
   const ops=Array.from({length:40},(_,i)=>()=>{
    const roll=random.int(10);
    if(roll===0)epoch+=1;
    const actor=w.as(w.person(random.chance(0.15)?BOB:ALICE,{epoch:random.chance(0.2)?Math.max(0,epoch-1):epoch}),org);
    if(roll<=2)return w.dispatch(org,{operation:'orgs.rename',actor,input:{name:`Name ${i}`,...random.chance(0.3)?{expectedRevision:random.int(6)+1}:{}}});
    if(roll<=4)return w.dispatch(org,{operation:'orgs.set-label',actor,input:{label:random.pick(ORG_LABELS)}});
    if(roll===5)return w.dispatch(org,{operation:'orgs.schedule-deletion',actor});
    if(roll===6)return w.dispatch(org,{operation:'orgs.cancel-deletion',actor});
    if(roll===7)return w.dispatch(ALICE,{operation:'orgs.list',actor:w.self(w.person(ALICE))});
    if(roll===8){w.clock.advance(random.int(3)*DAY);return w.system(org,OrganizationTick);}
    return w.dispatch(org,{operation:'orgs.get',actor});
   });
   const results=await concurrently(random.shuffle(ops));
   const allowed=new Set(['not_found','organization_stale','organization_deletion_pending','organization_not_pending','authority_epoch_stale','organization_deletion_due','reauthentication_required']);
   for(const r of results)if(r.status==='rejected')assert.ok(allowed.has(r.reason.code),`unexpected ${r.reason.code}: ${r.reason.message}`);
   const record=await w.record(org),audit=await w.writer(org).metadata.list({prefix:'org/audit/'});
   assert.equal(record.ownerOfRecord.sub,ALICE,'no operation changes the owner of record');assert.equal(record.initialAdmin.sub,ALICE);
   assert.ok(['active','deletion-scheduled','deletion-due'].includes(record.state));assert.equal(record.deletion===null,record.state==='active');
   assert.equal(audit.size,record.auditSeq,'one audit row per sequence number');assert.ok([...audit.values()].every(e=>!e.principal||e.principal.sub===ALICE),'no audited change by a non-member');
   assert.ok(ORG_LABELS.includes(record.label));
   const seen=await w.writer(org).metadata.get('org/principal-epoch/'+encodeURIComponent(ISSUER+' '+ALICE));assert.ok(seen===undefined||seen<=epoch);
  }finally{await w.close();}
 });
});
