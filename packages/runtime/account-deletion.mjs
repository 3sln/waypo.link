// DX-3: self-serve and admin-assisted account deletion (docs/architecture/account-deletion-export.md §2, §4.2, §6).
//
// This module is the account-placement core. It owns the deletion request record, the deadline commit, the
// fence and the hold, and drives the shared purge executor (`purgeBatch`, packages/runtime/lifecycle-storage.mjs)
// with the deletion stage hooks. The engine operations (packages/app/domains/account-deletion.mjs) call
// `DeletionService`; the account slice (packages/runtime/account/deletion.mjs) composes it over a controller.
//
// Everything new is gated by ACCOUNT_DELETION_ENABLED through the injected flags port: `enabled` for new
// requests, `background` (env kill switch only) for cancel and background continuation (§8.1). An env kill halts
// execution between stages and keeps data; a committed request stays fenced.
//
// Every external effect is an injected port (`DeletionPorts`). A port that is `undefined` is misconfigured and
// the operation refuses or holds; a port that is `null` is declared absent on this host (for example the email
// bridge on Node) and its stage is a recorded no-op. Destructive work prefers holding to guessing.
//
// DeletionPorts {
//   identity   {get(owner), tombstone(owner,{assignmentId,reason})}   lifecycleIdentityPort (identity/lifecycle-tombstone.mjs)
//   security   owner -> {epoch, changedAt|null}                        DX-6 `identitySecurity` (R1-H1)
//   hold       owner -> {held}                                         `deletionHoldPort`: explicit admin hold only (R1-M8)
//   adminAuthority owner -> {admin}                                    built-in admin role (R1-L9)
//   billing    {cancelAtPeriodEnd, uncancel, revokeAll, anonymize, paid?} | null   DX-4 BillingClosure
//   notices    {deliver(input) -> {accepted}}                          DX-5 templates over mail and push
//   erasure    {federation:{eraseSubject}|null, mcp:{eraseSubject}|null, emailBridge:{erase}|null,
//               operatorApps:{ownerDeleted(owner,{reason,basis})}|null}   §2.3 E3, E5b; R1-M12 (no default wiring)
//   exports    {cancelAll(owner,{budget})} | null                      DX-1 ExportGeneration (E6)
//   due        {put(owner,executeAfter), delete(owner,executeAfter)}   the `deletion-due` index (§2.2)
// }
import {AppFault} from '../app/faults.mjs';
import {key,base64url} from '../core/records.mjs';
import {canonical,isUUID} from '../core/primitives.mjs';
import {PURGE_KEY,TOMBSTONE_KEY,purgeBatch} from './lifecycle-storage.mjs';

const DUE_CURSOR_KEY='deletion-due-cursor';
export const REQUEST_KEY='deletion/request-v1',FENCE_KEY='deletion/fence-v1',RECEIPT_PREFIX='deletion/receipt/',DELETION_FLAG='ACCOUNT_DELETION_ENABLED';
export const DELETION_BASES=Object.freeze(['owner','admin-email','admin-underage','admin-closure']);
const MINUTE=60000,HOUR=3600000,DAY=86400000;
export const STEP_UP_WINDOW_MS=300000,SECURITY_WINDOW_MS=72*HOUR,GRACE_DAYS=14,EXTENDED_GRACE_DAYS=30;
export const DRAIN_GIVE_UP_MS=72*HOUR,HOLD_ALERT_MS=7*DAY,NOTICE_GIVE_UP_MS=DAY;
const MAX_TOKENS=16,MAX_PUSH=16;
// Wargame 4 L1: the request/cancel loop is bounded per account. At most REQUEST_BUDGET owner requests commit
// per REQUEST_WINDOW_MS; receipts are kept for RECEIPT_TTL_MS and at most RECEIPT_CAP. Every new request gets its own
// "scheduled" notice and cancel link (review: a quiet window hid a re-request after a cancel).
export const REQUEST_BUDGET=3,REQUEST_WINDOW_MS=DAY,RECEIPT_CAP=16,RECEIPT_TTL_MS=30*DAY;
export const REQUEST_LOG_KEY='deletion/request-log';
// Outboxes E4 waits for (account-local rows only; delivery itself is the owning slice's code).
export const DRAIN_PREFIXES=Object.freeze(['connections/cascade/','integration-events/row/']);
// RTC-d: `rtcDrain` ends live sessions with control statements (rtc.lifecycle `deletion`) and delivers them.
const DRAINS=Object.freeze(['connectionsDrain','brokeredSeveranceDrain','integrationEventsAlarm','eventBusSweep','rtcDrain']);
const CANCELLABLE=new Set(['owner','admin-email']);
// PORT-2 (identity portability, IP-R1-L10): the transfer-out record (packages/identity/transfer-out.mjs TRANSFER_KEY).
// A committed move refuses deletion (the moved identity is purged by its own `moved` purge); a deletion request
// cancels a pending move explicitly, in the same account transaction that schedules the deletion.
const TRANSFER_KEY='transfer-out/v1',TRANSFER_PENDING=new Set(['pending','held','contested']);
const OPERATION_ID=/^[A-Za-z0-9_-]{16,128}$/;

const fail=(code,message,status)=>{throw new AppFault(code,message,status);};
const notFound=()=>fail('not_found','Not found.',404);
const unavailable=(message='Account deletion is temporarily unavailable.')=>fail('deletion_unavailable',message,503);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,names)=>{if(value===undefined)return {};if(!plain(value)||Object.keys(value).some(name=>!names.includes(name)))fail('invalid_request','Unsupported deletion request.',400);return value;};
const hex=bytes=>[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
async function sha256(text){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));}
function sameText(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}

/** New requests: the evaluated owner flag. Unknown flags (registry row not yet landed) and errors are off. */
export function deletionEnabled(flags,owner){try{return flags.for({subject:{kind:'account',owner}}).enabled(DELETION_FLAG)===true;}catch{return false;}}
/** Cancel and background continuation follow only the env kill switch (feature-flags §0.7, §4). */
export function deletionBackground(flags,owner){try{return flags.for({subject:{kind:'account',owner}}).background(DELETION_FLAG)===true;}catch{return false;}}
/** Admin-initiated scheduling needs the flag's global component (§8.1). */
export function deletionGlobal(flags){try{return flags.for({}).global(DELETION_FLAG)===true;}catch{return false;}}

function validSecurity(value){
 if(!plain(value)||!Number.isSafeInteger(value.epoch)||value.epoch<0||!(value.changedAt===null||value.changedAt===undefined||Number.isSafeInteger(value.changedAt)))throw Object.assign(new Error('Identity security state unavailable'),{code:'security_unavailable'});
 return {epoch:value.epoch,changedAt:value.changedAt??null};
}
/** Server-derived grace (§2.1). 14 days, or 30 after a security-sensitive change in the previous 72 hours (a
 * change dated in the future also counts). Admin bases use 30 days; admin closure executes at `exportUntil`. */
export function deletionGrace({now,security,basis='owner',exportUntil}){
 if(basis==='admin-closure'&&Number.isSafeInteger(exportUntil))return {graceDays:Math.max(1,Math.ceil((exportUntil-now)/DAY)),executeAfter:exportUntil};
 const changedAt=security?.changedAt,recent=Number.isSafeInteger(changedAt)&&now-changedAt<SECURITY_WINDOW_MS;
 const graceDays=basis==='owner'&&!recent?GRACE_DAYS:EXTENDED_GRACE_DAYS;
 return {graceDays,executeAfter:now+graceDays*DAY};
}

/** Min-merge alarm helper (§2.2, R1-M4): never moves an earlier pending alarm later. */
export async function armAlarm(metadata,time,now=Date.now()){
 if(!Number.isSafeInteger(time)||typeof metadata?.setAlarm!=='function')return;
 const prior=typeof metadata.getAlarm==='function'?await metadata.getAlarm():null;
 if(Number.isSafeInteger(prior)&&prior>now&&prior<=time)return;
 await metadata.setAlarm(time);
}

/** True while a deletion request is scheduled or executing, or any purge is fenced or running. The inactivity
 * lifecycle holds (`deletion-scheduled`), and seven-day shelving and semantic backfill refuse (R1-H2). `reader`
 * is the metadata store or a transaction. */
export async function deletionBlocksMaintenance(reader){
 const request=await reader.get(REQUEST_KEY);
 return ['scheduled','executing'].includes(request?.state)||await reader.get(FENCE_KEY)!==undefined||await reader.get(PURGE_KEY)!==undefined;
}
/** The alarm must return right after the deletion tick while a fence or purge job exists, or after deletion. */
export async function alarmFenced(reader){return await reader.get(FENCE_KEY)!==undefined||await reader.get(PURGE_KEY)!==undefined||await reader.get(TOMBSTONE_KEY)!==undefined;}

/** D1: an ungated orchestration admitted before the deletion fence must not write after it. Re-checked inside the
 * account gate (`gated`) and inside the writing transaction (for example audience decisions). `reader` is the
 * metadata store or a transaction. */
export async function assertLifecycleOpen(reader){
 if(await reader.get(TOMBSTONE_KEY)!==undefined)fail('account_deleted','This account was deleted.',410);
 if(await reader.get(FENCE_KEY)!==undefined||await reader.get(PURGE_KEY)!==undefined)fail('account_deleting','Account deletion has begun.',410);
}
/** Review #3: the entry fence (`lifecycleBlocked`) re-checked inside invoke's account gate for every policy not
 * declared 'purging': a call admitted before the deletion fence or the tombstone committed does not run after it. */
export async function assertDeletionFenceOpen(reader){
 if(await reader.get(TOMBSTONE_KEY)!==undefined)fail('account_deleted','This account was deleted after its final notice period.',410);
 if(await reader.get(FENCE_KEY)!==undefined)fail('account_deleting','Account deletion has begun.',410);
}
/** The `deletion-due/<executeAfter>/<owner>` index (§2.2) over any key/value metadata store. The adapter
 * chooses the store (the identity directory or the scheduler object); the sweep calls `deletionTick(owner)`
 * for due rows independent of LIFECYCLE_ENABLED. */
export function deletionDueIndex(metadata){
 const name=(owner,at)=>{if(!isUUID(owner)||!Number.isSafeInteger(at)||at<0)throw new TypeError('Invalid deletion index entry');return `deletion-due/${String(at).padStart(16,'0')}/${owner}`;};
 return Object.freeze({
  put:(owner,at)=>metadata.put(name(owner,at),{owner,executeAfter:at}),
  delete:(owner,at)=>metadata.delete(name(owner,at)),
  async due({now=Date.now(),limit=64}={}){const rows=await metadata.list({prefix:'deletion-due/',limit});return [...rows.values()].filter(row=>isUUID(row?.owner)&&Number.isSafeInteger(row.executeAfter)&&row.executeAfter<=now);},
  /** Wargame D3: one page of due rows after the persisted cursor. Rows are ordered by executeAfter, so the page ends
   * at the first row that is not yet due; `wrapped` means the next page starts again from the beginning. */
  async page({now=Date.now(),limit=64}={}){
   const cursor=await metadata.get(DUE_CURSOR_KEY),rows=await metadata.list({prefix:'deletion-due/',...typeof cursor==='string'&&cursor.startsWith('deletion-due/')?{startAfter:cursor}:{},limit});
   const due=[];let wrapped=rows.size<limit;
   for(const [name,row] of rows){if(!(Number.isSafeInteger(row?.executeAfter)&&row.executeAfter<=now)){wrapped=true;break;}if(isUUID(row?.owner))due.push({...row,key:name});}
   return {rows:due,wrapped,last:[...rows.keys()].at(-1)??null};
  },
  advance:async(last,wrapped)=>wrapped||!last?metadata.delete(DUE_CURSOR_KEY):metadata.put(DUE_CURSOR_KEY,last),
 });
}
/** One bounded sweep over due rows: invokes `deletionTick` on each owner's account. Failures are counted and
 * retried at the next sweep; the row is removed only by cancel or E11. A persisted cursor that wraps (wargame D3)
 * means held rows at the head of the index cannot starve later due accounts. */
/** Wargame 4: the Node scheduler's run. Each run reads the live flag port (background semantics: only the env kill
 * stops it), so a flag enabled after boot is honoured. `flags()` returns a pinned port. */
export function deletionDueSweepRun({flags,index,accounts}){return async()=>{try{if(!(await flags()).background(DELETION_FLAG))return {skipped:true};return await sweepDeletionDue({index,accounts});}catch{return {failed:true};}};}
export async function sweepDeletionDue({index,accounts,now=Date.now(),limit=64}){
 let ticked=0,failed=0;
 const page=typeof index.page==='function'?await index.page({now,limit}):{rows:await index.due({now,limit})};
 for(const row of page.rows){
  try{const result=await accounts.get(row.owner).invoke({method:'deletionTick',args:[row.owner,{source:'sweep'}]});if(result?.$fault)failed++;else ticked++;}catch{failed++;}
 }
 if(typeof index.advance==='function')await index.advance(page.last,page.wrapped||!page.rows.length);
 return {ticked,failed};
}

/** E4: drains integration and severance outboxes (the alarm no longer runs them once fenced) until each is empty,
 * with a bounded retry; gives up after 72 hours and logs the count dropped. Security never depends on delivery. */
export async function drainOutboxes(c,owner,{state,clock=Date.now,log=()=>{}}={}){
 const now=clock();state.startedAt??=now;state.attempts=(state.attempts??0)+1;
 let pending=0;
 for(const name of DRAINS){
  if(typeof c[name]!=='function')continue;
  try{const out=await c[name](owner);if(out?.more===true||Number.isSafeInteger(out?.pending)&&out.pending>0)pending++;}
  catch(error){if(error?.code!=='not_found')pending++;}// A disabled feature answers not_found and has nothing queued.
 }
 for(const prefix of DRAIN_PREFIXES)if((await c.metadata.list({prefix,limit:1})).size)pending++;
 if(!pending)return {done:true,attempts:state.attempts};
 if(now-state.startedAt>=DRAIN_GIVE_UP_MS){let dropped=0;for(const prefix of DRAIN_PREFIXES)dropped+=(await c.metadata.list({prefix,limit:1000})).size;log({action:'drain-dropped',dropped});return {done:true,dropped,attempts:state.attempts};}
 return {done:false,retryAt:now+Math.min(HOUR,MINUTE*2**Math.min(state.attempts-1,6))};
}

const erasureMissing=name=>({held:true,reason:`erasure-port-unconfigured:${name}`});
/** The erasure stage hooks common to every purge reason (§6, R1-H3/H4). `ports` are DeletionPorts. */
export function erasureStages(c,{ports,clock=Date.now,log=()=>{}}={}){
 const erasure=ports?.erasure;
 const call=async(name,method,owner,state,args=[])=>{
  if(state[name])return true;
  const port=erasure?.[name];if(port===null){state[name]='absent';return true;}
  if(typeof port?.[method]!=='function')return false;
  state[name]={result:await port[method](owner,...args)};return true;
 };
 return {
  // E3: grant, token-family, preference, brokered-JTI and device-grant rows; then the owner's MCP shard rows.
  async eraseGrants(owner,{state}){for(const name of ['federation','mcp'])if(!await call(name,'eraseSubject',owner,state))return erasureMissing(name);return {done:true,federation:state.federation==='absent'?'absent':'erased',mcp:state.mcp==='absent'?'absent':'erased'};},
  async drain(owner,{state}){return drainOutboxes(c,owner,{state,clock,log});},
  // R1-M12 is open: notify operator-run apps of owner deletion through a pluggable port with no default wiring.
  async notifyOperatorApps(owner,{state,reason,basis}){
   const port=erasure?.operatorApps;if(port===null)return {done:true,operatorApps:'absent'};if(typeof port?.ownerDeleted!=='function')return erasureMissing('operatorApps');
   const result=await port.ownerDeleted(owner,{reason,basis});
   if(result?.done===false){state.attempts=(state.attempts??0)+1;return {done:false,retryAt:clock()+Math.min(DAY,HOUR*2**Math.min(state.attempts-1,5))};}
   return {done:true,operatorApps:'notified'};
  },
  // E5b: the owner's EmailBridgeObject (settings, holding queue, dedup, reply ledger); absent on Node.
  async eraseEmailBridge(owner,{state}){return await call('emailBridge','erase',owner,state)?{done:true,emailBridge:state.emailBridge==='absent'?'absent':'erased'}:erasureMissing('emailBridge');},
  // E6: before the blob stages, so deferred garbage pinned by an export becomes collectable.
  // DX-1's ExportGeneration.cancelAll owns the job and write-intent schema; there is deliberately no parts-only
  // fallback here (an unconfigured port holds), and `null` (no export store on this host) is a recorded no-op.
  async exportsCancel(owner,{budget}){const port=ports?.exports;if(port===null)return {done:true,exports:'absent'};if(typeof port?.cancelAll!=='function')return erasureMissing('exports');return port.cancelAll(owner,{budget});},
 };
}

/** Unconditional restore path (§2.3, R1-L1/R1-M7): an account object with no `owner` for a deleted identity gets
 * `owner` plus a restored tombstone, whatever the lifecycle mode. The reason comes from the identity tombstone's
 * `account-deleted-<reason>` audit event. Returns {deleted, restored}. A failing identity read rejects. */
export async function restoreDeletedAccount(c,owner,identity,{clock=Date.now}={}){
 if(!isUUID(owner))throw new TypeError('Invalid account identifier');
 const stored=await c.metadata.get('owner');if(stored!==undefined&&stored!==owner)fail('forbidden','Account owner mismatch.',403);
 if(await c.metadata.get(TOMBSTONE_KEY)!==undefined)return {deleted:true,restored:false};
 if(stored!==undefined)return {deleted:false,restored:false};
 const account=await identity.get(owner);if(account?.status!=='deleted')return {deleted:false,restored:false};
 const basis=account.deletionReason,tombstone={version:1,owner,deletedAt:clock(),reason:!basis||basis==='inactive'?'inactive-unpaid':basis==='owner'?'owner':basis==='moved'?'moved':'admin',...basis&&basis!=='inactive'?{basis}:{},restored:true};
 const restored=await c.metadata.transaction(async tx=>{if(await tx.get('owner')!==undefined||await tx.get(TOMBSTONE_KEY)!==undefined)return false;await tx.put('owner',owner);await tx.put(TOMBSTONE_KEY,tombstone);return true;});
 return {deleted:true,restored};
}
/** Empty-object identity check for `lifecycleBlocked` (R1-M7). Whenever `owner` is absent, asks the identity port
 * once per object lifetime; a deleted identity gets its tombstone restored and the caller answers
 * `account_deleted`. An unreadable identity refuses rather than materialising. Returns a fault or null. */
/** `restore:false` answers without writing (the request path cannot prove the object is addressed by `owner`);
 * `failOpen:true` lets an unreadable identity through unmemoized instead of refusing. */
export async function emptyAccountCheck(c,owner,identity,{restore=true,failOpen=false}={}){
 if(!identity||typeof identity.get!=='function'||!isUUID(owner)||c.deletionIdentityChecked===owner)return null;
 if(await c.metadata.get('owner')!==undefined){c.deletionIdentityChecked=owner;return null;}
 let deleted;
 try{deleted=restore?(await restoreDeletedAccount(c,owner,identity)).deleted:(await identity.get(owner))?.status==='deleted';}
 catch{return failOpen?null:{code:'lifecycle_unavailable',message:'Account status is temporarily unavailable.',status:503};}
 if(deleted)return {code:'account_deleted',message:'This account was deleted.',status:410};
 c.deletionIdentityChecked=owner;return null;
}

/** Public projection of a request: never channels, tokens or billing identifiers. */
export function deletionView(request,{fenced=false}={}){
 if(!request)return {state:'none'};
 return {state:request.state,basis:request.basis,requestedAt:request.requestedAt,executeAfter:request.executeAfter,graceDays:request.graceDays,
  cancellable:request.state==='scheduled'&&!fenced&&CANCELLABLE.has(request.basis),
  notice:{required:hasChannels(request),accepted:request.noticeAccepted===true},
  billing:{pending:request.billing?.pending===true,cancelAtPeriodEnd:Array.isArray(request.billing?.set)?request.billing.set.length:0,...request.billing?.unrestored?{unrestored:request.billing.unrestored.length}:{}},
  hold:request.hold?.reason??null,...request.state==='cancelled'?{cancelledAt:request.cancelledAt}:{}};
}
function hasChannels(request){return Boolean(request?.channels?.email)||Boolean(request?.channels?.push?.length);}

async function channelSnapshot(tx,owner,identity){
 const email=typeof identity.verifiedEmail==='string'&&Number.isSafeInteger(identity.emailVerifiedAt)?identity.verifiedEmail:null;
 // Copies, not references: deleting push-subscription rows after the request cannot suppress notices (R1-M2).
 const push=[...(await tx.list({prefix:key('push-subscription',owner)})).values()].filter(row=>row?.owner===owner&&typeof row.endpoint==='string'&&plain(row.keys)).slice(0,MAX_PUSH).map(row=>({id:row.id,endpoint:row.endpoint,keys:structuredClone(row.keys)}));
 return {email,emailVerifiedAt:email?identity.emailVerifiedAt:null,push};
}

const NOTICE_KINDS=Object.freeze(['scheduled','reminder-3d','reminder-1d','executing','completed']);

export class DeletionService{
 #tail=Promise.resolve();
 /** `executor` is the account controller (or a test composition): metadata, blobs, archives, config and the
  * optional search, severance and drain methods. `ports` is DeletionPorts or a function returning it. */
 constructor({executor,ports,flags,clock,random,log=()=>{},wake,budget=64,busyMs=2000}){
  if(!executor?.metadata||typeof flags?.for!=='function'||typeof clock?.now!=='function'||typeof random?.bytes!=='function'||typeof random?.uuid!=='function')throw new TypeError('Deletion service dependencies are required.');
  Object.assign(this,{executor,portSource:ports,flags,clock,random,log,wake,budget,busyMs:Number.isSafeInteger(busyMs)&&busyMs>0?busyMs:2000});
 }
 get metadata(){return this.executor.metadata;}
 get ports(){const value=typeof this.portSource==='function'?this.portSource():this.portSource;return plain(value)?value:{};}
 now(){const now=this.clock.now();if(!Number.isSafeInteger(now)||now<0)unavailable();return now;}
 port(name){const value=this.ports[name];if(value===undefined)unavailable('Account deletion is not configured.');return value;}
 async arm(time){if(!Number.isSafeInteger(time))return;try{if(typeof this.wake==='function')await this.wake(time);else await armAlarm(this.metadata,time,this.now());}catch{/* The sweep through the due index is the backstop. */}}
 async bound(owner){const stored=await this.metadata.get('owner');if(stored!==owner)fail(stored===undefined?'account_unavailable':'forbidden',stored===undefined?'Account unavailable.':'Account owner mismatch.',stored===undefined?409:403);}
 /** Revision-checked update of the current request; returns the new record or null if it changed. */
 async update(id,revision,mutate){
  return this.metadata.transaction(async tx=>{const current=await tx.get(REQUEST_KEY);if(current?.id!==id||current.revision!==revision)return null;const next=mutate(structuredClone(current));if(!next)return null;next.revision=current.revision+1;await tx.put(REQUEST_KEY,next);return next;});
 }
 /** Id-checked update of the current request that tolerates concurrent revisions; `mutate` re-checks state. */
 async patch(id,mutate){
  return this.metadata.transaction(async tx=>{const current=await tx.get(REQUEST_KEY);if(current?.id!==id)return null;const next=mutate(structuredClone(current));if(!next)return null;next.revision=current.revision+1;await tx.put(REQUEST_KEY,next);return next;});
 }
 serial(work){const run=this.#tail.then(work,work);this.#tail=run.catch(()=>{});return run;}

 // ---- owner and admin requests ----

 /** Owner request (§2.1). `actor`: {kind:'owner', owner, stepUpAt, sessionId?}, built by the trusted adapter from
  * `IdentityService.privileged(context, 300000)`. `input`: {confirmHandle, acknowledgements, operationId}. */
 async request(actor,input){
  if(actor?.kind!=='owner'||!isUUID(actor.owner))fail('unauthorized','Sign in to continue.',401);
  const owner=actor.owner,v=exact(input,['confirmHandle','acknowledgements','operationId']);
  if(!deletionEnabled(this.flags,owner))notFound();
  if(typeof v.operationId!=='string'||!OPERATION_ID.test(v.operationId))fail('invalid_request','A fresh operation ID is required.',400);
  await this.bound(owner);
  const acknowledgements=exact(v.acknowledgements,['messages','storage','names','plan']);
  const fingerprint=await sha256(canonical({owner,confirmHandle:v.confirmHandle??null,acknowledgements}));
  const replay=await this.replayed(v.operationId,fingerprint);if(replay)return replay;
  const now=this.now();
  // A fresh step-up proves possession of a credential now; a recent sign-in alone is not enough.
  if(!Number.isSafeInteger(actor.stepUpAt)||actor.stepUpAt>now||now-actor.stepUpAt>=STEP_UP_WINDOW_MS)fail('step_up_required','Confirm your password or passkey to continue.',401);
  const identityPort=this.port('identity'),identity=await identityPort.get(owner);
  if(!identity)fail('account_unavailable','Account unavailable.',409);
  if(identity.status==='recovering')fail('recovery_pending','Finish account recovery first.',409);
  if(identity.status==='suspended')fail('account_suspended','This account is suspended. Contact support to close it.',423);
  if(identity.status==='deleted')fail('account_deleted','This account was deleted.',410);
  if(identity.status!=='active')fail('account_unavailable','Account unavailable.',409);
  if(typeof v.confirmHandle!=='string'||typeof identity.handle!=='string'||!(v.confirmHandle===identity.handle||v.confirmHandle===`@${identity.handle}`))fail('confirmation_mismatch','Type your full account name to confirm.',400);
  const billing=this.port('billing');
  let paid=true;if(billing===null)paid=false;else if(typeof billing.paid==='function'){try{paid=await billing.paid(owner)!==false;}catch{paid=true;}}
  if(acknowledgements.messages!==true||acknowledgements.storage!==true||acknowledgements.names!==true||paid&&acknowledgements.plan!==true)fail('acknowledgement_required','Confirm each statement before deleting your account.',400);
  // A takeover of an administrator must not silently remove the operator's own access path (R1-L9).
  if(identity.systemIdentity)fail('admin_role_held','Internal accounts cannot be deleted here.',409);
  let admin;try{admin=await this.port('adminAuthority')(owner);}catch(error){if(error instanceof AppFault)throw error;unavailable();}
  if(admin?.admin!==false)fail('admin_role_held','Remove the administrator role before deleting this account.',409);
  let security;try{security=validSecurity(await this.port('security')(owner));}catch(error){if(error instanceof AppFault)throw error;unavailable();}
  const {graceDays,executeAfter}=deletionGrace({now,security,basis:'owner'});
  return this.schedule(owner,{basis:'owner',operationId:v.operationId,fingerprint,now,graceDays,executeAfter,security,identity,actor:{kind:'owner',...typeof actor.sessionId==='string'?{sessionId:actor.sessionId}:{}},billing});
 }

 /** Admin bases (§2.6, §4.2). System actor {kind:'system', owner, reason}; DX-7's AdminService has verified the
  * administrator, step-up, typed handle, rate window and, for admin-email, the link confirmation.
  * `input`: {basis, operationId, adminAuditSeq, exportUntil?}. */
 async scheduleAdmin(actor,input){
  if(actor?.kind!=='system'||!isUUID(actor.owner))fail('forbidden','Admin deletion requires a system actor.',403);
  const owner=actor.owner,v=exact(input,['basis','operationId','adminAuditSeq','exportUntil','confirmed']);
  if(!['admin-email','admin-underage','admin-closure'].includes(v.basis))fail('invalid_request','Unsupported deletion basis.',400);
  if(!deletionGlobal(this.flags))notFound();
  if(typeof v.operationId!=='string'||!OPERATION_ID.test(v.operationId)||!Number.isSafeInteger(v.adminAuditSeq)||v.adminAuditSeq<0)fail('invalid_request','Operation ID and audit sequence are required.',400);
  await this.bound(owner);
  const fingerprint=await sha256(canonical({owner,basis:v.basis,adminAuditSeq:v.adminAuditSeq,exportUntil:v.exportUntil??null}));
  const replay=await this.replayed(v.operationId,fingerprint);if(replay)return replay;
  const now=this.now(),identity=await this.port('identity').get(owner);
  if(!identity||identity.status==='deleted')fail('account_unavailable','Account unavailable.',409);
  if(identity.status==='recovering')fail('recovery_pending','Account recovery is in progress.',409);
  if(v.basis==='admin-email'){
   if(identity.status!=='active')fail('account_unavailable','Account unavailable.',409);
   if(!identity.verifiedEmail)fail('no_verified_email','The account has no verified email.',409);
   // An owner who turned email sign-in off said the mailbox alone is not authority (R1-M3).
   if(identity.emailLoginEnabled!==true)fail('email_login_disabled','Email sign-in is disabled; use account recovery.',409);
   // The emailed confirmation is authority only over the address and security epoch it was issued for (DX-7):
   // scheduling commits only if both are still current, checked before and again right after the commit.
   const c=exact(v.confirmed,['securityEpoch','emailVerifiedAt','verifiedEmail']);
   if(!Number.isSafeInteger(c.securityEpoch)||typeof c.verifiedEmail!=='string'||!(c.emailVerifiedAt===null||Number.isSafeInteger(c.emailVerifiedAt)))fail('invalid_request','The confirmation evidence is required.',400);
  }
  if(v.exportUntil!==undefined&&v.exportUntil!==null&&(v.basis!=='admin-closure'||!Number.isSafeInteger(v.exportUntil)||v.exportUntil<=now||v.exportUntil>now+366*DAY))fail('invalid_request','Invalid export window.',400);
  let security;try{security=validSecurity(await this.port('security')(owner));}catch(error){if(error instanceof AppFault)throw error;unavailable();}
  const confirmedCurrent=async(current,currentSecurity)=>current?.status==='active'&&current.emailLoginEnabled===true&&current.verifiedEmail===v.confirmed.verifiedEmail&&(current.emailVerifiedAt??null)===v.confirmed.emailVerifiedAt&&currentSecurity?.epoch===v.confirmed.securityEpoch;
  if(v.basis==='admin-email'&&!await confirmedCurrent(identity,security))fail('confirmation_stale','The account email or security settings changed after this confirmation was sent.',409);
  const {graceDays,executeAfter}=deletionGrace({now,security,basis:v.basis,exportUntil:v.exportUntil??undefined});
  const verify=v.basis!=='admin-email'?undefined:async()=>{try{return await confirmedCurrent(await this.port('identity').get(owner),validSecurity(await this.port('security')(owner)));}catch{return false;}};
  return this.schedule(owner,{basis:v.basis,operationId:v.operationId,fingerprint,now,graceDays,executeAfter,security,identity,actor:{kind:'admin',adminAuditSeq:v.adminAuditSeq},billing:this.port('billing'),exportUntil:v.basis==='admin-closure'?v.exportUntil??null:undefined,verify});
 }

 /** An operation ID replays its request: the current view while that request is current, else the stored result. */
 async replayed(operationId,fingerprint){
  const receipt=await this.metadata.get(RECEIPT_PREFIX+operationId);if(!receipt)return null;
  if(receipt.fingerprint!==fingerprint)fail('operation_conflict','This operation ID was already used for a different request.',409);
  const current=await this.metadata.get(REQUEST_KEY);
  return current?.operationId===operationId?deletionView(current,{fenced:await this.metadata.get(FENCE_KEY)!==undefined}):receipt.result;
 }
 async schedule(owner,{basis,operationId,fingerprint,now,graceDays,executeAfter,security,identity,actor,billing,exportUntil,verify}){
  const id=this.random.uuid();
  const record=await this.metadata.transaction(async tx=>{
   const replay=await tx.get(RECEIPT_PREFIX+operationId);if(replay){if(replay.fingerprint!==fingerprint)fail('operation_conflict','This operation ID was already used for a different request.',409);return {replay:replay.result};}
   if(await tx.get(TOMBSTONE_KEY)!==undefined)fail('account_deleted','This account was deleted.',410);
   if(await tx.get(FENCE_KEY)!==undefined||await tx.get(PURGE_KEY)!==undefined)fail('account_deleting','Account deletion has begun.',410);
   const existing=await tx.get(REQUEST_KEY);if(['scheduled','executing'].includes(existing?.state))fail('deletion_scheduled','Deletion is already scheduled.',409);
   const transfer=await tx.get(TRANSFER_KEY);if(transfer?.state==='committed')fail('account_unavailable','Account unavailable.',409);
   // Admin bases are verified and rate-limited by AdminService; an owner loop must not be able to block them.
   if(basis==='owner'){const log=(await tx.get(REQUEST_LOG_KEY)??[]).filter(at=>Number.isSafeInteger(at)&&at>now-REQUEST_WINDOW_MS&&at<=now);
    if(log.length>=REQUEST_BUDGET)fail('deletion_rate_limited','Too many deletion requests. Try again tomorrow.',429);
    await tx.put(REQUEST_LOG_KEY,[...log,now]);}
   // Receipts expire and are capped; the newest (including this one) are kept for replay.
   const receipts=[...await tx.list({prefix:RECEIPT_PREFIX,limit:64})].map(([path,value])=>({path,at:Number.isSafeInteger(value?.at)?value.at:0})).sort((a,b)=>b.at-a.at);
   for(const [i,row]of receipts.entries())if(i>=RECEIPT_CAP-1||row.at<=now-RECEIPT_TTL_MS)await tx.delete(row.path);
   if(TRANSFER_PENDING.has(transfer?.state))await tx.put(TRANSFER_KEY,{...transfer,state:'cancelled',reason:'deletion',endedAt:now,tokens:[],hold:null,channels:null,notices:{},revision:transfer.revision+1});
   const request={v:1,id,owner,basis,operationId,fingerprint,requestedAt:now,executeAfter,graceDays,actor,handle:identity.handle??null,...exportUntil!==undefined?{exportUntil}:{},
    channels:await channelSnapshot(tx,owner,identity),cancelTokenHashes:[],securityEpoch:security.epoch,securityChangedAt:security.changedAt,
    billing:billing===null?{none:true}:{pending:true,retryAt:now},notices:{},noticeAccepted:false,dueIndexed:null,state:'scheduled',hold:null,revision:1};
   await tx.put(REQUEST_KEY,request);await tx.put(RECEIPT_PREFIX+operationId,{fingerprint,result:deletionView(request),at:now});
   return {request};
  });
  if(record.replay)return (await this.replayed(operationId,fingerprint))??record.replay;
  let request=record.request;
  // Post-commit re-check (DX-7 race): an identity change that committed before this read voids the request and
  // its receipt; one that commits after it is a change during grace, which moves the deadline (R1-M2).
  if(verify&&!await verify(request)){
   await this.metadata.transaction(async tx=>{const live=await tx.get(REQUEST_KEY);if(live?.id===request.id&&live.state==='scheduled')await tx.put(REQUEST_KEY,{...live,state:'cancelled',cancelledAt:this.now(),cancelledBy:'confirmation-stale',channels:null,cancelTokenHashes:[],revision:live.revision+1});await tx.delete(RECEIPT_PREFIX+operationId);});
   fail('confirmation_stale','The account email or security settings changed after this confirmation was sent.',409);
  }
  this.log({action:'deletion-requested',owner,basis,graceDays});
  // Wargame 4 L2: anchor the committed request (due row and a backstop alarm) before any external call, so a crash
  // or a hung provider call cannot strand it.
  request=await this.ensureIndexed(request)??request;
  await this.arm(this.now()+5*MINUTE);
  // Cancel-at-period-end is attempted synchronously; a Polar failure keeps billing.pending and step retries hourly.
  if(billing!==null)request=await this.retryBilling(request)??request;
  request=await this.ensureIndexed(request)??request;
  request=await this.sendDueNotices(request)??request;
  await this.arm(this.nextWake(request));
  return deletionView(request);
 }

 async status(actor){
  if(!['owner','system'].includes(actor?.kind)||!isUUID(actor.owner))fail('unauthorized','Sign in to continue.',401);
  await this.bound(actor.owner);
  if(await this.metadata.get(TOMBSTONE_KEY)!==undefined)return {state:'deleted'};
  return deletionView(await this.metadata.get(REQUEST_KEY),{fenced:await this.metadata.get(FENCE_KEY)!==undefined});
 }

 /** Owner cancel (any session, no step-up) or system cancel (admin reverses a closure). One account transaction
  * decides against the deadline commit (§2.2): if commit won, this answers deletion_in_progress (410). */
 async cancel(actor){
  if(!['owner','system'].includes(actor?.kind)||!isUUID(actor.owner))fail('unauthorized','Sign in to continue.',401);
  const owner=actor.owner;if(!deletionBackground(this.flags,owner))unavailable();
  await this.bound(owner);
  return this.cancelWith(owner,request=>actor.kind==='system'||CANCELLABLE.has(request.basis),actor.kind==='system'?'admin':'owner');
 }
 /** Cancel-only link (§2.1): a 256-bit token from any notice, valid while the request is scheduled. It grants
  * nothing else and every failure looks the same. */
 async cancelToken(actor,input){
  if(actor?.kind!=='cancel-link'||!isUUID(actor.owner))fail('invalid_token','This link is no longer valid.',400);
  const owner=actor.owner,v=exact(input,['token']);
  if(!deletionBackground(this.flags,owner))unavailable();
  if(typeof v.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(v.token)||await this.metadata.get('owner')!==owner)fail('invalid_token','This link is no longer valid.',400);
  const hash=await sha256(`deletion-cancel\0${v.token}`);
  try{return await this.cancelWith(owner,request=>CANCELLABLE.has(request.basis)&&request.cancelTokenHashes.some(value=>sameText(value,hash)),'link',{idempotent:false});}
  catch(error){if(['deletion_not_cancellable','not_found','deletion_in_progress'].includes(error?.code))fail('invalid_token','This link is no longer valid.',400);throw error;}
 }
 async cancelWith(owner,allowed,by,{idempotent=true}={}){
  const now=this.now();
  const outcome=await this.metadata.transaction(async tx=>{
   const request=await tx.get(REQUEST_KEY);
   if(!request||request.owner!==owner)notFound();
   if(request.state==='cancelled'){if(!idempotent)notFound();return {request,already:true};}
   if(request.state!=='scheduled'||await tx.get(FENCE_KEY)!==undefined||await tx.get(PURGE_KEY)!==undefined)fail('deletion_in_progress','Account deletion has begun and can no longer be cancelled.',410);
   if(!allowed(request))fail('deletion_not_cancellable','This deletion cannot be cancelled here.',403);
   const next={...request,state:'cancelled',cancelledAt:now,cancelledBy:by,cancelTokenHashes:[],channels:null,hold:null,revision:request.revision+1,billing:{...request.billing,...request.billing?.none?{}:{uncancelPending:true}}};
   await tx.put(REQUEST_KEY,next);return {request:next};
  });
  let request=outcome.request;
  if(!outcome.already)this.log({action:'deletion-cancelled',owner,by});
  request=await this.afterCancel(request)??request;
  return {...deletionView(request),billing:{restored:request.billing?.restored?.length??0,unrestored:request.billing?.unrestored??[],pending:request.billing?.uncancelPending===true}};
 }
 /** Undo only what this request set (DX-4 matches canceled_at), then drop the due-index row. Retried by step. */
 async afterCancel(request){
  let current=await this.metadata.get(REQUEST_KEY);if(current?.id!==request.id||current.state!=='cancelled')return request;
  const billing=this.ports.billing,now=this.now();
  if(current.billing?.uncancelPending&&billing===null)current=await this.patch(current.id,r=>{r.billing={...r.billing,uncancelPending:false};return r;})??current;
  if(current.billing?.uncancelPending&&billing&&typeof billing.uncancel==='function'&&(current.billing.uncancelRetryAt??0)<=now){
   // One caller at a time (a cancel racing a tick): claim the undo, which expires if this process dies.
   const claimed=await this.patch(current.id,r=>{if(!r.billing?.uncancelPending||(r.billing.claimedUntil??0)>now)return null;r.billing={...r.billing,claimedUntil:now+5*MINUTE};return r;});
   if(claimed){
    current=claimed;
    try{const result=await billing.uncancel(current.owner,Array.isArray(current.billing.set)?current.billing.set:[]);current=await this.patch(current.id,r=>{r.billing={...r.billing,uncancelPending:false,claimedUntil:null,restored:result?.restored??[],unrestored:result?.unrestored??[]};return r;})??current;}
    catch{current=await this.patch(current.id,r=>{r.billing={...r.billing,claimedUntil:null,uncancelRetryAt:this.now()+HOUR};return r;})??current;}
   }
  }
  if(current.dueIndexed!==null&&current.dueIndexed!==undefined){
   const due=this.ports.due,at=current.dueIndexed;try{if(due)await due.delete(current.owner,at);current=await this.patch(current.id,r=>{if(r.dueIndexed===at)r.dueIndexed=null;return r;})??current;}catch{/* Retried by step; a stale row only causes a no-op tick. */}
  }
  return current;
 }

 // ---- background ----

 /** `deletion.step` / `deletionTick` (§2.2, §2.3): one bounded step. Returns {action, busy?, wakeAt?}. */
 step(actor){
  if(actor?.kind!=='system'||!isUUID(actor.owner))fail('forbidden','Deletion steps require a system actor.',403);
  return this.serial(()=>this.stepOnce(actor.owner));
 }
 async stepOnce(owner){
  const now=this.now();
  const request=await this.metadata.get(REQUEST_KEY);
  // The tombstone is written before the wipe. A crash between them leaves the purge job behind: finish the wipe.
  if(await this.metadata.get(TOMBSTONE_KEY)!==undefined&&!(request?.state==='executing'&&await this.metadata.get(PURGE_KEY)!==undefined))return {action:'deleted'};
  if(!request)return {action:'none'};
  if(request.owner!==owner||await this.metadata.get('owner')!==owner){this.log({action:'deletion-hold',owner,reason:'owner-mismatch'});return {action:'hold',reason:'owner-mismatch',wakeAt:now+DAY};}
  // An env kill halts between stages and keeps data; a committed request stays fenced (§8.1, R1-L11).
  if(!deletionBackground(this.flags,owner))return {action:'killed',wakeAt:now+HOUR};
  if(request.state==='cancelled'){const after=await this.afterCancel(request);return {action:'cancelled',...after?.billing?.uncancelPending?{wakeAt:after.billing.uncancelRetryAt??now+HOUR}:{}};}
  if(request.state==='scheduled')return this.scheduled(request);
  if(request.state==='executing')return this.execute(request);
  return {action:'hold',reason:'unknown-state',wakeAt:now+DAY};
 }

 async retryBilling(request){
  const billing=this.ports.billing;if(!request.billing?.pending||request.state!=='scheduled')return request;
  if(!billing||typeof billing.cancelAtPeriodEnd!=='function')return request;
  let result;
  try{result=await billing.cancelAtPeriodEnd(request.owner);}
  catch{const attempts=(request.billing.attempts??0)+1;return await this.patch(request.id,r=>{if(r.state!=='scheduled'||!r.billing?.pending)return null;r.billing={...r.billing,pending:true,attempts,retryAt:this.now()+HOUR};return r;});}
  const set=Array.isArray(result?.set)?result.set:[];
  // A cancel that committed while this call was in flight must still undo what the call set.
  const next=await this.patch(request.id,r=>{
   if(r.state==='scheduled'){r.billing={set,...result?.uncertain?.length?{uncertain:result.uncertain}:{},pending:false};return r;}
   if(r.state==='cancelled'){r.billing={...r.billing,set,pending:false,uncancelPending:true,claimedUntil:null,uncancelRetryAt:null};return r;}
   return null;
  });
  if(next?.state==='cancelled')return this.afterCancel(next);
  return next;
 }
 async ensureIndexed(request){
  if(request.dueIndexed===request.executeAfter)return request;
  const due=this.ports.due;if(!due||typeof due.put!=='function')return request;
  try{await due.put(request.owner,request.executeAfter);if(Number.isSafeInteger(request.dueIndexed))await due.delete(request.owner,request.dueIndexed);}catch{return request;}
  return await this.update(request.id,request.revision,r=>{r.dueIndexed=request.executeAfter;return r;})??request;
 }
 dueNotices(request,now){
  const due=[];if(request.state!=='scheduled')return due;
  const entry=kind=>request.notices?.[kind];
  const ready=kind=>!entry(kind)?.accepted&&(entry(kind)?.nextAt??0)<=now;
  if(ready('scheduled'))due.push('scheduled');
  if(now>=request.executeAfter-3*DAY&&now<request.executeAfter&&request.graceDays>3&&ready('reminder-3d'))due.push('reminder-3d');
  if(now>=request.executeAfter-DAY&&now<request.executeAfter&&ready('reminder-1d'))due.push('reminder-1d');
  return due;
 }
 /** Sends due notices to the channel snapshot. Each notice carries a fresh cancel-only token for cancellable
  * bases; its hash is committed before delivery so the link works when it arrives. */
 async sendDueNotices(request){
  let current=request;const notices=this.ports.notices;
  if(!hasChannels(current)||!notices||typeof notices.deliver!=='function')return current;
  for(const kind of this.dueNotices(current,this.now())){
   const cancellable=CANCELLABLE.has(current.basis);let token=null;
   if(cancellable){token=base64url(this.random.bytes(32));const hash=await sha256(`deletion-cancel\0${token}`);current=await this.update(current.id,current.revision,r=>{if(r.state!=='scheduled')return null;r.cancelTokenHashes=[...r.cancelTokenHashes,hash].slice(-MAX_TOKENS);return r;});if(!current)return null;}
   const attempts=(current.notices?.[kind]?.attempts??0)+1;let accepted=false;
   try{accepted=(await notices.deliver({owner:current.owner,kind,basis:current.basis,handle:current.handle,executeAfter:current.executeAfter,graceDays:current.graceDays,channels:current.channels,cancellable,...token?{cancelToken:token}:{},attemptId:`${current.id}:${kind}:${current.securityEpoch}:${attempts}`}))?.accepted===true;}catch{accepted=false;}
   const now=this.now();
   current=await this.update(current.id,current.revision,r=>{r.notices={...r.notices,[kind]:{attempts,accepted,at:now,...accepted?{}:{nextAt:now+Math.min(6*HOUR,15*MINUTE*2**Math.min(attempts-1,5))}}};if(accepted)r.noticeAccepted=true;return r;})??current;
   this.log({action:'deletion-notice',owner:current.owner,kind,accepted});
  }
  return current;
 }
 nextWake(request){
  const now=this.now();if(request.state!=='scheduled')return now+this.busyMs;
  const times=[request.executeAfter,request.executeAfter-3*DAY,request.executeAfter-DAY].filter(time=>time>now);
  for(const kind of NOTICE_KINDS){const at=request.notices?.[kind]?.nextAt;if(Number.isSafeInteger(at)&&!request.notices[kind].accepted)times.push(Math.max(at,now+1000));}
  if(request.billing?.pending&&Number.isSafeInteger(request.billing.retryAt))times.push(Math.max(request.billing.retryAt,now+1000));
  return Math.max(now+1000,Math.min(...times,now+DAY));
 }
 async hold(request,reason){
  const now=this.now();const prior=request.hold?.reason===reason?request.hold:null,attempts=(prior?.attempts??0)+1,since=prior?.since??now;
  const next=await this.update(request.id,request.revision,r=>{r.hold={reason,since,attempts,at:now};return r;})??request;
  const wakeAt=now+Math.min(DAY,HOUR*2**Math.min(attempts-1,5));
  this.log({action:'deletion-hold',owner:request.owner,reason,attempts,state:request.state});
  if(now-since>=HOLD_ALERT_MS)this.log({action:'operator-alert',owner:request.owner,reason,since});
  await this.arm(wakeAt);
  return {action:'hold',reason,wakeAt,request:next.state};
 }

 async scheduled(request){
  const owner=request.owner;let current=request;
  if(current.billing?.pending&&(current.billing.retryAt??0)<=this.now())current=await this.retryBilling(current)??current;
  current=await this.ensureIndexed(current)??current;
  // A security-sensitive change during grace moves the deadline to at least 14 days after it and requires a new
  // accepted notice (R1-M2). Without the security state, never commit.
  let security;try{security=validSecurity(await this.port('security')(owner));}catch{return this.hold(current,'security-unavailable');}
  if(security.epoch!==current.securityEpoch){
   const changedAt=Number.isSafeInteger(security.changedAt)?security.changedAt:this.now();
   current=await this.update(current.id,current.revision,r=>{if(r.state!=='scheduled')return null;const executeAfter=Math.max(r.executeAfter,changedAt+GRACE_DAYS*DAY);
    Object.assign(r,{securityEpoch:security.epoch,securityChangedAt:changedAt,executeAfter,graceDays:Math.ceil((executeAfter-r.requestedAt)/DAY),notices:{},noticeAccepted:false,extendedAt:changedAt});return r;})??current;
   this.log({action:'deletion-extended',owner,executeAfter:current.executeAfter});
   current=await this.ensureIndexed(current)??current;
  }
  current=await this.sendDueNotices(current)??current;
  const now=this.now();
  if(current.state!=='scheduled')return {action:current.state};
  if(now<current.executeAfter){const wakeAt=this.nextWake(current);await this.arm(wakeAt);return {action:'wait',wakeAt};}
  // Commit preconditions, read outside the transaction; the transaction re-checks the request itself.
  // An inactivity purge already owns `lifecycle/purge-v1` (the lifecycle should hold while a request exists).
  if(await this.metadata.get(PURGE_KEY)!==undefined)return this.hold(current,'inactivity-purge-running');
  if(hasChannels(current)&&!current.noticeAccepted)return this.hold(current,typeof this.ports.notices?.deliver==='function'?'notice-unaccepted':'notice-unconfigured');
  let held;try{held=(await this.port('hold')(owner))?.held!==false;}catch{held=true;}
  if(held)return this.hold(current,'admin-hold');
  const committed=await this.metadata.transaction(async tx=>{
   const live=await tx.get(REQUEST_KEY);
   if(live?.id!==current.id||live.state!=='scheduled'||now<live.executeAfter||live.revision!==current.revision)return null;
   if(await tx.get(PURGE_KEY)!==undefined)return null;
   const next={...live,state:'executing',executingAt:now,hold:null,cancelTokenHashes:[],revision:live.revision+1};
   await tx.put(REQUEST_KEY,next);await tx.put(FENCE_KEY,{v:1,owner,requestId:live.id,at:now});return next;
  });
  if(!committed){const wakeAt=now+this.busyMs;await this.arm(wakeAt);return {action:'retry',wakeAt};}
  this.log({action:'deletion-committed',owner,basis:committed.basis});
  const notices=this.ports.notices;
  if(hasChannels(committed)&&typeof notices?.deliver==='function'){try{await notices.deliver({owner,kind:'executing',basis:committed.basis,handle:committed.handle,executeAfter:committed.executeAfter,graceDays:committed.graceDays,channels:committed.channels,cancellable:false,attemptId:`${committed.id}:executing`});}catch{/* Informational; the commit already required an accepted notice. */}}
  await this.arm(now+this.busyMs);
  return {action:'committed',busy:true,wakeAt:now+this.busyMs};
 }

 /** Deletion-only stage hooks plus the common erasure hooks. */
 stages(request){
  const ports=this.ports,billing=ports.billing,clock=()=>this.now(),log=this.log;
  const common=erasureStages(this.executor,{ports,clock,log});
  const owner=request.owner,completedNotice=async(_owner,{state})=>{
   const notices=ports.notices;if(!request.channels?.email)return {done:true,sent:false,reason:'no-email'};
   if(typeof notices?.deliver!=='function')return {done:true,sent:false,reason:'notice-unconfigured'};
   state.firstAt??=clock();state.attempts=(state.attempts??0)+1;
   let accepted=false;try{accepted=(await notices.deliver({owner,kind:'completed',basis:request.basis,handle:request.handle,executeAfter:request.executeAfter,graceDays:request.graceDays,channels:{email:request.channels.email,emailVerifiedAt:request.channels.emailVerifiedAt,push:[]},cancellable:false,attemptId:`${request.id}:completed:${state.attempts}`}))?.accepted===true;}catch{accepted=false;}
   if(accepted)return {done:true,sent:true};
   // Last point at which the address exists; after a day of failures the wipe proceeds and the drop is logged.
   if(clock()-state.firstAt>=NOTICE_GIVE_UP_MS){log({action:'deletion-notice-dropped',owner,kind:'completed'});return {done:true,sent:false,reason:'undelivered'};}
   return {done:false,retryAt:clock()+Math.min(6*HOUR,15*MINUTE*2**Math.min(state.attempts-1,5))};
  };
  const billingStage=method=>async()=>{
   if(billing===null)return {done:true,billing:'absent'};
   if(typeof billing?.[method]!=='function')return {held:true,reason:'billing-unconfigured'};
   try{return {done:true,evidence:await billing[method](owner)};}
   catch(error){return {held:true,reason:`billing-${typeof error?.code==='string'?error.code:'unavailable'}`};}
  };
  return {...common,billingStop:billingStage('revokeAll'),billingAnonymize:billingStage('anonymize'),notice:completedNotice};
 }
 async execute(request){
  const owner=request.owner,ports=this.ports;let lastHold=null;
  const fence=async()=>{
   const live=await this.metadata.get(REQUEST_KEY);
   if(live?.id!==request.id||live.state!=='executing'||live.owner!==owner){lastHold='request-changed';return false;}
   const marker=await this.metadata.get(FENCE_KEY);if(marker?.owner!==owner||marker.requestId!==request.id){lastHold='fence-missing';return false;}
   if(await this.metadata.get('owner')!==owner){lastHold='owner-mismatch';return false;}
   // A legal hold freezes deletion but does not cancel it; an unreadable hold counts as held.
   try{if((await ports.hold(owner))?.held!==false){lastHold='admin-hold';return false;}}catch{lastHold='admin-hold-unavailable';return false;}
   if(!deletionBackground(this.flags,owner)){lastHold='killed';return false;}
   return true;
  };
  if(typeof ports.hold!=='function'||!ports.identity)return this.hold(request,'deletion-unconfigured');
  const beforeWipe=async()=>{
   const due=ports.due;if(!Number.isSafeInteger(request.dueIndexed))return;
   if(!due||typeof due.delete!=='function')return {held:true,reason:'due-index-unconfigured'};
   try{await due.delete(owner,request.dueIndexed);}catch{return {held:true,reason:'due-index-unavailable'};}
  };
  let batch;
  try{batch=await purgeBatch(this.executor,owner,{identity:ports.identity,fence,budget:this.budget,log:event=>this.log({owner,...event}),reason:request.basis==='owner'?'owner':'admin',basis:request.basis,requestedAt:request.requestedAt,stages:this.stages(request),beforeWipe,clock:()=>this.now()});}
  catch(error){return this.hold(await this.metadata.get(REQUEST_KEY)??request,typeof error?.code==='string'?error.code:'unavailable');}
  if(batch.done){this.log({action:'deletion-completed',owner,basis:request.basis});return {action:'deleted'};}
  const live=await this.metadata.get(REQUEST_KEY)??request;
  if(batch.halted)return this.hold(live,batch.hold??lastHold??'fence');
  if(live.hold)await this.update(live.id,live.revision,r=>{r.hold=null;return r;});
  const wakeAt=Number.isSafeInteger(batch.wakeAt)?batch.wakeAt:this.now()+this.busyMs;
  await this.arm(wakeAt);
  return {action:'executing',stage:batch.stage,busy:!Number.isSafeInteger(batch.wakeAt),wakeAt};
 }
}
