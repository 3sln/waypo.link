// Bindle item-classification/v1 (docs/spec/extensions/item-classification.md; provisional, unsigned). The 3sln.me paid
// built-in is tested in tests/classifier-occupant.test.mjs; these tests cover the published artefacts, the shared validation in the
// Bindle SDK for both sides of the contract, the deterministic test double (a contract implementation, never a
// classifier), the presigned-URL fetch rules, the application selection rules and the dispatcher's no-effect handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import contract from '../docs/artefacts/item-classification-v1.json' with {type:'json'};
import fragment from '../docs/artefacts/fragments/item-classification-v1.json' with {type:'json'};
import * as C from '../packages/sdk/src/item-classification.mjs';
import {fetchPresignedItem,nonPublicAddress} from '../packages/sdk/src/item-classification-fetch.mjs';
import {classifierDouble,presignedFetchDouble,classifierPort,TEXT_CAPABILITIES} from './helpers/classifier-double.mjs';
import {fragmentOutcome} from '../packages/core/fragments.mjs';
import {contractMethods} from '../packages/core/contract-methods.mjs';
import {canonical,digest} from '../packages/core/records.mjs';
import {publicFragments} from '../packages/core/public-contracts.mjs';
import {compileContractVersion} from '../packages/federation/integrations.mjs';
import {FederationController} from '../packages/federation/runtime.mjs';
import {federationControllerOptions,federationSchemas,federationDeclarations} from '../packages/runtime/federation.mjs';
import {configuredArtefactDocuments} from '../packages/runtime/artefact-pins.mjs';
import {RESOURCE_METHOD_HANDLERS} from '../packages/runtime/account/storage.mjs';
import {ACCOUNT_SLICES} from '../packages/runtime/account/index.mjs';
import {forEachSeed} from './helpers/chaos.mjs';

const NOW=Date.UTC(2026,9,28,12),ORIGIN='https://3sln.example',OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LABELS=[{id:'invoice',description:'A bill or invoice asking for payment.'},{id:'travel',description:'Travel bookings and itineraries.'}];
const enc=new TextEncoder(),b64=s=>C.encodeBase64url(enc.encode(s));
const inline=(text='Your travel invoice',over={})=>({detail:'minimal',item:{kind:'text',mediaType:'text/plain',size:enc.encode(text).length,data:b64(text)},labels:LABELS,...over});
const HREF='https://objects.example/bucket/item-1?X-Sig=abc';
const byURL=(over={},item={})=>({detail:'minimal',item:{kind:'text',mediaType:'text/plain',size:19,url:{href:HREF,expiresAt:NOW+300000},...item},labels:LABELS,...over});
const invalid=fn=>assert.throws(fn,{code:'invalid_args'});

test('artefacts: the contract compiles in the shipped dialect, the fragment is valid under the rev 3.3 member table, and Parlay pins its digest',async()=>{
 const methods=contractMethods(contract);assert.deepEqual(Object.keys(methods).sort(),['capabilities','classify']);assert.equal(methods.capabilities.effect,'read');assert.equal(methods.classify.effect,'write');
 const v=compileContractVersion(contract);
 for(const args of [inline(),byURL(),inline('x',{detail:'standard',tags:{language:'en'}}),inline('x',{detail:'full',tags:{language:'en-GB',source:'email',origin:'mail.example',context:['list-id']}})])assert.equal(v.validate({method:'classify',args}),true,JSON.stringify(args).slice(0,80));
 assert.equal(v.validate({method:'capabilities',args:{}}),true);assert.equal(v.validate({method:'capabilities',args:{x:1}}),false);
 // The schema itself refuses tags beyond the declared detail level, both item forms at once, and unknown members.
 for(const args of [inline('x',{tags:{language:'en'}}),inline('x',{detail:'standard',tags:{source:'email'}}),{...inline(),item:{...inline().item,url:byURL().item.url}},{...inline(),extra:1},inline('x',{detail:'everything'}),byURL({},{url:{href:'http://objects.example/x',expiresAt:NOW}})])assert.equal(v.validate({method:'classify',args}),false,JSON.stringify(args).slice(0,100));
 assert.deepEqual(v.shape('capabilities',structuredClone(TEXT_CAPABILITIES)),TEXT_CAPABILITIES);
 assert.deepEqual(v.shape('classify',{scores:{invoice:.1},model:{id:'m',version:'1'},extra:true}),{scores:{invoice:.1},model:{id:'m',version:'1'}},'open result: readers drop unknown members');
 assert.deepEqual(fragmentOutcome(fragment),{status:'valid'});assert.equal(fragment.id,C.ITEM_CLASSIFICATION_FRAGMENT);assert.equal(contract.$id,C.ITEM_CLASSIFICATION_CONTRACT);
 for(const field of [...C.KIND_FIELDS,C.FALLBACK_FIELD]){const f=fragment.fields[field];assert.deepEqual([f.type,f.selection,f.cardinality,f.contracts,f.consumers,f.announce],['resource','exclusive',{min:0,max:1},[C.ITEM_CLASSIFICATION_CONTRACT],['application'],true],field);
  const d=fragment.fields[C.detailField(field)];assert.deepEqual([d.type,d.values,d.cardinality],['enum',[...C.DETAIL_LEVELS],{min:0,max:1}],field);assert.equal(d.selection,undefined);}
 assert.equal(Object.keys(fragment.fields).length,12);assert.equal(fragment.fields.other,undefined,'other has no field of its own: the fallback serves it');
 const parlay=JSON.parse(await readFile(new URL('../apps/parlay/integration.json',import.meta.url))).setup.fragments.find(f=>f.fragment===fragment.id);
 assert.equal(parlay.digest,'sha256-'+await digest(crypto,canonical(fragment)));
 // The withdrawn 3sln.me fragment stays resolvable and listed as withdrawn (append-only).
 const withdrawn=publicFragments.find(f=>f.name==='item-classifier');assert.equal(withdrawn.status,'withdrawn');assert.ok(JSON.parse(await readFile(new URL('../'+withdrawn.source,import.meta.url))).id);
});

test('the shared fragment and contract ship behind the flags; the manifest lists the contract only while the paid built-in is offered',()=>{
 assert.equal(typeof RESOURCE_METHOD_HANDLERS[C.ITEM_CLASSIFICATION_CONTRACT],'function');assert.ok(ACCOUNT_SLICES.classifier);
 const on={APP_ORIGIN:ORIGIN,INTEGRATIONS_ENABLED:true,EXTENSIONS_ENABLED:true};
 assert.equal(JSON.stringify(federationDeclarations(on,{target:'authority',mounts:{}})).includes(C.ITEM_CLASSIFICATION_CONTRACT),false,'not offered without a model, spend authority and version');
 assert.deepEqual(federationSchemas(on)[C.ITEM_CLASSIFICATION_FRAGMENT],fragment);assert.equal(federationSchemas({APP_ORIGIN:ORIGIN})[C.ITEM_CLASSIFICATION_FRAGMENT],undefined,'flags default off');
 assert.deepEqual(configuredArtefactDocuments(on)[C.ITEM_CLASSIFICATION_CONTRACT],contract);assert.equal(configuredArtefactDocuments({})[C.ITEM_CLASSIFICATION_CONTRACT],undefined);
});

test('capabilities: side-effect-free, exact arguments, open result read conservatively',async()=>{
 const d=classifierDouble();assert.deepEqual(await d.capabilities({}),TEXT_CAPABILITIES);await assert.rejects(d.capabilities({kinds:['text']}),{code:'invalid_args'});
 assert.deepEqual(d.counts,{capabilities:1,classify:0,fetched:0,refused:0});
 // Unknown members, kinds and input forms are ignored; malformed known members make the result unusable.
 assert.deepEqual(C.validateCapabilities({kinds:[{kind:'text',mediaTypes:['text/*'],inputs:['inline','carrier-pigeon'],maxBytes:10,future:1},{kind:'hologram',mediaTypes:['x/y'],inputs:['inline'],maxBytes:1}],maxLabels:4,later:true}),{kinds:[{kind:'text',mediaTypes:['text/*'],inputs:['inline'],maxBytes:10}],maxLabels:4});
 for(const bad of [null,{kinds:[],maxLabels:0},{kinds:[],maxLabels:17},{kinds:{},maxLabels:1},{kinds:[{kind:'text',mediaTypes:['Text/Plain'],inputs:['inline'],maxBytes:1}],maxLabels:1},{kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['inline'],maxBytes:0}],maxLabels:1},{kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['inline'],maxBytes:1},{kind:'text',mediaTypes:['text/html'],inputs:['inline'],maxBytes:1}],maxLabels:1},{kinds:[],maxLabels:1,model:{id:'',version:'1'}}])assert.equal(C.validateCapabilities(bad),null,JSON.stringify(bad));
 const caps=C.validateCapabilities({kinds:[{kind:'image',mediaTypes:['image/*'],inputs:['url'],maxBytes:5000000},{kind:'text',mediaTypes:['text/plain','text/markdown'],inputs:['inline'],maxBytes:100}],maxLabels:2});
 const v=a=>C.validateClassifyArgs(a,{now:NOW});
 assert.equal(C.checkCapabilities(v(inline('hi')),caps),null);assert.equal(C.checkCapabilities(v(inline('x'.repeat(101))),caps),'size');
 assert.equal(C.checkCapabilities(v({...inline(),item:{...inline().item,kind:'audio'}}),caps),'kind');assert.equal(C.checkCapabilities(v({...inline(),item:{...inline().item,mediaType:'text/html'}}),caps),'media_type');
 assert.equal(C.checkCapabilities(v(byURL()),caps),'input');assert.equal(C.checkCapabilities(v(inline('hi',{labels:[...LABELS,{id:'c',description:'c'}]})),caps),'labels');
 assert.equal(C.checkCapabilities(v(byURL({},{kind:'image',mediaType:'image/png'})),caps),null);
});

test('inline items: exact base64url of exactly size bytes, bounded, UTF-8 for text; scores per supplied label',async()=>{
 const d=classifierDouble({log:true});
 assert.deepEqual(await d.classify(inline()),{scores:{invoice:.95,travel:.95},model:{id:'test/double',version:'1'}});assert.deepEqual(await d.classify(inline('hello')),{scores:{invoice:.02,travel:.02},model:{id:'test/double',version:'1'}});
 const v=a=>C.validateClassifyArgs(a,{now:NOW});
 invalid(()=>v({...inline(),item:{...inline().item,size:3}}));invalid(()=>v({...inline(),item:{...inline().item,data:inline().item.data+'='}}));invalid(()=>v({...inline(),item:{...inline().item,data:'a'}}));
 const big=new Uint8Array(C.LIMITS.inlineBytes+1);invalid(()=>v({...inline(),item:{kind:'image',mediaType:'image/png',size:big.length,data:C.encodeBase64url(big)}}));
 assert.equal(v({...inline(),item:{kind:'image',mediaType:'image/png',size:C.LIMITS.inlineBytes,data:C.encodeBase64url(big.subarray(1))}}).item.size,C.LIMITS.inlineBytes);
 invalid(()=>v({...inline(),item:{kind:'text',mediaType:'text/plain',size:2,data:C.encodeBase64url(new Uint8Array([0xc3,0x28]))}}));
 assert.equal(v({...inline(),item:{kind:'other',mediaType:'application/octet-stream',size:2,data:C.encodeBase64url(new Uint8Array([0xc3,0x28]))}}).item.kind,'other');
 for(const item of [{...inline().item,kind:'hologram'},{...inline().item,mediaType:'text/plain; charset=utf-8'},{...inline().item,mediaType:'TEXT/PLAIN'},{...inline().item,extra:1},{kind:'text',mediaType:'text/plain',size:1}])invalid(()=>v({...inline(),item}));
 for(const args of [{},{...inline(),detail:undefined},{...inline(),labels:undefined},{...inline(),more:true}])invalid(()=>v(args));
 // A non-text item scores 0.5 per label in the double; the result always has exactly the supplied labels.
 assert.equal((await classifierDouble({capabilities:{kinds:[{kind:'image',mediaTypes:['image/*'],inputs:['inline'],maxBytes:10}],maxLabels:16}}).classify({...inline(),item:{kind:'image',mediaType:'image/png',size:3,data:C.encodeBase64url(new Uint8Array([1,2,3]))}})).scores.invoice,.5);
 await assert.rejects(d.classify({...inline(),item:{kind:'image',mediaType:'image/png',size:3,data:C.encodeBase64url(new Uint8Array([1,2,3]))}}),{code:'unsupported_item'},'a kind outside the capabilities');
});

test('labels: 1-16 distinct tokens with one-line descriptions of at most 200 code points; the classifier may advertise fewer',async()=>{
 const v=labels=>C.validateClassifyArgs(inline('x',{labels}),{now:NOW});
 for(const labels of [[],Array.from({length:17},(_,i)=>({id:'l'+i,description:'d'})),[{id:'a',description:'x'},{id:'a',description:'y'}],[{id:'A',description:'x'}],[{id:'a',description:''}],[{id:'a',description:'   '}],[{id:'a',description:'line\u2028break'}],[{id:'a',description:'tab\there'}],[{id:'a',description:'rtl\u202eoverride'}],[{id:'a',description:'\ud800'}],[{id:'a',description:'😀'.repeat(201)}],[{id:'a',description:'x',extra:1}]])invalid(()=>v(labels));
 assert.equal(v([{id:'a',description:'😀'.repeat(200)}]).labels[0].description.length,400,'200 astral code points (400 UTF-16 units) are within the bound');
 const few=classifierDouble({capabilities:{...TEXT_CAPABILITIES,maxLabels:1}});await assert.rejects(few.classify(inline()),{code:'unsupported_item'});assert.equal(few.counts.refused,1);
});

test('tags: a bounded vocabulary, and nothing beyond the declared detail level',()=>{
 const v=(detail,tags)=>C.validateClassifyArgs(inline('x',{detail,tags}),{now:NOW});
 assert.deepEqual(v('minimal',undefined).tags,{});assert.deepEqual(v('minimal',{}).tags,{});assert.deepEqual(v('standard',{language:'pt-BR'}).tags,{language:'pt-BR'});
 assert.deepEqual(v('full',{language:'en',source:'email',origin:'mail.example',context:['list-id','parlay:thread']}).tags,{language:'en',source:'email',origin:'mail.example',context:['list-id','parlay:thread']});
 assert.equal(v('full',{source:'unregistered-source'}).tags.source,'unregistered-source','classifiers read unregistered sources as other');
 for(const [detail,tags] of [['minimal',{language:'en'}],['standard',{source:'email'}],['standard',{origin:'mail.example'}],['standard',{context:['a']}],['full',{name:'secret.pdf'}],['full',{language:'english language'}],['full',{source:'Email'}],['full',{origin:'https://mail.example'}],['full',{origin:'192.0.2.1'}],['full',{context:[]}],['full',{context:['a','a']}],['full',{context:Array.from({length:17},(_,i)=>'c'+i)}],['full',{context:['UPPER']}],['full',[]]])invalid(()=>v(detail,tags));
});

test('presigned URLs: https only, no credentials, fragment, port or IP literal, canonical, at most one hour, bounded size',()=>{
 const v=(href,expiresAt=NOW+300000,size=19)=>C.validateClassifyArgs(byURL({},{size,url:{href,expiresAt}}),{now:NOW});
 assert.equal(v(HREF).item.url.href,HREF);
 for(const href of ['http://objects.example/x','ftp://objects.example/x','https://user:pw@objects.example/x','https://objects.example/x#frag','https://objects.example:8443/x','https://192.0.2.1/x','https://[2001:db8::1]/x','https://localhost/x','https://printer.local/x','https://svc.internal/x','https://intranet/x','https://objects.example/a/../b','https://OBJECTS.example/x','not a url','https://objects.example/'+'x'.repeat(4096)])invalid(()=>v(href));
 invalid(()=>v(HREF,NOW));invalid(()=>v(HREF,NOW-1));invalid(()=>v(HREF,NOW+C.LIMITS.urlLifetimeMs+1));assert.ok(v(HREF,NOW+C.LIMITS.urlLifetimeMs));invalid(()=>v(HREF,'soon'));
 invalid(()=>v(HREF,NOW+1000,0));invalid(()=>v(HREF,NOW+1000,C.LIMITS.urlBytes+1));assert.equal(v(HREF,NOW+1000,C.LIMITS.urlBytes).item.size,C.LIMITS.urlBytes);
 invalid(()=>C.validateClassifyArgs(byURL({},{url:{href:HREF,expiresAt:NOW+1000,headers:{}}}),{now:NOW}));
 assert.equal(nonPublicAddress('203.0.113.10'),false);for(const a of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','fd00::1','fe80::1','::ffff:10.0.0.1','224.0.0.1'])assert.equal(nonPublicAddress(a),true,a);
});

test('presigned fetch: one GET of exactly the URL, no redirects or credentials, bounded by size and expiry; failures are item_unavailable',async()=>{
 const text='Your travel invoice',ok={[HREF]:{body:text,headers:{'content-length':String(enc.encode(text).length)}}};
 let net=presignedFetchDouble(ok),d=classifierDouble({fetch:net.fetch,now:()=>NOW});
 assert.deepEqual((await d.classify(byURL())).scores,{invoice:.95,travel:.95});assert.equal(d.counts.fetched,1);
 assert.deepEqual(net.requests,[{href:HREF,method:'GET',redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',headers:['accept']}],'no Authorization, Cookie or other credential is forwarded');
 // A redirect is refused and its target is never fetched, even on the same origin.
 for(const location of ['https://elsewhere.example/x','https://objects.example/other']){net=presignedFetchDouble({[HREF]:{status:302,location},[location]:{body:text}});d=classifierDouble({fetch:net.fetch});await assert.rejects(d.classify(byURL()),{code:'item_unavailable'});assert.deepEqual(net.requests.map(r=>r.href),[HREF]);}
 const cases=[
  ['larger body than declared',{[HREF]:{body:text+'!'}}],['smaller body than declared',{[HREF]:{body:'short'}}],['content-length mismatch',{[HREF]:{body:text,headers:{'content-length':'999'}}}],
  ['404',{[HREF]:{status:404,body:'x'}}],['206',{[HREF]:{status:206,body:text}}],['network failure',{[HREF]:{throws:true}}],
 ];
 for(const [name,objects] of cases){net=presignedFetchDouble(objects);d=classifierDouble({fetch:net.fetch});await assert.rejects(d.classify(byURL()),{code:'item_unavailable'},name);}
 // A host that resolves to a non-public address is never contacted.
 net=presignedFetchDouble(ok);d=classifierDouble({fetch:net.fetch,checkHost:async()=>['203.0.113.10','10.0.0.5']});await assert.rejects(d.classify(byURL()),{code:'item_unavailable'});assert.equal(net.requests.length,0);
 net=presignedFetchDouble(ok);d=classifierDouble({fetch:net.fetch,checkHost:async()=>{throw new Error('nxdomain');}});await assert.rejects(d.classify(byURL()),{code:'item_unavailable'});assert.equal(net.requests.length,0);
 // Expired between validation and fetch: refused without a request.
 let clock=NOW;net=presignedFetchDouble(ok);const expiring=classifierDouble({fetch:net.fetch,now:()=>clock,checkHost:async()=>{clock=NOW+400000;return ['203.0.113.10'];}});
 await assert.rejects(expiring.classify(byURL()),{code:'item_unavailable'});assert.equal(net.requests.length,0);
 // A declared size over the classifier's own limit is unsupported_item, before any fetch.
 net=presignedFetchDouble(ok);d=classifierDouble({fetch:net.fetch,capabilities:{kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['url'],maxBytes:10}],maxLabels:16}});await assert.rejects(d.classify(byURL()),{code:'unsupported_item'});assert.equal(net.requests.length,0);
 // A classifier that does not fetch refuses the URL form as unsupported_item; one that only fetches refuses inline.
 await assert.rejects(classifierDouble({capabilities:{kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['inline'],maxBytes:100}],maxLabels:16}}).classify(byURL()),{code:'unsupported_item'});
 await assert.rejects(classifierDouble({fetch:net.fetch,capabilities:{kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['url'],maxBytes:100}],maxLabels:16}}).classify(inline()),{code:'unsupported_item'});
 // The deadline never exceeds the URL's remaining validity or the 30 s bound.
 let aborted=false;const slow=async(href,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));}));
 await assert.rejects(fetchPresignedItem({mediaType:'text/plain',size:19,url:{href:HREF,expiresAt:Date.now()+50}},{fetch:slow,checkHost:async()=>['203.0.113.10'],now:Date.now}),{code:'item_unavailable'});assert.equal(aborted,true);
});

test('post-effect rule: once fetched or charged, a classifier never answers a no-effect code',async()=>{
 for(const code of C.NO_EFFECT_CODES){const net=presignedFetchDouble({[HREF]:{body:'Your travel invoice'}}),d=classifierDouble({fetch:net.fetch,afterFetch:code});await assert.rejects(d.classify(byURL()),{code:'indeterminate'},code);}
 await assert.rejects(C.afterEffect(async()=>{throw Object.assign(new Error(),{code:'invalid_classification'});}),{code:'invalid_classification'});
 assert.equal(await C.afterEffect(async()=>7),7);
 // Before any effect, the refusal keeps its no-effect code.
 const d=classifierDouble({fail:method=>method==='classify'?'rate_limited':null});await assert.rejects(d.classify(inline()),{code:'rate_limited'});
 assert.ok(C.NO_EFFECT_CODES.includes('unsupported_item'));assert.ok(C.FAILOVER_CODES.includes('unsupported_item'));assert.equal(C.FAILOVER_CODES.includes('indeterminate'),false);assert.equal(C.FAILOVER_CODES.includes('item_unavailable'),false);
});

test('app side: the owner detail ceiling is enforced when building calls; absence or garbage means minimal',()=>{
 const tags={language:'en',source:'email',origin:'mail.example',context:['list-id']},item={kind:'text',mediaType:'text/plain',bytes:enc.encode('hi')};
 const build=detail=>C.buildClassifyArgs({detail,item,tags,labels:LABELS},{now:NOW});
 assert.equal(build(undefined).detail,'minimal');assert.equal(build(undefined).tags,undefined);assert.equal(build('everything').detail,'minimal');assert.equal(build({level:'full'}).tags,undefined);
 assert.deepEqual(build('standard').tags,{language:'en'});assert.deepEqual(build('full').tags,tags);assert.equal(build('minimal').tags,undefined);
 assert.deepEqual(build('minimal').item,{kind:'text',mediaType:'text/plain',size:2,data:'aGk'});
 assert.deepEqual(C.buildClassifyArgs({detail:'full',item:{kind:'image',mediaType:'image/png',size:10,url:{href:HREF,expiresAt:NOW+1000}},labels:LABELS},{now:NOW}).item.url,{href:HREF,expiresAt:NOW+1000});
 assert.throws(()=>C.buildClassifyArgs({detail:'full',item,tags:{context:['BAD']},labels:LABELS},{now:NOW}),{code:'invalid_args'},'an app cannot send what a classifier would refuse');
});

test('app side: per-kind field, else fallback; each with its own detail; other kinds go to the fallback only',()=>{
 const values={text:'https://c.example/t',textDetail:'full',image:[{resource:'https://c.example/i'}],fallback:'https://c.example/f',fallbackDetail:'standard'};
 assert.deepEqual(C.classifierCandidates(values,'text'),[{field:'text',resource:'https://c.example/t',detail:'full'},{field:'fallback',resource:'https://c.example/f',detail:'standard'}]);
 assert.deepEqual(C.classifierCandidates(values,'image'),[{field:'image',resource:'https://c.example/i',detail:'minimal'},{field:'fallback',resource:'https://c.example/f',detail:'standard'}]);
 assert.deepEqual(C.classifierCandidates(values,'other').map(c=>c.field),['fallback']);assert.deepEqual(C.classifierCandidates(values,'audio').map(c=>c.field),['fallback']);
 assert.deepEqual(C.classifierCandidates({text:'https://c.example/x',fallback:'https://c.example/x'},'text').map(c=>c.field),['text'],'one resource is asked once');
 assert.deepEqual(C.classifierCandidates({},'video'),[]);assert.throws(()=>C.classifierCandidates({},'hologram'),TypeError);
});

test('app side: classifyWithFallback over doubles: capabilities skip, unsupported_item and no-effect failover, ambiguous stop, explicit unscored',async()=>{
 const T='https://c.example/t',F='https://c.example/f',item={kind:'text',mediaType:'text/plain',bytes:enc.encode('travel plans')};
 const run=(resources,values={text:T,fallback:F})=>{const port=classifierPort({values,resources});return {port,out:C.classifyWithFallback(port,{values,item,tags:{source:'web'},labels:LABELS,now:NOW})};};
 const html={kinds:[{kind:'text',mediaTypes:['text/html'],inputs:['inline'],maxBytes:100}],maxLabels:16};
 let {port,out}=run({[T]:classifierDouble({capabilities:html}),[F]:classifierDouble()});let r=await out;
 assert.equal(r.status,'scored');assert.equal(r.field,'fallback');assert.deepEqual(port.dispatches.map(d=>`${d.method}@${d.resource===T?'T':'F'}`),['capabilities@T','capabilities@F','classify@F'],'the text classifier never received the item');
 // A classifier whose capabilities lie: unsupported_item at classify time still fails over (no effect claimed).
 const liar=classifierDouble({capabilities:html});liar.capabilities=async()=>TEXT_CAPABILITIES;
 ({port,out}=run({[T]:liar,[F]:classifierDouble()}));r=await out;assert.equal(r.field,'fallback');assert.equal(liar.counts.refused,1);
 for(const code of ['rate_limited','temporarily_unavailable','forbidden','not_found']){({out}=run({[T]:classifierDouble({fail:m=>m==='classify'?code:null}),[F]:classifierDouble()}));assert.equal((await out).field,'fallback',code);}
 // Unreadable capabilities skip the candidate without dispatching classify.
 ({port,out}=run({[T]:classifierDouble({fail:m=>m==='capabilities'?'temporarily_unavailable':null}),[F]:classifierDouble()}));r=await out;assert.equal(r.field,'fallback');assert.deepEqual(port.dispatches.filter(d=>d.method==='classify').map(d=>d.resource),[F]);
 // Ambiguous outcomes and invalid results stop: the fallback never sees the item.
 const late=classifierDouble({afterFetch:'forbidden'});late.capabilities=async()=>({kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['inline'],maxBytes:100}],maxLabels:16});
 const lateInline={...late,classify:async()=>{throw Object.assign(new Error('?'),{code:'indeterminate'});}};
 ({port,out}=run({[T]:lateInline,[F]:classifierDouble()}));assert.deepEqual(await out,{status:'unscored',reason:'unknown_outcome',kind:'text',mediaType:'text/plain'});assert.deepEqual(port.dispatches.filter(d=>d.method==='classify').map(d=>d.resource),[T]);
 const wrong={capabilities:async()=>TEXT_CAPABILITIES,classify:async()=>({scores:{invoice:.5},model:{id:'m',version:'1'}})};
 ({out}=run({[T]:wrong,[F]:classifierDouble()}));assert.equal((await out).reason,'invalid_result');
 // Gaps: nothing configured for the kind, or every candidate refuses it.
 ({out}=run({},{image:'https://c.example/i'}));assert.equal((await out).reason,'no_classifier');
 ({out}=run({[T]:classifierDouble({capabilities:html}),[F]:classifierDouble({capabilities:html})}));assert.equal((await out).reason,'unsupported');
 ({out}=run({[T]:classifierDouble({capabilities:html}),[F]:classifierDouble({fail:m=>m==='classify'?'rate_limited':null})}));assert.equal((await out).reason,'unavailable','a transient failure is not a gap');
 // The detail of the field actually used: the fallback at minimal sends no tags even though the text field allows full.
 const seen=classifierDouble({log:true});({out}=run({[T]:classifierDouble({capabilities:html}),[F]:seen},{text:T,textDetail:'full',fallback:F}));await out;assert.deepEqual([seen.calls[0].detail,seen.calls[0].tags],['minimal',{}]);
});

test('app side: more labels than a candidate takes are split across calls to it; a failure after a part never moves on',async()=>{
 const T='https://c.example/t',F='https://c.example/f',item={kind:'text',mediaType:'text/plain',bytes:enc.encode('invoice for travel')},labels=Array.from({length:5},(_,i)=>({id:i===0?'invoice':i===1?'travel':'l'+i,description:'d'+i}));
 const small={kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['inline'],maxBytes:100}],maxLabels:2};
 let d=classifierDouble({capabilities:small,log:true}),port=classifierPort({values:{text:T,fallback:F},resources:{[T]:d,[F]:classifierDouble()}});
 let r=await C.classifyWithFallback(port,{values:{text:T,fallback:F},item,labels,now:NOW});
 assert.equal(r.status,'scored');assert.equal(r.calls,3);assert.deepEqual(d.calls.map(c=>c.labels.length),[2,2,1]);assert.deepEqual(Object.keys(r.result.scores),labels.map(l=>l.id));assert.equal(r.result.scores.invoice,.95);
 // The second part refused: the item already reached this classifier, so the fallback is not tried.
 let n=0;d=classifierDouble({capabilities:small,fail:m=>m==='classify'&&++n===2?'rate_limited':null});const fb=classifierDouble();port=classifierPort({values:{text:T,fallback:F},resources:{[T]:d,[F]:fb}});
 r=await C.classifyWithFallback(port,{values:{text:T,fallback:F},item,labels,now:NOW});assert.deepEqual([r.status,r.reason],['unscored','unavailable']);assert.equal(fb.counts.classify,0);
 // Parts answered by different models cannot be merged.
 let m=0;const mixed={capabilities:async()=>small,classify:async args=>({scores:Object.fromEntries(args.labels.map(l=>[l.id,.5])),model:{id:'m',version:String(++m)}})};
 r=await C.classifyWithFallback(classifierPort({values:{text:T},resources:{[T]:mixed}}),{values:{text:T},item,labels,now:NOW});assert.equal(r.reason,'invalid_result');
});

// Dispatcher (issuer-hosted classifier, for example a future adapter resource): the real FederationController journal.
function memoryMetadata(){const rows=new Map();return {rows,transaction:async op=>op({get:async k=>structuredClone(rows.get(k)),set:async(k,v)=>{rows.set(k,structuredClone(v));},delete:async k=>{rows.delete(k);},list:async prefix=>[...rows].filter(([k])=>k.startsWith(prefix)).map(([key,value])=>({key,value}))})};}
test('dispatcher: unsupported_item is a final no-effect refusal; classify results are never journaled; a same-tx retry is indeterminate',async()=>{
 const options=federationControllerOptions({config:{APP_ORIGIN:ORIGIN,INTEGRATIONS_ENABLED:true,EXTENSIONS_ENABLED:true},repository:{get:async()=>({id:OWNER,status:'active',handle:'alice'})},accounts:{get:()=>({invoke:async()=>[]})},owner:OWNER});
 assert.equal(options.dispatcher.retainResult({contract:C.ITEM_CLASSIFICATION_CONTRACT,method:'classify'}),false);
 const double=classifierDouble({capabilities:{kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['inline'],maxBytes:100}],maxLabels:16}});
 const metadata=memoryMetadata(),host={dispatcher:{durableJournal:true,readOnly:options.dispatcher.readOnly,retainResult:options.dispatcher.retainResult,execute:ctx=>double[ctx.method](ctx.args)},metadata,clock:()=>NOW,issuer:ORIGIN};
 const dispatch=ctx=>FederationController.prototype.dispatch.call(host,ctx,globalThis.crypto);
 const ctx=(args,method='classify')=>({contract:C.ITEM_CLASSIFICATION_CONTRACT,method,subject:`${ORIGIN}/entities/${OWNER}`,resource:'https://3sln.example/r/classifier',clientId:'https://app.example/client.json',tx:crypto.randomUUID(),args});
 const secret='Quarterly travel invoice for Ms. Example',first=ctx(inline(secret));
 assert.deepEqual((await dispatch(first)).scores,{invoice:.95,travel:.95});
 const rows=()=>[...metadata.rows].filter(([k])=>k.startsWith('federation/journal/'));const [[,row]]=rows();assert.equal(row.retained,false);assert.equal(Object.hasOwn(row,'result'),false);
 assert.equal(JSON.stringify([...metadata.rows]).includes('0.95'),false);assert.equal((await dispatch({...first})).__federationError.code,'indeterminate');assert.equal(double.counts.classify,1,'no second classification');
 const refused=ctx(inline('x',{item:{kind:'image',mediaType:'image/png',size:1,data:C.encodeBase64url(new Uint8Array([1]))}}));
 assert.equal((await dispatch(refused)).__federationError.code,'unsupported_item');assert.equal((await dispatch({...refused})).__federationError.code,'unsupported_item','journaled as final');assert.equal(double.counts.classify,2,'the retry is answered from the journal');
 // capabilities is a read: never journaled.
 const before=rows().length;assert.equal((await dispatch(ctx({},'capabilities'))).maxLabels,16);assert.equal(rows().length,before);
 // A refusal after an effect is indeterminate at the dispatcher too (not journaled as a final no-effect answer).
 const lateHost={...host,dispatcher:{...host.dispatcher,execute:()=>C.afterEffect(async()=>{throw Object.assign(new Error(),{code:'forbidden'});})}};
 assert.equal((await FederationController.prototype.dispatch.call(lateHost,ctx(inline()),globalThis.crypto)).__federationError.code,'indeterminate');
});

test('seeded chaos: mutated arguments are either accepted as valid or refused with invalid_args, never anything else',async()=>{
 const pool=[undefined,null,'',0,-1,1.5,2**53,'x'.repeat(5000),[],{},'text','https://objects.example/x','\u2028','😀',true,'minimal','full','text/plain'];
 const paths=[['detail'],['item'],['item','kind'],['item','mediaType'],['item','size'],['item','data'],['item','url'],['labels'],['labels',0],['labels',0,'id'],['labels',0,'description'],['tags'],['tags','context'],['extra']];
 await forEachSeed(16,async random=>{
  for(let i=0;i<64;i++){
   const args=structuredClone(random.chance(.5)?inline():byURL()),path=random.pick(paths),value=random.pick(pool);
   let target=args;for(const key of path.slice(0,-1)){if(target[key]===null||typeof target[key]!=='object')target[key]={};target=target[key];}
   if(value===undefined)delete target[path.at(-1)];else target[path.at(-1)]=value;
   try{const valid=C.validateClassifyArgs(args,{now:NOW});assert.equal(C.validateClassifyArgs(structuredClone({...valid}),{now:NOW}).detail,valid.detail,'a validated copy validates again');}
   catch(error){assert.equal(error.code,'invalid_args',`${path.join('.')}=${JSON.stringify(value)?.slice(0,40)}: ${error.message}`);}
  }
 });
});
