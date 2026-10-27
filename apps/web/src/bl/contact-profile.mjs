// The owner's optional contact profile and per-link profile sharing. Contact links themselves are created and managed
// by the owner's apps (messaging left the core on 2026-10-27); the console only edits the profile and chooses which
// fields each live link (a "contact parent", keyed by its record jti in `data.contacts`) may disclose. State lives under
// `contactProfile` and is cleared on every account reset (see account-context.mjs and release.mjs).
import {GuardedAction,snapshot,publish} from './guarded-action.mjs';
export const PROFILE_FIELDS=['displayName','bio','avatar'];
const merge=(r,ctx,patch)=>publish(r,ctx,{contactProfile:{...snapshot(r).contactProfile,...patch}});
const values=(r,d)=>d.operationId?r.browser.consumeSubmission(d.operationId):d.values;
// `status` (bug hunt F1): 'loading' until GET /api/profile answers, then 'loaded' (or 'error'). The profile form
// stays read-only for saving until 'loaded', so a save can never replace the stored profile with the empty
// placeholder fields; the server also refuses a save whose `expectedRevision` no longer matches.
async function load(r,ctx){const owner=snapshot(r).session.account.id;if(snapshot(r).contactProfile?.status!=='loaded')merge(r,ctx,{status:'loading'});
 try{const profile=await r.api.get('/api/profile');if(snapshot(r).session?.account.id!==owner||snapshot(r).offline)return;merge(r,ctx,{profile:profile??{},status:'loaded'});}
 catch(error){if(snapshot(r).contactProfile?.status==='loading')merge(r,ctx,{status:'error'});throw error;}}
export const profileReady=state=>state.contactProfile?.status==='loaded';
/** The live contact links the owner's apps created, as listed by the account snapshot. */
export const sharingLinks=state=>(Array.isArray(state.data?.contacts)?state.data.contacts:[]).filter(link=>link?.active===true&&typeof link.id==='string');
// The automatic load on entering Account & security is quiet: the panel shows its own error state, so a failure adds no
// page alert there; an explicit load still reports it.
export class LoadContactProfile extends GuardedAction {async perform(r,ctx,d){try{await load(r,ctx);}catch(error){if(!d.quiet||error.status===401)throw error;}}}
// Per-link sharing is keyed by the link record jti; the server answers contact_not_found unless the link is live and the owner's.
export class UpdateContactSharing extends GuardedAction {mutation=true;async perform(r,ctx,d){const v=values(r,d);if(!v)return;if(!sharingLinks(snapshot(r)).some(link=>link.id===d.id))throw Error('This contact link is no longer active.');const profileFields=PROFILE_FIELDS.filter(field=>v['profile:'+field]==='on');
  try{await r.api.request(`/api/contacts/${encodeURIComponent(d.id)}/sharing`,{profileFields},'PUT');}catch(error){if(error.code!=='contact_not_found')throw error;publish(r,ctx,{modal:null});try{publish(r,ctx,{data:await r.api.get('/api/account')});}catch{}throw Error('This contact link is no longer active.');}
  publish(r,ctx,{modal:null,notice:'Contact sharing permissions saved.',error:''});r.browser.restoreFocus?.();
  try{publish(r,ctx,{data:await r.api.get('/api/account')});}catch(error){if(error.status===401)throw error;publish(r,ctx,{error:'Your change was saved, but the latest information could not be loaded. Reload to see it.'});}}}
export const PROFILE_WITHDRAWN_STALE='Profile sharing is now off. Your other changes were not saved because your contact profile changed in another session; the latest version is shown.';
export const PROFILE_STALE='Your contact profile changed in another session. The latest version is shown; review it and save again.';
export class SaveProfile extends GuardedAction {mutation=true;async perform(r,ctx,d){const book=snapshot(r).contactProfile;if(book?.status!=='loaded')throw Error('Your contact profile is still loading. Try again when it has loaded.');r.browser.captureFocus?.();const v=values(r,d),revision=book.profile?.revision;
  let profile;try{profile=await r.api.request('/api/profile',{displayName:v.displayName,bio:v.bio,avatar:v.avatar,discloseToContacts:v.discloseToContacts==='on',...typeof revision==='string'?{expectedRevision:revision}:{}},'PUT');}
  catch(error){if(error.code!=='profile_stale')throw error;const latest=await r.api.get('/api/profile');merge(r,ctx,{profile:latest??{},status:'loaded',epoch:(book.epoch??0)+1});throw Error(PROFILE_STALE);}
  // A stale save that turns sharing off applies only the withdrawal (server L-1); the other fields keep the newer
  // stored values, so the owner is told instead of seeing "saved" over text that was not stored (bug hunt round 3, B1).
  if(PROFILE_FIELDS.some(field=>profile?.[field]!==v[field])){merge(r,ctx,{profile:profile??{},status:'loaded',epoch:(book.epoch??0)+1});throw Error(PROFILE_WITHDRAWN_STALE);}
  merge(r,ctx,{profile});publish(r,ctx,{notice:'Contact profile saved.',error:''});r.browser.restoreFocus?.();}}
