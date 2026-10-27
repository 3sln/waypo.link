// Relay (TURN) credential lifecycle: lease, issue, revoke and sweep. Generalized from Beam's ICE issuance
// (packages/runtime/account/beams.mjs, wargame round 3 D1/D2 and review follow-ups) when Beam left the core
// (DEVLOG 2026-10-26). A tested, unused building block for the ice-relay occupant planned in
// docs/architecture/rtc-signaling.md §5; nothing calls it yet.
//
// A session record lives at one storage key and carries `expiresAt`, `relay` ({[leg]: slot}) and `relayReserved`
// (bytes reserved across every leg and re-issue). Rules kept from Beam:
// - Issued usernames are persisted per leg and revoked on terminal transitions (revokeRelayCredentials) and by the
//   sweep; a credential never outlives the session (TTL = min(300 s, remaining session lifetime)).
// - After a credential expires the leg may re-issue, at most RELAY_MAX_ISSUES times, each with a new reservation;
//   the old usernames are revoked once the new ones are recorded.
// - An 'issuing' marker is a lease (RELAY_LEASE_MS), so a crash mid-issuance cannot wedge the leg, and the success
//   write requires that the call still holds its lease.
// - The reservation of one session is capped at RELAY_RESERVATION_FACTOR times one leg's envelope.
// - Any failure before the credentials are recorded revokes what was issued, releases the reservation (when the
//   budget supports it and nothing is left unrevoked) and returns the leg to idle. When revoking fails, the
//   reservation is kept (the credentials may still carry traffic) and the usernames stay for the sweep.
import {RtcError,TURN_MAX_TTL_SECONDS} from './turn.mjs';

export const RELAY_LEASE_MS=60000,RELAY_MAX_ISSUES=4,RELAY_RESERVATION_FACTOR=4,RELAY_RETRY_MS=60000;
const fail=(code,message,status)=>{throw new RtcError(code,message,status);};
/** Normalizes a stored slot; `true` and 'issuing' are Beam's pre-round-3 markers. */
export const relaySlot=raw=>raw===true?{state:'issued',count:1,expiresAt:0,usernames:[]}:raw==='issuing'?{state:'issuing',at:0,count:1,usernames:[]}:raw&&typeof raw==='object'?{state:raw.state,at:raw.at??0,count:raw.count??0,expiresAt:raw.expiresAt??0,usernames:Array.isArray(raw.usernames)?raw.usernames:[]}:{state:'idle',count:0,expiresAt:0,usernames:[]};
export const relayUsernames=issued=>[...new Set((issued?.iceServers??[]).map(s=>s.username).filter(Boolean))];
const heldUsernames=record=>Object.values(record?.relay??{}).flatMap(slot=>relaySlot(slot).usernames);

/**
 * Issues relay credentials for one leg of the session at `path`.
 * `check(record)` throws when the record no longer allows issuance (participant, state); it runs in both transactions.
 * `budget` is {reserve({...,maxBytes,ttl}) -> {enforced}, commit(reservation), release?(reservation)}.
 * Returns {issued, retryAt}: retryAt is set when unrevoked usernames need a later sweep.
 */
export async function issueRelayCredentials({store,path,leg,bytes,check=()=>{},budget,adapter,now=()=>Date.now(),reservation:context={}}){
 if(!Number.isSafeInteger(bytes)||bytes<0)fail('relay_invalid','The relay envelope is invalid.',400);
 let prior=[],count=0,leaseAt=0,sessionExpiresAt=0;
 await store.transaction(async tx=>{
  const current=await tx.get(path);if(!current)fail('relay_session_expired','This session has expired.',410);check(current);
  const at=now(),slot=relaySlot(current.relay?.[leg]);
  if(slot.state==='issuing'&&slot.at+RELAY_LEASE_MS>at||slot.state==='issued'&&slot.expiresAt>at)fail('relay_already_issued','Relay credentials were already issued for this leg.',409);
  const reserved=Number.isSafeInteger(current.relayReserved)?current.relayReserved:0;
  if(slot.count>=RELAY_MAX_ISSUES||reserved+bytes>bytes*RELAY_RESERVATION_FACTOR)fail('relay_limit','No more relay credentials can be issued for this session.',409);
  if(current.expiresAt-at<1000)fail('relay_session_expired','This session has expired.',410);
  prior=slot.usernames;count=slot.count+1;leaseAt=at;sessionExpiresAt=current.expiresAt;
  current.relayReserved=reserved+bytes;current.relay={...current.relay,[leg]:{state:'issuing',at,count,usernames:prior,expiresAt:slot.expiresAt}};await tx.put(path,current);
 });
 const ours=slot=>slot?.state==='issuing'&&slot.at===leaseAt;
 let reservation=null,held=false,committed=false,issued=null,ttl=0,issuedAt=0;
 try{
  reservation=await budget.reserve({...context,leg,maxBytes:bytes,ttl:TURN_MAX_TTL_SECONDS});if(!reservation?.enforced)fail('relay_unfunded','An enforceable relay allowance is required.',503);held=true;
  // The TTL is computed after the reservation, so the credential never outlives the session.
  ttl=Math.min(TURN_MAX_TTL_SECONDS,Math.floor((sessionExpiresAt-now())/1000));if(ttl<1)fail('relay_session_expired','This session has expired.',410);
  issuedAt=now();issued=await adapter.issue({ttl});
  await budget.commit(reservation);committed=true;
  const usernames=relayUsernames(issued),expiresAt=issuedAt+ttl*1000;
  await store.transaction(async tx=>{
   const current=await tx.get(path);if(!current)fail('relay_session_expired','This session has expired.',410);check(current);
   if(!ours(current.relay?.[leg]))fail('relay_lease_lost','Relay issuance was superseded; try again.',409);
   current.relay={...current.relay,[leg]:{state:'issued',count,expiresAt,usernames:[...prior,...usernames.map(username=>({username,expiresAt}))]}};await tx.put(path,current);
  });
 }catch(error){
  const unrevoked=[];
  if(issued)for(const username of relayUsernames(issued))try{await adapter.revoke(username);}catch{unrevoked.push({username,expiresAt:issuedAt+ttl*1000});}
  if(held&&!committed&&!unrevoked.length&&typeof budget.release==='function')try{await budget.release(reservation);held=false;}catch{}
  try{await store.transaction(async tx=>{
   const current=await tx.get(path);if(!current)return;const slot=current.relay?.[leg];
   if(!held&&!committed&&Number.isSafeInteger(current.relayReserved))current.relayReserved=Math.max(0,current.relayReserved-bytes);
   if(ours(slot))current.relay={...current.relay,[leg]:{state:'idle',count:unrevoked.length?slot.count:Math.max(0,slot.count-1),usernames:[...(slot.usernames||[]),...unrevoked]}};
   else if(unrevoked.length&&slot&&typeof slot==='object')current.relay={...current.relay,[leg]:{...slot,usernames:[...(slot.usernames||[]),...unrevoked]}};
   await tx.put(path,current);
  });}catch{}
  if(unrevoked.length)error.retryAt=now()+RELAY_RETRY_MS;
  throw error;
 }
 // The previous (expired) credentials are revoked once the new ones are recorded.
 let retryAt=null;if(prior.length)({retryAt}=await revokeRelayCredentials({store,path,adapter,only:prior.map(p=>p.username),now}));
 return {issued,retryAt};
}

/** Revokes stored usernames of the session at `path` (all, or `only` those named). A username whose revocation
 * fails is kept for the sweep until its credential has expired anyway. Returns {pending, retryAt}. */
export async function revokeRelayCredentials({store,path,adapter,only,now=()=>Date.now()}){
 const record=await store.get(path),targets=heldUsernames(record).filter(entry=>!only||only.includes(entry.username));if(!targets.length)return {pending:0,retryAt:null};
 const done=new Set();
 for(const {username,expiresAt} of targets){try{await adapter.revoke(username);done.add(username);}catch{if(expiresAt<=now())done.add(username);}}
 let pending=0;
 await store.transaction(async tx=>{const current=await tx.get(path);if(!current?.relay)return;const relay={};for(const [leg,raw] of Object.entries(current.relay)){if(!raw||typeof raw!=='object'){relay[leg]=raw;continue;}const usernames=(raw.usernames||[]).filter(entry=>!done.has(entry.username));pending+=usernames.length;relay[leg]={...raw,usernames};}current.relay=relay;await tx.put(path,current);});
 return {pending,retryAt:pending?now()+RELAY_RETRY_MS:null};
}

/** Sweep: sessions under `prefix` that are terminal or expired and still hold usernames are revoked. */
export async function sweepRelayCredentials({store,prefix,adapter,terminal=()=>false,limit=128,now=()=>Date.now()}){
 let retryAt=null,swept=0;
 for(const [path,record] of await store.list({prefix,limit})){
  if(!heldUsernames(record).length||!(terminal(record)||record.expiresAt<=now()))continue;swept++;
  const result=await revokeRelayCredentials({store,path,adapter,now});if(result.retryAt)retryAt=Math.min(retryAt??Infinity,result.retryAt);
 }
 return {swept,retryAt};
}
