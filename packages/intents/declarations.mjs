import {parseReference} from '../core/artefacts.mjs';
import {prefixedURL} from '../federation/integrations.mjs';
import {plain} from '../core/strict-json.mjs';
// INT-3 / intents §5. Declarations are claims, never grants; validation performs no fetch.
export function validateIntentDeclarations(clientId,entries){
 if(!Array.isArray(entries)||entries.length>16)return [];
 const counts=new Map();for(const entry of entries)if(typeof entry?.kind==='string')counts.set(entry.kind,(counts.get(entry.kind)??0)+1);
 const out=[];for(const entry of entries)try{
  if(!plain(entry)||Object.keys(entry).length!==4||!['kind','version','digest','route'].every(k=>Object.hasOwn(entry,k))||counts.get(entry.kind)!==1||!Number.isSafeInteger(entry.version)||entry.version<1||entry.version>1024||!prefixedURL(entry.route,clientId))continue;
  parseReference({artefact:entry.kind,version:entry.version,digest:entry.digest},{kind:'intent'});
  out.push({kind:entry.kind,version:entry.version,digest:entry.digest,route:entry.route});
 }catch{}return out;
}
/** Companion to federation classification. Call only for a successfully adopted, validated snapshot;
 * transient/invalid observations preserve the old declarations and never clear a default. `removed` is
 * the kind set for which the router clears this handler's defaults; route/version changes preserve them. */
export function adoptIntentDeclarations(pinned,current,{adopted=false}={}){
 const before=validateIntentDeclarations(pinned?.clientId,pinned?.manifest?.intents),after=adopted?validateIntentDeclarations(pinned?.clientId,current?.manifest?.intents):before;
 const next=structuredClone(pinned),changed=JSON.stringify(before)!==JSON.stringify(after),removed=before.filter(entry=>!after.some(candidate=>candidate.kind===entry.kind)).map(entry=>entry.kind);
 if(adopted&&next?.manifest){if(after.length)next.manifest.intents=after;else delete next.manifest.intents;}
 return {next,changed,changes:changed?['intents_changed']:[],removed};
}

// One integration hook. Declarations confer no authority; continuity failures still keep the old snapshot.
export function intentIntegrationHooks(validate,classify){return [
 (value,context={})=>{const result=validate(value,context);if(result.status==='valid'){const intents=validateIntentDeclarations(context.clientId,value?.intents);if(intents.length)result.manifest.intents=intents;}return result;},
 (pinned,observed,keySet,options)=>{const result=classify(pinned,observed,keySet,options),client=observed?.client;if(result.decision==='invalid'||observed?.transient||client?.integration?.status!=='valid'||client.id!==pinned.clientId)return result;
  const sorted=v=>JSON.stringify([...v??[]].sort()),method=client.authMethod==='private_key_jwt'?'private_key_jwt':'none';
  if(method!==pinned.authMethod||sorted(client.redirectUris)!==sorted(pinned.redirectUris)||(client.jwksUri??undefined)!==pinned.jwksUri||method==='private_key_jwt'&&(!keySet?.thumbprints?.some(k=>pinned.thumbprints?.includes(k))||keySet.thumbprints.some(k=>!pinned.thumbprints?.includes(k))))return result;
  const adopted=adoptIntentDeclarations(result.next,{clientId:client.id,manifest:client.integration.manifest},{adopted:true});if(!adopted.changed)return result;return {...result,decision:result.decision==='unchanged'?'adopt':result.decision,next:adopted.next,changes:[...result.changes,...adopted.changes]};
 }
];}
