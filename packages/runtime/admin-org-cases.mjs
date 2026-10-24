// ORG-12d support adjudication: the admin HTTP routes (thin: parse, passkey boundary, dispatch, serialize) and the
// adapter ports both runtimes compose. Host administration, not Bindle protocol. Provisional (coordinator), not signed
// off by the user. Mounted by packages/runtime/admin-http.mjs after it built `admin` and `scoped`.
//
//   POST /api/admin/org-cases/list    {startAfter?}                      -> {cases, next, decisionsLeft}
//   POST /api/admin/org-cases/get     {org}                              -> {case}
//   POST /api/admin/org-cases/challenge {org, kind, process, decision, exclude?} -> {passkey, authenticationOptions}
//        (review L7: the passkey challenge for ONE decision, bound to its digest)
//   POST /api/admin/org-cases/decide  {org, kind, process, decision, exclude?, category?, reason?, passkeyResponse,
//                                      challengeId?}                     -> {outcome, state?, decisionsLeft}
//   POST /api/admin/org-cases/audit   {before?}                          -> {entries, next}
//
// Every route needs the administrator actor (never boot), Origin and CSRF, and the console's passkey-only step-up;
// `decide` also needs a fresh passkey assertion for that one decision. Seizing decisions (proceed, uphold, reject)
// answer the uniform 404 while ORG_BREAK_GLASS_ENABLED is off for the organization (AdminService#decideOrgCase); the
// queue, the case and the safe direction (acknowledge, note, abort, close) stay available (design §12d.12).
import {createAppEngine,perform,read} from '../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../app/providers.mjs';
import {ListOrgCases,ReadOrgCase,DecideOrgCase,OrgCaseAudit,OrgCaseChallenge,adminOperatorPasskeyContext} from '../identity/admin.mjs';
import {adminRoutes} from './admin-http.mjs';

const OPERATIONS={list:ListOrgCases,get:ReadOrgCase,challenge:OrgCaseChallenge,decide:DecideOrgCase,audit:OrgCaseAudit};
export async function adminOrgCaseRoutes({path,request,env,local,admin,scoped,body,json}){
 if(!path.startsWith('/api/admin/org-cases/'))return null;
 if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST'});
 if(request.headers.get('Origin')!==env.APP_ORIGIN)return json({error:'csrf'},403);
 const name=path.slice('/api/admin/org-cases/'.length),Operation=OPERATIONS[name];if(!Operation)return json({error:'not_found'},404);
 if(new URL(request.url).search)return json({error:'invalid_request'},400);
 // Operators are administrator accounts; boot is never one (it is no account and cannot be a party-free operator).
 if(scoped?.actor!=='admin'||request.headers.get('X-Bindle-Admin-Actor')!=='admin')return json({error:'operator_capability_required',message:'Support decisions need an operator account.'},403);
 const source=await body(request,16384);if(!source||typeof source!=='object'||Array.isArray(source))return json({error:'invalid_request'},400);
 let context=scoped,input=source;
 if(name==='decide'){
  const {passkeyResponse,challengeId,...rest}=source;input=rest;
  // Authority first (without needing an older step-up to be fresh), then the passkey assertion opens the window.
  if(!(await admin.access({},scoped)).admin)return json({error:'forbidden'},403);
  if(!passkeyResponse)return json({error:'step_up_required',message:'Confirm this decision with your passkey.'},403);
  // Review L7: the challenge this assertion answers (the session's only pending step-up challenge), so the decision can
  // check it is the one /org-cases/challenge bound to exactly this decision.
  const challenge=await admin.pendingStepUpChallenge(scoped);
  const confirmation=await adminRoutes({path:'/api/admin/step-up',request,env:{...env,ADMIN_SERVICE:()=>admin},local,context:scoped,body:async()=>({method:'passkey',challengeId,response:passkeyResponse}),json});
  if(!confirmation.ok)return confirmation;
  context=adminOperatorPasskeyContext(admin,scoped,challenge);
 }
 const engine=createAppEngine({providers:{admin,clock:{now:()=>admin.clock()},random:cryptoRandom,audit:nullAudit}});
 try{
  const operation=new Operation({actor:{kind:'admin-http',context},input}),result=['decide','challenge'].includes(name)?await perform(engine,operation):await read(engine,operation);
  return json(result,200,{'Cache-Control':'private, no-store'});
 }finally{await engine.dispose();}
}

/** The admin service's `organizations` port: internal RPC into the organization's writer (never an owner route). */
export function adminOrgCasePorts({accounts}){
 const call=async(org,method,args)=>{const result=await accounts.get(org).invoke({method,args:[org,...args]});if(result?.$fault)throw Object.assign(new Error(result.$fault.message),{code:result.$fault.code,status:result.$fault.status});return result;};
 return {
  case:org=>call(org,'orgsBreakGlassSignal',[{operation:'case'}]),
  resolve:(org,input)=>call(org,'orgsBreakGlassSignal',[{operation:'resolve',input}]),
  claimResolve:(org,input)=>call(org,'orgsClaimResolve',[input]),
  cancelProposals:(org,input)=>call(org,'orgsBreakGlassSignal',[{operation:'proposal-cancel',input}])
 };
}
/** The organization writer's ports (review L5, least privilege): `narrow` is the admin store's narrow client
 * (packages/identity/admin-store.mjs narrowAdminStore), bound to the calling organization. The account object never
 * receives get/list/commit on the admin store. Both adapters pass the result into the account objects' config. */
export function organizationAdminPorts({narrow,config}){
 if(!narrow)return {};const issuer=config?.APP_ORIGIN??null;
 return {ORGANIZATION_OPERATOR_ASSERTIONS:{verify:input=>narrow.verifyOperatorAssertion({...input,issuer}),registered:operator=>narrow.operatorRegistered(operator)},
  ORGANIZATION_SUPPORT_CASES:{apply:(org,input)=>narrow.applySupportCase(org,input)}};
}
