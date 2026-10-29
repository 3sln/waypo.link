import {bodyObjects} from '../store/bodies.mjs';
import {projectIncoming,removeIncoming} from '../store/item-index.mjs';
// Intake: public-request filtering with the spam tiers of architecture §12.1. Bridged public intake (`deliver`, spec §9),
// address allowlists, header heuristics and the provider bridge port were removed with the email bridge (owner direction
// 2026-10-28; the `parlay-email-bridge-retired-v1` reset deletes their rows). Filtering runs after custody in `intake.drain`, so no
// receipt, error, header or timing class at admission depends on classification, score, rule or allowlist (§6.7).
//  - very likely spam: p >= T_high under a threshold pinned to the occupant's {model, version, schema}: auto-reject
//    into the bounded, recoverable Rejected view (500 items or 7 days, whichever is smaller);
//  - could be spam: T_low <= p < T_high: `sys:suspected.spam`, deprioritized, no push;
//  - an unpinned model version (calibration mode) or no consent: never auto-reject;
//  - unscored (item-classification §8.4: the owner consented but no classifier could score it — none fits, all
//    refused, a failure, or no allowance left): never auto-reject, never pushed. The request is held quietly and marked
//    `scoring: {state: 'unscored', reason}` so the owner sees it was not checked (the conservative default:
//    an unchecked request must not look like a checked clean one, nor be punished as spam);
//  - allowlisted principals are never auto-rejected; the skipped reject is recorded in tagHistory.
// The classifier sees only minimized, redacted text: no identifiers, recipients or URLs.
import {MailboxAction,MailboxQuery} from '../engine.mjs';
import {fault} from '../faults.mjs';
import {KEYS,BOUNDS,actorOwner,chargeUsage} from '../store/mailbox.mjs';
import {classifyText,classifierSnapshot,noteGap} from './categories.mjs';

export const T_HIGH=0.97,T_LOW=0.70,SPAM='sys:suspected.spam',FINAL_SPAM='sys:spam',DEFAULT_ALLOWANCE=200,MAX_CLASSIFIER_CHARS=8000;
const invalid=message=>fault('invalid_input',message,400);
const decoder=new TextDecoder('utf-8',{fatal:false});
export const defaultSettings=()=>({classifierConsent:false,allowance:DEFAULT_ALLOWANCE,usage:{day:0,calls:0},pins:[]});
const modelKey=e=>JSON.stringify([e.model,e.version,e.schema]);
const evidenceOK=e=>e&&typeof e==='object'&&['model','version','schema'].every(k=>typeof e[k]==='string'&&e[k].length>0&&e[k].length<=128);
// Deterministic redaction before any text leaves the mailbox (architecture §12): link capabilities, URLs, bearer-like
// tokens and one-time codes are replaced; the result is bounded (about 2,000 tokens).
export function minimize(text){
 return String(text).replace(/bindle_(meta|data)=[^\s&#]+/gi,'bindle_$1=[redacted]').replace(/\b(?:https?|web\+bindle):\/\/\S+/gi,'[url]').replace(/\b(?:bearer|token|dpop)\s+\S+/gi,'[credential]').replace(/[A-Za-z0-9_\-+/]{24,}={0,2}/g,'[token]').replace(/\b\d{4,8}\b/g,'[code]').slice(0,MAX_CLASSIFIER_CHARS);
}
// Pure tier decision. result: {spam:number, evidence:{model,version,schema}} | null. `unscored`: the owner wanted the
// request classified and it was not (a reason token), which holds it quietly instead of pushing it.
export function decideTier({result,pins=[],allowlisted=false,unscored=null}){
 if(result&&typeof result.spam==='number'&&result.spam>=0&&result.spam<=1&&evidenceOK(result.evidence)){
  const pin=pins.find(x=>modelKey(x)===modelKey(result.evidence)),p=result.spam,high=pin?.high??T_HIGH,low=pin?.low??T_LOW;
  const tag={id:SPAM,source:'classifier',probability:p,evidence:{model:result.evidence.model,version:result.evidence.version,schema:result.evidence.schema}};
  if(p>=high&&pin)return allowlisted?{tier:'suspect',tags:[tag],history:[{action:'reject-skipped',reason:'allowlist',rule:'default:reject.spam'}]}:{tier:'reject',tags:[tag,{id:FINAL_SPAM,source:'rule',rule:'default:reject.spam'}],history:[{action:'rejected',rule:'default:reject.spam'}]};
  if(p>=high&&!pin)return {tier:'suspect',tags:[tag],history:[{action:'calibration',reason:'unpinned_model'}]};
  if(p>=low)return {tier:'suspect',tags:[tag],history:[]};
  return {tier:'none',tags:[],history:[]};
 }
 const marker=unscored?[{action:'unscored',reason:unscored}]:[];
 if(unscored)return {tier:'unscored',tags:[],history:marker};
 return {tier:'none',tags:[],history:[]};
}

// Owner settings: classifier consent, metered allowance, and explicit threshold pins per model version.
export class IntakeSettings extends MailboxAction {
 static operation='intake.settings';static deps=['receive'];
 async run({receive}){
  actorOwner(this.actor);const input=this.input??{};
  return receive.store.transaction(async tx=>{
   const s={...defaultSettings(),...await tx.get(KEYS.settings)};
   if(input.classifierConsent!==undefined)s.classifierConsent=input.classifierConsent===true;
   if(input.allowance!==undefined){if(!Number.isSafeInteger(input.allowance)||input.allowance<0||input.allowance>100000)invalid('Choose a valid allowance.');s.allowance=input.allowance;}
   if(input.pin!==undefined){const pin=input.pin;if(!evidenceOK(pin))invalid('Choose a model version.');const high=pin.high??T_HIGH,low=pin.low??T_LOW;if(!(low>0&&low<high&&high<=1))invalid('Choose valid thresholds.');s.pins=[...s.pins.filter(x=>modelKey(x)!==modelKey(pin)),{model:pin.model,version:pin.version,schema:pin.schema,high,low}].slice(-16);}
   await tx.put(KEYS.settings,s);return s;
  });
 }
}
const principalOf=p=>{if(!p||typeof p.issuer!=='string'||!/^https:\/\/[^/?#]+$/.test(p.issuer)||typeof p.subject!=='string'||!/^[a-f0-9-]{36}$/.test(p.subject))invalid('Choose a valid principal.');return {issuer:p.issuer,subject:p.subject};};
// Allowlist of principals.
export class IntakeAllow extends MailboxAction {
 static operation='intake.allow';static deps=['receive','clock'];
 async run({receive,clock}){
  actorOwner(this.actor);const input=this.input??{},allowed=input.allowed!==false;
  if(Object.keys(input).some(k=>!['principal','allowed'].includes(k)))invalid('Choose a valid principal.');
  const principal=principalOf(input.principal),key=KEYS.allowPrincipal(principal);
  return receive.store.transaction(async tx=>{
   if(allowed){if(!await tx.get(key)&&(await tx.list({prefix:'allow/'})).size>=BOUNDS.maxAllow)fault('limit_reached','The allowlist is full.',409);await tx.put(key,{at:clock.now(),principal});}
   else await tx.delete(key);return {allowed};
  });
 }
}

// Drains pending public requests: classification outside any transaction, then one result transaction per item that
// rechecks the item is still pending (a quarantine, rescue or crash in between wins). Re-running is safe.
export class IntakeDrain extends MailboxAction {
 static operation='intake.drain';static deps=['receive','classifier','clock'];static changes='incoming-changed';
 async run({receive,classifier,clock}){
  actorOwner(this.actor,['system','owner']);const store=receive.store,limit=Math.min(Math.max(Number(this.input?.limit)||32,1),256);
  const queue=[...(await store.list({prefix:'pending/'})).entries()].slice(0,limit),out={processed:0,rejected:0,suspected:0,classified:0,unscored:0};
  for(const [pendingKey,{id}] of queue){
   const now=clock.now(),item=await store.get(KEYS.item(id));if(!item||item.state!=='pending'||item.quarantined){await store.transaction(tx=>tx.delete(pendingKey));continue;}
   const settings={...defaultSettings(),...await store.get(KEYS.settings)},day=Math.floor(now/86400000),used=settings.usage.day===day?settings.usage.calls:0;
   const allowlisted=Boolean(item.origin==='native'&&item.author?.principal&&await store.get(KEYS.allowPrincipal(item.author.principal)));
   let result=null,called=false,miss=null;
   // The field values are read once for this item's operation (extensions §3.2). A classifier call is reserved inside a
   // transaction before it is made, so concurrent drains cannot overspend the owner's allowance (BB2-R8).
   const {values,candidates}=settings.classifierConsent?await classifierSnapshot(classifier):{values:null,candidates:0};
   if(settings.classifierConsent&&!candidates)miss='no_classifier';
   else if(settings.classifierConsent){called=await store.transaction(async tx=>{const s={...defaultSettings(),...await tx.get(KEYS.settings)},u=s.usage.day===day?s.usage.calls:0;if(!s.classifierConsent||u>=s.allowance)return false;await tx.put(KEYS.settings,{...s,usage:{day,calls:u+1}});return true;});if(!called)miss='allowance';}
   if(called){let body='';if(item.origin==='native'&&item.content?.mimeType?.startsWith('text/plain')){const b=await store.get(KEYS.body(id));if(b)body=decoder.decode(b);}
    const text=minimize(`${item.subject}\n\n${body}`);
    // Parlay asks only its spam category here (item-classification/v1: the caller supplies the taxonomy).
    const outcome=await classifyText(classifier,values,{text,source:'message',hints:[]},['spam'],{now});
    if(outcome.status==='scored')result={spam:outcome.labels.spam,evidence:outcome.evidence};else miss=outcome.reason;
    await store.transaction(tx=>noteGap(tx,outcome,now));
   }else if(miss==='no_classifier')await store.transaction(tx=>noteGap(tx,{status:'unscored',reason:miss},now));
   const decision=decideTier({result,pins:settings.pins,allowlisted,unscored:result?null:miss});
   await store.transaction(async tx=>{
    const current=await tx.get(KEYS.item(id));await tx.delete(pendingKey);
    if(!current||current.state!=='pending'||current.quarantined)return;
    const next={...current,tags:[...current.tags,...decision.tags.map(t=>({...t,at:now}))],tagHistory:[...current.tagHistory,...decision.history.map(h=>({...h,at:now}))]};
    if(decision.tier==='reject'){Object.assign(next,{state:'rejected',rejectedAt:now,notification:null});await tx.put(KEYS.rejected(now,id),{id});await boundRejected(tx,now);out.rejected++;}
    else Object.assign(next,{state:'request',priority:decision.tier==='suspect'?'low':'normal',notification:['suspect','unscored'].includes(decision.tier)||miss?'quiet':'push'});
    if(!result&&miss)next.scoring={state:'unscored',reason:miss,at:now};
    if(decision.tier==='suspect')out.suspected++;await tx.put(KEYS.item(id),next);await projectIncoming(tx,next);
   });
   out.processed++;if(called&&result)out.classified++;if(!result&&miss)out.unscored++;
  }
  return out;
 }
}
// The Rejected view keeps the most recent 500 items and nothing older than 7 days; erased items lose body and record.
async function boundRejected(tx,now){
 const rows=[...(await tx.list({prefix:'rejected/'})).entries()];let excess=rows.length-BOUNDS.rejectedItems;
 for(const [key,{id}] of rows){const at=Number(key.split('/')[1]);if(excess>0||at+BOUNDS.rejectedMs<now){const item=await tx.get(KEYS.item(id));await tx.delete(key);await tx.delete(KEYS.item(id));await removeIncoming(tx,id);await tx.delete(KEYS.body(id));if(item?.hot>0)await chargeUsage(tx,{bytes:-item.hot,items:-1});
  if(item?.author?.jkt)await tx.delete(`by-jkt/${item.author.jkt}/${id}`);if(item?.bodyRef?.storage==='user')for(const key of bodyObjects(item.bodyRef))await tx.put(`storage-gc/${encodeURIComponent(key)}`,{key});excess--;}}
}
// Erases expired Rejected items, then deletes queued user-storage bodies (erased items and refused-attempt orphans)
// outside any transaction; a failed delete stays queued (BB2-R1, BB2-R7).
export class IntakeSweep extends MailboxAction {
 static operation='intake.sweep';static deps=['receive','userStorage','clock'];static changes='incoming-changed';
 async run({receive,userStorage,clock}){
  actorOwner(this.actor,['system','owner']);const now=clock.now();await receive.store.transaction(tx=>boundRejected(tx,now));let deleted=0,pending=0;
  for(const [key,{key:object}] of await receive.store.list({prefix:'storage-gc/'})){
   try{if(typeof userStorage?.delete!=='function')throw new Error();await userStorage.delete(object);await receive.store.transaction(tx=>tx.delete(key));deleted++;}catch{pending++;}
  }
  return {deleted,pending};
 }
}
// Rescue turns a rejected item into an ordinary request; optionally allowlists its sender.
export class IntakeRescue extends MailboxAction {
 static operation='intake.rescue';static deps=['receive','clock'];static changes='incoming-changed';
 async run({receive,clock}){
  actorOwner(this.actor);const {id,allow=false}=this.input??{},now=clock.now();if(typeof id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(id))invalid('Choose an item.');
  return receive.store.transaction(async tx=>{
   const item=await tx.get(KEYS.item(id));if(!item||item.state!=='rejected')fault('not_found','That item is not in Rejected.',404);
   await tx.delete(KEYS.rejected(item.rejectedAt,id));
   const next={...item,state:'request',priority:'normal',notification:null,reviewed:true,tags:item.tags.filter(t=>t.id!==FINAL_SPAM),tagHistory:[...item.tagHistory,{action:'rescued',at:now}]};await tx.put(KEYS.item(id),next);await projectIncoming(tx,next);
   if(allow===true&&item.origin==='native'&&item.author?.principal)await tx.put(KEYS.allowPrincipal(item.author.principal),{at:now,principal:{issuer:item.author.principal.issuer,subject:item.author.principal.subject}});
   return {id,state:'request'};
  });
 }
}
const view=i=>({id:i.id,origin:i.origin,kind:i.kind,author:{principal:i.author?.principal??null,verified:i.origin==='native'&&i.imported?.verified!==false},subject:i.subject,receivedAt:i.receivedAt,state:i.state,priority:i.priority??'normal',tags:i.tags,tagHistory:i.tagHistory,rejectedAt:i.rejectedAt??null,...i.scoring?{scoring:{state:i.scoring.state,reason:i.scoring.reason}}:{}});
// "Requests" View: suspected requests sorted to the bottom. Rejected view: not searchable, newest first.
export class IntakeRequests extends MailboxQuery {
 static operation='intake.requests';static deps=['receive'];static refreshOn=['incoming-changed'];
 async fetch({receive}){actorOwner(this.actor);return [...(await receive.store.list({prefix:'item/'})).values()].filter(i=>i.state==='request'&&!i.quarantined).sort((a,b)=>(a.priority==='low')-(b.priority==='low')||b.receivedAt-a.receivedAt).map(view);}
}
export class IntakeRejected extends MailboxQuery {
 static operation='intake.rejected';static deps=['receive'];static refreshOn=['incoming-changed'];
 async fetch({receive}){actorOwner(this.actor);const out=[];for(const [,{id}] of [...(await receive.store.list({prefix:'rejected/'})).entries()].reverse()){const i=await receive.store.get(KEYS.item(id));if(i)out.push(view(i));}return out;}
}
export const INTAKE_OPERATIONS=[IntakeSettings,IntakeAllow,IntakeDrain,IntakeSweep,IntakeRescue,IntakeRequests,IntakeRejected];
