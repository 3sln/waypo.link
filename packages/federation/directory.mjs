// ORG-7, organizations §3a. The directory hook for identity/keys.resolveIdentityKey, links and BindleBox.
// resolve is CACHE ONLY: request verification never discovers issuers or refreshes membership-dependent state.
// Background callers dispatch RefreshDirectoryIdentity after their own membership/invitation admission. Pins use
// a durable serializable transaction port (get/set); caches are bounded, disposable, never served past freshness.
// Foreign issuers require an explicit allowlist, empty by default. This does not open the production egress gate.
import {publicClientHost,clientSite,memoryLimiter} from './client-metadata.mjs';
import {strictJSON,plainObject} from '../links/envelope.mjs';
import {canonical,key} from '../core/records.mjs';
import {siteGlobal} from '../flags/read.mjs';
import {isUUID} from '../core/primitives.mjs';
import {verifyKeyContinuity} from '../identity/keys.mjs';
import {MAX_MOVES,MAX_MOVES_DOCUMENT_BYTES,DOCUMENT_BYTES,MAX_DOCUMENT_KEYS,MAX_STATEMENT_BYTES,MAX_ATTESTATION_BYTES} from '../identity/succession.mjs';
export const DIRECTORY_LIMITS=Object.freeze({timeoutMs:1500,maxBytes:65536,cacheEntries:256,cacheBytes:8388608,inFlight:32,global:{windowMs:60000,limit:600},perSite:{windowMs:60000,limit:30},
 // RTC-e review F4 (provisional): host-wide budgets per feature, fetch class and issuer site, spent through the host's
 // shared limiter (`hostLimiter`: WORK_AUTHORITY on both adapters) by every directory instance on the host, so the
 // outbound volume to one issuer no longer scales with the number of targeted writers. Verification follow-ups:
 //  - the key names the feature (`rtc`, `org`), so one feature's traffic never spends another's budget;
 //  - every class also has a per-tenant share of `1/share` of its class limit (`tenant` overrides), spent first, so a
 //    few tenants (targeted writers or attacker accounts) cannot spend the whole class;
 //  - `interactive` has no host-wide class limit (null): each interactive fetch is user-triggered by an authenticated
 //    account under per-account limits (RTC `warms`), so a host-wide cap would only be a lever for a few accounts to deny
 //    every other user. It keeps its per-tenant share.
 host:Object.freeze({windowMs:60000,interactive:null,background:1200,claimed:120,linked:240,share:16,tenant:Object.freeze({interactive:40})})});
/** The fixed per-feature names of the host-wide keys (anything else is `other`). */
export const DIRECTORY_FEATURES=Object.freeze(['rtc','org','other']);
/** Fetch classes (RTC-e review F1). Each has its own per-site bucket in every directory, so no class can starve another:
 *  - `background`: refresh-ahead of tracked, verified peers and members (the full per-site budget);
 *  - `interactive`: user-triggered (the caller-initiated warm at `open`, §4.1): its own per-site budget;
 *  - `claimed`: a request-path claim nobody has verified yet: a third of the per-site budget;
 *  - `linked`: a claim backed by a locally verified relationship (rtc-signaling §8.2 step 3 exception: a link basis
 *    that verified at step 2, or a peer with a live session): a third of the per-site budget. */
export const DIRECTORY_PRIORITIES=Object.freeze(['background','interactive','claimed','linked']);
const fail=code=>{throw Object.assign(new Error('The identity could not be verified.'),{code,status:503});};
export function directoryURL(value){let u;try{u=new URL(value);}catch{return null;}return typeof value==='string'&&value.length<=2048&&u.href===value&&u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&!u.hash&&!value.includes('#')&&publicClientHost(u.hostname)&&!/%2f|%5c|\\/i.test(u.pathname)?u:null;}
const onOrigin=(value,issuer)=>{const u=directoryURL(value);return u&&u.origin===issuer&&!u.search&&!value.includes('?')?value:null;};
const pinKey=(issuer,subject)=>key('directory-pin',issuer,subject);
/** Wargame 2026-10-23 F2: the optional `handle` is `local` or `local@host` where host is exactly the issuer's host (a
 * provider vouches only for handles on its own host); local is 1..64 printable ASCII characters without `@`, `/`, `?`,
 * `#`, `\\` or `:`. Returns the local part, or null for an invalid handle. */
export function directoryHandle(handle,issuer){
 if(typeof handle!=='string'||handle.length>320)return null;const at=handle.indexOf('@'),local=at<0?handle:handle.slice(0,at),host=at<0?null:handle.slice(at+1);
 if(!/^[\x21-\x7e]{1,64}$/.test(local)||/[@/?#\\:]/.test(local))return null;
 let issuerHost;try{issuerHost=new URL(issuer).hostname;}catch{return null;}
 return host===null||host.toLowerCase()===issuerHost?local:null;
}
const age=(header,cap)=>{if(/no-store|no-cache/i.test(header??''))return 0;const m=/(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i.exec(header??'');return m?Math.min(cap,Number(m[1])*1000):0;};
export async function validateDirectoryDocument(document,{issuer,subject,crypto=globalThis.crypto}={}){
 if(!plainObject(document)||document.v!==1||document.iss!==issuer||document.sub!==subject||!['person','organization'].includes(document.kind)||Object.keys(document).some(n=>!['v','iss','sub','kind','handle','keys','features','moves'].includes(n))||!Array.isArray(document.keys)||document.keys.length>MAX_DOCUMENT_KEYS)fail('invalid_document');
 // Identity portability §7 "Size": the derived budget with `moves`, per-record caps and at most 16 records.
 if(document.moves!==undefined&&(!Array.isArray(document.moves)||document.moves.length===0||document.moves.length>MAX_MOVES||document.moves.some(r=>!plainObject(r)||Object.keys(r).sort().join(',')!=='attestation,statement'||typeof r.statement!=='string'||r.statement.length>MAX_STATEMENT_BYTES||!(r.attestation===null||typeof r.attestation==='string'&&r.attestation.length<=MAX_ATTESTATION_BYTES))))fail('invalid_document');
 const seen=new Set();
 for(const entry of document.keys){
  if(!plainObject(entry)||typeof entry.kid!=='string'||!entry.kid||entry.kid.length>128||seen.has(entry.kid)||!['sig','cert','enc'].includes(entry.use)||!['active','retired','revoked'].includes(entry.state)||entry.alg!==(entry.use==='enc'?'ECDH-ES':'ES256')||!plainObject(entry.jwk)||Object.keys(entry.jwk).some(n=>!['kty','crv','x','y'].includes(n))||entry.jwk.kty!=='EC'||entry.jwk.crv!=='P-256')fail('invalid_document');
  seen.add(entry.kid);try{await crypto.subtle.importKey('jwk',entry.jwk,{name:entry.use==='enc'?'ECDH':'ECDSA',namedCurve:'P-256'},false,entry.use==='enc'?[]:['verify']);}catch{fail('invalid_document');}
 }
 if(document.keys.filter(k=>k.use==='sig'&&k.state==='active').length!==1)fail('invalid_document');
 const bytes=new TextEncoder().encode(JSON.stringify(document)).length;if(bytes>(document.moves?MAX_MOVES_DOCUMENT_BYTES:DOCUMENT_BYTES))fail('invalid_document');
 // Move chains confer no authority here. SuccessorRegistry must adopt them before the caller changes issuer.
 // Review follow-up (F2): a handle failing directoryHandle is dropped; the keys stay usable.
 const accepted=structuredClone(document);if(accepted.handle!==undefined&&directoryHandle(accepted.handle,issuer)===null)delete accepted.handle;return accepted;
}
/** Fresh enough: unexpired, and with `early` more than half of its freshness lifetime left (refresh-ahead, F5). */
const fresh=(entry,now,early)=>entry?.until>now&&(!early||entry.until-now>(entry.ttl??0)/2);
/** Scaled limits for a roster of `n` identities (wargame 2026-10-23 F5, provisional): each identity is refetched about
 * once per half to three quarters of its <=300 s freshness, so the per-site budget is n/2 + the base per minute and the
 * cache holds the whole roster plus the base. Bounded by DIRECTORY_MAX_ROSTER. */
export const DIRECTORY_MAX_ROSTER=65536;
/** Each of the compact verification and disposable full-document caches is bounded by bytes
 * and entries. Each roster-scaled byte budget is 8 MiB plus 8 KiB per identity, capped at 64 MiB. */
export const DIRECTORY_MAX_CACHE_BYTES=67108864;
export function directoryLimitsFor(n,base=DIRECTORY_LIMITS){
 const size=Math.min(DIRECTORY_MAX_ROSTER,Math.max(0,Number.isSafeInteger(n)?n:0)),perSite=Math.max(base.perSite.limit,Math.ceil(size/2)+base.perSite.limit);
 return {...base,cacheEntries:Math.max(base.cacheEntries,size+base.cacheEntries),cacheBytes:Math.min(DIRECTORY_MAX_CACHE_BYTES,Math.max(base.cacheBytes,base.cacheBytes+size*8192)),perSite:{...base.perSite,limit:perSite},global:{...base.global,limit:Math.max(base.global.limit,perSite*2)}};
}
export class IdentityDirectory {
 /** `tenant`: the owner whose budget this directory spends at a shared egress (passed as `budget` in the fetch init). */
 constructor({store,fetch,enabled=false,config=null,issuers=[],clock=()=>Date.now(),limiter,hostLimiter=null,crypto=globalThis.crypto,limits={},tenant=null,features=[],feature='other'}={}){
  if(!store?.transaction||typeof fetch!=='function')throw new TypeError('Directory needs a durable transactional pin store and SSRF-safe egress.');
  Object.assign(this,{store,fetcher:fetch,config,enabled:enabled===true,issuers:new Set(issuers),clock,crypto,limits:{...DIRECTORY_LIMITS,...limits},limiter:limiter??memoryLimiter({clock}),hostLimiter:typeof hostLimiter?.consume==='function'?hostLimiter:null,tenant:typeof tenant==='string'?tenant:null,keepFeatures:Array.isArray(features)?features.filter(n=>typeof n==='string').slice(0,4):[],feature:DIRECTORY_FEATURES.includes(feature)?feature:'other'});this.base=this.limits;this.cache=new Map();this.cacheBytes=0;this.documents=new Map();this.documentBytes=0;this.manifests=new Map();this.flights=new Map();this.misses=new Map();this.manifestFlights=new Map();
 }
 /** RTC-e review F4: the host-wide budget of `cls` for `site` through the host's shared limiter (absent: no host
  * budget, as in unit tests). A limiter that fails refuses (closed). Verification follow-ups: keys are
  * `directory-host-v1/<feature>/<class>/<site>`, and this tenant's share `.../t/<tenant hash>` is spent first (a share
  * refusal spends nothing of the class). `interactive` has only the tenant share (DIRECTORY_LIMITS.host). */
 async hostAdmit(cls,site){
  if(!this.hostLimiter)return true;const host=this.limits.host??DIRECTORY_LIMITS.host,limit=host?.[cls],valid=n=>Number.isSafeInteger(n)&&n>=1;
  if(limit!==null&&!valid(limit))return false;const base=`directory-host-v1/${this.feature}/${cls}/${site}`;
  try{
   if(this.tenant!==null){const share=this.tenantShare(cls,host,limit);if(!valid(share))return false;
    if(await this.hostLimiter.consume(`${base}/t/${await this.tenantHash()}`,{windowMs:host.windowMs,limit:share})!==true)return false;}
   return limit===null||await this.hostLimiter.consume(base,{windowMs:host.windowMs,limit})===true;
  }catch{return false;}
 }
 /** This tenant's host-wide share of class `cls`: `tenant[cls]`, else 1/`share` of the class limit. A background share
  * grows with this directory's roster-scaled per-site budget (an organization's members), up to a quarter of the class. */
 tenantShare(cls,host,limit){
  const fixed=host.tenant?.[cls];if(fixed!==undefined)return fixed;if(!Number.isSafeInteger(limit))return 0;
  const base=Math.ceil(limit/Math.max(1,host.share??16));return cls==='background'?Math.max(base,Math.min(Math.floor(limit/4),this.limits.perSite.limit)):base;
 }
 /** A stable pseudonym of the tenant for the shared limiter's keys (never the owner id itself). */
 async tenantHash(){
  this.tenantKey??=(async()=>[...new Uint8Array(await this.crypto.subtle.digest('SHA-256',new TextEncoder().encode('directory-tenant\0'+this.tenant)))].slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join(''))();
  return this.tenantKey;
 }
 /** F5: the caller's roster size (MemberContextService discovery); scales the per-site budget and the cache. */
 capacity(n){this.limits=directoryLimitsFor(n,this.base);}
 /** Cache only, never dials: fresh identity/key material (with full document fields while
  * retained in the independent document cache), or null. Freshness is shared by both tiers. */
 peek({issuer,subject}={}){if(!this.allowed(issuer)||!isUUID(subject))return null;const entry=this.cache.get(issuer+'\n'+subject);return entry?.document&&fresh(entry,this.clock(),false)?structuredClone(this.documents.get(issuer+'\n'+subject)?.document??entry.document):null;}
 allowed(issuer){const u=directoryURL(issuer+'/');return (this.config?siteGlobal(this.config,'DIRECTORY_ENABLED'):this.enabled)&&u&&u.origin===issuer&&this.issuers.has(issuer);}
 remember(map,k,v){
  if(map===this.cache){const drop=key=>{this.cacheBytes-=map.get(key)?.bytes??0;map.delete(key);};drop(k);
   // Verification keeps only identity and key material. Bulky portability history and
   // feature documents have an independent disposable byte budget and cannot evict keys.
   if(v.document){
    const document=structuredClone(v.document),old=this.documents.get(k);this.documentBytes-=old?.bytes??0;this.documents.delete(k);
    const bytes=new TextEncoder().encode(JSON.stringify(document)).length;this.documents.set(k,{document,bytes});this.documentBytes+=bytes;
    while(this.documents.size>this.limits.cacheEntries||this.documentBytes>this.limits.cacheBytes){const first=this.documents.keys().next().value;this.documentBytes-=this.documents.get(first).bytes;this.documents.delete(first);}
    const {v:version,iss,sub,kind,handle,keys}=document;v={...v,document:{v:version,iss,sub,kind,...handle===undefined?{}:{handle},keys}};
   }else{this.documentBytes-=this.documents.get(k)?.bytes??0;this.documents.delete(k);}
   v.bytes=v.document?new TextEncoder().encode(JSON.stringify(v.document)).length:0;map.set(k,v);this.cacheBytes+=v.bytes;
   while(map.size>this.limits.cacheEntries||this.cacheBytes>this.limits.cacheBytes&&map.size>1)drop(map.keys().next().value);
   if(this.cacheBytes>this.limits.cacheBytes)drop(k);return;}
  map.delete(k);map.set(k,v);while(map.size>this.limits.cacheEntries)map.delete(map.keys().next().value);}
 async json(url,maxBytes,priority='background'){
  const u=directoryURL(url);if(!u||!this.allowed(u.origin))fail('issuer_refused');const site=clientSite(u.hostname);
  // Unconfirmed degradation (claimed-refresh starvation): request-path 'claimed' refreshes use at most a third of the
  // per-site budget, and no longer the member bucket at all.
  // Review follow-up: the narrower limiters run first, so a refused claimed or per-site request spends no global token.
  // RTC-e review F1: the classes have disjoint per-site buckets (interactive its own; claimed and linked a third each;
  // background the rest), then the directory's global bucket, then the host-wide per-site budget of the class (F4).
  const cls=DIRECTORY_PRIORITIES.includes(priority)?priority:'background',third={...this.limits.perSite,limit:Math.max(1,Math.floor(this.limits.perSite.limit/3))};
  const bucket=cls==='background'?['directory/site/'+site,this.limits.perSite]:cls==='interactive'?['directory/interactive/'+site,this.limits.perSite]:['directory/'+cls+'/'+site,third];
  if(!await this.limiter.consume(...bucket)||!await this.limiter.consume('directory/global',this.limits.global)||!await this.hostAdmit(cls,site))fail('rate_limited');
  const controller=new AbortController();let timer;
  const work=(async()=>{
   const response=await this.fetcher(url,{method:'GET',redirect:'manual',credentials:'omit',headers:{Accept:'application/json','Accept-Encoding':'identity'},signal:controller.signal,budget:{tenant:this.tenant??'',priority,allowance:this.limits.perSite.limit}});
   if(response?.status===404){void response.body?.cancel().catch(()=>{});return {gone:true,ttl:Math.min(60000,age(response.headers.get('Cache-Control'),60000))};}
   if(response?.status!==200){void response?.body?.cancel().catch(()=>{});fail('temporarily_unavailable');}
   const length=response.headers.get('Content-Length'),encoding=response.headers.get('Content-Encoding');
   if((response.headers.get('Content-Type')??'').split(';')[0].trim().toLowerCase()!=='application/json'||encoding&&encoding.toLowerCase()!=='identity'||length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes)){void response.body?.cancel().catch(()=>{});fail('invalid_document');}
   const reader=response.body?.getReader();if(!reader)fail('invalid_document');const chunks=[];let size=0;
   const abort=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',abort,{once:true});
   try{for(;;){const {done,value}=await reader.read();if(controller.signal.aborted)fail('temporarily_unavailable');if(done)break;size+=value.byteLength;if(size>maxBytes){abort();fail('invalid_document');}chunks.push(value);}}finally{controller.signal.removeEventListener('abort',abort);reader.releaseLock();}
   const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
   let document;try{document=strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('invalid_document');}return {document,ttl:age(response.headers.get('Cache-Control'),300000),header:response.headers.get('Cache-Control')};
  })();work.catch(()=>{});
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('Directory timeout.'),{code:'temporarily_unavailable'}));},this.limits.timeoutMs);})]);}finally{clearTimeout(timer);}
 }
 async manifest(issuer,priority){
  const cached=this.manifests.get(issuer);if(cached?.until>this.clock())return cached.directory;
  // F1: concurrent refreshes share one manifest fetch.
  if(this.manifestFlights.has(issuer))return this.manifestFlights.get(issuer);
  const pending=this.#manifest(issuer,priority).finally(()=>this.manifestFlights.delete(issuer));this.manifestFlights.set(issuer,pending);return pending;
 }
 async #manifest(issuer,priority){
  const result=await this.json(issuer+'/.well-known/bindle/manifest.json',65536,priority),d=result.document;
  if(!plainObject(d)||d.issuer!==issuer||d.version!=='0'||!plainObject(d.features)||!onOrigin(d.features['directory.v1']?.directory_url,issuer))fail('invalid_manifest');
  for(const name of ['authorization_request_endpoint','authorization_endpoint','token_endpoint','rpc_endpoint','jwks_uri'])if(!onOrigin(d[name],issuer))fail('invalid_manifest');
  if(!Array.isArray(d.login_presentation)||!d.login_presentation.includes('redirect')||Object.keys(d.features).length>32||Object.values(d.features).some(v=>!plainObject(v)||new TextEncoder().encode(JSON.stringify(v)).length>4096))fail('invalid_manifest');
  if(typeof d.preferences_contract!=='string'||!directoryURL(d.preferences_contract)||!Array.isArray(d.dpop_signing_alg_values_supported)||!d.dpop_signing_alg_values_supported.includes('ES256'))fail('invalid_manifest');
  // RTC-e: a caller may ask to keep named manifest features (each already bounded to 4 KiB above), e.g. rtc-signaling.v1;
  // nothing else of the manifest is kept.
  const directory=d.features['directory.v1'].directory_url,features={};for(const name of this.keepFeatures)if(plainObject(d.features[name]))features[name]=structuredClone(d.features[name]);
  this.remember(this.manifests,issuer,{directory,features,until:this.clock()+age(result.header,3600000)});return directory;
 }
 /** RTC-e: the kept manifest features of `issuer` (see `features` in the constructor), fetching the manifest under the
  * same budgets when it is not cached. */
 async features(issuer,priority='background'){await this.manifest(issuer,priority);return structuredClone(this.manifests.get(issuer)?.features??{});}
 /** Cache only, never dials: the kept manifest features of `issuer` while its manifest is fresh, else null. */
 peekFeatures(issuer){const cached=this.manifests.get(issuer);return this.allowed(issuer)&&cached?.until>this.clock()?structuredClone(cached.features??{}):null;}
 async accept(issuer,subject,identity,document){
  return this.store.transaction(async tx=>{
   const path=pinKey(issuer,subject),previous=await tx.get(path);if(previous&&previous.identity!==identity)fail('identity_uri_changed');
   const states=Object.assign(Object.create(null),previous?.states),material=Object.assign(Object.create(null),previous?.material),active=document.keys.find(k=>k.use==='sig'&&k.state==='active');
   for(const entry of document.keys){
    const old=states[entry.kid],point=canonical({use:entry.use,alg:entry.alg,jwk:entry.jwk});
    if(material[entry.kid]&&material[entry.kid]!==point||old==='revoked'&&entry.state!=='revoked'||old==='retired'&&entry.state==='active'||old==='superseded'&&entry.state==='active')fail('key_rollback');
    material[entry.kid]=point;states[entry.kid]=old==='superseded'&&entry.state!=='revoked'?old:entry.state;
   }
   let reset=false;
   if(previous?.kid&&previous.kid!==active.kid){
    const entries=new Map(document.keys.filter(k=>k.use==='sig').map(k=>[k.kid,k]));let next=active,continuous=false;const visited=new Set();
    while(next?.predecessor&&!visited.has(next.kid)){visited.add(next.kid);const signer=entries.get(next.predecessor);if(!signer||!await verifyKeyContinuity({signer:{...signer,publicJwk:signer.jwk},next:{...next,publicJwk:next.jwk},subject,crypto:this.crypto}))break;if(signer.kid===previous.kid){continuous=true;break;}next=signer;}
    reset=!continuous;if(states[previous.kid]==='active')states[previous.kid]='superseded';
   }
   if(Object.keys(states).length>4096)fail('pin_history_full');
   const pin={identity,kid:active.kid,states,material,epoch:(previous?.epoch??0)+(reset?1:0)};await tx.set(path,pin);return pin;
  });
 }
 /** `priority`: 'background' (default), 'claimed' (a request-path claim), 'linked' (a claim with a locally verified
  * relationship) or 'interactive' (user-triggered); see DIRECTORY_PRIORITIES. `early`:
  * refetch once less than half of the cached freshness lifetime is left (refresh-ahead for rosters, F5).
  * `verificationOnly` (defaults to `early`) accepts fresh compact material after full-document eviction. */
 async refresh({issuer,subject,kid,priority='background',early=false,verificationOnly=early}={}){
  if(!this.allowed(issuer)||!isUUID(subject))fail('issuer_refused');const name=issuer+'\n'+subject;
  if(this.flights.has(name))return this.flights.get(name);
  const cached=this.cache.get(name),now=this.clock();if(fresh(cached,now,early&&!kid)&&(!kid||cached.document?.keys.some(k=>k.kid===kid))&&(!cached.document||verificationOnly||this.documents.has(name)))return cached.document?structuredClone(this.documents.get(name)?.document??cached.document):null;
  if(kid&&cached){const last=this.misses.get(name);if(last!==undefined&&last+60000>now)return null;this.remember(this.misses,name,now);}
  if(this.flights.size>=this.limits.inFlight)fail('rate_limited');
  const pending=(async()=>{
   const pinned=await this.store.transaction(tx=>tx.get(pinKey(issuer,subject)));let identity=pinned?.identity;
   if(!identity){const directory=await this.manifest(issuer,priority),lookup=await this.json(directory+'?sub='+encodeURIComponent(subject),8192,priority);if(lookup.gone){this.remember(this.cache,name,{document:null,until:this.clock()+lookup.ttl,ttl:lookup.ttl});return null;}const d=lookup.document;if(!plainObject(d)||Object.keys(d).sort().join(',')!=='identity,iss,sub'||d.iss!==issuer||d.sub!==subject||!onOrigin(d.identity,issuer))fail('invalid_directory');identity=d.identity;}
   const result=await this.json(identity+'/identity.json',MAX_MOVES_DOCUMENT_BYTES,priority);
   if(result.gone){this.remember(this.cache,name,{document:null,until:this.clock()+result.ttl,ttl:result.ttl});return null;}
   const document=await validateDirectoryDocument(result.document,{issuer,subject,crypto:this.crypto});await this.accept(issuer,subject,identity,document);
   this.remember(this.cache,name,{document,identity,until:this.clock()+result.ttl,ttl:result.ttl});return structuredClone(document);
  })().finally(()=>this.flights.delete(name));this.flights.set(name,pending);return pending;
 }
 async resolve({issuer,subject,kid,purpose='signing',identity}={}){
  if(!this.allowed(issuer)||!isUUID(subject)||typeof kid!=='string'||!['signing','encryption','certification'].includes(purpose))return null;
  const cached=this.cache.get(issuer+'\n'+subject);if(!cached?.document||cached.until<=this.clock()||identity!==undefined&&identity!==cached.identity)return null;
  const pin=await this.store.transaction(tx=>tx.get(pinKey(issuer,subject))),entry=cached.document.keys.find(k=>k.kid===kid&&k.use===({signing:'sig',encryption:'enc',certification:'cert'}[purpose])&&k.state==='active');
  if(!entry||!pin||pin.identity!==cached.identity||pin.states[kid]!=='active'||purpose==='signing'&&pin.kid!==kid)return null;
  return {kid,purpose,alg:entry.alg,publicJwk:structuredClone(entry.jwk),state:'active',current:true,verifiable:true,identity:pin.identity,authorityEpoch:pin.epoch};
 }
}
