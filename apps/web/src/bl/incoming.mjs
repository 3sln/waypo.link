import {loadActivity,activityIntent,activityEnabled} from './activity.mjs';
import {OwnerFlow,snapshot,publish,expireOwner} from './owner-flow.mjs';
import {intentsAvailable} from './contact-link.mjs';
import {decodeIntent} from '../../../../packages/intents/format.mjs';
const split=v=>String(v??'').split(',').map(x=>x.trim()).filter(Boolean);
export async function loadIncoming(r,ctx,{more=false}={}){try{if(!more&&await loadActivity(r,ctx))return;}catch(error){if(error.status===401){expireOwner(r,ctx);return;}throw error;}if(more&&!snapshot(r).incoming?.cursor)return;const owner=snapshot(r).session?.account?.id,generation=snapshot(r).beamGeneration??0;if(!owner||snapshot(r).offline)return;const id=snapshot(r).incomingView??'all',ticket=r.browser.id(),live=()=>snapshot(r).session?.account?.id===owner&&(snapshot(r).beamGeneration??0)===generation&&!snapshot(r).offline&&snapshot(r).incomingTicket===ticket;publish(r,ctx,{incomingLoading:true,incomingError:'',incomingTicket:ticket});try{const result=await r.api.get('/api/views');if(!live())return;const views=result.views,view=views.find(v=>v.id===id)??views[0];publish(r,ctx,{data:{...snapshot(r).data,views}});if(!view){publish(r,ctx,{incoming:{items:[]},incomingLoading:false});return;}const query=new URLSearchParams({view:view.id,viewRevision:String(view.revision),limit:'50'});if(more&&snapshot(r).incoming?.cursor)query.set('cursor',snapshot(r).incoming.cursor);const incoming=await r.api.get('/api/incoming?'+query);if(!live())return;publish(r,ctx,{incomingView:view.id,incoming:{...incoming,items:more?[...(snapshot(r).incoming?.items??[]),...incoming.items]:incoming.items},incomingLoading:false});}catch(error){if(live()&&error.status===401){expireOwner(r,ctx,generation);return;}if(live())publish(r,ctx,{incomingLoading:false,incomingError:['cursor_stale','view_conflict'].includes(error.code)?'This View or its messages changed. Reload to continue.':'Messages could not be loaded. Please try again.'});}}
export class LoadIncoming extends OwnerFlow{constructor(d={}){super(d);this.mutation=!!d.activityAction&&!['filter','reload','next','previous','search','revision','close','push-load','explain'].includes(d.activityAction);}async perform(r,ctx,d){if(d.activityAction){await activityIntent(r,ctx,d);return;}await loadIncoming(r,ctx,d);}}
export class SelectView extends OwnerFlow{mutation=false;async perform(r,ctx,d){if(activityEnabled(snapshot(r))){publish(r,ctx,{view:'inbox'});await loadActivity(r,ctx);return;}publish(r,ctx,{view:'inbox',incomingView:d.id,incoming:null,selected:null,messageDetail:null,messageRender:null});await loadIncoming(r,ctx);}}
export class SaveView extends OwnerFlow{async perform(r,ctx,d){const v=d.values,old=snapshot(r).modal?.view,filter={version:1,...old?.filter?.receivedAfter!==undefined?{receivedAfter:old.filter.receivedAfter}:{},...old?.filter?.receivedBefore!==undefined?{receivedBefore:old.filter.receivedBefore}:{}},tags=split(v.tagsAll);if(tags.length>32||tags.some(t=>t.length>64)||new Set(tags).size!==tags.length)throw Error('Use up to 32 distinct tags, with up to 64 characters each.');if(tags.length)filter.tagsAll=tags;if(v.read!=='any')filter.read=v.read==='read';if(v.classification==='keep'&&old?.filter?.classifications)filter.classifications=[...old.filter.classifications];else if(v.classification!=='any')filter.classifications=[v.classification];const body={name:v.name,filter,sort:v.sort};
 // A create attempt keeps one operation ID while its request is unchanged, so a retry after a lost reply returns the View the service already made.
 if(!old){const fingerprint=JSON.stringify([snapshot(r).session.account.id,body]),attempt=snapshot(r).viewCreateAttempt;body.operationId=attempt?.fingerprint===fingerprint?attempt.operationId:r.browser.id();publish(r,ctx,{viewCreateAttempt:{fingerprint,operationId:body.operationId}});}
 const result=await r.api.request('/api/views'+(old?'/'+encodeURIComponent(old.id):''),{...body,...old?{expectedRevision:old.revision}:{}},old?'PUT':'POST');publish(r,ctx,{modal:null,viewCreateAttempt:null,incomingView:result.view?.id??result.id??old?.id??'all',incoming:null,notice:'View saved.'});await loadIncoming(r,ctx);}}
export class DeleteView extends OwnerFlow{async perform(r,ctx){const view=snapshot(r).modal?.view;if(!view)return;await r.api.request('/api/views/'+encodeURIComponent(view.id),{expectedRevision:view.revision},'DELETE');publish(r,ctx,{modal:null,incomingView:'all',incoming:null,notice:'View deleted. Messages are kept.'});await loadIncoming(r,ctx);}}

// "Message the developer" (contacts spike CR-C5/CR-C8; provisional, unsigned). GET /api/developer-contact is an
// eligibility read only. POST mints a single-use invitation bound to this account on the developer identity's Parlay and
// answers with the Bindle Messaging `connect` intent, which the console hands to the user's own messaging app. The
// invitation token is a bearer capability: it lives only in browser.secret('developerContactURL'), scoped to the owner
// and session generation, never in persisted or rendered state.
const CONNECT_KIND='https://spec.bindle.example/messaging/v1/intents/connect',STATES=['eligible','ineligible','unavailable'];
const eligibilityOf=e=>{const state=STATES.includes(e?.state)?e.state:'unavailable';return {state,...typeof e?.reason==='string'?{reason:e.reason}:{},...typeof e?.tier==='string'?{tier:e.tier}:{}};};
const unavailableContact=result=>({available:false,reason:typeof result?.reason==='string'?result.reason:'contact-unavailable'});
const storedInvitation=r=>{const record=r.browser.secret('developerContactURL');return record?.owner===snapshot(r).session?.account?.id&&record.generation===(snapshot(r).beamGeneration??0)&&Number.isSafeInteger(record.expiresAt)&&record.expiresAt>Date.now()+60000?record:null;};
// The minted answer is untrusted until checked: one unsigned `connect` intent value, its scheme URL, and a bounded expiry.
function invitationOf(result){
 const value=result?.intent?.value,url=result?.intent?.url,expiresAt=result?.expiresAt;
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,6400}$/.test(value)||url!=='web+bindle://intent?bintent='+value||!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+3660000)return null;
 try{if(decodeIntent(value).kind.artefact!==CONNECT_KIND)return null;}catch{return null;}
 return {value,url,expiresAt};
}
// The provider's intent router (fragment placement, never sent to a server) when intents are on for this account;
// otherwise the scheme URL, which the browser hands to a registered messaging app.
const handoffTarget=(s,record)=>intentsAvailable(s)?'/i#bintent='+record.value:record.url;
const failures={not_eligible:'Your account is not currently eligible to message the developer.',eligibility_unavailable:'Your eligibility could not be checked right now. Try again shortly.',developer_unavailable:'The platform developer account is not ready to receive messages.',rate_limited:'Please wait before trying again.'};
export class LoadDeveloperContact extends OwnerFlow{mutation=false;async perform(r,ctx){publish(r,ctx,{developerContactLoading:true});try{const result=await r.api.get('/api/developer-contact');r.browser.storeSecret('developerContactURL',null);if(result?.available!==true){publish(r,ctx,{developerContact:unavailableContact(result)});return;}publish(r,ctx,{developerContact:{available:true,eligibility:eligibilityOf(result.eligibility),...result.recipientBadge&&typeof result.recipientBadge==='object'?{recipientBadge:result.recipientBadge}:{}}});}catch(error){if(this.detail.quiet&&error.status!==401)return;if(error.code==='rate_limited')throw Error('Please wait before checking again.');throw error;}finally{publish(r,ctx,{developerContactLoading:false});}}}
// Mints (or reuses this session's unexpired) invitation and hands it off. Eligibility is checked again by the server.
export class OpenDeveloperContact extends OwnerFlow{async perform(r,ctx){
 const owner=snapshot(r).session.account.id,generation=snapshot(r).beamGeneration??0;let record=storedInvitation(r);
 if(!record){
  if(snapshot(r).developerContact?.available!==true||snapshot(r).developerContact.eligibility?.state!=='eligible')return;
  let result;try{result=await r.api.request('/api/developer-contact',{},'POST');}catch(error){
   if(['not_eligible','eligibility_unavailable'].includes(error.code)&&snapshot(r).developerContact?.available===true)publish(r,ctx,{developerContact:{...snapshot(r).developerContact,eligibility:{state:error.code==='not_eligible'?'ineligible':'unavailable'},invitation:null}});
   if(error.code==='developer_unavailable')publish(r,ctx,{developerContact:{available:false,reason:'developer-unavailable'}});
   if(failures[error.code])throw Error(failures[error.code]);throw error;}
  if(result?.available===false){publish(r,ctx,{developerContact:unavailableContact(result)});return;}
  const invitation=invitationOf(result);if(!invitation)throw Error('Developer contact is not available right now. Try again later.');
  record={...invitation,owner,generation};r.browser.storeSecret('developerContactURL',record);
  publish(r,ctx,{developerContact:{...snapshot(r).developerContact,invitation:{expiresAt:record.expiresAt}}});
 }
 r.browser.navigate(handoffTarget(snapshot(r),record));
}}
export class CopyDeveloperContact extends OwnerFlow{async perform(r,ctx){const record=storedInvitation(r);if(record){await r.browser.copy(record.url);publish(r,ctx,{notice:'Invitation link copied.'});}}}
