// ART-3 composition only. ART-4 owns existing fetcher/pin call sites; no public mirror routes here.
import {createAppEngine,perform,read} from '../app/engine.mjs';
import {PinArtefact,ResolveArtefact,RefreshArtefact,StoredArtefact} from '../federation/artefact-store.mjs';
import {artefactURL,ArtefactFault} from '../core/artefacts.mjs';
import {strictJSON} from '../core/strict-json.mjs';
// This port has no network fallback. Operator-registered bytes only, including envelope and record URLs.
export function artefactFetchPort({documents,mirrorRecords={},clock,maxGlobal=64,maxOrigin=16}){
 let window=-1,total=0;const origins=new Map(),negative=new Map();
 return {async record(digest){if(!Object.hasOwn(mirrorRecords,digest))throw new ArtefactFault('artefact_unavailable');return structuredClone(mirrorRecords[digest]);},async fetch(id,{envelope=false}={}){
  artefactURL(id);if(envelope&&Object.hasOwn(documents,id+'/envelope'))id+='/envelope';const now=clock.now(),minute=Math.floor(now/60000),origin=new URL(id).origin;
  if(window!==minute){window=minute;total=0;origins.clear();}
  if((negative.get(id)??0)>now||total>=maxGlobal||(origins.get(origin)??0)>=maxOrigin)throw new ArtefactFault('artefact_unavailable');
  total++;origins.set(origin,(origins.get(origin)??0)+1);
  if(!Object.hasOwn(documents,id)){negative.set(id,now+60000);throw new ArtefactFault('artefact_unavailable');}
  const value=documents[id],raw=typeof value==='string'?value:value instanceof Uint8Array?value:JSON.stringify(value);if(new TextEncoder().encode(typeof raw==='string'?raw:'').byteLength>262144||raw instanceof Uint8Array&&raw.byteLength>262144)throw new ArtefactFault('artefact_unavailable');let parsed;try{parsed=JSON.parse(typeof raw==='string'?raw:new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new ArtefactFault('artefact_invalid');}if(!Object.hasOwn(parsed??{},'bindle_artefact'))return parsed;try{return strictJSON(raw,{maxDepth:36});}catch{throw new ArtefactFault('artefact_invalid');}
 }};
}
export function artefactRuntime({store,documents,mirrorRecords,flags,clock,random,audit,validateBody,kinds}){
 if(typeof validateBody!=='function')throw new TypeError('Artefact runtime requires a kind body validator');
 const engine=createAppEngine({providers:{federationStore:store,egress:artefactFetchPort({documents,mirrorRecords,clock}),flags,clock,random,audit,config:{validateArtefactBody:validateBody,artefactKinds:kinds}}});
 return {engine,pin:input=>perform(engine,new PinArtefact({input})),resolve:input=>read(engine,new ResolveArtefact({input})),refresh:input=>perform(engine,new RefreshArtefact({input})),record:digest=>read(engine,new StoredArtefact({input:{digest}}))};
}
