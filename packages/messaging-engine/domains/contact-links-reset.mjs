// Contacts spike phase 4 reset `parlay-contact-links-retired-v1` (docs/architecture/contacts-and-links-rethink.md §9,
// last paragraph; provisional, unsigned). Destructive cleanup is acceptable (no real users; DEVLOG 2026-10-27, SQ-1).
//
// Contact links left Parlay: first contact is only an invitation redemption (`recipient.invite` + BindleInvite) or the
// list-policy gate (messaging §4, §6.7). This bounded, idempotent reset, in the style of the core `messaging-retired-v1`
// reset (packages/runtime/messaging-reset.mjs), deletes the retired mailbox families, in this order:
//   1. queued contact-link edge publications: `edge-outbox/` rows that are not invitation or hosted-recipient entries
//      (so they never reach the instance index; the index half is resetEdgeIndexLinks in store/edge-index.mjs);
//   2. `decision/`      conditional-link audience decisions;
//   3. `contact-link/`, `known/`  the indexes of contacts added from another person's contact link;
//   4. `contact/`       those contacts (their principals were unverified link claims, so nothing is migrated);
//   5. `parent/`        owner-issued contact-link parents, last among the data.
// It then seeds the built-in "Contacts" list (policy `message`, "can message you") from the owner's accepted two-party
// conversation peers, but only in a mailbox whose owner has never curated a list (review M1, provisional): for every
// active room with exactly two participants whose other participant is an `accepted` peer, is not blocked and belongs
// to no list at all, that peer joins Contacts (with the binding the conversation verified). A group peer joins no list
// (rethink §4.3), a blocked peer is never added (a block overrides every list), and the owner never lists itself.
// Seeding pages over `conv/room/` with a cursor row; each room is decided inside one transaction against the live room,
// peer, block, memberships and list rows.
//
// Why "never curated" is a mailbox-wide rule (M1): seeding must never widen a narrower placement the owner chose (a peer
// put only in a `request` or `receive-only` list: firstContactPolicy takes the most permissive list, so adding Contacts
// would admit that peer's credential-less first contact) and must never undo a removal. A per-peer membership check
// covers the first case but not the second, because removeMember leaves no tombstone. Instead the reset relies on an
// invariant of the list code (invites.mjs): every list mutation (lists.add, lists.remove, lists.create,
// lists.set-policy, invitation placement and admission, developer-contact minting) writes the built-in list row before
// it touches a membership, and no code deletes list rows; this reset never writes a list row itself (listRow falls back
// to the built-in Contacts definition). So an empty `list/` prefix proves that no one was ever added or removed except
// by this reset, and a non-empty one stops seeding for good, including when the owner curates between two slices. The
// cost of the rule is that a mailbox already curated under phase 3 gets no seeded Contacts; its peers stay reachable in
// their existing conversations, and the owner can add them by hand. The per-peer check (any membership, of any list)
// stays as a second guard and keeps the seeding free of duplicates.
//
// Where it runs (application lifecycle, not wire behaviour): the app shells run `mailbox.reset-contact-links` (system
// actor) on mailbox open, before the requested operation, and again from the mailbox alarm until the marker exists
// (apps/parlay/worker/mailbox.mjs `open` and `alarm`). Kept: invitations (`inv/`), lists and memberships (`list/`,
// `list-member/`, `member-of/`), blocks, conversations, items, replay rows and every other family.
import {MailboxAction} from '../engine.mjs';
import {KEYS,actorOwner,principalKey} from '../store/mailbox.mjs';
import {INV,CONTACTS_LIST,INVITE_POLICY} from './invites.mjs';

export const CONTACT_LINKS_RESET='parlay-contact-links-retired-v1';
export const CONTACT_LINKS_RESET_MARKER=`migration/${CONTACT_LINKS_RESET}`;
const CURSOR=`${CONTACT_LINKS_RESET_MARKER}/rooms`,STATE=`${CONTACT_LINKS_RESET_MARKER}/outbox`;
export const CONTACT_LINKS_RESET_PREFIXES=Object.freeze(['decision/','contact-link/','known/','contact/','parent/']);
const live=entry=>entry?.kind==='invite'||entry?.kind==='host';
const who=p=>({issuer:p.issuer,subject:p.subject});
const same=(a,b)=>a.issuer===b.issuer&&a.subject===b.subject;
// Defensive paging over any store: some adapters ignore `startAfter` or `limit`, so both are reapplied here.
const listPage=async(store,prefix,after,n)=>new Map([...await store.list({prefix,...after===undefined?{}:{startAfter:after},limit:n})].filter(([key])=>after===undefined||key>after).slice(0,n));
const bindingOf=peer=>{const b={keyId:peer.keyId,ingress:peer.outbound?.ingress,identityURI:peer.principal?.identityURI};return typeof b.keyId==='string'&&typeof b.ingress==='string'&&typeof b.identityURI==='string'?b:undefined;};

// The owner has curated a list (see the header): seeding stops. Reads only list rows, which this reset never writes.
const curated=async tx=>(await tx.list({prefix:INV.lists,limit:1})).size>0;
// Seeds Contacts from one room inside the caller's transaction. Returns 1 when it created a membership.
async function seedRoom(tx,room,owner,now){
 if(room?.state!=='active'||!Array.isArray(room.participants)||room.participants.length!==2)return 0;
 const other=room.participants.map(x=>x?.principal).find(p=>p&&typeof p.issuer==='string'&&typeof p.subject==='string'&&!same(p,owner));if(!other)return 0;
 const peer=await tx.get(`conv/peer/${room.id}/${principalKey(other)}`);
 if(peer?.state!=='accepted'||await tx.get(KEYS.block(who(other))))return 0;
 const key=INV.member(CONTACTS_LIST,other),binding=bindingOf(peer),prior=await tx.get(key);
 // A membership this reset created from another room of the same peer may still gain that room's binding.
 if(prior){if(prior.via?.kind==='reset'&&binding&&!prior.binding)await tx.put(key,{...prior,binding});return 0;}
 // Any other membership (any list) is the owner's placement: never widened (M1).
 if((await tx.list({prefix:INV.memberships(other),limit:1})).size)return 0;
 if((await tx.list({prefix:INV.members(CONTACTS_LIST)})).size>=INVITE_POLICY.maxMembers)return 0;
 await tx.put(key,{principal:who(other),list:CONTACTS_LIST,addedAt:now,via:{kind:'reset',reset:CONTACT_LINKS_RESET},...binding?{binding}:{}});await tx.put(INV.memberOf(other,CONTACTS_LIST),{list:CONTACTS_LIST});
 return 1;
}

/**
 * One bounded slice of the reset over the raw mailbox store ({get, list, transaction}). At most `limit` rows are deleted
 * or rooms examined per call, in transactions of at most `page` rows. Returns {done, deleted, seeded}.
 */
export async function resetContactLinks(store,{limit=256,page=64,now=Date.now()}={}){
 if(await store.get(CONTACT_LINKS_RESET_MARKER)!==undefined)return {done:true,deleted:0,seeded:0};
 let work=0,deleted=0,seeded=0;
 // 1. Queued contact-link edge publications (no `kind`), paged by key. Nothing queues them any more, so one full scan
 // suffices; its progress is kept in the state row so a resumed slice never rescans live entries.
 let state=await store.get(STATE)??{};
 while(!state.outbox&&work<limit){
  const n=Math.min(page,limit-work),rows=await listPage(store,'edge-outbox/',state.after,n);work+=rows.size;
  const stale=[...rows].filter(([,entry])=>!live(entry)).map(([key])=>key),next=rows.size<n?{outbox:true}:{after:[...rows.keys()].at(-1)};
  await store.transaction(async tx=>{for(const key of stale){const current=await tx.get(key);if(current&&!live(current)){await tx.delete(key);deleted++;}}await tx.put(STATE,next);});
  state=next;
 }
 if(!state.outbox)return {done:false,deleted,seeded};
 // 2–5. Retired families, whole prefixes, parents last.
 for(const prefix of CONTACT_LINKS_RESET_PREFIXES){
  while(work<limit){
   const rows=await listPage(store,prefix,undefined,Math.min(page,limit-work));if(!rows.size)break;
   await store.transaction(async tx=>{for(const key of rows.keys())await tx.delete(key);});work+=rows.size;deleted+=rows.size;
  }
  if(work>=limit)return {done:false,deleted,seeded};
 }
 // 6. Seed Contacts from accepted two-party conversation peers, resuming after the stored cursor.
 const config=await store.get(KEYS.config),owner=config?.principal;
 if(owner&&!await curated(store))while(work<limit){
  const after=await store.get(CURSOR),n=Math.min(page,limit-work),rows=await listPage(store,'conv/room/',after??undefined,n);if(!rows.size)break;
  await store.transaction(async tx=>{if(await tx.get(CURSOR)!==after)return;if(!await curated(tx))for(const key of rows.keys())seeded+=await seedRoom(tx,await tx.get(key),owner,now);await tx.put(CURSOR,[...rows.keys()].at(-1));});
  work+=rows.size;if(rows.size<n)break;
 }
 if(work>=limit)return {done:false,deleted,seeded};
 // 7. Marker last. A mailbox not yet configured has no rooms to seed from; its marker is written all the same.
 await store.transaction(async tx=>{await tx.delete(CURSOR);await tx.delete(STATE);await tx.put(CONTACT_LINKS_RESET_MARKER,{version:1,completedAt:now});});
 return {done:true,deleted,seeded};
}

export class MailboxResetContactLinks extends MailboxAction {
 static operation='mailbox.reset-contact-links';static deps=['contacts','clock'];static changes='contacts-changed';
 run({contacts,clock}){actorOwner(this.actor,['system','owner']);const {limit,page}=this.input??{};return resetContactLinks(contacts.store,{limit:Number.isSafeInteger(limit)&&limit>0&&limit<=4096?limit:256,page:Number.isSafeInteger(page)&&page>0&&page<=256?page:64,now:clock.now()});}
}
export const RESET_OPERATIONS=[MailboxResetContactLinks];
