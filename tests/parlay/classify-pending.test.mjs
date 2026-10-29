// Owner direction 2026-10-28 (provisional): an item awaiting auto-classification is visibly pending, the owner is warned
// when classification is slow, and rules run once before auto-tagging and again after it completes, each from a blank
// slate (the final run replaces the provisional one). Engine level, including seeded chaos over classifier latency and
// completion order with rules changing in between.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestEngine} from './helpers/engine.mjs';
import {organizationProviders} from '../../packages/messaging-engine/domains/views.mjs';
import {base64url} from '../../packages/messaging-protocol/index.mjs';
import {TAXONOMY} from '../../packages/messaging-engine/domains/categories.mjs';
import {CLASSIFICATION_SLOW_MS} from '../../packages/messaging-engine/domains/classify.mjs';
import {forEachSeed,fakeClock} from '../helpers/chaos.mjs';

const MODEL={model:'triage',version:'1',schema:TAXONOMY},enc=new TextEncoder(),dec=new TextDecoder();
const TEXT='https://classifiers.example/r/text',CAPS={kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['inline'],maxBytes:65536}],maxLabels:16};
// Scores come from words in the text: "social" and "spam" score 0.99, anything else 0.01. `gate` delays each call.
const port=({gate=async()=>{},fail=null}={})=>({calls:0,async fields(){return {text:TEXT,textDetail:'minimal'};},async capabilities(){return CAPS;},async classify(_,args){this.calls++;await gate(args);if(fail)throw Object.assign(new Error('x'),{code:fail});const text=dec.decode(args.item.data);return {scores:Object.fromEntries(args.labels.map(l=>[l.id,text.includes(l.id)?.99:.01])),model:{id:MODEL.model,version:MODEL.version}};}});
const fresh=(t,classifier,clock)=>{const e=createTestEngine({...clock?{clock}:{},providers:organizationProviders({PARLAY_ENABLED:true,classifier})});t.after(()=>e.dispose());return e;};
// A native one-off message with a text/plain body (bridged channel items went with the email bridge, 2026-10-28).
const put=async(e,id,text='hello',extra={})=>{await e.store.put('body/'+id,enc.encode(text));await e.store.put('item/'+id,{id,origin:'native',kind:'one-off',subject:'',content:{mimeType:'text/plain'},receivedAt:10,state:'inbox',tags:[{id:'from-list',source:'intake'}],notification:'push',...extra});};
const RULES=[
 {id:'list-tag',enabled:true,match:{tagsAll:['from-list']},actions:{addTags:['list-mail']}},
 {id:'list-quarantine',enabled:false,match:{tagsAll:['from-list']},actions:{quarantined:true}},
 {id:'list-folder',enabled:true,match:{tagsAll:['from-list']},actions:{collection:'Lists'}},
 {id:'friends',enabled:true,match:{tagsAll:['sys:suspected.social'],source:'classifier'},actions:{addTags:['friends']}},
 {id:'not-list',enabled:true,match:{tagsAll:['sys:suspected.social'],source:'classifier'},actions:{removeTags:['list-mail']}},
];
const setup=async(e,rules=RULES)=>{await e.run('classify.settings',{input:{consent:true,pin:{...MODEL,thresholds:{social:.9,spam:.9}}}});const defaults=(await e.run('rules.list')).filter(r=>r.default);await e.run('rules.replace',{input:{rules:[...rules,...defaults]}});};
const view=item=>({tags:[...item.tags].map(t=>typeof t==='string'?t:t.id).sort(),quarantined:Boolean(item.quarantined),collection:item.collection??null,notification:item.notification??null});

test('classify.begin: provisional rules, held notification, a visible pending state and a slow warning after the threshold',async t=>{
 const clock=fakeClock(Date.UTC(2026,9,28,12)),c=port(),e=fresh(t,c,clock);await put(e,'a');await setup(e);
 const begun=await e.run('classify.begin',{id:'a'});assert.equal(begun.status,'pending');
 let item=await e.store.get('item/a');assert.deepEqual(item.classificationPending,{since:clock.now()});assert.equal(item.notification,null,'no notification while pending');assert.equal(item.heldNotification,'push');
 assert.deepEqual(view(item).tags,['from-list','list-mail']);assert.equal(item.ruleRun.run,1);
 assert.equal(item.collection??null,null,'effects wait for the final run');assert.deepEqual(item.ruleRun.effects,[{kind:'move',collection:'Lists',ruleId:'list-folder'}]);
 const rows=await e.run('incoming.query',{input:{limit:10}});assert.deepEqual(rows.items.find(r=>r.id==='a').classificationPending,{since:clock.now()},'the projection shows the pending state');
 assert.deepEqual(await e.run('classify.begin',{id:'a'}).then(r=>r.status),'pending','idempotent');
 let status=await e.run('classify.status');assert.deepEqual(status.pending,{count:1,slow:0,oldestSince:clock.now(),slowAfterMs:CLASSIFICATION_SLOW_MS});
 clock.advance(CLASSIFICATION_SLOW_MS);status=await e.run('classify.status');assert.equal(status.pending.slow,1);
 // Completion: the final run replaces the provisional one, the notification is released, pending is cleared.
 await put(e,'b','social plans');await e.run('classify.begin',{id:'b'});
 const done=await e.run('classify.item',{id:'b'});assert.equal(done.status,'complete');
 item=await e.store.get('item/b');assert.equal(item.classificationPending,undefined);assert.equal(item.heldNotification,undefined);assert.equal(item.notification,'push');assert.equal(item.ruleRun.run,2);
 assert.deepEqual(view(item).tags,['friends','from-list','sys:social'],'list-mail from run 1 is gone: the final run removed it');assert.equal(item.collection,'Lists','the final run executed its move');assert.equal(item.effectsExecuted,'b#1');
 status=await e.run('classify.status');assert.equal(status.pending.count,1,'a is still pending');
 // rules.apply leaves a pending item alone: its rules come from the blank-slate runs only.
 const pendingBefore=await e.store.get('item/a');assert.deepEqual(await e.run('rules.apply',{id:'a'}).then(()=>e.store.get('item/a')),pendingBefore);
 // Without consent nothing begins.
 await e.run('classify.settings',{input:{consent:false}});await put(e,'c');assert.equal((await e.run('classify.begin',{id:'c'})).reason,'no-consent');
});

test('the final run is a blank slate: effects of rules that no longer match are reverted; owner choices survive',async t=>{
 const c=port(),e=fresh(t,c);await put(e,'a');await setup(e,RULES.map(r=>r.id==='list-quarantine'?{...r,enabled:true}:r));
 await e.run('classify.begin',{id:'a'});let item=await e.store.get('item/a');assert.equal(Boolean(item.quarantined),false,'a provisional run never quarantines');assert.deepEqual(item.ruleRun.effects.map(x=>x.kind).sort(),['move','quarantine']);assert.deepEqual(view(item).tags,['from-list','list-mail']);
 // The owner disables the quarantine and folder rules and adds a tag of their own before classification completes.
 const rules=await e.run('rules.list');await e.run('rules.replace',{input:{rules:rules.map(r=>['list-quarantine','list-folder'].includes(r.id)?{...r,enabled:false}:r)}});
 const org=await e.run('incoming.query',{input:{limit:10}}),rev=org.items.find(r=>r.id==='a').organizationRevision;await e.run('incoming.update',{input:{id:'a',expectedRevision:rev,addTags:['mine']}});
 await e.run('classify.item',{id:'a'});item=await e.store.get('item/a');
 assert.equal(Boolean(item.quarantined),false,'the quarantine listed by the provisional run was never executed');assert.equal(item.collection??null,null);assert.equal(item.notification,'push','released after the final run');
 assert.deepEqual(view(item).tags,['from-list','list-mail','mine']);assert.equal(item.classificationPending,undefined);
 // A final state that is quarantined drops the held notification.
 await put(e,'s','spam spam');const all=await e.run('rules.list');await e.run('rules.replace',{input:{rules:all.map(r=>({...r,enabled:r.id==='default:promote.spam'?true:r.enabled}))}});
 await e.run('classify.begin',{id:'s'});await e.run('classify.item',{id:'s'});item=await e.store.get('item/s');assert.equal(item.quarantined,true);assert.equal(item.notification,null);
 // An owner-suppressed tag is not re-added by the final run.
 await put(e,'o','hello');await e.run('classify.begin',{id:'o'});const r=(await e.run('incoming.query',{input:{limit:20}})).items.find(x=>x.id==='o');await e.run('incoming.update',{input:{id:'o',expectedRevision:r.organizationRevision,removeTags:['list-mail']}});
 await e.run('classify.item',{id:'o'});assert.equal(view(await e.store.get('item/o')).tags.includes('list-mail'),false);
});

test('an unscored or failed classification still completes the item; consent withdrawn mid-flight completes it without evidence',async t=>{
 for(const fail of ['indeterminate','unsupported_item']){
  const c=port({fail}),e=fresh(t,c);await put(e,'a','social');await setup(e);await e.run('classify.begin',{id:'a'});
  const r=await e.run('classify.item',{id:'a'});assert.equal(r.status,'failed');const item=await e.store.get('item/a');
  assert.equal(item.classificationPending,undefined);assert.equal(item.notification,'push');assert.equal(item.classificationResult.classifier.result.status,'failed');assert.deepEqual(view(item).tags,['from-list','list-mail','sys:classification-failed']);
 }
 let release,started;const ready=new Promise(r=>started=r),c=port({gate:()=>{started();return new Promise(r=>release=r);}}),e=fresh(t,c);await put(e,'a','social');await setup(e);await e.run('classify.begin',{id:'a'});
 const pending=e.run('classify.item',{id:'a'});await ready;await e.run('classify.settings',{input:{consent:false}});release();
 const r=await pending;assert.equal(r.reason,'changed');const item=await e.store.get('item/a');assert.equal(item.classificationPending,undefined);assert.equal(view(item).tags.includes('friends'),false,'no evidence from a withdrawn consent');assert.equal(view(item).tags.includes('sys:classification-failed'),true);assert.equal(item.notification,'push');
});

test('seeded chaos: random latency and completion order with rules changing in between end exactly where one run with the final rules would',async t=>{
 const texts=['hello','social plans','spam spam','social spam','list news'];
 await forEachSeed(12,async random=>{
  const gates=[],failing=new Set(texts.filter(()=>random.chance(.3)));const c=port({gate:args=>new Promise((resolve,reject)=>gates.push(()=>failing.has(dec.decode(args.item.data).trim())?reject(Object.assign(new Error('x'),{code:random.pick(['indeterminate','unsupported_item','rate_limited'])})):resolve()))}),e=fresh(t,c);
  const initial=RULES.map(r=>({...r,enabled:random.chance(.5)})),final=RULES.map(r=>({...r,enabled:random.chance(.5)}));
  await setup(e,initial);const ids=texts.map((_,i)=>'i'+i);for(const [i,id] of ids.entries())await put(e,id,texts[i]);
  for(const id of random.shuffle([...ids]))await e.run('classify.begin',{id});
  const running=ids.map(id=>e.run('classify.item',{id}));
  // Rules change while classifications are in flight; calls then complete in a random order.
  while(gates.length<ids.length)await new Promise(r=>setTimeout(r,0));
  const current=await e.run('rules.list');await e.run('rules.replace',{input:{rules:current.map(r=>{const f=final.find(x=>x.id===r.id);return f?{...r,enabled:f.enabled}:r;})}});
  for(const gate of random.shuffle([...gates]))gate();await Promise.all(running);
  // Reference: a fresh mailbox with the final rules from the start, no interleaving.
  const ref=fresh(t,{...port(),async classify(_,args){if(failing.has(dec.decode(args.item.data).trim()))throw Object.assign(new Error('x'),{code:'indeterminate'});return port().classify(_,args);}});await setup(ref,final);for(const [i,id] of ids.entries()){await put(ref,id,texts[i]);await ref.run('classify.begin',{id});await ref.run('classify.item',{id});}
  for(const id of ids){const got=await e.store.get('item/'+id),want=await ref.store.get('item/'+id);assert.deepEqual(view(got),view(want),id);assert.equal(got.classificationPending,undefined);assert.equal(got.notification,got.quarantined?null:'push');assert.equal(got.effectsExecuted,id+'#1','effects executed exactly once, after the final run');}
  assert.equal((await e.run('classify.status')).pending.count,0);
 });
});
