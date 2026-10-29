// Thin HTTP adapter for the cross-device email flow and email sign-up (sign-in and intents spike §3.4, §4.3; P3). The
// protocol is the identity engine's (packages/identity/email-flow.mjs); this module only parses, derives the display
// context and the browser marker cookie, dispatches one identity action and serializes. Behind EMAIL_FLOW_V2: with it
// off every path below answers exactly like any other unknown /api/auth/ path.
//
// Every endpoint is POST with a JSON body. The router already refuses a mutation whose `Origin` is not the exact app
// origin; here a `Sec-Fetch-Site` other than `same-origin` is refused too (a browser always sends it; a client without
// Fetch Metadata still needs the exact Origin). Responses are `no-store` with `Referrer-Policy: no-referrer`
// (`privateHeaders`).
import {IdentityAction} from '../../identity/index.mjs';
import {requesterSummary} from '../../identity/email-flow.mjs';
import {installAccountSession} from '../account-session-http.mjs';
import {json,body,cookie,status,flagGlobal,signupEnabled,accountHandle} from './shared.mjs';

export const EMAIL_FLOW_PATHS=Object.freeze({
 '/api/auth/email/flow/start':'emailFlowStart','/api/auth/email/flow/status':'emailFlowStatus','/api/auth/email/flow/redeem':'emailFlowRedeem',
 '/api/auth/email/flow/cancel':'emailFlowCancel','/api/auth/email/flow/resend':'emailFlowResend',
 '/api/auth/email/link/inspect':'emailLinkInspect','/api/auth/email/link/approve':'emailLinkApprove','/api/auth/email/link/reveal':'emailLinkReveal',
 '/api/auth/email/link/cancel':'emailLinkCancel','/api/auth/email/link/status':'emailLinkStatus','/api/auth/email/link/complete-here':'emailLinkCompleteHere',
 '/api/auth/email/signup':'emailSignupConfirm'
});
/** The same-browser marker B (spike §4.1): 256 random bits, HttpOnly, SameSite=Strict, `__Host-` off loopback, 20 minutes,
 * shared by concurrent flows of one browser. The record keeps only a keyed hash of it. */
export const EMAIL_BROWSER_COOKIE='__Host-bindle_email_flow',LOCAL_EMAIL_BROWSER_COOKIE='bindle_email_flow';
const B64=/^[A-Za-z0-9_-]{43}$/;
export function emailBrowserCookie(request,local){const name=local?LOCAL_EMAIL_BROWSER_COOKIE:EMAIL_BROWSER_COOKIE;for(const piece of (request.headers.get('Cookie')||'').split(';')){const [key,...rest]=piece.trim().split('=');if(key===name){const value=rest.join('=');return B64.test(value)?value:undefined;}}return undefined;}
const newBrowserMarker=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const browserCookie=(value,local)=>`${local?LOCAL_EMAIL_BROWSER_COOKIE:EMAIL_BROWSER_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1200${local?'':'; Secure'}`;
const setupCookie=(binding,local)=>`${local?'bindle_setup':'__Host-bindle_setup'}=${binding}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${local?'':'; Secure'}`;
/** Display-only requester context from the request (spike §4.4, N7): browser family and system, and the edge's coarse
 * geo when the runtime's geo source is authoritative (Workers, `request.cf`). Never an IP. */
export const requestRequester=(request,local)=>requesterSummary({userAgent:request.headers.get('User-Agent'),...local?{}:{city:request.cf?.city,region:request.cf?.region,country:request.cf?.country}});

/** Session stage handler; answers only for EMAIL_FLOW_PATHS with EMAIL_FLOW_V2 on. */
export async function emailFlowRoutes({request,env,path,local,engine,context,vault}){
 const method=EMAIL_FLOW_PATHS[path];if(!method||!flagGlobal(env,'EMAIL_FLOW_V2'))return;
 if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST'});
 const site=request.headers.get('Sec-Fetch-Site');if(site!==null&&site!=='same-origin')return json({error:'csrf',message:'Reload the page before continuing.'},403);
 if(path==='/api/auth/email/signup'&&!signupEnabled(env,{request}))return json({error:'release_gated',message:'Account creation is not open yet.'},503);
 const input=await body(request,8192),headers=new Headers();
 const existing=emailBrowserCookie(request,local),marker=path==='/api/auth/email/flow/start'?existing??newBrowserMarker():existing;
 const ctx={...context,emailBrowser:marker};
 if(path==='/api/auth/email/flow/start'){ctx.requester=requestRequester(request,local);ctx.signupOpen=signupEnabled(env,{request})&&flagGlobal(env,'EMAIL_SIGNUP_ENABLED');}
 if(path==='/api/auth/email/signup')ctx.setupBinding=crypto.randomUUID()+crypto.randomUUID();
 let result;
 try{result=(await engine.dispatch(new IdentityAction(method,input,ctx)).next('result')).detail;}
 catch(error){if(typeof error?.code!=='string')throw error;return json({error:error.code,message:error.message,...Number.isSafeInteger(error.remaining)?{remaining:error.remaining}:{}},status(error),Number.isSafeInteger(error.retryAfter)&&error.retryAfter>0?{'Retry-After':String(error.retryAfter)}:{});}
 // B is set or refreshed at start only, so a link opened elsewhere never acquires it.
 if(path==='/api/auth/email/flow/start')headers.append('Set-Cookie',browserCookie(marker,local));
 if(path==='/api/auth/email/signup'&&result.account?.status==='pending'){await accountHandle(env,result.account.id).rememberSignupOrigin(result.account.id,{createdAt:result.account.createdAt});headers.append('Set-Cookie',setupCookie(ctx.setupBinding,local));}
 if(result?.sessionToken){
  // A fresh session minted by the engine (never derived from the flow's values; spike T5), installed under the
  // multi-account rules like every other sign-in.
  if(result.account?.id)try{await accountHandle(env,result.account.id).touch(result.account.id);result.billingSync=await accountHandle(env,result.account.id).billingRefresh(result.account.id,{force:true});}catch{result.billingSync={checked:false,error:'billing_provider_unavailable'};}
  if(vault){for(const value of await installAccountSession({request,env,local,engine,context:ctx,result,legacyCleared:cookie('',local,0)}))headers.append('Set-Cookie',value);}else headers.append('Set-Cookie',cookie(result.sessionToken,local));
  delete result.sessionToken;
 }
 return json(result,200,headers);
}
