// DX-1 export ports composed by the Worker and Node adapters (account-deletion-export.md §1.1, §1.4).
// Every projection here hands DX-1's contributors records that its own redaction (export-contributors.mjs) filters
// again: tokens, JTIs, hashes and credentials are never copied in the first place.
import {isUUID} from '../core/primitives.mjs';

const NOTIFIED=new Set(['export-created','export-downloaded','export-grant-created']);
const accepted=result=>typeof result?.messageId==='string'&&result.messageId.length>0;
/** The idempotent security-event port: one owner audit entry per operationId (the security log the export itself
 * contains), then a best-effort mail alert for creation and first downloads. A failing audit write throws, so DX-1
 * retries; mail never blocks the export. Push to the owner's devices is added inside the account object. */
export function exportNoticePort({repository,mailer,clock=()=>Date.now()}){
 if(typeof repository?.get!=='function'||typeof repository.compareAndSwap!=='function')throw new TypeError('An identity repository is required.');
 return async function notice({type,owner,jobId,operationId}){
  if(!isUUID(owner)||typeof type!=='string'||!/^export-[a-z-]{1,32}$/.test(type)||typeof operationId!=='string'||operationId.length>300)throw new TypeError('Invalid export notice.');
  let account;
  for(let attempt=0;;attempt++){
   account=await repository.get(owner);if(!account||account.status==='deleted')throw Object.assign(new Error('Account unavailable.'),{code:'export_unavailable',status:503});
   if((account.audit??[]).some(entry=>entry?.ref===operationId))break;
   const next={...account,audit:[...(account.audit??[]).slice(-99),{id:crypto.randomUUID(),type,at:clock(),ref:operationId,...isUUID(jobId)?{jobId}:{}}],revision:account.revision+1};
   if(await repository.compareAndSwap(owner,account.revision,next))break;
   if(attempt>=3)throw Object.assign(new Error('The security log is busy.'),{code:'export_unavailable',status:503});
  }
  let mailed=false;
  if(NOTIFIED.has(type)&&typeof account.verifiedEmail==='string'&&Number.isSafeInteger(account.emailVerifiedAt)&&typeof mailer?.sendSecurityAlert==='function')try{mailed=accepted(await mailer.sendSecurityAlert({email:account.verifiedEmail,type:type==='export-grant-created'?'export-created':type,owner}));}catch{mailed=false;}
  return {recorded:true,mailed};
 };
}
/** Federation grants of the owner's shard, as DX-1 grant rows (no tokens, families or JTIs). */
export function federationGrantRows(rows){return rows.filter(row=>row&&typeof row.clientId==='string').map(row=>({id:row.id,client:row.clientId,clientId:row.clientId,fragments:row.fragment?[row.fragment]:[],fields:row.fields??[],resources:row.resources??[],methods:row.methods??{},created:row.createdAt??row.approvedAt??null,expires:row.expiresAt??null,state:row.active?'active':'revoked'}));}
/** MCP grants (approved collections and tools), as DX-1 grant rows. */
export function mcpGrantRows(rows){return rows.filter(row=>row&&typeof row.clientId==='string').map(row=>({id:row.id,client:row.clientId,clientId:row.clientId,label:row.clientName,resources:(row.permissions??[]).map(p=>({collectionId:p.collectionId,tools:p.tools})),created:row.approvedAt??null,expires:row.expiresAt??null,state:row.active?'active':'revoked',kind:'mcp'}));}
/** One bounded page: an owner's federation and MCP grants are each capped by their stores. */
export function exportGrantsPort({federation,mcp}){
 return Object.freeze({async page({owner,cursor}){if(cursor)return {rows:[],done:true,cursor:null};const rows=[...federationGrantRows(federation?await federation(owner):[]),...mcpGrantRows(mcp?await mcp(owner):[])];return {rows,done:true,cursor:null};}});
}
