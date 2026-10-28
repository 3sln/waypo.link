// Bindle item-classification/v1 (docs/spec/extensions/item-classification.md; draft, provisional, unsigned). Shared,
// pure validation for both sides of the contract and the fragment's selection rules for applications:
//  - classifier side: classify/capabilities argument validation (§3), the capability check that yields
//    `unsupported_item` (§4), the post-effect rule (§6) and the presigned-URL rules a fetch must follow (§5; the fetch
//    itself is ./item-classification-fetch.mjs);
//  - application side: the detail ceiling (§8.2), capability and result validation, per-kind selection with the
//    fallback field and the failover rule (§8.3).
// Nothing here performs I/O, keeps state or knows any provider. Inline item bytes are accepted as a base64url string
// (JSON transport) or a Uint8Array (the planned CBOR transport), with one bound.

export const ITEM_CLASSIFICATION_CONTRACT='https://spec.bindle.example/contracts/item-classification/v1';
export const ITEM_CLASSIFICATION_FRAGMENT='https://spec.bindle.example/fragments/item-classification/v1';
/** Item kinds of v1 (§2.1). `other` has no field of its own: it is served by the fallback field only. */
export const ITEM_KINDS=Object.freeze(['text','image','audio','video','document','other']);
/** Detail levels, smallest first (§2.3). Each level includes everything the levels before it allow. */
export const DETAIL_LEVELS=Object.freeze(['minimal','standard','full']);
/** Tag members each level allows (§2.3). `kind`, `mediaType` and `size` are not tags: every call carries them. */
export const DETAIL_TAGS=Object.freeze({minimal:Object.freeze([]),standard:Object.freeze(['language']),full:Object.freeze(['language','source','origin','context'])});
export const INPUT_FORMS=Object.freeze(['inline','url']);
/** Registered `tags.source` values (§2.4); a classifier reads any other well-formed token as `other`. */
export const SOURCES=Object.freeze(['email','message','upload','web','feed','capture','other']);
/** Fragment field names (§8.1): one classifier field per kind except `other`, the fallback, and a detail field each. */
export const KIND_FIELDS=Object.freeze(['text','image','audio','video','document']);
export const FALLBACK_FIELD='fallback';
export const detailField=field=>`${field}Detail`;
export const LIMITS=Object.freeze({
 inlineBytes:262144,          // decoded bytes of an inline item
 urlBytes:104857600,          // declared size of a presigned-URL item
 urlLength:4096,
 urlLifetimeMs:3600000,       // expiresAt at most one hour after the call
 fetchTimeoutMs:30000,        // a classifier's whole fetch, including retries of the same GET
 labels:16,descriptionCodePoints:200,
 contextTags:16,
 capabilityKinds:16,mediaTypes:32,
 modelId:100,modelVersion:64,
});
/** Codes after which an application may try the next candidate (extensions §3.3 plus `unsupported_item`, §8.3). */
export const FAILOVER_CODES=Object.freeze(['unsupported_item','unsupported_contract','unsupported_method','forbidden','not_found','rate_limited','temporarily_unavailable']);
/** Codes that claim no effect occurred (protocol §5 AMD-C4 plus the contract's own refusals, §6). */
export const NO_EFFECT_CODES=Object.freeze(['invalid_args','unsupported_item','unsupported_contract','unsupported_method','forbidden','not_found','rate_limited','temporarily_unavailable']);

const TOKEN=/^[a-z0-9][a-z0-9._-]{0,63}$/,CONTEXT=/^[a-z0-9][a-z0-9._:-]{0,63}$/,SOURCE=/^[a-z][a-z0-9-]{0,31}$/;
const RESTRICTED='[a-z0-9][a-z0-9!#$&^_.+-]{0,62}';
const MEDIA_TYPE=new RegExp(`^${RESTRICTED}/${RESTRICTED}$`),MEDIA_RANGE=new RegExp(`^(?:\\*/\\*|${RESTRICTED}/\\*|${RESTRICTED}/${RESTRICTED})$`);
const LANGUAGE=/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,7}$/;
const HOST=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BASE64URL=/^[A-Za-z0-9_-]*$/;
// C0, DEL, C1, line/paragraph separators and bidirectional controls: a label description is one plain line.
const CONTROL=/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const only=(v,keys)=>plain(v)&&Object.keys(v).every(k=>keys.includes(k));
const codePoints=s=>{let n=0;for(const _ of s)n++;return n;};
const safeInt=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
/** A coded error: `code` is a contract error code, `message` safe for display. */
export const classificationError=(code,message)=>Object.assign(new Error(message),{code});
const invalid=message=>{throw classificationError('invalid_args',message);};

/** Decodes unpadded base64url (null when malformed). */
export function decodeBase64url(data){
 if(typeof data!=='string'||!BASE64URL.test(data)||data.length%4===1)return null;
 try{const binary=atob(data.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-data.length%4)%4));const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}catch{return null;}
}
export function encodeBase64url(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
const utf8=new TextDecoder('utf-8',{fatal:true});
const wellFormedUTF8=bytes=>{try{utf8.decode(bytes);return true;}catch{return false;}};
/** The canonical media-type essence of `type` (lowercase, no parameters), or null. */
export function mediaEssence(type){if(typeof type!=='string')return null;const essence=type.split(';')[0].trim().toLowerCase();return MEDIA_TYPE.test(essence)?essence:null;}
const ipLiteral=host=>host.startsWith('[')||/^[0-9.]+$/.test(host)||/^0x/i.test(host);

/**
 * Presigned-URL rules checked from the arguments alone (§5.1): absolute `https:` with no userinfo, fragment or port
 * other than 443, a DNS host name (no IP literal, no single-label or `localhost`/`.local`/`.internal` name),
 * canonical serialization, and an expiry in the future and at most one hour away. Returns the parsed URL.
 */
export function presignedURL(url,{now}){
 if(!only(url,['href','expiresAt'])||typeof url.href!=='string'||url.href.length>LIMITS.urlLength)invalid('A presigned URL needs href and expiresAt.');
 let parsed;try{parsed=new URL(url.href);}catch{invalid('The presigned URL is malformed.');}
 if(parsed.protocol!=='https:')invalid('A presigned URL must use https.');
 if(parsed.username||parsed.password||parsed.hash||url.href.includes('#')||parsed.port!=='')invalid('A presigned URL carries no credentials, fragment or port.');
 const host=parsed.hostname;
 if(ipLiteral(host)||!HOST.test(host)||host==='localhost'||/\.(?:localhost|local|internal|home\.arpa)$/.test(host))invalid('A presigned URL needs a public DNS host name.');
 if(parsed.href!==url.href)invalid('The presigned URL is not in canonical form.');
 if(!Number.isSafeInteger(url.expiresAt))invalid('A presigned URL needs an integer expiry.');
 if(url.expiresAt<=now)invalid('The presigned URL has expired.');
 if(url.expiresAt>now+LIMITS.urlLifetimeMs)invalid('A presigned URL may be valid for at most one hour.');
 return parsed;
}

function validateTags(tags,detail){
 if(tags===undefined)return {};
 if(!only(tags,['language','source','origin','context']))invalid('Tags hold only language, source, origin and context.');
 const allowed=DETAIL_TAGS[detail];
 for(const key of Object.keys(tags))if(!allowed.includes(key))invalid(`The ${key} tag is beyond the ${detail} detail level.`);
 if(tags.language!==undefined&&(typeof tags.language!=='string'||tags.language.length>35||!LANGUAGE.test(tags.language)))invalid('Use a BCP 47 language tag.');
 if(tags.source!==undefined&&(typeof tags.source!=='string'||!SOURCE.test(tags.source)))invalid('Use a lowercase source token.');
 if(tags.origin!==undefined&&(typeof tags.origin!=='string'||!HOST.test(tags.origin)))invalid('Origin is a lowercase host name.');
 if(tags.context!==undefined&&(!Array.isArray(tags.context)||tags.context.length<1||tags.context.length>LIMITS.contextTags||tags.context.some(t=>typeof t!=='string'||!CONTEXT.test(t))||new Set(tags.context).size!==tags.context.length))invalid('Use 1 to 16 distinct lowercase context tokens.');
 return {...tags.language!==undefined?{language:tags.language}:{},...tags.source!==undefined?{source:tags.source}:{},...tags.origin!==undefined?{origin:tags.origin}:{},...tags.context!==undefined?{context:[...tags.context]}:{}};
}
/** Labels (§3.4): 1–16 objects {id, description}, distinct ids, descriptions 1–200 code points on one plain line. */
export function validateLabels(labels){
 if(!Array.isArray(labels)||labels.length<1||labels.length>LIMITS.labels)invalid('Use 1 to 16 labels.');
 for(const label of labels)if(!only(label,['id','description'])||typeof label.id!=='string'||!TOKEN.test(label.id)||typeof label.description!=='string'||!label.description.isWellFormed()||codePoints(label.description)<1||codePoints(label.description)>LIMITS.descriptionCodePoints||CONTROL.test(label.description)||!label.description.trim())invalid('Each label needs a lowercase id and a one-line description of at most 200 characters.');
 if(new Set(labels.map(l=>l.id)).size!==labels.length)invalid('Label ids must be distinct.');
 return labels.map(({id,description})=>({id,description}));
}
/**
 * Complete, deterministic validation of `classify` arguments (§3), run by a classifier before any effect. Throws
 * `invalid_args`; returns a fresh copy holding only validated members, with the inline item decoded to `bytes`.
 * The capability check (`unsupported_item`) is separate: checkCapabilities.
 */
export function validateClassifyArgs(args,{now}){
 if(!Number.isSafeInteger(now))throw new TypeError('validateClassifyArgs needs the current time');
 if(!only(args,['detail','item','tags','labels']))invalid('Use detail, item, optional tags and labels.');
 if(!DETAIL_LEVELS.includes(args.detail))invalid('Use the minimal, standard or full detail level.');
 const {item}=args;
 if(!only(item,['kind','mediaType','size','data','url'])||(item.data===undefined)===(item.url===undefined))invalid('An item has a kind, a media type, a size and exactly one of data and url.');
 if(!ITEM_KINDS.includes(item.kind))invalid('Unknown item kind.');
 if(typeof item.mediaType!=='string'||!MEDIA_TYPE.test(item.mediaType))invalid('Use a lowercase media type without parameters.');
 const out={detail:args.detail,item:{kind:item.kind,mediaType:item.mediaType,size:item.size},tags:validateTags(args.tags,args.detail),labels:validateLabels(args.labels)};
 if(item.data!==undefined){
  if(!safeInt(item.size,0,LIMITS.inlineBytes))invalid('An inline item is at most 256 KiB.');
  // `data` is abstract bytes (§3): a base64url string on today's JSON transport, a native byte string (Uint8Array)
  // under the planned CBOR transport. Both are accepted here, with the same bound, so that switch is mechanical.
  const bytes=item.data instanceof Uint8Array?item.data.slice():decodeBase64url(item.data);if(!bytes||bytes.length!==item.size)invalid('Inline data must be exactly size bytes (unpadded base64url on the JSON transport).');
  if(item.mediaType.startsWith('text/')&&!wellFormedUTF8(bytes))invalid('Text items are UTF-8.');
  out.item.data=item.data instanceof Uint8Array?bytes.slice():item.data;Object.defineProperty(out,'bytes',{value:bytes,enumerable:false});
 }else{
  if(!safeInt(item.size,1,LIMITS.urlBytes))invalid('A presigned-URL item declares a size of at most 100 MiB.');
  presignedURL(item.url,{now});out.item.url={href:item.url.href,expiresAt:item.url.expiresAt};
 }
 return out;
}
/** `capabilities` takes exactly `{}` (§4.1). */
export function validateCapabilitiesArgs(args){if(!only(args,[])||Object.keys(args).length)invalid('capabilities takes no arguments.');return {};}

/**
 * Validates a capabilities result (§4.2) for a reader: unknown members, kinds and input forms are ignored (the result
 * is open); a malformed known member makes the whole result unusable (null). Kinds are distinct.
 */
export function validateCapabilities(value){
 if(!plain(value)||!Array.isArray(value.kinds)||value.kinds.length>LIMITS.capabilityKinds||!safeInt(value.maxLabels,1,LIMITS.labels))return null;
 const kinds=[];
 for(const entry of value.kinds){
  if(!plain(entry)||typeof entry.kind!=='string'||!Array.isArray(entry.mediaTypes)||entry.mediaTypes.length<1||entry.mediaTypes.length>LIMITS.mediaTypes||entry.mediaTypes.some(t=>typeof t!=='string'||!MEDIA_RANGE.test(t))||!Array.isArray(entry.inputs)||entry.inputs.length<1||entry.inputs.length>8||entry.inputs.some(i=>typeof i!=='string')||!safeInt(entry.maxBytes,1,LIMITS.urlBytes))return null;
  if(kinds.some(k=>k.kind===entry.kind)||value.kinds.filter(k=>k?.kind===entry.kind).length>1)return null;
  if(!ITEM_KINDS.includes(entry.kind))continue;
  const inputs=entry.inputs.filter(i=>INPUT_FORMS.includes(i));if(!inputs.length)continue;
  kinds.push({kind:entry.kind,mediaTypes:[...new Set(entry.mediaTypes)],inputs:[...new Set(inputs)],maxBytes:entry.maxBytes});
 }
 const model=value.model===undefined?undefined:plain(value.model)&&typeof value.model.id==='string'&&value.model.id.length>=1&&codePoints(value.model.id)<=LIMITS.modelId&&typeof value.model.version==='string'&&value.model.version.length>=1&&codePoints(value.model.version)<=LIMITS.modelVersion?{id:value.model.id,version:value.model.version}:null;
 if(model===null)return null;
 return {kinds,maxLabels:value.maxLabels,...model?{model}:{}};
}
const matches=(range,type)=>range==='*/*'||range===type||range.endsWith('/*')&&type.startsWith(range.slice(0,-1));
/**
 * Whether validated `classify` arguments fall inside `capabilities` (validated). Returns null when they do, else the
 * reason: 'kind', 'media_type', 'input', 'size' or 'labels'. A classifier refuses with `unsupported_item` for any
 * reason (§4.3); an application skips the candidate without dispatching (§8.3).
 */
export function checkCapabilities(args,capabilities){
 const entry=capabilities?.kinds?.find(k=>k.kind===args.item.kind);if(!entry)return 'kind';
 if(!entry.mediaTypes.some(range=>matches(range,args.item.mediaType)))return 'media_type';
 const form=args.item.url!==undefined?'url':'inline';if(!entry.inputs.includes(form))return 'input';
 if(args.item.size>Math.min(entry.maxBytes,form==='inline'?LIMITS.inlineBytes:LIMITS.urlBytes))return 'size';
 if(args.labels.length>capabilities.maxLabels)return 'labels';
 return null;
}
/** Classifier side: refuse arguments outside the advertised capabilities, before any effect (§4.3). */
export function refuseUnsupported(args,capabilities){if(checkCapabilities(args,capabilities)!==null)throw classificationError('unsupported_item','This classifier cannot classify this kind of item.');}

/** A result (§7) that scores exactly `labels`, each in [0, 1], with bounded model evidence; otherwise null. */
export function validateClassifyResult(value,labels){
 const ids=labels.map(l=>l.id);
 if(!plain(value)||!plain(value.scores)||!plain(value.model))return null;
 const {id,version}=value.model;
 if(typeof id!=='string'||!id.length||codePoints(id)>LIMITS.modelId||typeof version!=='string'||!version.length||codePoints(version)>LIMITS.modelVersion)return null;
 const keys=Object.keys(value.scores);
 if(keys.length!==ids.length||keys.some(k=>!ids.includes(k))||Object.values(value.scores).some(p=>typeof p!=='number'||!Number.isFinite(p)||p<0||p>1))return null;
 return {scores:Object.fromEntries(ids.map(k=>[k,value.scores[k]])),model:{id,version}};
}

/**
 * Post-effect rule (§6): once a classifier has had any effect (fetch, model call, charge), a refusal it raises must not
 * claim no effect. Wraps the post-effect part of an implementation and turns a no-effect code into `indeterminate`.
 */
export async function afterEffect(fn){try{return await fn();}catch(error){if(NO_EFFECT_CODES.includes(error?.code))throw classificationError('indeterminate','The classification outcome is unknown.');throw error;}}

// ---- Application side -------------------------------------------------------------------------------------------

/** The detail level of `value` (an approved detail field value); anything else, including absence, is `minimal`. */
export const detailLevel=value=>DETAIL_LEVELS.includes(value)?value:'minimal';
/**
 * Builds `classify` arguments under the owner's detail ceiling (§8.2): tags beyond `detail` are dropped, never sent.
 * `item` is {kind, mediaType, bytes} (inline) or {kind, mediaType, size, url: {href, expiresAt}}. `encoding` is how
 * inline bytes travel: 'base64url' for the JSON transport (default) or 'bytes' for a transport with native byte strings.
 * The result still goes through validateClassifyArgs, so a caller cannot send what a classifier would refuse.
 */
export function buildClassifyArgs({detail,item,tags={},labels},{now,encoding='base64url'}){
 const level=detailLevel(detail),allowed=DETAIL_TAGS[level],kept={};
 for(const key of allowed)if(tags?.[key]!==undefined&&!(key==='context'&&Array.isArray(tags.context)&&!tags.context.length))kept[key]=key==='context'?[...tags.context]:tags[key];
 const base={kind:item.kind,mediaType:item.mediaType};
 const built={detail:level,item:item.bytes!==undefined?{...base,size:item.bytes.length,data:encoding==='bytes'?item.bytes.slice():encodeBase64url(item.bytes)}:{...base,size:item.size,url:{href:item.url?.href,expiresAt:item.url?.expiresAt}},...Object.keys(kept).length?{tags:kept}:{},labels:labels.map(({id,description})=>({id,description}))};
 validateClassifyArgs(built,{now});return built;
}
const resourceOf=value=>{const first=Array.isArray(value)?value[0]:value;const id=plain(first)?first.resource:first;return typeof id==='string'&&id?id:null;};
/**
 * Candidates for an item of `kind` (§8.3), from the application's approved values of the fragment (its preferences
 * projection, read once per operation): the kind's own field (none for `other`), then `fallback` when it holds a
 * different resource. Each candidate carries the detail level of its own field.
 */
export function classifierCandidates(values,kind){
 if(!ITEM_KINDS.includes(kind))throw new TypeError('Unknown item kind');
 const out=[];
 for(const field of [...KIND_FIELDS.includes(kind)?[kind]:[],FALLBACK_FIELD]){const resource=resourceOf(values?.[field]);if(resource&&!out.some(c=>c.resource===resource))out.push({field,resource,detail:detailLevel(values?.[detailField(field)])});}
 return out;
}
/**
 * One classification over the fragment (§8.3). `port`: {capabilities(resource) -> result, classify(resource, args) ->
 * result}, each throwing errors with a contract `code`; the port uses a fresh `tx` per call. Candidates are tried in
 * order: a candidate whose capabilities cannot be read or do not cover the item is skipped without dispatch; labels
 * beyond its maxLabels are split across calls to it; after `unsupported_item` or another failover code (before any part
 * succeeded) the next candidate is tried; any other outcome stops (never a second disclosure after an ambiguous one or
 * after a part succeeded). Returns
 *  {status:'scored', result, field, resource, detail} or
 *  {status:'unscored', reason, kind, mediaType} with reason 'no_classifier' | 'unsupported' | 'unavailable' |
 *  'item_unavailable' | 'unknown_outcome' | 'invalid_result'.
 * 'no_classifier' and 'unsupported' are gaps the application surfaces to the owner (§8.4).
 */
export async function classifyWithFallback(port,{values,item,tags,labels,now}){
 const candidates=classifierCandidates(values,item.kind),miss={kind:item.kind,mediaType:item.mediaType};
 if(!candidates.length)return {status:'unscored',reason:'no_classifier',...miss};
 let unsupported=0;
 for(const candidate of candidates){
  let capabilities;try{capabilities=validateCapabilities(await port.capabilities(candidate.resource));}catch{capabilities=null;}
  if(!capabilities)continue;
  // More labels than the candidate takes: split them into calls of at most maxLabels to the same candidate.
  const chunks=[];for(let i=0;i<labels.length;i+=capabilities.maxLabels)chunks.push(labels.slice(i,i+capabilities.maxLabels));
  const calls=chunks.map(chunk=>buildClassifyArgs({detail:candidate.detail,item,tags,labels:chunk},{now}));
  if(calls.some(args=>checkCapabilities(args,capabilities)!==null)){unsupported++;continue;}
  const results=[];let next=false;
  for(const args of calls){
   let value;
   try{value=await port.classify(candidate.resource,args);}
   catch(error){
    // Before anything reached this candidate, a no-effect refusal moves on; after a part succeeded it stops, because
    // moving on would disclose the item to a second classifier.
    if(!results.length&&error?.code==='unsupported_item'){unsupported++;next=true;break;}
    if(!results.length&&FAILOVER_CODES.includes(error?.code)){next=true;break;}
    if(results.length&&FAILOVER_CODES.includes(error?.code))return {status:'unscored',reason:'unavailable',...miss};
    return {status:'unscored',reason:error?.code==='item_unavailable'?'item_unavailable':'unknown_outcome',...miss};
   }
   const result=validateClassifyResult(value,args.labels);
   if(!result||results.length&&(result.model.id!==results[0].model.id||result.model.version!==results[0].model.version))return {status:'unscored',reason:'invalid_result',...miss};
   results.push(result);
  }
  if(next)continue;
  const result={scores:Object.fromEntries(labels.map(l=>[l.id,results.find(r=>Object.hasOwn(r.scores,l.id)).scores[l.id]])),model:results[0].model};
  return {status:'scored',result,field:candidate.field,resource:candidate.resource,detail:candidate.detail,calls:results.length};
 }
 return {status:'unscored',reason:unsupported===candidates.length?'unsupported':'unavailable',...miss};
}
