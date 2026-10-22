// DX-2: all owner paths run before admission/touch, including suspended owners.
// Only a header-borne CLI grant can bypass the session stage, and only for GET
// of its own job volume. No bearer is accepted in a URL or a mutation body.
import {json,body,accountHandle,privateHeaders,routeFlags} from './shared.mjs';
import {ExportStepUp,parseExportGrant} from '../account/exports.mjs';
import {streamExport} from '../export-tar.mjs';
const ID='([a-f0-9-]{36})',job=new RegExp('^/api/exports/'+ID+'$'),cancel=new RegExp('^/api/exports/'+ID+'/cancel$'),grants=new RegExp('^/api/exports/'+ID+'/grants$'),revoke=new RegExp('^/api/exports/'+ID+'/grants/'+ID+'$'),volume=new RegExp('^/api/exports/'+ID+'/volumes/([1-9][0-9]{0,8})\\.tar$');
export function allowedMethods(path){if(path==='/api/exports')return ['GET','POST'];if(job.test(path)||volume.test(path))return ['GET'];if(cancel.test(path)||grants.test(path))return ['POST'];if(revoke.test(path))return ['DELETE'];return null;}
function guard(request,env){const url=new URL(request.url),origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');if(url.origin!==env.APP_ORIGIN||origin&&origin!==env.APP_ORIGIN||site&&!['same-origin','none'].includes(site))return json({error:'csrf'},403);if(url.search)return json({error:'invalid_export'},400);}
function only(request,path){const allow=allowedMethods(path);return allow&&!allow.includes(request.method)?json({error:'method_not_allowed'},405,{Allow:allow.join(', ')}):null;}
const inputOf=(request,n)=>({volume:n,...request.headers.has('Range')?{range:request.headers.get('Range')}:{},...request.headers.has('If-Range')?{ifRange:request.headers.get('If-Range')}:{}});
export function exportResponse(layout,{archives,blobs,signal,execution}={}){
 if(layout.status===416)return json({error:'range_not_satisfiable'},416,{'Accept-Ranges':'bytes',...Number.isSafeInteger(layout.volumeBytes)?{'Content-Range':`bytes */${layout.volumeBytes}`}:{}});
 const headers=new Headers({...privateHeaders,'Content-Type':'application/x-tar','Content-Disposition':`attachment; filename="bindle-export-${layout.volume.n}.tar"`,'Accept-Ranges':'bytes',ETag:layout.etag,'Content-Length':String(layout.contentLength)});
 if(layout.status===206)headers.set('Content-Range',`bytes ${layout.range.offset}-${layout.range.offset+layout.range.length-1}/${layout.volume.bytes}`);
 const source=streamExport(layout.volume,{archives,blobs,range:layout.range});
 if(typeof FixedLengthStream==='function'){
  const fixed=new FixedLengthStream(layout.contentLength),pump=source.pipeTo(fixed.writable,{signal});if(execution?.waitUntil)execution.waitUntil(pump.catch(()=>{}));else void pump.catch(()=>{});return new Response(fixed.readable,{status:layout.status,headers});
 }
 return new Response(source,{status:layout.status,headers});
}
async function download(request,object,owner,id,env,execution,evidence,token){try{const layout=token?await object.exportGrantDownload(owner,id,inputOf(request,Number(volume.exec(new URL(request.url).pathname)[2])),token):await object.exportDownload(owner,id,inputOf(request,Number(volume.exec(new URL(request.url).pathname)[2])),evidence);return exportResponse(layout,{archives:env.ARCHIVES,blobs:env.BLOBS,signal:request.signal,execution});}catch(error){if(error.status===416)return json({error:'range_not_satisfiable'},416,{'Accept-Ranges':'bytes',...Number.isSafeInteger(error.volumeBytes)?{'Content-Range':`bytes */${error.volumeBytes}`}:{}});throw error;}}
export const stages={
 async api({request,env,path,execution}){
  if(!allowedMethods(path))return;
  const refused=guard(request,env)||only(request,path);if(refused)return refused;
  const header=request.headers.get('Authorization');if(!header)return;
  const match=volume.exec(path),token=header.startsWith('Bearer ')?header.slice(7):'',parsed=parseExportGrant(token);
  if(!match||request.method!=='GET'||!parsed||parsed.jobId!==match[1])return json({error:'unauthorized'},401);
  return download(request,accountHandle(env,parsed.owner),parsed.owner,match[1],env,execution,undefined,token);
 },
 async beforeActivity({request,env,path,engine,context,owner,id,object,execution}){
  if(!allowedMethods(path))return;
  const refused=guard(request,env)||only(request,path);if(refused)return refused;
  if(request.headers.has('Authorization'))return json({error:'unauthorized'},401);
  if(!['GET','HEAD'].includes(request.method)&&(request.headers.get('Origin')!==env.APP_ORIGIN||context.csrfToken!==owner.csrfToken))return json({error:'csrf'},403);
  // With the flag off and no export history, the list answers exactly as before the route existed.
  if(path==='/api/exports'&&request.method==='GET'){const list=await object.exportList(id);if(!list?.jobs?.length&&!routeFlags(env,{subject:{kind:'account',owner:id}}).enabled('ACCOUNT_EXPORT_ENABLED'))return json({error:'not_found'},404);return json(list);}
  const mJob=job.exec(path),mCancel=cancel.exec(path),mGrant=grants.exec(path),mRevoke=revoke.exec(path),mVolume=volume.exec(path);
  if(mJob)return json(await object.exportStatus(id,mJob[1]));
  if(mCancel){const input=await body(request,128);if(Object.keys(input).length)return json({error:'invalid_export'},400);return json(await object.exportCancel(id,mCancel[1]));}
  if(mRevoke)return json(await object.exportRevokeGrant(id,mRevoke[1],mRevoke[2]));
  if(mVolume){const sessionId=owner.sessionContext??owner.devices?.find(d=>d.current)?.id;return download(request,object,id,mVolume[1],env,execution,{sessionId});}
  const input=await body(request,1024),evidence=await engine.query(new ExportStepUp(context)).peek();if(evidence.owner!==id)return json({error:'unauthorized'},401);
  if(mGrant)return json(await object.exportGrant(id,mGrant[1],input,evidence));
  return json(await object.exportCreate(id,input,evidence));
 },
};
