// BB-B2 public-request intake: spam tiers, calibration mode, owner-only pins, principal allowlist overrides, unscored
// holds without consent/occupant/allowance, the bounded recoverable Rejected view and the per-sender/issuer/owner
// public limits. Bridged (email) intake, address allowlists, header heuristics and provider calibrations went with the
// email bridge (owner direction 2026-10-28); only native first-contact requests remain.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,P,NOW,uuidOf,encoder} from './receive-fixtures.test.mjs';
import * as intake from '../../packages/messaging-engine/domains/intake.mjs';
import * as budget from '../../packages/messaging-engine/domains/receive-budget.mjs';
import {KEYS} from '../../packages/messaging-engine/store/mailbox.mjs';
import {TAXONOMY,CATEGORY_DESCRIPTIONS} from '../../packages/messaging-engine/domains/categories.mjs';

// Pins bind to {model id, model version, Parlay's taxonomy}; the classifier reports only the model.
const MODEL={model:'spamnet',version:'3',schema:TAXONOMY};
// Host view of the item-classification fragment with one text classifier: the score is read from a `p=` marker in the
// (already minimized) text the call carries inline.
const TEXT='https://classifiers.example/r/text',CAPS={kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['inline'],maxBytes:65536}],maxLabels:16};
const textOf=input=>new TextDecoder().decode(input.item.data);
const classifier=(evidence=MODEL,values={text:TEXT})=>{const inputs=[];return {inputs,evidence,values,async fields(){return structuredClone(this.values);},async capabilities(){return CAPS;},async classify(resource,input){inputs.push(structuredClone(input));const text=textOf(input),p=Number(/p=(0\.\d+)/.exec(text)?.[1]??0);if(/explode/.test(text))throw new Error('occupant failure');return {scores:{spam:p},model:{id:this.evidence.model,version:this.evidence.version}};}};};
const fresh=async(t,options)=>{const w=await createWorld(options);t.after(()=>w.dispose());return w;};
const code=(r,status,error)=>{assert.equal(r.status,status,JSON.stringify(r.json));assert.equal(r.json.error,error);};
const {minimize,decideTier,T_HIGH}=intake;
const say=(w,from,link,n,text)=>w.deliver(from,'bob',link,{operationId:uuidOf(n),body:encoder.encode(text),createdAt:w.clock.now()-1000});
const byState=async w=>Object.groupBy(await w.items('bob'),i=>i.state);

test('spam storm through a request list: tiers apply after custody and nothing observable varies with them',async t=>{
 const c=classifier(),w=await fresh(t,{classifier:c}),link=await w.admit('bob',{policy:'request'});
 await w.run('bob','intake.settings',{classifierConsent:true,pin:MODEL});
 const responses=[];
 for(let i=0;i<5;i++)responses.push(await say(w,'alice',link,i+1,`Win money p=0.99 ${i}`));
 responses.push(await say(w,'carol',link,10,'Maybe spam p=0.80'),await say(w,'carol',link,11,'Hello there p=0.10'));
 // Every admitted request got the same 200 {receipt} shape and headers, and each receipt verifies for its sender.
 for(const r of responses){assert.equal(r.status,200);assert.deepEqual(Object.keys(r.json),['receipt']);assert.deepEqual([...r.headers.keys()].sort(),[...responses[0].headers.keys()].sort());assert.equal((await w.verify('bob',r,r.json.receipt)).state,'delivered');}
 assert.deepEqual(Object.keys(responses[0].json.receipt.payload).sort(),Object.keys(responses[6].json.receipt.payload).sort());
 // The per-sender public limit (5/day) refuses before classification with the ordinary code.
 const over=await say(w,'alice',link,6,'p=0.10 legit?');code(over,429,'rate_limited');
 assert.equal((await w.run('bob','receive.items')).items.length,0,'requests wait for the drain');
 const drained=await w.system('bob','intake.drain',{});assert.deepEqual(drained,{processed:7,rejected:5,suspected:1,classified:7,unscored:0});
 const s=await byState(w);assert.equal(s.rejected.length,5);assert.equal(s.request.length,2);
 for(const item of s.rejected){assert.equal(item.notification,null);assert.ok(item.tags.some(x=>x.id==='sys:spam'&&x.rule==='default:reject.spam'));}
 const requests=await w.run('bob','intake.requests');assert.deepEqual(requests.map(r=>r.priority),['normal','low'],'suspected requests sort last');
 assert.equal(s.request.find(i=>i.priority==='low').notification,'quiet');assert.equal(s.request.find(i=>i.priority==='normal').notification,'push');
 assert.equal((await w.run('bob','intake.rejected')).length,5);
 // Replays after rejection still return the identical receipt.
 assert.deepEqual((await w.post('alice','bob',responses[0].request)).json,responses[0].json);
 // The classifier saw minimized text only: no principal, issuer, link capability, URL or recipient.
 // Intake asks only Parlay's spam category (the caller supplies the taxonomy).
 for(const input of c.inputs){assert.deepEqual(Object.keys(input.item).sort(),['data','kind','mediaType','size']);assert.equal(input.detail,'minimal','no detail field approved: minimal');assert.equal(input.tags,undefined);assert.equal(textOf(input).includes('[url]')||!textOf(input).includes('http'),true);assert.deepEqual(input.labels,[{id:'spam',description:CATEGORY_DESCRIPTIONS.spam}]);for(const leak of [P.alice.principal.subject,'provider.example','bindle_meta','hub.box.example'])assert.equal((textOf(input)+JSON.stringify(input.labels)).includes(leak),false,leak);}
});

test('calibration mode, allowlist and rescue: thresholds are bound to the model version and allowlisted senders are never rejected',async t=>{
 const c=classifier(),w=await fresh(t,{classifier:c}),link=await w.admit('bob',{policy:'request'});
 await w.run('bob','intake.settings',{classifierConsent:true});
 await say(w,'alice',link,1,'p=0.995 unpinned');await w.system('bob','intake.drain',{});
 let [item]=await w.items('bob');assert.equal(item.state,'request');assert.equal(item.priority,'low');assert.equal(item.tagHistory[0].action,'calibration');
 // Pinned for version 3, then the occupant reports version 4: back to calibration, no auto-reject.
 await w.run('bob','intake.settings',{pin:MODEL});c.evidence={...MODEL,version:'4'};
 await say(w,'alice',link,2,'p=0.995 drifted');await w.system('bob','intake.drain',{});
 assert.equal((await byState(w)).rejected,undefined);
 // Only the owner calibrates: a calibration the occupant reports for itself is ignored (BB2-R5); provider-published
 // calibrations went with the email bridge.
 c.calibration=()=>({...MODEL,version:'4',high:0.5,low:0.1});
 await say(w,'alice',link,7,'p=0.995 self-calibrated');await w.system('bob','intake.drain',{});assert.equal((await byState(w)).rejected,undefined);
 await w.run('bob','intake.settings',{pin:{...MODEL,version:'4',high:0.99,low:0.8}});
 await say(w,'alice',link,3,'p=0.995 calibrated');await w.system('bob','intake.drain',{});
 const rejected=(await byState(w)).rejected;assert.equal(rejected.length,1);
 // Allowlisted principals: the reject is skipped and recorded; rules may still tag and deprioritize.
 await w.run('bob','intake.allow',{principal:P.carol.principal});
 // The allowlist holds principals only; email addresses and unknown members are refused.
 for(const input of [{email:'boss@corp.example'},{principal:P.alice.principal,email:'boss@corp.example'}])await assert.rejects(w.run('bob','intake.allow',input),{code:'invalid_input'});
 await say(w,'carol',link,4,'p=0.999 from a friend');await w.system('bob','intake.drain',{});
 item=(await w.items('bob')).find(i=>i.author.principal.subject===P.carol.principal.subject);
 assert.equal(item.state,'request');assert.equal(item.priority,'low');assert.deepEqual(item.tagHistory.map(h=>[h.action,h.reason]),[['reject-skipped','allowlist']]);
 // Rescue with "always allow": the item becomes an ordinary request and later spam-scored mail is not rejected.
 assert.deepEqual(await w.run('bob','intake.rescue',{id:rejected[0].id,allow:true}),{id:rejected[0].id,state:'request'});
 await assert.rejects(w.run('bob','intake.rescue',{id:rejected[0].id}),{code:'not_found'});
 assert.equal((await w.run('bob','intake.rejected')).length,0);
 await say(w,'alice',link,5,'p=0.999 again');await w.system('bob','intake.drain',{});assert.equal((await byState(w)).rejected,undefined);
 // Members of a `message` list (Contacts) are not requests at all.
 const priv=await w.admit('bob');const r=await w.deliver('alice','bob',priv,{operationId:uuidOf(6),body:encoder.encode('p=0.999 private')});assert.equal(r.status,200);
 assert.equal((await w.items('bob')).find(i=>i.operationId===uuidOf(6)).state,'inbox');
});

test('without consent, occupant or allowance there is no auto-reject, and nothing is guessed from headers',async t=>{
 const c=classifier(),w=await fresh(t,{classifier:c}),link=await w.admit('bob',{policy:'request'});
 await say(w,'alice',link,1,'p=0.999');await w.system('bob','intake.drain',{});assert.equal(c.inputs.length,0,'no consent: never called');
 let [item]=await w.items('bob');assert.deepEqual([item.state,item.priority,item.notification,item.scoring],['request','normal','push',undefined]);assert.deepEqual(item.tags,[],'no heuristic tags');
 await w.run('bob','intake.settings',{classifierConsent:true,pin:MODEL,allowance:1});
 await say(w,'alice',link,2,'p=0.999 first');await say(w,'carol',link,3,'p=0.999 second');
 const out=await w.system('bob','intake.drain',{});assert.equal(out.classified,1);assert.equal(out.rejected,1);assert.equal(out.unscored,1);
 item=(await w.items('bob')).find(i=>i.state==='request'&&i.id!==item.id);assert.deepEqual(item.tags,[]);assert.deepEqual(item.scoring,{state:'unscored',reason:'allowance',at:item.scoring.at},'allowance exhausted: explicitly unscored');assert.equal(item.notification,'quiet');
 // A failing occupant leaves the request unscored too.
 await w.run('bob','intake.settings',{allowance:10});await say(w,'carol',link,4,'explode p=0.999');await w.system('bob','intake.drain',{});
 item=(await w.items('bob')).find(i=>i.operationId===uuidOf(4));assert.equal(item.state,'request');assert.deepEqual([item.scoring.state,item.scoring.reason,item.notification],['unscored','unknown_outcome','quiet']);
 // The owner's request listing carries the marker, so the UI can say the request was not checked.
 assert.deepEqual((await w.run('bob','intake.requests')).find(r=>r.id===item.id).scoring,{state:'unscored',reason:'unknown_outcome'});
 assert.equal(decideTier({result:null}).tier,'none');assert.equal(decideTier({result:null,unscored:'allowance'}).tier,'unscored');
 assert.equal(decideTier({result:{spam:0.99,evidence:MODEL},pins:[{...MODEL,high:T_HIGH,low:0.7}]}).tier,'reject');
 assert.equal(decideTier({result:{spam:1.5,evidence:MODEL},pins:[{...MODEL,high:T_HIGH,low:0.7}]}).tier,'none','out-of-range scores are ignored');
 for(const name of ['heuristics','IntakeDeliver','IntakeAccept'])assert.equal(intake[name],undefined,name);
 assert.equal(intake.INTAKE_OPERATIONS.some(Op=>['intake.deliver','intake.accept'].includes(Op.operation)),false);
});

test('public request limits: 5 per sender, 100 per issuer host and 200 per owner a day; no email-domain row',()=>{
 assert.deepEqual({...budget.BUDGET_DEFAULTS.free.public},{sender:5,issuer:100,owner:200});assert.equal(budget.intakeBudgetIdentity,undefined);
 // The plus plan's owner windows (240/minute) sit above the public limits, isolating them.
 let state=null;const charge=(sender,domain)=>{state=budget.chargeBudget(state,{now:NOW,plan:'plus',bytes:0,parent:'first-contact',sender,request:{sender,domain}});};
 const limited=fn=>assert.throws(fn,{code:'rate_limited'});
 for(let i=0;i<5;i++)charge('same','one.example');limited(()=>charge('same','one.example'));
 let n=0;for(;n<120;n++){try{charge(`u${n}`,'flood.example');}catch(error){assert.equal(error.code,'rate_limited');break;}}
 assert.equal(n,100,'per issuer host');
 for(let d=0;state.public.owner<200;d++)charge(`x${d}`,`d${d}.example`);
 limited(()=>charge('late','fresh.example'));assert.equal(state.public.owner,200,'a refused charge is never applied');
 // The next UTC day starts fresh.
 state=budget.chargeBudget(state,{now:NOW+86400000,plan:'plus',bytes:0,parent:'first-contact',sender:'late',request:{sender:'late',domain:'fresh.example'}});assert.equal(state.public.owner,1);
});

test('the Rejected view is bounded to 500 items and 7 days, from its own reserve',async t=>{
 const c=classifier(),w=await fresh(t,{classifier:c}),link=await w.admit('bob',{policy:'request'}),store=w.peer('bob').store;
 await w.run('bob','intake.settings',{classifierConsent:true,pin:MODEL,allowance:10000});
 await say(w,'carol',link,1,'p=0.10 lunch?');await say(w,'alice',link,2,'p=0.99 flood');
 // 490 earlier rejections (seeded directly, a day old, for speed), then a 30-request flood through the drain: the
 // one delivered above plus 29 pending clones of it (the per-sender limit would otherwise stop one sender at 5; the
 // clones carry no hot-usage charge).
 const template=(await w.items('bob')).find(i=>i.operationId===uuidOf(2)),seededAt=w.clock.now()-86400000;
 await store.transaction(async tx=>{
  for(let i=0;i<490;i++){const id=`seed${String(i).padStart(39,'0')}`;await tx.put(`item/${id}`,{id,origin:'native',kind:'one-off',author:template.author,subject:'',state:'rejected',rejectedAt:seededAt+i,receivedAt:seededAt+i,tags:[],tagHistory:[],quarantined:false});await tx.put(KEYS.rejected(seededAt+i,id),{id});}
  for(let i=0;i<29;i++){const id=`flood${String(i).padStart(38,'0')}`,receivedAt=w.clock.now()+i;const {hot,...clone}=template;await tx.put(KEYS.item(id),{...clone,id,operationId:uuidOf(1000+i),receivedAt});await tx.put(KEYS.body(id),await tx.get(KEYS.body(template.id)));await tx.put(KEYS.pending(receivedAt,id),{id});}
 });
 while((await w.system('bob','intake.drain',{limit:256})).processed);
 const rejected=await w.run('bob','intake.rejected');assert.equal(rejected.length,500);assert.ok(rejected[0].rejectedAt>=rejected.at(-1).rejectedAt);
 assert.equal(rejected.filter(r=>r.id.startsWith('seed')).length,470,'the 20 oldest were evicted and erased');assert.equal(await store.get(`item/seed${'0'.repeat(39)}`),undefined);
 assert.equal((await w.run('bob','intake.requests')).length,1,'the flood never evicted the legitimate request');
 w.clock.advance(7*86400000+1);await w.system('bob','intake.sweep',{});assert.equal((await w.run('bob','intake.rejected')).length,0);
 assert.equal((await w.items('bob')).length,1);
});

test('minimization redacts capabilities, URLs, tokens and codes and bounds the text',()=>{
 const out=minimize('See https://x.example/a?b=c and web+bindle://add-contact?x bindle_meta=aaa.bbb.ccc Bearer abc.def code 123456 key ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 p=0.42');
 for(const leak of ['https://','web+bindle','aaa.bbb.ccc','abc.def','123456','ABCDEFGHIJKLMNOPQRSTUVWXYZ0123'])assert.equal(out.includes(leak),false,leak);
 assert.ok(out.includes('p=0.42'));assert.equal(minimize('x'.repeat(20000).replace(/x/g,'ab ')).length,8000);
});

test('a crash during the drain leaves the item pending and the rerun applies it exactly once; quarantine wins',async t=>{
 const c=classifier(),w=await fresh(t,{classifier:c}),link=await w.admit('bob',{policy:'request'});
 await w.run('bob','intake.settings',{classifierConsent:true,pin:MODEL});
 await say(w,'alice',link,1,'p=0.99 crash');
 const bob=w.peer('bob');bob.faults={mailboxStore:[{method:'transaction',when:1,mode:'throw'}]};await w.network.recover('bob');
 await assert.rejects(w.system('bob','intake.drain',{}),{code:'injected_fault'});assert.equal((await w.items('bob'))[0].state,'pending');
 assert.equal((await w.system('bob','intake.drain',{})).rejected,1);assert.equal((await w.system('bob','intake.drain',{})).processed,0);
 assert.equal((await w.items('bob'))[0].tags.filter(x=>x.id==='sys:spam').length,1);
 // A request whose author key is learned revoked before the drain is quarantined, never classified or shown.
 await say(w,'carol',link,2,'p=0.10 pending');w.directory.revoke(P.carol.jkt,Math.floor(w.clock.now()/3600000));
 w.clock.advance(300001);const recheck=await w.system('bob','delegation.recheck',{});assert.equal(recheck.revoked,1);
 const before=c.inputs.length;assert.equal((await w.system('bob','intake.drain',{})).processed,0);assert.equal(c.inputs.length,before);
 assert.equal((await w.items('bob')).find(i=>i.author.principal.subject===P.carol.principal.subject).quarantined.reason,'delegation_revoked');
});

test('review regressions: the allowance reservation and user-body erasure',async t=>{
 const c=classifier(),deleted=[],storage={async put(){},async delete(key){deleted.push(key);}},w=await fresh(t,{classifier:c,userStorage:storage}),link=await w.admit('bob',{policy:'request'});
 // BB2-R8: concurrent drains reserve calls inside a transaction and never overspend.
 await w.run('bob','intake.settings',{classifierConsent:true,pin:MODEL,allowance:1});for(let i=0;i<3;i++)await say(w,'alice',link,i+1,'p=0.10');
 await Promise.all([w.system('bob','intake.drain',{}),w.system('bob','intake.drain',{}),w.system('bob','intake.drain',{})]);assert.equal(c.inputs.length,1);
 // BB2-R7: erasing a rejected item with a user-storage body queues the object; the sweep deletes it.
 const store=w.peer('bob').store,id='u'.repeat(43);await store.transaction(async tx=>{await tx.put(`item/${id}`,{id,origin:'native',author:{jkt:'j1',principal:P.alice.principal},state:'rejected',rejectedAt:1,bodyRef:{storage:'user',key:'parlay/v1/items/u/1'},tags:[],tagHistory:[]});await tx.put(`rejected/${'1'.padStart(16,'0')}/${id}`,{id});await tx.put(`by-jkt/j1/${id}`,1);});
 assert.deepEqual(await w.system('bob','intake.sweep',{}),{deleted:1,pending:0});assert.deepEqual(deleted,['parlay/v1/items/u/1']);assert.equal(await store.get(`by-jkt/j1/${id}`),undefined);
});

// Item-classification §8.4: consent with no usable classifier never lets a request through as if it had been checked.
test('consent without a text classifier: requests are held quietly as unscored, never rejected, and the gap is recorded',async t=>{
 for(const values of [{},{image:'https://classifiers.example/r/image'}]){
  const c=classifier(MODEL,values),w=await fresh(t,{classifier:c}),link=await w.admit('bob',{policy:'request'});
  await w.run('bob','intake.settings',{classifierConsent:true,pin:MODEL});await say(w,'alice',link,1,'Win money p=0.99');
  const out=await w.system('bob','intake.drain',{});assert.deepEqual(out,{processed:1,rejected:0,suspected:0,classified:0,unscored:1});assert.equal(c.inputs.length,0);
  const [item]=await w.items('bob');assert.deepEqual([item.state,item.notification,item.priority,item.scoring.state,item.scoring.reason],['request','quiet','normal','unscored','no_classifier']);
  assert.ok(item.tagHistory.some(h=>h.action==='unscored'&&h.reason==='no_classifier'));
  assert.deepEqual((await w.store('bob').get('bb:classify:gaps')).map(g=>[g.kind,g.reason]),[['text','no_classifier']]);
 }
});
