// Signaling owner pages (docs/spec/extensions/signaling.md rev 3.2 §20.1.4 session handler approval, §5.8 pairing
// creation and activation, §14.1 pairings by peer and live offers, §4.3 service designation; release gate
// "Signaling", owner pages). The console view `signaling` (/console?view=signaling&page=…) is the provider page these
// widening actions require: same origin, CSRF-protected, frame-ancestors 'none' (the console's own headers), nothing
// preselected, and every decision control armed after a delay (bl/authorize-entry-arming.mjs, wired in release.mjs).
// Engine-first: the server computes the disclosures in its review (packages/signaling/owner-pages.mjs); these Actions
// only take the review, show it, and commit exactly the reviewed input with the review id once armed. Narrowing stays
// on the existing controls (bl/signaling-controls.mjs). Provisional (coordinator), not signed off by the user; nothing
// here is shown or requested while the account's session features lack signalingEnabled.
//
// State: `signalingPage` {owner, generation, page, params, status: 'loading'|'ready'|'error', review, refusal, detail,
// service, armed, surface, done}; `signaling` (the settings read, shared with bl/signaling-controls.mjs).
// Pages: overview (pairings by peer, own-app pairings, pending activations, live offers), approve {client, kind},
// auto-connect {client, kind}, pair {client?, kind?}, pairing {id}, service {organization}.
import {GuardedAction,snapshot,publish} from './guarded-action.mjs';
import {freshAPI} from './step-up.mjs';
import {Action} from '../shared/stack.mjs';
import {signalingEnabled} from './signaling-controls.mjs';
import {createArming} from './authorize-entry-arming.mjs';

export const SIGNALING_PAGES=Object.freeze(['overview','approve','auto-connect','pair','pairing','service']);
/** The client-side arming delay of decision controls (the server floor is shorter, owner-pages.mjs PAGE_REVIEW). */
export const ARM_DELAY_MS=1200;
export const ROUTE_EVENT='signaling-page-route';
const DAY=86400000,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,PAIRING=/^pr_[A-Za-z0-9_-]{22}$/;
const text=(v,max=2048)=>typeof v==='string'&&v.length>0&&v.length<=max;

export const SIGNALING_PAGE_UNAVAILABLE='This page is not available right now.';
export const SIGNALING_NOT_ARMED='Ready in a moment. Select the button again.';
export const SIGNALING_REVIEW_EXPIRED='This review expired or changed. Review the change again.';
export const SIGNALING_CHANGED='These details changed somewhere else. Review the latest version.';
export const SIGNALING_INCOMPLETE='Choose every option before reviewing.';
const MESSAGES=Object.freeze({
 decision_not_armed:SIGNALING_NOT_ARMED,review_required:SIGNALING_REVIEW_EXPIRED,conflict:SIGNALING_CHANGED,not_found:SIGNALING_PAGE_UNAVAILABLE,
 peer_unknown:'No account with that handle was found here.',handler_excluded:'This app is excluded for this connection type. Remove the exclusion in intent settings first.',
 pairing_parties_incomplete:'Each app needs its own access and approval first.',pairing_exists:'You already have a pairing with this account for this connection type.',
 invalid_args:'This change is not allowed. Check the choices and try again.',rate_limited:'Too many requests. Wait a moment, then try again.'});
const friendly=error=>{const m=MESSAGES[error?.code]??(error?.status===404?SIGNALING_PAGE_UNAVAILABLE:null);if(m)throw Object.assign(Error(m),{code:error.code,status:error.status});throw error;};

/** The page route of a console address (validated; anything else is the overview). */
export function pageRoute(search){
 const q=new URLSearchParams(search),one=name=>q.getAll(name).length===1?q.get(name):null,page=SIGNALING_PAGES.includes(one('page'))?one('page'):'overview',params={};
 const client=one('client'),kind=one('kind'),id=one('id'),organization=one('organization');
 if(text(client))params.client=client;if(text(kind,256))params.kind=kind;if(id&&PAIRING.test(id))params.id=id;if(organization&&UUID.test(organization))params.organization=organization;
 return {page,params};
}
/** The console address of a page (what release.mjs pushes into history). */
export function pageURL(page,params={}){const q=new URLSearchParams({view:'signaling',page});for(const [k,v] of Object.entries(params))if(typeof v==='string'&&v)q.set(k,v);return '/console?'+q;}
/** The loaded page of the signed-in account, or null (never while signaling is off for it). */
export const pageModel=s=>{if(!signalingEnabled(s))return null;const p=s.signalingPage;return p&&p.owner===s.session?.account?.id&&p.generation===(s.beamGeneration??0)?p:null;};
/** The current decision surface (a live review id) while the signaling view shows one, else ''. Arming restarts per surface. */
export const decisionSurface=s=>{const p=pageModel(s);return s.view==='signaling'&&!s.modal&&!s.stepUp&&typeof p?.review?.review==='string'?p.review.review:'';};

/**
 * The arming of the decision surfaces (release.mjs; adaptive sign-in §9 "Activation tricks" via createArming): one
 * arming per surface (a review id), restarted by focus, visibility, resize and a new surface; disposed while no
 * surface shows (a dialog or the step-up prompt hides it). `passes(event)` admits only a trusted activation whose press
 * started while armed; anything else is reported early. `arm` and `early` dispatch SignalingArm and SignalingEarly.
 */
export function decisionGate({win,doc,read,arm,early,delay=ARM_DELAY_MS,arming:make=createArming}){
 let arming=null,surface='';
 return Object.freeze({
  sync(){const next=decisionSurface(read());if(next===surface)return;surface=next;arming?.dispose();arming=next?make({win,doc,delay,onChange:armed=>arm({armed,surface:next}),onReject:early}):null;},
  passes(event){if(event?.isTrusted!==true)return false;if(!arming){early();return false;}let passed=false;arming.guard(()=>{passed=true;})(event);return passed;},
  dispose(){arming?.dispose();arming=null;surface='';},
 });
}

const owner=r=>snapshot(r).session.account.id;
const generation=r=>snapshot(r).beamGeneration??0;
const page=r=>pageModel(snapshot(r));
const patch=(r,ctx,values)=>{const p=page(r);if(p)publish(r,ctx,{signalingPage:{...p,...values}});};
const route=(ctx,target,params={})=>ctx.engineFeed.dispatchEvent(new CustomEvent(ROUTE_EVENT,{detail:{page:target,params}}));
const values=(r,d)=>d.operationId?r.browser.consumeSubmission(d.operationId):d.values??{};

async function loadSettings(r,ctx){const data=await r.api.get('/api/signaling/settings');publish(r,ctx,{signaling:{...data,owner:owner(r),generation:generation(r),status:'loaded'}});return data;}
async function loadPage(r,ctx,p){
 if(p.page==='pairing'&&p.params.id)patch(r,ctx,{detail:await r.api.get('/api/signaling/pairing?id='+encodeURIComponent(p.params.id))});
 if(p.page==='service'&&p.params.organization)patch(r,ctx,{service:await r.api.get('/api/orgs/'+p.params.organization+'/signaling')});
}
/** Takes a review; for the organization designation through the organization's owner interface. */
async function takeReview(r,ctx,action,input){
 const p=page(r),api=freshAPI(r,ctx);
 const review=p?.page==='service'?await api.request('/api/orgs/'+p.params.organization+'/signaling',{operation:'review',input:{action,input}}):await api.request('/api/signaling/review',{action,input});
 if(review?.refusal)patch(r,ctx,{review:null,refusal:review.refusal,armed:false});
 else patch(r,ctx,{review,refusal:null,armed:false,done:null});
 r.browser.focus?.('#signaling-decision-title');
}

/** Opens a page ({page, params}): loads the settings, then what the page needs, and (approval page) its review. */
export class OpenSignalingPage extends GuardedAction {
 // Not a mutation: it never waits on the console's busy reservation (the review it may take changes nothing visible).
 mutation=false;
 async perform(r,ctx,d){
  const s=snapshot(r);if(!signalingEnabled(s))throw Error(SIGNALING_PAGE_UNAVAILABLE);
  const target=SIGNALING_PAGES.includes(d.page)?d.page:'overview',params=d.params&&typeof d.params==='object'?d.params:{};
  publish(r,ctx,{signalingPage:{owner:owner(r),generation:generation(r),page:target,params,status:'loading',review:null,refusal:null,detail:null,service:null,armed:false,done:null}});
  try{
   await loadSettings(r,ctx);await loadPage(r,ctx,page(r));
   if(target==='approve'&&params.client&&params.kind)await takeReview(r,ctx,'session-approve',{clientId:params.client,kind:params.kind});
   if(target==='auto-connect'&&params.client&&params.kind)await takeReview(r,ctx,'session-auto-connect',{clientId:params.client,kind:params.kind});
   patch(r,ctx,{status:'ready'});
  }catch(error){if(error.status===401)throw error;patch(r,ctx,{status:'error'});friendly(error);}
 }
}

/** Builds the input of a review from a page control or form and takes the review. */
export class ReviewSignalingChange extends GuardedAction {
 mutation=true;
 async perform(r,ctx,d){
  const p=page(r);if(!p)throw Error(SIGNALING_PAGE_UNAVAILABLE);
  const action=d.action,detail=p.detail?.pairing;let input;
  if(action==='session-approve'){if(!text(d.clientId)||!text(d.kind,256))throw Error(SIGNALING_PAGE_UNAVAILABLE);input={clientId:d.clientId,kind:d.kind};}
  else if(action==='session-auto-connect'){if(!text(d.clientId)||!text(d.kind,256))throw Error(SIGNALING_PAGE_UNAVAILABLE);input={clientId:d.clientId,kind:d.kind};}
  else if(action==='pairing-create')input=pairingInput(values(r,d));
  else if(action==='pairing-activate'){if(!detail)throw Error(SIGNALING_PAGE_UNAVAILABLE);input={id:detail.id,revision:detail.revision};}
  else if(action==='pairing-renew'){if(!detail)throw Error(SIGNALING_PAGE_UNAVAILABLE);const days=Number(values(r,d).days);if(![30,90,180,365].includes(days))throw Error(SIGNALING_INCOMPLETE);return reviewed(r,ctx,'pairing-update',{id:detail.id,revision:detail.revision,expiresAt:Date.now()+days*DAY});}
  else if(action==='pairing-reconfirm'){if(!detail)throw Error(SIGNALING_PAGE_UNAVAILABLE);return reviewed(r,ctx,'pairing-update',{id:detail.id,revision:detail.revision,kind:detail.kind.artefact});}
  else if(action==='set-service'){if(!p.service)throw Error(SIGNALING_PAGE_UNAVAILABLE);input={designated:true,revision:p.service.revision};}
  else throw Error(SIGNALING_PAGE_UNAVAILABLE);
  return reviewed(r,ctx,action,input);
 }
}
async function reviewed(r,ctx,action,input){try{await takeReview(r,ctx,action,input);}catch(error){if(error.status===401)throw error;friendly(error);}}
/** The pairing creation form's values as a review input (§5.8): nothing is preselected, so every choice is required. */
export function pairingInput(v){
 const kind=v.kind,local=v.local,with_=v.with,opens=v.opens,label=String(v.label??'').trim();
 if(!text(kind,256)||!text(local)||!['self','principal'].includes(with_)||!['local','peer','both'].includes(opens)||!label||label.length>64)throw Error(SIGNALING_INCOMPLETE);
 let peer;
 if(with_==='self'){if(!text(v.peerApp))throw Error(SIGNALING_INCOMPLETE);peer={self:{client_id:v.peerApp,client_session:null}};}
 else{const handle=String(v.peerHandle??'').trim();if(!handle||handle.length>320)throw Error(SIGNALING_INCOMPLETE);peer={handle};}
 const days=Number(v.days),expiry=with_==='principal'?{expiresAt:Date.now()+([30,90,180,365].includes(days)?days:90)*DAY}:{};
 return {kind,local:{client_id:local,client_session:null},peer,opens,label,...expiry};
}

const DECISIONS=Object.freeze({
 'session-approve':{path:'/api/intents/session-approve',notice:()=>'Connection type approved.'},
 'session-auto-connect':{path:'/api/intents/session-auto-connect',notice:()=>'Automatic connection turned on.'},
 'pairing-create':{path:'/api/signaling/pairing-create',notice:out=>out.state==='live'?'Pairing created and active.':'Pairing created. It is not active yet.'},
 'pairing-activate':{path:'/api/signaling/pairing-activate',notice:()=>'Pairing activated.'},
 'pairing-update':{path:'/api/signaling/pairing-update',notice:(out,input)=>input.kind?'Pairing updated to the newer version.':'Pairing renewed.'},
 'set-service':{path:null,notice:()=>'Designated as a service.'},
});
/**
 * The armed decision of the current review. Runs only while the surface is armed (release.mjs passes only trusted,
 * armed activations) and sends exactly the reviewed input with its review id. `autoConnect` is the approval page's
 * separate, unchecked control, honoured only where the review allows it.
 */
export class DecideSignalingChange extends GuardedAction {
 mutation=true;
 async perform(r,ctx,d){
  const p=page(r),review=p?.review;if(!review?.review)throw Error(SIGNALING_REVIEW_EXPIRED);
  if(p.armed!==true||p.surface!==review.review)throw Error(SIGNALING_NOT_ARMED);
  const decision=DECISIONS[review.action];if(!decision)throw Error(SIGNALING_PAGE_UNAVAILABLE);
  const input={...review.input,...review.action==='session-approve'&&d.autoConnect===true&&review.disclosure?.autoConnectAllowed===true?{autoConnect:true}:{},...review.action==='pairing-create'?{activate:true}:{}};
  const api=freshAPI(r,ctx);let out;
  try{out=decision.path?await api.request(decision.path,{...input,review:review.review}):await api.request('/api/orgs/'+p.params.organization+'/signaling',{operation:'set-service',input,review:review.review});}
  catch(error){if(error.status===401)throw error;if(['review_required','conflict'].includes(error.code))patch(r,ctx,{review:null,armed:false});friendly(error);}
  patch(r,ctx,{review:null,armed:false,done:{action:review.action,result:out}});
  publish(r,ctx,{notice:decision.notice(out??{},input),error:''});
  try{await loadSettings(r,ctx);await loadPage(r,ctx,page(r));}catch(error){if(error.status===401)throw error;}
  if(review.action==='pairing-create'&&typeof out?.id==='string')route(ctx,'pairing',{id:out.id});
  r.browser.focus?.('#signaling-page-title');
 }
}
/** Leaves a decision surface without deciding (the page returns to its form or summary). */
export class CancelSignalingReview extends Action {
 static deps={state:{write:true}};
 constructor(detail={}){super();this.detail=detail;}
 execute(r,ctx){const s=r.state.snapshot(),p=pageModel(s);if(!p||s.busy)return;r.state.transition(next=>Object.assign(next,{signalingPage:{...p,review:null,refusal:null,armed:false}}));ctx.engineFeed.dispatchEvent(new Event('browser-state-updated'));}
}
/** The arming resource's state for one decision surface (release.mjs). A stale surface's arming is ignored. */
export class SignalingArm extends Action {
 static deps={state:{write:true}};
 constructor(detail={}){super();this.detail=detail;}
 execute(r,ctx){const s=r.state.snapshot(),p=pageModel(s);if(!p||p.review?.review!==this.detail.surface)return;const armed=this.detail.armed===true;if(p.armed===armed&&p.surface===this.detail.surface)return;r.state.transition(next=>Object.assign(next,{signalingPage:{...p,armed,surface:this.detail.surface}}));ctx.engineFeed.dispatchEvent(new Event('browser-state-updated'));}
}
/** An activation before the control armed is explained, not silently dropped. */
export class SignalingEarly extends Action {
 static deps={state:{write:true}};
 execute(r,ctx){if(!pageModel(r.state.snapshot()))return;r.state.transition(next=>Object.assign(next,{notice:SIGNALING_NOT_ARMED,error:''}));ctx.engineFeed.dispatchEvent(new Event('browser-state-updated'));}
}
/** Relabelling a pairing (narrowing-neutral, compare-and-swap; no review). */
export class RelabelSignalingPairing extends GuardedAction {
 mutation=true;
 async perform(r,ctx,d){
  const p=page(r),detail=p?.detail?.pairing;if(!detail)throw Error(SIGNALING_PAGE_UNAVAILABLE);
  const label=String(values(r,d).label??'').trim();if(!label||label.length>64)throw Error(SIGNALING_INCOMPLETE);
  try{await r.api.request('/api/signaling/pairing-update',{id:detail.id,revision:detail.revision,label});}catch(error){if(error.status===401)throw error;friendly(error);}
  publish(r,ctx,{notice:'Pairing renamed.',error:''});try{await loadSettings(r,ctx);await loadPage(r,ctx,page(r));}catch(error){if(error.status===401)throw error;}
 }
}
/** Removing the service designation (narrowing; from its confirmation dialog): revokes offers longer than 900 s. */
export class RemoveSignalingDesignation extends GuardedAction {
 mutation=true;
 async perform(r,ctx){
  const s=snapshot(r),p=page(r);if(!p?.service||p.page!=='service')throw Error(SIGNALING_PAGE_UNAVAILABLE);
  if(s.modal?.kind!=='signaling-page-confirm'||s.modal.action!=='service-remove')throw Error('Review the change in the dialog, then confirm.');
  let out;try{out=await r.api.request('/api/orgs/'+p.params.organization+'/signaling',{operation:'set-service',input:{designated:false,revision:p.service.revision}});}catch(error){if(error.status===401)throw error;friendly(error);}
  publish(r,ctx,{modal:null,notice:Number(out?.revoked)>0?'Designation removed. Long-lived offers were revoked.':'Designation removed.',error:''});
  try{await loadPage(r,ctx,page(r));}catch(error){if(error.status===401)throw error;}
  r.browser.restoreFocus?.();
 }
}
export const SIGNALING_PAGE_INTENTS=Object.freeze({'signaling-review':ReviewSignalingChange,'signaling-decide':DecideSignalingChange,'signaling-cancel-review':CancelSignalingReview,'signaling-relabel':RelabelSignalingPairing,'signaling-remove-designation':RemoveSignalingDesignation});
