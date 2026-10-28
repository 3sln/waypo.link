import {DurableObject} from 'cloudflare:workers';
import {parlayEnv} from '../env.mjs';
import {createMailbox,enabled} from './mailbox.mjs';
import {workerStore} from './storage.mjs';
import {createHTTP} from './http.mjs';
import {servicePorts} from './ports.mjs';
import {metadataPort} from './metadata.mjs';
import {createEdgeIndex,flushEdgeOutbox,linkClaims} from '../../../packages/messaging-engine/store/edge-index.mjs';
import {createConversationEdge,flushConversationEdge} from '../../../packages/messaging-engine/domains/conversations.mjs';
import {parseCredential,ProtocolFault,edgeKey} from '../../../packages/messaging-protocol/index.mjs';
import {MailboxFault,fault} from '../../../packages/messaging-engine/faults.mjs';
// One mailbox per authenticated owner; only this app's Worker/bindings can invoke its RPC methods.
export class MailboxObject extends DurableObject {
 constructor(ctx,env){super(ctx,env);env=this.env=parlayEnv(env);this.store=workerStore(ctx.storage);this.ready=enabled(env.PARLAY_ENABLED)?ctx.blockConcurrencyWhile(()=>this.store.recover()):Promise.resolve();}
 ports(){return servicePorts({services:this.env.PARLAY_SERVICES,egress:this.env.PARLAY_EGRESS,store:this.store,secret:this.env.PARLAY_KEY_ENCRYPTION_KEY,clientId:this.env.PARLAY_CLIENT_ID});}
 async mailbox(){await this.ready;return this.box??=createMailbox({store:this.store,ports:this.ports(),PARLAY_ENABLED:this.env.PARLAY_ENABLED});}
 async provision(owner,input){const box=await this.mailbox();await box.provision(owner,input);return {configured:true};}
 async invoke(owner,operation,params={}){
  try{const box=await this.mailbox();if(operation!=='shell.integration-event'&&!operation.startsWith('shell.removal-'))await box.open(owner);const value=await box.run(owner,operation,params);if(this.env.LINK_INDEX)await flushIndexes(this.store,this.env,owner);return value instanceof Response?{ok:true,response:{status:value.status,headers:[...value.headers],body:await value.text()}}:{ok:true,value};}
  catch(error){return {ok:false,error:{code:error?.code??'internal_error',status:error?.status??500}};}
 }
 async alarm(){if(!enabled(this.env.PARLAY_ENABLED))return;const result=await (await this.mailbox()).alarm(),owner=await this.store.get('owner');if(owner&&this.env.LINK_INDEX)await flushIndexes(this.store,this.env,owner);return result;}
}
// Separate SQLite index objects keep malformed/unknown capabilities away from per-user mailboxes. Keys are
// digests only, as in B2. The full admission transaction always checks the live parent again.
export class LinkIndexObject extends DurableObject {
 constructor(ctx,env){super(ctx,env);env=this.env=parlayEnv(env);this.index=createEdgeIndex(workerStore(ctx.storage));}
 async check(header){try{if(!enabled(this.env.PARLAY_ENABLED))fault('not_found','Messaging is disabled.',404);return {ok:true,value:await this.index.check(header)};}catch(error){return {ok:false,error:{code:error?.code??'internal_error',status:error?.status??500}};}}
 publish(entry){if(!enabled(this.env.PARLAY_ENABLED))fault('not_found','Messaging is disabled.',404);return this.ctx.storage.transaction(tx=>createEdgeIndex(tx).publish(entry));}
 async checkConversation(credential,envelope){try{if(!enabled(this.env.PARLAY_ENABLED))fault('not_found','Messaging is disabled.',404);return {ok:true,value:await createConversationEdge(this.store??workerStore(this.ctx.storage)).check(credential,envelope)};}catch(error){return {ok:false,error:{code:error?.code??'internal_error',status:error?.status??500}};}}
 async routeConversation(token){try{if(!enabled(this.env.PARLAY_ENABLED))fault('not_found','Messaging is disabled.',404);return {ok:true,value:await createConversationEdge(workerStore(this.ctx.storage)).route(token)};}catch(error){return {ok:false,error:{code:error?.code??'internal_error',status:error?.status??500}};}}
 publishConversation(entry){if(!enabled(this.env.PARLAY_ENABLED))fault('not_found','Messaging is disabled.',404);return this.ctx.storage.transaction(tx=>createConversationEdge(tx).publish(entry));}
 // Contacts spike phase 3: hosted-recipient and invitation entries (messaging §6.7 step 2, §7.4).
 async hosted(issuer,owner){try{if(!enabled(this.env.PARLAY_ENABLED))fault('not_found','Messaging is disabled.',404);return {ok:true,value:await this.index.hosted(issuer,owner)};}catch(error){return {ok:false,error:{code:error?.code??'internal_error',status:error?.status??500}};}}
 async checkInvite(token,claim){try{if(!enabled(this.env.PARLAY_ENABLED))fault('not_found','Messaging is disabled.',404);return {ok:true,value:await this.index.checkInvite(token,claim)};}catch(error){return {ok:false,error:{code:error?.code??'internal_error',status:error?.status??500}};}}
}
// Every key (link, invitation digest, hosted recipient, conversation) maps onto one of 64 fixed index objects by hash, so
// attacker-chosen junk keys never create more objects than that (contacts phase 3 review L4).
function indexStub(env,key){if(!env.LINK_INDEX)fault('recipient_unavailable','Ingress index unavailable.',503);let hash=2166136261;for(const c of key)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;return env.LINK_INDEX.get(env.LINK_INDEX.idFromName(`links-v1/${hash%64}`));}
function checked(result){if(!result.ok)throw new ProtocolFault(result.error.code,{status:result.error.status});return result.value;}
export function edgeIndex(env){
 const stub=(iss,jti)=>indexStub(env,JSON.stringify([iss,jti]));
 // Invitation entries shard by token digest, hosted-recipient entries by (issuer, owner); link entries by (iss, jti).
 const shard=entry=>entry.kind==='invite'?indexStub(env,'invite:'+entry.digest):entry.kind==='host'?indexStub(env,'host:'+JSON.stringify([entry.issuer,entry.subject])):stub(entry.iss,entry.jti);
 return {check:async header=>{const credential=parseCredential(header);if(credential.scheme!=='BindleLink')fault('not_authorized','Not authorized.',403);const {claims}=linkClaims(credential.value),result=await stub(claims.iss,claims.jti).check(header);if(!result.ok)throw new ProtocolFault(result.error.code,{status:result.error.status});return result.value;},
  hosted:async(issuer,owner)=>checked(await indexStub(env,'host:'+JSON.stringify([issuer,owner])).hosted(issuer,owner)),
  checkInvite:async(token,claim)=>checked(await indexStub(env,'invite:'+claim.invite).checkInvite(token,claim)),
  publish:entry=>shard(entry).publish(entry)};
}
export function conversationIndex(env){return {
 async check(credential,envelope){const p=envelope.payload,key=await edgeKey({conversationId:p.record.conversationId,author:{issuer:p.author.principal.issuer,subject:p.author.principal.subject},owner:{issuer:p.recipient.issuer,subject:p.recipient.owner}});return checked(await indexStub(env,'peer:'+key).checkConversation(credential,envelope));},
 async route(token){return checked(await indexStub(env,'route:'+token).routeConversation(token));},
 publish:entry=>indexStub(env,entry.kind==='route'?'route:'+entry.token:'peer:'+entry.key).publishConversation(entry)
};}
async function flushIndexes(store,env,owner){await flushEdgeOutbox(store,edgeIndex(env),owner);await flushConversationEdge(store,conversationIndex(env),owner);}
export default {fetch(request,env){env=parlayEnv(env);return createHTTP({PARLAY_ENABLED:env.PARLAY_ENABLED,INTENT_LINKS_ENABLED:env.INTENT_LINKS_ENABLED,APP_CLEAN_REMOVAL_ENABLED:env.APP_CLEAN_REMOVAL_ENABLED,services:env.PARLAY_SERVICES,assets:request=>env.ASSETS?.fetch(request)??new Response('Not found',{status:404}),edge:edgeIndex(env),conversationEdge:conversationIndex(env),metadata:metadataPort({clientId:env.PARLAY_CLIENT_ID,services:env.PARLAY_SERVICES,INTENT_LINKS_ENABLED:env.INTENT_LINKS_ENABLED,APP_CLEAN_REMOVAL_ENABLED:env.APP_CLEAN_REMOVAL_ENABLED}),authenticate:request=>{if(!env.PARLAY_SERVICES)fault('recipient_unavailable','Authentication unavailable.',503);return env.PARLAY_SERVICES.authenticate({authorization:request.headers.get('Authorization'),method:request.method,url:request.url});},mailbox:async owner=>{if(!env.MAILBOXES)fault('recipient_unavailable','Mailbox unavailable.',503);const stub=env.MAILBOXES.get(env.MAILBOXES.idFromName(owner));return {async run(owner,name,params){const result=await stub.invoke(owner,name,params);if(!result.ok)throw new MailboxFault(result.error.code,undefined,result.error.status);return result.response?new Response(result.response.body,{status:result.response.status,headers:result.response.headers}):result.value;}};}})(request);}};
