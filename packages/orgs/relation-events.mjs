// ORG-10e relation events (spec docs/spec/organizations.md §9.9, §9.4 proposals, §12 item 10, §14; design §8b.4 gaps 1–2,
// RL-5, RL-6, RL-12, RL-15). Provisional (coordinator), not signed off by the user.
//
// A relation event is a compact JWS whose header is exactly {alg:'ES256', kid, typ:'bindle-relation-event+jwt'}, signed
// with the SENDING entity's active certification key, and whose payload is exactly
//   {bindle:'relation-event', v:1, iss, sub, aud, instance, aep, iat, jti, events:{<one type>: payload}}.
// Its typ differs from certificates, statements and intents, so no other profile accepts it.
//
// Receiving (relations.ingest, the events endpoint's engine operation), in spec order:
//   1. without any fetch: JWS rules, size ≤ 32 KiB, exact members, typ, bindle, v, aud = this entity, iat window
//      (−300 s, +30 s). Only a failure here is refused (400); everything after answers the same {accepted:true} (202).
//   2. without any fetch: the sender's origin principal (successor index) is a counterpart in `instance`, live or
//      pending, and the sender is that principal's CURRENT issuer (an earlier host fails here).
//   3. without any fetch: the signature under the sender's active certification key as already held in the key cache.
//      A key that is not held schedules one background refresh for that sender, for any sender of a supported issuer,
//      before and whatever step 2 decided, so the schedule never depends on participation (RL-R1-H1). When step 2 fails
//      or the key is missing, a fixed dummy verification keeps the cost the same.
//   4. a `jti` accepted from that sender within the window stops processing; it is recorded only after step 3.
//   5. a widening event (live edge state, introduction, recognition) with an `aep` below the recorded floor is ignored;
//      narrowing is applied whatever its `aep`; a higher `aep` is recorded and is an authority reset (RL-4 hold).
//      While a full RL-4 hold is active nothing widening from that counterpart is honoured (C8); events never release it.
//   6. apply: per (instance, sender, receiver, half) an end is final and the highest generation wins.
// The sender comes only from the verified signature: no adapter-supplied `from` is read (ORG-10f production gate 1).
//
// Sending: the durable outbox (relation-instances.mjs `enqueue`) holds unsigned rows; `drain` signs each with the
// organization's certification key at delivery time (current `aep`, fresh `iat`, the row's `jti`, so a retry is re-signed
// with the same `jti`) and hands it to the transport's `deliver(from, to, jws)`. Same host: the other organization's
// writer (the same signed path, RL-15). Another provider: ORG-11a, through `manifestEventDelivery` below, which posts only
// to the counterpart's current issuer's validated manifest `relations.v1.events_endpoint` (RL-6).
import {AppAction,AppQuery} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {plain} from '../core/strict-json.mjs';
import {digest,textEncoder} from '../core/records.mjs';
import {signCompact,parseCompact,verifyCompact} from './relation-statements.mjs';
import {RELATION_EVENT,RELATION_EVENT_TYPES,RELATION_EVENT_PAST_S,RELATION_EVENT_FUTURE_S,halfEvent,applyMirror,narrowingEvent,outgoingLive,incomingLive} from './relation-edges.mjs';
import {edgeEntries,slotOf} from './relation-documents.mjs';
import {identityURI} from './relation-invitations.mjs';
import {RELATION_LIMITS} from './relation-invitations.mjs';
import {principalKey,samePrincipal} from './grants.mjs';
import {validPrincipal} from './memberships.mjs';
import {K,party} from './relation-keys.mjs';

export const RELATION_EVENT_TYP='bindle-relation-event+jwt',RELATION_EVENT_MAX_BYTES=32768;
export const RELATION_EVENT_MEDIA_TYPE='application/secevent+jwt';
export const INTRODUCTION_TTL_MS=30*86400000;
const DAY=86400000,OUTBOX_RETRY_MS=72*3600000,BATCH=256;
const MEMBERS=['bindle','v','iss','sub','aud','instance','aep','iat','jti','events'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,JTI=/^[A-Za-z0-9_.:-]{1,128}$/,SLOT=/^[a-z][a-z0-9-]{0,31}$/,INTRO_ID=/^[A-Za-z0-9_-]{43}$/;
const fail=(code,message,status)=>{throw new AppFault(code,message,status);};
const exact=(v,names,optional=[])=>plain(v)&&names.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>names.includes(k)||optional.includes(k));
const originOk=v=>{if(typeof v!=='string'||v.length>256)return false;try{const u=new URL(v);return (u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))&&u.origin===v;}catch{return false;}};

/** The exact payload of a relation event. */
export function relationEventPayload({from,to,instance,aep,iat,jti,events}){return {bindle:'relation-event',v:1,iss:from.iss,sub:from.sub,aud:identityURI(to),instance,aep,iat,jti,events};}
/** Signs a relation event with the sending entity's certification key ({kid, privateKey}). */
export function signRelationEvent(payload,{kid,privateKey}){return signCompact({typ:RELATION_EVENT_TYP,kid,privateKey,payload});}
/**
 * Spec §9.9 step 1, with no fetch: the JWS profile and size, the exact members, `typ`, `bindle`, `v`, `aud` equal to
 * `audience`, and the `iat` window. Returns the parsed JWS ({header, payload, input, signature}) or null. Verifies no
 * signature.
 */
export function parseRelationEvent(jws,{now,audience}){
 const parsed=parseCompact(jws,{typ:RELATION_EVENT_TYP,maxBytes:RELATION_EVENT_MAX_BYTES,maxDepth:12});if(!parsed)return null;
 const e=parsed.payload,nowS=Math.floor(now/1000);
 if(!exact(e,MEMBERS)||e.bindle!=='relation-event'||e.v!==1||!originOk(e.iss)||typeof e.sub!=='string'||!UUID.test(e.sub)||e.aud!==audience)return null;
 if(typeof e.instance!=='string'||!e.instance||e.instance.length>512||!Number.isSafeInteger(e.aep)||e.aep<0||!Number.isSafeInteger(e.iat)||e.iat<nowS-RELATION_EVENT_PAST_S||e.iat>nowS+RELATION_EVENT_FUTURE_S)return null;
 if(typeof e.jti!=='string'||!JTI.test(e.jti)||!plain(e.events)||Object.keys(e.events).length!==1||!RELATION_EVENT_TYPES.includes(Object.keys(e.events)[0])||!plain(Object.values(e.events)[0]))return null;
 return parsed;
}
/** True when `key` ({kid, publicJwk}) verifies the parsed event. */
export const verifyRelationEvent=(parsed,key)=>verifyCompact(parsed,key?[key]:[]);

// A fixed dummy key and input: the step-2-failed and key-missing paths verify a real ECDSA signature of the same shape.
let dummy;
export async function dummyVerify(crypto=globalThis.crypto){
 dummy??=(async()=>{const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']),input=textEncoder.encode('bindle-relation-event-dummy');return {key:pair.publicKey,input,signature:new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,input)).map((b,i)=>i===0?b^1:b)};})();
 const {key,input,signature}=await dummy;try{await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,input);}catch{/* same cost either way */}
 return false;
}

/**
 * RL-6 delivery to an entity on another provider (the ORG-11a transport plugs in here; this is the port and its rule).
 * The endpoint comes ONLY from the validated manifest of the counterpart's CURRENT issuer (`current(origin)` follows the
 * successor index): `relations.v1.events_endpoint`, an https URL on that issuer's origin. Nothing received in a response,
 * a link or an event is ever used as a delivery target. `post(url, body, {contentType})` performs the SSRF-safe fetch.
 */
export function manifestEventDelivery({current=async p=>p,manifest,post}){
 if(typeof manifest!=='function'||typeof post!=='function')throw new TypeError('Event delivery needs manifest and post ports.');
 return async(to,jws)=>{
  const target=await current(to),issuer=target?.iss;if(!originOk(issuer))throw Object.assign(new Error('No current issuer.'),{code:'relation_delivery_unavailable'});
  const m=await manifest(issuer),endpoint=m?.features?.['relations.v1']?.events_endpoint;let url;try{url=new URL(endpoint);}catch{url=null;}
  if(!url||url.protocol!=='https:'||url.origin!==issuer||url.username||url.password||url.hash||url.href!==endpoint)throw Object.assign(new Error('No validated events endpoint.'),{code:'relation_delivery_unavailable'});
  return post(endpoint,jws,{contentType:RELATION_EVENT_MEDIA_TYPE});
 };
}

/** The introduction identifier: deduplicates per (instance, proposer, slot, candidate) (spec §9.9 step 6). */
export const introductionId=(instance,proposer,slot,candidate)=>digest(globalThis.crypto,JSON.stringify(['bindle-relation-introduction-v1',instance,proposer.iss,proposer.sub,slot,candidate.iss,candidate.sub]));

/** RelationService methods (installed on its prototype by relation-instances.mjs). `this` is the service. */
export const relationEventMethods={
 /** The sender's active certification key as already held (cache-only), or null. */
 async cachedKey(p,kid){try{const k=await this.counterparts.certificationKey?.({iss:p.iss,sub:p.sub,kid});return k?.publicJwk?{kid,publicJwk:k.publicJwk,...typeof k.identity==='string'?{identity:k.identity}:{}}:null;}catch{return null;}},
 /** Schedules one background key refresh for a claimed principal of a supported issuer (bounded queue). */
 async scheduleRefresh(tx,owner,p,now){if(this.foreign(p)&&!this.flag(owner,'ORG_FOREIGN_RELATIONS_ENABLED'))return false;try{return await this.refreshQueue(tx,p,{now,source:'claimed'});}catch{return false;}},
 /** The origin principal behind a presented (iss, sub): the local successor-index view, then the port. */
 async originOf(tx,p){const row=await tx.get(K.origin(p));if(row?.origin)return party(row.origin);try{const o=await this.successors?.origin?.(p);return validPrincipal(o)?party(o):party(p);}catch{return party(p);}},
 /** The current principal of an origin principal (after a counterpart's move). */
 async currentOf(tx,origin){const row=await tx.get(K.successor(origin));return row?.current?party(row.current):party(origin);},

 /** relations.ingest (system; the events endpoint). See the module header for the steps. */
 ingest(actor,input){return this.system(actor,async(r,now,tx)=>{
  const accepted={accepted:true},me=this.self(r.id),parsed=parseRelationEvent(input?.event,{now,audience:identityURI(me)});
  if(!parsed)fail('relation_event_invalid','Invalid relation event.',400);
  const e=parsed.payload,sender={iss:e.iss,sub:e.sub};
  const key=await this.cachedKey(sender,parsed.header.kid);if(!key)await this.scheduleRefresh(tx,r.id,sender,now);
  // Step 2 (no fetch).
  const origin=await this.originOf(tx,sender),current=await this.currentOf(tx,origin);
  const part=await tx.get(K.instance(e.instance)),cp=part?await tx.get(K.cp(e.instance,origin)):null;
  const counterpart=Boolean(samePrincipal(current,sender)&&part&&cp&&cp.state!=='ended');
  // Step 3 (cache-only key; the same work whatever step 2 decided).
  const signed=counterpart&&key&&(key.identity===undefined||key.identity===identityURI(sender))?await verifyRelationEvent(parsed,key):await dummyVerify();
  if(!counterpart||!signed)return accepted;
  // Step 4: recorded only now.
  if(await tx.get(K.jti(origin,e.jti)))return accepted;await tx.put(K.jti(origin,e.jti),{at:now});await tx.put(K.jtiAt(now,origin,e.jti),true);
  const received=e.events,[[type,payload]]=Object.entries(received),narrowing=narrowingEvent(received);
  // Step 5: the aep floor is per sender, across instances (review L9). A higher aep is an authority reset (RL-4).
  const floorRow=await tx.get(K.aep(origin)),floor=Math.max(floorRow?.aep??0,cp.peerAep??0);
  if(e.aep>floor){await tx.put(K.aep(origin),{aep:e.aep,at:now,...floorRow?{}:{baseline:true}});if(floorRow)await this.applyReset(tx,r,origin,{aep:e.aep,cause:'aep-increase'},now);}
  cp.peerAep=Math.max(floor,e.aep);
  if(!narrowing&&e.aep<floor){await tx.put(K.cp(e.instance,origin),cp);return accepted;}
  // C8: while a full hold is active nothing widening from that counterpart is honoured; narrowing always is.
  // Flags stop widening, never inbound revocation. Signature verification and the one 202 answer stay identical.
  if(!narrowing&&(!this.flag(r.id)||this.foreign(sender)&&!this.flag(r.id,'ORG_FOREIGN_RELATIONS_ENABLED'))){await tx.put(K.cp(e.instance,origin),cp);return accepted;}
  const hold=await this.activeHold(tx,origin,now);
  if(!narrowing&&hold?.kind==='full'){await tx.put(K.cp(e.instance,origin),cp);return accepted;}
  if(type===RELATION_EVENT.introduction){await tx.put(K.cp(e.instance,origin),cp);await this.receiveIntroduction(tx,r,part,cp,sender,payload,now);return accepted;}
  if(type===RELATION_EVENT.recognition){await tx.put(K.cp(e.instance,origin),cp);await this.receiveRecognition(tx,r,part,origin,payload,now);return accepted;}
  if(type!==RELATION_EVENT.edgeState&&type!==RELATION_EVENT.edgeEnded){await tx.put(K.cp(e.instance,origin),cp);return accepted;}// doorbells: forwarded by ORG-10f
  if(!['grant','acceptance'].includes(payload?.half)){await tx.put(K.cp(e.instance,origin),cp);return accepted;}
  const field=payload.half==='grant'?'peerGrant':'peerAcceptance',{changed,mirror}=applyMirror(cp[field],received,now);
  if(changed){cp[field]=mirror;
   // A counterpart's end is final, so my matching half can never be live again: end it too and say so.
   await this.endMatching(tx,r,cp,now);
   await this.settleCounterpart(tx,r,part,cp,now);
  }
  await tx.put(K.cp(e.instance,origin),cp);if(changed)await this.refreshImports(tx,part,cp,now,r);
  return accepted;
 });},

 /** relations.outbox-drain (system): signs and delivers queued rows. At least once; a failure backs off; a row past
  * the 72 h window is dropped (anti-entropy recovers it). Failures and successes keep the reachability record. */
 async drain(actor,{limit=64}={}){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  const now=this.clock.now(),me=this.self(actor.owner);
  const {rows,aep}=await this.metadata.transaction(async tx=>{if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
   const out=[];for(const [key,row] of await tx.list({prefix:'rel/outbox/',limit:Math.min(limit,BATCH)})){if(row.notBefore>now)break;out.push({key,row,to:row.kind?row.to:await this.currentOf(tx,row.to)});}
   return {rows:out,aep:(await tx.get('org/record-v1'))?.aep??0};});
  const done=[],retry=[],reached=new Map();let signer=null;
  for(const {key,row,to} of rows){
   if(this.foreign(to)&&!this.flag(actor.owner,'ORG_FOREIGN_RELATIONS_ENABLED')){retry.push({key,row});continue;}
   try{
    if(row.kind==='offer')await this.transport.offer(me,row.to,{meta:row.meta});
    else if(row.kind==='retract')await this.transport.retract(me,row.to,{jti:row.invitation});
    else{signer??=await this.certification?.(actor.owner);if(!signer?.kid||!signer.privateKey)throw new Error('certification key unavailable');
     const jws=await signRelationEvent(relationEventPayload({from:me,to,instance:row.instance,aep:Math.max(aep,row.aep??0),iat:Math.floor(this.clock.now()/1000),jti:row.jti,events:row.events}),signer);
     await this.transport.deliver(me,to,jws);reached.set(principalKey(row.to),{p:row.to,ok:true});}
    done.push(key);
   }catch{retry.push({key,row});if(!row.kind&&!reached.get(principalKey(row.to))?.ok)reached.set(principalKey(row.to),{p:row.to,ok:false});}
  }
  await this.metadata.transaction(async tx=>{for(const key of done)await tx.delete(key);
   for(const {key,row} of retry){await tx.delete(key);if(now-row.createdAt>OUTBOX_RETRY_MS)continue;row.attempts++;row.notBefore=now+Math.min(3600000,1000*2**Math.min(row.attempts,12));await tx.put(K.outbox(row.notBefore,row.seq),row);}
   for(const {p,ok} of reached.values()){const k=K.reach(p),old=await tx.get(k);if(ok){if(old)await tx.delete(k);}else await tx.put(k,{principal:party(p),since:old?.since??now,last:now,flagged:old?.flagged??false});}});
  return {delivered:done.length,pending:retry.length};
 },

 /** relations.resync (system): anti-entropy. Re-queues the latest state of every half this organization holds. */
 resync(actor,{after}={}){return this.system(actor,async(r,now,tx)=>{
  let n=0,last=null;const page=await tx.list({prefix:'rel/cp/',...after?{startAfter:after}:{},limit:BATCH});
  for(const [key,cp] of page){last=key;
   // An ended counterpart is re-told its final state for 72 h only (the same bound as deletion), then never again.
   if(cp.state==='ended'){if(now-(cp.endedAt??0)<OUTBOX_RETRY_MS)for(const kind of ['grant','acceptance']){await this.enqueue(tx,r,cp.principal,halfEvent(kind,{state:'ended'}),cp.instance);n++;}continue;}
   if(cp.state!=='live')continue;for(const kind of ['grant','acceptance'])if(cp[kind]&&cp[kind].state!=='pending'){await this.emitHalf(tx,r,cp,kind);n++;}}
  return {queued:n,next:page.size===BATCH?last:null};
 });},

 // ---- introductions and recognition (spec §9.4 proposals; design §8b.5, RL-11, RL-12) --------------------------
 /**
  * relations.introduce (proposal; flag, one unheld admin). RL-12: only for a candidate that holds a live edge with this
  * organization in the instance, in the slot named. Sent to each counterpart this organization has a live edge with
  * whose slot has access entries with that slot, never to the candidate. Confers nothing.
  */
 async introduce(actor,input){
  this.requireEnabled(actor);
  return this.orgs.frame(actor,input,['instance','slot','candidate'],async(r,v,now,m,tx)=>{
   if(typeof v.instance!=='string'||typeof v.slot!=='string'||!SLOT.test(v.slot)||!validPrincipal(v.candidate))fail('invalid_request','Unsupported relation request.',400);
   const part=await tx.get(K.instance(v.instance));if(part?.state!=='live')fail('not_found','Not found.',404);
   const doc=await this.docFor(tx,part.relation),ccp=await tx.get(K.cp(part.instance,v.candidate));
   if(!slotOf(doc,v.slot)||!ccp||ccp.slot!==v.slot||!(outgoingLive(part,ccp,now)||incomingLive(part,ccp)))fail('relation_introduction_invalid','Introduce only an organization you share a live edge with in this relation.',409);
   const recipients=[];
   for(const cp of await this.counterpartsOf(tx,part.instance)){if(samePrincipal(cp.principal,v.candidate)||!(outgoingLive(part,cp,now)||incomingLive(part,cp)))continue;
    if(edgeEntries(doc,cp.slot,v.slot).length||edgeEntries(doc,v.slot,cp.slot).length)recipients.push(cp);}
   if(!recipients.length)fail('relation_introduction_empty','Nobody in this relation would receive this introduction.',409);
   const me=this.self(r.id),id=await introductionId(part.instance,me,v.slot,v.candidate),statement=await this.statements.sign({org:r.id,party:me,instance:part.instance,relation:part.relation,slot:ccp.as});
   for(const cp of recipients)await this.enqueue(tx,r,cp.principal,{[RELATION_EVENT.introduction]:{slot:v.slot,candidate:party(v.candidate),statement}},part.instance);
   await tx.put(K.introduced(id),{v:1,id,instance:part.instance,slot:v.slot,candidate:party(v.candidate),recipients:recipients.map(cp=>party(cp.principal)),at:now,outcomes:{}});
   await this.orgs.audit(tx,r,'relation-introduced',actor,{instance:part.instance,slot:v.slot,candidate:party(v.candidate),recipients:recipients.length});
   this.orgs.notice(r,'relation-introduced',{instance:part.instance,slot:v.slot,candidate:party(v.candidate)},now);
   return {introduced:recipients.length};
  },{admin:true});
 },
 /** Receives an introduction (after spec §9.9 steps 1–5): queued for this organization's admins only. */
 async receiveIntroduction(tx,r,part,cp,sender,payload,now){
  if(!exact(payload,['slot','candidate','statement'])||typeof payload.slot!=='string'||!SLOT.test(payload.slot)||!validPrincipal(payload.candidate)||typeof payload.statement!=='string')return;
  if(!this.flag(r.id))return;// nothing is recorded or announced while relations are off (as for offers)
  const me=this.self(r.id),proposer=cp.principal,candidate=party(payload.candidate);
  if(samePrincipal(candidate,me)||samePrincipal(candidate,proposer)||this.foreign(candidate)||await tx.get(K.mute(proposer)))return;
  if(!(outgoingLive(part,cp,now)||incomingLive(part,cp))||await tx.get(K.cp(part.instance,candidate)))return;
  const doc=await this.docFor(tx,part.relation);if(!slotOf(doc,payload.slot)||!(edgeEntries(doc,cp.as,payload.slot).length||edgeEntries(doc,payload.slot,cp.as).length))return;
  // The proposer's fresh participation statement for this instance (verified only now, for a verified counterpart).
  const st=await this.statements.verify(payload.statement,{party:sender,mode:'presented',expect:{instance:part.instance,relation:part.relation}});if(!st)return;
  const id=await introductionId(part.instance,proposer,payload.slot,candidate);if(await tx.get(K.intro(id)))return;
  const day=Math.floor(now/DAY),count=(await tx.get(K.introDay(proposer,day)))??0;if(count>=RELATION_LIMITS.introductionsPerDay)return;
  let open=0;for(const [key,item] of await tx.list({prefix:'rel/inbound/',limit:RELATION_LIMITS.inbound+1}))if(item.expiresAt>now)open++;else await tx.delete(key);
  for(const [key,item] of await tx.list({prefix:'rel/intro/',limit:RELATION_LIMITS.inbound+1}))if(item.expiresAt>now)open++;else await tx.delete(key);
  if(open>=RELATION_LIMITS.inbound){const c=await this.counters(tx),today=Math.floor(now/DAY);if(c.fullNoticeDay!==today){c.fullNoticeDay=today;await tx.put(K.state,c);this.orgs.notice(r,'relation-inbound-full',{limit:RELATION_LIMITS.inbound},now);}return;}
  await tx.put(K.introDay(proposer,day),count+1);
  await tx.put(K.intro(id),{v:1,id,instance:part.instance,relation:part.relation,proposer:party(proposer),slot:payload.slot,candidate,receivedAt:now,expiresAt:now+INTRODUCTION_TTL_MS});
  this.orgs.notice(r,'relation-introduction-received',{introduction:id,instance:part.instance,proposer:party(proposer),slot:payload.slot,candidate},now);
 },
 /** Receives a recognition notice: honoured only from a recipient of an introduction this organization sent. */
 async receiveRecognition(tx,r,part,origin,payload,now){
  if(!exact(payload,['slot','candidate','outcome'])||typeof payload.slot!=='string'||!SLOT.test(payload.slot)||!validPrincipal(payload.candidate)||!['recognized','declined'].includes(payload.outcome))return;
  const id=await introductionId(part.instance,this.self(r.id),payload.slot,payload.candidate),row=await tx.get(K.introduced(id));
  if(!row||!row.recipients.some(p=>samePrincipal(p,origin))||row.outcomes[principalKey(origin)])return;
  row.outcomes[principalKey(origin)]=payload.outcome;await tx.put(K.introduced(id),row);
  this.orgs.notice(r,'relation-recognition',{instance:part.instance,from:party(origin),slot:payload.slot,candidate:party(payload.candidate),outcome:payload.outcome},now);
 },
 /** relations.introductions: pending introductions for this organization's admins. */
 introductions(actor){return this.adminRead(actor,async(r,tx)=>{const now=this.clock.now();return {items:[...(await tx.list({prefix:'rel/intro/',limit:RELATION_LIMITS.inbound})).values()].filter(i=>i.expiresAt>now).map(i=>({introduction:i.id,instance:i.instance,proposer:i.proposer,slot:i.slot,candidate:i.candidate,receivedAt:i.receivedAt,expiresAt:i.expiresAt}))};});},
 /** Drops an introduction item and tells only the proposer the outcome (spec §9.4: never the candidate). */
 async decideIntroduction(tx,r,item,outcome,now){
  await tx.delete(K.intro(item.id));
  const cp=await tx.get(K.cp(item.instance,item.proposer));
  if(cp&&cp.state!=='ended')await this.enqueue(tx,r,item.proposer,{[RELATION_EVENT.recognition]:{slot:item.slot,candidate:party(item.candidate),outcome}},item.instance);
 },
 /**
  * relations.admit (widening, step-up): recognizing an introduced candidate means issuing it a relation invitation
  * with this organization's own values (spec §9.4 admission). The introduction itself never creates an edge (C9).
  */
 async admit(actor,input){
  if(!plain(input)||typeof input.introduction!=='string'||!INTRO_ID.test(input.introduction))fail('invalid_request','Unsupported relation request.',400);
  const item=await this.adminRead(actor,(r,tx)=>tx.get(K.intro(input.introduction)));if(!item||item.expiresAt<=this.clock.now())fail('not_found','Not found.',404);
  const {introduction,...rest}=input;
  const out=await this.invite(actor,{...rest,instance:item.instance,slot:item.slot,invitee:item.candidate});
  await this.orgs.frame(actor,{},[],async(r,v,now,m,tx)=>{const current=await tx.get(K.intro(item.id));if(current)await this.decideIntroduction(tx,r,current,'recognized',now);await this.orgs.audit(tx,r,'relation-introduction-admitted',actor,{introduction:item.id,instance:item.instance,candidate:item.candidate});},{admin:true,exposure:false,exit:true});
  return out;
 },
};

// ---- engine operations ---------------------------------------------------------------------------------------------
const CHANGED='relations-changed';
export class IntroduceRelation extends AppAction{static operation='relations.introduce';static deps=['relations'];static changes=CHANGED;static entities=['organization'];run({relations}){return relations.introduce(this.actor,this.input);}}
export class AdmitRelationCandidate extends AppAction{static operation='relations.admit';static deps=['relations'];static changes=CHANGED;static entities=['organization'];run({relations}){return relations.admit(this.actor,this.input);}}
export class RelationIntroductions extends AppQuery{static operation='relations.introductions';static deps=['relations'];static refreshOn=[CHANGED];static entities=['organization'];static lifecycle='suspended';fetch({relations}){return relations.introductions(this.actor);}}
export const RELATION_EVENT_OPERATIONS=Object.freeze([IntroduceRelation,AdmitRelationCandidate,RelationIntroductions]);
