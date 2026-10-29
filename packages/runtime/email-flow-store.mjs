// Durable store for cross-device email flows (sign-in and intents spike §4.2; packages/identity/email-flow.mjs owns the
// port contract). Records live in the identity storage beside device requests:
//   email-flow/<flowId>        {value: record, expiresAt: purgeAt}   one record per flow, CAS on `value.revision`
//   email-flow-link/<index>    {flowId, expiresAt: purgeAt}          an immutable pointer from HMAC(K_link, L)
// Both are indexed in the identity expiry index (identity-shards.mjs `indexDeviceExpiry`), whose alarm deletes them at
// `purgeAt` (the flow's expiry + 24 h): terminal flows are kept for 24 hours, then purged (spike §4.3 step 10).
//
// The Node adapter keeps them in its one identity store (IdentityRepository); the Worker routes each key to an identity
// shard by its own value (families `email-flow` and `email-flow-link`), so no write ever spans two shards: the record and
// its pointer are separate single-key writes, and a stale pointer is detected by the record's `linkIndex`.
import {indexDeviceExpiry,identityShardName} from './identity-shards.mjs';
import {EMAIL_FLOW} from '../identity/email-flow.mjs';

const flowKey=id=>`email-flow/${id}`,linkKey=index=>`email-flow-link/${index}`;
const purgeAt=record=>record.expiresAt+EMAIL_FLOW.retentionMs;
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{22}$/.test(value),validIndex=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const validRecord=record=>record&&typeof record==='object'&&validId(record.flowId)&&Number.isSafeInteger(record.revision)&&Number.isSafeInteger(record.expiresAt);

/** The store over transactional metadata ({get, put, delete, transaction}); the methods every adapter exposes. */
export class EmailFlowStorage {
  constructor(metadata){this.metadata=metadata;}
  async emailFlowCreate(record){
    if(!validRecord(record)||record.revision!==0)throw new TypeError('Invalid email flow');
    return this.metadata.transaction(async tx=>{const key=flowKey(record.flowId);if(await tx.get(key))return false;await tx.put(key,{value:record,expiresAt:purgeAt(record)});await indexDeviceExpiry(tx,key,purgeAt(record));return true;});
  }
  async emailFlowGet(id){if(!validId(id))return null;const row=await this.metadata.get(flowKey(id));return row?.value&&row.expiresAt>Date.now()?row.value:null;}
  async emailFlowCompareAndSwap(id,revision,record){
    if(!validId(id)||!validRecord(record)||record.flowId!==id||record.revision!==revision+1)throw new TypeError('Invalid email flow write');
    return this.metadata.transaction(async tx=>{const key=flowKey(id),row=await tx.get(key);if(!row?.value||row.value.revision!==revision||row.value.expiresAt!==record.expiresAt)return false;await tx.put(key,{value:record,expiresAt:row.expiresAt});return true;});
  }
  async emailFlowPutLink(index,flowId,until){
    if(!validIndex(index)||!validId(flowId)||!Number.isSafeInteger(until))throw new TypeError('Invalid email flow link');
    return this.metadata.transaction(async tx=>{const key=linkKey(index);if(await tx.get(key))return false;await tx.put(key,{flowId,expiresAt:until});await indexDeviceExpiry(tx,key,until);return true;});
  }
  async emailFlowFindByLink(index){if(!validIndex(index))return null;const row=await this.metadata.get(linkKey(index));return row&&row.expiresAt>Date.now()?row.flowId:null;}
}
/** The identity port over an object with the `emailFlow*` methods (the Node IdentityRepository). */
export const repositoryEmailFlows=repository=>Object.freeze({
  create:record=>repository.emailFlowCreate(record),get:id=>repository.emailFlowGet(id),
  compareAndSwap:(id,revision,record)=>repository.emailFlowCompareAndSwap(id,revision,record),
  putLink:(index,flowId,until)=>repository.emailFlowPutLink(index,flowId,until),findByLink:index=>repository.emailFlowFindByLink(index),
});
/** The identity port over identity shards (the Worker): `shard(name)` is the IdentityDirectory stub for a shard name. */
export function shardedEmailFlows(shard){
  const flow=async id=>shard(await identityShardName('email-flow',id)),link=async index=>shard(await identityShardName('email-flow-link',index));
  return Object.freeze({
    create:async record=>(await flow(record.flowId)).emailFlowCreate(record),get:async id=>validId(id)?(await flow(id)).emailFlowGet(id):null,
    compareAndSwap:async(id,revision,record)=>(await flow(id)).emailFlowCompareAndSwap(id,revision,record),
    putLink:async(index,flowId,until)=>(await link(index)).emailFlowPutLink(index,flowId,until),findByLink:async index=>validIndex(index)?(await link(index)).emailFlowFindByLink(index):null,
  });
}
