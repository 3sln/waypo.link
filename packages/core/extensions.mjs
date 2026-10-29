// Extension declarations (protocol §2, extensions revision 3.2 §2; draft, unsigned). Pure and dependency-light so the
// provider (manifest emission, federation clients, the identity directory) and the SDK share one reading.
//
// A provider declares `extensions: [{spec, options}]`. The spec URL is the extension's whole identity, versioned in its
// last path segment. A processor *implements* an extension by holding its descriptor (bundled here, never fetched,
// extensions §2.3) together with an implementation of its spec. Every Bindle-owned row comes from the extensions §2.8
// mapping of the former `features` and `profiles` keys; identifiers under spec.bindle.example are placeholders.
//
// Provider-published extensions (3sln.me's own provider features, extensions §4.2 and §11.1) are listed separately:
// only this provider declares and processes them.
import {fieldOutcome,httpsIdentifier,cardinalityOf} from './fragments.mjs';

export const BINDLE_EXTENSIONS_BASE='https://spec.bindle.example/extensions';
const B=name=>`${BINDLE_EXTENSIONS_BASE}/${name}/v1`;
/** Bindle-owned extension spec URLs (extensions §2.8; EXT3-21 reading, pending owner sign-off). The contact-intents
 * extension `…/extensions/intents/v1` is withdrawn (contacts spike CR-P1, CL-11; removed in contacts phase 4). */
export const EXT=Object.freeze({
 authorizationEntry:B('authorization-entry'),deviceAuthorization:B('device-authorization'),integrations:B('integrations'),brokeredResources:B('brokered-resources'),
 fedcm:B('fedcm'),intentLinks:B('intent-links'),clientIdMetadata:B('client-id-metadata'),
 directory:B('directory'),organizations:B('organizations'),keyDelegation:B('key-delegation'),relations:B('relations'),portability:B('portability'),
 appRemoval:B('app-removal'),subjectDeleted:B('subject-deleted'),artefactVersions:B('artefact-versions'),embeddedComponents:B('embedded-components'),
 // Signaling rev 3.2 (docs/spec/extensions/signaling.md §3.1; extensions §2.8 row `signaling.v1`). Implemented locally
 // behind SIGNALING_ENABLED and SIGNALING_FOREIGN_ENABLED (default off). The interim `…/extensions/rtc-signaling/v1`
 // identity is retired with packages/rtc (Appendix C.1/C.2); it was never published.
 signaling:B('signaling'),
 // Bindle Messaging §2.5 (contacts spike CR-X1, provisional, unsigned): published by Bindle Messaging. Its one provider
 // feature consumes the messaging-ingress `mailbox` field and gates the Parlay key-delegation purposes. Prerequisite:
 // key-delegation (below).
 messagingMailbox:B('messaging-mailbox'),
});
/** 3sln.me-published extensions whose single provider feature (extensions §4.2) consumes a provider-only field. */
export const PROVIDER_EXT=Object.freeze({
 // The 3sln.me `email-bridge` extension was removed on 2026-10-28 (owner direction: strike the email bridge for now;
 // revisit later). None is published at present.
 // The 3sln.me `messaging-address` extension was withdrawn by the contacts spike (CL-4, CR-X1) and removed on 2026-10-28;
 // the Bindle-published messaging-mailbox extension (EXT.messagingMailbox) replaces its feature.
});

const url=(title,{endpoint,min=1,maxLength=2048}={})=>({title,type:'url',maxLength,...endpoint?{endpoint}:{},...min===1?{}:{cardinality:{min,max:1}}});
const int=(title,minimum,maximum,{min=1}={})=>({title,type:'integer',minimum,maximum,...min===1?{}:{cardinality:{min,max:1}}});
const choice=(title,values,{min=1,max=values.length}={})=>({title,type:'enum',values,cardinality:{min,max}});
const d=(id,title,description,options={},document)=>({id,title,description,...document?{document}:{},options});
/** Descriptors of the Bindle-owned extensions this code base implements. Immutable per spec URL (extensions §7). */
export const BINDLE_DESCRIPTORS=Object.freeze([
 d(EXT.authorizationEntry,'Authorization entry','Sign in to apps without typing your full handle, switch accounts, confirm it is you, add access and sign out from the app.',{endpoint:url('Entry endpoint',{endpoint:'audience'}),intents:choice('Intents',['login','select-account','reauthenticate','end-session','grant-more','configure'])}),
 d(EXT.deviceAuthorization,'Device sign-in','Sign in on devices without a browser by approving a short code on another device.'),
 d(EXT.integrations,'Integrations','Connect services that supply resources to your account and receive its events.',{hint_endpoint:url('Hint endpoint',{endpoint:'audience',min:0})}),
 d(EXT.brokeredResources,'Brokered resources','Use resources hosted by your connected integrations, with access ending when you disconnect them.',{jwks_uri:url('Brokering keys',{endpoint:'public'}),preferences_contract:url('Preferences contract',{maxLength:256}),introspection_endpoint:url('Introspection endpoint',{endpoint:'audience',min:0})}),
 d(EXT.fedcm,'Browser sign-in','Sign in with the browser\'s own account chooser.',{config_url:url('FedCM configuration',{endpoint:'public'})}),
 d(EXT.intentLinks,'Intent links','Handle intent links for apps you approve.',{endpoint:url('Intent endpoint',{endpoint:'public'})}),
 d(EXT.clientIdMetadata,'App metadata documents','Use apps that identify themselves with a published metadata document.'),
 d(EXT.directory,'Directory','Look up handles and identity documents for people on this provider.',{directory_url:url('Directory',{endpoint:'public'})}),
 d(EXT.organizations,'Organizations','Host organizations whose members sign in from their own providers.',{effective_methods:{title:'Effective methods',type:'boolean',cardinality:{min:0,max:1}}}),
 d(EXT.keyDelegation,'Key delegation','Issue certificates that let your approved apps and organizations act for you, for a short time.',{max_certificate_seconds:int('Longest certificate lifetime',60,86400),revocation_bound_seconds:int('Revocation bound',1,86400,{min:0})}),
 d(EXT.relations,'Relations','Take part in relations between organizations hosted on different providers.',{accept_endpoint:url('Accept endpoint',{endpoint:'audience'}),join_endpoint:url('Join endpoint',{endpoint:'audience'}),events_endpoint:url('Events endpoint',{endpoint:'audience',min:0})}),
 d(EXT.portability,'Identity moves','Move your identity to another provider with an attested record.',{move_endpoint:url('Move endpoint',{endpoint:'audience',min:0}),attestation_jwks_uri:url('Attestation keys',{endpoint:'public',min:0}),transfer_in_endpoint:url('Transfer-in endpoint',{endpoint:'audience',min:0})}),
 d(EXT.appRemoval,'App removal','Remove apps cleanly, telling them to delete what they hold for you.',{jwks_uri:url('Removal keys',{endpoint:'public'}),return_uri:url('Return page',{endpoint:'public'}),completion_endpoint:url('Completion endpoint',{endpoint:'audience',min:0})}),
 d(EXT.subjectDeleted,'Deletion notices','Tell your connected integrations when your account is deleted.'),
 d(EXT.artefactVersions,'Artefact versions','Accept additive versions of published documents at the same address.'),
 // Embedded components (extensions §2.7, EXT3-29 provisional). The components profile's nested `parts` map cannot be
 // an option (options are atomic, extensions §2.4), so each part is the value `<name>/<version>`.
 d(EXT.embeddedComponents,'Embedded components','Show your account, sign-in and request controls inside the apps you use.',{embed_origin:url('Component origin',{endpoint:'public'}),protocol:{title:'Protocol versions',type:'integer',minimum:1,maximum:64,cardinality:{min:1,max:8}},parts:choice('Parts',['avatar/1','account-switcher/1','sign-in/1','request/1'],{min:1,max:4}),credential_binding:choice('Credential binding',['key-binding.v1'],{min:0,max:4}),manage_url:url('Account management page',{endpoint:'public',min:0})}),
 // Signaling (extensions §2.3 example; signaling §3.1): `endpoint` is an audience endpoint option.
 d(EXT.messagingMailbox,'Messaging app keys','Lets the messaging app you choose send and receive Bindle messages as you.'),
 d(EXT.signaling,'Signaling','Direct connections between your devices and other people\'s, for the kinds you approve.',{endpoint:url('Session endpoint',{endpoint:'audience'}),max_leg_certificate_seconds:int('Leg certificate lifetime',120,900),profiles:choice('Profiles',['data','webrtc'],{min:1,max:2})},'https://spec.bindle.example/extensions/signaling/v1/spec.html'),
].map(value=>deepFreeze(value)));
/** 3sln.me provider-feature descriptors (extensions §11.1). Their user-facing text is the feature's consent text. */
export const PROVIDER_DESCRIPTORS=Object.freeze([
].map(value=>deepFreeze(value)));

/** Prose prerequisites (extensions §2.5), as each extension's spec states them. Non-recursive presence checks only. */
export const PREREQUISITES=Object.freeze({
 [EXT.brokeredResources]:Object.freeze([EXT.integrations]),[EXT.fedcm]:Object.freeze([EXT.authorizationEntry]),
 [EXT.subjectDeleted]:Object.freeze([EXT.integrations]),[EXT.intentLinks]:Object.freeze([EXT.artefactVersions]),
 [EXT.portability]:Object.freeze([EXT.directory]),
 [EXT.signaling]:Object.freeze([EXT.directory,EXT.artefactVersions]),
 [EXT.messagingMailbox]:Object.freeze([EXT.keyDelegation]),
});
/** Flat OAuth/core members that receive audience-bound requests (extensions §2.4 distinctness). */
export const FLAT_AUDIENCE_ENDPOINTS=Object.freeze(['authorization_request_endpoint','token_endpoint','rpc_endpoint','revocation_endpoint','device_authorization_endpoint']);
/** The one option core names as exempt from the issuer-origin rule (extensions §2.7, embedded-components). */
export const ORIGIN_EXEMPT=Object.freeze({[EXT.embeddedComponents]:Object.freeze(['embed_origin'])});
export const EXTENSION_LIMITS=Object.freeze({entries:48,entryBytes:4096,descriptorBytes:16384,options:32});

function deepFreeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}return value;}
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const bytes=v=>{try{return new TextEncoder().encode(JSON.stringify(v)).length;}catch{return Infinity;}};
const controls=/[\u0000-\u001f\u007f\u2028\u2029]/;
const text=(v,max)=>typeof v==='string'&&v.length>0&&[...v].length<=max&&!controls.test(v);

/** Spec URL syntax (extensions §2.2): {line, version} or null. */
export function parseSpecURL(value){
 if(typeof value!=='string'||value.length>256||!httpsIdentifier(value))return null;
 let u;try{u=new URL(value);}catch{return null;}if(u.search||u.hash||u.href!==value)return null;
 const parts=u.pathname.split('/'),last=parts.at(-1);if(!/^v[1-9][0-9]{0,2}$/.test(last??'')||parts.length<3)return null;
 return {line:value.slice(0,value.length-last.length-1),version:Number(last.slice(1))};
}
/** Descriptor validation (extensions §2.3, §2.4). Returns a frozen copy or throws TypeError. */
export function validateDescriptor(value){
 if(!plain(value)||Object.keys(value).some(k=>!['id','title','description','document','options'].includes(k))||bytes(value)>EXTENSION_LIMITS.descriptorBytes)throw new TypeError('Invalid extension descriptor.');
 if(!parseSpecURL(value.id)||!text(value.title,100)||!text(value.description,500)||value.document!==undefined&&!httpsIdentifier(value.document)||!plain(value.options)||Object.keys(value.options).length>EXTENSION_LIMITS.options)throw new TypeError('Invalid extension descriptor.');
 for(const [name,option] of Object.entries(value.options)){
  if(!/^[a-z][a-z0-9_]{0,63}$/.test(name)||!plain(option)||Object.hasOwn(option,'extensible'))throw new TypeError('Invalid extension option.');
  if(fieldOutcome(option,{option:true}).status!=='valid')throw new TypeError('Invalid extension option.');
 }
 return deepFreeze(structuredClone(value));
}
/** A descriptor registry: Map(spec URL -> descriptor). Every descriptor is validated once, at construction. */
export function descriptorRegistry(list=BINDLE_DESCRIPTORS){const map=new Map();for(const value of list){const descriptor=validateDescriptor(value);if(map.has(descriptor.id))throw new TypeError('Duplicate extension descriptor.');map.set(descriptor.id,descriptor);}return map;}
export const BINDLE_REGISTRY=descriptorRegistry(BINDLE_DESCRIPTORS);

function originOf(value){try{return new URL(value).origin;}catch{return null;}}
const loopback=host=>host==='localhost'||host==='127.0.0.1'||host==='[::1]';
/** One option value against its member schema. `issuer`: the declarer's origin; endpoints must be on it. */
function optionValue(option,value,{issuer,exempt=false,allowInsecureLocalhost=false}){
 const type=option.type,check=item=>{
  if(type==='boolean')return typeof item==='boolean';
  if(type==='integer')return Number.isSafeInteger(item)&&item>=option.minimum&&item<=option.maximum;
  if(type==='number')return typeof item==='number'&&Number.isFinite(item)&&Math.abs(item)<=Number.MAX_SAFE_INTEGER&&item>=option.minimum&&item<=option.maximum;
  if(type==='enum')return option.values.includes(item);
  if(typeof item!=='string'||item.length<(option.minLength??0)||item.length>option.maxLength||controls.test(item))return false;
  if(type==='string')return true;
  let u;try{u=new URL(item);}catch{return false;}
  const insecure=allowInsecureLocalhost&&u.protocol==='http:'&&loopback(u.hostname);
  if(u.protocol!=='https:'&&!insecure||u.username||u.password||u.hash||u.href!==item&&u.origin!==item)return false;
  if(option.endpoint&&!exempt&&u.origin!==issuer)return false;
  return true;
 };
 const {min,max}=cardinalityOf(option);
 if(max===1)return check(value);
 return Array.isArray(value)&&value.length>=min&&value.length<=max&&new Set(value).size===value.length&&value.every(check);
}
/**
 * Validates one entry's options against its descriptor (extensions §2.4). Unknown option members are ignored (and
 * dropped); a known member that fails validation, or a required member that is absent, makes the entry invalid.
 * Returns the clean options or null.
 */
export function validateOptions(descriptor,options,{issuer,allowInsecureLocalhost=false}={}){
 if(options===undefined)options={};if(!plain(options))return null;
 const clean={},exempt=ORIGIN_EXEMPT[descriptor.id]??[];
 for(const [name,option] of Object.entries(descriptor.options)){
  if(!Object.hasOwn(options,name)){if(cardinalityOf(option).min>0)return null;continue;}
  if(!optionValue(option,options[name],{issuer,exempt:exempt.includes(name),allowInsecureLocalhost}))return null;
  clean[name]=structuredClone(options[name]);
 }
 return clean;
}
// Audience comparison (extensions §2.4 rev 3.3, EXT3-32, CR-X3-34): the WHATWG URL serialisation of each value, so
// scheme and host case, the ASCII host form, a default port, dot segments and an empty path never separate equal
// endpoints. The query is compared exactly (the serialiser keeps it); nothing else is normalised.
export const audienceKey=value=>{try{return new URL(value).href;}catch{return value;}};
const audienceValues=(descriptor,options)=>Object.entries(descriptor.options).filter(([name,o])=>o.endpoint==='audience'&&Object.hasOwn(options,name)).flatMap(([name])=>Array.isArray(options[name])?options[name]:[options[name]]).map(audienceKey);

/**
 * Processes a manifest's `extensions` (extensions §2.2–§2.5, protocol §2 processing rules). Never throws on content:
 * an invalid entry is absent for this processor and never invalidates the manifest.
 *   registry  Map(spec URL -> descriptor) of the extensions this processor implements.
 *   issuer    the manifest's issuer origin (endpoint options must be on it).
 * Returns {extensions: Map(spec -> options), absent: [{spec, reason}], ignored: count}. `absent` lists entries for
 * implemented extensions that were dropped, with the reason (duplicate, versions, options, audience, prerequisite).
 */
export function readExtensions(manifest,{registry=BINDLE_REGISTRY,issuer=manifest?.issuer,allowInsecureLocalhost=false}={}){
 const out=new Map(),absent=[],raw=manifest?.extensions;let ignored=0;
 if(raw===undefined)return {extensions:out,absent,ignored};
 if(!Array.isArray(raw)||raw.length>EXTENSION_LIMITS.entries)return {extensions:out,absent:[{spec:null,reason:'container'}],ignored:Array.isArray(raw)?raw.length:1};
 const issuerOrigin=originOf(issuer);
 // Syntax and per-spec / per-line counts over every entry with a valid spec, implemented or not (§2.5).
 const parsed=raw.map(entry=>{if(!plain(entry)||bytes(entry)>EXTENSION_LIMITS.entryBytes)return null;const spec=parseSpecURL(entry.spec);return spec?{entry,spec:entry.spec,line:spec.line}:null;});
 const specCount=new Map(),lineSpecs=new Map();
 for(const p of parsed)if(p){specCount.set(p.spec,(specCount.get(p.spec)??0)+1);if(!lineSpecs.has(p.line))lineSpecs.set(p.line,new Set());lineSpecs.get(p.line).add(p.spec);}
 const candidates=[];
 for(const p of parsed){
  if(!p){ignored++;continue;}
  const descriptor=registry.get(p.spec);if(!descriptor){ignored++;continue;}
  if(specCount.get(p.spec)>1){absent.push({spec:p.spec,reason:'duplicate'});continue;}
  if(lineSpecs.get(p.line).size>1){absent.push({spec:p.spec,reason:'versions'});continue;}
  const options=validateOptions(descriptor,p.entry.options,{issuer:issuerOrigin,allowInsecureLocalhost});
  if(!options){absent.push({spec:p.spec,reason:'options'});continue;}
  candidates.push({spec:p.spec,descriptor,options});
 }
 // Audience distinctness (§2.4): against the flat audience members, within an entry and across entries.
 const flat=new Set(FLAT_AUDIENCE_ENDPOINTS.map(name=>manifest?.[name]).filter(v=>typeof v==='string').map(audienceKey));
 const owners=new Map();for(const c of candidates)for(const value of new Set(audienceValues(c.descriptor,c.options))){if(!owners.has(value))owners.set(value,new Set());owners.get(value).add(c.spec);}
 const collided=new Set();
 for(const c of candidates){const values=audienceValues(c.descriptor,c.options);if(new Set(values).size!==values.length||values.some(v=>flat.has(v)||owners.get(v).size>1))collided.add(c.spec);}
 const valid=candidates.filter(c=>{if(collided.has(c.spec)){absent.push({spec:c.spec,reason:'audience'});return false;}return true;});
 // Prerequisites (§2.5): exactly one entry with the prerequisite's exact spec in the same manifest; no recursion.
 for(const c of valid){
  const missing=(PREREQUISITES[c.spec]??[]).some(spec=>specCount.get(spec)!==1);
  if(missing){absent.push({spec:c.spec,reason:'prerequisite'});continue;}
  out.set(c.spec,deepFreeze(c.options));
 }
 return {extensions:out,absent,ignored};
}
/** Options of one extension in a processed manifest, or null when it is absent. */
export const extensionOptions=(manifest,spec,options={})=>readExtensions(manifest,options).extensions.get(spec)??null;

/**
 * Option members whose values combine across several declarations of one extension instead of the later value winning
 * (review M3, 2026-10-28; provisional, unsigned). Key delegation (organizations §14): one entry describes every
 * certificate profile the issuer issues, so `max_certificate_seconds` and `revocation_bound_seconds` are the maximum
 * over all of them (a relying party bounds revocation exposure by the longest).
 */
export const OPTION_COMBINE=Object.freeze({[EXT.keyDelegation]:Object.freeze({max_certificate_seconds:'max',revocation_bound_seconds:'max'})});
function combineOptions(spec,earlier={},later={}){
 const out={...earlier,...structuredClone(later)},rules=OPTION_COMBINE[spec]??{};
 for(const [name,rule] of Object.entries(rules))if(rule==='max'&&Number.isSafeInteger(earlier[name])&&Number.isSafeInteger(later[name]))out[name]=Math.max(earlier[name],later[name]);
 return out;
}
/**
 * Emission side: merges declaration entries into a manifest's `extensions`. `merge:true` combines options of an entry
 * already present for the same spec (later members win, except the OPTION_COMBINE members); otherwise a second entry
 * for one spec is an error, because a duplicate would make every copy absent at every processor (§2.5). Throws
 * TypeError on composition errors.
 */
export function withExtensionEntries(manifest,entries=[],{merge=false}={}){
 const list=(Array.isArray(manifest.extensions)?manifest.extensions:[]).map(e=>structuredClone(e));
 for(const entry of entries){
  if(!plain(entry)||!parseSpecURL(entry.spec)||entry.options!==undefined&&!plain(entry.options)||Object.keys(entry).some(k=>!['spec','options'].includes(k)))throw new TypeError('Invalid extension declaration.');
  const at=list.findIndex(e=>e.spec===entry.spec);
  if(at>=0){if(!merge)throw new TypeError('Duplicate extension declaration.');list[at]={spec:entry.spec,options:combineOptions(entry.spec,list[at].options??{},entry.options??{})};}
  else list.push(entry.options&&Object.keys(entry.options).length?{spec:entry.spec,options:structuredClone(entry.options)}:{spec:entry.spec});
 }
 if(list.length>EXTENSION_LIMITS.entries||list.some(e=>bytes(e)>EXTENSION_LIMITS.entryBytes))throw new TypeError('Too many or oversized extension declarations.');
 return list.length?{...manifest,extensions:list}:(({extensions,...rest})=>rest)(manifest);
}
/** A declaration entry, dropping an empty options object. */
export const declare=(spec,options)=>options&&Object.keys(options).length?{spec,options:structuredClone(options)}:{spec};

// RFC 9562 UUIDv5 (URL namespace) for a provider feature's deterministic `tx` (extensions §4.2): over (spec URL,
// contract, entity, fingerprint), joined by `|`. The spec names the inputs, not their encoding; this one is fixed here.
const UUID_URL_NAMESPACE=Uint8Array.from('6ba7b8119dad11d180b400c04fd430c8'.match(/../g),h=>parseInt(h,16));
export async function featureTx(spec,contract,entity,fingerprint,{crypto=globalThis.crypto}={}){
 // §4.2 rev 3.3: the first three inputs never contain `|`, so the joined name is unambiguous.
 if(!parseSpecURL(spec)||typeof contract!=='string'||typeof entity!=='string'||typeof fingerprint!=='string'||[spec,contract,entity].some(v=>v.includes('|')))throw new TypeError('Invalid feature transaction input.');
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-1',new Uint8Array([...UUID_URL_NAMESPACE,...new TextEncoder().encode(`${spec}|${contract}|${entity}|${fingerprint}`)]))).slice(0,16);
 bytes[6]=bytes[6]&15|80;bytes[8]=bytes[8]&63|128;const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
/** A provider feature's client identity (extensions §4.2): the pair (issuer, spec URL), serialized for journal keys and
 * grant records. Never equal to an application's client_id (which is an HTTPS URL without this prefix). */
export const featureIdentity=(issuer,spec)=>{if(!parseSpecURL(spec))throw new TypeError('Invalid feature spec URL.');return `feature:${issuer}|${spec}`;};
