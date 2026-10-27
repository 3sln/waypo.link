import {migrateTags} from '../core/tags.mjs';
import {StorageError} from '../storage/policy.mjs';
import {key,canonical,digest} from '../core/records.mjs';
// MCP item tools reach v1 app messages too; they live in activity's app-message/ family (messaging extraction prep).
import {itemRecord} from '../activity/app-messages.mjs';
import {MessagingFault} from '../core/records.mjs';
const fail=(code,message,status=403)=>{throw new StorageError(code,message,status);};
// F10 (wargame 3): agent mutation journals bind a request UUID to its arguments for a bounded replay lifetime. After
// MCP_JOURNAL_TTL_MS the row and its expiry index are swept by the account alarm and the UUID may execute again.
// In-process marker (not serializable, so no RPC caller can forge it): browser automation already charged this write.
export const WORK_PRECHARGED=Symbol('work-precharged');
export const MCP_JOURNAL_TTL_MS=48*3600000,MCP_JOURNAL_EXPIRY='mcp/operation-expiry/';
const expiryKey=(expiresAt,journal)=>`${MCP_JOURNAL_EXPIRY}${String(expiresAt).padStart(16,'0')}/${journal.slice('mcp/operation/'.length)}`;
/** F3 (wargame 3): list rows are projected to an allowlist. The subject is an excerpt of sender content, so it is
 * returned only when item_read is consented for the same collection; notification summaries, grant IDs and owner
 * identifiers are never returned. Shared by MCP tools, the collection resource, the review prompt and browser automation. */
export function mcpListItem(item,{itemRead=false}={}){
 const tagged=migrateTags(item),subject=item?.senderMetadata?.subject;
 return {id:item.id,mimeType:item.mimeType,size:item.size,receivedAt:item.receivedAt??null,readAt:item.readAt??null,tags:tagged.tags,classification:tagged.classification,quarantined:Boolean(item.quarantined),...itemRead&&typeof subject==='string'?{subject}:{}};
}
/** Inbox mutation results use the list projection (write) or a fixed acknowledgement (delete). The journal keeps
 * only the projection (subject included, as account-internal state); each return re-applies the caller's item_read
 * consent. Replay re-projects too, so rows journaled before this projection existed are never returned raw. */
function journalResult(tool,result){
 if(tool==='item_delete')return {deleted:true};
 if(!result||typeof result!=='object'||typeof result.id!=='string')fail('indeterminate','Read the item before retrying this operation.',503);
 const subject=typeof result.senderMetadata?.subject==='string'?result.senderMetadata.subject:typeof result.subject==='string'?result.subject:undefined;
 return mcpListItem({...result,senderMetadata:subject===undefined?undefined:{subject}},{itemRead:true});
}
function mutationResult(tool,result,itemRead){
 const projected=journalResult(tool,result);if(tool==='item_delete')return projected;
 const {subject,...rest}=projected;return itemRead&&subject!==undefined?{...rest,subject}:rest;
}
/** Account alarm sweep: deletes expired journal rows in bounded batches; returns the next expiry, if any. */
export async function sweepMcpJournal(metadata,now=Date.now(),limit=100){
 const rows=await metadata.list({prefix:MCP_JOURNAL_EXPIRY,limit});let next=null;
 for(const [index,row]of rows){if(!Number.isSafeInteger(row?.expiresAt)||typeof row.journal!=='string'||!row.journal.startsWith('mcp/operation/')){await metadata.delete(index);continue;}if(row.expiresAt>now){next=row.expiresAt;break;}const current=await metadata.get(row.journal);if(!current||current.expiresAt===row.expiresAt)await metadata.delete(row.journal);await metadata.delete(index);}
 if(next===null&&rows.size>=limit)next=now+1000;return next;
}
export async function mcpCollections(account,owner){
 await account.warm(owner);
 const inbox=(await account.messages.collections(owner)).filter(c=>c.active).map(c=>({id:`inbox:${c.id}`,name:c.name,kind:'inbox',tools:['collections_list','items_list','item_read','item_write','item_delete']}));
 const resources=[...(await account.metadata.list({prefix:'resource/',limit:202})).values()],storage=resources.filter(r=>r.kind!=='app-connection'),legacyDefaultAllowance=storage.filter(r=>r.builtin===true&&r.provider==='hosted'&&r.owner===owner).length===1?1:0;
 if(resources.length>200+legacyDefaultAllowance||storage.length>100+legacyDefaultAllowance)fail('resource_limit','This account has too many sources.',429);
 return [...inbox,...resources.filter(r=>r.owner===owner&&r.kind!=='app-connection'&&r.status==='connected').map(r=>({id:`resource:${r.id}`,name:r.name,kind:'storage',tools:['collections_list',...r.capabilities?.read?['item_read']:[],...r.capabilities?.write?['item_write']:[],...(r.provider==='hosted'||r.capabilities?.delete)?['item_delete']:[]]}))];
}
export async function mcpOperation(account,owner,clientId,tool,args,{itemRead=false,workCharged=false,connection}={}){
 const collection=(await mcpCollections(account,owner)).find(c=>c.id===args.collectionId);
 if(!collection||!collection.tools.includes(tool))fail('forbidden','The collection or function is no longer available.');
 const id=collection.id.split(':')[1];
 if(collection.kind==='storage'){
  const method={item_read:'get',item_write:'put',item_delete:'delete'}[tool];
  const input=tool==='item_read'?{key:args.key}:tool==='item_write'?{key:args.key,dataBase64:args.dataBase64,contentType:args.contentType,condition:args.condition}:{key:args.key,version:args.version};
  if(tool==='item_read'&&collection.kind==='storage'){
   const resource=await account.metadata.get(`resource/${id}`);
   if(resource.provider==='hosted'){const item=await account.metadata.get(`hosted/${id}/${encodeURIComponent(args.key)}`);if(item?.size>65536)fail('result_too_large','Download this item through the account interface.',413);}
   // Managed Drive objects record their verified size locally, so oversize reads are refused before any download.
   else if(resource.provider==='google-drive'&&typeof account.googleDrive?.path==='function'){const entry=await account.metadata.get(await account.googleDrive.path(id,args.key));if(entry?.size>65536)fail('result_too_large','Download this item through the account interface.',413);}
  }
  return account.federationRPC({subject:`${account.config.APP_ORIGIN}/entities/${owner}`,clientId:`mcp:${clientId}`,resource:`${account.config.APP_ORIGIN}/entities/${owner}/resources/${id}`,contract:'https://3sln.me/artefacts/contracts/object-storage/v1',method,args:input,tx:args.requestId??crypto.randomUUID()},workCharged?WORK_PRECHARGED:undefined,connection?{connection:{id:connection.id,generation:connection.generation}}:{});
 }
 if(tool==='items_list'){const page=await account.messagePage(owner,{collection:id,limit:args.limit??20,cursor:args.cursor});return {items:page.items.map(item=>mcpListItem(item,{itemRead})),cursor:page.cursor??null};}
 const writing=['item_write','item_delete'].includes(tool);
 let journal,fingerprint;
 if(writing){
  if(!/^[a-f0-9-]{36}$/.test(args.requestId||''))fail('invalid_args','A request UUID is required.',400);
  journal=`mcp/operation/${encodeURIComponent(clientId)}/${args.requestId}`;fingerprint=await digest(crypto,canonical({tool,args}));let prior=await account.metadata.get(journal);
  if(prior&&Number.isSafeInteger(prior.expiresAt)&&prior.expiresAt<=Date.now()){await account.metadata.delete(journal);prior=null;}
  if(prior){if(prior.fingerprint!==fingerprint)fail('tx_conflict','Request identifier was reused.',409);if(prior.state==='failed')fail(prior.error?.code??'invalid_args',prior.error?.message??'The operation was refused.',prior.error?.status??400);if(prior.state!=='done')fail('indeterminate','Read the item before retrying this operation.',503);return mutationResult(tool,prior.result,itemRead);}
 }
 if(typeof args.key!=='string'||!/^[a-f0-9-]{36}$/.test(args.key))fail('invalid_args','A message identifier is required.',400);
 const record=(await itemRecord(k=>account.metadata.get(k),owner,args.key))?.record;
 if(!record||record.owner!==owner||record.collection!==id)fail('forbidden','This item does not belong to the selected collection.');
 if(tool==='item_read'){
  if(record.size>65536)fail('result_too_large','Download this item through the account interface.',413);
  const payload=await account.messageBytes(owner,args.key);
  const tagged=migrateTags(record);return {item:{id:record.id,mimeType:record.mimeType,size:record.size,tags:tagged.tags,classification:tagged.classification},dataBase64:btoa(String.fromCharCode(...payload.bytes))};
 }
 if(tool==='item_write'&&(!args.actions||Object.keys(args.actions).some(k=>!['tags','addTags','removeTags','classification','quarantined','read'].includes(k))))fail('invalid_args','Only message metadata can be changed.',400);
 // F4 (provisional, wargame 3): agents may quarantine but never release quarantine; release is an owner console action.
 if(tool==='item_write'&&args.actions.quarantined!==undefined&&args.actions.quarantined!==true)fail('forbidden','Only the account owner can release quarantine.',403);
 if(!['item_write','item_delete'].includes(tool))fail('unsupported_method','This function is unavailable.',400);
 // Every inbox mutation is charged once (F9); browser automation already charged its confirmed prepare.
 if(!workCharged)await account.admitWork(owner,{clientId:`mcp:${clientId}`});
 const createdAt=Date.now(),expiresAt=createdAt+MCP_JOURNAL_TTL_MS;
 await account.metadata.put(journal,{fingerprint,state:'reserved',createdAt,expiresAt});await account.metadata.put(expiryKey(expiresAt,journal),{journal,expiresAt});
 if(typeof account.scheduleAlarm==='function')await account.scheduleAlarm(expiresAt);
 let result;
 try{
  // MCP edits are owner-delegated but keep distinct provenance (docs/architecture/tags.md).
  if(tool==='item_write')result=await account.messages.update(owner,args.key,args.actions,{source:'mcp',clientId});
  else result=await account.deleteMessage(owner,args.key);
 }catch(error){
  // Deterministic refusals (validation, not found) cannot have taken effect: record them so a retry is not wedged.
  // Messaging faults are raised inside the aborted transaction; storage faults count only as definite 4xx refusals.
  const deterministic=error instanceof MessagingFault||error instanceof StorageError&&Number.isSafeInteger(error.status)&&error.status>=400&&error.status<500&&error.status!==429;
  if(deterministic)await account.metadata.put(journal,{fingerprint,state:'failed',error:{code:error.code,message:error.message,status:error.status??(error.code==='not_found'?404:400)},createdAt,expiresAt});
  throw error;
 }
 // Only the projection is journaled and returned (F3 review): never summaries, grant IDs, owner or sender metadata.
 await account.metadata.put(journal,{fingerprint,state:'done',result:journalResult(tool,result),createdAt,expiresAt});return mutationResult(tool,result,itemRead);
}
