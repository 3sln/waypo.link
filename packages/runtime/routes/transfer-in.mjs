// PORT-6 destination intake. The cross-origin form is an interactive document handoff, never signup authority.
import {TransferEnrollmentAction} from '../../identity/transfer-enrollment.mjs';
import {requestAgeLocation} from '../../identity/age-policy.mjs';
import {identity,json,body,bytesOf,flagGlobal,status,pseudonym,subnet,securePage} from './shared.mjs';
const API=/^\/api\/transfer-in\/(check|start|status|cancel|retry|email-start|email-confirm)$/;
export function allowedMethods(path){return API.test(path)?['POST']:null;}
export const admission={exempt:path=>API.test(path)};
export const stages={
 async public({request,env,path}){
  if(path!=='/bindle/portability/transfer-in')return;
  if(new URL(request.url).search)return json({error:'not_found'},404);
  if(!flagGlobal(env,'IDENTITY_TRANSFER_IN_ENABLED')||!env.TRANSFER_IN_INTAKE)return json({error:'not_found'},404);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST'});
  if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/x-www-form-urlencoded')return json({error:'invalid_request'},400);
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await bytesOf(request,1048576));}catch(error){return json({error:'invalid_request'},error.status??400);}
  const fields=new URLSearchParams(text);if([...fields.keys()].length!==1||!fields.has('package'))return json({error:'invalid_request'},400);
  let pkg;try{pkg=JSON.parse(fields.get('package'));}catch{return json({error:'invalid_request'},400);}
  // The package is embedded as non-executable data, escaped out of HTML parsing; it is not retained by the server.
  const data=JSON.stringify(pkg).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
  if(typeof env.TRANSFER_IN_DOCUMENT!=='function')return json({error:'not_found'},404);
  const response=await env.TRANSFER_IN_DOCUMENT({request,packageJSON:data}),headers=new Headers(response.headers);
  for(const [key,value] of Object.entries({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; worker-src 'self'"}))headers.set(key,value);
  return securePage(new Response(response.body,{status:response.status,headers}),true,false,{keepPolicy:true});
 },
 async unauthenticated({request,env,path,local}){
  const match=API.exec(path);if(!match)return;
  if(new URL(request.url).search)return json({error:'not_found'},404);
  if(!env.TRANSFER_IN_INTAKE||['check','start'].includes(match[1])&&!flagGlobal(env,'IDENTITY_TRANSFER_IN_ENABLED'))return json({error:'not_found'},404);
  const origin=request.headers.get('Origin');if(origin!==env.APP_ORIGIN)return json({error:'invalid_origin'},403);
  const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY,ip=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown');
  if(!secret||typeof env.ABUSE?.consume!=='function'){if(!local)return json({error:'temporarily_unavailable'},503);}else for(const [kind,value,limit]of [['ip',ip,20],['network',subnet(ip),80]])if(!await env.ABUSE.consume('transfer-intake:'+kind+':'+await pseudonym(value,secret),{windowMs:60000,limit}))return json({error:'rate_limited'},429,{'Retry-After':'60'});
  const input=await body(request,1048576),context={origin,remoteIP:local?'127.0.0.1':request.headers.get('CF-Connecting-IP')||'unknown',region:request.cf?.country||'unknown',ageLocation:requestAgeLocation(request,env)};
  const engine=await identity(env);try{const feed=engine.dispatch(new TransferEnrollmentAction(match[1],input,context,env.TRANSFER_IN_INTAKE));let result;feed.addEventListener('result',event=>{result=event.detail;},{once:true});await feed.next('complete');return json(result,200,{'Referrer-Policy':'no-referrer','Cache-Control':'private, no-store'});}catch(error){return json({error:error.code??'temporarily_unavailable',message:typeof error.code==='string'?error.message:'The move could not be completed.'},status(error));}finally{engine.dispose();}
 }
};
