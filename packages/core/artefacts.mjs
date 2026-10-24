// Artefacts rev 2. Pure value operations: no fetch, storage, flags or implicit head advancement.
// Raw documents enter through strictJSON; object inputs must still pass the refusing serializer.
import {strictJSON,jcs,plain,scalarString,textEncoder} from './strict-json.mjs';
import {canonical} from './primitives.mjs';
import {validateIntentKind} from '../intents/schema.mjs';

export const ARTEFACT_LIMITS=Object.freeze({envelopeBytes:262144,bodyBytes:65536,bodyDepth:32,bodyMembers:4096,versions:1024});
export const DIGEST_PATTERN=/^sha256-[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const TYPE='bindle.artefact-version.v1',controls=/[\p{Cc}\p{Bidi_Control}\u2028\u2029\u200b\ufeff]/u;
export class ArtefactFault extends Error {constructor(code='artefact_invalid'){super(code);this.name='ArtefactFault';this.code=code;}}
const fail=(code)=>{throw new ArtefactFault(code);};
const exact=(v,required,optional=[])=>plain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const positive=n=>Number.isSafeInteger(n)&&n>0;
const copy=v=>strictJSON(jcs(v,{maxDepth:36}),{maxDepth:36});
const source=v=>typeof v==='string'||v instanceof Uint8Array?strictJSON(v,{maxDepth:36}):copy(v);
const guarded=fn=>{try{return fn();}catch(e){if(e instanceof ArtefactFault)throw e;fail();}};
export function artefactURL(value){
 if(typeof value!=='string'||value.length>256||!scalarString(value)||/[?#\s]/u.test(value))fail();
 let u;try{u=new URL(value);}catch{fail();}if(u.protocol!=='https:'||u.username||u.password||u.href!==value&&u.origin!==value)fail();return value;
}
export const versionURL=(id,version)=>{artefactURL(id);if(!positive(version))fail();return `${id}/versions/${version}`;};
const digestValue=v=>{if(typeof v!=='string')fail();if(!v.startsWith('sha256-'))fail(/^[a-z][a-z0-9]*-/.test(v)?'artefact_unverifiable':'artefact_invalid');if(!DIGEST_PATTERN.test(v))fail();return v;};
const base64url=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
const hash=async(value,crypto)=>`sha256-${base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',textEncoder.encode(value))))}`;
export const digestJSON=(value,{crypto=globalThis.crypto}={})=>hash(jcs(value,{maxDepth:36}),crypto);

// Envelope-level checks only. A malformed entry invalidates its suffix, not an earlier valid version.
export function parseEnvelope(input,{id}={}){return guarded(()=>{
 const e=source(input);if(!plain(e)||e.bindle_artefact!==1)fail();artefactURL(e.id);
 if(id!==undefined&&e.id!==id||typeof e.kind!=='string'||!e.kind.length||!Array.isArray(e.versions)||!e.versions.length||e.versions.length>1024)fail();
 if(e.notices!==undefined&&(!Array.isArray(e.notices)||e.notices.length>8||e.notices.filter(n=>n?.type==='deprecated').length>7||e.notices.filter(n=>n?.type==='retracted').length>1))fail();
 if(e.signatures!==undefined&&(!Array.isArray(e.signatures)||e.signatures.length>64))fail();return e;
});}
function bodyValue(body,kind){
 if(!plain(body))fail();const encoded=guarded(()=>jcs(body,{maxDepth:32,maxMembers:4096}));
 if(textEncoder.encode(encoded).byteLength>(kind==='slot'?16384:65536))fail();
 const display=v=>{if(typeof v==='string')return !controls.test(v);if(plain(v))return Object.values(v).every(display);return false;};
 const maps=['properties','patternProperties','dependentSchemas','$defs','definitions','fields','x-methods','occupant','consumer'];
 const visit=(v,names=false)=>{if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){if(!names&&['title','description','summary'].includes(k)&&!display(x))fail();visit(x,!names&&maps.includes(k));}};visit(body);return body;
}
export function versionRecord(line,entry){return guarded(()=>{
 if(!exact(entry,['version','prev','body'])||!positive(entry.version)||entry.version>1024)fail();artefactURL(line.id);
 if(typeof line.kind!=='string'||!line.kind.length||entry.version===1&&entry.prev!==null||entry.version>1&&!DIGEST_PATTERN.test(entry.prev))fail();
 bodyValue(entry.body,line.kind);return copy({t:TYPE,id:line.id,kind:line.kind,version:entry.version,prev:entry.prev,body:entry.body});
});}
export function parseVersionRecord(input){return guarded(()=>{
 const r=source(input);if(!exact(r,['t','id','kind','version','prev','body'])||r.t!==TYPE)fail();return versionRecord(r,{version:r.version,prev:r.prev,body:r.body});
});}
export const versionDigest=(record,options)=>digestJSON(parseVersionRecord(record),options);
export function parseReference(input,{urlMember='artefact',kind}={}){return guarded(()=>{
 if(!plain(input))fail();const id=artefactURL(input[urlMember]),hasVersion=Object.hasOwn(input,'version'),hasDigest=Object.hasOwn(input,'digest');
 if(hasVersion&&(!positive(input.version)||!hasDigest))fail();
 let digest=input.digest;if(hasDigest){if(!hasVersion&&typeof digest==='string'&&digest.length===43)digest=`sha256-${digest}`;digestValue(digest);}
 const implied={fragment:'fragment',slot:'slot',manifest:'bus',contract:'rpc-contract'};
 return {id,...(kind||Object.hasOwn(implied,urlMember)?{kind:kind??implied[urlMember]}:{}),...(hasVersion?{version:input.version}:{}),...(hasDigest?{digest}:{}),legacy:hasDigest&&!hasVersion,latest:!hasDigest&&!hasVersion};
});}

// `records` is a Map keyed by per-version URL (or digest), containing received record bytes/values.
// No resolver callback: obtaining missing records is the ART-3 provider's responsibility.
// storedDigests is the already accepted prefix; checking it detects truncation and history rewrites.
// These checks establish the envelope/profile and cryptographic chain. The provider supplies the kind's
// existing domain validator as validateBody; this core does not import federation's server-only validators.
function sameDetachedRecord(envelope,records,i,digest,authenticated){
 const next=envelope.versions[i+1];if(!next||next.version!==i+2||next.prev!==digest||!authenticated)return false;
 const received=records.get(versionURL(envelope.id,i+1))??records.get(next.prev);if(received===undefined)return false;
 try{return jcs(parseVersionRecord(received),{maxDepth:36})===jcs(parseVersionRecord(authenticated),{maxDepth:36});}catch{return false;}
}
export async function extractVersion(input,version,{id,kind,records=new Map(),storedDigests=[],authenticatedPrefix,crypto=globalThis.crypto,validateBody}={}){
 const envelope=parseEnvelope(input,{id});if(!positive(version))fail();if(kind!==undefined&&kind!==envelope.kind)fail();
 if(envelope.versions.length<storedDigests.length)fail('artefact_history_rewritten');
 if(version>envelope.versions.length)fail('artefact_unavailable');const digests=[],verified=[];
 for(let i=0;i<Math.max(version,storedDigests.length);i++){
  try{
  const e=envelope.versions[i];
  // A provider may reuse its detached, previously authenticated copy. Compare complete entries,
  // including bodies, before skipping cryptography; any changed prefix takes the normal verifier.
  // A body-less entry is only bound by the following entry's prev and a supplied record, so it is reused only when
  // that binding and the supplied record match the authenticated copy; otherwise the cold verifier decides, keeping
  // warm and cold outcomes (and recorded faults) identical.
  if(authenticatedPrefix?.digests[i]===storedDigests[i]&&storedDigests[i]!==undefined&&authenticatedPrefix.envelope.id===envelope.id&&authenticatedPrefix.envelope.kind===envelope.kind&&jcs(e)===jcs(authenticatedPrefix.envelope.versions[i])&&(Object.hasOwn(e,'body')||sameDetachedRecord(envelope,records,i,storedDigests[i],authenticatedPrefix.records[i]))){digests.push(storedDigests[i]);verified.push(authenticatedPrefix.records[i]);continue;}
  if(!exact(e,['version','prev'],['body'])||e.version!==i+1||i===0&&e.prev!==null||i>0&&e.prev!==digests[i-1])fail(i<storedDigests.length?'artefact_history_rewritten':'artefact_invalid');
  let record;
  if(Object.hasOwn(e,'body'))record=versionRecord(envelope,e);
  else{
   const next=envelope.versions[i+1];if(!next||next.version!==i+2||!DIGEST_PATTERN.test(next.prev))fail();
   const received=records.get(versionURL(envelope.id,i+1))??records.get(next.prev);if(received===undefined)fail('artefact_unavailable');record=parseVersionRecord(received);
   if(record.id!==envelope.id||record.kind!==envelope.kind||record.version!==i+1||record.prev!==e.prev)fail();
  }
  const digest=await versionDigest(record,{crypto});
  if(!Object.hasOwn(e,'body')&&digest!==envelope.versions[i+1].prev)fail('artefact_digest_mismatch');
  if(storedDigests[i]!==undefined&&digest!==storedDigests[i])fail('artefact_history_rewritten');digests.push(digest);verified.push(record);
  }catch(e){if(i<storedDigests.length&&['artefact_invalid','artefact_digest_mismatch'].includes(e.code))fail('artefact_history_rewritten');throw e;}
 }
 // Kind validators receive a detached copy, so a validator that prepares data cannot alter hashed records.
 const record=verified[version-1];if(validateBody&&await validateBody(copy(record.body),{id:record.id,kind:record.kind,version})===false)fail();
 return {envelope,record,body:record.body,id:record.id,kind:record.kind,version,digest:digests[version-1],digests,records:verified};
}
export const verifyChain=(input,options={})=>{const envelope=parseEnvelope(input,options);return extractVersion(envelope,envelope.versions.length,options);};
export async function verifyReference(input,reference,options={}){
 const ref=Object.hasOwn(reference??{},'id')?parseReference({...reference,artefact:reference.id},{kind:reference.kind}):parseReference(reference,options);
 if(ref.latest)fail();
 // Legacy parse/digest semantics deliberately remain permissive; strict parsing starts at migration.
 let value;try{value=typeof input==='string'?JSON.parse(input):input instanceof Uint8Array?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input)):input;}catch{fail();}
 if(!Object.hasOwn(value??{},'bindle_artefact')){
  if(!ref.legacy)fail();value=guarded(()=>JSON.parse(canonical(value)));const digest=await hash(canonical(value),options.crypto??globalThis.crypto);if(digest!==ref.digest)fail('artefact_digest_mismatch');return {id:ref.id,body:value,digest,legacy:true};
 }
 const {validateBody,...chainOptions}=options,result=await extractVersion(input,ref.version??1,{...chainOptions,id:ref.id,kind:ref.kind});
 const digest=ref.legacy?await hash(canonical(result.body),options.crypto??globalThis.crypto):result.digest;
 if(digest!==ref.digest)fail('artefact_digest_mismatch');if(validateBody&&await validateBody(copy(result.body),{id:result.id,kind:result.kind,version:result.version})===false)fail();return {...result,legacy:ref.legacy};
}

const pointerPart=k=>String(k).replaceAll('~','~0').replaceAll('/','~1');
const at=(v,path)=>path.reduce((v,k)=>v&&Object.hasOwn(v,k)?v[k]:undefined,v);
const pointer=p=>p.length?`/${p.map(pointerPart).join('/')}`:'';
const fieldName=k=>/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(k);
const text=(v,n)=>typeof v==='string'&&scalarString(v)&&!controls.test(v)&&[...v].length<=n&&v.length>0;
const distinctStrings=(v,max)=>Array.isArray(v)&&v.length>0&&v.length<=max&&new Set(v).size===v.length&&v.every(x=>text(x,2048));
function field(v,{optional=false,title=true}={}){
 if(!plain(v)||Object.keys(v).some(k=>!['title','description','type','cardinality','contracts','values','extensible','minLength','maxLength','minimum','maximum'].includes(k)))return false;
 if((title||v.title!==undefined)&&!text(v.title,200)||v.description!==undefined&&!text(v.description,1000)||!['string','boolean','integer','number','enum','url','resource'].includes(v.type))return false;
 const c=v.cardinality??{min:1,max:1};if(!exact(c,['min','max'])||!Number.isSafeInteger(c.min)||c.min<0||!positive(c.max)||c.max>16||c.min>c.max||optional&&c.min!==0)return false;
 if(optional&&v.cardinality?.min!==0)return false;
 if(v.type==='resource'){if(!distinctStrings(v.contracts,16))return false;try{v.contracts.forEach(artefactURL);}catch{return false;}}else if(v.contracts!==undefined)return false;
 if(v.type==='enum'){if(!distinctStrings(v.values,32)||v.extensible!==undefined&&typeof v.extensible!=='boolean')return false;}else if(v.values!==undefined||v.extensible!==undefined)return false;
 if(['string','url'].includes(v.type)){if(!positive(v.maxLength)||v.maxLength>2048||v.minLength!==undefined&&(!Number.isSafeInteger(v.minLength)||v.minLength<0||v.minLength>v.maxLength))return false;}else if(v.minLength!==undefined||v.maxLength!==undefined)return false;
 if(['integer','number'].includes(v.type)){if(!Number.isSafeInteger(v.minimum)||!Number.isSafeInteger(v.maximum)||v.minimum>v.maximum)return false;}else if(v.minimum!==undefined||v.maximum!==undefined)return false;return true;
}
// Schema traversal follows schema positions only, never examples/defaults/const. Local refs are followed
// with a visited set, so recursive definitions work without mistaking annotation data for schemas.
const schemaMaps=['properties','patternProperties','dependentSchemas'],schemaArrays=['allOf','anyOf','oneOf','prefixItems'],schemaSingles=['items','contains','additionalProperties','unevaluatedProperties','unevaluatedItems','propertyNames','not','if','then','else','contentSchema'];
const grandfathered=new Set('art-lojban cel-gaulish en-gb-oed i-ami i-bnn i-default i-enochian i-hak i-klingon i-lux i-mingo i-navajo i-pwn i-tao i-tay i-tsu no-bok no-nyn sgn-be-fr sgn-be-nl sgn-ch-de zh-guoyu zh-hakka zh-min zh-min-nan zh-xiang'.split(' '));
const languageTag=v=>{if(grandfathered.has(v.toLowerCase())||/^x(?:-[a-z0-9]{1,8})+$/i.test(v))return true;try{return Intl.getCanonicalLocales(v).length===1;}catch{return false;}};
function schemaGraph(root,base=[]){
 const anchors=new Map(),resources=new Map(),scopes=new Map(),fallback='https://schema.example/__root__';
 const register=(map,key,p)=>map.set(key,map.has(key)?null:p);
 const scan=(v,p,uri)=>{
  if(!plain(v))return;
  if(v.$id!==undefined){if(typeof v.$id!=='string')throw Error('invalid schema id');const u=new URL(v.$id,uri);if(u.hash)throw Error('fragment schema id');uri=u.href;register(resources,uri,p);}
  else if(p.length===base.length)register(resources,uri,p);
  scopes.set(pointer(p),uri);
  for(const k of ['$anchor','$dynamicAnchor'])if(typeof v[k]==='string')register(anchors,`${uri}#${v[k]}`,p);
  for(const k of [...schemaMaps,'$defs'])if(plain(v[k]))for(const [name,x]of Object.entries(v[k]))scan(x,[...p,k,name],uri);
  for(const k of schemaArrays)if(Array.isArray(v[k]))v[k].forEach((x,i)=>scan(x,[...p,k,String(i)],uri));
  for(const k of schemaSingles)scan(v[k],[...p,k],uri);
 };scan(at(root,base),base,fallback);
 const resolve=(ref,from=base)=>{
  if(typeof ref!=='string')return null;let u;try{u=new URL(ref,scopes.get(pointer(from))??scopes.get(pointer(base))??fallback);}catch{return null;}
  const fragment=u.hash.slice(1);u.hash='';const resource=resources.get(u.href);if(!resource)return null;
  if(!fragment)return resource;
  let tail;try{tail=decodeURIComponent(fragment);}catch{return null;}
  if(tail.startsWith('/')){if(/~(?![01])/u.test(tail))return null;const p=[...resource,...tail.slice(1).split('/').map(k=>k.replaceAll('~1','/').replaceAll('~0','~'))];return at(root,p)===undefined?null:p;}
  return anchors.get(`${u.href}#${tail}`)??null;
 };
 const walk=(start,role,visit,{definitions=false}={})=>{
  const seen=new Set();
  const go=(p,r)=>{const key=`${r}:${pointer(p)}`;if(seen.has(key))return;seen.add(key);const v=at(root,p);if(!plain(v))return;visit(v,p,r);
   for(const k of ['$ref','$dynamicRef'])if(v[k]!==undefined){const target=resolve(v[k],p);if(target===null)throw Error('unresolved reference');go(target,r);}
   for(const k of [...schemaMaps,...definitions?['$defs']:[]])if(plain(v[k]))for(const name of Object.keys(v[k]))go([...p,k,name],r==='branch'&&k==='properties'&&name==='args'?'request':r==='branch'?'frozen':r);
   for(const k of schemaArrays)if(Array.isArray(v[k]))v[k].forEach((_,i)=>go([...p,k,String(i)],r));
   for(const k of schemaSingles)if(plain(v[k]))go([...p,k],['not','if','propertyNames','contains'].includes(k)?'frozen':r);
  };go(start,role);
 };return {resolve,walk};
}
const rule=(pattern,operation,allow)=>Object.freeze({pattern,operation,allow});
const optionRules=['occupant','consumer'].map(k=>rule(`/slot/options/${k}`,'add-member',c=>Object.keys(c.nextParent).length<=32&&fieldName(c.key)&&field(c.value,{optional:true,title:false})));
const fragmentRules=[rule('/fields','add-member',c=>Object.keys(c.nextParent).length<=32&&fieldName(c.key)&&field(c.value,{optional:true})),rule('/fields/*/values','append',c=>at(c.old,c.segments.slice(0,-1))?.type==='enum'&&at(c.old,c.segments.slice(0,-1))?.extensible===true&&text(c.value,2048)&&!c.parent.includes(c.value)&&!c.added.slice(0,c.index).includes(c.value)&&c.parent.length+c.added.length<=32)];
const intentRules=[
 rule('/data/properties','add-member',c=>!c.next.data.required.includes(c.key)&&!Object.hasOwn(c.old.disclosure.fields,c.key)&&Object.hasOwn(c.next.disclosure.fields,c.key)),
 rule('/disclosure/fields','add-member',c=>!Object.hasOwn(c.old.data.properties,c.key)&&Object.hasOwn(c.next.data.properties,c.key)),
 ...['/title','/summary','/disclosure/fields/*/title'].map(path=>rule(path,'add-member',c=>languageTag(c.key)&&!Object.keys(c.parent).some(k=>k.toLowerCase()===c.key.toLowerCase()))),
 rule('/data/properties/*/values','append',c=>at(c.old,c.segments.slice(0,-1))?.type==='enum'&&at(c.old,c.segments.slice(0,-1))?.extensible===true&&!c.parent.includes(c.value)&&!c.added.slice(0,c.index).includes(c.value))
];
export const DEFAULT_KINDS=Object.freeze({
 intent:Object.freeze({rules:Object.freeze(intentRules),validate:body=>{validateIntentKind(body);return true;}}),
 fragment:Object.freeze({rules:Object.freeze(fragmentRules)}),slot:Object.freeze({rules:Object.freeze(optionRules)}),
 bus:Object.freeze({rules:Object.freeze([...optionRules,rule('/slot/bus/types','append',c=>c.old.slot?.bus?.types_extensible===true&&typeof c.value==='string'&&/^[a-z][a-z0-9.-]{0,47}$/.test(c.value)&&!c.parent.includes(c.value)&&!c.added.slice(0,c.index).includes(c.value))]),schema:'bus'}),
 'rpc-contract':Object.freeze({rules:Object.freeze([]),schema:'rpc'}),
 'submission-schema':Object.freeze({rules:Object.freeze([]),schema:'request'}),'manifest-profile':Object.freeze({rules:Object.freeze([]),schema:'profile'}),document:Object.freeze({rules:Object.freeze([])})
});
function schemaRules(kind,old,next){
 const base=kind==='profile'?['declaration']:kind==='bus'?['slot','bus','payload']:[],rules=[],graph=schemaGraph(old,base),nextGraph=schemaGraph(next,base),roles=new Map();
 const visit=(v,p,r)=>{const key=pointer([...p,'properties']),list=roles.get(key)??[];list.push({v,role:r});roles.set(key,list);};
 // Every old schema reference must already resolve, including unused definitions. Never fill a dangling ref.
 graph.walk(base,'frozen',(v,p)=>{for(const k of ['$ref','$dynamicRef'])if(v[k]!==undefined){const before=graph.resolve(v[k],p),after=nextGraph.resolve(v[k],p);if(before===null||after===null||pointer(before)!==pointer(after))throw Error('reference capture');}},{definitions:true});
 if(kind==='rpc'){
  for(const m of Object.values(old['x-methods']??{})){
   for(const [key,role]of [['request','branch'],['result','result']])if(m[key]!==undefined){const p=graph.resolve(m[key]);if(p===null)throw Error('unresolved method');graph.walk(p,role,visit);}
  }
  const newMethod=k=>!Object.hasOwn(old['x-methods']??{},k)&&plain(next['x-methods']?.[k])&&typeof next['x-methods'][k].effect==='string';
  rules.push(rule('/x-methods','add-member',c=>newMethod(c.key)));
  for(const union of ['oneOf','anyOf'])rules.push(rule(`/${union}`,'append',c=>{
   let v=c.value,seen=new Set();while(plain(v)&&v.$ref!==undefined){const p=nextGraph.resolve(v.$ref);if(p===null||seen.has(pointer(p)))return false;seen.add(pointer(p));v=at(next,p);}
   return plain(v)&&newMethod(v.properties?.method?.const)&&Array.isArray(v.required)&&v.required.includes('method');
  }));
  const forbidden=v=>v&&typeof v==='object'&&Object.entries(v).some(([k,x])=>['$id','$anchor','$dynamicAnchor','$dynamicRef'].includes(k)||forbidden(x));
  rules.push(rule('/$defs','add-member',c=>!forbidden(c.value)));
  rules.push(rule('/x-methods/*/summary','add-member',c=>{
   const tags=Object.keys(c.nextParent);return languageTag(c.key)&&text(c.value,160)&&tags.length<=8&&new Set(tags.map(k=>k.toLowerCase())).size===tags.length;
  }));
 }else if(kind==='bus')graph.walk(['slot','bus','payload'],'result',visit);
 else if(kind==='request')graph.walk([],'request',visit);
 else if(kind==='profile')graph.walk(['declaration'],'request',visit);
 for(const [path,list]of roles)rules.push({...rule(path,'add-member',c=>list.every(({v,role})=>
  role==='request'?!v.required?.includes(c.key)&&!(kind==='rpc'&&plain(c.value)&&Object.hasOwn(c.value,'default')):
  role==='result'?(v.additionalProperties===undefined||v.additionalProperties===true)&&!v.required?.includes(c.key):false)),literal:true});
 return rules;
}
const matches=(pattern,path)=>{const a=pattern.split('/'),b=path.split('/');return a.length===b.length&&a.every((s,i)=>s==='*'||s===b[i]);};
// Pluggable kinds: own entries {rules:[{pattern,operation,allow(context)}], validate?(body)}.
// No global registration/mutation. The caller supplies the reviewed table; relation is unknown by default.
// A null additive result means unknown, never permission to advance a head. Changes name the growth paths;
// projection and consent at those paths remain the responsibility of the consumers (ART-5/ART-6).
export function validateAdditive(kind,old,next,{kinds=DEFAULT_KINDS}={}){
 const table=kinds instanceof Map?kinds.get(kind):Object.hasOwn(kinds,kind)?kinds[kind]:undefined;
 if(!table)return {known:false,additive:null,changes:[]};const changes=[];
 try{
  bodyValue(old,kind);bodyValue(next,kind);if(table.validate&&(table.validate(old)===false||table.validate(next)===false))return {known:true,additive:false,changes:[]};
  const rules=[...table.rules??[],...table.schema?schemaRules(table.schema,old,next):[]];
  const allow=(p,operation,context)=>rules.some(r=>r.operation===operation&&(r.literal?r.pattern===pointer(p):matches(r.pattern,pointer(p)))&&r.allow({...context,old,next,segments:p,path:pointer(p)}));
  const walk=(a,b,p)=>{
   if(plain(a)){
    if(!plain(b))return false;for(const k of Object.keys(a))if(!Object.hasOwn(b,k)||!walk(a[k],b[k],[...p,k]))return false;
    for(const k of Object.keys(b))if(!Object.hasOwn(a,k)){if(!allow(p,'add-member',{key:k,value:b[k],parent:a,nextParent:b}))return false;changes.push({path:pointer([...p,k]),operation:'add-member'});}return true;
   }
   if(Array.isArray(a)){
    if(!Array.isArray(b)||b.length<a.length)return false;for(let i=0;i<a.length;i++)if(!walk(a[i],b[i],[...p,String(i)]))return false;
    const added=b.slice(a.length);for(let i=0;i<added.length;i++){if(!allow(p,'append',{value:added[i],parent:a,nextParent:b,added,index:i}))return false;changes.push({path:pointer([...p,String(a.length+i)]),operation:'append'});}return true;
   }return a===b;
  };const additive=walk(old,next,[]);return {known:true,additive,changes:additive?changes:[]};
 }catch{return {known:true,additive:false,changes:[]};}
}

const noticeDate=s=>{
 if(typeof s!=='string')return false;const m=/^(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:[Zz]|[+-](\d\d):(\d\d))$/.exec(s);if(!m)return false;
 const [,year,month,day,hour,minute,second,offsetHour='0',offsetMinute='0']=m,y=Number(year),days=[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
 return Number(month)>=1&&Number(month)<=12&&Number(day)>=1&&Number(day)<=days[Number(month)-1]&&Number(hour)<24&&Number(minute)<60&&Number(second)<=60&&Number(offsetHour)<24&&Number(offsetMinute)<60;
};
export const noticeDigest=(id,notice,options)=>{artefactURL(id);return digestJSON({t:'bindle.artefact-notice.v1',id,notice},options);};
// Digests come from a verified copy, not a reference supplied by an application. A lagging stored prefix
// may accept notices at a later copy head. Sticky state is returned; the provider persists it in ART-3.
export function evaluateNotices(envelope,{digests,storedDigests=[],accepted=[]}={}){
 const e=parseEnvelope(envelope),consistent=Array.isArray(digests)&&storedDigests.every((d,i)=>digests[i]===d),notices=accepted.map(copy);let rewritten=false,closedAt=null;
 const valid=n=>{
  if(!exact(n,['type','head','reason','issued'],['from','successor'])||!['deprecated','retracted'].includes(n.type)||typeof n.reason!=='string'||!scalarString(n.reason)||controls.test(n.reason)||[...n.reason].length>500||!noticeDate(n.issued)||!consistent)return false;
  const head=digests.indexOf(n.head)+1;if(!head)return false;
  if(n.type==='retracted'?!positive(n.from)||n.from>head:Object.hasOwn(n,'from'))return false;
  try{if(n.successor!==undefined)artefactURL(n.successor);}catch{return false;}return true;
 };
 const incoming=(e.notices??[]).filter(valid);
 for(const n of accepted)if(!incoming.some(v=>jcs(v)===jcs(n)))rewritten=true;
 for(const n of incoming)if(!notices.some(v=>jcs(v)===jcs(n)))notices.push(copy(n));
 for(const n of notices)if(n.type==='retracted'){const h=digests?.indexOf(n.head)+1;if(h){closedAt=closedAt===null?h:Math.min(h,closedAt);if(e.versions.length>h)rewritten=true;}}
 return {notices,rewritten,closedAt};
}
// Valid pinned-key signatures are supplied by the crypto provider, never inferred from signature presence.
export function evaluateRetraction(version,{notices=[],signedNotices=[],existingPin=false,ownerResumed=false}={}){
 if(!positive(version))fail();const affected=notices.filter(n=>n.type==='retracted'&&n.from<=version),signed=affected.some(n=>signedNotices.some(s=>jcs(s)===jcs(n)));
 return {affected:affected.length>0,allowPin:existingPin||!affected.length,keepRecord:true,revoke:false,notify:affected.length>0,shouldSuspend:existingPin&&signed&&!ownerResumed};
}
// Each copy must independently have trusted provenance. Foreign digests/unsigned records cannot freeze a
// line (R1-H2). `fetchedByProvider` and `validPinnedSignature` are trusted adapter facts, never wire claims.
export async function equivocationEvidence(a,b,{crypto=globalThis.crypto}={}){
 const trusted=(copy,record)=>copy.validPinnedSignature===true||copy.fetchedByProvider===true&&[record.id,versionURL(record.id,record.version)].includes(copy.url);
 let x,y;try{x=parseVersionRecord(a.record);y=parseVersionRecord(b.record);}catch{return null;}
 if(x.id!==y.id||x.version!==y.version||!trusted(a,x)||!trusted(b,y))return null;
 const left=await versionDigest(x,{crypto}),right=await versionDigest(y,{crypto});return left===right?null:{id:x.id,version:x.version,digests:[left,right],records:[x,y]};
}
