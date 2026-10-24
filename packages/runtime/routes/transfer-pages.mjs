// PORT-6/7 thin adapters. Secret material is accepted only in bounded POST bodies, never URLs.
import {createAppEngine,perform,read} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {RedirectExtensionStatus,CreateRedirectExtensionCheckout,ApplyRedirectExtensionWebhook} from '../../billing/redirect-extension.mjs';
import {redirectCapability,resolveRedirect,redirectExtensionService} from '../redirect-extension.mjs';
import {movedWindow} from '../../identity/lifecycle-tombstone.mjs';
import {ageRequirement,requestAgeLocation} from '../../identity/age-policy.mjs';
import {json,body,privateHeaders,flagGlobal,pseudonym,subnet,securePage} from './shared.mjs';
const ROOT='/api/portability/redirect',SUCCESSORS='/api/account/successors';
const pages=new Map([['/transfer-security','security'],['/transfer-out','out'],['/account/transfer-out','out'],['/transfer-in','in'],['/transfer-moved','moved'],['/transfer-redirect','redirect'],['/transfer-successor','successor'],['/transfer-dispute','dispute'],['/account/transfer-out/dispute','dispute']]);
const unknown=()=>json({error:'not_found'},404);
const engineFor=env=>createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,redirectExtensions:redirectExtensionService(env)}});
export async function redirectWebhook(env,verified){const engine=engineFor(env);try{return await perform(engine,new ApplyRedirectExtensionWebhook(verified));}finally{engine.dispose();}}
export async function transferDocument({request,env,url},kind,packageJSON){
 let asset=await env.ASSETS.fetch(new Request(new URL('/transfer-'+kind+'.html',url),{method:'GET'}));
 if([301,302,307,308].includes(asset.status)){const target=new URL(asset.headers.get('Location')??'',url);if(target.origin===url.origin&&target.pathname==='/transfer-'+kind&&!target.search&&!target.hash)asset=await env.ASSETS.fetch(new Request(target,{method:'GET'}));}
 if(!asset.ok)return json({error:'temporarily_unavailable'},503);
 // A replacer function, never a replacement string: the package comes from a cross-site POST, and `$'`, `$&` or `$``
 // in it would otherwise splice page markup into the data script.
 let html=await asset.text();if(packageJSON)html=html.replace('</head>',()=>`<script type="application/json" id="transfer-package">${packageJSON}</script></head>`);
 const headers={...privateHeaders,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; img-src 'self' data:; base-uri 'none'; form-action 'self' https:; frame-ancestors 'none'; worker-src 'self' blob:",'Cross-Origin-Opener-Policy':'same-origin','X-Robots-Tag':'noindex, nofollow, nosnippet'};
 if(kind==='security')headers['Content-Security-Policy']="default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
 const response=await securePage(new Response(html,{status:200,headers}),true,false,{keepPolicy:true});return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
}
async function budget({request,env,local}){
 const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;if(!secret||!env.ABUSE?.consume)return local?null:json({error:'temporarily_unavailable'},503);
 const ip=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown');if(!await env.ABUSE.consume('redirect-page:'+await pseudonym(subnet(ip),secret),{limit:120,windowMs:60000}))return json({error:'rate_limited'},429,{'Retry-After':'60'});
}
export const stages={
 async public(route){
  const {request,env,url}=route,path=route.path.endsWith('.html')?route.path.slice(0,-5):route.path,match=/^\/moved\/([A-Za-z0-9_-]{64,240})$/.exec(path);
  if(match){if(request.headers.has('Authorization'))return unknown();const denied=await budget(route);if(denied)return denied;if(!['GET','HEAD'].includes(request.method)||url.search)return unknown();const account=await resolveRedirect(env,match[1]);if(!account||!movedWindow(account.moved,typeof env.MOVED_CLOCK==='function'?env.MOVED_CLOCK():Date.now()).live)return unknown();return transferDocument(route,'redirect');}
  if(path.startsWith('/moved/'))return unknown();
  if(pages.has(path)){
   if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405,{Allow:'GET, HEAD'});
   const kind=pages.get(path);
   if(kind==='redirect'){if(request.headers.has('Authorization')||[...url.searchParams.keys()].some(k=>k!=='id')||url.searchParams.getAll('id').length!==1)return unknown();const account=await resolveRedirect(env,url.searchParams.get('id'));if(!account||!movedWindow(account.moved,typeof env.MOVED_CLOCK==='function'?env.MOVED_CLOCK():Date.now()).live)return unknown();}
   // The transfer-out page also accepts the destination-start statement digest its move endpoint's authorize_url
   // carries (spec §6.1 item 1); it is not a secret, only the statement an authorization will be made against.
   else if([...url.searchParams.keys()].some(k=>k!=='lang'&&!(kind==='out'&&k==='statement'))||url.searchParams.getAll('lang').length>1||url.searchParams.has('lang')&&!['en','es'].includes(url.searchParams.get('lang'))||url.searchParams.has('statement')&&(url.searchParams.getAll('statement').length!==1||!/^sha256-[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('statement'))))return unknown();
   const flag=['in','security'].includes(kind)?'IDENTITY_TRANSFER_IN_ENABLED':kind==='successor'?'IDENTITY_SUCCESSOR_ADOPTION_ENABLED':'IDENTITY_TRANSFER_OUT_ENABLED';
   // Existing moves, disputes and read-only export must remain reachable after a rollout closes.
   if(['in','security','successor'].includes(kind)&&!flagGlobal(env,flag))return unknown();
   return transferDocument(route,kind);
  }
  if(path!==ROOT&&path!==ROOT+'/checkout')return;
  if(request.headers.has('Authorization'))return unknown();
  const denied=await budget(route);if(denied)return denied;
  const checkout=path.endsWith('/checkout');if(request.method!==(checkout?'POST':'GET'))return json({error:'method_not_allowed'},405,{Allow:checkout?'POST':'GET'});
  if(checkout&&(request.headers.get('Origin')!==env.APP_ORIGIN||request.headers.get('X-Bindle-Transfer')!=='1'||url.search))return json({error:'csrf'},403);
  const input=checkout?await body(request,2048):Object.fromEntries(url.searchParams);if(Object.keys(input).some(k=>k!=='id'&&!(checkout&&k==='ageConfirmed'))||!checkout&&url.searchParams.getAll('id').length!==1)return unknown();
  // Review 2026-10-23 (M3): the anonymous redirect purchase is a paid checkout: the region policy and a fresh paid-age
  // attestation apply exactly as for an account checkout (no account exists, so the runtime location decides).
  if(checkout){const requirement=ageRequirement(requestAgeLocation(request,env));if(requirement.blocked)return json({error:'signup_region_blocked',message:"Purchases aren't available in your region."},403);if(input.ageConfirmed===undefined)return json({error:'age_confirmation_required',message:'Confirm the minimum purchase age.'},400);if(!Number.isSafeInteger(input.ageConfirmed)||input.ageConfirmed<requirement.paidMinimumAge||input.ageConfirmed>150)return json({error:'age_confirmation_insufficient',message:'Confirm the required purchase age.'},400);delete input.ageConfirmed;}
  const engine=engineFor(env);try{return json(checkout?await perform(engine,new CreateRedirectExtensionCheckout(input.id)):await read(engine,new RedirectExtensionStatus(input.id)));}catch(error){if(error.status===404)return unknown();throw error;}finally{engine.dispose();}
 },
 async beforeActivity({path,request,env,url,id,object}){
  if(path==='/api/account/transfer-out'&&request.method==='GET'){
   const status=await object.transferOutStatus(id);if(status?.state!=='committed')return;
   const account=await env.IDENTITY_REPOSITORY.get(id),capability=await redirectCapability(env,account);return json({...status,redirectPage:capability?'/moved/'+capability:null});
  }
  if(path!==SUCCESSORS&&!path.startsWith(SUCCESSORS+'/'))return;
  if(path===SUCCESSORS&&request.method==='GET')return json(await object.transferSuccessorPending(id,{origin:{iss:url.searchParams.get('iss'),sub:url.searchParams.get('sub')}}));
  if(!['adopt','dismiss'].includes(path.slice(SUCCESSORS.length+1)))return unknown();
  const input=await body(request,2048);return json(await object.transferSuccessorDecide(id,{...input,dismiss:path.endsWith('/dismiss')}));
 },
};
export const allowedMethods=path=>path===ROOT?['GET']:path===ROOT+'/checkout'?['POST']:path===SUCCESSORS?['GET']:[SUCCESSORS+'/adopt',SUCCESSORS+'/dismiss'].includes(path)?['POST']:null;
export const admission={exempt:path=>path.startsWith(SUCCESSORS)};
