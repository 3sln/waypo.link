// ORG-10c imported resources (spec docs/spec/organizations.md §10, §9.7; design §8b.3, §8b.5, RL-13). Values a grantee
// receives through an edge appear in its pool as imports, keyed by (grantor origin principal, instance, entry), never
// by label or handle. Use inside the grantee goes through the grantee's own grants: a member's grant on the import's
// grantee-scoped id, intersected with the application's ceiling and the edge's methods (effectiveAuthority, §6.2).
//
//   rel/import/<grantor>/<instance>/<entry>   {grantor, instance, entry, resources:[{id, resource, contracts, methods,
//                                              scope?, expires_at?}], status:'available'|'unavailable', updatedAt}
//   rel/import-id/<id>                         {key, resource}: lookup by the grantee-scoped id (`imp_…`)
//
// Composition rule (spec §9.7, R3-H2): imports are never a grant value over an edge. Grant values are validated against
// the organization's own resource pool (packages/orgs/relation-instances.mjs), where imports do not exist, and every
// `imp_` id is refused there explicitly. `omitImports` is the same rule for any projection over an edge.
// The preferences relay projection (spec §10) needs an entity certificate as its token (ORG-10d); `relayDescriptor`
// builds the descriptor without one, and the packages/federation/service.mjs projection hunk waits for ORG-10d.
import {AppQuery} from '../app/engine.mjs';
import {digest} from '../core/records.mjs';
import {principalKey} from './grants.mjs';
import {effectiveAuthority} from './grants.mjs';

export const IMPORT_PREFIX='rel/import/',IMPORT_ID_PREFIX='rel/import-id/',IMPORT_ID=/^imp_[A-Za-z0-9_-]{32}$/;
const ik=instance=>encodeURIComponent(instance);
export const importKey=(grantor,instance,entry)=>`${IMPORT_PREFIX}${principalKey(grantor)}/${ik(instance)}/${String(entry).padStart(3,'0')}`;
export const importPrefix=(grantor,instance)=>`${IMPORT_PREFIX}${principalKey(grantor)}/${ik(instance)}/`;
/** The grantee-scoped id of one imported resource; stable across rebinding of the same grantor resource. */
export async function importId(grantor,instance,entry,resource){return 'imp_'+(await digest(globalThis.crypto,JSON.stringify(['bindle-relation-import-v1',grantor.iss,grantor.sub,instance,entry,resource]))).slice(0,32);}
export const isImportId=value=>typeof value==='string'&&value.startsWith('imp_');
/** Drops imported resources from any value projected or granted over an edge (spec §9.7 composition rule). */
export const omitImports=values=>(Array.isArray(values)?values:[]).filter(v=>!isImportId(typeof v==='string'?v:v?.resource));
const live=(r,now)=>r.expires_at===undefined||r.expires_at>now/1000;

/**
 * Recomputes the import rows of one counterpart from my mirror of its grant half and my acceptance half. Entries no
 * longer granted stay as `unavailable` rows (nothing is recalled, spec §9.6); dropped resources lose their id index.
 */
export async function syncImports(tx,{grantor,instance,available,entries,now}){
 const prefix=importPrefix(grantor,instance),existing=await tx.list({prefix,limit:65}),seen=new Set();
 for(const e of entries??[]){
  const key=importKey(grantor,instance,e.index),old=existing.get(key),resources=[];seen.add(key);
  for(const r of e.resources){const id=await importId(grantor,instance,e.index,r.resource);resources.push({id,...structuredClone(r)});}
  for(const r of old?.resources??[])if(!resources.some(x=>x.id===r.id))await tx.delete(IMPORT_ID_PREFIX+r.id);
  for(const r of resources)if(!old?.resources?.some(x=>x.id===r.id))await tx.put(IMPORT_ID_PREFIX+r.id,{key,resource:r.resource});
  await tx.put(key,{v:1,grantor:{iss:grantor.iss,sub:grantor.sub},instance,entry:e.index,resources,status:available?'available':'unavailable',updatedAt:now});
 }
 for(const [key,row] of existing)if(!seen.has(key)&&row.status!=='unavailable')await tx.put(key,{...row,status:'unavailable',updatedAt:now});
}
/** Marks every import of a counterpart unavailable (suspension, end, leaving). */
export async function holdImports(tx,{grantor,instance,now}){
 for(const [key,row] of await tx.list({prefix:importPrefix(grantor,instance),limit:65}))if(row.status!=='unavailable')await tx.put(key,{...row,status:'unavailable',updatedAt:now});
}
/** The import row and resource behind a grantee-scoped id, with its live status at `now`. */
export async function importById(tx,id,now){
 if(typeof id!=='string'||!IMPORT_ID.test(id))return null;
 const index=await tx.get(IMPORT_ID_PREFIX+id);if(!index)return null;const row=await tx.get(index.key),r=row?.resources?.find(x=>x.id===id);
 if(!r)return null;return {row,resource:r,available:row.status==='available'&&live(r,now)};
}
/** The listing shape of an import row (no grantor values beyond what the edge carries). */
export const importView=(row,now)=>({grantor:{...row.grantor},instance:row.instance,entry:row.entry,status:row.status,resources:row.resources.map(r=>({id:r.id,resource:r.resource,contracts:[...r.contracts],methods:structuredClone(r.methods),status:row.status==='available'&&live(r,now)?'available':'unavailable',...r.expires_at!==undefined?{expires_at:r.expires_at}:{}}))});
/**
 * Grantee-side effective authority on an import: the member's own grant on the import id ∩ the application's ceiling ∩
 * the edge's methods. Unavailable imports give nothing. Governance never appears (effectiveAuthority, spec §6.2).
 */
export function importAuthority({member,application,found,now}){
 if(!found?.available)return {};
 return effectiveAuthority({member,application,resource:{id:found.resource.id,contracts:found.resource.methods},imported:found.resource.methods,now});
}
/** The spec §10 relay descriptor for an application, minus its entity-certificate token (ORG-10d). */
export function relayDescriptor(found,{label,brokerOrigin}){
 return {id:found.resource.id,label,status:found.available?'available':'unavailable',contracts:[...found.resource.contracts],grantor:`${found.row.grantor.iss}/identity/${found.row.grantor.sub}`,instance:found.row.instance,broker:{origin:brokerOrigin??found.row.grantor.iss,resource:found.resource.resource}};
}

export class RelationImports extends AppQuery{static operation='relations.imports';static deps=['relations'];static entities=['organization'];static membershipEntry=true;static refreshOn=['relations-changed'];fetch({relations}){return relations.imports(this.actor,this.input??{});}}
export class RelationImportAuthority extends AppQuery{static operation='relations.import-authority';static deps=['relations'];static entities=['organization'];static membershipEntry=true;fetch({relations}){return relations.importAuthority(this.actor,this.input);}}
export const RELATION_IMPORT_OPERATIONS=Object.freeze([RelationImports,RelationImportAuthority]);
