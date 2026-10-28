// Parlay's message-category taxonomy and its use of the shared item-classification fragment (extensions CR-X3-25,
// provisional, unsigned). Parlay owns its categories and sends them with every item-classification/v1 call
// (docs/spec/extensions/item-classification.md); a classifier hard-codes none. Parlay binds every threshold to
// (model id, model version, taxonomy): changing a description below changes what is asked, so it MUST change TAXONOMY,
// which sends every pin back to calibration.
//
// The classifier port is the host's view of the fragment (it owns the preferences projection, grants and transport):
//   fields()                    -> the approved field values, read once per operation (extensions §3.2)
//   capabilities(resource)      -> the classifier's capabilities result
//   classify(resource, args)    -> the classify result; errors carry the contract `code`; a fresh tx per call
// Parlay classifies message text only (kind `text`, `text/plain`, inline). Selection, the owner's detail ceiling and
// the fallback are the shared rules in packages/sdk/src/item-classification.mjs. An item Parlay wanted classified but
// could not score is `unscored`, never silently treated as clean (item-classification §8.4).
import {TAG_CATEGORIES,boundedString} from './tags.mjs';
import {ITEM_CLASSIFICATION_CONTRACT,ITEM_CLASSIFICATION_FRAGMENT,classifierCandidates,classifyWithFallback} from '../../sdk/src/item-classification.mjs';
export const CLASSIFICATION_CONTRACT=ITEM_CLASSIFICATION_CONTRACT,CLASSIFICATION_FRAGMENT=ITEM_CLASSIFICATION_FRAGMENT;
export const TAXONOMY='parlay-message-categories-v1';
export const CATEGORY_DESCRIPTIONS=Object.freeze({spam:'Unsolicited or deceptive spam.',social:'Personal social correspondence.',promotional:'Marketing or promotion.',recruitment:'Recruiting or employment outreach.',conversation:'An ongoing human conversation.',outreach:'An initial personal outreach.',transactional:'A service transaction.',receipt:'A receipt or invoice.',automation:'Automatically generated mail.',verification:'An identity or account verification.',code:'A one-time authentication code.'});
// Header hints Parlay may share as context tags, and only when the owner allows `full` detail (data minimization:
// nothing else from the headers leaves the mailbox; Parlay never sends `origin`, whatever the level).
export const CLASSIFIER_HINTS=Object.freeze(['auto-submitted','list-id','list-unsubscribe','precedence-bulk']);
// Parlay's own ceiling on text it sends (minimized text, cut at a code point boundary). A classifier advertising a
// smaller limit for text is skipped by its capabilities, never sent the item.
export const MAX_CLASSIFIER_BYTES=2000;
export const ITEM_KIND='text',MEDIA_TYPE='text/plain';
/** Why an item Parlay wanted classified has no score. `no_classifier` and `unsupported` are gaps shown to the owner. */
export const UNSCORED_REASONS=Object.freeze(['no_classifier','unsupported','unavailable','item_unavailable','unknown_outcome','invalid_result','allowance']);
export const GAP_REASONS=Object.freeze(['no_classifier','unsupported']);
const GAPS='bb:classify:gaps',MAX_GAPS=16;
const encoder=new TextEncoder(),plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
/** Cuts `text` at a code point boundary so its UTF-8 encoding is at most `max` bytes. */
export function truncateBytes(text,max=MAX_CLASSIFIER_BYTES){let out='',bytes=0;for(const c of String(text)){bytes+=encoder.encode(c).length;if(bytes>max)break;out+=c;}return out;}
/** The caller-supplied label set for `ids` (a subset of Parlay's categories, in Parlay's order). */
export function categoryLabels(ids=TAG_CATEGORIES){
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!Object.hasOwn(CATEGORY_DESCRIPTIONS,id)))throw new TypeError('Unknown Parlay category');
 return TAG_CATEGORIES.filter(id=>ids.includes(id)).map(id=>({id,description:CATEGORY_DESCRIPTIONS[id]}));
}
/** The item and the most Parlay would share: bounded text, the source and recognized hints as context tags. The
 * owner's detail level, applied by buildClassifyArgs, decides how much of `tags` is actually sent. */
export function parlayItem({text,hints=[],source}){
 const context=[...new Set((Array.isArray(hints)?hints:[]).map(h=>String(h).toLowerCase()).filter(h=>CLASSIFIER_HINTS.includes(h)))];
 return {item:{kind:ITEM_KIND,mediaType:MEDIA_TYPE,bytes:encoder.encode(truncateBytes(text??''))},tags:{...source?{source}:{},...context.length?{context}:{}}};
}
/** Parlay's evidence from a validated contract result. */
export function classificationEvidence(result,ids=TAG_CATEGORIES){
 if(!plain(result?.scores)||!boundedString(result?.model?.id,100)||!boundedString(result?.model?.version,64))return null;
 const keys=Object.keys(result.scores);if(keys.length!==ids.length||keys.some(k=>!ids.includes(k)))return null;
 return {labels:{...result.scores},evidence:{model:result.model.id,version:result.model.version,schema:TAXONOMY}};
}
/** A port is usable when it implements the whole host view; anything else means no classifier. */
export const usablePort=port=>typeof port?.fields==='function'&&typeof port.capabilities==='function'&&typeof port.classify==='function';
/** The operation's snapshot of the field values and whether any candidate exists for Parlay's items (no dispatch). */
export async function classifierSnapshot(port){
 if(!usablePort(port))return {values:null,candidates:0};
 let values;try{values=await port.fields();}catch{return {values:null,candidates:0};}
 return {values:plain(values)?values:{},candidates:classifierCandidates(plain(values)?values:{},ITEM_KIND).length};
}
/**
 * One classification with Parlay's taxonomy over the fragment: per-kind field, then fallback, under each field's detail
 * level. Returns {status:'scored', labels, evidence, field, detail} or {status:'unscored', reason}. Never throws for
 * a classifier outcome; never retries after an ambiguous dispatch.
 */
export async function classifyText(port,values,input,ids,{now}){
 if(!usablePort(port)||!values)return {status:'unscored',reason:'no_classifier'};
 const {item,tags}=parlayItem(input),labels=categoryLabels(ids);
 let outcome;try{outcome=await classifyWithFallback(port,{values,item,tags,labels,now});}catch{return {status:'unscored',reason:'unknown_outcome'};}
 if(outcome.status!=='scored')return {status:'unscored',reason:outcome.reason};
 const evidence=classificationEvidence(outcome.result,labels.map(l=>l.id));
 return evidence?{status:'scored',...evidence,field:outcome.field,detail:outcome.detail}:{status:'unscored',reason:'invalid_result'};
}
/** Records (or, after a score, clears) the owner-visible gap for Parlay's item kind. Bounded; no item content. */
export async function noteGap(tx,outcome,now){
 const prior=await tx.get(GAPS),gaps=Array.isArray(prior)?prior.filter(g=>plain(g)&&!(g.kind===ITEM_KIND&&g.mediaType===MEDIA_TYPE)):[];
 if(outcome.status==='unscored'&&GAP_REASONS.includes(outcome.reason))gaps.push({kind:ITEM_KIND,mediaType:MEDIA_TYPE,reason:outcome.reason,at:now});
 else if(outcome.status!=='scored')return;
 const next=gaps.slice(-MAX_GAPS);if(JSON.stringify(next)!==JSON.stringify(Array.isArray(prior)?prior:[]))await tx.put(GAPS,next);
}
export async function readGaps(tx){const value=await tx.get(GAPS);return Array.isArray(value)?value.filter(g=>plain(g)&&typeof g.kind==='string'&&typeof g.mediaType==='string'&&GAP_REASONS.includes(g.reason)).map(({kind,mediaType,reason,at})=>({kind,mediaType,reason,at})):[];}
