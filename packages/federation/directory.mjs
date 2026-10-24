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
export const DIRECTORY_LIMITS=Object.freeze({timeoutMs:1500,maxBytes:65536,cacheEntries:256,inFlight:32,global:{windowMs:60000,limit:600},perSite:{windowMs:60000,limit:30}});
const fail=code=>{throw Object.assign(new Error('The identity could not be verified.'),{code,status:503});};
export function directoryURL(value){let u;try{u=new URL(value);}catch{return null;}return typeof value==='string'&&value.length<=2048&&u.href===value&&u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&!u.hash&&!value.includes('#')&&publicClientHost(u.hostname)&&!/%2f|%5c|\\/i.test(u.pathname)?u:null;}
const onOrigin=(value,issuer)=>{const u=directoryURL(value);return u&&u.origin===issuer&&!u.search&&!value.includes('?')?value:null;};
const pinKey=(issuer,subject)=>key('directory-pin',issuer,subject);
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
 return structuredClone(document);
}
export class IdentityDirectory {
 constructor({store,fetch,enabled=false,config=null,issuers=[],clock=()=>Date.now(),limiter,crypto=globalThis.crypto,limits={}}={}){
  if(!store?.transaction||typeof fetch!=='function')throw new TypeError('Directory needs a durable transactional pin store and SSRF-safe egress.');
  Object.assign(this,{store,fetcher:fetch,config,enabled:enabled===true,issuers:new Set(issuers),clock,crypto,limits:{...DIRECTORY_LIMITS,...limits},limiter:limiter??memoryLimiter({clock})});this.cache=new Map();this.manifests=new Map();this.flights=new Map();this.misses=new Map();
 }
 allowed(issuer){const u=directoryURL(issuer+'/');return (this.config?siteGlobal(this.config,'DIRECTORY_ENABLED'):this.enabled)&&u&&u.origin===issuer&&this.issuers.has(issuer);}
 remember(map,k,v){map.delete(k);map.set(k,v);while(map.size>this.limits.cacheEntries)map.delete(map.keys().next().value);}
 async json(url,maxBytes){
  const u=directoryURL(url);if(!u||!this.allowed(u.origin))fail('issuer_refused');
  if(!await this.limiter.consume('directory/global',this.limits.global)||!await this.limiter.consume('directory/site/'+clientSite(u.hostname),this.limits.perSite))fail('rate_limited');
  const controller=new AbortController();let timer;
  const work=(async()=>{
   const response=await this.fetcher(url,{method:'GET',redirect:'manual',credentials:'omit',headers:{Accept:'application/json','Accept-Encoding':'identity'},signal:controller.signal});
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
 async manifest(issuer){
  const cached=this.manifests.get(issuer);if(cached?.until>this.clock())return cached.directory;
  const result=await this.json(issuer+'/.well-known/bindle/manifest.json',65536),d=result.document;
  if(!plainObject(d)||d.issuer!==issuer||d.version!=='0'||!plainObject(d.features)||!onOrigin(d.features['directory.v1']?.directory_url,issuer))fail('invalid_manifest');
  for(const name of ['authorization_request_endpoint','authorization_endpoint','token_endpoint','rpc_endpoint','jwks_uri'])if(!onOrigin(d[name],issuer))fail('invalid_manifest');
  if(!Array.isArray(d.login_presentation)||!d.login_presentation.includes('redirect')||Object.keys(d.features).length>32||Object.values(d.features).some(v=>!plainObject(v)||new TextEncoder().encode(JSON.stringify(v)).length>4096))fail('invalid_manifest');
  if(typeof d.preferences_contract!=='string'||!directoryURL(d.preferences_contract)||!Array.isArray(d.dpop_signing_alg_values_supported)||!d.dpop_signing_alg_values_supported.includes('ES256'))fail('invalid_manifest');
  const directory=d.features['directory.v1'].directory_url;this.remember(this.manifests,issuer,{directory,until:this.clock()+age(result.header,3600000)});return directory;
 }
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
 async refresh({issuer,subject,kid}={}){
  if(!this.allowed(issuer)||!isUUID(subject))fail('issuer_refused');const name=issuer+'\n'+subject;
  if(this.flights.has(name))return this.flights.get(name);
  const cached=this.cache.get(name),now=this.clock();if(cached?.until>now&&(!kid||cached.document?.keys.some(k=>k.kid===kid)))return cached.document?structuredClone(cached.document):null;
  if(kid&&cached){const last=this.misses.get(name);if(last!==undefined&&last+60000>now)return null;this.remember(this.misses,name,now);}
  if(this.flights.size>=this.limits.inFlight)fail('rate_limited');
  const pending=(async()=>{
   const pinned=await this.store.transaction(tx=>tx.get(pinKey(issuer,subject)));let identity=pinned?.identity;
   if(!identity){const directory=await this.manifest(issuer),lookup=await this.json(directory+'?sub='+encodeURIComponent(subject),8192);if(lookup.gone){this.remember(this.cache,name,{document:null,until:this.clock()+lookup.ttl});return null;}const d=lookup.document;if(!plainObject(d)||Object.keys(d).sort().join(',')!=='identity,iss,sub'||d.iss!==issuer||d.sub!==subject||!onOrigin(d.identity,issuer))fail('invalid_directory');identity=d.identity;}
   const result=await this.json(identity+'/identity.json',MAX_MOVES_DOCUMENT_BYTES);
   if(result.gone){this.remember(this.cache,name,{document:null,until:this.clock()+result.ttl});return null;}
   const document=await validateDirectoryDocument(result.document,{issuer,subject,crypto:this.crypto});await this.accept(issuer,subject,identity,document);
   this.remember(this.cache,name,{document,identity,until:this.clock()+result.ttl});return structuredClone(document);
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
