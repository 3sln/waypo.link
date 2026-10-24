// ART-3 composition only. ART-4 owns existing fetcher/pin call sites; no public mirror routes here.
import {createAppEngine,perform,read} from '../app/engine.mjs';
import {PinArtefact,ResolveArtefact,RefreshArtefact,StoredArtefact} from '../federation/artefact-store.mjs';
import {artefactURL,ArtefactFault} from '../core/artefacts.mjs';
import {strictJSON} from '../core/strict-json.mjs';
// This port has no network fallback. Operator-registered bytes only, including envelope and record URLs.
// Unregistered ids are refused before any negative state (wargame F1). Registered documents are operator-supplied
// local bytes, so reading them costs no network budget: no request, junk digest or junk version can starve another
// (review follow-up 3). A port with real egress would charge its budget here and report exhaustion as
// `artefact_budget_exhausted`, which the store never persists as `negativeUntil`.
export const NEGATIVE_LIMIT=1024;
export function artefactFetchPort({documents,mirrorRecords={},clock,maxNegative=NEGATIVE_LIMIT}){
 const negative=new Map();
 const remember=(id,until)=>{negative.delete(id);negative.set(id,until);while(negative.size>maxNegative)negative.delete(negative.keys().next().value);};
 return {async record(digest){if(!Object.hasOwn(mirrorRecords,digest))throw new ArtefactFault('artefact_unavailable');return structuredClone(mirrorRecords[digest]);},async fetch(id,{envelope=false}={}){
  artefactURL(id);if(envelope&&Object.hasOwn(documents,id+'/envelope'))id+='/envelope';const now=clock.now();
  if(!Object.hasOwn(documents,id))throw new ArtefactFault('artefact_unregistered');
  const until=negative.get(id);if(until!==undefined){if(until>now)throw new ArtefactFault('artefact_unavailable');negative.delete(id);}
  const value=documents[id],raw=typeof value==='string'?value:value instanceof Uint8Array?value:JSON.stringify(value);if(new TextEncoder().encode(typeof raw==='string'?raw:'').byteLength>262144||raw instanceof Uint8Array&&raw.byteLength>262144){remember(id,now+60000);throw new ArtefactFault('artefact_unavailable');}let parsed;try{parsed=JSON.parse(typeof raw==='string'?raw:new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new ArtefactFault('artefact_invalid');}if(!Object.hasOwn(parsed??{},'bindle_artefact'))return parsed;try{return strictJSON(raw,{maxDepth:36});}catch{throw new ArtefactFault('artefact_invalid');}
 }};
}
export function artefactRuntime({store,documents,mirrorRecords,flags,clock,random,audit,validateBody,kinds}){
 if(typeof validateBody!=='function')throw new TypeError('Artefact runtime requires a kind body validator');
 const engine=createAppEngine({providers:{federationStore:store,egress:artefactFetchPort({documents,mirrorRecords,clock}),flags,clock,random,audit,config:{validateArtefactBody:validateBody,artefactKinds:kinds}}});
 const registered=id=>typeof id==='string'&&(Object.hasOwn(documents,id)||Object.hasOwn(documents,id+'/envelope'));
 return {engine,registered,pin:input=>perform(engine,new PinArtefact({input})),resolve:input=>read(engine,new ResolveArtefact({input})),refresh:input=>perform(engine,new RefreshArtefact({input})),record:digest=>read(engine,new StoredArtefact({input:{digest}}))};
}
