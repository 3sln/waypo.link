// U404: public identity admission uses the account single writer's lifecycle policy, including the deletion fence.
import {AppQuery,ownerOf} from '../engine.mjs';
import {fault} from '../faults.mjs';
import {normalizeHandle} from '../../identity/handles.mjs';
export class PublicAccountAvailable extends AppQuery {
 static operation='identity.public-available';static deps=['accountStore'];
 async fetch({accountStore}){if(await accountStore.get('owner')!==ownerOf(this.actor))fault('not_found','Not found.',404);return {available:true};}
}
export class PublicIdentityAvailable extends AppQuery {
 static operation='identity.public-lookup';static deps=['identityShards','accounts'];
 async fetch({identityShards,accounts}){
  let handle;try{handle=normalizeHandle(this.input?.handle);}catch{fault('not_found','Not found.',404);}
  const identity=await identityShards.findByHandle(handle);if(identity?.status!=='active')fault('not_found','Not found.',404);
  // dispatch is lifecycle-gated before and inside the account gate; never infer admission from the directory alone.
  const result=await accounts.get(identity.id).invoke({method:'dispatch',args:[identity.id,{operation:PublicAccountAvailable.operation}]});
  if(result?.$fault)throw Object.assign(new Error(result.$fault.message),result.$fault);if(result?.available!==true)fault('temporarily_unavailable','Account status is unavailable.',503);return result;
 }
}
