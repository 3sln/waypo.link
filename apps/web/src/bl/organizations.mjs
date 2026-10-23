import {Query} from '../shared/stack.mjs';
import {OwnerFlow,snapshot,publish} from './owner-flow.mjs';
export const organizationsEnabled=s=>(s.data?.features?.organizationsEnabled??s.session?.account?.consoleFeatures?.organizationsEnabled??s.config?.organizationsEnabled)===true;
export const organizationsModel=s=>organizationsEnabled(s)&&!s.offline&&s.session?.account?.id&&s.organizationsConsole?.owner===s.session.account.id&&s.organizationsConsole?.session===s.session.sessionContext&&s.organizationsConsole?.generation===(s.beamGeneration??0)?s.organizationsConsole:null;
const same=(a,b)=>a?.iss===b?.iss&&a?.sub===b?.sub;
// Visibility is derived from the authenticated person's identity and loaded membership,
// never from form claims. The server rechecks every decision and fresh authentication.
export function organizationsRequestDecisions(s,q,now=Date.now()){
 const m=organizationsModel(s);if(!m||!q||!['subject','elevated'].includes(q.state))return [];
 const actor={iss:s.config.origin,sub:s.session.account.id},subject=m.members.find(x=>x.id===q.target)?.principal,owner=m.organization?.ownerOfRecord,actions=[];
 if(same(actor,subject)||q.state==='elevated'&&same(actor,owner))actions.push('accept','reject');
 if(same(actor,q.requester)){if(q.state==='subject'&&!same(subject,owner)&&(q.subjectRejected||now>=q.elevateAt))actions.push('elevate');actions.push('retract');}return actions;
}
const base=s=>organizationsModel(s)??{owner:s.session.account.id,session:s.session.sessionContext,generation:s.beamGeneration??0,organizations:[],pending:[],context:null,members:[],requests:[],audit:[]};
const json=(value,fallback)=>{if(value===undefined||value==='')return fallback;if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{fail('invalid_request');}};
const fail=code=>{throw Object.assign(Error(code),{code});};
const put=(r,ctx,p)=>publish(r,ctx,{organizationsConsole:{...base(snapshot(r)),...p}});
const privateFields={organization:null,members:[],requests:[],audit:[],invitation:null};
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
  const reload=async()=>{const list=await call('list',undefined,null);put(r,ctx,{organizations:list.organizations??[],pending:list.pending??[],stale:false,error:null});};
  const details=async id=>{put(r,ctx,{...privateFields,context:id,error:null});const organization=await call('get',undefined,id);put(r,ctx,{organization,stale:false});try{const result=await call('members',undefined,id);put(r,ctx,{members:result.members??[],requests:result.requests??[],membersUnavailable:false});}catch(error){if(error.status===403||error.status===404||error.code==='not_found')put(r,ctx,{membersUnavailable:true});else throw error;}};
  const change=async(action,input)=>{if(!org)fail('organization_required');put(r,ctx,{stale:true,error:null});const result=await call(action,input);put(r,ctx,{notice:'saved',...result.invitation?{invitation:result}:{}});try{if(action==='leave'){put(r,ctx,{...privateFields,context:null});await reload();}else await details(org);}catch{put(r,ctx,{error:'saved_stale'});}if(result.invitation)put(r,ctx,{invitation:result});return result;};
  try{
   if(a==='entry'){if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(d.org??'')||typeof d.invitation!=='string'||!d.invitation||d.invitation.length>128)fail('invalid_request');if(m.recovery)fail('recovery_required');put(r,ctx,{...privateFields,context:null,entry:{org:d.org,invitation:d.invitation},error:null});publish(r,ctx,{view:'organizations'});return;}
   if(a==='reload'){await reload();if(m.context)await details(m.context);return;}
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
    const key='organizationCreation:'+m.owner+':'+m.session,prior=r.browser.secret(key),input={name:String(v.name??''),label:String(v.label??'organization')},attempt=prior??{request:port.id(),...input};if(prior&&(prior.name!==input.name||prior.label!==input.label))fail('reload_required');r.browser.storeSecret(key,attempt);put(r,ctx,{stale:true});
    const result=await call('create',attempt,null);if(result.recoveryFile){const passphrase=port.passphrase(),answers=[passphrase],questions=[{id:'organization-passphrase',type:'passphrase',prompt:'Organization recovery passphrase',hint:''}];r.browser.storeSecret('organizationRecovery:'+m.owner+':'+m.session,{file:result.recoveryFile});put(r,ctx,{recovery:{fileName:result.recoveryFile.fileName,passphrase,stage:'encrypt'},context:result.organization.id,...privateFields});let encrypted;try{encrypted=await checked(()=>r.recoveryFile.encrypt(JSON.parse(result.recoveryFile.content),questions,answers,initial.config.origin));}finally{answers.fill('');}r.browser.storeSecret('organizationRecovery:'+m.owner+':'+m.session,{encrypted:JSON.stringify(encrypted,null,2),token:result.recoveryFile.recoveryToken});put(r,ctx,{recovery:{fileName:result.recoveryFile.fileName,passphrase,stage:'download'}});}r.browser.storeSecret(key,null);await reload();await details(result.organization.id);return;
   }
   if(a==='accept'){if(!org||v.confirm!==true)fail('review_required');await call('accept',{invitation:String(v.invitation??'')});put(r,ctx,{notice:'joined',entry:null,context:org,...privateFields});await reload();return;}
   if(a==='audit'){if(!org)fail('organization_required');const result=await call('audit');put(r,ctx,{audit:result.entries??[],error:null});return;}
   if(a==='rename'){await change(a,{name:String(v.name??''),expectedRevision:m.organization?.revision});return;}
   if(a==='label'){await change(a,{label:String(v.label??''),expectedRevision:m.organization?.revision});return;}
   if(a==='invite'){await change(a,{grants:json(v.grants,[]),...v.invitee?{invitee:json(v.invitee,null)}:{},...v.expiresAt!==undefined?{expiresAt:v.expiresAt}:{},...v.expires_at!==undefined?{expires_at:v.expires_at}:{}});return;}
   if(a==='leave'){if(v.confirm!==true)fail('review_required');await change(a,{});return;}
   if(a==='remove'||a==='grants'){if(!m.members.some(x=>x.id===d.id)||v.confirm!==true)fail('review_required');await change(a,{membership:d.id,...a==='grants'?{grants:json(v.grants,[])}:{},...v.reason?{reason:String(v.reason)}:{}});return;}
   if(a==='decide'){if(!['accept','reject','elevate','retract'].includes(v.decision)||v.confirm!==true)fail('review_required');await change(a,{request:String(d.id??v.request??''),decision:v.decision});return;}
   fail('invalid_request');
  }catch(error){put(r,ctx,{error:error.code??'unavailable'});}
 }
}
