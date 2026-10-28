// Signaling owner controls (apps/web/src/bl/signaling-controls.mjs; signaling.md rev 3.2 §14.1) driven through the
// real ngin engine and browser-state provider, against a recording API double. The routes and engine rules are the
// server's (tests/*.test.mjs); the rendered surfaces are covered by tests/browser/signaling-controls.mjs and, in real
// browsers, tests/browser/signaling-controls-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {within} from '../helpers/async.mjs';
import {Window} from 'happy-dom';
const window=new Window({url:'https://space.example/console'}),names=['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'];
const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));for(const name of names)globalThis[name]=window[name];
const {Engine,Provider}=await import('../../apps/web/src/shared/stack.mjs');
const {default:StateProvider}=await import('../../apps/web/src/providers/browser-state.mjs');
const sg=await import('../../apps/web/src/bl/signaling-controls.mjs');
const {SETTINGS,OWNER,OTHER,ORIGIN,APP,CHAT,SYNC,FAR}=await import('../helpers/signaling-controls-fixture.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const features={signalingEnabled:true};
// A local seeded generator (the same mulberry32 step as packages/app/memory-providers.mjs createRandom) so this browser
// test never imports server modules; a failing seed is named and can be rerun with CHAOS_SEED.
function createRandom(seed){let state=seed>>>0;const next=()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};const int=n=>Math.floor(next()*n);return {seed,next,int,pick:list=>list[int(list.length)],chance:p=>next()<p};}
async function forEachSeed(count,fn,base=Number(process.env.CHAOS_SEED??1)){for(let seed=base;seed<base+count;seed++){try{await fn(createRandom(seed));}catch(error){error.message=`seed=${seed} (rerun with CHAOS_SEED=${seed}): ${error.message}`;throw error;}}}
async function fixture({get,request,submissions={},enabled=true,view='security'}={}){
 const calls=[],effects=[];
 const api={async get(path){calls.push({method:'GET',path});return get?get(path):path==='/api/signaling/settings'?structuredClone(SETTINGS):{};},async request(path,body,method='POST'){calls.push({method,path,body});return request?request(path,body,method):{};}};
 const browser={consumeSubmission:id=>submissions[id],captureFocus:()=>effects.push(['captureFocus']),restoreFocus:()=>effects.push(['restoreFocus']),focus:selector=>effects.push(['focus',selector]),setCaptchaAction(){},installCaptcha(){}};
 const engine=new Engine({providers:{state:StateProvider,api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),portalContributions:Provider.fromSingleton({}),recoveryFile:Provider.fromSingleton({})}});
 const write=patch=>engine.container.use({state:{write:true}},({state})=>state.transition(next=>Object.assign(next,patch))),read=()=>engine.container.use(['state'],({state})=>state.snapshot());
 await write({loading:false,locale:'en',view,route:{kind:'home'},config:{},session:{account:{id:OWNER,consoleFeatures:enabled?features:{}},sessionContext:'ctx'},beamGeneration:1,data:{features:enabled?features:{},collections:[]}});
 return {engine,calls,effects,write,read,act:action=>within(engine.dispatch(action).next('complete'),action.constructor.name),close:()=>engine.dispose()};
}
const loaded=async f=>{await f.act(new sg.LoadSignalingSettings());assert.equal(sg.signalingModel(await f.read()).status,'loaded');f.calls.length=0;};
const settled=()=>new Promise(resolve=>setTimeout(resolve,0));

test('the settings load reports loading then loaded; nothing is requested or shown while signaling is off',async()=>{
 const off=await fixture({enabled:false});
 try{
  await off.act(new sg.LoadSignalingSettings());await off.act(new sg.SignalingOwnerAction({action:'unblock',input:{issuer:'https://spam.example'}}));assert.equal((await off.read()).error,sg.SIGNALING_UNAVAILABLE);
  await off.act(new sg.SaveSignalingPolicy({values:{other:'public',self:'all'}}));
  assert.deepEqual(off.calls,[]);assert.equal(sg.signalingModel(await off.read()),null);
  // The old flag name is never honoured (renamed server-side to signalingEnabled).
  await off.write({session:{account:{id:OWNER,consoleFeatures:{rtcSignalingEnabled:true}},sessionContext:'ctx'},data:{features:{rtcSignalingEnabled:true}}});assert.equal(sg.signalingEnabled(await off.read()),false);
 }finally{await off.close();}
 let finish;const f=await fixture({get:()=>new Promise(resolve=>finish=resolve)});
 try{
  const pending=f.act(new sg.LoadSignalingSettings());while(!finish)await settled();
  assert.equal(sg.signalingModel(await f.read()).status,'loading');finish(structuredClone(SETTINGS));await pending;
  const m=sg.signalingModel(await f.read());assert.equal(m.status,'loaded');assert.equal(m.owner,OWNER);assert.equal(m.policy.revision,3);assert.equal(m.apps.length,3);
  assert.deepEqual(f.calls,[{method:'GET',path:'/api/signaling/settings'}]);
  // A later reload while loaded never flips the surfaces back to their loading state.
  finish=null;const again=f.act(new sg.LoadSignalingSettings());while(!finish)await settled();assert.equal(sg.signalingModel(await f.read()).status,'loaded');finish(structuredClone(SETTINGS));await again;
 }finally{await f.close();}
 const g=await fixture({get:()=>{throw Object.assign(Error('Unavailable'),{status:503});}});
 try{await g.act(new sg.LoadSignalingSettings());const s=await g.read();assert.equal(sg.signalingModel(s).status,'error');assert.equal(s.error,'Unavailable');}finally{await g.close();}
});

test('an account switch during a load discards the answer; another owner\'s settings are never shown',async()=>{
 let finish;const f=await fixture({get:()=>new Promise(resolve=>finish=resolve)});
 try{
  const pending=f.act(new sg.LoadSignalingSettings());while(!finish)await settled();
  await f.write({session:{account:{id:OTHER,consoleFeatures:features},sessionContext:'ctx2'},beamGeneration:2});finish(structuredClone(SETTINGS));await pending;
  assert.equal(sg.signalingModel(await f.read()),null);
  // A model left from the earlier owner or session generation is ignored by the selector.
  await f.write({signaling:{...structuredClone(SETTINGS),owner:OWNER,generation:1,status:'loaded'}});assert.equal(sg.signalingModel(await f.read()),null);
 }finally{await f.close();}
});

test('removing and revoking run only from their confirmation dialog and send exactly the members the route takes',async()=>{
 const f=await fixture();
 try{
  await loaded(f);
  const cases=[
   ['revoke-endpoint',{endpoint:'ep_'+'a'.repeat(22)},'/api/signaling/revoke-endpoint',{endpoint:'ep_'+'a'.repeat(22)},'Device removed.'],
   ['revoke-offers',{id:'of_open'},'/api/signaling/revoke-offers',{id:'of_open'},'Offer revoked.'],
   ['revoke-offers',{clientId:APP},'/api/signaling/revoke-offers',{clientId:APP},'Offers revoked.'],
   ['pairing-remove',{id:'pr_self'},'/api/signaling/pairing-remove',{id:'pr_self'},'Pairing removed.'],
   ['session-unapprove',{clientId:APP,kind:CHAT},'/api/intents/session-unapprove',{clientId:APP,kind:CHAT},'Connection type removed.']];
  for(const [action,input,path,body,notice] of cases){
   assert.equal(sg.needsConfirmation(action),true,action);
   await f.write({modal:null,error:'',notice:''});await f.act(new sg.SignalingOwnerAction({action,input}));
   assert.equal((await f.read()).error,sg.SIGNALING_REVIEW,action+' without its dialog');assert.equal(f.calls.length,0);
   await f.write({modal:{kind:'signaling-confirm',action,input:action==='revoke-offers'&&input.id?{id:'of_bound'}:{...input,...input.endpoint?{endpoint:'ep_other'}:input.id?{id:'other'}:{clientId:'https://elsewhere.example/client'}}},error:''});
   await f.act(new sg.SignalingOwnerAction({action,input}));assert.equal((await f.read()).error,sg.SIGNALING_REVIEW,action+' with a dialog for something else');assert.equal(f.calls.length,0);
   await f.write({modal:{kind:'signaling-confirm',action:action==='pairing-remove'?'revoke-endpoint':'pairing-remove',input},error:''});
   await f.act(new sg.SignalingOwnerAction({action,input}));assert.equal((await f.read()).error,sg.SIGNALING_REVIEW,action+' with another action\'s dialog');assert.equal(f.calls.length,0);
   // Extra members in the intent are dropped, never forwarded.
   await f.write({modal:{kind:'signaling-confirm',action,input},error:''});await f.act(new sg.SignalingOwnerAction({action,input:{...input,all:true,autoConnect:true}}));const s=await f.read();
   assert.deepEqual(f.calls.map(c=>`${c.method} ${c.path}`),[`POST ${path}`,'GET /api/signaling/settings'],action);assert.deepEqual(f.calls[0].body,body,action);
   assert.equal(s.modal,null);assert.equal(s.notice,notice);assert.equal(s.error,'');assert.equal(s.busy,false);assert.deepEqual(f.effects.at(-1),['restoreFocus']);f.calls.length=0;
  }
 }finally{await f.close();}
});

test('unblocking and turning auto-connect off need no dialog; turning auto-connect on is never sent',async()=>{
 const f=await fixture();
 try{
  await loaded(f);
  await f.act(new sg.SignalingOwnerAction({action:'unblock',input:{principal:FAR,handle:'x'}}));
  assert.deepEqual(f.calls[0],{method:'POST',path:'/api/signaling/unblock',body:{principal:FAR}});let s=await f.read();assert.equal(s.notice,'Unblocked.');assert.deepEqual(f.effects.at(-1),['focus','#signaling-blocked-title']);f.calls.length=0;
  await f.act(new sg.SignalingOwnerAction({action:'unblock',input:{issuer:'https://spam.example'}}));
  assert.deepEqual(f.calls[0].body,{issuer:'https://spam.example'});assert.equal((await f.read()).notice,'Provider unblocked.');f.calls.length=0;
  await f.act(new sg.SignalingOwnerAction({action:'session-auto-connect',input:{clientId:APP,kind:SYNC,autoConnect:true}}));
  assert.deepEqual(f.calls[0],{method:'POST',path:'/api/intents/session-auto-connect',body:{clientId:APP,kind:SYNC,autoConnect:false}},'only ever narrows');
  s=await f.read();assert.equal(s.notice,'Automatic connection turned off.');assert.deepEqual(f.effects.at(-1),['focus','#'+sg.signalingAppAnchor(APP)]);
  assert.match(sg.signalingAppAnchor(APP),/^signaling-app-[0-9a-z]+$/);assert.notEqual(sg.signalingAppAnchor(APP),sg.signalingAppAnchor(APP+'x'));
 }finally{await f.close();}
});

test('unknown actions, malformed input and the routes this surface does not offer are refused before any request',async()=>{
 const f=await fixture();
 try{
  await loaded(f);
  const refused=[['end-session',{sid:'s'}],['block',{principal:FAR}],['set-policy',{other:'public'}],['revoke-offers',{all:false}],['revoke-offers',{}],['unblock',{principal:{iss:ORIGIN}}],['unblock',{}],['revoke-endpoint',{endpoint:''}],['session-unapprove',{clientId:APP}],['session-auto-connect',{kind:SYNC}],['pairing-remove',{id:7}],['__proto__',{}],['toString',{}],[undefined,{}]];
  for(const [action,input] of refused){await f.write({error:'',modal:{kind:'signaling-confirm',action,input}});await f.act(new sg.SignalingOwnerAction({action,input}));assert.equal((await f.read()).error,sg.SIGNALING_UNAVAILABLE,String(action)+JSON.stringify(input));}
  assert.equal(f.calls.length,0);
 }finally{await f.close();}
});

test('a refusal with the uniform 404 reads as unavailable; other failures keep their message and clear busy',async()=>{
 let fail=Object.assign(Error('Request failed'),{status:404,code:'not_found'});
 const f=await fixture({request:async()=>{throw fail;}});
 try{
  await loaded(f);await f.act(new sg.SignalingOwnerAction({action:'unblock',input:{principal:FAR}}));let s=await f.read();
  assert.equal(s.error,sg.SIGNALING_UNAVAILABLE);assert.equal(s.notice??'','');assert.equal(s.busy,false);
  fail=Object.assign(Error('Too many requests. Wait a moment, then try again.'),{status:429,code:'rate_limited'});
  await f.write({modal:{kind:'signaling-confirm',action:'pairing-remove',input:{id:'pr_self'}}});await f.act(new sg.SignalingOwnerAction({action:'pairing-remove',input:{id:'pr_self'}}));s=await f.read();
  assert.equal(s.error,'Too many requests. Wait a moment, then try again.');assert.equal(s.busy,false);assert.equal(s.modal?.kind,'signaling-confirm','the dialog stays open so the owner can retry or cancel');
 }finally{await f.close();}
});

test('connection privacy sends both choices with the loaded revision, coercing unknown values to relay',async()=>{
 const f=await fixture({submissions:{privacy:{other:'public',self:'public'},weird:{other:'all',self:'everything'}}});
 try{
  await loaded(f);
  await f.act(new sg.SaveSignalingPolicy({operationId:'privacy'}));
  assert.deepEqual(f.calls.map(c=>`${c.method} ${c.path}`),['POST /api/signaling/set-policy','GET /api/signaling/settings']);assert.deepEqual(f.calls[0].body,{other:'public',self:'public',revision:3});
  assert.equal((await f.read()).notice,sg.SIGNALING_POLICY_SAVED);assert.deepEqual(f.effects.slice(-2),[['captureFocus'],['restoreFocus']]);f.calls.length=0;
  await f.act(new sg.SaveSignalingPolicy({operationId:'weird'}));assert.deepEqual(f.calls[0].body,{other:'relay',self:'relay',revision:3},'`all` never applies to other people; an unknown value falls back to relay');
 }finally{await f.close();}
 // Nothing is sent before the settings (and so the revision) are loaded.
 const early=await fixture({submissions:{privacy:{other:'public',self:'all'}}});
 try{await early.act(new sg.SaveSignalingPolicy({operationId:'privacy'}));assert.deepEqual(early.calls,[]);}finally{await early.close();}
});

test('a stale revision reloads the latest settings and asks for a review; nothing is retried or reported as saved',async()=>{
 let revision=3;const f=await fixture({get:()=>({...structuredClone(SETTINGS),policy:{other:'public',self:'relay',revision}}),request:async(path,body)=>{if(body.revision!==revision)throw Object.assign(Error('conflict'),{status:409,code:'conflict'});revision++;return {other:body.other,self:body.self,revision};},submissions:{privacy:{other:'relay',self:'all'}}});
 try{
  await loaded(f);revision=4;// changed in another tab
  await f.act(new sg.SaveSignalingPolicy({operationId:'privacy'}));let s=await f.read();
  assert.deepEqual(f.calls.map(c=>`${c.method} ${c.path}`),['POST /api/signaling/set-policy','GET /api/signaling/settings']);assert.equal(f.calls[0].body.revision,3);
  assert.equal(s.error,sg.SIGNALING_CONFLICT);assert.equal(s.notice??'','');assert.equal(sg.signalingModel(s).policy.revision,4,'the newer settings are shown');assert.equal(s.busy,false);f.calls.length=0;
  await f.act(new sg.SaveSignalingPolicy({operationId:'privacy'}));s=await f.read();assert.equal(f.calls[0].body.revision,4);assert.equal(s.notice,sg.SIGNALING_POLICY_SAVED);assert.equal(s.error,'');
 }finally{await f.close();}
});

test('a change that succeeds but whose refresh fails is reported as saved with stale data',async()=>{
 let reads=0;const f=await fixture({get:()=>{if(++reads>1)throw Object.assign(Error('Unavailable'),{status:503});return structuredClone(SETTINGS);}});
 try{await loaded(f);await f.act(new sg.SignalingOwnerAction({action:'unblock',input:{issuer:'https://spam.example'}}));const s=await f.read();assert.equal(s.notice,'Provider unblocked.');assert.equal(s.error,sg.SIGNALING_STALE);assert.equal(sg.signalingModel(s).status,'loaded');}finally{await f.close();}
});

// Seeded chaos: random owner operations, dialogs opened for the right or the wrong target, flag flips, account
// switches and server faults. Invariants: a confirmed operation is sent only while its exact dialog is open, nothing is
// sent while the flag is off, every request carries only the route's members, busy always clears, and the model shown
// is always the signed-in owner's.
test('seeded chaos: confirmation, flag and owner invariants hold across random operations and faults',async()=>{
 const ROUTES={'/api/signaling/unblock':['principal','issuer'],'/api/signaling/revoke-endpoint':['endpoint'],'/api/signaling/revoke-offers':['id','clientId','all'],'/api/signaling/pairing-remove':['id'],'/api/intents/session-unapprove':['clientId','kind'],'/api/intents/session-auto-connect':['clientId','kind','autoConnect'],'/api/signaling/set-policy':['other','self','revision']};
 const OPS=[['revoke-endpoint',{endpoint:'ep_'+'a'.repeat(22)}],['revoke-offers',{id:'of_open'}],['revoke-offers',{clientId:APP}],['pairing-remove',{id:'pr_peer'}],['session-unapprove',{clientId:APP,kind:CHAT}],['session-auto-connect',{clientId:APP,kind:SYNC}],['unblock',{principal:FAR}],['unblock',{issuer:'https://spam.example'}],['block',{principal:FAR}],['revoke-offers',{all:true}]];
 await forEachSeed(12,async random=>{
  let fault=null;const f=await fixture({submissions:{p:{other:'public',self:'all'}},get:()=>{if(fault==='get')throw Object.assign(Error('Unavailable'),{status:503});return structuredClone(SETTINGS);},request:async()=>{if(fault==='404')throw Object.assign(Error('x'),{status:404,code:'not_found'});if(fault==='409')throw Object.assign(Error('conflict'),{status:409,code:'conflict'});if(fault==='500')throw Object.assign(Error('Server error'),{status:500});return {};}});
  try{
   await loaded(f);
   for(let step=0;step<30;step++){
    fault=random.chance(0.3)?random.pick(['get','404','409','500']):null;
    const roll=random.int(10);
    if(roll===0){await f.write({session:{account:{id:random.chance(0.5)?OWNER:OTHER,consoleFeatures:features},sessionContext:'c'+step},beamGeneration:step+2,signaling:null});await f.act(new sg.LoadSignalingSettings());}
    else if(roll===1){const on=random.chance(0.5);const s=await f.read();await f.write({session:{...s.session,account:{...s.session.account,consoleFeatures:on?features:{}}},data:{features:on?features:{}}});}
    else if(roll===2)await f.act(new sg.SaveSignalingPolicy({operationId:'p'}));
    else{
     const [action,input]=random.pick(OPS),modal=random.chance(0.6)?{kind:'signaling-confirm',action:random.chance(0.8)?action:random.pick(OPS)[0],input:random.chance(0.8)?input:random.pick(OPS)[1]}:null;
     await f.write({modal,error:'',notice:''});const before=f.calls.length,s0=await f.read();
     await f.act(new sg.SignalingOwnerAction({action,input:{...input,extra:random.int(3)}}));
     const sent=f.calls.slice(before).filter(c=>c.method==='POST');
     if(sent.length){
      assert.equal(sg.signalingEnabled(s0),true,'nothing is sent while the flag is off');
      if(sg.needsConfirmation(action))assert.ok(s0.modal?.kind==='signaling-confirm'&&s0.modal.action===action&&JSON.stringify(sg.signalingInput(action,s0.modal.input))===JSON.stringify(sg.signalingInput(action,input)),'a confirmed operation needs its exact dialog');
      assert.equal(sent.length,1);
     }
    }
    const s=await f.read();assert.equal(s.busy,false,'busy clears');
    const m=sg.signalingModel(s);if(m)assert.equal(m.owner,s.session.account.id,'only the signed-in owner\'s model');
   }
   for(const c of f.calls.filter(c=>c.method==='POST')){assert.ok(Object.hasOwn(ROUTES,c.path),c.path);for(const key of Object.keys(c.body))assert.ok(ROUTES[c.path].includes(key),`${c.path} carries only its members (${key})`);if(c.path.endsWith('session-auto-connect'))assert.equal(c.body.autoConnect,false);}
  }finally{await f.close();}
 });
});
