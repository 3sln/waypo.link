// The published object-storage/v1 predates x-methods. Its frozen body is never rewritten: only this exact
// reviewed snapshot gets the adapter's method/result mapping. Every other contract carries its own metadata.
import {LEGACY_OBJECT_STORAGE} from './legacy-object-storage.mjs';
import {canonical} from './primitives.mjs';
const source=LEGACY_OBJECT_STORAGE,id='https://3sln.me/artefacts/contracts/object-storage/v1',effects={capabilities:'read',get:'read',put:'write',delete:'destructive',presign:'write'};
export function contractMethods(schema){
 if(schema?.['x-methods'])return schema['x-methods'];
 if(schema?.$id!==id||canonical(schema)!==source)return {};
 return Object.fromEntries(Object.entries(effects).map(([method,effect])=>[method,{effect,request:schema.oneOf.find(branch=>branch.properties?.method?.const===method),result:'#/$defs/'+method+'Result'}]));
}
