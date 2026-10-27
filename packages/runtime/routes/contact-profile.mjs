// HTTP routes of the contact profile slice (packages/runtime/account/contact-profile.mjs): the owner's contact profile,
// per-link profile sharing, contact-link redemption and saved contacts. Kept from the Beam routes when Beam left the
// core (DEVLOG 2026-10-26); PUT /api/contacts/{id}/beam became PUT /api/contacts/{id}/sharing.
// Stage handlers and route-module shape: packages/runtime/routes/index.mjs.
import {isUUID as uuid} from '../../core/primitives.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {canonicalContactLink} from '../../links/preview.mjs';
import {contactUnknown} from '../public-unknown.mjs';
import {json,body,accountHandle} from './shared.mjs';
import {withdrawsSharing} from '../../links/sharing-fields.mjs';

const fail=(code,message,status)=>{throw new StorageError(code,message,status);};
const SHARING=/^\/api\/contacts\/([a-f0-9-]{36})\/sharing$/;
export function allowedMethods(path){
 if(path==='/api/profile')return ['GET','PUT'];
 if(path==='/api/contacts/redeem')return ['POST'];
 if(path==='/api/contacts/directory'||/^\/api\/contacts\/profile\/[^/]+$/.test(path))return ['GET'];
 if(/^\/api\/contacts\/directory\/[^/]+$/.test(path))return ['DELETE'];
 if(/^\/api\/contacts\/[^/]+\/sharing$/.test(path))return ['PUT'];
 return null;
}
// Withdrawing disclosure is protective (never refused for capacity).
export const admission={
 protective:[
  {match:path=>path==='/api/profile',test:change=>change.discloseToContacts===false},
  {match:(path,method)=>method==='PUT'&&/^\/api\/contacts\/[^/]+\/sharing$/.test(path),test:withdrawsSharing},
 ],
};
export const stages={
 async owner({request,env,url,path,owner,object}){
  if(!allowedMethods(path))return;
  const id=owner.account.id;
  if(path==='/api/profile')return json(await object.accountProfile(id,request.method==='PUT'?await body(request):undefined));
  const sharing=SHARING.exec(path);if(sharing)return json(await object.contactSharing(id,sharing[1],await body(request)));
  if(path==='/api/contacts/redeem'){
   // Wargame round 3 L2/L2b: one shared canonical parser (both URL forms), and every refusal (malformed, foreign,
   // unknown or inactive account, handle mismatch, failed verification) is the same answer, so a forged link is not
   // an account-state oracle. The identity lookup precedes the account object so an arbitrary UUID never creates
   // account storage; its outcome is indistinguishable from a link that fails verification.
   const refused=()=>fail('contact_invalid_redemption','This signed contact URL is invalid.',400);
   const input=await body(request),canonical=typeof input?.url==='string'&&input.url.length<=18000?canonicalContactLink(env.APP_ORIGIN,input.url):null;if(!canonical||!uuid(canonical.sub))refused();
   const account=await env.IDENTITY_REPOSITORY.get(canonical.sub);if(!account||account.status!=='active'||account.handle!==canonical.handle)refused();
   let binding;try{binding=await accountHandle(env,canonical.sub).contactRedeem(canonical.sub,canonical.link,id);}catch(error){if(contactUnknown(error)||error?.code==='link_malformed'||error?.code==='contact_invalid_redemption')refused();throw error;}
   return json(await object.savedContactRemember(id,binding,canonical.link));
  }
  const forget=/^\/api\/contacts\/directory\/([a-f0-9-]{36})$/.exec(path);if(forget)return json(await object.savedContactForget(id,forget[1]));
  if(path==='/api/contacts/directory'){
   const result=[];
   for(const r of await object.savedContacts(id)){
    try{const account=await env.IDENTITY_REPOSITORY.get(r.peer);if(!account||account.status!=='active')fail('contact_inactive','The contact is unavailable.',409);const info=await accountHandle(env,r.peer).contactInfo(r.peer,id,{grantId:r.grantId});result.push({...r,handle:account.handle,...info});}
    catch(error){if(!error.code)throw error;result.push({...r,profile:null});}
   }
   return json(result);
  }
  const profile=/^\/api\/contacts\/profile\/([a-f0-9-]{36})$/.exec(path);
  if(profile){const contact=(await object.savedContacts(id)).find(r=>r.peer===profile[1]);if(!contact)fail('contact_not_found','Import a signed contact link first.',404);const requested=url.searchParams.get('grantId');if(requested&&requested!==contact.grantId)fail('profile_grant_mismatch','Use this contact’s recorded grant.',403);return json(await accountHandle(env,profile[1]).contactDisclosed(profile[1],id,{grantId:contact.grantId}));}
  return json({error:'not_found'},404);
 },
};
