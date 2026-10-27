// Organization billing standing, the billing-lapse claim and ownership transfer (docs/architecture/organizations-design.md
// ORG-D18, ORG-D21, §1d, §12a, §12b.1, §12b.2a item 9, §12b.3, §12b.3a, §12b.5). Engine-first: every rule here runs in
// the organization's account single writer and commits through one record transaction; provider I/O (Polar, identity,
// peer accounts) is done through ports OUTSIDE transactions, and every external effect leaves through a durable,
// idempotent outbox (`ownershipOutbox`, one row per effect), so a crash or a replayed webhook can never apply a rule twice.
//
// What the user decided (2026-10-21/22): organizations are always paid; ownership can be transferred; the recipient sets
// up billing first; billing starts a fresh period; the previous owner's payment confers nothing. Everything else here
// is *Provisional (coordinator), not signed off by the user* (§1d), and the figures in OWNERSHIP are revisable.
//
// Record fields (all lazily created on the organization record):
//   billing   {v, subscriptions:{[id]: verified snapshot + paidThrough (+ hold:{reason, since} while Polar cannot confirm
//              it)}, handled:{[id]: role}, unpaidSince, reconciledAt,
//              claim:null|{id, by, plan, state:'awaiting-payment'|'pending'|'effective'|'closed', ...}, renewal}
//   transfer  null|{id, state, from, to, toHandle, admin, plan, offeredAt, notBefore, expiresAt, blockableUntil,
//              objections, acceptance, payment, closedAt, closedReason, effectiveAt}
//   transferHistory  the last 16 closed transfers
//   ownershipEffects {v, pending, done, subs}: the summary of the ownership outbox, whose effects are rows
//              (org/effect/<id>, {id, kind:'revoke'|'refund'|'recovery-rotate'|'index'|..., doneAt, attempts}; see
//              packages/orgs/ownership-effects.mjs, 2026-10-24; the pre-release in-record `ownershipOutbox` array migrates once)
//   recovery  null|{state:'rotation-pending'|'missing'|'issued', owner, since, cause} (§12d.9; null: the creation file)
//   authorityEpoch  the organization's `aep` (spec §3 rev 4.4): raised only by a change of control without the file
//   moveCoolingUntil  ms (portability §6.2; moves stay refused by the portability guards regardless)
//
// Ports (constructor options, besides MembershipService's):
//   billing   {configured(), state(org,{known}), checkout(org,{...}), revoke(org,id), refund(org,{...}), plans(currency)}
//             (packages/billing/organizations.mjs OrganizationBilling; SANDBOX ONLY)
//   accounts  {get(sub) -> {status, handle, kind}|null}  this provider's identity records (recipient checks)
//   effects   {rotateRecovery(org) -> {rotated:true}, index(person, {org, role, handle}) -> true}
//   alert     (entry) -> void   operator alert sink (a held subscription needs reconciliation); best effort, never blocks
//   plans     the paid-check port; `check({creator, org, override:true})` answers the operator allowlist override.
//
// Extension hooks (no-ops here; packages/orgs/break-glass.mjs overrides them, ORG-12a): ownershipBusy, ownerAction,
// stepContext, advanceExtra, settleExtra, drainExtra. Every owner change goes through changeOwner (the shared guarded
// commit).
import {MembershipService,membershipState,ORG_ADMIN_DELAY_MS} from './memberships.mjs';
import {ORG_RECORD,ORG_OWNED,ORG_JOINED,ORG_CREATION,ORG_DELETION_DELAY_MS} from './organizations.mjs';
import {organizationPowers,requireFresh} from './authority.mjs';
import {principalKey,samePrincipal} from '../core/principals.mjs';
import {normalizeMemberGrants} from './grants.mjs';
import {rosterOf} from './roster.mjs';
import {enqueueMemberKeyRefresh} from './key-refresh.mjs';
import {queueEffect,loadEffect,pendingEffects,subscriptionEffectPending,flushEffects,dueEffects,firstDueAt} from './ownership-effects.mjs';
import {AppFault} from '../app/faults.mjs';

const DAY=86400000,MINUTE=60000;
/** Provisional figures (coordinator, 2026-10-23; §1d item 10 and this workstream). Revisable; none is signed off. */
export const OWNERSHIP=Object.freeze({
 TRANSFER_MIN_DELAY_MS:DAY,        // §12b.3a: at least 24 h after the offer's notices
 OFFER_LAPSE_MS:14*DAY,            // §12b.3a: an offer not accepted within 14 days lapses
 CLAIM_NOTICE_MS:3*DAY,            // §12b.3: the 72 h break-glass notice (§1d item 1)
 GRACE_MS:14*DAY,                  // agent figure: grace after the paid-through time before read-only
 CLAIM_AFTER_READ_ONLY_MS:30*DAY,  // §12b.3: thirty days of read-only before an admin may claim
 MOVE_COOLING_MS:30*DAY,           // portability §6.2
 STEP_UP_MS:5*MINUTE,              // P18 step-up freshness
 CREDENTIAL_AGE_MS:7*DAY,          // P18: a credential enrolled more than 7 days earlier
 SECURITY_COOLING_MS:30*DAY,       // P18: no security change in the last 30 days, else the admins' block returns
 CHECKOUT_POLL_MS:15*MINUTE,       // a lost webhook is caught by polling while a checkout is open
 CLAIM_CHECKOUT_MS:DAY,            // an unpaid claim checkout may be replaced by another admin after a day
 FRESH_MS:5*MINUTE,                // a transfer or claim takes effect only on a provider snapshot at most this old
 PAYMENT_SETTLE_MS:2*DAY,          // an owner payment begun before a claim's deadline holds the claim this long to settle
 RETRY_MS:MINUTE,
 CLAIM_CHECKOUTS_PER_DAY:4,        // F-05: new claim checkouts per organization per 24 h (an open one is reused)
 BILLING_RETENTION_MS:30*DAY,      // F-05: an ended, settled subscription is forgotten this long after it ended
 CLAIM_ESCALATION_RETRY_MS:3600000,// F-03: an escalated claim re-checks the owner's hold hourly
 CLAIM_ESCALATION_MS:30*DAY,       // follow-up 6: an escalated claim nobody resolves closes, refunded in full
 DRAIN_LEASE_MS:10*MINUTE,         // re-review: one ownership drain at a time (the provider takes no idempotency key)
 OPERATOR_APPROVAL_MS:3*DAY,       // §12d.8: a second operator approves a proposal within 72 h, or it lapses
 OUTBOX_PENDING_MAX:256,OUTBOX_DONE_KEPT:128,REISSUES_KEPT:8, // review H1: only pending effects count; critical ones always queue
 OPERATOR_ASSERTION_MS:5*MINUTE    // review M3: an operator assertion is fresh for this long
});
const PLANS=['org-team','org-business','org-scale'],OWNERSHIP_DRAIN_LEASE='org/ownership-drain-lease';
const OPEN=['offered','paid'],UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,HANDLE=/^[a-z0-9][a-z0-9._-]{0,62}$/i;
const fail=(code='not_found',message='Not found.',status=409)=>{throw new AppFault(code,message,status);};
const party=p=>({iss:p?.iss??null,sub:p?.sub});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(value,names)=>{if(value===undefined)value={};if(!plain(value)||Object.keys(value).some(k=>!names.includes(k)))fail('invalid_request','Unsupported ownership request.',400);return value;};
const reasonOf=v=>{if(v===undefined||v==='')return null;if(typeof v!=='string'||[...v].length>280||/[\u0000-\u001f]/.test(v))fail('invalid_reason','Give a reason of at most 280 characters.',400);return v.trim()||null;};
const hex=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');

/** Whether a verified subscription is paid through `now` (its stored paidThrough never extends on a failed renewal). */
const paidNow=(s,now)=>Number.isSafeInteger(s?.paidThrough)&&s.paidThrough>now&&!s.refunded;
/** Whether the stored snapshot could still matter: not refunded or revoked by us, and not ended at the provider. */
const live=(r,s,now)=>!['revoke','refund'].includes(r.billing?.handled?.[s.id])&&!(Number.isSafeInteger(s.endedAt)&&s.endedAt<=now);
const ended=(s,now)=>Number.isSafeInteger(s?.endedAt)&&s.endedAt<=now;
/** Whether a revoke or refund for subscription `id` is still waiting in the ownership outbox. */
const effectPending=subscriptionEffectPending;
/** Subscriptions Polar could not confirm at the last reconcile (gone or failing verification): held for an operator.
 * A hold never counts as unpaid: it blocks the unpaid clock, claims and claim effects until reconciled. */
export const heldSubscriptions=r=>Object.values(r?.billing?.subscriptions??{}).filter(s=>s?.hold);
/** The owner of record's own paid subscription (§12b.1 item 1), the latest-paid if several. */
export function ownerSubscription(r,now){
 const owner=r?.ownerOfRecord?.sub;let best=null;
 for(const s of Object.values(r?.billing?.subscriptions??{}))if(s.owner===owner&&paidNow(s,now)&&!['revoke','refund'].includes(r.billing.handled?.[s.id])&&(!best||s.paidThrough>best.paidThrough))best=s;
 return best;
}
/**
 * The organization's billing standing (§12a, §12b.3). Pure.
 *   paid       the operator override (allowlist), or the owner of record's paid subscription
 *   pending    never observed yet (organization billing configured but not reconciled); never read-only
 *   grace      unpaid for less than GRACE_MS
 *   read-only  unpaid for GRACE_MS or longer; leaving, removals, decisions and export stay open (§12a)
 * `claimableAt`: from then on an admin may start a lapse claim (§12b.3).
 */
export function billingStanding(r,now,{override=false,configured=false}={}){
 const s=ownerSubscription(r,now),b=r?.billing,plan=s?.plan??(PLANS.includes(r?.plan?.plan)?r.plan.plan:null);
 const base={plan,paidUntil:s?.paidThrough??null,pastDue:s?.status==='past_due',source:override?'override':s?'polar':null,unpaidSince:null,readOnlyAt:null,claimableAt:null,held:heldSubscriptions(r).length>0};
 if(override||s)return {standing:'paid',...base};
 const t=r?.transfer,tp=t?.state==='paid'?r.billing?.subscriptions?.[t.payment?.subscriptionId]:null;
 if(tp&&paidNow(tp,now))return {standing:'paid',...base,plan:tp.plan,paidUntil:tp.paidThrough,source:'transfer'};
 if(!Number.isSafeInteger(b?.unpaidSince))return {standing:configured&&!Number.isSafeInteger(b?.reconciledAt)||!configured&&b?.observedAt===undefined?'pending':'grace',...base};
 const readOnlyAt=b.unpaidSince+OWNERSHIP.GRACE_MS,claimableAt=readOnlyAt+OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS;
 return {standing:now>=readOnlyAt?'read-only':'grace',...base,unpaidSince:b.unpaidSince,readOnlyAt,claimableAt};
}
/** The digest the recipient echoes to prove they saw the current disclosure (plan, price, fresh period, §12b.3a). */
export async function transferDisclosureDigest(r,t,{plan,currency,amount}){return hex(JSON.stringify(['bindle-org-transfer-disclosure-v1',r.id,t.id,party(t.from),party(t.to),t.admin===true,plan,currency,amount,'fresh-period','previous-payment-confers-nothing']));}

export class OwnershipService extends MembershipService{
 constructor(options){super(options);this.billing=options.billing??null;this.accounts=options.accounts??null;this.effects=options.effects??null;this.alert=typeof options.alert==='function'?options.alert:null;this.operators=options.operators??null;}
 billingConfigured(){try{return this.billing?.configured?.()===true;}catch{return false;}}
 /** The operator override (ORGANIZATIONS_PAID_ALLOWLIST): the organization or its owner of record is listed. */
 async override(r){
  if(typeof this.plans?.check!=='function'||r?.kind!=='organization')return false;
  try{const result=await this.plans.check({creator:party(r.ownerOfRecord),org:r.id,override:true,now:this.clock.now()});return result?.paid===true&&result.source!=='polar';}catch{return false;}
 }
 async standingOf(r){return billingStanding(r,this.clock.now(),{override:await this.override(r),configured:this.billingConfigured()});}
 /** Read-only gate for operations that add or change authority or content. Severance, leaving, decisions and export
  * never pass through it (§12a: lapsed payment must never cut off severance, leaving or export). */
 async writable(){const r=await this.metadata.get(ORG_RECORD);if(r?.kind!=='organization')return;if((await this.standingOf(r)).standing==='read-only')fail('organization_read_only','This organization’s payment has lapsed, so it is read-only. Leaving, removing members, decisions and export stay available.',402);}
 async invite(actor,input){await this.writable();return super.invite(actor,input);}
 async policy(actor,input){await this.writable();return super.policy(actor,input);}
 async rename(actor,input){await this.writable();return super.rename(actor,input);}
 async setLabel(actor,input){await this.writable();return super.setLabel(actor,input);}
 async actingAuthority(actor,input){if(input?.widen===true)await this.writable();return super.actingAuthority(actor,input);}
 /** Grant changes that only remove or narrow stay available while read-only; anything new waits for payment. */
 async grants(actor,input){
  const m=await this.metadata.transaction(async tx=>{const r=await this.open(tx);return r?.kind==='organization'?rosterOf(r).memberById(input?.membership):undefined;});let next=null;try{next=normalizeMemberGrants(input?.grants);}catch{}
  const shape=g=>JSON.stringify(Object.fromEntries(Object.entries(g).filter(([k])=>!['grantedBy','grantedAt','notBefore'].includes(k)).sort()));
  const narrowing=m&&next&&next.every(g=>m.grants.some(old=>shape(old)===shape(g)));if(!narrowing)await this.writable();
  return super.grants(actor,input);
 }
 /** Delayed deletion closes an unpaid offer (an offer the owner could withdraw anyway); a verified, not yet effective
  * transfer refuses deletion, since withdrawing it is no longer possible (§12b.3a "until the payment is verified"). */
 async scheduleDeletion(actor,input){
  return this.mutate(actor,input,[],{powers:['owner-of-record'],fresh:true},async(record,value,now,tx)=>{
   this.ensure(record);await this.ownerAction(record,actor,now,tx,'schedule-deletion');
   if(record.transfer?.state==='paid')fail('transfer_pending','A verified ownership transfer is pending; deletion can be scheduled once it completes or fails.',409);
   if(record.transfer?.state==='offered')await this.closeTransfer(record,record.transfer,'deletion',now,tx,actor);
   record.state='deletion-scheduled';record.deletion={requestedAt:now,notBefore:now+ORG_DELETION_DELAY_MS,by:party(actor.principal)};
   await this.audit(tx,record,'organization-deletion-scheduled',actor,{notBefore:record.deletion.notBefore});
  });
 }

 // ---- transaction frame ------------------------------------------------------------------------------------
 ensure(r){membershipState(r,this.random,this.clock.now());r.billing??={v:1,subscriptions:{},handled:{},unpaidSince:null,reconciledAt:null,claim:null,renewal:null};r.billing.subscriptions??={};r.billing.handled??={};r.transfer??=null;r.transferHistory??=[];r.recovery??=null;return r;}
 /** Before every commit: this transaction's ownership effects (rows, indexes, summary), then the roster. */
 async beforeCommit(tx,r,actor){const wrote=r?.kind==='organization'?await flushEffects(tx,r,this.clock.now(),{doneKept:OWNERSHIP.OUTBOX_DONE_KEPT}):false;const flushed=await super.beforeCommit(tx,r,actor);return wrote||flushed;}
 /** One record transaction (system or adapter-verified actor). `fn(r, now, tx)` mutates; a change is written once. */
 async commit(actor,fn,{system=true}={}){
  if(system&&actor?.kind!=='system')fail('forbidden','System only.',403);
  return this.metadata.transaction(async tx=>{
   if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
   const raw=await this.open(tx,[]);if(raw?.kind!=='organization'||raw.id!==actor.owner)return null;
   const r=this.ensure(raw),before=JSON.stringify(r),now=this.clock.now(),result=await fn(r,now,tx);
   await this.finish(tx,r,before,actor,now);return structuredClone(result);
  });
 }
 /** Owner-route frame: the actor is resolved and epoch-checked by OrganizationService#organization. */
 async act(actor,input,names,fn,{exit=false,exposure=true}={}){
  const value=exact(input,names);if(exposure&&!this.enabled(actor?.owner))fail('not_found','Not found.',404);
  return this.metadata.transaction(async tx=>{
   const r=this.ensure(await this.organization(tx,actor,{write:true})),now=this.clock.now(),before=JSON.stringify(r);
   if(!exit&&r.state!=='active')fail('organization_deletion_pending','This organization is scheduled for deletion.',409);
   const powers=organizationPowers(r,actor.principal,{now}),result=await fn(r,value,now,tx,powers);
   await this.finish(tx,r,before,actor,now);return structuredClone(result);
  });
 }
 /** Queues an external effect (its own row, written with this commit; packages/orgs/ownership-effects.mjs). Only PENDING
  * rows count toward the cap (break-glass review H1); done rows are kept for 30 days, at most OUTBOX_DONE_KEPT of them
  * (pruned at the flush). Effects are `critical` by default and never refused for capacity, so a
  * full outbox can never block an abort, a refund or an owner change in a system step (review R2: a non-critical revoke
  * or index row could throw inside an effect commit and wedge every sync). Only effects a person's NEW request adds
  * (an ownership offer, an ordinary break-glass notice) pass `critical:false`; starting a new process also checks the
  * backlog first. */
 outbox(r,kind,detail,now,{critical=true}={}){
  if(!critical&&pendingEffects(r)>=OWNERSHIP.OUTBOX_PENDING_MAX)fail('ownership_outbox_full','Ownership effects need operator attention.',503);
  const {id:ignored,...rest}=detail??{},row={...structuredClone(rest),id:this.random.uuid(),kind,createdAt:now,doneAt:null,attempts:0,nextAt:now};return queueEffect(r,row);
 }
 /** Notices to every admin, plus named principals (the recipient need not be a member), via the member outbox. */
 ownershipNotice(r,type,detail,now,{principals=[],members=[]}={}){
  rosterOf(r).notice({id:this.random.uuid(),type,at:now,...principals.length?{principals:principals.map(party)}:{},...structuredClone(detail)},{admins:true,members:members.filter(Boolean)});
 }
 /** Whether `principal` may pay for the organization: the owner of record, even while their governance authority is
  * held after a security change (F-03). Paying confers no governance, and a held owner who cannot pay would lose the
  * organization to a lapse claim. */
 mayRenew(r,principal,now){
  if(organizationPowers(r,principal,{now}).includes('owner-of-record'))return true;
  const m=r.memberships?.[principalKey(principal)];return samePrincipal(principal,r.ownerOfRecord)&&m?.state==='live'&&(m.expires_at===undefined||m.expires_at>now/1000);
 }
 /** P18 tight verification (portability §6.2 items 1–3), from the session's trusted step-up evidence only. Returns
  * whether the owner had a security change in the cooling window (then the admins' block power returns). */
 tight(actor,now){
  const proof=actor?.verification;
  if(!proof||!Number.isSafeInteger(proof.stepUpAt)||proof.stepUpAt>now||proof.stepUpAt+OWNERSHIP.STEP_UP_MS<=now||!Number.isSafeInteger(proof.enrolledAt)||proof.enrolledAt<0||proof.enrolledAt>now-OWNERSHIP.CREDENTIAL_AGE_MS||!Number.isSafeInteger(proof.securityChangedAt)||proof.securityChangedAt<0||proof.securityChangedAt>now)
   fail('tight_verification_required','Confirm with a passkey or password enrolled more than 7 days ago.',401);
  return proof.securityChangedAt>now-OWNERSHIP.SECURITY_COOLING_MS?proof.securityChangedAt+OWNERSHIP.SECURITY_COOLING_MS:null;
 }
 freshStepUp(actor,now){const at=actor?.verification?.stepUpAt;if(Number.isSafeInteger(at)&&at<=now&&at+OWNERSHIP.STEP_UP_MS>now)return;requireFresh(actor,now,OWNERSHIP.STEP_UP_MS);}
 async archive(r,t){r.transferHistory=[...r.transferHistory,structuredClone(t)].slice(-16);}

 // ---- views -------------------------------------------------------------------------------------------------
 /** The ownership view, filtered by role: owner of record and admins see billing, the offer and the claim; the named
  * recipient of an open offer sees its disclosure; other live members see the standing only; others get not_found. */
 async ownership(actor,input={}){
  exact(input,['currency']);const pre=await this.metadata.get(ORG_RECORD);let pricing=null;
  if(pre&&this.billingConfigured()&&pre.transfer&&OPEN.includes(pre.transfer.state)){try{pricing=await this.billing.plans(input.currency??'usd');}catch{pricing=null;}}
  const override=pre?await this.override(pre):false;
  return this.metadata.transaction(async tx=>{
   const r=this.ensure(await this.organization(tx,actor)),now=this.clock.now(),powers=organizationPowers(r,actor.principal,{now}),member=r.memberships[principalKey(actor.principal)];
   const owner=powers.includes('owner-of-record'),admin=powers.includes('admin'),t=r.transfer,recipient=Boolean(t&&OPEN.includes(t.state)&&samePrincipal(t.to,actor.principal)),live=member?.state==='live',heldOwner=!owner&&this.mayRenew(r,actor.principal,now);
   if(!owner&&!admin&&!recipient&&!live)fail('not_found','Not found.',404);
   const standing=billingStanding(r,now,{override,configured:this.billingConfigured()}),out={organization:{id:r.id,name:r.name,handle:r.handle??null,label:r.label,state:r.state},billing:{...standing,configured:this.billingConfigured(),server:this.billingConfigured()?'sandbox':null,provisional:true}};
   if(recipient)out.offer=await this.offerView(r,t,pricing,now);
   if(!owner&&!admin&&!heldOwner)return out;
   // Review follow-up 6: a held owner sees billing and the renew decision only, never objections or who objected.
   if(heldOwner){out.decisions=this.billingConfigured()&&standing.standing!=='paid'&&!ownerSubscription(r,now)?['renew']:[];return out;}
   const held=Boolean(r.memberships[principalKey(r.ownerOfRecord)]?.hold),claim=r.billing.claim;
   out.transfer=t?{...this.transferView(t),objections:(t.objections??[]).map(o=>({by:party(o.by),at:o.at,reason:o.reason}))}:null;
   out.claim=claim?{id:claim.id,by:party(claim.by),state:claim.state,plan:claim.plan,createdAt:claim.createdAt,notBefore:claim.notBefore??null,closedReason:claim.closedReason??null}:null;
   out.recovery=r.recovery?{state:r.recovery.state,since:r.recovery.since,owner:party(r.recovery.owner)}:null;out.moveCoolingUntil=r.moveCoolingUntil??null;
   out.ownerOfRecord=party(r.ownerOfRecord);out.history=r.transferHistory.slice(-5).map(x=>this.transferView(x));
   const decisions=[],configured=this.billingConfigured(),openT=t&&OPEN.includes(t.state);
   if(owner&&configured&&!held&&!openT&&r.state==='active'&&claim?.state!=='pending')decisions.push('offer');
   if(owner&&t?.state==='offered')decisions.push('withdraw');
   if(admin&&!owner&&openT)decisions.push('object');
   if(admin&&!owner&&openT&&Number.isSafeInteger(t.blockableUntil)&&now<t.blockableUntil)decisions.push('block');
   if((owner||heldOwner)&&configured&&standing.standing!=='paid'&&!ownerSubscription(r,now))decisions.push('renew');
   if(admin&&!owner&&configured&&standing.standing==='read-only'&&now>=standing.claimableAt&&!standing.held&&claim?.state!=='pending'&&t?.state!=='paid')decisions.push('claim');
   if(owner&&r.recovery&&r.recovery.state!=='issued')decisions.push('reissue-recovery');
   out.decisions=decisions;return out;
  });
 }
 transferView(t){return {id:t.id,state:t.state,from:party(t.from),to:party(t.to),toHandle:t.toHandle,admin:t.admin===true,plan:t.plan??null,offeredAt:t.offeredAt,notBefore:t.notBefore,expiresAt:t.expiresAt,blockableUntil:t.blockableUntil??null,accepted:Boolean(t.acceptance),paid:Boolean(t.payment),closedAt:t.closedAt??null,closedReason:t.closedReason??null,effectiveAt:t.effectiveAt??null};}
 async offerView(r,t,pricing,now){
  const current=ownerSubscription(r,now)?.plan??(PLANS.includes(r.plan?.plan)?r.plan.plan:null),plans=pricing?.plans?.filter(p=>!current||p.id===current)??[];
  const disclosures=await Promise.all(plans.map(async p=>({plan:p.id,name:p.name,storageBytes:p.storageBytes,aiCreditsMonthly:p.aiCreditsMonthly,members:p.members,provisional:true,price:p.price,digest:await transferDisclosureDigest(r,t,{plan:p.id,currency:p.price.currency,amount:p.price.amount})})));
  return {...this.transferView(t),organization:{id:r.id,name:r.name,handle:r.handle??null},currentPlan:current,choosePlan:!current,plans:disclosures,server:'sandbox',
   terms:{freshPeriod:true,previousPaymentConfersNothing:true,ownerOfRecord:['billing','elevations','recovery-file'],refundIfTransferFails:'full',membershipPolicy:'§12b, §12c'},decisions:t.state==='offered'?['accept','decline']:[]};
 }

 // ---- transfer: owner, admins, recipient -------------------------------------------------------------------
 /** §12b.3a Offer. The owner of record, tight verification, one named active 3sln.me person account. */
 async transferOffer(actor,input){
  const v=exact(input,['recipient','handle','admin','confirm']);
  if(typeof v.recipient!=='string'||!UUID.test(v.recipient)||typeof v.handle!=='string'||!HANDLE.test(v.handle)||v.admin!==undefined&&typeof v.admin!=='boolean')fail('invalid_request','Name the recipient’s handle.',400);
  if(v.confirm!==true)fail('review_required','Review the recipient before offering ownership.',400);
  if(!this.enabled(actor?.owner))fail('not_found','Not found.',404);
  if(!this.billingConfigured())fail('billing_unavailable','Ownership transfer needs organization billing, which is not available on this host.',503);
  const now=this.clock.now(),blockableUntil=this.tight(actor,now);
  let account=null;try{account=await this.accounts?.get(v.recipient);}catch{account=null;}
  if(account?.kind!=='person'||account.status!=='active'||String(account.handle??'').toLowerCase()!==v.handle.toLowerCase())fail('recipient_unavailable','That account cannot receive ownership. Check the handle and try again.',409);
  return this.act(actor,{},[],async(r,_,now,tx,powers)=>{
   if(!powers.includes('owner-of-record')){if(samePrincipal(r.ownerOfRecord,actor.principal)&&r.memberships[principalKey(r.ownerOfRecord)]?.hold)fail('authority_held','Governance authority is held after a security change.',403);fail('not_found','Not found.',404);}
   const to={iss:actor.principal.iss??null,sub:v.recipient};if(samePrincipal(to,r.ownerOfRecord))fail('recipient_unavailable','You already own this organization.',409);
   if(r.transfer&&OPEN.includes(r.transfer.state))fail('transfer_pending','An ownership offer is already open.',409);
   if(r.billing.claim?.state==='pending')fail('claim_pending','A billing-lapse claim is pending.',409);
   await this.ownerAction(r,actor,now,tx,'transfer-offer');
   if(r.transfer)await this.archive(r,r.transfer);
   const t={id:this.random.uuid(),state:'offered',from:party(r.ownerOfRecord),to,toHandle:account.handle,admin:v.admin===true,plan:ownerSubscription(r,now)?.plan??null,offeredAt:now,notBefore:now+OWNERSHIP.TRANSFER_MIN_DELAY_MS,expiresAt:now+OWNERSHIP.OFFER_LAPSE_MS,blockableUntil,objections:[],acceptance:null,payment:null};
   r.transfer=t;this.ownershipNotice(r,'ownership-offered',{transfer:t.id,recipient:to,recipientHandle:t.toHandle,admin:t.admin,notBefore:t.notBefore,expiresAt:t.expiresAt,blockableUntil},now,{principals:[to]});
   this.outbox(r,'index',{person:to.sub,role:'offer',transfer:t.id},now,{critical:false});
   await this.audit(tx,r,'organization-ownership-offered',actor,{transfer:t.id,recipient:to,admin:t.admin,blockableUntil});
   return {transfer:this.transferView(t)};
  });
 }
 /** The owner withdraws an unpaid offer. A payment that still arrives is refunded in full (settle). */
 transferWithdraw(actor,input){return this.act(actor,input,['transfer','reason'],async(r,v,now,tx,powers)=>{
  const t=r.transfer;if(!powers.includes('owner-of-record')||!t||t.id!==v.transfer)fail('not_found','Not found.',404);
  if(t.state!=='offered')fail('transfer_not_withdrawable',t.state==='paid'?'The recipient’s payment is verified, so the offer can no longer be withdrawn.':'This offer is closed.',409);
  this.freshStepUp(actor,now);await this.closeTransfer(r,t,'withdrawn',now,tx,actor,reasonOf(v.reason));return {transfer:this.transferView(t)};
 },{exit:true,exposure:false});}
 /** Any admin may object: recorded, and notified to the owner and every admin again. Objection never blocks. */
 transferObject(actor,input){return this.act(actor,input,['transfer','reason'],async(r,v,now,tx,powers)=>{
  const t=r.transfer;if(!powers.includes('admin')||!t||t.id!==v.transfer||!OPEN.includes(t.state))fail('not_found','Not found.',404);
  if(samePrincipal(actor.principal,r.ownerOfRecord))fail('invalid_decision','The offering owner cannot object.',409);
  requireFresh(actor,now);const reason=reasonOf(v.reason);if((t.objections??[]).length>=32)fail('objection_limit','Too many objections.',429);
  t.objections.push({by:party(actor.principal),at:now,reason});
  this.ownershipNotice(r,'ownership-offer-objected',{transfer:t.id,by:party(actor.principal),reason},now,{members:[r.memberships[principalKey(r.ownerOfRecord)]?.id]});
  await this.audit(tx,r,'organization-ownership-objected',actor,{transfer:t.id,reason});return {transfer:this.transferView(t)};
 },{exit:true,exposure:false});}
 /** P18: after an owner security change in the last 30 days, any admin may block until the cooling ends. A block
  * closes the offer; a payment already verified is refunded in full. */
 transferBlock(actor,input){return this.act(actor,input,['transfer','reason'],async(r,v,now,tx,powers)=>{
  const t=r.transfer;if(!powers.includes('admin')||!t||t.id!==v.transfer||!OPEN.includes(t.state))fail('not_found','Not found.',404);
  if(samePrincipal(actor.principal,r.ownerOfRecord)||!Number.isSafeInteger(t.blockableUntil)||now>=t.blockableUntil)fail('invalid_decision','This offer cannot be blocked.',409);
  requireFresh(actor,now);await this.closeTransfer(r,t,'blocked',now,tx,actor,reasonOf(v.reason));return {transfer:this.transferView(t)};
 },{exit:true,exposure:false});}
 /** The recipient declines an unpaid offer. */
 transferDecline(actor,input){return this.act(actor,input,['transfer'],async(r,v,now,tx)=>{
  const t=r.transfer;if(!t||t.id!==v.transfer||!samePrincipal(t.to,actor.principal)||!OPEN.includes(t.state))fail('not_found','Not found.',404);
  if(t.state!=='offered')fail('transfer_not_withdrawable','The payment is verified; the transfer completes after its notice period.',409);
  await this.closeTransfer(r,t,'declined',now,tx,actor);return {transfer:this.transferView(t)};
 },{exit:true,exposure:false});}
 /**
  * §12b.3a Acceptance: the recipient, freshly stepped up, echoes the disclosure digest and gets a checkout created by
  * their own account for the organization's plan. The checkout is never proof of anything; only a verified payment
  * (settle) moves the transfer on.
  */
 async transferAccept(actor,input){
  const v=exact(input,['transfer','plan','currency','disclosure','confirm','locale']);
  if(v.confirm!==true||typeof v.disclosure!=='string'||!/^[a-f0-9]{64}$/.test(v.disclosure))fail('review_required','Review the disclosure before accepting.',400);
  if(!this.enabled(actor?.owner))fail('not_found','Not found.',404);
  if(!this.billingConfigured())fail('billing_unavailable','Organization billing is not available on this host.',503);
  const now=this.clock.now();this.freshStepUp(actor,now);
  if(typeof actor.addedUnder?.kid!=='string'||!actor.addedUnder.kid||!plain(actor.addedUnder.publicKey))fail('identity_provenance_required','Verified identity key evidence is required.',403);
  const pre=this.ensure(await this.metadata.get(ORG_RECORD)??fail()),t0=pre.transfer;
  if(!t0||t0.id!==v.transfer||!samePrincipal(t0.to,actor.principal)||t0.state!=='offered')fail('not_found','Not found.',404);
  if(now>=t0.expiresAt)fail('transfer_lapsed','This offer has lapsed.',409);
  const current=ownerSubscription(pre,now)?.plan??(PLANS.includes(pre.plan?.plan)?pre.plan.plan:null),plan=current??v.plan;
  if(!PLANS.includes(plan)||current&&v.plan!==undefined&&v.plan!==current)fail('invalid_plan','The transfer uses the organization’s current plan.',400);
  const pricing=await this.billing.plans(v.currency??'usd'),entry=pricing.plans.find(p=>p.id===plan);if(!entry)fail('billing_provider_unavailable','The plan price is unavailable.',503);
  if(await transferDisclosureDigest(pre,t0,{plan,currency:entry.price.currency,amount:entry.price.amount})!==v.disclosure)fail('disclosure_changed','The plan, price or offer changed. Review the disclosure again.',409);
  const prior=t0.acceptance;if(prior?.checkout&&prior.plan===plan&&prior.currency===entry.price.currency&&prior.checkout.expiresAt>now+5*MINUTE)return {checkout:{url:prior.checkout.url,server:'sandbox'},transfer:this.transferView(t0)};
  const checkout=await this.billing.checkout(pre.id,{owner:actor.principal.sub,plan,currency:entry.price.currency,purpose:'transfer',binding:t0.id,returnPath:'/console?org_transfer='+pre.id,locale:v.locale});
  return this.act(actor,{},[],async(r,_,now,tx)=>{
   const t=r.transfer;if(!t||t.id!==t0.id||t.state!=='offered'||!samePrincipal(t.to,actor.principal))fail('transfer_changed','This offer changed. Reload and review it again.',409);
   t.acceptance={at:now,plan,currency:entry.price.currency,amount:entry.price.amount,addedUnder:structuredClone(actor.addedUnder),checkout:{checkoutId:checkout.checkoutId,url:checkout.url,createdAt:now,expiresAt:checkout.expiresAt}};
   await this.audit(tx,r,'organization-ownership-checkout',actor,{transfer:t.id,plan,checkout:checkout.checkoutId});return {checkout:{url:checkout.url,server:'sandbox'},transfer:this.transferView(t)};
  },{exit:true,exposure:false});
 }
 /** Closes an open transfer. A verified payment is refunded in full, because the recipient received nothing. */
 async closeTransfer(r,t,reason,now,tx,actor=null,detail=null){
  if(!OPEN.includes(t.state))return;
  const paid=t.state==='paid';t.state=['withdrawn','lapsed','blocked','declined'].includes(reason)?reason:reason==='deletion'?'withdrawn':'failed';t.closedAt=now;t.closedReason=reason;
  if(paid&&t.payment)this.refundPayment(r,t.payment,'transfer-'+reason,now);
  this.ownershipNotice(r,'ownership-offer-closed',{transfer:t.id,reason,refunded:paid},now,{principals:[t.to],members:[r.memberships[principalKey(r.ownerOfRecord)]?.id]});
  this.outbox(r,'index',{person:t.to.sub,role:'offer-closed',transfer:t.id},now);
  await this.audit(tx,r,'organization-ownership-offer-closed',actor??{kind:'system',principal:null},{transfer:t.id,reason,refunded:paid,...detail?{detail}:{}});
 }
 refundPayment(r,payment,reason,now){if(!payment?.subscriptionId||r.billing.handled[payment.subscriptionId]==='refund')return;r.billing.handled[payment.subscriptionId]='refund';this.outbox(r,'refund',{subscriptionId:payment.subscriptionId,orderId:payment.orderId,reason},now,{critical:true});}
 /** Non-throwing (review H2): whether a process's payment can still pay for an owner change. 'gone' (refunded, charged
  * back, revoked, ended, not paid, or not the new owner's), 'held' (Polar cannot confirm it now) or null (valid). */
 paymentState(r,payment,to,now){const s=r.billing.subscriptions[payment?.subscriptionId];if(!s)return 'gone';if(s.hold)return 'held';if(s.owner!==to?.sub||s.refunded||!paidNow(s,now)||['refund','revoke'].includes(r.billing.handled[s.id]))return 'gone';return null;}
 /** Runs an owner-change effect; the commit's throwing guard is a backstop only, so a refusal never fails the step. */
 async guardedEffect(fn,wake,now){try{await fn();return true;}catch(error){if(error?.code!=='owner_change_refused')throw error;wake(now+OWNERSHIP.RETRY_MS);return false;}}

 // ---- billing: owner renewal, lapse claim, creation checkout ----------------------------------------------
 /** The owner of record subscribes (again) when no paid owner subscription exists: lapsed, legacy or allowlisted. */
 async billingCheckout(actor,input){
  const v=exact(input,['plan','currency','locale']);if(!this.enabled(actor?.owner))fail('not_found','Not found.',404);
  if(!this.billingConfigured())fail('billing_unavailable','Organization billing is not available on this host.',503);
  if(!PLANS.includes(v.plan))fail('invalid_plan','Choose an organization plan.',400);
  const loaded=await this.load([actor?.principal]);if(loaded?.kind!=='organization')fail();const pre=this.ensure(loaded),now=this.clock.now();
  if(!this.mayRenew(pre,actor?.principal,now))fail('not_found','Not found.',404);
  if(ownerSubscription(pre,now))fail('subscription_exists','This organization already has a paid subscription.',409);
  requireFresh(actor,now);const binding='renew-'+this.random.uuid();
  const checkout=await this.billing.checkout(pre.id,{owner:actor.principal.sub,plan:v.plan,currency:v.currency??'usd',purpose:'renew',binding,returnPath:'/console?org_billing='+pre.id,locale:v.locale});
  return this.act(actor,{},[],async(r,_,now,tx)=>{if(!this.mayRenew(r,actor.principal,now))fail('not_found','Not found.',404);r.billing.renewal={binding,plan:v.plan,by:party(actor.principal),createdAt:now,checkoutId:checkout.checkoutId};await this.audit(tx,r,'organization-billing-checkout',actor,{plan:v.plan});return {checkout:{url:checkout.url,server:'sandbox'}};},{exit:true,exposure:false});
 }
 /** §12b.3 lapse claim: after 30 days read-only, an admin (not the owner) starts a subscription and proposes itself. */
 async claimStart(actor,input){
  const v=exact(input,['plan','currency','confirm','locale']);if(v.confirm!==true)fail('review_required','Review the claim before continuing.',400);
  if(!this.enabled(actor?.owner))fail('not_found','Not found.',404);if(!this.billingConfigured())fail('billing_unavailable','Organization billing is not available on this host.',503);
  if(!PLANS.includes(v.plan))fail('invalid_plan','Choose an organization plan.',400);
  const loaded=await this.load([actor?.principal]);if(loaded?.kind!=='organization')fail();
  const pre=this.ensure(loaded),now=this.clock.now(),powers=organizationPowers(pre,actor?.principal,{now}),currency=v.currency??'usd';
  if(!powers.includes('admin'))fail('not_found','Not found.',404);this.freshStepUp(actor,now);
  const override=await this.override(pre),configured=this.billingConfigured();this.claimable(pre,billingStanding(pre,now,{override,configured}),actor,now);
  // F-05: the admin's open claim checkout for the same terms is reused, and new claim checkouts are rate-limited, so
  // claims cannot multiply subscriptions. A payment on a superseded claim's binding is refunded as unbound.
  const prior=pre.billing.claim;
  if(prior?.state==='awaiting-payment'&&samePrincipal(prior.by,actor.principal)&&prior.plan===v.plan&&(prior.currency??'usd')===currency&&typeof prior.checkout?.url==='string'&&prior.checkout.expiresAt>now+5*MINUTE)return {checkout:{url:prior.checkout.url,server:'sandbox'},claim:{id:prior.id,state:'awaiting-payment'}};
  if([...pre.billing.claimHistory??[],...prior?[prior]:[]].filter(c=>c.createdAt>now-DAY).length>=OWNERSHIP.CLAIM_CHECKOUTS_PER_DAY)fail('claim_limit','Too many claim checkouts today. Use the open one or try again tomorrow.',429);
  const id=this.random.uuid(),checkout=await this.billing.checkout(pre.id,{owner:actor.principal.sub,plan:v.plan,currency,purpose:'claim',binding:id,returnPath:'/console?org_billing='+pre.id,locale:v.locale});
  return this.act(actor,{},[],async(r,_,now,tx,powers)=>{
   // Review item 8: the standing is computed on the record this transaction commits, never on an earlier read.
   if(!powers.includes('admin'))fail('not_found','Not found.',404);this.claimable(r,billingStanding(r,now,{override,configured}),actor,now);
   // Review follow-up 4: the reuse and the daily limit are re-checked on the committed record. A concurrent start by the
   // same admin for the same terms wins the race; this one returns that claim (its unused checkout binds nothing, so a
   // payment on it is refunded as unbound).
   const open=r.billing.claim;
   if(open?.state==='awaiting-payment'&&samePrincipal(open.by,actor.principal)&&open.plan===v.plan&&(open.currency??'usd')===currency&&typeof open.checkout?.url==='string'&&open.checkout.expiresAt>now+5*MINUTE)return {checkout:{url:open.checkout.url,server:'sandbox'},claim:{id:open.id,state:'awaiting-payment'}};
   if([...r.billing.claimHistory??[],...open?[open]:[]].filter(c=>c.createdAt>now-DAY).length>=OWNERSHIP.CLAIM_CHECKOUTS_PER_DAY)fail('claim_limit','Too many claim checkouts today. Use the open one or try again tomorrow.',429);
   if(r.billing.claim){const old=r.billing.claim;if(old.state==='awaiting-payment'){old.state='closed';old.closedReason='superseded';old.closedAt=now;}r.billing.claimHistory=[...(r.billing.claimHistory??[]),old].slice(-8);}
   r.billing.claim={id,by:party(actor.principal),owner:party(r.ownerOfRecord),plan:v.plan,currency,state:'awaiting-payment',createdAt:now,checkout:{checkoutId:checkout.checkoutId,url:checkout.url,expiresAt:checkout.expiresAt},payment:null,notBefore:null};
   await this.audit(tx,r,'organization-lapse-claim-started',actor,{claim:id,plan:v.plan});return {checkout:{url:checkout.url,server:'sandbox'},claim:{id,state:'awaiting-payment'}};
  },{exit:true,exposure:false});
 }
 claimable(r,standing,actor,now){
  if(samePrincipal(actor.principal,r.ownerOfRecord))fail('invalid_decision','The owner keeps the organization by paying.',409);
  if(r.memberships[principalKey(actor.principal)]?.hold)fail('authority_held','Governance authority is held after a security change.',403);
  if(standing.standing!=='read-only'||now<standing.claimableAt||standing.held)fail('claim_unavailable','A claim is possible only after 30 days of read-only status.',409);
  if(r.billing.claim?.state==='pending')fail('claim_pending','A claim is already pending.',409);
  if(r.billing.claim?.state==='awaiting-payment'&&!samePrincipal(r.billing.claim.by,actor.principal)&&r.billing.claim.createdAt+OWNERSHIP.CLAIM_CHECKOUT_MS>now)fail('claim_in_progress','Another admin’s claim checkout is open.',409);
  if(r.transfer?.state==='paid')fail('transfer_pending','A verified ownership transfer is pending.',409);
  if(heldSubscriptions(r).length)fail('billing_held','Billing needs operator reconciliation before a claim is possible.',409);
  const busy=this.ownershipBusy(r,'lapse-claim');if(busy)fail(busy,'Another ownership process is pending.',409);
 }
 /** Person placement: a creation checkout for a reserved, unpaid organization (§12a: always paid; checkout at creation). */
 async creationCheckout(actor,input){
  const v=exact(input,['request','plan','currency','locale']);
  if(!this.billingConfigured())fail('billing_unavailable','Organization billing is not available on this host.',503);
  if(!PLANS.includes(v.plan))fail('invalid_plan','Choose an organization plan.',400);
  const row=await this.metadata.transaction(async tx=>{await this.person(tx,actor);return tx.get(ORG_CREATION+v.request);});
  if(!row||row.state!=='reserved'||row.payment?.state!=='required')fail('not_found','Not found.',404);
  const now=this.clock.now(),prior=row.payment.checkout;
  if(prior&&prior.plan===v.plan&&prior.currency===(v.currency??'usd')&&prior.expiresAt>now+5*MINUTE)return {checkout:{url:prior.url,server:'sandbox'},request:row.request,org:row.org};
  const checkout=await this.billing.checkout(row.org,{owner:actor.owner,plan:v.plan,currency:v.currency??'usd',purpose:'create',binding:row.request,returnPath:'/console?org_checkout='+encodeURIComponent(row.request),locale:v.locale});
  await this.metadata.transaction(async tx=>{await this.person(tx,actor);const again=await tx.get(ORG_CREATION+v.request);if(again?.state!=='reserved'||again.payment?.state!=='required')fail('not_found','Not found.',404);again.payment={...again.payment,plan:v.plan,checkout:{checkoutId:checkout.checkoutId,url:checkout.url,plan:v.plan,currency:checkout.currency,createdAt:now,expiresAt:checkout.expiresAt}};await tx.put(ORG_CREATION+v.request,again);});
  return {checkout:{url:checkout.url,server:'sandbox'},request:row.request,org:row.org};
 }
 /** Person placement: verifies the creation payment (a captured first order on a `create` subscription bound to this
  * request and created by this person) and marks the reservation paid. Never trusts a redirect. */
 async creationPayment(actor,input){
  const v=exact(input,['request']);
  const row=await this.metadata.transaction(async tx=>{await this.person(tx,actor);return tx.get(ORG_CREATION+v.request);});
  if(!row||row.state==='confirmed'||row.payment?.state!=='required')return row?{state:row.state,payment:row.payment?.state??null}:fail('not_found','Not found.',404);
  if(!this.billingConfigured())fail('billing_unavailable','Organization billing is not available on this host.',503);
  const snapshot=await this.billing.state(row.org,{});
  const s=snapshot.subscriptions.find(x=>x.purpose==='create'&&x.binding===row.request&&x.owner===actor.owner&&x.paid&&!x.refunded&&['active','canceled'].includes(x.status)&&x.validUntil>this.clock.now());
  if(!s)return {state:row.state,payment:'required',checkout:row.payment.checkout?{url:row.payment.checkout.url,plan:row.payment.checkout.plan}:null};
  return this.metadata.transaction(async tx=>{await this.person(tx,actor);const again=await tx.get(ORG_CREATION+v.request);if(again.payment?.state==='required'){again.payment={state:'verified',plan:s.plan,subscriptionId:s.id,orderId:s.orderId,verifiedAt:this.clock.now()};again.plan={source:'polar',plan:s.plan};await tx.put(ORG_CREATION+v.request,again);}return {state:again.state,payment:'verified',plan:again.plan};});
 }
 /** Person placement, system: the person-side indexes this organization's ownership changes (discovery hints only;
  * the organization's record stays authoritative). */
 async ownershipIndex(actor,input){
  const v=exact(input,['org','role','handle']);if(actor?.kind!=='system'||!UUID.test(v.org??'')||!['owned','member','offer','offer-closed'].includes(v.role))fail('forbidden','System only.',403);
  return this.metadata.transaction(async tx=>{
   if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
   const now=this.clock.now(),offer='orgs/offers/'+v.org;
   if(v.role==='offer'){if((await tx.list({prefix:'orgs/offers/'})).size<64)await tx.put(offer,{v:1,org:v.org,at:now});return {indexed:true};}
   if(v.role==='offer-closed'){await tx.delete(offer);return {indexed:true};}
   await tx.delete(offer);
   if(v.role==='owned'){await tx.put(ORG_OWNED+v.org,{v:1,org:v.org,handle:typeof v.handle==='string'?v.handle:null,role:'owner-of-record',createdAt:now});await tx.delete(ORG_JOINED+v.org);}
   else{if(await tx.get(ORG_OWNED+v.org))await tx.delete(ORG_OWNED+v.org);if(!await tx.get(ORG_JOINED+v.org))await tx.put(ORG_JOINED+v.org,{v:1,org:v.org,joinedAt:now});}
   return {indexed:true};
  });
 }
 /** Person placement: open offers addressed to this person (hints; each organization confirms). */
 async offers(actor){return this.metadata.transaction(async tx=>{await this.person(tx,actor);return {offers:[...(await tx.list({prefix:'orgs/offers/'})).values()].map(row=>({id:row.org,at:row.at}))};});}

 // ---- system: reconcile, webhook, tick, drain ---------------------------------------------------------------
 /** Pulls the verified Polar state, then applies it and every time-based rule in one commit. */
 async sync(actor){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  const r0=await this.metadata.get(ORG_RECORD);if(r0?.kind!=='organization'||r0.id!==actor.owner)return {wakeAt:null};
  if(!this.billingConfigured())return this.tick(actor);
  // F-05: only subscriptions that can still matter are re-read: held ones, ones not ended, and ones whose revoke or refund
  // is still pending. A settled (revoked or refunded) one is marked so the provider port does not count it.
  const now=this.clock.now(),known=Object.fromEntries(Object.values(r0.billing?.subscriptions??{}).filter(s=>s.hold||!ended(s,now)||effectPending(r0,s.id)).map(s=>[s.id,{amount:s.amount,currency:s.currency,...['revoke','refund'].includes(r0.billing.handled?.[s.id])?{settled:true}:{}}]));
  const snapshot=await this.billing.state(r0.id,{known});
  return this.step(actor,r0,snapshot);
 }
 async tick(actor){if(actor?.kind!=='system')fail('forbidden','System only.',403);const r0=await this.metadata.get(ORG_RECORD);if(r0?.kind!=='organization'||r0.id!==actor.owner)return {wakeAt:null};return this.step(actor,r0,null);}
 async step(actor,r0,snapshot){
  const override=await this.override(r0),configured=this.billingConfigured();let recipient=null,claimant=null;
  const status=async sub=>{try{const a=await this.accounts?.get(sub);return a?a.kind==='person'&&a.status==='active':this.accounts?false:null;}catch{return null;}};
  if(r0.transfer&&OPEN.includes(r0.transfer.state))recipient=await status(r0.transfer.to.sub);
  if(r0.billing?.claim?.state==='pending')claimant=await status(r0.billing.claim.by.sub);
  const extra=await this.stepContext(r0),alerts=[],result=await this.commit(actor,async(r,now,tx)=>{if(snapshot)await this.applySnapshot(r,snapshot,now,tx,alerts);return this.advance(r,now,tx,{override,configured,recipient,claimant,alerts,extra});});
  for(const entry of alerts){try{await this.alert?.(entry);}catch{/* the hold and its audit row are durable; the alert is best effort */}}
  return result;
 }
 /** A signature-verified Polar event: deduplicated by id (a reused id with another body is refused), then reconciled. */
 async billingWebhook(actor,verified){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(verified?.id??'')||!/^[a-f0-9]{64}$/.test(verified?.bodyHash??''))fail('invalid_webhook','Verified webhook descriptor is invalid.',400);
  const key='org/billing-event/'+verified.id,prior=await this.metadata.get(key);
  if(prior){if(prior.bodyHash!==verified.bodyHash)fail('webhook_id_conflict','Webhook identifier was reused.',409);return {duplicate:true};}
  const rows=await this.metadata.list({prefix:'org/billing-event/',limit:4097}),now=this.clock.now(),expired=[...rows].filter(([,row])=>row.receivedAt+35*DAY<=now).map(([k])=>k);
  if(rows.size-expired.length>=4096)fail('billing_event_capacity','Billing events need reconciliation before retry.',503);
  const result=await this.sync(actor);
  await this.metadata.transaction(async tx=>{for(const k of expired)await tx.delete(k);if(!await tx.get(key))await tx.put(key,{bodyHash:verified.bodyHash,type:String(verified.type??''),receivedAt:this.clock.now()});});
  return {duplicate:false,...result};
 }
 /**
  * Stores the verified snapshot and settles payments against open offers and claims. Unbound payments are refunded.
  * A tracked subscription Polar no longer returns, or that fails verification against the terms of its first
  * verification, is never read as unpaid: its stored snapshot is kept, it is held (`hold`) and an operator is alerted
  * (§12b.3: a missing or unverifiable provider result must not start the unpaid clock or advance a claim).
  */
 async applySnapshot(r,snapshot,now,tx,alerts=[]){
  const b=r.billing,seen=new Set();
  for(const s of snapshot.subscriptions??[]){
   seen.add(s.id);const prev=b.subscriptions[s.id];let paidThrough=prev?.paidThrough??0;
   if(s.refunded)paidThrough=0;
   else if(s.paid&&(s.status==='active'||s.status==='canceled'&&s.cancelAtPeriodEnd))paidThrough=Math.max(paidThrough,s.validUntil);
   if(s.endedAt!==null&&s.endedAt!==undefined)paidThrough=Math.min(paidThrough,s.endedAt);
   if(['revoked','canceled'].includes(s.status)&&!s.cancelAtPeriodEnd)paidThrough=Math.min(paidThrough,s.endedAt??now);
   // The price it was bought at: amount and currency stay those of the first verification.
   b.subscriptions[s.id]={...structuredClone(s),amount:prev?.amount??s.amount,currency:prev?.currency??s.currency,paidThrough,firstSeenAt:prev?.firstSeenAt??now};
   if(prev?.hold)await this.audit(tx,r,'organization-billing-hold-cleared',{kind:'system',principal:null},{subscription:s.id,reason:prev.hold.reason,since:prev.hold.since});
  }
  const unverified=new Map((snapshot.unverified??[]).map(u=>[u.id,u.reason==='missing'?'missing':'unverifiable']));
  // Review item 3: a NEW organization subscription that fails verification (today's price, its binding) is held for an
  // operator like a known one (H1), never silently dropped; a held subscription blocks the unpaid clock and claims.
  for(const u of snapshot.unverified??[])if(u.unknown===true&&typeof u.id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(u.id)&&!b.subscriptions[u.id]){
   b.subscriptions[u.id]={id:u.id,owner:null,purpose:null,binding:null,paid:false,refunded:false,paidThrough:0,firstSeenAt:now,hold:{reason:'unverifiable',since:now}};
   await this.audit(tx,r,'organization-billing-held',{kind:'system',principal:null},{subscription:u.id,reason:'unverifiable',owner:null,purpose:null});
   alerts.push({kind:'organization-billing',action:'operator-alert',reason:'subscription-unverifiable',org:r.id,subscription:u.id,owner:null,purpose:null,since:now});
  }
  for(const [id,s] of Object.entries(b.subscriptions)){
   if(seen.has(id))continue;
   if(!live(r,s,now)){if(s.hold)delete s.hold;continue;} // refunded, revoked or ended: nothing left to protect
   const reason=unverified.get(id)??'missing';
   if(s.hold?.reason===reason)continue;
   s.hold={reason,since:s.hold?.since??now};
   await this.audit(tx,r,'organization-billing-held',{kind:'system',principal:null},{subscription:id,reason,owner:s.owner,purpose:s.purpose});
   alerts.push({kind:'organization-billing',action:'operator-alert',reason:'subscription-'+reason,org:r.id,subscription:id,owner:s.owner,purpose:s.purpose,since:s.hold.since});
  }
  // F-05: a subscription whose effect is done is forgotten: ended (and settled) for BILLING_RETENTION_MS, or revoked or
  // refunded by us and no longer returned by the provider. Its `handled` entry goes with it; a forgotten subscription
  // cannot return, because a revoked one leaves the customer's active list.
  const open=new Set([r.transfer?.payment?.subscriptionId,b.claim?.payment?.subscriptionId].filter(Boolean));
  for(const [id,s] of Object.entries(b.subscriptions)){
   if(s.hold||open.has(id)||effectPending(r,id))continue;
   if(ended(s,now)?s.endedAt+OWNERSHIP.BILLING_RETENTION_MS<=now:['revoke','refund'].includes(b.handled[id])&&!seen.has(id)){delete b.subscriptions[id];delete b.handled[id];}
  }
  b.reconciledAt=Number.isSafeInteger(snapshot.reconciledAt)?Math.min(now,snapshot.reconciledAt):now;
  // The current renewal binding settles first, then the oldest: the first owner payment is kept, later ones refunded.
  const order=Object.values(b.subscriptions).sort((x,y)=>(y.binding===b.renewal?.binding)-(x.binding===b.renewal?.binding)||(x.periodStart??0)-(y.periodStart??0)||x.id.localeCompare(y.id));
  for(const s of order){
   if(!s.paid||s.refunded||s.hold||b.handled[s.id])continue;
   const payment={subscriptionId:s.id,orderId:s.orderId,verifiedAt:now},t=r.transfer,c=b.claim;
   if(s.purpose==='transfer'&&t?.id===s.binding&&t.state==='offered'&&s.owner===t.to.sub){
    t.state='paid';t.payment=payment;b.handled[s.id]='transfer';
    // §12b.3: a transfer verified during a lapse claim closes the claim, since the organization is paid again.
    if(c&&['awaiting-payment','pending'].includes(c.state))await this.closeClaim(r,c,'transfer-paid',now,tx);
    this.ownershipNotice(r,'ownership-transfer-paid',{transfer:t.id,notBefore:t.notBefore},now,{principals:[t.to],members:[r.memberships[principalKey(r.ownerOfRecord)]?.id]});
    await this.audit(tx,r,'organization-ownership-payment-verified',{kind:'system',principal:null},{transfer:t.id,subscription:s.id});continue;
   }
   if(s.purpose==='claim'&&c?.id===s.binding&&c.state==='awaiting-payment'&&s.owner===c.by.sub&&r.transfer?.state!=='paid'&&!this.ownershipBusy(r,'lapse-claim')){
    c.state='pending';c.payment=payment;c.notBefore=now+OWNERSHIP.CLAIM_NOTICE_MS;b.handled[s.id]='claim';
    this.ownershipNotice(r,'ownership-claim-pending',{claim:c.id,by:c.by,notBefore:c.notBefore},now,{members:[r.memberships[principalKey(r.ownerOfRecord)]?.id]});
    await this.audit(tx,r,'organization-lapse-claim-pending',{kind:'system',principal:null},{claim:c.id,subscription:s.id,notBefore:c.notBefore});continue;
   }
   if(await this.settleExtra(r,s,payment,now,tx))continue;
   const ownerPayment=['create','renew'].includes(s.purpose)&&s.owner===r.ownerOfRecord.sub&&(s.purpose==='renew'||s.binding===r.request);
   const duplicate=ownerPayment&&Object.values(b.subscriptions).some(x=>x.id!==s.id&&b.handled[x.id]==='owner'&&x.owner===s.owner&&paidNow(x,now));
   if(ownerPayment&&!duplicate){b.handled[s.id]='owner';continue;}
   // Paid, but bound to nothing open (a withdrawn, lapsed, blocked or closed offer or claim; a renewal by a former
   // owner; a second owner payment while one is already paid): the payer received nothing, so it is revoked and
   // refunded in full.
   this.refundPayment(r,payment,(duplicate?'duplicate-':'unbound-')+s.purpose,now);
   await this.audit(tx,r,'organization-payment-refunded',{kind:'system',principal:null},{subscription:s.id,purpose:s.purpose});
  }
 }
 /** Every time-based rule: unpaid tracking, offer lapse, the 24 h transfer effect, the 72 h claim effect. */
 async advance(r,now,tx,{override,configured,recipient,claimant,alerts=[],extra={}}){
  const b=r.billing;b.observedAt=now;let wakeAt=null;const wake=t=>{if(Number.isSafeInteger(t))wakeAt=Math.min(wakeAt??Infinity,Math.max(t,now+1000));};
  const t=r.transfer,c=b.claim,held=heldSubscriptions(r).length>0;
  // An ownership change happens only on a fresh provider snapshot (H2): a step that could not reconcile (Polar
  // unreachable, the time rules alone) never changes the owner on stale data; it wakes and retries.
  const fresh=configured&&Number.isSafeInteger(b.reconciledAt)&&b.reconciledAt<=now&&now-b.reconciledAt<=OWNERSHIP.FRESH_MS;
  if(t?.state==='offered'&&now>=t.expiresAt)await this.closeTransfer(r,t,'lapsed',now,tx);
  if(t?.state==='paid'&&now>=t.notBefore){
   if(r.state!=='active')await this.closeTransfer(r,t,'organization-unavailable',now,tx);
   else if(recipient===false)await this.closeTransfer(r,t,'recipient-unavailable',now,tx);
   else if(recipient===true&&fresh){const ps=this.paymentState(r,t.payment,t.to,now);if(ps==='gone')await this.closeTransfer(r,t,'payment-failed',now,tx);else if(ps==='held')wake(now+OWNERSHIP.RETRY_MS);else await this.guardedEffect(()=>this.transferEffect(r,t,now,tx),wake,now);}
   else wake(now+OWNERSHIP.RETRY_MS);
  }
  if(c?.state==='pending'){
   if(ownerSubscription(r,now))await this.closeClaim(r,c,'owner-paid',now,tx);
   else if(now>=c.notBefore){const m=await rosterOf(r).principal(c.by),owner=r.memberships[principalKey(r.ownerOfRecord)];
    if(r.state!=='active'||claimant===false||m?.state!=='live'||!m.grants.some(g=>g.power==='admin'))await this.closeClaim(r,c,'claimant-unavailable',now,tx);
    // F-03: while an admin's objection keeps the owner's authority held, the automatic effect would let the objector take
    // the organization from an owner who cannot act. It is escalated to an operator instead; the owner may still pay
    // (which closes the claim), and the claim re-checks hourly.
    else if(owner?.hold?.objected===true&&!Number.isSafeInteger(c.operatorApprovedAt)){
     // Review follow-up 6: the escalation is bounded. Unresolved for CLAIM_ESCALATION_MS, the claim closes and every
     // order bound to it is refunded; an operator may close it or let it proceed earlier (resolveClaim).
     if(Number.isSafeInteger(c.escalatedAt)&&now>=c.escalatedAt+OWNERSHIP.CLAIM_ESCALATION_MS){await this.closeClaim(r,c,'escalation-expired',now,tx);}
     else if(!Number.isSafeInteger(c.escalatedAt)){c.escalatedAt=now;await this.audit(tx,r,'organization-lapse-claim-escalated',{kind:'system',principal:null},{claim:c.id,reason:'owner-hold-objected'});alerts.push({kind:'organization-billing',action:'operator-alert',reason:'claim-owner-hold-objected',org:r.id,claim:c.id,since:now});}
     if(c.state==='pending')wake(Math.min(now+OWNERSHIP.CLAIM_ESCALATION_RETRY_MS,c.escalatedAt+OWNERSHIP.CLAIM_ESCALATION_MS));}
    // Held: Polar could not confirm a subscription, or the snapshot is stale, or an owner payment begun before the
    // deadline is not settled yet. An owner payment made before notBefore always defeats the claim, however late
    // it is confirmed, so the claim waits rather than taking effect.
    else if(claimant===true&&fresh&&this.paymentState(r,c.payment,c.by,now)==='gone')await this.closeClaim(r,c,'payment-failed',now,tx);
    else if(claimant===true&&fresh&&!held&&!this.ownerPaymentSettling(r,c,now))await this.guardedEffect(()=>this.claimEffect(r,c,now,tx),wake,now);
    else wake(now+OWNERSHIP.RETRY_MS);}
  }
  if(c?.state==='awaiting-payment'&&c.createdAt+7*DAY<=now){c.state='closed';c.closedReason='unpaid';c.closedAt=now;}
  await this.advanceExtra(r,now,tx,{fresh,held,extra,alerts,wake});
  const standing=billingStanding(r,now,{override,configured});
  if(standing.standing==='paid')b.unpaidSince=null;
  else if(!Number.isSafeInteger(b.unpaidSince)&&!held&&(!configured||Number.isSafeInteger(b.reconciledAt))){
   const owner=r.ownerOfRecord.sub,last=Math.max(0,...Object.values(b.subscriptions).filter(s=>s.owner===owner).map(s=>s.paidThrough??0));
   b.unpaidSince=last>0&&last<=now?last:now;await this.audit(tx,r,'organization-billing-unpaid',{kind:'system',principal:null},{since:b.unpaidSince});
   this.ownershipNotice(r,'organization-billing-unpaid',{since:b.unpaidSince,readOnlyAt:b.unpaidSince+OWNERSHIP.GRACE_MS},now,{members:[r.memberships[principalKey(r.ownerOfRecord)]?.id]});
  }
  const nt=r.transfer,nc=b.claim,after=billingStanding(r,now,{override,configured});
  if(nt?.state==='offered'){wake(nt.expiresAt);if(nt.acceptance)wake(now+OWNERSHIP.CHECKOUT_POLL_MS);}
  if(nt?.state==='paid')wake(nt.notBefore);
  if(nc?.state==='awaiting-payment')wake(now+OWNERSHIP.CHECKOUT_POLL_MS);
  if(nc?.state==='pending')wake(nc.notBefore);
  if(after.paidUntil)wake(after.paidUntil);
  if(after.readOnlyAt&&after.readOnlyAt>now)wake(after.readOnlyAt);
  if(after.claimableAt&&after.claimableAt>now)wake(after.claimableAt);
  const effectDue=await firstDueAt(tx,r);if(effectDue!==null)wake(effectDue);
  return {wakeAt,standing:after.standing,transfer:nt?.state??null,claim:nc?.state??null,...this.stepSummary(r)};
 }
 /** Whether the owner of record began a payment before the claim's deadline that Polar has not settled yet (the order
  * is not captured and not refunded or ended). Bounded by PAYMENT_SETTLE_MS so an abandoned order cannot hold forever. */
 ownerPaymentSettling(r,c,now){
  if(now>=c.notBefore+OWNERSHIP.PAYMENT_SETTLE_MS)return false;
  return Object.values(r.billing.subscriptions).some(s=>s.owner===r.ownerOfRecord.sub&&['create','renew'].includes(s.purpose)&&!s.paid&&!s.refunded&&Number.isSafeInteger(s.periodStart)&&s.periodStart<c.notBefore&&live(r,s,now)&&!['canceled','revoked'].includes(s.status));
 }
 /**
  * The shared owner-change commit (§12b.3a "Effect", §12d.5 "The effect commit", ORG-12a). Transfer, lapse claim,
  * break-glass and reinstatement change the owner of record only here, and its guards are re-checked in this very
  * commit: the organization is active; the owner of record is still the one the process recorded when it began
  * (`expect`), so at most one process takes effect per owner of record (§12d.2 "Racing ownership processes"); and,
  * except for a reinstatement, the payment is a verified, paid, unheld subscription created by the new owner, from a
  * provider snapshot no older than FRESH_MS. `authorityReset` raises the organization's `aep` (spec §3 rev 4.4).
  */
 ownerChangeGuard(r,to,payment,now,{cause,expect}){
  const refuse=reason=>fail('owner_change_refused','This ownership change cannot take effect now ('+reason+').',409);
  if(r.state!=='active')refuse('organization-unavailable');
  if(!expect||!samePrincipal(r.ownerOfRecord,expect))refuse('owner-changed');
  if(!to||samePrincipal(to,r.ownerOfRecord))refuse('same-owner');
  if(cause==='reinstatement'){if(payment)refuse('payment');return;}
  const s=r.billing.subscriptions[payment?.subscriptionId],b=r.billing;
  if(!s||s.owner!==to.sub||!paidNow(s,now)||s.hold||['refund','revoke'].includes(b.handled[s.id]))refuse('payment-unverified');
  if(!Number.isSafeInteger(b.reconciledAt)||b.reconciledAt>now||now-b.reconciledAt>OWNERSHIP.FRESH_MS)refuse('stale-snapshot');
 }
 async changeOwner(r,to,payment,now,tx,{cause,id,expect,admin=false,addedUnder=null,authorityReset=false,moveCoolingMs=OWNERSHIP.MOVE_COOLING_MS}){
  this.ownerChangeGuard(r,to,payment,now,{cause,expect});
  const prev=party(r.ownerOfRecord),key=principalKey(to),roster=rosterOf(r);let m=await roster.member(key);
  if(!m||m.state!=='live'){
   m={id:m?.id??this.random.uuid().replaceAll('-',''),principal:party(to),state:'live',generation:(m?.generation??0)+1,grants:[],aep:m?.aep??0,addedUnder:structuredClone(addedUnder??m?.addedUnder??null),createdAt:m?.createdAt??now,joinedBy:cause};
   roster.putMember(key,m);this.notice(r,'member-joined',{membership_id:m.id},now);await enqueueMemberKeyRefresh(tx,party(to),{now});
  }
  // F-04: the owner of record's membership never expires (an expiry would leave the organization without an owner).
  delete m.expires_at;delete m.expiryBlocked;
  if(admin&&!m.grants.some(g=>g.power==='admin'))m.grants.push({power:'admin',grantedBy:prev,grantedAt:now,notBefore:now+ORG_ADMIN_DELAY_MS});
  r.ownerOfRecord=party(to);
  // The previous owner's subscriptions are cancelled at once, not at period end, with no automatic refund (§12b.3a;
  // refunds are discretionary on request under the terms). Revocation is idempotent at the provider (a subscription it
  // no longer knows counts as revoked), so one the last reconcile could not see is cancelled too.
  for(const s of Object.values(r.billing.subscriptions))if(s.id!==payment?.subscriptionId&&s.owner===prev.sub&&!['refund','revoke'].includes(r.billing.handled[s.id])&&!(s.endedAt!==null&&s.endedAt!==undefined&&s.endedAt<=now)){r.billing.handled[s.id]='revoke';this.outbox(r,'revoke',{subscriptionId:s.id,reason:cause},now);}
  // A reinstatement has no payment: the organization starts its ordinary grace period (§12d.5 "Contest").
  if(payment)r.billing.handled[payment.subscriptionId]='owner';r.billing.unpaidSince=payment?null:now;r.billing.renewal=null;
  r.recovery={state:'rotation-pending',owner:party(to),since:now,cause,ref:id};this.outbox(r,'recovery-rotate',{cause,ref:id},now,{critical:true});
  // Review M2: a reissue begun under an earlier owner can no longer be confirmed.
  r.recoveryGeneration=(r.recoveryGeneration??0)+1;
  r.moveCoolingUntil=Math.max(r.moveCoolingUntil??0,now+moveCoolingMs);
  if(authorityReset)r.authorityEpoch=(r.authorityEpoch??0)+1;
  const prevMember=r.memberships[principalKey(prev)];
  this.ownershipNotice(r,'ownership-changed',{cause,id,from:prev,to:party(to)},now,{members:[prevMember?.id,m.id]});
  this.outbox(r,'index',{person:prev.sub,role:'member'},now);this.outbox(r,'index',{person:to.sub,role:'owned'},now);
  return {prev,member:m};
 }
 async transferEffect(r,t,now,tx){
  const {prev}=await this.changeOwner(r,t.to,t.payment,now,tx,{cause:'transfer',id:t.id,expect:t.from,admin:t.admin===true,addedUnder:t.acceptance?.addedUnder});
  t.state='effective';t.effectiveAt=now;t.closedAt=now;t.closedReason='effective';
  if(r.billing.claim&&['awaiting-payment','pending'].includes(r.billing.claim.state))await this.closeClaim(r,r.billing.claim,'transferred',now,tx);
  this.outbox(r,'index',{person:t.to.sub,role:'offer-closed',transfer:t.id},now);
  await this.audit(tx,r,'organization-ownership-transferred',{kind:'system',principal:null},{transfer:t.id,from:prev,to:party(t.to),subscription:t.payment.subscriptionId,moveCoolingUntil:r.moveCoolingUntil});
 }
 async claimEffect(r,c,now,tx){
  const {prev}=await this.changeOwner(r,c.by,c.payment,now,tx,{cause:'lapse-claim',id:c.id,expect:c.owner??r.ownerOfRecord});
  c.state='effective';c.effectiveAt=now;
  if(r.transfer?.state==='offered')await this.closeTransfer(r,r.transfer,'owner-changed',now,tx);
  await this.audit(tx,r,'organization-lapse-claim-effective',{kind:'system',principal:null},{claim:c.id,from:prev,to:party(c.by),subscription:c.payment.subscriptionId});
 }
 async closeClaim(r,c,reason,now,tx){
  const paid=c.state==='pending';c.state='closed';c.closedReason=reason;c.closedAt=now;if(paid)this.refundPayment(r,c.payment,'claim-'+reason,now);
  this.ownershipNotice(r,'ownership-claim-closed',{claim:c.id,reason,refunded:paid},now,{members:[(await rosterOf(r).principal(c.by))?.id]});
  await this.audit(tx,r,'organization-lapse-claim-closed',{kind:'system',principal:null},{claim:c.id,reason,refunded:paid});
 }
 /** System, operator tooling (review follow-up 6): resolves an escalated lapse claim. `close` (one operator) closes it
  * with a full refund of every order bound to it. `proceed` lifts the escalation, so the claim takes effect at the next
  * fresh step under every other rule (fresh snapshot, live admin claimant, no held subscription, no owner payment). Under
  * §12d.8 principle 3 (BG-16, ORG-12d) proceeding needs TWO different operators: the first call proposes, and a second
  * call by a different operator within OPERATOR_APPROVAL_MS approves; the same operator twice is refused. An operator
  * who is the claimant, the owner of record or a member of the organization cannot act. `operator` is the internal
  * account the admin service authenticated (step-up and capability are checked there). */
 async resolveClaim(actor,input){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  const v=exact(input,['claim','decision','note','reasonDigest','operator','assertion']);if(typeof v.claim!=='string'||!['close','proceed'].includes(v.decision))fail('invalid_request','Name the claim and close or proceed.',400);
  if(typeof v.operator!=='string'||!UUID.test(v.operator))fail('operator_required','Name the operator who decides.',400);
  // ORG-12d review L1: the note is validated BEFORE the assertion is verified, so a bad note never spends it. Review M3:
  // the admin service sends only `reasonDigest` (the organization audit is readable by the claimant).
  const note=reasonOf(v.note);if(v.reasonDigest!==undefined&&(typeof v.reasonDigest!=='string'||!/^[a-f0-9]{64}$/.test(v.reasonDigest)||note!==null))fail('invalid_request','Unsupported reason digest.',400);
  const verified=await this.verifyOperator(v.assertion,{operator:v.operator,org:actor?.owner,kind:'lapse-claim',process:v.claim,decision:v.decision,exclude:[]});
  // Review M1: re-verify a pending proposer (outside the transaction) before it can count as the first operator.
  const pending=(await this.metadata.get(ORG_RECORD))?.billing?.claim?.proceedProposal;let proposerActive=true;
  if(v.decision==='proceed'&&pending?.operator&&pending.operator!==v.operator&&typeof this.operators?.registered==='function'){try{proposerActive=await this.operators.registered(pending.operator)===true;}catch{proposerActive=false;}}
  const digest=v.reasonDigest??null;
  return this.commit(actor,async(r,now,tx)=>{
   const c=r.billing.claim;if(!c||c.id!==v.claim||c.state!=='pending'||!Number.isSafeInteger(c.escalatedAt))fail('not_found','Not found.',404);
   const operator={iss:this.issuer??null,sub:v.operator};await this.operatorConflict(r,operator,[c.by]);this.spendOperatorNonce(c,verified,now);
   const sys={kind:'system',principal:null};let outcome=v.decision;
   if(v.decision==='close')await this.closeClaim(r,c,'operator-closed',now,tx);
   else{
    let proposal=c.proceedProposal&&c.proceedProposal.at+OWNERSHIP.OPERATOR_APPROVAL_MS>now?c.proceedProposal:null;
    if(proposal&&proposal.operator!==v.operator){if(proposal.operator!==pending?.operator)fail('conflict','The proposal changed; reload and try again.',409);
     if(!proposerActive){await this.audit(tx,r,'organization-support-proposal-cancelled',sys,{claim:c.id,kind:'lapse-claim',operator:proposal.operator,decision:'proceed',reason:'proposer-inactive'});c.proceedProposal=null;proposal=null;}}
    if(!proposal){c.proceedProposal={operator:v.operator,at:now,...note?{note}:{},...digest?{reasonDigest:digest}:{}};outcome='proceed-proposed';}
    else if(proposal.operator===v.operator)fail('second_operator_required','A different operator must approve this decision.',409);
    else{c.operatorApprovedAt=now;c.operatorPair=[proposal.operator,v.operator].sort();c.proceedProposal=null;outcome='proceed-approved';}
   }
   await this.audit(tx,r,'organization-lapse-claim-resolved',sys,{claim:c.id,decision:outcome,operator:v.operator,...note?{note}:{},...digest?{reasonDigest:digest}:{}});
   return {claim:{id:c.id,state:c.state,closedReason:c.closedReason??null,approved:Number.isSafeInteger(c.operatorApprovedAt)},decision:outcome};
  });
 }
 /**
  * Review M3: the engine verifies who the operator is instead of trusting a caller's UUID. `operators.verify({assertion,
  * operator, scope, at})` (the admin service's signed assertion, or a durable operator registry; ORG-12d) must answer
  * {ok:true, operator, capability:'support.org-break-glass', nonce, expiresAt} for this exact operator and scope (the
  * organization, the process, the decision and any exclusions). No port, or anything else, refuses (fail closed).
  */
 async verifyOperator(assertion,{operator,org,kind,process,decision,exclude=[]}){
  // Review R2: the scope names the process kind too, so a lapse-claim assertion can never act on a break-glass claim.
  const scope={org,kind,process,decision,exclude:[...exclude].sort()},now=this.clock.now();let out=null;
  try{out=await this.operators?.verify?.({assertion,operator,scope,at:now});}catch{out=null;}
  if(out?.ok!==true||out.operator!==operator||out.capability!=='support.org-break-glass'||typeof out.nonce!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(out.nonce)||!Number.isSafeInteger(out.expiresAt)||out.expiresAt<=now||out.expiresAt>now+OWNERSHIP.OPERATOR_ASSERTION_MS)fail('operator_unverified','The operator could not be verified.',403);
  return out;
 }
 /** An assertion is used once per process (replays are refused); the record keeps the last 64 nonces. */
 spendOperatorNonce(holder,verified,now){holder.operatorNonces=(holder.operatorNonces??[]).filter(n=>n.expiresAt>now);if(holder.operatorNonces.some(n=>n.nonce===verified.nonce))fail('operator_unverified','This operator assertion was already used.',403);holder.operatorNonces=[...holder.operatorNonces,{nonce:verified.nonce,expiresAt:verified.expiresAt}].slice(-64);}
 /** §12d.8: an operator may not act on an organization in which they are a member (any state), or on a process in which
  * they are a named party (`parties`) or the owner of record. */
 async operatorConflict(r,operator,parties=[]){
  if([r.ownerOfRecord,...parties].some(p=>p&&p.sub===operator.sub))fail('operator_conflict','This operator is a party to the decision.',403);
  const m=await rosterOf(r).principal(operator);if(m)fail('operator_conflict','This operator is a member of the organization.',403);
 }
 /** Executes due outbox effects through their ports, outside transactions. Each is idempotent at the provider (re-read
  * before acting), so an `after` fault (effect applied, caller saw a failure) repeats safely. */
 async drainOwnership(actor){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  const r=await this.metadata.get(ORG_RECORD);if(r?.kind!=='organization'||r.id!==actor.owner)return {done:0,pending:0};
  // Re-review item 2: the pinned Polar SDK (@polar-sh/sdk 1.0.2) takes no idempotency key on refunds.create, so drains
  // are serialized by a lease: an overlapping run backs off instead of re-reading an order another run is refunding.
  // The lease outlives the slowest run (16 effects, each a few bounded provider calls) and is released at the end.
  const holder=this.random.uuid(),leased=await this.metadata.transaction(async tx=>{const lease=await tx.get(OWNERSHIP_DRAIN_LEASE);if(lease?.until>this.clock.now())return false;await tx.put(OWNERSHIP_DRAIN_LEASE,{holder,until:this.clock.now()+OWNERSHIP.DRAIN_LEASE_MS});return true;});
  if(!leased)return {done:0,pending:pendingEffects(r),leased:false,wakeAt:this.clock.now()+OWNERSHIP.RETRY_MS};
  try{return await this.#drainOwnership(actor,r);}
  finally{try{await this.metadata.transaction(async tx=>{if((await tx.get(OWNERSHIP_DRAIN_LEASE))?.holder===holder)await tx.delete(OWNERSHIP_DRAIN_LEASE);});}catch{/* the lease expires on its own */}}
 }
 async #drainOwnership(actor,r){
  // A record still holding the pre-release in-record outbox is migrated to rows by one commit first.
  if(Array.isArray(r.ownershipOutbox)){await this.commit(actor,()=>{});r=await this.metadata.get(ORG_RECORD);}
  const now=this.clock.now(),due=await dueEffects(this.metadata,now,16);let done=0;
  for(const e of due){
   let ok=false,error=null;
   try{
    if(e.kind==='revoke')ok=(await this.billing?.revoke(r.id,e.subscriptionId))?.revoked===true;
    // Review follow-up 6: every order of the subscription is refunded (renewals included), not only the first.
    else if(e.kind==='refund'){await this.billing?.revoke(r.id,e.subscriptionId);const refund={subscriptionId:e.subscriptionId,orderId:e.orderId,reason:'other',comment:'3sln.me organization ownership: '+e.reason,...e.retainProcessingFee===true?{retainProcessingFee:true}:{}};ok=(await (typeof this.billing?.refundAll==='function'?this.billing.refundAll(r.id,refund):this.billing?.refund(r.id,refund)))?.refunded===true;}
    else if(e.kind==='recovery-rotate')ok=(await this.effects?.rotateRecovery?.(r.id))?.rotated===true;
    else if(e.kind==='index')ok=(await this.effects?.index?.(e.person,{org:r.id,role:e.role,handle:r.handle??null}))===true;
    else ok=await this.drainExtra(r,e,actor)===true;
   }catch(err){error=typeof err?.code==='string'?err.code:'effect_failed';}
   await this.commit(actor,async(x,at,tx)=>{const row=await loadEffect(tx,x,e.id);if(!row||row.doneAt)return;
    // §12d.9: once the old binding is cleared the state is `missing` until the new owner saves a file. A delivered
    // notice's abort token is erased from the row (only its hash stays, on the claim).
    if(ok){row.doneAt=at;delete row.token;if(Array.isArray(row.channels))row.channels=row.channels.map(({abort,...ch})=>ch);if(e.kind==='recovery-rotate'&&x.recovery?.state==='rotation-pending'&&x.recovery.ref===e.ref)x.recovery={...x.recovery,state:'missing',rotatedAt:at};}
    else{row.attempts++;row.lastError=error??'effect_unavailable';row.nextAt=at+Math.min(6*3600000,OWNERSHIP.RETRY_MS*2**Math.min(row.attempts,9));}});
   if(ok)done++;
  }
  const after=await this.metadata.get(ORG_RECORD),pending=pendingEffects(after);
  return {done,pending,wakeAt:pending?await firstDueAt(this.metadata,after):null};
 }
 /** Owner of record: begins an organization recovery-file reissue (the transfer rule "reissued to the new owner").
  * Returns the creation request the identity record binds; the edge action issues and binds the file.
  * §12d.9 (ORG-12r): only the unheld owner of record, with a fresh step-up using a credential enrolled at least 7 days
  * earlier (P18 item 1). Within 30 days of a security change on the owner's account, a reissue that would replace an
  * existing file is refused; from `missing` (after a change of owner) it is immediate. Every admin is notified. A reissue
  * is an owner-interface action, so it aborts a pending break-glass claim (T14), and it never raises the `aep`. */
 recoveryReissueBegin(actor,input){return this.act(actor,input,[],async(r,v,now,tx,powers)=>{
  if(!powers.includes('owner-of-record'))fail('not_found','Not found.',404);const cooling=this.tight(actor,now);
  // Review M2: like the personal reissue, an owner who has a passkey must step up with it (evidence from the identity
  // adapter: `verification.hasPasskey` and `verification.method`).
  if(actor.verification?.hasPasskey===true&&actor.verification?.method!=='passkey')fail('passkey_required','Confirm with your passkey to replace the organization recovery file.',401);
  if(r.recovery?.state==='rotation-pending')fail('recovery_rotation_pending','The previous owner’s file is still being invalidated. Try again in a minute.',409);
  if(cooling&&r.recovery?.state!=='missing')fail('recovery_reissue_cooling','Your account had a recent security change. The recovery file can be replaced 30 days after it.',409);
  await this.ownerAction(r,actor,now,tx,'recovery-reissue');
  // Review R2-M2: every begun reissue is remembered until confirmed (a file may already be bound for it). Overflowing the
  // list invalidates the oldest by a rotation, never by forgetting it.
  r.recoveryReissues=[...(r.recoveryReissues??[]),{id:this.random.uuid(),owner:party(actor.principal),generation:r.recoveryGeneration??0,at:now}];
  if(r.recoveryReissues.length>OWNERSHIP.REISSUES_KEPT){r.recoveryReissues=r.recoveryReissues.slice(-OWNERSHIP.REISSUES_KEPT);this.rotateAfterReissue(r,now,'reissue-overflow');}
  this.ownershipNotice(r,'organization-recovery-reissue-started',{state:r.recovery?.state??'issued'},now);
  await this.audit(tx,r,'organization-recovery-reissue-started',actor);return {request:r.request,generation:r.recoveryGeneration??0};
 },{exit:true});}
 /** Confirms a reissue only for the owner and recovery generation that began it (review M2, R2-M2). Any `done` that is
  * not confirmed, from a principal who began a reissue (in any generation) and is not confirming the current owner's
  * current-generation reissue, invalidates the possibly bound file with a fresh rotation and answers {issued:false}; the
  * edge then never hands that file out (it also fails closed on any `done` error). A principal who began nothing gets
  * not_found and causes no rotation. */
 recoveryReissueDone(actor,input){return this.act(actor,input,['kid','generation'],async(r,v,now,tx,powers)=>{
  const generation=r.recoveryGeneration??0,list=r.recoveryReissues??[],mine=list.filter(x=>samePrincipal(x.owner,actor.principal));
  const entry=v.generation===undefined?mine.at(-1):mine.find(x=>x.generation===v.generation);
  if(!entry){if(!mine.length)fail('not_found','Not found.',404);}
  const current=entry&&powers.includes('owner-of-record')&&entry.generation===generation&&samePrincipal(r.ownerOfRecord,actor.principal);
  if(!current){
   r.recoveryReissues=list.filter(x=>x!==(entry??mine.at(-1)));this.rotateAfterReissue(r,now,'reissue-superseded');
   await this.audit(tx,r,'organization-recovery-reissue-superseded',actor,{generation});return {issued:false,reason:'owner_changed'};
  }
  r.recoveryReissues=list.filter(x=>x!==entry);r.recovery={state:'issued',owner:party(actor.principal),since:now,cause:r.recovery?.cause??'reissue'};this.ownershipNotice(r,'organization-recovery-reissued',{},now);
  await this.audit(tx,r,'organization-recovery-reissued',actor,{kid:typeof v.kid==='string'?v.kid.slice(0,200):null});return {issued:true};
 },{exit:true,exposure:false});}
 /** Invalidates any file bound since: an ordinary signing rotation through the outbox; the state is rotation-pending. */
 rotateAfterReissue(r,now,cause){const ref=this.random.uuid();r.recovery={state:'rotation-pending',owner:party(r.ownerOfRecord),since:now,cause,ref};this.outbox(r,'recovery-rotate',{cause,ref},now);}

 // ---- extension hooks (no-ops; packages/orgs/break-glass.mjs overrides them) ---------------------------------
 /** An error code when another ownership process blocks `kind` from starting or settling, else null. */
 ownershipBusy(){return null;}
 /** Called inside the commit of an owner-interface action with fresh authentication (`action`). May refuse it. */
 async ownerAction(){}
 /** Extra port reads a step needs, done outside the transaction; handed to advanceExtra as `extra`. */
 async stepContext(){return {};}
 /** Further time rules, inside the step's commit. */
 async advanceExtra(){}
 /** Settles a verified, paid, unhandled subscription; true when handled (otherwise it is refunded as unbound). */
 async settleExtra(){return false;}
 /** Executes an outbox effect of a kind this class does not know; true when done. */
 async drainExtra(){return false;}
 /** Extra fields for a step's result. */
 stepSummary(){return {};}
}

/**
 * The organization entitlement port (replaces the bare allowlist, ORG-1's paid check). `check({creator, org, request,
 * override})`: the operator allowlist (`ORGANIZATIONS_PAID_ALLOWLIST`: creator/owner or organization UUIDs) passes as
 * an override; otherwise, with `org` and `request`, the verified Polar state decides. `payable`: whether a reservation
 * may be made unpaid and paid by checkout (organization billing configured, sandbox only).
 */
export function organizationEntitlementPort({allowlist,billing}){
 const listed=new Set(typeof allowlist==='string'?allowlist.split(',').map(v=>v.trim().toLowerCase()).filter(v=>UUID.test(v)):[]);
 const configured=()=>{try{return billing?.configured?.()===true;}catch{return false;}};
 return Object.freeze({
  get payable(){return configured();},
  async check({creator,org,request,override=false}={}){
   if(listed.has(String(creator?.sub??'').toLowerCase())||listed.has(String(org??'').toLowerCase()))return {paid:true,plan:'organization-internal',source:'allowlist'};
   if(override||!configured()||!UUID.test(org??'')||typeof request!=='string')return {paid:false,reason:configured()?'payment_required':'billing_unavailable'};
   const snapshot=await billing.state(org,{}),s=snapshot.subscriptions.find(x=>x.purpose==='create'&&x.binding===request&&x.owner===creator?.sub&&x.paid&&!x.refunded&&['active','canceled'].includes(x.status));
   return s?{paid:true,plan:s.plan,source:'polar',subscriptionId:s.id}:{paid:false,reason:'payment_required'};
  }
 });
}
