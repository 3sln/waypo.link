// Signaling admission at the recipient provider and the initiator provider's own limits (docs/spec/extensions/
// signaling.md §5.2, §9.2 step 7, §12.1, §13). Storage keys, the owner IP policy, principal and provider blocks,
// fixed-window limits (with the open-offer per-issuer fair share) and the pending/connected capacity classes, as
// functions over one account writer's transaction `tx` ({get, put, delete, list({prefix, limit, startAfter}) -> Map}).
// Provisional (coordinator), not signed off by the user; behind SIGNALING_ENABLED (default off).
//
// Appendix C.1 admission.mjs: mutes and alerts are removed; blocks (principal and issuer), limits and windows are kept;
// the link windows (`preferred`, `issuerParent`) are removed; added are the aggregate `data` budget, the offer windows
// (bound and open, with the per-issuer fair share), the pairing windows (own-entity per (pairing, endpoint pair),
// cross-entity per pairing id), the pairing and open-offer sub-budgets and the split pending reserve.
//
// No presence oracle (§12.1): every admission outcome after the batch's shape check is silent. Limits are keyed by a
// SHA-256 of what they count (no principal named in a row) and expire with their window (§12.4).
import {digest} from '../core/records.mjs';
import {principalKey} from '../core/principals.mjs';
import {IP_POLICIES} from './messages.mjs';
import {BOUNDS} from './sessions.mjs';

/** Storage prefix of every signaling row in an entity's account store (renamed from `rtc/`; dev rows reset). */
export const PREFIX='sig/';
export const K=Object.freeze({
 policy:'sig/policy',closed:'sig/closed',service:'sig/service',
 endpoint:id=>`sig/ep/${id}`,endpointPrefix:'sig/ep/',
 queue:(id,seq)=>`sig/epq/${id}/${String(seq).padStart(12,'0')}`,queuePrefix:id=>`sig/epq/${id}/`,
 out:sid=>`sig/out/${sid}`,outPrefix:'sig/out/',
 in:(initiator,sid)=>`sig/in/${principalKey(initiator)}/${sid}`,inPrefix:'sig/in/',
 delivered:(endpoint,sid)=>`sig/dlv/${endpoint}/${sid}`,deliveredPrefix:endpoint=>`sig/dlv/${endpoint}/`,
 delegate:jkt=>`sig/dlg/${jkt}`,delegatePrefix:'sig/dlg/',
 offer:digest=>`sig/offer/${digest}`,offerPrefix:'sig/offer/',
 pairing:id=>`sig/pairing/${id}`,pairingPrefix:'sig/pairing/',
 pairingPeer:hash=>`sig/pairing-peer/${hash}`,pairingPeerPrefix:'sig/pairing-peer/',
 block:p=>`sig/block/${principalKey(p)}`,blockPrefix:'sig/block/',
 // A block of a whole initiator provider (issuer origin), AMD-RW4. Not under blockPrefix.
 issuerBlock:iss=>`sig/block-iss/${encodeURIComponent(iss)}`,issuerBlockPrefix:'sig/block-iss/',
 limit:(name,hash)=>`sig/limit/${name}/${hash}`,limitPrefix:'sig/limit/',
 // Outbox rows per peer (one failing peer never stalls the others); `sig/outbox-seq` holds {seq, count}.
 outbox:(peer,seq)=>`sig/outbox/${principalKey(peer)}/${String(seq).padStart(12,'0')}`,outboxPeerPrefix:peer=>`sig/outbox/${principalKey(peer)}/`,outboxPrefix:'sig/outbox/',outboxSeq:'sig/outbox-seq',
 inbox:seq=>`sig/inq/${String(seq).padStart(12,'0')}`,inboxPrefix:'sig/inq/',inboxMeta:'sig/inq-meta',
 aep:p=>`sig/aep/${principalKey(p)}`,aepPrefix:'sig/aep/',
 // The connection generation an app's signaling state belongs to (§5.4 "its connection is live", §20.1.4 clearing),
 // keyed by a hash of the client id: {clientId, generation}.
 app:hash=>`sig/app/${hash}`,appPrefix:'sig/app/',
});

// ---- owner IP policy (§16.5) -------------------------------------------------------------------------------------
/** Defaults: relay-only for other entities (RTC-6), direct (`all`) for own devices. `revision` is the compare-and-swap
 * counter of §14.1 "Concurrent edits". */
export const DEFAULT_POLICY=Object.freeze({v:2,other:'relay',self:'all',revision:0});
export async function readPolicy(tx){const p=await tx.get(K.policy);return p?.v===2?p:structuredClone(DEFAULT_POLICY);}
/** The sender's IP policy for one session: `other` cross-entity (relay or public; `all` never applies cross-entity),
 * `self` for own devices. */
export const ipPolicyFor=(policy,{crossEntity})=>crossEntity?(policy.other==='public'?'public':'relay'):(IP_POLICIES.includes(policy.self)?policy.self:'all');
const IP_RANK={relay:0,public:1,all:2};
/** Whether `next` widens `prior` (a more permissive IP policy). */
export const policyWidens=(prior,next)=>IP_RANK[next.other]>IP_RANK[prior.other]||IP_RANK[next.self]>IP_RANK[prior.self];
/** The stricter of two policies (§16.5: the session's pinned policy and the owner's current one). */
export const stricterIp=(a,b)=>(IP_RANK[a]??0)<=(IP_RANK[b]??0)?(a in IP_RANK?a:'relay'):b;

// ---- blocks (§13.2) -----------------------------------------------------------------------------------------------
// The owner's own principal and its own provider can never be blocked, and an invite from the owner's own entity is
// never blocked, whatever rows are stored (RTCw-M6-3). Blocked invites are dropped at the block step, silently.
const samePrincipal=(a,b)=>Boolean(a&&b)&&a.iss===b.iss&&a.sub===b.sub;
/** Whether an invite from `principal` is dropped; `self` (the owner's own principal) is never blocked. */
export const isBlocked=async(tx,principal,{self}={})=>!samePrincipal(principal,self)&&Boolean(await tx.get(K.block(principal))||principal.iss!==self?.iss&&await tx.get(K.issuerBlock(principal.iss)));
/** A block target from owner input: exactly `{principal}` or `{issuer}`, or null. `issuer` is this host's own issuer,
 * which is never a provider block target. */
export function blockTarget(input,{issuer,validPrincipal,validOrigin}){
 const keys=input!==null&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input):[];if(keys.length!==1)return null;
 if(keys[0]==='principal')return validPrincipal(input.principal)?{principal:{iss:input.principal.iss,sub:input.principal.sub}}:null;
 if(keys[0]==='issuer')return typeof input.issuer==='string'&&validOrigin(input.issuer)&&input.issuer!==issuer?{issuer:input.issuer}:null;
 return null;
}
export const blockKey=target=>target.issuer!==undefined?K.issuerBlock(target.issuer):K.block(target.principal);
/** Whether a principal falls under `target`. */
export const blockCovers=(target,principal)=>target.issuer!==undefined?principal?.iss===target.issuer:samePrincipal(principal,target.principal);
/** Stores `target` (idempotent). Returns false, storing nothing, when its table is full. */
export async function putBlock(tx,target,now){
 const key=blockKey(target);if(await tx.get(key))return true;
 const [prefix,max]=target.issuer!==undefined?[K.issuerBlockPrefix,BOUNDS.issuerBlocks]:[K.blockPrefix,BOUNDS.blocks];
 if((await tx.list({prefix,limit:max})).size>=max)return false;
 await tx.put(key,target.issuer!==undefined?{issuer:target.issuer,at:now}:{principal:target.principal,at:now});return true;
}
export async function principalBlocks(tx){return [...(await tx.list({prefix:K.blockPrefix,limit:BOUNDS.blocks})).values()].map(r=>({principal:r.principal,at:r.at}));}
export async function issuerBlocks(tx){return [...(await tx.list({prefix:K.issuerBlockPrefix,limit:BOUNDS.issuerBlocks})).values()].map(r=>({issuer:r.issuer,at:r.at}));}

// ---- fixed-window limits (§13.1, Appendix B RTC-11) ---------------------------------------------------------------
const MIN=60000,HOUR=3600000;
/** Reference values (examples; provider policy): {max, windowMs} per limit name. */
export const LIMITS=Object.freeze({
 // Recipient, cross-entity: per (initiator, recipient); per (sending issuer, recipient) (same-host principals are
 // individual shares, bounded together by `sameHost`); per recipient. `initiator` is the host-wide window per
 // initiator origin principal across every recipient on the host (hostLimits port).
 pair:{max:6,windowMs:10*MIN},initiator:{max:30,windowMs:HOUR},issuerRecipient:{max:20,windowMs:HOUR},recipient:{max:60,windowMs:HOUR},sameHost:{max:40,windowMs:HOUR},
 // Own devices (§13.1 "Own devices"): `self` invites at the recipient AND own-entity `open` calls at the initiator.
 self:{max:120,windowMs:HOUR},
 // Own-entity pairings: per (pairing, endpoint pair). Cross-entity pairings: per pairing id, 30 per local covered
 // endpoint, at most 240 (`relation`; its max is computed per invite, this is the per-endpoint unit).
 ownPairing:{max:30,windowMs:HOUR},relation:{max:30,windowMs:HOUR},
 // Open offers (§13.1 "Open offers"): per offer W, per (initiator, offer), and the per-issuer fair share floor F.
 offerOpen:{max:60,windowMs:HOUR},offerOpenService:{max:3600,windowMs:HOUR},offerPrincipal:{max:6,windowMs:HOUR},offerPrincipalService:{max:12,windowMs:HOUR},
 offerIssuerFloor:{max:6,windowMs:HOUR},offerIssuerFloorService:{max:60,windowMs:HOUR},
 // Initiator provider: `open` calls (cross-entity only), key-warming fetches, offer mints per app.
 opens:{max:60,windowMs:HOUR},warms:{max:20,windowMs:HOUR},mint:{max:120,windowMs:HOUR},
 leg:{max:256,windowMs:MIN},
});
export const RELATION_MAX_PER_PAIRING=240;
const limitHash=(name,parts,crypto)=>digest(crypto,JSON.stringify([name,...parts]));
const windowOf=item=>({max:item.max??LIMITS[item.name].max,windowMs:item.windowMs??LIMITS[item.name].windowMs});
/**
 * Counts `amount` (default 1) against each named limit atomically: true and every counter incremented only when all
 * have room; otherwise false and nothing changes. `items` is [{name, parts, max?, windowMs?, amount?}].
 */
export async function takeLimits(tx,items,now,crypto=globalThis.crypto){
 const rows=[];
 for(const item of items){const l=windowOf(item),amount=item.amount??1,key=K.limit(item.name,await limitHash(item.name,item.parts,crypto)),row=await tx.get(key);const live=row&&row.resetAt>now?row:{count:0,resetAt:now+l.windowMs};if(live.count+amount>l.max)return false;rows.push([key,live,amount]);}
 for(const [key,row,amount] of rows)await tx.put(key,{count:row.count+amount,resetAt:row.resetAt});
 return true;
}
/** A read-only pre-check: false when any named limit has no room (nothing is written). */
export async function limitsOpen(tx,items,now,crypto=globalThis.crypto){
 for(const item of items){const l=windowOf(item),row=await tx.get(K.limit(item.name,await limitHash(item.name,item.parts,crypto)));if(row&&row.resetAt>now&&row.count+(item.amount??1)>l.max)return false;}
 return true;
}
/** Deletes limit rows whose window has passed (bounded per call). */
export async function pruneLimits(tx,now,budget=512){let n=0;for(const [key,row] of await tx.list({prefix:K.limitPrefix,limit:budget}))if(!(row?.resetAt>now)){await tx.delete(key);n++;}return n;}

/**
 * The per-issuer fair share of one open offer's window (§13.1): one sending issuer may take at most max(W / (n + 1), F)
 * of W, where n is the number of issuers already charged to that offer in the current window (the sender included when
 * it already holds charges; this provider's own issuer counts as one). Read-only check (`take: false`) or atomic take.
 * The row holds keyed hashes of issuers, never an issuer.
 */
export async function fairShare(tx,{offer,issuer,service,now,take=false},crypto=globalThis.crypto){
 const W=(service?LIMITS.offerOpenService:LIMITS.offerOpen).max,F=(service?LIMITS.offerIssuerFloorService:LIMITS.offerIssuerFloor).max,windowMs=LIMITS.offerOpen.windowMs;
 const key=K.limit('offer-issuers',await limitHash('offer-issuers',[offer],crypto)),row=await tx.get(key),live=row&&row.resetAt>now?row:{count:0,resetAt:now+windowMs,issuers:{}};
 const id=await limitHash('offer-issuer',[offer,issuer],crypto),n=Object.keys(live.issuers).length,mine=live.issuers[id]??0;
 if(mine>=Math.max(Math.floor(W/(n+1)),F))return false;
 if(take)await tx.put(key,{count:live.count+1,resetAt:live.resetAt,issuers:{...live.issuers,[id]:mine+1}});
 return true;
}

/**
 * The §13.1 windows one admitted invite counts against at the recipient, by its admission class:
 *   self         the entity's own `self` window only
 *   ownPairing   its own window per (pairing, endpoint pair) only
 *   relation     the window per pairing id (30 per covered local endpoint, at most 240) and the per-(initiator,
 *                recipient) window; never the per-recipient or issuer windows
 *   bound        the per-(initiator, recipient) window only (the offer's single use bounds the rest)
 *   open         its own windows only: per offer and per (initiator, offer) (the fair share is checked separately)
 *   unbased      a cross-entity invite with no basis, or whose offer did not match: pair, issuer and recipient
 *                windows (and the same-host share)
 * The host-wide initiator window applies to every cross-entity invite and is spent through the hostLimits port.
 */
export function inviteLimits({cls,sender,issuer,pairing=null,endpoints=null,offer=null,service=false,covered=1}){
 if(cls==='self')return [{name:'self',parts:[]}];
 if(cls==='ownPairing')return [{name:'ownPairing',parts:[pairing,...endpoints]}];
 const pair={name:'pair',parts:[sender.iss,sender.sub]};
 if(cls==='relation')return [{name:'relation',parts:[pairing],max:Math.min(RELATION_MAX_PER_PAIRING,LIMITS.relation.max*Math.max(1,covered))},pair];
 if(cls==='bound')return [pair];
 if(cls==='open')return [{name:service?'offerOpenService':'offerOpen',parts:[offer]},{name:service?'offerPrincipalService':'offerPrincipal',parts:[offer,sender.iss,sender.sub]}];
 const same=sender.iss===issuer,share=same?[sender.iss,sender.sub]:[sender.iss];
 return [pair,{name:'issuerRecipient',parts:share},{name:'recipient',parts:[]},...same?[{name:'sameHost',parts:[]}]:[]];
}

// ---- capacity (§13.1 pending and connected capacity, sub-budgets, the split pending reserve) -----------------------
/** The capacity class of an admission class: `self` and `ownPairing` use the `self` reserve share; `relation` and
 * `bound` the cross-entity share; `open` never uses a reserve. Pairings (`ownPairing`, `relation`) share the pairing
 * sub-budget; open offers the open-offer sub-budget. */
const RESERVE={self:'self',ownPairing:'self',relation:'cross',bound:'cross'};
const PAIRING=new Set(['ownPairing','relation']);
/** Counts live `in` records by state and class. */
export function capacityCounts(records){
 const c={pending:0,connected:0,pendingBy:{},connectedBy:{},pendingPairing:0,connectedPairing:0,reserveBy:{}};
 for(const r of records){const cls=r.cls??'self';if(r.state==='pending'){c.pending++;c.pendingBy[cls]=(c.pendingBy[cls]??0)+1;if(PAIRING.has(cls))c.pendingPairing++;if(r.reserve)c.reserveBy[r.reserve]=(c.reserveBy[r.reserve]??0)+1;}else if(r.state==='connected'){c.connected++;c.connectedBy[cls]=(c.connectedBy[cls]??0)+1;if(PAIRING.has(cls))c.connectedPairing++;}}
 return c;
}
/**
 * Whether an invite of admission class `cls` fits the recipient's capacity: false, `'base'` (base pending capacity) or
 * the reserve share it takes (`'self'` or `'cross'`; the service records it on the session as `reserve`). Beyond base
 * capacity only the class's own share admits, while fewer pending sessions hold that share than its size, so
 * cross-entity invites can never take the `self` share and own-entity invites never the cross-entity share. Open offers
 * never use a reserve and take at most their sub-budget; pairings together take at most theirs.
 */
export function capacityAllows(counts,cls){
 const P=BOUNDS.recipientPending,C=BOUNDS.recipientConnected,total=P+BOUNDS.reserveSelf+BOUNDS.reserveCross;
 if(counts.connected>=C)return false;
 // Both sub-budgets are shares of BASE pending capacity P (and of connected capacity C), never of P plus the reserves
 // (§13.1 "Pairing sub-budget", "Open-offer sub-budget": reference at most half of each).
 const pendingShare=Math.floor(P*BOUNDS.subBudgetShare),connectedShare=Math.floor(C*BOUNDS.subBudgetShare);
 if(cls==='open'&&((counts.pendingBy.open??0)>=pendingShare||(counts.connectedBy.open??0)>=connectedShare))return false;
 if(PAIRING.has(cls)&&(counts.pendingPairing>=pendingShare||counts.connectedPairing>=connectedShare))return false;
 if(counts.pending<P)return 'base';
 const share=RESERVE[cls];if(!share)return false;
 return (counts.reserveBy[share]??0)<(share==='self'?BOUNDS.reserveSelf:BOUNDS.reserveCross)&&counts.pending<total?share:false;
}
/** Live, unexpired endpoints registered for `line`, most recently active first. */
export async function endpointsFor(tx,{line,now}){
 const out=[];for(const ep of (await tx.list({prefix:K.endpointPrefix,limit:BOUNDS.endpoints*2})).values())if(ep&&ep.expiresAt>now&&ep.kinds.includes(line))out.push(ep);
 return out.sort((a,b)=>b.lastSeen-a.lastSeen||(a.id<b.id?-1:1));
}
