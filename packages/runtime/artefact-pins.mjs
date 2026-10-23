import sendMessageIntent from '../../docs/artefacts/intents/send-message-v1.json' with {type:'json'};
import addContactIntent from '../../docs/artefacts/intents/add-contact-v1.json' with {type:'json'};
import openConversationIntent from '../../docs/artefacts/intents/open-conversation-v1.json' with {type:'json'};
import {validateIntentKind} from '../intents/schema.mjs';
import {contractMethods} from '../core/contract-methods.mjs';
import preferencesV2 from '../../docs/artefacts/preferences-v2.json' with {type:'json'};
import {createAppEngine,read} from '../app/engine.mjs';
import {IntegrationContract,createIntegrationsProvider} from '../federation/integrations.mjs';
import {CONSENT_CONTRACT_SCHEMAS} from '../consent/contracts.mjs';
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
 const documents=new Proxy({}, {get:(_,key)=>configuredArtefactDocuments(config)[key],getOwnPropertyDescriptor:(_,key)=>Object.hasOwn(configuredArtefactDocuments(config),key)?{configurable:true,enumerable:true,value:configuredArtefactDocuments(config)[key]}:undefined});
 const runtime=artefactRuntime({store,documents,flags:{for:ctx=>flagsFor(config,ctx)},clock,random:cryptoRandom,audit:nullAudit,validateBody:(body,{id,kind})=>{
  if(kind==='intent')return validateIntentKind(body).id===id;
  if(kind==='slot')return validateSlotManifest(body,id).status==='valid';
  if(kind==='bus')return validateBusManifest(body,id).status==='valid';
  if(kind==='rpc-contract')return body?.$id===id&&Object.keys(contractMethods(body)).length>0;
  if(kind===undefined||kind==='fragment'){validateSchema(body,id);return true;}return false;
 }});
 return {get enabled(){return siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED');},...runtime};
}
export function reviewedSchemaFetcher(config,missing='untrusted_schema_host'){
 const fetcher=async url=>{const schemas=federationSchemas(config);if(!Object.hasOwn(schemas,url))fail(missing,missing==='unsupported_fragment'?'Unsupported fragment.':'This fragment has not been registered with this provider.');return structuredClone(schemas[url]);};
 Object.defineProperty(fetcher,'artefacts',{get:()=>config.ARTEFACTS});return fetcher;
}
export function remoteArtefacts(config,invoke){return {get enabled(){return siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED');},...Object.fromEntries(['pin','resolve','refresh','record'].map(method=>[method,async input=>{const response=await invoke(method,input);if(!response.ok)throw Object.assign(new Error(response.error.code),response.error);return response.result;}]))};}

// Operator-reviewed contracts share the durable resolver; no URL from an app becomes an ambient fetch.
export function configuredArtefactDocuments(config){
 const contracts=typeof config.FEDERATION_CONTRACTS==='string'?JSON.parse(config.FEDERATION_CONTRACTS):config.FEDERATION_CONTRACTS??{},documents={};
 for(const body of [...CONSENT_CONTRACT_SCHEMAS,preferencesV2]){documents[body.$id]=body;documents[body.$id+'/envelope']={bindle_artefact:1,id:body.$id,kind:'rpc-contract',versions:[{version:1,prev:null,body}]};}
 for(const envelope of [sendMessageIntent,addContactIntent,openConversationIntent]){documents[envelope.id]=envelope;documents[envelope.id+'/envelope']=envelope;}
 return Object.assign(documents,contracts,federationSchemas(config));
}
export async function pinConfiguredContract(config,target){
 if(!siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED')||!config.ARTEFACTS?.enabled)fail('unsupported_artefact_version');
 const {contract,version,digest}=typeof target==='string'?{contract:target}:target;
 const pin=await config.ARTEFACTS.pin({artefact:contract,kind:'rpc-contract',...version!==undefined?{version}:{},...digest!==undefined?{digest}:{}});
 if(!pin.reference.version||pin.body?.$id!==contract)fail('artefact_unverifiable');return {schema:pin.body,version:pin.reference.version,digest:pin.reference.digest};
}
export async function resolveConfiguredContract(config,{contract,version,digest}){const pin=await config.ARTEFACTS.resolve({artefact:contract,kind:'rpc-contract',version,digest});return {digest:pin.reference.digest,record:await config.ARTEFACTS.record(pin.reference.digest)};}

export async function configuredContractVersion(config,input){
 const enabled=siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED')||input.existing===true;const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,config:{INTEGRATIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:enabled?'true':'false'},integrations:createIntegrationsProvider({artefactVersions:enabled,contractResolver:target=>resolveConfiguredContract(config,target)})}});
 try{return await read(engine,new IntegrationContract({input}));}finally{await engine.dispose();}
}
