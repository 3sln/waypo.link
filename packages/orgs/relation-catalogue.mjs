// ORG-10f: the first 3sln.me relation catalogue (design §8b.9 RL-14; §8b.1 table). Provisional (coordinator), not signed
// off by the user. Published under the reserved `.example` placeholder until publication authority is agreed (AGENTS.md),
// shown as "listed by 3sln.me" and never as a verified publisher.
//
// Every entry grants object storage, the only contract the runtime pool offers today (packages/runtime/account/
// relations.mjs `runtimeResources`): one shared fragment with one resource field. A relation is whatever its matrix
// says (§8b.1); the titles below never authorize anything.
//
// `relationCatalogue()` builds the envelopes once (hash-chained, packages/orgs/relation-documents.mjs) and returns
//   {entries:[{key, title, description, publisher, pin, slots}], fetch(artefactId), fragment(pin)}
// for the RelationDocuments port. Anything outside the catalogue is `relation_unavailable` until ORG-11 adds a fetch
// for documents named by URL (behind ORG_FOREIGN_RELATIONS_ENABLED and the egress gate).
import {digestJSON} from '../core/artefacts.mjs';
import {relationEnvelope,pinKey} from './relation-documents.mjs';

export const OBJECT_STORAGE='https://3sln.me/artefacts/contracts/object-storage/v1';
export const RELATION_CATALOGUE_PUBLISHER='https://relations.3sln.example';
const BASE=RELATION_CATALOGUE_PUBLISHER;
const READ=['capabilities','get'],WRITE=['capabilities','delete','get','put'];
const FRAGMENT={id:`${BASE}/fragments/shared-files`,title:'Shared files',description:'Files one organization shares with another.',publisher:BASE,fields:{files:{title:'Files',type:'resource',contracts:[OBJECT_STORAGE]}}};
const org=(title,min,max)=>({title,arity:{min,max},kinds:['organization']});

/** The catalogue bodies (version 1 of each), in display order. */
function bodies(f){
 const entry=(grantor,grantee,methods,extra={})=>({grantor,grantee,fragment:f.fragment,version:f.version,digest:f.digest,methods:{files:{[OBJECT_STORAGE]:methods}},...extra});
 return [
  {key:'share',body:{id:`${BASE}/relations/share`,title:'Share',description:'One organization shares chosen files with another.',publisher:BASE,crit:[],
   slots:{owner:org('Owner',1,1),recipient:org('Recipient',1,1)},access:[entry('owner','recipient',WRITE)]}},
  {key:'group',body:{id:`${BASE}/relations/group`,title:'Group',description:'A parent and its subsidiaries. Each subsidiary shares what it chooses with the parent; the parent does not govern it.',publisher:BASE,crit:[],
   slots:{parent:org('Parent',1,1),subsidiary:org('Subsidiary',0,64)},access:[entry('subsidiary','parent',READ),entry('parent','subsidiary',READ,{required:false})]}},
  {key:'supply',body:{id:`${BASE}/relations/supply`,title:'Supply',description:'A buyer and its suppliers exchange orders and invoices as files.',publisher:BASE,crit:[],
   slots:{buyer:org('Buyer',1,1),supplier:org('Supplier',1,256)},access:[entry('buyer','supplier',WRITE,{required:false}),entry('supplier','buyer',WRITE,{required:false})]}},
  {key:'accounting-engagement',body:{id:`${BASE}/relations/accounting-engagement`,title:'Accounting engagement',description:'A client shares its records with its accounting firm, which may share reports back.',publisher:BASE,crit:[],
   slots:{client:org('Client',1,1),firm:org('Firm',1,1)},access:[entry('client','firm',READ),entry('firm','client',READ,{required:false})]}},
 ];
}

let built=null;
/** The catalogue and its RelationDocuments fetch/fragment functions (built once per isolate). */
export function relationCatalogue(){
 built??=(async()=>{
  const f={fragment:FRAGMENT.id,version:1,digest:await digestJSON(FRAGMENT)},fragments=new Map([[pinKey(f),FRAGMENT]]),envelopes=new Map(),entries=[];
  for(const {key,body} of bodies(f)){const {envelope,pins}=await relationEnvelope(body.id,[body]);envelopes.set(body.id,envelope);
   entries.push({key,title:body.title,description:body.description,publisher:body.publisher,publisherVerified:false,listedBy:'3sln.me',pin:pins[0],slots:Object.entries(body.slots).map(([name,s])=>({name,title:s.title,min:s.arity.min,max:s.arity.max}))});}
  return Object.freeze({entries:Object.freeze(entries),fetch:async id=>envelopes.has(id)?structuredClone(envelopes.get(id)):null,fragment:async p=>{const body=fragments.get(pinKey(p));return body?structuredClone(body):undefined;}});
 })();
 return built;
}
