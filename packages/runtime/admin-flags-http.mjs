// Mount after admin-http has built `admin` and `scoped`. No flag policy lives here.
import {createAppEngine,operate} from '../app/engine.mjs';
import {EDGE_OPERATIONS} from '../app/edge-operations.mjs';
import {cryptoRandom,nullAudit} from '../app/providers.mjs';
import {adminRoutes} from './admin-http.mjs';
const names=['list','get','history','preview','explain','seed-verify','experiment-results','seed','take-control','update','rollback','reshuffle','experiment-start','experiment-stop','experiment-conclude','retire'];
const writes=new Set(names.slice(7));
export async function adminFlagsRoutes({path,request,env,local,admin,scoped,body,json}){
 if(!path.startsWith('/api/admin/flags/'))return null;
 if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST'});
 if(request.headers.get('Origin')!==env.APP_ORIGIN)return json({error:'csrf'},403);
 const name=path.slice('/api/admin/flags/'.length);if(!names.includes(name))return json({error:'not_found'},404);
 // The mounted adapter supplied the cookie/account context. Actor selection is
 // still explicit and Origin/CSRF/session checks run for reads as well as writes.
 if(!['boot','admin'].includes(scoped?.actor)||request.headers.get('X-Bindle-Admin-Actor')!==scoped.actor)return json({error:'actor_required'},403);
 const source=await body(request,262144);if(!source||typeof source!=='object'||Array.isArray(source))return json({error:'invalid_request'},400);
 const {passkeyResponse,challengeId,stepUpAt:_at,stepUpMethod:_method,actor:_actor,internalAccounts:_internal,...input}=source;
 let actor=await admin.actor(scoped,true),session,verified=false;
 if(writes.has(name)){
  // Legacy identity sessions retain only stepUpAt. Never infer passkey evidence
  // from that timestamp (the general identity endpoint also accepts passwords).
  if(!passkeyResponse)return json({error:'step_up_required'},403);
  // Keep identity verification at its existing passkey-only HTTP boundary.
  // The path differs from this mount, so delegation cannot recurse into flags.
  const confirmation=await adminRoutes({path:scoped.actor==='boot'?'/api/admin/boot/step-up':'/api/admin/step-up',request,env:{...env,ADMIN_SERVICE:()=>admin},local,context:scoped,body:async()=>({method:'passkey',challengeId,response:passkeyResponse}),json});
  if(!confirmation.ok)return confirmation;
  verified=true;actor=await admin.actor(scoped,false);
 }
 if(scoped.actor==='boot'){
  const boot=await admin.bootSession(scoped);session=boot.session;
  actor={...actor,expect:{...actor.expect,'boot/sessions':boot.sessions.revision}};
 }else session=(await admin.identity.authorized(scoped,true)).session;
 const clock={now:()=>admin.clock()},engine=createAppEngine({providers:{flagStore:env.flagStore??admin.store,config:env,clock,random:cryptoRandom,audit:nullAudit,flagStats:env.flagStats}});
 try{
  const result=await operate(engine,new EDGE_OPERATIONS['flags.'+name]({actor,input:{...input,stepUpAt:session.stepUpAt,stepUpMethod:verified?'passkey':undefined}}));
  return json(result,200,{'Cache-Control':'private, no-store'});
 }finally{await engine.dispose();}
}
