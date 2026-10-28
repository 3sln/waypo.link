// BB-B5 classifier consumer over the shared Bindle item-classification fragment (extensions CR-X3-25, IC-4). The host
// port (./categories.mjs) owns the live field values, grants and transport; this consumer picks the text classifier,
// else the fallback, honours each field's detail level, and fails over only on a proven no-effect refusal
// (item-classification §8.3). Parlay supplies its own categories and binds thresholds to {model, version, schema:
// TAXONOMY}. An item it wanted classified but could not score is recorded `unscored` (§8.4) and, when no classifier can
// handle text at all, the gap is kept for the owner (classify.status). The former 3sln.me item-classifier fragment and
// its decision-model/v1 contract are withdrawn.
import {MailboxAction,MailboxQuery} from '../engine.mjs';
import {fault} from '../faults.mjs';
import {minimize} from './intake.mjs';
import {TAG_CATEGORIES,heuristicSuspectedTags,applyAutomatedTags,recordAutomated,runRulesFresh,executeRuleEffects,boundedString} from './tags.mjs';
import {ownerRules} from './rules.mjs';
import {CLASSIFICATION_FRAGMENT,CLASSIFICATION_CONTRACT,MAX_CLASSIFIER_BYTES,CLASSIFIER_HINTS,truncateBytes,classifyText,classifierSnapshot,noteGap,readGaps} from './categories.mjs';
import {incomingItem,organizationOf,saveOrganization} from '../store/item-index.mjs';
import {KEYS} from '../store/mailbox.mjs';
import {fromBase64url} from '../../messaging-protocol/index.mjs';
export const CLASSIFIER_FRAGMENT=CLASSIFICATION_FRAGMENT,CLASSIFIER_CONTRACT=CLASSIFICATION_CONTRACT;
// Owner direction 2026-10-28: an item awaiting auto-classification shows that it is pending, and the owner is warned
// when classification is slow: any item pending longer than this (provisional constant).
export const CLASSIFICATION_SLOW_MS=120000;
const PENDING='bb:classify:pending/',MAX_PENDING_SCAN=1000;
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
// Eligibility shared by classify.begin and classify.item. Returns a skip reason or null.
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
 * the delivery notification is held, and the item is marked pending until classify.item completes it. Idempotent. A
 * host calls this instead of rules.apply for an item the owner wants classified, then classify.item.
 */
export class ClassifyBegin extends MailboxAction {
 static operation='classify.begin';static deps=['tags','clock'];static changes='incoming-changed';
 run({tags,clock}){
  const id=this.id??this.input?.id,now=clock.now();
  return tags.transaction(async tx=>{
   const item=await incomingItem(tx,id),s={...defaults(),...await tx.get(SETTINGS)},m=organizationOf(item),skip=skipReason(item,s);
   if(skip)return {id,status:'skipped',reason:skip};if(!s.consent)return {id,status:'skipped',reason:'no-consent'};
   if(m.classificationPending)return {id,status:'pending',item:m};
   if(m.classificationResult?.classifier)return {id,status:'skipped',reason:'classified'};
   m.mimeType??=item.content?.mimeType;m.grantId??=item.jti;
   // Provisional run: tags only; its effects are listed, never executed (they wait for the final run).
   await runRulesFresh(m,await ownerRules(tx),{now,run:1});
   m.classificationPending={since:now};m.heldNotification=item.notification??null;m.organizationRevision++;
   await tx.put(PENDING+encodeURIComponent(id),{since:now});
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
 await tx.delete(PENDING+encodeURIComponent(item.id));
 const {classificationPending:_p,heldNotification:_h,...rest}=item;
 return saveOrganization(tx,{...rest,notification},m);
}
// The unscored marker (§8.4): the classifier field's evidence slot records that no score exists, and why.
const unscored=reason=>({source:'classifier',status:'unscored',version:'none',reason,labels:[]});
export class ClassifyItem extends MailboxAction {
 static operation='classify.item';static deps=['tags','classifier','clock'];static changes='incoming-changed';
 async run({tags,classifier,clock}){
  const id=this.id??this.input?.id,now=()=>clock.now(),day=Math.floor(now()/86400000);
  // The field values are read once for this operation (extensions §3.2), before anything is reserved.
  const {values,candidates}=await classifierSnapshot(classifier);
  const snapshot=await tags.transaction(async tx=>{
   const item=await incomingItem(tx,id),s={...defaults(),...await tx.get(SETTINGS)},m=organizationOf(item),skip=skipReason(item,s);
   if(skip)return {skip};
   // Classification is wanted only with the owner's consent; an allowance or classifier shortfall then makes the item
   // unscored, never silently clean.
   let reserved=false,text='',miss=null;const used=s.usage.day===day?s.usage.calls:0;
   if(s.consent){
    if(!candidates)miss='no_classifier';else if(used>=s.allowance)miss='allowance';
    else{reserved=true;s.usage={day,calls:used+1};await tx.put(SETTINGS,s);text=minimizedText(await textOf(tx,item));}
   }
   return {item,settings:s,revision:m.organizationRevision,pending:Boolean(m.classificationPending),reserved,miss,text,hints:headerHints(item)};
  });
  if(snapshot.skip)return {id,status:'skipped',reason:snapshot.skip};
  let outcome=snapshot.miss?{status:'unscored',reason:snapshot.miss}:null;
  if(snapshot.reserved)outcome=await classifyText(classifier,values,{text:snapshot.text,source:snapshot.item.origin==='channel'?'email':'message',hints:snapshot.item.origin==='channel'?(snapshot.item.asserted?.automation??[]).filter(h=>CLASSIFIER_HINTS.includes(h)).slice(0,16):[]},TAG_CATEGORIES,{now:now()});
  return tags.transaction(async tx=>{
   const item=await incomingItem(tx,id),s={...defaults(),...await tx.get(SETTINGS)},m=organizationOf(item),at=now();
   const settingsChanged=s.revision!==snapshot.settings.revision;
   // A pending item is completed by a blank-slate rule run, so owner edits in between never invalidate it; only a
   // settings change (consent withdrawn, pins changed) drops the evidence, and the item still completes.
   if(m.classificationPending){
    if(outcome&&!settingsChanged)await noteGap(tx,outcome,at);
    const pin=outcome?.status==='scored'&&!settingsChanged?s.pins.find(p=>modelKey(p)===modelKey(outcome.evidence)):null;
    const evidence=settingsChanged?[]:[...pin?[{source:'classifier',status:'complete',model:outcome.evidence.model,version:outcome.evidence.version,schema:outcome.evidence.schema,labels:labelsOver(outcome,pin)}]:outcome?.status==='unscored'?[unscored(outcome.reason)]:[],snapshot.hints];
    const value=await completePending(tx,item,m,evidence,at);
    if(settingsChanged)return {id,status:'skipped',reason:'changed',item:value};
    return {id,status:pin?'complete':outcome?.status==='scored'?'calibration':outcome?'unscored':'heuristic',...outcome?.status==='unscored'?{reason:outcome.reason}:{},source:pin?'classifier':'heuristic',...pin?{evidence:outcome.evidence}:{},item:value};
   }
   if(m.organizationRevision!==snapshot.revision||settingsChanged)return {id,status:'skipped',reason:'changed'};
   if(outcome)await noteGap(tx,outcome,at);
   if(outcome?.status==='scored'){
    const pin=s.pins.find(p=>modelKey(p)===modelKey(outcome.evidence));
    // No default probability threshold: a new model/schema/version enters calibration and adds no model tags.
    if(pin){const value=await applyAutomatedTags(tx,item,{source:'classifier',status:'complete',model:outcome.evidence.model,version:outcome.evidence.version,schema:outcome.evidence.schema,labels:labelsOver(outcome,pin)},at);return {id,status:'complete',source:'classifier',evidence:outcome.evidence,item:value};}
   }
   let current=item;
   if(outcome?.status==='unscored'){await applyAutomatedTags(tx,current,unscored(outcome.reason),at);current=await incomingItem(tx,id);}
   const value=await applyAutomatedTags(tx,current,snapshot.hints,at);
   return {id,status:outcome?.status==='scored'?'calibration':outcome?'unscored':'heuristic',...outcome?.status==='unscored'?{reason:outcome.reason}:{},source:'heuristic',item:value};
  });
 }
}
const labelsOver=(outcome,pin)=>Object.entries(outcome.labels).filter(([category,p])=>pin.thresholds[category]!==undefined&&p>=pin.thresholds[category]).map(([category,probability])=>({tag:'sys:suspected.'+category,probability}));
export const CLASSIFY_OPERATIONS=[ClassificationSettings,ClassificationStatus,ClassifyBegin,ClassifyItem];
