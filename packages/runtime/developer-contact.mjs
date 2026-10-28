// Developer contact (contacts spike rev 2 §4.7, CR-C5; provisional, unsigned, flags off). The console's "Message the
// developer" asks 3sln.me. `GET /api/developer-contact` is an eligibility read only; `POST` (same path, no new public
// endpoint) re-checks eligibility and then asks the developer identity's Parlay, through the host mint hook
// `DEVELOPER_CONTACT_MINT`, for a single-use invitation bound to the requesting user's principal (Parlay
// `invites.mint-bound`, one-hour expiry). The answer is the Bindle Messaging `connect` intent (messaging §4.1), which the
// console hands to the user's own messaging app. The invitation token is a bearer capability: 3sln.me never logs or
// stores it, and the response is no-store (routes/shared.mjs `json`).
//
// Transport gap (recorded, not solved here): no adapter yet carries the mint request from the provider to the developer
// identity's Parlay. The Parlay mailbox contract only has `describe`; a mint method needs a Parlay-published contract or
// an app-grant RPC agreed by a spec owner. Until a host configures the hook, developer contact answers like an unready
// developer account (`developer-unavailable`).
//
// This module no longer depends on packages/links (CR-C5). Contact links keep their developer link policy until contacts
// phase 4 through packages/links/audience.mjs `evaluateLinkPolicy`, which reuses `developerEvaluation` below.
import {systemBadge} from '../identity/system-bootstrap.mjs';
import {StorageError} from '../storage/policy.mjs';
import {BILLING_STATE_KEY,entitlementFromState} from '../billing/catalog.mjs';
import {encodeIntent} from '../intents/format.mjs';
import {verifyChain} from '../core/artefacts.mjs';
import connectIntent from '../../docs/artefacts/intents/connect-v1.json' with {type:'json'};

/** Billing tiers of developer contact, in the order of Parlay `invites.mint-bound` (`priority:<tier>` labels). */
export const DEVELOPER_TIERS=Object.freeze(['free','paid','plus','ultra']);
/** The bound invitation's lifetime (rethink §4.7 reference: one hour; Parlay's mint maximum). */
export const DEVELOPER_INVITE_TTL=3600000;
export const CONNECT_INTENT_KIND='https://spec.bindle.example/messaging/v1/intents/connect';

export async function developerContactTier(controller,owner){
 await controller.warm(owner);await controller.billingRefresh(owner,{force:true});
 const state=await controller.metadata.get(BILLING_STATE_KEY);
 if(state?.owner!==owner||!['active','canceled'].includes(state.status))return 'free';
 const now=Date.now(),tier=entitlementFromState({...state,upgrade:undefined},now,controller.config).plan;
 if(tier!=='free'&&(!Number.isSafeInteger(state.reconciledAt)||state.reconciledAt>now||state.reconciledAt<now-300000))throw new StorageError('developer_contact_eligibility_unavailable','Your subscription could not be verified. Please try again shortly.',503);
 return tier;
}
/** The active-population mode ('all-active' | 'paid-only') from the census port, or null when it is unknown or stale. */
async function populationMode(config){
 let population;try{population=await config?.DEVELOPER_CONTACT_POPULATION?.policy?.();}catch{}
 const now=Date.now();
 if(!population||!Number.isSafeInteger(population.observedAt)||!Number.isSafeInteger(population.validUntil)||population.observedAt>now||population.validUntil<=now||population.validUntil>population.observedAt+60000||!['all-active','paid-only'].includes(population.mode))return null;
 return population.mode;
}
/** One eligibility decision from a billing tier: paid tiers are eligible; a free account is eligible only while the
 * active population is below the threshold ('all-active'); anything unknown is unavailable.
 * Results: {eligible, reason?, tier, tags?, final} or {state:'unavailable'}. */
export async function developerDecision(config,tier){
 if(DEVELOPER_TIERS.includes(tier)&&tier!=='free')return {eligible:true,tier,tags:['priority:'+tier],final:tier==='ultra'};
 const mode=await populationMode(config);if(!mode)return {state:'unavailable'};
 return mode==='paid-only'?{eligible:false,reason:'paid-required',tier:'free'}:{eligible:true,tier:'free',tags:['priority:free'],final:false};
}
/** The developer evaluation run on an AccountController for one same-host principal: the principal's tier from its own
 * account (this one, or through CONVERSATION_ACCOUNT), then `developerDecision`. Used by the contact-link policy
 * evaluator (packages/links/audience.mjs) until contacts phase 4. */
export async function developerEvaluation(controller,principal){
 let tier;try{if(principal.subject===await controller.metadata.get('owner'))tier=await controller.gated(()=>developerContactTier(controller,principal.subject));else{const result=await controller.config.CONVERSATION_ACCOUNT?.(principal.subject)?.invoke({method:'developerContactTier',args:[principal.subject]});if(typeof result!=='string')return {state:'unavailable'};tier=result;}}catch{return {state:'unavailable'};}
 return developerDecision(controller.config,tier);
}

/** The configured developer handle, or null when developer contact is off (unset or blank configuration). */
export function developerContactHandle(env){const value=env?.DEVELOPER_CONTACT_HANDLE;return typeof value==='string'&&value.trim()?value.trim():null;}

// The `connect` kind reference ({artefact, version, digest}) from the reviewed artefact snapshot, verified once.
let connectReference;
export function connectKindReference(){
 connectReference??=verifyChain(connectIntent,{id:CONNECT_INTENT_KIND,kind:'intent',validateBody:body=>body?.id===CONNECT_INTENT_KIND&&body.capability===true}).then(result=>Object.freeze({artefact:result.id,version:result.version,digest:result.digest}));
 return connectReference;
}
const TOKEN=/^[A-Za-z0-9_-]{22,43}$/;
// The minted `connect` data, checked before it leaves: the members and bounds of messaging §4.1, the inviter is the
// developer identity on this host, and the expiry is at most the requested hour (plus clock slack) away. Handlers
// validate the data against the kind again (messaging §4.2 step 1); this module stays free of the intent-kind schema
// code, which still reaches packages/links until contacts phase 4.
function connectData(data,{origin,developer,now}){
 if(!data||typeof data!=='object'||Array.isArray(data))return null;
 const keys=Object.keys(data);if(!keys.every(k=>['inviter','token','delegation','expires_at','hint'].includes(k)))return null;
 if(!data.inviter||typeof data.inviter!=='object'||Object.keys(data.inviter).sort().join()!=='iss,sub'||data.inviter.iss!==origin||data.inviter.sub!==developer)return null;
 if(typeof data.token!=='string'||!TOKEN.test(data.token)||typeof data.delegation!=='string'||!data.delegation.length||data.delegation.length>2048)return null;
 if(!Number.isSafeInteger(data.expires_at)||data.expires_at*1000<=now||data.expires_at*1000>now+DEVELOPER_INVITE_TTL+60000)return null;
 if(data.hint!==undefined&&data.hint!=='no-reply')return null;
 return data;
}

/** The configured developer identity, or null: DEVELOPER_CONTACT_HANDLE names an active identity holding the developer
 * system badge for that handle. */
async function developerIdentity(env){
 const handle=developerContactHandle(env);if(!handle)return null;
 const recipient=await env.IDENTITY_REPOSITORY.findByHandle(handle),badge=systemBadge(recipient);
 if(recipient?.status!=='active'||!badge||badge.role!=='developer'||badge.handle!==handle)return null;
 return {recipient,badge};
}
/** Eligibility of the requesting (same-host) user: billing tier from the user's own account, then the population mode. */
async function requesterEligibility(env,owner,account){
 let tier;try{tier=await account.developerContactTier(owner.account.id);if(typeof tier!=='string')return {state:'unavailable'};}catch{return {state:'unavailable'};}
 try{return await developerDecision(env,tier);}catch{return {state:'unavailable'};}
}
const eligibilityView=decision=>decision.state==='unavailable'?{state:'unavailable'}:{state:decision.eligible?'eligible':'ineligible',...decision.reason?{reason:decision.reason}:{},...decision.tier?{tier:decision.tier}:{}};

export async function developerContactRoutes({path,request,env,owner,object,accountHandle,body,json,limit,remoteIP}){
 if(path!=='/api/developer-contact')return null;
 if(!['GET','POST'].includes(request.method))return json({error:'method_not_allowed'},405,{Allow:'GET, POST'});
 if(limit&&!await limit(env,{operation:'developer-contact',remoteIP,handle:owner.account.id}))return json({error:'rate_limited'},429,{'Retry-After':'60'});
 if(request.method==='POST'&&body){let input;try{input=await body(request,1024);}catch(error){return json({error:error.code??'invalid_request'},error.status??400);}if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)return json({error:'invalid_request'},400);}
 // No built-in default: an unset DEVELOPER_CONTACT_HANDLE, a missing developer identity or an unconfigured mint hook all
 // answer like an unready developer account, so the console keeps its existing copy.
 const mint=env.DEVELOPER_CONTACT_MINT;
 if(typeof mint!=='function'||!developerContactHandle(env))return json({available:false,reason:'developer-unavailable'});
 const developer=await developerIdentity(env);if(!developer)return json({available:false,reason:'developer-unavailable'});
 const account=object??accountHandle(env,owner.account.id),decision=await requesterEligibility(env,owner,account),eligibility=eligibilityView(decision);
 if(request.method==='GET')return json({available:true,eligibility,recipientBadge:developer.badge});
 if(eligibility.state!=='eligible')return json({error:eligibility.state==='unavailable'?'eligibility_unavailable':'not_eligible',eligibility},eligibility.state==='unavailable'?503:403);
 const {recipient}=developer,now=Date.now();
 let data,kind;
 try{
  kind=await connectKindReference();
  const minted=await mint({developer:{id:recipient.id,handle:recipient.handle},principal:{issuer:env.APP_ORIGIN,subject:owner.account.id},tier:decision.tier,expiresIn:DEVELOPER_INVITE_TTL});
  data=connectData(minted,{origin:env.APP_ORIGIN,developer:recipient.id,now});
 }catch{data=null;}
 // Nothing about a failed mint is echoed or logged: the hook's answer may hold the token.
 if(!data)return json({error:'developer_unavailable',available:false,reason:'developer-unavailable'},503);
 let value;try{value=encodeIntent({bintent:1,kind:{artefact:kind.artefact,version:kind.version,digest:kind.digest},data,exp:data.expires_at});}catch{return json({error:'developer_unavailable',available:false,reason:'developer-unavailable'},503);}
 return json({intent:{value,url:'web+bindle://intent?bintent='+value},expiresAt:data.expires_at*1000});
}
