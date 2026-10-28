import {siteGlobal} from '../flags/read.mjs';
import {digest} from '../core/records.mjs';
import {validateIntegrationManifest} from '../federation/integrations.mjs';
import {createFieldOperation,PROVIDER_REGISTRY} from '../federation/extensions.mjs';
import {readExtensions} from '../core/extensions.mjs';
import {fragmentOutcome,fieldAttributes,consumes} from '../core/fragments.mjs';
import {canonical} from '../core/records.mjs';
import {appendSeverance} from '../federation/brokered-severance.mjs';
import {FEATURE_DEFINITIONS,SUSPENSION_REVOCATION_MS,FEATURE_SWEEP_MS} from '../app/domains/provider-features.mjs';
import {MESSAGING_INGRESS_FRAGMENT} from '../links/types.mjs';
// Extensions rev 3.2 (CR-X3-26): the former slot documents, republished as ordinary fragments at new URLs. The provider
// pins these exact documents; the classifier fragment is application-consumed (Parlay requests it as a setup fragment),
// the intake and ingress fragments are consumed only by provider features.
import classifierFragment from '../../docs/artefacts/fragments/item-classifier-v1.json' with {type:'json'};
import messagingIngressFragment from '../../docs/artefacts/fragments/messaging-ingress-v1.json' with {type:'json'};
import publicIntakeFragment from '../../docs/artefacts/fragments/public-intake-v1.json' with {type:'json'};
import {REMOVAL_RECORD,REMOVAL_OPEN,removalOpen} from '../app/domains/app-removal.mjs';
export class AppConnectionError extends Error{constructor(code,message,status=400){super(message);Object.assign(this,{code,status});}}
const fail=(code,message,status)=>{throw new AppConnectionError(code,message,status);};
const prefix='resource/';
// EXT-X4 (docs/spec/integrations.md §1, §3, §7; docs/spec/extensions.md §3, §5): the app connection is the integration
// connection. A record written before X4 has no `state` and reads as `active`/`disconnected` from `status`; X4 writes
// `state` (and keeps `status` derived from it, so every legacy check stays exact) the first time a migrated path touches
// it, and only while INTEGRATIONS_ENABLED (packages/runtime/account/connections.mjs). Fencing is record-driven, never
// flag-driven: a suspended or manifest-invalid record refuses a legacy re-authorization even with the flag off.
export const CONNECTION_STATES=Object.freeze(['configuring','active','degraded','manifest-invalid','suspended','disconnected']);
const LIVE=['configuring','active','degraded'],SERVING=['active','degraded'],PAUSED=['suspended','manifest-invalid'];
export const connectionStatus=state=>LIVE.includes(state)?'active':state==='disconnected'?'disconnected':'suspended';
export const connectionState=r=>r?.state??(r?.status==='active'?'active':'disconnected');
const valid=r=>r?.kind==='app-connection'&&r.provider==='app'&&Number.isSafeInteger(r.generation)&&r.generation>0&&(r.state===undefined||CONNECTION_STATES.includes(r.state)&&r.status===connectionStatus(r.state));
/** The deterministic connection id of (owner, client): one record per app per account, reused across reconnects. */
export async function appConnectionId(owner,clientId){const encoded=await digest(globalThis.crypto,`app-connection/v1\0${owner}\0${clientId}`);const hex=[...atob(encoded.replace(/-/g,'+').replace(/_/g,'/'))].slice(0,16).map(c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-8${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
/**
 * The liveness of one app's connection, read in the caller's transaction `tx` ({get}) (signaling §5.4 "its connection
 * is live", §14.2, §20.1.4): {state, generation}. `state` is `live` (active, and not fenced by an account suspension),
 * `paused` (suspended, manifest-invalid or fenced), `ended` (disconnected) or `absent` (never connected). `generation` is the
 * connection generation that the app's tokens carry (`check`): every disconnect, reconnect, pause, resume or re-setup
 * changes it, so a consumer that records it can tell state of an earlier connection from the current one.
 */
export async function appConnectionState(tx,owner,clientId){
 if(typeof clientId!=='string'||!clientId)return {state:'ended',generation:null};
 const r=await tx.get(prefix+await appConnectionId(owner,clientId));
 if(r===undefined||r===null)return {state:'absent',generation:null};
 if(!valid(r)||r.owner!==owner||r.clientId!==clientId||r.status==='disconnected')return {state:'ended',generation:null};
 if(r.status!=='active')return {state:'paused',generation:r.generation};
 if(r.fence!==undefined){const lifecycle=await tx.get(LIFECYCLE_STATE);if(BLOCKED.includes(lifecycle?.phase)||r.fence!==epochOf(lifecycle))return {state:'paused',generation:r.generation};}
 return {state:'live',generation:r.generation};
}
// Extensions rev 3.2 (§3–§6): the owner's value of each provider-consumable field of a recognized fragment is one ordered
// record per field (entries are "seats": a connection, optionally a brokered record, in owner order). Provider features
// consume those fields only through grants (feature records) that the owner enables. Outbox rows are the transactional
// events later slices drain (X6 delivery, X7 credential revocation, X8 projection); cascade rows are durable intents for
// effects owned by other modules (key-delegation revocation), drained after commit. Notices are owner-only records
// (post-connection announcements, feature suspension and revocation).
// Local revision 2 slot rows (`connections/slot/`) are not migrated: they are deleted on first touch (CR-X3-29).
const FIELD='connections/field/',LEGACY_SLOT='connections/slot/',FEATURE='connections/feature/',NOTICE='connections/notice/',ANNOUNCED='connections/announced/',MUTED='connections/announce-muted/',OUTBOX='connections/outbox/',CASCADE='connections/cascade/',CASCADE_ALL=CASCADE+'~all',META='connections/meta',LIFECYCLE_STATE='lifecycle/state-v1',RECORD='integrations/record/';
export const OUTBOX_LIMIT=4096,CASCADE_LIMIT=256,FIELD_RECORDS_LIMIT=64,RECENT_AUTH_MS=900000,NOTICE_LIMIT=64;
// Review M1: an active grant records when an evaluation last saw its declaration valid (`seenAt`), refreshed at most
// this often (and whenever the clock moved backwards), so a later loss is dated no later than it happened.
const SEEN_REFRESH_MS=60000;
const BLOCKED=['suspended','purge-review','purging'];
// Fields whose value holds key-delegation.v1 certificates (packages/identity/delegation.mjs): a change of value entry,
// generation, ingress or consented purposes revokes or reconciles them through a cascade row (review KD-4).
export const DELEGATION_FIELDS=Object.freeze([MESSAGING_INGRESS_FRAGMENT]);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const MESSAGING_INGRESS_FRAGMENT_DOCUMENT=freeze(messagingIngressFragment);
export const ITEM_CLASSIFIER_FRAGMENT_DOCUMENT=freeze(classifierFragment);
export const PUBLIC_INTAKE_FRAGMENT_DOCUMENT=freeze(publicIntakeFragment);
/** Provider-consumable fields this provider recognizes (trusted pins, exact URL -> fragment document). */
export const RECOGNIZED_FIELDS=Object.freeze({[MESSAGING_INGRESS_FRAGMENT_DOCUMENT.id]:MESSAGING_INGRESS_FRAGMENT_DOCUMENT,[PUBLIC_INTAKE_FRAGMENT_DOCUMENT.id]:PUBLIC_INTAKE_FRAGMENT_DOCUMENT});
export const recognizedFields=()=>RECOGNIZED_FIELDS;
const pad=n=>String(n).padStart(16,'0');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const only=(v,names)=>plain(v)&&Object.keys(v).every(k=>names.includes(k));
const ID=/^[a-f0-9-]{36}$/,SEAT=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&/^[\x21-\x7e]+$/.test(v);
const httpsId=v=>{if(typeof v!=='string'||v.length>256)return false;try{const u=new URL(v);return u.protocol==='https:'&&u.href===v&&!u.username&&!u.password&&!u.hash;}catch{return false;}};
const purposesValid=v=>Array.isArray(v)&&v.length<=8&&v.every((p,i)=>httpsId(p)&&(i===0||v[i-1]<p));
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const epochOf=s=>Number.isSafeInteger(s?.capabilityEpoch)?s.capabilityEpoch:0;
const requiresSetup=m=>Boolean(m?.setup?.fragments?.some(f=>f.required===true));
const bump=(r,field='generation')=>{if(!Number.isSafeInteger(r[field])||r[field]>=Number.MAX_SAFE_INTEGER)fail('unavailable','Connection generation unavailable.',503);r[field]++;};
const cnxOf=entry=>`${entry.seat}.${entry.generation}`;
/** Validates an approval snapshot (packages/federation/integrations.mjs integrationSnapshot): the manifest must re-derive
 * exactly from the snapshot's own client members, so a stored pin can never be widened by editing it. */
export function connectionSnapshotValid(s,clientId,{reserved=[],artefactVersions=false}={}){
 if(!only(s,['clientId','redirectUris','authMethod','jwksUri','thumbprints','pendingThumbprints','manifest'])||s.clientId!==clientId||bytes(s)>16384)return false;
 if(!Array.isArray(s.redirectUris)||s.redirectUris.length>16||s.redirectUris.some(u=>typeof u!=='string'))return false;
 const tp=v=>Array.isArray(v)&&v.length>0&&v.length<=16&&v.every(t=>typeof t==='string'&&/^[A-Za-z0-9_-]{43}$/.test(t));
 if(s.authMethod==='private_key_jwt'){if(typeof s.jwksUri!=='string'||!tp(s.thumbprints)||s.pendingThumbprints!==undefined&&!tp(s.pendingThumbprints))return false;}
 else if(s.authMethod!=='none'||s.jwksUri!==undefined||s.thumbprints!==undefined||s.pendingThumbprints!==undefined)return false;
 let r;try{r=validateIntegrationManifest(s.manifest,{artefactVersions,clientId,confidential:s.authMethod==='private_key_jwt',redirectUris:s.redirectUris,jwksUri:s.jwksUri,reserved});}catch{return false;}
 return r.status==='valid'&&JSON.stringify(r.manifest)===JSON.stringify(s.manifest);
}
/** A provider-authored built-in manifest: {v:1, setup?, resources?:{contracts}} (extensions rev 3.2: no `extensions`). */
export function builtInManifestValid(m){
 if(!only(m,['v','setup','resources'])||m.v!==1||bytes(m)>8192)return false;
 if(m.resources!==undefined&&(!only(m.resources,['contracts'])||!Array.isArray(m.resources.contracts)||m.resources.contracts.length>32||!m.resources.contracts.every(httpsId)))return false;
 return m.setup===undefined||only(m.setup,['fragments'])&&Array.isArray(m.setup.fragments)&&m.setup.fragments.length<=8;
}
export class AppConnections{
 /** `fields`: provider-recognized fragments with a provider-consumable resource field, by exact URL (trusted pins).
  * `declarations()`: the provider's own feature declarations right now, `{manifest:{issuer, extensions}, blocked:[spec]}`
  * (packages/app/domains/provider-features.mjs), read on every feature operation so suspension is immediate.
  * `builtins`: provider-authored built-in integrations by id -> {name, manifest}. `severed(owner)`: optional hook run
  * after a legacy disconnect that wrote cascade rows; its failure never undoes the committed disconnect. */
 constructor({metadata,origin,config,clock=()=>Date.now(),fields=RECOGNIZED_FIELDS,declarations=async()=>({manifest:{extensions:[]},blocked:[]}),builtins={},severed,ended,subjectDeleted,uuid=()=>crypto.randomUUID()}){Object.assign(this,{metadata,origin,config,clock,fieldPins:fields,declarations,builtins,severed,ended,subjectDeleted,uuid});}
 async id(owner,clientId){return appConnectionId(owner,clientId);}
 async binding(owner,clientId){const id=await this.id(owner,clientId);const r=await this.metadata.get(prefix+id);if(r&&!valid(r))fail('unavailable','Invalid connection record.',503);return {id,generation:r?.generation??0,notificationGeneration:r?.notifications?.generation??1};}
 async registerBrowser(owner){return this.register(owner,{id:`${this.origin}/automation/browser`,name:'Browser automation'},undefined,{transport:'browser',provenance:{kind:'owner-browser-consent'}});}
 /** `trusted.integration` ({kind:'external'|'built-in', snapshot, builtin?}) is set only by the X4 connect paths: it
  * writes the lifecycle state, the pinned snapshot and the account capability fence. Without it the legacy record shape
  * is kept, except that a same-incarnation re-approval carries X4 fields forward instead of dropping them. */
 async register(owner,client,expected,trusted={}){
  if(typeof owner!=='string'||typeof client?.id!=='string'||!client.id||client.id.length>200||typeof client.name!=='string'||!client.name||client.name.length>100)fail('invalid_request','Invalid app connection.');
  const id=await this.id(owner,client.id);
  // L1: the announcement scope reads feature state, so declarations are applied first (read outside the transaction).
  const declared=trusted.integration?await this.#declarationState():null;
  const result=await this.metadata.transaction(async tx=>{
   const prior=await tx.get(prefix+id);if(prior&&!valid(prior))fail('unavailable','Invalid connection record.',503);if(prior&&prior.owner!==owner)fail('forbidden','Connection belongs to another account.',403);
   if(expected!==undefined&&(prior?.generation??0)!==expected)fail('consent_stale','Connection changed. Start a fresh authorization.',409);
   // Only the owner resumes, from the provider's own interface (integrations §3.1); an authorization never does.
   if(PAUSED.includes(prior?.state))fail('connection_suspended','This connection is paused. Resume it from your account first.',409);
   if(trusted.notifications===true&&trusted.expectedNotificationGeneration!==undefined&&(prior?.notifications?.generation??1)!==trusted.expectedNotificationGeneration)fail('consent_stale','Message permission changed. Review again.',409);
   const changed=Boolean(trusted.integration&&prior?.status==='active'&&(JSON.stringify(prior.integration??null)!==JSON.stringify(trusted.integration)||prior.appOrigin!==client.origin));
   const same=prior?.status==='active',generation=same?prior.generation+(changed?1:0):(prior?.generation??0)+1;
   if(!Number.isSafeInteger(generation)||generation<1)fail('unavailable','Connection generation unavailable.',503);
   if(!prior&&[...(await tx.list({prefix,limit:201})).values()].filter(r=>r.kind==='app-connection').length>=100)fail('connection_limit','This account has reached its new-app connection limit. Previously connected apps can still reconnect.',429);
   let notifications=prior?.notifications??{enabled:false,generation:1};if(trusted.notifications===true&&!notifications.enabled){if(!Number.isSafeInteger(notifications.generation)||notifications.generation<1||notifications.generation>=Number.MAX_SAFE_INTEGER)fail('unavailable','Notification generation unavailable.',503);notifications={enabled:true,generation:notifications.generation+1};}if(prior?.status==='disconnected')notifications={enabled:trusted.notifications===true,generation:(prior.notifications?.generation??1)+1};
   const record={id,owner,clientId:client.id,name:client.name,status:'active',generation,connectedAt:same?prior.connectedAt:this.clock(),kind:'app-connection',provider:'app',transport:trusted.transport??'mcp',...trusted.transport==='bindle'?{appOrigin:client.origin,notifications}:{},resourceURI:`${this.origin}/entities/${encodeURIComponent(owner)}/resources/${id}`,contracts:[],...client.metadata?{metadata:structuredClone(client.metadata)}:{},provenance:trusted.provenance??{kind:'oauth-consent',issuer:`${this.origin}/mcp/oauth`}};
   const events=[];
   if(trusted.integration){
    const lifecycle=await tx.get(LIFECYCLE_STATE);if(BLOCKED.includes(lifecycle?.phase))fail('account_suspended','This account is suspended.',423);
    const manifest=trusted.integration.snapshot?.manifest??trusted.integration.manifest,configured=same&&prior.configured===true||!requiresSetup(manifest);
    Object.assign(record,{state:configured?(same&&prior.state==='degraded'?'degraded':'active'):'configuring',configured,stateChangedAt:this.clock(),fence:same&&prior.fence!==undefined?prior.fence:epochOf(lifecycle),integration:structuredClone(trusted.integration)});
    record.status=connectionStatus(record.state);
    events.push({type:'connection-activated',connection:id,clientId:client.id,generation,state:record.state,kind:trusted.integration.kind});
   }else if(same&&prior.state!==undefined)for(const k of ['state','configured','stateChangedAt','fence','integration'])if(prior[k]!==undefined)record[k]=structuredClone(prior[k]);
   await tx.put(prefix+id,record);if(events.length)await this.#emit(tx,events);
   // Extensions §6: a newly active integration connection may be announced to the owner (local, owner-only).
   if(trusted.integration&&!same){await this.#syncFeatures(tx,declared);await this.#announce(tx,record);}
   if(changed){await this.#cascade(tx,this.#delegationRows(await this.#affected(tx,id),'system'));await this.#reseat(tx,record);}
   return this.view(record);
  });
  return result;
 }
 view(record){const {owner,...value}=record;return value;}
 async list(owner){const rows=await this.metadata.list({prefix,limit:201});if(rows.size>200)fail('connection_limit','Resource listing exceeds the account limit.',429);return [...rows].filter(([,v])=>v.kind==='app-connection').map(([,v])=>{if(v.owner!==owner)fail('forbidden','Connection belongs to another account.',403);return this.view(v);}).sort((a,b)=>b.connectedAt-a.connectedAt);}
 async check(owner,id,generation,clientId){const r=typeof id==='string'&&await this.metadata.get(prefix+id);if(!valid(r)||r.owner!==owner||r.status!=='active'||r.generation!==generation||clientId!==undefined&&r.clientId!==clientId)fail('invalid_token','The app was disconnected. Reconnect with fresh consent.',401);
  // X4-R2: a migrated connection outlives no account suspension, even one that ended before anyone looked.
  if(r.fence!==undefined){const lifecycle=await this.metadata.get(LIFECYCLE_STATE);if(BLOCKED.includes(lifecycle?.phase)||r.fence!==epochOf(lifecycle))fail('invalid_token','The app was disconnected. Reconnect with fresh consent.',401);}
  return true;}
 async notificationSettings(owner,id,input){return this.metadata.transaction(async tx=>{const r=await tx.get(prefix+id);if(!valid(r)||r.owner!==owner||r.transport!=='bindle')fail('not_found','App connection not found.',404);const current=r.notifications??{enabled:false,generation:1};if(!Number.isSafeInteger(current.generation)||current.generation<1||typeof current.enabled!=='boolean')fail('unavailable','Notification settings unavailable.',503);if(input===undefined)return current;if(!input||Object.keys(input).length!==1||typeof input.enabled!=='boolean')fail('invalid_request','Choose whether this app may send messages.');if(r.status!=='active')fail('invalid_token','Reconnect this application first.',401);if(current.enabled!==input.enabled){if(current.generation>=Number.MAX_SAFE_INTEGER)fail('unavailable','Notification settings unavailable.',503);r.notifications={enabled:input.enabled,generation:current.generation+1};await tx.put(prefix+id,r);}return r.notifications??current;});}
 /** Severs one connection (integrations §7.1 Disconnect). A legacy record keeps exactly its old effect; a migrated one,
  * or one holding field entries, also vacates every entry, enqueues `connection-revoked` (terminal) and the delegation
  * cascade in the same transaction, then runs the `severed` hook. */
 async disconnect(owner,id,{reason='uninstalled',expectedGeneration}={}){
  if(!/^[a-f0-9-]{36}$/.test(id))fail('not_found','App connection not found.',404);
  const out=await this.metadata.transaction(async tx=>{
   const r=await tx.get(prefix+id);if(!valid(r)||r.owner!==owner)fail('not_found','App connection not found.',404);
   if(expectedGeneration!==undefined&&expectedGeneration!==r.generation)fail('connection_stale','The connection changed. Reload and try again.',409);
   let cascaded=false,ended=false;
   if(r.status!=='disconnected'){ended=true;
    if(r.generation>=Number.MAX_SAFE_INTEGER)fail('unavailable','Connection generation unavailable.',503);
    const migrated=r.state!==undefined;r.severanceReason=reason;r.status='disconnected';r.generation++;r.disconnectedAt=this.clock();
    if(migrated){r.state='disconnected';r.stateChangedAt=r.disconnectedAt;}
    await tx.put(prefix+id,r);await this.#closeRemovals(tx,r,r.disconnectedAt);
    const removed=await this.#vacateConnection(tx,id);
    if(migrated||removed.length){
     await this.#emit(tx,[{type:'connection-revoked',connection:id,clientId:r.clientId,generation:r.generation,terminal:true,reason}]);
     await this.#cascade(tx,[{kind:'delegations',clientId:r.clientId,reason:['deleted','system'].includes(reason)?reason:'uninstalled'}]);cascaded=true;
    }
   }
   if(reason==='uninstalled'&&r.severanceReason!==reason){r.severanceReason=reason;await tx.put(prefix+id,r);}
   return {result:{disconnected:true,app:this.view(r)},cascaded,ended:ended?r.clientId:null};
  });
  if(out.cascaded&&typeof this.severed==='function')try{await this.severed(owner);}catch{/* Durable cascade rows are retried. */}
  // Connection end, whatever the record's shape or INTEGRATIONS_ENABLED (signaling §14.2, §20.1.4 clearing). Its
  // failure never undoes the disconnect: the consumer re-checks the connection generation on every use and sweeps.
  if(out.ended&&typeof this.ended==='function')try{await this.ended(owner,out.ended);}catch{/* the consumer's own sweep retries */}
  return out.result;
 }

 // Wargame F5: a disconnect or severance concludes this connection's open clean removal in the same commit, as the
 // account-deletion hook does, so a stale record can neither block, remind about nor force a later reinstallation.
 // The removal's own commit also passes through here; its conclusion then overwrites this one in the same commit.
 async #closeRemovals(tx,r,now){
  const index=REMOVAL_OPEN+encodeURIComponent(r.clientId),open=await tx.get(index);if(typeof open!=='string')return;
  const rec=await tx.get(REMOVAL_RECORD+open);if(removalOpen(rec)&&rec.entity===r.owner&&rec.connection!==r.id)return;
  if(removalOpen(rec)&&rec.entity===r.owner)await tx.put(REMOVAL_RECORD+open,{...rec,state:'forced',outcome:'disconnected',committed_at:now,access_ends_by:now+360000});
  await tx.delete(index);
 }

 // ---- X4 connections domain (called by packages/app/domains/connections.mjs; INTEGRATIONS_ENABLED is checked there) ----
 async #load(tx,owner,id){if(typeof id!=='string'||!ID.test(id))fail('not_found','Connection not found.',404);const r=await tx.get(prefix+id);if(!valid(r)||r.owner!==owner)fail('not_found','Connection not found.',404);if(r.state===undefined)r.state=connectionState(r);return r;}
 #fenced(r,expected,required){if(expected===undefined){if(required)fail('invalid_request','The expected connection generation is required.');return;}if(!Number.isSafeInteger(expected)||expected!==r.generation)fail('connection_stale','The connection changed. Reload and try again.',409);}
 async #meta(tx){const m=await tx.get(META);return m&&Number.isSafeInteger(m.seq)?m:{seq:0,low:0,cascade:0,pending:0};}
 async #emit(tx,events){const m=await this.#meta(tx),at=this.clock();for(const e of events){m.seq++;await tx.put(OUTBOX+pad(m.seq),{seq:m.seq,at,...e});if(m.seq-m.low>OUTBOX_LIMIT){m.low++;await tx.delete?.(OUTBOX+pad(m.low));}}await tx.put(META,m);}
 // Over-revocation is always safe: past the bound, pending cascades collapse into one revoke-all row.
 async #cascade(tx,rows){if(!rows.length)return;const m=await this.#meta(tx),at=this.clock();for(const row of rows){if(m.pending>=CASCADE_LIMIT){await tx.put(CASCADE_ALL,{kind:'delegations',all:true,reason:'system',at});continue;}m.cascade++;m.pending++;await tx.put(CASCADE+pad(m.cascade),{...row,at});}await tx.put(META,m);}
 #field(url){
  const doc=typeof url==='string'&&Object.hasOwn(this.fieldPins,url)?this.fieldPins[url]:null;
  if(!doc||fragmentOutcome(doc,url).status!=='valid')fail('unsupported_field','This field is not recognized here.',400);
  const found=Object.entries(doc.fields).find(([,f])=>f.type==='resource'&&consumes(f,'provider'));if(!found)fail('unsupported_field','This field is not recognized here.',400);
  const [name,field]=found,a=fieldAttributes(field);
  return {url,schema:doc,name,field,selection:a.selection,consumers:a.consumers,announce:a.announce,max:a.max,contracts:[...a.contracts]};
 }
 async #values(tx,url){const key=FIELD+await digest(globalThis.crypto,url),r=await tx.get(key);return {key,record:r?.fragment===url&&Array.isArray(r.entries)?r:{fragment:url,revision:0,entries:[]}};}
 async #fieldRows(tx){
  // CR-X3-29: revision 2 slot rows are reset, never migrated (pre-release data, DEVLOG).
  for(const [key] of [...(await tx.list({prefix:LEGACY_SLOT,limit:FIELD_RECORDS_LIMIT+1})).entries()])await tx.delete(key);
  const rows=[...(await tx.list({prefix:FIELD,limit:FIELD_RECORDS_LIMIT+1})).entries()];if(rows.length>FIELD_RECORDS_LIMIT)fail('unavailable','Too many field records.',503);return rows.filter(([,v])=>typeof v?.fragment==='string'&&Array.isArray(v.entries));
 }
 #summary(rec){return rec.entries.map(e=>({seat:e.seat,connection:e.connection,clientId:e.clientId,generation:e.generation}));}
 async #vacateConnection(tx,id,{keep}={}){
  const removed=[];
  for(const [key,rec] of await this.#fieldRows(tx)){
   const gone=rec.entries.filter(e=>e.connection===id&&!keep?.(rec.fragment,e));if(!gone.length)continue;
   rec.entries=rec.entries.filter(e=>!gone.includes(e));rec.revision=(rec.revision??0)+1;await tx.put(key,rec);
   for(const e of gone)removed.push({fragment:rec.fragment,entry:e});
   await this.#emit(tx,[...gone.map(e=>({type:'value-removed',fragment:rec.fragment,seat:e.seat,connection:id,clientId:e.clientId,generation:e.generation})),{type:'field-changed',fragment:rec.fragment,revision:rec.revision,entries:this.#summary(rec)}]);
   await this.#withdrawApprovals(tx,rec.fragment,gone);
  }
  return removed;
 }
 // Delegation cascades for entries leaving (or changing generation in) a delegation field.
 #delegationRows(changes,reason){return changes.filter(c=>DELEGATION_FIELDS.includes(c.fragment)).map(c=>({kind:'delegations',clientId:c.entry.clientId,reason}));}
 // Extensions §5.1: a connection is a candidate (a brokered offer, or a built-in) when the contracts recorded for it at
 // the connection include every contract the field requires. Declarations, names and labels never qualify one.
 #eligible(r,field){
  const manifest=r.integration?.snapshot?.manifest??r.integration?.manifest;if(!manifest)return false;
  const offered=manifest.resources?.contracts??[];return field.contracts.every(c=>offered.includes(c));
 }
 // Re-binds this connection's entries to its new generation (resume/approve), dropping entries it no longer qualifies for.
 async #reseat(tx,r){
  const removed=await this.#vacateConnection(tx,r.id,{keep:(url,e)=>{try{return this.#eligible(r,this.#field(url));}catch{return false;}}});
  for(const [key,rec] of await this.#fieldRows(tx)){let changed=false;for(const e of rec.entries)if(e.connection===r.id&&e.generation!==r.generation){e.generation=r.generation;changed=true;}if(changed){rec.revision=(rec.revision??0)+1;await tx.put(key,rec);await this.#emit(tx,[{type:'field-changed',fragment:rec.fragment,revision:rec.revision,entries:this.#summary(rec)}]);if(DELEGATION_FIELDS.includes(rec.fragment))await this.#cascade(tx,[{kind:'reconcile'}]);}}
  await this.#cascade(tx,this.#delegationRows(removed,'system'));
 }
 #affected=async(tx,id)=>(await this.#fieldRows(tx)).flatMap(([,rec])=>rec.entries.filter(e=>e.connection===id).map(entry=>({fragment:rec.fragment,entry})));

 // ---- Provider-feature grants (extensions §4.2) ----
 async #featureKey(spec){return FEATURE+await digest(globalThis.crypto,spec);}
 async #featureRecord(tx,spec){const r=await tx.get(await this.#featureKey(spec));return r?.spec===spec?r:null;}
 async #featureRecords(tx){const out=[];for(const spec of Object.keys(FEATURE_DEFINITIONS)){const r=await this.#featureRecord(tx,spec);if(r)out.push(r);}return out;}
 async #featuresFor(tx,url){return (await this.#featureRecords(tx)).filter(r=>r.fragment===url);}
 async #putFeature(tx,r){await tx.put(await this.#featureKey(r.spec),r);}
 #descriptor(spec){const d=PROVIDER_REGISTRY.get(spec);return {title:d?.title??spec,description:d?.description??'',host:new URL(spec).host};}
 // The live declaration state of every provider feature, read through the trusted port (never request input).
 async #declarationState(){
  let out;try{out=await this.declarations();}catch{out=null;}
  const valid=out?new Set(readExtensions(out.manifest,{registry:PROVIDER_REGISTRY,issuer:out.manifest?.issuer}).extensions.keys()):new Set();
  return {valid,blocked:new Set(Array.isArray(out?.blocked)?out.blocked:[])};
 }
 async #notice(tx,notice){
  const rows=[...(await tx.list({prefix:NOTICE,limit:NOTICE_LIMIT+8})).entries()].sort(([a],[b])=>a<b?-1:1);for(const [key] of rows.slice(0,Math.max(0,rows.length-NOTICE_LIMIT+1)))await tx.delete(key);
  const m=await this.#meta(tx);m.notice=(m.notice??0)+1;await tx.put(META,m);const id=pad(m.notice);await tx.put(NOTICE+id,{id,at:this.clock(),...notice});
 }
 // Revokes the brokered credentials minted under `grant` for the brokered records among `entries` (integrations §5.3).
 async #severGrant(tx,grant,entries,type){
  const rows=[];for(const e of entries){if(typeof e.resource!=='string')continue;const rec=await tx.get(RECORD+e.resource);if(rec?.v===1&&rec.connection===e.connection)rows.push({type,connection:rec.connection,generation:rec.generation,resource:rec.resource,grants:[grant]});}
  await appendSeverance(tx,rows,{clock:this.clock});
 }
 async #revokeFeature(tx,r,reason,entries){
  const old=r.grant;r.state='revoked';r.reason=reason;r.revokedAt=this.clock();delete r.suspendedAt;delete r.seenAt;await this.#putFeature(tx,r);
  await this.#severGrant(tx,old,entries??(await this.#values(tx,r.fragment)).record.entries.filter(e=>r.approved.includes(e.seat)),'feature-revoked');
  await this.#emit(tx,[{type:'feature-revoked',feature:r.spec,grant:old,reason}]);await this.#notice(tx,{kind:'feature-revoked',feature:r.spec,reason});
 }
 // L5: a grant is bound to the fragment pin it was approved under; the provider's pinned document must still match.
 async #pinCurrent(r){const doc=Object.hasOwn(this.fieldPins,r.fragment)?this.fieldPins[r.fragment]:null;return Boolean(doc)&&typeof r.pin==='string'&&r.pin==='sha256-'+await digest(globalThis.crypto,canonical(doc));}
 /** Applies declaration loss, return, blocking and the 30-day bound (extensions §4.2) to every feature grant, in the
  * caller's transaction. Time-correct (review M1): a loss is dated from the last evaluation that still saw the
  * declaration valid (`seenAt`; the scheduled sweep, featureSync, keeps that within FEATURE_SWEEP_MS of the truth), never
  * from the first evaluation that noticed it, so a loss nobody observed for 30 days revokes on the first look, and a
  * suspension is revoked once 30 days old by the clock before any resumption is considered. A clock that jumped
  * backwards neither revokes nor resumes early: elapsed time is measured from the recorded timestamps. */
 async #syncFeatures(tx,state){
  const now=this.clock(),changes=[];
  for(const r of await this.#featureRecords(tx)){
   if(!['active','suspended'].includes(r.state))continue;
   if(state.blocked.has(r.spec)){await this.#revokeFeature(tx,r,'blocked');changes.push({feature:r.spec,state:'revoked'});continue;}
   const declared=state.valid.has(r.spec),live=declared&&await this.#pinCurrent(r);
   if(r.state==='active'){
    if(live){if(!Number.isSafeInteger(r.seenAt)||now<r.seenAt||now-r.seenAt>=SEEN_REFRESH_MS){r.seenAt=now;await this.#putFeature(tx,r);}continue;}
    r.suspendedAt=Number.isSafeInteger(r.seenAt)?r.seenAt:Number.isSafeInteger(r.enabledAt)?r.enabledAt:now;delete r.seenAt;
    if(now-r.suspendedAt>=SUSPENSION_REVOCATION_MS){await this.#revokeFeature(tx,r,'suspension-expired');changes.push({feature:r.spec,state:'revoked'});continue;}
    r.state='suspended';r.reason=declared?'pin':'declaration';await this.#putFeature(tx,r);await this.#emit(tx,[{type:'feature-suspended',feature:r.spec,grant:r.grant}]);await this.#notice(tx,{kind:'feature-suspended',feature:r.spec});changes.push({feature:r.spec,state:'suspended'});continue;
   }
   // Suspended: 30 days from the suspension timestamp revoke, even when the declaration is back (never resumed).
   if(now-r.suspendedAt>=SUSPENSION_REVOCATION_MS){await this.#revokeFeature(tx,r,'suspension-expired');changes.push({feature:r.spec,state:'revoked'});continue;}
   if(live){r.state='active';delete r.suspendedAt;delete r.reason;r.seenAt=now;await this.#putFeature(tx,r);await this.#emit(tx,[{type:'feature-resumed',feature:r.spec,grant:r.grant}]);changes.push({feature:r.spec,state:'active'});}
  }
  return changes;
 }
 /** An approval set or value changed (value change, reorder, entry purposes or ingress, reapproval): a new
  * `bindle.grant` (extensions §4.2), and the brokered credentials minted under the old one revoked for every entry it
  * covered (`extra`: entries that just left the value). Only an active or suspended grant is ever regranted (L4): a
  * revoked or disabled feature needs a fresh enable. */
 async #regrant(tx,r,extra=[]){
  if(!['active','suspended'].includes(r.state))return;
  const old=r.grant,current=(await this.#values(tx,r.fragment)).record.entries.filter(e=>(r.approved??[]).includes(e.seat)),entries=[...current,...extra.filter(e=>!current.some(c=>c.seat===e.seat))];
  r.grant=this.uuid();r.revision=(r.revision??0)+1;await this.#putFeature(tx,r);await this.#severGrant(tx,old,entries,'feature-regranted');await this.#emit(tx,[{type:'feature-regranted',feature:r.spec,grant:r.grant,previous:old}]);
 }
 async #withdrawApprovals(tx,url,gone){
  const seats=gone.map(e=>e.seat);for(const r of await this.#featuresFor(tx,url)){if(!['active','suspended'].includes(r.state)||!r.approved?.some(s=>seats.includes(s)))continue;r.approved=r.approved.filter(s=>!seats.includes(s));await this.#regrant(tx,r,gone);}
 }
 // L3: a value change of approved entries (order among them, consented purposes, ingress) regrants their features.
 async #regrantFor(tx,url,changed){for(const r of await this.#featuresFor(tx,url))if(changed(r))await this.#regrant(tx,r);}
 // Extensions §6: post-connection announcements, computed locally from the contracts recorded at the connection. Only
 // for `announce` fields an enabled (live) provider feature consumes, never for the provider's own built-ins, at most
 // once per (field, supplier). Nothing is sent to the integration; the notice is an owner-only record.
 // L2: markers are keyed per field (`<digest(url)>/<digest(clientId)>`), so turning one field's announcements back on
 // resets "at most once" for that field only.
 async #announcedKey(url,clientId){return ANNOUNCED+await digest(globalThis.crypto,url)+'/'+(clientId===undefined?'':await digest(globalThis.crypto,clientId));}
 async #announce(tx,r){
  if(r.integration?.kind!=='external'||!SERVING.includes(r.state))return;
  for(const url of Object.keys(this.fieldPins)){
   let field;try{field=this.#field(url);}catch{continue;}if(!field.announce||!this.#eligible(r,field))continue;
   const consumers=(await this.#featuresFor(tx,url)).filter(f=>f.state==='active');if(!consumers.length)continue;
   if(await tx.get(MUTED+await digest(globalThis.crypto,url))===true)continue;
   const marker=await this.#announcedKey(url,r.clientId);if(await tx.get(marker))continue;await tx.put(marker,{at:this.clock()});
   await this.#notice(tx,{kind:'announcement',template:'candidate-available',fragment:url,field:field.name,supplier:{clientId:r.clientId,origin:r.appOrigin??new URL(r.clientId).origin},contracts:[...field.contracts],claimed:true,consumers:consumers.map(f=>({feature:f.spec,...this.#descriptor(f.spec)}))});
  }
 }

 /** Connect from an approved integration manifest snapshot (system actor: the federation consent adapter). */
 async connect(owner,{client,snapshot,expectedGeneration}={}){
  if(!only(client,['id','name','origin'])||typeof client.id!=='string')fail('invalid_request','Invalid integration client.');
  let origin;try{origin=new URL(client.id).origin;}catch{fail('invalid_request','Invalid integration client.');}
  if(!origin.startsWith('https://')||client.origin!==undefined&&client.origin!==origin)fail('invalid_request','The integration origin must be its client_id origin.');
  if(!connectionSnapshotValid(snapshot,client.id,{artefactVersions:siteGlobal(this.config??{},'ARTEFACT_VERSIONS_ENABLED'),reserved:[new URL(this.origin).hostname]}))fail('invalid_integration','The integration manifest snapshot is not valid.',400);
  return this.register(owner,{id:client.id,name:client.name,origin},expectedGeneration,{transport:'bindle',integration:{kind:'external',snapshot:structuredClone(snapshot)},provenance:{kind:'oauth-consent',issuer:this.origin}});
 }
 /** Built-in integrations are connections too (integrations §3.2): the owner's explicit action is the authorization. */
 async connectBuiltIn(owner,{integration}={}){
  const def=typeof integration==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(integration)&&Object.hasOwn(this.builtins,integration)?this.builtins[integration]:null;
  if(!def||typeof def.name!=='string'||!builtInManifestValid(def.manifest))fail('not_found','Built-in integration not found.',404);
  return this.register(owner,{id:`${this.origin}/integrations/${integration}`,name:def.name,origin:this.origin},undefined,{transport:'bindle',integration:{kind:'built-in',builtin:integration,manifest:structuredClone(def.manifest)},provenance:{kind:'owner-built-in'}});
 }
 /** Lifecycle transitions (integrations §3.1, §7.1). `op`: suspend | resume | configured | health | approve. */
 async transition(owner,id,op,input={},{authTime}={}){
  const declared=op==='configured'?await this.#declarationState():null;
  return this.metadata.transaction(async tx=>{
   const r=await this.#load(tx,owner,id),now=this.clock(),from=r.state,events=[];
   const set=state=>{r.state=state;r.status=connectionStatus(state);r.stateChangedAt=now;};
   if(from==='disconnected')fail('connection_disconnected','This connection was disconnected. Connect again with fresh consent.',409);
   if(op==='suspend'){
    this.#fenced(r,input.expectedGeneration,false);if(from==='suspended')return this.view(r);
    bump(r);set('suspended');r.suspensionReason='owner';events.push({type:'connection-revoked',connection:id,clientId:r.clientId,generation:r.generation,terminal:false,reason:'suspended'});
    await this.#cascade(tx,this.#delegationRows(await this.#affected(tx,id),'system'));
   }else if(op==='resume'){
    this.#fenced(r,input.expectedGeneration,true);if(from!=='suspended')fail('invalid_state','Only a paused connection can be resumed.',409);
    const lifecycle=await tx.get(LIFECYCLE_STATE);if(BLOCKED.includes(lifecycle?.phase))fail('account_suspended','This account is suspended.',423);
    if(r.fence!==undefined&&r.fence!==epochOf(lifecycle)){await this.#severAllTx(tx,owner,'suspended');return this.view(await tx.get(prefix+id));}
    bump(r);set(r.integration?.invalid||r.integration?.review?'manifest-invalid':r.configured===false?'configuring':'active');r.fence=epochOf(lifecycle);
    events.push({type:r.state==='manifest-invalid'?'connection-state':'connection-resumed',connection:id,clientId:r.clientId,generation:r.generation,state:r.state});
    if(r.state!=='manifest-invalid')await this.#reseat(tx,r);
   }else if(op==='configured'){
    this.#fenced(r,input.expectedGeneration,true);if(typeof input.configured!=='boolean')fail('invalid_request','Say whether setup is complete.');
    if(!LIVE.includes(from))fail('invalid_state','This connection is not live.',409);
    r.configured=input.configured;const to=input.configured?(from==='configuring'?'active':from):'configuring';
    if(to!==from){if(to==='configuring'){bump(r);await this.#cascade(tx,this.#delegationRows(await this.#affected(tx,id),'system'));}set(to);events.push({type:'connection-state',connection:id,clientId:r.clientId,generation:r.generation,state:to});if(SERVING.includes(to))await this.#reseat(tx,r);if(from==='configuring'&&to==='active'){await this.#syncFeatures(tx,declared);await this.#announce(tx,r);}}
   }else if(op==='health'){
    this.#fenced(r,input.expectedGeneration,true);if(typeof input.degraded!=='boolean')fail('invalid_request','Say whether the connection is degraded.');
    const to=input.degraded&&from==='active'?'degraded':!input.degraded&&from==='degraded'?'active':from;if(to!==from){set(to);events.push({type:'connection-state',connection:id,clientId:r.clientId,generation:r.generation,state:to});}
   }else if(op==='approve'){
    // The owner approves a staged manifest change (integrations §2.3); a security-relevant one left the connection
    // manifest-invalid, so approval starts a new generation and re-checks every seat against the approved manifest.
    this.#fenced(r,input.expectedGeneration,true);const staged=r.integration?.staged;
    if(r.integration?.kind!=='external'||!staged)fail('invalid_state','There is no change to review.',409);
    if(r.integration.invalid)fail('manifest_invalid','The integration manifest is unavailable or invalid. Wait for it to be fixed.',409);
    if(!connectionSnapshotValid(staged,r.clientId,{artefactVersions:siteGlobal(this.config??{},'ARTEFACT_VERSIONS_ENABLED'),reserved:[new URL(this.origin).hostname]}))fail('invalid_integration','The staged manifest is not valid.',409);
    // W5-S2: the approval names the staged revision the owner reviewed; a re-staged snapshot needs a fresh review.
    if(typeof input.stagedRevision!=='string'||input.stagedRevision!==r.integration.stagedRevision)fail('connection_changed','This change was updated. Review it again.',409);
    if(!(Number.isSafeInteger(authTime)&&authTime<=now&&now-authTime<=RECENT_AUTH_MS))fail('reauthentication_required','Confirm it is you before approving this change.',401);
    r.integration={kind:'external',snapshot:structuredClone(staged)};
    if(from==='manifest-invalid'){bump(r);set(r.configured===false||requiresSetup(staged.manifest)&&r.configured!==true?'configuring':'active');events.push({type:'connection-resumed',connection:id,clientId:r.clientId,generation:r.generation,state:r.state});}
    else events.push({type:'manifest-adopted',connection:id,clientId:r.clientId,generation:r.generation,changes:['owner_approved']});
    if(from!=='suspended')await this.#reseat(tx,r);
   }else fail('invalid_request','Unsupported connection change.');
   await tx.put(prefix+id,r);if(events.length)await this.#emit(tx,events);return this.view(r);
  });
 }
 /** Applies an X3 revalidation result (classifyIntegrationChange) under the generation the caller observed. */
 async revalidated(owner,id,{expectedGeneration,result}={}){
  return this.metadata.transaction(async tx=>{
   const r=await this.#load(tx,owner,id),now=this.clock(),events=[];this.#fenced(r,expectedGeneration,true);
   if(r.integration?.kind!=='external'||!r.integration.snapshot)fail('invalid_state','This connection has no integration manifest.',409);
   if(!only(result,['decision','changes','next','staged'])||!['unchanged','adopt','review','invalid'].includes(result.decision)||!Array.isArray(result.changes)||result.changes.length>32||result.changes.some(c=>typeof c!=='string'||!/^[a-z_]{1,40}$/.test(c)))fail('invalid_request','Unsupported revalidation result.');
   if(r.state==='disconnected')fail('connection_disconnected','This connection was disconnected.',409);
   const reserved=[new URL(this.origin).hostname],artefactVersions=siteGlobal(this.config??{},'ARTEFACT_VERSIONS_ENABLED'),okNext=result.next===undefined||connectionSnapshotValid(result.next,r.clientId,{reserved,artefactVersions});if(!okNext)fail('invalid_request','Unsupported revalidation result.');
   const set=state=>{r.state=state;r.status=connectionStatus(state);r.stateChangedAt=now;};
   const invalidate=reason=>{if(r.state==='manifest-invalid'||r.state==='suspended')return;bump(r);set('manifest-invalid');events.push({type:'connection-revoked',connection:id,clientId:r.clientId,generation:r.generation,terminal:false,reason});};
   const security=result.changes.filter(c=>['identity_changed','keys_replaced','endpoint_collision','client_gone','client_invalid','client_mismatch','manifest_removed','manifest_invalid'].includes(c));
   let affected=[];
   if(result.decision==='invalid'){r.integration.invalid={reason:result.changes[0]??'manifest_invalid'};delete r.integration.staged;delete r.integration.stagedRevision;affected=await this.#affected(tx,id);invalidate('manifest-invalid');}
   else{
    if(result.next&&JSON.stringify(result.next)!==JSON.stringify(r.integration.snapshot)){r.integration.snapshot=structuredClone(result.next);events.push({type:'manifest-adopted',connection:id,clientId:r.clientId,generation:r.generation,changes:result.changes.slice(0,32)});}
    if(result.decision==='review'){
     if(result.staged!==undefined&&connectionSnapshotValid(result.staged,r.clientId,{reserved,artefactVersions})&&JSON.stringify(result.staged)!==JSON.stringify(r.integration.staged)){r.integration.staged=structuredClone(result.staged);r.integration.stagedRevision=this.uuid();}
     if(security.length){r.integration.review={changes:security};affected=await this.#affected(tx,id);invalidate('manifest-review');}
    }else{
     const wasInvalid=Boolean(r.integration.invalid||r.integration.review);delete r.integration.invalid;delete r.integration.review;
     if(wasInvalid&&r.state==='manifest-invalid'){bump(r);set(r.configured===false?'configuring':'active');events.push({type:'connection-resumed',connection:id,clientId:r.clientId,generation:r.generation,state:r.state});}
    }
    if(SERVING.includes(r.state)||r.state==='configuring')await this.#reseat(tx,r);
   }
   if(affected.length&&r.state==='manifest-invalid')await this.#cascade(tx,this.#delegationRows(affected,'system'));
   await tx.put(prefix+id,r);if(events.length)await this.#emit(tx,events);return this.view(r);
  });
 }
 /** Account recovery, suspension or deletion severs every connection (integrations §3.1, §7.1; review KD-4). */
 async severAll(owner,{reason='suspended'}={}){
  if(!['suspended','deleted','system'].includes(reason))fail('invalid_request','Unsupported reason.');
  return this.metadata.transaction(async tx=>{const bound=await tx.get('owner');if(bound!==undefined&&bound!==owner)fail('forbidden','Account owner mismatch.',403);return this.#severAllTx(tx,owner,reason);});
 }
 // Every connection, paginated (storage resources share the prefix). Idempotent: a repeat for the same lifecycle
 // incarnation that severs nothing writes nothing (X4-R1, R8d); otherwise one revoke-all cascade row is enqueued.
 async #severAllTx(tx,owner,reason){
  let severed=0,after='';const now=this.clock(),lifecycle=await tx.get(LIFECYCLE_STATE),mark=`${lifecycle?.generation??0}:${epochOf(lifecycle)}:${lifecycle?.phase??'none'}`;
  for(;;){
   const rows=[...(await tx.list({prefix,startAfter:after,limit:200})).entries()];
   for(const [key,r] of rows)if(r?.kind==='app-connection'&&valid(r)&&r.owner===owner){
    const eligible=connectionState(r)!=='manifest-invalid'&&(r.status!=='disconnected'||r.severanceReason==='account-suspended');
    if(r.status!=='disconnected'){
     bump(r);r.status='disconnected';r.state='disconnected';r.disconnectedAt=now;r.stateChangedAt=now;r.severanceReason=eligible?'account-'+reason:'manifest-invalid';
     await this.#vacateConnection(tx,r.id);await this.#emit(tx,[{type:'connection-revoked',connection:r.id,clientId:r.clientId,generation:r.generation,terminal:true,reason:'account-'+reason}]);severed++;
    }
    // The trusted host hook appends directly to the durable SET outbox in this same severance transaction.
    if(reason==='deleted'&&eligible&&r.subjectDeletedAt===undefined&&typeof this.subjectDeleted==='function'&&await this.subjectDeleted(tx,r,now))r.subjectDeletedAt=now;
    await this.#closeRemovals(tx,r,now);
    await tx.put(key,r);
   }
   if(rows.length<200)break;const next=rows.at(-1)[0];if(next<=after)break;after=next;
  }
  const m=await this.#meta(tx);if(!severed&&m.severed===mark)return {severed};
  await this.#cascade(tx,[{kind:'delegations',all:true,reason}]);const m2=await this.#meta(tx);m2.severed=mark;await tx.put(META,m2);
  return {severed};
 }

 // ---- Field values (extensions §3, §5): only the owner assigns, reorders or removes resources ----
 #fresh(authTime){return Number.isSafeInteger(authTime)&&authTime<=this.clock()&&this.clock()-authTime<=RECENT_AUTH_MS;}
 /** `input`: {fragment, connection, resource?, position?, replace?, purposes?, approve?, expectedRevision?}. `approve`:
  * the provider features (spec URLs) the owner explicitly approves for this new resource; none by default (§3.4). Any
  * add, replace or fill of a field an enabled provider feature consumes needs recent authentication (§3.4, EXT3-27). */
 async assign(owner,input,actor={}){
  if(!only(input,['fragment','connection','resource','position','replace','purposes','approve','expectedRevision']))fail('invalid_request','Unsupported field request.');
  const field=this.#field(input.fragment);
  if(input.resource!==undefined&&!text(input.resource,128))fail('invalid_request','Choose a resource.');
  if(input.purposes!==undefined&&!purposesValid(input.purposes))fail('invalid_request','Choose recognized purposes in ascending order.');
  if(input.position!==undefined&&(!Number.isSafeInteger(input.position)||input.position<0))fail('invalid_request','Choose a position.');
  if(input.replace!==undefined&&typeof input.replace!=='boolean')fail('invalid_request','Unsupported field request.');
  if(input.approve!==undefined&&(!Array.isArray(input.approve)||input.approve.length>8||input.approve.some(s=>typeof s!=='string')||new Set(input.approve).size!==input.approve.length))fail('invalid_request','Unsupported field request.');
  const state=await this.#declarationState();
  return this.metadata.transaction(async tx=>{
   await this.#syncFeatures(tx,state);
   const result=await this.#assignTx(tx,owner,field,input,actor);return result;
  });
 }
 async #assignTx(tx,owner,field,input,actor){
  const r=await this.#load(tx,owner,input.connection),lifecycle=await tx.get(LIFECYCLE_STATE);
  if(!SERVING.includes(r.state)||r.status!=='active')fail('connection_unavailable','Only an active connection can fill a field.',409);
  if(!this.#eligible(r,field))fail('not_a_candidate','This connection does not offer the contracts this field requires.',403);
  if(BLOCKED.includes(lifecycle?.phase)||r.fence!==epochOf(lifecycle))fail('connection_stale','The connection changed. Reload and try again.',409);
  const {key,record}=await this.#values(tx,field.url);
  if(input.expectedRevision!==undefined&&input.expectedRevision!==record.revision)fail('field_changed','The field changed. Reload and try again.',409);
  const features=await this.#featuresFor(tx,field.url),live=features.filter(f=>f.state==='active');
  if(live.length&&!this.#fresh(actor.authTime))fail('reauthentication_required','Confirm it is you before changing a field a provider feature uses.',401);
  const approve=input.approve??[];for(const spec of approve)if(!live.some(f=>f.spec===spec))fail('invalid_request','Approve only enabled features that use this field.');
  const resource=input.resource??null;
  if(record.entries.some(e=>e.connection===r.id&&e.resource===resource))fail('already_assigned','This resource is already in the field.',409);
  const removed=[],exclusive=field.selection==='exclusive'||field.max===1;
  if(exclusive&&record.entries.length){
   if(input.replace!==true)fail('field_filled','Another resource fills this field. Replace it explicitly.',409);
   removed.push(...record.entries.map(entry=>({fragment:field.url,entry})));record.entries=[];
  }else if(record.entries.length>=field.max)fail('field_full','This field is full.',409);
  const entry={seat:this.uuid(),connection:r.id,clientId:r.clientId,generation:r.generation,resource,purposes:structuredClone(input.purposes??[]),ingress:null,assignedAt:this.clock()};
  const at=Math.min(input.position??record.entries.length,record.entries.length);record.entries.splice(at,0,entry);record.revision=(record.revision??0)+1;
  await tx.put(key,record);
  await this.#emit(tx,[...removed.map(c=>({type:'value-removed',fragment:field.url,seat:c.entry.seat,connection:c.entry.connection,clientId:c.entry.clientId,generation:c.entry.generation})),{type:'field-changed',fragment:field.url,revision:record.revision,entries:this.#summary(record)}]);
  if(removed.length)await this.#withdrawApprovals(tx,field.url,removed.map(c=>c.entry));
  // Per-consumer approval of the new resource: only the features the owner ticked, each with a new grant.
  for(const spec of approve){const f=await this.#featureRecord(tx,spec);f.approved=[...new Set([...(f.approved??[]),entry.seat])];await this.#regrant(tx,f);}
  await this.#cascade(tx,[...this.#delegationRows(removed,'system'),...DELEGATION_FIELDS.includes(field.url)?[{kind:'reconcile'}]:[]]);
  return this.#fieldView(tx,field,record);
 }
 /** `input`: {fragment, seat, expectedRevision?}. Removal needs no reauthentication (§3.4). */
 async unassign(owner,input){
  if(!only(input,['fragment','seat','expectedRevision'])||!SEAT.test(input.seat??''))fail('invalid_request','Unsupported field request.');
  const field=this.#field(input.fragment);
  return this.metadata.transaction(async tx=>{
   const {key,record}=await this.#values(tx,field.url);if(input.expectedRevision!==undefined&&input.expectedRevision!==record.revision)fail('field_changed','The field changed. Reload and try again.',409);
   const entry=record.entries.find(e=>e.seat===input.seat);if(!entry)fail('not_found','Resource not found in this field.',404);
   record.entries=record.entries.filter(e=>e!==entry);record.revision++;await tx.put(key,record);
   await this.#emit(tx,[{type:'value-removed',fragment:field.url,seat:entry.seat,connection:entry.connection,clientId:entry.clientId,generation:entry.generation},{type:'field-changed',fragment:field.url,revision:record.revision,entries:this.#summary(record)}]);
   await this.#withdrawApprovals(tx,field.url,[entry]);
   await this.#cascade(tx,this.#delegationRows([{fragment:field.url,entry}],'system'));
   return this.#fieldView(tx,field,record);
  });
 }
 /** `input`: {fragment, seats:[seat...] (a permutation), expectedRevision?}. Order is the owner's priority. */
 async reorder(owner,input,actor={}){
  if(!only(input,['fragment','seats','expectedRevision'])||!Array.isArray(input.seats))fail('invalid_request','Unsupported field request.');
  const field=this.#field(input.fragment),state=await this.#declarationState();
  return this.metadata.transaction(async tx=>{
   await this.#syncFeatures(tx,state);
   const {key,record}=await this.#values(tx,field.url);if(input.expectedRevision!==undefined&&input.expectedRevision!==record.revision)fail('field_changed','The field changed. Reload and try again.',409);
   if(input.seats.length!==record.entries.length||new Set(input.seats).size!==input.seats.length||input.seats.some(s=>!record.entries.some(e=>e.seat===s)))fail('invalid_request','List every current resource exactly once.');
   if((await this.#featuresFor(tx,field.url)).some(f=>f.state==='active')&&!this.#fresh(actor.authTime))fail('reauthentication_required','Confirm it is you before changing a field a provider feature uses.',401);
   const before=record.entries.map(e=>e.seat);record.entries=input.seats.map(s=>record.entries.find(e=>e.seat===s));record.revision++;await tx.put(key,record);
   await this.#emit(tx,[{type:'field-changed',fragment:field.url,revision:record.revision,entries:this.#summary(record)}]);
   const order=(seats,r)=>seats.filter(s=>(r.approved??[]).includes(s)).join(',');await this.#regrantFor(tx,field.url,r=>order(before,r)!==order(input.seats,r));
   return this.#fieldView(tx,field,record);
  });
 }
 /** `input`: {fragment, seat, purposes}: the owner's consented purposes for this entry (withdrawal reconciles at once). */
 async configureSeat(owner,input){
  if(!only(input,['fragment','seat','purposes'])||!SEAT.test(input.seat??'')||!purposesValid(input.purposes))fail('invalid_request','Unsupported field request.');
  const field=this.#field(input.fragment);
  return this.metadata.transaction(async tx=>{
   if(BLOCKED.includes((await tx.get(LIFECYCLE_STATE))?.phase))fail('account_suspended','This account is suspended.',423);
   const {key,record}=await this.#values(tx,field.url),entry=record.entries.find(e=>e.seat===input.seat);if(!entry)fail('not_found','Resource not found in this field.',404);
   const changed=JSON.stringify(entry.purposes??[])!==JSON.stringify(input.purposes);
   entry.purposes=structuredClone(input.purposes);record.revision++;await tx.put(key,record);
   await this.#emit(tx,[{type:'field-changed',fragment:field.url,revision:record.revision,entries:this.#summary(record)}]);
   if(changed)await this.#regrantFor(tx,field.url,r=>(r.approved??[]).includes(entry.seat));
   if(DELEGATION_FIELDS.includes(field.url))await this.#cascade(tx,[{kind:'reconcile'}]);
   return this.#fieldView(tx,field,record);
  });
 }
 /** System (the C1b `describe` adapter): records the entry's validated ingress, on the connection's own origin, for the
  * entry incarnation the adapter observed. `input`: {fragment, seat, generation, ingress}. */
 async setIngress(owner,input){
  if(!only(input,['fragment','seat','generation','ingress'])||!SEAT.test(input.seat??'')||typeof input.ingress!=='string'||input.ingress.length>2048)fail('invalid_request','Unsupported field request.');
  const field=this.#field(input.fragment);
  return this.metadata.transaction(async tx=>{
   if(BLOCKED.includes((await tx.get(LIFECYCLE_STATE))?.phase))fail('account_suspended','This account is suspended.',423);
   const {key,record}=await this.#values(tx,field.url),entry=record.entries.find(e=>e.seat===input.seat);if(!entry)fail('not_found','Resource not found in this field.',404);
   const r=await this.#load(tx,owner,entry.connection);if(entry.generation!==input.generation||r.generation!==input.generation||!SERVING.includes(r.state))fail('connection_stale','The connection changed. Reload and try again.',409);
   let u;try{u=new URL(input.ingress);}catch{fail('invalid_request','Invalid ingress.');}
   if(u.origin!==r.appOrigin||u.href!==input.ingress||u.username||u.password||u.hash||u.search)fail('invalid_request','The ingress must be on the app origin.');
   if(entry.ingress!==input.ingress){entry.ingress=input.ingress;record.revision++;await tx.put(key,record);await this.#emit(tx,[{type:'field-changed',fragment:field.url,revision:record.revision,entries:this.#summary(record)}]);await this.#regrantFor(tx,field.url,r=>(r.approved??[]).includes(entry.seat));if(DELEGATION_FIELDS.includes(field.url))await this.#cascade(tx,[{kind:'reconcile'}]);}
   return this.#fieldView(tx,field,record);
  });
 }
 async #fieldView(tx,field,record){
  const out=[];for(const e of record.entries){const r=await tx.get(prefix+e.connection);out.push({seat:e.seat,connection:e.connection,clientId:e.clientId,name:r?.name??null,origin:r?.appOrigin??null,builtIn:r?.integration?.kind==='built-in',resource:e.resource,purposes:[...e.purposes??[]],ingress:e.ingress??null,available:Boolean(r&&valid(r)&&SERVING.includes(connectionState(r))&&r.status==='active'&&r.generation===e.generation),assignedAt:e.assignedAt});}
  const consumers=(await this.#featuresFor(tx,field.url)).filter(f=>['active','suspended'].includes(f.state)).map(f=>({feature:f.spec,...this.#descriptor(f.spec),state:f.state,approved:[...f.approved??[]]}));
  return {fragment:field.url,field:field.name,title:field.schema.title,host:new URL(field.url).host,selection:field.selection,max:field.max,contracts:[...field.contracts],announce:field.announce,revision:record.revision,values:out,consumers,muted:await tx.get(MUTED+await digest(globalThis.crypto,field.url))===true};
 }
 /** Owner view: every recognized provider-consumable field with its values (owner order) and its consumers. */
 async fields(owner){const state=await this.#declarationState();return this.metadata.transaction(async tx=>{await this.#syncFeatures(tx,state);const out=[];for(const url of Object.keys(this.fieldPins)){let field;try{field=this.#field(url);}catch{continue;}out.push(await this.#fieldView(tx,field,(await this.#values(tx,url)).record));}return out;});}
 /**
  * Extensions §5.1 candidates for one field, from recorded contracts only: brokered offers (active external connections
  * whose recorded `resources.contracts` cover the field), the provider's built-ins (built-in connections), and brokered
  * records. Neutral order (by origin, then id), nothing preselected, no provider preference; contracts of offers and
  * records are the supplier's claims. Owner-only (the owner's own settings, never an app's flow).
  */
 async candidates(owner,{fragment}={}){
  const field=this.#field(fragment);
  return this.metadata.transaction(async tx=>{
   const lifecycle=await tx.get(LIFECYCLE_STATE),out=[];
   for(let after='';;){const rows=[...(await tx.list({prefix,startAfter:after,limit:200})).entries()];
    for(const [,r] of rows){if(!valid(r)||r.owner!==owner||!r.integration)continue;const state=connectionState(r);if(!SERVING.includes(state)||r.status!=='active'||r.fence!==undefined&&r.fence!==epochOf(lifecycle)||!this.#eligible(r,field))continue;
     const builtIn=r.integration.kind==='built-in',origin=builtIn?this.origin:r.appOrigin??new URL(r.clientId).origin;
     out.push({kind:builtIn?'built-in':'offer',id:`connection:${r.id}`,connection:r.id,clientId:r.clientId,origin,label:r.name,labelSupplied:!builtIn,builtIn,contracts:[...field.contracts],claimed:!builtIn});}
    if(rows.length<200||rows.at(-1)[0]<=after)break;after=rows.at(-1)[0];}
   for(const [,rec] of await tx.list({prefix:RECORD,limit:257})){if(rec?.v!==1||rec.owner!==owner||rec.status!=='available'||!Array.isArray(rec.contracts)||!field.contracts.every(c=>rec.contracts.includes(c)))continue;const c=await tx.get(prefix+rec.connection);if(!valid(c)||c.owner!==owner||!SERVING.includes(connectionState(c))||c.status!=='active'||c.generation!==rec.generation)continue;
    out.push({kind:'record',id:`record:${rec.id}`,connection:rec.connection,record:rec.id,clientId:rec.clientId,origin:c.appOrigin??new URL(rec.clientId).origin,label:rec.label??null,labelSupplied:true,builtIn:false,contracts:[...rec.contracts],claimed:true});}
   return {fragment:field.url,field:field.name,candidates:out.sort((a,b)=>a.origin<b.origin?-1:a.origin>b.origin?1:a.id<b.id?-1:a.id>b.id?1:0)};
  });
 }
 /** The value port core: available entries in owner order, plus the account fence: `sever` is true when the account
  * lifecycle is blocked, or its capability epoch moved since a connection was (re)activated, meaning a suspension
  * happened that no hook reported (review KD-4). */
 async value(owner,url){
  const field=this.#field(url);
  return this.metadata.transaction(async tx=>this.#valueTx(tx,owner,field));
 }
 async #valueTx(tx,owner,field){
  const bound=await tx.get('owner');if(bound!==undefined&&bound!==owner)return {fragment:field.url,selection:field.selection,entries:[],sever:false};
  const lifecycle=await tx.get(LIFECYCLE_STATE),{record}=await this.#values(tx,field.url),entries=[];let sever=BLOCKED.includes(lifecycle?.phase);
  if(!sever)for(let after='';;){const rows=[...(await tx.list({prefix,startAfter:after,limit:200})).entries()];if(rows.some(([,r])=>r?.kind==='app-connection'&&r.owner===owner&&r.status!=='disconnected'&&r.fence!==undefined&&r.fence!==epochOf(lifecycle))){sever=true;break;}if(rows.length<200||rows.at(-1)[0]<=after)break;after=rows.at(-1)[0];}
  for(const e of record.entries){
   const r=await tx.get(prefix+e.connection);if(!valid(r)||r.owner!==owner)continue;
   if(r.status==='active'&&r.fence!==undefined&&r.fence!==epochOf(lifecycle))sever=true;
   if(SERVING.includes(connectionState(r))&&r.status==='active'&&r.generation===e.generation&&r.fence===epochOf(lifecycle))entries.push({seat:e.seat,connection:e.connection,clientId:e.clientId,origin:r.appOrigin??null,generation:e.generation,cnx:cnxOf(e),resource:e.resource,purposes:[...e.purposes??[]],ingress:e.ingress??null,kind:r.integration?.kind??'external'});
  }
  return {fragment:field.url,selection:field.selection,entries:sever?[]:entries,sever};
 }
 /** A selection state machine (packages/federation/extensions.mjs createFieldOperation) over the current value for a
  * provider feature: the feature's approved entries in owner order, unavailable ones marked so (extensions §3.1). */
 async fieldOperation(owner,{feature}={}){
  const live=await this.featureResources(owner,{feature}),def=FEATURE_DEFINITIONS[feature],field=this.#field(def.fragment);
  const view=await this.metadata.transaction(async tx=>(await this.#values(tx,field.url)).record);
  const resources=view.entries.filter(e=>live.approved.includes(e.seat)).map(e=>({id:e.seat,status:live.resources.some(a=>a.seat===e.seat)?'available':'unavailable',credentialCurrent:true}));
  return createFieldOperation(field.field,resources,{consumer:'provider',featureLive:live.live});
 }

 // ---- Provider features (extensions §4.2) ----
 #featureView(spec,r,declared){const def=FEATURE_DEFINITIONS[spec];return {feature:spec,...this.#descriptor(spec),declared,fragment:def.fragment,field:def.field,methods:structuredClone(def.methods),state:r?.state??'off',...r?{grant:r.grant,approved:[...r.approved??[]],enabledAt:r.enabledAt,...r.suspendedAt!==undefined?{suspendedAt:r.suspendedAt}:{},...r.revokedAt!==undefined?{revokedAt:r.revokedAt}:{},...r.reason?{reason:r.reason}:{}}:{}};}
 /** Owner view of every provider feature: descriptor text with the host of its spec URL, whether it is declared now,
  * the field and methods it requests, and its grant state (off, active, suspended, revoked). */
 async features(owner){const state=await this.#declarationState();return this.metadata.transaction(async tx=>{await this.#syncFeatures(tx,state);const out=[];for(const spec of Object.keys(FEATURE_DEFINITIONS))out.push(this.#featureView(spec,await this.#featureRecord(tx,spec),state.valid.has(spec)&&!state.blocked.has(spec)));return out;});}
 /** Owner, with recent authentication (§3.4): enabling is the consent for the feature's request, bound to the field's
  * current values. `assign` ({connection, resource?}) fills an empty field on the same screen (§4.2). */
 async enableFeature(owner,input={},actor={}){
  if(!only(input,['feature','assign','expectedRevision']))fail('invalid_request','Unsupported feature request.');
  const def=typeof input.feature==='string'&&Object.hasOwn(FEATURE_DEFINITIONS,input.feature)?FEATURE_DEFINITIONS[input.feature]:null;if(!def)fail('not_found','Feature not found.',404);
  if(input.assign!==undefined&&!only(input.assign,['connection','resource']))fail('invalid_request','Unsupported feature request.');
  const field=this.#field(def.fragment);if(field.name!==def.field||!field.consumers.includes('provider'))fail('unsupported_field','This field is not available to provider features.',400);
  if(!this.#fresh(actor.authTime))fail('reauthentication_required','Confirm it is you before enabling this feature.',401);
  const state=await this.#declarationState();
  if(state.blocked.has(input.feature))fail('feature_blocked','This feature is blocked on this provider.',409);
  if(!state.valid.has(input.feature))fail('feature_unavailable','This feature is not available right now.',409);
  return this.metadata.transaction(async tx=>{
   await this.#syncFeatures(tx,state);
   if(BLOCKED.includes((await tx.get(LIFECYCLE_STATE))?.phase))fail('account_suspended','This account is suspended.',423);
   let r=await this.#featureRecord(tx,input.feature);if(r?.state==='active')return this.#featureView(input.feature,r,true);
   let {record}=await this.#values(tx,field.url);
   if(input.expectedRevision!==undefined&&input.expectedRevision!==record.revision)fail('field_changed','The field changed. Reload and try again.',409);
   if(input.assign){if(record.entries.length)fail('field_filled','This field already has a value. Change it in the field settings.',409);await this.#assignTx(tx,owner,field,{fragment:field.url,...input.assign},{authTime:actor.authTime});record=(await this.#values(tx,field.url)).record;}
   const pin='sha256-'+await digest(globalThis.crypto,canonical(field.schema));
   r={spec:input.feature,issuer:this.origin,fragment:field.url,field:field.name,pin,methods:structuredClone(def.methods),state:'active',grant:this.uuid(),approved:record.entries.map(e=>e.seat),enabledAt:this.clock(),seenAt:this.clock(),revision:(r?.revision??0)+1};
   await this.#putFeature(tx,r);await this.#emit(tx,[{type:'feature-enabled',feature:r.spec,grant:r.grant}]);
   return this.#featureView(input.feature,r,true);
  });
 }
 /** Owner: disabling revokes the feature's grant at once, with its brokered credentials (§4.2). No reauthentication. */
 async disableFeature(owner,input={}){
  if(!only(input,['feature'])||typeof input.feature!=='string'||!Object.hasOwn(FEATURE_DEFINITIONS,input.feature))fail('not_found','Feature not found.',404);
  const state=await this.#declarationState();
  return this.metadata.transaction(async tx=>{await this.#syncFeatures(tx,state);const r=await this.#featureRecord(tx,input.feature);if(!r)fail('not_found','Feature not found.',404);if(['active','suspended'].includes(r.state))await this.#revokeFeature(tx,r,'disabled');return this.#featureView(input.feature,r,state.valid.has(input.feature));});
 }
 /** System: applies declaration loss and return, blocking and the 30-day revocation (also run by every read). The
  * account alarm runs it every FEATURE_SWEEP_MS while any grant is active or suspended (review M1), so suspension,
  * revocation and the owner's notice happen with nobody reading; `next` is when to sweep again (null: nothing to watch). */
 async featureSync(owner){const state=await this.#declarationState();return this.metadata.transaction(async tx=>{const changes=await this.#syncFeatures(tx,state);const watched=(await this.#featureRecords(tx)).some(r=>['active','suspended'].includes(r.state));return {changes,next:watched?this.clock()+FEATURE_SWEEP_MS:null};});}
 /** System, the provider feature's projection (extensions §3.1): only while its enablement is live and unsuspended,
  * its approved resources that are available now, in owner order, with the current `bindle.grant`. */
 async featureResources(owner,{feature}={}){
  const def=typeof feature==='string'&&Object.hasOwn(FEATURE_DEFINITIONS,feature)?FEATURE_DEFINITIONS[feature]:null;if(!def)fail('not_found','Feature not found.',404);
  const field=this.#field(def.fragment),state=await this.#declarationState();
  return this.metadata.transaction(async tx=>{
   await this.#syncFeatures(tx,state);const r=await this.#featureRecord(tx,feature);
   if(r?.state!=='active')return {feature,live:false,state:r?.state??'off',approved:[],resources:[],sever:false};
   const value=await this.#valueTx(tx,owner,field);
   return {feature,live:true,state:'active',grant:r.grant,approved:[...r.approved],resources:value.entries.filter(e=>r.approved.includes(e.seat)).map(e=>({...e,grant:r.grant})),selection:field.selection,sever:value.sever};
  });
 }
 /** Owner-only notices (announcements, feature suspension and revocation), newest last. */
 async notices(owner){return this.metadata.transaction(async tx=>({notices:[...(await tx.list({prefix:NOTICE,limit:NOTICE_LIMIT+8})).values()].sort((a,b)=>a.id<b.id?-1:1)}));}
 async dismissNotice(owner,{id}={}){if(typeof id!=='string'||!/^\d{16}$/.test(id))fail('invalid_request','Unsupported notice.');return this.metadata.transaction(async tx=>{const had=await tx.get(NOTICE+id);if(had)await tx.delete(NOTICE+id);return {dismissed:Boolean(had)};});}
 /** Owner: turn announcements for a field off or back on (§6 rule 6: turning them on again resets "at most once"). */
 async announcements(owner,{fragment,enabled}={}){
  const field=this.#field(fragment);if(typeof enabled!=='boolean')fail('invalid_request','Say whether announcements are on.');
  return this.metadata.transaction(async tx=>{const key=MUTED+await digest(globalThis.crypto,field.url);
   if(!enabled)await tx.put(key,true);else if(await tx.get(key)===true){await tx.delete(key);for(const [k] of await tx.list({prefix:await this.#announcedKey(field.url),limit:512}))await tx.delete(k);}
   return {fragment:field.url,enabled};});
 }

 // ---- Outbox and cascades (system actors only) ----
 async outbox(owner,{after=0,limit=100}={}){
  if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>500)fail('invalid_request','Unsupported outbox request.');
  return this.metadata.transaction(async tx=>{const m=await this.#meta(tx),rows=[...(await tx.list({prefix:OUTBOX,limit:OUTBOX_LIMIT+1})).values()].filter(e=>e.seq>after).sort((a,b)=>a.seq-b.seq);return {events:rows.slice(0,limit),seq:m.seq,gap:after<m.low};});
 }
 async ack(owner,{through}={}){
  if(!Number.isSafeInteger(through)||through<0)fail('invalid_request','Unsupported acknowledgment.');
  return this.metadata.transaction(async tx=>{const m=await this.#meta(tx),upto=Math.min(through,m.seq);let removed=0;for(const [key,e] of await tx.list({prefix:OUTBOX,limit:OUTBOX_LIMIT+1}))if(e.seq<=upto){await tx.delete(key);removed++;}m.low=Math.max(m.low,upto);await tx.put(META,m);return {acknowledged:upto,removed};});
 }
 async cascades(owner){return this.metadata.transaction(async tx=>[...(await tx.list({prefix:CASCADE,limit:CASCADE_LIMIT+2})).entries()].map(([key,row])=>({key,...row})));}
 async cascadeDone(owner,key){
  if(typeof key!=='string'||!key.startsWith(CASCADE))fail('invalid_request','Unsupported cascade.');
  return this.metadata.transaction(async tx=>{if(await tx.get(key)===undefined)return {done:false};await tx.delete(key);if(key!==CASCADE_ALL){const m=await this.#meta(tx);m.pending=Math.max(0,m.pending-1);await tx.put(META,m);}return {done:true};});
 }
}
