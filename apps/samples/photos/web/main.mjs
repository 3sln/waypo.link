// Photos boot. Integration pattern shown: a public, signed-out view; sign-in through a full-page redirect (the handle
// form of <bindle-sign-in>, no islands); storage requested incrementally, only when the person first adds a photo.
import '../../../../packages/sdk/src/define.mjs';
import {reconcile} from '../../../../vendor/dodo/index.js';
import {BindleClient} from '../../../../packages/sdk/src/identity.mjs';
import {indexedDBKeyStore} from '../../../../packages/sdk/src/dpop.mjs';
import {createI18n} from '../../kit/web/i18n.mjs';
import {jsonStore,accountLabel,STORAGE_CONTRACT} from '../../kit/web/bindle.mjs';
import {createPhotosEngine,LIBRARY_FRAGMENT,photoKey} from './bl.mjs';
import {CATALOGUES} from './i18n.mjs';
import {headerStart,headerActions,mainView} from './ui.mjs';

const origin=location.origin,clientId=origin+'/bindle/client.json',STORE_KEY='photos.v1';
const libraryRequest={fragment:LIBRARY_FRAGMENT,required:false,purpose:'Keep the photos you add in storage you choose.',fields:['library'],methods:{library:{[STORAGE_CONTRACT]:['capabilities','get','put','delete']}}};
const safe=fn=>{try{return fn();}catch{return null;}};
const local={async load(){return safe(()=>JSON.parse(localStorage.getItem(STORE_KEY)));},async save(value){safe(()=>localStorage.setItem(STORE_KEY,JSON.stringify(value)));}};
const saved=safe(()=>JSON.parse(localStorage.getItem(STORE_KEY)))??{};
const i18n=createI18n(CATALOGUES,saved.locale??navigator.language);

const app=document.querySelector('#app'),template=document.createElement('template');
template.innerHTML=`<bindle-session client-metadata="${clientId}" redirect-uri="${origin}/bindle/callback" default-host="none" islands="off" presentation="redirect" no-callback>
 <div class="shell"><header class="topbar"><div class="topbar-start"></div><div class="topbar-end"><div class="topbar-actions"></div><bindle-account actions="accounts switch manage sign-out" signed-out="panel"></bindle-account></div></header><main class="view"></main></div>
 <dialog class="sheet signin-sheet" aria-labelledby="signin-title"><div class="sheet-body"><img src="/apps/samples/photos/web/icon.svg" alt="" width="44" height="44" class="mark"><h2 id="signin-title"></h2><p class="signin-copy"></p><bindle-sign-in identity-required></bindle-sign-in><button type="button" class="btn ghost signin-close"></button></div></dialog>
</bindle-session>`;
const fragment=document.importNode(template.content,true);
fragment.querySelector('bindle-session').client=new BindleClient({clientMetadataUrl:clientId,redirectUri:`${origin}/bindle/callback`,defaultHost:'none',keyStore:indexedDBKeyStore()});
app.append(fragment);
const $=selector=>app.querySelector(selector),sessionEl=$('bindle-session'),accountEl=$('bindle-account'),signInDialog=$('.signin-sheet');

let store=null,incremental=null;
const client=()=>sessionEl.client;
const remote={ready:()=>!!client()?.session&&!!store,read:key=>store.read(key),write:(key,value,version)=>store.write(key,value,version),remove:(key,version)=>store.remove(key,version),readBytes:key=>store.readBytes(key),writeBytes:(key,bytes,type,version)=>store.writeBytes(key,bytes,type,version)};
async function incrementalClient(){if(!incremental){const {createIncrementalClient}=await import('../../../../packages/sdk/src/incremental.mjs');incremental=createIncrementalClient({client:client(),enabled:true,presentation:'popup'});}return incremental;}
const grants={async requestStorage(){const result=await (await incrementalClient()).grantMore({reason:'To keep the photos you add.',requests:[libraryRequest]});if(result?.outcome==='redirecting')return 'redirecting';const f=result?.fragments?.find(x=>x.fragment===LIBRARY_FRAGMENT);return result?.outcome==='completed'&&['granted','partial'].includes(f?.outcome)?'granted':'declined';}};
const photos=createPhotosEngine({local,remote,grants,locale:i18n.locale});
const send=(name,input)=>photos.run(name,input).catch(error=>console.warn('Photos operation failed',name,error?.message));

// Own photos are fetched as bytes through the SDK and shown through object URLs.
const urls=new Map(),loading=new Set();
async function loadUrls(s){for(const p of s.photos)if(!urls.has(p.id)&&!loading.has(p.id)){loading.add(p.id);try{const object=await store.readBytes(photoKey(p.id));if(object)urls.set(p.id,URL.createObjectURL(new Blob([object.bytes],{type:object.contentType})));}catch{}finally{loading.delete(p.id);}photos.changed();}}
const hooks={async upload(input){for(const file of [...input.files]){const bytes=new Uint8Array(await file.arrayBuffer());await send('upload',{title:(name=>name.charAt(0).toUpperCase()+name.slice(1))(file.name.replace(/\.[a-z0-9]+$/i,'').replace(/[-_]+/g,' ')),type:file.type,bytes});}input.value='';}};

let lastToast=null,toastTimer=null;
function render(s){
 i18n.locale=s.locale;document.documentElement.lang=s.locale;sessionEl.setAttribute('lang',s.locale);document.title=i18n.t('app.name');
 if(s.theme==='system'){delete document.documentElement.dataset.theme;sessionEl.removeAttribute('theme');}else{document.documentElement.dataset.theme=s.theme;sessionEl.setAttribute('theme',s.theme);}
 if(sessionEl.requests.length!==(s.wanted?1:0))sessionEl.requests=s.wanted?[libraryRequest]:[];
 const t=i18n.t;reconcile($('.topbar-start'),headerStart(s,t,send));reconcile($('.topbar-actions'),headerActions(s,t,send));accountEl.setAttribute('sign-in-prompt',t('signin.title'));
 reconcile($('.view'),mainView(s,t,i18n,send,urls,hooks));
 $('#signin-title').textContent=t('signin.title');$('.signin-copy').textContent=t('signin.body');$('.signin-close').textContent=t('signin.close');
 if(s.signIn&&!signInDialog.open)signInDialog.showModal();else if(!s.signIn&&signInDialog.open)signInDialog.close();
 if(s.toast&&s.toast.at!==lastToast){lastToast=s.toast.at;clearTimeout(toastTimer);toastTimer=setTimeout(()=>send('dismissToast'),3200);}
 if(s.storage==='granted'&&store)loadUrls(s);
}
photos.subscribe(render);
$('.signin-close').addEventListener('click',()=>send('panel',{signIn:false}));
signInDialog.addEventListener('close',()=>{if(photos.read().signIn)send('panel',{signIn:false});});
addEventListener('keydown',e=>{if(e.key==='Escape'&&photos.read().viewer)send('view',{viewer:null});});

sessionEl.addEventListener('bindle-session-change',async event=>{
 const view=event.detail;
 if(view){store=jsonStore(client(),LIBRARY_FRAGMENT,'library');incremental=null;if(location.pathname==='/bindle/callback')history.replaceState(null,'','/');await send('connected',{issuer:view.issuer,subject:view.subject,label:accountLabel(view),fragments:view.grantedFragments.map(g=>g.fragment)});if(photos.read().wanted)await send('tab',{tab:'library'});}
 else{store=null;for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();if(photos.read().account)await send('disconnected',{});}
});

await send('load');
if(location.pathname==='/library')await send('tab',{tab:'library'});
if(location.pathname==='/bindle/callback'){
 await sessionEl.ready;const url=new URL(location.href),state=url.searchParams.get('state'),iss=url.searchParams.get('iss');
 if(state&&client()?.readPending(state))await sessionEl.completeCallback(location.href);
 else if(state){if(iss)await client().discoverHost(new URL(iss).host).catch(()=>null);const result=await (await incrementalClient()).completeCallback(location.href).catch(()=>null);history.replaceState(null,'','/');
  const f=result?.fragments?.find(x=>x.fragment===LIBRARY_FRAGMENT);if(result){await send('tab',{tab:'library'});// A completed decline is final; any other outcome (granted, or an exchange this document could not finish) continues
  // with one more sign-in, which carries the optional library request and shows the actual grant.
  await send('storageResult',{declined:result.outcome==='completed'&&!['granted','partial'].includes(f?.outcome)});}}
 else history.replaceState(null,'','/');
}
window.__photos={engine:photos,session:sessionEl};
