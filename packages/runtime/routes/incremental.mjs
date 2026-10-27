import {pinConfiguredContract} from '../artefact-pins.mjs';
// FF-5a: legacy mount visibility is preserved; after console adoption owner reads/reversal ignore targeting.
import {federationSchemas} from '../federation.mjs';
import {clientSite} from '../../federation/client-metadata.mjs';
import {consentContracts} from '../../consent/contracts.mjs';
import {digest,canonical} from '../../core/records.mjs';
// IA-2 owner routes (docs/spec/incremental-authorization.md §9.2): list, add and remove the owner's request
// suppressions for one app. Mounted only with INCREMENTAL_AUTH_ENABLED and the adapter's INCREMENTAL_AUTHORIZATION port
// (runtime/incremental-authorization.mjs); otherwise nothing answers and no allowlist reveals the path. The access
// views (CX-3) are their UI. Removing a suppression never re-sends or replays an earlier request.
//   GET    /api/incremental/suppressions?client=<client id>     → {suppressions}
//   POST   /api/incremental/suppressions  {client, scope, kind?, fragment?, field?}
//   DELETE /api/incremental/suppressions/<id>?client=<client id>
import {flagReadable,flagGlobal,flagEnabled,json,body,status} from './shared.mjs';
const PATH=/^\/api\/incremental\/suppressions(?:\/([0-9a-f-]{36}))?$/;
const mounted=env=>env.INCREMENTAL_AUTHORIZATION?.mounted===true;
const fault=error=>json({error:error?.code??'invalid_request',message:error?.code?error.message:'The request could not be completed.'},status(error));
export const stages={
 async public({request,env,path,url}){if(!['/api/incremental/schema','/api/incremental/contracts'].includes(path)||(!mounted(env)||!flagGlobal(env,'INCREMENTAL_AUTH_ENABLED')))return;if(request.method!=='GET')return json({error:'method_not_allowed'},405);if(path==='/api/incremental/contracts'){const contract=url.searchParams.get('contract');if(contract&&flagGlobal(env,'ARTEFACT_VERSIONS_ENABLED')){const pin=await pinConfiguredContract(env,{contract,version:Number(url.searchParams.get('version')),digest:url.searchParams.get('digest')}),reviewedPin=(await consentContracts())[contract];return json({contracts:{[contract]:{...pin,...reviewedPin?{reviewedPin}:{}}}});}return json({contracts:await consentContracts()});}const fragment=url.searchParams.get('fragment'),schemas=federationSchemas(env);if(!Object.hasOwn(schemas,fragment))return json({error:'not_found'},404);if(flagGlobal(env,'ARTEFACT_VERSIONS_ENABLED')&&url.searchParams.has('version')){const pin=await env.ARTEFACTS.pin({artefact:fragment,kind:'fragment',version:Number(url.searchParams.get('version')),digest:url.searchParams.get('digest')});return json({schema:pin.body,digest:pin.reference.digest,version:pin.reference.version});}const schema=schemas[fragment];return json({schema,digest:await digest(crypto,canonical(schema))});},
 async beforeActivity({request,env,path,url,id,context}){
  if(!mounted(env)||!flagReadable(env,'INCREMENTAL_AUTH_ENABLED',true))return;if(path==='/api/incremental/preferences'&&request.method==='GET'){let site;try{site=clientSite(new URL(url.searchParams.get('client')).hostname);}catch{return json({error:'invalid_request'},400);}const prefs=await env.FEDERATION_AUTHORITY.preferences(context),preference=prefs.preferences.find(p=>p.fragment===url.searchParams.get('fragment'))??null;return json({preference,candidates:(preference?.resources??[]).filter(r=>clientSite(new URL(r.id).hostname)!==site)});}
  const match=PATH.exec(path);if(!match)return;const port=env.INCREMENTAL_AUTHORIZATION,client=url.searchParams.get('client')??undefined;
  try{
   if(!match[1]&&request.method==='GET')return json(await port.suppressionList(id,client===undefined?{}:{clientId:client}));
   if(!match[1]&&request.method==='POST'){if(!flagEnabled(env,'INCREMENTAL_AUTH_ENABLED',{subject:{kind:'account',owner:id}}))return json({error:'feature_unavailable'},409);const {client:clientId,...rest}=await body(request,4096);return json(await port.suppressionAdd(id,{clientId,...rest}),201);}
   if(match[1]&&request.method==='DELETE')return json(await port.suppressionRemove(id,{clientId:client,id:match[1]}));
   return json({error:'method_not_allowed',message:'This operation does not support that request method.'},405,{Allow:match[1]?'DELETE':'GET, POST'});
  }catch(error){return fault(error);}
 },
};
