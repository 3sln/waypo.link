// Redirect management adapters (packages/identity/redirect-management.mjs; design §6.4). 3sln.me signs the moved
// identity in as a Bindle client of its current provider with the SDK's own BindleClient (packages/sdk/src/identity.mjs),
// run server side: discovery, the provider's authorization entry or identity request, PKCE S256, and the code exchange
// at the provider's token endpoint, all over the operator's SSRF-safe portability egress (TRANSFER_IN_PORTS.fetch: the
// Worker's strictly-public fetch with a DoH screen, Node's DNS-pinned adapter). No DPoP key, no refresh use: the token
// response is only evidence of who signed in, and its tokens are revoked at once (best effort).
//
// The pending login (PKCE verifier, state, endpoints) and the action chosen before sign-in are sealed under a key
// derived from KEY_ENCRYPTION_KEY for this purpose (HKDF, AES-GCM, purpose AAD) into an opaque `transaction` the browser holds for at most
// 10 minutes and returns with the callback; the server keeps no state. The callback's `state` must equal the sealed one,
// and the authorization code is single use at the provider.
//
// Client identity: a client-id-metadata.v1 document at REDIRECT_CLIENT_PATH (public client, `none` auth, the single
// redirect URI MANAGE_PATH). Providers that do not resolve metadata-document client IDs cannot be used.
import {BindleClient} from '../sdk/src/identity.mjs';
import {revoke} from '../sdk/src/tokens.mjs';
import {portabilityClient,PORTABILITY_LIMITS} from '../identity/successors.mjs';
import {memoryLimiter,clientSite} from '../federation/client-metadata.mjs';
import {attestationRoots,parseAttestationKeySet} from '../identity/attestation-keys.mjs';
import {RedirectManagementService} from '../identity/redirect-management.mjs';
import {redirectRecordsPort} from '../identity/redirect-records.mjs';

export const REDIRECT_CLIENT_PATH='/bindle/portability/redirect-client',MANAGE_PATH='/transfer-manage';
const TRANSACTION_TTL=600000,MAX_TRANSACTION=12000;
const b64u=text=>btoa(text).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unb64u=text=>atob(text.replaceAll('-','+').replaceAll('_','/'));
// Review (info): the transaction is sealed under a key derived for this purpose only (HKDF-SHA-256 from
// KEY_ENCRYPTION_KEY, info below) with a purpose-specific AAD, so no other sealed record can stand in for it.
const PURPOSE='bindle-redirect-management/v1',enc=new TextEncoder();
async function sealingKey(secret,crypto){let raw;try{raw=Uint8Array.from(atob(secret),c=>c.charCodeAt(0));}catch{raw=null;}if(!raw||raw.length!==32)throw new Error('Sealing key is not configured.');const base=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(32),info:enc.encode(PURPOSE)},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function seal(value,secret,crypto){const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(PURPOSE)},await sealingKey(secret,crypto),enc.encode(JSON.stringify(value))));const out=new Uint8Array(12+cipher.length);out.set(iv);out.set(cipher,12);return b64u(String.fromCharCode(...out));}
async function unseal(text,secret,crypto){const bytes=Uint8Array.from(unb64u(text),c=>c.charCodeAt(0));if(bytes.length<29)throw new Error('Invalid sign-in state.');const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:enc.encode(PURPOSE)},await sealingKey(secret,crypto),bytes.slice(12));return JSON.parse(new TextDecoder().decode(clear));}
/** Review L2: the SDK's fetches spend the same per-site and global portability budgets as the portability client
 * (before any egress) and get a deadline. */
export function budgetedEgress(fetcher,limiter,limits=PORTABILITY_LIMITS){
 return async(url,init={})=>{
  const u=new URL(url);
  if(!await limiter.consume('portability/global',limits.global)||!await limiter.consume(`portability/site/${clientSite(u.hostname)}`,limits.perSite))throw Object.assign(new Error('The identity provider egress budget is exhausted.'),{code:'temporarily_unavailable'});
  const deadline=AbortSignal.timeout(limits.timeoutMs*2);
  return fetcher(url,{...init,signal:init.signal?AbortSignal.any([init.signal,deadline]):deadline});
 };
}
/** Storage shim for one BindleClient call: the SDK writes its pending record here; we seal or restore it. */
function sealedStorage(initial={}){
 const items=new Map(Object.entries(initial));
 return {get length(){return items.size;},key:i=>[...items.keys()][i]??null,getItem:k=>items.has(k)?items.get(k):null,setItem:(k,v)=>{items.set(k,String(v));},removeItem:k=>{items.delete(k);},clear:()=>items.clear(),dump:()=>Object.fromEntries(items)};
}
/** The client-id-metadata.v1 document 3sln.me publishes for redirect management. */
export function redirectClientMetadata(origin){return {client_id:origin+REDIRECT_CLIENT_PATH,client_name:'3sln.me redirect management',client_uri:origin,redirect_uris:[origin+MANAGE_PATH],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none'};}

/** The `signin` port. `fetcher(url, init)` is the SSRF-safe egress; a URLSearchParams body is sent as its string. */
export function bindleRedirectSignin({origin,secret,fetcher,limiter=memoryLimiter({clock:Date.now}),clock=Date.now,crypto=globalThis.crypto}){
 if(typeof origin!=='string'||new URL(origin).origin!==origin||typeof secret!=='string'||!secret||typeof fetcher!=='function')throw new TypeError('Redirect sign-in needs an origin, a sealing secret and egress.');
 const budgeted=budgetedEgress(fetcher,limiter),egress=(url,init={})=>budgeted(url,{...init,...init.body instanceof URLSearchParams?{body:init.body.toString()}:{}});
 const make=storage=>new BindleClient({clientMetadataUrl:origin+REDIRECT_CLIENT_PATH,redirectUri:origin+MANAGE_PATH,fetcher:egress,crypto,storage,clock,history:null,defaultHost:'none',emailFallback:false,keyStore:null,embedderOrigin:origin});
 return Object.freeze({
  async begin({identity,intent}){
   const storage=sealedStorage(),client=make(storage);
   const started=await client.beginAuthorization({intent:'login',identity,presentation:'redirect',dpop:false});
   if(started?.kind!=='provider'||typeof started.authorizationUrl!=='string'||typeof started.state!=='string')throw Object.assign(new Error('No Bindle provider.'),{code:'no-provider'});
   const authorize=new URL(started.authorizationUrl);if(authorize.protocol!=='https:'||authorize.origin!==started.issuer)throw Object.assign(new Error('Unexpected authorization URL.'),{code:'invalid-callback'});
   const transaction=await seal({v:1,purpose:'redirect-management',items:storage.dump(),state:started.state,issuer:started.issuer,intent,exp:clock()+TRANSACTION_TTL},secret,crypto);if(transaction.length>MAX_TRANSACTION)throw Object.assign(new Error('Sign-in state too large.'),{code:'invalid-callback'});
   return {authorizationUrl:authorize.href,transaction};
  },
  async complete({transaction,callback}){
   if(typeof transaction!=='string'||transaction.length>MAX_TRANSACTION||!/^[A-Za-z0-9_-]+$/.test(transaction))throw new Error('Invalid sign-in state.');
   const value=await unseal(transaction,secret,crypto);
   if(value?.v!==1||value.purpose!=='redirect-management'||!Number.isSafeInteger(value.exp)||value.exp<=clock()||!value.items||typeof value.items!=='object')throw new Error('Sign-in expired.');
   const url=new URL(callback);if(url.origin+url.pathname!==origin+MANAGE_PATH||url.searchParams.get('state')!==value.state||url.searchParams.get('iss')!==value.issuer)throw new Error('Callback does not match.');
   const client=make(sealedStorage(value.items)),session=await client.completeLogin(url.href);
   revoke(client,session).catch(()=>{});
   const token={issuer:session.issuer,subject:session.subject,client_id:session.client_id,...session.bindle_origin!==undefined?{bindle_origin:structuredClone(session.bindle_origin)}:{},...session.bindle_moves!==undefined?{bindle_moves:structuredClone(session.bindle_moves)}:{}};
   return {token,intent:value.intent};
  },
 });
}

/** Review L2: one portability client and limiter per egress port (the fleet limiter `ABUSE` when the adapter has
 * one), never one per request, so budgets and caches hold across requests. */
const shared=new WeakMap();
function sharedEgress(fetch,env,clock){
 let entry=shared.get(fetch);
 if(!entry){const limiter=typeof env.ABUSE?.consume==='function'?{consume:(name,window)=>env.ABUSE.consume('redirect-manage-egress:'+name,window)}:memoryLimiter({clock});entry={limiter,client:portabilityClient({fetch,limiter,clock})};shared.set(fetch,entry);}
 return entry;
}
/** The service for this deployment, or null when egress or the sealing key is not configured. */
export async function redirectManagementService(env){
 const fetch=env.REDIRECT_MANAGEMENT_FETCH??env.TRANSFER_IN_PORTS?.fetch;if(typeof fetch!=='function'||!env.KEY_ENCRYPTION_KEY||!env.IDENTITY_REPOSITORY||!env.APP_ORIGIN)return null;
 const clock=typeof env.MOVED_CLOCK==='function'?env.MOVED_CLOCK:Date.now,{client,limiter}=sharedEgress(fetch,env,clock);
 const roots=await attestationRoots({issuer:env.APP_ORIGIN,set:parseAttestationKeySet(env.IDENTITY_ATTESTATION_KEYS??env.IDENTITY_ATTESTATION_KEY),configured:env.TRANSFER_IN_PORTS?.roots??{}});
 return new RedirectManagementService({records:redirectRecordsPort(env.IDENTITY_REPOSITORY,{clock}),client,signin:env.REDIRECT_MANAGEMENT_SIGNIN??bindleRedirectSignin({origin:env.APP_ORIGIN,secret:env.KEY_ENCRYPTION_KEY,fetcher:fetch,limiter,clock}),issuer:env.APP_ORIGIN,roots,store:env.REDIRECT_MANAGEMENT_PIN_STORE??null,due:env.REDIRECT_EXTENSION_DUE??null,clock});
}
