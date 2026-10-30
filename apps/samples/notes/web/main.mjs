// Notes boot: the static shell around the @3sln/bindle elements, the engine providers, rendering and routes.
// Integration pattern shown: local-first. The app works fully signed out; <bindle-sign-in> (a provider island where the
// provider offers one) adds sync, and the notes written before signing in are merged into the account's copy.
import '../../../../packages/sdk/src/define.mjs';
import {reconcile} from '../../../../vendor/dodo/index.js';
import {BindleClient} from '../../../../packages/sdk/src/identity.mjs';
import {indexedDBKeyStore} from '../../../../packages/sdk/src/dpop.mjs';
import {createI18n} from '../../kit/web/i18n.mjs';
import {jsonStore,sendAppMessage,accountLabel,APP_MESSAGES_FRAGMENT,APP_MESSAGES_CONTRACT,verifyRemoval,peekRemoval,removalReturnUrl} from '../../kit/web/bindle.mjs';
import {createNotesEngine,INDEX_KEY,noteKey} from './bl.mjs';
import {CATALOGUES} from './i18n.mjs';
import {topbarStart,topbarEnd,mainView,settingsView,signInCopy} from './ui.mjs';
import {removalView} from './removal.mjs';

const SYNC_FRAGMENT='https://notes.example/fragments/sync/v1',STORAGE_CONTRACT='https://3sln.me/artefacts/contracts/object-storage/v1';
// The provider Notes features in its sign-in button (any other provider works through "Use a different provider").
const FEATURED_HOST='alpha.example';
const origin=location.origin,clientId=origin+'/bindle/client.json',STORE_KEY='notes.v1',SEEN_KEY='notes.removal-seen',REMOVAL_KEY='notes.removal';
const requests=[{fragment:SYNC_FRAGMENT,required:true,purpose:'Keep a synced copy of your notes in a folder you choose.',fields:['store','sort'],methods:{store:{[STORAGE_CONTRACT]:['capabilities','get','put','delete']}}}];

const safe=fn=>{try{return fn();}catch{return null;}};
const local={async load(){return safe(()=>JSON.parse(localStorage.getItem(STORE_KEY)));},async save(value){safe(()=>localStorage.setItem(STORE_KEY,JSON.stringify(value)));},clear(){safe(()=>localStorage.removeItem(STORE_KEY));}};
const saved=safe(()=>JSON.parse(localStorage.getItem(STORE_KEY)))??{};
const i18n=createI18n(CATALOGUES,saved.locale??navigator.language);

// ---- static shell ---------------------------------------------------------------------------------------------------
const app=document.querySelector('#app');
const template=document.createElement('template');
template.innerHTML=`<bindle-session client-metadata="${clientId}" redirect-uri="${origin}/bindle/callback" default-host="${FEATURED_HOST}" island-issuers="https://${FEATURED_HOST}" no-callback>
 <div class="shell"><header class="topbar"><div class="topbar-start"></div><div class="topbar-end"><div class="topbar-actions"></div><bindle-account actions="accounts switch provider manage sign-out" hidden></bindle-account></div></header><main class="view"></main></div>
 <dialog class="sheet signin-sheet" aria-labelledby="signin-title"><div class="sheet-body"><div class="signin-mark"><img src="/apps/samples/notes/web/icon.svg" alt="" width="44" height="44"></div><h2 id="signin-title"></h2><p class="signin-copy"></p><bindle-sign-in></bindle-sign-in><p class="signin-foot"></p><button type="button" class="btn ghost signin-close"></button></div></dialog>
 <dialog class="sheet settings-sheet" aria-label="Settings"><div class="settings-body"></div></dialog>
</bindle-session>`;
// The app supplies its own BindleClient so it can give it a persistent DPoP key store: a redirect-mode incremental
// request then binds its exchange to a key that survives the navigation (public clients get DPoP-bound tokens only).
const fragment=document.importNode(template.content,true);
fragment.querySelector('bindle-session').client=new BindleClient({clientMetadataUrl:clientId,redirectUri:`${origin}/bindle/callback`,defaultHost:FEATURED_HOST,keyStore:indexedDBKeyStore()});
app.append(fragment);
const $=selector=>app.querySelector(selector);
const sessionEl=$('bindle-session'),accountEl=$('bindle-account'),signInDialog=$('.signin-sheet'),settingsDialog=$('.settings-sheet');
sessionEl.requests=requests;
// Signed out, Notes' own "Sync" call to action is the affordance (local-first); signed in, the header shows the
// element's avatar-only trigger with the held accounts in its panel.

// ---- providers ------------------------------------------------------------------------------------------------------
let store=null,incremental=null,lastGrant=null;
const client=()=>sessionEl.client;
const remote={ready:()=>!!client()?.session&&!!store,preferences:()=>client().readPreferences(SYNC_FRAGMENT),read:key=>store.read(key),write:(key,value,version)=>store.write(key,value,version),remove:(key,version)=>store.remove(key,version)};
async function incrementalClient(){
 if(!incremental){const {createIncrementalClient}=await import('../../../../packages/sdk/src/incremental.mjs');incremental=createIncrementalClient({client:client(),enabled:true,presentation:'popup'});await incremental.loadCapabilities?.();}
 return incremental;
}
const grants={
 async requestMessages(){
  const helper=await incrementalClient();
  const result=await helper.grantMore({reason:'To send you reminders about your notes.',requests:[{fragment:APP_MESSAGES_FRAGMENT,purpose:'Send you reminders you ask for.',fields:['messages'],methods:{messages:{[APP_MESSAGES_CONTRACT]:['createOwn']}}}]});
  lastGrant=result;if(result?.outcome==='redirecting')return 'redirecting';
  const fragment=result?.fragments?.find(f=>f.fragment===APP_MESSAGES_FRAGMENT)??result?.fragments?.[0];
  return result?.outcome==='completed'&&['granted','partial'].includes(fragment?.outcome)?'granted':'declined';
 },
 sendMessage:message=>sendAppMessage(client(),message)
};
const notes=createNotesEngine({local,remote,grants,locale:i18n.locale});
const send=(name,input)=>notes.run(name,input).then(result=>{if(name==='create')requestAnimationFrame(()=>app.querySelector('.title-input')?.focus());return result;}).catch(error=>console.warn('Notes operation failed',name,error?.message));

// ---- edits sync shortly after typing stops --------------------------------------------------------------------------
let syncTimer=null;
const scheduleSync=()=>{clearTimeout(syncTimer);syncTimer=setTimeout(()=>{if(notes.read().account)send('sync');},700);};
const hooks={
 edit:(id,fields)=>send('edit',{id,...fields}).then(changed=>{if(changed)scheduleSync();}),
 remind:note=>{const title=note.title.trim()||i18n.t('list.untitled');return send('remind',{id:note.id,subject:i18n.t('reminder.subject',{title}),body:i18n.t('reminder.body',{title})});},
 toggleReminders:async input=>{await send(input.checked?'enableReminders':'disableReminders');input.checked=notes.read().reminders.enabled;},
 signOut:async()=>{await send('panel',{settings:false});await sessionEl.signOut({revoke:true});}
};

// ---- rendering ------------------------------------------------------------------------------------------------------
let toastTimer=null,lastToast=null,removal=null;
function apply(s){
 i18n.locale=s.locale;document.documentElement.lang=s.locale;sessionEl.setAttribute('lang',s.locale);
 if(s.theme==='system'){delete document.documentElement.dataset.theme;sessionEl.removeAttribute('theme');}else{document.documentElement.dataset.theme=s.theme;sessionEl.setAttribute('theme',s.theme);}
 document.title=i18n.t('app.name');
}
const remindersRequest={fragment:APP_MESSAGES_FRAGMENT,required:false,purpose:'Send you reminders you ask for.',fields:['messages'],methods:{messages:{[APP_MESSAGES_CONTRACT]:['createOwn']}}};
function render(s){
 apply(s);const t=i18n.t;
 // Once the person turned reminders on, sign-ins also carry the (optional, already approved) app-messages request.
 const wanted=s.reminders.wanted===true;if(sessionEl.requests.length!==(wanted?2:1))sessionEl.requests=wanted?[...requests,remindersRequest]:requests;
 reconcile($('.topbar-start'),removal?topbarStart(s,t).slice(0,1):topbarStart(s,t));
 reconcile($('.topbar-actions'),removal?[]:topbarEnd(s,t,send));
 accountEl.hidden=!s.account;
 if(removal)reconcile($('.view'),removalView(removal,s,t,removalActions));
 else reconcile($('.view'),mainView(s,t,i18n,send,hooks));
 const copy=signInCopy(s,t);$('#signin-title').textContent=removal?.needsSignIn?t('removal.title'):copy.title;$('.signin-copy').textContent=removal?.needsSignIn?t('removal.signin',{account:removal.label}):copy.body;$('.signin-foot').textContent=copy.foot;$('.signin-close').textContent=copy.close;
 if(s.signIn&&!signInDialog.open)signInDialog.showModal();else if(!s.signIn&&signInDialog.open)signInDialog.close();
 reconcile($('.settings-body'),settingsView(s,t,i18n,send,hooks));
 if(s.settings&&!settingsDialog.open)settingsDialog.showModal();else if(!s.settings&&settingsDialog.open)settingsDialog.close();
 if(s.toast&&s.toast.at!==lastToast){lastToast=s.toast.at;clearTimeout(toastTimer);toastTimer=setTimeout(()=>send('dismissToast'),3200);}
}
notes.subscribe(render);
$('.signin-close').addEventListener('click',()=>send('panel',{signIn:false}));
signInDialog.addEventListener('close',()=>{if(notes.read().signIn)send('panel',{signIn:false});});
settingsDialog.addEventListener('close',()=>{if(notes.read().settings)send('panel',{settings:false});});
for(const dialog of [signInDialog,settingsDialog])dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});

// ---- the Bindle session ---------------------------------------------------------------------------------------------
sessionEl.addEventListener('bindle-session-change',async event=>{
 const view=event.detail;
 if(view){
  store=jsonStore(client(),SYNC_FRAGMENT,'store');incremental=null;
  if(location.pathname==='/bindle/callback')history.replaceState(null,'',removal?'/bindle/remove':'/');
  if(removal?.needsSignIn){removal.needsSignIn=false;removal.signedIn=view.subject===removal.subject&&view.issuer===removal.issuer;notes.changed();return;}
  await send('connected',{issuer:view.issuer,subject:view.subject,label:accountLabel(view),fragments:view.grantedFragments.map(g=>g.fragment)});
 }else{store=null;if(notes.read().account)await send('disconnected',{});}
});

// ---- clean removal (app-removal §6.3–§6.5) --------------------------------------------------------------------------
const seen={has:jti=>(safe(()=>JSON.parse(localStorage.getItem(SEEN_KEY)))??[]).includes(jti),add:jti=>{const list=safe(()=>JSON.parse(localStorage.getItem(SEEN_KEY)))??[];list.push(jti);safe(()=>localStorage.setItem(SEEN_KEY,JSON.stringify(list.slice(-50))));}};
const removalActions={
 set(field,value){removal[field]=value;notes.changed();},
 cancel(){location.assign(removalReturnUrl(removal,'canceled'));},
 async finish(){
  if(removal.choice==='delete'&&!removal.signedIn){removal.needsSignIn=true;safe(()=>sessionStorage.setItem(REMOVAL_KEY,JSON.stringify(removal)));await send('panel',{signIn:true});return;}
  removal.working=true;removal.failed=false;notes.changed();
  try{
   if(removal.choice==='delete'){const index=await store.read(INDEX_KEY);for(const id of Object.keys(index?.value?.notes??{})){const doc=await store.read(noteKey(id));if(doc)await store.remove(noteKey(id),doc.version);}if(index)await store.remove(INDEX_KEY,index.version);}
   if(removal.clearLocal)local.clear();
   safe(()=>sessionStorage.removeItem(REMOVAL_KEY));
   location.assign(removalReturnUrl(removal,'completed',{items:[{label:'Synced notes',disposition:removal.choice==='delete'?'deleted':'kept',location:'owner-storage'},{label:'Copy on this device',disposition:removal.clearLocal?'deleted':'kept',location:'app'}],message:removal.choice==='delete'?'Notes deleted its synced copy from your storage.':'Your synced notes stay in your storage.'}));
  }catch{removal.working=false;removal.failed=true;notes.changed();}
 }
};
async function startRemoval(){
 const url=new URL(location.href),token=url.searchParams.get('removal_request');
 history.replaceState(null,'',url.pathname);
 removal={phase:'checking',choice:'keep',clearLocal:false};render(notes.read());
 const known=saved.lastAccount?[saved.lastAccount]:[];
 const verified=token&&peekRemoval(token)?await verifyRemoval(token,{clientId,knownSubjects:known,seen}).catch(()=>null):null;
 removal=verified?{...removal,...verified,phase:'ready',label:saved.lastAccount.label,host:new URL(verified.issuer).host}:{phase:'neutral'};notes.changed();
}

// ---- boot -----------------------------------------------------------------------------------------------------------
await send('load');
const pendingRemoval=safe(()=>JSON.parse(sessionStorage.getItem(REMOVAL_KEY)));
if(location.pathname==='/bindle/remove')await startRemoval();
else if(location.pathname==='/bindle/callback'){
 if(pendingRemoval)removal={...pendingRemoval,needsSignIn:true};
 await sessionEl.ready;const state=new URL(location.href).searchParams.get('state');
 if(state&&client()?.readPending(state))await sessionEl.completeCallback(location.href);
 else if(state){
  // A redirect-mode incremental request returns here; the app session itself did not survive the navigation (SDK
  // sessions are memory-only), so the person reconnects to keep syncing, with the new access already granted.
  // The client-id-metadata ID applies only once this document knows the issuer's declaration: discover it first.
  const iss=new URL(location.href).searchParams.get('iss');if(iss)await client().discoverHost(new URL(iss).host).catch(()=>null);
  const helper=await incrementalClient(),result=await helper.completeCallback(location.href).catch(()=>null);lastGrant=result;history.replaceState(null,'','/');
  const fragment=result?.fragments?.find(f=>f.fragment===APP_MESSAGES_FRAGMENT);if(result)await send('remindersResult',{granted:['granted','partial'].includes(fragment?.outcome)});
 }
 else history.replaceState(null,'','/');
}
// Read-only hooks for automated checks (the simulation's storage invariant reads the synced copy through the SDK).
window.__notes={engine:notes,session:sessionEl,get lastGrant(){return lastGrant;},async storedTitles(){if(!store)return null;const index=await store.read(INDEX_KEY),out=[];for(const [id,entry]of Object.entries(index?.value?.notes??{}))if(!entry.deleted){const doc=await store.read(noteKey(id));out.push(doc?.value?.title??null);}return out.sort();}};
