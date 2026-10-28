// Core links: audience decisions, response signing and replay state (links §7.2–§7.5, §9). Methods taking `c` run on
// the AccountController; the ungated ones never hold the account gate across cross-account lookups. Parents are the
// type-neutral contact parents of ./parents.mjs (LinkService records). The legacy messaging half (decisions on
// `contact-grant/` parents, JSON inspection of legacy links, delivery admission, dead-parent reclamation and
// tombstones) was removed with core messaging on 2026-10-27 (DEVLOG "Messaging removed from core; Parlay rename").
import {StorageError} from '../storage/policy.mjs';
import {key,digest,fail} from '../core/records.mjs';
import {LinkReplayRecord} from './replay.mjs';
import {prepareLinkResponse,signLinkResponse} from '../identity/link-response.mjs';
import {evaluateLinkPolicy} from '../runtime/developer-contact.mjs';
import {UUID} from '../core/primitives.mjs';
import {CONTACT_KEYS} from './contact-profile.mjs';
import {LINK_FRAGMENT_TABLE} from './types.mjs';
import {assertLifecycleOpen} from '../runtime/account-deletion.mjs';
const DAY=86400000,CONTACT_PATH=/^\/users\/(?:[a-z0-9][a-z0-9_-]{2,31}|n\.[0-9abcdefghjkmnpqrstvwxyz]{1,9})\/contact\/[a-f0-9-]{36}$/;
const local=c=>c.config.LOCAL_DEVELOPMENT==='true';
const decisionPath=async(parent,principal)=>`link-audience/${parent}/${await digest(crypto,`${principal.issuer}\u0000${principal.subject}`)}`;
const invalid=()=>{throw new StorageError('link_invalid','This contact link is invalid or no longer active.',401);};
// Host-policy decision for one (parent, verified principal), with bounded reuse (links §7.5): a final positive
// decision lasts the UTC day, anything lower or negative at most 15 minutes. This is the links-contract `evaluate`
// port (LinkService `decide`, messaging §4.2), with the decision bound to the policy it was made under, so a policy change never reuses an old positive.
export async function decideLinkAudience(c,{parent,policy,principal}){
 if(!UUID.test(parent??'')||typeof principal?.issuer!=='string'||!UUID.test(principal?.subject??''))return {state:'unavailable'};
 return cachedDecision(c,parent,principal,policy,true);
}
async function cachedDecision(c,parent,principal,policy,bindPolicy=false){
 const path=await decisionPath(parent,principal),now=Date.now(),cached=await c.metadata.get(path);
 if(cached?.version===1&&cached.issuer===principal.issuer&&cached.subject===principal.subject&&cached.expiresAt>now&&cached.decidedAt<=now&&(!bindPolicy||cached.policy===(policy??null)))return cached;
 let result;try{result=await evaluateLinkPolicy(c,policy,principal);}catch{result=null;}
 if(!result||result.state==='unavailable')return {state:'unavailable'};
 const dayEnd=(Math.floor(now/DAY)+1)*DAY,record={version:1,issuer:principal.issuer,subject:principal.subject,state:result.eligible?'eligible':'ineligible',...result.reason?{reason:result.reason}:{},...result.tier?{tier:result.tier}:{},tags:result.eligible?result.tags??[]:[],decidedAt:now,expiresAt:result.eligible&&result.final?dayEnd:Math.min(dayEnd,now+900000),...bindPolicy?{policy:policy??null}:{}};
 // D1: ungated after a cross-account policy evaluation, so the decision is written only while no deletion fence,
 // purge job or tombstone exists, in the same transaction as that check.
 try{await c.metadata.transaction(async tx=>{await assertLifecycleOpen(tx);await tx.put(path,record);});}catch(error){if(error?.status===410)return {state:'unavailable'};throw error;}
 return record;
}
// links §9 step 2: the signed-in opener's own provider signs, after an explicit click, for a same-host link only.
export async function signOwnLinkResponse(c,owner,handle,link){
 let meta;try{meta=prepareLinkResponse(link,{types:LINK_FRAGMENT_TABLE.map(row=>row.type),allowInsecureLocalhost:local(c)});if(new URL(link).origin!==c.config.APP_ORIGIN||meta.claims.iss!==c.config.APP_ORIGIN||!CONTACT_PATH.test(new URL(link).pathname))fail('link_invalid');}catch{invalid();}
 if(typeof handle!=='string'||!handle)throw new StorageError('unauthorized','Sign in again to continue.',401);
 const signer=await c.signingKey(owner);
 return signLinkResponse({meta,principal:{iss:c.config.APP_ORIGIN,sub:owner,handle:`${handle}@${new URL(c.config.APP_ORIGIN).host}`},key:signer,types:LINK_FRAGMENT_TABLE.map(row=>row.type),allowInsecureLocalhost:local(c)});
}
// Bounded expiry sweeps for decisions and orphaned per-parent rows.
async function sweep(c,prefix,expired,limit=128){
 const cursorKey='link-gc-cursor/'+prefix,cursor=await c.metadata.get(cursorKey);let rows=await c.metadata.list({prefix,...cursor?{startAfter:cursor}:{},limit});if(!rows.size&&cursor)rows=await c.metadata.list({prefix,limit});
 const now=Date.now(),stale=[];for(const [path,row]of rows)if(await expired(row,now,path))stale.push(path);for(let i=0;i<stale.length;i+=64)await c.metadata.delete(stale.slice(i,i+64));
 if(rows.size)await c.metadata.put(cursorKey,[...rows.keys()].at(-1));else await c.metadata.delete(cursorKey);return rows.size===limit;
}
/** Link-state maintenance on the account alarm: expired audience decisions, sharing rows whose contact parent was
 * reclaimed by LinkService, and replay rows of conditional parents (64 parents a run, wrapping cursor). */
export async function collectLinkState(c,owner){
 let more=false;
 more=await sweep(c,'link-audience/',row=>!(row?.expiresAt>Date.now()))||more;
 more=await sweep(c,CONTACT_KEYS.sharing,async(row,now,path)=>(await c.metadata.get(key('link',path.slice(CONTACT_KEYS.sharing.length))))?.owner!==owner)||more;
 c.linkReplay??=new LinkReplayRecord({metadata:c.metadata});
 {const cursorKey='link-gc-cursor/replay',prefix=key('link'),cursor=await c.metadata.get(cursorKey);let rows=await c.metadata.list({prefix,...cursor?{startAfter:cursor}:{},limit:64});if(!rows.size&&cursor)rows=await c.metadata.list({prefix,limit:64});
  for(const record of rows.values())if(record?.owner===owner&&UUID.test(record.jti??'')&&record.claims?.audience)await c.linkReplay.purge(record.jti,64);
  if(rows.size===64){await c.metadata.put(cursorKey,[...rows.keys()].at(-1));more=true;}else await c.metadata.delete(cursorKey);}
 if(more)await c.scheduleAlarm(Date.now()+3600000);
}
