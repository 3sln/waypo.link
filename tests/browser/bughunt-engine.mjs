// Browser bug hunt fixes (DEVLOG 2026-10-27) driven through the real ngin engine and Actions: F1 contact profile
// load state and stale-write handling, F6 opening a message without refetching, F9/F10 device naming and focus,
// F10 sharing focus, F11 confirmed removal and F13 copy notice. Activity (F3) and account data (F5) engine checks live
// in activity-engine.mjs and account-data-engine.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {within} from '../helpers/async.mjs';
import {Window} from 'happy-dom';
const window=new Window({url:'https://space.example/console'}),names=['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'];
const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));for(const name of names)globalThis[name]=window[name];
const {Engine,Provider}=await import('../../apps/web/src/shared/stack.mjs');
const {default:StateProvider}=await import('../../apps/web/src/providers/browser-state.mjs');
const {LoadContactBook,SaveProfile,UpdateContactSharing,RemoveSavedContact,PROFILE_STALE}=await import('../../apps/web/src/bl/contact-book.mjs');
const {RenameDevice,DEVICE_NAME_REQUIRED}=await import('../../apps/web/src/bl/devices.mjs');
const {CopyDeveloperContact}=await import('../../apps/web/src/bl/incoming.mjs');
const {ReadMessage}=await import('../../apps/web/src/bl/release.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const OWNER='550e8400-e29b-41d4-a716-446655440001',MESSAGE='660e8400-e29b-41d4-a716-000000000001',REVISION='a'.repeat(32);
async function fixture({get,request,submissions={},secrets={}}={}){
 const calls=[],effects=[],store={...secrets};
 const api={async get(path){calls.push({method:'GET',path});return get?get(path):{};},async request(path,body,method='POST'){calls.push({method,path,body});return request?request(path,body,method):{};}};
 const browser={consumeSubmission:id=>submissions[id],secret:key=>store[key],storeSecret:(key,value)=>{store[key]=value;},copy:async value=>effects.push(['copy',value]),captureFocus:()=>effects.push(['captureFocus']),restoreFocus:()=>effects.push(['restoreFocus']),focus:selector=>effects.push(['focus',selector]),setCaptchaAction(){},installCaptcha(){}};
 const engine=new Engine({providers:{state:StateProvider,api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),portalContributions:Provider.fromSingleton({}),recoveryFile:Provider.fromSingleton({})}});
 const write=patch=>engine.container.use({state:{write:true}},({state})=>state.transition(next=>Object.assign(next,patch))),read=()=>engine.container.use(['state'],({state})=>state.snapshot());
 await write({loading:false,locale:'en',view:'contacts',route:{kind:'home'},config:{},session:{account:{id:OWNER},sessionContext:'ctx'},beamGeneration:1,data:{contacts:[],collections:[],devices:[]}});
 return {engine,calls,effects,write,read,act:action=>within(engine.dispatch(action).next('complete'),action.constructor.name),close:()=>engine.dispose()};
}

test('F1 the contact book reports loading, then loaded; a failed load is an error state that keeps Save off',async()=>{
 let finish;const f=await fixture({get:path=>path==='/api/profile'?new Promise(resolve=>finish=resolve):[]});
 try{
  const pending=f.act(new LoadContactBook());while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal((await f.read()).contactBook.profileStatus,'loading');
  finish({displayName:'Stored',bio:'',avatar:'',discloseToContacts:false,revision:REVISION});await pending;
  const book=(await f.read()).contactBook;assert.equal(book.profileStatus,'loaded');assert.equal(book.profile.displayName,'Stored');
  // A later reload while loaded does not flip the form back to loading.
  finish=null;const again=f.act(new LoadContactBook());while(!finish)await new Promise(resolve=>setTimeout(resolve,0));assert.equal((await f.read()).contactBook.profileStatus,'loaded');finish({displayName:'Stored',revision:REVISION});await again;
 }finally{await f.close();}
 const g=await fixture({get:path=>{if(path==='/api/profile')throw Object.assign(Error('Unavailable'),{status:503});return [];}});
 try{await g.act(new LoadContactBook());const s=await g.read();assert.equal(s.contactBook.profileStatus,'error');assert.equal(s.error,'Unavailable');await g.act(new SaveProfile({values:{displayName:'x',bio:'',avatar:''}}));assert.equal(g.calls.some(c=>c.method==='PUT'),false,'no save before a successful load');}finally{await g.close();}
});

test('F1 a save names the loaded revision; a stale refusal shows the latest profile and asks for a fresh review',async()=>{
 let stored={displayName:'Other session',bio:'',avatar:'',discloseToContacts:false,revision:'b'.repeat(32)};
 const f=await fixture({get:path=>path==='/api/profile'?stored:[],request:async(path,body)=>{if(body.expectedRevision!==stored.revision)throw Object.assign(Error('Your contact profile changed in another session. Reload it and try again.'),{code:'profile_stale',status:409});stored={...body,revision:'c'.repeat(32)};delete stored.expectedRevision;return stored;}});
 try{
  await f.write({contactBook:{directory:[],profile:{displayName:'Loaded',bio:'',avatar:'',discloseToContacts:false,revision:REVISION},profileStatus:'loaded',profileEpoch:0}});
  await f.act(new SaveProfile({values:{displayName:'Mine',bio:'',avatar:''}}));
  assert.deepEqual(f.calls.find(c=>c.method==='PUT').body,{displayName:'Mine',bio:'',avatar:'',discloseToContacts:false,expectedRevision:REVISION});
  let s=await f.read();assert.equal(s.error,PROFILE_STALE);assert.notEqual(s.notice,'Contact profile saved.');assert.equal(s.contactBook.profile.displayName,'Other session');assert.equal(s.contactBook.profileEpoch,1,'the form is rebuilt to show the latest values');
  await f.write({error:''});await f.act(new SaveProfile({values:{displayName:'Mine',bio:'',avatar:''}}));
  s=await f.read();assert.equal(s.notice,'Contact profile saved.');assert.equal(s.contactBook.profile.displayName,'Mine');assert.equal(s.contactBook.profile.revision,'c'.repeat(32));
  assert.deepEqual(f.effects.slice(-2),[['captureFocus'],['restoreFocus']],'focus returns to the control that submitted');
 }finally{await f.close();}
});

test('F6 opening an unread message marks it read once and patches local lists without refetching the account',async()=>{
 const message={id:MESSAGE,owner:OWNER,readAt:null,receivedAt:1,mimeType:'text/plain',senderMetadata:{subject:'Hi'}};
 const f=await fixture({get:path=>path.startsWith('/api/messages/')?{message:{...message,readAt:5},render:{kind:'text'}}:(()=>{throw Error('unexpected '+path);})()});
 try{
  await f.write({view:'inbox',data:{messages:[structuredClone(message)],views:[]},incoming:{items:[{...message,type:'message'}],cursor:null}});
  await f.act(new ReadMessage({id:MESSAGE}));let s=await f.read();
  assert.deepEqual(f.calls.map(c=>`${c.method} ${c.path}`),[`PATCH /api/messages/${MESSAGE}`,`GET /api/messages/${MESSAGE}`]);
  assert.equal(s.data.messages[0].readAt,5);assert.equal(s.incoming.items[0].readAt,5);assert.equal(s.messageDetail.id,MESSAGE);assert.equal(s.selected,MESSAGE);
  await f.act(new ReadMessage({id:MESSAGE}));assert.deepEqual(f.calls.slice(2).map(c=>`${c.method} ${c.path}`),[`GET /api/messages/${MESSAGE}`],'an already-read message is only fetched');
 }finally{await f.close();}
});

test('F9 and F10 a blank device name is refused with a plain reason; a saved name returns focus to its opener',async()=>{
 const f=await fixture({submissions:{blank:{label:'   '},named:{label:'  Living room  '}},get:()=>({devices:[{id:'tv',label:'Living room'}]})});
 try{
  await f.write({modal:{kind:'rename-device',device:{id:'tv'}}});
  await f.act(new RenameDevice({sessionId:'tv',operationId:'blank'}));let s=await f.read();
  assert.equal(s.error,DEVICE_NAME_REQUIRED);assert.equal(s.modal?.kind,'rename-device','the dialog stays open');assert.equal(f.calls.length,0);
  await f.act(new RenameDevice({sessionId:'tv',operationId:'named'}));s=await f.read();
  assert.deepEqual(f.calls.find(c=>c.method==='POST').body,{sessionId:'tv',label:'Living room'});assert.equal(s.modal,null);assert.equal(s.notice,'Device name saved.');assert.deepEqual(f.effects.at(-1),['restoreFocus']);
 }finally{await f.close();}
});

test('F10 and F11 sharing restores focus; removing a saved contact needs its confirmation dialog, then focuses the list',async()=>{
 const f=await fixture({submissions:{share:{'profile:bio':'on'}},get:path=>path==='/api/account'?{contacts:[]}:path==='/api/contacts/directory'?[]:{displayName:'',revision:REVISION}});
 try{
  await f.write({modal:{kind:'contact-permissions',contact:{id:'g1'}}});await f.act(new UpdateContactSharing({id:'g1',operationId:'share'}));assert.deepEqual(f.effects.at(-1),['restoreFocus']);
  await f.act(new RemoveSavedContact({peer:'peer-1'}));assert.equal(f.calls.some(c=>c.method==='DELETE'),false);assert.match((await f.read()).error,/confirm/);
  await f.write({modal:{kind:'remove-saved-contact',contact:{peer:'peer-2'}},error:''});await f.act(new RemoveSavedContact({peer:'peer-1'}));assert.equal(f.calls.some(c=>c.method==='DELETE'),false,'the dialog must name the same contact');
  await f.write({modal:{kind:'remove-saved-contact',contact:{peer:'peer-1'}},error:''});await f.act(new RemoveSavedContact({peer:'peer-1'}));
  const s=await f.read();assert.ok(f.calls.some(c=>c.method==='DELETE'&&c.path==='/api/contacts/directory/peer-1'));assert.equal(s.modal,null);assert.equal(s.notice,'Saved contact removed.');assert.deepEqual(f.effects.at(-1),['focus','.saved-contacts h2']);
 }finally{await f.close();}
});

test('F13 copying the developer contact link says "Contact link copied."',async()=>{
 const f=await fixture({secrets:{developerContactURL:{owner:OWNER,generation:1,url:'https://space.example/users/dev/contact/x?bindle_meta=a.b'}}});
 try{await f.act(new CopyDeveloperContact());assert.equal((await f.read()).notice,'Contact link copied.');assert.deepEqual(f.effects.at(-1),['copy','https://space.example/users/dev/contact/x?bindle_meta=a.b']);}finally{await f.close();}
});
