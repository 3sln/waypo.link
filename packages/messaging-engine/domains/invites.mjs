// Contacts spike phase 3 (docs/architecture/contacts-and-links-rethink.md §4.3–§4.5, CR-C9 single-use subset;
// docs/spec/extensions/messaging.md §4, §6.7, §7.4, §8.2; provisional, unsigned). Parlay single-use invitations,
// first-class contact lists and the first-contact gate, alongside the withdrawn contact links (removed in phase 4).
//
// Application behaviour (spec §4 scope: none of it is on the wire):
//  - lists: a list has a name and one relationship policy, `message` ("can message you"), `request` or `receive-only`.
//    "Contacts" (`message`) is built in. The most permissive policy among a person's lists applies, a block overrides
//    every list, and there are no per-person overrides (§4.4).
//  - invitations: a link record is uses plus expiry (plus its id, an owner-private name, the token digest, its state
//    and a redemption ledger). The "Invite a person" template creates the link, an admission rule ("arrived via this
//    link" → place in Contacts) and uses the Contacts list as its target. Relationship lives on lists, never on links.
//  - admission: a verified redemption is handed to the owner's rules; placement in a `message` or `receive-only` list
//    accepts (the drain sends the invitation response), `request` only holds, no matching rule holds for review, and a
//    blocked redeemer is refused silently (no response; §4.5 makes held, ignored and refused indistinguishable).
//
// Wire behaviour (spec): receive.redeem runs §4.4 steps 3–7 after the edge ran steps 1–2 (handleConversationIngress);
// receive.first-contact runs §6.7 steps 4–5 for credential-less first contact. The edge index holds, per token digest,
// {owner, state, redeemers: H(principal) of recorded redeemers of an exhausted token} and, per hosted recipient, the
// owner; neither holds a token or secret. Only same-host redeemers are verified (CL-24): any other author is
// author_unverifiable (401) with no fetch.
//
// Redeemer side (§4.2, CL-19): invites.inspect verifies the inviter's delegation certificate (directory key, typ,
// bindle, iss/sub, author purpose) and its jkt status, and returns the certificate's ingress; nothing is sent. Only
// invites.redeem (the viewer's confirmation) admits the inviter to Contacts and sends the redemption, at most one pending
// redemption per token digest, with identical bytes on retry (the outbox keeps them). invites.sweep rolls the admission
// back when this flow created it, no conversation with the inviter exists, and either a terminal error arrived or the
// return control expired without an accept.
import * as P from '../../messaging-protocol/index.mjs';
import {equalDigest,isUUID} from '../../messaging-protocol/encoding.mjs';
import {verifyDelegation} from '../../messaging-protocol/certificate.mjs';
import {MailboxAction,MailboxQuery} from '../engine.mjs';
import {MailboxFault,fault} from '../faults.mjs';
import {KEYS,actorOwner,readConfig,principalKey,queueEdge,chargeUsage,BOUNDS} from '../store/mailbox.mjs';
import {projectIncoming} from '../store/item-index.mjs';
import {requireRestored} from '../store/restore.mjs';
import {chargeBudget,ownerExhausted} from './receive-budget.mjs';
import {verificationPorts,knownRevoked,recordRevocation,jktIndex,seenKey,boundedCache} from './delegation.mjs';
import {createConversation} from './conversations.mjs';

const DAY=86400000,HOUR=3600000;
const pk=p=>principalKey(p);
const protocol=(code,extra)=>{throw new P.ProtocolFault(code,extra);};
const invalid=message=>fault('invalid_input',message,400);
const who=p=>({issuer:p.issuer,subject:p.subject});
const same=(a,b)=>Boolean(a&&b)&&a.issuer===b.issuer&&a.subject===b.subject;
const te=new TextEncoder();
const token=(n=32)=>P.base64url(globalThis.crypto.getRandomValues(new Uint8Array(n)));

// Provisional application policy values (rethink §4.4, §4.5; reference values, not protocol limits).
export const INVITE_POLICY=Object.freeze({personDefaultMs:7*DAY,personMaxMs:30*DAY,boundMinMs:5*60000,maxLinks:256,maxLedger:64,maxRules:512,
 perInvitationPerHour:30,maxLists:64,maxMembers:4096,pendingRedemptions:64});
export const POLICIES=Object.freeze(['message','request','receive-only']);
// Most permissive first (§4.4): can message you > request > receive only.
const RANK=Object.freeze({message:3,request:2,'receive-only':1});
export const CONTACTS_LIST='contacts';
const BUILTINS=Object.freeze([{id:CONTACTS_LIST,name:'Contacts',policy:'message',builtin:true}]);
export const INV=Object.freeze({
 list:id=>`list/${id}`,lists:'list/',member:(list,p)=>`list-member/${list}/${pk(p)}`,members:list=>`list-member/${list}/`,memberOf:(p,list)=>`member-of/${pk(p)}/${list}`,memberships:p=>`member-of/${pk(p)}/`,
 link:id=>`inv/link/${id}`,links:'inv/link/',token:d=>`inv/token/${d}`,redeemed:(d,p)=>`inv/redeemed/${d}/${pk(p)}`,rule:id=>`inv/rule/${id}`,rules:'inv/rule/',
 accept:id=>`inv/accept/${id}`,accepts:'inv/accept/',pending:d=>`inv/pending/${d}`,pendings:'inv/pending/',
});
// H(author principal) for the edge index's redeemer list: no principal in clear in an instance-wide row.
export const principalDigest=p=>P.sha256(globalThis.crypto,P.jcs(['bindle-messaging-redeemer-v1',p.issuer,p.subject]));
const tokenDigest=t=>P.sha256(globalThis.crypto,t);

// ---------------------------------------------------------------- lists
const listView=(l,count)=>({id:l.id,name:l.name,policy:l.policy,builtin:Boolean(l.builtin),members:count});
async function listRow(store,id){const row=await store.get(INV.list(id));return row??BUILTINS.find(b=>b.id===id)??null;}
async function ensureBuiltins(tx,now){for(const b of BUILTINS)if(!await tx.get(INV.list(b.id)))await tx.put(INV.list(b.id),{...b,createdAt:now});}
/** Adds `principal` to `list` inside the caller's transaction. Returns whether this call created the membership. */
export async function addMember(tx,list,principal,{via,now,binding,selfCreated=false}){
 await ensureBuiltins(tx,now);if(!await tx.get(INV.list(list)))fault('not_found','That list does not exist.',404);
 const key=INV.member(list,principal),prior=await tx.get(key);if(prior){if(binding&&!prior.binding)await tx.put(key,{...prior,binding});return false;}
 if((await tx.list({prefix:INV.members(list)})).size>=INVITE_POLICY.maxMembers)fault('limit_reached','That list is full.',409);
 await tx.put(key,{principal:who(principal),list,addedAt:now,via,...binding?{binding}:{},...selfCreated?{selfCreated:true}:{}});await tx.put(INV.memberOf(principal,list),{list});return true;
}
export async function removeMember(tx,list,principal){const key=INV.member(list,principal);if(!await tx.get(key))return false;await tx.delete(key);await tx.delete(INV.memberOf(principal,list));return true;}
/** The owner policy that gates first contact from `principal` (§6.7 step 5): 'blocked', the most permissive policy
 * among its lists, or null. Reads only; callers recheck it inside their commit. */
export async function firstContactPolicy(store,principal){
 if(await store.get(KEYS.block(who(principal))))return 'blocked';
 let best=null;for(const [,m] of await store.list({prefix:INV.memberships(principal)})){const l=await listRow(store,m.list);if(l&&(best===null||RANK[l.policy]>RANK[best]))best=l.policy;}
 return best;
}
const listInput=v=>{if(typeof v!=='string'||!/^[a-z0-9-]{1,64}$/.test(v))invalid('Choose a list.');return v;};
const principalInput=v=>{try{const u=new URL(v?.issuer);if(u.origin!==v.issuer||u.protocol!=='https:'||!isUUID(v.subject))throw 0;}catch{invalid('Choose a valid person.');}return {issuer:v.issuer,subject:v.subject};};
const nameInput=(v,max=80)=>{if(typeof v!=='string'||!v.trim()||[...v].length>max||/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/u.test(v))invalid('Choose a shorter name.');return v.trim();};

export class ListsList extends MailboxQuery {
 static operation='lists.list';static deps=['contacts'];static refreshOn=['contacts-changed'];
 async fetch({contacts}){actorOwner(this.actor);const store=contacts.store,rows=new Map(BUILTINS.map(b=>[b.id,b]));for(const [,l] of await store.list({prefix:INV.lists}))rows.set(l.id,l);
  const out=[];for(const l of rows.values())out.push(listView(l,(await store.list({prefix:INV.members(l.id)})).size));return {lists:out.sort((a,b)=>Number(b.builtin)-Number(a.builtin)||a.name.localeCompare(b.name))};}
}
export class ListsMembers extends MailboxQuery {
 static operation='lists.members';static deps=['contacts'];static refreshOn=['contacts-changed'];
 async fetch({contacts}){actorOwner(this.actor);const list=listInput(this.input?.list),l=await listRow(contacts.store,list);if(!l)fault('not_found','That list does not exist.',404);
  return {list:listView(l,0),members:[...(await contacts.store.list({prefix:INV.members(list)})).values()].map(m=>({principal:m.principal,addedAt:m.addedAt,via:m.via?.kind??'manual',...m.via?.invite?{invite:m.via.invite}:{},reachable:Boolean(m.binding)}))};}
}
export class ListsCreate extends MailboxAction {
 static operation='lists.create';static deps=['contacts','random','clock'];static changes='contacts-changed';
 async run({contacts,random,clock}){actorOwner(this.actor);const name=nameInput(this.input?.name),policy=this.input?.policy;if(!POLICIES.includes(policy))invalid('Choose a policy.');
  return contacts.store.transaction(async tx=>{await ensureBuiltins(tx,clock.now());if((await tx.list({prefix:INV.lists})).size>=INVITE_POLICY.maxLists)fault('limit_reached','Too many lists.',409);const l={id:random.uuid(),name,policy,builtin:false,createdAt:clock.now()};await tx.put(INV.list(l.id),l);return listView(l,0);});}
}
// A policy change applies to every member at their next inbound evaluation (§4.4): nothing is cached per member.
export class ListsSetPolicy extends MailboxAction {
 static operation='lists.set-policy';static deps=['contacts','clock'];static changes='contacts-changed';
 async run({contacts,clock}){actorOwner(this.actor);const list=listInput(this.input?.list),policy=this.input?.policy;if(!POLICIES.includes(policy))invalid('Choose a policy.');
  return contacts.store.transaction(async tx=>{await ensureBuiltins(tx,clock.now());const l=await tx.get(INV.list(list));if(!l)fault('not_found','That list does not exist.',404);await tx.put(INV.list(list),{...l,policy});return listView({...l,policy},(await tx.list({prefix:INV.members(list)})).size);});}
}
export class ListsAdd extends MailboxAction {
 static operation='lists.add';static deps=['contacts','clock'];static changes='contacts-changed';
 async run({contacts,clock}){actorOwner(this.actor);const list=listInput(this.input?.list),principal=principalInput(this.input?.principal),config=await readConfig(contacts.store);if(same(principal,config.principal))invalid('That is you.');
  return contacts.store.transaction(async tx=>({added:await addMember(tx,list,principal,{via:{kind:'manual'},now:clock.now()})}));}
}
export class ListsRemove extends MailboxAction {
 static operation='lists.remove';static deps=['contacts'];static changes='contacts-changed';
 async run({contacts}){actorOwner(this.actor);const list=listInput(this.input?.list),principal=principalInput(this.input?.principal);return contacts.store.transaction(async tx=>({removed:await removeMember(tx,list,principal)}));}
}

// ---------------------------------------------------------------- inviter: links, rules, templates
const linkView=l=>({id:l.id,name:l.name,template:l.template,uses:{max:l.maxUses,used:l.used},...l.bound?{bound:l.bound}:{},expiresAt:l.expiresAt,state:l.state,createdAt:l.createdAt,...l.revokedAt?{revokedAt:l.revokedAt}:{},
 ledger:l.ledger.map(e=>({principal:e.principal,at:e.at,outcome:e.outcome}))});
const edgeState=(l,now)=>l.state!=='live'||l.expiresAt<=now?'dead':l.used>=l.maxUses?'exhausted':'live';
async function publishInvite(tx,l,now){await queueEdge(tx,{kind:'invite',digest:l.tokenDigest,state:edgeState(l,now),redeemers:l.used>=l.maxUses?l.redeemers??[]:[],expiresAt:l.expiresAt});}
// The inviter's current author-purpose certificate, for the intent's `delegation` member (§4.1): the same snapshot
// rules as conversations.mjs (principal, purpose, certified ingress), without lifetime, since an invitation outlives it.
async function currentDelegation(delegateKeys,config){
 let s;try{s=await (typeof delegateKeys?.current==='function'?delegateKeys.current():undefined);}catch{s=undefined;}
 let c;try{c=P.parseDelegation(s?.delegation).claims;}catch{fault('signing_unavailable','Messaging signing is unavailable. Reconnect Parlay.',503);}
 if(s.kid!==`jkt:${c.jkt}`||c.iss!==config.principal.issuer||c.sub!==config.principal.subject||!c.purposes.includes(P.PURPOSES.author)||c.client.ingress!==config.ingress)fault('signing_unavailable','Messaging signing is unavailable. Reconnect Parlay.',503);
 if(s.delegation.length>2048)fault('signing_unavailable','Messaging signing is unavailable. Reconnect Parlay.',503);
 return s.delegation;
}
/** Creates one invitation from a template inside a fresh token (shared by the owner operation and the provider's
 * developer-contact mint hook). Returns {invite, data}; the token appears only in `data`, once. */
export async function createInvitation({store,delegateKeys,random,clock},{template='person',name,bound,expiresIn,rule:ruleInput}){
 if(template!=='person')invalid('Choose a template.');
 const now=clock.now(),config=await readConfig(store),delegation=await currentDelegation(delegateKeys,config);
 const ms=expiresIn===undefined?INVITE_POLICY.personDefaultMs:expiresIn;
 if(!Number.isSafeInteger(ms)||ms<(bound?INVITE_POLICY.boundMinMs:HOUR)||ms>INVITE_POLICY.personMaxMs)invalid('Choose an expiry between one hour and 30 days.');
 const target=bound===undefined||bound===null?null:principalInput(bound);if(target&&same(target,config.principal))invalid('That is you.');
 const label=name===undefined||name===null?(target?null:'Invitation'):nameInput(name);
 const secret=token(32),digest=await tokenDigest(secret),id=random.uuid(),expiresAt=now+ms;
 const link={id,name:label,template,maxUses:1,used:0,bound:target,expiresAt,state:'live',createdAt:now,tokenDigest:digest,ledger:[],redeemers:[]};
 const rule={id:random.uuid(),when:{link:id},place:[ruleInput?.list??CONTACTS_LIST],...ruleInput?.tags?{tags:ruleInput.tags}:{},createdBy:'template',createdAt:now};
 await store.transaction(async tx=>{
  await ensureBuiltins(tx,now);if(!await tx.get(INV.list(rule.place[0])))fault('not_found','That list does not exist.',404);
  if([...(await tx.list({prefix:INV.links})).values()].filter(l=>l.state==='live'&&l.expiresAt>now).length>=INVITE_POLICY.maxLinks)fault('limit_reached','Too many open invitations.',409);
  if((await tx.list({prefix:INV.rules})).size>=INVITE_POLICY.maxRules)fault('limit_reached','Too many rules.',409);
  await tx.put(INV.link(id),link);await tx.put(INV.token(digest),id);await tx.put(INV.rule(rule.id),rule);await publishInvite(tx,link,now);
 });
 return {invite:linkView(link),data:{inviter:{iss:config.principal.issuer,sub:config.principal.subject},token:secret,delegation,expires_at:Math.floor(expiresAt/1000)}};
}
// Developer contact (rethink §4.7, CR-C5; provisional): a single-use invitation bound to one principal with a short
// expiry, whose rule places the redeemer in the built-in-on-demand "Users" list (`message`) and tags it
// `priority:<tier>` (an owner-private label). System actor only: the trusted composition that carries the provider's
// mint request over the developer identity's own app grant calls it; no owner or ingress route reaches it.
export const USERS_LIST='users';
export const DEVELOPER_TIERS=Object.freeze(['free','paid','plus','ultra']);
export class InvitesMintBound extends MailboxAction {
 static operation='invites.mint-bound';static deps=['contacts','delegateKeys','random','clock'];static changes='contacts-changed';
 async run({contacts,delegateKeys,random,clock}){
  actorOwner(this.actor,['system']);const {principal,tier,expiresIn=HOUR}=this.input??{};
  if(!DEVELOPER_TIERS.includes(tier))invalid('Choose a tier.');if(!Number.isSafeInteger(expiresIn)||expiresIn<INVITE_POLICY.boundMinMs||expiresIn>HOUR)invalid('Choose an expiry of at most one hour.');
  await contacts.store.transaction(async tx=>{await ensureBuiltins(tx,clock.now());if(!await tx.get(INV.list(USERS_LIST)))await tx.put(INV.list(USERS_LIST),{id:USERS_LIST,name:'Users',policy:'message',builtin:false,createdAt:clock.now()});});
  return createInvitation({store:contacts.store,delegateKeys,random,clock},{template:'person',name:'Developer contact',bound:principalInput(principal),expiresIn,rule:{list:USERS_LIST,tags:[`priority:${tier}`]}});
 }
}
export class InvitesCreate extends MailboxAction {
 static operation='invites.create';static deps=['contacts','delegateKeys','random','clock'];static changes='contacts-changed';
 async run({contacts,delegateKeys,random,clock}){actorOwner(this.actor);const i=this.input??{};return createInvitation({store:contacts.store,delegateKeys,random,clock},{template:i.template??'person',name:i.name,bound:i.bound,expiresIn:i.expiresIn});}
}
// Revoke always stops new joins; it also removes the link's rules (default) and optionally everyone it admitted, from
// the lists its rules placed them in (§4.4). A revoked token is dead at the edge at once.
export class InvitesRevoke extends MailboxAction {
 static operation='invites.revoke';static deps=['contacts','clock'];static changes='contacts-changed';
 async run({contacts,clock}){
  actorOwner(this.actor);const id=this.input?.id,removeRules=this.input?.removeRules!==false,removeAdmitted=this.input?.removeAdmitted===true;if(!isUUID(id))invalid('Choose an invitation.');
  return contacts.store.transaction(async tx=>{
   const now=clock.now(),l=await tx.get(INV.link(id));if(!l)fault('not_found','That invitation does not exist.',404);
   if(l.state==='live'){l.state='revoked';l.revokedAt=now;await tx.put(INV.link(id),l);}await publishInvite(tx,l,now);
   let rules=0,removed=0;const lists=new Set();
   for(const [key,r] of await tx.list({prefix:INV.rules}))if(r.when?.link===id){for(const x of r.place)lists.add(x);if(removeRules){await tx.delete(key);rules++;}}
   if(removeAdmitted)for(const e of l.ledger)if(e.outcome==='admitted')for(const list of lists){const m=await tx.get(INV.member(list,e.principal));if(m?.via?.invite===id&&await removeMember(tx,list,e.principal))removed++;}
   return {invite:linkView(l),rulesRemoved:rules,membersRemoved:removed};
  });
 }
}
export class InvitesList extends MailboxQuery {
 static operation='invites.list';static deps=['contacts','clock'];static refreshOn=['contacts-changed','incoming-changed'];
 async fetch({contacts,clock}){actorOwner(this.actor);const now=clock.now();return {invites:[...(await contacts.store.list({prefix:INV.links})).values()].map(l=>({...linkView(l),state:l.state==='live'&&l.expiresAt<=now?'expired':l.state==='live'&&l.used>=l.maxUses?'used':l.state})).sort((a,b)=>b.createdAt-a.createdAt)};}
}

// ---------------------------------------------------------------- admission (application behaviour, §4.4)
async function admission(tx,linkId,principal){
 if(await tx.get(KEYS.block(who(principal))))return {decision:'refuse',place:[],tags:[]};
 const place=new Set(),tags=new Set();
 for(const [,r] of await tx.list({prefix:INV.rules}))if(r.when?.link===linkId){for(const l of r.place)place.add(l);for(const t of r.tags??[])tags.add(t);}
 let best=null;for(const list of place){const l=await tx.get(INV.list(list))??BUILTINS.find(b=>b.id===list);if(l&&(best===null||RANK[l.policy]>RANK[best]))best=l.policy;}
 // Placement in a `message` or `receive-only` list accepts (a receive-only member's conversation lets the owner
 // deliver); `request` alone holds; no placement rule holds for review (the safe default).
 return {decision:best==='message'||best==='receive-only'?'accept':'hold',place:[...place],tags:[...tags]};
}

// ---------------------------------------------------------------- shared receive helpers
async function receiptSigner(delegateKeys,config,now){
 let s;try{s=await (typeof delegateKeys?.current==='function'?delegateKeys.current():undefined);}catch{s=undefined;}
 if(!s||typeof s!=='object')protocol('recipient_unavailable',{retryAfter:60});
 let c;try{c=P.parseDelegation(s.delegation).claims;}catch{protocol('recipient_unavailable',{retryAfter:60});}
 if(s.kid!==`jkt:${c.jkt}`||c.iss!==config.principal.issuer||c.sub!==config.principal.subject||!c.purposes.includes(P.PURPOSES.receipt)||c.client.ingress!==config.ingress||now<c.iat*1000-P.LIMITS.clockSkewMs||now>c.exp*1000+P.LIMITS.clockSkewMs||now<c.since*1000)protocol('recipient_unavailable',{retryAfter:60});
 return Object.freeze({kid:s.kid,privateKey:s.privateKey,delegation:s.delegation});
}
// Pre-crypto limiters (§7.4, §4.5), in memory and bounded per mailbox store: per invitation (30 per hour, charged on
// every attempt that reaches the mailbox) and, as in receive.mjs, refusals after verification per verified principal.
const limiters=new WeakMap();
const limiterFor=store=>{let l=limiters.get(store);if(!l){l=boundedCache(4096);limiters.set(store,l);}return l;};
function chargeWindow(store,key,max,windowMs,now){const l=limiterFor(store),row=l.get(key,now)??{count:0,until:now+windowMs};if(row.count>=max){const e=new MailboxFault('rate_limited','Too many messages. Try again later.',429);e.retryAfter=Math.max(1,Math.ceil((row.until-now)/1000));throw e;}l.set(key,{count:row.count+1,until:row.until},row.until);}
export const FIRST_CONTACT_REFUSALS=Object.freeze({windowMs:HOUR,principal:20});
const refusalKey=p=>`refused|${pk(p)}`;
function checkRefusals(store,principal,now){const row=limiterFor(store).get(refusalKey(principal),now);if(row&&row.count>=FIRST_CONTACT_REFUSALS.principal){const e=new MailboxFault('rate_limited','Too many messages. Try again later.',429);e.retryAfter=Math.max(1,Math.ceil((row.until-now)/1000));throw e;}}
function countRefusal(store,principal,now){const l=limiterFor(store),row=l.get(refusalKey(principal),now)??{count:0,until:now+FIRST_CONTACT_REFUSALS.windowMs};l.set(refusalKey(principal),{count:row.count+1,until:row.until},row.until);}
function recipientHere(p,config){if(p.recipient.issuer!==config.principal.issuer||p.recipient.owner!==config.principal.subject)protocol('recipient_unavailable',{retryAfter:60});}
async function verifyAuthor({envelope,directory,store,now}){
 const learned=[],ports=verificationPorts({directory,store,now,learned});
 try{return await P.verifyEnvelope(envelope,{resolveKey:ports.resolveKey,status:ports.status,now});}
 catch(error){if(learned.length)await store.transaction(async tx=>{for(const r of learned)await recordRevocation(tx,{...r,now});}).catch(()=>{});throw error;}
}
function itemOf({id,envelope,author,delivery,now,state,request=false,extra={}}){
 const p=envelope.payload;
 return {id,origin:'native',kind:p.kind,author:{principal:author.principal,keyId:author.keyId,jkt:author.jkt,client:{client_id:author.client.client_id,origin:author.client.origin}},
  operationId:p.operationId,subject:p.subject,content:p.content,bodyRef:delivery.body?{storage:'mailbox'}:null,createdAt:p.createdAt,receivedAt:now,state,request,hot:0,tags:[],tagHistory:[],
  payloadDigest:delivery.payloadDigest,quarantined:false,reviewed:false,notification:state==='inbox'?'push':null,envelope,...extra};
}
async function storeItem(tx,item,delivery,author,now,{hot=0}={}){
 await tx.put(KEYS.item(item.id),{...item,hot});await projectIncoming(tx,item);
 if(delivery.body)await tx.put(KEYS.body(item.id),delivery.body);
 if(item.state==='pending')await tx.put(KEYS.pending(now,item.id),{id:item.id});
 await tx.put(jktIndex(author.jkt,item.id),1);
 const seen=await tx.get(seenKey(author.jkt));await tx.put(seenKey(author.jkt),{jkt:author.jkt,principal:author.principal,lastSeen:now,checkedAt:seen?.checkedAt??(author.statusChecked?now:0)});
}
async function chargeHot(tx,delivery,envelope){
 if(!delivery.body)return 0;const charge=delivery.body.byteLength+te.encode(P.jcs(envelope)).byteLength,u=await tx.get(KEYS.usage)??{hotBytes:0,hotItems:0};
 if(u.hotBytes+charge>BOUNDS.hotBytes||u.hotItems+1>BOUNDS.hotItems)protocol('recipient_storage_unavailable',{retryAfter:60});await chargeUsage(tx,{bytes:charge});return charge;
}

// ---------------------------------------------------------------- inviter: redemption intake (§4.4 steps 3–7)
export class ReceiveRedeem extends MailboxAction {
 static operation='receive.redeem';static deps=['receive','directory','delegateKeys','clock'];static changes='incoming-changed';
 async run({receive,directory,delegateKeys,clock}){
  actorOwner(this.actor,['ingress']);
  const {contentType,body,authorization,idempotencyKey,ingress}=this.input??{},store=receive.store,now=clock.now(),config=await readConfig(store);
  await requireRestored(store);if(ingress!==config.ingress)protocol('ingress_moved');
  const credential=P.parseCredential(authorization),delivery=await P.parseDelivery(contentType,body,{idempotencyKey}),envelope=delivery.envelope,p=envelope.payload;
  // §4.4 step 2: shape (validateEnvelope enforced the §4.3 shape; the credential must pair with `invite`).
  if(P.checkCredentialKind(envelope,credential)!=='BindleInvite')protocol('malformed');
  recipientHere(p,config);
  // Step 1 at the mailbox: owner budget pre-check and the per-invitation window, before any crypto.
  ownerExhausted(await store.get(KEYS.budget),{now,plan:config.plan});chargeWindow(store,`invite|${p.recipient.invite}`,INVITE_POLICY.perInvitationPerHour,HOUR,now);
  // Step 3: one read-only lookup with one timing class for every token failure (digest work happens on all paths).
  const claimed=who(p.author.principal),digest=await tokenDigest(credential.token),matches=equalDigest(digest,p.recipient.invite);
  const linkId=await store.get(INV.token(p.recipient.invite)),link=linkId?await store.get(INV.link(linkId)):null,prior=await store.get(INV.redeemed(p.recipient.invite,claimed));
  const live=Boolean(link)&&link.state==='live'&&link.expiresAt>now&&(link.used<link.maxUses||Boolean(prior))&&(!link.bound||same(link.bound,claimed));
  if(!matches||!live)protocol('invite_invalid');
  // The acceptance window follows the token checks, so the edge pre-filter and the mailbox agree on precedence.
  P.checkWindow(envelope,now);checkRefusals(store,claimed,now);
  // Step 4: same-host authors only (CL-24), then author verification with the status check.
  if(claimed.issuer!==config.principal.issuer)protocol('author_unverifiable');
  let verified;try{verified=await verifyAuthor({envelope,directory,store,now});}catch(error){if(error?.code==='author_unverifiable'&&error.status!==503)countRefusal(store,claimed,now);throw error;}
  const author=verified.author,principal=who(author.principal);
  const signer=await receiptSigner(delegateKeys,config,now);
  const receipt=await P.signReceipt(await P.receiptPayload(envelope,{recipient:config.principal,ingress:config.ingress,receivedAt:now,bodyDigest:null}),signer);
  const id=await P.sha256(globalThis.crypto,P.replayKey(envelope));
  return store.transaction(async tx=>{
   await requireRestored(tx,{envelope});
   // Step 5: a recorded redemption by this verified author answers the request whatever the token's current state.
   const recorded=await tx.get(INV.redeemed(p.recipient.invite,principal));
   if(recorded){if(recorded.payloadDigest===delivery.payloadDigest)return {receipt:recorded.receipt,replay:true};protocol('invite_invalid');}
   // Step 6: re-check liveness, record the redemption and count the use in this one transaction.
   const l=await tx.get(INV.link(linkId));
   if(!l||l.state!=='live'||l.expiresAt<=now||l.used>=l.maxUses||(l.bound&&!same(l.bound,principal)))protocol('invite_invalid');
   if(await tx.get(KEYS.revoked(author.jkt)))protocol('author_unverifiable',{revoked:true});
   if(await tx.get(KEYS.item(id)))protocol('operation_conflict');
   await tx.put(KEYS.budget,chargeBudget(await tx.get(KEYS.budget),{now,plan:config.plan,bytes:0,parent:`invite:${l.id}`,sender:pk(principal)}));
   // Step 7: the owner's admission decision (application behaviour).
   const decided=await admission(tx,l.id,principal),c=p.conversation,listed=c.genesis.payload.participants.find(x=>same(x.principal,principal));
   const binding={keyId:listed.keyId,ingress:c.creatorBinding.ingress,identityURI:author.principal.identityURI};
   let admitted=false;
   if(decided.decision==='accept')for(const list of decided.place)if(await addMember(tx,list,principal,{via:{kind:'invite',invite:l.id},now,binding}))admitted=true;
   const state=decided.decision==='refuse'?'refused':decided.decision==='accept'?'inbox':'pending';
   const item=itemOf({id,envelope,author,delivery,now,state,request:state==='pending',extra:{redemption:{invite:l.id,name:l.name,bound:Boolean(l.bound)},...decided.tags.length?{tags:decided.tags.map(t=>({id:t,source:'rule'}))}:{}}});
   if(state==='refused'){await tx.put(KEYS.item(id),{...item,notification:null});}else await storeItem(tx,item,delivery,author,now);
   if(decided.decision==='accept')await tx.put(INV.accept(id),{itemId:id,at:now});
   l.used++;l.ledger=[...l.ledger,{principal,at:now,outcome:decided.decision==='accept'?'admitted':decided.decision==='hold'?'held':'refused',itemId:id}].slice(-INVITE_POLICY.maxLedger);
   if(l.used>=l.maxUses)l.redeemers=[...new Set([...(l.redeemers??[]),await principalDigest(principal)])];
   await tx.put(INV.link(l.id),l);await publishInvite(tx,l,now);
   await tx.put(INV.redeemed(p.recipient.invite,principal),{payloadDigest:delivery.payloadDigest,receipt,itemId:id,at:now,retainUntil:Math.max(l.expiresAt,now)+P.LIMITS.retentionMs});
   await tx.put(KEYS.replay(id),{payloadDigest:delivery.payloadDigest,itemId:id,receipt,retainUntil:P.retainUntil(envelope,now)});
   return {receipt,replay:false,admitted};
  });
 }
}

// ---------------------------------------------------------------- credential-less first contact (§6.7)
export class ReceiveFirstContact extends MailboxAction {
 static operation='receive.first-contact';static deps=['receive','directory','delegateKeys','clock'];static changes='incoming-changed';
 async run({receive,directory,delegateKeys,clock}){
  actorOwner(this.actor,['ingress']);
  const {contentType,body,authorization,idempotencyKey,ingress}=this.input??{},store=receive.store,now=clock.now(),config=await readConfig(store);
  await requireRestored(store);if(ingress!==config.ingress)protocol('ingress_moved');
  const credential=P.parseCredential(authorization),delivery=await P.parseDelivery(contentType,body,{idempotencyKey}),envelope=delivery.envelope,p=envelope.payload;
  if(p.kind==='conversation-record'||P.checkCredentialKind(envelope,credential)!==null)protocol('malformed');
  recipientHere(p,config);P.checkWindow(envelope,now);
  const id=await P.sha256(globalThis.crypto,P.replayKey(envelope)),prior=await store.get(KEYS.replay(id));
  await requireRestored(store,{envelope,replay:Boolean(prior)});
  // No refusal before verification depends on owner policy (§6.7): only budgets and the verified-refusal limiter.
  if(!prior){ownerExhausted(await store.get(KEYS.budget),{now,plan:config.plan});checkRefusals(store,who(p.author.principal),now);}
  const verified=await verifyAuthor({envelope,directory,store,now}),author=verified.author,principal=who(author.principal);
  if(!P.statusRequired(envelope)&&await knownRevoked({directory,store,now},author.jkt))protocol('author_unverifiable',{revoked:true});
  // Step 5: owner policy on the verified principal. Policy refusal and block share one code and timing class.
  const policy=await firstContactPolicy(store,principal);
  if(!['message','request'].includes(policy)){countRefusal(store,principal,now);protocol('not_authorized');}
  const signer=await receiptSigner(delegateKeys,config,now);
  const receipt=await P.signReceipt(await P.receiptPayload(envelope,{recipient:config.principal,ingress:config.ingress,receivedAt:now,bodyDigest:delivery.bodyDigest}),signer);
  return store.transaction(async tx=>{
   await requireRestored(tx,{envelope,replay:Boolean(await tx.get(KEYS.replay(id)))});
   const recorded=await tx.get(KEYS.replay(id)),outcome=P.replayDecision(recorded,{payloadDigest:delivery.payloadDigest});
   // Live owner policy is rechecked inside the commit, for replays too.
   const live=await firstContactPolicy(tx,principal);if(!['message','request'].includes(live))protocol('not_authorized');
   if(await tx.get(KEYS.revoked(author.jkt)))protocol('author_unverifiable',{revoked:true});
   if(outcome==='replay')return {receipt:recorded.receipt,replay:true};
   const bytes=delivery.body?.byteLength??0;
   await tx.put(KEYS.budget,chargeBudget(await tx.get(KEYS.budget),{now,plan:config.plan,bytes,parent:'first-contact',sender:pk(principal)}));
   const hot=await chargeHot(tx,delivery,envelope),request=live==='request';
   await storeItem(tx,itemOf({id,envelope,author,delivery,now,state:request?'pending':'inbox',request,extra:{firstContact:{policy:live}}}),delivery,author,now,{hot});
   await tx.put(KEYS.replay(id),{payloadDigest:delivery.payloadDigest,itemId:id,receipt,retainUntil:P.retainUntil(envelope,now)});
   return {receipt,replay:false};
  });
 }
}

// ---------------------------------------------------------------- redeemer side (§4.2 handler duties)
const B64=/^[A-Za-z0-9_-]+$/;
/** Step 1: the `connect` data shape and `expires_at`, locally, with no fetch. */
export function connectData(input,now){
 const d=input;
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['inviter','token','delegation','expires_at','hint'].includes(k)))invalid('This invitation is not valid.');
 const i=d.inviter;if(!i||typeof i!=='object'||Object.keys(i).length!==2||!Object.hasOwn(i,'iss')||!Object.hasOwn(i,'sub'))invalid('This invitation is not valid.');
 try{const u=new URL(i.iss);if(u.origin!==i.iss||u.protocol!=='https:'||!isUUID(i.sub))throw 0;}catch{invalid('This invitation is not valid.');}
 if(typeof d.token!=='string'||!/^[A-Za-z0-9_-]{22,43}$/.test(d.token)||typeof d.delegation!=='string'||d.delegation.length>2048||d.delegation.split('.').length!==3||!d.delegation.split('.').every(s=>B64.test(s)))invalid('This invitation is not valid.');
 if(Object.hasOwn(d,'expires_at')&&(!Number.isSafeInteger(d.expires_at)||d.expires_at<0))invalid('This invitation is not valid.');
 if(Object.hasOwn(d,'hint')&&d.hint!=='no-reply')invalid('This invitation is not valid.');
 if(Object.hasOwn(d,'expires_at')&&d.expires_at*1000<=now)fault('invite_expired','This invitation has expired. Ask for a new one.',410);
 return {inviter:{issuer:i.iss,subject:i.sub},token:d.token,delegation:d.delegation,expiresAt:Object.hasOwn(d,'expires_at')?d.expires_at*1000:null,hint:d.hint??null};
}
/** Steps 2–3 (CL-19): the inviter's certificate against the directory key, its status, and its certified ingress. */
export async function verifyInviter({directory,store,now,config},data){
 const unverifiable=()=>fault('invite_unverifiable','This invitation could not be verified. Ask for a new one.',403);
 // Same-host only in this version (CL-24): a foreign inviter fails without any fetch.
 if(data.inviter.issuer!==config.principal.issuer)unverifiable();
 if(same(data.inviter,config.principal))invalid('This is your own invitation.');
 let jws;try{jws=P.parseDelegation(data.delegation);}catch{unverifiable();}
 const c=jws.claims;if(c.iss!==data.inviter.issuer||c.sub!==data.inviter.subject||!c.purposes.includes(P.PURPOSES.author)||typeof c.client.ingress!=='string')unverifiable();
 try{const u=new URL(c.client.ingress);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw 0;}catch{unverifiable();}
 const ports=verificationPorts({directory,store,now});let key;
 try{key=await ports.resolveKey({issuer:c.iss,subject:c.sub,keyId:jws.header.kid});}catch{fault('recipient_unavailable','The inviter could not be checked right now. Try again.',503);}
 if(!key||key.keyId!==jws.header.kid||typeof key.identityURI!=='string')unverifiable();
 // Certificate expiry is not checked (invitations outlive 24-hour certificates): verify at the certificate's own iat.
 try{await verifyDelegation(data.delegation,{identityKey:key,principal:{issuer:c.iss,subject:c.sub},keyId:jws.header.kid,jkt:c.jkt,purpose:P.PURPOSES.author,now:c.iat*1000});}catch{unverifiable();}
 let status;try{status=await ports.status?.({issuer:c.iss,subject:c.sub,identityURI:key.identityURI,jkt:c.jkt});}catch{status=undefined;}
 if(status?.status==='revoked')unverifiable();if(status?.status!=='active')fault('recipient_unavailable','The inviter could not be checked right now. Try again.',503);
 return {principal:{issuer:c.iss,subject:c.sub,identityURI:key.identityURI},keyId:jws.header.kid,ingress:c.client.ingress,handle:typeof key.handle==='string'?key.handle:null,jkt:c.jkt};
}
export class InvitesInspect extends MailboxAction {
 static operation='invites.inspect';static deps=['contacts','directory','clock'];
 async run({contacts,directory,clock}){
  actorOwner(this.actor);const store=contacts.store,now=clock.now(),config=await readConfig(store),data=connectData(this.input?.data,now);
  const inviter=await verifyInviter({directory,store,now,config},data),digest=await tokenDigest(data.token),pending=await store.get(INV.pending(digest));
  return {inviter:who(inviter.principal),handle:inviter.handle,host:new URL(inviter.principal.issuer).host,expiresAt:data.expiresAt,hint:data.hint,alreadyContact:(await firstContactPolicy(store,inviter.principal))==='message',pending:pending?{state:pending.state}:null};
 }
}
export class InvitesRedeem extends MailboxAction {
 static operation='invites.redeem';static deps=['contacts','conversations','outbox','directory','delegateKeys','clock'];static changes='contacts-changed';
 async run({contacts,outbox,directory,delegateKeys,clock}){
  actorOwner(this.actor);const store=contacts.store,now=clock.now(),config=await readConfig(store),data=connectData(this.input?.data,now),digest=await tokenDigest(data.token);
  // At most one pending redemption per token digest per account; a repeat resumes it with identical bytes.
  const existing=await store.get(INV.pending(digest));
  if(existing&&existing.state!=='rolled-back'){if(existing.state==='pending'&&!existing.submitted)await resume({store,outbox,delegateKeys,clock},existing,data);return {state:existing.state,conversationId:existing.conversationId};}
  if(existing)fault('invite_used','This invitation was already used or is no longer valid; ask for a new one.',410);
  const inviter=await verifyInviter({directory,store,now,config},data);
  if((await store.list({prefix:INV.pendings})).size>=INVITE_POLICY.pendingRedemptions)fault('limit_reached','Too many invitations in progress.',409);
  const operationId=globalThis.crypto.randomUUID();
  // Step 4 happened in the handler (the viewer confirmed); admit the inviter to message the viewer, remembering
  // whether this flow created the admission so rollback never removes an existing contact.
  const created=await store.transaction(async tx=>{
   if(await tx.get(INV.pending(digest)))fault('conflict','This invitation is already in progress.',409);
   const selfCreated=await addMember(tx,CONTACTS_LIST,inviter.principal,{via:{kind:'redeemed',tokenDigest:digest},now,selfCreated:true});
   const row={tokenDigest:digest,inviter:who(inviter.principal),inviterKeyId:inviter.keyId,ingress:inviter.ingress,identityURI:inviter.principal.identityURI,operationId,selfCreated,state:'pending',submitted:false,createdAt:now,expiresAt:data.expiresAt};
   await tx.put(INV.pending(digest),row);return row;
  });
  return resume({store,outbox,delegateKeys,clock},created,data);
 }
}
// Step 5: build and submit the redemption once; the outbox retries with identical bytes.
async function resume({store,outbox,delegateKeys,clock},row,data){
 const {conversationId,returnExpiresAt}=await createConversation({store,outbox,delegateKeys,clock},{subject:'',text:null,operationId:row.operationId,
  invitees:[{principal:{issuer:row.inviter.issuer,subject:row.inviter.subject,identityURI:row.identityURI},keyId:row.inviterKeyId,ingress:row.ingress,recipient:{issuer:row.inviter.issuer,owner:row.inviter.subject,invite:row.tokenDigest},credential:`BindleInvite ${data.token}`}]});
 await store.transaction(async tx=>{const cur=await tx.get(INV.pending(row.tokenDigest));if(cur&&cur.state==='pending')await tx.put(INV.pending(row.tokenDigest),{...cur,submitted:true,conversationId,returnExpiresAt:returnExpiresAt??cur.returnExpiresAt});});
 return {state:'pending',conversationId};
}
// Step 6, rollback: only a self-created admission, only with no conversation with the inviter, and only after a
// terminal error or an expired return control. Settled rows are kept (state) so a reused token reads as used.
export class InvitesSweep extends MailboxAction {
 static operation='invites.sweep';static deps=['contacts','clock'];static changes='contacts-changed';
 async run({contacts,clock}){
  actorOwner(this.actor,['owner','system']);const store=contacts.store,now=clock.now();let rolledBack=0,settled=0;
  for(const [key,row] of await store.list({prefix:INV.pendings})){
   if(row.state!=='pending')continue;
   const message=row.submitted?await store.get(`bb:send:message/${row.operationId}`):null,tasks=message?await Promise.all(message.tasks.map(k=>store.get(k))):[];
   const terminal=tasks.some(t=>t?.state==='rejected'),expired=Number.isSafeInteger(row.returnExpiresAt)&&row.returnExpiresAt<=now;
   if(!terminal&&!expired)continue;
   await store.transaction(async tx=>{
    const cur=await tx.get(key);if(!cur||cur.state!=='pending')return;
    const room=cur.conversationId?await tx.get(`conv/room/${cur.conversationId}`):null,peer=room?await tx.get(`conv/peer/${room.id}/${pk(cur.inviter)}`):null;
    if(peer?.state==='accepted'){await tx.put(key,{...cur,state:'accepted',settledAt:now});settled++;return;}
    let conversation=false;for(const [,r] of await tx.list({prefix:'conv/room/'})){if(r.id===cur.conversationId||r.state!=='active')continue;const pr=await tx.get(`conv/peer/${r.id}/${pk(cur.inviter)}`);if(pr?.state==='accepted'){conversation=true;break;}}
    if(cur.selfCreated&&!conversation){const m=await tx.get(INV.member(CONTACTS_LIST,cur.inviter));if(m?.via?.tokenDigest===cur.tokenDigest)await removeMember(tx,CONTACTS_LIST,cur.inviter);}
    await tx.put(key,{...cur,state:'rolled-back',reason:terminal?'refused':'expired',settledAt:now});rolledBack++;
   });
  }
  // Inviter side: a link record that is revoked, expired or used is kept for the receipt-retention time (spec §8.2: the
  // redemption replay namespace lasts while the issuer keeps the record), then pruned with its token, rule and replay
  // rows, a bounded batch per run. A pruned token reads as unknown: invite_invalid.
  let pruned=0;
  for(const [key,l] of await store.list({prefix:INV.links})){
   if(pruned>=16)break;const deadAt=l.state==='revoked'?l.revokedAt:l.used>=l.maxUses?(l.ledger.at(-1)?.at??l.createdAt):l.expiresAt;
   if(!(l.state!=='live'||l.used>=l.maxUses||l.expiresAt<=now)||deadAt+P.LIMITS.retentionMs>now)continue;
   await store.transaction(async tx=>{const cur=await tx.get(key);if(!cur||cur.tokenDigest!==l.tokenDigest)return;await tx.delete(key);await tx.delete(INV.token(l.tokenDigest));
    for(const [k] of await tx.list({prefix:`inv/redeemed/${l.tokenDigest}/`}))await tx.delete(k);for(const [k,r] of await tx.list({prefix:INV.rules}))if(r.when?.link===l.id)await tx.delete(k);
    await queueEdge(tx,{kind:'invite',digest:l.tokenDigest,state:'dead',redeemers:[],expiresAt:l.expiresAt});});
   pruned++;
  }
  return {rolledBack,settled,...pruned?{pruned}:{}};
 }
}
export const INVITE_OPERATIONS=[ListsList,ListsMembers,ListsCreate,ListsSetPolicy,ListsAdd,ListsRemove,InvitesMintBound,InvitesCreate,InvitesRevoke,InvitesList,ReceiveRedeem,ReceiveFirstContact,InvitesInspect,InvitesRedeem,InvitesSweep];

// ---------------------------------------------------------------- edge (instance-wide, before any mailbox wakes)
// First-contact budgets (§7.4): per source and per claimed `recipient.owner`, whether or not the owner is hosted, so a
// 429 reveals nothing about hosting. In memory and bounded; a deployment with many edge isolates approximates them.
export const FIRST_CONTACT_BUDGET=Object.freeze({windowMs:60000,perSource:60,perOwner:120,keys:8192});
export function createFirstContactBudget({limits=FIRST_CONTACT_BUDGET,now=()=>Date.now()}={}){
 const cache=boundedCache(limits.keys);
 const hit=(key,max)=>{const t=now(),row=cache.get(key,t)??{count:0,until:t+limits.windowMs};if(row.count>=max)protocol('rate_limited',{retryAfter:Math.max(1,Math.ceil((row.until-t)/1000))});cache.set(key,{count:row.count+1,until:row.until},row.until);};
 return Object.freeze({charge({source,owner}){hit(`s|${String(source??'unknown').slice(0,128)}`,limits.perSource);hit(`o|${String(owner).slice(0,64)}`,limits.perOwner);}});
}
