// Signaling owner pages (apps/web/src/bl/signaling-pages.mjs; signaling.md rev 3.2 §20.1.4, §5.8, §14.1, §4.3) driven
// through the real ngin engine and browser-state provider against a recording API double: every page action takes the
// server's review, commits exactly the reviewed input with the review id only once the surface is armed, and narrows
// without a review. The server rules are tests/signaling-owner-pages*.test.mjs; the rendered pages are
// tests/browser/signaling-pages.mjs and, in real browsers with the real arming resource, signaling-pages-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {within} from '../helpers/async.mjs';
import {Window} from 'happy-dom';
const window=new Window({url:'https://space.example/console'}),names=['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'];
const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));for(const name of names)globalThis[name]=window[name];
const {Engine,Provider}=await import('../../apps/web/src/shared/stack.mjs');
const {default:StateProvider}=await import('../../apps/web/src/providers/browser-state.mjs');
const sp=await import('../../apps/web/src/bl/signaling-pages.mjs');
const {ConfirmOwner}=await import('../../apps/web/src/bl/step-up.mjs');
const F=await import('../helpers/signaling-pages-fixture.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const features={signalingEnabled:true};
async function fixture({get,request,submissions={},enabled=true}={}){
 const calls=[],routes=[],effects=[];
 const api={async get(path){calls.push({method:'GET',path});if(get){const v=await get(path);if(v!==undefined)return v;}return path==='/api/signaling/settings'?structuredClone(F.SETTINGS_WITH_PEERS):path.startsWith('/api/signaling/pairing?')?structuredClone(F.DETAIL):path.endsWith('/signaling')?structuredClone(F.SERVICE):{};},
  async request(path,body,method='POST'){calls.push({method,path,body:structuredClone(body)});if(request){const v=await request(path,body);if(v!==undefined)return v;}
   if(path==='/api/signaling/review')return structuredClone({'session-approve':F.APPROVE_REVIEW,'session-auto-connect':{...F.SYNC_REVIEW,action:'session-auto-connect'},'pairing-create':F.PAIR_REVIEW,'pairing-activate':F.ACTIVATE_REVIEW,'pairing-update':F.RENEW_REVIEW}[body.action]);
   if(path.endsWith('/signaling')&&body.operation==='review')return structuredClone(F.SERVICE_REVIEW);
   if(path==='/api/signaling/pairing-create')return {...structuredClone(F.DETAIL.pairing),id:'pr_'+'n'.repeat(22),state:'live'};
   return {};}};
 const browser={consumeSubmission:id=>submissions[id],focus:selector=>effects.push(['focus',selector]),restoreFocus:()=>effects.push(['restoreFocus']),captureFocus(){},setCaptchaAction(){},installCaptcha(){},authenticatePasskey:async()=>({id:'test-passkey'})};
 const engine=new Engine({providers:{state:StateProvider,api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),portalContributions:Provider.fromSingleton({}),recoveryFile:Provider.fromSingleton({})}});
 engine.feed.addEventListener(sp.ROUTE_EVENT,event=>routes.push(event.detail));
 const write=patch=>engine.container.use({state:{write:true}},({state})=>state.transition(next=>Object.assign(next,patch))),read=()=>engine.container.use(['state'],({state})=>state.snapshot());
 await write({loading:false,locale:'en',view:'signaling',route:{kind:'home'},config:{},session:{account:{id:F.OWNER,consoleFeatures:enabled?features:{}},sessionContext:'ctx'},beamGeneration:1,data:{features:enabled?features:{},collections:[]}});
 const act=action=>within(engine.dispatch(action).next('complete'),action.constructor.name);
 const page=async()=>sp.pageModel(await read());
 const arm=async()=>{const p=await page();await act(new sp.SignalingArm({armed:true,surface:p.review.review}));};
 return {engine,calls,routes,effects,write,read,act,page,arm,posts:()=>calls.filter(c=>c.method==='POST'),close:()=>engine.dispose()};
}

test('routes: the address decides the page; anything malformed is the overview; page URLs are on the console',()=>{
 assert.deepEqual(sp.pageRoute('?view=signaling&page=approve&client=https%3A%2F%2Fapp.example%2Fclient&kind=https%3A%2F%2Fk.example%2Fv1'),{page:'approve',params:{client:'https://app.example/client',kind:'https://k.example/v1'}});
 assert.deepEqual(sp.pageRoute('?view=signaling&page=pairing&id=pr_'+'a'.repeat(22)),{page:'pairing',params:{id:'pr_'+'a'.repeat(22)}});
 assert.deepEqual(sp.pageRoute('?view=signaling&page=pairing&id=../x'),{page:'pairing',params:{}});
 assert.deepEqual(sp.pageRoute('?page=nope&organization=not-a-uuid'),{page:'overview',params:{}});
 assert.deepEqual(sp.pageRoute('?page=approve&page=pair'),{page:'overview',params:{}},'a repeated member is no choice');
 assert.equal(sp.pageURL('service',{organization:F.ORG}),'/console?view=signaling&page=service&organization='+F.ORG);
});

test('approval page: opening takes the review; the decision waits for the armed surface and sends exactly the reviewed input',async()=>{
 const off=await fixture({enabled:false});
 try{await off.act(new sp.OpenSignalingPage({page:'approve',params:{client:F.APP,kind:F.CHAT}}));assert.deepEqual(off.calls,[]);assert.equal((await off.read()).error,sp.SIGNALING_PAGE_UNAVAILABLE);}finally{await off.close();}
 const f=await fixture();
 try{
  await f.act(new sp.OpenSignalingPage({page:'approve',params:{client:F.APP,kind:F.CHAT}}));
  assert.deepEqual(f.calls,[{method:'GET',path:'/api/signaling/settings'},{method:'POST',path:'/api/signaling/review',body:{action:'session-approve',input:{clientId:F.APP,kind:F.CHAT}}}]);
  let p=await f.page();assert.equal(p.status,'ready');assert.equal(p.review.review,F.APPROVE_REVIEW.review);assert.equal(p.armed,false);
  assert.equal(sp.decisionSurface(await f.read()),F.APPROVE_REVIEW.review);
  // Not armed: refused without a request (an early click is explained).
  f.calls.length=0;await f.act(new sp.DecideSignalingChange({}));assert.equal((await f.read()).error,sp.SIGNALING_NOT_ARMED);assert.deepEqual(f.posts(),[]);
  // A stale surface's arming is ignored.
  await f.act(new sp.SignalingArm({armed:true,surface:'rv_'+'z'.repeat(22)}));assert.equal((await f.page()).armed,false);
  await f.arm();
  // Auto-connect is honoured only where the review allows it (CHAT is not a self kind).
  await f.act(new sp.DecideSignalingChange({autoConnect:true}));
  assert.deepEqual(f.posts(),[{method:'POST',path:'/api/intents/session-approve',body:{...F.APPROVE_REVIEW.input,review:F.APPROVE_REVIEW.review}}]);
  const s=await f.read();p=sp.pageModel(s);assert.equal(s.notice,'Connection type approved.');assert.equal(p.review,null);assert.equal(p.done.action,'session-approve');assert.equal(sp.decisionSurface(s),'');
 }finally{await f.close();}
 // A self kind with the separate, unchecked control turned on by the owner.
 const g=await fixture({request:(path,body)=>path==='/api/signaling/review'?structuredClone(F.SYNC_REVIEW):undefined});
 try{await g.act(new sp.OpenSignalingPage({page:'approve',params:{client:F.APP,kind:F.SYNC}}));await g.arm();g.calls.length=0;await g.act(new sp.DecideSignalingChange({autoConnect:true}));
  assert.deepEqual(g.posts()[0].body,{...F.SYNC_REVIEW.input,autoConnect:true,review:F.SYNC_REVIEW.review});}finally{await g.close();}
});

test('the server refusing the decision: an early click keeps the review, an expired one asks to review again, an account switch discards late answers',async()=>{
 let answer=null;const f=await fixture({request:path=>{if(path==='/api/intents/session-approve'&&answer)throw answer;}});
 try{
  await f.act(new sp.OpenSignalingPage({page:'approve',params:{client:F.APP,kind:F.CHAT}}));await f.arm();
  answer=Object.assign(Error('x'),{status:409,code:'decision_not_armed'});await f.act(new sp.DecideSignalingChange({}));
  assert.equal((await f.read()).error,sp.SIGNALING_NOT_ARMED);assert.ok((await f.page()).review,'the review stays');
  answer=Object.assign(Error('x'),{status:409,code:'review_required'});await f.act(new sp.DecideSignalingChange({}));
  assert.equal((await f.read()).error,sp.SIGNALING_REVIEW_EXPIRED);assert.equal((await f.page()).review,null,'review again');
 }finally{await f.close();}
 let finish;const g=await fixture({request:path=>path==='/api/signaling/review'?new Promise(resolve=>finish=resolve):undefined});
 try{
  const pending=g.act(new sp.OpenSignalingPage({page:'approve',params:{client:F.APP,kind:F.CHAT}}));while(!finish)await new Promise(r=>setTimeout(r,0));
  await g.write({session:{account:{id:'550e8400-e29b-41d4-a716-446655440009',consoleFeatures:features},sessionContext:'ctx2'},beamGeneration:2});finish(structuredClone(F.APPROVE_REVIEW));await pending;
  assert.equal(sp.pageModel(await g.read()),null,'another account never sees this review');
 }finally{await g.close();}
});

test('pairing creation page: nothing preselected (every choice required), the review, an existing cross-entity pairing linked, and fresh authentication through the console step-up',async()=>{
 const submissions={empty:{kind:F.CHAT,local:F.APP,label:'Bob'},cross:{kind:F.CHAT,local:F.APP,with:'principal',peerHandle:' river ',opens:'local',label:' Bob ',days:'180'},own:{kind:F.SYNC,local:F.APP,with:'self',peerApp:F.APP2,opens:'both',label:'Desk'}};
 assert.throws(()=>sp.pairingInput(submissions.empty),{message:sp.SIGNALING_INCOMPLETE});
 assert.throws(()=>sp.pairingInput({...submissions.own,peerApp:''}),{message:sp.SIGNALING_INCOMPLETE});
 assert.deepEqual(sp.pairingInput(submissions.own),{kind:F.SYNC,local:{client_id:F.APP,client_session:null},peer:{self:{client_id:F.APP2,client_session:null}},opens:'both',label:'Desk'},'no expiry is sent for an own-entity pairing');
 let stepped=false;
 const f=await fixture({submissions,request:path=>{
  if(path==='/api/signaling/review'&&!stepped)throw Object.assign(Error('Confirm it is you to pair with another account.'),{status:403,code:'reauthentication_required'});
  if(path==='/api/auth/step-up/begin')return {passkey:true,authenticationOptions:{challenge:'c'}};if(path==='/api/auth/step-up'){stepped=true;return {};}}});
 try{
  await f.act(new sp.OpenSignalingPage({page:'pair',params:{}}));
  await f.act(new sp.ReviewSignalingChange({action:'pairing-create',operationId:'empty'}));assert.equal((await f.read()).error,sp.SIGNALING_INCOMPLETE);
  f.calls.length=0;const reviewing=f.engine.dispatch(new sp.ReviewSignalingChange({action:'pairing-create',operationId:'cross'})).next('complete');
  let s;for(let i=0;i<50&&!(s=await f.read()).stepUp;i++)await new Promise(r=>setTimeout(r,0));
  assert.ok(s.stepUp?.passkey,'the console asks the owner to confirm it is them');
  await f.act(new ConfirmOwner({id:s.stepUp.id,method:'passkey'}));await within(reviewing,'review after step-up');
  const reviews=f.posts().filter(c=>c.path==='/api/signaling/review');assert.equal(reviews.length,2,'the same review is sent again once');
  const input=reviews[1].body.input;assert.deepEqual({...input,expiresAt:0},{kind:F.CHAT,local:{client_id:F.APP,client_session:null},peer:{handle:'river'},opens:'local',label:'Bob',expiresAt:0});
  assert.ok(Math.abs(input.expiresAt-(Date.now()+180*86400000))<60000);
  assert.equal((await f.page()).review.review,F.PAIR_REVIEW.review);
  await f.arm();f.calls.length=0;await f.act(new sp.DecideSignalingChange({activate:true}));
  assert.deepEqual(f.posts()[0],{method:'POST',path:'/api/signaling/pairing-create',body:{...F.PAIR_REVIEW.input,activate:true,review:F.PAIR_REVIEW.review}},'"Create and activate" on a review that offered activation');
  assert.deepEqual(f.routes,[{page:'pairing',params:{id:'pr_'+'n'.repeat(22)}}],'the new pairing\'s page opens');
  assert.equal((await f.read()).notice,'Pairing created and active.');
 }finally{await f.close();}
 const g=await fixture({submissions,request:path=>path==='/api/signaling/review'?{action:'pairing-create',review:null,refusal:{code:'pairing_exists',existing:F.PENDING_ID}}:undefined});
 try{await g.act(new sp.OpenSignalingPage({page:'pair',params:{}}));await g.act(new sp.ReviewSignalingChange({action:'pairing-create',operationId:'own'}));
  const p=await g.page();assert.equal(p.review,null);assert.deepEqual(p.refusal,{code:'pairing_exists',existing:F.PENDING_ID});assert.equal(sp.decisionSurface(await g.read()),'');}finally{await g.close();}
});

test('pairing creation decision: activation is sent only from the activation control of a review that offered it (§5.8 P3)',async()=>{
 const submissions={own:{kind:F.SYNC,local:F.APP,with:'self',peerApp:F.APP2,opens:'both',label:'Desk'}};
 for(const [review,detail,activate] of [[F.OWN_PAIR_REVIEW,{activate:true},false],[F.PAIR_REVIEW,{activate:false},false],[F.PAIR_REVIEW,{},false],[F.PAIR_REVIEW,{activate:true},true]]){
  const f=await fixture({submissions,request:path=>path==='/api/signaling/review'?structuredClone(review):undefined});
  try{
   await f.act(new sp.OpenSignalingPage({page:'pair',params:{}}));await f.act(new sp.ReviewSignalingChange({action:'pairing-create',operationId:'own'}));
   await f.arm();f.calls.length=0;await f.act(new sp.DecideSignalingChange(detail));
   const body=f.posts().find(c=>c.path==='/api/signaling/pairing-create').body;
   assert.equal('activate' in body,activate,`activateNow ${review.disclosure.activateNow}, control ${JSON.stringify(detail)}`);assert.deepEqual({...body,activate:undefined,review:undefined},{...review.input,activate:undefined,review:undefined});
  }finally{await f.close();}
 }
});

test('pairing page: activation, renewal and re-confirmation each take their review; relabel needs none; cancelling leaves the surface',async()=>{
 const f=await fixture({submissions:{renew:{days:'365'},bad:{days:'7'},label:{label:'Bob laptop'}}});
 try{
  await f.act(new sp.OpenSignalingPage({page:'pairing',params:{id:F.PENDING_ID}}));
  assert.deepEqual(f.calls.map(c=>c.path),['/api/signaling/settings','/api/signaling/pairing?id='+F.PENDING_ID]);
  await f.act(new sp.ReviewSignalingChange({action:'pairing-activate'}));assert.deepEqual(f.posts().at(-1).body,{action:'pairing-activate',input:{id:F.PENDING_ID,revision:1}});
  await f.act(new sp.CancelSignalingReview());assert.equal((await f.page()).review,null);
  await f.act(new sp.ReviewSignalingChange({action:'pairing-activate'}));await f.arm();f.calls.length=0;await f.act(new sp.DecideSignalingChange({}));
  assert.deepEqual(f.posts(),[{method:'POST',path:'/api/signaling/pairing-activate',body:{id:F.PENDING_ID,revision:1,review:F.ACTIVATE_REVIEW.review}}]);
  assert.deepEqual(f.calls.filter(c=>c.method==='GET').map(c=>c.path),['/api/signaling/settings','/api/signaling/pairing?id='+F.PENDING_ID],'the page reloads');
  await f.act(new sp.ReviewSignalingChange({action:'pairing-renew',operationId:'bad'}));assert.equal((await f.read()).error,sp.SIGNALING_INCOMPLETE);
  f.calls.length=0;await f.act(new sp.ReviewSignalingChange({action:'pairing-renew',operationId:'renew'}));
  const renew=f.posts()[0].body;assert.equal(renew.action,'pairing-update');assert.equal(renew.input.id,F.PENDING_ID);assert.ok(Math.abs(renew.input.expiresAt-(Date.now()+365*86400000))<60000);
  await f.act(new sp.CancelSignalingReview());f.calls.length=0;
  await f.act(new sp.ReviewSignalingChange({action:'pairing-reconfirm'}));assert.deepEqual(f.posts()[0].body,{action:'pairing-update',input:{id:F.PENDING_ID,revision:1,kind:F.CHAT}});
  await f.act(new sp.CancelSignalingReview());f.calls.length=0;
  await f.act(new sp.RelabelSignalingPairing({operationId:'label'}));assert.deepEqual(f.posts(),[{method:'POST',path:'/api/signaling/pairing-update',body:{id:F.PENDING_ID,revision:1,label:'Bob laptop'}}]);
  assert.equal((await f.read()).notice,'Pairing renamed.');
 }finally{await f.close();}
});

test('service designation page: through the organization route; setting takes its review, removal only from its dialog',async()=>{
 const f=await fixture({request:(path,body)=>path.endsWith('/signaling')&&body.operation==='set-service'&&body.input.designated===false?{designated:false,revision:2,revoked:3}:undefined});
 try{
  await f.act(new sp.OpenSignalingPage({page:'service',params:{organization:F.ORG}}));
  assert.ok(f.calls.some(c=>c.path==='/api/orgs/'+F.ORG+'/signaling'&&c.method==='GET'));
  await f.act(new sp.ReviewSignalingChange({action:'set-service'}));
  assert.deepEqual(f.posts().at(-1),{method:'POST',path:'/api/orgs/'+F.ORG+'/signaling',body:{operation:'review',input:{action:'set-service',input:{designated:true,revision:0}}}});
  await f.arm();f.calls.length=0;await f.act(new sp.DecideSignalingChange({}));
  assert.deepEqual(f.posts(),[{method:'POST',path:'/api/orgs/'+F.ORG+'/signaling',body:{operation:'set-service',input:{designated:true,revision:0},review:F.SERVICE_REVIEW.review}}]);
  f.calls.length=0;await f.act(new sp.RemoveSignalingDesignation());assert.deepEqual(f.posts(),[],'only from its dialog');
  await f.write({modal:{kind:'signaling-page-confirm',action:'service-remove'}});await f.act(new sp.RemoveSignalingDesignation());
  assert.deepEqual(f.posts(),[{method:'POST',path:'/api/orgs/'+F.ORG+'/signaling',body:{operation:'set-service',input:{designated:false,revision:0}}}],'removal is narrowing: no review');
  const s=await f.read();assert.equal(s.modal,null);assert.equal(s.notice,'Designation removed. Long-lived offers were revoked.');
 }finally{await f.close();}
});

test('seeded chaos: no decision is ever sent unarmed, for another surface, without its review, or while signaling is off',async()=>{
 const createRandom=seed=>{let state=seed>>>0;const next=()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};return {int:n=>Math.floor(next()*n),pick:list=>list[Math.floor(next()*list.length)],chance:p=>next()<p};};
 const base=Number(process.env.CHAOS_SEED??1);let total=0;
 for(let seed=base;seed<base+10;seed++){const random=createRandom(seed);let fault=null;
  const f=await fixture({submissions:{renew:{days:'90'}},request:path=>{if(fault&&path!=='/api/signaling/review')throw Object.assign(Error('x'),{status:fault==='409'?409:500,code:fault==='409'?random.pick(['review_required','decision_not_armed','conflict']):undefined});}});
  try{
   const decisions=[];
   for(let step=0;step<40;step++){
    fault=random.chance(0.25)?random.pick(['409','500']):null;const roll=random.int(8);
    if(roll===0)await f.act(new sp.OpenSignalingPage({page:random.pick(['approve','pairing','service','pair']),params:{client:F.APP,kind:F.CHAT,id:F.PENDING_ID,organization:F.ORG}}));
    else if(roll===1)await f.act(new sp.ReviewSignalingChange({action:random.pick(['pairing-activate','pairing-renew','set-service','session-approve']),clientId:F.APP,kind:F.CHAT,operationId:'renew'}));
    else if(roll===2){const p=await f.page();if(p?.review)await f.act(new sp.SignalingArm({armed:random.chance(0.7),surface:random.chance(0.8)?p.review.review:'rv_'+'x'.repeat(22)}));}
    else if(roll===3){const on=random.chance(0.8),s=await f.read();await f.write({session:{...s.session,account:{...s.session.account,consoleFeatures:on?features:{}}},data:{features:on?features:{}}});}
    else if(roll===4)await f.act(new sp.CancelSignalingReview());
    else{const s=await f.read(),p=sp.pageModel(s),before=f.calls.length;await f.act(new sp.DecideSignalingChange({autoConnect:random.chance(0.5)}));
     const sent=f.calls.slice(before).filter(c=>c.method==='POST'&&c.path!=='/api/signaling/review');
     if(sent.length){assert.equal(sent.length,1);assert.ok(p?.review&&p.armed===true&&p.surface===p.review.review,`seed ${seed}: armed surface`);assert.equal(sent[0].body.review,p.review.review,`seed ${seed}: the review id`);decisions.push(sent[0]);}}
    const s=await f.read();assert.equal(s.busy,false,`seed ${seed}: busy clears`);
   }
   total+=decisions.length;
  }finally{await f.close();}
 }
 assert.ok(total>0,'the model reaches decisions');
});
