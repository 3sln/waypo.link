// BB-B5 classifier consumer over the shared Bindle item-classification fragment (extensions CR-X3-25, IC-4). The host
// port (./categories.mjs) owns the live field values, grants and transport; this consumer picks the text classifier,
// else the fallback, honours each field's detail level, and fails over only on a proven no-effect refusal
// (item-classification §8.3). Parlay supplies its own categories and binds thresholds to {model, version, schema:
// TAXONOMY}. An item it wanted classified but could not score (§8.4 "unscored") gets the failure tag
// CLASSIFICATION_FAILED_TAG with a reason (owner direction 2026-10-28) and, when no classifier can handle text at all, the
// gap is kept for the owner (classify.status). The owner can find failed items with a tag filter and re-request them
// (classify.retry). The former 3sln.me item-classifier fragment and its decision-model/v1 contract are withdrawn.
import {MailboxAction,MailboxQuery} from '../engine.mjs';
import {fault} from '../faults.mjs';
import {minimize} from './intake.mjs';
import {TAG_CATEGORIES,CLASSIFICATION_FAILED_TAG,heuristicSuspectedTags,applyAutomatedTags,recordAutomated,clearClassificationFailure,runRulesFresh,executeRuleEffects,boundedString} from './tags.mjs';
import {ownerRules} from './rules.mjs';
import {CLASSIFICATION_FRAGMENT,CLASSIFICATION_CONTRACT,MAX_CLASSIFIER_BYTES,CLASSIFIER_HINTS,UNSCORED_REASONS,truncateBytes,classifyText,classifierSnapshot,noteGap,readGaps} from './categories.mjs';
import {incomingItem,organizationOf,saveOrganization,CLASSIFY_PENDING,classifyPendingKey,validItemId} from '../store/item-index.mjs';
import {KEYS} from '../store/mailbox.mjs';
import {fromBase64url} from '../../messaging-protocol/index.mjs';
export const CLASSIFIER_FRAGMENT=CLASSIFICATION_FRAGMENT,CLASSIFIER_CONTRACT=CLASSIFICATION_CONTRACT;
export {CLASSIFICATION_FAILED_TAG};
// Owner direction 2026-10-28: an item awaiting auto-classification shows that it is pending, and the owner is warned
// when classification is slow: any item pending longer than this (provisional constant).
export const CLASSIFICATION_SLOW_MS=120000;
// Owner direction 2026-10-28: an item pending longer than this is failed by the deadline sweep (classify.sweep, run from
// the mailbox alarm): it gets the failure tag (reason `deadline`) and goes through the final rule run, so a held
// notification is always released (review M2). Provisional constant, well above the classifier timeout.
export const CLASSIFICATION_DEADLINE_MS=600000;
/** Reasons a failed item carries: the contract-level unscored reasons, plus the deadline, an item that is no longer
 * eligible (consent withdrawn, conversation opt-in removed, moved into public intake) and a settings change mid-flight. */
export const CLASSIFICATION_FAILURE_REASONS=Object.freeze([...UNSCORED_REASONS,'deadline','ineligible','changed']);
export const MAX_CLASSIFY_RETRY=50;
const PENDING=CLASSIFY_PENDING,MAX_PENDING_SCAN=1000,MAX_SWEEP=64,MAX_DUE=16;
const SETTINGS='bb:classify:settings',defaults=()=>({revision:0,consent:false,allowance:200,usage:{day:0,calls:0},pins:[],conversations:[]});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),evidenceOK=e=>plain(e)&&boundedString(e.model,100)&&boundedString(e.version,64)&&boundedString(e.schema,128);
const modelKey=e=>JSON.stringify([e.model,e.version,e.schema]),decoder=new TextDecoder();
export {MAX_CLASSIFIER_BYTES};
const minimizedText=text=>truncateBytes(minimize(text),MAX_CLASSIFIER_BYTES);
function normalizePin(p){
 if(!evidenceOK(p)||!plain(p.thresholds)||!Object.keys(p.thresholds).length||Object.entries(p.thresholds).some(([k,v])=>!TAG_CATEGORIES.includes(k)||typeof v!=='number'||!Number.isFinite(v)||v<=0||v>1))fault('invalid_classification','Choose model-bound thresholds.',400);
 return {model:p.model,version:p.version,schema:p.schema,thresholds:{...p.thresholds}};
}
function headerHints(item){
 if(item.origin!=='channel')return heuristicSuspectedTags({});
 const hints=new Set((item.asserted?.automation??[]).map(h=>String(h).toLowerCase())),headers={};
 if(hints.has('auto-submitted'))headers['auto-submitted']='auto-generated';
 if(hints.has('list-unsubscribe')||hints.has('list-id'))headers['list-id']='present';
 if(hints.has('precedence-bulk'))headers.precedence='bulk';
 return heuristicSuspectedTags(headers);
}
async function textOf(tx,item){
 if(item.origin==='channel')return (item.message?.parts??[]).filter(p=>p.mimeType?.startsWith('text/plain')).map(p=>decoder.decode(fromBase64url(p.dataBase64url))).join('\n');
 const body=item.content?.mimeType?.startsWith('text/plain')?await tx.get(KEYS.body(item.id)):null;
 return `${item.subject??''}\n\n${body?decoder.decode(body):''}`;
}
export class ClassificationSettings extends MailboxAction {
 static operation='classify.settings';static deps=['tags'];static changes='classification-settings-changed';
 run({tags}){
  const input=structuredClone(this.input??{});
  if(!plain(input)||Object.keys(input).some(k=>!['consent','allowance','pin','conversation'].includes(k))||input.consent!==undefined&&typeof input.consent!=='boolean'||input.allowance!==undefined&&(!Number.isSafeInteger(input.allowance)||input.allowance<0||input.allowance>100000))fault('invalid_classification');
  const pin=input.pin===undefined?null:normalizePin(input.pin),conversation=input.conversation;
  if(conversation!==undefined&&(!plain(conversation)||!boundedString(conversation.id,1024)||typeof conversation.enabled!=='boolean'))fault('invalid_classification');
  return tags.transaction(async tx=>{const s={...defaults(),...await tx.get(SETTINGS)};
   if(input.consent!==undefined)s.consent=input.consent;if(input.allowance!==undefined)s.allowance=input.allowance;
   if(pin)s.pins=[...s.pins.filter(p=>modelKey(p)!==modelKey(pin)),pin].slice(-16);
   if(conversation){s.conversations=s.conversations.filter(id=>id!==conversation.id);if(conversation.enabled){if(s.conversations.length>=1000)fault('limit_reached');s.conversations.push(conversation.id);}}
   s.revision++;await tx.put(SETTINGS,s);return s;
  });
 }
}
// This query reports local consent only; a bound classifier port is never advertised as verified occupancy.
// `pending` summarizes items awaiting auto-classification: how many, how many are slow (CLASSIFICATION_SLOW_MS) and since
// when the oldest has waited.
export class ClassificationStatus extends MailboxQuery {
 static operation='classify.status';static deps=['tags','clock'];static refreshOn=['classification-settings-changed','incoming-changed'];
 fetch({tags,clock}){return tags.transaction(async tx=>{const s={...defaults(),...await tx.get(SETTINGS)},now=clock.now(),since=[...(await tx.list({prefix:PENDING,limit:MAX_PENDING_SCAN})).values()].map(v=>v?.since).filter(Number.isSafeInteger);
  return {consent:s.consent,allowance:s.allowance,revision:s.revision,pins:s.pins,conversations:s.conversations,gaps:await readGaps(tx),pending:{count:since.length,slow:since.filter(t=>now-t>=CLASSIFICATION_SLOW_MS).length,oldestSince:since.length?Math.min(...since):null,slowAfterMs:CLASSIFICATION_SLOW_MS}};});}
}
// Eligibility shared by classify.begin, classify.item and classify.retry. Returns a skip reason or null.
function skipReason(item,s){
 // §12.1 public requests are already classified by BB-B2; never retier, reject or release them here.
 if(item.request||['pending','rejected'].includes(item.state))return 'public-intake';
 const conversation=item.type==='conversation'||item.kind==='conversation'||item.conversationId!==undefined;
 if(conversation&&!s.conversations.includes(item.conversationId??item.id))return 'conversation-opt-in';
 if(item.origin!=='channel'&&!conversation&&item.kind!=='one-off')return 'unsupported-kind';
 return null;
}
/**
 * The item enters auto-classification (owner direction 2026-10-28): rules run provisionally from a blank slate (run 1),
 * the delivery notification is held, and the item is marked pending until classify.item (or the deadline sweep)
 * completes it. Idempotent. A host calls this instead of rules.apply for an item the owner wants classified.
 */
export class ClassifyBegin extends MailboxAction {
 static operation='classify.begin';static deps=['tags','clock'];static changes='incoming-changed';
 run({tags,clock}){
  const id=this.id??this.input?.id,now=clock.now();
  return tags.transaction(async tx=>{
   const item=await incomingItem(tx,id),s={...defaults(),...await tx.get(SETTINGS)},m=organizationOf(item),skip=skipReason(item,s);
   if(m.classificationPending)return {id,status:'pending',item:m};
   if(skip)return {id,status:'skipped',reason:skip};if(!s.consent)return {id,status:'skipped',reason:'no-consent'};
   if(m.classificationResult?.classifier)return {id,status:'skipped',reason:'classified'};
   m.mimeType??=item.content?.mimeType;m.grantId??=item.jti;
   // Provisional run: tags only; its effects are listed, never executed (they wait for the final run).
   await runRulesFresh(m,await ownerRules(tx),{now,run:1});
   m.classificationPending={since:now};m.heldNotification=item.notification??null;m.organizationRevision++;
   await tx.put(classifyPendingKey(id),{since:now});
   return {id,status:'pending',item:await saveOrganization(tx,{...item,notification:null},m)};
  });
 }
}
/** Completes a pending item: evidence, the final blank-slate rule run (run 2), then its effects, once (including the held notification). */
async function completePending(tx,item,m,evidence,now){
 for(const input of evidence)recordAutomated(m,input,now);
 const effects=await runRulesFresh(m,await ownerRules(tx),{now,run:2});
 m.ruleGeneration=(m.ruleGeneration??0)+1;
 const notification=executeRuleEffects(m,effects,{generation:m.ruleGeneration,notification:m.heldNotification??null});
 delete m.classificationPending;delete m.heldNotification;m.organizationRevision++;
 await tx.delete(classifyPendingKey(item.id));
 const {classificationPending:_p,heldNotification:_h,...rest}=item;
 return saveOrganization(tx,{...rest,notification},m);
}
// The failure marker (§8.4 unscored; owner direction 2026-10-28): the classifier evidence slot records that no score
// exists and why, and recordAutomated sets CLASSIFICATION_FAILED_TAG from it.
const failed=reason=>({source:'classifier',status:'failed',version:'none',reason,labels:[]});
// A scored result with no pinned thresholds (calibration) is still a completed classification: it is recorded with no
// labels, so the item counts as classified (never charged again, review L2) and any failure tag is cleared.
const completed=(outcome,pin)=>({source:'classifier',status:'complete',model:outcome.evidence.model,version:outcome.evidence.version,schema:outcome.evidence.schema,labels:pin?labelsOver(outcome,pin):[]});
const sourceOf=item=>item.origin==='channel'?'email':'message';
const hintsOf=item=>item.origin==='channel'?(item.asserted?.automation??[]).filter(h=>CLASSIFIER_HINTS.includes(h)).slice(0,16):[];
/**
 * Classifies one item. For a pending item (classify.begin or classify.retry) it is the single classifier call of that
 * pending entry: the entry is claimed before anything is reserved, so a repeated or concurrent classify.item never
 * charges twice (review L2), and the item is always completed through the final rule run: scored, or failed with a
 * reason, including when it is no longer eligible (review M2). An item that is not pending and already has a classifier
 * result is never classified (or charged) again; only an explicit owner re-request (classify.retry) does that.
 */
export class ClassifyItem extends MailboxAction {
 static operation='classify.item';static deps=['tags','classifier','clock'];static changes='incoming-changed';
 async run({tags,classifier,clock}){
  const id=this.id??this.input?.id,now=()=>clock.now(),day=Math.floor(now()/86400000);
  // The field values are read once for this operation (extensions §3.2), before anything is reserved.
  const {values,candidates}=await classifierSnapshot(classifier);
  const snapshot=await tags.transaction(async tx=>{
   const item=await incomingItem(tx,id),s={...defaults(),...await tx.get(SETTINGS)},m=organizationOf(item),skip=skipReason(item,s),at=now();
   let claim=null;
   if(m.classificationPending){
    const row=await tx.get(classifyPendingKey(id));
    if(row?.claimed!==undefined)return {result:{id,status:'pending',reason:'in-progress'}};
    // No longer eligible: completed at once, failed, with the header hints (review M2).
    if(skip||!s.consent)return {result:{id,status:'failed',reason:'ineligible',...skip?{skip}:{skip:'no-consent'},source:'heuristic',item:await completePending(tx,item,m,[failed('ineligible'),headerHints(item)],at)}};
    claim=at;await tx.put(classifyPendingKey(id),{since:row?.since??m.classificationPending.since,claimed:claim});
   }else{
    if(skip)return {result:{id,status:'skipped',reason:skip}};
    if(m.classificationResult?.classifier)return {result:{id,status:'skipped',reason:'classified'}};
   }
   // Classification is wanted only with the owner's consent; an allowance or classifier shortfall then fails the item
   // (failure tag), never silently clean.
   let reserved=false,text='',miss=null;const used=s.usage.day===day?s.usage.calls:0;
   if(s.consent){
    if(!candidates)miss='no_classifier';else if(used>=s.allowance)miss='allowance';
    else{reserved=true;s.usage={day,calls:used+1};await tx.put(SETTINGS,s);text=minimizedText(await textOf(tx,item));}
   }
   return {item,settings:s,revision:m.organizationRevision,claim,reserved,miss,text,hints:headerHints(item)};
  });
  if(snapshot.result)return snapshot.result;
  let outcome=snapshot.miss?{status:'unscored',reason:snapshot.miss}:null;
  if(snapshot.reserved)outcome=await classifyText(classifier,values,{text:snapshot.text,source:sourceOf(snapshot.item),hints:hintsOf(snapshot.item)},TAG_CATEGORIES,{now:now()});
  return tags.transaction(async tx=>{
   let item;try{item=await incomingItem(tx,id);}catch(error){if(error?.code==='not_found')return {id,status:'skipped',reason:'removed'};throw error;}
   const s={...defaults(),...await tx.get(SETTINGS)},m=organizationOf(item),at=now();
   const settingsChanged=s.revision!==snapshot.settings.revision;
   if(snapshot.claim!==null){
    // Still this claim's pending entry? The deadline sweep may have failed it, and the owner may have re-requested it.
    const row=await tx.get(classifyPendingKey(id));
    if(!m.classificationPending||row&&row.claimed!==snapshot.claim)return {id,status:'skipped',reason:'changed'};
    // A pending item is completed by a blank-slate rule run, so owner edits in between never invalidate it; a settings
    // change (consent withdrawn, pins changed) drops the evidence and fails the item (reason `changed`).
    if(outcome&&!settingsChanged)await noteGap(tx,outcome,at);
    const scored=outcome?.status==='scored'&&!settingsChanged,pin=scored?s.pins.find(p=>modelKey(p)===modelKey(outcome.evidence)):null;
    const reason=settingsChanged?'changed':outcome?.reason??'ineligible';
    const evidence=scored?[completed(outcome,pin),snapshot.hints]:settingsChanged?[failed(reason)]:[failed(reason),snapshot.hints];
    const value=await completePending(tx,item,m,evidence,at);
    return {id,status:pin?'complete':scored?'calibration':'failed',...scored?{}:{reason},source:pin?'classifier':'heuristic',...pin?{evidence:outcome.evidence}:{},item:value};
   }
   if(m.organizationRevision!==snapshot.revision||settingsChanged)return {id,status:'skipped',reason:'changed'};
   if(outcome)await noteGap(tx,outcome,at);
   let current=item;
   if(outcome?.status==='scored'){
    const pin=s.pins.find(p=>modelKey(p)===modelKey(outcome.evidence));
    // No default probability threshold: a new model/schema/version enters calibration and adds no model tags.
    if(pin){const value=await applyAutomatedTags(tx,item,completed(outcome,pin),at);return {id,status:'complete',source:'classifier',evidence:outcome.evidence,item:value};}
    await applyAutomatedTags(tx,current,completed(outcome,null),at);current=await incomingItem(tx,id);
   }
   if(outcome?.status==='unscored'){await applyAutomatedTags(tx,current,failed(outcome.reason),at);current=await incomingItem(tx,id);}
   const value=await applyAutomatedTags(tx,current,snapshot.hints,at);
   return {id,status:outcome?.status==='scored'?'calibration':outcome?'failed':'heuristic',...outcome?.status==='unscored'?{reason:outcome.reason}:{},source:'heuristic',item:value};
  });
 }
}
/**
 * Deadline sweep (review M2; owner direction 2026-10-28), run by the mailbox alarm. Every pending entry past
 * CLASSIFICATION_DEADLINE_MS is failed (reason `deadline`) through the final rule run, so its effects and held
 * notification run; entries whose item is gone or no longer pending are removed. Returns the ids of unclaimed pending
 * items for the host to classify (bounded).
 */
export class ClassifySweep extends MailboxAction {
 static operation='classify.sweep';static deps=['tags','clock'];static changes='incoming-changed';
 run({tags,clock}){
  return tags.transaction(async tx=>{
   const now=clock.now(),due=[];let failedCount=0,removed=0;
   for(const [key,row] of await tx.list({prefix:PENDING,limit:MAX_PENDING_SCAN})){
    let id;try{id=decodeURIComponent(key.slice(PENDING.length));}catch{id=null;}
    const item=id!==null&&validItemId(id)?await tx.get(`item/${id}`)??await tx.get('bb:incoming:row/'+id):null;
    const m=item?organizationOf(item):null;
    if(!m?.classificationPending){await tx.delete(key);removed++;continue;}
    const since=Number.isSafeInteger(row?.since)?row.since:m.classificationPending.since;
    if(!Number.isSafeInteger(since)||now-since>=CLASSIFICATION_DEADLINE_MS){if(failedCount<MAX_SWEEP){await completePending(tx,item,m,[failed('deadline'),headerHints(item)],now);failedCount++;}}
    else if(row?.claimed===undefined&&due.length<MAX_DUE)due.push(id);
   }
   return {failed:failedCount,removed,due};
  });
 }
}
/**
 * The owner re-requests classification of failed items (owner direction 2026-10-28). Each selected item that carries
 * the failure tag (or a failed classifier result), is not pending and is still eligible re-enters pending: the failure
 * tag and its evidence are cleared, the delivery notification is held, and the next classify.item classifies it again,
 * charged again against the local allowance (and, for the built-in, the owner's AI allowance). Items beyond today's
 * remaining allowance are refused here (`allowance`) rather than queued to fail. The previous final run's tags stay until
 * the new final run replaces them; its executed effects are not undone (owner choices win, as always).
 */
export class ClassifyRetry extends MailboxAction {
 static operation='classify.retry';static deps=['tags','clock'];static changes='incoming-changed';
 run({tags,clock}){
  const input=this.input??{};
  if(!plain(input)||Object.keys(input).some(k=>k!=='ids')||!Array.isArray(input.ids)||!input.ids.length||input.ids.length>MAX_CLASSIFY_RETRY||new Set(input.ids).size!==input.ids.length||input.ids.some(id=>!validItemId(id)))fault('invalid_classification','Choose up to 50 items to classify again.',400);
  return tags.transaction(async tx=>{
   const now=clock.now(),day=Math.floor(now/86400000),s={...defaults(),...await tx.get(SETTINGS)},used=s.usage.day===day?s.usage.calls:0;
   // Unclaimed pending entries will each take one call of today's allowance; claimed ones are already counted in `used`.
   const queued=[...(await tx.list({prefix:PENDING,limit:MAX_PENDING_SCAN})).values()].filter(row=>row?.claimed===undefined).length;
   let room=Math.max(0,s.allowance-used-queued);const results=[];
   for(const id of input.ids){
    const item=await tx.get(`item/${id}`)??await tx.get('bb:incoming:row/'+id);if(!item){results.push({id,status:'refused',reason:'not_found'});continue;}
    const m=organizationOf(item),skip=skipReason(item,s);
    const wasFailed=m.tags.includes(CLASSIFICATION_FAILED_TAG)||m.classificationResult?.classifier?.result?.status==='failed';
    const reason=m.classificationPending?'pending':!wasFailed?'not_failed':skip?'ineligible':!s.consent?'no_consent':room<1?'allowance':null;
    if(reason){results.push({id,status:'refused',reason});continue;}
    room--;clearClassificationFailure(m,now);
    if(m.classificationResult?.classifier){const {classifier:_,...rest}=m.classificationResult;m.classificationResult=rest;}
    m.tagSuppressed=(m.tagSuppressed??[]).filter(t=>t!==CLASSIFICATION_FAILED_TAG);
    m.classificationPending={since:now,retry:true};m.heldNotification=item.notification??null;m.organizationRevision++;
    await tx.put(classifyPendingKey(id),{since:now});
    const saved=await saveOrganization(tx,{...item,notification:null},m);results.push({id,status:'pending',organizationRevision:saved.organizationRevision});
   }
   return {results};
  });
 }
}
const labelsOver=(outcome,pin)=>Object.entries(outcome.labels).filter(([category,p])=>pin.thresholds[category]!==undefined&&p>=pin.thresholds[category]).map(([category,probability])=>({tag:'sys:suspected.'+category,probability}));
export const CLASSIFY_OPERATIONS=[ClassificationSettings,ClassificationStatus,ClassifyBegin,ClassifyItem,ClassifySweep,ClassifyRetry];
