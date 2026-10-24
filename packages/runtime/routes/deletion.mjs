// DX-5. These routes run before activity/admission; cancel links run without session authority. All state
// changes dispatch DX-3's engine operations via its existing account RPC facades. Mounting is a coordinator hunk.
import {Action,Query} from '../../../vendor/ngin/index.js';
import {isUUID} from '../../core/primitives.mjs';
import {deletionLocalization} from '../../i18n/deletion-catalogue.mjs';
import {DELETION_CANCEL_PATH} from '../deletion-notices.mjs';
import {json,body,privateHeaders,routeFlags,accountHandle,pseudonym,subnet} from './shared.mjs';

const ROOT='/api/account/deletion',CANCEL=ROOT+'/cancel',TOKEN=ROOT+'/cancel-token',SCRIPT=DELETION_CANCEL_PATH+'.mjs';
const fail=(code,message,status)=>{throw Object.assign(new Error(message),{code,status});};
const invalid=()=>json({error:'invalid_token',message:'This link is no longer valid.'},400);
const empty=input=>{if(Object.keys(input).length)fail('invalid_request','Unsupported deletion request.',400);};
function originGuard(request,env,mutation=false){if(new URL(request.url).origin!==env.APP_ORIGIN)fail('invalid_origin','Use the configured account domain.',403);const origin=request.headers.get('Origin');if(mutation?origin!==env.APP_ORIGIN:origin!==null&&origin!==env.APP_ORIGIN)fail('csrf','Reload the account page before continuing.',403);if(['cross-site','same-site'].includes(request.headers.get('Sec-Fetch-Site')))fail('csrf','Reload the account page before continuing.',403);}
function background(env,owner){try{return routeFlags(env,{subject:{kind:'account',owner}}).background('ACCOUNT_DELETION_ENABLED')===true;}catch{return false;}}
function method(request,path){const allow=allowedMethods(path);return allow&&!allow.includes(request.method)?json({error:'method_not_allowed'},405,{Allow:allow.join(', ')}):null;}
export function allowedMethods(path){return path===ROOT?['GET','POST']:[CANCEL,TOKEN].includes(path)?['POST']:[DELETION_CANCEL_PATH,SCRIPT].includes(path)?['GET','HEAD']:null;}
export const admission={exempt:path=>[ROOT,CANCEL,TOKEN].includes(path)};

/** Read only the evidence the account engine needs; never return identity secrets to the route or browser. */
export class DeletionStepUp extends Query{
 static deps=['identity'];constructor(context){super();this.context=context;}
 async fetch({identity}){const {account,session,sessionId}=await identity.privileged({...this.context,requireCurrentTerms:false},300000);return {owner:account.id,stepUpAt:session.stepUpAt,sessionId};}
}
/** Client transport Action. It carries a cancel capability only; no session, cookies or account response. */
// A self-contained factory survives bundler class renaming when embedded in the browser module.
function cancelLinkAction(Action){return class extends Action{
 static deps=['api'];constructor(input){super();this.input=input;}
 async execute({api},{dispatchFeed}){const result=await api.cancel(this.input);dispatchFeed.dispatchEvent(new CustomEvent('result',{detail:result}));}
};}
export const CancelDeletionLink=cancelLinkAction(Action);
async function cancelBudget(request,env){
 const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;if(!secret||typeof env.ABUSE?.consume!=='function')fail('deletion_unavailable','Account deletion is temporarily unavailable.',503);
 const ip=request.headers.get('CF-Connecting-IP')||(env.LOCAL_DEVELOPMENT==='true'?'127.0.0.1':'unknown');
 for(const [scope,value,limit]of [['ip',ip,30],['network',subnet(ip),120]])if(!await env.ABUSE.consume('deletion-cancel:'+scope+':'+await pseudonym(value,secret),{windowMs:60000,limit}))return json({error:'rate_limited',message:'Please wait before trying again.'},429,{'Retry-After':'60'});
}
/** Wargame 4 L1: owner request and cancel are budgeted per session and per network (the request/cancel loop). */
async function sessionBudget(request,env,session){
 const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;if(!secret||typeof env.ABUSE?.consume!=='function')fail('deletion_unavailable','Account deletion is temporarily unavailable.',503);
 const ip=request.headers.get('CF-Connecting-IP')||(env.LOCAL_DEVELOPMENT==='true'?'127.0.0.1':'unknown');
 for(const [scope,value,limit]of [['session',String(session??'none'),10],['network',subnet(ip),60]])if(!await env.ABUSE.consume('deletion-owner:'+scope+':'+await pseudonym(value,secret),{windowMs:600000,limit}))return json({error:'rate_limited',message:'Please wait before trying again.'},429,{'Retry-After':'600'});
}
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const scriptJSON=value=>JSON.stringify(value).replaceAll('<','\\u003c');
export function deletionCancelScript(locale='en'){
 const {t}=deletionLocalization(locale),messages=scriptJSON({done:t('Deletion cancelled. You can sign in to review your account.'),invalid:t('This link is invalid or no longer available. Sign in to review your account.'),failed:t('We could not confirm cancellation. Try again or sign in to review your account.')});
 return `import {Engine,Provider,Action} from '/vendor/ngin/index.js';\nconst CancelDeletionLink=(${cancelLinkAction.toString()})(Action);\nconst messages=${messages},fragment=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'',location.pathname+location.search);const form=document.querySelector('form'),button=form.querySelector('button'),status=document.querySelector('[role=status]');let input={owner:fragment.get('owner'),token:fragment.get('token')},busy=false;const valid=[...fragment.keys()].length===2&&fragment.getAll('owner').length===1&&fragment.getAll('token').length===1&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.owner??'')&&/^[A-Za-z0-9_-]{43}$/.test(input.token??'');fragment.delete('token');fragment.delete('owner');const api={cancel:async value=>{const response=await fetch('${TOKEN}',{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json','X-Bindle-Cancel':'1'},body:JSON.stringify(value)});if(!response.ok)throw Object.assign(new Error('cancel_failed'),{invalid:response.status===400});const result=await response.json();if(result.cancelled!==true)throw Error('cancel_failed');return {cancelled:true};}},engine=new Engine({providers:{api:Provider.fromSingleton(api)}});button.disabled=!valid;if(!valid){input=null;status.textContent=messages.invalid;}form.addEventListener('submit',async event=>{event.preventDefault();if(!input||busy)return;busy=true;button.disabled=true;status.textContent='';try{await engine.dispatch(new CancelDeletionLink(input)).next('complete');input=null;status.textContent=messages.done;}catch(error){status.textContent=error.invalid?messages.invalid:messages.failed;button.disabled=false;}finally{busy=false;}});`;
}
async function cancelPage({request,env,url}){
 const locale=url.searchParams.get('lang')==='es'?'es':'en',{t}=deletionLocalization(locale);
 // Reuse the shipped 3sln graph and its import-map hash. No new build entry or server source is published.
 const asset=await env.ASSETS.fetch(new Request(new URL('/build-manifest.json',url)));let manifest;try{manifest=await asset.json();}catch{}
 if(!asset.ok||!manifest?.imports?.['/vendor/ngin/index.js']||!/^sha256-[A-Za-z0-9+/]{43}=$/.test(manifest.importMapCSP??''))return json({error:'deletion_unavailable'},503);
 const map=scriptJSON({imports:manifest.imports});
 const html=`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(t('Cancel account deletion'))}</title></head><body><main><h1>${escape(t('Cancel account deletion'))}</h1><p>${escape(t('Confirm to cancel the scheduled deletion. This does not sign you in.'))}</p><form><button type="submit" disabled>${escape(t('Cancel deletion'))}</button></form><p role="status" aria-live="polite"></p><p><a href="/console">${escape(t('Sign in'))}</a></p><noscript>${escape(t('JavaScript is required to use this link. You can also sign in to cancel deletion.'))}</noscript></main><script type="importmap">${map}</script><script type="module" src="${SCRIPT}?lang=${locale}"></script></body></html>`;
 // Recompute the hash: escaping '<' can change JSON bytes from the build's map serialization.
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(map))),hash=btoa(String.fromCharCode(...digest));
 return new Response(request.method==='HEAD'?null:html,{headers:{...privateHeaders,'Content-Type':'text/html; charset=utf-8','Content-Language':locale,'X-Robots-Tag':'noindex, nofollow, nosnippet','Cross-Origin-Opener-Policy':'same-origin','Content-Security-Policy':`default-src 'none'; script-src 'self' 'sha256-${hash}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`}});
}
export const stages={
 async public(route){
  const {request,env,path,url}=route;if(![DELETION_CANCEL_PATH,SCRIPT].includes(path))return;
  originGuard(request,env);const denied=method(request,path);if(denied)return denied;if(!background(env))return json({error:'deletion_unavailable'},503);
  if([...url.searchParams.keys()].some(name=>name!=='lang')||url.searchParams.getAll('lang').length>1)return json({error:'invalid_request'},400);
  if(path===SCRIPT)return new Response(request.method==='HEAD'?null:deletionCancelScript(url.searchParams.get('lang')==='es'?'es':'en'),{headers:{...privateHeaders,'Content-Type':'text/javascript; charset=utf-8','Cross-Origin-Resource-Policy':'same-origin'}});
  return cancelPage(route);
 },
 async unauthenticated({request,env,path,url}){
  if(path!==TOKEN)return;originGuard(request,env,true);const denied=method(request,path);if(denied)return denied;
  if(url.search)return invalid();if(request.headers.get('X-Bindle-Cancel')!=='1')return json({error:'csrf'},403);
  const limited=await cancelBudget(request,env);if(limited)return limited;
  const input=await body(request,1024);if(Object.keys(input).length!==2||!isUUID(input.owner)||typeof input.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token))return invalid();
  if(!background(env,input.owner))return json({error:'deletion_unavailable'},503);
  try{await accountHandle(env,input.owner).deletionCancelToken(input.owner,{token:input.token});return json({cancelled:true});}
  catch(error){if(['invalid_token','not_found','forbidden','account_deleted','account_deleting','deletion_in_progress','deletion_not_cancellable','account_unavailable'].includes(error.code))return invalid();throw error;}
 },
 async beforeActivity({request,env,path,url,engine,context,id,object,owner}){
  if(![ROOT,CANCEL].includes(path))return;originGuard(request,env,request.method==='POST');const denied=method(request,path);if(denied)return denied;
  if(url.search)fail('invalid_request','Unsupported deletion request.',400);
  if(request.method==='POST'&&(typeof context.csrfToken!=='string'||context.csrfToken!==owner.csrfToken))return json({error:'csrf'},403);
  const flags=routeFlags(env,{subject:{kind:'account',owner:id}});
  if(request.method==='POST'){const limited=await sessionBudget(request,env,owner.sessionContext);if(limited)return limited;}
  if(path===ROOT&&request.method==='POST'){
   if(!flags.enabled('ACCOUNT_DELETION_ENABLED'))return json({error:'not_found'},404);
   const input=await body(request,4096),evidence=await engine.query(new DeletionStepUp(context)).peek();
   if(evidence.owner!==id)fail('account_context_conflict','Reload the account chooser before continuing.',409);
   return json(await object.deletionRequest(id,input,{stepUpAt:evidence.stepUpAt,sessionId:evidence.sessionId}));
  }
  // Status follows no flag (an existing request stays visible through a ramp-down); with the flag off and no
  // request, the route answers exactly as before it existed.
  if(path===ROOT){const status=await object.deletionStatus(id);if(status?.state==='none'&&!flags.enabled('ACCOUNT_DELETION_ENABLED'))return json({error:'not_found'},404);return json(status);}
  if(!background(env,id))return json({error:'deletion_unavailable'},503);
  empty(await body(request,128));return json(await object.deletionCancel(id));
 },
};
