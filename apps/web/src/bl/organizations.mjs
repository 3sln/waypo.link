import {Query} from '../shared/stack.mjs';
import {OwnerFlow,snapshot,publish} from './owner-flow.mjs';
export const organizationsEnabled=s=>(s.data?.features?.organizationsEnabled??s.session?.account?.consoleFeatures?.organizationsEnabled??s.config?.organizationsEnabled)===true;
export const organizationsModel=s=>organizationsEnabled(s)&&!s.offline&&s.session?.account?.id&&s.organizationsConsole?.owner===s.session.account.id&&s.organizationsConsole?.session===s.session.sessionContext&&s.organizationsConsole?.generation===(s.beamGeneration??0)?s.organizationsConsole:null;
const DECISIONS=['accept','reject','elevate','retract'];
// The server computes which decisions this person may take on each request (orgs.requests mirrors decide's rules and
// guards); the console never derives authority from loaded member data or form claims, and the server rechecks.
export function organizationsRequestDecisions(s,q){return organizationsModel(s)&&q&&['subject','elevated'].includes(q.state)&&Array.isArray(q.decisions)?q.decisions.filter(d=>DECISIONS.includes(d)):[];}
export const organizationPowers=m=>m?.membership?.powers??m?.organization?.powers??[];
export const organizationAdmin=m=>organizationPowers(m).includes('admin');
const base=s=>organizationsModel(s)??{owner:s.session.account.id,session:s.session.sessionContext,generation:s.beamGeneration??0,organizations:[],pending:[],offers:[],creation:null,plans:null,context:null,...privateFields};
/** Checkout links leave the console only for the Polar sandbox (organization billing is sandbox-only). */
export function organizationCheckoutURL(value){let url;try{url=new URL(value);}catch{fail('billing_unavailable');}if(url.protocol!=='https:'||url.hostname!=='sandbox.polar.sh'||url.username||url.password||url.port)fail('billing_unavailable');return url.href;}
/** The decisions the server advertises for the current organization's ownership view (it rechecks every one). */
export function ownershipDecisions(m){return Array.isArray(m?.ownership?.decisions)?m.ownership.decisions.filter(d=>['offer','withdraw','object','block','renew','claim','reissue-recovery'].includes(d)):[];}
const json=(value,fallback)=>{if(value===undefined||value==='')return fallback;if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{fail('invalid_request');}};
const fail=code=>{throw Object.assign(Error(code),{code});};
const put=(r,ctx,p)=>publish(r,ctx,{organizationsConsole:{...base(snapshot(r)),...p}});
// Everything read for one organization context. Switching context clears all of it before anything new is fetched.
const privateFields={organization:null,membership:null,members:[],requests:[],adminRequests:[],audit:[],invitation:null,membersUnavailable:false,connections:[],connectionsUnavailable:false,preferences:[],preferencesUnavailable:false,ownership:null,offerDraft:null};
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,TOKEN=/^[A-Za-z0-9_.-]{1,8192}$/;
const refused=error=>error?.status===403||error?.status===404||error?.code==='not_found';
const unavailable=error=>refused(error)||error?.status===503||['feature_unavailable','preferences_unavailable','connections_unavailable'].includes(error?.code);
/** An invitation pasted as a link or as its signed token. A link only supplies routing hints; the server validates. */
export function invitationInput(value,org){
 const text=String(value??'').trim();
 if(/^https?:\/\//i.test(text)){try{const url=new URL(text),match=/^\/orgs\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/invitation$/.exec(url.pathname),meta=url.searchParams.get('bindle_meta');if(match&&meta&&TOKEN.test(meta))return {org:match[1],invitation:meta};}catch{}fail('invalid_request');}
 if(!TOKEN.test(text))fail('invalid_request');return {org,invitation:text};
}
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
export class OrganizationsView extends Query{static deps=['state'];boot({state},{notify,engineFeed}){this.feed=engineFeed;this.paint=()=>notify(organizationsModel(state.snapshot()));engineFeed.addEventListener('browser-state-updated',this.paint);this.paint();}kill(){this.feed.removeEventListener('browser-state-updated',this.paint);}}
export class OrganizationsIntent extends OwnerFlow{
 static deps={state:{write:true},api:{},browser:{},organizationsConsole:{},recoveryFile:{}};
 async execute(r,ctx){
  if(!organizationsEnabled(snapshot(r)))return;
  // Tight verification also needs the existing interactive step-up. Adapt only
  // this organization's request, once; cooling-period refusals remain visible
  // after confirmation and must not expire the person's authenticated session.
  let prompted=false;const api=new Proxy(r.api,{get:(target,key)=>['request','get'].includes(key)?async(...args)=>{if(args[0]==='/api/auth/step-up/begin')prompted=true;try{return await target[key](...args);}catch(error){if(typeof args[0]!=='string'||!args[0].startsWith('/api/orgs/')||error.code!=='tight_verification_required')throw error;const retry=prompted;prompted=true;throw Object.assign(Error(error.message),{code:retry?'tight_verification_required':'reauthentication_required',status:retry?409:401});}}:typeof target[key]==='function'?target[key].bind(target):target[key]});
  return super.execute({...r,api},ctx);
 }
 async perform(resources,ctx,d){
  const initial=snapshot(resources),session=initial.session.sessionContext,r={...resources,current:()=>resources.current()&&snapshot(resources).session?.sessionContext===session&&organizationsEnabled(snapshot(resources))},port=r.organizationsConsole,m=base(initial),v=d.values??{},a=d.action,org=d.org??v.org??m.context;
  const checked=async fn=>{if(!r.current())fail('organization_changed');const result=await fn();if(!r.current())fail('organization_changed');return result;},call=(action,input,id=org)=>checked(()=>port.call(action,input,{api:r.api,...id?{org:id}:{}}));
  const reload=async()=>{const list=await call('list',undefined,null);put(r,ctx,{organizations:list.organizations??[],pending:list.pending??[],offers:list.offers??[],stale:false,error:null});};
  const plans=async()=>{try{const result=await call('plans',undefined,null);put(r,ctx,{plans:result.configured?result:{configured:false,plans:[]}});}catch{put(r,ctx,{plans:{configured:false,plans:[]}});}};
  const leave=url=>{r.browser.navigate(organizationCheckoutURL(url));};
  // The organization recovery file (creation or reissue after an ownership change): kept only in this session's secret
  // store, encrypted in the browser with a generated passphrase, then downloaded and verified (R4-M5).
  const keepRecovery=async(file,id)=>{const passphrase=port.passphrase(),answers=[passphrase],questions=[{id:'organization-passphrase',type:'passphrase',prompt:'Organization recovery passphrase',hint:''}];r.browser.storeSecret('organizationRecovery:'+m.owner+':'+m.session,{file});put(r,ctx,{recovery:{fileName:file.fileName,passphrase,stage:'encrypt'},context:id,...privateFields});let encrypted;try{encrypted=await checked(()=>r.recoveryFile.encrypt(JSON.parse(file.content),questions,answers,initial.config.origin));}finally{answers.fill('');}r.browser.storeSecret('organizationRecovery:'+m.owner+':'+m.session,{encrypted:JSON.stringify(encrypted,null,2),token:file.recoveryToken});put(r,ctx,{recovery:{fileName:file.fileName,passphrase,stage:'download'}});};
  const creationKey='organizationCreation:'+m.owner+':'+m.session;
  const created=async result=>{
   if(result.payment?.required){put(r,ctx,{stale:false,creation:{request:result.payment.request,org:result.payment.org,name:result.payment.name??null,plan:result.payment.plan??null,checkout:result.payment.checkout?.url??null}});await plans();return;}
   put(r,ctx,{creation:null});if(result.recoveryFile)await keepRecovery(result.recoveryFile,result.organization.id);r.browser.storeSecret(creationKey,null);await reload();await details(result.organization.id);
  };
  // A context loads the person's own membership first (any member may read it); admin surfaces follow only when the
  // organization itself reports the admin power. Each admin surface fails closed on its own without hiding the rest.
  const details=async id=>{
   put(r,ctx,{...privateFields,context:id,error:null});
   let membership;try{membership=await call('membership',undefined,id);}catch(error){if(refused(error)){put(r,ctx,{error:'not_found'});return;}throw error;}
   const powers=membership.powers??[],admin=powers.includes('admin'),privileged=admin||powers.includes('owner-of-record');
   const organization=privileged?await call('get',undefined,id):{...membership.organization,powers};
   put(r,ctx,{membership:{...membership.membership,powers},organization:{...organization,powers},stale:false});
   const requests=await call('requests',undefined,id);put(r,ctx,{requests:requests.requests??[]});
   // Billing, the offer, the claim and their decisions: loaded only for the owner of record and admins (other members
   // keep the ORG-5 read set; a read-only refusal explains itself on their next change).
   const ownership=async()=>{if(privileged)try{put(r,ctx,{ownership:await call('ownership',undefined,id)});}catch(error){if(!unavailable(error))throw error;}};
   if(!admin){await ownership();return;}
   try{const result=await call('members',undefined,id);put(r,ctx,{members:result.members??[],adminRequests:result.requests??[],membersUnavailable:false});}
   catch(error){if(error.code==='organization_deletion_pending')put(r,ctx,{membersUnavailable:'deletion_pending'});else if(refused(error))put(r,ctx,{membersUnavailable:true});else throw error;}
   try{const result=await call('connections',undefined,id);put(r,ctx,{connections:result.connections??[],connectionsUnavailable:false});}catch(error){if(unavailable(error))put(r,ctx,{connectionsUnavailable:true});else throw error;}
   try{const result=await call('preferences',undefined,id);put(r,ctx,{preferences:result.preferences??[],preferencesUnavailable:false});}catch(error){if(unavailable(error))put(r,ctx,{preferencesUnavailable:true});else throw error;}

   await ownership();
  };
  const change=async(action,input)=>{if(!org)fail('organization_required');put(r,ctx,{stale:true,error:null});const result=await call(action,input);put(r,ctx,{notice:'saved',...result.invitation?{invitation:result}:{}});try{if(action==='leave'){put(r,ctx,{...privateFields,context:null});await reload();}else await details(org);}catch{put(r,ctx,{error:'saved_stale'});}if(result.invitation)put(r,ctx,{invitation:result});return result;};
  try{
   // Returning from a Polar sandbox checkout. The redirect proves nothing: each path reloads server state, and creation
   // resumes only when the server verified the payment bound to the stored request.
   if(a==='entry'&&d.returnTo){
    publish(r,ctx,{view:'organizations'});await reload();
    if(d.returnTo==='checkout'){const attempt=r.browser.secret(creationKey);if(attempt&&attempt.request===d.request){put(r,ctx,{stale:true});await created(await call('create',attempt,null));}return;}
    if(UUID.test(d.org??'')&&(m.organizations.some(o=>o.id===d.org)||snapshot(r).organizationsConsole?.organizations?.some(o=>o.id===d.org)))await details(d.org);
    put(r,ctx,{notice:d.returnTo==='transfer'?'transfer_checkout_returned':'billing_checkout_returned'});return;
   }
   if(a==='entry'){if(!UUID.test(d.org??'')||typeof d.invitation!=='string'||!TOKEN.test(d.invitation))fail('invalid_request');if(m.recovery)fail('recovery_required');put(r,ctx,{...privateFields,context:null,entry:{org:d.org,invitation:d.invitation},error:null});publish(r,ctx,{view:'organizations'});return;}
   if(a==='reload'){await reload();await plans();if(m.context)await details(m.context);return;}
   if(a==='select'){if(m.recovery)fail('recovery_required');if(!d.org){put(r,ctx,{...privateFields,context:null,error:null});return;}await details(d.org);return;}
   if(a==='encrypt-recovery'||a==='download-recovery'||a==='verify-recovery'||a==='confirm-recovery'){
    const key='organizationRecovery:'+m.owner+':'+m.session,secret=r.browser.secret(key);if(!m.recovery||!secret)fail('recovery_required');
    if(a==='encrypt-recovery'){if(!secret.file)fail('recovery_required');const answers=[m.recovery.passphrase];let encrypted;try{encrypted=await checked(()=>r.recoveryFile.encrypt(JSON.parse(secret.file.content),[{id:'organization-passphrase',type:'passphrase',prompt:'Organization recovery passphrase',hint:''}],answers,initial.config.origin));}finally{answers.fill('');}r.browser.storeSecret(key,{encrypted:JSON.stringify(encrypted,null,2),token:secret.file.recoveryToken});put(r,ctx,{recovery:{...m.recovery,stage:'download'},stale:false,error:null});return;}
    if(a==='download-recovery'){if(!secret.encrypted)fail('recovery_required');r.browser.download(m.recovery.fileName,secret.encrypted);put(r,ctx,{recovery:{...m.recovery,stage:'verify'}});return;}
    if(a==='verify-recovery'){if(m.recovery.stage!=='verify')fail('recovery_required');const answers=[String(v.passphrase??'')];let payload;try{payload=await checked(()=>r.recoveryFile.decrypt(secret.encrypted,answers,initial.config.origin));}finally{answers.fill('');}if(payload.recoveryToken!==secret.token)fail('recovery_mismatch');put(r,ctx,{recovery:{...m.recovery,stage:'confirm'}});return;}
    if(m.recovery.stage!=='confirm'||v.confirm!==true)fail('review_required');r.browser.storeSecret(key,null);put(r,ctx,{recovery:null,notice:'recovery_saved'});return;
   }
   if(m.recovery)fail('recovery_required');if(m.stale&&a!=='accept')fail('reload_required');
   if(a==='create'){
    const prior=r.browser.secret(creationKey),input={name:String(v.name??''),label:String(v.label??'organization'),...v.plan?{plan:String(v.plan)}:{}},attempt=prior??{request:port.id(),...input};if(prior&&(prior.name!==input.name||prior.label!==input.label))fail('reload_required');r.browser.storeSecret(creationKey,attempt);put(r,ctx,{stale:true});
    await created(await call('create',attempt,null));return;
   }
   // Checkout at creation: the reservation exists unpaid; the checkout is created by this person's account.
   if(a==='creation-checkout'){if(!m.creation?.request||!['org-team','org-business','org-scale'].includes(v.plan))fail('review_required');const result=await call('creation-checkout',{request:m.creation.request,plan:v.plan},null);leave(result.checkout.url);return;}
   if(a==='creation-recheck'){const attempt=r.browser.secret(creationKey);if(!attempt||attempt.request!==m.creation?.request)fail('reload_required');put(r,ctx,{stale:true});await created(await call('create',attempt,null));return;}
   if(a==='creation-forget'){r.browser.storeSecret(creationKey,null);put(r,ctx,{creation:null});return;}
   // Ownership offers addressed to this person (§12b.3a): accept by paying for a fresh period, or decline.
   if(a==='accept-offer'||a==='decline-offer'){
    const row=m.offers.find(o=>o.id===d.org),offer=row?.offer;if(!offer||!offer.decisions?.includes(a==='accept-offer'?'accept':'decline')||v.confirm!==true)fail('review_required');
    if(a==='decline-offer'){await call('transfer',{operation:'decline',transfer:offer.id},row.id);put(r,ctx,{notice:'offer_declined'});await reload();return;}
    const plan=offer.plans.find(p=>p.plan===(v.plan??offer.currentPlan??offer.plans[0]?.plan));if(!plan)fail('review_required');
    const result=await call('transfer',{operation:'accept',transfer:offer.id,disclosure:plan.digest,confirm:true,...offer.choosePlan?{plan:plan.plan}:{}},row.id);leave(result.checkout.url);return;
   }
   if(a==='accept'){if(v.confirm!==true)fail('review_required');const target=invitationInput(v.invitation,org);if(!UUID.test(target.org??''))fail('review_required');await call('accept',{invitation:target.invitation},target.org);put(r,ctx,{notice:'joined',entry:null,...privateFields,context:target.org});await reload();await details(target.org);return;}
   // Ownership and billing for the current organization; the server advertises which decisions this member may take.
   if(['offer-resolve','offer','withdraw','object','block','renew','claim','reissue-recovery'].includes(a)){
    if(!org)fail('organization_required');const decisions=ownershipDecisions(m),transfer=m.ownership?.transfer;
    if(a==='offer-resolve'){if(!decisions.includes('offer'))fail('review_required');const result=await call('transfer-recipient',{handle:String(v.handle??'').trim()});put(r,ctx,{offerDraft:{recipient:result.recipient.id,handle:result.recipient.handle},error:null});return;}
    if(a==='offer'){if(!decisions.includes('offer')||!m.offerDraft||v.confirm!==true)fail('review_required');await change('transfer',{operation:'offer',recipient:m.offerDraft.recipient,handle:m.offerDraft.handle,admin:v.admin===true,confirm:true});return;}
    if(['withdraw','object','block'].includes(a)){if(!decisions.includes(a)||!transfer||v.confirm!==true)fail('review_required');await change('transfer',{operation:a,transfer:transfer.id,...v.reason?{reason:String(v.reason)}:{}});return;}
    if(a==='renew'||a==='claim'){if(!decisions.includes(a)||!['org-team','org-business','org-scale'].includes(v.plan)||a==='claim'&&v.confirm!==true)fail('review_required');const result=await call(a==='renew'?'billing-checkout':'claim',{plan:v.plan,...a==='claim'?{confirm:true}:{}});leave(result.checkout.url);return;}
    if(!decisions.includes('reissue-recovery')||v.confirm!==true)fail('review_required');const result=await call('recovery-file');await keepRecovery(result.recoveryFile,org);return;
   }
   if(a==='audit'){if(!org)fail('organization_required');const result=await call('audit');put(r,ctx,{audit:result.entries??[],error:null});return;}
   if(a==='rename'){await change(a,{name:String(v.name??''),expectedRevision:m.organization?.revision});return;}
   if(a==='label'){await change(a,{label:String(v.label??''),expectedRevision:m.organization?.revision});return;}
   if(a==='invite'){await change(a,{grants:json(v.grants,[]),...v.invitee?{invitee:json(v.invitee,null)}:{},...v.expiresAt!==undefined?{expiresAt:v.expiresAt}:{},...v.expires_at!==undefined?{expires_at:v.expires_at}:{}});return;}
   if(a==='leave'){if(v.confirm!==true)fail('review_required');await change(a,{});return;}
   if(a==='cancel-deletion'){if(m.organization?.state!=='deletion-scheduled'||v.confirm!==true)fail('review_required');await change(a,undefined);return;}
   if(a==='remove'||a==='grants'){if(!m.members.some(x=>x.id===d.id)||v.confirm!==true)fail('review_required');await change(a,{membership:d.id,...a==='grants'?{grants:json(v.grants,[])}:{},...v.reason?{reason:String(v.reason)}:{}});return;}
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
  }catch(error){put(r,ctx,{error:error.code??'unavailable'});}
 }
}
