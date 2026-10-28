// Extensions revision 3.2 (docs/spec/extensions.md §2, §3; protocol §2): `{spec, options}` declarations processed with
// bundled descriptors (packages/core/extensions.mjs), manifest emission through MANIFEST_DECLARATIONS
// (packages/runtime/federation.mjs, packages/federation/runtime.mjs), the gated engine Queries, and the selection state
// machine over field attributes (packages/federation/extensions.mjs). Revision 2 slot tests were rewritten here and in
// tests/extensions-rev3-engine.test.mjs (fragment attributes, provider features, floor rules, chaos).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EXT,PROVIDER_EXT,BINDLE_DESCRIPTORS,PROVIDER_DESCRIPTORS,BINDLE_REGISTRY,readExtensions,parseSpecURL,validateDescriptor,descriptorRegistry,withExtensionEntries,declare,EXTENSION_LIMITS} from '../packages/core/extensions.mjs';
import {createFieldOperation,nextFieldDispatch,recordFieldOutcome,fieldOperationResult,createExtensionsProvider,ExtensionDeclarations,FieldAttributes,FieldSelection,PROVIDER_REGISTRY} from '../packages/federation/extensions.mjs';
import {createManifestDeclarationProvider,withManifestDeclarations} from '../packages/federation/runtime.mjs';
import {MANIFEST_DECLARATIONS,federationDeclarations} from '../packages/runtime/federation.mjs';
import {createAppEngine,read} from '../packages/app/engine.mjs';
import {memoryAudit} from '../packages/app/providers.mjs';
import {fakeClock} from './helpers/chaos.mjs';

const ISS='https://p.example',code=c=>e=>{assert.equal(e.code,c,`expected ${c}, got ${e.code}`);return true;};
const floor={version:'0',issuer:ISS,authorization_request_endpoint:ISS+'/api/oauth/requests',token_endpoint:ISS+'/oauth/token',rpc_endpoint:ISS+'/bindle/rpc',revocation_endpoint:ISS+'/oauth/revoke'};
const read$=(extensions,extra={})=>readExtensions({...floor,...extra,extensions});
const keys=r=>[...r.extensions.keys()];
const entry={spec:EXT.authorizationEntry,options:{endpoint:ISS+'/api/oauth/entries',intents:['login']}};

test('spec URLs: versioned last segment, HTTPS, bounded, no query, fragment or userinfo',()=>{
 assert.deepEqual(parseSpecURL('https://x.example/ext/widgets/v12'),{line:'https://x.example/ext/widgets',version:12});
 for(const bad of ['https://x.example/ext/widgets','https://x.example/v1','http://x.example/a/v1','https://x.example/a/v0','https://x.example/a/v1000','https://u@x.example/a/v1','https://x.example/a/v1?x','https://x.example/a/v1#x','https://x.example/'+'a'.repeat(260)+'/v1',7,null])assert.equal(parseSpecURL(bad),null,String(bad));
});

test('descriptors: every bundled descriptor validates; unknown members, attributes and bad endpoints are refused',async()=>{
 for(const d of [...BINDLE_DESCRIPTORS,...PROVIDER_DESCRIPTORS]){validateDescriptor(d);
  // The JSON artefacts under docs/artefacts/extensions mirror the bundled descriptors exactly.
  const name=new URL(d.id).pathname.split('/').at(-2);assert.deepEqual(JSON.parse(await readFile(new URL(`../docs/artefacts/extensions/${name}-v1.json`,import.meta.url))),structuredClone(d),name);}
 const base={id:'https://x.example/e/v1',title:'T',description:'D',options:{}};
 for(const bad of [{...base,publisher:'https://x.example'},{...base,requires:[]},{...base,id:'https://x.example/e'},{...base,title:''},{...base,options:{r:{title:'R',type:'resource',contracts:['https://c.example/c/v1']}}},{...base,options:{u:{title:'U',type:'url',maxLength:9,selection:'exclusive'}}},{...base,options:{s:{title:'S',type:'string',maxLength:9,endpoint:'audience'}}},{...base,options:{u:{title:'U',type:'url',maxLength:9,endpoint:'both'}}},{...base,options:{e:{title:'E',type:'enum',values:['a'],extensible:true}}}])
  assert.throws(()=>validateDescriptor(bad),TypeError,JSON.stringify(bad));
 assert.throws(()=>descriptorRegistry([base,base]),TypeError,'one descriptor per spec URL');
});

test('processing: unknown and invalid specs ignored; duplicates and two versions of a line are all absent',()=>{
 let r=read$([entry,{spec:'https://x.example/unknown/v1'},{spec:'nope'},'string',{spec:EXT.integrations}]);
 assert.deepEqual(keys(r),[EXT.authorizationEntry,EXT.integrations]);assert.equal(r.ignored,3);
 r=read$([entry,entry,{spec:EXT.integrations}]);assert.deepEqual(keys(r),[EXT.integrations]);assert.deepEqual(r.absent.map(a=>a.reason),['duplicate','duplicate']);
 r=read$([entry,{spec:EXT.authorizationEntry.replace(/v1$/,'v2')},{spec:EXT.integrations}]);assert.deepEqual(keys(r),[EXT.integrations],'a second version of the line, even unimplemented, makes the line absent');
 assert.deepEqual(keys(read$(Array.from({length:EXTENSION_LIMITS.entries+1},()=>({spec:EXT.integrations})))),[],'an oversized container is ignored as a whole');
 assert.deepEqual(keys(read$([{spec:EXT.integrations,options:{pad:'x'.repeat(EXTENSION_LIMITS.entryBytes)}}])),[],'an entry over 4 KiB is ignored');
 assert.deepEqual(keys(read$({not:'an array'})),[]);assert.deepEqual(keys(readExtensions({...floor})),[]);
 // Clean break: revision 2 containers mean nothing.
 assert.deepEqual(keys(readExtensions({...floor,features:{'authorization-entry.v1':entry.options},profiles:{'https://3sln.me/artefacts/profiles/components/v1':{}}})),[]);
 assert.deepEqual(keys(read$([{slot:'https://x.example/slots/s/v1',role:'occupant',ref:'r'}])),[],'revision 2 entries lack `spec`');
});

test('options: scalar and array shapes, absence only with min 0, unknown members ignored, known members failing make the entry absent',()=>{
 const o=opts=>read$([{spec:EXT.authorizationEntry,options:opts}]).extensions.get(EXT.authorizationEntry)??null;
 assert.deepEqual(o({...entry.options,future:1}),entry.options,'unknown option members are ignored and dropped');
 for(const bad of [{endpoint:entry.options.endpoint},{intents:['login']},{...entry.options,intents:'login'},{...entry.options,intents:[]},{...entry.options,intents:['login','login']},{...entry.options,intents:['teleport']},{...entry.options,endpoint:'https://other.example/e'},{...entry.options,endpoint:[entry.options.endpoint]}])assert.equal(o(bad),null,JSON.stringify(bad));
 assert.deepEqual(read$([{spec:EXT.integrations}]).extensions.get(EXT.integrations),{},'options absent means {}');
 assert.equal(read$([{spec:EXT.integrations,options:[]}]).extensions.get(EXT.integrations),undefined);
 const kd=v=>read$([{spec:EXT.keyDelegation,options:{max_certificate_seconds:v}}]).extensions.get(EXT.keyDelegation)??null;
 assert.ok(kd(660));assert.equal(kd(59),null);assert.equal(kd(660.5),null);assert.equal(kd('660'),null);
});

test('endpoints: issuer origin, audience distinctness (every colliding entry invalid), shared public endpoints, the embed_origin exemption',()=>{
 const relations=(accept,join)=>({spec:EXT.relations,options:{accept_endpoint:accept,join_endpoint:join}});
 assert.deepEqual(keys(read$([relations(ISS+'/a',ISS+'/a')])),[],'audience endpoints differ within an entry');
 assert.deepEqual(keys(read$([relations(ISS+'/bindle/rpc',ISS+'/j')])),[],'an audience endpoint equal to a flat one is invalid');
 const r=read$([relations(ISS+'/x',ISS+'/j'),{spec:EXT.signaling,options:{endpoint:ISS+'/x',max_leg_certificate_seconds:600,profiles:['data','webrtc']}},{spec:EXT.directory,options:{directory_url:ISS+'/d'}},{spec:EXT.artefactVersions}]);
 assert.deepEqual(keys(r).sort(),[EXT.artefactVersions,EXT.directory].sort(),'both colliding entries are invalid');assert.deepEqual(r.absent.map(a=>a.reason),['audience','audience']);
 const shared=read$([{spec:EXT.appRemoval,options:{jwks_uri:ISS+'/jwks',return_uri:ISS+'/r'}},{spec:EXT.integrations},{spec:EXT.brokeredResources,options:{jwks_uri:ISS+'/jwks',preferences_contract:'https://3sln.me/artefacts/contracts/preferences/v2'}}]);
 assert.deepEqual(keys(shared).sort(),[EXT.appRemoval,EXT.brokeredResources,EXT.integrations].sort(),'one key set serves two extensions');
 const embed=origin=>read$([{spec:EXT.embeddedComponents,options:{embed_origin:origin,protocol:[1],parts:['avatar/1']}}]).extensions.has(EXT.embeddedComponents);
 assert.equal(embed('https://embed.other.example'),true,'embed_origin is exempt from the issuer-origin rule');
 assert.equal(read$([{spec:EXT.embeddedComponents,options:{embed_origin:'https://embed.other.example',protocol:[1],parts:['avatar/1'],manage_url:'https://embed.other.example/m'}}]).extensions.has(EXT.embeddedComponents),false,'for that option only');
 // A non-endpoint URL option is an opaque identifier and may name another host.
 assert.ok(read$([{spec:EXT.integrations},{spec:EXT.brokeredResources,options:{jwks_uri:ISS+'/k',preferences_contract:'https://other.example/contracts/preferences/v2'}}]).extensions.has(EXT.brokeredResources));
 assert.equal(readExtensions({...floor,extensions:[{spec:EXT.fedcm,options:{config_url:'http://localhost:8787/f'}},entry]},{issuer:'http://localhost:8787'}).extensions.has(EXT.fedcm),false,'insecure only when allowed');
});

test('prerequisites: non-recursive presence of exactly one entry; the dependent extension is absent without it',()=>{
 const fedcm={spec:EXT.fedcm,options:{config_url:ISS+'/f'}};
 assert.deepEqual(keys(read$([fedcm])),[]);assert.equal(read$([fedcm]).absent[0].reason,'prerequisite');
 assert.deepEqual(keys(read$([fedcm,entry])).sort(),[EXT.authorizationEntry,EXT.fedcm].sort());
 // Presence only: an invalid prerequisite entry still satisfies the check (it need not be implemented or valid).
 assert.ok(read$([fedcm,{spec:EXT.authorizationEntry,options:{endpoint:'https://other.example/e',intents:['login']}}]).extensions.has(EXT.fedcm));
 assert.equal(read$([fedcm,entry,entry]).extensions.has(EXT.fedcm),false,'exactly one entry');
});

test('emission: rows emit one entry per extension, built-in contracts, and duplicates fail closed at composition',()=>{
 const provider=registry=>createManifestDeclarationProvider({registry,context:{issuer:ISS,target:'authority',mounts:{}}});
 const rows=[{flag:'A',mounted:()=>true,declare:()=>({extensions:[declare(EXT.integrations)],contracts:['https://c.example/a/v1']})},{flag:'B',mounted:()=>true,declare:()=>({contracts:['https://c.example/a/v1','https://c.example/b/v1']})}];
 assert.deepEqual(provider(rows).declarations({A:true,B:'true'}),{extensions:[{spec:EXT.integrations}],contracts:['https://c.example/a/v1','https://c.example/b/v1']});
 assert.deepEqual(provider(rows).declarations({A:true}),{extensions:[{spec:EXT.integrations}],contracts:['https://c.example/a/v1']});
 assert.throws(()=>provider([...rows,{flag:'A',mounted:()=>true,declare:()=>({extensions:[declare(EXT.integrations)]})}]).declarations({A:true}),TypeError);
 assert.throws(()=>provider([{flag:'A',mounted:()=>true,declare:()=>({features:{'x.v1':{}}})}]).declarations({A:true}),TypeError,'no features container');
 assert.throws(()=>withManifestDeclarations(floor,{profiles:{}}),TypeError);
 assert.deepEqual(withExtensionEntries({extensions:[{spec:EXT.portability,options:{move_endpoint:ISS+'/m'}}]},[declare(EXT.portability,{transfer_in_endpoint:ISS+'/t'})],{merge:true}).extensions,[{spec:EXT.portability,options:{move_endpoint:ISS+'/m',transfer_in_endpoint:ISS+'/t'}}]);
 for(const row of MANIFEST_DECLARATIONS)assert.ok(row.declare.length<=1&&typeof row.mounted==='function');
});

test('emission: the real rows produce entries every processor accepts, behind flags and mounts only',()=>{
 const config={APP_ORIGIN:ISS,APP_CLEAN_REMOVAL_ENABLED:'true',INTEGRATION_EVENT_PORTS:{signer:{sign(){}}},INTEGRATIONS_ENABLED:'true',BROKERING_ENABLED:'true',SUBJECT_DELETED_EVENTS_ENABLED:'true',ORG_RELATIONS_ENABLED:'true',ORG_FOREIGN_RELATIONS_ENABLED:'true',DEVICE_AUTHORIZATION_ENABLED:'true'};
 const out=federationDeclarations(config,{target:'authority',mounts:{integrations:true,brokeredResources:true,relations:true,deviceAuthorization:true}});
 assert.equal(out.features,undefined);assert.equal(out.profiles,undefined);
 const r=readExtensions({...floor,...out,device_authorization_endpoint:out.device_authorization_endpoint},{registry:PROVIDER_REGISTRY});
 assert.deepEqual(r.absent,[]);assert.deepEqual(keys(r).sort(),[EXT.appRemoval,EXT.subjectDeleted,EXT.integrations,EXT.relations,EXT.brokeredResources,EXT.deviceAuthorization].sort());
 assert.deepEqual(federationDeclarations({APP_ORIGIN:ISS},{target:'authority',mounts:{integrations:true,brokeredResources:true}}),{},'flags off: nothing is declared');
 assert.deepEqual(federationDeclarations({...config},{target:'authority',mounts:{}}).extensions?.map(e=>e.spec)??[],[EXT.appRemoval],'flags without mounts declare nothing else');
 // The provider's own feature extensions need EXTENSIONS_ENABLED and their own mounted evidence.
 assert.ok(!out.extensions.some(e=>Object.values(PROVIDER_EXT).includes(e.spec)));
});

test('engine harness: declaration, field-attribute and selection Queries are gated by EXTENSIONS_ENABLED',async t=>{
 const make=async flag=>{const clock=fakeClock(0),e=createAppEngine({providers:{clock,random:{uuid:()=>crypto.randomUUID()},audit:memoryAudit({clock}),config:{EXTENSIONS_ENABLED:flag},extensions:createExtensionsProvider()}});t.after(()=>e.dispose());return e;};
 const off=await make(false);await assert.rejects(read(off,new ExtensionDeclarations({input:{manifest:{...floor,extensions:[entry]}}})),code('extensions_disabled'));
 const on=await make(true),d=await read(on,new ExtensionDeclarations({input:{manifest:{...floor,extensions:[entry,{spec:PROVIDER_EXT.emailBridge}]}}}));
 assert.deepEqual(Object.keys(d.extensions).sort(),[EXT.authorizationEntry,PROVIDER_EXT.emailBridge].sort());
 assert.equal((await read(on,new FieldAttributes({input:{field:{title:'R',type:'resource',contracts:['https://c.example/c/v1'],selection:'exclusive'}}}))).status,'valid','exclusive defaults to cardinality max 1');
 assert.equal((await read(on,new FieldSelection({input:{field:{title:'R',type:'resource',cardinality:{min:0,max:2},contracts:['https://c.example/c/v1'],selection:'ordered'},resources:[]}}))).selection,'ordered');
});

const FIELD=(selection,max,consumers)=>({title:'F',type:'resource',cardinality:{min:0,max},contracts:['https://c.example/c/v1'],...selection?{selection}:{},...consumers?{consumers}:{}});
const ok=id=>({id,status:'available',credentialCurrent:true});
const TX=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('selection: exclusive invokes the single resource; an empty field is unfilled; policy never advances',()=>{
 assert.equal(fieldOperationResult(createFieldOperation(FIELD('exclusive',1),undefined)).status,'unfilled');
 let s=createFieldOperation(FIELD('exclusive',1),ok('a'));let {state,dispatch}=nextFieldDispatch(s,{tx:TX(1)});assert.equal(dispatch.resource.id,'a');
 state=recordFieldOutcome(state,{tx:TX(1),httpStatus:404});assert.equal(nextFieldDispatch(state,{tx:TX(2)}).dispatch,null,'exclusive never fails over');
 s=createFieldOperation(FIELD('exclusive',1),{...ok('a'),credentialCurrent:false});assert.equal(nextFieldDispatch(s,{tx:TX(1)}).dispatch,null);assert.equal(fieldOperationResult(s).status,'unavailable');
 assert.throws(()=>createFieldOperation(FIELD('exclusive',1),[ok('a'),ok('b')]),code('invalid_resources'));
});

test('selection: ordered follows owner order, skips unavailable resources, needs a fresh tx per switch, advances only pre-dispatch',()=>{
 const base=createFieldOperation(FIELD('ordered',3),[{...ok('a'),status:'unavailable'},ok('b'),ok('c')]);
 let {state,dispatch}=nextFieldDispatch(base,{tx:TX(1)});assert.equal(dispatch.resource.id,'b');
 assert.equal(nextFieldDispatch(state,{tx:TX(2)}).dispatch,null,'nothing while an attempt is outstanding');
 for(const failure of [{httpStatus:401},{httpStatus:403},{httpStatus:404},{httpStatus:429},{code:'unsupported_contract'},{code:'unsupported_method'},{code:'forbidden'},{code:'not_found'},{code:'rate_limited'},{code:'temporarily_unavailable'},{bytesSent:false}]){
  const next=nextFieldDispatch(recordFieldOutcome(state,{tx:TX(1),...failure}),{tx:TX(2)});assert.equal(next.dispatch?.resource.id,'c',JSON.stringify(failure));
  assert.throws(()=>nextFieldDispatch(recordFieldOutcome(state,{tx:TX(1),...failure}),{tx:TX(1)}),code('invalid_tx'),'a fresh tx for every resource');}
 for(const ambiguous of [{httpStatus:500},{httpStatus:502},{code:'indeterminate'},{code:'conflict'},{}]){
  const after=recordFieldOutcome(state,{tx:TX(1),...ambiguous});assert.equal(nextFieldDispatch(after,{tx:TX(2)}).dispatch,null,JSON.stringify(ambiguous));assert.equal(fieldOperationResult(after).status,'unknown');}
 const done=recordFieldOutcome(state,{tx:TX(1),ok:true});assert.equal(nextFieldDispatch(done,{tx:TX(2)}).dispatch,null);assert.equal(fieldOperationResult(done).status,'succeeded');
 // A removal while an outcome is outstanding is reported unknown, and nothing is dispatched elsewhere.
 const removed=nextFieldDispatch(state,{tx:TX(3),removed:['b']});assert.equal(removed.dispatch,null);assert.equal(fieldOperationResult(removed.state).status,'unknown');
});

test('selection: consumers and live enablement; a field without a policy has no failover',()=>{
 assert.throws(()=>createFieldOperation(FIELD('ordered',2),[],{consumer:'provider'}),code('unsupported_consumer'),'default consumers are applications only');
 const p=createFieldOperation(FIELD('ordered',2,['provider']),[ok('a'),ok('b')],{consumer:'provider'});assert.equal(nextFieldDispatch(p,{tx:TX(1)}).dispatch,null,'a feature that is not live never dispatches');
 assert.equal(nextFieldDispatch(p,{tx:TX(1),featureLive:true}).dispatch.resource.id,'a');
 assert.throws(()=>createFieldOperation(FIELD('ordered',2,['provider']),[],{consumer:'application'}),code('unsupported_consumer'));
 const none=createFieldOperation(FIELD(null,2),[ok('a'),ok('b')]);const first=nextFieldDispatch(none,{tx:TX(1)});
 assert.equal(nextFieldDispatch(recordFieldOutcome(first.state,{tx:TX(1),httpStatus:404}),{tx:TX(2)}).dispatch,null);
 assert.throws(()=>createFieldOperation({title:'S',type:'string',maxLength:3},[]),code('invalid_field'));
 assert.ok(BINDLE_REGISTRY.has(EXT.authorizationEntry)&&PROVIDER_REGISTRY.has(PROVIDER_EXT.emailBridge)&&!BINDLE_REGISTRY.has(PROVIDER_EXT.emailBridge));
});
