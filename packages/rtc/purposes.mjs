// RTC-b: the `rtc-purpose` artefact kind (docs/spec/rtc-signaling.md §3.4, §15; design §4). Pure value operations plus
// the reviewed candidate lines. Provisional (coordinator), not signed off by the user.
//
// A purpose names what a session is for and bounds it: the most media it may negotiate, whether it may ring, who it
// may connect, whether an app may auto-claim own-device sessions, and a context schema (the intents §4.2–§4.3 data
// schema and disclosure rules, reused here through validateIntentKind/validateIntentData).
//
// Registration follows the intent-kind pattern (packages/intents/registered.mjs, packages/runtime/artefact-pins.mjs):
// reviewed envelopes under docs/artefacts/rtc-purposes/, operator-registered as local artefact documents, body
// validation wired into configuredArtefacts' validateBody, and digests pinned by tests. As for the `relation` kind
// (packages/orgs/relation-documents.mjs), `rtc-purpose` is NOT added to DEFAULT_KINDS: spec §3.5 item 3 says that until
// the kind and its growth table are registered and signed, additivity is unverifiable (artefacts §6.4), so a provider
// uses exactly the versions it holds pinned references for and never advances a head. The growth table is implemented
// here (PURPOSE_KINDS, purposeAdditive) so registration later is one row.
import {jcs,plain,textEncoder} from '../core/strict-json.mjs';
import {artefactURL,validateAdditive,parseReference} from '../core/artefacts.mjs';
import {validateIntentKind,validateIntentData} from '../intents/schema.mjs';
import callPurpose from '../../docs/artefacts/rtc-purposes/call-v1.json' with {type:'json'};
import screenSharePurpose from '../../docs/artefacts/rtc-purposes/screen-share-v1.json' with {type:'json'};
import fileTransferPurpose from '../../docs/artefacts/rtc-purposes/file-transfer-v1.json' with {type:'json'};
import deviceSyncPurpose from '../../docs/artefacts/rtc-purposes/device-sync-v1.json' with {type:'json'};
import {RTC_MEDIA,mediaValid} from './messages.mjs';

export const RTC_PURPOSE_KIND='rtc-purpose';
export const PURPOSE_CATEGORIES=Object.freeze(['identity','location','money','personal-data','public','send-as-you']);
export const PURPOSE_LIMITS=Object.freeze({contextProperties:8,contextBytes:2048});
export class PurposeFault extends Error {constructor(code='rtc_purpose_invalid'){super(code);this.name='PurposeFault';this.code=code;}}
const fail=(code='rtc_purpose_invalid')=>{throw new PurposeFault(code);};
const MEMBERS=['id','title','summary','publisher','media','alert','parties','auto_accept','context','categories'];
const exact=(v,required,optional=[])=>plain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const line=v=>{try{return artefactURL(v)===v&&!v.includes('?');}catch{return false;}};
const EMPTY_DATA=Object.freeze({type:'object',properties:{},required:[]}),EMPTY_DISCLOSURE=Object.freeze({categories:[],fields:{}});
/** The purpose's context as an intent-kind body, so the intents §4.2–§4.3 validators apply unchanged. */
const contextKind=(b,context=b.context)=>({id:b.id,title:b.title,summary:b.summary,publisher:b.publisher,effect:'view',capability:false,data:context?.data??EMPTY_DATA,disclosure:context?.disclosure??EMPTY_DISCLOSURE});

/** Throws PurposeFault unless `body` is exactly a valid rtc-purpose body (spec §3.4). Returns a detached copy. */
export function validatePurpose(body){
 let b;try{b=JSON.parse(jcs(body,{maxDepth:16}));}catch{fail();}
 if(!exact(b,MEMBERS,['supersedes'])||b.supersedes!==undefined&&!line(b.supersedes))fail();
 if(!line(b.id)||typeof b.publisher!=='string'||new URL(b.id).origin!==b.publisher)fail();
 if(!mediaValid(b.media)||typeof b.alert!=='boolean'||!['self','other','any'].includes(b.parties)||!['never','self'].includes(b.auto_accept))fail();
 if(b.alert===false&&b.parties!=='self'||b.auto_accept==='self'&&b.parties!=='self')fail();
 if(!Array.isArray(b.categories)||b.categories.length>PURPOSE_CATEGORIES.length||!b.categories.every((c,i)=>PURPOSE_CATEGORIES.includes(c)&&(i===0||b.categories[i-1]<c)))fail();
 if(b.context!==null){
  if(!exact(b.context,['data','disclosure'])||!plain(b.context.data?.properties)||Object.keys(b.context.data.properties).length>PURPOSE_LIMITS.contextProperties||textEncoder.encode(jcs(b.context)).length>PURPOSE_LIMITS.contextBytes)fail();
  if(Object.values(b.context.data.properties).some(p=>p?.format==='contact-link'))fail();
 }
 // id, title, summary, publisher, and the context data schema and disclosure, by the intents validator.
 try{validateIntentKind(contextKind(b));}catch{fail();}
 return b;
}

// ---- growth table (artefacts §6.3 row proposed by AMD-R4) -------------------------------------------------------
const languageTag=v=>{try{return typeof v==='string'&&(/^x(?:-[a-z0-9]{1,8})+$/i.test(v)||Intl.getCanonicalLocales(v).length===1);}catch{return false;}};
const at=(v,path)=>path.reduce((x,k)=>x&&Object.hasOwn(x,k)?x[k]:undefined,v);
const translation=c=>languageTag(c.key)&&!Object.keys(c.parent).some(k=>k.toLowerCase()===c.key.toLowerCase());
const PURPOSE_RULES=Object.freeze([
 ...['/title','/summary','/context/disclosure/fields/*/title'].map(pattern=>Object.freeze({pattern,operation:'add-member',allow:translation})),
 Object.freeze({pattern:'/context/data/properties',operation:'add-member',allow:c=>!at(c.next,['context','data','required']).includes(c.key)&&!Object.hasOwn(at(c.old,['context','disclosure','fields']),c.key)&&Object.hasOwn(at(c.next,['context','disclosure','fields']),c.key)}),
 Object.freeze({pattern:'/context/disclosure/fields',operation:'add-member',allow:c=>!Object.hasOwn(at(c.old,['context','data','properties']),c.key)&&Object.hasOwn(at(c.next,['context','data','properties']),c.key)})
]);
/** The reviewed kind table for validateAdditive. Not part of DEFAULT_KINDS until the growth table is signed. */
export const PURPOSE_KINDS=Object.freeze({[RTC_PURPOSE_KIND]:Object.freeze({rules:PURPOSE_RULES,validate:body=>{try{validatePurpose(body);return true;}catch{return false;}}})});
/** {known, additive, changes} for one step old → next of an rtc-purpose line, under the proposed growth table. */
export const purposeAdditive=(old,next)=>validateAdditive(RTC_PURPOSE_KIND,old,next,{kinds:PURPOSE_KINDS});
/** An additive step that adds `context` properties adds disclosure: a widening that needs new approval (spec §3.5). */
export function purposeWidens(old,next){const before=Object.keys(old.context?.data?.properties??{});return Object.keys(next.context?.data?.properties??{}).some(k=>!before.includes(k));}

// ---- sessions of a purpose (spec §4.1, §6.2, §15) ----------------------------------------------------------------
/** Whether `media` (nonempty, ascending) is within the purpose's `media`. */
export const mediaWithin=(media,body)=>mediaValid(media)&&media.every(m=>body.media.includes(m));
/** Whether the purpose's `parties` admits an own-entity (`self`) or cross-entity session. */
export const partiesAdmit=(body,{ownEntity})=>body.parties==='any'||(body.parties==='self')===(ownEntity===true);
/** Validates an invite `context` against the purpose's context schema (`null` is always allowed). */
export function validateContext(body,context){
 if(context===null)return null;if(body.context===null)fail('rtc_context_invalid');
 try{return validateIntentData(contextKind(body),context);}catch{fail('rtc_context_invalid');}
}
/** Spec §4.1/§6.2 invite checks against a validated purpose body: media subset, parties, context. */
export function validateInviteForPurpose(invite,body,{ownEntity}){
 if(!mediaWithin(invite.media,body))fail('rtc_media_not_permitted');
 if(!partiesAdmit(body,{ownEntity}))fail('rtc_parties_not_permitted');
 validateContext(body,invite.context);return true;
}
/** Projects a context valid under version N+k to an older approved version N (spec §15): members N does not name are
 * dropped. The caller has verified that N → N+k is additive; the raw invite is still delivered unchanged. */
export function projectContext(context,fromBody,toBody){
 if(context===null)return null;validateContext(fromBody,context);
 const names=Object.keys(toBody.context?.data?.properties??{}),projected=Object.fromEntries(Object.entries(context).filter(([k])=>names.includes(k)));
 return toBody.context===null?null:validateContext(toBody,projected);
}
/** Plain-text consent facts for one purpose (design §7): title attributed to the host of `id`, media, ringing, parties. */
export function purposeDisclosure(body,locale='en'){
 const b=validatePurpose(body),pick=map=>map[Object.keys(map).find(k=>k.toLowerCase()===String(locale).toLowerCase())??'en'];
 return {id:b.id,host:new URL(b.id).host,title:pick(b.title),summary:pick(b.summary),media:[...b.media],alert:b.alert,parties:b.parties,autoAccept:b.auto_accept,categories:[...b.categories],context:Object.keys(b.context?.data?.properties??{})};
}

// ---- reviewed candidate lines (spec §3.4) ------------------------------------------------------------------------
/** Reviewed v1 snapshots; these match docs/artefacts/rtc-purposes and are pinned by tests/rtc-purposes.test.mjs. */
export const REGISTERED_PURPOSES=Object.freeze([callPurpose,screenSharePurpose,fileTransferPurpose,deviceSyncPurpose]);
export const RTC_PURPOSE_REFERENCES=Object.freeze([
 Object.freeze({artefact:'https://spec.bindle.example/rtc-purposes/call/v1',version:1,digest:'sha256-nw4HaBA0_-dPEBWIhs8RmcHOtL75DYzGCh0j6bASy_k'}),
 Object.freeze({artefact:'https://spec.bindle.example/rtc-purposes/screen-share/v1',version:1,digest:'sha256-JTAiD2UCFMjdEdwcQD-LuBOFXOrLjySBEMQmB0g9BcI'}),
 Object.freeze({artefact:'https://spec.bindle.example/rtc-purposes/file-transfer/v1',version:1,digest:'sha256-j2LbKD9mtkyZSeuGw0LO5RSL2EvwgeztkJ9h6HcEG8A'}),
 Object.freeze({artefact:'https://spec.bindle.example/rtc-purposes/device-sync/v1',version:1,digest:'sha256-_qWQDhbRDDMj84QbO4kI061KfOBqdQxIM4MwJhN_R9w'})
]);
/** The provider-held reference for a purpose line, or null (an unregistered line is never resolved by URL). */
export const registeredPurpose=line=>RTC_PURPOSE_REFERENCES.find(r=>r.artefact===line)??null;
/** A purpose reference {purpose, version, digest} in artefacts §5 form, with kind `rtc-purpose`. */
export function purposeReference(value){const ref=parseReference(value,{urlMember:'purpose',kind:RTC_PURPOSE_KIND});if(!ref.version||ref.legacy)fail('rtc_purpose_invalid');return {purpose:ref.id,version:ref.version,digest:ref.digest};}
export {RTC_MEDIA};
