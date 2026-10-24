// ORG-12a/ORG-12c break-glass: an organization whose owner is gone (docs/architecture/organizations-design.md §12d;
// spec docs/spec/organizations.md rev 4.4 §3). 3sln.me provider policy. Provisional (coordinator), not signed off by the
// user, and unreviewed; every figure in BREAK_GLASS is revisable (§12d.11 BG-1 … BG-17).
//
// Engine-first: every rule runs in the organization's account single writer and commits through one record transaction
// (BreakGlassService extends OwnershipService, so transfer, lapse claim, break-glass and reinstatement share one guarded
// owner-change commit, OwnershipService#changeOwner). Port I/O (owner channels, the per-person claim ledger, Polar,
// identity accounts) happens OUTSIDE transactions; external effects leave through the durable ownership outbox
// (refunds through the existing drain lease, owner notices, ledger updates).
//
// Storage (organization account):
//   org/claim/<id>           the claim row (below); one claim is open at a time
//   org/record-v1            breakGlass:{id, state}|null (summary of the current or last claim)
//                            breakGlassMarks:{lockUntil, trackSUntil, noProceedUntil, counted:[{claim, at}], disputed:[channel id]}
//                            breakGlassContest:{claim, formerOwner, newOwner, t1, until, state:'window'|'open'|'closed'|'upheld'|'rejected'}|null
//                            authorityEpoch (raised once per effect or reinstatement, spec §3 rev 4.4)
// Claim row: {v, id, state, track:'A'|'S', causes[], frozen, owner, ownerAep, initiator, candidate, memberInitiated,
//   quorumRequired, candidacy, cosigners[], cosignChanges{}, category, statement, statementDigest, channels[],
//   adminDomains[], tokens[], createdAt, quorumAt, checkout, payment, paidAt, waitStartedAt, waitEndsAt, reminders[],
//   held:{enteredAt, ackAt, total}, objections[], disputes[], barredPairs[], proposal, decision, finalEndsAt,
//   counted, tier1At, closedReason, closedAt, effectiveAt, contest, log[]}
//
// Ports (constructor options, besides OwnershipService's), each with a seam the identity stream (ORG-12b) fills:
//   ownerChannels  {snapshot(owner, {org, at}) -> {status, lastInteractiveAt, channels:[{id, kind, enrolledAt, domain?}]},
//                   domains({org, principals}) -> [domain], notify(owner, {org, claim, event, channel, kind, abort?})
//                   -> {accepted}}. Channel ADDRESSES never cross this port; email `domain` is hashed on arrival.
//                   `ownerChannelsPort()` below is the in-memory implementation (tests, loopback).
//   claimLedger    {reserve(person, {org, claim, role, at}) -> {ok, reason?}, update(person, {org, claim, event, at})}
//                   the per-person limits (§12d.8), kept in each person's own account (BreakGlassService#breakGlassLedger,
//                   or `memoryClaimLedger()`).
// Inbound signals (system operations; never wire input): orgs.breakglass-liveness (an interactive owner sign-in or
// step-up), orgs.breakglass-security-change, orgs.breakglass-abort-token (after the public link route parsed a token),
// orgs.breakglass-resolve (an approved operator decision from the admin service), orgs.breakglass-file-recovery (ORG-12f).
import {OwnershipService,OWNERSHIP,ownerSubscription,heldSubscriptions} from './ownership.mjs';
import {ORG_RECORD} from './organizations.mjs';
import {organizationPowers} from './authority.mjs';
import {principalKey,samePrincipal,memberPowers} from './grants.mjs';
import {rosterOf,attachRoster} from './roster.mjs';
import {AppFault} from '../app/faults.mjs';

const DAY=86400000,HOUR=3600000;
export const BREAK_GLASS_FLAG='ORG_BREAK_GLASS_ENABLED';
/** Provisional figures (§12d.5 "Timeouts, in one place", §12d.8 rate limits; BG-2, BG-17). Revisable. */
export const BREAK_GLASS=Object.freeze({
 GATHER_MS:7*DAY,                 // quorum and candidacy, from T1
 PAYMENT_MS:7*DAY,                // payment, from quorum
 WAIT_A_MS:30*DAY,                // Track A wait from verified payment (BG-1)
 WAIT_S_MS:60*DAY,                // Track S wait from verified payment (effect still needs a support decision)
 REMINDERS_MS:Object.freeze([7*DAY,21*DAY]),
 REMINDER_BEFORE_MS:3*DAY,        // 72 h before effect
 ACK_MS:30*DAY,DECIDE_MS:60*DAY,HELD_TOTAL_MS:120*DAY,
 FINAL_MS:7*DAY,CONTEST_MS:90*DAY,MOVE_COOLING_MS:90*DAY,
 LOCK_MS:30*DAY,TRACK_S_AFTER_ABORT_MS:180*DAY,NO_PROCEED_AFTER_TIER1_MS:30*DAY,
 ADMIN_TENURE_MS:30*DAY,MEMBER_TENURE_MS:90*DAY,OWNER_QUIET_MS:30*DAY,CREDENTIAL_AGE_MS:7*DAY,
 YEAR_MS:365*DAY,ORG_COUNTED:3,PERSON_COUNTED:2,PERSON_UNPAID_STARTS:4,
 COSIGN_CHANGES_PER_DAY:10,RETRY_MS:HOUR,OPERATOR_APPROVAL_MS:3*DAY,
 STATEMENT_CHARS:2000,CHANNELS:16,TOKENS:512,TOKEN_RESERVE:64,TOKEN_FAILURES:64,LOG:256,DISPUTED_MEMORY:32,
 OWNER_NOTICES_PER_CLAIM:24,
 CHANNEL_ATTEMPTS:8,CHANNEL_DAYS_MS:7*DAY, // review R2-M1: a channel is undeliverable after 8 failed attempts over 7 days
 NOTICE_BOUND_MS:7*DAY,           // review R2-M1: a final claim whose notice was never accepted is held after this
 CONTEST_OPEN_MAX_MS:30*DAY,      // review R2: an undecided contest blocks lapse claims at most this long, then escalates      // review H1: non-critical owner notices per claim; critical ones always go out
 CATEGORIES:Object.freeze(['owner-deceased','owner-unreachable','owner-credentials-lost','other'])
});
export const BREAK_GLASS_OPEN=Object.freeze(['gathering','waiting','held','final']);
export const BREAK_GLASS_TERMINAL=Object.freeze(['effective','aborted','withdrawn','closed']);
const CLAIM='org/claim/',LEDGER='orgs/break-glass/',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,CHANNEL=/^[A-Za-z0-9_.:-]{1,128}$/;
const KINDS=['session','credential','email','push'];
const fail=(code='not_found',message='Not found.',status=409)=>{throw new AppFault(code,message,status);};
const party=p=>({iss:p?.iss??null,sub:p?.sub});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(value,names)=>{if(value===undefined)value={};if(!plain(value)||Object.keys(value).some(k=>!names.includes(k)))fail('invalid_request','Unsupported break-glass request.',400);return value;};
const isOpen=c=>BREAK_GLASS_OPEN.includes(c?.state);
const hex=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const sameHex=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;};
const secret=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
const pair=(a,b)=>[a,b].sort();
/** Review M4: the hash of the domain and of every parent suffix with at least two labels, so mail.acme.example matches
 * acme.example. Addresses never cross the port; only these hashes are stored. A public suffix such as co.uk can match
 * an unrelated domain, which only ever moves a claim to Track S (the safe direction). */
/** IDNA (UTS 46 via the URL parser) to the ASCII form, lowercase, without a trailing dot; null when invalid. */
const asciiDomain=domain=>{try{const host=new URL('http://'+String(domain).trim().replace(/\.$/,'')+'/').hostname;return /^[a-z0-9.-]+$/.test(host)&&host.includes('.')?host:null;}catch{return null;}};
const suffixHashes=async domain=>{const ascii=asciiDomain(domain);if(!ascii)return [];const labels=ascii.split('.').filter(Boolean),out=[];for(let i=0;i<=labels.length-2;i++)out.push(await hex(labels.slice(i).join('.')));return out;};
/** Owner notices that are always sent (never dropped for the per-claim cap, never refused for outbox capacity). */
const CRITICAL=new Set(['start','paid','remind','remind-72h','liveness','dispute','proceed','effect','abort','tier1','owner-active','withdraw','ineligible','lapse','unpaid','superseded','support-abort','expire','undelivered','contest']);
/** What admins and members see of a closure (review L8): never which owner proof or action ended it. */
const CANDIDATE_REFUSAL='That account cannot be the candidate. Candidates are active 3sln.me admins of at least 30 days.';
const publicReason=reason=>['owner-elevated','owner'].includes(reason)?'owner':reason;
const samePair=(x,y)=>Array.isArray(x)&&Array.isArray(y)&&x[0]===y[0]&&x[1]===y[1];

// ---- the transition table (§12d.5) -------------------------------------------------------------------------------
const same=c=>c.state;
/**
 * Event -> {t: table row(s), from: states, to: state or (claim, detail) -> state}. Guards that need the organization
 * (eligibility, quorum, proofs, operators) are the service's; this table is the shape every commit must follow.
 */
export const BREAK_GLASS_TRANSITIONS=Object.freeze({
 start:{t:'T1',from:[null],to:()=>'gathering'},
 accept:{t:'T2',from:['gathering'],to:same},
 cosign:{t:'T3',from:['gathering'],to:same},
 // A co-signature can be withdrawn until effect; one that leaves a required quorum short closes the claim (T16).
 uncosign:{t:'T3',from:BREAK_GLASS_OPEN,to:same},
 checkout:{t:'T4',from:['gathering'],to:same},
 paid:{t:'T5',from:['gathering'],to:c=>c.track==='A'?'waiting':'held'},
 lapse:{t:'T6',from:['gathering'],to:()=>'closed'},
 remind:{t:'T7',from:['waiting'],to:same},
 object:{t:'T8',from:BREAK_GLASS_OPEN,to:c=>c.state==='waiting'?'held':c.state},
 liveness:{t:'T9',from:BREAK_GLASS_OPEN,to:c=>['waiting','final'].includes(c.state)?'held':c.state},
 abort:{t:'T10',from:['gathering','waiting','held'],to:()=>'aborted'},
 // T11; also a tier-0 stop in a claim where tier 0 can no longer abort (see BreakGlassService#ownerStop).
 dispute:{t:'T11',from:['final','gathering','held'],to:c=>c.state==='final'?'held':c.state},
 tier1:{t:'T12',from:['final'],to:()=>'aborted'},
 'owner-active':{t:'T14',from:BREAK_GLASS_OPEN,to:()=>'aborted'},
 withdraw:{t:'T15',from:BREAK_GLASS_OPEN,to:()=>'withdrawn'},
 ineligible:{t:'T16',from:BREAK_GLASS_OPEN,to:()=>'closed'},
 superseded:{t:'T17',from:BREAK_GLASS_OPEN,to:()=>'closed'},
 freeze:{t:'T18',from:BREAK_GLASS_OPEN,to:same},
 unfreeze:{t:'T19',from:BREAK_GLASS_OPEN,to:same},
 acknowledge:{t:'T20',from:['held'],to:same},
 'support-abort':{t:'T21',from:['held'],to:()=>'aborted'},
 propose:{t:'T22',from:['held','effective'],to:same},
 proceed:{t:'T22',from:['held'],to:()=>'final'},
 expire:{t:'T23',from:['held'],to:()=>'closed'},
 effect:{t:'T24/T25',from:['waiting','final'],to:()=>'effective'},
 // Review M1: at the end of a Track A wait without a provider-accepted out-of-band notice (T1, T5, 72 h), hold for support.
 undelivered:{t:'T26',from:['waiting','final','gathering'],to:c=>c.state==='gathering'?'gathering':'held'},
 // Review H2: the claim's payment is gone (refunded, charged back, cancelled) before effect.
 unpaid:{t:'T16',from:['waiting','held','final'],to:()=>'closed'},
 contest:{t:'T27',from:['effective'],to:same},
 'contest-resolved':{t:'T27',from:['effective'],to:same}
});
/**
 * Pure: the claim after `event` at `now`. Throws `invalid_transition` for an event the table does not allow from the
 * claim's state (and never moves a terminal claim). `detail.reason` names a closure. Never mutates its input.
 */
export function breakGlassTransition(claim,event,now,detail={}){
 const row=BREAK_GLASS_TRANSITIONS[event];const from=claim?.state??null;
 if(!row||!row.from.includes(from))fail('invalid_transition','This break-glass step is not available now.',409);
 const next=structuredClone(claim??{});const to=row.to(next,detail);
 next.state=to;if(BREAK_GLASS_TERMINAL.includes(to)&&to!==from){next.closedAt=now;next.closedReason=detail.reason??event;}
 next.log=[...(next.log??[]),{event,t:row.t,from,to,at:now}].slice(-BREAK_GLASS.LOG);
 return next;
}

/** The digest the candidate echoes to prove they saw the checkout disclosure (§12d.6, BG-R1-M6). */
export async function breakGlassDisclosureDigest(r,c,{plan,currency,amount}){
 return hex(JSON.stringify(['bindle-org-break-glass-disclosure-v1',r.id,c.id,party(c.candidate),plan,currency,amount,'fresh-period','paid-period-runs-from-checkout','previous-payment-confers-nothing','owner-may-abort','contest-90-days','refund-full-unless-voluntary-withdrawal-less-processing-fee']));
}

/**
 * The per-person limits (§12d.8): one pending candidacy anywhere; at most PERSON_COUNTED counted claims and
 * PERSON_UNPAID_STARTS unpaid starts in 365 days, as initiator or candidate. Pure over that person's ledger rows
 * [{org, claim, role, state:'pending'|'ended', startedAt, countedAt|null}]. Returns null or a refusal code.
 */
export function ledgerDecision(rows,{org,claim,role},now){
 // A released row is a start that was refused before it existed; it never counts.
 const year=now-BREAK_GLASS.YEAR_MS,others=(rows??[]).filter(x=>!(x.org===org&&x.claim===claim)&&x.released!==true);
 if(role==='candidate'&&others.some(x=>x.role==='candidate'&&x.state==='pending'))return 'candidacy_pending';
 if(others.filter(x=>Number.isSafeInteger(x.countedAt)&&x.countedAt>year).length>=BREAK_GLASS.PERSON_COUNTED)return 'break_glass_person_limit';
 if(others.filter(x=>x.startedAt>year&&!Number.isSafeInteger(x.countedAt)).length>=BREAK_GLASS.PERSON_UNPAID_STARTS)return 'break_glass_start_limit';
 return null;
}
/** Applies a ledger update to one row (pure). `counted` marks it paid or owner-aborted; `uncounted` (an expired held
 * claim, BG-17) clears that; `ended` releases a pending candidacy. */
export function ledgerApply(row,{event,at}){
 const next={...row};if(event==='counted')next.countedAt??=at;else if(event==='uncounted')next.countedAt=null;else if(event==='ended')next.state='ended';else if(event==='released'){next.state='ended';next.released=true;}
 return next;
}
/** An in-memory claim ledger (tests and loopback): the same decision and update rules as the person-side operation. */
export function memoryClaimLedger(){
 const people=new Map(),rows=sub=>{if(!people.has(sub))people.set(sub,new Map());return people.get(sub);};
 return {people,
  async reserve(sub,{org,claim,role,at}){const mine=rows(sub),refusal=ledgerDecision([...mine.values()],{org,claim,role},at);if(refusal)return {ok:false,reason:refusal};const key=org+'/'+claim,prior=mine.get(key);mine.set(key,{org,claim,role:prior?.role==='candidate'?'candidate':role,state:'pending',startedAt:prior?.startedAt??at,countedAt:prior?.countedAt??null});return {ok:true};},
  async update(sub,{org,claim,event,at}){const mine=rows(sub),key=org+'/'+claim,row=mine.get(key);if(row)mine.set(key,ledgerApply(row,{event,at}));return {ok:true};}};
}
/**
 * The in-memory owner-channels port (tests, loopback demonstration): `owners` maps an owner sub to {status,
 * lastInteractiveAt, channels:[{id, kind, enrolledAt, domain?}]}; `domains` maps a party key (an org id or a person sub)
 * to the email domains it controls. Every notify call is recorded in `sent` (with the abort token, as a mail would carry
 * it). The production adapter is the identity stream's (ORG-12b, packages/identity/owner-channels.mjs).
 */
export function ownerChannelsPort({owners=new Map(),domainMap=new Map(),fail:failing=()=>false}={}){
 const sent=[];
 return {owners,domainMap,sent,
  async snapshot(owner){const o=owners.get(owner?.sub);return o?structuredClone(o):{status:'active',lastInteractiveAt:null,channels:[]};},
  async domains({org,principals=[]}){return [...new Set([...(domainMap.get(org)??[]),...principals.flatMap(p=>domainMap.get(p?.sub)??[])])];},
  async notify(owner,notice){if(failing(notice))return {accepted:false};sent.push({owner:owner.sub,...structuredClone(notice)});return {accepted:true};}};
}

/**
 * Operator assertions (review M3): the admin service signs, for one internal operator holding `support.org-break-glass`,
 * one decision scope {org, process, decision, exclude}, valid for 5 minutes, with a single-use nonce; the organization's
 * writer verifies it (OwnershipService#verifyOperator). HMAC-SHA-256 over a shared secret, plus a registry predicate
 * (`registered(operator)`) for the capability. The loopback and test implementation; ORG-12d supplies the production
 * signer and registry (a production gate: "verified operator identity").
 */
export function hmacOperatorAssertions({secret,registered=()=>false,clock=()=>Date.now(),ttlMs=OWNERSHIP.OPERATOR_ASSERTION_MS}={}){
 if(typeof secret!=='string'||secret.length<16)throw new TypeError('An operator assertion secret of at least 16 characters is required.');
 const b64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
 const unb64=text=>Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),ch=>ch.charCodeAt(0));
 const canon=scope=>JSON.stringify([scope?.org??null,scope?.kind??null,scope?.process??null,scope?.decision??null,[...(scope?.exclude??[])].sort()]);
 let key=null;const hmac=async text=>{key??=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)));};
 return {
  async sign({operator,scope}){const payload=b64(new TextEncoder().encode(JSON.stringify({v:1,operator,capability:'support.org-break-glass',scope:canon(scope),nonce:b64(crypto.getRandomValues(new Uint8Array(16))),expiresAt:clock()+ttlMs})));return payload+'.'+b64(await hmac(payload));},
  async verify({assertion,operator,scope,at}){
   if(typeof assertion!=='string'||assertion.length>2048)return {ok:false};const [payload,sig,...rest]=assertion.split('.');if(!payload||!sig||rest.length)return {ok:false};
   let expected,claims;try{expected=b64(await hmac(payload));claims=JSON.parse(new TextDecoder().decode(unb64(payload)));}catch{return {ok:false};}
   if(!sameHex(expected,sig)||claims?.v!==1||claims.operator!==operator||claims.capability!=='support.org-break-glass'||claims.scope!==canon(scope)||!Number.isSafeInteger(claims.expiresAt)||claims.expiresAt<=at||!registered(operator))return {ok:false};
   return {ok:true,operator,capability:claims.capability,nonce:claims.nonce,expiresAt:claims.expiresAt};
  }
 };
}

export class BreakGlassService extends OwnershipService{
 constructor(options){super(options);this.ownerChannels=options.ownerChannels??null;this.claimLedger=options.claimLedger??null;}
 /** ORG_BREAK_GLASS_ENABLED for this organization (requires ORGANIZATIONS_ENABLED). Gates starting a claim and its
  * effect only (§12d.12). */
 breakGlassEnabled(owner){if(!this.enabled(owner))return false;try{return this.flags?.for({subject:{kind:'account',owner}}).enabled(BREAK_GLASS_FLAG)===true;}catch{return false;}}
 ensure(r){super.ensure(r);r.breakGlass??=null;r.breakGlassMarks??={lockUntil:0,trackSUntil:0,noProceedUntil:0,counted:[],disputed:[]};r.breakGlassContest??=null;r.authorityEpoch??=0;return r;}

 // ---- storage ------------------------------------------------------------------------------------------------
 async claimOf(tx,r){const id=r.breakGlass?.id;if(typeof id!=='string')return null;return (await tx.get(CLAIM+id))??null;}
 async putClaim(tx,r,c){await tx.put(CLAIM+c.id,c);r.breakGlass={id:c.id,state:c.state};}
 /** One transition: the table, one audit entry, the stored row and the record summary (invariant I7). The audit entry
  * carries no statement text (only its digest), no channel addresses and no Track S cause (§12d.8). */
 async move(tx,r,c,event,now,actor,detail={}){
  const next=breakGlassTransition(c,event,now,detail);for(const k of Object.keys(c))delete c[k];Object.assign(c,next);
  await this.audit(tx,r,'organization-break-glass-'+event,actor??{kind:'system',principal:null},{claim:c.id,state:c.state,track:c.track,frozen:c.frozen===true,...detail.audit??{},...BREAK_GLASS_TERMINAL.includes(c.state)?{reason:publicReason(c.closedReason)}:{}});
  await this.putClaim(tx,r,c);return c;
 }

 // ---- eligibility --------------------------------------------------------------------------------------------
 /** An effective admin homed here, with ADMIN_TENURE_MS of admin before `since`, not the owner (§12d.3). */
 eligibleAdmin(r,m,since,now){
  if(!m||m.state!=='live'||m.hold||m.expires_at!==undefined||samePrincipal(m.principal,r.ownerOfRecord))return false;
  if((m.principal.iss??null)!==(this.issuer??null)||!memberPowers(m,now).includes('admin'))return false;
  return m.grants.some(g=>g.power==='admin'&&g.expires_at===undefined&&(g.notBefore??0)<=now&&Number.isSafeInteger(g.grantedAt)&&g.grantedAt<=since-BREAK_GLASS.ADMIN_TENURE_MS);
 }
 /** A live member homed here with MEMBER_TENURE_MS (member-initiated claims, only when no admin is effective). */
 eligibleMember(r,m,since,now){return Boolean(m&&m.state==='live'&&!m.hold&&m.expires_at===undefined&&!samePrincipal(m.principal,r.ownerOfRecord)&&(m.principal.iss??null)===(this.issuer??null)&&Number.isSafeInteger(m.createdAt)&&m.createdAt<=since-BREAK_GLASS.MEMBER_TENURE_MS);}
 async eligibleAdmins(r,since,now){return (await rosterOf(r).admins()).filter(m=>this.eligibleAdmin(r,m,since,now));}
 async effectiveAdmins(r,now){return (await rosterOf(r).admins()).filter(m=>!samePrincipal(m.principal,r.ownerOfRecord)&&memberPowers(m,now).includes('admin'));}
 /** The distinct eligible admins currently signing: the initiator, the candidate once accepted, and co-signers. */
 async signers(r,c,now){
  const roster=rosterOf(r),out=new Set(),add=async p=>{const m=await roster.principal(p);if(this.eligibleAdmin(r,m,c.createdAt,now))out.add(principalKey(p));};
  await add(c.initiator);if(c.candidacy)await add(c.candidate);for(const s of c.cosigners)await add(s.principal);
  return out;
 }
 async quorumMet(r,c,now){return !c.quorumRequired||(await this.signers(r,c,now)).size>=2;}
 /** The candidate is still eligible: a live, unheld member (an admin unless member-initiated) with no authority reset. */
 async candidateEligible(r,c,now){
  const m=await rosterOf(r).principal(c.candidate);if(!m||m.state!=='live'||m.hold||m.aep!==c.candidateAep)return false;
  return c.memberInitiated?this.eligibleMember(r,m,c.createdAt,now)||this.eligibleAdmin(r,m,c.createdAt,now):this.eligibleAdmin(r,m,c.createdAt,now);
 }
 /** Out-of-band owner channels: a push subscription, or a confirmed email whose domain no signing party controls. */
 outOfBand(c){return c.channels.filter(ch=>ch.kind==='push'||ch.kind==='email'&&!(ch.domainHashes??[]).some(h=>c.adminDomains.includes(h)));}
 /** Moves a claim to Track S (one way) and remembers why, for operators only (BG-R1-M4). */
 toTrackS(c,cause){if(!c.causes.includes(cause))c.causes.push(cause);c.track='S';}
 /** The owner proof a session carries for claim `c` (§12d.3): 1 (elevated), 0 (known channel) or null. */
 ownerTier(r,c,actor,now){
  const v=actor?.verification??{},m=r.memberships?.[principalKey(c.owner)];
  const stepUp=Number.isSafeInteger(v.stepUpAt)&&v.stepUpAt<=now&&v.stepUpAt+OWNERSHIP.STEP_UP_MS>now;
  const aged=Number.isSafeInteger(v.enrolledAt)&&v.enrolledAt>=0&&v.enrolledAt<=c.createdAt-BREAK_GLASS.CREDENTIAL_AGE_MS;
  const noReset=m?.aep===c.ownerAep&&!(Number.isSafeInteger(v.authorityResetAt)&&v.authorityResetAt>c.createdAt);
  if(stepUp&&aged&&noReset)return 1;
  const knownSession=Number.isSafeInteger(v.sessionCreatedAt)&&v.sessionCreatedAt<c.createdAt;
  const knownCredential=stepUp&&Number.isSafeInteger(v.enrolledAt)&&v.enrolledAt>=0&&v.enrolledAt<c.createdAt;
  return knownSession||knownCredential?0:null;
 }
 limitsRefusal(r,now){
  const marks=r.breakGlassMarks;
  if(marks.lockUntil>now)return 'break_glass_locked';
  if(marks.counted.filter(x=>x.at>now-BREAK_GLASS.YEAR_MS).length>=BREAK_GLASS.ORG_COUNTED)return 'break_glass_limit';
  return null;
 }
 /** Another ownership process pending (§12d.2 "Racing ownership processes"); the lapse claim and transfer ask here. */
 ownershipBusy(r){if(isOpen(r?.breakGlass))return 'break_glass_pending';if(r&&this.contestActive(r,this.clock.now()))return 'contest_window';return null;}
 otherProcess(r){
  if(r.transfer&&['offered','paid'].includes(r.transfer.state))return 'transfer_pending';
  if(r.billing?.claim?.state==='pending')return 'claim_pending';
  if(isOpen(r.breakGlass))return 'break_glass_pending';
  // Review H3: no new ownership process while the former owner can still contest the last change.
  if(this.contestActive(r,this.clock.now()))return 'contest_window';
  if(r.fileRecovery?.state==='pending')return 'file_recovery_pending';
  if(r.state!=='active')return 'organization_deletion_pending';
  return null;
 }
 /** The contest window's restrictions apply until it closes, and while a contest opened in it is undecided. */
 // Review R2: an undecided contest keeps the restrictions at most until the window ends or CONTEST_OPEN_MAX_MS after it
 // opened, whichever is later; it is escalated to operators (advanceExtra) and stays decidable.
 contestActive(r,now){const k=r.breakGlassContest;return Boolean(k&&(k.state==='window'&&now<k.until||k.state==='open'&&now<Math.max(k.until,(k.openedAt??0)+BREAK_GLASS.CONTEST_OPEN_MAX_MS)));}

 // ---- notices --------------------------------------------------------------------------------------------------
 /** Notices to every admin and the named parties (the member outbox), and one owner-notice outbox row carrying a fresh
  * single-use abort token for every email and push channel while the claim is open (§12d.8). Excluded channels get
  * notices too. Tokens are stored hashed on the claim; the raw token leaves only through the owner-channels port. */
 async notify(tx,r,c,event,now,{owner=true,parties=[]}={}){
  const roster=rosterOf(r),ids=[];for(const p of [c.candidate,c.initiator,...parties])if(p){const m=await roster.principal(p);if(m)ids.push(m.id);}
  this.ownershipNotice(r,'break-glass-'+event,{claim:c.id,state:c.state==='held'?'held-for-support':['aborted','withdrawn','closed'].includes(c.state)?'closed':c.state,earliestEffectAt:this.earliestEffect(c)},now,{members:ids});
  if(!owner)return;
  const critical=CRITICAL.has(event);c.noticeRows??=0;
  if(!critical&&c.noticeRows>=BREAK_GLASS.OWNER_NOTICES_PER_CLAIM)return;
  // Review L7: ordinary notices leave TOKEN_RESERVE tokens for final notices, so objection spam cannot exhaust them.
  const tokenCap=event==='proceed'?BREAK_GLASS.TOKENS:BREAK_GLASS.TOKENS-BREAK_GLASS.TOKEN_RESERVE;
  const channels=[];
  for(const ch of c.channels){
   const row={channel:ch.id,kind:ch.kind};
   if(isOpen(c)&&['email','push'].includes(ch.kind)&&c.tokens.length<tokenCap){const id=this.random.uuid(),raw=secret();c.tokens.push({id,channel:ch.id,hash:await hex(raw),issuedAt:now,usedAt:null});row.abort=`bg1.${c.id}.${id}.${raw}`;}
   channels.push(row);
  }
  c.noticeRows++;this.outbox(r,'owner-notice',{claim:c.id,owner:party(c.owner),event,channels},now,{critical});await this.putClaim(tx,r,c);
 }
 earliestEffect(c){
  if(c.state==='waiting')return c.waitEndsAt??null;
  if(c.state==='final')return Math.max(c.finalEndsAt??0,(c.paidAt??0)+BREAK_GLASS.WAIT_S_MS);
  return null;
 }
 ledger(r,c,event,now){for(const p of new Set([c.initiator.sub,c.candidate.sub]))this.outbox(r,'ledger',{person:p,claim:c.id,event},now,{critical:true});}

 // ---- ending a claim -------------------------------------------------------------------------------------------
 async end(...args){
  // MembershipService#end(r, m, actor, reason, now, tx): during a contest window the former owner's membership cannot
  // be removed or expire (BG-R1-M3); leaving is theirs to choose.
  const [r,m,,reason]=args,now=args[4];
  if(m&&reason!=='left'&&this.contestActive(r,now)&&samePrincipal(m.principal,r.breakGlassContest.formerOwner))fail('contest_window','The former owner’s membership cannot be removed while they can contest the ownership change.',409);
  return super.end(...args);
 }
 /**
  * Ends an open claim through `event` (abort, withdraw, closures). A verified payment is refunded exactly once through
  * the ownership drain (invariant I4): in full, except a VOLUNTARY withdrawal, which keeps the processing fee (§12d.6,
  * BG-17). `lock` (an owner or support abort) locks new claims for LOCK_MS; `ownerAbort` also counts the claim and sends
  * claims in the next TRACK_S_AFTER_ABORT_MS to support. `uncount` (an expired held claim) never counts or locks.
  */
 async finishClaim(tx,r,c,event,now,actor,{reason,voluntary=false,lock=false,ownerAbort=false,uncount=false,audit}={}){
  await this.move(tx,r,c,event,now,actor,{reason,audit});
  const marks=r.breakGlassMarks;
  if(c.payment&&r.billing.handled[c.payment.subscriptionId]!=='refund'){
   r.billing.handled[c.payment.subscriptionId]='refund';
   this.outbox(r,'refund',{subscriptionId:c.payment.subscriptionId,orderId:c.payment.orderId,reason:'break-glass-'+(reason??event),...voluntary?{retainProcessingFee:true}:{}},now,{critical:true});
   c.refund={at:now,retainProcessingFee:voluntary};await this.putClaim(tx,r,c);
  }
  if(ownerAbort&&!c.counted){c.counted=true;marks.counted.push({claim:c.id,at:now});await this.putClaim(tx,r,c);this.ledger(r,c,'counted',now);}
  if(uncount&&c.counted){c.counted=false;marks.counted=marks.counted.filter(x=>x.claim!==c.id);await this.putClaim(tx,r,c);this.ledger(r,c,'uncounted',now);}
  if(lock)marks.lockUntil=Math.max(marks.lockUntil,now+BREAK_GLASS.LOCK_MS);
  if(ownerAbort)marks.trackSUntil=Math.max(marks.trackSUntil,now+BREAK_GLASS.TRACK_S_AFTER_ABORT_MS);
  marks.counted=marks.counted.filter(x=>x.at>now-BREAK_GLASS.YEAR_MS);
  this.ledger(r,c,'ended',now);
  // Review L1: abort links for an ended claim are useless; erase any still waiting in the outbox.
  // Review R2-L2: earlier undelivered notices of an ended claim are dropped (the closing notice below replaces them).
  for(const e of r.ownershipOutbox)if(e.kind==='owner-notice'&&e.claim===c.id){if(Array.isArray(e.channels))e.channels=e.channels.map(({abort,...ch})=>ch);if(!e.doneAt){e.doneAt=now;e.dropped=true;}}
  await this.notify(tx,r,c,event,now);
  return c;
 }

 // ---- T1 start ---------------------------------------------------------------------------------------------------
 /**
  * T1. An eligible admin (or, when no admin is effective, an eligible member who is also the candidate) starts a claim
  * naming a candidate, a reason category and a statement. Gated by ORG_BREAK_GLASS_ENABLED; not_found otherwise.
  */
 async breakGlassStart(actor,input){
  const v=exact(input,['candidate','category','statement','confirm']);
  if(v.confirm!==true)fail('review_required','Review the claim before starting it.',400);
  if(!plain(v.candidate)||typeof v.candidate.sub!=='string'||!UUID.test(v.candidate.sub)||Object.keys(v.candidate).some(k=>!['iss','sub'].includes(k)))fail('invalid_request','Name the candidate.',400);
  if(!BREAK_GLASS.CATEGORIES.includes(v.category))fail('invalid_request','Choose a reason category.',400);
  if(typeof v.statement!=='string'||!v.statement.trim()||[...v.statement].length>BREAK_GLASS.STATEMENT_CHARS||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v.statement))fail('invalid_statement','Give a statement of at most 2,000 characters.',400);
  if(!this.breakGlassEnabled(actor?.owner))fail('not_found','Not found.',404);
  if(!this.ownerChannels||!this.claimLedger)fail('break_glass_unavailable','Break-glass is not available on this host.',503);
  const now=this.clock.now();this.freshStepUp(actor,now);
  const candidate={iss:v.candidate.iss??actor.principal.iss??this.issuer??null,sub:v.candidate.sub},self=samePrincipal(candidate,actor.principal);
  if(self&&this.tight(actor,now))fail('candidate_ineligible',CANDIDATE_REFUSAL,409);
  let account=null;try{account=await this.accounts?.get(candidate.sub);}catch{account=null;}
  // Review R2-L1: every eligibility check, and the uniform candidate answer, runs BEFORE anything is written anywhere
  // (no ledger reservation in another person's account for an ineligible initiator).
  const pre=await this.metadata.transaction(async tx=>{const r=this.ensure(await this.organization(tx,actor,{}));await attachRoster(tx,r,[candidate]);await this.startEligibility(r,actor,candidate,account,self,now);return r;});
  const snapshot=await this.ownerChannels.snapshot(party(pre.ownerOfRecord),{org:pre.id,at:now});
  const domains=await this.ownerChannels.domains({org:pre.id,principals:[actor.principal,candidate]});
  const id=this.random.uuid(),reserved=[];
  try{
   for(const [p,role] of [[candidate,'candidate'],...self?[]:[[actor.principal,'initiator']]]){
    // The initiator is eligible by now, so a ledger refusal may say why (one pending candidacy, yearly limits).
    const result=await this.claimLedger.reserve(p.sub,{org:pre.id,claim:id,role,at:now});if(!result?.ok)fail(['candidacy_pending','break_glass_person_limit','break_glass_start_limit'].includes(result?.reason)?result.reason:'break_glass_unavailable','You cannot take part in another break-glass claim now.',429);reserved.push(p.sub);
   }
   const statementDigest=await hex(v.statement.trim()),channels=await this.channelsOf(snapshot,now),adminDomains=[...new Set((await Promise.all(domains.filter(d=>typeof d==='string').slice(0,64).map(suffixHashes))).flat())];
   return await this.act(actor,{},[],async(r,_,now,tx,powers)=>{
    const {memberInitiated,eligible,cand}=await this.startEligibility(r,actor,candidate,account,self,now);
    const c={v:1,id,org:r.id,state:null,track:'A',causes:[],frozen:false,owner:party(r.ownerOfRecord),ownerAep:r.memberships[principalKey(r.ownerOfRecord)]?.aep??0,
     initiator:party(actor.principal),candidate:party(candidate),candidateAep:cand?.aep??0,memberInitiated,quorumRequired:!memberInitiated&&eligible.length>=2,candidacy:null,cosigners:[],cosignChanges:{},
     category:v.category,statement:v.statement.trim(),statementDigest,channels,adminDomains,tokens:[],tokenFailures:0,createdAt:now,quorumAt:null,checkout:null,payment:null,paidAt:null,
     waitStartedAt:null,waitEndsAt:null,reminders:[],held:null,heldTotal:0,objections:[],disputes:[],barredPairs:[],proposal:null,decision:null,finalEndsAt:null,counted:false,tier1At:null,contest:null,log:[],
     ownerStatus:snapshot?.status==='active'?'active':String(snapshot?.status??'unknown').slice(0,32),ownerLastInteractiveAt:Number.isSafeInteger(snapshot?.lastInteractiveAt)?snapshot.lastInteractiveAt:null};
    // Track S triggers at T1 (§12d.4). The causes are kept for operators and the owner only.
    if(!c.quorumRequired)this.toTrackS(c,memberInitiated?'member-initiated':'single-admin');
    if(c.ownerStatus!=='active')this.toTrackS(c,'owner-account');
    if(!this.outOfBand(c).length)this.toTrackS(c,'no-out-of-band-channel');
    // Review L2: unknown activity is no evidence of absence.
    if(c.ownerLastInteractiveAt===null||c.ownerLastInteractiveAt>now-BREAK_GLASS.OWNER_QUIET_MS)this.toTrackS(c,'recent-owner-sign-in');
    if(r.breakGlassMarks.trackSUntil>now)this.toTrackS(c,'recent-owner-abort');
    if(r.breakGlass?.id){const prior=await tx.get(CLAIM+r.breakGlass.id);if(prior)for(const d of prior.disputes??[])this.rememberDisputed(r,d.channel);}
    await this.move(tx,r,c,'start',now,actor,{audit:{category:c.category,statementDigest,initiator:c.initiator,candidate:c.candidate}});
    if(self){c.candidacy={acceptedAt:now};await this.move(tx,r,c,'accept',now,actor);}
    await this.checkQuorum(r,c,now);await this.putClaim(tx,r,c);
    // Invariant I6: notices to every recorded owner channel are enqueued at T1, long before any wait starts.
    await this.notify(tx,r,c,'start',now);
    return {claim:await this.claimView(r,c,actor,now)};
   },{exposure:false});
  }catch(error){for(const sub of reserved){try{await this.claimLedger.update(sub,{org:pre.id,claim:id,event:'released',at:now});}catch{/* an orphan pending row ends with the claim id that never existed */}}throw error;}
 }
 /** T1 eligibility, shared by the pre-check and the start commit. Order matters (review L8, R2-L1): the owner, then the
  * initiator (not_found when ineligible), then the uniform candidate answer, then pending processes and limits. */
 async startEligibility(r,actor,candidate,account,self,now){
  if(samePrincipal(candidate,r.ownerOfRecord)||samePrincipal(actor.principal,r.ownerOfRecord))fail('invalid_decision','The owner cannot start a break-glass claim.',409);
  const roster=rosterOf(r),initiator=await roster.principal(actor.principal),cand=await roster.principal(candidate);
  const effective=await this.effectiveAdmins(r,now),eligible=await this.eligibleAdmins(r,now,now);
  let memberInitiated=false;
  if(!this.eligibleAdmin(r,initiator,now,now)){
   if(effective.length===0&&self&&this.eligibleMember(r,initiator,now,now))memberInitiated=true;
   else fail('not_found','Not found.',404);
  }
  // Review L8: one answer for every unusable candidate (unknown, not a person, inactive, foreign or not eligible).
  if(account?.kind!=='person'||account.status!=='active'||!memberInitiated&&!this.eligibleAdmin(r,cand,now,now))fail('candidate_ineligible',CANDIDATE_REFUSAL,409);
  const busy=this.otherProcess(r);if(busy)fail(busy,'Another ownership process is pending.',409);
  const limit=this.limitsRefusal(r,now);if(limit)fail(limit,limit==='break_glass_locked'?'A recent claim was stopped; a new one is possible later.':'This organization has reached the yearly claim limit.',429);
  // Review R2-L2: a new claim is refused while the ownership outbox is backed up (aborts never are).
  if(r.ownershipOutbox.filter(e=>!e.doneAt).length>=OWNERSHIP.OUTBOX_PENDING_MAX)fail('ownership_outbox_full','Ownership effects need operator attention.',503);
  return {memberInitiated,eligible,cand};
 }
 async channelsOf(snapshot,now){
  const out=[];for(const ch of Array.isArray(snapshot?.channels)?snapshot.channels:[]){
   if(!plain(ch)||typeof ch.id!=='string'||!CHANNEL.test(ch.id)||!KINDS.includes(ch.kind)||!Number.isSafeInteger(ch.enrolledAt)||ch.enrolledAt>=now||out.some(x=>x.id===ch.id))continue;
   out.push({id:ch.id,kind:ch.kind,enrolledAt:ch.enrolledAt,excluded:false,...ch.kind==='email'&&typeof ch.domain==='string'&&ch.domain?{domainHashes:await suffixHashes(ch.domain)}:{}});
   if(out.length>=BREAK_GLASS.CHANNELS)break;
  }
  return out;
 }
 rememberDisputed(r,channel){const d=r.breakGlassMarks.disputed;if(!d.includes(channel))d.push(channel);r.breakGlassMarks.disputed=d.slice(-BREAK_GLASS.DISPUTED_MEMORY);}
 async checkQuorum(r,c,now){if(c.state==='gathering'&&c.candidacy&&await this.quorumMet(r,c,now)){c.quorumAt??=now;}else if(c.state==='gathering'&&!c.payment)c.quorumAt=null;}

 // ---- frames ---------------------------------------------------------------------------------------------------
 /** An owner-route frame on the open claim named `claim`. Never gated by ORG_BREAK_GLASS_ENABLED or
  * ORGANIZATIONS_ENABLED (aborts, withdrawals and objections are the safe direction, invariant I10). */
 onClaim(actor,input,names,fn){
  const v=exact(input,['claim',...names]);if(typeof v.claim!=='string'||!UUID.test(v.claim))fail('not_found','Not found.',404);
  return this.act(actor,{},[],async(r,_,now,tx,powers)=>{
   const c=await this.claimOf(tx,r);if(!c||c.id!==v.claim)fail('not_found','Not found.',404);
   return fn(r,c,v,now,tx,powers);
  },{exit:true,exposure:false});
 }
 /** System frame (inbound signals and operator decisions). */
 onSystem(actor,fn){return this.commit(actor,async(r,now,tx)=>fn(r,await this.claimOf(tx,r),now,tx));}

 // ---- T2, T3, T4 ---------------------------------------------------------------------------------------------------
 /** T2: the candidate accepts with P18 items 1–2 (a credential at least 7 days old, no security change in 30 days). */
 breakGlassAccept(actor,input){return this.onClaim(actor,input,[],async(r,c,v,now,tx)=>{
  if(!samePrincipal(actor.principal,c.candidate)||c.state!=='gathering')fail('not_found','Not found.',404);
  if(this.tight(actor,now))fail('candidate_ineligible','Your account had a security change in the last 30 days.',409);
  if(!await this.candidateEligible(r,c,now))fail('candidate_ineligible','You cannot be the candidate now.',409);
  if(!c.candidacy){c.candidacy={acceptedAt:now};await this.move(tx,r,c,'accept',now,actor);}
  await this.checkQuorum(r,c,now);await this.putClaim(tx,r,c);await this.notify(tx,r,c,'accept',now,{owner:false});
  return {claim:await this.claimView(r,c,actor,now)};
 });}
 cosignBudget(c,actor,now){const key=principalKey(actor.principal),list=(c.cosignChanges[key]??[]).filter(t=>t>now-DAY);if(list.length>=BREAK_GLASS.COSIGN_CHANGES_PER_DAY)fail('cosign_limit','Too many co-signature changes today.',429);c.cosignChanges[key]=[...list,now];}
 /** T3: an eligible admin co-signs. An email channel on a domain that co-signer controls stops counting as out of band
  * (BG-R1-H2), which may move the claim to Track S. */
 async breakGlassCosign(actor,input){
  const v=exact(input,['claim']);const now0=this.clock.now();this.freshStepUp(actor,now0);
  let hashes=[];if(this.ownerChannels){try{hashes=[...new Set((await Promise.all((await this.ownerChannels.domains({org:actor.owner,principals:[actor.principal]})).filter(d=>typeof d==='string').slice(0,16).map(suffixHashes))).flat())];}catch{fail('break_glass_unavailable','Break-glass is not available right now.',503);}}
  return this.onClaim(actor,v,[],async(r,c,_,now,tx)=>{
   if(c.state!=='gathering')fail('not_found','Not found.',404);
   const m=await rosterOf(r).principal(actor.principal);if(!this.eligibleAdmin(r,m,c.createdAt,now)||samePrincipal(actor.principal,c.initiator)||samePrincipal(actor.principal,c.candidate))fail('not_found','Not found.',404);
   if(c.cosigners.some(s=>samePrincipal(s.principal,actor.principal)))return {claim:await this.claimView(r,c,actor,now)};
   this.cosignBudget(c,actor,now);c.cosigners.push({principal:party(actor.principal),at:now});
   for(const h of hashes)if(!c.adminDomains.includes(h))c.adminDomains.push(h);
   if(c.track==='A'&&!this.outOfBand(c).length)this.toTrackS(c,'no-out-of-band-channel');
   await this.move(tx,r,c,'cosign',now,actor);await this.checkQuorum(r,c,now);await this.putClaim(tx,r,c);await this.notify(tx,r,c,'cosign',now,{owner:false});
   return {claim:await this.claimView(r,c,actor,now)};
  });
 }
 /** T3/T16: a co-signer withdraws (until effect). A required quorum left short after payment closes the claim. */
 breakGlassUncosign(actor,input){return this.onClaim(actor,input,[],async(r,c,v,now,tx)=>{
  const i=c.cosigners.findIndex(s=>samePrincipal(s.principal,actor.principal));if(i<0||!isOpen(c))fail('not_found','Not found.',404);
  this.cosignBudget(c,actor,now);c.cosigners.splice(i,1);await this.move(tx,r,c,'uncosign',now,actor);
  if(c.state==='gathering')await this.checkQuorum(r,c,now);
  // Review L5: a co-signer who withdraws after payment chose to end it, so the processing fee is kept (as for a withdrawal).
  if(c.state!=='gathering'&&!await this.quorumMet(r,c,now))await this.finishClaim(tx,r,c,'ineligible',now,{kind:'system',principal:null},{reason:'quorum-withdrawn',voluntary:true});
  else{await this.putClaim(tx,r,c);await this.notify(tx,r,c,'uncosign',now,{owner:false});}
  return {claim:await this.claimView(r,c,actor,now)};
 });}
 /** T4: the candidate gets a checkout with purpose `break-glass` bound to the claim, for the organization's current
  * plan, after echoing the disclosure digest. P18 is rechecked. Gated: a start-side step. */
 async breakGlassCheckout(actor,input){
  const v=exact(input,['claim','currency','locale','disclosure','confirm','plan']);
  if(v.confirm!==true||typeof v.disclosure!=='string'||!/^[a-f0-9]{64}$/.test(v.disclosure))fail('review_required','Review the disclosure before paying.',400);
  if(!this.breakGlassEnabled(actor?.owner))fail('not_found','Not found.',404);
  if(!this.billingConfigured())fail('billing_unavailable','Organization billing is not available on this host.',503);
  const now=this.clock.now();if(this.tight(actor,now))fail('candidate_ineligible','Your account had a security change in the last 30 days.',409);
  const pre=this.ensure(await this.load([actor.principal])??fail()),c0=await this.metadata.get(CLAIM+(pre.breakGlass?.id??'none'));
  if(!c0||c0.id!==v.claim||c0.state!=='gathering'||!samePrincipal(actor.principal,c0.candidate)||!c0.candidacy)fail('not_found','Not found.',404);
  const plan=this.claimPlan(pre,now,v.plan);const pricing=await this.billing.plans(v.currency??'usd'),entry=pricing.plans.find(p=>p.id===plan);if(!entry)fail('billing_provider_unavailable','The plan price is unavailable.',503);
  if(await breakGlassDisclosureDigest(pre,c0,{plan,currency:entry.price.currency,amount:entry.price.amount})!==v.disclosure)fail('disclosure_changed','The plan or price changed. Review the disclosure again.',409);
  const prior=c0.checkout;if(prior&&prior.plan===plan&&prior.currency===entry.price.currency&&prior.expiresAt>now+5*60000)return {checkout:{url:prior.url,server:'sandbox'}};
  const checkout=await this.billing.checkout(pre.id,{owner:actor.principal.sub,plan,currency:entry.price.currency,purpose:'break-glass',binding:c0.id,returnPath:'/console?org_break_glass='+pre.id,locale:v.locale});
  return this.onClaim(actor,{claim:v.claim},[],async(r,c,_,now,tx)=>{
   if(c.state!=='gathering'||!samePrincipal(actor.principal,c.candidate)||!c.candidacy)fail('not_found','Not found.',404);
   if(!await this.quorumMet(r,c,now))fail('quorum_required','Two eligible admins must sign before payment.',409);
   if(!await this.candidateEligible(r,c,now))fail('candidate_ineligible','You cannot be the candidate now.',409);
   c.checkout={checkoutId:checkout.checkoutId,url:checkout.url,plan,currency:entry.price.currency,amount:entry.price.amount,createdAt:now,expiresAt:checkout.expiresAt};
   await this.move(tx,r,c,'checkout',now,actor,{audit:{plan,checkout:checkout.checkoutId}});return {checkout:{url:checkout.url,server:'sandbox'}};
  });
 }
 claimPlan(r,now,requested){const current=ownerSubscription(r,now)?.plan??(['org-team','org-business','org-scale'].includes(r.plan?.plan)?r.plan.plan:null),plan=current??requested;if(!['org-team','org-business','org-scale'].includes(plan)||current&&requested!==undefined&&requested!==current)fail('invalid_plan','The claim uses the organization’s current plan.',400);return plan;}

 // ---- T5 payment (ORG-12c) ---------------------------------------------------------------------------------------
 /** A verified, paid `break-glass` subscription bound to the open claim, created by its candidate, with candidacy and
  * quorum: the wait starts (T5). Anything else bound to break-glass is not handled here, so the caller refunds it in
  * full as unbound. The claim's subscription confers nothing until the effect (§12d.6). */
 async settleExtra(r,s,payment,now,tx){
  if(s.purpose!=='break-glass')return false;
  const c=await this.claimOf(tx,r);
  if(!c||c.id!==s.binding||c.state!=='gathering'||c.payment||s.owner!==c.candidate.sub||!c.candidacy||!c.checkout)return false;
  if(!await this.quorumMet(r,c,now)||!await this.candidateEligible(r,c,now))return false;
  c.payment=payment;c.paidAt=now;r.billing.handled[s.id]='break-glass';
  if(!c.counted){c.counted=true;r.breakGlassMarks.counted.push({claim:c.id,at:now});this.ledger(r,c,'counted',now);}
  c.waitStartedAt=now;c.waitEndsAt=now+(c.track==='A'?BREAK_GLASS.WAIT_A_MS:BREAK_GLASS.WAIT_S_MS);
  await this.move(tx,r,c,'paid',now,null,{audit:{subscription:s.id,waitEndsAt:c.waitEndsAt}});
  if(c.state==='held')this.enterHeld(c,now);
  await this.putClaim(tx,r,c);await this.notify(tx,r,c,'paid',now);return true;
 }
 enterHeld(c,now){c.held={enteredAt:now,ackAt:null};}
 leaveHeld(c,now){if(c.held){c.heldTotal=(c.heldTotal??0)+Math.max(0,now-c.held.enteredAt);c.held=null;}}

 // ---- owner, admins, candidate -----------------------------------------------------------------------------------
 /** T8: any effective admin other than the owner, the initiator and the candidate objects (foreign admins included):
  * Track S from now on; a waiting claim is held for support. Never gated. */
 breakGlassObject(actor,input){return this.onClaim(actor,input,['reason'],async(r,c,v,now,tx,powers)=>{
  if(!isOpen(c)||!powers.includes('admin')||[c.owner,c.initiator,c.candidate].some(p=>samePrincipal(p,actor.principal)))fail('not_found','Not found.',404);
  const reason=typeof v.reason==='string'?v.reason.slice(0,280):null;
  // Review H1: one objection per admin per claim (a repeat is a no-op), so objections cannot flood owner notices.
  if(c.objections.some(o=>samePrincipal(o.by,actor.principal)))return {claim:await this.claimView(r,c,actor,now)};
  if(c.objections.length>=32)fail('objection_limit','Too many objections.',429);
  c.objections.push({by:party(actor.principal),at:now,...reason?{reasonDigest:await hex(reason)}:{}});this.toTrackS(c,'admin-objection');
  const before=c.state;await this.move(tx,r,c,'object',now,actor);if(before!=='held'&&c.state==='held')this.enterHeld(c,now);
  await this.putClaim(tx,r,c);await this.notify(tx,r,c,'object',now);return {claim:await this.claimView(r,c,actor,now)};
 });}
 /** T15: the initiator or the candidate withdraws. A verified payment is refunded less the processing fee. Never gated. */
 breakGlassWithdraw(actor,input){return this.onClaim(actor,input,[],async(r,c,v,now,tx)=>{
  if(!isOpen(c)||![c.initiator,c.candidate].some(p=>samePrincipal(p,actor.principal)))fail('not_found','Not found.',404);
  await this.finishClaim(tx,r,c,'withdraw',now,actor,{reason:'withdrawn',voluntary:true});return {claim:await this.claimView(r,c,actor,now)};
 });}
 /**
  * T10/T11/T12: the owner of record recorded at T1, signed in. Tier 1 (a step-up with a credential enrolled at least 7
  * days before T1 and no authority reset since) aborts at any point before effect, and support can never override it.
  * Tier 0 (a known session or credential) aborts while no support decision to proceed exists; in `final` it is a
  * dispute that voids the decision and returns the claim to support. A held owner may abort with tier 0 (BG-9).
  * Never gated, and the owner's governance hold does not block it.
  */
 breakGlassAbort(actor,input){return this.onClaim(actor,input,[],async(r,c,v,now,tx)=>{
  if(!isOpen(c)||!samePrincipal(actor.principal,c.owner))fail('not_found','Not found.',404);
  const tier=this.ownerTier(r,c,actor,now);if(tier===null)fail('owner_proof_required','Confirm with a passkey or password you had before this claim began.',401);
  await this.ownerStop(tx,r,c,tier,now,actor,{channel:null});return {claim:await this.claimView(r,c,actor,now),tier};
 });}
 /**
  * The owner stops a claim. Tier 1 always ends it (T10, T12). Tier 0 aborts (T10) while no support decision to proceed
  * has existed in the claim; after one (and in a claim started within 180 days of an owner abort, which goes to support
  * precisely so that it can look at channels someone else may control, §12d.2 "Owner's account taken over") a tier-0
  * stop is a dispute: it voids any decision, holds the claim for support and can never be overridden into an effect
  * without a new two-operator decision (T11, BG-15). Provisional reading of the design; see the DEVLOG entry.
  */
 async ownerStop(tx,r,c,tier,now,actor,{channel}){
  if(tier===1){
   c.tier1At=now;const fromFinal=c.state==='final';
   if(fromFinal)r.breakGlassMarks.noProceedUntil=Math.max(r.breakGlassMarks.noProceedUntil,now+BREAK_GLASS.NO_PROCEED_AFTER_TIER1_MS);
   await this.finishClaim(tx,r,c,fromFinal?'tier1':'abort',now,actor,{reason:'owner-elevated',lock:true,ownerAbort:true});return;
  }
  const disputeOnly=c.state==='final'||c.decisionMade===true||c.causes.includes('recent-owner-abort');
  if(!disputeOnly){if(channel){c.disputes.push({channel,at:now,excluded:false});this.rememberDisputed(r,channel);}await this.finishClaim(tx,r,c,'abort',now,actor,{reason:'owner',lock:true,ownerAbort:true});return;}
  const ch=c.channels.find(x=>x.id===channel),excluded=Boolean(ch?.excluded);
  c.disputes.push({channel:channel??'session',at:now,excluded});if(channel)this.rememberDisputed(r,channel);
  // BG-R1-H1: a dispute from a channel support excluded still stops the effect; a new decision then needs a pair of
  // operators different from the pair that excluded it.
  if(excluded&&c.decision?.pair)c.barredPairs.push(c.decision.pair);
  const before=c.state;c.decision=null;c.finalEndsAt=null;c.proposal=null;for(const x of c.channels)x.excluded=false;
  if(before==='waiting'){this.toTrackS(c,'owner-dispute');await this.move(tx,r,c,'liveness',now,actor);}
  else{this.toTrackS(c,'owner-dispute');await this.move(tx,r,c,'dispute',now,actor);}
  if(before!=='held'&&c.state==='held')this.enterHeld(c,now);
  await this.putClaim(tx,r,c);await this.notify(tx,r,c,'dispute',now);
 }
 /** T27: the former owner contests within 90 days with tier-1 proof relative to that claim's T1 (membership not
  * required). Opens a support case; two operators uphold (a reinstatement) or reject it. */
 breakGlassContest(actor,input){
  const v=exact(input,['claim','reason']);if(typeof v.claim!=='string'||!UUID.test(v.claim))fail('not_found','Not found.',404);
  return this.act(actor,{},[],async(r,_,now,tx)=>{
   const k=r.breakGlassContest;if(!k||k.claim!==v.claim||!this.contestActive(r,now)||!samePrincipal(actor.principal,k.formerOwner))fail('not_found','Not found.',404);
   const c=await tx.get(CLAIM+k.claim);if(!c||c.state!=='effective')fail('not_found','Not found.',404);
   if(this.ownerTier(r,c,actor,now)!==1)fail('tight_verification_required','Confirm with a passkey or password enrolled at least 7 days before the claim began.',401);
   if(k.state==='open')return {contest:{state:'open'}};
   k.state='open';k.openedAt=now;c.contest={openedAt:now,state:'open',...typeof v.reason==='string'?{reasonDigest:await hex(v.reason.slice(0,2000))}:{}};
   await this.move(tx,r,c,'contest',now,actor);await this.notify(tx,r,c,'contest',now,{owner:false,parties:[k.formerOwner]});return {contest:{state:'open'}};
  },{exit:true,exposure:false});
 }

 // ---- inbound signals (system) ----------------------------------------------------------------------------------
 /** T9: an interactive sign-in or step-up on the owner's person account (from the identity sign-in hook). Background
  * session refreshes do not count (BG-R1-M2). Reveals nothing to the caller. */
 breakGlassLiveness(actor,input){
  const v=exact(input,['principal','kind','at']);
  return this.onSystem(actor,async(r,c,now,tx)=>{
   if(!['sign-in','step-up'].includes(v.kind)||!c||!isOpen(c)||!samePrincipal(v.principal,c.owner))return {received:true};
   this.toTrackS(c,'owner-liveness');const before=c.state;
   if(before==='final'){c.decision=null;c.finalEndsAt=null;for(const x of c.channels)x.excluded=false;}
   c.proposal=null; // review L3: a pending proposal never survives owner liveness
   await this.move(tx,r,c,'liveness',now);if(before!=='held'&&c.state==='held')this.enterHeld(c,now);
   await this.putClaim(tx,r,c);await this.notify(tx,r,c,'liveness',now);return {received:true};
  });
 }
 /** T16: a security change on the candidate's account closes the claim (an authority reset is seen through the
  * membership's `aep`). A co-signer's change withdraws their signature. */
 breakGlassSecurityChange(actor,input){
  const v=exact(input,['principal','at']);
  return this.onSystem(actor,async(r,c,now,tx)=>{
   if(!c||!isOpen(c))return {received:true};
   if(samePrincipal(v.principal,c.candidate)){await this.finishClaim(tx,r,c,'ineligible',now,null,{reason:'ineligible'});return {received:true};}
   const i=c.cosigners.findIndex(s=>samePrincipal(s.principal,v.principal));
   if(i>=0){c.cosigners.splice(i,1);await this.move(tx,r,c,'uncosign',now);if(c.state==='gathering')await this.checkQuorum(r,c,now);
    if(c.state!=='gathering'&&!await this.quorumMet(r,c,now))await this.finishClaim(tx,r,c,'ineligible',now,null,{reason:'quorum-withdrawn'});else await this.putClaim(tx,r,c);}
   return {received:true};
  });
 }
 /** The public abort link, after the route parsed `bg1.<claim>.<token id>.<secret>`: tier 0 from that channel. Used,
  * unknown and expired tokens get the identical answer; a GET never reaches this operation (§12d.8). */
 async breakGlassAbortToken(actor,input){
  const v=exact(input,['token']);const parts=typeof v.token==='string'&&v.token.length<=256?v.token.split('.'):[];
  const ok=parts.length===4&&parts[0]==='bg1'&&UUID.test(parts[1])&&UUID.test(parts[2])&&/^[A-Za-z0-9_-]{43}$/.test(parts[3]);
  const digest=ok?await hex(parts[3]):null;
  await this.onSystem(actor,async(r,c,now,tx)=>{
   if(!ok||!c||c.id!==parts[1])return;
   const t=c.tokens.find(x=>x.id===parts[2]),valid=isOpen(c)&&t&&!t.usedAt&&sameHex(t.hash,digest)&&c.channels.some(ch=>ch.id===t.channel);
   if(!valid){if(c.tokenFailures<BREAK_GLASS.TOKEN_FAILURES){c.tokenFailures++;await this.putClaim(tx,r,c);}return;}
   t.usedAt=now;await this.ownerStop(tx,r,c,0,now,null,{channel:t.channel});
  });
  return {received:true};
 }
 /** ORG-12f seam (T17–T19): a file-based recovery started, was cancelled, or took effect. */
 breakGlassFileRecovery(actor,input){
  const v=exact(input,['event']);if(!['started','cancelled','effective'].includes(v.event))fail('invalid_request','Unsupported recovery event.',400);
  return this.onSystem(actor,async(r,c,now,tx)=>{
   r.fileRecovery={state:v.event==='started'?'pending':v.event,at:now};
   if(!c||!isOpen(c))return {claim:c?.state??null};
   if(v.event==='started'&&!c.frozen){c.frozen=true;await this.move(tx,r,c,'freeze',now);}
   else if(v.event==='cancelled'&&c.frozen){c.frozen=false;await this.move(tx,r,c,'unfreeze',now);}
   else if(v.event==='effective')await this.finishClaim(tx,r,c,'superseded',now,null,{reason:'superseded'});
   return {claim:c.state,frozen:c.frozen===true};
  });
 }
 /**
  * Operator decisions (ORG-12d applies them after the admin service authenticated `operator`, an internal account with
  * `support.org-break-glass`, and its step-up). One operator: `acknowledge`, `note` (T20) and `abort` (T21). Two
  * different operators: `proceed` (T22, optionally excluding owner channels), `uphold` and `reject` (a contest). The
  * first call proposes; a second call by a DIFFERENT operator with the same decision and exclusions within 72 h
  * approves (invariant I8). No operator may be the owner, the candidate, the initiator, a co-signer or a member.
  */
 breakGlassResolve(actor,input){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  const v=exact(input,['claim','operator','decision','category','reason','exclude','assertion']);
  if(typeof v.claim!=='string'||!UUID.test(v.claim)||typeof v.operator!=='string'||!UUID.test(v.operator)||!['acknowledge','note','abort','proceed','uphold','reject'].includes(v.decision))fail('invalid_request','Unsupported operator decision.',400);
  const exclude=v.exclude===undefined?[]:Array.isArray(v.exclude)&&v.exclude.length<=BREAK_GLASS.CHANNELS&&v.exclude.every(x=>typeof x==='string'&&CHANNEL.test(x))?[...new Set(v.exclude)].sort():fail('invalid_request','Unsupported exclusions.',400);
  const reason=typeof v.reason==='string'?v.reason.slice(0,2000):null;
  return this.verifyOperator(v.assertion,{operator:v.operator,org:actor?.owner,kind:'break-glass',process:v.claim,decision:v.decision,exclude}).then(verified=>this.onSystem(actor,async(r,c0,now,tx)=>{
   const contest=['uphold','reject'].includes(v.decision),c=contest?await tx.get(CLAIM+v.claim):c0;
   if(!c||c.id!==v.claim)fail('not_found','Not found.',404);
   const operator={iss:this.issuer??null,sub:v.operator},sys={kind:'system',principal:null},detail={operator:v.operator,decision:v.decision,...v.category?{category:String(v.category).slice(0,64)}:{},...reason?{reasonDigest:await hex(reason)}:{}};
   await this.operatorConflict(r,operator,[c.owner,c.candidate,c.initiator,...c.cosigners.map(s=>s.principal)]);this.spendOperatorNonce(c,verified,now);
   if(contest){
    const k=r.breakGlassContest;if(c.state!=='effective'||k?.claim!==c.id||k.state!=='open')fail('not_found','Not found.',404);
    const approved=await this.twoOperators(tx,r,c,v.decision,v.operator,[],now,detail);if(!approved)return {decision:'proposed'};
    if(v.decision==='reject'){k.state='rejected';c.contest={...c.contest,state:'rejected',at:now};await this.move(tx,r,c,'contest-resolved',now,sys,{audit:{...detail,pair:approved}});await this.notify(tx,r,c,'contest-rejected',now,{owner:false,parties:[k.formerOwner]});return {decision:'approved',contest:'rejected'};}
    await this.reinstate(tx,r,c,k,now,approved,detail);return {decision:'approved',contest:'upheld'};
   }
   if(!isOpen(c))fail('not_found','Not found.',404);
   if(v.decision==='acknowledge'||v.decision==='note'){if(c.state!=='held')fail('not_found','Not found.',404);if(v.decision==='acknowledge')c.held.ackAt??=now;await this.move(tx,r,c,'acknowledge',now,sys,{audit:detail});return {decision:'recorded'};}
   if(v.decision==='abort'){if(c.state!=='held')fail('not_found','Not found.',404);await this.finishClaim(tx,r,c,'support-abort',now,sys,{reason:'support',lock:true,audit:detail});return {decision:'recorded',state:c.state};}
   // proceed (T22)
   if(c.state!=='held')fail('not_found','Not found.',404);
   if(c.tier1At||r.breakGlassMarks.noProceedUntil>now)fail('owner_proof_recent','The owner’s elevated proof ended a claim recently; support cannot proceed.',409);
   const disputed=new Set([...c.disputes.map(d=>d.channel),...r.breakGlassMarks.disputed]);
   // Review R2-M1: a channel that disputed, or one marked undeliverable, may be excluded.
   if(exclude.some(id=>!c.channels.some(ch=>ch.id===id&&(disputed.has(id)||ch.undeliverable))))fail('invalid_exclusion','Only owner channels that disputed a claim, or that cannot be reached, can be excluded.',409);
   if(c.channels.filter(ch=>!exclude.includes(ch.id)).length<1)fail('last_channel','The owner’s last channel can never be excluded.',409);
   // Review L6: after an excluded channel's dispute the new pair shares NO operator with a barred pair (refused at once).
   if(c.barredPairs.some(p=>p.includes(v.operator)))fail('operator_pair_barred','A new pair of operators must decide after an excluded channel disputed.',409);
   const approved=await this.twoOperators(tx,r,c,'proceed',v.operator,exclude,now,detail);if(!approved)return {decision:'proposed'};
   if(c.barredPairs.some(p=>p.includes(approved[0])||p.includes(approved[1])))fail('operator_pair_barred','A new pair of operators must decide after an excluded channel disputed.',409);
   for(const ch of c.channels)ch.excluded=exclude.includes(ch.id);
   c.decision={pair:approved,exclude,at:now};c.decisionMade=true;c.finalEndsAt=now+BREAK_GLASS.FINAL_MS;this.leaveHeld(c,now);
   await this.move(tx,r,c,'proceed',now,sys,{audit:{...detail,pair:approved,excluded:exclude.length,finalEndsAt:c.finalEndsAt}});
   // T22: a 7-day final notice with fresh abort links to every owner channel, the excluded ones too.
   await this.notify(tx,r,c,'proceed',now);return {decision:'approved',state:c.state};
  }));
 }
 /** Records a proposal, or approves it with a second, different operator. Returns the approving pair or null. */
 async twoOperators(tx,r,c,decision,operator,exclude,now,detail){
  const p=c.proposal&&c.proposal.decision===decision&&c.proposal.at+BREAK_GLASS.OPERATOR_APPROVAL_MS>now&&JSON.stringify(c.proposal.exclude)===JSON.stringify(exclude)?c.proposal:null;
  if(!p){c.proposal={decision,operator,exclude,at:now};await this.move(tx,r,c,'propose',now,{kind:'system',principal:null},{audit:detail});return null;}
  if(p.operator===operator)fail('second_operator_required','A different operator must approve this decision.',409);
  c.proposal=null;return pair(p.operator,operator);
 }

 // ---- effect and reinstatement (the shared owner-change commit) ------------------------------------------------
 /** The effect preconditions of §12d.5, re-checked in the effect commit. Returns a reason when it cannot happen now. */
 async effectBlocked(r,c,now,{fresh,extra}){
  if(c.frozen)return 'frozen';if(!['waiting','final'].includes(c.state))return 'state';
  if(!samePrincipal(r.ownerOfRecord,c.owner))return 'owner-changed';
  if(r.state!=='active')return 'organization-unavailable';
  if(!this.breakGlassEnabled(r.id))return 'flag-off';
  if(!fresh)return 'stale-snapshot';if(heldSubscriptions(r).length)return 'billing-held';
  if(extra?.breakGlassCandidate?.ok!==true)return 'candidate-unverified';
  if(!await this.quorumMet(r,c,now))return 'quorum';
  if(this.paymentState(r,c.payment,c.candidate,now))return 'payment';
  return null;
 }
 async effect(tx,r,c,now){
  const {prev}=await this.changeOwner(r,c.candidate,c.payment,now,tx,{cause:'break-glass',id:c.id,expect:c.owner,authorityReset:true,moveCoolingMs:BREAK_GLASS.MOVE_COOLING_MS});
  const former=await rosterOf(r).principal(prev);
  if(former?.state==='live')former.hold={aep:former.aep,at:now,noticeAt:null,objected:false,cause:'break-glass'};
  if(r.billing.claim&&['awaiting-payment'].includes(r.billing.claim.state)){r.billing.claim.state='closed';r.billing.claim.closedReason='owner-changed';r.billing.claim.closedAt=now;}
  r.breakGlassContest={claim:c.id,formerOwner:party(prev),newOwner:party(c.candidate),t1:c.createdAt,until:now+BREAK_GLASS.CONTEST_MS,state:'window'};
  c.effectiveAt=now;await this.move(tx,r,c,'effect',now,null,{audit:{from:prev,to:party(c.candidate),subscription:c.payment.subscriptionId,authorityEpoch:r.authorityEpoch,contestUntil:r.breakGlassContest.until}});
  this.ledger(r,c,'ended',now);await this.notify(tx,r,c,'effect',now,{parties:[prev]});
 }
 /** An upheld contest: a restoration, not a transfer (BG-13). One commit restores the former owner, revokes the
  * break-glass owner's subscription (no automatic refund), raises the epoch, rotates the recovery binding, holds the
  * break-glass owner's governance and starts the ordinary 14-day grace (the former owner sets up billing). */
 async reinstate(tx,r,c,k,now,approved,detail){
  // Review H3: restore the former owner from whoever owns the organization now (the window refuses new processes, but a
  // reinstatement must never be blocked by an ownership change that slipped through).
  if(samePrincipal(r.ownerOfRecord,k.formerOwner))fail('not_found','Not found.',404);
  const {prev}=await this.changeOwner(r,k.formerOwner,null,now,tx,{cause:'reinstatement',id:c.id,expect:party(r.ownerOfRecord),authorityReset:true,moveCoolingMs:BREAK_GLASS.MOVE_COOLING_MS});
  const roster=rosterOf(r),bg=await roster.principal(prev),former=await roster.principal(k.formerOwner);
  if(bg?.state==='live')bg.hold={aep:bg.aep,at:now,noticeAt:null,objected:false,cause:'reinstatement'};
  if(former?.hold?.cause==='break-glass')former.hold=null;
  k.state='upheld';c.contest={...c.contest,state:'upheld',at:now};
  await this.move(tx,r,c,'contest-resolved',now,{kind:'system',principal:null},{audit:{...detail,pair:approved,reinstated:party(k.formerOwner),authorityEpoch:r.authorityEpoch}});
  await this.notify(tx,r,c,'reinstated',now,{owner:false,parties:[k.formerOwner,prev]});
 }

 // ---- time rules (part of orgs.ownership-tick) ------------------------------------------------------------------
 async stepContext(r0){
  const id=r0?.breakGlass?.id;if(!isOpen(r0?.breakGlass))return {};
  const c=await this.metadata.get(CLAIM+id);if(!c)return {};
  let a=null;try{a=await this.accounts?.get(c.candidate.sub);}catch{a=null;}
  const changed=Number.isSafeInteger(a?.securityChangedAt)&&a.securityChangedAt>c.createdAt;
  return {breakGlassCandidate:{ok:a?a.kind==='person'&&a.status==='active'&&!changed:null,gone:a?a.kind!=='person'||!['active'].includes(a.status)||changed:false}};
 }
 async advanceExtra(r,now,tx,{fresh,extra,alerts,wake}){
  const k=r.breakGlassContest;
  if(k&&k.state==='window'&&now>=k.until){k.state='closed';await this.audit(tx,r,'organization-break-glass-contest-window-closed',{kind:'system',principal:null},{claim:k.claim});}
  if(k&&['window','open'].includes(k.state)&&k.until>now)wake(k.until);
  if(k?.state==='open'&&!k.escalatedAt){const due=(k.openedAt??now)+BREAK_GLASS.CONTEST_OPEN_MAX_MS;if(now>=due){k.escalatedAt=now;alerts.push({kind:'organization-break-glass',action:'operator-alert',reason:'contest-undecided',org:r.id,claim:k.claim,since:k.openedAt});await this.audit(tx,r,'organization-break-glass-contest-escalated',{kind:'system',principal:null},{claim:k.claim});}else wake(due);}
  const c=await this.claimOf(tx,r);if(!c||!isOpen(c))return;
  const sys={kind:'system',principal:null};
  // T16: the candidate left, was removed, held, reset, suspended or deleting; or a required quorum is short.
  if(extra.breakGlassCandidate?.gone===true||!await this.candidateEligible(r,c,now)){
   // Review L5: a candidate who left the organization ended the claim by choice; the processing fee is kept.
   const cm=await rosterOf(r).principal(c.candidate),left=cm?.state==='ended'&&cm.endReason==='left';
   await this.finishClaim(tx,r,c,'ineligible',now,sys,{reason:left?'candidate-left':'ineligible',voluntary:left});return;}
  // Review H2: the payment is gone (refunded, charged back, cancelled): the claim closes, never wedging the sync.
  if(fresh&&c.payment&&this.paymentState(r,c.payment,c.candidate,now)==='gone'){await this.finishClaim(tx,r,c,'unpaid',now,sys,{reason:'payment-failed'});return;}
  if(c.state!=='gathering'&&!await this.quorumMet(r,c,now)){await this.finishClaim(tx,r,c,'ineligible',now,sys,{reason:'quorum-withdrawn'});return;}
  if(c.state==='gathering'){
   await this.checkQuorum(r,c,now);
   if(!c.quorumAt&&now>=c.createdAt+BREAK_GLASS.GATHER_MS){await this.finishClaim(tx,r,c,'lapse',now,sys,{reason:'quorum-lapsed'});return;}
   if(c.quorumAt&&!c.payment&&now>=Math.max(c.quorumAt,c.createdAt)+BREAK_GLASS.PAYMENT_MS){await this.finishClaim(tx,r,c,'lapse',now,sys,{reason:'unpaid'});return;}
   await this.putClaim(tx,r,c);wake(c.quorumAt?c.quorumAt+BREAK_GLASS.PAYMENT_MS:c.createdAt+BREAK_GLASS.GATHER_MS);return;
  }
  if(c.state==='waiting'){
   const due=[...BREAK_GLASS.REMINDERS_MS.map(d=>c.waitStartedAt+d),c.waitEndsAt-BREAK_GLASS.REMINDER_BEFORE_MS].filter(t=>t<c.waitEndsAt);
   const last=c.waitEndsAt-BREAK_GLASS.REMINDER_BEFORE_MS;
   for(const t of due)if(now>=t&&!c.reminders.includes(t)){c.reminders.push(t);await this.move(tx,r,c,'remind',now,sys,{audit:{reminder:t}});await this.notify(tx,r,c,t===last?'remind-72h':'remind',now);}
   const next=due.find(t=>!c.reminders.includes(t));if(next)wake(next);
   if(now>=c.waitEndsAt)await this.tryEffect(tx,r,c,now,{fresh,extra,wake});else wake(c.waitEndsAt);
   return;
  }
  if(c.state==='final'){
   const at=Math.max(c.finalEndsAt,c.paidAt+BREAK_GLASS.WAIT_S_MS);
   if(now>=at)await this.tryEffect(tx,r,c,now,{fresh,extra,wake});else wake(at);return;
  }
  if(c.state==='held'){
   // T23: unacknowledged for 30 days, undecided for 60 days since entering `held`, or 120 days held in total. No lock
   // and no charge to the limits (BG-17); an operator alert. A held claim never takes effect (invariant I9).
   if(!c.held)this.enterHeld(c,now);
   const total=(c.heldTotal??0)+(now-c.held.enteredAt),ackBy=c.held.ackAt?Infinity:c.held.enteredAt+BREAK_GLASS.ACK_MS,decideBy=c.held.enteredAt+BREAK_GLASS.DECIDE_MS,cap=c.held.enteredAt+BREAK_GLASS.HELD_TOTAL_MS-(c.heldTotal??0);
   if(now>=ackBy||now>=decideBy||total>=BREAK_GLASS.HELD_TOTAL_MS){alerts.push({kind:'organization-break-glass',action:'operator-alert',reason:'held-claim-expired',org:r.id,claim:c.id,since:c.held.enteredAt});await this.finishClaim(tx,r,c,'expire',now,sys,{reason:'expired',uncount:true});return;}
   await this.putClaim(tx,r,c);wake(Math.min(ackBy,decideBy,cap));
  }
 }
 async tryEffect(tx,r,c,now,{fresh,extra,wake}){
  // Review M1: Track A takes effect only if the T1, T5 and 72 h notices were each accepted by the provider on at least one
  // out-of-band channel; otherwise the claim is held for support (Track S).
  if(c.state==='waiting'){const missing=['start','paid','remind-72h'].filter(e=>!this.deliveredOutOfBand(c,e));
   if(missing.length){this.toTrackS(c,'notice-undelivered');await this.move(tx,r,c,'undelivered',now,{kind:'system',principal:null},{audit:{events:missing.length}});this.enterHeld(c,now);await this.putClaim(tx,r,c);await this.notify(tx,r,c,'undelivered',now);return;}}
  // Review R2-M1: a final claim needs its final notice accepted on a channel support did not exclude. If that has not
  // happened within NOTICE_BOUND_MS of the earliest effect time, the claim goes back to support.
  if(c.state==='final'&&!this.deliveredTo(c,'proceed')){const at=Math.max(c.finalEndsAt,c.paidAt+BREAK_GLASS.WAIT_S_MS);
   if(now>=at+BREAK_GLASS.NOTICE_BOUND_MS){this.toTrackS(c,'notice-undelivered');c.decision=null;c.finalEndsAt=null;for(const ch of c.channels)ch.excluded=false;await this.move(tx,r,c,'undelivered',now,{kind:'system',principal:null});this.enterHeld(c,now);await this.putClaim(tx,r,c);await this.notify(tx,r,c,'undelivered',now);return;}
   if(!c.lastBlocked||c.lastBlocked.reason!=='notices-pending'){c.lastBlocked={reason:'notices-pending',at:now};await this.putClaim(tx,r,c);}wake(Math.min(now+BREAK_GLASS.RETRY_MS,at+BREAK_GLASS.NOTICE_BOUND_MS));return;}
  const blocked=await this.effectBlocked(r,c,now,{fresh,extra});
  // T26: a transient failure retries hourly and never weakens a guard. Frozen or flag-off claims simply stay pending.
  if(blocked){if(!c.lastBlocked||c.lastBlocked.reason!==blocked){c.lastBlocked={reason:blocked,at:now};await this.putClaim(tx,r,c);}wake(now+(blocked==='stale-snapshot'?OWNERSHIP.RETRY_MS:BREAK_GLASS.RETRY_MS));return;}
  await this.guardedEffect(()=>this.effect(tx,r,c,now),wake,now);
 }
 stepSummary(r){return {breakGlass:r.breakGlass?.state??null};}
 /** Whether an owner notice for `event` was accepted by the provider on an out-of-band channel (review M1). */
 /** Whether an owner notice for `event` was accepted on any channel support did not exclude (review R2-M1). */
 deliveredTo(c,event){const ok=new Set(c.channels.filter(ch=>!ch.excluded).map(ch=>ch.id));return Object.values(c.delivered??{}).some(d=>d.event===event&&d.accepted.some(id=>ok.has(id)));}
 deliveredOutOfBand(c,event){const oob=new Set(this.outOfBand(c).map(ch=>ch.id));return Object.values(c.delivered??{}).some(d=>d.event===event&&d.accepted.some(id=>oob.has(id)));}

 // ---- owner-interface actions, decisions and outbox ------------------------------------------------------------
 /** T14 and the contest-window restrictions. During the window the new owner cannot offer a transfer or schedule
  * deletion; otherwise an unheld owner of record acting with fresh authentication aborts a pending claim. */
 async ownerAction(r,actor,now,tx,action){
  if(['transfer-offer','schedule-deletion'].includes(action)&&this.contestActive(r,now)&&samePrincipal(actor.principal,r.ownerOfRecord))fail('contest_window','This is not available while the former owner can contest the ownership change.',409);
  const c=await this.claimOf(tx,r);
  if(c&&isOpen(c)&&samePrincipal(actor.principal,c.owner)&&organizationPowers(r,actor.principal,{now}).includes('owner-of-record'))await this.finishClaim(tx,r,c,'owner-active',now,actor,{reason:'owner-active',lock:true,ownerAbort:true,audit:{ownerAction:action}});
 }
 /** Owner decisions on elevated requests: T14, and during the contest window an acceptance that narrows or removes a
  * GM grant is refused until the window closes (a reinstatement could not undo it; BG-R1-M3; see DEVLOG for the
  * deviation from "recorded and applied later"). */
 async ownerDecision(r,q,m,actor,decision,now,tx){
  if(decision==='accept'&&this.contestActive(r,now)){
   const admin=g=>g.power==='admin',had=m.grants.filter(admin),next=(q.grants??[]).filter(admin);
   const narrows=q.remove===true||had.some(g=>!next.some(n=>(n.expires_at??Infinity)>=(g.expires_at??Infinity)));
   if(narrows)fail('contest_window','This change to an admin grant can be accepted once the former owner’s contest window closes.',409);
  }
  await this.ownerAction(r,actor,now,tx,'decision');
 }
 async drainExtra(r,e,actor){
  if(e.kind==='owner-notice'){
   if(!this.ownerChannels)return false;
   // Review M1: per-channel provider acceptance is recorded on the claim; a retry only re-sends what was not accepted.
   // Review R2-M1/R2-L2: a channel that keeps failing (8 attempts over 7 days; 8 attempts once the claim has ended) is
   // marked undeliverable and no longer retried, so one dead push subscription can never hold a row (or a claim) forever.
   const c0=await this.metadata.get(CLAIM+e.claim);if(!c0)return true;
   const dead=new Set(c0.channels.filter(ch=>ch.undeliverable).map(ch=>ch.id)),already=new Set(c0.delivered?.[e.id]?.accepted??[]),accepted=[],failed=[];
   for(const ch of e.channels??[]){if(already.has(ch.channel)){accepted.push(ch.channel);continue;}if(dead.has(ch.channel))continue;
    try{const out=await this.ownerChannels.notify(e.owner,{org:r.id,claim:e.claim,event:e.event,channel:ch.channel,kind:ch.kind,...ch.abort?{abort:ch.abort}:{}});if(out?.accepted===true)accepted.push(ch.channel);else failed.push(ch.channel);}catch{failed.push(ch.channel);}}
   if(!actor)return failed.length===0;
   const outcome=await this.commit(actor,async(x,at,tx)=>{const c=await tx.get(CLAIM+e.claim);if(!c)return {done:true};
    c.delivered??={};const prior=c.delivered[e.id]?.accepted??[];if(accepted.length)c.delivered[e.id]={event:e.event,at,accepted:[...new Set([...prior,...accepted])]};
    const keys=Object.keys(c.delivered);if(keys.length>64)for(const k of keys.slice(0,keys.length-64))delete c.delivered[k];
    c.channelFailures??={};let newlyDead=[];
    for(const id of failed){const f=c.channelFailures[id]??{attempts:0,firstAt:at};f.attempts++;c.channelFailures[id]=f;const ch=c.channels.find(x=>x.id===id);
     if(ch&&!ch.undeliverable&&f.attempts>=BREAK_GLASS.CHANNEL_ATTEMPTS&&(!isOpen(c)||at-f.firstAt>=BREAK_GLASS.CHANNEL_DAYS_MS)){ch.undeliverable=true;newlyDead.push(ch);}}
    // An out-of-band channel that cannot be reached is no evidence the owner was told: Track S, and a waiting or final
    // claim is held for support (which may exclude that channel).
    if(isOpen(c)&&newlyDead.some(ch=>['email','push'].includes(ch.kind))){this.toTrackS(c,'channel-undeliverable');if(['waiting','final','gathering'].includes(c.state)){const before=c.state;if(before==='final'){c.decision=null;c.finalEndsAt=null;for(const ch of c.channels)ch.excluded=false;}await this.move(tx,x,c,'undelivered',at,{kind:'system',principal:null},{audit:{channels:newlyDead.length}});if(before!=='gathering')this.enterHeld(c,at);}}
    await tx.put(CLAIM+c.id,c);
    const row=new Set([...(c.delivered[e.id]?.accepted??[]),...c.channels.filter(ch=>ch.undeliverable).map(ch=>ch.id)]);
    return {done:(e.channels??[]).every(ch=>row.has(ch.channel))};});
   return outcome?.done===true;
  }
  if(e.kind==='ledger'){if(!this.claimLedger)return false;const out=await this.claimLedger.update(e.person,{org:r.id,claim:e.claim,event:e.event,at:e.createdAt});return out?.ok===true;}
  return false;
 }
 async ownership(actor,input){
  const out=await super.ownership(actor,input);const r=await this.metadata.get(ORG_RECORD);
  if(Array.isArray(out.decisions)&&r&&this.contestActive(r,this.clock.now()))out.decisions=out.decisions.filter(d=>!['offer','claim'].includes(d));
  if(r?.breakGlassContest&&out.ownerOfRecord)out.contestUntil=this.contestActive(r,this.clock.now())?r.breakGlassContest.until:null;
  return out;
 }

 // ---- views ----------------------------------------------------------------------------------------------------
 /** The role-filtered view (§12d.8): the owner, admins, the candidate and members each see what they may, with the
  * decisions the server would accept now. Admins see "held for support", never the cause; channel kinds and ages go
  * to the owner only. A non-member, or anyone when nothing is pending and the flag is off, gets not_found. */
 breakGlassView(actor,input={}){
  exact(input,[]);
  return this.metadata.transaction(async tx=>{
   const r=this.ensure(await this.organization(tx,actor)),now=this.clock.now(),c=await this.claimOf(tx,r);
   const m=r.memberships[principalKey(actor.principal)],formerOwner=r.breakGlassContest&&samePrincipal(actor.principal,r.breakGlassContest.formerOwner);
   if(m?.state!=='live'&&!formerOwner&&!(c&&samePrincipal(actor.principal,c.owner)))fail('not_found','Not found.',404);
   const enabled=this.breakGlassEnabled(r.id),view=c?await this.claimView(r,c,actor,now):null;
   if(!enabled&&!(view&&(isOpen(c)||this.contestActive(r,now))))fail('not_found','Not found.',404);
   const decisions=[];
   if(enabled&&!this.otherProcess(r)&&!this.limitsRefusal(r,now)&&(this.eligibleAdmin(r,m,now,now)||(await this.effectiveAdmins(r,now)).length===0&&this.eligibleMember(r,m,now,now)))decisions.push('start');
   if(formerOwner&&this.contestActive(r,now)&&r.breakGlassContest.state==='window')decisions.push('contest');
   return {claim:view,decisions,contest:r.breakGlassContest&&(formerOwner||organizationPowers(r,actor.principal,{now}).length)?{claim:r.breakGlassContest.claim,until:r.breakGlassContest.until,state:r.breakGlassContest.state}:null};
  });
 }
 async claimView(r,c,actor,now){
  const owner=samePrincipal(actor.principal,c.owner),candidate=samePrincipal(actor.principal,c.candidate),powers=organizationPowers(r,actor.principal,{now}),admin=powers.includes('admin')||owner||powers.includes('owner-of-record');
  // Review L8: only the owner sees how a claim ended; everyone else sees "closed".
  const ended=['aborted','withdrawn','closed'].includes(c.state);
  const base={id:c.id,state:c.state==='held'?'held-for-support':ended&&!owner?'closed':c.state,createdAt:c.createdAt,earliestEffectAt:this.earliestEffect(c),closedReason:owner&&ended?c.closedReason:null};
  if(!admin&&!candidate)return base;
  // The track is the owner's to see: shown to admins it would reveal that a Track S trigger applied (BG-R1-M4).
  const out={...base,...owner?{track:c.track}:{},frozen:c.frozen===true,initiator:party(c.initiator),candidate:party(c.candidate),candidacyAccepted:Boolean(c.candidacy),cosigners:c.cosigners.map(s=>({principal:party(s.principal),at:s.at})),
   objections:c.objections.length,category:c.category,statement:c.statement,paid:Boolean(c.payment),waitEndsAt:c.waitEndsAt,finalEndsAt:c.finalEndsAt,decisions:[]};
  if(owner)out.channels=c.channels.map(ch=>({kind:ch.kind,enrolledAt:ch.enrolledAt,excluded:ch.excluded===true}));
  if(isOpen(c)){
   if(owner)out.decisions.push('abort');
   if(candidate&&c.state==='gathering'&&!c.candidacy)out.decisions.push('accept');
   if(candidate&&c.state==='gathering'&&c.candidacy&&!c.payment&&await this.quorumMet(r,c,now)){out.decisions.push('pay');out.disclosure=await this.disclosureView(r,c,now);}
   if([c.initiator,c.candidate].some(p=>samePrincipal(p,actor.principal)))out.decisions.push('withdraw');
   const mine=c.cosigners.some(s=>samePrincipal(s.principal,actor.principal)),me=r.memberships[principalKey(actor.principal)];
   if(c.state==='gathering'&&!mine&&this.eligibleAdmin(r,me,c.createdAt,now)&&![c.initiator,c.candidate].some(p=>samePrincipal(p,actor.principal)))out.decisions.push('cosign');
   if(mine)out.decisions.push('uncosign');
   if(powers.includes('admin')&&![c.owner,c.initiator,c.candidate].some(p=>samePrincipal(p,actor.principal)))out.decisions.push('object');
  }
  return out;
 }
 async disclosureView(r,c,now){
  if(!this.billingConfigured())return null;let pricing=null;try{pricing=await this.billing.plans('usd');}catch{return null;}
  const plan=ownerSubscription(r,now)?.plan??(['org-team','org-business','org-scale'].includes(r.plan?.plan)?r.plan.plan:null),entries=pricing.plans.filter(p=>!plan||p.id===plan);
  return Promise.all(entries.map(async p=>({plan:p.id,price:p.price,digest:await breakGlassDisclosureDigest(r,c,{plan:p.id,currency:p.price.currency,amount:p.price.amount}),
   terms:{freshPeriod:true,paidPeriodRunsFromCheckout:true,previousPaymentConfersNothing:true,ownerMayAbort:true,contestDays:90,refund:'full unless you withdraw voluntarily; then less the processing fee'}})));
 }
 /** System, for operators: this organization's claim as a case (states, timers, track and causes, channel kinds and
  * ages, billing standing, proposal). Never the statement text or channel addresses. */
 breakGlassCase(actor){
  return this.onSystem(actor,async(r,c,now)=>{
   if(!c)return {case:null};
   return {case:{id:c.id,org:r.id,state:c.state,track:c.track,causes:[...c.causes],frozen:c.frozen===true,createdAt:c.createdAt,paidAt:c.paidAt,waitEndsAt:c.waitEndsAt,held:c.held,heldTotal:c.heldTotal??0,finalEndsAt:c.finalEndsAt,
    channels:c.channels.map(ch=>({id:ch.id,kind:ch.kind,enrolledAt:ch.enrolledAt,excluded:ch.excluded===true})),disputes:c.disputes.map(d=>({channel:d.channel,at:d.at,excluded:d.excluded})),objections:c.objections.length,
    proposal:c.proposal?{decision:c.proposal.decision,at:c.proposal.at,exclude:[...c.proposal.exclude]}:null,decision:c.decision,barredPairs:c.barredPairs,ownerStatus:c.ownerStatus,category:c.category,statementDigest:c.statementDigest,
    contest:r.breakGlassContest?.claim===c.id?{state:r.breakGlassContest.state,until:r.breakGlassContest.until}:null,billingHeld:heldSubscriptions(r).length>0}};
  });
 }

 // ---- person placement: the per-person claim ledger ---------------------------------------------------------------
 /** System, in a PERSON's account writer: reserve or update this person's break-glass ledger rows
  * (`orgs/break-glass/<org>/<claim>`), the per-person limits of §12d.8. Rows older than 400 days are pruned. */
 async breakGlassLedger(actor,input){
  const v=exact(input,['op','org','claim','role','event','at']);
  if(actor?.kind!=='system'||!['reserve','update'].includes(v.op)||!UUID.test(v.org??'')||!UUID.test(v.claim??'')||!Number.isSafeInteger(v.at))fail('forbidden','System only.',403);
  return this.metadata.transaction(async tx=>{
   if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
   const rows=[...await tx.list({prefix:LEDGER,limit:256})],key=LEDGER+v.org+'/'+v.claim;
   for(const [k,row] of rows)if(row.startedAt<v.at-400*DAY)await tx.delete(k);
   const live=rows.filter(([,row])=>row.startedAt>=v.at-400*DAY).map(([,row])=>row);
   if(v.op==='reserve'){
    if(!['initiator','candidate'].includes(v.role))fail('invalid_request','Unsupported role.',400);
    const refusal=ledgerDecision(live,v,v.at);if(refusal)return {ok:false,reason:refusal};if(live.length>=128)return {ok:false,reason:'break_glass_person_limit'};
    const prior=await tx.get(key);await tx.put(key,{org:v.org,claim:v.claim,role:prior?.role==='candidate'?'candidate':v.role,state:'pending',startedAt:prior?.startedAt??v.at,countedAt:prior?.countedAt??null});return {ok:true};
   }
   if(!['counted','uncounted','ended','released'].includes(v.event))fail('invalid_request','Unsupported event.',400);
   const row=await tx.get(key);if(row)await tx.put(key,ledgerApply(row,{event:v.event,at:v.at}));return {ok:true};
  });
 }
}
