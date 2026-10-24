// ORG-12b/12e: the break-glass abort link (docs/architecture/organizations-design.md §12d.3 tier 0, §12d.8 "Notices" and
// rate limits). Provisional (coordinator), not signed off by the user. Modelled on the recovery-reissue cancel page
// (routes/recovery-reissue.mjs).
//
// Owner notices mail `ORG_CLAIM_ABORT_PATH#org=<org>&token=bg1.<claim>.<token id>.<secret>&handle=<org handle>` (and push
// the same path). Opening the page changes nothing (mail scanners): the capability stays in the fragment and the script
// removes it from the address bar. The POST to /api/org-claim/abort needs no sign-in, never signs in and is never gated by
// any flag (an abort is the safe direction).
//
// Review 2026-10-23 M2 (coordinator decision, provisional): tier-0 semantics stay, so the owner's link still aborts, but a
// scanner that runs the page's script must also supply what a person does:
//   - a real user-activation gesture on submit (checked in the page);
//   - typing the organization's handle shown on the page; the server requires `confirmed` to equal the organization's
//     handle from its identity record ('stop' when it has none);
//   - at least 2 seconds between the page render and the POST: the page carries a signed render time in a <meta> element
//     (no inline script, CSP-safe), and the server refuses earlier POSTs and pages older than 2 hours.
// Residual: a scanner that executes scripts, reads the fragment, waits and synthesizes trusted input can still abort. That
// only stops a claim (the safe direction); the claimants can start again later, within the locks and limits.
//
// Review L1: the per-address budget is checked without spending (`peek`) and charged only for refused or failed outcomes,
// so the owner's own successful stop never spends the budget of a network shared with attackers. An IPv6 address counts
// per /64. Every well-formed request gets the identical `{received:true}` whatever the token's fate (the writer returns
// its outcome privately); only an unreachable writer answers 503. Review L2: every POST past the budget check takes at
// least POST_FLOOR_MS, so the response time does not tell a valid token from a refused one.
import {privateHeaders,json,body,limit,accountHandle,subnet64} from './shared.mjs';
import {ORG_CLAIM_ABORT_PATH} from '../../identity/owner-channels.mjs';

export {ORG_CLAIM_ABORT_PATH};
export const ORG_CLAIM_ABORT_API='/api/org-claim/abort';
export const ORG_CLAIM_RENDER_MIN_MS=2000,ORG_CLAIM_RENDER_MAX_MS=2*3600000,POST_FLOOR_MS=250;
const SCRIPT=ORG_CLAIM_ABORT_PATH+'.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,TOKEN=/^bg1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/,HANDLE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TEXT={
 en:{title:'Stop an ownership claim',lead:'Someone asked 3sln.me to make another person the owner of an organization you own. If you did not agree to this, stop the claim. This does not sign you in, and nothing changes until you confirm below.',org:'Your organization:',type:'To confirm, type the organization handle shown above.',typeNone:'To confirm, type stop.',button:'Stop this claim',done:'Thank you. If this link was still valid, the claim is stopped and the organization stays yours. Sign in from a device you already use to review the organization, save a new recovery file and check its members.',invalid:'This link is incomplete. Open the whole link from the notice, or sign in to review the organization.',mismatch:'That does not match. Type the organization handle exactly as shown.',fast:'Please wait a moment, then press the button again.',expired:'This page is too old. Open the link from your notice again.',failed:'We could not send your answer. Try again, or sign in to review the organization.',limited:'Too many attempts from your network. Wait a few minutes and try again, or sign in to stop the claim from your account.',back:'Open your account'},
 es:{title:'Detener una reclamación de propiedad',lead:'Alguien pidió a 3sln.me que otra persona pase a ser propietaria de una organización que es tuya. Si no estás de acuerdo, detén la reclamación. Esto no inicia sesión y nada cambia hasta que confirmes abajo.',org:'Tu organización:',type:'Para confirmar, escribe el identificador de la organización que se muestra arriba.',typeNone:'Para confirmar, escribe stop.',button:'Detener esta reclamación',done:'Gracias. Si este enlace aún era válido, la reclamación se detuvo y la organización sigue siendo tuya. Inicia sesión desde un dispositivo que ya uses para revisar la organización, guardar un nuevo archivo de recuperación y comprobar sus miembros.',invalid:'Este enlace está incompleto. Abre el enlace completo del aviso o inicia sesión para revisar la organización.',mismatch:'No coincide. Escribe el identificador de la organización tal como se muestra.',fast:'Espera un momento y vuelve a pulsar el botón.',expired:'Esta página es demasiado antigua. Abre de nuevo el enlace del aviso.',failed:'No pudimos enviar tu respuesta. Vuelve a intentarlo o inicia sesión para revisar la organización.',limited:'Demasiados intentos desde tu red. Espera unos minutos y vuelve a intentarlo, o inicia sesión para detener la reclamación desde tu cuenta.',back:'Abrir tu cuenta'},
};
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const json_=value=>JSON.stringify(value).replaceAll('<','\\u003c');
const PAGE_CSP="default-src 'none'; script-src 'self'; img-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
const PAGE_HEADERS=locale=>({...privateHeaders,'Content-Type':'text/html; charset=utf-8','Content-Language':locale,'X-Robots-Tag':'noindex, nofollow, nosnippet','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':PAGE_CSP});
const normalized=value=>String(value??'').trim().replace(/^@/,'').toLowerCase();
const b64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
async function renderMac(env,at){const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;if(typeof secret!=='string'||!secret)return null;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('bindle-org-claim-render-v1\0'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(String(at)))));}
/** A signed render time for the page (`<at>.<mac>`), or '' when the host has no secret (the POST then refuses). */
export async function orgClaimRenderStamp(env,at=Date.now()){const mac=await renderMac(env,at);return mac?`${at}.${mac}`:'';}
/** Whether a stamp is genuine and its age is within [ORG_CLAIM_RENDER_MIN_MS, ORG_CLAIM_RENDER_MAX_MS]: 'ok' | 'fast' | 'expired' | 'invalid'. */
export async function orgClaimRenderCheck(env,stamp,now=Date.now()){
 const m=/^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(typeof stamp==='string'?stamp:'');if(!m)return 'invalid';
 const at=Number(m[1]),expected=await renderMac(env,at);if(!expected||expected.length!==m[2].length)return 'invalid';let d=0;for(let i=0;i<expected.length;i++)d|=expected.charCodeAt(i)^m[2].charCodeAt(i);if(d)return 'invalid';
 if(now-at<ORG_CLAIM_RENDER_MIN_MS)return 'fast';if(now-at>ORG_CLAIM_RENDER_MAX_MS)return 'expired';return 'ok';
}
/** The page script: reads and clears the fragment, shows the handle, and POSTs only on a trusted, user-activated submit
 * whose typed confirmation matches. */
export function orgClaimAbortScript(locale='en'){
 const t=TEXT[locale]??TEXT.en;
 return `const messages=${json_({done:t.done,invalid:t.invalid,mismatch:t.mismatch,fast:t.fast,expired:t.expired,failed:t.failed,limited:t.limited,type:t.type,typeNone:t.typeNone})};
const storageKey='3sln:org-claim-abort',incoming=location.hash.slice(1);let saved='';try{saved=sessionStorage.getItem(storageKey)??'';}catch{}
const fragment=new URLSearchParams(incoming||saved),org=fragment.get('org'),token=fragment.get('token'),given=fragment.get('handle');history.replaceState(null,'',location.pathname+location.search);
const handle=typeof given==='string'&&${HANDLE}.test(given)?given:null,expected=(handle??'stop').toLowerCase(),rendered=document.querySelector('meta[name="bindle-rendered"]')?.content??'';
const form=document.querySelector('form'),button=form.querySelector('button'),input=form.querySelector('input'),status=document.querySelector('[role=status]'),shown=document.querySelector('[data-org]'),hint=document.querySelector('[data-type-hint]');let busy=false;
const valid=typeof org==='string'&&${UUID}.test(org)&&typeof token==='string'&&${TOKEN}.test(token);
if(handle){shown.textContent='@'+handle;shown.parentElement.hidden=false;}hint.textContent=handle?messages.type:messages.typeNone;
const typed=()=>input.value.trim().replace(/^@/,'').toLowerCase();
const update=()=>{button.disabled=busy||!valid||typed()!==expected;};
if(valid){try{sessionStorage.setItem(storageKey,fragment.toString());}catch{}input.disabled=false;input.addEventListener('input',update);}else status.textContent=messages.invalid;update();
form.addEventListener('submit',async event=>{event.preventDefault();if(busy||!valid)return;
 // A person pressed the button or Enter: a trusted event with transient user activation (where the browser reports it).
 if(!event.isTrusted||navigator.userActivation&&!navigator.userActivation.isActive)return;
 if(typed()!==expected){status.textContent=messages.mismatch;return;}
 busy=true;update();
 try{const response=await fetch('${ORG_CLAIM_ABORT_API}',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({org,token,confirmed:typed(),rendered})});
  if(response.ok){try{sessionStorage.removeItem(storageKey);}catch{}status.textContent=messages.done;form.hidden=true;return;}
  const body=await response.json().catch(()=>({}));
  status.textContent=response.status===429?messages.limited:body.error==='confirmation_mismatch'?messages.mismatch:body.error==='too_fast'?messages.fast:body.error==='page_expired'?messages.expired:messages.failed;
 }catch{status.textContent=messages.failed;}busy=false;update();});
`;
}
async function page(env,locale){
 const t=TEXT[locale]??TEXT.en,stamp=await orgClaimRenderStamp(env);
 return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="bindle-rendered" content="${escape(stamp)}"><title>${escape(t.title)}</title><link rel="icon" type="image/svg+xml" href="/icon.svg"><style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;color:#1d1d1f;background:#fff}main{max-width:36rem;margin:0 auto}label{display:grid;gap:6px;margin:16px 0}input{font:inherit;min-height:44px;padding:8px 10px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;max-width:100%;box-sizing:border-box}button{font:inherit;min-height:44px;padding:.6em 1.2em;border:2px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #3156c8;outline-offset:3px}[role=status]:not(:empty){padding:12px;border-left:4px solid currentColor}a{color:#1d4ed8}strong{overflow-wrap:anywhere}@media (prefers-color-scheme:dark){body{color:#f2f2f2;background:#111}a{color:#9cf}}</style></head><body><main><h1>${escape(t.title)}</h1><p>${escape(t.lead)}</p><p hidden>${escape(t.org)} <strong data-org translate="no"></strong></p><form><label><span data-type-hint></span><input name="confirmed" autocomplete="off" autocapitalize="none" spellcheck="false" disabled></label><button type="submit" disabled>${escape(t.button)}</button></form><p role="status" aria-live="polite"></p><p><a href="/console">${escape(t.back)}</a></p></main><script type="module" src="${SCRIPT}${locale==='es'?'?lang=es':''}"></script></body></html>`;
}
const locale=url=>url.searchParams.get('lang')==='es'?'es':'en';
/** The confirmation the server expects for an organization: its handle from the identity record, else 'stop'. */
async function expectedConfirmation(env,org){const repo=env.IDENTITY_REPOSITORY;if(typeof repo?.get!=='function')return null;let record=null;try{record=await repo.get(org);}catch{return null;}
 return record?.kind==='organization'&&typeof record.handle==='string'&&HANDLE.test(record.handle)?record.handle.toLowerCase():'stop';}
export const stages={
 async public({request,env,path,url}){
  if(path!==ORG_CLAIM_ABORT_PATH&&path!==SCRIPT)return;
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405,{Allow:'GET, HEAD'});
  // No capability may travel in the query string.
  if([...url.searchParams.keys()].some(name=>name!=='lang')||url.searchParams.getAll('lang').length>1)return json({error:'invalid_request'},400);
  const lang=locale(url);
  if(path===SCRIPT)return new Response(request.method==='HEAD'?null:orgClaimAbortScript(lang),{headers:{...privateHeaders,'Content-Type':'text/javascript; charset=utf-8','Cross-Origin-Resource-Policy':'same-origin'}});
  return new Response(request.method==='HEAD'?null:await page(env,lang),{headers:PAGE_HEADERS(lang)});
 },
 // After the router's same-origin check for API mutations (an Origin other than APP_ORIGIN is refused with 403).
 async unauthenticated({request,env,path,local}){
  if(path!==ORG_CLAIM_ABORT_API)return;
  if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST'});
  const remoteIP=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown'),address=remoteIP.includes(':')?subnet64(remoteIP):remoteIP;
  const budget=async phase=>{try{return await limit(env,{operation:'org-claim-abort',remoteIP,address,phase});}catch{return false;}};
  // The budget is checked before the body is read or any organization is reached, without spending it (review L1).
  if(!await budget('peek'))return json({error:'rate_limited',message:'Please wait before trying again.'},429,{'Retry-After':'60'});
  const started=Date.now(),floor=async response=>{const wait=POST_FLOOR_MS-(Date.now()-started);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));return response;};
  const refuse=async(code,message)=>{await budget('charge');return floor(json({error:code,message},400));};
  let input;try{input=await body(request,1024);}catch{return refuse('invalid_request','Unsupported request.');}
  if(!input||Object.keys(input).some(name=>!['org','token','confirmed','rendered'].includes(name))||typeof input.confirmed!=='string')return refuse('confirmation_required','Confirm on the page to stop the claim.');
  const render=await orgClaimRenderCheck(env,input.rendered);
  if(render!=='ok')return refuse(render==='fast'?'too_fast':render==='expired'?'page_expired':'confirmation_required',render==='fast'?'Wait a moment and try again.':render==='expired'?'Open the link from your notice again.':'Confirm on the page to stop the claim.');
  if(typeof input.org!=='string'||!UUID.test(input.org)||typeof input.token!=='string'||!TOKEN.test(input.token)){await budget('charge');return floor(json({received:true}));}
  const expected=await expectedConfirmation(env,input.org);if(expected===null)return floor(json({error:'temporarily_unavailable',message:'Try again in a moment.'},503,{'Retry-After':'30'}));
  if(normalized(input.confirmed)!==expected)return refuse('confirmation_mismatch','Type the organization handle exactly as shown.');
  // An unknown organization (not_found) answers exactly like an unknown token. Only a failure to reach the writer is
  // reported (503, never token-dependent), so the owner is never told a claim stopped when nothing was decided.
  let outcome='refused';
  try{outcome=(await accountHandle(env,input.org).orgsBreakGlassSignal(input.org,{operation:'abort-token',input:{token:input.token}}))?.outcome??'refused';}
  catch(error){if(!['not_found','account_deleted','account_deleting'].includes(error?.code))return floor(json({error:'temporarily_unavailable',message:'Try again in a moment.'},503,{'Retry-After':'30'}));}
  if(outcome!=='stopped')await budget('charge');
  return floor(json({received:true}));
 },
};
export function allowedMethods(path){return path===ORG_CLAIM_ABORT_PATH||path===SCRIPT?['GET','HEAD']:path===ORG_CLAIM_ABORT_API?['POST']:null;}
