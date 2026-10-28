import {readBody} from '../store/bodies.mjs';
// Receive-side mailbox operations: configuration (principal, ingress, plan, and the edge's hosted-recipient entry),
// owner listings of admitted items, replay retention and body reads, plus the uniform ingress error mapping. Admission
// itself is first contact (invites.mjs: receive.redeem for invitation redemptions, receive.first-contact for the list
// gate, messaging §4.4 and §6.7) and conversation records (conversations.mjs). The contact-link admission path
// (receive.deliver, BindleLink, conditional-link audience decisions and link quotas) was removed in contacts spike
// phase 4. Classification of public requests runs later (intake.drain), so no response depends on it (§6.7).
import * as P from '../../messaging-protocol/index.mjs';
import {MailboxAction,MailboxQuery} from '../engine.mjs';
import {fault} from '../faults.mjs';
import {KEYS,actorOwner,queueEdge} from '../store/mailbox.mjs';

export class ReceiveConfigure extends MailboxAction {
 static operation='receive.configure';static deps=['receive'];
 async run({receive}){
  actorOwner(this.actor);const {principal,ingress,plan='free'}=this.input??{};
  try{P.validatePrincipal(principal);const u=new URL(ingress);if(u.protocol!=='https:'||u.search||u.hash||u.href!==ingress)throw new Error();}catch{fault('invalid_input','Choose a valid principal and ingress.',400);}
  if(!['free','paid','plus','ultra'].includes(plan))fault('invalid_input','Choose a valid plan.',400);
  const config={principal:{issuer:principal.issuer,subject:principal.subject,identityURI:principal.identityURI},ingress,plan};
  // Contacts spike phase 3: the edge's hosted-recipient entry (messaging §6.7 step 2), active while a connection is.
  await receive.store.transaction(async tx=>{await tx.put(KEYS.config,config);await queueEdge(tx,{kind:'host',issuer:principal.issuer,subject:principal.subject,active:(await tx.get('shell:authorization'))?.active!==false});});return config;
 }
}

// Owner listing of admitted items. Pending, rejected and quarantined items never appear here (see intake queries).
const itemView=i=>({id:i.id,origin:i.origin,kind:i.kind,author:i.origin==='native'?{principal:i.author.principal,verified:i.imported?.verified!==false}:{asserted:i.asserted,verified:false},subject:i.subject,content:i.content,receivedAt:i.receivedAt,state:i.state,request:i.request,priority:i.priority??'normal',tags:i.tags,tagHistory:i.tagHistory,quarantined:Boolean(i.quarantined)});
export class ReceiveItems extends MailboxQuery {
 static operation='receive.items';static deps=['receive'];static refreshOn=['incoming-changed'];
 async fetch({receive}){actorOwner(this.actor);const items=[...(await receive.store.list({prefix:'item/'})).values()];return {items:items.filter(i=>!i.quarantined&&(i.state==='inbox'||i.state==='request')).sort((a,b)=>(a.priority==='low')-(b.priority==='low')||b.receivedAt-a.receivedAt).map(itemView),quarantined:items.filter(i=>i.quarantined).map(itemView)};}
}
// Retention sweep (spec §8.2): replay entries and receipts past retainUntil are dropped; items stay.
export class ReceiveSweep extends MailboxAction {
 static operation='receive.sweep';static deps=['receive','clock'];
 async run({receive,clock}){
  actorOwner(this.actor,['system','owner']);const now=clock.now();
  return receive.store.transaction(async tx=>{let dropped=0;for(const [key,entry] of await tx.list({prefix:'replay/'}))if(entry.retainUntil<now){await tx.delete(key);dropped++;}return {dropped};});
 }
}
export class ReceiveBody extends MailboxQuery {
 static operation='receive.body';static deps=['receive','userStorage'];
 async fetch({receive,userStorage}){
  actorOwner(this.actor);const id=this.input?.id;if(typeof id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(id))fault('invalid_input','Choose an item.',400);
  const item=await receive.store.get(KEYS.item(id));if(!item||item.quarantined)fault('not_found','Item unavailable.',404);
  const body=item.bodyRef?.storage==='user'?await readBody(userStorage,item.bodyRef):await receive.store.get(KEYS.body(id));
  if(!body){const parts=(item.message?.parts??[]).filter(p=>p.mimeType==='text/plain').map(p=>P.fromBase64url(p.dataBase64url)),bytes=new Uint8Array(Math.min(65536,parts.reduce((n,p)=>n+p.length,0)));let at=0;for(const p of parts){const part=p.subarray(0,bytes.length-at);bytes.set(part,at);at+=part.length;}return {id,text:parts.length?new TextDecoder().decode(bytes):null,truncated:parts.reduce((n,p)=>n+p.length,0)>65536};}
  const bytes=Uint8Array.from(body);if(item.content&&P.jcs(await P.contentDescriptor(item.content.mimeType,bytes))!==P.jcs(item.content))fault('body_unavailable','Body digest mismatch.',503);
  return {id,text:item.content?.mimeType?.startsWith('text/')?new TextDecoder().decode(bytes.subarray(0,65536)):null,truncated:bytes.length>65536};
 }
}
export const RECEIVE_OPERATIONS=[ReceiveConfigure,ReceiveItems,ReceiveSweep,ReceiveBody];

// Ingress error bodies (spec §8.3): {error, message} with fixed messages; 429 and 503 carry Retry-After; clock_skew
// carries serverTime. Unknown failures are a 500 without detail. The edge adapter is handleConversationIngress.
const MESSAGES={malformed:'The request is malformed.',invite_invalid:'The invitation is not valid.',envelope_expired:'The message has expired.',clock_skew:'The message is dated in the future.',author_unverifiable:'The author cannot be verified.',author_required:'An author is required.',not_authorized:'Not authorized.',operation_conflict:'The operation conflicts with an earlier one.',too_large:'The request is too large.',record_unsupported:'Unsupported record.',unsupported_profile:'Unsupported profile.',rate_limited:'Too many messages. Try again later.',recipient_unavailable:'The recipient is unavailable.',recipient_storage_unavailable:'The recipient is unavailable.',ingress_moved:'The ingress has moved.',counter_gap:'Counter gap.',incarnation_stale:'Stale incarnation.',participants_exceeded:'Too many participants.',record_forbidden:'Record forbidden.'};
export function ingressError(error,now){
 const code=error?.code,headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
 if(typeof code!=='string'||!Object.hasOwn(P.ERRORS,code))return Response.json({error:'internal_error',message:'The request could not be completed.'},{status:500,headers});
 const status=code==='author_unverifiable'&&error.status===503?503:P.ERRORS[code];
 if(status===429||status===503)headers['Retry-After']=String(Number.isSafeInteger(error.retryAfter)&&error.retryAfter>0?error.retryAfter:60);
 return Response.json({error:code,message:MESSAGES[code]??'The request could not be completed.',...code==='clock_skew'?{serverTime:Number.isSafeInteger(error.serverTime)?error.serverTime:now}:{}},{status,headers});
}
