// HTTP router (docs/architecture/app-engine.md §7, §12). It keeps the cross-cutting steps (origin, method
// allowlist, CSRF, session, owner resolution, capacity admission, activity) and runs the per-slice route stages
// of packages/runtime/routes/index.mjs between them. Shared helpers live in packages/runtime/routes/shared.mjs.
import {recoveryReissueEligibility,organizationReissueEligibility} from './recovery-eligibility.mjs';
import {accountRoutePaths} from './account-session-http.mjs';
import {accountCookiesEnabled,selectedAccountMember,parseAccountCookies,hasAccountVault,installedAccountCookies,accountFault} from './account-cookies.mjs';
import {FlagsRuntime} from './flags.mjs';
import {OwnerQuery,ClosureOwnerQuery,IdentityFault} from '../identity/index.mjs';
import {personActor} from '../orgs/authority.mjs';
import * as deletionRoutes from './routes/deletion.mjs';
import * as exportRoutes from './routes/exports.mjs';
import * as transferPages from './routes/transfer-pages.mjs';
// DX-7 closure-export sessions reach only these routes: session, deletion status and the owner's export.
const CLOSURE_ROUTES=[[/^\/api\/account\/transfer-out$/,['GET']],[/^\/api\/session$/,['GET']],[/^\/api\/account\/deletion$/,['GET']],[/^\/api\/exports$/,['GET','POST']],[/^\/api\/exports\/[a-f0-9-]{36}$/,['GET']],[/^\/api\/exports\/[a-f0-9-]{36}\/cancel$/,['POST']],[/^\/api\/exports\/[a-f0-9-]{36}\/volumes\/[1-9][0-9]{0,8}\.tar$/,['GET','HEAD']]];
const closureRoute=(path,method)=>CLOSURE_ROUTES.some(([pattern,methods])=>pattern.test(path)&&methods.includes(method));
import {MessagingFault} from '../core/records.mjs';
import {StorageError} from '../storage/policy.mjs';
import {flagReadable,sessionFeatures,json,status,body,cookie,sessionToken,setupCookie,deviceCookie,signedContactPath,identity,limit,turnstile,accountHandle} from './routes/shared.mjs';
import {stage,routeMethods,admission} from './routes/index.mjs';
export {subnet,signupEnabled} from './routes/shared.mjs';

// The router's own paths; every other path's methods come from its route module.
const allowedMethods=path=>['/api/session','/api/account'].includes(path)?['GET']:routeMethods(path);

export default {
 turnstile, rateLimit:limit,
 async fetch(request,env,execution){
  let engine;
  try{
   if(!env.flags&&!env.FLAGS)env={...env,flags:await new FlagsRuntime({env,platform:env.FLAGS_PLATFORM??'worker'}).pin({request})};
   const url=new URL(request.url);const local=env.LOCAL_DEVELOPMENT==='true';
   const route={request,env,execution,url,local};let response;
   response=await stage('edge',route);if(response)return response.passthrough??response;
   if(url.origin!==env.APP_ORIGIN)return json({error:'invalid_origin',message:'Use the configured account domain.'},403);
   // Island documents and assets are served only on the embed origin, never under the app origin (review M3).
   if(url.pathname==='/embed'||url.pathname.startsWith('/embed/'))return json({error:'not_found'},404);
   const path=url.pathname;const mutation=!['GET','HEAD','OPTIONS'].includes(request.method);
   Object.assign(route,{path,mutation});
   response=await stage('public',route);if(response)return response.passthrough??response;
   const allow=allowedMethods(path);if(allow&&!allow.includes(request.method))return json({error:'method_not_allowed',message:'This operation does not support that request method.'},405,{Allow:allow.join(', ')});
   if(path.startsWith('/api/demo'))return json({error:'not_found'},404);
   response=await stage('anonymous',route);if(response)return response.passthrough??response;
   if(mutation&&path.startsWith('/api/')&&request.headers.get('Origin')!==env.APP_ORIGIN)return json({error:'csrf',message:'Reload the account page before continuing.'},403);
   response=await stage('unauthenticated',route);if(response)return response.passthrough??response;
   if(path.startsWith('/api/')){
    response=await stage('api',route);if(response)return response.passthrough??response;
    // Member cookies are authenticated and the tab selector matched before any owner actor is routed.
    const vault=accountCookiesEnabled(env),accountCookies=vault?parseAccountCookies(request,local):new Map(),vaultPresent=vault&&hasAccountVault(accountCookies,local),accountPath=vault&&accountRoutePaths.includes(path);let accountMember=null;if(vault&&!accountPath&&!(mutation&&request.headers.get('X-Bindle-Account')===null))accountMember=await selectedAccountMember(request,env,local,accountCookies);
    engine=await identity(env);const context={origin:request.headers.get('Origin')||env.APP_ORIGIN,sessionToken:accountMember?.token||(vaultPresent?undefined:sessionToken(request,local)),expectedOwner:accountMember?.owner||request.headers.get('X-Bindle-Account')||undefined,sessionContext:accountMember?.sessionContext||request.headers.get('X-Bindle-Session-Context')||undefined,csrfToken:request.headers.get('X-CSRF-Token'),remoteIP:request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown'),region:/^[A-Z]{2}$/.test(request.cf?.country||'')?request.cf.country:'unknown',deviceBinding:deviceCookie(request,local),setupBinding:setupCookie(request,local),...typeof execution?.waitUntil==='function'?{waitUntil:promise=>execution.waitUntil(promise)}:{}};
    Object.assign(route,{engine,context,vault,accountCookies,vaultPresent,accountPath,accountMember});
    response=await stage('session',route);if(response)return response.passthrough??response;
    // Header-less private writes would follow a mutable default; tabs must name their member.
    // (Header-less mutations never select the default member, so identity writes fail closed too.)
    if(vaultPresent&&mutation&&request.headers.get('X-Bindle-Account')===null)throw accountFault('account_context_conflict',409);
    let owner,closure=null;try{owner=await engine.query(new OwnerQuery(context)).peek();}catch(error){
     // A closed account's restricted session is tried only after the ordinary owner refused, and only on its routes.
     if(error.code==='unauthorized'&&closureRoute(path,request.method))try{closure=await engine.query(new ClosureOwnerQuery(context)).peek();}catch{closure=null;}
     if(!closure){if(path==='/api/session'&&error.code==='unauthorized')return json({authenticated:false},200,{'Cache-Control':'private, no-store'});throw error;}
    }
    if(closure){
     const id=closure.account.id;if(path==='/api/session')return json({authenticated:true,...closure,features:sessionFeatures(env,id)},200,{'Cache-Control':'private, no-store'});
     if(mutation&&context.csrfToken!==closure.csrfToken)return json({error:'csrf',message:'Reload the account page before continuing.'},403);
     Object.assign(route,{owner:closure,id,object:accountHandle(env,id),dispatch:null});route.context={...context,allowClosure:true};
     const restricted=await transferPages.stages.beforeActivity(route)??await deletionRoutes.stages.beforeActivity(route)??await exportRoutes.stages.beforeActivity(route);if(restricted)return restricted.passthrough??restricted;
     return json({error:'closure_restricted',message:'Only export and deletion status are available for this account.'},403);
    }
    // ORG-0: the security epoch travels in the actor only; the session view is unchanged.
    const {securityEpoch,authorityEpoch,organizationVerification,...session}=owner;
    if(path==='/api/session'){if(vault&&!accountMember&&!vaultPresent&&context.sessionToken){const headers=new Headers({'Cache-Control':'private, no-store'});for(const value of await installedAccountCookies(env,{owner:owner.account.id,token:context.sessionToken,expiresAt:owner.expiresAt,sessionContext:owner.sessionContext},local))headers.append('Set-Cookie',value);headers.append('Set-Cookie',cookie('',local,0));return json({authenticated:true,...session,features:sessionFeatures(env,owner.account.id)},200,headers);}return json({authenticated:true,...session,features:sessionFeatures(env,owner.account.id)},200,{'Cache-Control':'private, no-store'});}
    const id=owner.account.id;const object=accountHandle(env,id);
    // ORG-0 power resolver seam (packages/orgs/authority.mjs): routes act through an explicit actor, never an implicit
    // owner. A person acting as themselves resolves to exactly the former owner; the account writer re-resolves powers.
    const actor=personActor({owner:id,iss:env.APP_ORIGIN,authTime:owner.authTime,epoch:securityEpoch,aep:authorityEpoch,verification:organizationVerification});
    // Engine-first routes (docs/architecture/app-engine.md §7): parse, dispatch one account operation as this actor, serialize.
    const dispatch=(Operation,params={})=>object.dispatch(id,{operation:Operation.operation,...params,actor:{principal:actor.principal,entity:actor.entity,authTime:actor.authTime,epoch:actor.epoch}});
    // Owner mutations independently require session CSRF, even when not an identity action.
    if(mutation&&context.csrfToken!==owner.csrfToken)return json({error:'csrf',message:'Reload the account page before continuing.'},403);
    Object.assign(route,{owner,id,object,dispatch,actor});
    response=await stage('beforeActivity',route);if(response)return response.passthrough??response;
    // Capacity admission: protective changes and exempt paths (declared by their route modules) are never refused.
    let protective=false;const protectiveRule=mutation&&admission.protective.find(rule=>rule.match(path,request.method));
    if(protectiveRule){const change=await body(request.clone());protective=protectiveRule.test(change);}
    const capacityExempt=protective||request.method==='DELETE'||admission.exempt(path);
    if(mutation&&!capacityExempt&&allowedMethods(path))await object.admitWork(id,{initialize:true});
    await object.touch(id);
    if(path==='/api/account'&&request.method==='GET')return json({...await object.snapshot(id),account:owner.account,credentials:owner.credentials,devices:owner.devices,audit:owner.audit,recovery:await (async()=>{const identity=await env.IDENTITY_REPOSITORY.get(id);return {...owner.recovery,...recoveryReissueEligibility(identity),...organizationReissueEligibility(identity)};})(),grants:[],features:sessionFeatures(env,id),...flagReadable(env,'DEVICE_AUTHORIZATION_ENABLED')&&env.FEDERATION_AUTHORITY?.ready()?{appSessions:(await env.FEDERATION_AUTHORITY.appSessions(context)).sessions}:{}},200,{'Cache-Control':'private, no-store'});
    response=await stage('owner',route);if(response)return response.passthrough??response;
    return json({error:'not_found'},404);
   }
   response=await stage('pages',route);if(response)return response.passthrough??response;
   return json({error:'not_found'},404);
  }catch(error){const pathname=new URL(request.url).pathname;const signedContact=signedContactPath.test(pathname);const cap=signedContact||pathname==='/bindle/rpc'&&request.headers.get('Authorization')?.startsWith('Bearer ');const headers=cap?{'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Retry-After','X-Robots-Tag':'noindex, nofollow, nosnippet',...(signedContact?{Vary:'Accept, Accept-Language'}:{})}:{};if(Number.isSafeInteger(error.retryAfter)&&error.retryAfter>0)headers['Retry-After']=String(error.retryAfter);if(error instanceof IdentityFault||error instanceof MessagingFault||error instanceof StorageError||error.status)return json({error:error.code||'invalid_request',message:error.message,...error.code==='signup_capacity_reached'?{capacity:error.capacity}:{}},status(error),headers);if(env.LOCAL_DEVELOPMENT==='true')console.error('Local runtime exception:',error.name,error.message);return json({error:'internal_error',message:'We could not complete this request. Please try again.'},500,headers);}
  finally{engine?.dispose();}
 },
 async scheduled(controller,env,ctx){
   if(env.DEVELOPER_CONTACT_POPULATION)ctx.waitUntil(env.DEVELOPER_CONTACT_POPULATION.censusStep());
   // Account lifecycle sweep (present only when LIFECYCLE_ENABLED): arms schedules and nudges bounded ticks;
   // per-account alarms drive notices, suspension and, only when separately enabled, purge.
   if(env.LIFECYCLE_SWEEP)ctx.waitUntil(env.LIFECYCLE_SWEEP.run({trigger:'cron'}).catch(()=>{}));
 }
};
