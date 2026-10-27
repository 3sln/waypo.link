// RTC-g owner settings and portal ring Actions (apps/web/src/bl/rtc-settings.mjs) driven through the real ngin engine
// and browser-state provider, against a recording API double. Routes and engine rules are covered by
// tests/rtc-owner-routes.test.mjs and tests/rtc-*.test.mjs; the rendered view by tests/browser/rtc-settings.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {within} from '../helpers/async.mjs';
import {Window} from 'happy-dom';
const window=new Window({url:'https://space.example/console'}),names=['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'];
const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));for(const name of names)globalThis[name]=window[name];
const {Engine,Provider}=await import('../../apps/web/src/shared/stack.mjs');
const {default:StateProvider}=await import('../../apps/web/src/providers/browser-state.mjs');
const rtc=await import('../../apps/web/src/bl/rtc-settings.mjs');
const {SETTINGS}=await import('../helpers/rtc-settings-fixture.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const OWNER='550e8400-e29b-41d4-a716-446655440001',OTHER='550e8400-e29b-41d4-a716-446655440002',ORIGIN='https://space.example';
const CALL='https://spec.bindle.example/rtc-purposes/call/v1',SCREEN='https://spec.bindle.example/rtc-purposes/screen-share/v1',SYNC='https://spec.bindle.example/rtc-purposes/device-sync/v1';
const APP='https://app.example/client',APP2='https://other.example/client';
const peer={iss:ORIGIN,sub:OTHER};
const features={rtcSignalingEnabled:true};
async function fixture({get,request,submissions={},enabled=true}={}){
 const calls=[],effects=[];
 const api={async get(path){calls.push({method:'GET',path});return get?get(path):path==='/api/rtc/settings'?structuredClone(SETTINGS):path==='/api/rtc/ring'?{invites:[]}:{};},async request(path,body,method='POST'){calls.push({method,path,body});return request?request(path,body,method):{};}};
 const browser={consumeSubmission:id=>submissions[id],captureFocus:()=>effects.push(['captureFocus']),restoreFocus:()=>effects.push(['restoreFocus']),focus:selector=>effects.push(['focus',selector]),setCaptchaAction(){},installCaptcha(){}};
 const engine=new Engine({providers:{state:StateProvider,api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),portalContributions:Provider.fromSingleton({}),recoveryFile:Provider.fromSingleton({})}});
 const write=patch=>engine.container.use({state:{write:true}},({state})=>state.transition(next=>Object.assign(next,patch))),read=()=>engine.container.use(['state'],({state})=>state.snapshot());
 await write({loading:false,locale:'en',view:'calls',route:{kind:'home'},config:{},session:{account:{id:OWNER,consoleFeatures:enabled?features:{}},sessionContext:'ctx'},beamGeneration:1,data:{features:enabled?features:{},contacts:[],collections:[]}});
 return {engine,calls,effects,write,read,act:action=>within(engine.dispatch(action).next('complete'),action.constructor.name),close:()=>engine.dispose()};
}
const loaded=async f=>{await f.act(new rtc.LoadRtcSettings());assert.equal(rtc.rtcModel(await f.read()).status,'loaded');f.calls.length=0;};

test('the settings load reports loading then loaded, and nothing is requested while RTC is off for the account',async()=>{
 const off=await fixture({enabled:false});
 try{await off.act(new rtc.LoadRtcSettings());await off.act(new rtc.LoadRtcRing());assert.deepEqual(off.calls,[]);const s=await off.read();assert.equal(rtc.rtcModel(s),null);assert.deepEqual(rtc.rtcRingInvites(s),[]);}finally{await off.close();}
 let finish;const f=await fixture({get:path=>path==='/api/rtc/settings'?new Promise(resolve=>finish=resolve):{invites:[]}});
 try{
  const pending=f.act(new rtc.LoadRtcSettings());while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(rtc.rtcModel(await f.read()).status,'loading');finish(structuredClone(SETTINGS));await pending;
  const m=rtc.rtcModel(await f.read());assert.equal(m.status,'loaded');assert.equal(m.owner,OWNER);assert.equal(m.purposes.length,3);
  // A later reload while loaded never flips the view back to its loading state.
  finish=null;const again=f.act(new rtc.LoadRtcSettings());while(!finish)await new Promise(resolve=>setTimeout(resolve,0));assert.equal(rtc.rtcModel(await f.read()).status,'loaded');finish(structuredClone(SETTINGS));await again;
 }finally{await f.close();}
 const g=await fixture({get:()=>{throw Object.assign(Error('Unavailable'),{status:503});}});
 try{await g.act(new rtc.LoadRtcSettings());const s=await g.read();assert.equal(rtc.rtcModel(s).status,'error');assert.equal(s.error,'Unavailable');}finally{await g.close();}
});

test('an account switch during a load discards the answer; another owner\'s model is never shown',async()=>{
 let finish;const f=await fixture({get:path=>path==='/api/rtc/settings'?new Promise(resolve=>finish=resolve):{invites:[]}});
 try{
  const pending=f.act(new rtc.LoadRtcSettings());while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
  await f.write({session:{account:{id:OTHER,consoleFeatures:features},sessionContext:'ctx2'},beamGeneration:2});finish(structuredClone(SETTINGS));await pending;
  assert.equal(rtc.rtcModel(await f.read()),null);
 }finally{await f.close();}
});

test('ending, revoking, removing a device, blocking and clearing everything run only from their confirmation dialog',async()=>{
 const f=await fixture();
 try{
  await loaded(f);
  const cases=[['end-session',{sid:'s'.repeat(22),caller:peer},'Session ended.'],['revoke-ticket',{jti:'t1'},'Call link revoked.'],['revoke-endpoint',{endpoint:'ep_'+'a'.repeat(22)},'Device removed from calls.'],['block',{principal:peer},'Blocked. Their calls and requests are dropped without telling them.'],['clear-missed',{},'Removed from the list.'],['narrow-app',{clientId:APP,purposes:[CALL]},'App access narrowed. Its calls and connections for the removed purposes ended.']];
  for(const [action,input,notice] of cases){
   await f.write({modal:null,error:'',notice:''});await f.act(new rtc.RtcOwnerAction({action,input}));let s=await f.read();
   assert.equal(s.error,rtc.RTC_REVIEW,action+' without its dialog');assert.equal(f.calls.length,0);
   await f.write({modal:{kind:'rtc-confirm',action,input:action==='block'?{principal:{iss:ORIGIN,sub:OWNER}}:{...input,extra:1}},error:''});await f.act(new rtc.RtcOwnerAction({action,input}));
   assert.equal((await f.read()).error,rtc.RTC_REVIEW,action+' with a dialog for something else');assert.equal(f.calls.length,0);
   await f.write({modal:{kind:'rtc-confirm',action,input},error:''});await f.act(new rtc.RtcOwnerAction({action,input}));s=await f.read();
   assert.deepEqual(f.calls.map(c=>`${c.method} ${c.path}`),[`POST /api/rtc/${action}`,'GET /api/rtc/settings','GET /api/rtc/ring'],action);assert.deepEqual(f.calls[0].body,input);
   assert.equal(s.modal,null);assert.equal(s.notice,notice);assert.equal(s.error,'');assert.deepEqual(f.effects.at(-1),['restoreFocus']);f.calls.length=0;
  }
 }finally{await f.close();}
});

test('removing one missed entry and declining from the ring need no dialog; unknown actions are refused',async()=>{
 const f=await fixture();
 try{
  await loaded(f);await f.act(new rtc.RtcOwnerAction({action:'clear-missed',input:{id:'m1'}}));assert.deepEqual(f.calls[0],{method:'POST',path:'/api/rtc/clear-missed',body:{id:'m1'}});f.calls.length=0;
  await f.write({rtcRing:{owner:OWNER,generation:1,invites:[{sid:'s'.repeat(22),caller:peer,purpose:CALL,media:['audio'],ringUntil:Date.now()+60000,apps:[]}],dismissed:[]}});
  await f.act(new rtc.RtcOwnerAction({action:'end-session',input:{sid:'s'.repeat(22),caller:peer,silent:true},ring:true}));assert.deepEqual(f.calls[0],{method:'POST',path:'/api/rtc/end-session',body:{sid:'s'.repeat(22),caller:peer,silent:true}});assert.deepEqual(rtc.rtcRingInvites(await f.read()),[],'the declined invite leaves the ring');f.calls.length=0;
  // `ring` exempts nothing by itself: a non-silent end (it tells the caller) and any other destructive action still ask.
  await f.write({error:''});await f.act(new rtc.RtcOwnerAction({action:'end-session',input:{sid:'s'.repeat(22),caller:peer},ring:true}));assert.equal((await f.read()).error,rtc.RTC_REVIEW);
  await f.write({error:''});await f.act(new rtc.RtcOwnerAction({action:'block',input:{principal:peer},ring:true}));assert.equal((await f.read()).error,rtc.RTC_REVIEW);
  for(const action of ['rtc.block','ingest','set-app-purposes',undefined]){await f.write({error:''});await f.act(new rtc.RtcOwnerAction({action,input:{}}));assert.equal((await f.read()).error,rtc.RTC_UNAVAILABLE,String(action));}
  assert.equal(f.calls.length,0);
 }finally{await f.close();}
});

test('a widening change refused with the uniform 404 reads as unavailable, not as an unknown error',async()=>{
 const f=await fixture({request:async()=>{throw Object.assign(Error('Request failed'),{status:404,code:'not_found'});}});
 try{await loaded(f);await f.act(new rtc.RtcOwnerAction({action:'unblock',input:{principal:peer}}));const s=await f.read();assert.equal(s.error,rtc.RTC_UNAVAILABLE);assert.equal(s.notice??'','');assert.equal(s.busy,false);}finally{await f.close();}
});

test('network privacy and requests submit only the policy members the form names, coercing unknown values to the safe default',async()=>{
 const f=await fixture({submissions:{privacy:{other:'public',self:'relay'},weird:{other:'all',self:'everything'},requests:{[`request:${CALL}`]:'on',[`request:${SYNC}`]:'on',[`request:${SCREEN}`]:'off'}}});
 try{
  await loaded(f);
  await f.act(new rtc.SaveRtcPolicy({operationId:'privacy'}));assert.deepEqual(f.calls[0],{method:'POST',path:'/api/rtc/set-policy',body:{other:'public',self:'relay'}});assert.equal((await f.read()).notice,'Call settings saved.');f.calls.length=0;
  await f.act(new rtc.SaveRtcPolicy({operationId:'weird'}));assert.deepEqual(f.calls[0].body,{other:'relay',self:'all'},'`all` never applies to other people; an unknown value falls back');f.calls.length=0;
  await f.act(new rtc.SaveRtcPolicy({operationId:'requests',requests:true}));assert.deepEqual(f.calls[0].body,{requests:[CALL]},'only the requests, and own-device purposes can never be requested by others');
  assert.deepEqual(f.effects.slice(-2),[['captureFocus'],['restoreFocus']]);
 }finally{await f.close();}
});

test('contact-link purposes and per-app automatic answers send exactly what the owner may set',async()=>{
 const f=await fixture({submissions:{contact:{[`purpose:${CALL}`]:'on',[`purpose:${SYNC}`]:'on'},none:{},auto:{[`auto:${SYNC}`]:'on',[`auto:${CALL}`]:'on'},off:{}}});
 try{
  await loaded(f);
  await f.act(new rtc.SaveRtcContact({parent:'770e8400-e29b-41d4-a716-000000000001',operationId:'contact'}));assert.deepEqual(f.calls[0].body,{parent:'770e8400-e29b-41d4-a716-000000000001',purposes:[CALL]});assert.equal((await f.read()).notice,'Contact link call settings saved.');f.calls.length=0;
  await f.act(new rtc.SaveRtcContact({parent:'770e8400-e29b-41d4-a716-000000000001',operationId:'none'}));assert.deepEqual(f.calls[0].body.purposes,[],'unchecking everything removes the configuration');f.calls.length=0;
  await f.act(new rtc.SaveRtcAutoAccept({clientId:APP,operationId:'auto'}));assert.deepEqual(f.calls[0].body,{autoAccept:{[APP2]:[SYNC],[APP]:[SYNC]}},'only auto_accept "self" purposes the app holds; other apps kept');f.calls.length=0;
  await f.act(new rtc.SaveRtcAutoAccept({clientId:APP2,operationId:'off'}));assert.deepEqual(f.calls[0].body,{autoAccept:{}},'an app without such purposes loses its entry');
 }finally{await f.close();}
});

test('the ring keeps live invites, hides dismissed ones in this tab only and never raises an error banner',async()=>{
 const now=Date.now(),invite=sid=>({sid,caller:peer,callerHandle:'river',purpose:CALL,title:{en:'Call',es:'Llamada'},media:['audio'],ringUntil:now+60000,apps:[{clientId:APP,origin:'https://app.example'}]});
 let invites=[invite('a'.repeat(22)),invite('b'.repeat(22)),{...invite('c'.repeat(22)),ringUntil:now-1}];
 const f=await fixture({get:path=>path==='/api/rtc/ring'?{invites}:structuredClone(SETTINGS)});
 try{
  await f.act(new rtc.LoadRtcRing());assert.deepEqual(rtc.rtcRingInvites(await f.read(),now).map(i=>i.sid),['a'.repeat(22),'b'.repeat(22)],'an expired invite is not shown');
  await f.act(new rtc.DismissRtcRing({sid:'a'.repeat(22)}));assert.deepEqual(rtc.rtcRingInvites(await f.read(),now).map(i=>i.sid),['b'.repeat(22)]);
  assert.equal(f.calls.filter(c=>c.method!=='GET').length,0,'dismissing sends nothing');
  invites=[invite('b'.repeat(22))];await f.act(new rtc.LoadRtcRing());assert.deepEqual((await f.read()).rtcRing.dismissed,[],'dismissals of ended invites are forgotten');
  await f.write({offline:true});assert.deepEqual(rtc.rtcRingInvites(await f.read(),now),[]);await f.write({offline:false});
  await f.write({data:{features:{}},session:{account:{id:OWNER,consoleFeatures:{}},sessionContext:'ctx'}});assert.deepEqual(rtc.rtcRingInvites(await f.read(),now),[],'nothing rings once RTC is off for the account');
 }finally{await f.close();}
 const g=await fixture({get:()=>{throw Object.assign(Error('Unavailable'),{status:503});}});
 try{await g.act(new rtc.LoadRtcRing());assert.equal((await g.read()).error??'','');}finally{await g.close();}
});

// ——— Review follow-ups (2026-10-27): F1, F3, F4 and F5 at engine level ———
const inviteOf=(sid,extra={})=>({sid,caller:peer,callerHandle:'river',purpose:CALL,title:{en:'Call',es:'Llamada'},media:['audio'],ringUntil:Date.now()+60000,apps:[],...extra});
const A='A'.repeat(22),B='B'.repeat(22),C='C'.repeat(22);

test('F1: a silent decline needs no dialog, says the caller is not told, and stays hidden while the provider still rings',async()=>{
 // The route answers the interim silent end (nothing changed at the provider): the invite is still listed afterwards.
 const invites=[inviteOf(A),inviteOf(B)];
 const f=await fixture({get:p=>p==='/api/rtc/ring'?{invites:structuredClone(invites)}:structuredClone(SETTINGS),request:p=>p==='/api/rtc/end-session'?{sid:A,state:'ringing',silent:true,local:true}:{}});
 try{
  await f.act(new rtc.LoadRtcRing());
  await f.act(new rtc.RtcOwnerAction({action:'end-session',input:{sid:A,caller:peer,silent:true},ring:true,until:invites[0].ringUntil}));
  const s=await f.read();assert.equal(s.error,'');assert.equal(s.notice,rtc.RTC_DECLINED);assert.doesNotMatch(s.notice,/ended|told the caller/i);
  assert.deepEqual(rtc.rtcRingInvites(s).map(i=>i.sid),[B],'the declined invite stays hidden though the provider still lists it');
  assert.deepEqual([...rtc.rtcDeclined(s)],[A]);
  // After its deadline the local entry lapses (nothing is kept beyond the ring).
  assert.deepEqual([...rtc.rtcDeclined(s,invites[0].ringUntil+1)],[]);
  // A silent end from the settings (no `ring`) is not a confirmation action either.
  assert.equal(rtc.needsConfirmation('end-session',{sid:A,caller:peer,silent:true}),false);assert.equal(rtc.needsConfirmation('end-session',{sid:A,caller:peer}),true);assert.equal(rtc.needsConfirmation('end-session',{sid:A}),true);
  assert.equal(rtc.silentEnd({role:'callee',state:'ringing',claimed:false}),true);assert.equal(rtc.silentEnd({role:'callee',state:'connected',claimed:true}),false);assert.equal(rtc.silentEnd({role:'caller',state:'ringing'}),false);
 }finally{await f.close();}
 // A failed request hides nothing.
 const g=await fixture({get:p=>p==='/api/rtc/ring'?{invites:[inviteOf(A)]}:structuredClone(SETTINGS),request:async()=>{throw Object.assign(Error('Unavailable'),{status:503});}});
 try{await g.act(new rtc.LoadRtcRing());await g.act(new rtc.RtcOwnerAction({action:'end-session',input:{sid:A,caller:peer,silent:true},ring:true}));assert.deepEqual(rtc.rtcRingInvites(await g.read()).map(i=>i.sid),[A]);assert.equal((await g.read()).error,'Unavailable');}finally{await g.close();}
});

test('F3: declining one invite keeps the others put off with Not now hidden, and reads settings only on their view',async()=>{
 let invites=[inviteOf(A),inviteOf(B)];
 const f=await fixture({get:p=>p==='/api/rtc/ring'?{invites:structuredClone(invites)}:structuredClone(SETTINGS),request:p=>{if(p==='/api/rtc/end-session')invites=invites.filter(i=>i.sid!==A);return {};}});
 try{
  await f.write({view:'inbox'});await f.act(new rtc.LoadRtcRing());await f.act(new rtc.DismissRtcRing({sid:B}));assert.deepEqual(rtc.rtcRingInvites(await f.read()).map(i=>i.sid),[A]);f.calls.length=0;
  await f.act(new rtc.RtcOwnerAction({action:'end-session',input:{sid:A,caller:peer,silent:true},ring:true}));
  assert.deepEqual(rtc.rtcRingInvites(await f.read()),[],'B, put off with Not now, does not come back');assert.deepEqual((await f.read()).rtcRing.dismissed,[B]);
  assert.deepEqual(f.calls.map(c=>`${c.method} ${c.path}`),['POST /api/rtc/end-session','GET /api/rtc/ring'],'no settings read off the calls view');
 }finally{await f.close();}
});

test('F5: after Decline or Not now focus moves to the next invite heading, else to main; restoreFocus only after a dialog',async()=>{
 const f=await fixture({get:p=>p==='/api/rtc/ring'?{invites:[inviteOf(A),inviteOf(B),inviteOf(C)]}:structuredClone(SETTINGS),request:()=>({local:true})});
 try{
  await f.act(new rtc.LoadRtcRing());
  await f.act(new rtc.DismissRtcRing({sid:B}));assert.deepEqual(f.effects.at(-1),['focus',`[id="rtc-ring-${C}"]`],'the next invite');
  await f.act(new rtc.RtcOwnerAction({action:'end-session',input:{sid:C,caller:peer,silent:true},ring:true}));assert.deepEqual(f.effects.at(-1),['focus',`[id="rtc-ring-${A}"]`],'the last one falls back to the previous invite');
  await f.act(new rtc.DismissRtcRing({sid:A}));assert.deepEqual(f.effects.at(-1),['focus','#main-content'],'none left: main');
  await loaded(f);await f.act(new rtc.RtcOwnerAction({action:'clear-missed',input:{id:'m1'}}));assert.deepEqual(f.effects.at(-1),['focus','#rtc-missed-title']);
  await f.act(new rtc.RtcOwnerAction({action:'end-session',input:{sid:A,caller:peer,silent:true},until:Date.now()+1000}));assert.deepEqual(f.effects.at(-1),['focus','#rtc-sessions-title']);
  assert.equal(f.effects.filter(e=>e[0]==='restoreFocus').length,0,'never restoreFocus without the matching capture');
  await f.write({modal:{kind:'rtc-confirm',action:'revoke-ticket',input:{jti:'t1'}}});await f.act(new rtc.RtcOwnerAction({action:'revoke-ticket',input:{jti:'t1'}}));assert.deepEqual(f.effects.at(-1),['restoreFocus'],'a confirmed action returns to the opener open-modal captured');
 }finally{await f.close();}
});

test('F4: an out-of-order ring answer is dropped; the outcome reports errors with Retry-After; idle is carried',async()=>{
 const pending=[];const f=await fixture({get:p=>p==='/api/rtc/ring'?new Promise(resolve=>pending.push(resolve)):structuredClone(SETTINGS)});
 try{
  const first=new rtc.LoadRtcRing(),second=new rtc.LoadRtcRing();const one=f.act(first);while(pending.length<1)await new Promise(r=>setTimeout(r,0));const two=f.act(second);while(pending.length<2)await new Promise(r=>setTimeout(r,0));
  pending[1]({invites:[inviteOf(B)],idle:false});await two;pending[0]({invites:[inviteOf(A)],idle:false});await one;
  assert.deepEqual(rtc.rtcRingInvites(await f.read()).map(i=>i.sid),[B],'the older answer arriving last is stale');assert.equal(first.outcome.stale,true);assert.equal(second.outcome.ok,true);
 }finally{await f.close();}
 const g=await fixture({get:()=>{throw Object.assign(Error('Too many'),{status:429,retryAfter:30});}});
 try{const a=new rtc.LoadRtcRing();await g.act(a);assert.deepEqual(a.outcome,{ok:false,status:429,retryAfter:30});assert.equal((await g.read()).error??'','');}finally{await g.close();}
 const h=await fixture({get:p=>p==='/api/rtc/ring'?{invites:[],idle:true}:structuredClone(SETTINGS)});
 try{const a=new rtc.LoadRtcRing();await h.act(a);assert.equal(a.outcome.idle,true);assert.equal((await h.read()).rtcRing.idle,true);
  await h.act(new rtc.ApplyRtcRing({invites:[inviteOf(C)],idle:false}));assert.deepEqual(rtc.rtcRingInvites(await h.read()).map(i=>i.sid),[C],'another tab\'s answer applies');}finally{await h.close();}
 assert.equal(rtc.rtcSettingsIdle({...structuredClone(SETTINGS),status:'loaded'}),true,'no endpoint, link or ticket: nothing can ring');
 assert.equal(rtc.rtcSettingsIdle({...structuredClone(SETTINGS),status:'loaded',contacts:[{parent:'p',purposes:[CALL]}]}),false);
 assert.equal(rtc.rtcSettingsIdle({...structuredClone(SETTINGS),status:'loaded',contacts:[{parent:'p',purposes:[SYNC]}]}),true,'a non-alerting purpose cannot ring');
 assert.equal(rtc.rtcSettingsIdle({...structuredClone(SETTINGS),status:'loaded',endpoints:[{endpoint:'e',purposes:[SYNC]}]}),false);
 assert.equal(rtc.rtcSettingsIdle({...structuredClone(SETTINGS),status:'loaded',tickets:[{live:true,purposes:[CALL]}]}),false);
 assert.equal(rtc.rtcSettingsIdle({...structuredClone(SETTINGS),status:'loaded',tickets:[{live:false,purposes:[CALL]}]}),true);
 assert.equal(rtc.rtcSettingsIdle({status:'loading'}),null);
});

// The ring poller (apps/web/src/bl/rtc-ring-poll.mjs) with a fake clock, timers and BroadcastChannel.
const {createRtcRingPoller}=await import('../../apps/web/src/bl/rtc-ring-poll.mjs');
function clock(){
 let t=0,seq=0;const timers=new Map();
 return {now:()=>t,setTimer:(fn,ms)=>{const id=++seq;timers.set(id,{fn,at:t+ms});return id;},clearTimer:id=>timers.delete(id),pending:()=>[...timers.values()].map(x=>x.at-t),
  async advance(ms){const end=t+ms;for(;;){const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;t=next[1].at;timers.delete(next[0]);next[1].fn();await settle();}t=end;await settle();}};
}
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setTimeout(r,0));};
function bus(){const members=new Set();return ()=>{const listeners=new Set(),me={postMessage:data=>{for(const m of members)if(m!==me)for(const l of m.listeners)l({data:structuredClone(data)});},addEventListener:(_,l)=>listeners.add(l),removeEventListener:(_,l)=>listeners.delete(l),close:()=>members.delete(me),listeners};members.add(me);return me;};}

test('F4 poller: backs off exponentially on errors, honours Retry-After, and never overlaps reads',async()=>{
 const c=clock();let runs=0,answer={ok:false},release=null;
 const p=createRtcRingPoller({key:()=>'o:ctx:1',eligible:()=>true,run:()=>{runs++;return release?new Promise(r=>{const go=release;release=null;go(r);}):Promise.resolve(answer);},random:()=>0.5,...c});
 p.poke();await settle();assert.equal(runs,1);assert.deepEqual(c.pending(),[20000],'first failure: interval × 2');
 await c.advance(20000);assert.equal(runs,2);assert.deepEqual(c.pending(),[40000],'second failure: × 4');
 p.poke({force:true});await settle();assert.equal(runs,2,'a forced poke never skips a backoff');
 answer={ok:false,retryAfter:120};await c.advance(40000);assert.equal(runs,3);assert.deepEqual(c.pending(),[120000],'Retry-After wins over a shorter backoff');
 for(let i=0;i<8;i++){answer={ok:false};await c.advance(c.pending()[0]);}assert.ok(c.pending()[0]<=300000,'capped at the maximum');
 answer={ok:true,invites:[]};await c.advance(c.pending()[0]);assert.deepEqual(c.pending(),[10000],'success resets to the interval');assert.equal(p.state.failures,0);
 // In-flight guard: pokes while a read is outstanding start nothing.
 let finish;release=resolve=>{finish=()=>resolve({ok:true,invites:[]});};const before=runs;await c.advance(10000);assert.equal(runs,before+1);
 for(let i=0;i<5;i++)p.poke({force:true});await settle();assert.equal(runs,before+1,'one read at a time');finish();await settle();assert.deepEqual(c.pending(),[10000]);
 p.stop();assert.deepEqual(c.pending(),[]);
});

test('F4 poller: polls only while eligible (ring routes, visible tab) and stops while nothing can ring',async()=>{
 const c=clock();let runs=0,eligible=false,active=false,result={ok:true,invites:[],idle:false};
 const p=createRtcRingPoller({key:()=>'o:ctx:1',eligible:()=>eligible,active:()=>active,run:async()=>{runs++;return result;},random:()=>0.5,...c});
 p.poke();await c.advance(60000);assert.equal(runs,0,'not on a route where the ring renders, or hidden');
 eligible=true;p.poke();await settle();assert.equal(runs,1);eligible=false;await c.advance(30000);assert.equal(runs,1,'a timer that fires after the tab left the ring routes (or was hidden) reads nothing');
 eligible=true;p.poke();await settle();assert.equal(runs,2);eligible=false;p.poke();assert.deepEqual(c.pending(),[],'leaving the ring routes stops the timer');
 eligible=true;result={ok:true,invites:[],idle:true};p.poke();await settle();assert.equal(runs,3);assert.deepEqual(c.pending(),[],'idle: no further polling');
 await c.advance(600000);p.poke();await settle();assert.equal(runs,3,'state changes do not wake an idle poller');
 active=true;result={ok:true,invites:[],idle:false};p.poke();await settle();assert.equal(runs,4,'the settings read shows something that can ring');active=false;
 result={ok:true,invites:[],idle:true};await c.advance(10000);assert.equal(runs,5);p.poke({force:true});await settle();assert.equal(runs,6,'becoming visible re-checks once');
 p.stop();
});

test('F4 poller: one tab per account polls and shares its answer; another takes over when the leader stops; no channel means each polls',async()=>{
 const c=clock(),join=bus(),applied={a:[],b:[]};let runsA=0,runsB=0;
 const make=(name,count)=>createRtcRingPoller({key:()=>'o:ctx:1',eligible:()=>true,run:async()=>{count();return {ok:true,invites:[{sid:name}],idle:false};},apply:d=>applied[name].push(d),channel:join(),random:()=>0.5,...c});
 const a=make('a',()=>runsA++);a.poke();await settle();assert.equal(runsA,0,'a starting tab says hello and waits briefly first');await c.advance(300);
 const b=make('b',()=>runsB++);b.poke();await c.advance(300);
 assert.equal(runsA,1);assert.equal(runsB,0,'b hears the leader\'s answer to its hello and does not read');assert.deepEqual(applied.b[0],{invites:[{sid:'a'}],idle:false});
 await c.advance(60000);assert.ok(runsA>=5,'a keeps polling');assert.equal(runsB,0,'b never polls while a leads');assert.ok(applied.b.length>=5);assert.deepEqual(applied.b.at(-1),{invites:[{sid:'a'}],idle:false});assert.equal(applied.a.length,0);
 a.stop();const at=runsB;await c.advance(30000);assert.ok(runsB>at,'b takes over within two intervals');
 // Another account's announcements are ignored.
 const other=createRtcRingPoller({key:()=>'p:ctx:1',eligible:()=>true,run:async()=>({ok:true,invites:[]}),channel:join(),random:()=>0.5,...c});let runsC=0;
 const d=createRtcRingPoller({key:()=>'p:ctx:1',eligible:()=>true,run:async()=>{runsC++;return {ok:true,invites:[]};},channel:null,random:()=>0.5,...c});
 other.poke();await c.advance(300);d.poke();await settle();assert.equal(runsC,1,'without BroadcastChannel a tab polls on its own, whatever leads on the channel');
 b.stop();other.stop();d.stop();
});

// ——— Service follow-ups (2026-10-27): narrowing an app's approved purposes from the apps panel ———
test('narrowing: the apps form opens the confirmation with the purposes still checked; it sends nothing until confirmed',async()=>{
 const f=await fixture({submissions:{keep:{[`keep:${CALL}`]:'on'},all:{[`keep:${CALL}`]:'on',[`keep:${SYNC}`]:'on'},none:{},foreign:{[`keep:${CALL}`]:'on',[`keep:${SCREEN}`]:'on'}}});
 try{
  await loaded(f);
  await f.act(new rtc.ReviewRtcNarrow({clientId:APP,operationId:'keep'}));let s=await f.read();
  assert.deepEqual(s.modal,{kind:'rtc-confirm',action:'narrow-app',input:{clientId:APP,purposes:[CALL]}});assert.deepEqual(f.calls,[],'nothing is sent before the dialog');assert.deepEqual(f.effects.at(-1),['captureFocus']);
  // A purpose the app does not hold is never added (narrowing only).
  await f.write({modal:null});await f.act(new rtc.ReviewRtcNarrow({clientId:APP,operationId:'foreign'}));assert.deepEqual((await f.read()).modal.input.purposes,[CALL]);
  // Unchanged or empty selections are refused with guidance; an unknown app is unavailable.
  for(const [operationId,error] of [['all',rtc.RTC_NARROW_SAME],['none',rtc.RTC_NARROW_NONE]]){await f.write({modal:null,error:''});await f.act(new rtc.ReviewRtcNarrow({clientId:APP,operationId}));s=await f.read();assert.equal(s.error,error,operationId);assert.equal(s.modal,null);}
  await f.write({modal:null,error:''});await f.act(new rtc.ReviewRtcNarrow({clientId:'https://unknown.example/client',operationId:'keep'}));assert.equal((await f.read()).error,rtc.RTC_UNAVAILABLE);
  assert.deepEqual(f.calls,[]);
  // Confirmed from the dialog: exactly {clientId, purposes} to the narrowing route, then the settings are re-read.
  const input={clientId:APP,purposes:[CALL]};await f.write({modal:{kind:'rtc-confirm',action:'narrow-app',input},error:''});await f.act(new rtc.RtcOwnerAction({action:'narrow-app',input}));s=await f.read();
  assert.deepEqual(f.calls.map(c=>`${c.method} ${c.path}`),['POST /api/rtc/narrow-app','GET /api/rtc/settings','GET /api/rtc/ring']);assert.deepEqual(f.calls[0].body,input);
  assert.equal(s.modal,null);assert.match(s.notice,/narrowed/);assert.equal(rtc.needsConfirmation('narrow-app',input),true);
 }finally{await f.close();}
 // A refusal (another owner's app, or the app already gone) reads as unavailable and keeps the dialog's outcome honest.
 const g=await fixture({request:()=>{throw Object.assign(Error('Not found'),{status:404});}});
 try{await loaded(g);const input={clientId:APP,purposes:[CALL]};await g.write({modal:{kind:'rtc-confirm',action:'narrow-app',input}});await g.act(new rtc.RtcOwnerAction({action:'narrow-app',input}));assert.equal((await g.read()).error,rtc.RTC_UNAVAILABLE);}finally{await g.close();}
});

test('wargame M2/M6: a provider block and bulk call-link revocation run only from their dialog, with their own notices',async()=>{
 const f=await fixture();
 try{
  await loaded(f);
  const cases=[['block',{issuer:'https://far.example'},'Provider blocked. Calls and requests from everyone there are dropped without telling them.'],['revoke-ticket',{clientId:APP},'Call links revoked.'],['revoke-ticket',{clientId:null},'Call links revoked.'],['revoke-ticket',{all:true},'Call links revoked.']];
  for(const [action,input,notice] of cases){
   await f.write({modal:null,error:'',notice:''});await f.act(new rtc.RtcOwnerAction({action,input}));
   assert.equal((await f.read()).error,rtc.RTC_REVIEW,JSON.stringify(input)+' without its dialog');assert.equal(f.calls.length,0);
   // A dialog for one app never confirms another app's (or every) revocation, nor a person's block a provider's.
   const other=action==='block'?{principal:peer}:input.all?{clientId:APP}:{all:true};
   await f.write({modal:{kind:'rtc-confirm',action,input:other},error:''});await f.act(new rtc.RtcOwnerAction({action,input}));assert.equal((await f.read()).error,rtc.RTC_REVIEW);assert.equal(f.calls.length,0);
   await f.write({modal:{kind:'rtc-confirm',action,input},error:''});await f.act(new rtc.RtcOwnerAction({action,input}));const s=await f.read();
   assert.deepEqual(f.calls[0],{method:'POST',path:`/api/rtc/${action}`,body:input});assert.equal(s.notice,notice);assert.equal(s.error,'');assert.deepEqual(f.effects.at(-1),['restoreFocus']);f.calls.length=0;
  }
  // Unblocking a provider and unmuting need no dialog (widening; the route answers the uniform 404 while RTC is off).
  await f.act(new rtc.RtcOwnerAction({action:'unblock',input:{issuer:'https://far.example'}}));assert.equal((await f.read()).notice,'Provider unblocked.');assert.deepEqual(f.effects.at(-1),['focus','#rtc-blocked-title']);f.calls.length=0;
  await f.act(new rtc.RtcOwnerAction({action:'unmute',input:{kind:'origin',value:'https://dialer.example'}}));assert.deepEqual(f.calls[0].body,{kind:'origin',value:'https://dialer.example'});assert.equal((await f.read()).notice,'Unmuted.');
 }finally{await f.close();}
});

test('wargame M6: muting the calling app from the ring needs no dialog and moves focus to the next invite',async()=>{
 const f=await fixture({get:p=>p==='/api/rtc/ring'?{invites:[inviteOf(A),inviteOf(B)]}:structuredClone(SETTINGS)});
 try{
  await f.act(new rtc.LoadRtcRing());f.calls.length=0;
  await f.act(new rtc.RtcOwnerAction({action:'mute',input:{kind:'origin',value:'https://dialer.example'},ring:true,sid:A}));
  assert.deepEqual(f.calls.map(c=>`${c.method} ${c.path}`),['POST /api/rtc/mute','GET /api/rtc/settings','GET /api/rtc/ring']);assert.deepEqual(f.calls[0].body,{kind:'origin',value:'https://dialer.example'});
  const s=await f.read();assert.equal(s.notice,'App muted. Its calls still arrive but no longer ring.');assert.equal(s.error,'');
  assert.deepEqual(f.effects.at(-1),['focus',`[id="rtc-ring-${B}"]`],'focus moves to the next invite');
 }finally{await f.close();}
});
