// Parlay's message-category taxonomy (extensions CR-X3-25, provisional, unsigned). Parlay owns its categories and sends
// them with every item-classification/v1 call (docs/spec/extensions/item-classification.md); a classifier provider
// hard-codes none. The classifier port is the contract call: classify({item:{text,hints},labels}) ->
// {scores:{<label id>:number}, model:{id,version}}. Parlay binds every threshold to (model id, model version, taxonomy):
// changing a description below changes what is asked, so it MUST change TAXONOMY, which sends every pin back to calibration.
import {TAG_CATEGORIES,boundedString} from './tags.mjs';
export const CLASSIFICATION_CONTRACT='https://spec.bindle.example/contracts/item-classification/v1';
export const CLASSIFICATION_FRAGMENT='https://spec.bindle.example/fragments/item-classification/v1';
export const TAXONOMY='parlay-message-categories-v1';
export const CATEGORY_DESCRIPTIONS=Object.freeze({spam:'Unsolicited or deceptive spam.',social:'Personal social correspondence.',promotional:'Marketing or promotion.',recruitment:'Recruiting or employment outreach.',conversation:'An ongoing human conversation.',outreach:'An initial personal outreach.',transactional:'A service transaction.',receipt:'A receipt or invoice.',automation:'Automatically generated mail.',verification:'An identity or account verification.',code:'A one-time authentication code.'});
// Header hints Parlay shares (data minimization: nothing else from the headers leaves the mailbox).
export const CLASSIFIER_HINTS=Object.freeze(['auto-submitted','list-id','list-unsubscribe','precedence-bulk']);
// Conservative byte ceiling, the 3sln.me resource's advertised text limit (the contract allows more; a smaller provider
// limit is refused as invalid_args, so the consumer cuts first). The model tokenizer is unknown: bytes bound tokens.
export const MAX_CLASSIFIER_BYTES=2000;
const encoder=new TextEncoder(),plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
/** Cuts `text` at a code point boundary so its UTF-8 encoding is at most `max` bytes. */
export function truncateBytes(text,max=MAX_CLASSIFIER_BYTES){let out='',bytes=0;for(const c of String(text)){bytes+=encoder.encode(c).length;if(bytes>max)break;out+=c;}return out;}
/** The caller-supplied label set for `ids` (a subset of Parlay's categories, in Parlay's order). */
export function categoryLabels(ids=TAG_CATEGORIES){
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!Object.hasOwn(CATEGORY_DESCRIPTIONS,id)))throw new TypeError('Unknown Parlay category');
 return TAG_CATEGORIES.filter(id=>ids.includes(id)).map(id=>({id,description:CATEGORY_DESCRIPTIONS[id]}));
}
/** Builds the contract arguments: bounded text, recognized hints only, and Parlay's labels. */
export function classificationArgs({text,hints=[]},ids=TAG_CATEGORIES){
 const shared=[...new Set((Array.isArray(hints)?hints:[]).map(h=>String(h).toLowerCase()).filter(h=>CLASSIFIER_HINTS.includes(h)))];
 return {item:{text:truncateBytes(text??''),hints:shared},labels:categoryLabels(ids)};
}
/** A contract result is used only when it scores exactly the labels asked, each in [0, 1], with bounded model evidence. */
export function classificationEvidence(value,ids=TAG_CATEGORIES){
 if(!plain(value)||!plain(value.scores)||!plain(value.model)||!boundedString(value.model.id,100)||!boundedString(value.model.version,64))return null;
 const keys=Object.keys(value.scores);if(keys.length!==ids.length||keys.some(k=>!ids.includes(k))||Object.values(value.scores).some(p=>typeof p!=='number'||!Number.isFinite(p)||p<0||p>1))return null;
 return {labels:{...value.scores},evidence:{model:value.model.id,version:value.model.version,schema:TAXONOMY}};
}
/** One contract call with Parlay's taxonomy. Returns {labels, evidence} or null; never retries another resource. */
export async function classifyText(classifier,input,ids=TAG_CATEGORIES){
 if(typeof classifier?.classify!=='function')return null;
 return classificationEvidence(await classifier.classify(classificationArgs(input,ids)),ids);
}
