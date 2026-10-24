// ORG-7: directory.v1. `federation` is the injected directory resource; no network or storage at the HTTP edge.
import {AppAction,AppQuery,read,perform} from '../engine.mjs';
import {fault} from '../faults.mjs';
import {isUUID} from '../../core/primitives.mjs';
import {siteGlobal} from '../../flags/read.mjs';
import {normalizeHandle} from '../../identity/handles.mjs';
export const DIRECTORY_FLAG='DIRECTORY_ENABLED',DIRECTORY_PATH='/bindle/directory';
export class DirectoryIdentity extends AppQuery {
 static operation='directory.identity';static deps=['identityShards','accounts','config'];
 async fetch({identityShards,accounts,config}){
  if(!siteGlobal(config,DIRECTORY_FLAG))return null;const input=this.input??{};let account;
  if(input.sub!==undefined){if(!isUUID(input.sub))return null;account=await identityShards.get(input.sub);}
  else{const parts=typeof input.handle==='string'?input.handle.split('@'):[];if(parts.length!==2||parts[1].toLowerCase()!==new URL(config.APP_ORIGIN).host)return null;let handle;try{handle=normalizeHandle(parts[0]);}catch{return null;}account=await identityShards.findByHandle(handle);}
  if(account?.status!=='active')return null;
  // This RPC runs behind the account gate and active lifecycle policy, including the deletion fence.
  const document=await accounts.get(account.id).invoke({method:'directoryDocument',args:[account.id,{id:account.id,kind:account.kind,handle:account.handle,moves:account.moves}]});
  if(document?.$fault){if(['not_found','account_deleted','account_deleting','account_suspended','identity_moved','forbidden'].includes(document.$fault.code)||[403,404,410].includes(document.$fault.status))return null;throw Object.assign(new Error(document.$fault.message),document.$fault);}
  if(!document)return null;
  const identity=account.identityUri??`${config.APP_ORIGIN}/identity/${account.id}`;
  return input.document?document:{iss:config.APP_ORIGIN,sub:account.id,identity};
 }
}
export class RefreshDirectoryIdentity extends AppAction {
 static operation='directory.refresh';static deps=['federation','config'];
 run({federation,config}){if(!siteGlobal(config,DIRECTORY_FLAG))fault('feature_disabled','Directory is unavailable.',404);if(this.actor?.kind!=='system')fault('forbidden','Background refresh only.',403);return federation.refresh(this.input??{});}
}
export class DirectoryKey extends AppQuery {
 static operation='directory.key';static deps=['federation','config'];
 fetch({federation,config}){if(!siteGlobal(config,DIRECTORY_FLAG))return null;return federation.resolve(this.input??{});}
}
export const DIRECTORY_OPERATIONS=Object.freeze([DirectoryIdentity,RefreshDirectoryIdentity,DirectoryKey]);
/** Shared `resolveIdentityKey` directory hook. The caller admits the relationship before background refresh;
 * signature verification uses resolve only. Every call observes the engine's pinned feature configuration. */
export const directoryHook=engine=>Object.freeze({resolve:input=>read(engine,new DirectoryKey({input})),refresh:input=>perform(engine,new RefreshDirectoryIdentity({actor:{kind:'system',reason:'directory-refresh'},input:{...input,verificationOnly:input?.verificationOnly??true}}))});
