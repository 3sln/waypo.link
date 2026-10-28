// Instance-wide edge index (spec §7.4; architecture §11 step 1): a bad first-contact credential or an unhosted recipient
// is refused here without waking any mailbox. Entries hold digests only, never a secret or plaintext token. The mailbox
// always re-verifies in full; the index is a cheap pre-filter that may lag (a stale entry only costs work).
// Contact-link entries (`link/<iss>/<jti>`) were removed in contacts spike phase 4; resetEdgeIndexLinks deletes them.
import {sha256,jcs,ProtocolFault} from '../../messaging-protocol/index.mjs';
import {equalDigest} from '../../messaging-protocol/encoding.mjs';

const DUMMY='A'.repeat(43);
// Contacts spike phase 3 (messaging §7.4, §6.7 step 2; provisional): invitation entries keyed by token digest
// {owner, state: live|exhausted|dead, redeemers: [H(principal)], expiresAt} and hosted-recipient entries keyed by
// (issuer, owner) {owner}. Neither holds a token, a secret or a principal in clear.
export const inviteKey=digest=>`invite/${digest}`;
export const hostKey=(issuer,owner)=>`host/${encodeURIComponent(issuer)}|${encodeURIComponent(owner)}`;
const redeemerDigest=p=>sha256(globalThis.crypto,jcs(['bindle-messaging-redeemer-v1',p.issuer,p.subject]));
const inviteInvalid=()=>{throw new ProtocolFault('invite_invalid');};
export function createEdgeIndex(store){
 if(!store||typeof store.get!=='function'||typeof store.put!=='function')throw new TypeError('The edge index needs a store');
 return Object.freeze({
  // Monotonic per key: an older generation never overwrites a newer one, and another owner never takes over. A queued
  // entry of any other kind (a contact-link publication queued before phase 4) is dropped.
  async publish(entry){
   if(entry.kind!=='invite'&&entry.kind!=='host')return false;
   const key=entry.kind==='invite'?inviteKey(entry.digest):hostKey(entry.issuer,entry.subject),prior=await store.get(key);
   if(prior&&(prior.owner!==entry.owner||prior.generation>=entry.generation))return false;
   await store.put(key,entry.kind==='invite'?{owner:entry.owner,state:entry.state,redeemers:entry.redeemers??[],expiresAt:entry.expiresAt,generation:entry.generation}:{owner:entry.owner,active:entry.active===true,generation:entry.generation});return true;
  },
  // §6.7 step 2: the routed owner of a hosted recipient with a current occupant, or recipient_unavailable. One body and
  // timing class for "not hosted" and "no occupant".
  async hosted(issuer,owner){const entry=typeof issuer==='string'&&typeof owner==='string'?await store.get(hostKey(issuer,owner)):undefined;if(!entry||entry.active!==true)throw new ProtocolFault('recipient_unavailable',{retryAfter:60});return entry.owner;},
  // §4.4 step 3 pre-filter: the presented token's digest must equal `recipient.invite`, name a live entry for the claimed
  // owner, or an exhausted one whose recorded redeemers include the claimed author (so its identical retry reaches the
  // replay step). Every failure is the same invite_invalid after the same digest work. The mailbox re-checks in full.
  async checkInvite(token,{invite,owner,author}){
   const digest=await sha256(globalThis.crypto,String(token)),claimed=await redeemerDigest(author),entry=await store.get(inviteKey(invite));
   const live=entry&&entry.owner===owner&&(entry.state==='live'||entry.state==='exhausted'&&Array.isArray(entry.redeemers)&&entry.redeemers.includes(claimed));
   if(!equalDigest(digest,typeof invite==='string'?invite:DUMMY)||!live)inviteInvalid();
   return entry.owner;
  },
 });
}
// Delivers queued publications from one mailbox to the edge index, then deletes exactly the rows it delivered.
// Safe to repeat after a crash at any point: publish is idempotent and generation-ordered.
export async function flushEdgeOutbox(mailboxStore,edge,owner){
 const rows=await mailboxStore.list({prefix:'edge-outbox/'});let published=0;
 for(const [,entry] of rows){await edge.publish({...entry,owner});published++;}
 if(rows.size)await mailboxStore.transaction(async tx=>{for(const [key,entry] of rows){const current=await tx.get(key);if(current&&current.generation===entry.generation)await tx.delete(key);}});
 return published;
}
// Contacts spike phase 4 reset, instance-index half (`parlay-contact-links-retired-v1`): deletes the retired contact-link
// entries `link/<iss>/<jti>` in bounded pages, then writes the marker last. Idempotent; a crash resumes. Invitation,
// hosted-recipient and conversation entries are kept. `store` is the raw index store ({get, list, transaction}).
export const EDGE_LINKS_RESET_MARKER='migration/parlay-contact-links-retired-v1';
export async function resetEdgeIndexLinks(store,{limit=256,page=64,now=()=>Date.now()}={}){
 if(await store.get(EDGE_LINKS_RESET_MARKER)!==undefined)return {done:true,deleted:0};
 let deleted=0;
 while(deleted<limit){
  const rows=await store.list({prefix:'link/',limit:Math.min(page,limit-deleted)});if(!rows.size)break;
  await store.transaction(async tx=>{for(const key of rows.keys())await tx.delete(key);});deleted+=rows.size;
 }
 if((await store.list({prefix:'link/',limit:1})).size)return {done:false,deleted};
 await store.transaction(tx=>tx.put(EDGE_LINKS_RESET_MARKER,{version:1,completedAt:now()}));
 return {done:true,deleted};
}
