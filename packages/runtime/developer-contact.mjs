import {systemBadge} from '../identity/system-bootstrap.mjs';
import {StorageError} from '../storage/policy.mjs';
import {BILLING_STATE_KEY,entitlementFromState} from '../billing/catalog.mjs';
import {developerPolicy,evaluateRegisteredPolicy} from '../links/policies.mjs';
export const DEVELOPER_CONTACT_TAGS=Object.freeze({free:['contact:developer','priority:free'],paid:['contact:developer','priority:paid'],plus:['contact:developer','priority:plus'],ultra:['contact:developer','priority:ultra']});
export async function developerContactTier(controller,owner){
 await controller.warm(owner);await controller.billingRefresh(owner,{force:true});
 const state=await controller.metadata.get(BILLING_STATE_KEY);
 if(state?.owner!==owner||!['active','canceled'].includes(state.status))return 'free';
 const now=Date.now(),tier=entitlementFromState({...state,upgrade:undefined},now,controller.config).plan;
 if(tier!=='free'&&(!Number.isSafeInteger(state.reconciledAt)||state.reconciledAt>now||state.reconciledAt<now-300000))throw new StorageError('developer_contact_eligibility_unavailable','Your subscription could not be verified. Please try again shortly.',503);
 return tier;
}
// Developer contact is one conditional link owned by the system developer identity
// (links §7, architecture bindle-links "Developer contact"). The operator policy registry
// (packages/links/policies.mjs, slice C1a) holds its policy; nobody else can name or parameterize a policy.
export {DEVELOPER_CONTACT_POLICY,developerPolicy,linkPolicyRegistry} from '../links/policies.mjs';
// Same-host principals only; the decision depends on nothing the audience supplies beyond the principal.
export function evaluateLinkPolicy(controller,policy,principal){return evaluateRegisteredPolicy({origin:controller.config.APP_ORIGIN,config:controller.config,policy,principal,evaluators:{[developerPolicy(controller.config)]:subject=>developerEvaluation(controller,subject)}});}
// The developer-contact evaluator of the registry: billing tier first, then the active-population mode.
async function developerEvaluation(controller,principal){
 let tier;try{if(principal.subject===await controller.metadata.get('owner'))tier=await controller.gated(()=>developerContactTier(controller,principal.subject));else{const result=await controller.config.CONVERSATION_ACCOUNT?.(principal.subject)?.invoke({method:'developerContactTier',args:[principal.subject]});if(typeof result!=='string')return {state:'unavailable'};tier=result;}}catch{return {state:'unavailable'};}
 if(Object.hasOwn(DEVELOPER_CONTACT_TAGS,tier)&&tier!=='free')return {eligible:true,tier,tags:['priority:'+tier],final:tier==='ultra'};
 let population;try{population=await controller.config.DEVELOPER_CONTACT_POPULATION?.policy?.();}catch{}
 const now=Date.now();
 if(!population||!Number.isSafeInteger(population.observedAt)||!Number.isSafeInteger(population.validUntil)||population.observedAt>now||population.validUntil<=now||population.validUntil>population.observedAt+60000||!['all-active','paid-only'].includes(population.mode))return {state:'unavailable'};
 return population.mode==='paid-only'?{eligible:false,reason:'paid-required',tier:'free'}:{eligible:true,tier:'free',tags:['priority:free'],final:false};
}
// Developer contact (DEVLOG 2026-10-27 "Messaging removed from core; Parlay rename; BB-CUT reset"): the link the developer
// account's messaging-ingress occupant issued through the links contract with the developer policy
// (account/links.mjs `developerOccupantLink`); the console hands it off as a `send-message` intent to the sender's own
// messaging app. The legacy core contact grant (`developer-contact/v1|v2`, daily grants) and the
// DEVELOPER_CONTACT_MODE switch were removed with core messaging; the BB-CUT reset deleted their rows.
export async function developerContactLink(controller,owner){return controller.developerOccupantLink(owner);}

export async function developerContactRoutes({path,request,env,owner,accountHandle,json,limit,remoteIP}){
 if(path!=='/api/developer-contact')return null;
 if(request.method!=='GET')return json({error:'method_not_allowed'},405,{Allow:'GET'});
 if(limit&&!await limit(env,{operation:'developer-contact',remoteIP,handle:owner.account.id}))return json({error:'rate_limited'},429,{'Retry-After':'60'});
 const recipientHandle=env.DEVELOPER_CONTACT_HANDLE??'ray',recipient=await env.IDENTITY_REPOSITORY.findByHandle(recipientHandle);
 const badge=systemBadge(recipient);
 if(recipient?.status!=='active'||!badge||badge.role!=='developer'||badge.handle!==recipientHandle)return json({available:false,reason:'developer-unavailable'});
 const receiver=accountHandle(env,recipient.id),link=await receiver.developerContactLink(recipient.id,recipient.handle);
 if(!link.available)return json({available:false,reason:link.reason??'contact-unavailable'});
 // Eligibility under the link's own bounded policy reuse, then a `send-message` intent handoff in the console.
 const decision=await receiver.developerLinkDecide(recipient.id,link.jti,{issuer:env.APP_ORIGIN,subject:owner.account.id});
 return json({available:true,mode:'occupant',intent:'send-message',url:link.url,expiresAt:link.expiresAt,policy:link.policy,recipientBadge:badge,eligibility:{state:decision.state,...decision.reason?{reason:decision.reason}:{},...decision.tier?{tier:decision.tier}:{}}});
}
