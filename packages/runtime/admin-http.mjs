// Host administration routes (reference implementation, not Bindle protocol).
// Mounted inside the /api/ block after the identity context is built. All
// routes are same-origin POST; the console names its actor explicitly.
import {createAppEngine,perform} from '../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../app/providers.mjs';
import {RequestUserDeletion,CloseUser,ReopenUser,ConfirmUserDeletion,adminDeletionPasskeyContext} from '../identity/admin.mjs';
import {adminFlagsRoutes} from './admin-flags-http.mjs';
import {adminOrgCaseRoutes} from './admin-org-cases.mjs';
const bootCookieName=local=>local?'bindle_boot':'__Host-bindle_boot';
const bootCookie=(token,local,maxAge)=>`${bootCookieName(local)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${local?'':'; Secure'}`;
// Wargame 2026-10-23 #6: a per-browser nonce binds boot passkey challenges to the caller that began them.
const loginNonceName=local=>local?'bindle_boot_login':'__Host-bindle_boot_login';
const loginNonceCookie=(nonce,local)=>`${loginNonceName(local)}=${nonce}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${local?'':'; Secure'}`;
function loginNonce(request,local){for(const piece of (request.headers.get('Cookie')||'').split(';')){const [key,...rest]=piece.trim().split('=');if(key===loginNonceName(local)){const value=rest.join('=');return /^[A-Za-z0-9_-]{43}$/.test(value)?value:undefined;}}}
const freshNonce=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function bootSession(request,local){for(const piece of (request.headers.get('Cookie')||'').split(';')){const [key,...rest]=piece.trim().split('=');if(key===bootCookieName(local)){const value=rest.join('=');return /^[A-Za-z0-9_-]{43}$/.test(value)?value:undefined;}}}
const BOOT={'/api/admin/boot/status':'bootStatus','/api/admin/boot/start':'bootStart','/api/admin/boot/complete':'bootComplete','/api/admin/boot/login/begin':'bootLoginBegin','/api/admin/boot/login':'bootLogin','/api/admin/boot/step-up':'bootStepUp','/api/admin/boot/logout':'bootLogout','/api/admin/boot/session':'bootSessionInfo','/api/admin/boot/end':'bootEnd'};
const OPERATIONS={'/api/admin/overview':'overview','/api/admin/catalog':'setCatalog','/api/admin/reservations/set':'reserve','/api/admin/reservations/remove':'unreserve','/api/admin/claims/mint':'mintClaim','/api/admin/claims/link':'claimLink','/api/admin/claims/revoke':'revokeClaim','/api/admin/users/lookup':'lookup','/api/admin/users/roles':'setRoles','/api/admin/users/badges':'setBadges','/api/admin/users/suspend':'suspend','/api/admin/users/reactivate':'reactivate','/api/admin/principals':'principals','/api/admin/audit':'audit','/api/admin/clients/block':'blockClient','/api/admin/clients/blocks':'clientBlocks'};
export const adminPath=path=>path.startsWith('/api/admin/');
export async function adminRoutes({path,request,env,local,context,body,json}){
 if(!adminPath(path))return null;
 if(!env.ADMIN_SERVICE)return json({error:'admin_unavailable',message:'Administration is not configured.'},503);
 if(path==='/api/admin/users/deletion/confirmation'||path==='/api/admin/users/deletion/confirmation.js')return deletionConfirmationPage({path,request,env,json});
 if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST'});
 if(request.headers.get('Origin')!==env.APP_ORIGIN)return json({error:'csrf'},403);
 const admin=await env.ADMIN_SERVICE(),actor=request.headers.get('X-Bindle-Admin-Actor'),scoped={...context,origin:request.headers.get('Origin'),bootSession:bootSession(request,local),bootLoginNonce:loginNonce(request,local),actor:['boot','admin'].includes(actor)?actor:undefined};
 if(['/api/admin/users/request-deletion','/api/admin/users/close','/api/admin/users/reopen','/api/admin/users/deletion/confirm'].includes(path)){
  if(new URL(request.url).search)return json({error:'invalid_request'},400);
  let verified=scoped;
  if(!path.endsWith('/confirm')){
   // Verify current authority before the assertion, without requiring an older
   // step-up to still be fresh: the assertion below creates the new window.
   if(scoped.actor==='admin'){if(!(await admin.access({},scoped)).admin)return json({error:'forbidden'},403);}
   else if(scoped.actor==='boot')await admin.bootSession(scoped,Infinity);else await admin.actor(scoped,true);
   const source=await body(request,16384);if(!source.passkeyResponse)return json({error:'step_up_required'},403);
   const result=await adminRoutes({path:scoped.actor==='boot'?'/api/admin/boot/step-up':'/api/admin/step-up',request,env:{...env,ADMIN_SERVICE:()=>admin},local,context:scoped,body:async()=>({method:'passkey',challengeId:source.challengeId,response:source.passkeyResponse}),json});if(!result.ok)return result;verified=adminDeletionPasskeyContext(admin,scoped);
   body=async()=>source;
  }
  const Operation=path.endsWith('/request-deletion')?RequestUserDeletion:path.endsWith('/close')?CloseUser:path.endsWith('/reopen')?ReopenUser:ConfirmUserDeletion,input=await body(request,16384),engine=createAppEngine({providers:{admin,clock:{now:()=>admin.clock()},random:cryptoRandom,audit:nullAudit}});
  try{return json(await perform(engine,new Operation({actor:{kind:'admin-http',context:verified},input})),200,{'Cache-Control':'private, no-store'});}finally{await engine.dispose();}
 }
 if(path.startsWith('/api/admin/flags/'))return adminFlagsRoutes({path,request,env,local,admin,scoped,body,json});
 // ORG-12d support adjudication (operators): packages/runtime/admin-org-cases.mjs.
 if(path.startsWith('/api/admin/org-cases/'))return adminOrgCaseRoutes({path,request,env,local,admin,scoped,body,json});
 if(path==='/api/admin/boot/begin'){const input=await body(request,128);if(Object.keys(input).length)return json({error:'invalid_request'},400);await admin.limited('boot-begin',scoped);const binding=context.setupBinding||crypto.randomUUID()+crypto.randomUUID();return json({ready:true},200,{'Set-Cookie':`${local?'bindle_setup':'__Host-bindle_setup'}=${binding}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${local?'':'; Secure'}`});}
 // Logout and end always clear the boot cookie, even if the server-side record update fails.
 if(path==='/api/admin/boot/logout'){let result;try{result=await admin.bootLogout(await body(request,128),scoped);}catch(error){result={loggedOut:false,error:error.code||'invalid_request'};}return json(result,result.loggedOut?200:409,{'Set-Cookie':bootCookie('',local,0)});}
 if(BOOT[path]){let issued;if(path==='/api/admin/boot/login/begin'&&!scoped.bootLoginNonce)scoped.bootLoginNonce=issued=freshNonce();const result=await admin[BOOT[path]](await body(request,16384),scoped),headers=new Headers();if(issued)headers.append('Set-Cookie',loginNonceCookie(issued,local));
  if(result.sessionToken){headers.append('Set-Cookie',bootCookie(result.sessionToken,local,Math.max(1,Math.floor((result.sessionExpiresAt-Date.now())/1000))));delete result.sessionToken;}
  if(path==='/api/admin/boot/logout'||path==='/api/admin/boot/end')headers.append('Set-Cookie',bootCookie('',local,0));return json(result,200,headers);}
 if(path==='/api/admin/step-up/begin')return json(await admin.identity.stepUpBegin(await body(request,128),scoped));
 // Administrators step up with a passkey only (coordinator decision, 2026-10-14).
 if(path==='/api/admin/step-up'){const input=await body(request,16384);if(input?.method!=='passkey')return json({error:'passkey_required',message:'Administrators confirm with a passkey. Add a passkey to this account first.'},403);return json(await admin.identity.stepUp(input,scoped));}
 if(path==='/api/admin/step-up/end')return json(await admin.endStepUp(await body(request,128),scoped));
 if(path==='/api/admin/access')return json(await admin.access(await body(request,128),scoped));
 if(OPERATIONS[path])return json(await admin[OPERATIONS[path]](await body(request,65536),scoped));
 return json({error:'not_found'},404);
}

// A confirmation link is a single-purpose credential. Its fragment is scrubbed
// before any network call; GET never schedules deletion or consumes the token.
const confirmationHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, nosnippet'};
export function adminDeletionConfirmationScript(){return `import {Engine,Provider,Action} from '/vendor/ngin/index.js';
const fragment=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'',location.pathname);let proof={owner:fragment.get('owner'),token:fragment.get('token')};const valid=[...fragment.keys()].length===2&&fragment.getAll('owner').length===1&&fragment.getAll('token').length===1&&/^[a-f0-9-]{36}$/.test(proof.owner??'')&&/^[A-Za-z0-9_-]{43}$/.test(proof.token??'');fragment.delete('token');fragment.delete('owner');const form=document.querySelector('form'),button=form.querySelector('button'),status=document.querySelector('[role=status]');let busy=false;if(!valid){proof=null;status.textContent='This confirmation is invalid or no longer available.';}button.disabled=!valid;
class ConfirmDeletion extends Action {static deps=['api'];constructor(input){super();this.input=input;}async execute({api}){return api.confirm(this.input);}}
const engine=new Engine({providers:{api:Provider.fromSingleton({confirm:async input=>{const response=await fetch('/api/admin/users/deletion/confirm',{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const result=await response.json();if(!response.ok||result.scheduled!==true)throw Error(response.status===400?'This confirmation is invalid or no longer available.':'Deletion could not be scheduled. Try again or contact the service operator.');}})}});
form.addEventListener('submit',async event=>{event.preventDefault();if(!proof||busy)return;const acknowledgements=Object.fromEntries(['messages','storage','names','plan'].map(name=>[name,form.elements[name].checked]));if(Object.values(acknowledgements).some(value=>!value))return;busy=true;button.disabled=true;try{await engine.dispatch(new ConfirmDeletion({...proof,acknowledgements})).next('complete');proof=null;status.textContent='Deletion is scheduled with 30 days to cancel. Check your confirmed notice channels.';}catch(error){status.textContent=error.message;button.disabled=false;}finally{busy=false;}});`;}
async function deletionConfirmationPage({path,request,env,json}){
 if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405,{Allow:'GET, HEAD'});
 if(new URL(request.url).search)return json({error:'invalid_request'},400);
 const admin=await env.ADMIN_SERVICE();if(!admin.deletionEnabled())return json({error:'not_found'},404);
 if(path.endsWith('.js'))return new Response(request.method==='HEAD'?null:adminDeletionConfirmationScript(),{headers:{...confirmationHeaders,'Content-Type':'text/javascript; charset=utf-8','Cross-Origin-Resource-Policy':'same-origin'}});
 const asset=await env.ASSETS?.fetch(new Request(new URL('/build-manifest.json',request.url)));let manifest;try{manifest=await asset?.json();}catch{}
 if(!asset?.ok||!manifest?.imports?.['/vendor/ngin/index.js'])return json({error:'deletion_unavailable'},503);
 const map=JSON.stringify({imports:manifest.imports}).replaceAll('<','\\u003c'),hash=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(map)))));
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm account deletion</title></head><body><main><h1>Confirm account deletion</h1><p>Confirming schedules deletion with 30 days to cancel. This link cannot sign you in.</p><p>Your subscription, if active, will end without an automatic refund. If its billing period ends during the grace period, cancelling deletion cannot restore it.</p><form>'+[['messages','Messages others received stay with them.'],['storage','Files in connected storage stay there.'],['names','Your name is never reassigned and cannot be reused.'],['plan','Your active plan ends without automatic refund.']].map(([name,text])=>'<p><label><input type="checkbox" required name="'+name+'"> '+text+'</label></p>').join('')+'<button type="submit" disabled>Schedule deletion</button></form><p role="status" aria-live="polite"></p><p><a href="/console">Sign in</a></p><noscript>JavaScript is required to confirm this request.</noscript></main><script type="importmap">'+map+'</script><script type="module" src="/api/admin/users/deletion/confirmation.js"></script></body></html>';
 return new Response(request.method==='HEAD'?null:html,{headers:{...confirmationHeaders,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self' 'sha256-"+hash+"'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"}});
}
