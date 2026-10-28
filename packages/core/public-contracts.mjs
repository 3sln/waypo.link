// Explicit publication catalog. Design-only contracts and superseded fixtures
// must not become public merely because a file exists in docs/artefacts.
const authority='https://3sln.me';
export const publicContracts=Object.freeze([
 ['object-storage','Object storage','docs/3sln/services/storage.html'],
 ['preferences','Preferences','docs/spec/contracts.html'],
 ['profile','Profile','docs/spec/contracts.html'],
 ['app-messages','Messages from connected apps','docs/3sln/services/app-messages.html'],
 ['resource-descriptor','Resource descriptor','docs/spec/contracts.html'],
 ['resource-scoping','Resource scoping','docs/spec/federation-implementation.html'],
].map(([name,title,documentation])=>Object.freeze({name,title,version:'v1',kind:'rpc-contract',status:'draft',id:`${authority}/artefacts/contracts/${name}/v1`,path:`/artefacts/contracts/${name}/v1.json`,source:`docs/artefacts/${name}-v1.json`,documentation:`/${documentation}`})).concat([Object.freeze({name:'preferences',title:'Preferences v2',version:'v2',kind:'rpc-contract',status:'draft',id:`${authority}/artefacts/contracts/preferences/v2`,path:'/artefacts/contracts/preferences/v2.json',source:'docs/artefacts/preferences-v2.json',documentation:'/docs/spec/extensions/integrations.html'})]));
// Conversation v1 was withdrawn with core messaging (DEVLOG 2026-10-27): its published JSON stays immutable at the same
// path, listed as withdrawn; its legacy spec moved to apps/parlay/docs/legacy/conversations.md.
export const publicSchemas=Object.freeze([Object.freeze({name:'conversation',title:'Conversation v1 local submission envelope (withdrawn)',version:'v1',kind:'submission-schema',status:'withdrawn',id:`${authority}/artefacts/conversation-v1.json`,path:'/artefacts/conversation-v1-body.json',source:'docs/artefacts/conversation-v1.json',documentation:'/artefacts/contracts/'})]);
export const publicFragments=Object.freeze([Object.freeze({name:'app-message-preferences',title:'App messages preference fragment',version:'v1',kind:'preferences-fragment',status:'draft',id:'https://3sln.me/artefacts/preferences/app-messages/v1',path:'/artefacts/preferences/app-messages/v1.json',source:'docs/artefacts/app-message-preferences-v1.json',documentation:'/docs/3sln/services/app-messages.html'}),
 // Extensions rev 3.2 (CR-X3-26): the former item-classifier slot, republished as an ordinary fragment at a new URL.
 // CR-X3-25 withdrew it: its decision-model/v1 contract carried provider-fixed message categories. The Bindle
 // item-classification fragment and contract replace it (docs/spec/extensions/item-classification.md). Its published
 // JSON stays immutable and resolvable at the same path, listed as withdrawn; no provider pins it.
 Object.freeze({name:'item-classifier',title:'Item classifier preference fragment (withdrawn)',version:'v1',kind:'preferences-fragment',status:'withdrawn',id:`${authority}/artefacts/fragments/item-classifier/v1`,path:'/artefacts/fragments/item-classifier/v1.json',source:'docs/artefacts/fragments/item-classifier-v1.json',documentation:'/docs/spec/extensions.html'})]);
// Extensions rev 3 removed the manifest `profiles` container. The components profile became the Bindle-owned
// embedded-components extension (extensions §2.7, §2.8; CR-X3-16), and no provider emits or reads the profile URL. Its
// published document stays immutable and resolvable at the same path, listed as withdrawn, until links move.
export const publicProfiles=Object.freeze([Object.freeze({name:'components',title:'3sln.me components profile (withdrawn)',version:'v1',kind:'manifest-profile',status:'withdrawn',id:`${authority}/artefacts/profiles/components/v1`,path:'/artefacts/profiles/components/v1.json',source:'docs/architecture/artefacts/components-profile-v1.json',documentation:'/docs/profiles/components-v1.html'})]);
// Extensions rev 3.2 removed slots. The retired slot document stays resolvable at its URL until links move (CR-X3-26);
// no provider processes it (a top-level `slot` makes a fragment unsupported, protocol §3).
export const publicSlots=Object.freeze([Object.freeze({name:'item-classifier-slot',title:'Item classifier slot (retired)',version:'v1',kind:'slot-manifest',status:'withdrawn',id:`${authority}/artefacts/slots/item-classifier/v1`,path:'/artefacts/slots/item-classifier/v1.json',source:'docs/artefacts/slots/item-classifier-v1.json',documentation:'/docs/spec/extensions.html'})]);
export const publicArtifacts=Object.freeze([...publicContracts,...publicSchemas,...publicFragments,...publicProfiles,...publicSlots]);
/** Which member of the JSON source carries the published identifier. */
export const artifactIdentifier=(artifact,value)=>['preferences-fragment','manifest-profile','slot-manifest'].includes(artifact.kind)?value.id:value.$id;
export function publicArtifact(path){return publicArtifacts.find(entry=>path===entry.path||path===`/artefacts/${entry.name}-${entry.version}.json`||path==='/'+entry.source||path===new URL(entry.id).pathname);}
export function contractRegistry(lock=[]){const entry=({title,id,path,version,kind,status,documentation})=>({title,id,schema:path,version,kind,status,documentation,envelope:id+'/envelope',artefact_versions:(lock.find(line=>line.id===id)?.versions??[]).map((digest,i)=>({version:i+1,digest,record:id+'/versions/'+(i+1)}))});return {version:1,description:'Published draft definitions. Schema validity grants no authority and does not imply provider or external interoperability conformance.',contracts:publicContracts.map(entry),schemas:publicSchemas.map(entry),fragments:publicFragments.map(entry),profiles:publicProfiles.map(entry),slots:publicSlots.map(entry)};}

// Publication stays additive: legacy canonical URLs retain their source body until ART-4+ consumers migrate.
export const artefactKind=artifact=>({'preferences-fragment':'fragment','slot-manifest':'slot'}[artifact.kind]??artifact.kind);
export const artefactPublication=artifact=>({envelope:new URL(artifact.id).pathname+'/envelope',record:version=>new URL(artifact.id).pathname+'/versions/'+version,body:version=>new URL(artifact.id).pathname+'/'+version+'.json',source:version=>version===1?artifact.source:artifact.source.replace(/\.json$/,'/'+version+'.json')});
export async function assembleArtefacts(lock,{read,core}){
 if(!Array.isArray(lock)||lock.length!==publicArtifacts.length||new Set(lock.map(line=>line.id)).size!==lock.length)throw Error('Invalid artefact lock catalog');
 const publications=[];
 for(const artifact of publicArtifacts){
  const line=lock.find(line=>line.id===artifact.id),kind=artefactKind(artifact),paths=artefactPublication(artifact),versions=[],records=[];
  if(!line||line.kind!==kind||!Array.isArray(line.versions)||!line.versions.length||line.versions.length>1024)throw Error('Missing artefact lock: '+artifact.id);
  for(let i=0;i<line.versions.length;i++){
   const body=core.strictJSON(await read(paths.source(i+1))),entry={version:i+1,prev:line.versions[i-1]??null,body},record=core.versionRecord({id:artifact.id,kind},entry);
   if(artifactIdentifier(artifact,body)!==artifact.id||await core.versionDigest(record)!==line.versions[i])throw Error('Artefact history differs from lock: '+artifact.id);
   if(i&&!core.validateAdditive(kind,versions[i-1].body,body).additive)throw Error('Non-additive artefact: '+artifact.id);
   versions.push(entry);records.push(record);
  }
  let envelope={bindle_artefact:1,id:artifact.id,kind,versions,notices:[],signatures:[]};
  for(let i=0;new TextEncoder().encode(JSON.stringify(envelope)).length>262144&&i<versions.length-1;i++)delete versions[i].body;
  core.parseEnvelope(core.strictJSON(JSON.stringify(envelope),{maxDepth:36}));publications.push({artifact,paths,envelope,records});
 }
 return publications;
}
