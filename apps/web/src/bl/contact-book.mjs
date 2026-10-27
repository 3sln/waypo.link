// Saved signed contacts, the owner's optional contact profile, and per-link
// profile sharing. State lives under `contactBook` and is cleared on every
// account reset (see account-context.mjs and release.mjs).
import {GuardedAction,snapshot,publish} from './guarded-action.mjs';
export const PROFILE_FIELDS=['displayName','bio','avatar'];
const merge=(r,ctx,patch)=>publish(r,ctx,{contactBook:{...snapshot(r).contactBook,...patch}});
const values=(r,d)=>d.operationId?r.browser.consumeSubmission(d.operationId):d.values;
// `profileStatus` (bug hunt F1): 'loading' until GET /api/profile answers, then 'loaded' (or 'error'). The profile form
// stays read-only for saving until 'loaded', so a save can never replace the stored profile with the empty
// placeholder fields; the server also refuses a save whose `expectedRevision` no longer matches.
async function load(r,ctx){const owner=snapshot(r).session.account.id;if(snapshot(r).contactBook?.profileStatus!=='loaded')merge(r,ctx,{profileStatus:'loading'});
 try{const [directory,profile]=await Promise.all([r.api.get('/api/contacts/directory'),r.api.get('/api/profile')]);if(snapshot(r).session?.account.id!==owner||snapshot(r).offline)return;merge(r,ctx,{directory:Array.isArray(directory)?directory:directory?.contacts??[],profile:profile??{},profileStatus:'loaded'});}
 catch(error){if(snapshot(r).contactBook?.profileStatus==='loading')merge(r,ctx,{profileStatus:'error'});throw error;}}
export const profileReady=state=>state.contactBook?.profileStatus==='loaded';
// After a confirmed mutation the outcome is published first; a failed refresh only reports stale data.
async function reloadAfter(r,ctx,patch){publish(r,ctx,{...patch,error:''});try{await load(r,ctx);}catch(error){if(error.status===401)throw error;publish(r,ctx,{error:'Your change was saved, but the latest information could not be loaded. Reload to see it.'});}}
export class LoadContactBook extends GuardedAction {async perform(r,ctx,d){const url=d.addContact?r.browser.secret('addContactURL'):null;if(url)publish(r,ctx,{view:'contacts',addContactURL:url});await load(r,ctx);}}
export class RedeemContact extends GuardedAction {mutation=true;async perform(r,ctx,d){const v=values(r,d);await r.api.request('/api/contacts/redeem',{url:v.url});r.browser.storeSecret('addContactURL',null);await reloadAfter(r,ctx,{modal:null,addContactURL:null,notice:'Signed contact saved.'});}}
export class UpdateContactSharing extends GuardedAction {mutation=true;async perform(r,ctx,d){const v=values(r,d);if(!v)return;const profileFields=PROFILE_FIELDS.filter(field=>v['profile:'+field]==='on');await r.api.request(`/api/contacts/${encodeURIComponent(d.id)}/sharing`,{profileFields},'PUT');publish(r,ctx,{data:await r.api.get('/api/account'),modal:null,notice:'Contact sharing permissions saved.',error:''});r.browser.restoreFocus?.();}}
export const PROFILE_WITHDRAWN_STALE='Profile sharing is now off. Your other changes were not saved because your contact profile changed in another session; the latest version is shown.';
export const PROFILE_STALE='Your contact profile changed in another session. The latest version is shown; review it and save again.';
export class SaveProfile extends GuardedAction {mutation=true;async perform(r,ctx,d){const book=snapshot(r).contactBook;if(book?.profileStatus!=='loaded')throw Error('Your contact profile is still loading. Try again when it has loaded.');r.browser.captureFocus?.();const v=values(r,d),revision=book.profile?.revision;
  let profile;try{profile=await r.api.request('/api/profile',{displayName:v.displayName,bio:v.bio,avatar:v.avatar,discloseToContacts:v.discloseToContacts==='on',...typeof revision==='string'?{expectedRevision:revision}:{}},'PUT');}
  catch(error){if(error.code!=='profile_stale')throw error;const latest=await r.api.get('/api/profile');merge(r,ctx,{profile:latest??{},profileStatus:'loaded',profileEpoch:(book.profileEpoch??0)+1});throw Error(PROFILE_STALE);}
  // A stale save that turns sharing off applies only the withdrawal (server L-1); the other fields keep the newer
  // stored values, so the owner is told instead of seeing "saved" over text that was not stored (bug hunt round 3, B1).
  if(['displayName','bio','avatar'].some(field=>profile?.[field]!==v[field])){merge(r,ctx,{profile:profile??{},profileStatus:'loaded',profileEpoch:(book.profileEpoch??0)+1});throw Error(PROFILE_WITHDRAWN_STALE);}
  merge(r,ctx,{profile});publish(r,ctx,{notice:'Contact profile saved.',error:''});r.browser.restoreFocus?.();}}
// Removing a saved contact is confirmed in a dialog first, like revoking a contact link (bug hunt F11).
export class RemoveSavedContact extends GuardedAction {mutation=true;async perform(r,ctx,d){const m=snapshot(r).modal;if(m?.kind!=='remove-saved-contact'||m.contact?.peer!==d.peer)throw Error('Review the contact you are removing, then confirm.');await r.api.request(`/api/contacts/directory/${encodeURIComponent(d.peer)}`,{},'DELETE');await reloadAfter(r,ctx,{modal:null,notice:'Saved contact removed.'});r.browser.focus?.('.saved-contacts h2');}}
export class CopySavedContact extends GuardedAction {async perform(r,ctx,d){const contact=snapshot(r).contactBook?.directory?.find(contact=>contact.peer===d.peer);if(contact?.url){await r.browser.copy(contact.url);publish(r,ctx,{notice:'Link copied.',error:''});}}}
