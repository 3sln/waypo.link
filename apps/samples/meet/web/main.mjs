// Meet boot. Integration patterns shown: a public join link with a guest view (anyone can open it signed out); sign-in
// with the person's own provider (full-page redirect, the handle form of <bindle-sign-in>) to call; a provider-held
// approval of Meet's call kind (the provider's own page, opened from Meet); and a direct WebRTC call between people on
// two different providers over Bindle signaling.
import '../../../../packages/sdk/src/define.mjs';
import {reconcile} from '../../../../vendor/dodo/index.js';
import {BindleClient} from '../../../../packages/sdk/src/identity.mjs';
import {indexedDBKeyStore} from '../../../../packages/sdk/src/dpop.mjs';
import {createI18n} from '../../kit/web/i18n.mjs';
import {resourceField,accountLabel} from '../../kit/web/bindle.mjs';
import {createMeetEngine} from './bl.mjs';
import {CATALOGUES} from './i18n.mjs';
import {headerStart,mainView} from './ui.mjs';
import {SIGNALING_FRAGMENT,SIGNALING_CONTRACT,SIGNALING_METHODS,CALL_KIND} from './constants.mjs';
import {signalingEndpoint,offerDigest,claims} from './signaling.mjs';
import {createCall,previewStream} from './call.mjs';

const origin=location.origin,clientId=origin+'/bindle/client.json',STORE_KEY='meet.v1',PENDING_KEY='meet.pending';
const requests=[{fragment:SIGNALING_FRAGMENT,required:true,purpose:'Place and receive video calls with people you invite.',fields:['signaling'],methods:{signaling:{[SIGNALING_CONTRACT]:[...SIGNALING_METHODS]}}}];
const safe=fn=>{try{return fn();}catch{return null;}};
const local={async load(){return safe(()=>JSON.parse(localStorage.getItem(STORE_KEY)));},async save(value){safe(()=>localStorage.setItem(STORE_KEY,JSON.stringify(value)));}};
const saved=safe(()=>JSON.parse(localStorage.getItem(STORE_KEY)))??{};
const i18n=createI18n(CATALOGUES,saved.locale??navigator.language);

const app=document.querySelector('#app'),template=document.createElement('template');
template.innerHTML=`<bindle-session client-metadata="${clientId}" redirect-uri="${origin}/bindle/callback" default-host="none" islands="off" presentation="redirect" no-callback>
 <div class="shell"><header class="topbar"><div class="topbar-start"></div><div class="topbar-end"><bindle-account actions="switch manage sign-out"></bindle-account></div></header><main class="view"></main></div>
 <dialog class="sheet signin-sheet" aria-labelledby="signin-title"><div class="sheet-body"><img src="/apps/samples/meet/web/icon.svg" alt="" width="44" height="44" class="mark"><h2 id="signin-title"></h2><p class="signin-copy"></p><bindle-sign-in identity-required></bindle-sign-in><button type="button" class="btn ghost signin-close"></button></div></dialog>
</bindle-session>`;
const fragment=document.importNode(template.content,true);
fragment.querySelector('bindle-session').client=new BindleClient({clientMetadataUrl:clientId,redirectUri:`${origin}/bindle/callback`,defaultHost:'none',keyStore:indexedDBKeyStore()});
app.append(fragment);
const $=selector=>app.querySelector(selector),sessionEl=$('bindle-session'),accountEl=$('bindle-account'),signInDialog=$('.signin-sheet');
sessionEl.requests=requests;
const client=()=>sessionEl.client;

// ---- the meetings provider: signaling, the meeting directory and the call ------------------------------------------
let lastError=null,endpoint=null,resource=null,call=null,media=null,hostKey=null,offers=new Set();const invites=new Map();
const coded=(message,code,extra={})=>Object.assign(new Error(message),{code,...extra});
/** The provider's page for approving Meet's call kind. `approval_required` carries it (signaling §20.1.4); the SDK
 * surfaces only the code today, so Meet builds the same page address from the issuer when the URL is absent. */
const approvalUrl=issuer=>{const url=new URL('/console',issuer);url.searchParams.set('view','signaling');url.searchParams.set('page','approve');url.searchParams.set('client',clientId);url.searchParams.set('kind',CALL_KIND);return url.href;};
async function signaling(method,args){
 try{return await resource.call(SIGNALING_CONTRACT,method,args);}
 catch(error){lastError={method,code:error?.code??null,message:String(error?.message??error).slice(0,200)};if(error?.code==='approval_required'||/not approved/i.test(error?.message??''))throw coded(error.message,'approval_required',{url:error.url??approvalUrl(client().session.issuer)});throw error;}
}
function ensureEndpoint(){
 if(!endpoint){resource=resourceField(client(),SIGNALING_FRAGMENT,'signaling');endpoint=signalingEndpoint({call:signaling,kinds:[CALL_KIND],label:'Meet'});}
 return endpoint;
}
async function listening(){const ep=ensureEndpoint();await ep.register();ep.listen(onEvent,{onError:error=>console.warn('Meet listen',error?.message)});return ep;}
function startMedia(role=meet.read().meeting?.role){if(!media){const s=meet.read();media=previewStream({label:s.name.trim()||s.account?.label||'',hue:role==='host'?232:24});}return media;}
const emit=(kind,detail)=>{if(kind==='remote'){remoteStream=detail.stream;attach();return;}send('callEvent',kind==='state'?detail:kind==='chat'?{chat:detail}:kind==='error'?{error:detail}:{});};
let remoteStream=null;
async function onEvent(event){
 // An `invite` reaches the endpoint that minted the offer it spends (offer_match, §5.5). Meet still checks that the
 // invite's basis is one of its own live offers before ringing (§5.5: an app must not rely on the flag alone).
 if(event.type==='invite'){
  const invite=claims(event.invite),digest=invite?.body?.basis?.offer_digest,mine=[...offers].length&&(await Promise.all([...offers].map(offerDigest))).includes(digest);
  if(!mine||meet.read().meeting?.role!=='host')return;
  invites.set(event.sid,event);
  const p=event.projection??{};await send('incoming',{sid:event.sid,label:p.handle??null,issuer:p.initiator?.iss??null});return;
 }
 if(call)await call.onEvent(event);
}
/** The signaling principal {iss, sub} of an app-session subject. A 3sln.me app session names the person by entity URI
 * (`<issuer>/entities/<id>`) while signaling addresses `{iss, sub}` with the bare id (signaling §5.1); there is no SDK
 * helper for this mapping yet, so Meet derives it and accepts a bare id unchanged. */
const principal=({issuer,subject})=>{const m=/^(https:\/\/[^/]+)\/entities\/([0-9a-f-]{36})$/.exec(subject);return {iss:issuer,sub:m&&m[1]===issuer?m[2]:subject};};
const api=async(path,init={})=>{const r=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init.headers??{}},credentials:'same-origin'});const body=await r.json().catch(()=>null);if(!r.ok)throw coded(body?.field?`${body.error}: ${body.field}`:body?.error??'request failed',body?.error??'http_'+r.status);return body;};
const meetings={
 async card(id){try{return await api(`/api/meetings/${id}`);}catch{return null;}},
 async create({title,host}){
  const ep=await listening();
  // An open offer: anyone holding the join link may ask to join, up to four times within fifteen minutes (§5.7).
  const minted=await ep.offer({kind:CALL_KIND,profile:'webrtc',uses:4,expires_in:900}),token=minted.offers[0].offer;offers.add(token);
  const created=await api('/api/meetings',{method:'POST',body:JSON.stringify({title,host:{label:host.label,issuer:host.issuer,subject:host.subject},offer:token,expiresAt:minted.expires_at*1000})});
  hostKey=created.hostKey;history.pushState(null,'',`/j/${created.id}`);startMedia('host');queueMicrotask(attach);
  return {...created,expiresAt:minted.expires_at*1000};
 },
 async join({meeting,label}){
  const joined=await api(`/api/meetings/${meeting}/join`,{method:'POST',body:'{}'});
  const ep=await listening();startMedia();call?.hangUp();remoteStream=null;
  call=createCall({role:'initiator',endpoint:ep,local:media.stream,emit,label});
  await call.open({host:principal(joined.host),offer:joined.offer});
 },
 async accept({sid,label}){
  const event=invites.get(sid);if(!event)throw coded('This request is no longer available.','gone');invites.delete(sid);
  startMedia();call?.hangUp();remoteStream=null;call=createCall({role:'recipient',endpoint:await listening(),local:media.stream,emit,label});await call.accept(event);
 },
 async decline({sid}){const event=invites.get(sid);invites.delete(sid);if(!event)return;const declining=createCall({role:'recipient',endpoint:await listening(),local:new MediaStream(),emit:()=>{},label:''});await declining.decline(event);},
 say(text){call?.say(text);},
 async hangUp(){await call?.hangUp();},
 async leave(){
  await call?.hangUp();call=null;remoteStream=null;
  if(hostKey&&meet.read().meeting){await api(`/api/meetings/${meet.read().meeting.id}/end`,{method:'POST',body:JSON.stringify({hostKey})}).catch(()=>{});hostKey=null;if(offers.size)await endpoint?.revokeOffers([...offers]).catch(()=>{});offers.clear();}
  media?.stop();media=null;if(location.pathname!=='/')history.pushState(null,'','/');
 }
};
const meet=createMeetEngine({local,meetings,locale:i18n.locale});
const send=(name,input)=>meet.run(name,input).catch(error=>console.warn('Meet operation failed',name,error?.message));
const hooks={async copy(link){try{await navigator.clipboard.writeText(link);}catch{}send('copied');}};

// ---- rendering ------------------------------------------------------------------------------------------------------
let lastToast=null,toastTimer=null;
function attach(){
 for(const video of app.querySelectorAll('video.local'))if(media&&video.srcObject!==media.stream){video.srcObject=media.stream;video.play?.().catch(()=>{});}
 for(const video of app.querySelectorAll('video.remote'))if(remoteStream&&video.srcObject!==remoteStream){video.srcObject=remoteStream;video.play?.().catch(()=>{});}
}
function render(s){
 i18n.locale=s.locale;document.documentElement.lang=s.locale;sessionEl.setAttribute('lang',s.locale);document.title=s.meeting&&s.phase!=='home'?`${s.meeting.title} · ${i18n.t('app.name')}`:i18n.t('app.name');
 if(s.theme==='system'){delete document.documentElement.dataset.theme;sessionEl.removeAttribute('theme');}else{document.documentElement.dataset.theme=s.theme;sessionEl.setAttribute('theme',s.theme);}
 const t=i18n.t;accountEl.setAttribute('sign-in-prompt',t('account.prompt'));
 if(['lobby','joining','ringing','connecting','in-call'].includes(s.phase)&&s.meeting){const name=s.name.trim()||s.account?.label||'';if(media&&media.label!==name&&s.phase==='lobby'){media.stop();media=null;}if(!media){startMedia(s.meeting.role);media.label=name;}}
 reconcile($('.topbar-start'),headerStart(s,t,send));reconcile($('.view'),mainView(s,t,i18n,send,hooks));attach();
 const joining=s.route.name==='meeting'&&s.meeting;
 $('#signin-title').textContent=joining?t('guest.signInTitle',{title:s.meeting.title}):t('home.signedOut.title');$('.signin-copy').textContent=joining?t('guest.signInBody'):t('home.signedOut.body');$('.signin-close').textContent=t('signin.close');
 if(s.signIn&&!signInDialog.open){safe(()=>sessionStorage.setItem(PENDING_KEY,location.pathname));signInDialog.showModal();}else if(!s.signIn&&signInDialog.open)signInDialog.close();
 if(s.toast&&s.toast.at!==lastToast){lastToast=s.toast.at;clearTimeout(toastTimer);toastTimer=setTimeout(()=>send('dismissToast'),3200);}
}
meet.subscribe(render);
$('.signin-close').addEventListener('click',()=>send('panel',{signIn:false}));
signInDialog.addEventListener('close',()=>{if(meet.read().signIn)send('panel',{signIn:false});});
signInDialog.addEventListener('click',event=>{if(event.target===signInDialog)signInDialog.close();});
addEventListener('popstate',()=>send('route',{meeting:/^\/j\/([a-z0-9]{10})$/.exec(location.pathname)?.[1]??null}));
addEventListener('pagehide',()=>{call?.hangUp();});

sessionEl.addEventListener('bindle-session-change',async event=>{
 const view=event.detail;
 if(view){endpoint=null;resource=null;await send('connected',{issuer:view.issuer,subject:view.subject,label:accountLabel(view)});}
 else{endpoint?.stop();endpoint=null;resource=null;await call?.hangUp();call=null;await send('disconnected',{});}
});

// ---- boot -----------------------------------------------------------------------------------------------------------
await send('load');
if(location.pathname==='/bindle/callback'){
 const callbackUrl=location.href;await sessionEl.ready;const state=new URL(callbackUrl).searchParams.get('state');
 // The redirect returns here; go back to the page the person signed in from (a meeting link, or home).
 const back=safe(()=>sessionStorage.getItem(PENDING_KEY));safe(()=>sessionStorage.removeItem(PENDING_KEY));
 history.replaceState(null,'',/^\/(j\/[a-z0-9]{10})?$/.test(back??'')?back:'/');
 await send('route',{meeting:/^\/j\/([a-z0-9]{10})$/.exec(location.pathname)?.[1]??null});
 if(state&&client()?.readPending(state))await sessionEl.completeCallback(callbackUrl).catch(error=>console.warn('Meet sign-in',error?.message));
}else await send('route',{meeting:/^\/j\/([a-z0-9]{10})$/.exec(location.pathname)?.[1]??null});
// Read-only hooks for automated checks (the simulation asserts call state and the data channel round trip).
window.__meet={engine:meet,session:sessionEl,get lastError(){return lastError;},get call(){return call;},async route(){return call?.route();}};
