import {Action} from '../shared/stack.mjs';
import {AdminAction,current,update,failure,sessionFailure} from './admin-access.mjs';
import {FlagsNavigate} from './admin-flags.mjs';
// ORG-12d support adjudication screens (organizations design §12d.8). Operators are administrators holding the
// internal `support.org-break-glass` capability; boot is never an operator. The server is the authority for every
// rule (two operators, barred pairs, exclusions, the daily limit); the checks here only avoid offering a request it
// would refuse. Case data is kept under `overview` so expiry, sign-out and lost authority drop it in the same
// transition as every other console datum (consoleReset).
export const ORG_CASES_VIEW='org-cases';
export const DECISIONS=Object.freeze({'break-glass':Object.freeze(['acknowledge','note','abort','proceed','uphold','reject']),'lapse-claim':Object.freeze(['close','proceed'])});
/** Two-operator decisions. */
export const TWO_OPERATOR=Object.freeze(['proceed','uphold','reject']);
/** Review M2: only these are gated by ORG_BREAK_GLASS_ENABLED; upholding a contest (restoring the former owner) never is. */
export const GATED=Object.freeze(['proceed','reject']);
/** Review L1: the lapse-claim writer accepts at most 280 characters. */
export const LAPSE_REASON_MAX=280;
export const REASON_REQUIRED=Object.freeze(['note','abort','close','proceed','uphold','reject']);
export const CATEGORY_REQUIRED=Object.freeze(['abort','close','proceed','uphold','reject']);
export const CATEGORIES=Object.freeze(['evidence-reviewed','channel-compromised','channel-undeliverable','owner-responded','insufficient-evidence','other']);
export const DAILY_DECISIONS=20;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH='/api/admin/org-cases/';
export const caseState=state=>state.overview?.orgCases??{};
export const orgCaseState=r=>caseState(current(r));
export function patchCases(r,ctx,patch){update(r,ctx,state=>({overview:{...state.overview??{},orgCases:{...caseState(state),...typeof patch==='function'?patch(caseState(state)):patch}}}));}
const call=(r,op,body={})=>r.api.call('admin',PATH+op,body);
const strings=value=>[].concat(value??[]).filter(item=>typeof item==='string');

/** Which decisions this operator may take now, from the server's `allowed` list narrowed by what the console knows. */
export function availableDecisions(c){
 if(!c||!Array.isArray(c.allowed))return [];
 const kinds=DECISIONS[c.kind]??[];
 return c.allowed.filter(d=>kinds.includes(d)&&!(GATED.includes(d)&&c.seizingEnabled===false)&&!(c.barred===true&&d==='proceed'));
}
/** The proposal the second operator may approve (another operator's, of a decision still allowed), or null. */
// Review M1: a proposal whose proposer no longer holds the capability cannot be approved; the server turns the call
// into a new proposal, so the console offers "propose" instead.
export function approvable(c){const p=c?.proposal;return p&&p.mine!==true&&p.proposerActive!==false&&availableDecisions(c).includes(p.decision)?p:null;}
/** Two-operator decisions this operator may propose: not one they already proposed, not one awaiting their approval. */
export function proposable(c){const p=c?.proposal;return availableDecisions(c).filter(d=>TWO_OPERATOR.includes(d)&&!(p&&p.decision===d&&p.proposerActive!==false));}
export const singleDecisions=c=>availableDecisions(c).filter(d=>!TWO_OPERATOR.includes(d));
export const excludableChannels=c=>(c?.channels??[]).filter(ch=>ch.excludable===true);

/** Validates and builds the decide body (without the passkey response). Throws a coded failure. */
export function decisionBody(c,detail){
 if(!c||!UUID.test(c.org??'')||!UUID.test(c.process??''))throw failure('not_found');
 const values=detail.values??{},approving=detail.approve===true,p=approving?approvable(c):null;
 if(approving&&!p)throw failure('second_operator_required');
 const decision=approving?p.decision:detail.decision;
 if(!availableDecisions(c).includes(decision))throw failure('not_allowed');
 if(!approving&&TWO_OPERATOR.includes(decision)&&!proposable(c).includes(decision))throw failure('second_operator_required');
 const body={org:c.org,kind:c.kind,process:c.process,decision};
 const reason=typeof values.reason==='string'?values.reason.trim():'';
 if(REASON_REQUIRED.includes(decision)&&([...reason].length<10||[...reason].length>500))throw failure('reason_required');
 if(c.kind==='lapse-claim'&&[...reason].length>LAPSE_REASON_MAX)throw failure('invalid_reason');
 if(reason)body.reason=reason;
 const category=typeof values.category==='string'?values.category:'';
 if(CATEGORY_REQUIRED.includes(decision)&&!CATEGORIES.includes(category))throw failure('category_required');
 if(CATEGORIES.includes(category))body.category=category;
 if(c.kind==='break-glass'&&decision==='proceed'){
  // The approver sends exactly the proposal's exclusions; a proposer may exclude only disputed or undeliverable
  // channels and never every channel (the server refuses `invalid_exclusion` and `last_channel` too).
  const exclude=approving?[...p.exclude]:strings(values.exclude);
  const allowed=new Set(excludableChannels(c).map(ch=>ch.id));
  if(!approving&&exclude.some(id=>!allowed.has(id)))throw failure('invalid_exclusion');
  if(new Set(exclude).size>=(c.channels??[]).length)throw failure('last_channel');
  body.exclude=[...new Set(exclude)].sort();
 }
 return body;
}
async function loadList(r,ctx,startAfter){
 const body=typeof startAfter==='string'&&startAfter?{startAfter}:{};const result=await call(r,'list',body);
 if(!Array.isArray(result?.cases))throw failure('unexpected_response');
 const trail=orgCaseState(r).list?.trail??[];
 patchCases(r,ctx,{list:{cases:result.cases,next:typeof result.next==='string'?result.next:null,startAfter:body.startAfter??null,trail:body.startAfter?[...trail,body.startAfter]:[]}});
}
async function loadCase(r,ctx,org){
 if(!UUID.test(org??''))throw failure('not_found');const result=await call(r,'get',{org});
 if(!result?.case||result.case.org!==org)throw failure('unexpected_response');
 patchCases(r,ctx,{selected:org,detail:result.case,decisionsLeft:Number.isSafeInteger(result.case.decisionsLeft)?result.case.decisionsLeft:orgCaseState(r).decisionsLeft??null});
}
/** Base: failures stay on the case screens (codes the shared console does not know), never as stale data. */
export class OrgCaseAction extends AdminAction {
 async failed(r,ctx,error){patchCases(r,ctx,{error:{code:error?.code??'unexpected_response'}});}
}
export class OrgCasesNavigate extends FlagsNavigate {
 async execute(r,ctx){
  if(this.detail.view!==ORG_CASES_VIEW)return super.execute(r,ctx);
  const state=current(r);if(state.busy||state.mode!=='admin')return;
  update(r,ctx,{view:ORG_CASES_VIEW,reveal:null,error:null,notice:'',busy:true});
  patchCases(r,ctx,{screen:'queue',pending:null,error:null,notice:null});r.browser.focus('#admin-heading');
  try{
   // The org-case data lives inside `overview`: load the overview first so a later refresh cannot race it away.
   if(!current(r).overview?.catalog)update(r,ctx,{overview:{...await r.api.call('admin','/api/admin/overview',{}),orgCases:caseState(current(r))}});
   await loadList(r,ctx);
  }catch(error){if(!sessionFailure(r,ctx,error))patchCases(r,ctx,{error:{code:error?.code??'unexpected_response'}});}
  finally{if(current(r).busy)update(r,ctx,{busy:false});}
 }
}
export class LoadOrgCases extends OrgCaseAction {async perform(r,ctx,detail){patchCases(r,ctx,{error:null,notice:null});await loadList(r,ctx,detail.startAfter);}}
export class OrgCasesBack extends OrgCaseAction {async perform(r,ctx){const trail=orgCaseState(r).list?.trail??[];patchCases(r,ctx,{list:{...orgCaseState(r).list,trail:trail.slice(0,-2)}});await loadList(r,ctx,trail.at(-2)??'');}}
export class OpenOrgCase extends OrgCaseAction {
 async perform(r,ctx,detail){patchCases(r,ctx,{screen:'case',detail:null,pending:null,error:null,notice:null});await loadCase(r,ctx,detail.org);r.browser.focus('#org-case-heading');}
 async failed(r,ctx,error){patchCases(r,ctx,{detail:null});await super.failed(r,ctx,error);}
}
export class OrgCaseQueue extends OrgCaseAction {async perform(r,ctx){patchCases(r,ctx,{screen:'queue',selected:null,detail:null,pending:null,error:null,notice:null});await loadList(r,ctx);r.browser.focus('#admin-heading');}}
export class LoadOrgCaseAudit extends OrgCaseAction {
 async perform(r,ctx,detail){
  patchCases(r,ctx,{screen:'audit',pending:null,error:null,notice:null});const body=Number.isSafeInteger(detail.before)&&detail.before>0?{before:detail.before}:{};
  const result=await call(r,'audit',body);if(!Array.isArray(result?.entries))throw failure('unexpected_response');
  patchCases(r,ctx,{audit:{entries:result.entries,next:Number.isSafeInteger(result.next)?result.next:null,before:body.before??null}});r.browser.focus('#org-case-audit-heading');
 }
 async failed(r,ctx,error){patchCases(r,ctx,{audit:null});await super.failed(r,ctx,error);}
}
/** Opens the form for one decision (or the approval form); purely local. */
export class OpenDecisionForm extends Action {
 static deps={state:{write:true},browser:{}};constructor(detail){super();this.detail=detail;}
 execute(r,ctx){if(current(r).busy)return;const c=orgCaseState(r).detail;if(!c)return;
  if(this.detail.decision===null){patchCases(r,ctx,{pending:null});return;}
  const approve=this.detail.approve===true;if(approve?!approvable(c):!availableDecisions(c).includes(this.detail.decision))return;
  patchCases(r,ctx,{pending:{decision:approve?approvable(c).decision:this.detail.decision,approve},error:null,notice:null});r.browser.focus('#org-case-form-heading');}
}
export class DecideOrgCase extends OrgCaseAction {
 async perform(r,ctx,detail){
  const s=orgCaseState(r),c=s.detail,pending=s.pending;if(!c||!pending)throw failure('not_found');
  const body=decisionBody(c,{...detail,decision:pending.decision,approve:pending.approve===true});
  if(Number.isSafeInteger(s.decisionsLeft)&&s.decisionsLeft<=0)throw failure('decision_limit');
  // Every decision carries its own passkey confirmation, whose challenge the server binds to exactly this decision
  // (review L7), and issues one single-use operator assertion for it.
  const {org,kind,process,decision,exclude}=body,options=await call(r,'challenge',{org,kind,process,decision,...exclude?{exclude}:{}});if(!options?.passkey)throw failure('passkey_required');
  const passkeyResponse=await r.browser.authenticatePasskey(options.authenticationOptions);
  const result=await call(r,'decide',{...body,passkeyResponse});
  if(!['proposed','approved','recorded'].includes(result?.outcome))throw failure('unexpected_response');
  update(r,ctx,{stepUpAt:r.browser.now()});
  patchCases(r,ctx,{pending:null,notice:{outcome:result.outcome,decision:body.decision},decisionsLeft:Number.isSafeInteger(result.decisionsLeft)?result.decisionsLeft:s.decisionsLeft??null});
  await loadCase(r,ctx,c.org);await loadList(r,ctx).catch(()=>{});
  // loadCase replaces decisionsLeft with the server's view; keep the decide answer if the detail omitted it.
  r.browser.focus('#org-case-heading');
 }
 async failed(r,ctx,error){
  const code=error?.code??'unexpected_response';patchCases(r,ctx,{error:{code}});
  // The case may have moved on (another operator approved, the owner disputed): show the server's current view.
  if(['conflict','not_found','second_operator_required','operator_pair_barred','owner_proof_recent','last_channel','invalid_exclusion'].includes(code)){const org=orgCaseState(r).detail?.org;if(org)await loadCase(r,ctx,org).catch(()=>{});}
 }
}
export class DismissOrgCaseMessage extends Action {static deps={state:{write:true}};execute(r,ctx){patchCases(r,ctx,{error:null,notice:null});}}
export const orgCaseConstructors={navigate:OrgCasesNavigate,'org-cases-load':LoadOrgCases,'org-cases-back':OrgCasesBack,'org-cases-open':OpenOrgCase,'org-cases-queue':OrgCaseQueue,'org-cases-audit':LoadOrgCaseAudit,'org-cases-form':OpenDecisionForm,'org-cases-decide':DecideOrgCase,'org-cases-dismiss':DismissOrgCaseMessage};
