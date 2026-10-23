import {MailboxAction,MailboxQuery,ownerOf,operations} from '../../../packages/bindlebox-engine/engine.mjs';
import {base64url} from '../../../packages/bindlebox-protocol/index.mjs';
import {fault} from '../../../packages/bindlebox-engine/faults.mjs';
// Trusted verifyRemoval service applies the protocol JWS, issuer declaration, relationship and replay checks.
// These engine operations independently bind its claims to the ordinary authenticated app session and live grant.
const denied=()=>fault('not_authorized','Removal could not be verified.',403);
export class PrepareMailboxRemoval extends MailboxAction {
 static operation='shell.removal-prepare';static deps=['mailboxStore','clock'];
 run({mailboxStore:store,clock}){return store.transaction(async tx=>{
  const owner=ownerOf(this.actor),claims=this.input?.claims,config=await tx.get('config'),grant=await tx.get('shell:authorization'),b=claims?.bindle;
  if(await tx.get('owner')!==owner||claims?.iss!==config?.principal?.issuer||claims?.sub!==config?.principal?.subject||!grant?.active||!b||b.actor||b.connection!==grant.connection||b.generation!==grant.generation||claims.exp*1000<=clock.now()||typeof claims.jti!=='string'||typeof b.removal!=='string')denied();
  let uri;try{uri=new URL(b.return_uri);if(uri.protocol!=='https:'||uri.origin!==claims.iss||uri.username||uri.password||uri.hash||uri.search)denied();}catch{denied();}
  // A freshly verified reissue replaces the nonce for the same open removal; in-flight completions fence on it.
  const saved={jti:claims.jti,removal:b.removal,returnUri:uri.href,generation:grant.generation,connection:grant.connection};await tx.put('shell:removal',saved);return {ready:true};
 });}
}
export class MailboxRemovalOptions extends MailboxQuery {
 static operation='shell.removal-options';static deps=['mailboxCleanup'];
 fetch({mailboxCleanup:cleanup}){return {delete:typeof cleanup?.deleteArchive==='function',export:typeof cleanup?.exportArchive==='function'};}
}
export class CompleteMailboxRemoval extends MailboxAction {
 static operation='shell.removal-complete';static deps=['mailboxStore','mailboxCleanup'];
 async run({mailboxStore:store,mailboxCleanup:cleanup}){
  const owner=ownerOf(this.actor),choice=this.input?.choice;if(!['keep','delete','export'].includes(choice))fault('invalid_input','Choose an archive option.',400);
  const check=async tx=>{const r=await tx.get('shell:removal'),grant=await tx.get('shell:authorization');if(await tx.get('owner')!==owner||!r||!grant?.active||grant.generation!==r.generation||grant.connection!==r.connection)denied();return r;},pending=await store.transaction(check);
  // These ports use the app's existing live grants; failures leave removal pending and hot state intact.
  let download;if(choice!=='keep'){const fn=choice==='delete'?cleanup?.deleteArchive:cleanup?.exportArchive;if(typeof fn!=='function')fault('recipient_unavailable','Archive operation unavailable.',503);download=await fn({owner,prefix:'bindlebox/v1/'});if(choice==='export'&&(typeof download?.data!=='string'||typeof download?.filename!=='string'))fault('recipient_unavailable','Export unavailable.',503);}
  await store.transaction(async tx=>{const r=await check(tx);if(r.jti!==pending.jti)denied();if(typeof tx.deleteAll==='function')await tx.deleteAll();else for(const [key]of await tx.list({prefix:''}))await tx.delete(key);});
  const uri=new URL(pending.returnUri);uri.searchParams.set('removal',pending.removal);uri.searchParams.set('outcome','completed');uri.searchParams.set('result',base64url(new TextEncoder().encode(JSON.stringify({v:1,items:[{label:'Archive',disposition:choice==='delete'?'deleted':'kept',location:'owner-storage'},{label:'Local mailbox and pending sends',disposition:'deleted',location:'app'}],message:choice==='delete'?"Parley's files deleted from your storage.":choice==='export'?'Export prepared; archive kept in your storage.':'Archive kept in your storage.'}))));
  return {returnUri:uri.href,...choice==='export'?{download}:{}};
 }
}
export const REMOVAL_OPERATIONS=operations(PrepareMailboxRemoval,MailboxRemovalOptions,CompleteMailboxRemoval);
