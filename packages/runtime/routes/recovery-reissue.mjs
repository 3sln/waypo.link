// Cancel page for an active-account recovery reissue (docs/spec/recovery-identity.md "Active-account reissue",
// wargame 2026-10-23 #1(c), provisional). The reissue notice mails `REISSUE_CANCEL_PATH#token=<owner>.<random>` to an email
// verified before the reissue began. Opening the page changes nothing: the capability stays in the fragment, the
// script removes it from the address bar and only an explicit button press POSTs it to
// /api/auth/recovery/reissue/cancel-email (IdentityService#reissueRecoveryCancelEmail). The page is server-rendered
// with a same-origin module script, so it needs no build entry. It never signs in.
import {privateHeaders,json} from './shared.mjs';

export const REISSUE_CANCEL_PATH='/account/recovery/cancel';
const SCRIPT=REISSUE_CANCEL_PATH+'.mjs';
const TEXT={
 en:{title:'Cancel recovery file replacement',lead:'Confirm to cancel the recent replacement of your recovery file. Your previous recovery file works again and the new one never will. This does not sign you in.',button:'Cancel replacement',done:'Replacement cancelled. Your previous recovery file works again. Sign in from a device you already use to review your account.',invalid:'This link is invalid or the replacement can no longer be cancelled. Sign in to review your account.',failed:'We could not cancel the replacement. Try again, or sign in to review your account.',back:'Open your account'},
 es:{title:'Cancelar el reemplazo del archivo de recuperación',lead:'Confirma para cancelar el reemplazo reciente de tu archivo de recuperación. Tu archivo anterior vuelve a funcionar y el nuevo nunca funcionará. Esto no inicia sesión.',button:'Cancelar reemplazo',done:'Reemplazo cancelado. Tu archivo de recuperación anterior vuelve a funcionar. Inicia sesión desde un dispositivo que ya uses para revisar tu cuenta.',invalid:'Este enlace no es válido o el reemplazo ya no se puede cancelar. Inicia sesión para revisar tu cuenta.',failed:'No pudimos cancelar el reemplazo. Vuelve a intentarlo o inicia sesión para revisar tu cuenta.',back:'Abrir tu cuenta'},
};
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const json_=value=>JSON.stringify(value).replaceAll('<','\\u003c');
/** The page script: reads and clears the fragment, then POSTs the token only on an explicit press. */
export function reissueCancelScript(locale='en'){
 const t=TEXT[locale]??TEXT.en;
 return `const messages=${json_({done:t.done,invalid:t.invalid,failed:t.failed})};
const fragment=new URLSearchParams(location.hash.slice(1)),token=fragment.get('token');history.replaceState(null,'',location.pathname+location.search);
const form=document.querySelector('form'),button=form.querySelector('button'),status=document.querySelector('[role=status]');let busy=false;
const valid=typeof token==='string'&&/^[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}$/.test(token);
if(valid)button.disabled=false;else status.textContent=messages.invalid;
form.addEventListener('submit',async event=>{event.preventDefault();if(busy||!valid)return;busy=true;button.disabled=true;
 try{const response=await fetch('/api/auth/recovery/reissue/cancel-email',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,confirmed:true})});
  if(response.ok){status.textContent=messages.done;form.hidden=true;return;}
  const body=await response.json().catch(()=>({}));status.textContent=['recovery_reissue_not_pending','unauthorized'].includes(body?.error)?messages.invalid:messages.failed;if(response.status>=500||response.status===429){busy=false;button.disabled=false;}
 }catch{status.textContent=messages.failed;busy=false;button.disabled=false;}});
`;
}
function page(locale){
 const t=TEXT[locale]??TEXT.en;
 return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(t.title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;color:#1d1d1f;background:#fff}main{max-width:36rem;margin:0 auto}button{font:inherit;padding:.6em 1.2em}@media (prefers-color-scheme:dark){body{color:#f2f2f2;background:#111}a{color:#9cf}}</style></head><body><main><h1>${escape(t.title)}</h1><p>${escape(t.lead)}</p><form><button type="submit" disabled>${escape(t.button)}</button></form><p role="status" aria-live="polite"></p><p><a href="/console">${escape(t.back)}</a></p></main><script type="module" src="${SCRIPT}${locale==='es'?'?lang=es':''}"></script></body></html>`;
}
export const stages={
 async public({request,env,path,url}){
  if(path!==REISSUE_CANCEL_PATH&&path!==SCRIPT)return;
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405,{Allow:'GET, HEAD'});
  if([...url.searchParams.keys()].some(name=>name!=='lang')||url.searchParams.getAll('lang').length>1)return json({error:'invalid_request'},400);
  const locale=url.searchParams.get('lang')==='es'?'es':'en';
  if(path===SCRIPT)return new Response(request.method==='HEAD'?null:reissueCancelScript(locale),{headers:{...privateHeaders,'Content-Type':'text/javascript; charset=utf-8','Cross-Origin-Resource-Policy':'same-origin'}});
  return new Response(request.method==='HEAD'?null:page(locale),{headers:{...privateHeaders,'Content-Type':'text/html; charset=utf-8','Content-Language':locale,'X-Robots-Tag':'noindex, nofollow, nosnippet','Cross-Origin-Opener-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"}});
 },
};
export function allowedMethods(path){return path===REISSUE_CANCEL_PATH||path===SCRIPT?['GET','HEAD']:null;}
