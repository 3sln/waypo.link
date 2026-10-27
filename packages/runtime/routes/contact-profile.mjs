// HTTP routes of the contact profile slice (packages/runtime/account/contact-profile.mjs): the owner's contact profile and
// per-link profile sharing. Redemption and saved contacts (/api/contacts/redeem, /api/contacts/directory*,
// /api/contacts/profile/*) moved with the messaging app (DEVLOG 2026-10-27; SQ-2, provisional).
// Stage handlers and route-module shape: packages/runtime/routes/index.mjs.
import {json,body} from './shared.mjs';
import {withdrawsSharing} from '../../links/sharing-fields.mjs';

const SHARING=/^\/api\/contacts\/([a-f0-9-]{36})\/sharing$/;
export function allowedMethods(path){
 if(path==='/api/profile')return ['GET','PUT'];
 if(SHARING.test(path))return ['PUT'];
 return null;
}
// Withdrawing disclosure is protective (never refused for capacity).
export const admission={
 protective:[
  {match:path=>path==='/api/profile',test:change=>change.discloseToContacts===false},
  {match:(path,method)=>method==='PUT'&&SHARING.test(path),test:withdrawsSharing},
 ],
};
export const stages={
 async owner({request,path,owner,object}){
  if(!allowedMethods(path))return;
  const id=owner.account.id;
  if(path==='/api/profile')return json(await object.accountProfile(id,request.method==='PUT'?await body(request):undefined));
  const sharing=SHARING.exec(path);if(sharing)return json(await object.contactSharing(id,sharing[1],await body(request)));
 },
};
