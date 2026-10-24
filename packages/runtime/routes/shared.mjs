// Helpers shared by the HTTP router (packages/runtime/http.mjs) and its per-slice route modules
// (packages/runtime/routes/index.mjs): responses, cookies, bounded bodies, rate limits and the account RPC handle.
import {createFlags} from '../../flags/evaluate.mjs';
import {getFlag} from '../../flags/registry.mjs';
import {legacyValue} from '../../flags/env.mjs';
import {flagContext} from '../flags.mjs';
import {enforceAbusePolicy} from '../../core/abuse-policy.mjs';
import {CONTACT_DELIVERY_STATUS} from '../../messaging/contact-delivery-service.mjs';

export {lifecycleUnknown,lookupUnknown,contactUnknown} from '../public-unknown.mjs';
const encoder=new TextEncoder();
export const signedContactPath=/^\/users\/((?:[a-z0-9][a-z0-9_-]{2,31}|n\.[0-9abcdefghjkmnpqrstvwxyz]{1,9}))\/contact\/([a-f0-9-]{36})$/;
export const privateHeaders={ 'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()' };
export const json=(data,status=200,extra={})=>{const headers=new Headers({...privateHeaders,'Content-Type':'application/json'});if(extra instanceof Headers){for(const [key,value]of extra)if(key!=='set-cookie')headers.set(key,value);for(const value of extra.getSetCookie())headers.append('Set-Cookie',value);}else for(const [key,value]of Object.entries(extra))headers.set(key,value);return new Response(JSON.stringify(data),{status,headers});};
export const publicUnknown=(headers={},request)=>{const response=json({error:'not_found'},404,headers);return request?.method==='HEAD'?new Response(null,{status:404,headers:response.headers}):response;};
export const cookie=(token,local,maxAge=86400)=>`${local?'bindle_session':'__Host-bindle_session'}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${local?'':'; Secure'}`;
export function sessionToken(request,local){const name=local?'bindle_session':'__Host-bindle_session';for(const piece of (request.headers.get('Cookie')||'').split(';')){const [key,...rest]=piece.trim().split('=');if(key===name)return decodeURIComponent(rest.join('='));}return undefined;}
export function setupCookie(request,local){const name=local?'bindle_setup':'__Host-bindle_setup';for(const piece of (request.headers.get('Cookie')||'').split(';')){const [key,...rest]=piece.trim().split('=');if(key===name){const value=rest.join('=');return /^[a-f0-9-]{72}$/.test(value)?value:undefined;}}}
export function deviceCookie(request,local){const name=local?'bindle_device':'__Host-bindle_device';for(const piece of (request.headers.get('Cookie')||'').split(';')){const [key,...rest]=piece.trim().split('=');if(key===name)return decodeURIComponent(rest.join('='));}return undefined;}
export function subnet(value){if(/^\d+\.\d+\.\d+\.\d+$/.test(value))return value.split('.').slice(0,3).join('.')+'/24';if(value.includes(':')){const [left,right='']=value.toLowerCase().split('::');const a=left?left.split(':'):[],b=right?right.split(':'):[];const groups=[...a,...Array(Math.max(0,8-a.length-b.length)).fill('0'),...b];return groups.slice(0,3).map(x=>parseInt(x||'0',16).toString(16)).join(':')+'::/48';}return 'unknown';}
/** The caller network for per-network budgets that must not be split by address rotation: IPv4 /24 (as `subnet`),
 * IPv6 /64 (one end-site allocation, where `subnet` uses /48). Other callers keep `subnet`. */
export function subnet64(value){const mapped=/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value??'');if(mapped)return subnet(mapped[1]);// IPv4-mapped IPv6 is its IPv4 /24 (review 2026-10-23)
 if(/^\d+\.\d+\.\d+\.\d+$/.test(value))return subnet(value);if(value.includes(':')){const [left,right='']=value.toLowerCase().split('::');const a=left?left.split(':'):[],b=right?right.split(':'):[];const groups=[...a,...Array(Math.max(0,8-a.length-b.length)).fill('0'),...b];return groups.slice(0,4).map(x=>parseInt(x||'0',16).toString(16)).join(':')+'::/64';}return 'unknown';}
export async function pseudonym(value,secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function consume(env,key,windowMs,limit,lifetime=false,peek=false){return env.ABUSE.consume(key,{windowMs,limit,lifetime,...peek?{peek:true}:{}});}
export async function limit(env,{operation,remoteIP,address,region,handle,phase,onDenied,signupKind,admissionId}){
  const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;if(!secret)return false;
  const ip=await pseudonym(address||remoteIP||'unknown',secret);// `address`: an optional coarser per-address key (an IPv6 /64)
 const network=await pseudonym(subnet(remoteIP||'unknown'),secret);
  return enforceAbusePolicy({consume:async window=>{if(window.signup){if(!env.ABUSE.consumeSignup)throw Object.assign(new Error('Signup capacity is unavailable.'),{code:'signup_capacity_unavailable',status:503});// The admission ID makes a redelivered capacity claim idempotent: one unit per signup.
const receipt=typeof admissionId==='string'?{admissionId,admissionDigest:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('signup\0'+window.signup.kind+'\0'+admissionId)))].map(x=>x.toString(16).padStart(2,'0')).join('')}:{};const result=await env.ABUSE.consumeSignup(window.key,{limit:window.limit,freeLimit:window.signup.freeLimit,kind:window.signup.kind,...receipt});if(result?.admitted===true)return true;if(!['free','global'].includes(result?.capacity))throw Object.assign(new Error('Signup capacity is unavailable.'),{code:'signup_capacity_unavailable',status:503});throw Object.assign(new Error(result.capacity==='free'?'Free signups are closed for now while we bootstrap and scale.':'Signups are closed for now while we bootstrap and scale.'),{code:'signup_capacity_reached',capacity:result.capacity,status:503});}const admitted=await consume(env,window.key,window.windowMs,window.limit,window.lifetime===true,window.peek===true);if(!admitted)onDenied?.(window);return admitted;}},{operation,phase,signupKind,ipHash:ip,subnetHash:network,handleHash:handle?await pseudonym(handle,secret):undefined,regionHash:await pseudonym(region||'unknown',secret),signupLimits:env});
}
/** The platform port is already pinned. The empty-store fallback supports direct/local adapters. */
export const routeFlags=(env,ctx={})=>(env.flags??env.FLAGS??createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}},env})).for(env.flags||env.FLAGS?ctx:flagContext(ctx,{request:ctx.request,platform:env.FLAGS_PLATFORM??'worker',now:Date.now()}));
export const capability=(env,name)=>legacyValue(name,env,{platform:env.FLAGS_PLATFORM??'worker'});
/** Preserve strict-string sites during the legacy cutover; managed values use the evaluator. */
export function flagEnabled(env,name,ctx={},strict=false){const flags=routeFlags(env,ctx),decision=flags.evaluate(name),state=flags.envState(name),legacy=state.state==='force-on-legacy'&&(decision.reason==='legacy-env'||flags.version===0&&['DEVICE_AUTHORIZATION_ENABLED','INCREMENTAL_AUTH_ENABLED','BROKERING_ENABLED'].includes(name)&&getFlag(name).requires.some(dep=>decision.reason==='dependency:'+dep&&flags.evaluate(dep).reason==='no-record'));return legacy?strict?state.raw==='true':state.value:decision.value;}
/** Protocol declarations and mounts ignore audience rules. */
export const flagGlobal=(env,name)=>routeFlags(env).global(name)||flagEnabled(env,name)&&routeFlags(env).envState(name).state==='force-on-legacy';
/** Legacy mounts stay hidden until console adoption. Once managed, retained owner paths ignore targeting and kills. */
export const flagReadable=(env,name,strict=false)=>routeFlags(env).version>0||flagEnabled(env,name,{},strict);
export const sessionFeatures=(env,owner)=>{const ctx={subject:{kind:'account',owner}};return {identityTransferOutEnabled:flagEnabled(env,'IDENTITY_TRANSFER_OUT_ENABLED',ctx),identityTransferInEnabled:flagEnabled(env,'IDENTITY_TRANSFER_IN_ENABLED',ctx),identitySuccessorAdoptionEnabled:flagEnabled(env,'IDENTITY_SUCCESSOR_ADOPTION_ENABLED',ctx),organizationsEnabled:flagEnabled(env,'ORGANIZATIONS_ENABLED',ctx,true),memberCertificatesEnabled:flagEnabled(env,'MEMBER_CERTIFICATES_ENABLED',ctx,true),intentLinksEnabled:flagEnabled(env,'INTENT_LINKS_ENABLED',ctx),deviceAuthorizationEnabled:flagEnabled(env,'DEVICE_AUTHORIZATION_ENABLED',ctx),incrementalAuthorizationEnabled:flagEnabled(env,'INCREMENTAL_AUTH_ENABLED',ctx)&&env.INCREMENTAL_AUTHORIZATION?.mounted===true,integrationsEnabled:flagEnabled(env,'INTEGRATIONS_ENABLED',ctx,true),eventBusesEnabled:flagEnabled(env,'EVENT_BUSES_ENABLED',ctx,true),incrementalAuthEnabled:flagEnabled(env,'INCREMENTAL_AUTH_ENABLED',ctx)&&env.INCREMENTAL_AUTHORIZATION?.mounted===true,activityV2Enabled:flagEnabled(env,'ACTIVITY_V2_ENABLED',ctx),semanticSearchEnabled:flagEnabled(env,'SEMANTIC_SEARCH_ENABLED',ctx),beamEnabled:flagEnabled(env,'BEAM_ENABLED',ctx),extensionsEnabled:flagEnabled(env,'EXTENSIONS_ENABLED',ctx),overQuotaRetentionEnabled:flagEnabled(env,'OVER_QUOTA_RETENTION_ENABLED',ctx),accountExportEnabled:flagEnabled(env,'ACCOUNT_EXPORT_ENABLED',ctx),accountDeletionEnabled:flagEnabled(env,'ACCOUNT_DELETION_ENABLED',ctx),emailRemovalEnabled:flagEnabled(env,'EMAIL_REMOVAL_ENABLED',ctx)};};
export function signupEnabled(env,ctx={}){
 const flags=routeFlags(env,ctx),decision=flags.evaluate('SIGNUP_ENABLED'),raw=flags.envState('SIGNUP_ENABLED').raw,local=env.LOCAL_DEVELOPMENT==='true',present=value=>typeof value==='string'&&value.trim().length>0;
 // Local signup and RELEASE_READY were implicit defaults before console ownership.
 const enabled=decision.reason==='no-record'?local||raw===undefined&&env.RELEASE_READY==='true':decision.value;
 return enabled&&(env.SIGNUP_CONTACT_REQUIRED!=='true'||capability(env,'EMAIL_SETUP_AVAILABLE')||capability(env,'PUSH_AVAILABLE'))&&present(env.RECOVERY_SIGNING_KEY)&&(local||[env.TURNSTILE_SITE_KEY,env.TURNSTILE_SECRET_KEY,env.KEY_ENCRYPTION_KEY].every(present));
}
export async function turnstile(env,input){
  if(env.LOCAL_DEVELOPMENT==='true'&&input.token==='local-browser-test-token')return true;
  if(!env.TURNSTILE_SECRET_KEY)return false;
  try{const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:input.token,remoteip:input.remoteIP}),signal:AbortSignal.timeout(10000)});const result=await response.json();return result.success===true&&(env.LOCAL_DEVELOPMENT==='true'||result.hostname===input.hostname&&result.action===input.action);}catch{return false;}
}
export async function identity(env){return env.IDENTITY_ENGINE();}
// A cloned request tees its stream: awaiting one branch's cancellation waits for
// the unread original. Start cancellation without delaying the bounded refusal.
export async function body(request,max=100000){const content=request.headers.get('Content-Type')||'';if(!content.startsWith('application/json'))throw Object.assign(new Error('Use JSON for this request.'),{code:'json_required',status:415});const reader=request.body?.getReader();if(!reader)throw Object.assign(new Error('Request body required'),{status:400});let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){void reader.cancel().catch(()=>{});throw Object.assign(new Error('Request is too large.'),{code:'body_too_large',status:413});}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}try{const result=JSON.parse(new TextDecoder().decode(bytes));if(!result||typeof result!=='object'||Array.isArray(result))throw new Error();return result;}catch{throw Object.assign(new Error('Request JSON must be an object.'),{code:'invalid_json',status:400});}}
export function status(error){if(error.status)return error.status;return {unauthorized:401,csrf:403,forbidden:403,not_found:404,conflict:409,handle_unavailable:409,idempotency_conflict:409,quota_exceeded:429,account_quota_exceeded:429,rate_limited:429,email_unavailable:503,push_unavailable:503,contact_required:409,email_already_linked:409,challenge_failed:403,intake_conflict:409,rotation_conflict:409,tag_label_conflict:409,audience_malformed:400}[error.code]||CONTACT_DELIVERY_STATUS[error.code]||400;}
export const jwsPart=(value,index)=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.split('.')[index].replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));}catch{return null;}};
// Bounded raw body read; limits apply while streaming.
export async function bytesOf(request,max){const reader=request.body?.getReader();if(!reader)throw Object.assign(new Error('Message body required.'),{code:'invalid_envelope',status:400});const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Object.assign(new Error('Message exceeds the request limit.'),{code:'too_large',status:413});}chunks.push(value);}const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}return out;}
/** A route result returned to the platform as is, outside the router's error funnel: the promise is not awaited
 * inside the router's `try`, exactly as a handler's un-awaited `return promise` was before the split. */
export const passthrough=promise=>Object.freeze({passthrough:promise});
/** `keepPolicy`: a handler's own CSP stays authoritative; only the build's import-map hash joins its script-src. */
export async function securePage(response,isolatedRecovery=false,immutable=false,{keepPolicy=false}={}){
 const own=keepPolicy?response.headers.get('Content-Security-Policy'):null;
 const headers=new Headers(response.headers),html=headers.get('Content-Type')?.includes('text/html');
 for(const [key,value]of Object.entries(privateHeaders))if(key!=='Cache-Control')headers.set(key,value);
 headers.set('Cache-Control',immutable&&response.ok?'public, max-age=31536000, immutable':html?'no-store':headers.get('Cache-Control')||'no-cache');
 let body=response.body,mapPolicy='';
 if(html){
  body=await response.text();
  const hash=/<meta name="bindle-import-map-csp" content="(sha256-[A-Za-z0-9+/]{43}=)">/.exec(body)?.[1];
  if(hash)mapPolicy=` '${hash}'`;
 }
 if(own){headers.set('Content-Security-Policy',mergeImportMapPolicy(own,mapPolicy));return new Response(body,{status:response.status,headers});}
 headers.set('Content-Security-Policy',isolatedRecovery?
  `default-src 'self'; script-src 'self'${mapPolicy} 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; worker-src 'self'`:
  `default-src 'self'; script-src 'self'${mapPolicy} https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'`);
 return new Response(body,{status:response.status,headers});
}

function mergeImportMapPolicy(policy,mapPolicy){return policy.split(';').map(part=>part.trim()).filter(Boolean).map(part=>mapPolicy&&/^script-src\s/i.test(part)&&!/'none'/.test(part)?part+mapPolicy:part).join('; ');}
export async function brandPage(response,env){if(!env.BRAND_NAME||env.BRAND_NAME==='3sln.me'||!response.headers.get('Content-Type')?.includes('text/html'))return response;const name=env.BRAND_NAME.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');let html=await response.text();html=html.replace(/(<a\b[^>]*\bdata-bindle-brand-logo(?:="[^"]*")?(?=\s|>)[^>]*>)[\s\S]*?<\/a>/g,(_,open)=>`${open}<span>${name}</span></a>`);html=html.replace(/<title>3sln\.me[^<]*<\/title>/,()=>`<title>${name}</title>`).replaceAll('<span>3sln.me</span>',()=>`<span>${name}</span>`).replace('<img src="/branding/3sln-lockup.svg" alt="3sln" width="91" height="34"><span class="logo-suffix">.me</span>',()=>`<span>${name}</span>`).replaceAll('/icon.svg','/generic-icon.svg').replaceAll('/branding/3sln-avatar.png','/generic-icon.svg');return new Response(html,{status:response.status,headers:response.headers});}
export function accountHandle(env,id){const stub=env.ACCOUNTS.get(id);return new Proxy({}, {get:(_,method)=>async(...args)=>{const result=await stub.invoke({method,args});if(result?.$fault){const error=new Error(result.$fault.message);Object.assign(error,{code:result.$fault.code,status:result.$fault.status||status(result.$fault),retryAfter:result.$fault.retryAfter});throw error;}return result;}});}
