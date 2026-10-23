// Organization billing standing, the billing-lapse claim and ownership transfer (docs/architecture/organizations-design.md
// ORG-D18, ORG-D21, §1d, §12a, §12b.1, §12b.2a item 9, §12b.3, §12b.3a, §12b.5). Engine-first: every rule here runs in
// the organization's account single writer and commits through one record transaction; provider I/O (Polar, identity,
// peer accounts) is done through ports OUTSIDE transactions, and every external effect leaves through a durable,
// idempotent outbox (`ownershipOutbox`), so a crash or a replayed webhook can never apply a rule twice.
//
// What the user decided (2026-10-21/22): organizations are always paid; ownership can be transferred; the recipient sets
// up billing first; billing starts a fresh period; the previous owner's payment confers nothing. Everything else here
// is *Provisional (coordinator), not signed off by the user* (§1d), and the figures in OWNERSHIP are revisable.
//
// Record fields (all lazily created on the organization record):
//   billing   {v, subscriptions:{[id]: verified snapshot + paidThrough}, handled:{[id]: role}, unpaidSince, reconciledAt,
//              claim:null|{id, by, plan, state:'awaiting-payment'|'pending'|'effective'|'closed', ...}, renewal}
//   transfer  null|{id, state, from, to, toHandle, admin, plan, offeredAt, notBefore, expiresAt, blockableUntil,
//              objections, acceptance, payment, closedAt, closedReason, effectiveAt}
//   transferHistory  the last 16 closed transfers
//   ownershipOutbox  [{id, kind:'revoke'|'refund'|'recovery-rotate'|'index', ..., doneAt, attempts}]
//   recovery  null|{state:'rotation-pending'|'reissue-required'|'issued', owner, since, cause}
//   moveCoolingUntil  ms (portability §6.2; moves stay refused by the portability guards regardless)
//
// Ports (constructor options, besides MembershipService's):
//   billing   {configured(), state(org,{known}), checkout(org,{...}), revoke(org,id), refund(org,{...}), plans(currency)}
//             (packages/billing/organizations.mjs OrganizationBilling; SANDBOX ONLY)
//   accounts  {get(sub) -> {status, handle, kind}|null}  this provider's identity records (recipient checks)
//   effects   {rotateRecovery(org) -> {rotated:true}, index(person, {org, role, handle}) -> true}
//   plans     the paid-check port; `check({creator, org, override:true})` answers the operator allowlist override.
import {MembershipService,membershipState,ORG_ADMIN_DELAY_MS} from './memberships.mjs';
import {ORG_RECORD,ORG_OWNED,ORG_JOINED,ORG_CREATION,ORG_DELETION_DELAY_MS} from './organizations.mjs';
import {organizationPowers,requireFresh} from './authority.mjs';
import {principalKey,samePrincipal,normalizeMemberGrants} from './grants.mjs';
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
 RETRY_MS:MINUTE
});
const PLANS=['org-team','org-business','org-scale'];
const OPEN=['offered','paid'],UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,HANDLE=/^[a-z0-9][a-z0-9._-]{0,62}$/i;
const fail=(code='not_found',message='Not found.',status=409)=>{throw new AppFault(code,message,status);};
const party=p=>({iss:p?.iss??null,sub:p?.sub});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(value,names)=>{if(value===undefined)value={};if(!plain(value)||Object.keys(value).some(k=>!names.includes(k)))fail('invalid_request','Unsupported ownership request.',400);return value;};
const reasonOf=v=>{if(v===undefined||v==='')return null;if(typeof v!=='string'||[...v].length>280||/[\u0000-\u001f]/.test(v))fail('invalid_reason','Give a reason of at most 280 characters.',400);return v.trim()||null;};
const hex=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');

/** Whether a verified subscription is paid through `now` (its stored paidThrough never extends on a failed renewal). */
const paidNow=(s,now)=>Number.isSafeInteger(s?.paidThrough)&&s.paidThrough>now&&!s.refunded;
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
 const base={plan,paidUntil:s?.paidThrough??null,pastDue:s?.status==='past_due',source:override?'override':s?'polar':null,unpaidSince:null,readOnlyAt:null,claimableAt:null};
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
 constructor(options){super(options);this.billing=options.billing??null;this.accounts=options.accounts??null;this.effects=options.effects??null;}
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
  const r=await this.metadata.get(ORG_RECORD),m=Object.values(r?.memberships??{}).find(x=>x.id===input?.membership);let next=null;try{next=normalizeMemberGrants(input?.grants);}catch{}
  const shape=g=>JSON.stringify(Object.fromEntries(Object.entries(g).filter(([k])=>!['grantedBy','grantedAt','notBefore'].includes(k)).sort()));
  const narrowing=m&&next&&next.every(g=>m.grants.some(old=>shape(old)===shape(g)));if(!narrowing)await this.writable();
  return super.grants(actor,input);
 }
 /** Delayed deletion closes an unpaid offer (an offer the owner could withdraw anyway); a verified, not yet effective
  * transfer refuses deletion, since withdrawing it is no longer possible (§12b.3a "until the payment is verified"). */
 async scheduleDeletion(actor,input){
  return this.mutate(actor,input,[],{powers:['owner-of-record'],fresh:true},async(record,value,now,tx)=>{
   this.ensure(record);
   if(record.transfer?.state==='paid')fail('transfer_pending','A verified ownership transfer is pending; deletion can be scheduled once it completes or fails.',409);
   if(record.transfer?.state==='offered')await this.closeTransfer(record,record.transfer,'deletion',now,tx,actor);
   record.state='deletion-scheduled';record.deletion={requestedAt:now,notBefore:now+ORG_DELETION_DELAY_MS,by:party(actor.principal)};
   await this.audit(tx,record,'organization-deletion-scheduled',actor,{notBefore:record.deletion.notBefore});
  });
 }

 // ---- transaction frame ------------------------------------------------------------------------------------
 ensure(r){membershipState(r,this.random,this.clock.now());r.billing??={v:1,subscriptions:{},handled:{},unpaidSince:null,reconciledAt:null,claim:null,renewal:null};r.billing.subscriptions??={};r.billing.handled??={};r.transfer??=null;r.transferHistory??=[];r.ownershipOutbox??=[];r.recovery??=null;return r;}
 /** One record transaction (system or adapter-verified actor). `fn(r, now, tx)` mutates; a change is written once. */
 async commit(actor,fn,{system=true}={}){
  if(system&&actor?.kind!=='system')fail('forbidden','System only.',403);
  return this.metadata.transaction(async tx=>{
   if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
   const raw=await tx.get(ORG_RECORD);if(raw?.kind!=='organization'||raw.id!==actor.owner)return null;
   const r=this.ensure(raw),before=JSON.stringify(r),now=this.clock.now(),result=await fn(r,now,tx);
   if(JSON.stringify(r)!==before){r.revision++;r.updatedAt=now;await tx.put(ORG_RECORD,r);}return structuredClone(result);
  });
 }
 /** Owner-route frame: the actor is resolved and epoch-checked by OrganizationService#organization. */
 async act(actor,input,names,fn,{exit=false,exposure=true}={}){
  const value=exact(input,names);if(exposure&&!this.enabled(actor?.owner))fail('not_found','Not found.',404);
  return this.metadata.transaction(async tx=>{
   const r=this.ensure(await this.organization(tx,actor,{write:true})),now=this.clock.now(),before=JSON.stringify(r);
   if(!exit&&r.state!=='active')fail('organization_deletion_pending','This organization is scheduled for deletion.',409);
   const powers=organizationPowers(r,actor.principal,{now}),result=await fn(r,value,now,tx,powers);
   if(JSON.stringify(r)!==before){r.revision++;r.updatedAt=now;await tx.put(ORG_RECORD,r);}return structuredClone(result);
  });
 }
 outbox(r,kind,detail,now){
  r.ownershipOutbox=r.ownershipOutbox.filter(e=>!e.doneAt||e.doneAt>now-30*DAY);
  if(r.ownershipOutbox.length>=256)fail('ownership_outbox_full','Ownership effects need operator attention.',503);
  const {id:ignored,...rest}=detail??{},row={...structuredClone(rest),id:this.random.uuid(),kind,createdAt:now,doneAt:null,attempts:0,nextAt:now};r.ownershipOutbox.push(row);return row;
 }
 /** Notices to every admin, plus named principals (the recipient need not be a member), via the member outbox. */
 ownershipNotice(r,type,detail,now,{principals=[],members=[]}={}){
  const admins=Object.values(r.memberships).filter(m=>m.state==='live'&&m.grants?.some(g=>g.power==='admin')).map(m=>m.id);
  r.memberOutbox.push({id:this.random.uuid(),type,at:now,recipients:[...new Set([...admins,...members.filter(Boolean)])],...principals.length?{principals:principals.map(party)}:{},...structuredClone(detail)});
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
 frozen(r){return r.recoveryClaim?.state==='pending';}
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
   const owner=powers.includes('owner-of-record'),admin=powers.includes('admin'),t=r.transfer,recipient=Boolean(t&&OPEN.includes(t.state)&&samePrincipal(t.to,actor.principal)),live=member?.state==='live';
   if(!owner&&!admin&&!recipient&&!live)fail('not_found','Not found.',404);
   const standing=billingStanding(r,now,{override,configured:this.billingConfigured()}),out={organization:{id:r.id,name:r.name,handle:r.handle??null,label:r.label,state:r.state},billing:{...standing,configured:this.billingConfigured(),server:this.billingConfigured()?'sandbox':null,provisional:true}};
   if(recipient)out.offer=await this.offerView(r,t,pricing,now);
   if(!owner&&!admin)return out;
   const held=Boolean(r.memberships[principalKey(r.ownerOfRecord)]?.hold),claim=r.billing.claim;
   out.transfer=t?{...this.transferView(t),objections:(t.objections??[]).map(o=>({by:party(o.by),at:o.at,reason:o.reason}))}:null;
   out.claim=claim?{id:claim.id,by:party(claim.by),state:claim.state,plan:claim.plan,createdAt:claim.createdAt,notBefore:claim.notBefore??null,closedReason:claim.closedReason??null}:null;
   out.recovery=r.recovery?{state:r.recovery.state,since:r.recovery.since,owner:party(r.recovery.owner)}:null;out.moveCoolingUntil=r.moveCoolingUntil??null;
   out.ownerOfRecord=party(r.ownerOfRecord);out.history=r.transferHistory.slice(-5).map(x=>this.transferView(x));
   const decisions=[],configured=this.billingConfigured(),openT=t&&OPEN.includes(t.state);
   if(owner&&configured&&!held&&!openT&&r.state==='active'&&claim?.state!=='pending'&&!this.frozen(r))decisions.push('offer');
   if(owner&&t?.state==='offered')decisions.push('withdraw');
   if(admin&&!owner&&openT)decisions.push('object');
   if(admin&&!owner&&openT&&Number.isSafeInteger(t.blockableUntil)&&now<t.blockableUntil)decisions.push('block');
   if(owner&&configured&&standing.standing!=='paid'&&!ownerSubscription(r,now))decisions.push('renew');
   if(admin&&!owner&&configured&&standing.standing==='read-only'&&now>=standing.claimableAt&&claim?.state!=='pending'&&t?.state!=='paid')decisions.push('claim');
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
   if(this.frozen(r))fail('recovery_pending','An organization recovery is pending.',409);
   if(r.transfer)await this.archive(r,r.transfer);
   const t={id:this.random.uuid(),state:'offered',from:party(r.ownerOfRecord),to,toHandle:account.handle,admin:v.admin===true,plan:ownerSubscription(r,now)?.plan??null,offeredAt:now,notBefore:now+OWNERSHIP.TRANSFER_MIN_DELAY_MS,expiresAt:now+OWNERSHIP.OFFER_LAPSE_MS,blockableUntil,objections:[],acceptance:null,payment:null};
   r.transfer=t;this.ownershipNotice(r,'ownership-offered',{transfer:t.id,recipient:to,recipientHandle:t.toHandle,admin:t.admin,notBefore:t.notBefore,expiresAt:t.expiresAt,blockableUntil},now,{principals:[to]});
   this.outbox(r,'index',{person:to.sub,role:'offer',transfer:t.id},now);
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
 refundPayment(r,payment,reason,now){if(!payment?.subscriptionId||r.billing.handled[payment.subscriptionId]==='refund')return;r.billing.handled[payment.subscriptionId]='refund';this.outbox(r,'refund',{subscriptionId:payment.subscriptionId,orderId:payment.orderId,reason},now);}

 // ---- billing: owner renewal, lapse claim, creation checkout ----------------------------------------------
 /** The owner of record subscribes (again) when no paid owner subscription exists: lapsed, legacy or allowlisted. */
 async billingCheckout(actor,input){
  const v=exact(input,['plan','currency','locale']);if(!this.enabled(actor?.owner))fail('not_found','Not found.',404);
  if(!this.billingConfigured())fail('billing_unavailable','Organization billing is not available on this host.',503);
  if(!PLANS.includes(v.plan))fail('invalid_plan','Choose an organization plan.',400);
  const pre=this.ensure(await this.metadata.get(ORG_RECORD)??fail()),now=this.clock.now();
  if(!organizationPowers(pre,actor?.principal,{now}).includes('owner-of-record'))fail('not_found','Not found.',404);
  if(ownerSubscription(pre,now))fail('subscription_exists','This organization already has a paid subscription.',409);
  requireFresh(actor,now);const binding='renew-'+this.random.uuid();
  const checkout=await this.billing.checkout(pre.id,{owner:actor.principal.sub,plan:v.plan,currency:v.currency??'usd',purpose:'renew',binding,returnPath:'/console?org_billing='+pre.id,locale:v.locale});
  return this.act(actor,{},[],async(r,_,now,tx,powers)=>{if(!powers.includes('owner-of-record'))fail('not_found','Not found.',404);r.billing.renewal={binding,plan:v.plan,by:party(actor.principal),createdAt:now,checkoutId:checkout.checkoutId};await this.audit(tx,r,'organization-billing-checkout',actor,{plan:v.plan});return {checkout:{url:checkout.url,server:'sandbox'}};},{exit:true,exposure:false});
 }
 /** §12b.3 lapse claim: after 30 days read-only, an admin (not the owner) starts a subscription and proposes itself. */
 async claimStart(actor,input){
  const v=exact(input,['plan','currency','confirm','locale']);if(v.confirm!==true)fail('review_required','Review the claim before continuing.',400);
  if(!this.enabled(actor?.owner))fail('not_found','Not found.',404);if(!this.billingConfigured())fail('billing_unavailable','Organization billing is not available on this host.',503);
  if(!PLANS.includes(v.plan))fail('invalid_plan','Choose an organization plan.',400);
  const pre=this.ensure(await this.metadata.get(ORG_RECORD)??fail()),now=this.clock.now(),powers=organizationPowers(pre,actor?.principal,{now});
  if(!powers.includes('admin'))fail('not_found','Not found.',404);this.freshStepUp(actor,now);
  const standing=await this.standingOf(pre),id=this.random.uuid();this.claimable(pre,standing,actor,now);
  const checkout=await this.billing.checkout(pre.id,{owner:actor.principal.sub,plan:v.plan,currency:v.currency??'usd',purpose:'claim',binding:id,returnPath:'/console?org_billing='+pre.id,locale:v.locale});
  const latest=await this.standingOf(await this.metadata.get(ORG_RECORD));
  return this.act(actor,{},[],async(r,_,now,tx,powers)=>{
   if(!powers.includes('admin'))fail('not_found','Not found.',404);this.claimable(r,latest,actor,now);
   if(r.billing.claim)r.billing.claimHistory=[...(r.billing.claimHistory??[]),r.billing.claim].slice(-8);
   r.billing.claim={id,by:party(actor.principal),plan:v.plan,state:'awaiting-payment',createdAt:now,checkout:{checkoutId:checkout.checkoutId,expiresAt:checkout.expiresAt},payment:null,notBefore:null};
   await this.audit(tx,r,'organization-lapse-claim-started',actor,{claim:id,plan:v.plan});return {checkout:{url:checkout.url,server:'sandbox'},claim:{id,state:'awaiting-payment'}};
  },{exit:true,exposure:false});
 }
 claimable(r,standing,actor,now){
  if(samePrincipal(actor.principal,r.ownerOfRecord))fail('invalid_decision','The owner keeps the organization by paying.',409);
  if(r.memberships[principalKey(actor.principal)]?.hold)fail('authority_held','Governance authority is held after a security change.',403);
  if(standing.standing!=='read-only'||now<standing.claimableAt)fail('claim_unavailable','A claim is possible only after 30 days of read-only status.',409);
  if(r.billing.claim?.state==='pending')fail('claim_pending','A claim is already pending.',409);
  if(r.billing.claim?.state==='awaiting-payment'&&!samePrincipal(r.billing.claim.by,actor.principal)&&r.billing.claim.createdAt+OWNERSHIP.CLAIM_CHECKOUT_MS>now)fail('claim_in_progress','Another admin’s claim checkout is open.',409);
  if(r.transfer?.state==='paid')fail('transfer_pending','A verified ownership transfer is pending.',409);
  if(this.frozen(r))fail('recovery_pending','An organization recovery is pending.',409);
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
  const snapshot=await this.billing.state(r0.id,{known:Object.keys(r0.billing?.subscriptions??{})});
  return this.step(actor,r0,snapshot);
 }
 async tick(actor){if(actor?.kind!=='system')fail('forbidden','System only.',403);const r0=await this.metadata.get(ORG_RECORD);if(r0?.kind!=='organization'||r0.id!==actor.owner)return {wakeAt:null};return this.step(actor,r0,null);}
 async step(actor,r0,snapshot){
  const override=await this.override(r0),configured=this.billingConfigured();let recipient=null,claimant=null;
  const status=async sub=>{try{const a=await this.accounts?.get(sub);return a?a.kind==='person'&&a.status==='active':this.accounts?false:null;}catch{return null;}};
  if(r0.transfer&&OPEN.includes(r0.transfer.state))recipient=await status(r0.transfer.to.sub);
  if(r0.billing?.claim?.state==='pending')claimant=await status(r0.billing.claim.by.sub);
  return this.commit(actor,async(r,now,tx)=>{if(snapshot)await this.applySnapshot(r,snapshot,now,tx);return this.advance(r,now,tx,{override,configured,recipient,claimant});});
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
 /** Stores the verified snapshot and settles payments against open offers and claims. Unbound payments are refunded. */
 async applySnapshot(r,snapshot,now,tx){
  const b=r.billing,seen=new Set();
  for(const s of snapshot.subscriptions??[]){
   seen.add(s.id);const prev=b.subscriptions[s.id];let paidThrough=prev?.paidThrough??0;
   if(s.refunded)paidThrough=0;
   else if(s.paid&&(s.status==='active'||s.status==='canceled'&&s.cancelAtPeriodEnd))paidThrough=Math.max(paidThrough,s.validUntil);
   if(s.endedAt!==null&&s.endedAt!==undefined)paidThrough=Math.min(paidThrough,s.endedAt);
   if(['revoked','canceled'].includes(s.status)&&!s.cancelAtPeriodEnd)paidThrough=Math.min(paidThrough,s.endedAt??now);
   b.subscriptions[s.id]={...structuredClone(s),paidThrough,firstSeenAt:prev?.firstSeenAt??now};
  }
  for(const [id,s] of Object.entries(b.subscriptions))if(!seen.has(id)){s.paidThrough=Math.min(s.paidThrough??0,now);s.status='missing';}
  for(const [id,s] of Object.entries(b.subscriptions))if((s.paidThrough??0)<now-400*DAY&&b.handled[id]!=='refund'&&Object.keys(b.subscriptions).length>16)delete b.subscriptions[id];
  b.reconciledAt=now;
  for(const s of Object.values(b.subscriptions)){
   if(!s.paid||s.refunded||b.handled[s.id])continue;
   const payment={subscriptionId:s.id,orderId:s.orderId,verifiedAt:now},t=r.transfer,c=b.claim;
   if(s.purpose==='transfer'&&t?.id===s.binding&&t.state==='offered'&&s.owner===t.to.sub&&!this.frozen(r)){
    t.state='paid';t.payment=payment;b.handled[s.id]='transfer';
    // §12b.3: a transfer verified during a lapse claim closes the claim, since the organization is paid again.
    if(c&&['awaiting-payment','pending'].includes(c.state))await this.closeClaim(r,c,'transfer-paid',now,tx);
    this.ownershipNotice(r,'ownership-transfer-paid',{transfer:t.id,notBefore:t.notBefore},now,{principals:[t.to],members:[r.memberships[principalKey(r.ownerOfRecord)]?.id]});
    await this.audit(tx,r,'organization-ownership-payment-verified',{kind:'system',principal:null},{transfer:t.id,subscription:s.id});continue;
   }
   if(s.purpose==='transfer'&&t?.id===s.binding&&t.state==='offered'&&this.frozen(r))continue; // a recovery freezes the offer; the payment waits
   if(s.purpose==='claim'&&c?.id===s.binding&&c.state==='awaiting-payment'&&s.owner===c.by.sub&&r.transfer?.state!=='paid'){
    c.state='pending';c.payment=payment;c.notBefore=now+OWNERSHIP.CLAIM_NOTICE_MS;b.handled[s.id]='claim';
    this.ownershipNotice(r,'ownership-claim-pending',{claim:c.id,by:c.by,notBefore:c.notBefore},now,{members:[r.memberships[principalKey(r.ownerOfRecord)]?.id]});
    await this.audit(tx,r,'organization-lapse-claim-pending',{kind:'system',principal:null},{claim:c.id,subscription:s.id,notBefore:c.notBefore});continue;
   }
   if(['create','renew'].includes(s.purpose)&&s.owner===r.ownerOfRecord.sub&&(s.purpose==='renew'||s.binding===r.request)){b.handled[s.id]='owner';continue;}
   // Paid, but bound to nothing open (a withdrawn, lapsed, blocked or closed offer or claim; a renewal by a former
   // owner; a duplicate): the payer received nothing, so it is revoked and refunded in full.
   this.refundPayment(r,payment,'unbound-'+s.purpose,now);
   await this.audit(tx,r,'organization-payment-refunded',{kind:'system',principal:null},{subscription:s.id,purpose:s.purpose});
  }
 }
 /** Every time-based rule: unpaid tracking, offer lapse, the 24 h transfer effect, the 72 h claim effect. */
 async advance(r,now,tx,{override,configured,recipient,claimant}){
  const b=r.billing;b.observedAt=now;let wakeAt=null;const wake=t=>{if(Number.isSafeInteger(t))wakeAt=Math.min(wakeAt??Infinity,Math.max(t,now+1000));};
  const t=r.transfer,c=b.claim;
  if(t?.state==='offered'&&now>=t.expiresAt)await this.closeTransfer(r,t,'lapsed',now,tx);
  if(t?.state==='paid'&&now>=t.notBefore&&!this.frozen(r)){
   if(r.state!=='active')await this.closeTransfer(r,t,'organization-unavailable',now,tx);
   else if(recipient===false)await this.closeTransfer(r,t,'recipient-unavailable',now,tx);
   else if(recipient===true)await this.transferEffect(r,t,now,tx);
   else wake(now+OWNERSHIP.RETRY_MS);
  }
  if(c?.state==='pending'){
   if(ownerSubscription(r,now))await this.closeClaim(r,c,'owner-paid',now,tx);
   else if(now>=c.notBefore){const m=r.memberships[principalKey(c.by)];if(r.state!=='active'||claimant===false||m?.state!=='live'||!m.grants.some(g=>g.power==='admin'))await this.closeClaim(r,c,'claimant-unavailable',now,tx);else if(claimant===true)await this.claimEffect(r,c,now,tx);else wake(now+OWNERSHIP.RETRY_MS);}
  }
  if(c?.state==='awaiting-payment'&&c.createdAt+7*DAY<=now){c.state='closed';c.closedReason='unpaid';c.closedAt=now;}
  const standing=billingStanding(r,now,{override,configured});
  if(standing.standing==='paid')b.unpaidSince=null;
  else if(!Number.isSafeInteger(b.unpaidSince)&&(!configured||Number.isSafeInteger(b.reconciledAt))){
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
  const pending=r.ownershipOutbox.filter(e=>!e.doneAt);if(pending.length)wake(Math.min(...pending.map(e=>e.nextAt??now)));
  return {wakeAt,standing:after.standing,transfer:nt?.state??null,claim:nc?.state??null};
 }
 /** Shared by a transfer and a lapse claim taking effect: one commit changes the owner of record (§12b.3a "Effect"). */
 async changeOwner(r,to,payment,now,tx,{cause,id,admin=false,addedUnder=null}){
  const prev=party(r.ownerOfRecord),key=principalKey(to);let m=r.memberships[key];
  if(!m||m.state!=='live'){
   m={id:m?.id??this.random.uuid().replaceAll('-',''),principal:party(to),state:'live',generation:(m?.generation??0)+1,grants:[],aep:m?.aep??0,addedUnder:structuredClone(addedUnder??m?.addedUnder??null),createdAt:m?.createdAt??now,joinedBy:cause};
   r.memberships[key]=m;this.notice(r,'member-joined',{membership_id:m.id},now);
  }
  if(admin&&!m.grants.some(g=>g.power==='admin'))m.grants.push({power:'admin',grantedBy:prev,grantedAt:now,notBefore:now+ORG_ADMIN_DELAY_MS});
  r.ownerOfRecord=party(to);
  // The previous owner's subscriptions are cancelled at once, not at period end, with no automatic refund (§12b.3a;
  // refunds are discretionary on request under the terms). Revocation is idempotent at the provider.
  for(const s of Object.values(r.billing.subscriptions))if(s.id!==payment.subscriptionId&&s.owner===prev.sub&&!['refund','revoke'].includes(r.billing.handled[s.id])&&s.status!=='missing'&&!(s.endedAt!==null&&s.endedAt!==undefined&&s.endedAt<=now)){r.billing.handled[s.id]='revoke';this.outbox(r,'revoke',{subscriptionId:s.id,reason:cause},now);}
  r.billing.handled[payment.subscriptionId]='owner';r.billing.unpaidSince=null;r.billing.renewal=null;
  r.recovery={state:'rotation-pending',owner:party(to),since:now,cause,ref:id};this.outbox(r,'recovery-rotate',{cause,ref:id},now);
  r.moveCoolingUntil=now+OWNERSHIP.MOVE_COOLING_MS;
  const prevMember=r.memberships[principalKey(prev)];
  this.ownershipNotice(r,'ownership-changed',{cause,id,from:prev,to:party(to)},now,{members:[prevMember?.id,m.id]});
  this.outbox(r,'index',{person:prev.sub,role:'member'},now);this.outbox(r,'index',{person:to.sub,role:'owned'},now);
  return {prev,member:m};
 }
 async transferEffect(r,t,now,tx){
  const {prev}=await this.changeOwner(r,t.to,t.payment,now,tx,{cause:'transfer',id:t.id,admin:t.admin===true,addedUnder:t.acceptance?.addedUnder});
  t.state='effective';t.effectiveAt=now;t.closedAt=now;t.closedReason='effective';
  if(r.billing.claim&&['awaiting-payment','pending'].includes(r.billing.claim.state))await this.closeClaim(r,r.billing.claim,'transferred',now,tx);
  this.outbox(r,'index',{person:t.to.sub,role:'offer-closed',transfer:t.id},now);
  await this.audit(tx,r,'organization-ownership-transferred',{kind:'system',principal:null},{transfer:t.id,from:prev,to:party(t.to),subscription:t.payment.subscriptionId,moveCoolingUntil:r.moveCoolingUntil});
 }
 async claimEffect(r,c,now,tx){
  const {prev}=await this.changeOwner(r,c.by,c.payment,now,tx,{cause:'lapse-claim',id:c.id});
  c.state='effective';c.effectiveAt=now;
  if(r.transfer?.state==='offered')await this.closeTransfer(r,r.transfer,'owner-changed',now,tx);
  await this.audit(tx,r,'organization-lapse-claim-effective',{kind:'system',principal:null},{claim:c.id,from:prev,to:party(c.by),subscription:c.payment.subscriptionId});
 }
 async closeClaim(r,c,reason,now,tx){
  const paid=c.state==='pending';c.state='closed';c.closedReason=reason;c.closedAt=now;if(paid)this.refundPayment(r,c.payment,'claim-'+reason,now);
  this.ownershipNotice(r,'ownership-claim-closed',{claim:c.id,reason,refunded:paid},now,{members:[r.memberships[principalKey(c.by)]?.id]});
  await this.audit(tx,r,'organization-lapse-claim-closed',{kind:'system',principal:null},{claim:c.id,reason,refunded:paid});
 }
 /** Executes due outbox effects through their ports, outside transactions. Each is idempotent at the provider (re-read
  * before acting), so an `after` fault (effect applied, caller saw a failure) repeats safely. */
 async drainOwnership(actor){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  const r=await this.metadata.get(ORG_RECORD);if(r?.kind!=='organization'||r.id!==actor.owner)return {done:0,pending:0};
  const now=this.clock.now(),due=(r.ownershipOutbox??[]).filter(e=>!e.doneAt&&(e.nextAt??0)<=now).slice(0,16);let done=0;
  for(const e of due){
   let ok=false,error=null;
   try{
    if(e.kind==='revoke')ok=(await this.billing?.revoke(r.id,e.subscriptionId))?.revoked===true;
    else if(e.kind==='refund'){await this.billing?.revoke(r.id,e.subscriptionId);ok=(await this.billing?.refund(r.id,{subscriptionId:e.subscriptionId,orderId:e.orderId,reason:'other',comment:'3sln.me organization ownership: '+e.reason}))?.refunded===true;}
    else if(e.kind==='recovery-rotate')ok=(await this.effects?.rotateRecovery?.(r.id))?.rotated===true;
    else if(e.kind==='index')ok=(await this.effects?.index?.(e.person,{org:r.id,role:e.role,handle:r.handle??null}))===true;
   }catch(err){error=typeof err?.code==='string'?err.code:'effect_failed';}
   await this.commit(actor,async(x,at)=>{const row=x.ownershipOutbox.find(y=>y.id===e.id);if(!row||row.doneAt)return;
    if(ok){row.doneAt=at;if(e.kind==='recovery-rotate'&&x.recovery?.state==='rotation-pending'&&x.recovery.ref===e.ref)x.recovery={...x.recovery,state:'reissue-required',rotatedAt:at};}
    else{row.attempts++;row.lastError=error??'effect_unavailable';row.nextAt=at+Math.min(6*3600000,OWNERSHIP.RETRY_MS*2**Math.min(row.attempts,9));}});
   if(ok)done++;
  }
  const after=await this.metadata.get(ORG_RECORD),pending=(after?.ownershipOutbox??[]).filter(e=>!e.doneAt);
  return {done,pending:pending.length,wakeAt:pending.length?Math.min(...pending.map(e=>e.nextAt??now)):null};
 }
 /** Owner of record: begins an organization recovery-file reissue (the transfer rule "reissued to the new owner").
  * Returns the creation request the identity record binds; the edge action issues and binds the file. */
 recoveryReissueBegin(actor,input){return this.act(actor,input,[],async(r,v,now,tx,powers)=>{
  if(!powers.includes('owner-of-record'))fail('not_found','Not found.',404);this.freshStepUp(actor,now);
  if(r.recovery?.state==='rotation-pending')fail('recovery_rotation_pending','The previous owner’s file is still being invalidated. Try again in a minute.',409);
  await this.audit(tx,r,'organization-recovery-reissue-started',actor);return {request:r.request};
 },{exit:true});}
 recoveryReissueDone(actor,input){return this.act(actor,input,['kid'],async(r,v,now,tx,powers)=>{
  if(!powers.includes('owner-of-record'))fail('not_found','Not found.',404);
  r.recovery={state:'issued',owner:party(actor.principal),since:now,cause:r.recovery?.cause??'reissue'};await this.audit(tx,r,'organization-recovery-reissued',actor,{kid:typeof v.kid==='string'?v.kid.slice(0,200):null});return {issued:true};
 },{exit:true});}
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
