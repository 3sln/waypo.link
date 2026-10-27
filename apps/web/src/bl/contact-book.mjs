// Saved signed contacts, the owner's optional contact profile, and per-link
// profile sharing. State lives under `contactBook` and is cleared on every
// account reset (see account-context.mjs and release.mjs).
import {GuardedAction,snapshot,publish} from './guarded-action.mjs';
export const PROFILE_FIELDS=['displayName','bio','avatar'];
const merge=(r,ctx,patch)=>publish(r,ctx,{contactBook:{...snapshot(r).contactBook,...patch}});
const values=(r,d)=>d.operationId?r.browser.consumeSubmission(d.operationId):d.values;
async function load(r,ctx){const owner=snapshot(r).session.account.id;const [directory,profile]=await Promise.all([r.api.get('/api/contacts/directory'),r.api.get('/api/profile')]);if(snapshot(r).session?.account.id!==owner||snapshot(r).offline)return;merge(r,ctx,{directory:Array.isArray(directory)?directory:directory?.contacts??[],profile:profile??{}});}
// After a confirmed mutation the outcome is published first; a failed refresh only reports stale data.
async function reloadAfter(r,ctx,patch){publish(r,ctx,{...patch,error:''});try{await load(r,ctx);}catch(error){if(error.status===401)throw error;publish(r,ctx,{error:'Your change was saved, but the latest information could not be loaded. Reload to see it.'});}}
export class LoadContactBook extends GuardedAction {async perform(r,ctx,d){const url=d.addContact?r.browser.secret('addContactURL'):null;if(url)publish(r,ctx,{view:'contacts',addContactURL:url});await load(r,ctx);}}
export class RedeemContact extends GuardedAction {mutation=true;async perform(r,ctx,d){const v=values(r,d);await r.api.request('/api/contacts/redeem',{url:v.url});r.browser.storeSecret('addContactURL',null);await reloadAfter(r,ctx,{modal:null,addContactURL:null,notice:'Signed contact saved.'});}}
export class UpdateContactSharing extends GuardedAction {mutation=true;async perform(r,ctx,d){const v=values(r,d);if(!v)return;const profileFields=PROFILE_FIELDS.filter(field=>v['profile:'+field]==='on');await r.api.request(`/api/contacts/${encodeURIComponent(d.id)}/sharing`,{profileFields},'PUT');publish(r,ctx,{data:await r.api.get('/api/account'),modal:null,notice:'Contact sharing permissions saved.',error:''});}}
export class SaveProfile extends GuardedAction {mutation=true;async perform(r,ctx,d){const v=values(r,d);const profile=await r.api.request('/api/profile',{displayName:v.displayName,bio:v.bio,avatar:v.avatar,discloseToContacts:v.discloseToContacts==='on'},'PUT');merge(r,ctx,{profile});publish(r,ctx,{notice:'Contact profile saved.',error:''});}}
export class RemoveSavedContact extends GuardedAction {mutation=true;async perform(r,ctx,d){await r.api.request(`/api/contacts/directory/${encodeURIComponent(d.peer)}`,{},'DELETE');await reloadAfter(r,ctx,{notice:'Saved contact removed.'});}}
export class CopySavedContact extends GuardedAction {async perform(r,ctx,d){const contact=snapshot(r).contactBook?.directory?.find(contact=>contact.peer===d.peer);if(contact?.url){await r.browser.copy(contact.url);publish(r,ctx,{notice:'Link copied.',error:''});}}}
