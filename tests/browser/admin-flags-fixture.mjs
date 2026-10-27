// Local test authority/passkey shim; exercises the real HTTP adapter and flag
// engine, not provider conformance or production authentication.
import {createMemoryEngine,OWNER} from '../../packages/app/memory-providers.mjs';
import {adminFlagsRoutes} from '../../packages/runtime/admin-flags-http.mjs';
export const activity='ACTIVITY_V2_ENABLED',search='SEMANTIC_SEARCH_ENABLED';
export async function flagFixture(options={}){
 const f=await createMemoryEngine(options),owner=OWNER,actor={kind:'admin',owner,expect:{['principal/'+owner]:1}};
 await f.flagStore.commit({expect:{['principal/'+owner]:null,'boot/principal':null,'boot/sessions':null},writes:{['principal/'+owner]:{active:true},'boot/principal':{active:true},'boot/sessions':{sessions:[]}}});
 const session={stepUpAt:f.clock.now()},admin={clock:()=>f.clock.now(),store:f.flagStore,identity:{authorized:async scoped=>{if(scoped.csrfToken!=='test-csrf')throw Object.assign(Error('csrf'),{code:'csrf',status:403});return {session};},stepUp:async input=>{if(input.method!=='passkey'||input.response?.id!=='verified-test-passkey')throw Object.assign(Error('invalid passkey'),{code:'unauthorized',status:401});session.stepUpAt=f.clock.now();return {stepUpUntil:session.stepUpAt+300000};}},actor:async scoped=>{if(scoped.denied)throw Object.assign(Error('denied'),{code:'forbidden',status:403});await admin.identity.authorized(scoped);return actor;}};
 const flagStats=await f.engine.container.use(['flagStats'],({flagStats})=>flagStats),env={...options.config,APP_ORIGIN:'https://host.example',flagStore:f.flagStore,flagStats};
 const call=async(op,input={},patch={})=>{
  const request=new Request(env.APP_ORIGIN+'/api/admin/flags/'+op,{method:'POST',headers:{Origin:env.APP_ORIGIN,'X-Bindle-Admin-Actor':'admin'},body:JSON.stringify(input)});
  const response=await adminFlagsRoutes({path:new URL(request.url).pathname,request,env,admin,scoped:{actor:'admin',csrfToken:'test-csrf',...patch},body:r=>r.json(),json:(v,status=200,headers={})=>Response.json(v,{status,headers})});
  const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error),{code:result.error,status:response.status});return result;
 };
 const seed=async name=>{const input={name,expectedRevision:null},p=await call('preview',{...input,action:'seed'});return call('seed',{...input,reason:'Seeded console test fixture.',typedName:name,previewDigest:p.digest,acknowledgeGates:p.requiredGates,passkeyResponse:{id:'verified-test-passkey'}});};
 return Object.assign(f,{admin,env,actor,call,seed,session});
}
