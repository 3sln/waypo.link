import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {within} from '../helpers/async.mjs';
import {Window} from 'happy-dom';
// The optional contact profile (Account & security), per-link profile sharing for the contact links the owner's apps
// created, and device naming, driven through the real engine. Saved contacts, core contact-link management and
// conversations left the core with messaging (2026-10-27); the last tests pin that none of them remain.
const window=new Window({url:'https://space.example/'}),names=['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'];
const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));for(const name of names)globalThis[name]=window[name];
const {dodo,Engine,Provider}=await import('../../apps/web/src/shared/stack.mjs');
const {forEachSeed}=await import('../helpers/chaos.mjs');
const {default:StateProvider}=await import('../../apps/web/src/providers/browser-state.mjs');
const {default:localize}=await import('../../apps/web/src/ui/localize.mjs');
const {createLocalization}=await import('../../packages/i18n/index.mjs');
const {LoadContactProfile,UpdateContactSharing,SaveProfile,sharingLinks}=await import('../../apps/web/src/bl/contact-profile.mjs');
const {RenameDevice}=await import('../../apps/web/src/bl/devices.mjs');
const {contactProfilePanel,contactSharingDialog}=await import('../../apps/web/src/ui/contact-profile.mjs');
const {default:securityView}=await import('../../apps/web/src/ui/release-security.mjs');
const {builtInModules}=await import('../../apps/web/src/shared/portal-modules.mjs');
// Finish imports before registering tests: a late top-level await can let the
// file's after hook restore Event before the final test is even registered.
const {NetworkChanged,SignOut}=await import('../../apps/web/src/bl/release.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const render=(node,locale='en')=>{const root=document.createElement('main');dodo.reconcile(root,[localize(node,createLocalization({locale}))]);return root;};
const buttons=(root,text)=>[...root.querySelectorAll('button')].filter(button=>button.textContent.trim()===text);
const jti='a1b2c3d4-0000-4000-8000-000000000001';
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

test('the contact profile loads only GET /api/profile and saving sends only the profile body',async()=>{
 const saved={displayName:'Ray',bio:'Builds things',avatar:'https://images.example/ray.png',discloseToContacts:true,revision:'r2'};
 const f=await fixture({submissions:{profile:{displayName:'Ray',bio:'Builds things',avatar:'https://images.example/ray.png',discloseToContacts:'on'}},api:{get:async()=>({displayName:'',bio:'',avatar:'',discloseToContacts:false,revision:'r1'}),request:async()=>saved}});
 try{
  // Bug hunt F1: a save is refused until the stored profile has loaded (it would otherwise overwrite it with blanks).
  await f.act(new SaveProfile({operationId:'profile'}));assert.deepEqual(f.calls,[]);assert.match((await f.read()).error,/still loading/);
  await f.write({error:''});await f.act(new LoadContactProfile());assert.deepEqual(f.calls,[{method:'GET',path:'/api/profile'}]);assert.equal((await f.read()).contactProfile.status,'loaded');
  await f.act(new SaveProfile({operationId:'profile'}));
  assert.deepEqual(f.calls.at(-1),{method:'PUT',path:'/api/profile',body:{displayName:'Ray',bio:'Builds things',avatar:'https://images.example/ray.png',discloseToContacts:true,expectedRevision:'r1'}});
  const state=await f.read();assert.deepEqual(state.contactProfile.profile,saved);assert.equal(state.notice,'Contact profile saved.');assert.equal(state.busy,false);
  const root=render(contactProfilePanel(state));assert.equal(root.querySelector('input[name=displayName]').value,'Ray');assert.equal(root.querySelector('input[name=discloseToContacts]').checked,true);
  assert.equal(f.calls.some(call=>/\/api\/contacts(\/directory|\/redeem|$)/.test(call.path)),false,'no saved-contact directory or redeem call');
 }finally{await f.close();}
});

test('a stale profile save reloads the latest version instead of claiming success',async()=>{
 let latest={displayName:'Other session',bio:'',avatar:'',discloseToContacts:false,revision:'r9'};
 const f=await fixture({submissions:{profile:{displayName:'Mine',bio:'',avatar:'',discloseToContacts:'on'}},api:{get:async()=>latest,request:async()=>{throw Object.assign(new Error('stale'),{code:'profile_stale',status:409});}}});
 try{await f.write({contactProfile:{profile:{displayName:'',revision:'r1'},status:'loaded'}});await f.act(new SaveProfile({operationId:'profile'}));const state=await f.read();assert.match(state.error,/changed in another session/);assert.deepEqual(state.contactProfile.profile,latest);assert.equal(state.contactProfile.epoch,1);assert.notEqual(state.notice,'Contact profile saved.');}finally{await f.close();}
});

test('the profile panel lives in Account & security and lists only live app-created links for sharing',()=>{
 const contacts=[parent({profileFields:['bio']}),parent({id:'b1b2c3d4-0000-4000-8000-000000000002',active:false}),parent({id:'c1b2c3d4-0000-4000-8000-000000000003',conditional:true,issuer:{kind:'app'}})];
 const state={locale:'en',session:{account:{id:'owner',handle:'ray'}},config:{},brand:{host:'space.example'},data:{contacts,account:{id:'owner',handle:'ray'}},contactProfile:{status:'loaded',profile:{}}};
 const root=render(securityView(state));const panel=root.querySelector('.contact-profile-settings');assert.ok(panel);
 assert.equal(panel.querySelectorAll('.link-sharing-row').length,2,'revoked links are not offered');assert.equal(buttons(panel,'Choose shared fields').length,2);
 assert.match(panel.textContent,/Shares: About you/);assert.match(panel.textContent,/Shares no profile fields\./);assert.match(panel.textContent,/Conditional/);
 assert.equal(panel.querySelector('bdi[translate=no]')?.textContent,'https://parlay.example/client');
 assert.doesNotMatch(root.textContent,/Saved contacts|New contact link|Create a contact link|Quarantine|Rotate challenge/);
 const es=render(securityView({...state,locale:'es'}),'es').querySelector('.contact-profile-settings');assert.ok(buttons(es,createLocalization({locale:'es'}).t('Choose shared fields')).length===2);assert.notEqual(createLocalization({locale:'es'}).t('Choose shared fields'),'Choose shared fields');
 const empty=render(contactProfilePanel({...state,data:{contacts:[]}}));assert.match(empty.textContent,/None of your apps has created a contact link yet\./);
});

test('the sharing dialog saves PUT /api/contacts/{jti}/sharing with profileFields only for a live link',async()=>{
 const contact={id:jti,profileFields:['bio']};
 const dialog=contactSharingDialog({locale:'en',modal:{kind:'contact-permissions',contact}}),root=render(dialog.body);
 assert.deepEqual([...root.querySelectorAll('input[type=checkbox]')].map(input=>[input.name,input.checked]),[['profile:displayName',false],['profile:bio',true],['profile:avatar',false]]);
 assert.doesNotMatch(root.textContent,/file offer/i);assert.equal(contactSharingDialog({locale:'en',modal:{kind:'other'}}),null);
 const intents=[];root.addEventListener('3sln-intent',event=>intents.push(event.detail));root.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(intents.at(-1)?.kind,'update-contact-sharing');assert.equal(intents.at(-1).id,jti);
 const f=await fixture({submissions:{share:{'profile:displayName':'on','profile:avatar':'on','beamEnabled':'on'}},api:{get:async path=>path==='/api/account'?{contacts:[parent({profileFields:['displayName','avatar']})]}:{}}});
 try{
  await f.write({modal:{kind:'contact-permissions',contact}});await f.act(new UpdateContactSharing({id:jti,operationId:'share'}));
  const put=f.calls.find(call=>call.method==='PUT');assert.deepEqual(put,{method:'PUT',path:`/api/contacts/${jti}/sharing`,body:{profileFields:['displayName','avatar']}});
  const state=await f.read();assert.equal(state.modal,null);assert.equal(state.notice,'Contact sharing permissions saved.');assert.deepEqual(state.data.contacts[0].profileFields,['displayName','avatar']);
  await f.act(new UpdateContactSharing({id:jti}));assert.equal(f.calls.filter(call=>call.method==='PUT').length,1,'no form values never clears sharing');
  // A link that is not live in the snapshot is never sent; a link revoked meanwhile answers contact_not_found.
  await f.act(new UpdateContactSharing({id:'not-a-live-link',operationId:'share'}));assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.match((await f.read()).error,/no longer active/);
 }finally{await f.close();}
 const g=await fixture({submissions:{share:{'profile:bio':'on'}},api:{get:async()=>({contacts:[]}),request:async()=>{throw Object.assign(new Error('gone'),{code:'contact_not_found',status:404});}}});
 try{await g.write({modal:{kind:'contact-permissions',contact}});await g.act(new UpdateContactSharing({id:jti,operationId:'share'}));const state=await g.read();assert.equal(state.modal,null);assert.match(state.error,/no longer active/);assert.deepEqual(state.data.contacts,[]);assert.equal(state.busy,false);}finally{await g.close();}
});

test('seeded snapshots: sharing rows match live links exactly and owner data is never translated',async()=>{
 await forEachSeed(40,async random=>{
  const contacts=Array.from({length:random.int(6)},(_,index)=>random.chance(.15)?random.pick([null,{},{id:7},{active:true}]):parent({id:`${index}0000000-0000-4000-8000-00000000000${index}`,active:random.chance(.7),name:random.chance(.3)?random.pick(['Friends','<b>x</b>','‮evil','Contact link']):undefined,conditional:random.chance(.3),profileFields:random.shuffle(['displayName','bio','avatar','beam','unknown']).slice(0,random.int(4)),issuer:random.chance(.5)?{kind:'app',clientId:random.pick(['https://a.example/c','<script>'])}:{kind:'app'},createdAt:random.chance(.8)?Date.UTC(2026,0,1+index):'bad',expiresAt:random.chance(.5)?Date.UTC(2027,0,1):undefined}));
  const state={locale:random.pick(['en','es']),session:{account:{id:'owner'}},config:{},data:{contacts},contactProfile:{status:random.pick(['loading','loaded','error']),profile:{}}};
  const live=sharingLinks(state);assert.deepEqual(live.map(link=>link.id),contacts.filter(c=>c?.active===true&&typeof c.id==='string').map(c=>c.id));
  const root=render(contactProfilePanel(state),state.locale),rows=[...root.querySelectorAll('.link-sharing-row')];assert.equal(rows.length,live.length);
  assert.equal(root.querySelector('b'),null);assert.equal(root.querySelector('script'),null);
  for(const [index,row] of rows.entries()){const expected=live[index].profileFields.filter(name=>['displayName','bio','avatar'].includes(name));assert.equal(row.querySelectorAll('button').length,1);if(!expected.length)assert.ok(row.querySelector('.link-sharing-fields'));assert.doesNotMatch(row.textContent,/beam|unknown/);}
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

test('offline and sign-out clear the contact profile, and a late load cannot restore it',{timeout:10000},async()=>{
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
