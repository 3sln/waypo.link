import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {within} from '../helpers/async.mjs';
import {Window} from 'happy-dom';
// The account profile (Account & security): display name and avatar only, against GET/PUT /api/profile, plus device
// naming, driven through the real engine. Per-link sharing, the disclosure switch and the bio were removed with contact
// links (contacts phase 4); saved contacts and conversations left the core with messaging (2026-10-27). The last tests
// pin that none of them remain.
const window=new Window({url:'https://space.example/'}),names=['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'];
const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));for(const name of names)globalThis[name]=window[name];
const {dodo,Engine,Provider}=await import('../../apps/web/src/shared/stack.mjs');
const {forEachSeed}=await import('../helpers/chaos.mjs');
const {default:StateProvider}=await import('../../apps/web/src/providers/browser-state.mjs');
const {default:localize}=await import('../../apps/web/src/ui/localize.mjs');
const {createLocalization}=await import('../../packages/i18n/index.mjs');
const profileModule=await import('../../apps/web/src/bl/contact-profile.mjs');
const {RenameDevice}=await import('../../apps/web/src/bl/devices.mjs');
const {LoadContactProfile,SaveProfile}=profileModule;
const profileView=await import('../../apps/web/src/ui/contact-profile.mjs'),{contactProfilePanel}=profileView;
const {default:securityView}=await import('../../apps/web/src/ui/release-security.mjs');
const {builtInModules}=await import('../../apps/web/src/shared/portal-modules.mjs');
// Finish imports before registering tests: a late top-level await can let the
// file's after hook restore Event before the final test is even registered.
const {NetworkChanged,SignOut}=await import('../../apps/web/src/bl/release.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const render=(node,locale='en')=>{const root=document.createElement('main');dodo.reconcile(root,[localize(node,createLocalization({locale}))]);return root;};
const buttons=(root,text)=>[...root.querySelectorAll('button')].filter(button=>button.textContent.trim()===text);
const jti='a1b2c3d4-0000-4000-8000-000000000001';
// A pre-phase-4 contact parent that a stale account snapshot might still carry; nothing renders or sends it.
const parent=(patch={})=>({id:jti,type:'https://spec.bindle.example/links/contact/v1',slot:'messaging-ingress',active:true,createdAt:Date.UTC(2026,9,1),expiresAt:Date.UTC(2027,9,1),conditional:false,issuer:{kind:'app',clientId:'https://parlay.example/client'},profileFields:[],discloseProfile:false,...patch});
async function fixture({api={},submissions={},contacts=[parent()]}={}){
 const calls=[];
 const client={async get(path){calls.push({method:'GET',path});if(api.get)return api.get(path);return {};},async request(path,body,method='POST'){calls.push({method,path,body});if(api.request)return api.request(path,body,method);return {};}};
 const browser={consumeSubmission:id=>submissions[id],secret:()=>null,storeSecret(){},copy:async()=>{},setCaptchaAction(){},installCaptcha(){},restoreFocus(){}};
 const engine=new Engine({providers:{state:StateProvider,api:Provider.fromSingleton(client),browser:Provider.fromSingleton(browser),portalContributions:Provider.fromSingleton({}),recoveryFile:Provider.fromSingleton({})}});
 const write=patch=>engine.container.use({state:{write:true}},({state})=>state.transition(next=>Object.assign(next,patch))),read=()=>engine.container.use(['state'],({state})=>state.snapshot());
 await write({loading:false,locale:'en',view:'security',route:{kind:'home'},config:{},brand:{host:'space.example'},session:{account:{id:'owner',handle:'ray'},sessionContext:'ctx'},data:{contacts,collections:[],devices:[]}});
 return {engine,calls,write,read,act:(action,what=action.constructor.name)=>within(engine.dispatch(action).next('complete'),what),close:()=>engine.dispose()};
}

test('the profile loads only GET /api/profile and saving sends only displayName, avatar and the expected revision',async()=>{
 const saved={displayName:'Ray',avatar:'https://images.example/ray.png',revision:'r2'};
 // Stale form or service members (bio, the disclosure switch, sharing fields) never reach the request body.
 const f=await fixture({submissions:{profile:{displayName:'Ray',bio:'Builds things',avatar:'https://images.example/ray.png',discloseToContacts:'on','profile:bio':'on'}},api:{get:async()=>({displayName:'',bio:'old',avatar:'',discloseToContacts:false,revision:'r1'}),request:async()=>saved}});
 try{
  // Bug hunt F1: a save is refused until the stored profile has loaded (it would otherwise overwrite it with blanks).
  await f.act(new SaveProfile({operationId:'profile'}));assert.deepEqual(f.calls,[]);assert.match((await f.read()).error,/still loading/);
  await f.write({error:''});await f.act(new LoadContactProfile());assert.deepEqual(f.calls,[{method:'GET',path:'/api/profile'}]);
  let state=await f.read();assert.equal(state.contactProfile.status,'loaded');assert.deepEqual(state.contactProfile.profile,{displayName:'',avatar:'',revision:'r1'},'only profile members are kept');
  await f.act(new SaveProfile({operationId:'profile'}));
  const put=f.calls.at(-1);assert.deepEqual(put,{method:'PUT',path:'/api/profile',body:{displayName:'Ray',avatar:'https://images.example/ray.png',expectedRevision:'r1'}});assert.deepEqual(Object.keys(put.body),['displayName','avatar','expectedRevision']);
  state=await f.read();assert.deepEqual(state.contactProfile.profile,saved);assert.equal(state.notice,'Profile saved.');assert.equal(state.busy,false);
  const root=render(contactProfilePanel(state));assert.equal(root.querySelector('input[name=displayName]').value,'Ray');assert.equal(root.querySelector('input[name=avatar]').value,'https://images.example/ray.png');
  assert.deepEqual([...root.querySelectorAll('input')].map(input=>input.name),['displayName','avatar']);
  assert.equal(f.calls.some(call=>/\/api\/(contacts|links)/.test(call.path)),false,'no contact, sharing or link call');
 }finally{await f.close();}
 // Without a stored revision the body is exactly the two fields; missing form fields are sent as empty strings.
 const g=await fixture({submissions:{profile:{}},api:{request:async()=>({displayName:'',avatar:'',revision:'r1'})}});
 try{await g.write({contactProfile:{profile:{},status:'loaded'}});await g.act(new SaveProfile({operationId:'profile'}));assert.deepEqual(g.calls.at(-1).body,{displayName:'',avatar:''});}finally{await g.close();}
});

test('a stale profile save reloads the latest version instead of claiming success',async()=>{
 let latest={displayName:'Other session',avatar:'',revision:'r9'};
 const f=await fixture({submissions:{profile:{displayName:'Mine',avatar:''}},api:{get:async()=>latest,request:async()=>{throw Object.assign(new Error('stale'),{code:'profile_stale',status:409});}}});
 try{await f.write({contactProfile:{profile:{displayName:'',revision:'r1'},status:'loaded'}});await f.act(new SaveProfile({operationId:'profile'}));const state=await f.read();assert.match(state.error,/changed in another session/);assert.deepEqual(state.contactProfile.profile,latest);assert.equal(state.contactProfile.epoch,1);assert.notEqual(state.notice,'Profile saved.');}finally{await f.close();}
 // A refused body (profile_invalid) is reported, not reloaded or claimed as saved.
 const g=await fixture({submissions:{profile:{displayName:'x'.repeat(81),avatar:''}},api:{request:async()=>{throw Object.assign(new Error('Use a display name of up to 80 characters.'),{code:'profile_invalid',status:400});}}});
 try{await g.write({contactProfile:{profile:{revision:'r1'},status:'loaded'}});await g.act(new SaveProfile({operationId:'profile'}));const state=await g.read();assert.match(state.error,/up to 80 characters/);assert.equal(g.calls.filter(call=>call.method==='GET').length,0);assert.notEqual(state.notice,'Profile saved.');}finally{await g.close();}
});

test('the profile panel lives in Account & security with display name and avatar only; no sharing editor or disclosure switch',()=>{
 const contacts=[parent({profileFields:['bio']}),parent({id:'c1b2c3d4-0000-4000-8000-000000000003',conditional:true})];
 const state={locale:'en',session:{account:{id:'owner',handle:'ray'}},config:{},brand:{host:'space.example'},data:{contacts,account:{id:'owner',handle:'ray'}},contactProfile:{status:'loaded',profile:{displayName:'Ray',avatar:'',bio:'stale',discloseToContacts:true}}};
 const root=render(securityView(state));const panel=root.querySelector('.contact-profile-settings');assert.ok(panel);
 assert.deepEqual([...panel.querySelectorAll('input')].map(input=>input.name),['displayName','avatar']);assert.equal(panel.querySelector('input[type=checkbox]'),null);
 assert.equal(panel.querySelector('.link-sharing,.link-sharing-row'),null);assert.equal(buttons(panel,'Choose shared fields').length,0);assert.equal(buttons(panel,'Save profile').length,1);
 assert.doesNotMatch(root.textContent,/contact link|Shares:|About you|stale|Saved contacts|New contact link|Create a contact link|Quarantine|Rotate challenge/i);
 // The sharing editor's module surface is gone.
 for(const gone of ['UpdateContactSharing','sharingLinks','PROFILE_WITHDRAWN_STALE'])assert.equal(gone in profileModule,false,gone);assert.equal('contactSharingDialog' in profileView,false);
 assert.deepEqual(profileModule.PROFILE_FIELDS,['displayName','avatar']);
});

test('seeded snapshots: the panel and save body ignore contact parents and stale profile members',async()=>{
 await forEachSeed(40,async random=>{
  const contacts=Array.from({length:random.int(4)},(_,index)=>parent({id:`${index}0000000-0000-4000-8000-00000000000${index}`,profileFields:['displayName','bio','avatar'].slice(0,random.int(3))}));
  const profile={displayName:random.pick(['','Ray','<b>x</b>','\u202eevil']),avatar:random.pick(['','https://images.example/a.png']),...random.chance(.5)?{bio:'BIO_SECRET'}:{},...random.chance(.5)?{discloseToContacts:true}:{},...random.chance(.5)?{revision:'r'+random.int(9)}:{}};
  const state={locale:random.pick(['en','es']),session:{account:{id:'owner'}},config:{},data:{contacts},contactProfile:{status:random.pick(['loading','loaded','error']),profile}};
  const root=render(contactProfilePanel(state),state.locale);assert.deepEqual([...root.querySelectorAll('input')].map(input=>input.name),['displayName','avatar']);
  assert.equal(root.querySelector('b'),null);assert.equal(root.textContent.includes('BIO_SECRET'),false);assert.equal(root.querySelector('.link-sharing-row'),null);
  const f=await fixture({contacts,submissions:{s:{displayName:'N',avatar:'',bio:'BIO_SECRET',discloseToContacts:'on'}},api:{request:async(path,body)=>({...body,revision:'next'})}});
  try{await f.write({contactProfile:{status:'loaded',profile}});await f.act(new SaveProfile({operationId:'s'}));const put=f.calls.find(call=>call.method==='PUT');
   assert.deepEqual(put.body,{displayName:'N',avatar:'',...typeof profile.revision==='string'?{expectedRevision:profile.revision}:{}});assert.equal(JSON.stringify((await f.read()).contactProfile).includes('BIO_SECRET'),false);}finally{await f.close();}
 });
});

test('the automatic loads on entering Account & security are quiet; explicit loads report failures',async()=>{
 const {LoadDeveloperContact}=await import('../../apps/web/src/bl/incoming.mjs');
 const f=await fixture({api:{get:async()=>{throw Object.assign(new Error('The service is temporarily unavailable.'),{status:503});}}});
 try{await f.act(new LoadContactProfile({quiet:true}));await f.act(new LoadDeveloperContact({quiet:true}));let s=await f.read();assert.equal(s.error??'','');assert.equal(s.contactProfile.status,'error');assert.equal(s.developerContact??null,null);assert.equal(s.developerContactLoading,false);
  assert.match(render(contactProfilePanel(s)).textContent,/could not be loaded/);
  await f.act(new LoadContactProfile());assert.match((await f.read()).error,/temporarily unavailable/);await f.write({error:''});await f.act(new LoadDeveloperContact());assert.match((await f.read()).error,/temporarily unavailable/);
 }finally{await f.close();}
});

test('device rename keeps the account-epoch guard and busy reservation',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const f=await fixture({submissions:{name:{label:'My TV'}},api:{request:async()=>{await gate;return {};},get:async()=>({devices:[{id:'tv',label:'My TV'}]})}});
 try{
  const pending=f.engine.dispatch(new RenameDevice({sessionId:'tv',operationId:'name'})).next('complete');
  await within(f.engine.dispatch(new RenameDevice({sessionId:'tv',operationId:'name'})).next('complete'),'the duplicate rename to be refused');
  release();await within(pending,'RenameDevice');
  assert.deepEqual(f.calls.filter(call=>call.method==='POST'),[{method:'POST',path:'/api/auth/devices/rename',body:{sessionId:'tv',label:'My TV'}}]);
  const state=await f.read();assert.equal(state.notice,'Device name saved.');assert.equal(state.data.devices[0].label,'My TV');
 }finally{release();await f.close();}
 let resume;const held=new Promise(resolve=>resume=resolve);
 const g=await fixture({submissions:{name:{label:'Other TV'}},api:{request:async()=>{await held;return {};},get:async()=>({devices:[{id:'PRIVATE_DEVICE'}]})}});
 try{
  const pending=g.engine.dispatch(new RenameDevice({sessionId:'tv',operationId:'name'})).next('complete');
  await new Promise(resolve=>setTimeout(resolve,5));await g.write({session:{account:{id:'someone-else'},sessionContext:'ctx-2'},beamGeneration:((await g.read()).beamGeneration??0)+1,busy:false});
  resume();await within(pending,'the stale rename');
  const state=await g.read();assert.equal(JSON.stringify(state).includes('PRIVATE_DEVICE'),false);assert.notEqual(state.notice,'Device name saved.');
 }finally{resume();await g.close();}
});

test('offline and sign-out clear the profile, and a late load cannot restore it',{timeout:10000},async()=>{
 let release,started;const wait=new Promise(resolve=>release=resolve),loading=new Promise(resolve=>started=resolve);
 const f=await fixture({api:{get:async path=>{if(path==='/api/profile'){started();await wait;return {displayName:'PRIVATE_NAME'};}return {};}}});
 let pending;
 try{
  await f.write({contactProfile:{profile:{displayName:'PRIVATE_OLD'},status:'loaded'}});
  pending=f.engine.dispatch(new LoadContactProfile()).next('complete');await within(loading,'the profile load to start');
  await f.act(new NetworkChanged({online:false}));release();await within(pending,'the stale profile load');
  assert.equal(JSON.stringify(await f.read()).includes('PRIVATE_'),false);
  await f.write({offline:false,session:{account:{id:'owner'},sessionContext:'ctx'},contactProfile:{profile:{displayName:'PRIVATE_OLD'},status:'loaded'}});
  await f.act(new SignOut());assert.equal(JSON.stringify(await f.read()).includes('PRIVATE_'),false);
 }finally{release();await within(Promise.allSettled([pending]),'profile load during teardown');await f.close();}
});

test('the shell loads the profile on Account & security; no Beam, conversation or contact-link surface remains',async()=>{
 const contributions=builtInModules.flatMap(module=>[module.id,...Object.values(module.contributions).flat().flatMap(entry=>[entry.id,entry.view,entry.title,entry.command,entry.key])]).filter(Boolean).map(String);
 for(const pattern of [/beam/i,/conversation/i,/contact link/i,/^contacts$/])assert.equal(contributions.some(value=>pattern.test(value)),false,contributions.filter(value=>pattern.test(value)).join(', '));
 for(const key of ['g f','g t','g c'])assert.equal(builtInModules.some(module=>module.contributions.keybindings?.some(binding=>binding.key===key)),false,key);
 const f=await fixture();try{const state=await f.read();assert.equal('beaming' in state,false);assert.equal('conversations' in state,false);assert.equal('contactBook' in state,false);assert.deepEqual(state.contactProfile,{});}finally{await f.close();}
 const shell=await readFile(new URL('../../apps/web/src/release.mjs',import.meta.url),'utf8');
 assert.equal(/beam(?!Generation)/i.test(shell),false,'the shell wires no Beam provider, action, event or view');
 assert.match(shell,/s\.view!=='security'[^;]*;[^]*contactProfileActions\.LoadContactProfile\(\{quiet:true\}\)/);assert.doesNotMatch(shell,/conversation|contactBook|'contacts'|redeem-contact|create-contact|send-authored-message/);
});
