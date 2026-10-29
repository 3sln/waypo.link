// Sign-in continuation (sign-in and intents spike §2.2 SI-8, owner-approved 2026-10-28; phase P1): one store in the
// tab's sessionStorage, at most one hour old and never extended, resumed by one shared step after every in-browser
// sign-in path (passkey, shared sign-in from another device, sign-up activation, an email link in the same tab) and
// discarded after a recovery. Engine level: the real console Actions over the real store with a fake sessionStorage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,Provider} from '../../apps/web/src/shared/stack.mjs';
import {compilePortalModules} from '../../packages/portal/index.mjs';
import StateProvider from '../../apps/web/src/providers/browser-state.mjs';
import {createContinuation,CONTINUATION_KEY,CONTINUATION_TTL_MS,LEGACY_CONTINUATION_KEYS} from '../../apps/web/src/shared/continuation.mjs';
import {createIntentBrowser,SignInIntent,initialIntentState,intentState,singleton} from '../../apps/web/src/bl/intent-flow.mjs';
import {BrowserState,InitializeSpace,SignIn,SignOut,ConfirmRecovery,ConfirmEmail,StartDeviceLogin,PrepareDeviceQR,PollDeviceLogin,EncryptRecovery,DownloadRecovery,VerifyRecovery,PrepareRecovery} from '../../apps/web/src/bl/release.mjs';

const MINUTE=60000,AUTHORIZE='/oauth/authorize?request_id='+'a'.repeat(43);
function memoryStorage(){const rows=new Map();return {rows,getItem:key=>rows.has(key)?rows.get(key):null,setItem:(key,value)=>{rows.set(key,String(value));},removeItem:key=>{rows.delete(key);}};}

test('store: an intent is kept at most one hour from capture, never extended, taken once, and survives the old 10-minute limit',()=>{
 let now=1_000_000;const storage=memoryStorage(),store=createContinuation({storage,now:()=>now});
 assert.equal(store.saveIntent({value:'v1',placement:'fragment',expiresAt:now+2*CONTINUATION_TTL_MS}),true);
 assert.equal(store.peek().expiresAt,now+CONTINUATION_TTL_MS,'capped at capture + 1 hour');
 now+=30*MINUTE;
 // A `?return_to=/i` arriving with the console keeps the intent and does not extend it.
 store.saveReturn('/i');assert.equal(store.peek().expiresAt,1_000_000+CONTINUATION_TTL_MS);
 const navigations=[];assert.equal(store.resume(target=>navigations.push(target)),true);assert.deepEqual(navigations,['/i']);
 assert.deepEqual(store.takeIntent(),{value:'v1',placement:'fragment',expiresAt:1_000_000+CONTINUATION_TTL_MS});
 assert.equal(store.takeIntent(),null,'taken once');
 store.saveIntent({value:'v2',placement:'query',expiresAt:now+10*MINUTE});now+=10*MINUTE;
 assert.equal(store.peek(),null,'the intent expiry is the record expiry');assert.equal(storage.rows.has(CONTINUATION_KEY),false);
});

test('store: an authorization return target is consumed by resume; malformed, foreign and legacy entries are dropped',()=>{
 let now=5_000;const storage=memoryStorage(),store=createContinuation({storage,now:()=>now});
 for(const bad of ['https://evil.example/','/console','//evil.example','/oauth/authorize?request_id=x',undefined])assert.equal(store.saveReturn(bad),false);
 assert.equal(store.peek(),null);
 store.saveReturn(AUTHORIZE);now+=59*MINUTE;
 const navigations=[];assert.equal(store.resume(target=>navigations.push(target)),true);assert.deepEqual(navigations,[AUTHORIZE]);assert.equal(store.peek(),null);
 storage.setItem(CONTINUATION_KEY,JSON.stringify({v:1,target:'/i',intent:{value:'x',placement:'nowhere'},expiresAt:now+1000}));assert.equal(store.peek(),null);
 storage.setItem(CONTINUATION_KEY,JSON.stringify({v:1,target:'/i',intent:{value:'x',placement:'post'},expiresAt:now+2*CONTINUATION_TTL_MS}));assert.equal(store.peek(),null,'a record claiming more than one hour is refused');
 storage.setItem(CONTINUATION_KEY,'{not json');assert.equal(store.peek(),null);
 for(const key of LEGACY_CONTINUATION_KEYS)storage.setItem(key,'{}');store.discard();assert.equal(storage.rows.size,0,'discard also removes the retired stores');
 const blocked=createContinuation({storage:{getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}}});
 assert.equal(blocked.saveIntent({value:'v',placement:'post',expiresAt:Date.now()+MINUTE}),false);assert.equal(blocked.peek(),null);assert.equal(blocked.resume(()=>assert.fail()),false);
});

test('intent page: Sign in or sign up keeps the intent in the one store and navigates without it in the URL',async t=>{
 let now=10_000;const storage=memoryStorage(),assigned=[];
 const browser=createIntentBrowser({value:'secret-intent',placement:'fragment',now:()=>now,window:{location:{origin:'https://3sln.example',assign:url=>assigned.push(url)},localStorage:{getItem:()=>null},sessionStorage:storage}});
 const engine=new Engine({providers:{state:singleton(intentState(initialIntentState())),api:singleton({}),browser:singleton(browser)}});t.after(()=>engine.dispose());
 await engine.dispatch(new SignInIntent()).next('complete');
 assert.deepEqual(assigned,['/console?signin=1&return_to=%2Fi']);assert.equal(assigned[0].includes('secret-intent'),false);
 const kept=JSON.parse(storage.getItem(CONTINUATION_KEY));assert.deepEqual(kept,{v:1,target:'/i',intent:{value:'secret-intent',placement:'fragment'},expiresAt:now+CONTINUATION_TTL_MS});
});

function consoleFixture({route={kind:'home',auth:'login'},confirm={account:{id:'u1',handle:'river'},csrfToken:'csrf',sessionContext:'s1'}}={}){
 let now=Date.now();const storage=memoryStorage(),store=createContinuation({storage,now:()=>now}),navigations=[],calls=[],secrets={pending:'pending-secret',token:'email-token'};
 const payload={version:1,issuer:'https://account.example',handle:'river',recoveryToken:'00000000-0000-0000-0000-000000000000.'+'a'.repeat(43)};
 const session={account:{id:'u1',handle:'river'},csrfToken:'csrf',sessionContext:'s1'};
 const api={csrf:null,async get(path){if(path==='/api/config')return {origin:'https://account.example',brand:{name:'Personal Space',host:'account.example'}};if(path==='/api/session')return {authenticated:false};if(path==='/api/account')return {account:{id:'u1',handle:'river'},messages:[],collections:[],contacts:[],resources:[],rules:[]};return {};},
  async request(path,body){calls.push({path,body});if(path==='/api/auth/login/passkey/begin')return {challengeToken:'pl1.token',authenticationOptions:{challenge:'c'}};if(path==='/api/auth/login/passkey/finish')return session;if(path.endsWith('/recovery/download'))return {fileName:'recovery.json',content:JSON.stringify(payload),recoveryToken:payload.recoveryToken};if(path.endsWith('/recovery/confirm'))return confirm;if(path==='/api/auth/email/login/confirm')return session;if(path.endsWith('/device/start'))return {deviceCode:'private-device-code',requestId:'550e8400-e29b-41d4-a716-446655440011',userCode:'23456789',verificationUriComplete:'https://account.example/device#request=550e8400-e29b-41d4-a716-446655440011',expiresAt:Date.now()+300000,interval:5};if(path.endsWith('/qr'))return {svg:'<svg/>'};if(path.endsWith('/device/poll'))return {status:'authorized',...session};return {};}};
 let generation=0,active=false,attempted=false,controller;
 const browser={preferences:()=>({}),language:()=>'en',applyLocale(){},savePreferences(){},inputFocused:()=>false,onFocus:()=>()=>{},route:()=>route,online:()=>true,restorePending:()=>null,pushPermission:()=>'unsupported',installCaptcha(){},applyBrand(){},setCaptchaAction(){},installWorker(){},onNetwork:()=>()=>{},now:()=>Date.now(),delay:(cb,ms)=>{const id=setTimeout(cb,ms);return()=>clearTimeout(id);},id:()=>'question-id',navigate:target=>navigations.push(target),clearRecoveryChallenge(){},captureFocus(){},modalFocus(){},restoreFocus(){},focus(){},secret:key=>secrets[key],storeSecret:(key,value)=>{secrets[key]=value;},savePending:token=>{secrets.pending=token;},clearPending:()=>{secrets.pending=null;secrets.recovery=null;},download(){},captcha:()=>({turnstileToken:'t'}),resetCaptcha(){},authenticatePasskey:async()=>({id:'cred'}),
  resumeContinuation:()=>store.resume(target=>navigations.push(target)),discardContinuation:()=>store.discard(),
  beginDeviceEntry:()=>{generation++;active=true;attempted=false;controller=new AbortController();return generation;},deviceGeneration:()=>generation,cancelDeviceEntry:()=>{generation++;active=false;controller?.abort();secrets.deviceCode=null;},deviceEntryLive:g=>active&&g===generation,deviceEntrySignal:g=>active&&g===generation?controller.signal:null,takeDeviceProof:g=>{if(!active||attempted||g!==generation)return null;attempted=true;return {token:'proof',signal:controller.signal};}};
 const registry=compilePortalModules([]);
 const engine=new Engine({providers:{portalContributions:Provider.fromSingleton(registry),state:StateProvider,api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),recoveryFile:Provider.fromSingleton({encrypt:async(p,q)=>({format:'3sln-recovery',questions:q,ciphertext:'opaque'}),decrypt:async()=>payload})}});
 const query=engine.query(new BrowserState());const sub=query.subscribe({next(){}});
 return {engine,store,storage,navigations,calls,query,advance:ms=>{now+=ms;},act:action=>engine.dispatch(action).next('complete'),close:async()=>{sub.unsubscribe();await engine.dispose();}};
}
async function keepIntentFor(f,ms){f.store.saveIntent({value:'kept-intent',placement:'post',expiresAt:Date.now()+CONTINUATION_TTL_MS});f.advance(ms);}
async function activate(f){await f.act(new PrepareRecovery());await f.act(new EncryptRecovery({values:{'answer:question-id':'private answer'}}));await f.act(new DownloadRecovery());await f.act(new VerifyRecovery({values:{'verify:question-id':'private answer'}}));await f.act(new ConfirmRecovery({values:{confirmed:'on'}}));}

const PATHS={
 'passkey sign-in':{route:{kind:'home',auth:'login'},run:async f=>{await f.act(new InitializeSpace());await f.act(new SignIn({values:{handle:'river'}}));}},
 'shared sign-in from another device':{route:{kind:'home',auth:'login'},run:async f=>{await f.act(new InitializeSpace());await f.act(new StartDeviceLogin());const generation=(await f.query.peek()).deviceGeneration;await f.act(new PrepareDeviceQR({generation}));await f.act(new PollDeviceLogin());}},
 'same-tab sign-up activation':{route:{kind:'recovery-setup'},run:async f=>{await f.act(new InitializeSpace());await activate(f);}},
 'email link in the same tab':{route:{kind:'email',emailLogin:true},run:async f=>{await f.act(new InitializeSpace());await f.act(new ConfirmEmail({}));}},
};
for(const [name,path] of Object.entries(PATHS))test(`console: ${name} resumes the kept intent 30 minutes later through the shared step`,async()=>{
 const f=consoleFixture({route:path.route});try{
  await keepIntentFor(f,30*MINUTE);await path.run(f);
  assert.deepEqual(f.navigations.filter(target=>target!=='/console'),['/i'],`${name}: resumed to the intent page`);
  assert.equal(f.store.peek()?.intent?.value,'kept-intent','the intent page takes the value');
 }finally{await f.close();}
});

test('console: completing a recovery discards a kept intent and opens the console',async()=>{
 const f=consoleFixture({route:{kind:'recovery-setup'},confirm:{account:{id:'u1',handle:'river'},csrfToken:'csrf',sessionContext:'s1',recovered:true}});try{
  await keepIntentFor(f,MINUTE);await f.act(new InitializeSpace());await activate(f);
  assert.deepEqual(f.navigations,['/console']);assert.equal(f.store.peek(),null);assert.equal(f.storage.rows.has(CONTINUATION_KEY),false);
 }finally{await f.close();}
});

test('console: an intent kept more than an hour ago is not resumed; sign-in still completes',async()=>{
 const f=consoleFixture();try{
  await keepIntentFor(f,CONTINUATION_TTL_MS+MINUTE);await f.act(new InitializeSpace());await f.act(new SignIn({values:{handle:'river'}}));
  assert.deepEqual(f.navigations,[]);assert.equal((await f.query.peek()).session.account.handle,'river');
 }finally{await f.close();}
});

test('console: an app authorization entry resumes after sign-in and is consumed',async()=>{
 const f=consoleFixture();try{
  f.store.saveReturn(AUTHORIZE);f.advance(20*MINUTE);await f.act(new InitializeSpace());await f.act(new SignIn({values:{handle:'river'}}));
  assert.deepEqual(f.navigations,[AUTHORIZE]);assert.equal(f.store.peek(),null);
 }finally{await f.close();}
});

test('console: signing out discards a kept intent so the next person who signs in here does not land on it (review 2026-10-29 L3)',async()=>{
 const f=consoleFixture();try{
  await f.act(new InitializeSpace());await f.act(new SignIn({values:{handle:'river'}}));
  await keepIntentFor(f,MINUTE);assert.equal(f.store.peek()?.target,'/i');
  await f.act(new SignOut({}));
  assert.ok(f.calls.some(call=>call.path==='/api/auth/logout'));assert.equal(f.store.peek(),null);assert.equal(f.storage.rows.has(CONTINUATION_KEY),false);
  await f.act(new SignIn({values:{handle:'river'}}));assert.deepEqual(f.navigations,[],'nothing is resumed for the next sign-in');
 }finally{await f.close();}
});
