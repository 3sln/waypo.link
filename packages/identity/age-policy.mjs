import {Engine,Provider,Action,Query} from '../../vendor/ngin/src/index.js';

// Research snapshot: docs/release/age-requirements.md (2026-10-21).
// Wargame 2026-10-23 (provisional): EU outermost regions (TFEU Art. 349/355(1)) and Aland (Art. 355(4)) are EU
// territory but geolocate under their own ISO 3166-1 codes, so the representative block lists them explicitly.
// The caller is the runtime, never a request body or a country header.
export const AGE_POLICY=Object.freeze({default:18,countries:Object.freeze({AT:14,BE:13,BG:14,HR:16,CY:14,CZ:15,DK:13,EE:13,FI:13,FR:15,DE:16,GR:15,HU:16,IE:16,IT:14,LV:13,LT:14,LU:16,MT:13,NL:16,PL:16,PT:13,RO:16,SK:16,SI:15,ES:16,SE:13,IS:13,NO:13,LI:16,GB:13,CH:16,US:13,CA:13,AU:16,NZ:16,JP:16,KR:14,SG:13,IN:18,MX:18,AR:18,ZA:18,AE:18,SA:18,PH:18,VN:18,TH:20,MY:18,IL:18,GP:15,MQ:15,GF:15,RE:15,YT:15,MF:15,AX:13}),regions:Object.freeze({'CA-QC':14,...Object.fromEntries(['TX','FL','NE','UT','AR','LA','GA','OH','VA','ID','IL','SC'].map(region=>['US-'+region,18]))}),representativeBlocked:Object.freeze(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','NO','LI','GB','GP','MQ','GF','RE','YT','MF','AX']),blocked:Object.freeze(['CN','BR','ID','TR','RU','IR','KP','SY','CU']),blockedRegions:Object.freeze(['US-MS','US-TN','UA-43','UA-40','UA-14','UA-09'])});
// Region policy (wargame 2026-10-23, provisional). Cloudflare reports XX for an unknown country and T1 for Tor; neither
// is a country. `block-unknown` (the Worker default) maps an unknown location to XX, which blocks signup and paid
// checkout; `allow-unknown` (the Node default; self-hosting owns its representative policy) leaves it unknown.
export const UNKNOWN_COUNTRY='XX',REGION_POLICIES=Object.freeze(['block-unknown','allow-unknown']);
/** A loopback http origin (local development only). */
export function loopbackOrigin(origin){try{const url=new URL(origin);return url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/'&&!url.username&&!url.password;}catch{return false;}}
// Review L6: local development defaults to allow-unknown only on a loopback http origin; a deployed origin with
// LOCAL_DEVELOPMENT=true (a misconfiguration, docs/spec/security.md) still fails closed.
export function regionPolicy(env){const value=env?.REGION_POLICY;if(REGION_POLICIES.includes(value))return value;return value===undefined&&env?.LOCAL_DEVELOPMENT==='true'&&loopbackOrigin(env?.APP_ORIGIN)?'allow-unknown':'block-unknown';}
/** The runtime's trusted location for a request: Cloudflare's `request.cf`, or a function port only the Node adapter
 * injects (an operator-configured trusted header). Never a request body or an unconfigured header. */
export function requestAgeLocation(request,env){const source=request?.cf??(typeof env?.REGION_LOCATION_SOURCE==='function'?env.REGION_LOCATION_SOURCE(request):undefined),{country,region}=trustedAgeLocation(source);if(country!==null&&country!==UNKNOWN_COUNTRY)return {country,region};return regionPolicy(env)==='block-unknown'?{country:UNKNOWN_COUNTRY,region:null}:{country:null,region:null};}
export function trustedAgeLocation(cf){const country=typeof cf?.country==='string'&&/^[A-Z]{2}$/.test(cf.country)?cf.country:null,region=typeof cf?.regionCode==='string'&&/^[A-Z0-9]{1,3}$/.test(cf.regionCode)?cf.regionCode:null;return {country,region};}
export function ageRequirement(location={}){const {country,region}=trustedAgeLocation({country:location?.country,regionCode:location?.region}),minimumAge=AGE_POLICY.regions[country+'-'+region]??AGE_POLICY.countries[country]??AGE_POLICY.default;return {minimumAge,paidMinimumAge:country==='TH'?20:Math.max(18,minimumAge),blocked:country===UNKNOWN_COUNTRY||AGE_POLICY.representativeBlocked.includes(country)||AGE_POLICY.blocked.includes(country)||AGE_POLICY.blockedRegions.includes(country+'-'+region),...country===UNKNOWN_COUNTRY?{blockedReason:'region-unknown'}:AGE_POLICY.representativeBlocked.includes(country)?{blockedReason:'representative'}:AGE_POLICY.blocked.includes(country)||AGE_POLICY.blockedRegions.includes(country+'-'+region)?{blockedReason:'age'}:{}};}
export class AgeRequirement extends Query {static deps=['agePolicy'];constructor(location){super();this.location=location;}fetch({agePolicy}){return agePolicy.requirement(this.location);}}
export const agePolicy=Object.freeze({requirement:ageRequirement});
export async function callerAgeRequirement(cf,location=trustedAgeLocation(cf)){const engine=new Engine({providers:{agePolicy:Provider.fromSingleton(agePolicy)}});try{return await engine.query(new AgeRequirement(location)).peek();}finally{engine.dispose();}}
export class AcceptTerms extends Action {static deps=['identity'];constructor(input,context){super();this.input=input;this.context=context;}async execute({identity},{dispatchFeed,engineFeed}){const result=await identity.acceptTerms(this.input,this.context);dispatchFeed.dispatchEvent(new CustomEvent('result',{detail:result}));engineFeed.dispatchEvent(new Event('identity-updated'));}}
export class TermsCreationAllowed extends Query {static deps=['identity'];constructor(context){super();this.context=context;}async fetch({identity}){const {account}=await identity.authorized(this.context);identity.requireCurrentTerms(account);return true;}}

// Only new content and grants are fenced. Transport adapters supply trusted path/method,
// and (for multiplexed operations) the untrusted document, which cannot widen this policy.
export function createsContentOrGrant(path,method,input={}){
 if(!['POST','PUT','PATCH'].includes(method))return false;
 if(/^\/api\/automation\/(?:prepare|invoke)$/.test(path))return input.name==='item_write';
 if(path==='/api/automation/confirm')return false;
 if(path==='/api/rules'&&method==='PUT')return !Array.isArray(input.rules)||input.rules.length>0;
 if(path==='/api/connections/owner')return ['connections.connect','connections.connect-built-in','connections.resume','connections.approve','connections.occupy','connections.configure-seat'].includes(input.operation);
 if(path==='/api/connections/setup')return input.action==='save';
 // `/api/profile` (display name and avatar, shown to apps through the identity profile resource) is content. Since
 // contacts phase 4 removed the disclosure toggle there is no protective withdrawal body any more, so every save is fenced.
 if(path==='/api/profile')return true;
 if(/^\/api\/events\/buses\/[^/]+\/features$/.test(path))return input.read===true||input.publish===true;
 return /^\/api\/(?:views\/[^/]+|rules\/[^/]+\/restore|collections|views|rules|tags\/labels|resources|integrations\/google\/(?:start|complete)|integrations\/records|automation\/grant|apps\/[^/]+\/grants|connections|mcp\/approve|events\/buses)$/.test(path)||/^\/api\/(?:resources\/[^/]+\/(?:objects|upload)|messages\/[^/]+\/postbacks\/prepare|events\/buses\/[^/]+\/history|integrations\/records\/[^/]+\/reconfirm)$/.test(path);
}
export class TermsRequestAllowed extends Query {static deps=['identity'];constructor(context,input){super();this.context=context;this.input=input;}async fetch({identity}){if(createsContentOrGrant(this.input.path,this.input.method,this.input.document)){const {account}=await identity.authorized(this.context);identity.requireCurrentTerms(account);}return true;}}

// Used only after the HTTP adapter verifies an existing bearer capability's owner.
export class TermsSubjectAllowed extends Query {static deps=['identity'];constructor(owner){super();this.owner=owner;}async fetch({identity}){const account=await identity.repository.get(this.owner);if(!account||account.status!=='active')throw Object.assign(Error('Account authority is no longer active.'),{code:'unauthorized',status:401});identity.requireCurrentTerms(account);return true;}}

// Checkout always requires a fresh paid-age attestation using the runtime's trusted location.
export class PaidCheckoutAllowed extends Query {static deps=['identity'];constructor(input,context){super();this.input=input;this.context=context;}async fetch({identity}){await identity.authorized(this.context,true);identity.ageAttestation(this.input,this.context,{paid:true});return true;}}

// Existing grants retain read/delete/revoke authority. Unknown mutating RPC methods fail closed.
export function rpcCreatesContentOrGrant({method,args}={}){if(method==='presign')return args?.operation==='write';return !['get','list','read','describe','capabilities','changes','delete','revoke','rotate','leave','disconnect','forget','end','ack','acknowledge','unsubscribe','cancel'].includes(method);}
export class TermsAccountAllowed extends Query {static deps=['repository','legalConfig'];constructor(owner){super();this.owner=owner;}async fetch({repository,legalConfig}){const account=await repository.get(this.owner);if(!account||account.status!=='active')throw Object.assign(Error('Account authority is no longer active.'),{code:'unauthorized',status:401});if(typeof legalConfig.termsVersion!=='string'||!legalConfig.termsVersion||account.termsVersion!==legalConfig.termsVersion)throw Object.assign(Error('Accept the current terms before creating content or granting access.'),{code:'terms_acceptance_required',status:403});return true;}}
export async function subjectTermsAllowed(repository,termsVersion,owner){const engine=new Engine({providers:{repository:Provider.fromSingleton(repository),legalConfig:Provider.fromSingleton({termsVersion})}});try{return await engine.query(new TermsAccountAllowed(owner)).peek();}finally{engine.dispose();}}
