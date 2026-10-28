import {intentFeature} from './intents.mjs';
import {createAppEngine,read} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {PublicIdentityAvailable} from '../../app/domains/public-identity.mjs';
import {holdBusRPC,busWaitsPort} from '../../events/waiter.mjs';
import {EVENT_BUS_CONTRACT} from '../../federation/event-buses.mjs';
import {handleIncrementalToken} from '../incremental-authorization.mjs';
import {movedAuthorization} from './moved.mjs';
// HTTP routes of slice 13c, Federation and the MCP authority (docs/architecture/app-engine.md §12): the embed origin, federation protocol and authorization entry, MCP OAuth and owner MCP routes.
// Stage handlers and route-module shape: packages/runtime/routes/index.mjs.
import {accountCookiesEnabled,selectedAccountMember,parseAccountCookies,hasAccountVault,removedAccountCookies,accountFault,readAccountMember,defaultAccountOwner,removedMemberCookie,accountCookieName} from '../account-cookies.mjs';
import {EXT,declare,withExtensionEntries} from '../../core/extensions.mjs';
import {IdentityAction} from '../../identity/index.mjs';
import {handleMcpPublic,handleMcpOwner,mcpPublicPath,mcpOwnerPath} from '../../mcp/http.mjs';
import {handleFederation} from '../../federation/http.mjs';
import {handleAuthorizationEntry,handleEmbedAPI} from '../federation-entry-http.mjs';
import {SHELL_TEMPLATE,SHELL_BUILD,shellBuild,shellConfig,fillShell,shellPolicy} from '../../federation/embed-shell.mjs';
import {ISLAND_PATH} from '../../sdk/src/islands-protocol.mjs';
import {AVATAR,avatarOrigins,readAvatarSource,reencodeAvatar} from '../../federation/embed-avatar.mjs';
import {handleObjectURL} from '../../storage/object-http.mjs';
import {UUID as uuidPattern} from '../../core/primitives.mjs';
/** A fixed, script-free page for an authorization request that already ended (bug hunt round 3, B5). */
export function authorizationEndedPage(language){
 const es=/^es\b/i.test(String(language??'').trim());
 return es?'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Esta solicitud ya terminó</title></head><body><main><h1>Esta solicitud ya terminó</h1><p>Esta solicitud de autorización caducó o ya se completó. Vuelve a la app e inicia sesión de nuevo si lo necesitas. <a href="/console">Ir a tu cuenta</a>.</p></main></body></html>'
  :'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>This request has ended</title></head><body><main><h1>This request has ended</h1><p>This authorization request expired or was already completed. Return to the app and sign in again if you need to. <a href="/console">Go to your account</a>.</p></main></body></html>';
}
import {flagGlobal,capability,json,lifecycleUnknown,body,cookie,sessionToken,pseudonym,subnet,subnet64,identity,securePage,brandPage,passthrough} from './shared.mjs';

const encoder=new TextEncoder();
export const stages={
 async edge({request,env,url,local}){
   // The dedicated embed origin serves only the islands shell, its assets and the embed API (components profile §3).
   if(env.EMBED_ORIGIN&&url.origin===env.EMBED_ORIGIN&&url.origin!==env.APP_ORIGIN)return await embedOriginRoutes(request,env,url,local);
 },
 async public({request,env,path,local}){
   if(path==='/.well-known/bindle/manifest.json'||path.startsWith('/oauth/')||path==='/bindle/rpc'||path.startsWith('/bindle/objects/')||path.startsWith('/api/oauth/')||path==='/api/preferences'||path==='/api/grants'||path.startsWith('/api/grants/')){
    let entryRemote,anonymousCaller;
    // Device-code polling has its own per-network and global poll bounds and RFC 8628 back-off (LA3-S2): it is
    // answered before the generic limiter, whose 429 would end a client's flow instead of slowing it.
    const deviceMounted=env.DEVICE_GRANT?.mounted===true&&flagGlobal(env,'DEVICE_AUTHORIZATION_ENABLED');
    if(deviceMounted&&path==='/oauth/token'){const device=await deviceRoutes(request,env,path,local);if(device)return device;}
    if(flagGlobal(env,'FEDERATION_ENABLED')&&request.method!=='OPTIONS'){
     const remote=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown'),secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;
     if(!secret)return json({error:'temporarily_unavailable',message:'Application connections are not configured.'},503);
     const ip=entryRemote=await pseudonym(remote,secret),network=await pseudonym(subnet(remote),secret),lane=parseInt(ip.slice(0,2),16)%16;
     // Review 2026-10-23: anonymous authorization requests are budgeted per caller NETWORK (IPv6 /64, IPv4 /24), so
     // rotating addresses inside one allocation buys nothing (packages/federation/service.mjs ANONYMOUS_REQUESTS_*).
     // Re-verification 2026-10-23: the caller also names its wider allocation (IPv6 /48 via `subnet`, the same /24 for
     // IPv4; IPv4-mapped IPv6 counts as IPv4), as `<network>.<allocation>`, so one /48 cannot spread over 65,536 /64s.
     {const narrow=subnet64(remote),mapped=/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(remote);anonymousCaller=(await pseudonym('anonymous-caller\0'+narrow,secret)).slice(0,32)+'.'+(await pseudonym('anonymous-allocation\0'+subnet(mapped?mapped[1]:remote),secret)).slice(0,32);}
     const readOnly=request.method==='GET'||request.method==='HEAD',rpc=path==='/bindle/rpc'||path.startsWith('/bindle/objects/');
     // X8-R4/R5: introspection is server-to-server on every brokered write, so it has its own per-IP/subnet class (not
     // the token endpoint's 30/min) ahead of the handler's per-connection window and its pre-authentication account call.
     const introspect=path==='/oauth/brokering/introspect'&&capability(env,'BROKERED_INTROSPECTION_MOUNTED'),rateClass=introspect?'introspect':rpc?'rpc':readOnly?'read':'mutation';
     if(!await env.ABUSE.consume(`bindle/${rateClass}/ip/${ip}`,{windowMs:60000,limit:introspect?300:rpc?120:readOnly?120:30})||!await env.ABUSE.consume(`bindle/${rateClass}/subnet/${network}`,{windowMs:60000,limit:introspect?1200:rpc?400:200})||!await env.ABUSE.consume(`bindle/${rateClass}/service-v1-${lane}`,{windowMs:60000,limit:introspect?1200:rpc?400:200})){const appOrigin=request.headers.get('Origin');const cors=path.startsWith('/bindle/objects/')?{'Access-Control-Allow-Origin':'*'}:appOrigin&&env.FEDERATION_AUTHORITY?.clients?.some(client=>client.origin===appOrigin)?{'Access-Control-Allow-Origin':appOrigin,Vary:'Origin'}:{};return json({error:'rate_limited',message:'Please wait before continuing this application connection.'},429,{'Retry-After':'60',...cors});}
    }
    if(path==='/oauth/brokering/introspect'&&capability(env,'BROKERED_INTROSPECTION_MOUNTED'))return env.BROKERED_INTROSPECTION(request);
    if(path.startsWith('/bindle/objects/'))return passthrough(handleObjectURL(request,{controller:env.FEDERATION_AUTHORITY,enabled:flagGlobal(env,'FEDERATION_ENABLED')}));
    // Device authorization grant (LA3): only where the adapter mounted DEVICE_GRANT, which requires the flag.
    if(deviceMounted&&path!=='/oauth/token'){const device=await deviceRoutes(request,env,path,local);if(device)return device;}
    // Member-token DPoP RPC (ORG-4 §7.2) under the organization/member flags, independent of the device grant; where the
    // device grant is mounted its RPC path above already serves these tokens, unchanged.
    if(!deviceMounted&&env.DEVICE_GRANT?.memberRpcMounted===true&&path==='/bindle/rpc'&&request.method==='POST'&&request.headers.get('Authorization')?.startsWith('DPoP '))return dpopRpc(request,env,input=>env.DEVICE_GRANT.memberRpc(input));
    // Provider-owned authorization entry (adaptive sign-in §7): cookieless creation keyed by the caller's IP
    // pseudonym, owner steps resolved through the multi-account cookies, and its own strict document policy (F7).
    const entryResponse=await handleAuthorizationEntry(request,{entries:env.FEDERATION_ENTRIES,issuer:env.APP_ORIGIN,assets:env.ASSETS,allowInsecureLocalhost:local,enabled:flagGlobal(env,'FEDERATION_ENABLED')&&Boolean(env.FEDERATION_ENTRIES),remote:()=>entryRemote,ownerContext:entryRequest=>entryOwnerContext(entryRequest,env,local),endSession:(entryRequest,context,subject)=>entryEndSession(entryRequest,env,local,subject)});
    if(entryResponse)return entryResponse.headers.get('Content-Type')?.includes('text/html')?passthrough(securePage(await brandPage(entryResponse,env),false,false,{keepPolicy:true})):entryResponse;
    if(flagGlobal(env,'INCREMENTAL_AUTH_ENABLED')){const incremental=await handleIncrementalToken(request,{port:env.INCREMENTAL_AUTHORIZATION,issuer:env.APP_ORIGIN,origins:(origin,id)=>env.FEDERATION_AUTHORITY?.clients?.some(c=>c.origin===origin)||env.FEDERATION_AUTHORITY?.directory?.isMetadataId(id)&&new URL(id).origin===origin,authorizeClient:async id=>{const directory=env.FEDERATION_AUTHORITY?.directory;if(directory?.isMetadataId(id))await directory.assertAllowed(id);},proofs:{verify:proof=>env.INCREMENTAL_AUTHORIZATION.tokenProof(proof),nonce:()=>env.INCREMENTAL_AUTHORIZATION.tokenNonce()}});if(incremental)return incremental;}
    // PORT-3 (identity portability spec §11): a request naming a moved identity answers `identity_moved` with `{to}`
    // while its redirect runs, and afterwards exactly as for a deleted identity (the probe's uniform 404).
    let movedTarget=null;
    const authority=env.FEDERATION_AUTHORITY,controller=authority&&path==='/api/oauth/requests'&&request.method==='POST'?new Proxy(authority,{get:(target,method)=>method==='beginAuthorization'?async input=>{const moved=await movedAuthorization(env,input?.identity);if(moved){movedTarget=moved.to;throw Object.assign(new Error('This identity moved to another provider.'),{code:'identity_moved',status:400});}const parts=typeof input.identity==='string'?input.identity.split('@'):[];if(parts.length===2&&parts[1].toLowerCase()===new URL(env.APP_ORIGIN).host){const probe=createAppEngine({providers:{identityShards:env.IDENTITY_REPOSITORY,accounts:env.ACCOUNTS,clock:systemClock,random:cryptoRandom,audit:nullAudit}});try{await read(probe,new PublicIdentityAvailable({input:{handle:parts[0]}}));}finally{probe.dispose();}}return target.beginAuthorization(input,{caller:anonymousCaller});}:Reflect.get(target,method,target)}):authority;
    const response=await handleFederation(request,{controller,issuer:env.APP_ORIGIN,allowInsecureLocalhost:local,assets:env.ASSETS,enabled:flagGlobal(env,'FEDERATION_ENABLED'),brokering:flagGlobal(env,'BROKERING_ENABLED')?env.FEDERATION_BROKERING:undefined,ownerContext:ownerRequest=>entryOwnerContext(ownerRequest,env,local)});
    if(movedTarget&&response?.status===400){const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');return json({error:'identity_moved',message:'This identity moved to another provider.',to:movedTarget},400,headers);}
    // Contact intents (links §6.4, the intents extension): this host accepts `bindle_intent` on its console entry.
    // Entry routes and the components profile are advertised only while this adapter mounts them (review F8).
    if(response&&path==='/.well-known/bindle/manifest.json'&&request.method==='GET'&&response.ok){const manifest=await response.json(),entries=env.FEDERATION_ENTRIES?env.FEDERATION_ENTRIES.manifest({components:await embedShellMounted(env)}):{};return json(withExtensionEntries(manifest,[...entries.extensions??[],...intentFeature(env),...flagGlobal(env,'IDENTITY_TRANSFER_IN_ENABLED')&&env.TRANSFER_IN_INTAKE?[declare(EXT.portability,{transfer_in_endpoint:env.APP_ORIGIN+'/bindle/portability/transfer-in'})]:[]],{merge:true}),200,{'Access-Control-Allow-Origin':'*'});}
    // Bug hunt round 3, B5: Back from the app (or an old tab) onto a completed or expired authorization request is a
    // browser navigation; it gets a readable page instead of the raw JSON error. API clients keep the JSON answer.
    if(response&&path==='/oauth/authorize'&&request.method==='GET'&&response.status===400&&request.headers.get('Accept')?.includes('text/html'))return passthrough(securePage(new Response(authorizationEndedPage(new URL(request.url).searchParams.get('lang')??request.headers.get('Accept-Language')),{status:400,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',Vary:'Accept'}})));
    if(response)return path==='/oauth/authorize'&&response.headers.get('Content-Type')?.includes('text/html')?passthrough(securePage(await brandPage(response,env))):response;
    return json({error:'not_found'},404);
   }
   if(mcpPublicPath(path)){
    if(!flagGlobal(env,'MCP_ENABLED'))return passthrough(handleMcpPublic(request,env));
    if(path==='/mcp/oauth/authorize'||path==='/mcp/oauth/token'){
     const remote=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown'),secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;
     if(!secret)return json({error:'temporarily_unavailable',message:'Assistant connections are not configured.'},503);
     const ip=await pseudonym(remote,secret),network=await pseudonym(subnet(remote),secret),partition=parseInt(ip.slice(0,2),16)%16;
     if(!await env.ABUSE.consume(`mcp/oauth/ip/${ip}`,{windowMs:60000,limit:30})||!await env.ABUSE.consume(`mcp/oauth/subnet/${network}`,{windowMs:60000,limit:100})||!await env.ABUSE.consume(`mcp/oauth/service-v1-${partition}`,{windowMs:60000,limit:32}))return json({error:'rate_limited'},429);
    }
    return passthrough(handleMcpPublic(request,env));
   }
 },
 async beforeActivity({request,env,path,owner}){
    if(mcpOwnerPath(path))return passthrough(handleMcpOwner({request,env,owner,body}));
 },
};
// Device grant mounts (LA3; docs/spec/device-authorization.md). Non-browser endpoints: the provider refuses Origin and
// Sec-Fetch-* itself, and no response here carries CORS. The device_code token branch, device-code cancellation and
// DPoP RPC are picked out before the generic federation handler; everything else falls through to it unchanged.
const DEVICE_URN='urn:ietf:params:oauth:grant-type:device_code',OPAQUE=/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/;
const formRequest=request=>request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()==='application/x-www-form-urlencoded';
async function boundedText(request,max){
 const length=Number(request.headers.get('Content-Length'));if(Number.isFinite(length)&&length>max){void request.body?.cancel().catch(()=>{});return null;}
 const reader=request.body?.getReader();if(!reader)return '';const chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){void reader.cancel().catch(()=>{});return null;}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(bytes);
}
const oauthResponse=result=>new Response(JSON.stringify(result.body),{status:result.status,headers:{'Content-Type':'application/json','X-Content-Type-Options':'nosniff',...result.headers}});
// Country and network trust only where the runtime's client address and geo source are authoritative (Workers).
function deviceNetwork(request,local){const remoteIP=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown'),country=request.cf?.country;return {remoteIP,...!local&&request.headers.has('CF-Connecting-IP')&&typeof country==='string'&&/^[A-Z]{2}$/.test(country)?{country,networkTrusted:true}:{}};}
// Browser evidence is Origin or Sec-Fetch-Site/Dest/User, which browsers send together. Node's fetch (undici, also
// the SDK's CLI transport) sends a lone `Sec-Fetch-Mode: cors`, which identifies no browser, so only that lone header is
// withheld from the provider's refusal check (reconciled in docs/release/linked-approval-review.md, LA3 mount).
const deviceHeaders=request=>{const headers=Object.fromEntries(request.headers);if(!Object.hasOwn(headers,'origin')&&headers['sec-fetch-mode']==='cors'&&Object.keys(headers).filter(name=>name.startsWith('sec-fetch-')).join()==='sec-fetch-mode')delete headers['sec-fetch-mode'];return headers;};
async function deviceRoutes(request,env,path,local){
 const grant=env.DEVICE_GRANT;
 if(path==='/oauth/device_authorization'){
  if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST','Cache-Control':'no-store'});
  const text=await boundedText(request,8192);if(text===null)return json({error:'invalid_request'},400,{'Cache-Control':'no-store'});
  return oauthResponse(await grant.authorize({headers:deviceHeaders(request),body:text,...deviceNetwork(request,local)}));
 }
 if(path==='/oauth/token'&&request.method==='POST'&&formRequest(request)){
  const text=await boundedText(request.clone(),8192);if(text===null||new URLSearchParams(text).get('grant_type')!==DEVICE_URN)return null;
  // Overload is RFC 8628 back-off, never a terminal error; an unexpected failure after redemption is a 503 (LA3-S4).
  let result;try{result=await grant.token({headers:deviceHeaders(request),body:text,remoteIP:deviceNetwork(request,local).remoteIP});}catch(error){if(!lifecycleUnknown(error))return json({error:'temporarily_unavailable'},503,{'Cache-Control':'no-store','Retry-After':'5'});result={status:410};}
  // U404: a grant whose own subject is deleted/deleting/moved is an invalid grant (RFC 6749), never 404/410.
  if(lifecycleUnknown({code:result.body?.error,status:result.status}))result={status:400,body:{error:'invalid_grant'}};
  if(result.status===503&&result.body?.error==='temporarily_unavailable')result={...result,status:400,body:{error:'slow_down',interval:10}};
  return oauthResponse(result);
 }
 // A device code is cancelled with a DPoP proof for its key; the RFC 7009 path then runs as usual (unknown is a silent
 // success there), so refresh/access revocation is never shadowed. Hinted refresh/access revocations skip this step.
 if(path==='/oauth/revoke'&&request.method==='POST'&&formRequest(request)&&request.headers.has('DPoP')){
  const text=await boundedText(request.clone(),8192);if(text===null)return null;const params=new URLSearchParams(text);
  // Only an explicit device_code hint can fail the request (LA3-S1). Without a hint the cancel is best effort and the
  // RFC 7009 handler always runs; browsers never reach it.
  const hint=params.get('token_type_hint'),browser=request.headers.has('Origin')||[...request.headers.keys()].some(name=>name.startsWith('sec-fetch-')&&name!=='sec-fetch-mode');
  if(!OPAQUE.test(params.get('token')??'')||browser||!['device_code',null].includes(hint))return null;
  const result=await grant.cancel({headers:deviceHeaders(request),body:text}).catch(()=>null);
  if(hint==='device_code'&&result)return oauthResponse(result);
  return null;
 }
 if(path==='/bindle/rpc'&&request.method==='POST'&&request.headers.get('Authorization')?.startsWith('DPoP '))return dpopRpc(request,env,input=>grant.rpc(input));
 return null;
}
/** DPoP resource RPC over `call(input)`: the device grant's provider RPC, or the member-token path (`memberRpc`). */
async function dpopRpc(request,env,call){
  if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')return json({error:'json_required'},415,{'Cache-Control':'no-store'});
  const text=await boundedText(request,1500000);let envelope;try{envelope=text===null?null:JSON.parse(text);}catch{}
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))return json({error:'invalid_request'},400,{'Cache-Control':'no-store'});
  try{const input={authorization:request.headers.get('Authorization'),dpop:request.headers.get('DPoP'),envelope,...request.headers.has('Origin')?{origin:request.headers.get('Origin')}:{}},waits=busWaitsPort(env.EVENT_BUS_WAITS)??env.EVENT_BUS_WAITER,held=flagGlobal(env,'EVENT_BUSES_ENABLED')&&waits&&envelope.contract===EVENT_BUS_CONTRACT&&envelope.method==='read';const result=held?await holdBusRPC({owner:input.authorization.slice(5).split('.')[0],waits,rpc:lease=>call({...input,busWaits:true,...lease?{busResume:lease}:{}}),recheck:lease=>call({...input,busResume:lease,checkOnly:true})}):await call(input);if(result?.error&&lifecycleUnknown(result.error))throw Object.assign(new Error('A DPoP access token is required.'),{code:'unauthorized'});return json(result,200,{'Cache-Control':'no-store'});}
  catch(caught){
  // U404: a token whose own subject is deleted/deleting/moved is an invalid token (RFC 6750 401), never 404/410.
  const error=lifecycleUnknown(caught)?Object.assign(new Error('A DPoP access token is required.'),{code:'unauthorized'}):caught;const status={unauthorized:401,use_dpop_nonce:401,forbidden:403,rate_limited:429,temporarily_unavailable:503,not_found:404}[error.code]??400;return json({error:error.code??'invalid_request',message:error.code?error.message:'The request could not be completed.'},status,{'Cache-Control':'no-store',...status===401?{'WWW-Authenticate':error.code==='use_dpop_nonce'?'DPoP error="use_dpop_nonce", algs="ES256"':'DPoP algs="ES256"'}:{},...Number.isSafeInteger(error.retryAfter)?{'Retry-After':String(error.retryAfter)}:{}});}
}
/** Owner context for federation and entry owner steps: the tab's authenticated member cookie, else the legacy session. */
async function entryOwnerContext(request,env,local){
 const base={csrfToken:request.headers.get('X-CSRF-Token'),origin:request.headers.get('Origin')??env.APP_ORIGIN};
 // Cookieless routes (token, RPC, revocation, entry creation) never decrypt member cookies.
 if(!request.headers.has('Cookie'))return {...base,sessionToken:undefined};
 if(!accountCookiesEnabled(env))return {...base,sessionToken:sessionToken(request,local)};
 const cookies=parseAccountCookies(request,local),mutation=!['GET','HEAD','OPTIONS'].includes(request.method);
 // As in the /api/ block, a header-less write never falls back to the default member (review M1): it is anonymous,
 // so owner steps fail closed while cookie-indifferent routes (token, RPC) are unaffected.
 if(mutation&&hasAccountVault(cookies,local)&&request.headers.get('X-Bindle-Account')===null)return {...base,sessionToken:undefined};
 const member=await selectedAccountMember(request,env,local,cookies);
 if(member)return {...base,sessionToken:member.token,expectedOwner:member.owner,sessionContext:member.sessionContext};
 return {...base,sessionToken:hasAccountVault(cookies,local)?undefined:sessionToken(request,local)};
}
/** Provider end-session for an authorization entry (auth.md D8; multi-account-sessions "App-requested account flows"):
 * ends only this browser's session for the entry's subject, never other saved accounts or other devices. The
 * subject's member cookie is authenticated by name; when present, the page must name exactly that member and send its
 * live CSRF, and the owner session is revoked before success. No session for the subject here is still a success. */
async function entryEndSession(request,env,local,subject){
 const owner=typeof subject==='string'&&subject.startsWith(env.APP_ORIGIN+'/entities/')?subject.slice(env.APP_ORIGIN.length+10):'';if(!uuidPattern.test(owner))throw accountFault('invalid_request',400);
 const context={origin:request.headers.get('Origin')||env.APP_ORIGIN,csrfToken:request.headers.get('X-CSRF-Token'),remoteIP:request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown')};let member;
 if(accountCookiesEnabled(env)){
  const jar=parseAccountCookies(request,local);
  // Without any member cookie the legacy session still authenticates owner steps, so it is the one to end (review 5).
  if(!hasAccountVault(jar,local))return legacyEnd();
  try{member=await readAccountMember(env,jar,owner,local);}catch(error){return error.code==='invalid_account_cookie'?[removedMemberCookie(accountCookieName(owner,local),local)]:[];}
  if(request.headers.get('X-Bindle-Account')!==owner||request.headers.get('X-Bindle-Session-Context')!==member.sessionContext)throw accountFault('account_context_conflict',409);
  Object.assign(context,{sessionToken:member.token,expectedOwner:owner,sessionContext:member.sessionContext});return revoke(removedAccountCookies(owner,local,await defaultAccountOwner(env,jar,local).catch(()=>null)===owner));
 }
 return legacyEnd();
 async function legacyEnd(){const token=sessionToken(request,local);if(!token||token.split('.')[0]!==owner)return [];context.sessionToken=token;return revoke([cookie('',local,0)]);}
 // Owner revocation precedes success; a session that is already gone (or no longer usable) has nothing left to end.
 async function revoke(cookies){const engine=await identity(env);try{await engine.dispatch(new IdentityAction('logout',{},context)).next('result');}catch(error){if(error.code!=='unauthorized')throw error;}finally{engine.dispose();}return cookies;}
}
const INERT_ISLAND='<!doctype html><meta charset="utf-8"><title></title>';
/** Embed routes exist only with federation, mounted entries and their configured dedicated embed origin. */
const embedMounted=env=>flagGlobal(env,'FEDERATION_ENABLED')&&Boolean(env.EMBED_ORIGIN)&&env.FEDERATION_ENTRIES?.embedOrigin===env.EMBED_ORIGIN;
/** The built shell: its template and build description, or null. Both are build outputs, fixed per deployment. */
async function embedShellBuild(env){
 try{
  const [page,meta]=await Promise.all([SHELL_TEMPLATE,SHELL_BUILD].map(path=>env.ASSETS.fetch(new Request(new URL(path,env.APP_ORIGIN),{method:'GET'}))));
  if(page.status!==200||!page.headers.get('Content-Type')?.includes('text/html')||meta.status!==200){await Promise.all([page.body?.cancel(),meta.body?.cancel()]);return null;}
  const template=await page.text(),build=shellBuild(await meta.json());return build&&template.split('{{CONFIG}}').length===2?{template,build}:null;
 }catch{return null;}
}
/** The components profile is offered only with embed routes mounted, DPoP for embed proofs and a built shell. */
async function embedShellMounted(env){return embedMounted(env)&&Boolean(env.FEDERATION_ENTRIES.dpop)&&await embedShellBuild(env)!==null;}
const embedHeaders={'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
/** Island picture sources: the provider's own static assets and operator-approved origins (packages/federation/embed-avatar.mjs). */
const embedAvatars=env=>({responseMs:AVATAR.responseMs,render:async(source,size)=>reencodeAvatar(await readAvatarSource(source,{issuer:env.APP_ORIGIN,assets:env.ASSETS,fetch:env.EMBED_AVATAR_FETCH,origins:avatarOrigins(env.EMBED_AVATAR_ORIGINS)}),size)});
/** Embed origin (extensions §2.7, CR-X3-16/35; components profile §2.2, §3; embed islands §3): cookieless, no CORS,
 * nothing but islands. The island document is the origin root `/` (owner-approved 2026-10-27); the other served paths
 * are provider-private sub-resources of that document (hashed assets, the service worker and the embed API). Every
 * other path, `/embed` included, is 404. */
async function embedOriginRoutes(request,env,url,local){
 const path=url.pathname,deny=(status=404,error='not_found',extra={})=>new Response(JSON.stringify({error}),{status,headers:{...embedHeaders,'Cache-Control':'no-store','Content-Type':'application/json','Cross-Origin-Resource-Policy':'same-origin',...extra}});
 if(!embedMounted(env))return deny();
 const asset=/^\/embed\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\.(?:m?js|css)$/.test(path)&&!path.includes('..');
 if(path!==ISLAND_PATH&&path!=='/embed/sw.js'&&!asset&&!path.startsWith('/embed/api/'))return deny();
 // Immutable hashed assets are static; the shell and the API pass the same per-IP and per-network admission.
 if(!asset){
  const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;if(!secret)return deny(503,'temporarily_unavailable');
  const remote=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown'),ip=await pseudonym(remote,secret),network=await pseudonym(subnet(remote),secret),lane=path.startsWith('/embed/api/')?'api':'shell';
  if(!await env.ABUSE.consume(`embed/${lane}/ip/${ip}`,{windowMs:60000,limit:lane==='api'?120:600})||!await env.ABUSE.consume(`embed/${lane}/subnet/${network}`,{windowMs:60000,limit:lane==='api'?400:2000}))return deny(429,'rate_limited',{'Retry-After':'60'});
 }
 if(path.startsWith('/embed/api/'))return await handleEmbedAPI(request,{authority:env.FEDERATION_AUTHORITY,embedOrigin:url.origin,enabled:flagGlobal(env,'FEDERATION_ENABLED'),avatars:embedAvatars(env)})??deny();
 if(!['GET','HEAD'].includes(request.method))return deny(405,'method_not_allowed',{Allow:'GET, HEAD'});
 if(path===ISLAND_PATH)return embedShell(request,env,url);
 // Hashed assets and the service worker take no query: one URL, one body, so no cache (HTTP or service worker) can be
 // keyed on attacker-chosen variants.
 if(url.search)return deny();
 const file=await env.ASSETS.fetch(new Request(new URL(path,env.APP_ORIGIN),{method:'GET'}));
 if(file.status!==200){await file.body?.cancel();return deny();}
 const script=/\.m?js$/.test(path);
 // COEP on scripts: the island worker is created by a COEP shell and must itself be COEP (Chromium refuses it otherwise).
 // A script response's CSP governs only a worker it starts: the island worker talks to this origin and the issuer only.
 const headers=new Headers({...embedHeaders,'Content-Type':script?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cross-Origin-Resource-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});
 if(script)headers.set('Content-Security-Policy',`default-src 'none'; script-src 'self'; connect-src 'self'${asset?' '+env.APP_ORIGIN:''}; base-uri 'none'`);
 if(asset)headers.set('Cache-Control','public, max-age=31536000, immutable');else{headers.set('Cache-Control','no-cache');headers.set('Service-Worker-Allowed',ISLAND_PATH);}
 return new Response(request.method==='HEAD'?null:file.body,{status:200,headers});
}
/** One static shell per client: frame-ancestors are the client's redirect-URI origins; unknown clients get an inert page. */
async function embedShell(request,env,url){
 const keys=[...url.searchParams.keys()],id=url.searchParams.get('client'),client=keys.length===1&&keys[0]==='client'&&id?env.FEDERATION_ENTRIES.clients.get(id):undefined;
 let ancestors=[];try{ancestors=[...new Set((client?.redirectUris??[]).map(uri=>new URL(uri).origin))].filter(origin=>(/^https:\/\/[A-Za-z0-9.:[\]-]+$/.test(origin)||env.LOCAL_DEVELOPMENT==='true'&&/^http:\/\/[A-Za-z0-9.:[\]-]+$/.test(origin)));}catch{ancestors=[];}
 // Plain-HTTP parents (tamperable on the network path) never frame islands outside local development (serving review S3).
 const built=ancestors.length?await embedShellBuild(env):null;
 const body=built?fillShell(built.template,shellConfig({issuer:env.APP_ORIGIN,clientId:client.id,origins:ancestors,build:built.build,incremental:env.INCREMENTAL_AUTHORIZATION?.mounted===true})):INERT_ISLAND;
 const policy=built?shellPolicy({issuer:env.APP_ORIGIN,ancestors,scripts:built.build.scripts}):`default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${ancestors.length?ancestors.join(' '):"'none'"}`;
 const tag='"'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(policy+'\0'+body)))].map(b=>b.toString(16).padStart(2,'0')).join('')+'"';
 const headers=new Headers({...embedHeaders,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':policy,'Cache-Control':built||!client?'private, max-age=300':'no-store',ETag:tag,'Origin-Agent-Cluster':'?1','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'cross-origin'});
 if(request.headers.get('If-None-Match')?.split(',').some(value=>value.trim()===tag))return new Response(null,{status:304,headers});
 return new Response(request.method==='HEAD'?null:body,{status:200,headers});
}
