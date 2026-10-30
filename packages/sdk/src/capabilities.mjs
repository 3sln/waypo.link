// Provider declarations and per-feature capabilities (components-profile decision
// note §4–§5, protocol §2, extensions §2). Pure and side-effect free: no window,
// storage or network. identity.mjs feeds it validated manifests; elements read
// only the frozen capability set, never the manifest.
//
// Provisional: extension declarations (extensions revision 3.2 §2) and the
// embedded-components extension are unsigned drafts; spec URLs under
// spec.bindle.example are placeholders. Declarations are read only from
// `extensions` through the shared processor (packages/core/extensions.mjs, bundled
// descriptors, never fetched). The former `features`/`profiles` keys are ignored.
import {EXT,BINDLE_REGISTRY,EXTENSION_LIMITS,readExtensions} from '../../core/extensions.mjs';
import {PARTS} from './islands-protocol.mjs';

export {EXT};
/** The embedded-components extension (formerly the components profile); its options configure islands. */
export const COMPONENTS_V1=EXT.embeddedComponents;
export const authorizationIntents=Object.freeze(['login','select-account','reauthenticate','end-session']);
/** Extensions this SDK implements; every other declared extension is ignored (extensions §2.5). */
// The contact-intents extension (`…/extensions/intents/v1`, options `intents` and `login_endpoint`) was withdrawn by the
// contacts spike (CR-P1, CL-11) and removed in contacts phase 4; the SDK no longer reads it.
export const implementedExtensions=Object.freeze([EXT.authorizationEntry,EXT.fedcm,EXT.clientIdMetadata,EXT.embeddedComponents]);
const registry=new Map(implementedExtensions.map(spec=>[spec,BINDLE_REGISTRY.get(spec)]));
export const declarationLimits=Object.freeze({entries:EXTENSION_LIMITS.entries,entryBytes:EXTENSION_LIMITS.entryBytes,cacheDefault:300000,cacheMax:3600000});
export const credentialBindings=Object.freeze(['key-binding.v1']);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const coded=(message,code)=>Object.assign(new Error(message),{code});
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
// An endpoint on the issuer origin with no credentials or fragment; null otherwise.
export function issuerURL(value,issuer){
  if(typeof value!=='string'||value.length>2048)return null;let url;try{url=new URL(value);}catch{return null;}
  return url.origin===issuer&&!url.username&&!url.password&&!url.hash?url.href:null;
}

// Conformance floor (protocol §2): fails closed with `unsupported-provider`, never a fallback.
export function checkFloor(manifest,issuer){
  const fail=message=>{throw coded(message,'unsupported-provider');};
  if(!plain(manifest)||manifest.version!=='0'||manifest.issuer!==issuer)fail('Unsupported manifest version or mismatched issuer.');
  if(!Array.isArray(manifest.login_presentation)||manifest.login_presentation.length>8||!manifest.login_presentation.includes('redirect'))fail('Provider must support redirect login.');
  for(const key of ['authorization_endpoint','token_endpoint','rpc_endpoint','jwks_uri','authorization_request_endpoint'])if(!issuerURL(manifest[key],issuer))fail(`Missing or foreign provider endpoint: ${key}.`);
  let contract;try{contract=new URL(manifest.preferences_contract);}catch{fail('Missing preferences contract.');}
  if(contract.protocol!=='https:'||contract.username||contract.password||contract.hash)fail('Invalid preferences contract.');
}

/**
 * Embedded-components options (already descriptor-validated) to the islands configuration. Adds the components
 * profile's own §2 rules the descriptor cannot express: `embed_origin` is a bare HTTPS origin that is not an IP
 * literal, the issuer origin or the embedder's origin, and `protocol` includes 1. Returns null when it must be ignored.
 * Parts are `<name>/<version>` values. Rev 3.3 (§2.7, CR-X3-33, provisional): no per-part FedCM (islands never
 * delegate to FedCM) and no `theme_tokens` (islands use provider defaults).
 */
export function readComponentsOptions(options,issuer,{embedderOrigin}={}){
  if(!plain(options))return null;
  let embed;try{embed=new URL(options.embed_origin);}catch{return null;}
  if(embed.origin!==options.embed_origin||embed.protocol!=='https:'||/^\[|^\d+(?:\.\d+){3}$/.test(embed.hostname)||embed.origin===issuer||embed.origin===embedderOrigin)return null;
  if(!Array.isArray(options.protocol)||!options.protocol.includes(1)||!Array.isArray(options.parts))return null;
  const parts={};
  for(const value of options.parts){
    const [name,v]=value.split('/'),version=Number(v);
    if(Object.hasOwn(PARTS,name)&&PARTS[name].versions.includes(version)&&(parts[name]?.version??0)<version)parts[name]={version};
  }
  const bindings=Array.isArray(options.credential_binding)?credentialBindings.filter(binding=>options.credential_binding.includes(binding)):[];
  const manageUrl=options.manage_url===undefined?null:issuerURL(options.manage_url,issuer);
  return {embedOrigin:embed.origin,parts,bindings,...manageUrl?{manageUrl}:{}};
}

// Normalized, frozen declaration. Only required members fail closed (checkFloor);
// every extension entry is validated independently by the shared processor and an
// invalid one is absent. Unknown keys, unimplemented extensions and the former
// `features`/`profiles` containers are ignored.
export function readDeclaration(manifest,issuer,{embedderOrigin}={}){
  checkFloor(manifest,issuer);
  const warnings=[];
  const read=readExtensions(manifest,{registry,issuer,allowInsecureLocalhost:issuer.startsWith('http://')});
  for(const {spec,reason} of read.absent)warnings.push(spec??`extensions:${reason}`);
  const extensions=Object.fromEntries(read.extensions),option=spec=>extensions[spec]??null;
  const entryOptions=option(EXT.authorizationEntry),fedcmOptions=option(EXT.fedcm);
  let components=null;
  if(option(EXT.embeddedComponents)){components=readComponentsOptions(option(EXT.embeddedComponents),issuer,{embedderOrigin});if(!components)warnings.push(EXT.embeddedComponents);}
  const algs=Array.isArray(manifest.dpop_signing_alg_values_supported)?manifest.dpop_signing_alg_values_supported:[];
  const grants=Array.isArray(manifest.grant_types_supported)?manifest.grant_types_supported:[];
  const revocationEndpoint=manifest.revocation_endpoint===undefined?null:issuerURL(manifest.revocation_endpoint,issuer);
  if(manifest.revocation_endpoint!==undefined&&!revocationEndpoint)warnings.push('revocation_endpoint');
  return freeze({
    issuer,authorizationEndpoint:manifest.authorization_endpoint,tokenEndpoint:manifest.token_endpoint,rpcEndpoint:manifest.rpc_endpoint,requestEndpoint:manifest.authorization_request_endpoint,preferencesContract:manifest.preferences_contract,
    loginPresentation:['redirect','popup'].filter(value=>manifest.login_presentation.includes(value)),
    ...revocationEndpoint?{revocationEndpoint}:{},dpop:algs.includes('ES256'),refresh:grants.includes('refresh_token'),
    // Validated options of every present implemented extension, keyed by spec URL (descriptor option names).
    extensions,
    authorizationEntry:entryOptions?{endpoint:entryOptions.endpoint,intents:[...entryOptions.intents]}:null,
    fedcm:fedcmOptions?{configUrl:fedcmOptions.config_url}:null,
    clientIdMetadata:!!option(EXT.clientIdMetadata),
    components,warnings,
  });
}

// Capability set (decision note §5): a pure function of the declaration, the
// runtime degradations of that issuer and the embedder's island policy.
export function computeCapabilities(declaration,{degraded=new Set(),defaultIssuer=null,islands='auto',islandIssuers=null,identityCredential=!!globalThis.IdentityCredential}={}){
  if(!declaration)return null;
  const issuer=declaration.issuer,off=key=>degraded.has(key);
  // Intents the SDK's flows use; grant-more and configure are read by incremental.mjs from the same entry.
  const declared=!off('authorization-entry')&&declaration.authorizationEntry||null,known=declared?authorizationIntents.filter(intent=>declared.intents.includes(intent)):[];
  const entry=known.length?declared:null,intents=entry?known:[];
  const fedcm=!off('fedcm')&&!!declaration.fedcm&&!!entry&&identityCredential;
  const policy=islands!=='off'&&(!islandIssuers||islandIssuers.includes(issuer));
  const components=!off('profile')&&policy&&declaration.components||null;
  const identityless=intents.includes('login'),bound=!!components?.bindings.includes('key-binding.v1');
  const part=(name,ok)=>{const value=components?.parts[name];return value&&ok&&!off(`part:${name}`)?Object.freeze({version:value.version}):null;};
  return freeze({
    issuer,supported:true,entry:!!entry,intents:[...intents],
    login:true,identityless,selectAccount:intents.includes('select-account'),reauthenticate:intents.includes('reauthenticate'),endSession:intents.includes('end-session'),
    popup:!off('popup')&&declaration.loginPresentation.includes('popup'),fedcm,
    revoke:!!declaration.revocationEndpoint,
    // DPoP needs the entry (it carries dpopJkt) and a refresh grant worth binding.
    dpop:!off('dpop')&&declaration.dpop&&!!entry&&declaration.refresh,refresh:declaration.refresh,
    clientIdMetadata:declaration.clientIdMetadata,
    manageUrl:components?.manageUrl??declaration.components?.manageUrl??issuer+'/',
    profile:!!components,embedOrigin:components?.embedOrigin??null,
    islands:{avatar:part('avatar',bound),switcher:part('account-switcher',bound&&identityless),signIn:part('sign-in',identityless)},
  });
}

// Runtime failure codes that show a declared capability is not implemented.
export const notImplemented=status=>[404,405,501].includes(status);
// HTTP freshness, capped at one hour; five minutes by default (decision note §4).
export function freshness(response){
  const control=response?.headers?.get?.('cache-control')??'';
  if(/\b(?:no-store|no-cache)\b/i.test(control))return 0;
  const age=/\bmax-age=(\d{1,9})\b/i.exec(control);
  return age?Math.min(Number(age[1])*1000,declarationLimits.cacheMax):declarationLimits.cacheDefault;
}

// Per-document declaration cache and degradation set, keyed by issuer origin.
// Degradations never persist, never cross issuers and never reverse.
export class CapabilityStore {
  #declarations=new Map();#degraded=new Map();#listeners=new Set();
  constructor({clock=Date.now}={}){this.clock=clock;}
  // `manifest` is the floor-checked manifest itself (deep-frozen), kept for consumers of raw members.
  remember(declaration,lifetime=declarationLimits.cacheDefault,manifest=null){
    const previous=this.#declarations.get(declaration.issuer)?.declaration;
    this.#declarations.set(declaration.issuer,{declaration,manifest:freeze(manifest),expiresAt:this.clock()+Math.min(Math.max(lifetime,0),declarationLimits.cacheMax)});
    if(JSON.stringify(previous)!==JSON.stringify(declaration))this.#notify(declaration.issuer);
    return declaration;
  }
  // Fresh declarations only; `stale:true` also returns an expired one (for synchronous UI decisions).
  declaration(issuer,{stale=false}={}){const entry=this.#declarations.get(issuer);return entry&&(stale||entry.expiresAt>this.clock())?entry.declaration:null;}
  manifest(issuer,{stale=false}={}){const entry=this.#declarations.get(issuer);return entry&&(stale||entry.expiresAt>this.clock())?entry.manifest:null;}
  degraded(issuer){return new Set(this.#degraded.get(issuer)??[]);}
  degrade(issuer,key){
    const set=this.#degraded.get(issuer)??new Set();if(set.has(key))return;
    set.add(key);this.#degraded.set(issuer,set);this.#notify(issuer);
  }
  capabilities(issuer,options={}){return computeCapabilities(this.declaration(issuer,{stale:true}),{...options,degraded:this.degraded(issuer)});}
  subscribe(listener){this.#listeners.add(listener);return ()=>this.#listeners.delete(listener);}
  #notify(issuer){for(const listener of this.#listeners)try{listener(issuer);}catch{}}
}
