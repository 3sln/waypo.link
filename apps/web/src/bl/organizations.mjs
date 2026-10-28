import {Query,Action} from '../shared/stack.mjs';
import {OwnerFlow,snapshot,publish} from './owner-flow.mjs';
import {breakGlassIntent} from './org-break-glass.mjs';
import {RELATION_FIELDS,loadRelations,relationLandingOpen,relationsIntent,relationLanding} from './org-relations.mjs';
export const organizationsEnabled=s=>(s.data?.features?.organizationsEnabled??s.session?.account?.consoleFeatures?.organizationsEnabled??s.config?.organizationsEnabled)===true;
export const organizationsModel=s=>organizationsEnabled(s)&&!s.offline&&s.session?.account?.id&&s.organizationsConsole?.owner===s.session.account.id&&s.organizationsConsole?.session===s.session.sessionContext&&s.organizationsConsole?.generation===(s.beamGeneration??0)?s.organizationsConsole:null;
const DECISIONS=['accept','reject','elevate','retract'];
// The server computes which decisions this person may take on each request (orgs.requests mirrors decide's rules and
// guards); the console never derives authority from loaded member data or form claims, and the server rechecks.
export function organizationsRequestDecisions(s,q){return organizationsModel(s)&&q&&['subject','elevated'].includes(q.state)&&Array.isArray(q.decisions)?q.decisions.filter(d=>DECISIONS.includes(d)):[];}
export const organizationPowers=m=>m?.membership?.powers??m?.organization?.powers??[];
export const organizationAdmin=m=>organizationPowers(m).includes('admin');
const base=s=>organizationsModel(s)??{owner:s.session.account.id,session:s.session.sessionContext,generation:s.beamGeneration??0,organizations:[],pending:[],offers:[],creation:null,plans:null,context:null,unsavedRecovery:[],leaveGuard:null,breakGlassItems:[],breakGlassDismissed:[],...privateFields};
/** The organizations model for this session, or a fresh one (ORG-12e notices load before the console opens). */
export const organizationsBase=s=>base(s);
/** Checkout links leave the console only for the Polar sandbox (organization billing is sandbox-only). */
export function organizationCheckoutURL(value){let url;try{url=new URL(value);}catch{fail('billing_unavailable');}if(url.protocol!=='https:'||url.hostname!=='sandbox.polar.sh'||url.username||url.password||url.port)fail('billing_unavailable');return url.href;}
/** The decisions the server advertises for the current organization's ownership view (it rechecks every one). */
export function ownershipDecisions(m){return Array.isArray(m?.ownership?.decisions)?m.ownership.decisions.filter(d=>['offer','withdraw','object','block','renew','claim','reissue-recovery'].includes(d)):[];}
const json=(value,fallback)=>{if(value===undefined||value==='')return fallback;if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{fail('invalid_request');}};
const fail=code=>{throw Object.assign(Error(code),{code});};
const put=(r,ctx,p)=>publish(r,ctx,{organizationsConsole:{...base(snapshot(r)),...p}});
// Everything read for one organization context. Switching context clears all of it before anything new is fetched.
const privateFields={organization:null,membership:null,members:[],membersNext:null,requests:[],adminRequests:[],requestsNext:null,audit:[],invitation:null,membersUnavailable:false,connections:[],connectionsUnavailable:false,preferences:[],preferencesUnavailable:false,ownership:null,offerDraft:null,inviteeDraft:null,breakGlass:null,breakGlassWizard:null,...RELATION_FIELDS};
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,TOKEN=/^[A-Za-z0-9_.-]{1,8192}$/;
const refused=error=>error?.status===403||error?.status===404||error?.code==='not_found';
// A definite refusal: the server answered and did not apply the change (validation, conflict, authority, rate limit).
// A timeout, network failure or 5xx leaves the outcome uncertain.
const definite=error=>Number.isInteger(error?.status)&&error.status>=400&&error.status<500&&error.status!==408;
// Organization changes whose outcome must be known before another one is sent. Reads, lookups, local actions,
// idempotent creation (keyed by its request) and the recovery steps are never blocked by an uncertain change.
const GUARDED=new Set(['rename','label','invite','leave','cancel-deletion','remove','grants','decide','connection','preference','revoke-invitation','offer','withdraw','object','block','renew','claim','reissue-recovery','accept-offer','decline-offer','bg-start','bg-accept','bg-cosign','bg-uncosign','bg-withdraw','bg-object','bg-contest','bg-checkout']);
const unavailable=error=>refused(error)||error?.status===503||['feature_unavailable','preferences_unavailable','connections_unavailable'].includes(error?.code);
/** The claims of a signed invitation token, decoded only as untrusted display and routing hints (never authority; the
 * server validates the whole signed token on accept). The organization comes from `aud` (`<issuer>/identity/<org>`). */
export function invitationClaims(token){
 try{const parts=String(token??'').split('.');if(parts.length!==3||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))return null;
  const claims=JSON.parse(atob(parts[1].replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-parts[1].length%4)%4)));if(!claims||typeof claims!=='object')return null;
  const org=/\/identity\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.exec(typeof claims.aud==='string'?claims.aud:'')?.[1]??null;
  const invitee=claims.invitee&&typeof claims.invitee.sub==='string'&&typeof claims.invitee.iss==='string'?{iss:claims.invitee.iss.slice(0,200),sub:claims.invitee.sub.slice(0,64)}:null;
  return {org,...Number.isSafeInteger(claims.exp)?{expiresAt:claims.exp*1000}:{},...invitee?{invitee}:{}};}catch{return null;}
}
/** An invitation pasted as a link or as its signed token. A link or token only supplies routing hints; the server validates. */
export function invitationInput(value,org){
 const text=String(value??'').trim();
 if(/^https?:\/\//i.test(text)){try{const url=new URL(text),match=/^\/orgs\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/invitation$/.exec(url.pathname),meta=url.searchParams.get('bindle_meta');if(match&&meta&&TOKEN.test(meta))return {org:match[1],invitation:meta};}catch{}fail('invitation_unrecognized');}
 if(!TOKEN.test(text))fail('invitation_unrecognized');const claimed=invitationClaims(text)?.org;return {org:claimed??org,invitation:text};
}
/** Who an invitation is for, as typed: a 3sln.me handle (resolved by the server) or a full identity URL. */
export function inviteeInput(value){
 const text=String(value??'').trim();
 if(/^https?:\/\//i.test(text)){try{const url=new URL(text),match=/^\/identity\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/.exec(url.pathname);if(match&&!url.username&&!url.password&&!url.search&&!url.hash)return {identity:{iss:url.origin,sub:match[1]}};}catch{}fail('invitee_unrecognized');}
 const handle=text.replace(/^@/,'').split('@')[0];if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(handle))fail('invitee_unrecognized');return {handle};
}
const METHOD=/^[A-Za-z0-9_.:/-]{1,128}$/,URLISH=/^[a-z][a-z0-9+.-]*:[^\s]{1,2040}$/i;
/** End of the given local calendar day (YYYY-MM-DD) as Unix seconds, or undefined. */
export function accessEnds(value,now=Date.now()){if(value===undefined||value==='')return undefined;const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));if(!m)fail('invalid_grant');const end=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),23,59,59).getTime();if(!Number.isFinite(end)||end<=now)fail('invalid_grant');return Math.floor(end/1000);}
/** Grants from the console's form: the admin power, the kept existing resource grants, and at most one new resource
 * grant. The vocabulary is packages/orgs/grants.mjs (`{power:'admin'}` or `{resource, methods:{contract:[method]}}`);
 * the server normalizes and rechecks it. A JSON `grants` value (scripted callers) is still accepted. */
export function grantsFromForm(v,existing=[]){
 if(v.grants!==undefined)return json(v.grants,[]);
 const ends=accessEnds(v.accessEnds),out=[],priorAdmin=existing.find(g=>g.power==='admin');
 if(v.admin===true)out.push(priorAdmin?{power:'admin',...priorAdmin.expires_at?{expires_at:priorAdmin.expires_at}:{}}:{power:'admin',...ends?{expires_at:ends}:{}});
 existing.filter(g=>!g.power).forEach((g,i)=>{if(v['keep:'+i]===true)out.push({resource:g.resource,methods:structuredClone(g.methods??{}),...g.expires_at?{expires_at:g.expires_at}:{}});});
 const resource=String(v.resource??'').trim(),contract=String(v.contract??'').trim(),methods=String(v.methods??'').split(/[\s,]+/).filter(Boolean);
 if(resource||contract||methods.length){if(!URLISH.test(resource)||!URLISH.test(contract)||!methods.length||methods.length>32||!methods.every(m=>METHOD.test(m)))fail('invalid_grant');out.push({resource,methods:{[contract]:[...new Set(methods)]},...ends?{expires_at:ends}:{}});}
 return out;
}
const LINK_DAYS={1:1,7:7,14:14,30:29.9};
/** Form values for one preference fragment: scalar fields from the form, everything else as stored. Resource
 * assignments are made through the app's own setup, never here. */
export function preferenceValues(preference,fields={}){
 const values={...preference?.values};
 for(const [name,field]of Object.entries(preference?.schema?.fields??{})){
  if(!Object.hasOwn(fields,name)||field.type==='resource'||(field.cardinality?.max??1)!==1)continue;
  const raw=fields[name],optional=(field.cardinality?.min??1)===0;
  if(field.type==='boolean'){values[name]=raw===true||raw==='true';continue;}
  if(raw===''||raw===undefined||raw===null){if(optional)delete values[name];else fail('invalid_preferences');continue;}
  if(['integer','number'].includes(field.type)){const n=Number(raw);if(!Number.isFinite(n)||field.type==='integer'&&!Number.isInteger(n))fail('invalid_preferences');values[name]=n;}else values[name]=String(raw);
 }
 return values;
}
/** An invitation link was opened (possibly while signed out). Only a boolean reaches the model: the token stays in the
 * organizations port's tab-scoped store until the signed-in console opens the join screen. */
export class NoteOrganizationInvitation extends Action{static deps={state:{write:true}};constructor(pending){super();this.pending=pending===true;}execute(r,ctx){r.state.transition(s=>Object.assign(s,{organizationInvitationPending:this.pending}));ctx.engineFeed.dispatchEvent(new Event('browser-state-updated'));}}
export class OrganizationsView extends Query{static deps=['state'];boot({state},{notify,engineFeed}){this.feed=engineFeed;this.paint=()=>notify(organizationsModel(state.snapshot()));engineFeed.addEventListener('browser-state-updated',this.paint);this.paint();}kill(){this.feed.removeEventListener('browser-state-updated',this.paint);}}
export class OrganizationsIntent extends OwnerFlow{
 static deps={state:{write:true},api:{},browser:{},organizationsConsole:{},recoveryFile:{}};
 async execute(r,ctx){
  if(!organizationsEnabled(snapshot(r)))return;
  // Tight verification also needs the existing interactive step-up. Adapt only
  // this organization's request, once; cooling-period refusals remain visible
  // after confirmation and must not expire the person's authenticated session.
  let prompted=false;const api=new Proxy(r.api,{get:(target,key)=>['request','get'].includes(key)?async(...args)=>{if(args[0]==='/api/auth/step-up/begin')prompted=true;try{return await target[key](...args);}catch(error){if(typeof args[0]!=='string'||!args[0].startsWith('/api/orgs/')||!['tight_verification_required','owner_proof_required'].includes(error.code))throw error;const retry=prompted;prompted=true;throw Object.assign(Error(error.message),{code:retry?error.code:'reauthentication_required',status:retry?409:401});}}:typeof target[key]==='function'?target[key].bind(target):target[key]});
  return super.execute({...r,api},ctx);
 }
 async perform(resources,ctx,d){
  const initial=snapshot(resources),session=initial.session.sessionContext,r={...resources,current:()=>resources.current()&&snapshot(resources).session?.sessionContext===session&&organizationsEnabled(snapshot(resources))},port=r.organizationsConsole,m=base(initial),v=d.values??{},age=v.ageConfirmed===true?{ageConfirmed:initial.config?.ageRequirement?.paidMinimumAge??18}:{},a=d.action,org=d.org??v.org??m.context;
  const checked=async fn=>{if(!r.current())fail('organization_changed');const result=await fn();if(!r.current())fail('organization_changed');return result;},call=(action,input,id=org)=>checked(()=>port.call(action,input,{api:r.api,...id?{org:id}:{}}));
  const unsaved=port.unsaved,markers=()=>unsaved?.list(m.owner)??[],tabs=port.recoveryTabs;
  // M3: organizations whose recovery file another tab of this browser is saving right now (fresh heartbeat), so this
  // tab neither offers nor issues a replacement that would invalidate that copy.
  const elsewhere=()=>{try{return tabs?.active(m.owner)??[];}catch{return [];}},recoveryMarkers=()=>({unsavedRecovery:markers(),recoveryElsewhere:elsewhere()});
  // ORG-10g: the Relationships tab reads and writes through the person's API with the same freshness checks.
  const relApi={get:p=>checked(()=>r.api.get(p)),post:(p,b)=>checked(()=>r.api.request(p,b))},relEnv=id=>({r,m:base(snapshot(r)),v,d,a,org:id,admin:organizationPowers(base(snapshot(r))).includes('admin'),api:relApi,put:p=>put(r,ctx,p),focus:selector=>r.browser.focus?.(selector),landing:port.relationLanding??relationLanding,copy:text=>port.copy(text),download:(name,content)=>r.browser.download(name,content),audit:async()=>{const result=await call('audit',undefined,id);put(r,ctx,{audit:result.entries??[],error:null});}});
  const reload=async()=>{const list=await call('list',undefined,null);put(r,ctx,{organizations:list.organizations??[],pending:list.pending??[],offers:list.offers??[],...recoveryMarkers(),stale:false,error:null});};
  // `creation` (additive on GET /api/orgs/plans): 'allowlisted' | 'checkout' | 'unavailable', for this person only.
  const plans=async()=>{try{const result=await call('plans',undefined,null);put(r,ctx,{plans:result.configured?result:{configured:false,plans:[],creation:result.creation??null}});}catch{put(r,ctx,{plans:{configured:false,plans:[],creation:null}});}};
  const leave=url=>{r.browser.navigate(organizationCheckoutURL(url));};
  // The organization recovery file (creation or reissue after an ownership change): kept only in this session's secret
  // store, encrypted in the browser with a generated passphrase, then downloaded and verified (R4-M5).
  const keepRecovery=async(file,id)=>{unsaved?.add(m.owner,id);const issue=port.id();try{tabs?.claim(m.owner,id,issue);}catch{}put(r,ctx,{...recoveryMarkers()});const passphrase=port.passphrase(),answers=[passphrase],questions=[{id:'organization-passphrase',type:'passphrase',prompt:'Organization recovery passphrase',hint:''}];r.browser.storeSecret('organizationRecovery:'+m.owner+':'+m.session,{file});put(r,ctx,{recovery:{fileName:file.fileName,passphrase,stage:'encrypt',issue},context:id,...privateFields});let encrypted;try{encrypted=await checked(()=>r.recoveryFile.encrypt(JSON.parse(file.content),questions,answers,initial.config.origin));}finally{answers.fill('');}r.browser.storeSecret('organizationRecovery:'+m.owner+':'+m.session,{encrypted:JSON.stringify(encrypted,null,2),token:file.recoveryToken});put(r,ctx,{recovery:{fileName:file.fileName,passphrase,stage:'download',issue}});};
  const creationKey='organizationCreation:'+m.owner+':'+m.session;
  const created=async result=>{
   if(result.payment?.required){put(r,ctx,{stale:false,creation:{request:result.payment.request,org:result.payment.org,name:result.payment.name??null,plan:result.payment.plan??null,checkout:result.payment.checkout?.url??null}});await plans();return;}
   // L3: the new organization is named in the context bar at once (no "Acting for …" placeholder before the list reloads).
   const listed=base(snapshot(r)).organizations.filter(o=>o.id!==result.organization.id);put(r,ctx,{creation:null,organizations:[...listed,{...result.organization,role:'owner-of-record',powers:['admin','owner-of-record'],available:true}]});if(result.recoveryFile)await keepRecovery(result.recoveryFile,result.organization.id);r.browser.storeSecret(creationKey,null);await reload();await details(result.organization.id);
   // Bug hunt round 3, B7: the create form is gone, so focus moves to the recovery-file step instead of the page body.
   if(result.recoveryFile)r.browser.focus?.('#org-recovery');
  };
  // A context loads the person's own membership first (any member may read it); admin surfaces follow only when the
  // organization itself reports the admin power. Each admin surface fails closed on its own without hiding the rest.
  const details=async id=>{
   const tab=base(snapshot(r)).context===id&&base(snapshot(r)).relationsTab===true;put(r,ctx,{...privateFields,context:id,error:null,relationsTab:tab});
   // L3: an organization that does not confirm the membership leaves no "Acting for" context behind.
   let membership;try{membership=await call('membership',undefined,id);}catch(error){if(refused(error)){put(r,ctx,{...privateFields,context:null,error:'not_found'});return;}throw error;}
   const powers=membership.powers??[],admin=powers.includes('admin'),privileged=admin||powers.includes('owner-of-record');
   const organization=privileged?await call('get',undefined,id):{...membership.organization,powers};
   put(r,ctx,{membership:{...membership.membership,powers},organization:{...organization,powers},stale:false});
   const requests=await call('requests',undefined,id);put(r,ctx,{requests:requests.requests??[]});
   // ORG-12e: the role-filtered break-glass view (members see only dates; uniform 404 when nothing applies).
   try{const view=await call('break-glass-view',undefined,id);put(r,ctx,{breakGlass:view&&typeof view==='object'?view:null});}catch(error){if(error?.code==='organization_changed')throw error;put(r,ctx,{breakGlass:null});}
   // Billing, the offer, the claim and their decisions: loaded only for the owner of record and admins (other members
   // keep the ORG-5 read set; a read-only refusal explains itself on their next change).
   const ownership=async()=>{if(privileged)try{put(r,ctx,{ownership:await call('ownership',undefined,id)});}catch(error){if(!unavailable(error))throw error;}};
   if(!admin){await loadRelations({api:relApi,put:p=>put(r,ctx,p),id,admin:false});await ownership();return;}
   try{const result=await call('members',undefined,id);put(r,ctx,{members:result.members??[],membersNext:typeof result.next==='string'?result.next:null,adminRequests:result.requests??[],requestsNext:typeof result.requestsNext==='string'?result.requestsNext:null,membersUnavailable:false});}
   catch(error){if(error.code==='organization_deletion_pending')put(r,ctx,{membersUnavailable:'deletion_pending'});else if(refused(error))put(r,ctx,{membersUnavailable:true});else throw error;}
   try{const result=await call('connections',undefined,id);put(r,ctx,{connections:result.connections??[],connectionsUnavailable:false});}catch(error){if(unavailable(error))put(r,ctx,{connectionsUnavailable:true});else throw error;}
   try{const result=await call('preferences',undefined,id);put(r,ctx,{preferences:result.preferences??[],preferencesUnavailable:false});}catch(error){if(unavailable(error))put(r,ctx,{preferencesUnavailable:true});else throw error;}
   await loadRelations({api:relApi,put:p=>put(r,ctx,p),id,admin:true});
   await ownership();
  };
  // H4: a change marks the view stale until the server's answer is known. A definite refusal applied nothing, so the
  // view is refreshed from the server and the forms are rebuilt from it (formEpoch); an uncertain failure refreshes too,
  // and only stays stale (blocking further changes, never reads) when that refresh also fails.
  const change=async(action,input)=>{if(!org)fail('organization_required');put(r,ctx,{stale:true,error:null,notice:null});let result;
   try{result=await call(action,input);}catch(error){if(error?.code==='organization_changed')throw error;const sure=definite(error),wizard=action==='break-glass'&&input?.operation==='start'?base(snapshot(r)).breakGlassWizard:null;let fresh=false;try{await details(org);fresh=true;}catch{}
    if(wizard)put(r,ctx,{breakGlassWizard:wizard});
    if(sure||fresh)put(r,ctx,{stale:false,formEpoch:(base(snapshot(r)).formEpoch??0)+1});
    if(!sure&&fresh)fail('change_uncertain');throw error;}put(r,ctx,{notice:result.invitation?'invitation_created':'saved',...result.invitation?{invitation:result}:{}});try{if(action==='leave'){put(r,ctx,{...privateFields,context:null});await reload();}else await details(org);}catch{put(r,ctx,{error:'saved_stale'});}if(result.invitation){put(r,ctx,{invitation:result});r.browser.focus?.('#org-invitation');}return result;};
  try{
   // Returning from a Polar sandbox checkout. The redirect proves nothing: each path reloads server state, and creation
   // resumes only when the server verified the payment bound to the stored request.
   if(a==='entry'&&d.returnTo){
    publish(r,ctx,{view:'organizations'});await reload();
    if(d.returnTo==='checkout'){const attempt=r.browser.secret(creationKey);if(attempt&&attempt.request===d.request){put(r,ctx,{stale:true});await created(await call('create',attempt,null));}return;}
    if(UUID.test(d.org??'')&&(m.organizations.some(o=>o.id===d.org)||snapshot(r).organizationsConsole?.organizations?.some(o=>o.id===d.org)))await details(d.org);
    put(r,ctx,{notice:d.returnTo==='transfer'?'transfer_checkout_returned':d.returnTo==='break-glass'?'break_glass_checkout_returned':'billing_checkout_returned'});return;
   }
   if(a==='entry'){if(!UUID.test(d.org??'')||typeof d.invitation!=='string'||!TOKEN.test(d.invitation))fail('invalid_request');if(m.recovery)fail('recovery_required');const hint=invitationClaims(d.invitation);if(hint?.org&&hint.org!==d.org)fail('invalid_request');const entry={org:d.org,invitation:d.invitation,...hint?.expiresAt?{expiresAt:hint.expiresAt}:{},...hint?.invitee?{invitee:hint.invitee}:{}};put(r,ctx,{...privateFields,context:null,entry,error:null});publish(r,ctx,{view:'organizations'});
    // The organization's own name and kind, from its record, for an invitation this account could accept now. Any
    // refusal is the same uniform answer, shown as "can't be used"; a transient failure just leaves the preview out.
    let preview=null;try{const out=await call('invitation-preview',{invitation:d.invitation},d.org);preview={name:typeof out?.organization?.name==='string'?out.organization.name:null,label:out?.organization?.label??null,handle:out?.organization?.handle??null,...out?.member===true?{member:true}:{}};}catch(error){if(refused(error))preview={invalid:true};}
    // L4: the person's own organizations, so an invitation reopened after joining says so (a failure leaves it out).
    try{await reload();}catch{}
    if(preview&&base(snapshot(r)).entry?.invitation===d.invitation)put(r,ctx,{entry:{...base(snapshot(r)).entry,preview}});return;}
   if(a==='dismiss-entry'){port.invitation?.set(null);put(r,ctx,{entry:null,error:null});publish(r,ctx,{organizationInvitationPending:false});return;}
   // F-2: the console's own address (/console?view=organizations[&org=]): opens the view in the shell and the context
   // the address names. The address is a routing hint; the organization confirms the membership as for any selection.
   if(a==='open'){publish(r,ctx,{view:'organizations'});put(r,ctx,{notice:null});await reload();await plans();if(m.recovery)return;if(d.org&&!UUID.test(d.org))fail('not_found');if(!d.org){put(r,ctx,{...privateFields,context:null,error:null});return;}await details(d.org);if(base(snapshot(r)).context===d.org)await relationLandingOpen(relEnv(d.org));return;}
   // F-1 leave guard: the in-memory recovery step is the only copy of the new file. Leaving keeps the persisted
   // "not saved" marker, so the organization shows the unsaved state and offers a fresh file afterwards.
   if(a==='guard'){if(!m.recovery)return;const p=d.pending&&typeof d.pending==='object'?d.pending:{},pending=Object.fromEntries(Object.entries(p).filter(([k,value])=>/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)&&k!=='force'&&(['number','boolean'].includes(typeof value)||typeof value==='string'&&value.length<=512)).slice(0,16));put(r,ctx,{leaveGuard:{...pending,kind:typeof p.kind==='string'?p.kind:'navigate'}});return;}
   if(a==='guard-cancel'){put(r,ctx,{leaveGuard:null});return;}
   if(a==='abandon-recovery'){r.browser.storeSecret('organizationRecovery:'+m.owner+':'+m.session,null);try{if(m.recovery&&m.context)tabs?.release(m.owner,m.context,m.recovery.issue);}catch{}put(r,ctx,{recovery:null,leaveGuard:null,...recoveryMarkers()});return;}
   if(a==='dismiss-recovery'){const id=d.org??v.org;if(!UUID.test(id??'')||v.confirm!==true)fail('review_required');unsaved?.remove(m.owner,id);put(r,ctx,{...recoveryMarkers(),notice:'recovery_dismissed',error:null});return;}
   // A fresh file for an organization whose file was not saved: the owner of record's reissue (fresh step-up), which
   // replaces the organization's credential, so the lost copy stops working (packages/orgs/creation.mjs). The server decides.
   if(a==='regenerate-recovery'){const id=d.org??v.org;if(m.recovery)fail('recovery_required');if(!UUID.test(id??'')||!markers().includes(id))fail('review_required');if(elsewhere().includes(id)){put(r,ctx,recoveryMarkers());fail('recovery_saving_elsewhere');}put(r,ctx,{error:null,notice:null});let result;try{result=await call('recovery-file',undefined,id);}catch(error){if(refused(error))fail('recovery_reissue_unavailable');throw error;}await keepRecovery(result.recoveryFile,id);return;}
   if(a==='reload'){await reload();await plans();if(m.context)await details(m.context);return;}
   if(a==='select'){if(m.recovery)fail('recovery_required');put(r,ctx,{notice:null});if(d.closeEntry===true&&m.entry){port.invitation?.set(null);put(r,ctx,{entry:null});publish(r,ctx,{organizationInvitationPending:false});}if(!d.org){put(r,ctx,{...privateFields,context:null,error:null});return;}await details(d.org);return;}
   if(a==='encrypt-recovery'||a==='download-recovery'||a==='verify-recovery'||a==='confirm-recovery'){
    const key='organizationRecovery:'+m.owner+':'+m.session,secret=r.browser.secret(key);if(!m.recovery||!secret)fail('recovery_required');
    if(a==='encrypt-recovery'){if(!secret.file)fail('recovery_required');const answers=[m.recovery.passphrase];let encrypted;try{encrypted=await checked(()=>r.recoveryFile.encrypt(JSON.parse(secret.file.content),[{id:'organization-passphrase',type:'passphrase',prompt:'Organization recovery passphrase',hint:''}],answers,initial.config.origin));}finally{answers.fill('');}r.browser.storeSecret(key,{encrypted:JSON.stringify(encrypted,null,2),token:secret.file.recoveryToken});put(r,ctx,{recovery:{...m.recovery,stage:'download'},stale:false,error:null});return;}
    if(a==='download-recovery'){if(!secret.encrypted)fail('recovery_required');r.browser.download(m.recovery.fileName,secret.encrypted);put(r,ctx,{recovery:{...m.recovery,stage:m.recovery.stage==='confirm'?'confirm':'verify'},error:null});return;}
    // M2: a passphrase that does not open the file is a mismatch, not a generic failure; checking before downloading
    // asks for the download.
    if(a==='verify-recovery'){if(!['verify','confirm'].includes(m.recovery.stage))fail('recovery_download_first');const answers=[String(v.passphrase??'')];let payload;try{payload=await checked(()=>r.recoveryFile.decrypt(secret.encrypted,answers,initial.config.origin));}catch(error){if(error?.code==='organization_changed')throw error;fail('recovery_mismatch');}finally{answers.fill('');}if(payload?.recoveryToken!==secret.token)fail('recovery_mismatch');put(r,ctx,{recovery:{...m.recovery,stage:'confirm'},error:null});return;}
    if(m.recovery.stage!=='confirm'||v.confirm!==true)fail('review_required');
    // M3: another tab issued a newer file for this organization (replacing its credential), so this copy no longer works.
    let latest=null;try{latest=m.context?tabs?.latest(m.owner,m.context)??null:null;}catch{}
    if(latest&&m.recovery.issue&&latest!==m.recovery.issue){r.browser.storeSecret(key,null);put(r,ctx,{recovery:null,leaveGuard:null,...recoveryMarkers()});fail('recovery_superseded');}
    r.browser.storeSecret(key,null);if(m.context){unsaved?.remove(m.owner,m.context);try{tabs?.release(m.owner,m.context,m.recovery.issue);}catch{}}put(r,ctx,{recovery:null,leaveGuard:null,...recoveryMarkers(),notice:'recovery_saved',error:null});if(m.context){try{await reload();await details(m.context);}catch{}}r.browser.focus?.(base(snapshot(r)).organization?'#org-details':'#org-title');return;
   }
   if(typeof a==='string'&&a.startsWith('bg-')){if(m.stale&&GUARDED.has(a))fail('reload_required');await breakGlassIntent({r,ctx,m:base(snapshot(r)),v,d,a,org,call,change,put:p=>put(r,ctx,p),leave,age,details,focus:selector=>r.browser.focus?.(selector)});return;}
   if(m.recovery)fail('recovery_required');if(m.stale&&GUARDED.has(a))fail('reload_required');
   if(typeof a==='string'&&a.startsWith('rel-')){if(!org)fail('organization_required');await relationsIntent(relEnv(org));return;}
   if(a==='create'){
    const prior=r.browser.secret(creationKey),input={name:String(v.name??''),label:String(v.label??'organization'),...v.plan?{plan:String(v.plan)}:{}},attempt=prior??{request:port.id(),...input};if(prior&&(prior.name!==input.name||prior.label!==input.label))fail('reload_required');r.browser.storeSecret(creationKey,attempt);put(r,ctx,{stale:true});
    await created(await call('create',attempt,null));return;
   }
   // Checkout at creation: the reservation exists unpaid; the checkout is created by this person's account.
   if(a==='creation-checkout'){if(!m.creation?.request||!['org-team','org-business','org-scale'].includes(v.plan))fail('review_required');const result=await call('creation-checkout',{request:m.creation.request,plan:v.plan,...age},null);leave(result.checkout.url);return;}
   if(a==='creation-recheck'){const attempt=r.browser.secret(creationKey);if(!attempt||attempt.request!==m.creation?.request)fail('reload_required');put(r,ctx,{stale:true});await created(await call('create',attempt,null));return;}
   if(a==='creation-forget'){r.browser.storeSecret(creationKey,null);put(r,ctx,{creation:null});return;}
   // Ownership offers addressed to this person (§12b.3a): accept by paying for a fresh period, or decline.
   if(a==='accept-offer'||a==='decline-offer'){
    const row=m.offers.find(o=>o.id===d.org),offer=row?.offer;if(!offer||!offer.decisions?.includes(a==='accept-offer'?'accept':'decline')||v.confirm!==true)fail('review_required');
    if(a==='decline-offer'){await call('transfer',{operation:'decline',transfer:offer.id},row.id);put(r,ctx,{notice:'offer_declined'});await reload();return;}
    const plan=offer.plans.find(p=>p.plan===(v.plan??offer.currentPlan??offer.plans[0]?.plan));if(!plan)fail('review_required');
    const result=await call('transfer',{operation:'accept',transfer:offer.id,disclosure:plan.digest,confirm:true,...offer.choosePlan?{plan:plan.plan}:{},...age},row.id);leave(result.checkout.url);return;
   }
   if(a==='accept'){if(v.confirm!==true)fail('review_required');const target=invitationInput(v.invitation??m.entry?.invitation,d.org??v.org??m.entry?.org??m.context);if(!UUID.test(target.org??''))fail('invitation_unrecognized');await call('accept',{invitation:target.invitation},target.org);port.invitation?.set(null);publish(r,ctx,{organizationInvitationPending:false});put(r,ctx,{notice:'joined',entry:null,...privateFields,context:target.org});await reload();await details(target.org);return;}
   // Invitee resolution: a handle through the organization's admin-only lookup; an identity URL is used as given.
   if(a==='invitee-resolve'){if(!org)fail('organization_required');const input=inviteeInput(v.invitee);if(input.identity){put(r,ctx,{inviteeDraft:{...input.identity,handle:null,foreign:input.identity.iss!==initial.config?.origin},error:null});return;}const result=await call('invitee',{handle:input.handle});const i=result?.invitee;if(!i||typeof i.iss!=='string'||!UUID.test(i.sub??''))fail('invitee_unavailable');put(r,ctx,{inviteeDraft:{iss:i.iss,sub:i.sub,handle:typeof i.handle==='string'?i.handle:null,foreign:false},error:null});return;}
   // M1: the admin power reaches an existing member only through an invitation bound to their account.
   if(a==='invitee-member'){const member=m.members.find(x=>x.id===d.id),p=member?.principal;if(!p||typeof p.iss!=='string'||typeof p.sub!=='string')fail('review_required');put(r,ctx,{inviteeDraft:{iss:p.iss,sub:p.sub,handle:typeof(member.handle??p.handle)==='string'?member.handle??p.handle:null,foreign:p.iss!==initial.config?.origin},error:null});r.browser.focus?.('#org-invite');return;}
   if(a==='invitee-clear'){put(r,ctx,{inviteeDraft:null,error:null});return;}
   if(a==='copy-invitation'){const link=m.invitation?.url??m.invitation?.invitation;if(!link)fail('review_required');try{await port.copy(link);}catch{fail('copy_failed');}put(r,ctx,{notice:'copied',error:null});return;}
   if(a==='dismiss-invitation'){put(r,ctx,{invitation:null,notice:null});return;}
   // Paged admin listing: follow the server's cursors; rows are appended once each (by id).
   if(a==='more-members'){if(!org||!m.membersNext&&!m.requestsNext)return;const result=await call('members',{...m.membersNext?{after:m.membersNext}:{},...m.requestsNext?{requestsAfter:m.requestsNext}:{}});const merge=(old,add)=>[...old,...(add??[]).filter(x=>!old.some(o=>o.id===x.id))];const now=base(snapshot(r));if(now.context!==org)return;
    const first=now.members.length,members=m.membersNext?merge(now.members,result.members):now.members;put(r,ctx,{members,membersNext:m.membersNext&&typeof result.next==='string'?result.next:null,adminRequests:m.requestsNext?merge(now.adminRequests,result.requests):now.adminRequests,requestsNext:m.requestsNext&&typeof result.requestsNext==='string'?result.requestsNext:null});r.browser.focus?.(members.length>first?'#org-member-'+first:'#org-members-heading');return;}
   if(a==='revoke-invitation'){const id=m.invitation?.invitation;if(!id)fail('review_required');await call('invitation-revoke',{invitation:id});put(r,ctx,{invitation:null,notice:'invitation_revoked',error:null});return;}
   // Ownership and billing for the current organization; the server advertises which decisions this member may take.
   if(['offer-resolve','offer','withdraw','object','block','renew','claim','reissue-recovery'].includes(a)){
    if(!org)fail('organization_required');const decisions=ownershipDecisions(m),transfer=m.ownership?.transfer;
    if(a==='offer-resolve'){if(!decisions.includes('offer'))fail('review_required');const result=await call('transfer-recipient',{handle:String(v.handle??'').trim()});put(r,ctx,{offerDraft:{recipient:result.recipient.id,handle:result.recipient.handle},error:null});return;}
    if(a==='offer'){if(!decisions.includes('offer')||!m.offerDraft||v.confirm!==true)fail('review_required');await change('transfer',{operation:'offer',recipient:m.offerDraft.recipient,handle:m.offerDraft.handle,admin:v.admin===true,confirm:true});return;}
    if(['withdraw','object','block'].includes(a)){if(!decisions.includes(a)||!transfer||v.confirm!==true)fail('review_required');await change('transfer',{operation:a,transfer:transfer.id,...v.reason?{reason:String(v.reason)}:{}});return;}
    if(a==='renew'||a==='claim'){if(!decisions.includes(a)||!['org-team','org-business','org-scale'].includes(v.plan)||a==='claim'&&v.confirm!==true)fail('review_required');const result=await call(a==='renew'?'billing-checkout':'claim',{plan:v.plan,...a==='claim'?{confirm:true}:{},...age});leave(result.checkout.url);return;}
    if(!decisions.includes('reissue-recovery')||v.confirm!==true)fail('review_required');const result=await call('recovery-file');await keepRecovery(result.recoveryFile,org);return;
   }
   if(a==='audit'){if(!org)fail('organization_required');const result=await call('audit');put(r,ctx,{audit:result.entries??[],error:null});return;}
   if(a==='rename'){await change(a,{name:String(v.name??''),expectedRevision:m.organization?.revision});return;}
   if(a==='label'){await change(a,{label:String(v.label??''),expectedRevision:m.organization?.revision});return;}
   if(a==='invite'){
    const bound=v.invitee!==undefined&&v.invitee!==''?json(v.invitee,null):v.audience!=='anyone'&&m.inviteeDraft?{iss:m.inviteeDraft.iss,sub:m.inviteeDraft.sub}:null;
    if(v.audience==='bound'&&!bound)fail('invitee_required');const grants=grantsFromForm(v);if(grants.some(g=>g.power)&&!bound)fail('bound_invitation_required');
    const days=LINK_DAYS[v.expiresInDays],expiresAt=v.expiresAt!==undefined?v.expiresAt:days?Date.now()+Math.round(days*86400000):undefined;
    const handle=bound&&m.inviteeDraft?.sub===bound.sub?m.inviteeDraft.handle:null,result=await change(a,{grants,...bound?{invitee:bound}:{},...expiresAt!==undefined?{expiresAt}:{},...v.expires_at!==undefined?{expires_at:v.expires_at}:{}});
    // The share view names the invitee by the handle the admin resolved (display only).
    if(handle&&result?.invitation&&result.invitee?.sub===bound.sub)put(r,ctx,{invitation:{...result,invitee:{...result.invitee,handle}}});return;}
   if(a==='leave'){if(v.confirm!==true)fail('review_required');await change(a,{});return;}
   if(a==='cancel-deletion'){if(m.organization?.state!=='deletion-scheduled'||v.confirm!==true)fail('review_required');await change(a,undefined);return;}
   if(a==='remove'||a==='grants'){const member=m.members.find(x=>x.id===d.id);if(!member||v.confirm!==true)fail('review_required');await change(a,{membership:d.id,...a==='grants'?{grants:grantsFromForm(v,member.grants??[])}:{},...v.reason?{reason:String(v.reason)}:{}});return;}
   if(a==='decide'){if(!DECISIONS.includes(v.decision)||v.confirm!==true)fail('review_required');await change(a,{request:String(d.id??v.request??''),decision:v.decision});return;}
   // Organization context for the existing connections operations. Only connections this console loaded for the
   // current organization can be named; the generation (and staged revision) come from that load, never the form.
   if(a==='connection'){
    const c=m.connections.find(x=>x.id===d.id),operation=v.operation??d.operation;if(!c||!['suspend','resume','disconnect','approve'].includes(operation))fail('connection_changed');
    if(['disconnect','approve'].includes(operation)&&v.confirm!==true)fail('review_required');if(operation==='approve'&&!c.integration?.staged)fail('connection_changed');
    await change('connection',{operation,input:{connection:c.id,expectedGeneration:c.generation,...operation==='approve'?{stagedRevision:c.integration.stagedRevision}:{}}});return;
   }
   if(a==='preference'){
    const p=m.preferences.find(x=>x.fragment===d.fragment);if(!p||v.confirm!==true)fail('review_required');
    const fields=Object.fromEntries(Object.entries(v).filter(([k])=>k.startsWith('field:')).map(([k,value])=>[k.slice(6),value]));
    await change('preference',{fragment:p.fragment,values:preferenceValues(p,fields),expectedRevision:p.revision??null});return;
   }
   fail('invalid_request');
  }catch(error){
   // A definite refusal of creation applied nothing: it never leaves the view stale, and a refused name or kind
   // releases the stored attempt so a corrected form can be sent.
   if(definite(error)&&base(snapshot(r)).stale)put(r,ctx,{stale:false});
   if(a==='create'&&definite(error)&&['invalid_name','invalid_label','invalid_plan','invalid_request'].includes(error.code))r.browser.storeSecret(creationKey,null);
   put(r,ctx,{error:error.code??'unavailable'});}
 }
}
