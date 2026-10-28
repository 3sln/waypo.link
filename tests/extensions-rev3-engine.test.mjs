// Extensions revision 3.2 floor rules at the engine level (docs/spec/extensions.md §3–§6, §8, §9; protocol §3 owner
// floor). The connections domain (packages/app/domains/connections.mjs over packages/apps/connections.mjs) holds the
// owner's values of provider-consumable fields and the provider-feature grants; the declarations port is the provider's
// own `extensions` (packages/app/domains/provider-features.mjs). Covered: no assignment without an owner action, no
// preselection or self-preferencing in candidates, per-consumer approval with none preselected, recent authentication,
// the feature identity in grants and brokered credentials, suspension on declaration loss and resumption, revocation on
// disable / 30-day suspension / block, announcements (scope, once per (field, supplier), no self-announcement, no
// assignment), unknown-member refusal of fragments, and a seeded chaos test over declaration churn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppEngine,perform,read,AppQuery} from '../packages/app/engine.mjs';
import {memoryAudit} from '../packages/app/providers.mjs';
import {AppConnections,RECOGNIZED_FIELDS,PUBLIC_INTAKE_FRAGMENT_DOCUMENT,MESSAGING_INGRESS_FRAGMENT_DOCUMENT} from '../packages/apps/connections.mjs';
import * as C from '../packages/app/domains/connections.mjs';
import {validateIntegrationManifest} from '../packages/federation/integrations.mjs';
import {PROVIDER_EXT,EXT,declare,featureTx,featureIdentity} from '../packages/core/extensions.mjs';
import {fragmentOutcome} from '../packages/core/fragments.mjs';
import {validateSchema} from '../packages/federation/schema.mjs';
import {SUSPENSION_REVOCATION_MS} from '../packages/app/domains/provider-features.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {forEachSeed,fakeClock} from './helpers/chaos.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ISSUER='https://3sln.example',DAY=86400000;
const INTAKE=PUBLIC_INTAKE_FRAGMENT_DOCUMENT.id,INGRESS=MESSAGING_INGRESS_FRAGMENT_DOCUMENT.id;
const INTAKE_CONTRACT='https://spec.bindle.example/contracts/public-intake/v1',MAILBOX='https://spec.bindle.example/messaging/v1/contracts/mailbox';
const BRIDGE=PROVIDER_EXT.emailBridge,ADDRESS=PROVIDER_EXT.messagingAddress;
const code=c=>e=>{assert.equal(e.code,c,`expected ${c}, got ${e.code}: ${e.message}`);return true;};

function snapshot(host,{contracts=[INTAKE_CONTRACT,MAILBOX]}={}){
 const clientId=`https://${host}/bindle/client.json`,redirectUris=[`https://${host}/bindle/callback`],jwksUri=`https://${host}/bindle/jwks.json`;
 const raw={v:1,resources:{rpc_endpoint:`https://${host}/bindle/rpc`,discovery_endpoint:`https://${host}/bindle/resources`,contracts}};
 const r=validateIntegrationManifest(raw,{clientId,confidential:true,redirectUris,jwksUri});assert.equal(r.status,'valid',r.reason);
 return {client:{id:clientId,name:host},snapshot:{clientId,redirectUris,authMethod:'private_key_jwt',jwksUri,thumbprints:['A'.repeat(43)],manifest:r.manifest}};
}
async function fixture({declared=[BRIDGE,ADDRESS],blocked=[],builtins={}}={}){
 const clock=fakeClock(Date.UTC(2026,9,27,12)),metadata=new SqliteMetadata(':memory:');await metadata.put('owner',OWNER);
 const decl={list:[...declared],blocked:[...blocked],raw:null,throws:false};
 let n=0;const connections=new AppConnections({metadata,origin:ISSUER,clock:clock.now,builtins,uuid:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`,
  declarations:async()=>{if(decl.throws)throw new Error('port down');return {manifest:decl.raw??{issuer:ISSUER,extensions:decl.list.map(spec=>declare(spec))},blocked:decl.blocked};}});
 const engine=createAppEngine({providers:{clock,random:{uuid:()=>crypto.randomUUID(),bytes:k=>crypto.getRandomValues(new Uint8Array(k))},audit:memoryAudit({clock}),config:{},connections:C.connectionsProvider({connections,enabled:true,account:async()=>({status:'active'})})}});
 const owner=()=>({kind:'owner',owner:OWNER,authTime:clock.now()}),stale={kind:'owner',owner:OWNER},system={kind:'system',owner:OWNER};
 const op=(Operation,actor,input)=>{const o=new Operation({actor,...input===undefined?{}:{input}});return o instanceof AppQuery?read(engine,o):perform(engine,o);};
 const connect=async(host,options)=>op(C.ConnectIntegration,system,snapshot(host,options));
 const outbox=async()=>(await op(C.ConnectionOutbox,system,{limit:500})).events;
 const projection=feature=>op(C.FeatureResources,system,{feature});
 const severance=async()=>[...(await metadata.list({prefix:'integrations/severance/'})).values()];
 return {clock,metadata,connections,engine,owner,stale,system,op,connect,outbox,projection,severance,decl,dispose:()=>metadata.close()};
}

test('fragments: the exhaustive member table refuses unknown members (unsupported) and misapplied ones (invalid)',()=>{
 const base={id:'https://f.example/x/v1',title:'X',description:'D',publisher:'https://f.example',fields:{r:{title:'R',type:'resource',cardinality:{min:0,max:1},contracts:['https://c.example/c/v1'],selection:'exclusive',consumers:['provider'],announce:true}}};
 assert.equal(fragmentOutcome(base).status,'valid');
 for(const doc of [{...base,slot:{v:1}},{...base,extra:1},{...base,fields:{r:{...base.fields.r,failover:'pre-dispatch'}}},{...base,fields:{r:{...base.fields.r,cardinality:{min:0,max:1,step:1}}}}])assert.equal(fragmentOutcome(doc).status,'unsupported');
 assert.equal(fragmentOutcome({...base,slot:{}}).reason,'slot_member','a revision 2 slot is never processed as an ordinary field');
 const field=patch=>({...base,fields:{r:{...base.fields.r,...patch}}});
 for(const doc of [field({selection:'exclusive',cardinality:{min:0,max:2}}),field({selection:'ordered',cardinality:{min:0,max:1}}),field({selection:'ordered',cardinality:{min:0,max:9}}),field({selection:'broadcast'}),field({consumers:[]}),field({consumers:['owner']}),field({consumers:['provider','provider']}),field({announce:'yes'}),
  {...base,fields:{s:{title:'S',type:'string',maxLength:4,consumers:['application']}}},{...base,fields:{s:{title:'S',type:'string',maxLength:4,selection:'exclusive'}}},{...base,fields:{s:{title:'S',type:'enum',values:['a'],extensible:1}}},{...base,fields:{n:{title:'N',type:'integer',minimum:0.5,maximum:2}}}])
  assert.equal(fragmentOutcome(doc).status,'invalid',JSON.stringify(doc.fields));
 assert.equal(fragmentOutcome({...base,fields:{s:{title:'S',type:'enum',values:['a'],extensible:true}}}).status,'valid','`extensible` is a core member');
 assert.equal(fragmentOutcome({...base,fields:{n:{title:'N',type:'number',minimum:-0.5,maximum:2.5}}}).status,'valid');
 assert.throws(()=>validateSchema({...base,slot:{v:1}},base.id),code('unsupported_fragment'));
 assert.throws(()=>validateSchema(field({consumers:[]}),base.id),code('invalid_schema'));
 for(const doc of Object.values(RECOGNIZED_FIELDS))assert.equal(fragmentOutcome(doc).status,'valid',doc.id);
});

test('floor: connections never assign; candidates are neutral, unpreselected, from recorded contracts only',async t=>{
 const f=await fixture({builtins:{intake:{name:'3sln.me intake',manifest:{v:1,resources:{contracts:[INTAKE_CONTRACT]}}}}});t.after(f.dispose);
 const z=await f.connect('zeta.example'),a=await f.connect('alpha.example'),none=await f.connect('none.example',{contracts:['https://other.example/c/v1']});
 const built=await f.op(C.ConnectBuiltIn,f.owner(),{integration:'intake'});
 const fields=await f.op(C.FieldList,f.owner());
 for(const field of fields)assert.deepEqual(field.values,[],'no declaration, connection or built-in fills a field');
 const {candidates}=await f.op(C.FieldCandidates,f.owner(),{fragment:INTAKE});
 assert.deepEqual(candidates.map(c=>c.connection),[a.id,z.id,built.id].sort((x,y)=>{const o=c=>candidates.find(k=>k.connection===c).origin;return o(x)<o(y)?-1:o(x)>o(y)?1:x<y?-1:1;}),'neutral order by origin');
 assert.ok(!candidates.some(c=>c.connection===none.id),'contracts must cover the field');
 assert.ok(candidates.every(c=>!Object.hasOwn(c,'selected')&&!Object.hasOwn(c,'default')),'nothing is preselected');
 const builtIn=candidates.find(c=>c.builtIn);assert.equal(builtIn.kind,'built-in');assert.equal(builtIn.claimed,false);
 assert.ok(candidates.filter(c=>!c.builtIn).every(c=>c.claimed===true&&c.labelSupplied===true),'supplier claims and labels are marked');
 // Only the owner assigns; a system actor cannot.
 await assert.rejects(f.op(C.AssignField,f.system,{fragment:INTAKE,connection:a.id}),code('forbidden'));
 await assert.rejects(f.op(C.AssignField,f.owner(),{fragment:INTAKE,connection:none.id}),code('not_a_candidate'));
 const v=await f.op(C.AssignField,f.owner(),{fragment:INTAKE,connection:a.id});assert.equal(v.values[0].connection,a.id);
 await assert.rejects(f.op(C.AssignField,f.owner(),{fragment:INTAKE,connection:z.id}),code('field_filled'),'a new connection never displaces the value');
});

test('provider features: enabling is owner consent with recent authentication; identity is (issuer, spec URL)',async t=>{
 const f=await fixture();t.after(f.dispose);const a=await f.connect('alpha.example');
 assert.equal((await f.projection(BRIDGE)).live,false,'not enabled: no projection');
 await assert.rejects(f.op(C.EnableFeature,f.stale,{feature:BRIDGE}),code('reauthentication_required'));
 await assert.rejects(f.op(C.EnableFeature,f.system,{feature:BRIDGE}),code('forbidden'));
 await assert.rejects(f.op(C.EnableFeature,f.owner(),{feature:'https://3sln.me/extensions/unknown/v1'}),code('not_found'));
 // Filling the empty field on the same screen.
 const on=await f.op(C.EnableFeature,f.owner(),{feature:BRIDGE,assign:{connection:a.id}});
 assert.equal(on.state,'active');assert.equal(on.host,'3sln.me');assert.equal(on.title,'Email to your messaging app');assert.equal(on.approved.length,1);
 const p=await f.projection(BRIDGE);assert.equal(p.live,true);assert.equal(p.resources.length,1);assert.equal(p.resources[0].grant,on.grant);
 assert.equal(featureIdentity(ISSUER,BRIDGE),`feature:${ISSUER}|${BRIDGE}`);
 const tx=await featureTx(BRIDGE,INTAKE_CONTRACT,OWNER,'fp');assert.match(tx,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.equal(tx,await featureTx(BRIDGE,INTAKE_CONTRACT,OWNER,'fp'));assert.notEqual(tx,await featureTx(ADDRESS,INTAKE_CONTRACT,OWNER,'fp'),'two features never share a tx');
 // Another feature never sees this grant.
 assert.equal((await f.projection(ADDRESS)).live,false);
});

test('per-consumer approval: adding or replacing a resource approves no feature unless the owner ticks it',async t=>{
 const f=await fixture();t.after(f.dispose);const a=await f.connect('alpha.example'),b=await f.connect('beta.example');
 await f.op(C.AssignField,f.owner(),{fragment:INTAKE,connection:a.id});
 const on=await f.op(C.EnableFeature,f.owner(),{feature:BRIDGE});assert.equal(on.approved.length,1,'enabling consents to the current value');
 await assert.rejects(f.op(C.AssignField,f.stale,{fragment:INTAKE,connection:b.id,replace:true}),code('reauthentication_required'),'replacing in a feature-consumed field needs recent authentication');
 await assert.rejects(f.op(C.AssignField,f.owner(),{fragment:INTAKE,connection:b.id,replace:true,approve:[ADDRESS]}),code('invalid_request'),'only features that use this field');
 await f.op(C.AssignField,f.owner(),{fragment:INTAKE,connection:b.id,replace:true});
 const p=await f.projection(BRIDGE);assert.equal(p.live,true);assert.deepEqual(p.resources,[],'the replacement is not approved for the bridge');assert.notEqual(p.grant,on.grant,'the value change issues a new grant');
 // Removing needs no reauthentication; reapproval is explicit.
 const field=(await f.op(C.FieldList,f.owner())).find(x=>x.fragment===INTAKE);
 await f.op(C.UnassignField,f.stale,{fragment:INTAKE,seat:field.values[0].seat});
 await f.op(C.AssignField,f.owner(),{fragment:INTAKE,connection:b.id,approve:[BRIDGE]});
 assert.equal((await f.projection(BRIDGE)).resources[0].clientId,b.client?.id??'https://beta.example/bindle/client.json');
});

test('suspension on declaration loss, resumption on the same spec URL, revocation after 30 days and on disable or block',async t=>{
 const f=await fixture();t.after(f.dispose);const a=await f.connect('alpha.example');
 const on=await f.op(C.EnableFeature,f.owner(),{feature:BRIDGE,assign:{connection:a.id}});
 f.decl.list=[ADDRESS];
 let p=await f.projection(BRIDGE);assert.equal(p.live,false,'suspended at once');assert.equal(p.state,'suspended');
 let view=(await f.op(C.FeatureList,f.owner())).find(x=>x.feature===BRIDGE);assert.equal(view.state,'suspended');assert.equal(view.approved.length,1,'grant records and values are kept');
 await assert.rejects(f.op(C.EnableFeature,f.owner(),{feature:BRIDGE}),code('feature_unavailable'));
 // A different version of the line resumes nothing.
 f.decl.raw={issuer:ISSUER,extensions:[declare('https://3sln.me/extensions/email-bridge/v2')]};
 assert.equal((await f.projection(BRIDGE)).live,false);f.decl.raw=null;
 f.decl.list=[BRIDGE,ADDRESS];f.clock.advance(5*DAY);
 p=await f.projection(BRIDGE);assert.equal(p.live,true,'resumes');assert.equal(p.grant,on.grant,'bound to the values it was approved under');
 // 30 days of continuous suspension revokes.
 f.decl.list=[];await f.op(C.FeatureSync,f.system);f.clock.advance(SUSPENSION_REVOCATION_MS-1);await f.op(C.FeatureSync,f.system);
 assert.equal((await f.op(C.FeatureList,f.owner())).find(x=>x.feature===BRIDGE).state,'suspended');
 f.clock.advance(1);await f.op(C.FeatureSync,f.system);
 view=(await f.op(C.FeatureList,f.owner())).find(x=>x.feature===BRIDGE);assert.equal(view.state,'revoked');assert.equal(view.reason,'suspension-expired');
 f.decl.list=[BRIDGE];assert.equal((await f.projection(BRIDGE)).live,false,'a revoked grant never resumes');
 const notices=(await f.op(C.NoticeList,f.owner())).notices.map(n=>n.kind);assert.ok(notices.includes('feature-suspended')&&notices.includes('feature-revoked'),'the owner is told');
 // Re-enabling is a new consent with a new grant; disabling revokes at once (no reauthentication).
 const again=await f.op(C.EnableFeature,f.owner(),{feature:BRIDGE});assert.notEqual(again.grant,on.grant);
 const off=await f.op(C.DisableFeature,f.stale,{feature:BRIDGE});assert.equal(off.state,'revoked');assert.equal(off.reason,'disabled');
 // Blocking revokes.
 const third=await f.op(C.EnableFeature,f.owner(),{feature:BRIDGE});assert.equal(third.state,'active');
 f.decl.blocked=[BRIDGE];assert.equal((await f.projection(BRIDGE)).live,false);
 assert.equal((await f.op(C.FeatureList,f.owner())).find(x=>x.feature===BRIDGE).reason,'blocked');
 await assert.rejects(f.op(C.EnableFeature,f.owner(),{feature:BRIDGE}),code('feature_blocked'));
 const events=(await f.outbox()).map(e=>e.type);for(const type of ['feature-enabled','feature-suspended','feature-resumed','feature-revoked'])assert.ok(events.includes(type),type);
 // A failing declarations port reads as "not declared": the feature is suspended, never left live.
 f.decl.blocked=[];f.decl.list=[BRIDGE,ADDRESS];await f.op(C.EnableFeature,f.owner(),{feature:ADDRESS});f.decl.throws=true;
 assert.equal((await f.projection(ADDRESS)).live,false);
});

test('announcements: post-connection, owner-only, once per (field, supplier), never for built-ins, never assign',async t=>{
 const f=await fixture({builtins:{intake:{name:'3sln.me intake',manifest:{v:1,resources:{contracts:[INTAKE_CONTRACT]}}}}});t.after(f.dispose);
 await f.connect('early.example');
 assert.deepEqual((await f.op(C.NoticeList,f.owner())).notices,[],'nothing is announced while no enabled consumer uses the field');
 const first=await f.connect('first.example');await f.op(C.EnableFeature,f.owner(),{feature:BRIDGE,assign:{connection:first.id}});
 await f.connect('second.example');await f.op(C.ConnectBuiltIn,f.owner(),{integration:'intake'});
 let notices=(await f.op(C.NoticeList,f.owner())).notices.filter(n=>n.kind==='announcement');
 assert.equal(notices.length,1,'one announcement for the new external supplier; none for the built-in');
 const n=notices[0];assert.equal(n.fragment,INTAKE);assert.equal(n.supplier.origin,'https://second.example');assert.equal(n.template,'candidate-available');
 assert.equal(n.claimed,true);assert.deepEqual(n.consumers.map(c=>[c.feature,c.host]),[[BRIDGE,'3sln.me']]);
 assert.ok(!JSON.stringify(n).includes(PUBLIC_INTAKE_FRAGMENT_DOCUMENT.title)&&!JSON.stringify(n).includes('Receiving app'),'no fragment or field titles in the wording');
 // The ingress field has no enabled consumer: never announced.
 assert.ok(!notices.some(x=>x.fragment===INGRESS));
 // Reconnecting the same supplier is not announced again; turning announcements back on resets it.
 const second=(await f.op(C.ConnectionList,f.owner())).connections.find(c=>c.clientId.startsWith('https://second.example'));
 await f.op(C.DisconnectConnection,f.owner(),{connection:second.id});await f.connect('second.example');
 notices=(await f.op(C.NoticeList,f.owner())).notices.filter(x=>x.kind==='announcement');assert.equal(notices.length,1,'at most once per (field, supplier)');
 await f.op(C.SetAnnouncements,f.owner(),{fragment:INTAKE,enabled:false});await f.op(C.SetAnnouncements,f.owner(),{fragment:INTAKE,enabled:true});
 await f.connect('third.example');
 notices=(await f.op(C.NoticeList,f.owner())).notices.filter(x=>x.kind==='announcement');assert.equal(notices.length,2);
 // An announcement never assigns or grants.
 const field=(await f.op(C.FieldList,f.owner())).find(x=>x.fragment===INTAKE);assert.equal(field.values.length,1);assert.equal(field.values[0].connection,first.id);
 assert.equal((await f.projection(BRIDGE)).resources.length,1);
 // Owner-only: no system read.
 await assert.rejects(f.op(C.NoticeList,f.system),code('forbidden'));
});

test('no occupancy oracle: an application request for a provider-only field is refused from the public fragment',async()=>{
 const {FederationService}=await import('../packages/federation/service.mjs');
 const doc=PUBLIC_INTAKE_FRAGMENT_DOCUMENT,store={transaction:fn=>fn({get:async()=>undefined,set:async()=>{},list:async()=>[],delete:async()=>{}})};
 const s=Object.create(FederationService.prototype,{artefactVersions:{value:false},schema:{value:async()=>({schema:doc,digest:'d'})}});
 await assert.rejects(s.pinRequests([{fragment:doc.id,required:true,purpose:'P',fields:['intake'],methods:{intake:{[INTAKE_CONTRACT]:['deliver']}}}]),code('invalid_request'));
 await assert.rejects(s.pinRequests([{fragment:doc.id,required:true,purpose:'P',fields:['intake'],options:{x:[1]}}]),code('invalid_args'),'AMD-X1 request options are gone');
 void store;
});

test('chaos: declaration churn (present, absent, duplicated, other version, invalid, blocked) suspends and revokes correctly',async()=>{
 await forEachSeed(12,async random=>{
  const f=await fixture();try{
   const a=await f.connect('alpha.example');let model={state:'active',suspendedAt:null};
   await f.op(C.EnableFeature,f.owner(),{feature:BRIDGE,assign:{connection:a.id}});
   for(let step=0;step<40;step++){
    const kind=random.pick(['valid','valid','absent','duplicate','version','invalid','blocked','advance','advance-long']);
    f.decl.raw=null;f.decl.blocked=[];
    if(kind==='valid')f.decl.list=[BRIDGE];
    else if(kind==='absent')f.decl.list=[];
    else if(kind==='duplicate')f.decl.raw={issuer:ISSUER,extensions:[declare(BRIDGE),declare(BRIDGE)]};
    else if(kind==='version')f.decl.raw={issuer:ISSUER,extensions:[declare(BRIDGE),declare('https://3sln.me/extensions/email-bridge/v2')]};
    else if(kind==='invalid')f.decl.raw={issuer:ISSUER,extensions:[{spec:BRIDGE,options:'not-an-object'}]};
    else if(kind==='blocked'){f.decl.list=[BRIDGE];f.decl.blocked=[BRIDGE];}
    else{f.clock.advance(kind==='advance'?random.int(3)*DAY:SUSPENSION_REVOCATION_MS);continue;}
    const valid=kind==='valid',now=f.clock.now();
    // Reference model of extensions §4.2.
    if(model.state!=='revoked'){
     if(kind==='blocked')model={state:'revoked',suspendedAt:null};
     else if(model.state==='suspended'&&now-model.suspendedAt>=SUSPENSION_REVOCATION_MS)model={state:'revoked',suspendedAt:null};
     else if(model.state==='active'&&!valid)model={state:'suspended',suspendedAt:now};
     else if(model.state==='suspended'&&valid)model={state:'active',suspendedAt:null};
     if(model.state==='suspended'&&now-model.suspendedAt>=SUSPENSION_REVOCATION_MS)model={state:'revoked',suspendedAt:null};
    }
    const p=await f.projection(BRIDGE);
    assert.equal(p.state,model.state,`step ${step} ${kind}`);
    assert.equal(p.live,model.state==='active',`live at step ${step}`);
    if(!p.live)assert.deepEqual(p.resources,[],'a suspended or revoked feature sees no resources');
    if(model.state==='revoked'){if(random.chance(0.5)){f.decl.list=[BRIDGE];f.decl.raw=null;f.decl.blocked=[];await f.op(C.EnableFeature,f.owner(),{feature:BRIDGE});model={state:'active',suspendedAt:null};}}
   }
  }finally{f.dispose();}
 });
});

test('brokered credentials: disabling, a value change and suspension expiry revoke credentials minted under the feature grant',async t=>{
 const f=await fixture();t.after(f.dispose);const a=await f.connect('alpha.example');
 // A brokered record for the intake field (registered by the owner through discovery; written directly here).
 const record='11111111-1111-4111-8111-111111111111';await f.metadata.put('integrations/record/'+record,{v:1,id:record,owner:OWNER,connection:a.id,clientId:a.clientId,generation:a.generation,resource:'https://alpha.example/r/intake',contracts:[INTAKE_CONTRACT],status:'available',assignments:[]});
 const on=await f.op(C.EnableFeature,f.owner(),{feature:BRIDGE,assign:{connection:a.id,resource:record}});
 assert.equal((await f.projection(BRIDGE)).resources[0].resource,record);
 const off=await f.op(C.DisableFeature,f.owner(),{feature:BRIDGE});assert.equal(off.state,'revoked');
 let rows=await f.severance();assert.deepEqual(rows.map(r=>[r.type,r.connection,r.resource,r.grants]),[['feature-revoked',a.id,'https://alpha.example/r/intake',[on.grant]]]);
 const again=await f.op(C.EnableFeature,f.owner(),{feature:BRIDGE});const field=(await f.op(C.FieldList,f.owner())).find(x=>x.fragment===INTAKE);
 await f.op(C.UnassignField,f.owner(),{fragment:INTAKE,seat:field.values[0].seat});
 rows=await f.severance();assert.ok(rows.some(r=>r.type==='feature-regranted'&&r.grants[0]===again.grant),'a value change revokes the old grant');
 assert.notEqual((await f.op(C.FeatureList,f.owner())).find(x=>x.feature===BRIDGE).grant,again.grant);
});
