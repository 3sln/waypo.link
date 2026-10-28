// HTTP route of developer contact (contacts spike §4.7, CR-C5; packages/runtime/developer-contact.mjs): GET
// `/api/developer-contact` is an eligibility read; POST mints a principal-bound invitation and answers with the Bindle
// Messaging `connect` intent. It moved here from the removed contact-link routes (routes/contacts.mjs, contacts phase 4).
// POST is exempt from capacity admission: it stores nothing in this account, so a full account can still reach support.
// Stage handlers and route-module shape: packages/runtime/routes/index.mjs.
import {developerContactRoutes} from '../developer-contact.mjs';
import {json,body,limit,accountHandle,flagEnabled} from './shared.mjs';

export function allowedMethods(path){return path==='/api/developer-contact'?['GET','POST']:null;}
export const admission={exempt:path=>path==='/api/developer-contact'};
export const stages={
 async owner({request,env,path,owner,object,context}){
  if(path!=='/api/developer-contact')return;
  const intentRoute=flagEnabled(env,'INTENT_LINKS_ENABLED',{request,subject:{kind:'account',owner:owner.account.id}});
  return developerContactRoutes({path,request,env,owner,object,accountHandle,body,json,limit,remoteIP:context.remoteIP,intentRoute});
 },
};
