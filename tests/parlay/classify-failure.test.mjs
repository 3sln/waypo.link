// Owner direction 2026-10-28 (signed in session): an item whose auto-classification fails (allowance, deadline,
// unavailable, unknown outcome, invalid result, no longer eligible) gets the "auto-classification failed" tag, keeps a
// reason, and goes through the final rule run (effects, held notification); the owner finds such items with a tag filter
// and re-requests them (classify.retry). Security review fixes M2 (pending always resolves: ineligible completion,
// deadline sweep, cleanup on removal) and L2 (no second charge). Engine level, plus seeded chaos against a reference
// model written from those rules, not from the implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestEngine,memoryStore,OWNER} from './helpers/engine.mjs';
import {createMailbox} from '../../apps/parlay/worker/mailbox.mjs';
import {organizationProviders} from '../../packages/messaging-engine/domains/views.mjs';
import {base64url} from '../../packages/messaging-protocol/index.mjs';
import {TAXONOMY} from '../../packages/messaging-engine/domains/categories.mjs';
import {CLASSIFICATION_DEADLINE_MS,CLASSIFICATION_FAILED_TAG as FAILED,MAX_CLASSIFY_RETRY} from '../../packages/messaging-engine/domains/classify.mjs';
import {removeIncoming,projectIncoming,classifyPendingKey} from '../../packages/messaging-engine/store/item-index.mjs';
import {nextWake} from '../../apps/parlay/worker/storage.mjs';
import {forEachSeed,fakeClock} from '../helpers/chaos.mjs';

const MODEL={model:'triage',version:'1',schema:TAXONOMY},enc=new TextEncoder(),dec=new TextDecoder();
const TEXT='https://classifiers.example/r/text',CAPS={kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['inline'],maxBytes:65536}],maxLabels:16};
const port=({gate=async()=>{},fail=null}={})=>({calls:0,async fields(){return {text:TEXT,textDetail:'minimal'};},async capabilities(){return CAPS;},async classify(_,args){this.calls++;const verdict=await gate(args);if(fail??verdict)throw Object.assign(new Error('x'),{code:fail??verdict});const text=dec.decode(args.item.data);return {scores:Object.fromEntries(args.labels.map(l=>[l.id,text.includes(l.id)?.99:.01])),model:{id:MODEL.model,version:MODEL.version}};}});
const fresh=(t,classifier,clock)=>{const e=createTestEngine({...clock?{clock}:{},providers:organizationProviders({PARLAY_ENABLED:true,classifier})});t.after(()=>e.dispose());return e;};
// A native one-off message with a text/plain body (bridged channel items went with the email bridge, 2026-10-28).
const put=async(e,id,text='hello')=>{await e.store.put('body/'+id,enc.encode(text));await e.store.put('item/'+id,{id,origin:'native',kind:'one-off',subject:'',content:{mimeType:'text/plain'},receivedAt:10,state:'inbox',tags:[],notification:'push'});};
// The failure tag is visible to rules: this one files failed items (an effect, so it waits for the final run).
const FAILED_RULE={id:'failed-folder',enabled:true,match:{tagsAll:[FAILED]},actions:{collection:'Failed'}};
const setup=async(e,{allowance}={})=>{await e.run('classify.settings',{input:{consent:true,...allowance!==undefined?{allowance}:{},pin:{...MODEL,thresholds:{social:.9}}}});const rules=await e.run('rules.list');await e.run('rules.replace',{input:{rules:[FAILED_RULE,...rules.map(r=>({...r,enabled:false}))]}});};
const tags=item=>(item.tags??[]).map(t=>typeof t==='string'?t:t.id).sort();
const reason=item=>item.classificationResult?.classifier?.result?.reason??null;

test('every failure path: the failure tag with its reason, the final rule run (rules see the tag) and the released notification',async t=>{
 // Unknown outcome, invalid result, unavailable (a no-effect refusal with no other classifier) and the allowance.
 for(const [mode,expected] of [['indeterminate','unknown_outcome'],['unsupported_item','unsupported'],['allowance','allowance'],['malformed','invalid_result']]){
  const c=port(mode==='allowance'||mode==='malformed'?{}:{fail:mode});if(mode==='malformed')c.classify=async()=>({scores:{nope:1},model:{id:'m',version:'1'}});
  const e=fresh(t,c);await put(e,'a','social');await setup(e,mode==='allowance'?{allowance:0}:{});await e.run('classify.begin',{id:'a'});
  const r=await e.run('classify.item',{id:'a'});assert.deepEqual([r.status,r.reason],['failed',expected],mode);
  const item=await e.store.get('item/a');assert.equal(item.classificationPending,undefined);assert.equal(item.notification,'push',mode);
  assert.deepEqual(tags(item),[FAILED]);assert.equal(reason(item),expected);assert.equal(item.tags.find(x=>x.id===FAILED).reason,expected,'the tag keeps its reason for display');
  assert.equal(item.collection,'Failed','the final run saw the failure tag and executed its effect once');assert.equal(item.effectsExecuted,'a#1');
  const found=await e.run('incoming.query',{input:{filter:{version:1,tagsAll:[FAILED]},limit:10}});assert.deepEqual(found.items.map(x=>x.id),['a'],'found by a tag filter');
 }
});

test('review M2: a pending item that is no longer eligible is completed, failed, never left pending',async t=>{
 const c=port(),e=fresh(t,c);await setup(e);
 // A conversation (projected only, as the conversation domain does) opted in, begun, then opted out.
 await e.store.transaction(tx=>projectIncoming(tx,{id:'conv',type:'conversation',kind:'conversation',subject:'Plans',receivedAt:10,state:'inbox',notification:'push'}));
 await e.run('classify.settings',{input:{conversation:{id:'conv',enabled:true}}});assert.equal((await e.run('classify.begin',{id:'conv'})).status,'pending');
 await e.run('classify.settings',{input:{conversation:{id:'conv',enabled:false}}});
 const r=await e.run('classify.item',{id:'conv'});assert.deepEqual([r.status,r.reason],['failed','ineligible']);assert.equal(c.calls,0,'nothing is sent for an ineligible item');
 const row=(await e.run('incoming.query',{input:{limit:10}})).items.find(x=>x.id==='conv');assert.equal(row.classificationPending,undefined);assert.ok(row.tags.includes(FAILED));
 // Consent withdrawn before the call: the same.
 await put(e,'b');await e.run('classify.begin',{id:'b'});await e.run('classify.settings',{input:{consent:false}});
 assert.deepEqual((await e.run('classify.item',{id:'b'})).reason,'ineligible');assert.equal((await e.store.get('item/b')).notification,'push');
 assert.equal((await e.run('classify.status')).pending.count,0);
});

test('review M2: the deadline sweep fails items pending too long, releases them once, and a late classifier answer changes nothing',async t=>{
 const clock=fakeClock(Date.UTC(2026,9,28,12));let release,started;const ready=new Promise(r=>started=r);
 const c=port({gate:()=>{started();return new Promise(r=>release=r);}}),e=fresh(t,c,clock);await put(e,'a','social');await put(e,'b');await setup(e);
 await e.run('classify.begin',{id:'a'});await e.run('classify.begin',{id:'b'});
 assert.deepEqual((await e.run('classify.sweep')).due.sort(),['a','b'],'unclaimed items are due for classification');
 const late=e.run('classify.item',{id:'a'});await ready;
 assert.deepEqual((await e.run('classify.sweep')).due,['b'],'a claimed item is not handed out again');
 // Before the deadline nothing fails; at the deadline both do, through the final run.
 clock.advance(CLASSIFICATION_DEADLINE_MS-1);assert.equal((await e.run('classify.sweep')).failed,0);
 clock.advance(1);assert.equal((await e.run('classify.sweep')).failed,2);
 for(const id of ['a','b']){const item=await e.store.get('item/'+id);assert.equal(item.classificationPending,undefined);assert.equal(reason(item),'deadline');assert.equal(item.notification,'push');assert.equal(item.collection,'Failed');assert.equal(item.effectsExecuted,id+'#1');}
 release();assert.deepEqual(await late.then(r=>[r.status,r.reason]),['skipped','changed']);
 const item=await e.store.get('item/a');assert.equal(reason(item),'deadline');assert.equal(tags(item).includes('sys:suspected.social'),false);assert.equal(item.effectsExecuted,'a#1','effects ran once');
 assert.equal((await e.run('classify.status')).pending.count,0);
});

test('review M2: removing an item removes its pending entry; the sweep drops orphans',async t=>{
 const e=fresh(t,port());await put(e,'a');await put(e,'b');await setup(e);await e.run('classify.begin',{id:'a'});await e.run('classify.begin',{id:'b'});
 await e.store.transaction(async tx=>{await tx.delete('item/a');await removeIncoming(tx,'a');});
 assert.equal(await e.store.get(classifyPendingKey('a')),undefined);assert.equal((await e.run('classify.status')).pending.count,1);
 // An orphan written by an older build (or another writer) is removed by the sweep, never counted as slow forever.
 await e.store.put(classifyPendingKey('ghost'),{since:0});const swept=await e.run('classify.sweep');assert.equal(swept.removed,1);assert.equal((await e.run('classify.status')).pending.count,1);
});

test('review L2: repeated or concurrent classify.item charges once per pending entry and never for a classified item',async t=>{
 let release;const gate=new Promise(r=>release=r),c=port({gate:()=>gate}),e=fresh(t,c);await put(e,'a','social');await setup(e);await e.run('classify.begin',{id:'a'});
 const first=e.run('classify.item',{id:'a'});await new Promise(r=>setTimeout(r,0));
 const others=await Promise.all([e.run('classify.item',{id:'a'}),e.run('classify.item',{id:'a'})]);assert.deepEqual(others.map(r=>r.reason),['in-progress','in-progress']);
 release();assert.equal((await first).status,'complete');
 for(let i=0;i<3;i++)assert.equal((await e.run('classify.item',{id:'a'})).reason,'classified');
 assert.equal(c.calls,1);assert.equal((await e.store.get('bb:classify:settings')).usage.calls,1);
 assert.equal((await e.run('classify.begin',{id:'a'})).reason,'classified','a classified item never begins again');
});

test('classify.retry: an owner re-request re-enters pending, is charged again, respects the allowance and refuses what is not failed',async t=>{
 const c=port({fail:'indeterminate'}),e=fresh(t,c);for(const id of ['a','b','c','ok'])await put(e,id,'social');await setup(e,{allowance:5});
 for(const id of ['a','b','c']){await e.run('classify.begin',{id});await e.run('classify.item',{id});}
 c.classify=port().classify;await e.run('classify.begin',{id:'ok'});await e.run('classify.item',{id:'ok'});
 assert.equal((await e.store.get('bb:classify:settings')).usage.calls,4);
 // Allowance 5, 4 used: one item fits today; the rest are refused here rather than queued to fail.
 const out=await e.run('classify.retry',{input:{ids:['a','b','ok','missing']}});
 assert.deepEqual(out.results.map(r=>[r.id,r.status,r.reason??null]),[['a','pending',null],['b','refused','allowance'],['ok','refused','not_failed'],['missing','refused','not_found']]);
 let item=await e.store.get('item/a');assert.deepEqual(item.classificationPending.retry,true);assert.equal(tags(item).includes(FAILED),false,'the failure tag is cleared while pending');assert.equal(item.notification,null);assert.equal(item.heldNotification,'push');
 assert.equal((await e.run('classify.retry',{input:{ids:['a']}})).results[0].reason,'pending');
 const r=await e.run('classify.item',{id:'a'});assert.equal(r.status,'complete');assert.equal((await e.store.get('bb:classify:settings')).usage.calls,5,'charged again');
 item=await e.store.get('item/a');assert.deepEqual(tags(item),['sys:suspected.social']);assert.equal(item.notification,'push');assert.equal(item.collection,'Failed','an executed effect is not undone');assert.equal(item.effectsExecuted,'a#2');
 assert.equal(item.automated['sys:suspected.social'].classifier.probability,.99);
 // The allowance used up: a retry is refused; tomorrow it fits again.
 assert.equal((await e.run('classify.retry',{input:{ids:['b']}})).results[0].reason,'allowance');
 // Consent withdrawn: refused.
 await e.run('classify.settings',{input:{consent:false,allowance:100}});assert.equal((await e.run('classify.retry',{input:{ids:['b']}})).results[0].reason,'no_consent');
 for(const input of [{},{ids:[]},{ids:['a','a']},{ids:Array.from({length:MAX_CLASSIFY_RETRY+1},(_,i)=>'x'+i)},{ids:['a'],extra:1},{ids:[7]}])await assert.rejects(e.run('classify.retry',{input}),{code:'invalid_classification'},JSON.stringify(input).slice(0,60));
 // An owner who removed the failure tag still sees a new failure after a re-request.
 await e.run('classify.settings',{input:{consent:true}});const row=(await e.run('incoming.query',{input:{limit:10}})).items.find(x=>x.id==='b');
 await e.run('incoming.update',{input:{id:'b',expectedRevision:row.organizationRevision,removeTags:[FAILED]}});assert.equal(tags(await e.store.get('item/b')).includes(FAILED),false);
 c.classify=port({fail:'indeterminate'}).classify;assert.equal((await e.run('classify.retry',{input:{ids:['b']}})).results[0].status,'pending');await e.run('classify.item',{id:'b'});assert.ok(tags(await e.store.get('item/b')).includes(FAILED));
});

test('worker alarm schedule: an unclaimed pending item wakes the alarm now; a claimed one at its deadline',async t=>{
 const clock=fakeClock(Date.UTC(2026,9,28,12));let release;const c=port({gate:()=>new Promise(r=>release=r)}),e=fresh(t,c,clock);await put(e,'a');await setup(e);await e.run('classify.begin',{id:'a'});
 const wake=()=>e.store.transaction(tx=>nextWake(tx,clock.now()));
 assert.equal(await wake(),clock.now()+1);
 const call=e.run('classify.item',{id:'a'});await new Promise(r=>setTimeout(r,0));
 assert.equal(await wake(),clock.now()+CLASSIFICATION_DEADLINE_MS);release();await call;assert.equal(await wake(),null);
});

test('app shell alarm: classifies due pending items through the mailbox port once, then fails overdue ones at the deadline',async t=>{
 let now=Date.UTC(2026,9,28,12);const clock={now:()=>now},c=port(),store=memoryStore([['owner',OWNER]]),box=createMailbox({store,PARLAY_ENABLED:true,clock,ports:{classifier:c}});t.after(()=>box.dispose());
 await box.open(OWNER);await box.run(OWNER,'classify.settings',{input:{consent:true,pin:{...MODEL,thresholds:{social:.9}}}});
 for(const id of ['a','b']){await store.put('body/'+id,enc.encode('social '+id));await store.put('item/'+id,{id,origin:'native',kind:'one-off',subject:'',content:{mimeType:'text/plain'},receivedAt:10,state:'inbox',tags:[],notification:'push'});}
 await box.run(OWNER,'classify.begin',{id:'a'});await box.alarm();
 assert.equal(c.calls,1);assert.equal((await store.get('item/a')).classificationPending,undefined);assert.equal((await store.get('item/a')).notification,'push');
 await box.alarm();assert.equal(c.calls,1,'never classified twice');
 // A claimed entry whose host call never returned: the alarm fails it at the deadline.
 await box.run(OWNER,'classify.begin',{id:'b'});await store.put(classifyPendingKey('b'),{since:now,claimed:now});
 now+=CLASSIFICATION_DEADLINE_MS;await box.alarm();const b=await store.get('item/b');assert.equal(reason(b),'deadline');assert.ok(tags(b).includes(FAILED));assert.equal(b.notification,'push');assert.equal(c.calls,1);
});

// Seeded chaos against a reference model written from the rules (owner direction 2026-10-28; review M2 and L2):
//  R1 a pending entry is classified at most once (one claim, one charge);
//  R2 a call answers only for the entry that claimed it, and only if the settings did not change meanwhile ('changed');
//  R3 an entry that is no longer eligible (consent withdrawn) completes failed ('ineligible');
//  R4 an entry past the deadline completes failed ('deadline') when the sweep runs;
//  R5 every completion runs the final rules once and releases the notification; nothing stays pending at the end;
//  R6 a removed item leaves no pending entry; R7 only a failed, eligible item is re-requested, within the allowance.
test('seeded chaos: begin, classify, answer, settings changes, removal, deadline sweeps and re-requests match the reference model',{timeout:120000},async t=>{
 // A second classifier call for one pending entry (R1 broken) never gets an answer here, so it shows up as this timeout.
 await forEachSeed(16,async random=>{
  const clock=fakeClock(Date.UTC(2026,9,28,12)),calls=[];
  const c=port({gate:args=>new Promise(resolve=>calls.push({text:dec.decode(args.item.data).trim(),resolve}))}),e=fresh(t,c,clock);
  const ids=['i0','i1','i2','i3','i4','i5'],texts=Object.fromEntries(ids.map((id,i)=>[id,i%2?'social '+id:'plain '+id]));
  for(const id of ids)await put(e,id,texts[id]);await setup(e,{allowance:12});
  // Reference state.
  const M={consent:true,revision:0,used:0,charged:0,items:Object.fromEntries(ids.map(id=>[id,{present:true,pending:null,last:null,completions:0,classified:false,failedEver:false}]))};
  let entry=0;const inflight=[];
  const complete=(it,outcome)=>{it.pending=null;it.completions++;it.last=outcome;it.classified=true;if(outcome!=='scored')it.failedEver=true;};
  const steps=[];
  for(let n=0;n<40;n++){
   const id=random.pick(ids),it=M.items[id],op=random.pick(['begin','begin','item','item','answer','answer','consent','sweep','advance','remove','retry']);steps.push(op+':'+id);
   if(op==='begin'){await e.run('classify.begin',{id}).catch(()=>{});if(it.present&&!it.pending&&M.consent&&!it.classified)it.pending={entry:++entry,since:clock.now(),claimed:false};}
   else if(op==='item'){
    if(!it.present||!it.pending&&!it.classified)continue;// the direct path (never begun) is outside this model
    const before=calls.length,run=e.run('classify.item',{id});
    if(it.pending&&!it.pending.claimed){
     if(!M.consent){await run;complete(it,'ineligible');}
     else if(M.used>=12){it.pending.claimed=true;await run;complete(it,'allowance');}
     else{it.pending.claimed=true;M.used++;M.charged++;while(calls.length===before)await new Promise(r=>setTimeout(r,0));inflight.push({id,entry:it.pending.entry,revision:M.revision,call:calls.at(-1),run,fail:random.chance(.3)});}
    }else await run;
   }
   else if(op==='answer'&&inflight.length){
    const f=inflight.splice(random.int(inflight.length),1)[0],target=M.items[f.id];f.call.resolve(f.fail?'indeterminate':undefined);await f.run;
    if(target.present&&target.pending?.entry===f.entry)complete(target,M.revision!==f.revision?'changed':f.fail?'unknown_outcome':'scored');
   }
   else if(op==='consent'){M.consent=!M.consent;M.revision++;await e.run('classify.settings',{input:{consent:M.consent}});}
   else if(op==='advance')clock.advance(random.pick([1000,CLASSIFICATION_DEADLINE_MS/2,CLASSIFICATION_DEADLINE_MS]));
   else if(op==='sweep'){await e.run('classify.sweep');for(const x of Object.values(M.items))if(x.present&&x.pending&&clock.now()-x.pending.since>=CLASSIFICATION_DEADLINE_MS)complete(x,'deadline');}
   else if(op==='remove'&&it.present){it.present=false;it.pending=null;await e.store.transaction(async tx=>{await tx.delete('item/'+id);await removeIncoming(tx,id);});}
   else if(op==='retry'&&it.present){
    const queued=Object.values(M.items).filter(x=>x.present&&x.pending&&!x.pending.claimed).length;
    const ok=!it.pending&&it.classified&&it.last!=='scored'&&M.consent&&12-M.used-queued>0;
    const r=await e.run('classify.retry',{input:{ids:[id]}});assert.equal(r.results[0].status,ok?'pending':'refused',steps.join(' '));
    if(ok){it.pending={entry:++entry,since:clock.now(),claimed:false};it.classified=false;it.last=null;}
   }
  }
  // Drain: answer every call still in flight, then the deadline passes and the sweep runs (R4, R5).
  for(const f of random.shuffle(inflight.splice(0))){const target=M.items[f.id];f.call.resolve(f.fail?'indeterminate':undefined);await f.run;if(target.present&&target.pending?.entry===f.entry)complete(target,M.revision!==f.revision?'changed':f.fail?'unknown_outcome':'scored');}
  clock.advance(CLASSIFICATION_DEADLINE_MS);await e.run('classify.sweep');for(const x of Object.values(M.items))if(x.present&&x.pending)complete(x,'deadline');
  const where=steps.join(' ');
  assert.equal(c.calls,M.charged,'R1: one classifier call per claimed entry '+where);assert.equal((await e.store.get('bb:classify:settings')).usage.calls,M.used,where);
  assert.equal((await e.store.list({prefix:'bb:classify:pending/'})).size,0,'R5/R6: nothing pending '+where);assert.equal((await e.run('classify.status')).pending.count,0);
  for(const id of ids){
   const it=M.items[id],item=await e.store.get('item/'+id);
   if(!it.present){assert.equal(item,undefined);continue;}
   assert.equal(item.classificationPending,undefined,id+' '+where);
   if(!it.completions){assert.equal(item.notification,'push');continue;}
   assert.equal(item.notification,'push','R5: released '+id+' '+where);assert.equal(item.effectsExecuted,`${id}#${it.completions}`,'R5: effects once per completion '+id+' '+where);
   const failedNow=it.last!=='scored';assert.equal(tags(item).includes(FAILED),failedNow,id+' '+where);
   if(failedNow)assert.equal(reason(item),it.last,id+' '+where);else assert.equal(item.classificationResult.classifier.result.status,'complete');
   assert.equal(item.collection??null,it.failedEver?'Failed':null,'effects are executed, never undone '+id+' '+where);
  }
 });
});
