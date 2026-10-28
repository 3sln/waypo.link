// HTTP route of the profile slice (packages/runtime/account/profile.mjs): `/api/profile`, the owner's display name and
// avatar preference (contacts spike CR-C4; contacts phase 4, provisional, unsigned). Per-link sharing
// (`PUT /api/contacts/{id}/sharing`) and the disclosure toggle were removed with contact links, so a save has no
// protective (withdrawal) form any more: it is capacity-admitted and terms-fenced like other content (age-policy.mjs).
// Stage handlers and route-module shape: packages/runtime/routes/index.mjs.
import {json,body} from './shared.mjs';

export function allowedMethods(path){return path==='/api/profile'?['GET','PUT']:null;}
export const stages={
 async owner({request,path,owner,object}){
  if(path!=='/api/profile')return;
  return json(await object.accountProfile(owner.account.id,request.method==='PUT'?await body(request):undefined));
 },
};
