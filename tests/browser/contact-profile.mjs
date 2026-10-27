import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {within} from '../helpers/async.mjs';
import {Window} from 'happy-dom';
// Saved contacts, the optional contact profile, per-link profile sharing and device
// naming, driven through the real engine. File beaming was removed from the core
// portal; the last tests pin that no Beam surface remains.
const window=new Window({url:'https://space.example/'}),names=['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'];
const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));for(const name of names)globalThis[name]=window[name];
const {dodo,Engine,Provider}=await import('../../apps/web/src/shared/stack.mjs');
const {default:StateProvider}=await import('../../apps/web/src/providers/browser-state.mjs');
const {default:localize}=await import('../../apps/web/src/ui/localize.mjs');
const {createLocalization}=await import('../../packages/i18n/index.mjs');
const {LoadContactBook,RedeemContact,UpdateContactSharing,SaveProfile,RemoveSavedContact,CopySavedContact}=await import('../../apps/web/src/bl/contact-book.mjs');
const {RenameDevice}=await import('../../apps/web/src/bl/devices.mjs');
const {contactBookSections,contactSharingDialog}=await import('../../apps/web/src/ui/contact-book.mjs');
const {contactsView}=await import('../../apps/web/src/ui/release-views.mjs');
const {builtInModules}=await import('../../apps/web/src/shared/portal-modules.mjs');
// Finish imports before registering tests: a late top-level await can let the
// file's after hook restore Event before the final test is even registered.
const {NetworkChanged,SignOut}=await import('../../apps/web/src/bl/release.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const render=(node,locale='en')=>{const root=document.createElement('main');dodo.reconcile(root,[localize(node,createLocalization({locale}))]);return root;};
const buttons=(root,text)=>[...root.querySelectorAll('button')].filter(button=>button.textContent.trim()===text);
const link='https://other.example/users/river/contact/44444444-1111-4111-8111-111111111111?sig=fixture';
async function fixture({api={},submissions={},secrets={}}={}){
 const calls=[],copied=[],store={...secrets};
 const client={async get(path){calls.push({method:'GET',path});if(api.get)return api.get(path);return path==='/api/contacts/directory'?[]:{};},async request(path,body,method='POST'){calls.push({method,path,body});if(api.request)return api.request(path,body,method);return {};}};
 const browser={consumeSubmission:id=>submissions[id],secret:key=>store[key],storeSecret:(key,value)=>{store[key]=value;},copy:async value=>copied.push(value),setCaptchaAction(){},installCaptcha(){},restoreFocus(){}};
 const engine=new Engine({providers:{state:StateProvider,api:Provider.fromSingleton(client),browser:Provider.fromSingleton(browser),portalContributions:Provider.fromSingleton({}),recoveryFile:Provider.fromSingleton({})}});
 const write=patch=>engine.container.use({state:{write:true}},({state})=>state.transition(next=>Object.assign(next,patch))),read=()=>engine.container.use(['state'],({state})=>state.snapshot());
 await write({loading:false,locale:'en',view:'inbox',route:{kind:'home'},config:{},session:{account:{id:'owner'},sessionContext:'ctx'},data:{contacts:[],collections:[],devices:[]}});
 return {engine,calls,copied,store,write,read,act:(action,what=action.constructor.name)=>within(engine.dispatch(action).next('complete'),what),close:()=>engine.dispose()};
}

test('saving the contact profile sends only the profile body and publishes the saved projection',async()=>{
 const saved={displayName:'Ray',bio:'Builds things',avatar:'https://images.example/ray.png',discloseToContacts:true};
 const f=await fixture({submissions:{profile:{displayName:'Ray',bio:'Builds things',avatar:'https://images.example/ray.png',discloseToContacts:'on'}},api:{request:async()=>saved}});
 try{
  await f.act(new SaveProfile({operationId:'profile'}));
  assert.deepEqual(f.calls,[{method:'PUT',path:'/api/profile',body:{displayName:'Ray',bio:'Builds things',avatar:'https://images.example/ray.png',discloseToContacts:true}}]);
  const state=await f.read();assert.deepEqual(state.contactBook.profile,saved);assert.equal(state.notice,'Contact profile saved.');assert.equal(state.busy,false);
  const root=render(contactBookSections(state));assert.equal(root.querySelector('input[name=displayName]').value,'Ray');assert.equal(root.querySelector('input[name=discloseToContacts]').checked,true);
 }finally{await f.close();}
});

test('redeeming a contact link saves it once, clears the add-contact secret, and removing it reloads the directory',async()=>{
 let directory=[],release;const gate=new Promise(resolve=>release=resolve);
 const f=await fixture({secrets:{addContactURL:link},submissions:{redeem:{url:link}},api:{
  get:async path=>path==='/api/contacts/directory'?directory:{displayName:''},
  request:async(path,body,method)=>{if(path==='/api/contacts/redeem'){await gate;directory=[{peer:'peer-1',grantId:'grant-1',url:link,profile:{displayName:'River',bio:'<b>hi</b>'}}];return {saved:true};}if(method==='DELETE'){directory=[];return {};}return {};}}});
 try{
  await f.write({addContactURL:link});
  const first=f.engine.dispatch(new RedeemContact({operationId:'redeem'})).next('complete'),second=f.engine.dispatch(new RedeemContact({operationId:'redeem'})).next('complete');
  await within(second,'the duplicate redeem to be refused');release();await within(first,'the redeem');
  assert.equal(f.calls.filter(call=>call.path==='/api/contacts/redeem').length,1,'the busy reservation refuses the duplicate submit');
  assert.deepEqual(f.calls.find(call=>call.path==='/api/contacts/redeem').body,{url:link});
  let state=await f.read();assert.equal(state.addContactURL,null);assert.equal(f.store.addContactURL,null);assert.equal(state.notice,'Signed contact saved.');assert.equal(state.contactBook.directory.length,1);
  let root=render(contactBookSections(state));assert.match(root.textContent,/River/);assert.match(root.textContent,/<b>hi<\/b>/);assert.equal(root.querySelector('b'),null);assert.equal(buttons(root,'Remove saved contact').length,1);
  await f.act(new CopySavedContact({peer:'peer-1'}));assert.deepEqual(f.copied,[link]);
  await f.act(new RemoveSavedContact({peer:'peer-1'}));
  assert.ok(f.calls.some(call=>call.method==='DELETE'&&call.path==='/api/contacts/directory/peer-1'));
  state=await f.read();assert.deepEqual(state.contactBook.directory,[]);assert.equal(state.notice,'Saved contact removed.');
  root=render(contactBookSections(state));assert.equal(buttons(root,'Remove saved contact').length,0);
 }finally{release();await f.close();}
});

test('the sharing dialog offers profile fields only and saves PUT /api/contacts/{id}/sharing with profileFields',async()=>{
 const contact={id:'grant/1',active:true,name:'Friends',profileFields:['bio']};
 const dialog=contactSharingDialog({locale:'en',modal:{kind:'contact-permissions',contact}}),root=render(dialog.body);
 assert.deepEqual([...root.querySelectorAll('input[type=checkbox]')].map(input=>[input.name,input.checked]),[['profile:displayName',false],['profile:bio',true],['profile:avatar',false]]);
 assert.doesNotMatch(root.textContent,/file offer/i);assert.equal(contactSharingDialog({locale:'en',modal:{kind:'other'}}),null);
 const intents=[];root.addEventListener('3sln-intent',event=>intents.push(event.detail));root.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(intents.at(-1)?.kind,'update-contact-sharing');assert.equal(intents.at(-1).id,'grant/1');
 const f=await fixture({submissions:{share:{'profile:displayName':'on','profile:avatar':'on','beamEnabled':'on'}},api:{get:async path=>path==='/api/account'?{contacts:[{...contact,profileFields:['displayName','avatar']}]}:{}}});
 try{
  await f.write({modal:{kind:'contact-permissions',contact}});await f.act(new UpdateContactSharing({id:'grant/1',operationId:'share'}));
  const put=f.calls.find(call=>call.method==='PUT');assert.deepEqual(put,{method:'PUT',path:'/api/contacts/grant%2F1/sharing',body:{profileFields:['displayName','avatar']}});
  const state=await f.read();assert.equal(state.modal,null);assert.equal(state.notice,'Contact sharing permissions saved.');assert.deepEqual(state.data.contacts[0].profileFields,['displayName','avatar']);
  await f.act(new UpdateContactSharing({id:'grant/1'}));assert.equal(f.calls.filter(call=>call.method==='PUT').length,1,'no form values never clears sharing');
 }finally{await f.close();}
});

test('contact link cards keep sharing permissions without a file-offer toggle and host the contact book',()=>{
 const state={locale:'en',session:{account:{id:'owner'}},config:{},data:{contacts:[{id:'c1',active:true,name:'Friends',form:'link',profileFields:[]}]},contactBook:{directory:[],profile:{}}};
 const root=render(contactsView(state));
 assert.equal(buttons(root,'Sharing permissions').length,1);assert.doesNotMatch(root.textContent,/file offer|beam/i);
 assert.ok(root.querySelector('.saved-contacts'));assert.ok(root.querySelector('.contact-profile-settings'));
});

test('the add-contact fragment lands in Contacts with the signed URL prefilled',async()=>{
 const f=await fixture({secrets:{addContactURL:link}});
 try{
  await f.act(new LoadContactBook({addContact:true}));
  const state=await f.read();assert.equal(state.view,'contacts');assert.equal(state.addContactURL,link);
  assert.deepEqual(f.calls.map(call=>call.path).sort(),['/api/contacts/directory','/api/profile']);
  const root=render(contactsView({...state,data:{contacts:[]}}));assert.equal(root.querySelector('input[name=url]').value,link);
  // The shell wires the handoff event to this action (release.mjs is a browser entry and is not imported here).
  const shell=await readFile(new URL('../../apps/web/src/release.mjs',import.meta.url),'utf8');
  assert.match(shell,/addEventListener\('add-contact-opened',\(\)=>engine\.dispatch\(new contactBookActions\.LoadContactBook\(\{addContact:true\}\)\)\)/);
 }finally{await f.close();}
 const plain=await fixture();try{await plain.act(new LoadContactBook({addContact:true}));assert.equal((await plain.read()).view,'inbox','no stored URL leaves the current view');}finally{await plain.close();}
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

test('offline and sign-out clear saved contacts, and a late load cannot restore them',{timeout:10000},async()=>{
 let release,started;const wait=new Promise(resolve=>release=resolve),loading=new Promise(resolve=>started=resolve);
 const f=await fixture({api:{get:async path=>{if(path==='/api/contacts/directory'){started();await wait;return [{url:'https://space.example/?sig=PRIVATE_URL'}];}return {displayName:'PRIVATE_NAME'};}}});
 let pending;
 try{
  await f.write({contactBook:{directory:[{url:'PRIVATE_URL'}]}});
  pending=f.engine.dispatch(new LoadContactBook()).next('complete');await within(loading,'the saved-contact load to start');
  await f.act(new NetworkChanged({online:false}));release();await within(pending,'the stale saved-contact load');
  assert.equal(JSON.stringify(await f.read()).includes('PRIVATE_'),false);
  await f.write({offline:false,session:{account:{id:'owner'},sessionContext:'ctx'},contactBook:{directory:[{url:'PRIVATE_URL'}]}});
  await f.act(new SignOut());assert.equal(JSON.stringify(await f.read()).includes('PRIVATE_'),false);
 }finally{release();await within(Promise.allSettled([pending]),'saved-contact load during teardown');await f.close();}
});

test('no Beam navigation, command, keybinding, view or state remains in the portal',async()=>{
 const contributions=builtInModules.flatMap(module=>[module.id,...Object.values(module.contributions).flat().flatMap(entry=>[entry.id,entry.view,entry.title,entry.command,entry.key])]).filter(Boolean).map(String);
 assert.equal(contributions.some(value=>/beam/i.test(value)),false,contributions.filter(value=>/beam/i.test(value)).join(', '));
 assert.equal(builtInModules.some(module=>module.contributions.keybindings?.some(binding=>binding.key==='g f')),false);
 const f=await fixture();try{const state=await f.read();assert.equal('beaming' in state,false);assert.deepEqual(state.contactBook,{});}finally{await f.close();}
 const shell=await readFile(new URL('../../apps/web/src/release.mjs',import.meta.url),'utf8');
 assert.equal(/beam(?!Generation)/i.test(shell),false,'the shell wires no Beam provider, action, event or view');
});
