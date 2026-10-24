// ORG-12d operator case screens at the UI-state level: the real console Actions and views over a fake admin API that
// models the HTTP contract (two operators, barred pairs, exclusions, the daily limit). It shows client behaviour only;
// the server's rules are tested at the engine level (tests/orgs-break-glass-support*.test.mjs).
import test from 'node:test';import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
const window=new Window({url:'https://host.example/console?admin'}),previous={};for(const name of ['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData']){previous[name]=globalThis[name];globalThis[name]=window[name];}
const {Engine,Provider,dodo}=await import('../../apps/web/src/shared/stack.mjs');
const {default:State,initialAdminState}=await import('../../apps/web/src/providers/admin-state.mjs');
const bl=await import('../../apps/web/src/bl/admin-org-cases.mjs');
const {consoleView,constructors}=await import('../../apps/web/src/admin-console.mjs');
const {createLocalization}=await import('../../packages/i18n/index.mjs');
const {default:localize}=await import('../../apps/web/src/ui/localize.mjs');
test.after(async()=>{await window.happyDOM.close();Object.assign(globalThis,previous);});

const ORG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',LAPSE='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',CONTEST='cccccccc-cccc-4ccc-8ccc-cccccccccccc',CLAIM='dddddddd-dddd-4ddd-8ddd-dddddddddddd',NOW=Date.UTC(2026,9,24,12);
const ADDRESS=/@[a-z0-9-]+\.[a-z]|mail\.|https?:\/\//i;
const coded=(code,status=409)=>Object.assign(Error(code),{code,status});
/** A fake of the four org-case routes. `me` is the signed-in operator; switching it models a second operator's tab. */
function fakeServer(){
 const s={me:'op1',left:{op1:20,op2:20,op3:20},decides:[],challenges:[],seizing:true,barred:new Set(),inactive:new Set(),cases:new Map()};
 const channels=()=>[{id:'ch-email',kind:'email',enrolledAt:NOW-200*86400000,ageDays:200,excluded:false,disputed:false,undeliverable:false,excludable:false},{id:'ch-push',kind:'push',enrolledAt:NOW-150*86400000,ageDays:150,excluded:false,disputed:false,undeliverable:true,excludable:true},{id:'ch-session',kind:'session',enrolledAt:NOW-100*86400000,ageDays:100,excluded:false,disputed:true,undeliverable:false,excludable:true}];
 s.cases.set(ORG,{org:ORG,handle:'acme',kind:'break-glass',process:CLAIM,state:'held',contest:null,track:'S',causes:['objection'],frozen:false,createdAt:NOW-40*86400000,paidAt:NOW-38*86400000,waitEndsAt:null,held:{enteredAt:NOW-5*86400000,ackAt:null},heldTotal:5*86400000,finalEndsAt:null,channels:channels(),disputes:[{channel:'ch-session',at:NOW-86400000,excluded:false}],objections:1,proposal:null,decision:null,ownerStatus:'active',category:'owner-unreachable',statementDigest:'f'.repeat(64),billingHeld:false,timeline:[{event:'start',t:'T1',from:null,to:'gathering',at:NOW-40*86400000},{event:'object',t:'T8',from:'waiting',to:'held',at:NOW-5*86400000}],_proposer:null});
 s.cases.set(LAPSE,{org:LAPSE,handle:'beta',kind:'lapse-claim',process:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',state:'escalated',escalatedAt:NOW-2*86400000,proposal:null,approved:false,_proposer:null});
 s.cases.set(CONTEST,{org:CONTEST,handle:'gamma',kind:'break-glass',process:'ffffffff-ffff-4fff-8fff-ffffffffffff',state:'effective',contest:{state:'open',until:NOW+30*86400000},track:'A',causes:[],frozen:false,createdAt:NOW-90*86400000,paidAt:NOW-88*86400000,waitEndsAt:NOW-58*86400000,held:null,heldTotal:0,finalEndsAt:null,channels:channels().slice(0,1),disputes:[],objections:0,proposal:null,decision:null,ownerStatus:'active',category:'owner-deceased',statementDigest:'a'.repeat(64),billingHeld:false,timeline:[],_proposer:null});
 const allowed=c=>c.kind==='lapse-claim'?(c.state==='escalated'?['close','proceed']:[]):c.contest?.state==='open'?['uphold','reject']:c.state==='held'?['acknowledge','note','abort','proceed']:[];
 const view=c=>{const {_proposer,...rest}=c;return {...structuredClone(rest),proposal:c.proposal?{...c.proposal,mine:_proposer===s.me,proposerActive:_proposer===s.me||!s.inactive.has(_proposer)}:null,barred:s.barred.has(s.me),allowed:allowed(c).filter(d=>s.seizing||!['proceed','reject'].includes(d)),seizingEnabled:s.seizing,decisionsLeft:s.left[s.me]};};
 const routes={
  list:()=>({cases:[...s.cases.values()].filter(c=>allowed(c).length).map(c=>({org:c.org,handle:c.handle,kind:c.kind,process:c.process,state:c.kind==='lapse-claim'?'escalated':c.contest?'contest':'held',since:NOW-86400000,updatedAt:NOW})),next:null}),
  challenge:body=>{s.challenges.push(structuredClone(body));return {passkey:true,authenticationOptions:{challenge:'bound-'+body.decision}};},
  get:({org})=>{const c=s.cases.get(org);if(!c)throw coded('not_found',404);return {case:view(c)};},
  decide:body=>{s.decides.push({...body,by:s.me});const c=s.cases.get(body.org);if(!c)throw coded('not_found',404);if(!body.passkeyResponse)throw coded('step_up_required',403);
   if(s.left[s.me]<=0)throw coded('decision_limit',429);s.left[s.me]--;
   if(!allowed(c).includes(body.decision))throw coded('not_found',404);
   if(['proceed','uphold','reject'].includes(body.decision)){
    if(s.barred.has(s.me))throw coded('operator_pair_barred');
    if(body.decision==='proceed'&&c.kind==='break-glass'&&(body.exclude??[]).length>=c.channels.length)throw coded('last_channel');
    const p=c.proposal;if(!p||p.decision!==body.decision||JSON.stringify(p.exclude??[])!==JSON.stringify(body.exclude??[])){c.proposal={decision:body.decision,at:NOW,expiresAt:NOW+3*86400000,exclude:body.exclude??[]};c._proposer=s.me;return {outcome:'proposed',decisionsLeft:s.left[s.me]};}
    if(c._proposer===s.me)throw coded('second_operator_required');
    c.proposal=null;c._proposer=null;if(c.kind==='lapse-claim')c.approved=true,c.state='pending';else if(body.decision==='proceed')c.state='final';else c.contest={...c.contest,state:body.decision==='uphold'?'upheld':'rejected'};
    return {outcome:'approved',state:c.state,decisionsLeft:s.left[s.me]};
   }
   if(body.decision==='abort'||body.decision==='close')c.state=body.decision==='abort'?'aborted':'closed';
   if(body.decision==='acknowledge')c.held={...c.held,ackAt:NOW};
   return {outcome:'recorded',decisionsLeft:s.left[s.me]};},
  audit:({before})=>({entries:s.decides.slice().reverse().map((d,i)=>({seq:100-i,at:NOW,action:'org-case.decide',phase:'applied',actor:{handle:d.by},target:d.org,after:{decision:d.decision,kind:d.kind,outcome:'recorded'},...d.reason?{reason:d.reason}:{}})).filter(e=>!before||e.seq<before),next:null})
 };
 return {s,call:async(op,body)=>routes[op](body??{})};
}
async function tab(server,{mode='admin',view='org-cases'}={}){
 const calls=[],api={generation:0,forget(){this.generation++;},call:async(actor,path,body)=>{calls.push({actor,path,body:structuredClone(body)});if(path==='/api/admin/step-up/begin')return {passkey:true,authenticationOptions:{challenge:'c'}};if(path==='/api/admin/overview')return {catalog:{version:1,roles:{},capabilities:{},badgeClasses:{}},reservations:{runtime:[],static:[]},claims:[],audit:{seq:1}};if(path.startsWith('/api/admin/org-cases/'))return server.call(path.split('/').at(-1),body);throw coded('not_found',404);}};
 const browser={now:()=>NOW,focus(){},clearSecrets(){},rememberFocus(){},restoreFocus(){},authenticatePasskey:async()=>({id:'verified-test-passkey'})};
 const engine=new Engine({providers:{api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),state:class extends State{constructor(){super(initialAdminState({phase:'console',mode,consoleReady:true,view:'overview',locale:'en',now:NOW,account:{id:'op',handle:'op1'},overview:{catalog:{version:1,roles:{},capabilities:{},badgeClasses:{}},reservations:{runtime:[],static:[]},claims:[],audit:{seq:1}}}));}}}});
 const snapshot=await engine.container.use(['state'],({state})=>state.snapshot);
 const act=action=>engine.dispatch(action).next('complete');
 const t={engine,api,calls,state:snapshot,read:()=>bl.caseState(snapshot()),act,close:()=>engine.dispose(),
  render:(locale='en')=>{const missing=new Set(),root=document.createElement('div');dodo.reconcile(root,[localize(consoleView({...snapshot(),locale}),createLocalization({locale,onMissing:(_,key)=>missing.add(key)}))]);return {root,missing,text:root.textContent};},
  decides:()=>calls.filter(c=>c.path==='/api/admin/org-cases/decide').map(c=>c.body)};
 if(view==='org-cases')await act(new constructors.navigate({view:'org-cases'}));
 return t;
}
const reason={category:'evidence-reviewed',reason:'Support reviewed the evidence out of band.'};

test('queue loads through the composed navigation, renders handles and states, and never an address',async()=>{const server=fakeServer(),t=await tab(server);try{
 assert.equal(t.state().view,'org-cases');assert.equal(t.read().list.cases.length,3);
 const {text,missing}=t.render();assert.ok(text.includes('@acme'));assert.ok(text.includes('Held for support'));assert.ok(text.includes('Lapse claim'));assert.ok(text.includes('Contest'));assert.equal(missing.size,0,[...missing].join('\n'));
 assert.ok(text.includes('Organization cases'));
 const {root}=t.render();const nav=[...root.querySelectorAll('.admin-nav-item')].filter(n=>n.getAttribute('aria-current')==='page');assert.deepEqual(nav.map(n=>n.textContent.trim()),['Organization cases'],'only the org-case item is current');
 // Empty state.
 server.s.cases.clear();await t.act(new bl.LoadOrgCases({}));assert.ok(t.render().text.includes('No claims are waiting for support.'));
}finally{await t.close();}});

test('case detail shows evidence (kinds and ages), timeline and timers, with no address strings in en or es',async()=>{const server=fakeServer(),t=await tab(server);try{
 await t.act(new bl.OpenOrgCase({org:ORG}));assert.equal(t.read().screen,'case');assert.equal(t.read().detail.org,ORG);
 for(const locale of ['en','es']){const {text,missing}=t.render(locale);assert.equal(missing.size,0,locale+': '+[...missing].join('\n'));assert.equal(ADDRESS.test(text.replace('@acme','')),false,locale+': no address');
  assert.ok(text.includes(locale==='en'?'Known session':'Sesión conocida'));assert.ok(text.includes(locale==='en'?'Undeliverable':'Inaccesible'));assert.ok(text.includes(locale==='en'?'Disputed':'Disputado'));assert.ok(text.includes('objection'),'Track S causes are shown to operators');}
 const {text}=t.render();assert.ok(text.includes('200 days before now'));assert.ok(text.includes('20 of 20 decisions left today'));assert.ok(text.includes('ffffffffffffffff…'),'only a short digest');
}finally{await t.close();}});

test('the exclusion picker lists only excludable channels and refuses excluding every channel',async()=>{const server=fakeServer(),t=await tab(server);try{
 await t.act(new bl.OpenOrgCase({org:ORG}));await t.act(new bl.OpenDecisionForm({decision:'proceed'}));
 const {root}=t.render();const boxes=[...root.querySelectorAll('input[name=exclude]')].map(b=>b.value).sort();assert.deepEqual(boxes,['ch-push','ch-session'],'the email channel is neither disputed nor undeliverable');
 await t.act(new bl.DecideOrgCase({values:{...reason,exclude:['ch-email']}}));assert.equal(t.read().error.code,'invalid_exclusion');
 // Every channel excludable: the console refuses before any passkey prompt or request.
 server.s.cases.get(ORG).channels.forEach(ch=>{ch.excludable=true;});await t.act(new bl.OpenOrgCase({org:ORG}));await t.act(new bl.OpenDecisionForm({decision:'proceed'}));
 await t.act(new bl.DecideOrgCase({values:{...reason,exclude:['ch-email','ch-push','ch-session']}}));assert.equal(t.read().error.code,'last_channel');assert.equal(t.decides().length,0);
 assert.equal(t.calls.filter(c=>c.path==='/api/admin/org-cases/challenge').length,0,'refused before the passkey');
}finally{await t.close();}});

test('propose shows "waiting" to the proposer; the second operator approves with exactly the proposed exclusions',async()=>{const server=fakeServer(),t=await tab(server);try{
 await t.act(new bl.OpenOrgCase({org:ORG}));await t.act(new bl.OpenDecisionForm({decision:'proceed'}));
 await t.act(new bl.DecideOrgCase({values:{...reason,reason:'short'}}));assert.equal(t.read().error.code,'reason_required');
 await t.act(new bl.DecideOrgCase({values:{reason:reason.reason,exclude:['ch-push']}}));assert.equal(t.read().error.code,'category_required');
 await t.act(new bl.DecideOrgCase({values:{...reason,exclude:['ch-push']}}));
 assert.equal(t.read().notice.outcome,'proposed');assert.equal(t.read().detail.proposal.mine,true);assert.deepEqual(t.decides()[0].exclude,['ch-push']);assert.deepEqual(t.decides()[0].passkeyResponse,{id:'verified-test-passkey'});
 assert.equal(t.read().decisionsLeft,19);let {text,root}=t.render();assert.ok(text.includes('Waiting for a second operator'));assert.equal([...root.querySelectorAll('button')].some(b=>b.textContent==='Approve proposal'),false,'no approval of one’s own proposal');
 assert.equal(bl.proposable(t.read().detail).includes('proceed'),false);
 // A second operator's tab.
 server.s.me='op2';const t2=await tab(server);try{await t2.act(new bl.OpenOrgCase({org:ORG}));({root}=t2.render());assert.ok([...root.querySelectorAll('button')].some(b=>b.textContent==='Approve proposal'));
  await t2.act(new bl.OpenDecisionForm({approve:true}));assert.equal(t2.read().pending.decision,'proceed');({root}=t2.render());assert.equal(root.querySelectorAll('input[name=exclude]').length,0,'the approver cannot change the exclusions');
  await t2.act(new bl.DecideOrgCase({values:{...reason,exclude:['ch-session','ch-push']}}));
  const sent=t2.decides().at(-1);assert.deepEqual(sent.exclude,['ch-push'],'exactly the proposal’s exclusions');assert.equal(sent.decision,'proceed');assert.equal(t2.read().notice.outcome,'approved');assert.equal(t2.read().detail.state,'final');
 }finally{await t2.close();}
 // The proposer trying to approve their own proposal through a forged intent is refused locally.
 server.s.me='op1';const t3=await tab(server);try{server.s.cases.get(ORG).state='held';server.s.cases.get(ORG).proposal={decision:'proceed',at:NOW,expiresAt:NOW+1,exclude:[]};server.s.cases.get(ORG)._proposer='op1';await t3.act(new bl.OpenOrgCase({org:ORG}));
  await t3.act(new bl.OpenDecisionForm({approve:true}));assert.equal(t3.read().pending,null);}finally{await t3.close();}
}finally{await t.close();}});

test('barred operators see no proceed; contest and lapse decisions; seizing off leaves safe actions only',async()=>{const server=fakeServer(),t=await tab(server);try{
 server.s.barred.add('op1');await t.act(new bl.OpenOrgCase({org:ORG}));let {text,root}=t.render();
 assert.ok(text.includes('A different pair of operators must decide'));const labels=()=>[...t.render().root.querySelectorAll('button')].map(b=>b.textContent);
 assert.equal(labels().includes('Propose to proceed'),false);assert.ok(labels().includes('Abort claim'));assert.ok(labels().includes('Acknowledge'));
 server.s.barred.clear();
 await t.act(new bl.OpenOrgCase({org:CONTEST}));assert.ok(labels().includes('Propose to uphold the contest'));assert.ok(labels().includes('Propose to reject the contest'));assert.equal(labels().includes('Abort claim'),false);
 await t.act(new bl.OpenDecisionForm({decision:'uphold'}));await t.act(new bl.DecideOrgCase({values:reason}));assert.equal(t.read().notice.outcome,'proposed');
 await t.act(new bl.OpenOrgCase({org:LAPSE}));assert.ok(labels().includes('Close and refund'));assert.ok(labels().includes('Propose to proceed'));
 await t.act(new bl.OpenDecisionForm({decision:'close'}));await t.act(new bl.DecideOrgCase({values:reason}));assert.equal(t.decides().at(-1).decision,'close');assert.equal(t.decides().at(-1).kind,'lapse-claim');assert.equal(t.decides().at(-1).exclude,undefined);
 server.s.seizing=false;server.s.cases.get(ORG).state='held';await t.act(new bl.OpenOrgCase({org:ORG}));({text}=t.render());assert.ok(text.includes('Proceeding and rejecting contests are turned off for this organization'));assert.equal(labels().includes('Propose to proceed'),false);assert.ok(labels().includes('Abort claim'));
 await t.act(new bl.OpenDecisionForm({decision:'proceed'}));assert.equal(t.read().pending,null,'a hidden decision cannot be opened');
}finally{await t.close();}});

test('error codes map to readable messages; the daily limit and acknowledgement; audit lists operator actions',async()=>{const server=fakeServer(),t=await tab(server);try{
 await t.act(new bl.OpenOrgCase({org:ORG}));await t.act(new bl.OpenDecisionForm({decision:'acknowledge'}));await t.act(new bl.DecideOrgCase({values:{}}));assert.equal(t.read().notice.outcome,'recorded');assert.ok(t.read().detail.held.ackAt);
 for(const [code,text] of [['operator_conflict','member of this organization'],['operator_pair_barred','different pair'],['second_operator_required','different operator'],['decision_limit','20 decisions'],['owner_proof_recent','elevated proof'],['operator_capability_required','support capability'],['last_channel','last channel']]){
  const call=t.api.call;t.api.call=async(actor,path,body)=>{if(path.endsWith('/decide'))throw coded(code);return call(actor,path,body);};
  await t.act(new bl.OpenDecisionForm({decision:'note'}));await t.act(new bl.DecideOrgCase({values:{reason:reason.reason}}));t.api.call=call;
  assert.equal(t.read().error.code,code);for(const locale of ['en','es']){const r=t.render(locale);assert.equal(r.missing.size,0,[...r.missing].join('\n'));if(locale==='en')assert.ok(r.text.includes(text),code);}
 }
 server.s.left.op1=0;await t.act(new bl.OpenOrgCase({org:ORG}));assert.ok(t.render().text.includes('0 of 20 decisions left today'));await t.act(new bl.OpenDecisionForm({decision:'note'}));const before=t.decides().length;await t.act(new bl.DecideOrgCase({values:{reason:reason.reason}}));assert.equal(t.read().error.code,'decision_limit');assert.equal(t.decides().length,before,'no request past the limit');
 await t.act(new bl.LoadOrgCaseAudit({}));assert.equal(t.read().screen,'audit');assert.ok(t.read().audit.entries.length>0);for(const locale of ['en','es']){const r=t.render(locale);assert.equal(r.missing.size,0,[...r.missing].join('\n'));assert.ok(r.text.includes('org-case.decide'));assert.ok(r.text.includes('@op1'));}
}finally{await t.close();}});

test('boot mode has no org-case navigation and cannot navigate there; the passkey is asked for every decision',async()=>{const server=fakeServer(),t=await tab(server,{mode:'boot',view:'overview'});try{
 await t.act(new constructors.navigate({view:'org-cases'}));assert.notEqual(t.state().view,'org-cases');assert.equal(t.render().text.includes('Organization cases'),false);
}finally{await t.close();}
 const a=await tab(server);try{await a.act(new bl.OpenOrgCase({org:ORG}));for(const d of ['acknowledge','note']){await a.act(new bl.OpenDecisionForm({decision:d}));await a.act(new bl.DecideOrgCase({values:{reason:reason.reason}}));}
  assert.equal(a.calls.filter(c=>c.path==='/api/admin/org-cases/challenge').length,2);assert.ok(a.decides().every(d=>d.passkeyResponse));
  // A cancelled passkey sends nothing.
  const before=a.decides().length;const browser=await a.engine.container.use(['browser'],({browser})=>browser);browser.authenticatePasskey=async()=>{throw coded('passkey_cancelled');};
  await a.act(new bl.OpenDecisionForm({decision:'note'}));await a.act(new bl.DecideOrgCase({values:{reason:reason.reason}}));assert.equal(a.read().error.code,'passkey_cancelled');assert.equal(a.decides().length,before);
 }finally{await a.close();}
});

test('Spanish renders every screen with no missing catalogue entries',async()=>{const server=fakeServer(),t=await tab(server);try{
 const check=()=>{const r=t.render('es');assert.equal(r.missing.size,0,[...r.missing].join('\n'));return r.text;};
 assert.ok(check().includes('Casos de organizaciones'));
 await t.act(new bl.OpenOrgCase({org:ORG}));for(const d of ['acknowledge','note','abort','proceed']){await t.act(new bl.OpenDecisionForm({decision:d}));check();}
 await t.act(new bl.OpenOrgCase({org:CONTEST}));check();await t.act(new bl.OpenOrgCase({org:LAPSE}));await t.act(new bl.OpenDecisionForm({decision:'close'}));check();
 await t.act(new bl.DecideOrgCase({values:reason}));check();
}finally{await t.close();}});


test('review follow-ups: uphold survives the kill switch, an inactive proposer cannot be approved, lapse reasons cap at 280, the challenge names the decision, the audit shows reasons',async()=>{const server=fakeServer(),t=await tab(server);try{
 const labels=()=>[...t.render().root.querySelectorAll('button')].map(b=>b.textContent.trim());
 server.s.seizing=false;await t.act(new bl.OpenOrgCase({org:CONTEST}));assert.ok(labels().includes('Propose to uphold the contest'),'M2: uphold is never gated');assert.equal(labels().includes('Propose to reject the contest'),false);
 server.s.seizing=true;server.s.me='op2';await t.act(new bl.OpenOrgCase({org:ORG}));await t.act(new bl.OpenDecisionForm({decision:'proceed'}));await t.act(new bl.DecideOrgCase({values:{...reason,exclude:['ch-push']}}));
 assert.deepEqual(server.s.challenges.at(-1),{org:ORG,kind:'break-glass',process:CLAIM,decision:'proceed',exclude:['ch-push']},'L7: the passkey challenge is begun for exactly this decision');
 server.s.inactive.add('op2');server.s.me='op3';await t.act(new bl.OpenOrgCase({org:ORG}));const {text}=t.render();
 assert.ok(text.includes('no longer holds the support capability'),'M1: the inactive proposer is shown');assert.equal(labels().includes('Approve proposal'),false);assert.equal(bl.approvable(t.read().detail),null);
 await t.act(new bl.OpenOrgCase({org:LAPSE}));await t.act(new bl.OpenDecisionForm({decision:'close'}));const before=t.calls.length;
 await t.act(new bl.DecideOrgCase({values:{category:'evidence-reviewed',reason:'x'.repeat(281)}}));assert.equal(t.read().error.code,'invalid_reason');assert.equal(t.calls.length,before,'L1: refused before any request');
 await t.act(new bl.DecideOrgCase({values:{category:'evidence-reviewed',reason:'Owner reached by phone; claim not justified.'}}));
 await t.act(new bl.LoadOrgCaseAudit({}));assert.ok(t.render().text.includes('Owner reached by phone; claim not justified.'),'L2: operators read the reason in the audit');
 const es=t.render('es');assert.equal(es.missing.size,0,[...es.missing].join(' | '));
}finally{await t.close();}});
