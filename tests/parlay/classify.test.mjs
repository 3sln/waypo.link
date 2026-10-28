import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestEngine} from './helpers/engine.mjs';
import {createTagsProvider} from '../../packages/messaging-engine/domains/tags.mjs';
import {organizationProviders} from '../../packages/messaging-engine/domains/views.mjs';
import {base64url} from '../../packages/messaging-protocol/index.mjs';
import {TAXONOMY} from '../../packages/messaging-engine/domains/categories.mjs';
import {decodeBase64url} from '../../packages/sdk/src/item-classification.mjs';
import {classifierDouble,classifierPort} from '../helpers/classifier-double.mjs';
// Parlay binds pins to {model id, model version, its own taxonomy}; the classifier reports only the model.
const MODEL={model:'triage',version:'1',schema:TAXONOMY},pin={...MODEL,thresholds:{social:.8,spam:.97,automation:.9,promotional:.8}},encoder=new TextEncoder();
const fresh=(t,classifier=null,extra={})=>{const e=createTestEngine({providers:{...organizationProviders({PARLAY_ENABLED:true,classifier}),...extra}});t.after(()=>e.dispose());return e;};
const put=(e,id='a',extra={})=>e.store.put('item/'+id,{id,origin:'channel',kind:'channel',subject:'',receivedAt:10,state:'inbox',tags:[],notification:'push',asserted:{automation:['auto-submitted','list-id'],sender:{headerFrom:'private@sender.example'}},message:{parts:[{mimeType:'text/plain',dataBase64url:base64url(encoder.encode('Hello 123456 https://signed.example/token?secret=private bearer secretBearerValue bindle_meta=capability '+'😀'.repeat(3000)))}]},...extra});
const enable=e=>e.run('classify.settings',{input:{consent:true,pin}});
// A host port over the shared item-classification fragment (categories.mjs): the approved field values, capabilities and
// classify per resource. One score per label Parlay asked for (unlisted labels score 0).
const TEXT='https://classifiers.example/r/text',FALLBACK='https://classifiers.example/r/fallback';
const TEXT_CAPS={kinds:[{kind:'text',mediaTypes:['text/*'],inputs:['inline'],maxBytes:65536}],maxLabels:16};
const answer=(input,labels,evidence=MODEL)=>({scores:Object.fromEntries(input.labels.map(l=>[l.id,labels[l.id]??0])),model:{id:evidence.model,version:evidence.version}});
const fake=(labels={social:.9},evidence=MODEL,{values={text:TEXT,textDetail:'full'},capabilities=TEXT_CAPS}={})=>({calls:[],resources:[],values,async fields(){return structuredClone(this.values);},async capabilities(){return structuredClone(capabilities);},async classify(resource,input){this.calls.push(input);this.resources.push(resource);return answer(input,labels,evidence);}});
const sent=call=>new TextDecoder().decode(decodeBase64url(call.item.data));

test('classification without a classifier, consent or allowance yields header hints only and never finalizes/rejects',async t=>{
 for(const mode of ['absent','consent','allowance','throw','malformed','requiresConsent']){
  const c=fake();if(mode==='throw')c.classify=async()=>{c.calls.push({});throw new Error('Unavailable');};if(mode==='malformed')c.classify=async()=>({scores:{'sys:spam':1},model:{id:MODEL.model,version:MODEL.version}});if(mode==='requiresConsent')c.classify=async()=>({requiresConsent:true});
  const e=fresh(t,mode==='absent'?undefined:c);await put(e);if(!['absent','consent'].includes(mode))await enable(e);if(mode==='allowance')await e.run('classify.settings',{input:{allowance:0}});
  const r=await e.run('classify.item',{id:'a'});assert.equal(r.source,'heuristic');assert.deepEqual([...r.item.tags].sort(),['sys:suspected.automation','sys:suspected.promotional']);assert.equal(r.item.quarantined,undefined);assert.equal(r.item.state,'inbox');
  if(['absent','consent','allowance'].includes(mode))assert.equal(c.calls.length,0);
  // Without consent nothing was wanted; with consent, every shortfall is an explicit unscored state (§8.4).
  const expected={absent:['heuristic'],consent:['heuristic'],allowance:['unscored','allowance'],throw:['unscored','unknown_outcome'],malformed:['unscored','invalid_result'],requiresConsent:['unscored','invalid_result']}[mode];
  assert.deepEqual([r.status,r.reason].filter(Boolean),expected,mode);
  if(expected[0]==='unscored')assert.deepEqual((await e.store.get('item/a')).classificationResult.classifier.result,{source:'classifier',status:'unscored',version:'none',reason:expected[1],labels:[]});
 }
});
test('a consented host classifier sees minimized text only, model-bound thresholds select suspected tags and owner rules promote',async t=>{
 const c=fake({social:.91,spam:.96,promotional:.2}),e=fresh(t,c);await put(e);await enable(e);
 const status=await e.run('classify.status');assert.equal(status.consent,true);assert.deepEqual(status.pins,[pin]);
 const r=await e.run('classify.item',{id:'a'});assert.equal(r.source,'classifier');assert.deepEqual(r.item.tags,['sys:social']);assert.equal(r.item.tagProvenance['sys:social'].source,'rule');assert.equal(r.item.tagProvenance['sys:social'].from,'sys:suspected.social');assert.equal(r.item.automated['sys:suspected.social'].classifier.probability,.91);
 // Full detail (the owner's choice for this field): the source and recognized header hints as context tags; never an origin.
 assert.deepEqual(Object.keys(c.calls[0]).sort(),['detail','item','labels','tags']);assert.equal(c.calls[0].detail,'full');assert.deepEqual(Object.keys(c.calls[0].item).sort(),['data','kind','mediaType','size']);assert.deepEqual([c.calls[0].item.kind,c.calls[0].item.mediaType],['text','text/plain']);
 assert.deepEqual(c.calls[0].tags,{source:'email',context:['auto-submitted','list-id']});const text=sent(c.calls[0]);assert.ok(encoder.encode(text).byteLength<=2000);assert.equal(c.calls[0].item.size,encoder.encode(text).byteLength);assert.equal(text.includes('\ufffd'),false);for(const secret of ['123456','signed.example','secretBearerValue','capability','private@sender.example'])assert.equal((text+JSON.stringify(c.calls[0].tags)).includes(secret),false,secret);
 const before=await e.store.get('item/a');await e.run('classify.item',{id:'a'});assert.deepEqual(await e.store.get('item/a'),before,'repeated identical evidence has no state changes');
});
test('new model/version/schema is calibration only; disabled defaults leave genuine suspected tags',async t=>{
 for(const field of ['model','version','schema']){
  // The schema is Parlay's taxonomy: a pin for another taxonomy revision is as unusable as one for another model.
  const c=fake({social:1},field==='schema'?MODEL:{...MODEL,[field]:'changed'}),e=fresh(t,c);await put(e);await e.run('classify.settings',{input:{consent:true,pin:field==='schema'?{...pin,schema:'parlay-message-categories-v0'}:pin}});
  const r=await e.run('classify.item',{id:'a'});assert.equal(r.status,'calibration');assert.ok(r.item.tags.every(t=>t.startsWith('sys:suspected.')));assert.equal(r.item.automated?.['sys:suspected.social'],undefined);
 }
 const c=fake(),e=fresh(t,c);await put(e);await enable(e);const rules=await e.run('rules.list');await e.run('rules.replace',{input:{rules:rules.map(r=>({...r,enabled:false}))}});
 const r=await e.run('classify.item',{id:'a'});assert.deepEqual(r.item.tags,['sys:suspected.social']);assert.equal(r.item.tagProvenance['sys:suspected.social'].source,'classifier');
});
test('owner suppression, manual category choices and quarantine release survive later classifier results',async t=>{
 const c=fake({social:1,spam:1}),e=fresh(t,c);await put(e);await enable(e);
 const initial=await e.run('classify.item',{id:'a'});assert.equal(initial.item.quarantined,true);assert.equal((await e.store.get('item/a')).notification,null);
 await e.run('incoming.update',{input:{id:'a',expectedRevision:initial.item.organizationRevision,removeTags:['sys:social','sys:spam'],classification:'work',quarantined:false}});
 const rules=await e.run('rules.list');await e.run('rules.replace',{input:{rules:[...rules,{id:'later',enabled:true,match:{tagsAll:['sys:suspected.automation']},actions:{addTags:['sys:social'],classification:'spam',quarantined:true}}]}});
 c.classify=async(_,input)=>answer(input,{automation:1});const r=await e.run('classify.item',{id:'a'});assert.equal(r.item.classification,'work');assert.equal(r.item.quarantined,false);assert.equal(r.item.tags.includes('sys:social'),false);
});
test('automation runs only newly matched rules; an owner-removed suspected tag cannot later promote',async t=>{
 const c=fake(),e=fresh(t,c);await put(e);await enable(e);await e.run('rules.delete',{id:'default:promote.social'});
 const r=await e.run('classify.item',{id:'a'});await e.run('incoming.update',{input:{id:'a',expectedRevision:r.item.organizationRevision,removeTags:['sys:suspected.social']}});
 await e.run('rules.restore-default',{id:'default:promote.social'});await e.run('classify.item',{id:'a'});
 assert.equal((await e.store.get('item/a')).tags.some(t=>t.id==='sys:social'),false);
 await e.run('rules.replace',{input:{rules:[{id:'new-social',enabled:true,match:{tagsAll:['sys:suspected.social']},actions:{addTags:['too-late']}}]}});
 c.classify=async(_,input)=>answer(input,{social:1,automation:1});const next=await e.run('classify.item',{id:'a'});assert.equal(next.item.tags.includes('too-late'),false);
});
test('public intake retains BB-B2 tiers; conversations require explicit local opt-in; metering reserves atomically',async t=>{
 const c=fake(),e=fresh(t,c);await enable(e);
 for(const [id,extra] of [['pending',{state:'pending',request:true}],['rejected',{state:'rejected',request:true}],['conversation',{kind:'conversation',type:'conversation'}]]){
  await put(e,id,extra);assert.equal((await e.run('classify.item',{id})).status,'skipped');
 }
 assert.equal(c.calls.length,0);await e.run('classify.settings',{input:{conversation:{id:'conversation',enabled:true}}});assert.equal((await e.run('classify.item',{id:'conversation'})).source,'classifier');
 await put(e,'first');await put(e,'second');await e.run('classify.settings',{input:{allowance:2}});
 const results=await Promise.all(['first','second'].map(id=>e.run('classify.item',{id})));assert.equal(results.filter(r=>r.source==='classifier').length,1);assert.equal(c.calls.length,2);
});
test('in-flight classification is fenced by owner edits/consent changes and never triggers failover after a timeout',async t=>{
 let resolve,started;const ready=new Promise(r=>{started=r;}),c={...fake(),calls:0,async classify(_,input){this.calls++;started();return new Promise(r=>{resolve=()=>r(answer(input,{spam:1}));});}},e=fresh(t,c);await put(e);await enable(e);
 const pending=e.run('classify.item',{id:'a'});await ready;await e.run('classify.settings',{input:{consent:false}});resolve();
 assert.equal((await pending).reason,'changed');assert.deepEqual((await e.store.get('item/a')).tags,[]);assert.equal(c.calls,1);
});
test('classifier operation flag and threshold validation fail closed',async t=>{
 const e=fresh(t,fake(),{tags:createTagsProvider()});await put(e);await assert.rejects(e.run('classify.status'),{code:'not_found'});await assert.rejects(e.run('classify.item',{id:'a'}),{code:'not_found'});
 const on=fresh(t,fake());for(const input of [{pin:{...pin,thresholds:{social:0}}},{pin:{...pin,version:''}},{pin:{...pin,thresholds:{unknown:.5}}},{consent:'yes'}])await assert.rejects(on.run('classify.settings',{input}),{code:'invalid_classification'});
});
test('post-intake tag overflow skips tag changes while retaining evidence and quarantine; intake overflow rolls back',async t=>{
 const c=fake(),e=fresh(t,c);await put(e,'a',{tags:Array.from({length:32},(_,n)=>({id:'tag'+n,source:'intake'}))});await enable(e);
 await e.run('rules.replace',{input:{rules:[{id:'overflow',enabled:true,match:{tagsAll:['sys:suspected.social']},actions:{addTags:['overflow'],quarantined:true}}]}});
 const result=await e.run('classify.item',{id:'a'});assert.equal(result.item.quarantined,true);assert.ok(result.item.automated['sys:suspected.social']);assert.equal(result.item.tags.includes('overflow'),false);assert.ok(result.item.tagHistory.some(h=>h.op==='skip'&&h.reason==='tag_limit'));
 await put(e,'intake',{tags:Array.from({length:32},(_,n)=>({id:'tag'+n,source:'intake'}))});
 await e.run('rules.replace',{input:{rules:[{id:'intake-overflow',enabled:true,match:{tagsAll:['tag0']},actions:{addTags:['overflow']}}]}});
 await assert.rejects(e.run('rules.apply',{id:'intake'}),{code:'invalid_actions'});assert.equal((await e.store.get('item/intake')).firedRules,undefined);
});

// Item-classification §8 (provisional): per-kind selection with the fallback field, the owner's detail ceiling per field,
// the no-effect failover rule, explicit unscored items and owner-visible gaps.
test('the detail level of the field actually used bounds what Parlay sends; absent means minimal',async t=>{
 for(const [values,detail,tags] of [[{text:TEXT},'minimal',undefined],[{text:TEXT,textDetail:'minimal'},'minimal',undefined],[{text:TEXT,textDetail:'standard'},'standard',undefined],[{text:TEXT,textDetail:'full'},'full',{source:'email',context:['auto-submitted','list-id']}],[{fallback:FALLBACK,textDetail:'full'},'minimal',undefined],[{fallback:FALLBACK,fallbackDetail:'full'},'full',{source:'email',context:['auto-submitted','list-id']}],[{text:TEXT,textDetail:'everything'},'minimal',undefined]]){
  const c=fake(undefined,undefined,{values}),e=fresh(t,c);await put(e);await enable(e);await e.run('classify.item',{id:'a'});
  assert.equal(c.calls[0].detail,detail,JSON.stringify(values));assert.deepEqual(c.calls[0].tags,tags,JSON.stringify(values));assert.equal(c.resources[0],values.text??values.fallback);
 }
});
test('per-kind selection: text first, the fallback only after a proven no-effect refusal or a capability miss',async t=>{
 const run=async(c)=>{const e=fresh(t,c);await put(e);await enable(e);return {e,r:await e.run('classify.item',{id:'a'})};};
 const both={text:TEXT,textDetail:'standard',fallback:FALLBACK,fallbackDetail:'full'};
 // Capabilities that do not cover text/plain skip the text classifier without sending it the item.
 let c=fake(undefined,undefined,{values:both});c.capabilities=async resource=>resource===TEXT?{kinds:[{kind:'image',mediaTypes:['image/*'],inputs:['inline'],maxBytes:1000}],maxLabels:16}:TEXT_CAPS;
 let {r}=await run(c);assert.equal(r.source,'classifier');assert.deepEqual(c.resources,[FALLBACK]);assert.equal(c.calls[0].detail,'full','the fallback field brings its own detail level');
 // unsupported_item and the other no-effect codes advance to the fallback.
 for(const code of ['unsupported_item','rate_limited','temporarily_unavailable','forbidden']){
  c=fake(undefined,undefined,{values:both});const inner=c.classify.bind(c);c.classify=async(resource,input)=>{if(resource===TEXT){c.resources.push(resource);throw Object.assign(new Error('no'),{code});}return inner(resource,input);};
  ({r}=await run(c));assert.equal(r.source,'classifier',code);assert.deepEqual(c.resources,[TEXT,FALLBACK],code);
 }
 // An ambiguous outcome never reaches a second classifier: the item stays unscored.
 for(const code of ['indeterminate','item_unavailable',undefined]){
  c=fake(undefined,undefined,{values:both});c.classify=async resource=>{c.resources.push(resource);throw Object.assign(new Error('?'),code?{code}:{});};
  ({r}=await run(c));assert.equal(r.status,'unscored');assert.deepEqual(c.resources,[TEXT],String(code));
 }
 // The same resource in both fields is asked once.
 c=fake(undefined,undefined,{values:{text:TEXT,fallback:TEXT}});c.classify=async resource=>{c.resources.push(resource);throw Object.assign(new Error('no'),{code:'unsupported_item'});};
 ({r}=await run(c));assert.deepEqual([r.status,r.reason],['unscored','unsupported']);assert.deepEqual(c.resources,[TEXT]);
});
test('no classifier for text, or none that can classify it, is an unscored item and a gap shown to the owner',async t=>{
 const c=fake(undefined,undefined,{values:{image:'https://classifiers.example/r/image'}}),e=fresh(t,c);await put(e);await put(e,'b');await enable(e);
 const r=await e.run('classify.item',{id:'a'});assert.deepEqual([r.status,r.reason],['unscored','no_classifier']);assert.equal(c.calls.length,0);
 let status=await e.run('classify.status');assert.deepEqual(status.gaps.map(g=>[g.kind,g.mediaType,g.reason]),[['text','text/plain','no_classifier']]);
 assert.equal((await e.store.get('bb:classify:settings')).usage.calls,0,'nothing was dispatched, so no allowance was used');
 // Every candidate refuses text: the gap says so.
 c.values={text:TEXT,fallback:FALLBACK};c.capabilities=async()=>({kinds:[{kind:'text',mediaTypes:['text/html'],inputs:['inline'],maxBytes:100000}],maxLabels:16});
 assert.deepEqual([(await e.run('classify.item',{id:'b'})).reason],['unsupported']);status=await e.run('classify.status');assert.deepEqual(status.gaps.map(g=>g.reason),['unsupported']);
 // A score clears the gap.
 c.capabilities=async()=>TEXT_CAPS;await put(e,'c');assert.equal((await e.run('classify.item',{id:'c'})).source,'classifier');assert.deepEqual((await e.run('classify.status')).gaps,[]);
});
test('engine path through the contract test double: Parlay arguments pass contract validation and scores come back',async t=>{
 const double=classifierDouble({log:true}),port=classifierPort({values:{text:TEXT,textDetail:'full'},resources:{[TEXT]:double}}),e=fresh(t,port);
 await put(e,'a',{message:{parts:[{mimeType:'text/plain',dataBase64url:base64url(encoder.encode('your social plans for friday'))}]}});
 await e.run('classify.settings',{input:{consent:true,pin:{model:'test/double',version:'1',schema:TAXONOMY,thresholds:{social:.9}}}});
 const r=await e.run('classify.item',{id:'a'});assert.equal(r.source,'classifier');assert.equal(r.item.automated['sys:suspected.social'].classifier.probability,.95);
 assert.deepEqual(port.dispatches.map(d=>d.method),['capabilities','classify']);assert.equal(new Set(port.dispatches.map(d=>d.tx)).size,2,'a fresh tx per call');
 assert.deepEqual(double.counts,{capabilities:1,classify:1,fetched:0,refused:0});
});
