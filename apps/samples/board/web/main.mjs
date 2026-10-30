// Board boot: the static shell around the @3sln/bindle elements, the engine providers, the live-update loop, rendering.
// Integration pattern shown: sign-in required. Everything lives behind <bindle-gate>; its signed-out card (with the
// SDK's own <bindle-sign-in>) is the only thing a signed-out visitor sees. The header carries <bindle-account>, which
// composes the person's avatar with the organization's once Board acts for one.
import '../../../../packages/sdk/src/define.mjs';
import {reconcile} from '../../../../vendor/dodo/index.js';
import {BindleClient} from '../../../../packages/sdk/src/identity.mjs';
import {indexedDBKeyStore,createProof} from '../../../../packages/sdk/src/dpop.mjs';
import {acquireMemberCertificate} from '../../../../packages/sdk/src/member.mjs';
import {createI18n} from '../../kit/web/i18n.mjs';
import {jsonStore,resourceField,sendAppMessage,accountLabel,APP_MESSAGES_FRAGMENT,APP_MESSAGES_CONTRACT} from '../../kit/web/bindle.mjs';
import {createBoardEngine} from './bl.mjs';
import {CATALOGUES} from './i18n.mjs';
import {topbarStart,topbarActions,boardView,orgSheet} from './ui.mjs';

const BOARD_FRAGMENT='https://board.example/fragments/boards/v1',BUS_FRAGMENT='https://board.example/buses/board-changes/v1';
const STORAGE_CONTRACT='https://3sln.me/artefacts/contracts/object-storage/v1',EVENT_BUS_CONTRACT='https://spec.bindle.example/contracts/event-bus/v1';
const origin=location.origin,clientId=origin+'/bindle/client.json',redirectUri=origin+'/bindle/callback',PREFS_KEY='board.v1';
const requests=[
 {fragment:BOARD_FRAGMENT,required:true,purpose:'Keep your boards and cards in storage you choose.',fields:['store'],methods:{store:{[STORAGE_CONTRACT]:['capabilities','get','put','delete']}}},
 {fragment:BUS_FRAGMENT,required:false,purpose:'Keep your open boards up to date as cards change.',fields:['bus'],methods:{bus:{[EVENT_BUS_CONTRACT]:['read','publish']}}},
 {fragment:APP_MESSAGES_FRAGMENT,required:false,purpose:'Tell you when a card is assigned to you.',fields:['messages'],methods:{messages:{[APP_MESSAGES_CONTRACT]:['createOwn']}}}
];
const safe=fn=>{try{return fn();}catch{return null;}};
const local={async load(){return safe(()=>JSON.parse(localStorage.getItem(PREFS_KEY)));},async save(value){safe(()=>localStorage.setItem(PREFS_KEY,JSON.stringify(value)));}};
const saved=safe(()=>JSON.parse(localStorage.getItem(PREFS_KEY)))??{};
const i18n=createI18n(CATALOGUES,saved.locale??navigator.language);

// ---- static shell ---------------------------------------------------------------------------------------------------
const app=document.querySelector('#app'),template=document.createElement('template');
template.innerHTML=`<bindle-session client-metadata="${clientId}" redirect-uri="${redirectUri}" default-host="none" presentation="redirect" islands="off" no-callback>
 <div class="shell"><header class="topbar"><div class="topbar-start"></div><div class="topbar-end"><div class="topbar-actions"></div><bindle-account actions="accounts switch manage sign-out" trigger="auto"></bindle-account></div></header>
 <main class="view"><bindle-gate><h2 slot="heading" class="gate-heading"></h2><span slot="lead" class="gate-lead"></span><div class="board"></div></bindle-gate></main></div>
 <dialog class="sheet org-sheet" aria-labelledby="org-title"><div class="sheet-body org-body"></div></dialog>
</bindle-session>`;
const fragment=document.importNode(template.content,true);
fragment.querySelector('bindle-session').client=new BindleClient({clientMetadataUrl:clientId,redirectUri,defaultHost:'none',keyStore:indexedDBKeyStore()});
app.append(fragment);
const $=selector=>app.querySelector(selector),sessionEl=$('bindle-session'),accountEl=$('bindle-account'),gateEl=$('bindle-gate'),orgDialog=$('.org-sheet');
sessionEl.requests=requests;
const client=()=>sessionEl.client;

// ---- providers ------------------------------------------------------------------------------------------------------
let store=null,busRef=null,certificate=null;
const remote={read:key=>store.read(key),write:(key,value,version)=>store.write(key,value,version)};
const bus={async publish(type,data){if(!busRef)return null;return busRef.call(EVENT_BUS_CONTRACT,'publish',{type,data});}};
const messages={send:message=>sendAppMessage(client(),message)};
const directory={async resolve(handle,host){
 if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host))throw new Error('address');
 const response=await fetch(`https://${host}/bindle/directory?handle=${encodeURIComponent(handle+'@'+host)}`,{credentials:'omit',redirect:'error'});
 if(!response.ok)throw new Error('not-found');const body=await response.json();
 if(typeof body.identity!=='string'||new URL(body.identity).origin!==`https://${host}`||!/^\/identity\/[0-9a-f-]{36}$/.test(new URL(body.identity).pathname))throw new Error('not-found');return body;}};
/** The member-context token: RFC 7523 jwt-bearer at the organization's token endpoint, DPoP with the holder key. */
const member={async exchange(){
 if(!certificate)throw Object.assign(new Error('no certificate'),{code:'failed'});
 const tokenEndpoint=new URL('/oauth/token',certificate.aud).href,body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:certificate.certificate,client_id:clientId});
 let nonce;
 for(let attempt=0;attempt<2;attempt++){
  const proof=await createProof(certificate.holder,{htu:tokenEndpoint,htm:'POST',nonce});
  const response=await fetch(tokenEndpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/x-www-form-urlencoded',DPoP:proof},body:body.toString()});
  const json=await response.json().catch(()=>({}));
  if(response.ok&&json.access_token){certificate.token={value:json.access_token,expiresAt:Date.now()+json.expires_in*1000,member:json.bindle_member};return certificate.token;}
  if(json.error==='use_dpop_nonce'&&response.headers.get('DPoP-Nonce')&&!nonce){nonce=response.headers.get('DPoP-Nonce');continue;}
  throw Object.assign(new Error(json.error??'failed'),{code:json.error??'failed'});
 }}};
const board=createBoardEngine({local,remote,bus,messages,directory,member,locale:i18n.locale});
const send=(name,input)=>board.run(name,input).catch(error=>console.warn('Board operation failed',name,error?.message));

// ---- live updates: a long-poll on the personal bus (events §4 `read` with `wait`) -------------------------------------
// The loop keeps the cursor it was given and never skips: a gap reloads the board from storage. Until the first read
// succeeds, and after any failure, it retries with a gentle backoff (the reader allowance is two reads a second).
const liveLog=[];let liveGeneration=0;
async function liveLoop(generation){
 const call=(args)=>busRef.call(EVENT_BUS_CONTRACT,'read',args);
 await send('live',{status:'connecting'});
 let cursor=null,failures=0;
 while(generation===liveGeneration&&busRef){
  try{
   const result=cursor?await call({cursor,wait:20,limit:50}):await call({start:'latest',limit:1});
   if(generation!==liveGeneration)return;
   liveLog.push({cursor:result.cursor,previous:cursor,records:result.records?.length??0,gap:result.gap!==null&&result.gap!==undefined&&result.gap!==false,payloads:(result.records??[]).map(r=>r.data??null)});
   failures=0;
   if(!cursor){cursor=result.cursor;await send('live',{status:'live',cursor});continue;}
   cursor=result.cursor;
   if(liveLog.at(-1).gap)await send('refresh');
   if(result.records?.length)await send('remoteChange',{record:result.records.at(-1),cursor});
   if(board.read().live.status!=='live')await send('live',{status:'live'});
  }catch(error){
   if(generation!==liveGeneration)return;
   // Keep trying (a closed tab, a rate limit or a provider restart is temporary); say so after a few misses.
   failures++;if(cursor&&failures>2&&board.read().live.status!=='error')await send('live',{status:'error'});
   await new Promise(r=>setTimeout(r,Math.min(8000,700*failures)));
  }
 }
}
function startLive(){liveGeneration++;if(busRef)liveLoop(liveGeneration);else send('live',{status:'off'});}

// ---- rendering ------------------------------------------------------------------------------------------------------
const hooks={
 assign:card=>send('assign',{card:card.id,subject:title=>i18n.t('msg.subject',{title}),body:title=>i18n.t('msg.body',{title})}),
 // Called from the click: the popup must open inside the user's gesture (acquireMemberCertificate opens it).
 useOrg(){
  const s=board.read(),session=client()?.session;if(!session||!s.org.identity)return;
  const pending=acquireMemberCertificate({issuer:session.issuer,aud:s.org.identity,clientId,redirectUri});
  send('orgCertifying');
  pending.then(async result=>{certificate={...result,aud:s.org.identity};accountEl.entity={subject:s.org.identity,name:`${s.org.handle}@${s.org.host}`};await send('orgCertified',{exp:result.exp});},
   error=>send('orgFailed',{code:error?.code}));
 }
};
let toastTimer=null,lastToast=null;
function render(s){
 i18n.locale=s.locale;const t=i18n.t;document.documentElement.lang=s.locale;sessionEl.setAttribute('lang',s.locale);document.title=t('app.name');
 if(s.theme==='system'){delete document.documentElement.dataset.theme;sessionEl.removeAttribute('theme');}else{document.documentElement.dataset.theme=s.theme;sessionEl.setAttribute('theme',s.theme);}
 accountEl.setAttribute('sign-in-prompt',t('signin.prompt'));
 $('.gate-heading').textContent=t('gate.heading');$('.gate-lead').textContent=t('gate.lead');
 reconcile($('.topbar-start'),topbarStart(s,t));reconcile($('.topbar-actions'),topbarActions(s,t,send));
 reconcile($('.board'),boardView(s,t,send,hooks));
 reconcile($('.org-body'),orgSheet(s,t,send,hooks));
 if(s.panel==='org'&&!orgDialog.open)orgDialog.showModal();else if(s.panel!=='org'&&orgDialog.open)orgDialog.close();
 if(!['pending','member','exchanging','certifying'].includes(s.org.phase)&&accountEl.entity){accountEl.entity=null;certificate=null;}
 let toastEl=$('.toast');
 if(s.toast){if(!toastEl){toastEl=document.createElement('div');toastEl.className='toast';toastEl.setAttribute('role','status');app.append(toastEl);}toastEl.textContent=t(s.toast.key,s.toast.vars);}else toastEl?.remove();
 if(s.toast&&s.toast.at!==lastToast){lastToast=s.toast.at;clearTimeout(toastTimer);toastTimer=setTimeout(()=>send('dismissToast'),3600);}
}
board.subscribe(render);
orgDialog.addEventListener('close',()=>{if(board.read().panel)send('panel',{panel:null});});
orgDialog.addEventListener('click',event=>{if(event.target===orgDialog)orgDialog.close();});

// ---- the Bindle session ---------------------------------------------------------------------------------------------
sessionEl.addEventListener('bindle-session-change',async event=>{
 const view=event.detail;
 if(view){
  store=jsonStore(client(),BOARD_FRAGMENT,'store');
  const fragments=view.grantedFragments.map(g=>g.fragment);busRef=fragments.includes(BUS_FRAGMENT)?resourceField(client(),BUS_FRAGMENT,'bus'):null;
  if(location.pathname==='/bindle/callback')history.replaceState(null,'','/');
  await send('connected',{issuer:view.issuer,subject:view.subject,label:accountLabel(view)});startLive();
 }else{store=null;busRef=null;liveGeneration++;await send('disconnected',{});}
});

await send('load');
if(location.pathname==='/bindle/callback'){await sessionEl.ready;const state=new URL(location.href).searchParams.get('state');if(state&&client()?.readPending(state))await sessionEl.completeCallback(location.href);else history.replaceState(null,'','/');}
// Read-only hooks for automated checks (the simulation reads state and the live loop's cursor log).
window.__board={engine:board,session:sessionEl,gate:gateEl,liveLog,get certificate(){return certificate?{exp:certificate.exp,aud:certificate.aud,token:!!certificate.token}:null;},async storedBoard(){return store?(await store.read('boards/main.json'))?.value??null:null;}};
