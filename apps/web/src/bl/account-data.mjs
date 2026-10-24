// DX-8: owner data controls. Flags are the account projection of the server flags port, never env values.
import {Provider,Query} from '../shared/stack.mjs';
import {OwnerFlow,snapshot,publish} from './owner-flow.mjs';
export const dataFlags={ACCOUNT_EXPORT_ENABLED:'accountExportEnabled',ACCOUNT_DELETION_ENABLED:'accountDeletionEnabled',EMAIL_REMOVAL_ENABLED:'emailRemovalEnabled',OVER_QUOTA_RETENTION_ENABLED:'overQuotaRetentionEnabled'};
export const accountDataFeatures=s=>s.data?.features??s.session?.account?.consoleFeatures??{};
export const closureSession=s=>s.session?.account?.scope==='closure-export'||s.session?.scope==='closure-export';
const stamp=s=>({owner:s.session.account.id,session:s.session.sessionContext,generation:s.beamGeneration??0}),same=(a,s)=>!!a&&!!s.session?.account&&!s.offline&&a.owner===s.session.account.id&&a.session===s.session.sessionContext&&a.generation===(s.beamGeneration??0);
export const accountDataCurrent=s=>same(s.accountData,s)?s.accountData:null;
export class AccountDataFlags extends Provider {
 static deps=['state'];
 constructor({state}){super();this.state=state;}
 async obtain(){const state=await this.state.obtain();return {for:()=>({enabled:name=>accountDataFeatures(state.snapshot())[dataFlags[name]]===true})};}release(){}
}
export function accountDataProjection(s){const a=accountDataCurrent(s);return a?{...a,locale:s.locale==='es'?'es':'en',busy:s.busy,offline:s.offline,stepUp:s.stepUp,account:s.session.account,closure:closureSession(s),paid:(s.billing?.plan??s.data?.storage?.plan??'free')!=='free',flags:Object.fromEntries(Object.entries(dataFlags).map(([name,key])=>[key,accountDataFeatures(s)[key]===true]))}:null;}
export class AccountDataView extends Query {
 static deps=['state','browser'];
 boot({state,browser},{notify,engineFeed}){this.feed=engineFeed;this.refresh=()=>{this.cancel?.();const s=state.snapshot(),a=accountDataProjection(s);notify(a);if(s.session?.account&&!s.offline)this.cancel=browser.delay?.(()=>engineFeed.dispatchEvent(new Event('account-data-check-due')),30000);};engineFeed.addEventListener('browser-state-updated',this.refresh);this.refresh();}
 kill(){this.cancel?.();this.feed.removeEventListener('browser-state-updated',this.refresh);}
}
const update=(r,ctx,patch)=>publish(r,ctx,{accountData:{...accountDataCurrent(snapshot(r)),...patch,...patch.stale===true?{ticket:null}:{}}}),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const failure=code=>{throw Object.assign(Error(code),{code,status:code==='confirmation_required'?400:409});};
const notices={keep_selection_too_large:['The selected whole units exceed your current quota. Choose fewer units.','Las unidades completas seleccionadas superan tu cuota actual. Selecciona menos unidades.'],retention_conflict:['Your retention selection changed. Refresh and review it again.','Tu selección de conservación cambió. Actualiza y revísala de nuevo.'],export_unavailable:['Exports are temporarily unavailable. Your data has not been exported. Try again later.','Las exportaciones no están disponibles temporalmente. Tus datos no se han exportado. Inténtalo más tarde.'],last_notice_channel:['Email is your only notice channel. Enable device notifications or explicitly accept the notice waiver below.','El correo es tu único canal de avisos. Activa notificaciones en un dispositivo o acepta expresamente la renuncia a avisos.'],stale:['Your account changed. Refresh and review before trying again.','Tu cuenta cambió. Actualiza y revisa antes de intentarlo de nuevo.'],unknown:['The request may have completed. Refresh its status before trying again.','La solicitud puede haberse completado. Actualiza su estado antes de intentarlo de nuevo.'],deletion_in_progress:['Deletion has begun and can no longer be cancelled.','La eliminación ha comenzado y ya no se puede cancelar.'],deletion_not_cancellable:['This deletion cannot be cancelled here. Contact support to appeal.','Esta eliminación no se puede cancelar aquí. Contacta con soporte para apelar.'],forbidden:['This session is not allowed to make that change.','Esta sesión no tiene permiso para realizar ese cambio.'],terms_required:['Accept the current terms before waiving email notices. Export and deletion remain available.','Acepta los términos actuales antes de renunciar a los avisos por correo. La exportación y la eliminación siguen disponibles.'],confirmation_required:['Confirm every statement and type your full handle exactly.','Confirma cada declaración y escribe tu nombre de cuenta completo exactamente.'],email_changed:['Your email changed. Refresh and review the current address.','Tu correo cambió. Actualiza y revisa la dirección actual.'],export_active:['An export already exists. Refresh to review it.','Ya existe una exportación. Actualiza para revisarla.'],export_rate_limited:['The export limit has been reached. Try again later.','Se alcanzó el límite de exportaciones. Inténtalo más tarde.'],recovery_pending:['Finish account recovery before requesting deletion.','Termina la recuperación de la cuenta antes de solicitar la eliminación.'],admin_role_held:['An administrator must have their role removed before requesting deletion.','Hay que retirar el rol de administrador antes de solicitar la eliminación.'],deletion_unavailable:['Deletion is temporarily unavailable. Refresh its status later.','La eliminación no está disponible temporalmente. Actualiza su estado más tarde.']};
export function accountDataError(code,locale){const pair=notices[code]??['The service refused the request. Refresh your account and try again.','El servicio rechazó la solicitud. Actualiza tu cuenta e inténtalo de nuevo.'];return pair[locale==='es'?1:0];}
async function load(r,ctx){const s=snapshot(r),old=accountDataCurrent(s),ticket=crypto.randomUUID();update(r,ctx,{...stamp(s),ticket,phase:'loading',confirmation:null,error:null,notice:null});
 try{let exportError=null;const absent=error=>{if(error.code==='not_found'&&error.status===404)return null;throw error;},[deletion,exports,retention]=await Promise.all([r.api.get('/api/account/deletion').catch(absent),r.api.get('/api/exports').catch(error=>{if(error.status===401||['account_context_conflict','session_context_conflict','local_account_changed'].includes(error.code))throw error;exportError=error.code==='not_found'&&error.status===404?null:error.code??'unknown';return null;}),!closureSession(s)&&accountDataFeatures(s).overQuotaRetentionEnabled===true?r.api.get('/api/account/retention').catch(absent):Promise.resolve(null)]);if(!r.current()||accountDataCurrent(snapshot(r))?.ticket!==ticket)return;
  const changed=JSON.stringify(old?.deletion)!==JSON.stringify(deletion),interstitial=deletion?.state==='scheduled'&&(changed||old?.interstitial!==false);
  update(r,ctx,{phase:'ready',retention,exportError,exportStale:!!exportError,deletion:deletion??{state:'none'},jobs:Array.isArray(exports?.jobs)?exports.jobs:[],stale:false,interstitial,confirmation:null});
  if(interstitial&&!old?.interstitial)r.browser.focus?.('#account-data-title');
 }catch(error){if(accountDataCurrent(snapshot(r))?.ticket===ticket)update(r,ctx,{phase:'error',stale:true,error:error.code??'unknown'});}
}
export class AccountDataAction extends OwnerFlow {
 static deps={state:{write:true},api:{},browser:{},accountDataFlags:{}};
 constructor(kind,detail={}){super(detail);this.kind=kind;this.mutation=kind!=='check';}
 async execute(resources,ctx){const s=snapshot(resources),live=()=>snapshot(resources).session?.account?.id===s.session?.account?.id&&snapshot(resources).session?.sessionContext===s.session?.sessionContext&&(snapshot(resources).beamGeneration??0)===(s.beamGeneration??0)&&!snapshot(resources).offline;
  // A 401 from an older session cannot tear down its replacement through OwnerFlow's generic expiry path.
  const api=new Proxy(resources.api,{get:(target,key)=>['get','request'].includes(key)?async(...args)=>{if(!live())throw Error('Account changed.');try{const result=await target[key](...args);if(!live())throw Error('Account changed.');return result;}catch(error){if(!live())throw Error('Account changed.');throw error;}}:typeof target[key]==='function'?target[key].bind(target):target[key]});return super.execute({...resources,api},ctx);
 }
 async perform(resources,ctx,d){const initial=snapshot(resources),session=initial.session.sessionContext,r={...resources,current:()=>resources.current()&&snapshot(resources).session?.sessionContext===session},a=accountDataCurrent(initial),restricted=closureSession(initial),enabled=name=>r.accountDataFlags.for({subject:{kind:'account',owner:initial.session.account.id}}).enabled(name)===true;
  if(!uuid.test(initial.session.account.id)||typeof session!=='string'||!session)return;
  if(['open','refresh','check'].includes(this.kind)){if(this.kind==='open')publish(r,ctx,{view:'account-data',modal:null});await load(r,ctx);if(this.kind==='open'){r.browser.focus?.('#account-data-title');const episode=accountDataCurrent(snapshot(r))?.retention?.episode;if(episode&&!restricted&&!['resolved','within-quota'].includes(episode.state))await r.api.request('/api/account/retention/viewed',{});}return;}if(!a)return;
  if(this.kind==='keep'){update(r,ctx,{interstitial:false});r.browser.focus?.('#main-content');return;}
  if(this.kind==='back'){update(r,ctx,{confirmation:null,error:null});r.browser.focus?.('#account-data-title');return;}
  if(a.phase!=='ready'||a.stale)return;
  try{
   if(this.kind==='review'){if(restricted||!['deletion','email'].includes(d.operation)||!enabled(d.operation==='deletion'?'ACCOUNT_DELETION_ENABLED':'EMAIL_REMOVAL_ENABLED'))return;if(d.operation==='deletion'&&['scheduled','executing','deleted'].includes(a.deletion?.state))return;if(d.operation==='email'&&!initial.session.account.verifiedEmail)return;update(r,ctx,{confirmation:{operation:d.operation,handle:initial.session.account.handle,email:initial.session.account.verifiedEmail},error:null});r.browser.focus?.('#account-data-confirm-title');return;}
   if(this.kind==='cancel-deletion'){
    if(restricted||a.deletion?.state!=='scheduled'||a.deletion.cancellable!==true)return;
    const status=await r.api.get('/api/account/deletion');if(status.state!=='scheduled'||status.cancellable!==true){update(r,ctx,{deletion:status,interstitial:false});return;}
    update(r,ctx,{stale:true,confirmation:null});const result=await r.api.request('/api/account/deletion/cancel',{});update(r,ctx,{deletion:result,stale:false,interstitial:false,notice:'cancelled',error:null});r.browser.focus?.('#account-data-title');return;
   }
   if(this.kind==='retention-keep'){
    if(restricted||!enabled('OVER_QUOTA_RETENTION_ENABLED')||!a.retention?.episode)return;
    const episode=a.retention.episode,keepSelection=a.retention.units.filter(unit=>d.values?.['keep:'+unit.id]==='on').map(unit=>unit.id);
    const retention=await r.api.request('/api/account/retention/keep',{episodeId:episode.id,revision:episode.keepSelectionRevision,keepSelection});update(r,ctx,{retention,notice:'retention-saved',error:null});return;
   }
   if(this.kind==='export'||this.kind==='retention-export'){
    if(a.exportStale||!enabled('ACCOUNT_EXPORT_ENABLED')||this.kind==='retention-export'&&(!a.retention?.episode?.exportOffered||restricted))return;if(!uuid.test(d.operationId??''))failure('stale');update(r,ctx,{stale:true,error:null});const job=await r.api.request('/api/exports',{operationId:d.operationId,...this.kind==='retention-export'?{purpose:'over-quota',episodeId:a.retention?.episode?.id}:{purpose:'owner'}});update(r,ctx,{jobs:[job,...a.jobs.filter(j=>j.id!==job.id)],stale:false,notice:'exported'});return;
   }
   if(this.kind==='cancel-export'){
    if(!uuid.test(d.id??'')||!a.jobs.some(j=>j.id===d.id&&['queued','generating','sealing','ready'].includes(j.state)))return;update(r,ctx,{stale:true,error:null});const job=await r.api.request('/api/exports/'+d.id+'/cancel',{});update(r,ctx,{jobs:a.jobs.map(j=>j.id===d.id?job:j),stale:false,notice:'export-cancelled'});return;
   }
   const c=a.confirmation,v=d.values??{};if(restricted||!c||this.kind!==c.operation)return;
   if(c.handle!==initial.session.account.handle||c.email!==initial.session.account.verifiedEmail)failure('stale');
   if(this.kind==='deletion'){
    if(!enabled('ACCOUNT_DELETION_ENABLED'))return;
    const handle='@'+c.handle.replace(/^@/,''),paid=!!accountDataProjection(initial).paid;if(v.confirmHandle!==handle||!['messages','storage','names',...paid?['plan']:[]].every(key=>v[key]==='on')||!uuid.test(d.operationId??''))failure('confirmation_required');
    const status=await r.api.get('/api/account/deletion');if(!['none','cancelled'].includes(status.state))failure('stale');
    update(r,ctx,{stale:true,confirmation:null,error:null});const deletion=await r.api.request('/api/account/deletion',{operationId:d.operationId,confirmHandle:v.confirmHandle,acknowledgements:{messages:true,storage:true,names:true,...paid?{plan:true}:{}}});update(r,ctx,{deletion,stale:false,interstitial:true,notice:null});r.browser.focus?.('#account-data-title');return;
   }
   if(!enabled('EMAIL_REMOVAL_ENABLED'))return;if(v.confirmed!=='on')failure('confirmation_required');
   update(r,ctx,{stale:true,error:null});const result=await r.api.request('/api/auth/email/remove',{confirmed:true,expectedEmail:c.email,waiveNotice:v.waiveNotice==='on'});
   if(result.removed!==true||result.account?.id!==initial.session.account.id)failure('unknown');publish(r,ctx,{session:{...snapshot(r).session,account:result.account},...snapshot(r).data?{data:{...snapshot(r).data,account:result.account}}:{}});update(r,ctx,{confirmation:null,stale:false,notice:'email-removed',error:null});r.browser.focus?.('#account-data-title');
  }catch(error){if(!r.current())return;const uncertain=!error.status||error.status>=500,stale=uncertain||['stale','email_changed','deletion_in_progress','deletion_scheduled','export_active','retention_conflict'].includes(error.code);update(r,ctx,{error:error.code==='export_unavailable'?'export_unavailable':uncertain?'unknown':error.code??'forbidden',stale,phase:stale?'error':'ready',...error.code==='last_notice_channel'?{needsWaiver:true}:{},...stale?{confirmation:null}:{}});}
 }
}
// The existing sign-in adapter retains account fields but discards top-level session scope. Normalize that
// contract at the API boundary and avoid the ordinary full snapshot read for a closure-export session.
export function bindAccountDataAPI(api){const request=api.request.bind(api),setContext=api.setContext?.bind(api),clearContext=api.clearContext?.bind(api);let restricted=null,features={};if(setContext)api.setContext=result=>{restricted=result?.account?.scope==='closure-export'?result.account:null;return setContext(result);};if(clearContext)api.clearContext=(...args)=>{restricted=null;features={};return clearContext(...args);};api.request=async(path,...args)=>{if(path==='/api/account'&&restricted)return {account:restricted,features};const result=await request(path,...args);if(result?.account&&result.features&&typeof result.features==='object')result.account={...result.account,consoleFeatures:result.features};if(result?.account&&result.scope==='closure-export'){features=result.features??{};result.account={...result.account,scope:'closure-export',closure:result.closure??result.account.closure};}if(path==='/api/session'||result?.account&&['/api/auth/login/password','/api/auth/login/passkey/finish'].includes(path))restricted=result.account?.scope==='closure-export'?result.account:null;return result;};return api;}
