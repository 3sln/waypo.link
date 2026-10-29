// Extensions CR-X3-25 (provisional, unsigned; owner direction 2026-10-28): the 3sln.me built-in classifier for paid tiers,
// on 3sln.me's own Workers AI account, implementing the Bindle item-classification/v1 contract (capabilities + classify).
// Engine-level: honest text-only capabilities, validation before effects, the server-side paid gate, plan-scaled
// allowances per account and per app, the spend ledger, the post-effect rule, no retention, the dispatcher journal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestEngine,OWNER,OTHER} from './helpers/app-engine.mjs';
import {createTestEngine as mailboxEngine} from './parlay/helpers/engine.mjs';
import {organizationProviders} from '../packages/messaging-engine/domains/views.mjs';
import {CATEGORY_DESCRIPTIONS,TAXONOMY} from '../packages/messaging-engine/domains/categories.mjs';
import {TAG_CATEGORIES} from '../packages/messaging-engine/domains/tags.mjs';
import {base64url} from '../packages/messaging-protocol/index.mjs';
import * as X from '../packages/runtime/account/classifier.mjs';
import {clefRequest,deterministicClassifierModel,workersAIClassifierModel} from '../packages/runtime/account/classifier-models.mjs';
import {GlobalSemanticBudget,SemanticBudgetError} from '../packages/runtime/semantic-budget.mjs';
import {LeasedSemanticSpend} from '../packages/runtime/semantic-leases.mjs';
import {semanticShard,SEMANTIC_LAYOUT} from '../packages/runtime/semantic-routing.mjs';
import {RESOURCE_METHOD_HANDLERS} from '../packages/runtime/account/storage.mjs';
import {federationControllerOptions,federationSchemas,federationDeclarations} from '../packages/runtime/federation.mjs';
import {configuredArtefactDocuments} from '../packages/runtime/artefact-pins.mjs';
import {ACCOUNT_SLICES,accountRPC} from '../packages/runtime/account/index.mjs';
import {stages as incrementalRoutes} from '../packages/runtime/routes/incremental.mjs';
import {FederationController} from '../packages/federation/runtime.mjs';
import {canonical,digest} from '../packages/core/records.mjs';
import {encodeBase64url,validateCapabilities,ITEM_CLASSIFICATION_FRAGMENT} from '../packages/sdk/src/item-classification.mjs';
import {classifierPort} from './helpers/classifier-double.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
import {AI_PLAN_ALLOWANCE} from '../packages/runtime/ai-allowance.mjs';

const ORIGIN='https://3sln.example',VERSION='clef-flash-evaluation-2026-10-20',owner={kind:'owner',owner:OWNER},system={kind:'system',owner:OWNER,clientId:'https://a.example/client.json'};
const LABELS=[{id:'invoice',description:'A bill or invoice asking for payment.'},{id:'travel',description:'Travel bookings and itineraries.'}];
const enc=new TextEncoder();
const wire=(text='Hello',over={})=>{const bytes=enc.encode(text);return {detail:'minimal',item:{kind:'text',mediaType:'text/plain',size:bytes.length,data:encodeBase64url(bytes)},labels:LABELS,...over};};
const responseFor=request=>({model:'clef-flash',answers:Object.fromEntries(Object.keys(request.questions).map(id=>[id,id==='travel'||id==='social'?.91:.01]))});
async function fixture(t,options={}){
 const modelCalls=[],leases=[],work=[],config={APP_ORIGIN:ORIGIN,INTEGRATIONS_ENABLED:true,EXTENSIONS_ENABLED:true,...options.config};let plan=options.plan??'paid';
 const global=await createTestEngine();t.after(()=>global.dispose());
 const authority=new GlobalSemanticBudget({metadata:global.metadata,clock:global.clock.now,config:options.budget??{}});
 const spend=new LeasedSemanticSpend({metadata:global.metadata,clock:global.clock.now,authorityFor:async id=>({partition:await semanticShard(id,SEMANTIC_LAYOUT.budgetShards),authority:{async reserveLease(input){leases.push(input);if(options.lease)return options.lease(input);const grant=await authority.reserveLease(input);return {...grant,owner:input.owner,partition:input.partition,layoutVersion:SEMANTIC_LAYOUT.version};}}})});
 const ai=X.classifierAI({binding:{async run(model,request){modelCalls.push({model,request});return options.run?options.run(model,request):responseFor(request);}},spend,clock:global.clock,version:VERSION,plan:async()=>typeof plan==='function'?plan():plan,admitWork:async(id,clientId)=>{work.push(clientId);return options.work!==false;},...options.ai});
 const e=await createTestEngine({clock:global.clock,providers:{config,ai}});t.after(()=>e.dispose());await e.metadata.put('owner',OWNER);
 const h=await createTestEngine({clock:e.clock,providers:{config,ai,accountStore:e.metadata}});t.after(()=>h.dispose());
 const perform=(Operation,input,actor=owner)=>h.perform(new Operation({actor,...input===undefined?{}:{input}})),read=(Operation,actor=owner,input)=>h.read(new Operation({actor,...input===undefined?{}:{input}}));
 const classify=(input,actor=system)=>perform(X.ClassifierClassify,input??wire(),actor);
 return {e:h,clock:global.clock,metadata:e.metadata,perform,read,classify,modelCalls,leases,work,config,ai,plan:value=>plan=value,global};
}
const effects=f=>({leases:f.leases.length,model:f.modelCalls.length,work:f.work.length});

test('identity: the built-in implements both methods of the shared contract and hard-codes no categories',async()=>{
 assert.equal(X.CLASSIFIER_FRAGMENT,ITEM_CLASSIFICATION_FRAGMENT);assert.deepEqual(X.CLASSIFIER_METHODS,['capabilities','classify']);
 assert.equal(RESOURCE_METHOD_HANDLERS[X.CLASSIFIER_CONTRACT],X.classifierResourceMethod);assert.equal(ACCOUNT_SLICES.classifier.methods.classifierDescriptors,X.methods.classifierDescriptors);assert.equal(accountRPC({}).classifierDescriptors.warm,true);
 assert.deepEqual(X.CLASSIFIER_PLANS,['paid','plus','ultra']);
 for(const key of Object.keys(X.CLASSIFIER_PLAN_LIMITS.paid))assert.ok(X.CLASSIFIER_PLAN_LIMITS.paid[key]<X.CLASSIFIER_PLAN_LIMITS.plus[key]&&X.CLASSIFIER_PLAN_LIMITS.plus[key]<X.CLASSIFIER_PLAN_LIMITS.ultra[key],`${key} scales paid < plus < ultra`);
 for(const [plan,limits] of Object.entries(X.CLASSIFIER_PLAN_LIMITS)){assert.equal(limits.monthlyMicroUSD,AI_PLAN_ALLOWANCE[plan].monthlyMicroUSD,'the shared AI allowance');assert.equal(limits.appMonthlyMicroUSD,limits.monthlyMicroUSD/2,'one app gets at most half');}
 assert.deepEqual(Object.fromEntries(Object.entries(AI_PLAN_ALLOWANCE).map(([k,v])=>[k,v.monthlyMicroUSD])),{paid:40000,plus:500000,ultra:5000000});
});

test('capabilities: text/plain inline only, within 2,000 bytes and six labels; never charged; behind the paid gate',async t=>{
 const f=await fixture(t),caps=await f.read(X.ClassifierCapabilities,system,{});
 assert.deepEqual(caps,{kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['inline'],maxBytes:2000}],maxLabels:6,model:{id:X.CLASSIFIER_MODEL,version:VERSION}});assert.ok(validateCapabilities(caps));
 await assert.rejects(f.read(X.ClassifierCapabilities,system,{kinds:[]}),{code:'invalid_args'});
 f.plan('free');await assert.rejects(f.read(X.ClassifierCapabilities,system,{}),{code:'forbidden'});f.plan(null);await assert.rejects(f.read(X.ClassifierCapabilities,system,{}),{code:'forbidden'});
 assert.deepEqual(effects(f),{leases:0,model:0,work:0});assert.equal(await f.metadata.get('classifier/usage/v1'),undefined);
 const unconfigured=await fixture(t,{ai:{version:undefined}});await assert.rejects(unconfigured.read(X.ClassifierCapabilities,system,{}),{code:'temporarily_unavailable'});
 for(const config of [{INTEGRATIONS_ENABLED:false},{EXTENSIONS_ENABLED:false}]){const g=await fixture(t,{config});await assert.rejects(g.read(X.ClassifierCapabilities,system,{}),{code:'not_found'});await assert.rejects(g.classify(),{code:'not_found'});}
});

test('classify: one score per caller label; only fixed text and ids are instructions; the lease is request-sized on the classifier ledger',async t=>{
 const f=await fixture(t),result=await f.classify(wire('Your travel plans\u0001\u0007 for June',{detail:'full',tags:{language:'en',source:'email',context:['list-id']}}));
 assert.deepEqual(result,{scores:{invoice:.01,travel:.91},model:{id:X.CLASSIFIER_MODEL,version:VERSION}});
 const {model,request}=f.modelCalls[0];assert.equal(model,X.CLASSIFIER_MODEL);assert.deepEqual(Object.keys(request.questions),['invoice','travel']);
 for(const q of Object.values(request.questions)){assert.equal(q.instructions.includes('Travel bookings'),false);assert.equal(q.instructions.includes('June'),false);}
 const state=JSON.parse(request.state);assert.deepEqual(state.untrusted_item,{text:'Your travel plans for June',tags:{language:'en',source:'email',context:['list-id']}},'controls are stripped from the model copy; tags travel as data');assert.deepEqual(state.categories,{invoice:LABELS[0].description,travel:LABELS[1].description});
 assert.equal(f.leases.length,1);assert.equal(f.leases[0].ledger,'ai');assert.equal(f.leases[0].microUSD,X.classifierCostMicroUSD(request));assert.deepEqual(f.work,['https://a.example/client.json'],'work is charged to the calling app');
});

test('validation and capability checks run before any effect: invalid_args and unsupported_item charge nothing',async t=>{
 const f=await fixture(t);
 for(const bad of [{},wire('x',{detail:'everything'}),wire('x',{tags:{language:'en'}}),{...wire(),item:{...wire().item,size:99}},wire('x',{labels:[]}),wire('x',{labels:[{id:'A',description:'x'}]})])await assert.rejects(f.classify(bad),{code:'invalid_args'},JSON.stringify(bad).slice(0,80));
 const png={...wire(),item:{kind:'image',mediaType:'image/png',size:3,data:encodeBase64url(new Uint8Array([1,2,3]))}};
 const url={...wire(),item:{kind:'text',mediaType:'text/plain',size:10,url:{href:'https://objects.example/x',expiresAt:f.clock.now()+60000}}};
 const html={...wire(),item:{...wire().item,mediaType:'text/html'}};
 for(const unsupported of [png,url,html,wire('x'.repeat(2001)),wire('x',{labels:Array.from({length:7},(_,i)=>({id:'l'+i,description:'d'}))})])await assert.rejects(f.classify(unsupported),{code:'unsupported_item'});
 assert.equal((await f.classify(wire('x'.repeat(2000),{labels:Array.from({length:6},(_,i)=>({id:'l'+i,description:'d'}))}))).model.id,X.CLASSIFIER_MODEL,'the bounds themselves are accepted');
 f.plan('free');const before=effects(f);await assert.rejects(f.classify(),{code:'forbidden'});assert.deepEqual(effects(f),before,'the paid gate refuses before allowances, work, spend or the model');
 // Bytes as a native byte string (the planned CBOR transport) validate the same way.
 f.plan('paid');assert.equal((await f.classify({...wire('travel'),item:{...wire('travel').item,data:enc.encode('travel')}})).scores.travel,.91);
});

test('the shared AI allowance scales by tier: account month, a 50% app share and a per-minute cap; refusals are rate_limited and write nothing',async t=>{
 for(const plan of X.CLASSIFIER_PLANS){
  const f=await fixture(t,{plan}),limits=X.CLASSIFIER_PLAN_LIMITS[plan];
  for(let i=0;i<limits.minuteCalls;i++)await f.classify(wire('m'+i),{...system,clientId:'https://app'+(i%3)+'.example/c.json'});
  const row=await f.metadata.get('ai/usage/v1');await assert.rejects(f.classify(),error=>error.code==='rate_limited'&&error.retryAfter>=1&&error.retryAfter<=60);assert.deepEqual(await f.metadata.get('ai/usage/v1'),row,'a refusal writes nothing');
  assert.equal(row.services.classify.calls,limits.minuteCalls);assert.ok(row.monthlyMicroUSD>0);
  f.clock.advance(60000);await f.classify();
 }
 const f=await fixture(t,{plan:'paid'}),limits=X.CLASSIFIER_PLAN_LIMITS.paid,month=new Date(f.clock.now()).toISOString().slice(0,7);
 const appKey=async id=>'ai/usage/v1/app/'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(id)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const A={...system,clientId:'https://a.example/client.json'},B={...system,clientId:'https://parlay.example/client.json'};
 // App A at its half of the month: refused until next month; app B keeps its own share.
 await f.metadata.put(await appKey(A.clientId),{month,monthlyMicroUSD:limits.appMonthlyMicroUSD});
 await assert.rejects(f.classify(wire(),A),error=>error.code==='rate_limited'&&error.retryAfter>60);const calls=f.modelCalls.length;await f.classify(wire(),B);assert.equal(f.modelCalls.length,calls+1);
 // The account month binds every app, and is shared with any other AI service writing the same allowance.
 await f.metadata.put('ai/usage/v1',{month,monthlyMicroUSD:limits.monthlyMicroUSD,services:{describe:{minute:'x',calls:1}}});await assert.rejects(f.classify(wire(),B),{code:'rate_limited'});
 // Upgrading lifts it at once; a corrupt counter fails closed.
 f.plan('plus');await f.classify(wire(),B);
 for(const bad of [{month,monthlyMicroUSD:-1},{month,monthlyMicroUSD:0,extra:1},{month,monthlyMicroUSD:0,services:{classify:{minute:1,calls:0}}}]){await f.metadata.put('ai/usage/v1',bad);await assert.rejects(f.classify(wire(),B),{code:'rate_limited'},JSON.stringify(bad));}
});

test('after the first effect no refusal claims no effect; a refused lease spent nothing and is rate_limited',async t=>{
 // The plan is lost between the lease and the model: charged, never called, indeterminate.
 let n=0;const early=await fixture(t,{plan:()=>++n<2?'paid':null});await assert.rejects(early.classify(),{code:'indeterminate'});assert.equal(early.leases.length,1);assert.equal(early.modelCalls.length,0);
 // Lost while the model ran: indeterminate, never forbidden.
 let release,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>release=r),late=await fixture(t,{run:()=>{started();return pending;}});
 const call=late.classify();await ready;late.plan('free');release({model:'clef-flash',answers:{invoice:.1,travel:.2}});await assert.rejects(call,{code:'indeterminate'});
 const failing=await fixture(t,{run:()=>{throw new Error('upstream');}});await assert.rejects(failing.classify(),{code:'indeterminate'});
 const garbage=await fixture(t,{run:()=>({model:'clef-flash',answers:{invoice:2}})});await assert.rejects(garbage.classify(),{code:'invalid_classification'});
 // A refused lease (the service budget) spent nothing: rate_limited, so an app may fail over.
 const refused=await fixture(t,{lease:()=>{throw new SemanticBudgetError();}});await assert.rejects(refused.classify(),error=>error.code==='rate_limited'&&error.retryAfter>0);assert.equal(refused.modelCalls.length,0);
 // A lease outcome that cannot be trusted may have spent money: indeterminate.
 const odd=await fixture(t,{lease:input=>({owner:input.owner,partition:input.partition,layoutVersion:SEMANTIC_LAYOUT.version,day:'2000-01-01',month:'2000-01',microUSD:input.microUSD,upsertSlots:0,ledger:'ai'})});await assert.rejects(odd.classify(),{code:'indeterminate'});
 const lost=await fixture(t,{lease:()=>{throw new Error('transport');}});await assert.rejects(lost.classify(),{code:'indeterminate'});
});

test('review M1: a refused work admission or ledger lease leaves the AI allowance counters as they were',async t=>{
 const usage=async f=>{const keys=[...(await f.metadata.list({prefix:'ai/usage/v1'})).entries()];return JSON.stringify(keys);};
 // A prior granted call leaves counters; each refusal afterwards changes none of them.
 for(const options of [{work:false},{lease:()=>{throw new SemanticBudgetError();}}]){
  let refuse=false;const f=await fixture(t,{...options.work===false?{ai:{admitWork:async()=>!refuse}}:{},...options.lease?{lease:input=>{if(refuse)return options.lease(input);return {owner:input.owner,partition:input.partition,layoutVersion:SEMANTIC_LAYOUT.version,day:new Date(f.clock.now()).toISOString().slice(0,10),month:new Date(f.clock.now()).toISOString().slice(0,7),microUSD:input.microUSD,upsertSlots:0,ledger:'ai'};}}:{}});
  await f.classify();const before=await usage(f),row=await f.metadata.get('ai/usage/v1');assert.equal(row.services.classify.calls,1);assert.ok(row.monthlyMicroUSD>0);
  refuse=true;
  for(let i=0;i<20;i++)await assert.rejects(f.classify(),{code:'rate_limited'});
  assert.equal(await usage(f),before,'twenty refusals debit nothing');
  // The minute cap is not consumed by refusals either: the next granted calls still fit.
  refuse=false;for(let i=1;i<X.CLASSIFIER_PLAN_LIMITS.paid.minuteCalls;i++)await f.classify();
 }
 // An empty account: a refusal before the lease writes no debit at all (or credits it back to zero).
 const empty=await fixture(t,{lease:()=>{throw new SemanticBudgetError();}});await assert.rejects(empty.classify(),{code:'rate_limited'});
 const row=await empty.metadata.get('ai/usage/v1');assert.equal(row?.monthlyMicroUSD??0,0);assert.equal(row?.services?.classify?.calls??0,0);
 // A granted lease keeps the debit even when the model then fails (the money may be spent).
 const failing=await fixture(t,{run:()=>{throw new Error('upstream');}});await assert.rejects(failing.classify(),{code:'indeterminate'});assert.ok((await failing.metadata.get('ai/usage/v1')).monthlyMicroUSD>0);
});

test('cost: every argument set within the capabilities stays under the per-call ceiling (worst case and seeded)',async()=>{
 const caps={configured:true,mediaTypes:['text/plain']},now=Date.UTC(2026,9,28);
 const worst=(text,description)=>X.classificationArgs({detail:'full',item:{kind:'text',mediaType:'text/plain',size:enc.encode(text).length,data:encodeBase64url(enc.encode(text))},tags:{language:'en-GB-oxendict',source:'s'.repeat(32),origin:'a'.repeat(60)+'.'+'b'.repeat(60)+'.'+'c'.repeat(60)+'.example',context:Array.from({length:16},(_,i)=>String(i).padEnd(64,'z'))},labels:Array.from({length:6},(_,i)=>({id:String(i).padEnd(64,'x'),description}))},{now,ai:caps});
 for(const text of ['"'.repeat(2000),'\\'.repeat(2000),'\n'.repeat(2000),'\u0001'.repeat(2000),'😀'.repeat(500),'a'.repeat(2000)])for(const description of ['😀'.repeat(200),'"'.repeat(200),'\\'.repeat(200)]){const cost=X.classifierCostMicroUSD(clefRequest(worst(text,description)));assert.ok(cost<=X.CLASSIFIER_LIMITS.microUSD,`${JSON.stringify(text[0])}/${description[0]}: ${cost}`);}
 const pool=['"','\\','\n','\t','a','é','😀','\u0001','\u2028'];
 await forEachSeed(16,async random=>{for(let i=0;i<8;i++){let text='';while(enc.encode(text).length<1990)text+=random.pick(pool);const description=Array.from({length:1+random.int(200)},()=>random.pick(pool.filter(c=>!['\n','\t','\u0001','\u2028'].includes(c)))).join('');const cost=X.classifierCostMicroUSD(clefRequest(worst(text,description)));assert.ok(cost<=X.CLASSIFIER_LIMITS.microUSD);}});
});

test('no retention: only counters are written, nothing content-bearing, and app counters are keyed by a digest',async t=>{
 const f=await fixture(t),secret='Quarterly invoice for Ms. Example, account 4417',labels=[{id:'invoice',description:'Unique-description-marker for bills.'}];
 await f.classify(wire(secret,{labels,detail:'full',tags:{origin:'secret-sender.example'}}));
 const dump=async store=>JSON.stringify([...(await store.list({prefix:''})).entries()]);
 for(const text of [await dump(f.metadata),await dump(f.global.metadata),JSON.stringify(f.e.audit.entries)])for(const needle of ['Quarterly','Unique-description-marker','"invoice"','secret-sender','a.example'])assert.equal(text.includes(needle),false,needle);
 const keys=[...(await f.metadata.list({prefix:''})).keys()].filter(k=>k!=='item-index-ready').sort();assert.equal(keys.length,3);assert.deepEqual(keys.filter(k=>!/^ai\/usage\/v1\/app\/[0-9a-f]{64}$/.test(k)),['ai/usage/v1','owner']);
 const options=federationControllerOptions({config:f.config,repository:{get:async()=>({id:OWNER,status:'active',handle:'alice'})},accounts:{get:()=>({invoke:async()=>[]})},owner:OWNER});
 assert.equal(options.dispatcher.retainResult({contract:X.CLASSIFIER_CONTRACT,method:'classify'}),false);assert.equal(options.dispatcher.readOnly({contract:X.CLASSIFIER_CONTRACT,method:'classify'}),false,'journaled as a write');
});

// Dispatcher level: the real FederationController.dispatch journal with the real contract adapter behind it.
function memoryMetadata(){const rows=new Map();return {rows,transaction:async op=>op({get:async k=>structuredClone(rows.get(k)),set:async(k,v)=>{rows.set(k,structuredClone(v));},delete:async k=>{rows.delete(k);},list:async prefix=>[...rows].filter(([k])=>k.startsWith(prefix)).map(([key,value])=>({key,value}))})};}
async function adapter(t,{plan=()=>'paid',appsCheck=()=>{}}={}){
 const f=await fixture(t),stub=deterministicClassifierModel();let runs=0,checks=0;const workClients=[];
 const c={config:{...f.config,CLASSIFIER_MODEL_PORT:{...stub,run:async request=>{runs++;return stub.run(request);}},CLASSIFIER_MODEL_VERSION:VERSION,SEMANTIC_SPEND:{authorityFor:async id=>({partition:await semanticShard(id,16),authority:{reserveLease:async input=>({owner:id,partition:input.partition,layoutVersion:1,day:new Date().toISOString().slice(0,10),month:new Date().toISOString().slice(0,7),microUSD:input.microUSD,upsertSlots:0,ledger:'ai'})}})},FEDERATION_IDENTITY_CHECK:async()=>true},metadata:f.metadata,warm:async()=>{},billingRefresh:async()=>{},billing:{entitlement:async()=>({plan:plan()})},admitWork:async(_id,{clientId}={})=>{workClients.push(clientId);return true;},apps:{check:async()=>appsCheck(++checks)}};
 const options=federationControllerOptions({config:f.config,repository:{get:async()=>({id:OWNER,status:'active',handle:'alice'})},accounts:{get:()=>({invoke:async()=>[]})},owner:OWNER});
 const metadata=memoryMetadata(),host={dispatcher:{durableJournal:true,readOnly:options.dispatcher.readOnly,retainResult:options.dispatcher.retainResult,execute:context=>X.classifierResourceMethod(c,OWNER,context)},metadata,clock:()=>Date.now(),issuer:ORIGIN};
 const context=(over={})=>({authority:'bindle',contract:X.CLASSIFIER_CONTRACT,method:'classify',subject:`${ORIGIN}/entities/${OWNER}`,resource:X.classifierResource({APP_ORIGIN:ORIGIN},OWNER),resourceGeneration:'v1',connection:{id:'consumer',generation:1},epoch:'verified',clientId:'https://box.example/client.json',tx:crypto.randomUUID(),args:wire('Quarterly travel invoice for Ms. Example'),...over});
 return {f,c,metadata,context,dispatch:ctx=>FederationController.prototype.dispatch.call(host,ctx,globalThis.crypto),runs:()=>runs,workClients};
}
test('contract adapter: foreign resource, subject or authority, stale consumers and unsupported methods are refused',async t=>{
 const d=await adapter(t),ctx=d.context();
 for(const extra of [{resource:'https://foreign.example/resource'},{subject:`${ORIGIN}/entities/${OTHER}`},{resourceGeneration:'999'},{authority:'mcp'},{contract:'https://spec.bindle.example/contracts/decision-model/v1'},{connection:null}])await assert.rejects(X.classifierResourceMethod(d.c,OWNER,{...ctx,...extra}),{code:'forbidden'});
 for(const method of ['decide','delete'])await assert.rejects(X.classifierResourceMethod(d.c,OWNER,{...ctx,method}),{code:'unsupported_method'});
 assert.deepEqual((await X.classifierResourceMethod(d.c,OWNER,ctx)).scores,{invoice:.95,travel:.95});assert.deepEqual(d.workClients,['https://box.example/client.json']);
 assert.equal((await X.classifierResourceMethod(d.c,OWNER,{...ctx,method:'capabilities',args:{}})).maxLabels,6);
});
test('dispatcher: no result or content in the journal, a keyed fingerprint, same-tx retry indeterminate, final unsupported_item, unjournaled capabilities',async t=>{
 const d=await adapter(t),ctx=d.context();
 assert.deepEqual((await d.dispatch(ctx)).scores,{invoice:.95,travel:.95});assert.equal(d.runs(),1);
 const journal=()=>[...d.metadata.rows].filter(([k])=>k.startsWith('federation/journal/'));const [[,row]]=journal();
 assert.equal(row.status,'complete');assert.equal(row.retained,false);assert.equal(Object.hasOwn(row,'result'),false);
 const all=JSON.stringify([...d.metadata.rows]);for(const needle of ['Quarterly','Ms. Example','0.95'])assert.equal(all.includes(needle),false,needle);
 const bare=await digest(globalThis.crypto,canonical({resource:ctx.resource,addressedResource:ctx.resource,contract:ctx.contract,method:ctx.method,args:ctx.args,scope:{},epoch:ctx.epoch,resourceGeneration:'v1',connectionGeneration:1}));
 assert.match(row.fingerprint,/^hmac:[A-Za-z0-9_-]{43}$/);assert.notEqual(row.fingerprint,bare);
 assert.equal((await d.dispatch({...ctx})).__federationError.code,'indeterminate');assert.equal(d.runs(),1);await assert.rejects(d.dispatch({...ctx,args:wire('other')}),{code:'tx_conflict'});
 const image=d.context({args:{...wire(),item:{kind:'image',mediaType:'image/png',size:1,data:encodeBase64url(new Uint8Array([1]))}}});
 assert.equal((await d.dispatch(image)).__federationError.code,'unsupported_item');assert.equal((await d.dispatch({...image})).__federationError.code,'unsupported_item','journaled as final');
 const rows=journal().length;assert.equal((await d.dispatch(d.context({method:'capabilities',args:{}}))).maxLabels,6);assert.equal(journal().length,rows,'capabilities is a read');
});
test('dispatcher: entitlement or connection lost after the model call is indeterminate; before any effect forbidden stays a no-effect answer',async t=>{
 let n=0;const late=await adapter(t,{plan:()=>++n<=2?'paid':'free'});assert.equal((await late.dispatch(late.context())).__federationError.code,'indeterminate');assert.equal(late.runs(),1);
 const revoked=await adapter(t,{appsCheck:k=>{if(k>1)throw Object.assign(Error('gone'),{code:'unauthorized'});}});assert.equal((await revoked.dispatch(revoked.context())).__federationError.code,'indeterminate');assert.equal(revoked.runs(),1);
 const free=await adapter(t,{plan:()=>'free'});assert.equal((await free.dispatch(free.context())).__federationError.code,'forbidden');assert.equal(free.runs(),0);
});

test('Parlay through the built-in: its 11 categories are split into calls of at most six, thresholds bind to its taxonomy',async t=>{
 const f=await fixture(t,{plan:'ultra'}),built={capabilities:async()=>f.read(X.ClassifierCapabilities,system,{}),classify:args=>f.classify(args)},port=classifierPort({values:{text:'builtin',textDetail:'full'},resources:{builtin:built}});
 const box=mailboxEngine({providers:organizationProviders({PARLAY_ENABLED:true,classifier:port})});t.after(()=>box.dispose());
 await box.run('classify.settings',{input:{consent:true,pin:{model:X.CLASSIFIER_MODEL,version:VERSION,schema:TAXONOMY,thresholds:{social:.9}}}});const rules=await box.run('rules.list');await box.run('rules.replace',{input:{rules:rules.map(r=>({...r,enabled:false}))}});
 await box.store.put('item/a',{id:'a',origin:'channel',kind:'channel',subject:'',receivedAt:10,state:'inbox',tags:[],asserted:{automation:['list-id','x-private-header']},message:{parts:[{mimeType:'text/plain',dataBase64url:base64url(enc.encode('Hello friend'))}]}});
 const result=await box.run('classify.item',{id:'a'});assert.equal(result.status,'complete');assert.deepEqual(result.item.tags,['sys:suspected.social']);
 assert.deepEqual(f.modelCalls.map(c=>Object.keys(c.request.questions).length),[6,5]);assert.deepEqual(f.modelCalls.flatMap(c=>Object.keys(JSON.parse(c.request.state).categories)),TAG_CATEGORIES);
 assert.deepEqual(JSON.parse(f.modelCalls[0].request.state).categories.spam,CATEGORY_DESCRIPTIONS.spam);assert.deepEqual(JSON.parse(f.modelCalls[0].request.state).untrusted_item.tags,{source:'email',context:['list-id']});
});

test('discovery: descriptors list both methods, the manifest lists the contract only while offered, and the fragment is served',async t=>{
 const f=await fixture(t),snapshot=()=>f.read(X.ClassifierDescriptors,system),descriptors=await snapshot();
 assert.equal(descriptors.length,1);assert.equal(descriptors[0].id,X.classifierResource({APP_ORIGIN:ORIGIN},OWNER));assert.deepEqual(descriptors[0].contracts,{[X.CLASSIFIER_CONTRACT]:['capabilities','classify']});assert.deepEqual(descriptors[0].limits,{maxRequestBytes:32768,maxResultBytes:16384,txRetentionSeconds:86400});
 const offered={...f.config,CLASSIFIER_MODEL_PORT:deterministicClassifierModel(),SEMANTIC_SPEND:{authorityFor(){}},CLASSIFIER_MODEL_VERSION:VERSION};
 assert.deepEqual(federationDeclarations(offered,{target:'authority',mounts:{}}).contracts?.includes(X.CLASSIFIER_CONTRACT),true);assert.equal(JSON.stringify(federationDeclarations(f.config,{target:'authority',mounts:{}})).includes(X.CLASSIFIER_CONTRACT),false);
 assert.deepEqual(federationSchemas(f.config)[X.CLASSIFIER_FRAGMENT],X.CLASSIFIER_FRAGMENT_DOCUMENT);assert.deepEqual(configuredArtefactDocuments(f.config)[X.CLASSIFIER_CONTRACT],X.CLASSIFIER_CONTRACT_DOCUMENT);
 const url=new URL(`/api/incremental/schema?fragment=${encodeURIComponent(X.CLASSIFIER_FRAGMENT)}`,ORIGIN),response=await incrementalRoutes.public({request:new Request(url),env:{...f.config,INCREMENTAL_AUTH_ENABLED:'true',INCREMENTAL_AUTHORIZATION:{mounted:true}},path:url.pathname,url});assert.equal(response.status,200);assert.deepEqual((await response.json()).schema,X.CLASSIFIER_FRAGMENT_DOCUMENT);
 const unavailable=await fixture(t,{ai:{version:undefined}});assert.deepEqual(await unavailable.read(X.ClassifierDescriptors,system),[]);
 // Review L3: a free (or plan-less) account is not offered the built-in at all; upgrading lists it.
 for(const plan of ['free',null]){f.plan(plan);assert.deepEqual(await snapshot(),[],String(plan));}f.plan('paid');assert.equal((await snapshot()).length,1);
 assert.equal(X.classifierOffered({AI:{run(){}},SEMANTIC_SPEND:{authorityFor(){}},CLASSIFIER_MODEL_VERSION:VERSION}),true);assert.equal(X.classifierOffered({AI:{run(){}}}),false);
 assert.equal(workersAIClassifierModel(undefined).configured,false);assert.deepEqual(workersAIClassifierModel({run(){}}).mediaTypes,['text/plain']);
 const status=await f.read(X.ClassifierStatus,system);assert.equal(status.plan,'paid');assert.deepEqual(status.limits,X.CLASSIFIER_PLAN_LIMITS.paid);
});
