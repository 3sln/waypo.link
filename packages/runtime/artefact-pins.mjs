// ART-4 adapter composition. Only operator-reviewed documents; never ambient network access.
import {artefactRuntime} from './artefacts.mjs';
import {federationSchemas} from './federation.mjs';
import {flagsFor,siteGlobal} from '../flags/read.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../app/providers.mjs';
import {validateSchema,fail} from '../federation/schema.mjs';
import {validateSlotManifest} from '../federation/extensions.mjs';
import {validateBusManifest} from '../federation/event-buses.mjs';
export const ARTEFACT_STORE='bindle-artefacts-v1';
export function configuredArtefacts({config,store,clock=systemClock}){
 const documents=new Proxy({}, {get:(_,key)=>federationSchemas(config)[key],getOwnPropertyDescriptor:(_,key)=>Object.hasOwn(federationSchemas(config),key)?{configurable:true,enumerable:true,value:federationSchemas(config)[key]}:undefined});
 const runtime=artefactRuntime({store,documents,flags:{for:ctx=>flagsFor(config,ctx)},clock,random:cryptoRandom,audit:nullAudit,validateBody:(body,{id,kind})=>{
  if(kind==='slot')return validateSlotManifest(body,id).status==='valid';
  if(kind==='bus')return validateBusManifest(body,id).status==='valid';
  if(kind===undefined||kind==='fragment'){validateSchema(body,id);return true;}return false;
 }});
 return {get enabled(){return siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED');},...runtime};
}
export function reviewedSchemaFetcher(config,missing='untrusted_schema_host'){
 const fetcher=async url=>{const schemas=federationSchemas(config);if(!Object.hasOwn(schemas,url))fail(missing,missing==='unsupported_fragment'?'Unsupported fragment.':'This fragment has not been registered with this provider.');return structuredClone(schemas[url]);};
 Object.defineProperty(fetcher,'artefacts',{get:()=>config.ARTEFACTS});return fetcher;
}
export function remoteArtefacts(config,invoke){return {get enabled(){return siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED');},...Object.fromEntries(['pin','resolve','refresh','record'].map(method=>[method,async input=>{const response=await invoke(method,input);if(!response.ok)throw Object.assign(new Error(response.error.code),response.error);return response.result;}]))};}
