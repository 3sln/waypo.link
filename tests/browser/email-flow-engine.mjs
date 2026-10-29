// "Continue with email" at engine level, client and server together (sign-in and intents spike §4.3, §4.5, §4.6, §3.4;
// P3). The real console Actions (bl/email-flow.mjs), the real original-tab resource (providers/email-flow.mjs) and the
// real helper-page Actions (bl/email-link.mjs) run against the real identity engine through a thin in-process router; the
// browser pieces (sessionStorage, BroadcastChannel, navigation) are fakes. Covers the intent kept by the original tab
// through an email sign-in (SI-8, §4.6), a spoofed wake-up, a reload, the code path, sign-up to the recovery step, the
// closed-tab fallback dropping the intent, and that S never enters the UI projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,Provider} from '../../apps/web/src/shared/stack.mjs';
import {compilePortalModules} from '../../packages/portal/index.mjs';
import StateProvider from '../../apps/web/src/providers/browser-state.mjs';
import {createContinuation,CONTINUATION_KEY,CONTINUATION_TTL_MS} from '../../apps/web/src/shared/continuation.mjs';
import {BrowserState,InitializeSpace} from '../../apps/web/src/bl/release.mjs';
import {EmailFlowSchedule,StartEmailFlow,PollEmailFlow,SubmitEmailFlowCode,ConfirmEmailSignup,RestoreEmailFlow,CancelEmailFlow,EMAIL_FLOW_POLL,EMAIL_FLOW_RESTORE,EMAIL_FLOW_ABANDON} from '../../apps/web/src/bl/email-flow.mjs';
import {createEmailFlowResource} from '../../apps/web/src/providers/email-flow.mjs';
import {linkState,initialLinkState,createLinkResource,InitializeLink,ConfirmLink,CompleteHere,LINK_UPDATED} from '../../apps/web/src/bl/email-link.mjs';
import {EMAIL_FLOW_CHANNEL,EMAIL_FLOW_STORE,wakeMessage} from '../../apps/web/src/shared/email-flow.mjs';
import {identityEngine,activate,config,context,memoryShards} from '../helpers/identity-engine.mjs';

const B_R='R'.repeat(43),B_PHONE='P'.repeat(43);
const ROUTES={'/api/auth/email/flow/start':'emailFlowStart','/api/auth/email/flow/status':'emailFlowStatus','/api/auth/email/flow/redeem':'emailFlowRedeem','/api/auth/email/flow/cancel':'emailFlowCancel','/api/auth/email/flow/resend':'emailFlowResend','/api/auth/email/link/inspect':'emailLinkInspect','/api/auth/email/link/approve':'emailLinkApprove','/api/auth/email/link/reveal':'emailLinkReveal','/api/auth/email/link/cancel':'emailLinkCancel','/api/auth/email/link/status':'emailLinkStatus','/api/auth/email/link/complete-here':'emailLinkCompleteHere','/api/auth/email/signup':'emailSignupConfirm','/api/auth/recovery/download':'downloadRecovery'};
function memoryStorage(){const rows=new Map();return {rows,getItem:key=>rows.has(key)?rows.get(key):null,setItem:(key,value)=>{rows.set(key,String(value));},removeItem:key=>{rows.delete(key);}};}
/** One BroadcastChannel bus per browser profile. */
function channelBus(){const members=new Set();return class FakeChannel{constructor(name){this.name=name;members.add(this);}postMessage(data){for(const other of members)if(other!==this&&other.name===this.name)queueMicrotask(()=>other.onmessage?.({data:structuredClone(data)}));}close(){members.delete(this);}};}
function server(){
 const mail=[],flags={for:()=>({enabled:name=>['EMAIL_FLOW_V2','EMAIL_SIGNUP_ENABLED'].includes(name)})};
 // Real time on both sides: the console compares the server's expiry times with its own clock.
 // The sharded repository allocates `n.` handles, as the Node and Worker repositories do.
 const h=identityEngine({repository:memoryShards().repository(()=>Date.now()),clock:{now:()=>Date.now(),advance(){}},flags,linkedPollLimits:{consume:async()=>true},mailer:{sendEmailFlow:async value=>{mail.push(value);},sendSecurityAlert:async()=>{},sendVerification:async()=>{},sendSetupCode:async()=>{}}});
 const call=async(path,body,ctx)=>{try{return await h.act(ROUTES[path],body,{...context,...ctx});}catch(error){throw Object.assign(new Error(error.message),{code:error.code,status:error.status??400,remaining:error.remaining});}};
 return {...h,mail,call};
}
function consoleTab(srv,{storage=memoryStorage(),Channel=channelBus(),browserMarker=B_R}={}){
 const navigations=[],calls=[],session={current:null},continuation=createContinuation({storage});
 const api={csrf:null,setContext(result){this.csrf=result.csrfToken;},
  async get(path){if(path==='/api/config')return {origin:config.origin,termsVersion:config.termsVersion,emailFlowEnabled:true,emailSignupEnabled:true,emailEnabled:true,ageRequirement:{minimumAge:18}};if(path==='/api/session')return session.current?{authenticated:true,...session.current}:{authenticated:false};if(path==='/api/account')return {account:session.current?.account,messages:[],collections:[],resources:[],rules:[]};return {};},
  async request(path,body){calls.push(path);const result=await srv.call(path,body,{emailBrowser:browserMarker,signupOpen:true});if(result?.sessionToken)session.current={account:result.account,csrfToken:result.csrfToken,sessionContext:result.sessionContext};return result;}};
 const secrets={};
 const browser={preferences:()=>({}),language:()=>'en',applyLocale(){},savePreferences(){},inputFocused:()=>false,onFocus:()=>()=>{},route:()=>({kind:'home',auth:'login'}),online:()=>true,restorePending:()=>null,pushPermission:()=>'unsupported',installCaptcha(){},applyBrand(){},setCaptchaAction(){},onNetwork:()=>()=>{},now:()=>Date.now(),delay:(cb,ms)=>{const id=setTimeout(cb,Math.min(ms,20));return()=>clearTimeout(id);},id:()=>'question-id',navigate:target=>navigations.push(target),captureFocus(){},restoreFocus(){},secret:key=>secrets[key],storeSecret:(key,value)=>{secrets[key]=value;},savePending:token=>{secrets.pending=token;},clearPending:()=>{secrets.pending=null;},captcha:()=>({turnstileToken:'verified'}),
  resumeContinuation:()=>continuation.resume(target=>navigations.push(target)),discardContinuation:()=>continuation.discard()};
 const emailFlow=createEmailFlowResource({storage,Channel});
 const engine=new Engine({providers:{portalContributions:Provider.fromSingleton(compilePortalModules([])),state:StateProvider,api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),recoveryFile:Provider.fromSingleton({}),emailFlow:Provider.fromSingleton(emailFlow)}});
 let polls=0;engine.feed.addEventListener(EMAIL_FLOW_POLL,()=>{polls++;engine.dispatch(new PollEmailFlow());});engine.feed.addEventListener(EMAIL_FLOW_RESTORE,()=>engine.dispatch(new RestoreEmailFlow()));engine.feed.addEventListener(EMAIL_FLOW_ABANDON,()=>engine.dispatch(new CancelEmailFlow({quiet:true})));
 const subs=[engine.query(new BrowserState()).subscribe({next(){}}),engine.query(new EmailFlowSchedule()).subscribe({next(){}})];
 const read=()=>engine.container.use(['state'],({state})=>state.snapshot());
 const until=async(predicate,label='condition')=>{for(let i=0;i<300;i++){const s=await read();if(predicate(s))return s;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail(`timed out waiting for ${label}: ${JSON.stringify((await read()).emailFlow)} ${(await read()).error}`);};
 return {engine,storage,Channel,navigations,calls,continuation,session,emailFlow,read,until,polls:()=>polls,act:action=>engine.dispatch(action).next('complete'),close:async()=>{for(const sub of subs)sub.unsubscribe();await engine.dispose();}};
}
function helperPage(srv,{token,browserMarker,Channel,storage=memoryStorage()}){
 const navigations=[];
 const fetch=async(path,init)=>{try{const value=await srv.call(path,JSON.parse(init.body),{emailBrowser:browserMarker});return {ok:true,status:200,json:async()=>value};}catch(error){return {ok:false,status:error.status,json:async()=>({error:error.code,message:error.message})};}};
 const link=createLinkResource({token,fetch,Channel,storage,win:{close(){navigations.push('close');}},location:{assign:target=>navigations.push(target)},setTimer:(cb,ms)=>setTimeout(cb,Math.min(ms,50))});
 const state=linkState(initialLinkState({}));
 const engine=new Engine({providers:{state:Provider.fromSingleton(state),link:Provider.fromSingleton(link)}});
 return {engine,state,navigations,storage,act:action=>engine.dispatch(action).next('complete')};
}
async function signInEmailAccount(srv,address){
 const active=await activate(srv.act,{handle:'alice',method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:config.termsVersion,turnstileToken:'verified'});
 const record=await srv.repository.get(active.owner.account.id),now=srv.clock.now();
 record.emails=[{address,state:'sign-in',verifiedAt:now-864e6,signInSince:now-864e6,notices:true,source:'linked',addedBy:{session:'passkey',at:now-864e6}}];
 await srv.repository.compareAndSwap(record.id,record.revision,{...record,revision:record.revision+1});return active;
}
const latestToken=srv=>srv.service.settleBackground().then(()=>srv.mail.filter(item=>item.token).at(-1)?.token);

test('same browser: the intent kept by the original tab survives an email sign-in and resumes there (SI-8, §4.6); S never enters the projection',async t=>{
 const srv=server(),alice=await signInEmailAccount(srv,'alice@mail.example');
 const R=consoleTab(srv);t.after(()=>R.close());
 R.continuation.saveIntent({value:'kept-intent',placement:'fragment',expiresAt:Date.now()+CONTINUATION_TTL_MS});
 await R.act(new InitializeSpace());
 await R.act(new StartEmailFlow({values:{email:'alice@mail.example'}}));
 const waiting=await R.until(s=>s.emailFlow?.stage==='waiting','waiting');assert.equal(waiting.emailFlow.email,'a•••@mail.example');
 const stored=JSON.parse(R.storage.getItem(EMAIL_FLOW_STORE));assert.match(stored.secret,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(JSON.stringify(await R.read()).includes(stored.secret),false,'S is never in the UI state');
 // The helper in the same profile approves; its wake-up makes R poll at once and redeem.
 const H=helperPage(srv,{token:await latestToken(srv),browserMarker:B_R,Channel:R.Channel});
 await H.act(new InitializeLink());assert.equal(H.state.snapshot().phase,'review');assert.equal(H.state.snapshot().view.sameBrowser,true);
 await H.act(new ConfirmLink());assert.equal(H.state.snapshot().phase,'done','the original tab acknowledged');assert.deepEqual(H.navigations,['close']);
 await R.until(s=>s.session?.account?.id===alice.owner.account.id,'signed in');
 assert.deepEqual(R.navigations,['/i'],'the kept intent resumes on the original tab');
 assert.equal(R.continuation.peek()?.intent?.value,'kept-intent','the intent page takes it from here');
 assert.equal(R.storage.getItem(EMAIL_FLOW_STORE),null,'the flow is forgotten');
});

test('spoofed BroadcastChannel messages wake nothing; a reload keeps the flow; another device\'s code finishes it on the original tab',async t=>{
 const srv=server(),alice=await signInEmailAccount(srv,'alice@mail.example');
 const storage=memoryStorage(),Channel=channelBus(),R=consoleTab(srv,{storage,Channel});t.after(()=>R.close());
 await R.act(new InitializeSpace());await R.act(new StartEmailFlow({values:{email:'alice@mail.example'}}));await R.until(s=>s.emailFlow?.stage==='waiting');
 const stored=JSON.parse(storage.getItem(EMAIL_FLOW_STORE)),attacker=new Channel(EMAIL_FLOW_CHANNEL);
 const before=R.polls();
 for(const forged of [wakeMessage({flowId:stored.flowId,channelTag:'x'.repeat(43)}),wakeMessage({flowId:'A'.repeat(22),channelTag:stored.channelTag}),{v:1,type:'redeemed',flowId:stored.flowId,tag:stored.channelTag}])attacker.postMessage(forged);
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(R.polls(),before,'forged wake-ups cause no poll');
 // Reload: a new console in the same tab storage restores the waiting flow.
 await R.close();const R2=consoleTab(srv,{storage,Channel});t.after(()=>R2.close());await R2.act(new InitializeSpace());
 await R2.until(s=>s.emailFlow?.stage==='waiting','restored');
 const H=helperPage(srv,{token:await latestToken(srv),browserMarker:B_PHONE,Channel:channelBus()});
 await H.act(new InitializeLink());assert.equal(H.state.snapshot().view.sameBrowser,false);
 await H.act(new ConfirmLink());assert.equal(H.state.snapshot().phase,'code');const code=H.state.snapshot().code;
 await R2.until(s=>s.emailFlow?.codeRequested===true,'code requested');
 await R2.act(new SubmitEmailFlowCode({values:{code:'12'}}));assert.match((await R2.read()).emailFlow.codeError,/6-digit/);
 await R2.act(new SubmitEmailFlowCode({values:{code:code==='000000'?'000001':'000000'}}));const wrong=(await R2.read()).emailFlow;assert.match(wrong.codeError,/does not match/);assert.equal(wrong.remaining,4);
 await R2.act(new SubmitEmailFlowCode({values:{code:`${code.slice(0,3)} ${code.slice(3)}`}}));
 await R2.until(s=>s.session?.account?.id===alice.owner.account.id,'signed in by code');
 const account=await srv.repository.get((await R2.read()).session.account.id);assert.equal(account.sessions.at(-1).source,'email-cross-device');
});

test('sign-up: the create-account link ends on the original tab in the terms and age step, then the recovery file',async t=>{
 const srv=server(),R=consoleTab(srv);t.after(()=>R.close());
 await R.act(new InitializeSpace());await R.act(new StartEmailFlow({values:{email:'new@mail.example'}}));await R.until(s=>s.emailFlow?.stage==='waiting');
 const H=helperPage(srv,{token:await latestToken(srv),browserMarker:B_R,Channel:R.Channel});
 await H.act(new InitializeLink());assert.equal(H.state.snapshot().view.purpose,'sign-up');await H.act(new ConfirmLink());
 await R.until(s=>s.emailFlow?.stage==='signup'&&!s.busy,'signup stage');
 await R.act(new ConfirmEmailSignup({values:{ageConfirmed:'18'}}));assert.match((await R.read()).error,/terms/);
 await R.act(new ConfirmEmailSignup({values:{ageConfirmed:'18',termsAccepted:'on'}}));
 const s=await R.read();assert.equal(s.pending,true,JSON.stringify(s.error));assert.equal(s.pendingStage,'recovery');assert.deepEqual(R.navigations,['/recovery/setup']);
});

test('closed original tab: no acknowledgement within 2 s, the helper offers "sign in here"; the intent is dropped and nothing in the helper tab resumes',async()=>{
 const srv=server();await signInEmailAccount(srv,'alice@mail.example');
 const R=consoleTab(srv);await R.act(new InitializeSpace());await R.act(new StartEmailFlow({values:{email:'alice@mail.example'}}));await R.until(s=>s.emailFlow?.stage==='waiting');
 const token=await latestToken(srv);await R.close();// the original tab is gone
 const helperStorage=memoryStorage();helperStorage.setItem(CONTINUATION_KEY,JSON.stringify({v:1,target:'/i',intent:{value:'copied',placement:'post'},expiresAt:Date.now()+60000}));
 const H=helperPage(srv,{token,browserMarker:B_R,Channel:channelBus(),storage:helperStorage});
 await H.act(new InitializeLink());await H.act(new ConfirmLink());assert.equal(H.state.snapshot().phase,'closed-tab');
 await H.act(new CompleteHere());assert.equal(H.state.snapshot().phase,'signed-in');assert.deepEqual(H.navigations,['/console']);
 assert.equal(helperStorage.getItem(CONTINUATION_KEY),null,'any continuation in the helper tab is dropped');
});

test('signing in another way while waiting cancels the flow on the server',async t=>{
 const srv=server();await signInEmailAccount(srv,'alice@mail.example');
 const R=consoleTab(srv);t.after(()=>R.close());await R.act(new InitializeSpace());await R.act(new StartEmailFlow({values:{email:'alice@mail.example'}}));await R.until(s=>s.emailFlow?.stage==='waiting');
 const {flowId}=JSON.parse(R.storage.getItem(EMAIL_FLOW_STORE));
 await R.engine.container.use({state:{write:true}},({state})=>state.transition(next=>Object.assign(next,{session:{account:{id:'other',handle:'other'},sessionContext:'s-other'}})));
 R.engine.feed.dispatchEvent(new Event('browser-state-updated'));
 await R.until(s=>s.emailFlow===null,'abandoned');
 const record=await srv.engine.container.use(['identity'],({identity})=>identity.emailFlows.get(flowId));
 for(let i=0;i<50&&record.state!=='cancelled';i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal((await srv.engine.container.use(['identity'],({identity})=>identity.emailFlows.get(flowId))).state,'cancelled');
});
void LINK_UPDATED;
