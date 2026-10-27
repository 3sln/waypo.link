// ORG-10e relation lifecycle (design §8b.6 lifecycle table, RL-4, RL-10, §8b.7 "stale relation after a move" and
// "counterpart takeover"; spec §9.5 provider policy, §9.6, §9.9 delivery). Provisional (coordinator), not signed off.
//
// RL-4 holds (3sln.me as grantor). A counterpart's authority reset is one of: a higher `aep` on a verified event or
// entity certificate, a key reset without continuity, a move adoption, or a contested identity (reported by the
// background directory refresh through relations.observe-counterpart). Effect:
//   full hold    its certificates get the uniform refusal and nothing widening from it is honoured (C8); narrowing
//                still applies. Released only by an admin confirmation bound to the hold's `aep`
//                (relations.confirm-counterpart); a later reset needs a new confirmation. Never by a relation event.
//   write hold   an automatically adopted, ATTESTED move: only write-capable methods are refused, for 72 h with notice
//                to every admin, or until an admin confirms (review RL-R1-H3).
// Imports from a held counterpart are marked `held` (spec §9.5 "imports from it are marked").
//
// Other lifecycle rows (relations.lifecycle, system; called by the billing, deletion and key-custody pipelines):
//   billing read-only     outgoing edges keep serving read methods; write-capable methods are refused; no widening
//   billing export-only   outgoing grant halves suspended (a suspended relation-edge-state), restored with a new
//                         generation when billing is active again; incoming edges untouched
//   deletion effect       the pre-purge step: leave every instance (relation-edge-ended for each half), stop
//                         certification; relations.purge-ready answers once the final events are acknowledged or 72 h
//                         have passed (the identity layer keeps the certification keys published until then)
//   key compromise        every outgoing grant half gets a new generation (statements are re-signed fresh anyway)
//   moved in (RL-10)      the organization's own move arrived here: outgoing grant halves arrive suspended (their resource
//                         identifiers changed) and every half is re-sent (anti-entropy); relations.rebind re-binds an
//                         edge's values from the destination's own pool, a new grantor consent
// A counterpart that keeps failing delivery is never treated as revoked; after 30 days its admins are told once and
// relations.get flags it (§8b.6 "a counterpart disappears").
import {AppAction,AppQuery} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {plain} from '../core/strict-json.mjs';
import {principalKey,samePrincipal} from '../core/principals.mjs';
import {validPrincipal} from './memberships.mjs';
import {bump,half,requiredSatisfied,outgoingLive} from './relation-edges.mjs';
import {IMPORT_PREFIX} from './relation-imports.mjs';
import {K,party,ik} from './relation-keys.mjs';

export const RELATION_LEFT_RETENTION_MS=30*86400000,RELATION_WRITE_HOLD_MS=72*3600000,RELATION_UNREACHABLE_FLAG_MS=30*86400000,RELATION_RESYNC_INTERVAL_MS=86400000,RELATION_PURGE_WAIT_MS=72*3600000;
export const BILLING_STAGES=Object.freeze(['active','read-only','export-only']);
const BATCH=256;
const fail=(code,message,status)=>{throw new AppFault(code,message,status);};
const invalid=()=>fail('invalid_request','Unsupported relation request.',400);

/** Whether an RL-4 hold refuses a call. A write hold that has run out refuses nothing. */
export function holdRefuses(hold,{write,now}){if(!hold)return false;if(hold.kind==='full')return true;return write===true&&hold.until>now;}

export const relationLifecycleMethods={
 /** The active hold on a counterpart (origin principal), or null. */
 async activeHold(tx,p,now){const h=await tx.get(K.hold(p));if(!h)return null;if(h.kind==='write'&&!(h.until>now))return null;return h;},
 /** Every counterpart record of `p` across this organization's instances (bounded scan; holds are rare). */
 async counterpartRecords(tx,p){const out=[],want=principalKey(p);let after;for(let i=0;i<64;i++){const page=await tx.list({prefix:'rel/cp/',...after?{startAfter:after}:{},limit:BATCH});for(const [key,cp] of page){after=key;if(principalKey(cp.principal)===want)out.push(cp);}if(page.size<BATCH)break;}return out;},
 /** Marks (or unmarks) every import from `p` as held. */
 async markImports(tx,p,held,now){
  for(const cp of await this.counterpartRecords(tx,p))for(const [key,row] of await tx.list({prefix:IMPORT_PREFIX+principalKey(p)+'/'+ik(cp.instance)+'/',limit:65})){
   if(Boolean(row.held)===held)continue;await tx.put(key,{...row,held,updatedAt:now});await this.mirrorImport(tx,{...row,held},now);}
 },
 /**
  * RL-4: records an authority reset of counterpart `p` (origin principal) and holds it. `kind` 'full' or 'write' (an
  * attested move). A full hold is never weakened by a later write hold; a new reset raises the hold's `aep`, so an
  * earlier confirmation never covers it.
  */
 async applyReset(tx,r,p,{aep,cause,kind='full'},now){
  const old=await tx.get(K.hold(p)),live=old&&(old.kind==='full'||old.until>now)?old:null;
  const floor=(await tx.get(K.aep(p)))?.aep??0,bound=Math.max(Number.isSafeInteger(aep)?aep:0,floor,live?.aep??0);
  const next={v:1,principal:party(p),kind:live?.kind==='full'||kind==='full'?'full':'write',aep:bound,cause,since:now,...(live?.kind!=='full'&&kind!=='full')?{until:now+RELATION_WRITE_HOLD_MS}:{},resets:(live?.resets??0)+1};
  await tx.put(K.hold(p),next);await this.markImports(tx,p,true,now);
  await this.orgs.audit(tx,r,'relation-counterpart-held',{kind:'system'},{counterpart:party(p),kind:next.kind,aep:next.aep,cause});
  this.orgs.notice(r,'relation-counterpart-held',{counterpart:party(p),kind:next.kind,aep:next.aep,cause,...next.until?{until:next.until}:{}},now);
  return next;
 },
 /**
  * relations.observe-counterpart (system; the background directory refresh). `input`: {counterpart, aep?, keyReset?,
  * contested?, move?:{to, attested}}. Only an observed change acts: an `aep` that did not rise (a cancelled recovery
  * raises nothing, R4-M2) holds nothing.
  */
 observeCounterpart(actor,input){return this.system(actor,async(r,now,tx)=>{
  if(!plain(input)||Object.keys(input).some(k=>!['counterpart','aep','keyReset','contested','move'].includes(k))||!validPrincipal(input.counterpart))invalid();
  if(input.aep!==undefined&&(!Number.isSafeInteger(input.aep)||input.aep<0))invalid();
  const origin=await this.originOf(tx,input.counterpart);if(!(await this.counterpartRecords(tx,origin)).length)return {held:false};
  const floorRow=await tx.get(K.aep(origin));let hold=null;
  if(Number.isSafeInteger(input.aep)&&input.aep>(floorRow?.aep??0)){await tx.put(K.aep(origin),{aep:input.aep,at:now,...floorRow?{}:{baseline:true}});if(floorRow)hold=await this.applyReset(tx,r,origin,{aep:input.aep,cause:'aep-increase'},now);}
  if(input.keyReset===true)hold=await this.applyReset(tx,r,origin,{aep:input.aep,cause:'key-reset'},now);
  if(input.contested===true)hold=await this.applyReset(tx,r,origin,{aep:input.aep,cause:'contested'},now);
  if(input.move!==undefined){
   const m=input.move;if(!plain(m)||!validPrincipal(m.to)||typeof m.attested!=='boolean')invalid();
   const prior=await this.currentOf(tx,origin);if(!samePrincipal(prior,origin))await tx.delete(K.origin(prior));
   if(samePrincipal(m.to,origin))await tx.delete(K.successor(origin));else{await tx.put(K.successor(origin),{current:party(m.to),attested:m.attested,at:now});await tx.put(K.origin(m.to),{origin:party(origin)});}
   hold=await this.applyReset(tx,r,origin,{aep:input.aep,cause:m.attested?'attested-move':'move',kind:m.attested?'write':'full'},now);
   await this.refreshQueue(tx,m.to,{now,source:'member'});
  }
  return {held:Boolean(hold),...hold?{kind:hold.kind,aep:hold.aep}:{}};
 });},
 /** relations.confirm-counterpart (widening, step-up): releases an RL-4 hold, bound to its `aep`. */
 confirmCounterpart(actor,input){return this.widen(actor,input,['counterpart','aep'],async(r,v,now,m,tx)=>{
  if(!validPrincipal(v.counterpart)||!Number.isSafeInteger(v.aep))invalid();
  const origin=await this.originOf(tx,v.counterpart),hold=await tx.get(K.hold(origin));
  if(!hold)fail('not_found','Not found.',404);if(hold.aep!==v.aep)fail('relation_hold_changed','This hold changed. Review it again.',409);
  await tx.delete(K.hold(origin));await tx.put(K.confirmed(origin),{aep:v.aep,at:now,by:party(actor.principal)});await this.markImports(tx,origin,false,now);
  // Review L1: generations the counterpart's earlier authority (perhaps a compromised key) signed must not outlive the
  // confirmed reset. The floor of every mirror of its halves restarts (an end stays final), so its next state applies.
  for(const cp of await this.counterpartRecords(tx,origin)){let changed=false;for(const m of ['peerGrant','peerAcceptance'])if(cp[m]&&cp[m].state!=='ended'){cp[m]={...cp[m],generation:0};changed=true;}
   if(changed){cp.peerEpoch=(cp.peerEpoch??0)+1;await tx.put(K.cp(cp.instance,origin),cp);}}
  await this.orgs.audit(tx,r,'relation-counterpart-confirmed',actor,{counterpart:party(origin),aep:v.aep,kind:hold.kind});
  this.orgs.notice(r,'relation-counterpart-confirmed',{counterpart:party(origin),aep:v.aep},now);
  return {released:true,counterpart:party(origin),aep:v.aep};
 });},
 /** relations.holds: the organization's RL-4 holds and unreachable counterparts (admins). */
 holds(actor){return this.adminRead(actor,async(r,tx)=>{const now=this.clock.now();
  return {holds:[...(await tx.list({prefix:'rel/hold/',limit:BATCH})).values()].filter(h=>h.kind==='full'||h.until>now).map(h=>({counterpart:h.principal,kind:h.kind,aep:h.aep,cause:h.cause,since:h.since,...h.until?{until:h.until}:{}})),
   unreachable:[...(await tx.list({prefix:'rel/reach/',limit:BATCH})).values()].map(x=>({counterpart:x.principal,since:x.since,flagged:now-x.since>=RELATION_UNREACHABLE_FLAG_MS}))};});},

 /** The billing stage and the deletion pre-purge state. */
 async stage(tx){return (await tx.get(K.billing))?.stage??'active';},
 async closing(tx){return Boolean(await tx.get(K.closing));},
 /** Widening is refused while billing is not active or the pre-purge step has begun. */
 async requireWidenable(tx){if(await this.closing(tx))fail('organization_deletion_pending','This organization is scheduled for deletion.',409);if(await this.stage(tx)!=='active')fail('relation_billing_lapsed','Renew this organization\'s plan to add or widen relations.',402);},

 /** relations.lifecycle (system). `input`: {event:'billing', stage} | {event:'deletion-effect'} | {event:'key-compromise'}
  * | {event:'moved-in'}. Bounded per call; relations.tick finishes any remainder. */
 lifecycle(actor,input){return this.system(actor,async(r,now,tx)=>{
  if(!plain(input)||typeof input.event!=='string')invalid();
  if(input.event==='billing'){
   if(Object.keys(input).some(k=>!['event','stage'].includes(k))||!BILLING_STAGES.includes(input.stage))invalid();
   const was=await this.stage(tx);await tx.put(K.billing,{stage:input.stage,at:now});let changed=0;
   if(input.stage==='export-only')changed=await this.eachOutgoing(tx,async(part,cp)=>{if(cp.grant?.state!=='live')return false;cp.grant=bump(cp.grant,'suspended',now);cp.grant.cause='billing';return true;},r,now);
   if(input.stage!=='export-only'&&was==='export-only')changed=await this.eachOutgoing(tx,async(part,cp)=>{if(cp.grant?.state!=='suspended'||cp.grant.cause!=='billing')return false;
    const doc=await this.docFor(tx,part.relation),entries=await this.liveEntries(tx,doc,cp.as,cp.slot,cp.grant.entries,now);if(!entries.length||!requiredSatisfied(doc,cp.as,cp.slot,entries))return false;cp.grant=half('live',cp.grant.generation+1,now,entries);return true;},r,now);
   await this.orgs.audit(tx,r,'relation-billing-stage',{kind:'system'},{stage:input.stage,changed});return {stage:input.stage,changed};
  }
  if(input.event==='key-compromise'){if(Object.keys(input).length!==1)invalid();
   const changed=await this.eachOutgoing(tx,async(part,cp)=>{if(!['live','suspended'].includes(cp.grant?.state))return false;const cause=cp.grant.cause;cp.grant=bump(cp.grant,cp.grant.state,now);if(cause)cp.grant.cause=cause;return true;},r,now);
   await this.orgs.audit(tx,r,'relation-key-compromise',{kind:'system'},{changed});return {changed};}
  if(input.event==='moved-in'){if(Object.keys(input).length!==1)invalid();
   const changed=await this.eachOutgoing(tx,async(part,cp)=>{if(!['live','suspended'].includes(cp.grant?.state))return false;cp.grant=bump(cp.grant,'suspended',now);cp.grant.cause='moved';return true;},r,now);
   await tx.put(K.tick,{...(await tx.get(K.tick))??{},resyncAt:0,cursor:null});// re-send every half at the next tick
   await this.orgs.audit(tx,r,'relation-moved-in',{kind:'system'},{changed});this.orgs.notice(r,'relation-rebind-needed',{edges:changed},now);return {changed};}
  if(input.event==='deletion-effect'){if(Object.keys(input).length!==1)invalid();
   if(!await tx.get(K.closing))await tx.put(K.closing,{at:now});const left=await this.leaveSome(tx,r,now);
   await this.orgs.audit(tx,r,'relation-deletion-effect',{kind:'system'},{left});return {left};}
  invalid();
 });},
 /** Applies `fn(part, cp)` to every counterpart with an outgoing grant half; a true result commits a new generation of
  * that half and emits it. Returns how many changed. */
 async eachOutgoing(tx,fn,r,now){let n=0,after;
  for(let i=0;i<64;i++){const page=await tx.list({prefix:'rel/cp/',...after?{startAfter:after}:{},limit:BATCH});
   for(const [key,cp] of page){after=key;if(cp.state!=='live'||!cp.grant)continue;const part=await tx.get(K.instance(cp.instance));if(part?.state!=='live')continue;
    if(await fn(part,cp)){await tx.put(key,cp);await this.emitHalf(tx,r,cp,'grant');n++;}}
   if(page.size<BATCH)break;}
  return n;},
 /** The pre-purge step: leaves participations, a bounded number per call, resuming from a cursor across calls so
  * every participation is reached however many left rows sort before it (review M1). */
 async leaveSome(tx,r,now,limit=32){let n=0;const closing=await tx.get(K.closing);let after=closing?.cursor??null;
  for(let pages=0;pages<64&&n<limit;pages++){const page=await tx.list({prefix:'rel/instance/',...after?{startAfter:after}:{},limit:BATCH});let stopped=false;
   for(const [key,part] of page){if(n>=limit){stopped=true;break;}after=key;if(part.state==='left')continue;await this.leaveInstance(tx,r,part,now);n++;}
   if(stopped)break;if(page.size<BATCH){after=null;break;}}
  if(closing)await tx.put(K.closing,{...closing,cursor:after});return n;},
 /** relations.purge-ready (system query): true once no participation is live or pending (from the counters, which the
  * chaos suite checks against the rows), the pre-purge cursor is exhausted, and the final events are delivered or 72 h
  * have passed since the step began. */
 purgeReady(actor){if(actor?.kind!=='system')fail('forbidden','System only.',403);
  return this.metadata.transaction(async tx=>{if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
   const closing=await tx.get(K.closing);if(!closing)return {ready:false,closing:false};const now=this.clock.now();
   const remaining=(await this.counters(tx)).instances??0,queued=(await tx.list({prefix:'rel/outbox/',limit:1})).size>0;
   return {ready:remaining===0&&!closing.cursor&&(!queued||now-closing.at>=RELATION_PURGE_WAIT_MS),closing:true,remaining,pending:queued,since:closing.at};});},
 /** Deletes left participations 30 days after leaving, with their counterpart records, imports and mirrors (review M1;
  * the final state was re-sent for 72 h). Bounded per call. */
 async pruneLeft(tx,now,limit=32){let n=0;
  for(const [key] of await tx.list({prefix:'rel/left/',limit})){const at=Number(key.split('/')[2]);if(at>now-RELATION_LEFT_RETENTION_MS)break;const instance=decodeURIComponent(key.slice(key.lastIndexOf('/')+1)),part=await tx.get(K.instance(instance));
   if(part?.state==='left'){for(const [ck,cp] of await tx.list({prefix:K.cpPrefix(instance),limit:1024})){for(const [ikey,row] of await tx.list({prefix:IMPORT_PREFIX+principalKey(cp.principal)+'/'+ik(instance)+'/',limit:65})){for(const x of row.resources??[]){await tx.delete('rel/import-id/'+x.id);await tx.delete('federation/resource/'+x.id);}await tx.delete(ikey);}await tx.delete(ck);}
    await tx.delete(K.instance(instance));}
   await tx.delete(key);n++;}
  return n;},
 /** Drops introduction day counters older than today and records of sent introductions older than 30 days (review L7). */
 async pruneIntroductions(tx,now,limit=256){let n=0;const today=Math.floor(now/86400000);
  for(const [key] of await tx.list({prefix:'rel/intro-day/',limit})){if(Number(key.slice(key.lastIndexOf('/')+1))<today){await tx.delete(key);n++;}}
  for(const [key,row] of await tx.list({prefix:'rel/introduced/',limit}))if(!(row.at>now-30*86400000)){await tx.delete(key);n++;}
  return n;},

 /** relations.rebind (widening, step-up; RL-10): re-binds an outgoing edge that arrived suspended after this
  * organization's move, with values from the destination's own pool. The counterpart receives a live edge state with a
  * new generation and the new resource identifiers; its imports update in place. */
 rebind(actor,input){return this.widen(actor,input,['instance','counterpart','values'],async(r,v,now,m,tx)=>{
  if(typeof v.instance!=='string'||!validPrincipal(v.counterpart))invalid();
  const part=await tx.get(K.instance(v.instance)),cp=part?await tx.get(K.cp(v.instance,v.counterpart)):null;
  if(part?.state!=='live'||cp?.state!=='live'||cp.grant?.state!=='suspended'||cp.grant.cause!=='moved')fail('not_found','Not found.',404);
  const doc=await this.docFor(tx,part.relation),entries=await this.grantEntries(tx,doc,cp.as,cp.slot,v.values,now);
  if(!entries)fail('relation_values_incomplete','Every required entry needs a value.',400);
  // The grantor marks a one-for-one replacement (review L5), so the grantee keeps that import's id and its members'
  // grants; any other change mints new import ids.
  for(const e of entries){const before=cp.grant.entries.find(x=>x.index===e.index);if(before?.resources.length===1&&e.resources.length===1&&before.resources[0].resource!==e.resources[0].resource)e.resources[0].replaces=before.resources[0].resource;}
  cp.grant=half('live',cp.grant.generation+1,now,entries);await tx.put(K.cp(part.instance,cp.principal),cp);await this.emitHalf(tx,r,cp,'grant');
  await this.orgs.audit(tx,r,'relation-grant-rebound',actor,{instance:part.instance,counterpart:party(cp.principal),generation:cp.grant.generation,gives:entries.map(e=>e.index)});
  this.orgs.notice(r,'relation-grant-rebound',{instance:part.instance,counterpart:party(cp.principal)},now);
  return this.edgeView(part,cp,now);
 });},

 /**
  * relations.tick (system; the account alarm). Runs the daily anti-entropy pass (resumable by cursor), the sweep, the
  * pre-purge remainder, write-hold expiry notices and the 30-day unreachable flag, then drains the outbox. Returns
  * {wakeAt}.
  */
 async tick(actor){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  const now=this.clock.now(),state=await this.metadata.transaction(async tx=>(await tx.get(K.tick))??{resyncAt:0,cursor:null});
  let resynced=false;
  if(state.cursor||now-(state.resyncAt??0)>=RELATION_RESYNC_INTERVAL_MS){const out=await this.resync(actor,{after:state.cursor??undefined});resynced=true;state.cursor=out.next;if(!out.next)state.resyncAt=now;}
  await this.sweep(actor);
  await this.system(actor,async(r,_,tx)=>{
   await tx.put(K.tick,state);
   if(await tx.get(K.closing))await this.leaveSome(tx,r,now);
   for(const [key,h] of await tx.list({prefix:'rel/hold/',limit:BATCH}))if(h.kind==='write'&&!(h.until>now)){await tx.delete(key);await this.markImports(tx,h.principal,false,now);this.orgs.notice(r,'relation-counterpart-hold-ended',{counterpart:h.principal,aep:h.aep},now);}
   for(const [key,x] of await tx.list({prefix:'rel/reach/',limit:BATCH}))if(!x.flagged&&now-x.since>=RELATION_UNREACHABLE_FLAG_MS){await tx.put(key,{...x,flagged:true});this.orgs.notice(r,'relation-counterpart-unreachable',{counterpart:x.principal,since:x.since},now);}
   return null;
  });
  const drained=await this.drain(actor,{});
  const next=await this.metadata.transaction(async tx=>{for(const [,row] of await tx.list({prefix:'rel/outbox/',limit:1}))return row.notBefore;return null;});
  return {resynced,delivered:drained.delivered,wakeAt:Math.min(next===null?Infinity:Math.max(now+1000,next),(state.cursor?now+1000:(state.resyncAt??now)+RELATION_RESYNC_INTERVAL_MS))};
 },
};

// ---- engine operations ---------------------------------------------------------------------------------------------
const CHANGED='relations-changed';
class LifeSystem extends AppAction{static deps=['relations'];static changes=CHANGED;static lifecycle='suspended';}
export class ObserveRelationCounterpart extends LifeSystem{static operation='relations.observe-counterpart';run({relations}){return relations.observeCounterpart(this.actor,this.input);}}
export class RelationLifecycleEvent extends LifeSystem{static operation='relations.lifecycle';static lifecycle='purging';run({relations}){return relations.lifecycle(this.actor,this.input);}}
export class RelationTick extends LifeSystem{static operation='relations.tick';static lifecycle='purging';run({relations}){return relations.tick(this.actor);}}
export class RelationPurgeReady extends AppQuery{static operation='relations.purge-ready';static deps=['relations'];static lifecycle='purging';fetch({relations}){return relations.purgeReady(this.actor);}}
export class ConfirmRelationCounterpart extends AppAction{static operation='relations.confirm-counterpart';static deps=['relations'];static changes=CHANGED;static entities=['organization'];run({relations}){return relations.confirmCounterpart(this.actor,this.input);}}
export class RebindRelationEdge extends AppAction{static operation='relations.rebind';static deps=['relations'];static changes=CHANGED;static entities=['organization'];run({relations}){return relations.rebind(this.actor,this.input);}}
export class RelationHolds extends AppQuery{static operation='relations.holds';static deps=['relations'];static refreshOn=[CHANGED];static entities=['organization'];static lifecycle='suspended';fetch({relations}){return relations.holds(this.actor);}}
export const RELATION_LIFECYCLE_OPERATIONS=Object.freeze([ConfirmRelationCounterpart,RebindRelationEdge,RelationHolds]);
export const RELATION_LIFECYCLE_SYSTEM_OPERATIONS=Object.freeze([ObserveRelationCounterpart,RelationLifecycleEvent,RelationTick,RelationPurgeReady]);
