// Provider-wide immutable records. federationStore must supply serializable transaction(get/put).
// Network work precedes transactions; verification is repeated against the committed head inside them.
import {AppAction,AppQuery,operations} from '../app/engine.mjs';
import {ArtefactFault,parseVersionRecord,parseReference,parseEnvelope,extractVersion,versionDigest,verifyReference,validateAdditive,DEFAULT_KINDS,evaluateNotices,evaluateRetraction,versionURL} from '../core/artefacts.mjs';
import {canonical} from '../core/primitives.mjs';
import {jcs} from '../core/strict-json.mjs';
const fail=code=>{throw new ArtefactFault(code);},clone=structuredClone;
const lineKey=id=>'artefacts/line/'+id,recordKey=digest=>'artefacts/record/'+digest,pinKey=ref=>'artefacts/pin/'+ref.id+'/'+(ref.version??'legacy')+'/'+ref.digest;
const legacyKey=(id,digest)=>recordKey(digest)+'/legacy/'+id;
const empty=()=>({head:0,digests:[],observed:[],notices:[],faults:[],blockedFrom:null,fetchedAt:null,negativeUntil:0});
const enabled=flags=>flags.for({}).global('ARTEFACT_VERSIONS_ENABLED');
const reference=input=>parseReference(input.reference??input,{urlMember:input.urlMember??'artefact',kind:input.kind});
const legacyDigest=async body=>'sha256-'+btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(body)))))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const finish=out=>{if(out.error)fail(out.error);return out.value;};
const result=(ref,record,state,existingPin=false)=>({reference:{artefact:ref.id,...ref.version?{version:ref.version}:{},digest:ref.digest},body:clone(record.body),kind:record.kind,legacy:!ref.version,notices:clone(state.notices),...evaluateRetraction(ref.version??1,{notices:state.notices,existingPin}),head:state.head});
async function cached(tx,ref,{existing=false,now}={}){
 if(!ref.digest)return null;const state=await tx.get(lineKey(ref.id))??empty(),pin=await tx.get(pinKey(ref));
 if(existing&&!pin)return null;
 const record=await tx.get(ref.version?recordKey(ref.digest):legacyKey(ref.id,ref.digest));if(!record||record.id!==ref.id||ref.version&&record.version!==ref.version||ref.kind&&record.kind!==ref.kind)return null;
 if((ref.version?await versionDigest(record):await legacyDigest(record.body))!==ref.digest)fail('artefact_digest_mismatch');
 if(!existing&&await tx.get('artefacts/mirror/'+ref.digest)&&(state.fetchedAt===null||state.fetchedAt+86400000<=now))fail('artefact_unavailable');
 if(!existing&&state.notices.some(n=>n.type==='retracted'&&n.from<=(ref.version??1)))fail('artefact_retracted');
 return result(ref,record,state,existing);
}
async function obtain(resources,ref,{refresh=false}={}){
 const {federationStore:store,egress,clock}=resources,state=await store.get(lineKey(ref.id))??empty(),now=clock.now();
 if(refresh&&state.fetchedAt!==null&&now-state.fetchedAt<3600000)return null;
 if(state.negativeUntil>now)fail('artefact_unavailable');
 try{
  const raw=await egress.fetch(ref.id,{envelope:enabled(resources.flags)});
  let envelope;try{envelope=parseEnvelope(raw,{id:ref.id});}catch(error){
   // Strict envelope errors never fall through to permissive legacy interpretation.
   let value;try{value=typeof raw==='string'?JSON.parse(raw):raw instanceof Uint8Array?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)):raw;}catch{fail('artefact_invalid');}
   if(Object.hasOwn(value??{},'bindle_artefact'))throw error;
   return {legacy:value};
  }
  if(!enabled(resources.flags))fail('unsupported_artefact_version');
  const records=new Map();for(let i=0;i<Math.max(refresh?envelope.versions.length:ref.version??envelope.versions.length,state.head);i++)if(envelope.versions[i]&&!Object.hasOwn(envelope.versions[i],'body')){
   const url=versionURL(ref.id,i+1),stored=await store.get(recordKey(envelope.versions[i+1]?.prev));records.set(url,stored??await egress.fetch(url,{record:true}));
  }
  return {envelope,records};
 }catch(error){
  if(!error.code||['artefact_unavailable','timeout','too_large','untrusted_schema_host'].includes(error.code)){
   await store.transaction(async tx=>{const current=await tx.get(lineKey(ref.id))??empty();current.negativeUntil=Math.max(current.negativeUntil,now+60000);await tx.put(lineKey(ref.id),current);});fail('artefact_unavailable');
  }throw error;
 }
}
async function accept(resources,ref,copy,{refresh=false,clear=false}={}){
 const {federationStore:store,clock,config}=resources;if(typeof config.validateArtefactBody!=='function')fail('artefact_unverifiable');
 return finish(await store.transaction(async tx=>{
  const state=await tx.get(lineKey(ref.id))??empty(),save=()=>tx.put(lineKey(ref.id),state);
  const fault=async(code,from)=>{if(!state.faults.some(f=>f.code===code&&f.from===from))state.faults.push({code,...from?{from}:{}});if(from)state.blockedFrom=state.blockedFrom===null?from:Math.min(from,state.blockedFrom);await save();return {error:code};};
  if(copy.legacy!==undefined){
   if(!copy.legacy||typeof copy.legacy!=='object'||Array.isArray(copy.legacy))return {error:'artefact_invalid'};
   if(refresh)return {value:null};if(ref.version) return {error:'artefact_invalid'};
   const digest=await legacyDigest(copy.legacy),resolved={...ref,digest:ref.digest??digest};
   await verifyReference(copy.legacy,{artefact:ref.id,digest:resolved.digest});if(await config.validateArtefactBody(clone(copy.legacy),{id:ref.id,kind:ref.kind,legacy:true})===false)return {error:'artefact_invalid'};
   if(state.head){const first=await tx.get(recordKey(state.digests[0]));if(!first||await legacyDigest(first.body)!==resolved.digest)return fault('artefact_history_rewritten');}
   const key='artefacts/legacy/'+ref.id,previous=await tx.get(key);if(previous&&previous!==resolved.digest)return {error:'schema_changed'};
   await tx.put(legacyKey(ref.id,resolved.digest),{id:ref.id,...ref.kind?{kind:ref.kind}:{},body:copy.legacy});await tx.put(key,resolved.digest);await tx.put(pinKey(resolved),true);return {value:result(resolved,{body:copy.legacy,kind:ref.kind},state)};
  }
  const {envelope,records}=copy,target=refresh?Math.max(1,state.head):ref.version??envelope.versions.length;
  let verified;
  try{verified=await extractVersion(envelope,Math.max(target,state.head),{id:ref.id,kind:ref.kind,records,storedDigests:state.digests});}
  catch(error){if(error.code==='artefact_history_rewritten')return fault(error.code);return {error:error.code??'artefact_invalid'};}
  // Notices can bind to the copy's later head without advancing the provider head.
  let noticeCopy=verified;try{noticeCopy=await extractVersion(envelope,envelope.versions.length,{id:ref.id,kind:ref.kind,records,storedDigests:state.digests});}catch{}
  const notices=evaluateNotices(envelope,{digests:noticeCopy.digests,storedDigests:state.digests,accepted:state.notices});state.notices=notices.notices;state.fetchedAt=clock.now();state.negativeUntil=0;
  if(notices.rewritten)return fault('artefact_history_rewritten');
  if(clear){if(state.blockedFrom!==null)return {error:'artefact_not_additive'};state.faults=[];await save();return {value:clone(state)};}
  if(refresh){await save();return {value:clone(state)};}
  if((state.observed??[]).some((digest,i)=>verified.digests[i]!==undefined&&verified.digests[i]!==digest))return fault('artefact_history_rewritten');
  const version=ref.legacy?1:target,record=verified.records[version-1],digest=ref.legacy?await legacyDigest(record.body):verified.digests[version-1];
  if(ref.digest&&ref.digest!==digest){await save();return {error:'artefact_digest_mismatch'};}
  if(state.blockedFrom!==null&&version>=state.blockedFrom){await save();return {error:'artefact_not_additive'};}
  if(state.notices.some(n=>n.type==='retracted'&&n.from<=version)){await save();return {error:'artefact_retracted'};}
  if(state.faults.length&&version>state.head){await save();return {error:state.blockedFrom!==null?'artefact_not_additive':'artefact_history_rewritten'};}
  const kinds=config.artefactKinds??DEFAULT_KINDS,known=kinds instanceof Map?kinds.has(envelope.kind):Object.hasOwn(kinds,envelope.kind);
  if(!known&&ref.latest){await save();return {error:'artefact_unverifiable'};}
  const old=await tx.get('artefacts/legacy/'+ref.id);if(old&&old!==await legacyDigest(verified.records[0].body))return fault('artefact_history_rewritten');
  for(let i=0;i<version;i++){
   const r=verified.records[i];if(await config.validateArtefactBody(clone(r.body),{id:r.id,kind:r.kind,version:r.version})===false){await save();return {error:'artefact_invalid'};}
   if(i&&known&&validateAdditive(envelope.kind,verified.records[i-1].body,r.body,{kinds}).additive!==true)return fault('artefact_not_additive',i+1);
   state.observed??=[];state.observed[i]=verified.digests[i];const key=recordKey(verified.digests[i]),previous=await tx.get(key);if(previous&&jcs(previous)!==jcs(r))return fault('artefact_history_rewritten');if(!previous)await tx.put(key,r);if(known&&i+1>state.head){state.head=i+1;state.digests=verified.digests.slice(0,i+1);}
  }
  const resolved={...ref,version:ref.legacy?undefined:version,digest};if(ref.legacy)await tx.put(legacyKey(ref.id,digest),{id:ref.id,kind:record.kind,body:record.body});
  await save();await tx.put(pinKey(resolved),true);return {value:result(resolved,record,state)};
 }));
}
// Configured mirror records never supply notices, answer latest, or advance heads.
async function acceptMirror(resources,ref){
 if(typeof resources.config.validateArtefactBody!=='function')fail('artefact_unverifiable');
 const records=[],digests=[];let digest=ref.digest;
 for(let n=ref.version;n>=1;n--){const raw=await resources.federationStore.get(recordKey(digest))??await resources.egress.record(digest),record=parseVersionRecord(raw);if(record.id!==ref.id||record.version!==n||ref.kind&&record.kind!==ref.kind||await versionDigest(record)!==digest)fail('artefact_digest_mismatch');records.unshift(record);digests.unshift(digest);digest=record.prev;}
 if(records.some(r=>r.kind!==records[0].kind))fail('artefact_invalid');
 return finish(await resources.federationStore.transaction(async tx=>{
  const state=await tx.get(lineKey(ref.id))??empty();
  if(state.fetchedAt===null||resources.clock.now()-state.fetchedAt>=86400000)return {error:'artefact_unavailable'};
  if(state.faults.length)return {error:'artefact_history_rewritten'};
  if(state.notices.some(n=>n.type==='retracted'&&n.from<=ref.version))return {error:'artefact_retracted'};
  for(let i=0;i<records.length;i++){
   if(state.digests[i]&&state.digests[i]!==digests[i])return {error:'artefact_digest_mismatch'};
   if(resources.config.validateArtefactBody&&await resources.config.validateArtefactBody(clone(records[i].body),records[i])===false)return {error:'artefact_invalid'};
   const key=recordKey(digests[i]),previous=await tx.get(key);if(previous&&jcs(previous)!==jcs(records[i]))return {error:'artefact_digest_mismatch'};if(!previous){await tx.put(key,records[i]);await tx.put('artefacts/mirror/'+digests[i],true);}
  }
  await tx.put(pinKey(ref),true);return {value:result(ref,records.at(-1),state)};
 }));
}
export class PinArtefact extends AppAction {
 static operation='artefacts.pin';static deps=['federationStore','egress','flags','clock','config'];static changes='artefacts.changed';
 async run(resources){const ref=reference(this.input);if(ref.version&&!enabled(resources.flags))fail('unsupported_artefact_version');const hit=await resources.federationStore.transaction(async tx=>{const hit=await cached(tx,ref,{now:resources.clock.now()});if(hit)await tx.put(pinKey(ref),true);return hit;});if(hit)return hit;let copy;try{copy=await obtain(resources,ref);}catch(error){if(error.code!=='artefact_unavailable'||!ref.version||!resources.egress.record)throw error;return acceptMirror(resources,ref);}return accept(resources,ref,copy);}
}
export class ResolveArtefact extends AppQuery {
 static operation='artefacts.resolve';static deps=['federationStore'];
 async fetch({federationStore}){const hit=await federationStore.transaction(tx=>cached(tx,reference(this.input),{existing:true}));if(!hit)fail('artefact_unavailable');return hit;}
}
export class RefreshArtefact extends AppAction {
 static operation='artefacts.refresh';static deps=PinArtefact.deps;static changes='artefacts.changed';
 async run(resources){const ref=reference(this.input),copy=await obtain(resources,ref,{refresh:true});return copy?accept(resources,ref,copy,{refresh:true}):null;}
}
export class ClearArtefactFault extends AppAction {
 static operation='artefacts.clearFault';static deps=PinArtefact.deps;
 async run(resources){if(this.actor?.kind!=='operator')fail('unauthorized');const ref=reference(this.input);return accept(resources,ref,await obtain(resources,ref),{clear:true});}
}
export class StoredArtefact extends AppQuery {
 static operation='artefacts.record';static deps=['federationStore'];
 async fetch({federationStore}){const record=await federationStore.get(recordKey(this.input.digest));return record?.t==='bindle.artefact-version.v1'&&await versionDigest(record)===this.input.digest?record:null;}
}
export const ARTEFACT_OPERATIONS=operations(PinArtefact,ResolveArtefact,RefreshArtefact,ClearArtefactFault,StoredArtefact);
