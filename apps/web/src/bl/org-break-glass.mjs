// ORG-12e break-glass console logic (docs/architecture/organizations-design.md §12d.12 "UI surfaces"). Render-only
// helpers plus the intent steps OrganizationsIntent delegates here (`bg-*` actions). Every decision offered comes from
// the server's role-filtered view (orgs.breakglass) or the person-level notices (GET /api/orgs/break-glass); the server
// rechecks each one. No channel details, causes or tokens are ever derived or kept here.
import {OwnerFlow,snapshot,publish} from './owner-flow.mjs';
import {organizationsEnabled,organizationsModel,organizationsBase} from './organizations.mjs';

export const BG_OPEN=Object.freeze(['gathering','waiting','held-for-support','final']);
export const BG_CATEGORIES=Object.freeze(['owner-deceased','owner-unreachable','owner-credentials-lost','other']);
export const BG_STEPS=Object.freeze(['alternatives','candidate','category','statement','review']);
const CLAIM_DECISIONS=['abort','accept','pay','withdraw','cosign','uncosign','object'],VIEW_DECISIONS=['start','contest'],ROLES=['owner','admin','former-owner'];
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,STATEMENT_CHARS=2000;
const fail=code=>{throw Object.assign(Error(code),{code});};
export const bgOpen=claim=>BG_OPEN.includes(claim?.state);
/** Decisions the server advertises on a claim view (the only ones the console offers). */
export const claimDecisions=claim=>Array.isArray(claim?.decisions)?claim.decisions.filter(d=>CLAIM_DECISIONS.includes(d)):[];
/** Top-level decisions of an organization's break-glass view: 'start' and 'contest'. */
export const viewDecisions=view=>Array.isArray(view?.decisions)?view.decisions.filter(d=>VIEW_DECISIONS.includes(d)):[];
/** The person-level notices, bounded and shape-checked (untrusted display data). */
export function breakGlassItems(m){
 return (Array.isArray(m?.breakGlassItems)?m.breakGlassItems:[]).filter(i=>i&&UUID.test(i.org??'')&&ROLES.includes(i.role)).slice(0,32);
}
/** The owner's open claims that the sign-in interstitial shows (not dismissed in this session). */
export function ownerClaims(s){
 const m=organizationsModel(s);if(!m)return [];const dismissed=new Set(m.breakGlassDismissed??[]);
 return breakGlassItems(m).filter(i=>i.role==='owner'&&bgOpen(i.claim)&&claimDecisions(i.claim).includes('abort')&&!dismissed.has(i.claim.id));
}
/** Co-signature and objection items for this admin, across organizations ("waiting for you"). */
export const adminItems=m=>breakGlassItems(m).filter(i=>i.role==='admin'&&bgOpen(i.claim)&&claimDecisions(i.claim).some(d=>['cosign','object'].includes(d)));
/** Former-owner contest entries during the 90-day window. */
export const contestItems=m=>breakGlassItems(m).filter(i=>i.role==='former-owner'&&viewDecisions(i).includes('contest')&&i.contest?.claim);
/** The paid period runs from checkout, so 30 (Track A) to 127 days (Track S at its longest) are lost before effect. */
export const LOST_DAYS=Object.freeze({min:30,max:127});

async function loadItems(r,ctx,port,put){
 let out;try{out=await port.call('break-glass-items',undefined,{api:r.api});}catch(error){if(error?.status===401)throw error;return false;}
 const items=(Array.isArray(out?.items)?out.items:[]).filter(i=>i&&UUID.test(i.org??'')&&ROLES.includes(i.role)).slice(0,32).map(i=>({org:i.org,name:typeof i.name==='string'?i.name.slice(0,200):null,handle:typeof i.handle==='string'?i.handle.slice(0,64):null,role:i.role,claim:i.claim&&typeof i.claim==='object'?i.claim:null,decisions:viewDecisions(i),contest:i.contest&&typeof i.contest==='object'?{claim:String(i.contest.claim??''),until:i.contest.until,state:i.contest.state}:null}));
 put({breakGlassItems:items});return true;
}
/** Loads the person-level notices (sign-in interstitial, co-signature items, contest entries). Not a mutation: it never
 * takes the shared busy reservation, so it can run beside the account load. Failures leave the console unchanged. */
export class BreakGlassNotices extends OwnerFlow{
 static deps={state:{write:true},api:{},browser:{},organizationsConsole:{}};
 mutation=false;
 async perform(r,ctx){
  const s=snapshot(r);if(!organizationsEnabled(s))return;const owner=s.session.account.id,session=s.session.sessionContext,generation=s.beamGeneration??0;
  const put=patch=>{const now=snapshot(r);if(now.session?.account?.id!==owner||now.session?.sessionContext!==session||(now.beamGeneration??0)!==generation)return;publish(r,ctx,{organizationsConsole:{...organizationsBase(now),...patch}});};
  try{await loadItems(r,ctx,r.organizationsConsole,put);}catch{/* the notices are advisory; the organization views recheck */}
 }
}

/**
 * The `bg-*` steps of OrganizationsIntent. `env`: {r, ctx, m, v, d, a, org, call, change, put, leave, age, details,
 * focus}. The wizard is one question per step; nothing is sent before the reviewed start.
 */
export async function breakGlassIntent(env){
 const {r,m,v,d,a,org,call,change,put,leave,age}=env,focus=env.focus??(()=>{}),view=m.breakGlass,claim=view?.claim,wizard=m.breakGlassWizard;
 const me=snapshot(r).session?.account?.id;
 const reloadItems=async()=>{try{await loadItems(r,env.ctx,r.organizationsConsole,put);}catch{}};
 // An item from the person-level notices, for actions taken outside the organization's own context (interstitial,
 // "waiting for you", contest entry). The organization rechecks the claim and the decision.
 const item=UUID.test(d.org??'')?breakGlassItems(m).find(i=>i.org===d.org&&(i.claim?.id===d.claim||i.contest?.claim===d.claim)):null;
 const target=d.org&&d.org!==m.context?item:null,targetOrg=target?target.org:org;
 const targetClaim=target?target.claim:claim,targetDecisions=target?claimDecisions(target.claim):claimDecisions(claim);
 const step=next=>{put({breakGlassWizard:next,error:null,notice:null});focus('#org-bg-step');};
 if(a==='bg-items'){await reloadItems();return;}
 if(a==='bg-dismiss'){const id=String(d.claim??'');if(!UUID.test(id))fail('review_required');put({breakGlassDismissed:[...new Set([...(m.breakGlassDismissed??[]),id])].slice(-32)});return;}
 if(a==='bg-wizard-open'){if(!viewDecisions(view).includes('start'))fail('review_required');step({step:'alternatives'});return;}
 if(a==='bg-wizard-cancel'){put({breakGlassWizard:null});focus('#org-break-glass');return;}
 if(a==='bg-wizard-back'){if(!wizard)return;const i=BG_STEPS.indexOf(wizard.step);if(i<=0){put({breakGlassWizard:null});focus('#org-break-glass');return;}step({...wizard,step:BG_STEPS[i-1]});return;}
 if(a==='bg-wizard-next'){if(wizard?.step!=='alternatives')fail('review_required');step({...wizard,step:'candidate'});return;}
 if(a==='bg-candidate'){
  if(wizard?.step!=='candidate'||!viewDecisions(view).includes('start'))fail('review_required');
  if(v.who==='self'){step({...wizard,step:'category',candidate:{sub:me,handle:null,self:true}});return;}
  const handle=String(v.handle??'').trim().replace(/^@/,'').split('@')[0];if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(handle))fail('invitee_unrecognized');
  const out=await call('invitee',{handle}),i=out?.invitee;if(!i||typeof i.iss!=='string'||!UUID.test(i.sub??''))fail('invitee_unavailable');
  step({...wizard,step:'category',candidate:{iss:i.iss,sub:i.sub,handle:typeof i.handle==='string'?i.handle:handle,self:i.sub===me}});return;
 }
 if(a==='bg-category'){if(wizard?.step!=='category'||!BG_CATEGORIES.includes(v.category))fail('review_required');step({...wizard,step:'statement',category:v.category});return;}
 if(a==='bg-statement'){if(wizard?.step!=='statement')fail('review_required');const text=String(v.statement??'').trim();if(!text||[...text].length>STATEMENT_CHARS||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))fail('invalid_statement');step({...wizard,step:'review',statement:text});return;}
 if(a==='bg-start'){
  if(wizard?.step!=='review'||!wizard.candidate?.sub||!BG_CATEGORIES.includes(wizard.category)||!wizard.statement||v.confirm!==true||!viewDecisions(view).includes('start'))fail('review_required');
  await change('break-glass',{operation:'start',candidate:{...wizard.candidate.iss?{iss:wizard.candidate.iss}:{},sub:wizard.candidate.sub},category:wizard.category,statement:wizard.statement,confirm:true});
  put({breakGlassWizard:null});await reloadItems();focus('#org-break-glass');return;
 }
 if(a==='bg-checkout'){
  if(!targetDecisions.includes('pay')||v.confirm!==true||v.ageConfirmed!==true)fail('review_required');
  const options=Array.isArray(targetClaim?.disclosure)?targetClaim.disclosure:[],entry=options.find(x=>x.plan===(v.plan||options[0]?.plan));if(!entry||!/^[a-f0-9]{64}$/.test(entry.digest??''))fail('review_required');
  const result=await call('break-glass-checkout',{claim:targetClaim.id,disclosure:entry.digest,confirm:true,...options.length>1?{plan:entry.plan}:{},...age},targetOrg);leave(result.checkout.url);return;
 }
 const OPS={'bg-accept':'accept','bg-cosign':'cosign','bg-uncosign':'uncosign','bg-withdraw':'withdraw','bg-object':'object','bg-abort':'abort','bg-contest':'contest'};
 if(!Object.hasOwn(OPS,a))fail('invalid_request');const operation=OPS[a];
 if(operation==='contest'){
  const contest=target?target.contest:view?.contest,allowed=target?viewDecisions(target).includes('contest'):viewDecisions(view).includes('contest');
  if(!allowed||!contest?.claim||v.confirm!==true)fail('review_required');
  const input={operation,claim:contest.claim,...v.reason?{reason:String(v.reason).slice(0,2000)}:{}};
  if(target){await call('break-glass',input,targetOrg);await reloadItems();put({notice:'break_glass_contested'});}else{await change('break-glass',input);put({notice:'break_glass_contested'});}return;
 }
 if(!targetClaim?.id||!targetDecisions.includes(operation))fail('review_required');
 // Abort is the safe direction: one press, no confirmation box. Every other change is reviewed first.
 if(!['abort','accept','cosign'].includes(operation)&&v.confirm!==true)fail('review_required');
 const input={operation,claim:targetClaim.id,...operation==='object'&&v.reason?{reason:String(v.reason).slice(0,280)}:{}};
 if(target){await call('break-glass',input,targetOrg);await reloadItems();if(m.context===targetOrg)await env.details(targetOrg);}else{await change('break-glass',input);await reloadItems();}
 put({notice:operation==='abort'?'break_glass_aborted':'saved'});
 if(operation==='abort')put({breakGlassDismissed:[...new Set([...(m.breakGlassDismissed??[]),targetClaim.id])].slice(-32)});
}
