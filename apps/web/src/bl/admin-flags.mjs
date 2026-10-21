import {Action} from '../shared/stack.mjs';
import {AdminAction,current,update,failure,sessionFailure} from './admin-access.mjs';
import {Navigate} from './admin-console.mjs';
// Kept under overview so the existing expiry/sign-out/authority reset drops
// every flag datum, including the pending proposal, in the same transition.
export const flagsState=state=>state.overview?.featureFlags??{};
export const flagState=r=>flagsState(current(r));
export function patchFlags(r,ctx,patch){update(r,ctx,state=>({overview:{...state.overview,featureFlags:{...flagsState(state),...patch}}}));}
export const flagCall=(r,op,input={})=>r.api.call(current(r).mode,'/api/admin/flags/'+op,input);
const copy=value=>structuredClone(value),tokens=value=>String(value??'').split(/[\s,]+/).filter(Boolean);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function resolveFlagAccounts(r,record){
 const next=copy(record),resolved=new Map(),lists=[next.deny?.accounts,...next.rules.map(rule=>rule.when.accounts),next.experiment?.eligibility?.when?.accounts].filter(Array.isArray);
 for(const list of lists)for(let i=0;i<list.length;i++){const text=list[i];if(UUID.test(text)){list[i]=text.toLowerCase();continue;}const handle=String(text).replace(/^@/,'');if(!resolved.has(handle)){const result=await r.api.call(current(r).mode,'/api/admin/users/lookup',{handle}),owner=result.user?.id;if(!UUID.test(owner??''))throw failure('not_found');resolved.set(handle,owner);}list[i]=resolved.get(handle);}
 return next;
}
export function draftFromValues(row,draft,values){
 if(!values)return copy(draft);const next=copy(draft),dims=row.registry.dimensions;
 next.on=values.on==='on';next.fallthrough=values.fallthrough==='true';
 if(row.registry.retainExisting)next.retainExisting=values.retainExisting==='on';
 next.deny={accounts:dims.includes('A')?tokens(values.denyAccounts):[],clients:dims.includes('C')?tokens(values.denyClients):[]};
 next.rules=next.rules.map((rule,i)=>{
  const when={},prefix='rule-'+i+'-';
  for(const [key,d]of [['accounts','A'],['clients','C'],['shards','S'],['countries','R'],['subdivisions','R']])if(dims.includes(d)&&tokens(values[prefix+key]).length)when[key]=tokens(values[prefix+key]);
  if(values[prefix+'subject'])when.subject=values[prefix+'subject'];
  const from=values[prefix+'from'],until=values[prefix+'until'];if(dims.includes('G')&&(from||until))when.window={...from?{from}:{},...until?{until}:{}};
  const serve={value:values[prefix+'value']==='true'};if(dims.includes('P')&&values[prefix+'percent']!=='')serve.percent=Number(values[prefix+'percent']);
  return {when,serve};
 });return next;
}
export async function reloadFlags(r,ctx){const list=await flagCall(r,'list');patchFlags(r,ctx,{list});return list;}
export class FlagsAction extends AdminAction {
 async failed(r,ctx,error){
  const code=error?.code??'unexpected_response';patchFlags(r,ctx,{pending:null});
  if(code==='conflict'){const list=await reloadFlags(r,ctx).catch(()=>null),row=list?.flags.find(row=>row.name===flagState(r).selected);if(row)patchFlags(r,ctx,{draft:copy(row.record),history:null,explanation:null,results:null});}
  if(code==='step_up_required')update(r,ctx,{error:{code,message:'Confirm with a passkey and try again.'}});
  else update(r,ctx,{error:{code}});
 }
}
export class FlagsNavigate extends Navigate {
 async execute(r,ctx){if(!['flags','experiments'].includes(this.detail.view))return super.execute(r,ctx);if(current(r).busy)return;patchFlags(r,ctx,{selected:null,pending:null,screen:'list'});update(r,ctx,{view:this.detail.view,reveal:null,error:null,notice:'',busy:true});r.browser.focus('#admin-heading');try{await reloadFlags(r,ctx);}catch(error){if(!sessionFailure(r,ctx,error))update(r,ctx,{error:{code:error?.code??'unexpected_response'}});}finally{if(current(r).busy)update(r,ctx,{busy:false});}}
}
export class FlagListScreen extends Action {static deps={state:{write:true},browser:{}};execute(r,ctx){if(current(r).busy)return;patchFlags(r,ctx,{selected:null,pending:null,screen:'list'});r.browser.focus('#admin-heading');}}
export class LoadFlags extends FlagsAction {async perform(r,ctx){await reloadFlags(r,ctx);}}
export class SelectFlag extends FlagsAction {
 async perform(r,ctx,detail){const list=await reloadFlags(r,ctx),row=list.flags.find(row=>row.name===detail.name);if(!row)throw failure('not_found');patchFlags(r,ctx,{selected:row.name,draft:copy(row.record),pending:null,history:null,explanation:null,results:null,screen:detail.screen??'edit'});r.browser.focus('#flag-editor-heading');}
}
export class RuleEdit extends Action {
 static deps={state:{write:true},browser:{}};constructor(detail){super();this.detail=detail;}
 execute(r,ctx){if(current(r).busy)return;const f=flagState(r),row=f.list?.flags.find(row=>row.name===f.selected);if(!row||!f.draft)return;const draft=draftFromValues(row,f.draft,this.detail.values),rules=draft.rules,i=this.detail.index;
  if(this.detail.operation==='add'&&rules.length<32)rules.push({when:{},serve:{value:row.registry.safe}});
  if(this.detail.operation==='remove'&&rules[i])rules.splice(i,1);
  if(['up','down'].includes(this.detail.operation)){const j=i+(this.detail.operation==='up'?-1:1);if(rules[i]&&rules[j])[rules[i],rules[j]]=[rules[j],rules[i]];}
  patchFlags(r,ctx,{draft,pending:null});if(Number.isInteger(i)&&['up','down'].includes(this.detail.operation))r.browser.focus('[data-rule="'+Math.max(0,i+(this.detail.operation==='up'?-1:1))+'"] button');
 }
}
export async function previewChange(r,ctx,action,extra={}){
 const f=flagState(r),row=f.list?.flags.find(row=>row.name===f.selected);if(!row)throw failure('not_found');
 if(action==='update'&&extra.record){extra={...extra,record:await resolveFlagAccounts(r,extra.record)};patchFlags(r,ctx,{draft:extra.record});}
 const input={name:row.name,expectedRevision:row.record?.rev??null,expectedVersion:f.list.version,...extra};
 const preview=await flagCall(r,'preview',{...input,action});patchFlags(r,ctx,{pending:{action,input,preview}});r.browser.focus('#flag-preview-heading');
}
export class PreviewFlag extends FlagsAction {
 async perform(r,ctx,detail){const f=flagState(r),row=f.list?.flags.find(row=>row.name===f.selected);if(!row)throw failure('not_found');let extra={};const action=detail.action??'update';
  if(action==='update'){const draft=draftFromValues(row,f.draft,detail.values);patchFlags(r,ctx,{draft});extra={record:draft};}
  if(action==='rollback')extra={revision:detail.revision};await previewChange(r,ctx,action,extra);
 }
}
export class ConfirmFlag extends FlagsAction {
 async perform(r,ctx,detail){
  const pending=flagState(r).pending;if(!pending)throw failure('preview_stale');const {action,input,preview}=pending,values=detail.values??{};
  if(values.previewAcknowledged!=='on')throw failure('acknowledgement_required');
  const gates=preview.requiredGates,acknowledgeGates=gates.filter(gate=>values['gate-'+gate]==='on');
  if(acknowledgeGates.length!==gates.length)throw failure('gates_unacknowledged');
  if(preview.critical&&(values.typedName!==input.name||String(values.reason??'').trim().length<10))throw failure(values.typedName!==input.name?'typed_name_required':'reason_required');
  const boot=current(r).mode==='boot',options=await r.api.call(current(r).mode,boot?'/api/admin/boot/login/begin':'/api/admin/step-up/begin',{});
  if(!options.passkey)throw failure('passkey_required');const response=await r.browser.authenticatePasskey(options.authenticationOptions);
  const result=await flagCall(r,action,{...input,previewDigest:preview.digest,reason:values.reason,typedName:values.typedName,acknowledgeGates,passkeyResponse:response,...boot?{challengeId:options.challengeId}:{}});
  patchFlags(r,ctx,{pending:null,draft:copy(result.record),history:null,results:null,saved:true});await reloadFlags(r,ctx);update(r,ctx,{stepUpAt:r.browser.now()});r.browser.focus('#flag-editor-heading');
 }
 async failed(r,ctx,error){if(['acknowledgement_required','gates_unacknowledged','reason_required','typed_name_required','passkey_cancelled','passkey_required'].includes(error?.code)){update(r,ctx,{error:{code:error.code}});return;}await super.failed(r,ctx,error);}
}
export class FlagHistory extends FlagsAction {async perform(r,ctx){patchFlags(r,ctx,{history:null});patchFlags(r,ctx,{history:await flagCall(r,'history',{name:flagState(r).selected}),screen:'history',pending:null});}}
export class ExplainFlag extends FlagsAction {
 async perform(r,ctx,detail){patchFlags(r,ctx,{explanation:null});const v=detail.values??{};let owner=String(v.owner??'').trim();
  if(v.handle){const result=await r.api.call(current(r).mode,'/api/admin/users/lookup',{handle:String(v.handle).trim().replace(/^@/,'')});owner=result.user?.id;if(!owner)throw failure('not_found');}
  const context={subject:owner?{kind:'account',owner}:{kind:'anonymous'},client:v.client?{clientId:v.client}:null,region:{country:v.country||'unknown',...v.subdivision?{subdivision:v.subdivision}:{}},now:r.browser.now()};
  patchFlags(r,ctx,{explanation:await flagCall(r,'explain',{name:flagState(r).selected,context})});
 }
}
export class VerifyFlags extends FlagsAction {async perform(r,ctx){patchFlags(r,ctx,{verification:null,screen:'cutover',pending:null});patchFlags(r,ctx,{verification:await flagCall(r,'seed-verify')});}}
export const flagConstructors={'navigate':FlagsNavigate,'flags-list':FlagListScreen,'flags-load':LoadFlags,'flags-select':SelectFlag,'flags-rule':RuleEdit,'flags-preview':PreviewFlag,'flags-confirm':ConfirmFlag,'flags-history':FlagHistory,'flags-explain':ExplainFlag,'flags-verify':VerifyFlags};
