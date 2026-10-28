// The account profile: display name and avatar, an account preference read by the embed view (contacts spike §4.8,
// CR-C4/CR-C8; provisional, unsigned). Per-link sharing, the disclosure switch and the bio were removed with contact
// links; what contacts see is a messaging-app peer profile, which is deferred. State lives under `contactProfile`
// (the name predates the removal) and is cleared on every account reset (see account-context.mjs and release.mjs).
import {GuardedAction,snapshot,publish} from './guarded-action.mjs';
export const PROFILE_FIELDS=['displayName','avatar'];
const merge=(r,ctx,patch)=>publish(r,ctx,{contactProfile:{...snapshot(r).contactProfile,...patch}});
const values=(r,d)=>d.operationId?r.browser.consumeSubmission(d.operationId):d.values;
// Only the profile members are kept from an answer; anything else the service might add is never rendered or resent.
const profileOf=answer=>Object.fromEntries(['displayName','avatar','revision'].filter(key=>typeof answer?.[key]==='string').map(key=>[key,answer[key]]));
// `status` (bug hunt F1): 'loading' until GET /api/profile answers, then 'loaded' (or 'error'). The profile form
// stays read-only for saving until 'loaded', so a save can never replace the stored profile with the empty
// placeholder fields; the server also refuses a save whose `expectedRevision` no longer matches.
async function load(r,ctx){const owner=snapshot(r).session.account.id;if(snapshot(r).contactProfile?.status!=='loaded')merge(r,ctx,{status:'loading'});
 try{const profile=await r.api.get('/api/profile');if(snapshot(r).session?.account.id!==owner||snapshot(r).offline)return;merge(r,ctx,{profile:profileOf(profile),status:'loaded'});}
 catch(error){if(snapshot(r).contactProfile?.status==='loading')merge(r,ctx,{status:'error'});throw error;}}
export const profileReady=state=>state.contactProfile?.status==='loaded';
// The automatic load on entering Account & security is quiet: the panel shows its own error state, so a failure adds no
// page alert there; an explicit load still reports it.
export class LoadContactProfile extends GuardedAction {async perform(r,ctx,d){try{await load(r,ctx);}catch(error){if(!d.quiet||error.status===401)throw error;}}}
export const PROFILE_STALE='Your profile changed in another session. The latest version is shown; review it and save again.';
// PUT /api/profile takes exactly {displayName, avatar, expectedRevision?}; any other member is refused (profile_invalid).
export class SaveProfile extends GuardedAction {mutation=true;async perform(r,ctx,d){const book=snapshot(r).contactProfile;if(book?.status!=='loaded')throw Error('Your profile is still loading. Try again when it has loaded.');r.browser.captureFocus?.();const v=values(r,d),revision=book.profile?.revision;
  let profile;try{profile=await r.api.request('/api/profile',{displayName:String(v?.displayName??''),avatar:String(v?.avatar??''),...typeof revision==='string'?{expectedRevision:revision}:{}},'PUT');}
  catch(error){if(error.code!=='profile_stale')throw error;const latest=await r.api.get('/api/profile');merge(r,ctx,{profile:profileOf(latest),status:'loaded',epoch:(book.epoch??0)+1});throw Error(PROFILE_STALE);}
  merge(r,ctx,{profile:profileOf(profile)});publish(r,ctx,{notice:'Profile saved.',error:''});r.browser.restoreFocus?.();}}
