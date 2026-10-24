// Wargame Q1/Q2 (2026-10-23): the search outbox must not be poisoned by an item messaging accepts, and a full search
// queue must not block deletion.
// Q1: messaging allows 32 user tags plus registered system tags; search must accept the same set (and build its
//     document deterministically), and drain must acknowledge and tombstone an event that fails deterministic
//     validation, with an operator signal, instead of throwing forever at the head of the queue.
// Q2: tombstones are always admitted; a tombstone replaces any pending upsert for the same item.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {key} from '../packages/messaging/store.mjs';
import {SearchService,MemorySearchIndex,MetadataSearchOutbox,enqueueSearchEvent,messageSearchDocument,searchEventKey} from '../packages/search/index.mjs';
import {MAX_SEARCH_TAGS} from '../packages/search/schema.mjs';
import {MAX_USER_TAGS,SYSTEM_TAGS} from '../packages/messaging/tags.mjs';
import {FederationController,federationMetadata} from '../packages/federation/runtime.mjs';
import {federationControllerOptions,federationEpoch} from '../packages/runtime/federation.mjs';
import {APP_NOTIFICATIONS,APP_NOTIFICATION_PREFERENCES} from '../packages/federation/app-notifications.mjs';

const owner='12345678-1234-4234-8234-123456789abc',poisonId='00000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',otherId='ffffffff-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function controllerFor(metadata,bytes){
 const blobs={get:async()=>({size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(0)}),delete:async()=>{},put:async()=>{}};
 const logs=[];
 const controller=new AccountController({metadata,sql:metadata.sql,gate:new SerialGate(),blobs,archives:{get:async()=>null},config:{APP_ORIGIN:'https://app.example',LOCAL_DEVELOPMENT:'true',BILLING_ENABLED:'false',LIFECYCLE_LOG:event=>logs.push(event)}});
 return {controller,logs};
}
const message=id=>({id,owner,collection:'inbox',mimeType:'text/plain',receivedAt:Date.now(),readAt:null,size:27,tags:[],classification:'unclassified',quarantined:false,blobRef:'body',revision:1,tagModel:1});

test('search accepts exactly what messaging accepts: 32 user tags plus every registered system tag',()=>{
 assert.equal(MAX_SEARCH_TAGS,MAX_USER_TAGS+Object.keys(SYSTEM_TAGS).length);
 const bytes=new TextEncoder().encode('x'),tags=[...Array.from({length:40},(_,i)=>`u${i}`),...Object.keys(SYSTEM_TAGS),'u1','bad\u0000tag'];
 const doc=messageSearchDocument({...message(otherId),bytes,tags});
 assert.equal(doc.tags.filter(t=>!t.startsWith('sys:')).length,32,'user tags are truncated deterministically');
 assert.deepEqual(doc.tags.slice(0,32),Array.from({length:32},(_,i)=>`u${i}`));
 assert.equal(doc.tags.filter(t=>t.startsWith('sys:')).length,Object.keys(SYSTEM_TAGS).length);
});

test('a message with 32 user tags plus a system tag does not wedge the search outbox',async()=>{
 const metadata=new SqliteMetadata(':memory:'),bytes=new TextEncoder().encode('Violet project private text'),{controller}=controllerFor(metadata,bytes);
 try{
  await metadata.put('owner',owner);await metadata.put('lastOwnerActiveAt',Date.now());
  for(const id of [poisonId,otherId]){const m=message(id);await metadata.put(key('message',owner,id),m);controller.itemIndex.upsert(m);}
  const tags=Array.from({length:32},(_,i)=>`t${i}`);
  await controller.messages.update(owner,poisonId,{tags,classification:'work'});
  assert.equal((await controller.messages.read(owner,poisonId)).tags.length,33);
  await controller.messages.update(owner,otherId,{read:true});
  const result=await controller.searchDrain(owner,{limit:10});
  assert.equal(result.processed,2);assert.equal(result.rejected,undefined,'a messaging-valid item was rejected by search');
  assert.deepEqual(await controller.searchOutbox.peek(owner,10),[]);
  assert.equal((await controller.omniSearch(owner,{text:'violet',mode:'lexical'})).items.length,2);
 }finally{metadata.close();}
});

test('drain acknowledges, tombstones and reports a deterministically invalid document, then keeps going',async()=>{
 const metadata=new SqliteMetadata(':memory:'),index=new MemorySearchIndex(),rejected=[];
 try{
  const docs=new Map([['message:a',{tags:Array.from({length:MAX_SEARCH_TAGS+1},(_,i)=>`x${i}`)}],['message:b',{tags:[]}]]);
  const authority={get:async(o,id,{revision})=>({id,owner:o,type:'message',source:{kind:'message',id},revision,title:'',text:'kept text',createdAt:1,acl:{readers:[o]},...docs.get(id)})};
  const service=new SearchService({index,authority,outbox:new MetadataSearchOutbox(metadata),onRejected:async(event,error)=>rejected.push([event.id,error.code])});
  await metadata.transaction(async tx=>{for(const id of ['message:a','message:b'])await enqueueSearchEvent(tx,{owner,id,source:{kind:'message',id}});});
  const result=await service.drain(owner,{limit:10});
  assert.equal(result.processed,2);assert.equal(result.rejected,1);assert.deepEqual(rejected,[['message:a','invalid_search_tags']]);
  assert.equal(await metadata.get(searchEventKey(owner,'message:a')),undefined);
  assert.equal((await service.search(owner,{text:'kept',mode:'lexical'})).items.map(i=>i.id).join(),'message:b');
  // A transient failure still throws and leaves the event queued for retry.
  const failing=new SearchService({index,authority:{get:async()=>{throw Object.assign(new Error('down'),{code:'temporarily_unavailable'});}},outbox:new MetadataSearchOutbox(metadata)});
  await metadata.transaction(tx=>enqueueSearchEvent(tx,{owner,id:'message:c',source:{kind:'message',id:'c'}}));
  await assert.rejects(failing.drain(owner,{limit:10}),{code:'temporarily_unavailable'});
  assert.ok(await metadata.get(searchEventKey(owner,'message:c')));
 }finally{metadata.close();}
});

test('the account records an operator signal when drain rejects a document',async()=>{
 const metadata=new SqliteMetadata(':memory:'),bytes=new TextEncoder().encode('x'),{controller,logs}=controllerFor(metadata,bytes);
 try{
  await metadata.put('owner',owner);const m=message(otherId);await metadata.put(key('message',owner,otherId),m);
  await metadata.transaction(tx=>enqueueSearchEvent(tx,{owner,id:'message:'+otherId,source:{kind:'message',id:otherId},revision:1}));
  controller.searchDocument=async(o,id,{revision})=>({id,owner:o,type:'message',source:{kind:'message',id:otherId},revision,title:'x'.repeat(501),text:'',createdAt:1,acl:{readers:[o]}});
  const result=await controller.searchDrain(owner,{limit:10});
  assert.equal(result.rejected,1);
  assert.equal((await metadata.get('search/rejected'))?.last?.code,'invalid_search_content');
  assert.ok(logs.some(e=>e.kind==='search'&&e.action==='operator-alert'));
 }finally{metadata.close();}
});

test('a full search outbox does not block message deletion, and the tombstone replaces a pending upsert',async()=>{
 const metadata=new SqliteMetadata(':memory:'),bytes=new TextEncoder().encode('x'),{controller}=controllerFor(metadata,bytes);
 try{
  await metadata.put('owner',owner);
  const m={...message(otherId),size:1};await metadata.put(key('message',owner,otherId),m);await metadata.put(key('message-usage',owner),{bytes:1,messages:1});
  await metadata.transaction(async tx=>{for(let i=0;i<1000;i++)await enqueueSearchEvent(tx,{owner,id:`message:p${i}`,source:{kind:'message',id:`p${i}`}},{maxQueue:1000});});
  await assert.rejects(metadata.transaction(tx=>enqueueSearchEvent(tx,{owner,id:'message:new',source:{kind:'message',id:'new'}},{maxQueue:1000})),{code:'search_queue_full'},'upserts stay bounded');
  await controller.messages.delete(owner,otherId);
  assert.equal(await metadata.get(key('message',owner,otherId)),undefined);
  assert.equal((await metadata.get(searchEventKey(owner,'message:'+otherId)))?.operation,'tombstone');
  // A pending upsert is replaced by the tombstone without adding a queue row.
  const usage=async()=>(await metadata.get(key('search-queue-usage',owner))).count,before=await usage();
  await metadata.transaction(tx=>enqueueSearchEvent(tx,{owner,id:'message:p1',operation:'tombstone',source:{kind:'message',id:'p1'}},{maxQueue:1000}));
  assert.equal(await usage(),before);assert.equal((await metadata.get(searchEventKey(owner,'message:p1'))).operation,'tombstone');
 }finally{metadata.close();}
});

// Connected-app path: 31 app tags + `app-message` + `sys:automation` is valid for messaging (32 user tags).
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ISSUER='https://provider.example',ORIGIN='https://app.example';
const client={id:ORIGIN+'/client',origin:ORIGIN,name:'Calendar app',redirectUris:[ORIGIN+'/callback']};
const subject=ISSUER+'/entities/'+OWNER,resource=subject+'/app-messages';
const fragment={id:APP_NOTIFICATION_PREFERENCES,title:'App messages',description:'Allow app messages',publisher:'https://3sln.me',fields:{notifications:{type:'resource',title:'Messages',contracts:[APP_NOTIFICATIONS]}}};
async function signingKeys(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const kid=crypto.randomUUID();return {APP_NOTIFICATION_SIGNING_JWK:{...await crypto.subtle.exportKey('jwk',pair.privateKey),kid,alg:'ES256'},APP_NOTIFICATION_PUBLIC_JWKS:{keys:[{...await crypto.subtle.exportKey('jwk',pair.publicKey),kid,alg:'ES256'}]}};}
test('a connected app sending 31 tags does not wedge the owner search outbox',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'search-app-tags-'));const db=new SqliteMetadata(join(directory,'account.sqlite')),fedDB=new SqliteMetadata(join(directory,'federation.sqlite'));t.after(async()=>{db.close();fedDB.close();await rm(directory,{recursive:true,force:true});});
 const blobs=new Map(),bucket={put:async(path,bytes)=>{blobs.set(path,new Uint8Array(bytes));},get:async path=>blobs.has(path)?{size:blobs.get(path).byteLength,arrayBuffer:async()=>blobs.get(path).buffer}:null,delete:async path=>blobs.delete(path)};
 const identity={id:OWNER,status:'active',termsVersion:'2026-10-11',handle:'n.1',assignmentId:crypto.randomUUID(),recoveryHash:'recovery'},epoch=await federationEpoch(identity);
 const config={APP_ORIGIN:ISSUER,KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),FEDERATION_ENABLED:'true',FEDERATION_CLIENTS:[structuredClone(client)],FEDERATION_SCHEMAS:{[APP_NOTIFICATION_PREFERENCES]:fragment},FEDERATION_IDENTITY_CHECK:async(o,value)=>o===OWNER&&value===epoch&&identity.status==='active',...await signingKeys()};
 const account=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,config,sql:db.sql});await account.touch(OWNER);
 const controller=new FederationController({...federationControllerOptions({config,repository:{get:async id=>id===OWNER?identity:null},accounts:{get:()=>account},owner:OWNER}),metadata:federationMetadata(fedDB),auth:{owner:async()=>({subject,epoch})}});
 const ownerAuth={sessionToken:'session'},methods=['createOwn'];
 await controller.configure(ownerAuth,{fragment:APP_NOTIFICATION_PREFERENCES,values:{notifications:resource},expectedRevision:null});
 const verifier='v'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
 const request=await controller.beginAuthorization({clientId:client.id,redirectUri:client.redirectUris[0],challenge,challengeMethod:'S256',state:'state',requests:[{fragment:APP_NOTIFICATION_PREFERENCES,required:true,purpose:'Send me messages',fields:['notifications'],methods:{notifications:{[APP_NOTIFICATIONS]:methods}}}]});
 const view=await controller.inspect(ownerAuth,request.requestId);
 const callback=new URL((await controller.approve(ownerAuth,{requestId:request.requestId,approved:[{fragment:APP_NOTIFICATION_PREFERENCES,revision:view.requests[0].revision,fields:['notifications'],resources:{notifications:[resource]},methods:{notifications:{[APP_NOTIFICATIONS]:methods}}}]})).redirectUri);
 const session=await controller.exchange({clientId:client.id,redirectUri:client.redirectUris[0],code:callback.searchParams.get('code'),verifier});
 const ref=(await controller.rpc(session.access_token,{version:'0',tx:crypto.randomUUID(),resource:'@preferences',contract:'https://3sln.me/artefacts/contracts/preferences/v1',method:'read',args:{fragment:APP_NOTIFICATION_PREFERENCES}})).result.values.notifications;
 const send=(input={})=>{const transactionId=crypto.randomUUID();return controller.rpc(ref.token,{version:'0',tx:transactionId,resource:ref.id,contract:APP_NOTIFICATIONS,method:'createOwn',args:{transactionId,createdAt:Date.now(),subject:'Event reminder',body:'Meeting tomorrow',...input}},{requestOrigin:ORIGIN});};
 const response=await send({tags:Array.from({length:31},(_,i)=>`app${i}`)});assert.equal(response.error,undefined,JSON.stringify(response));
 const stored=[...(await db.list({prefix:'message/'})).values()][0];assert.equal(stored.tags.length,33);
 await send();
 const result=await account.searchDrain(OWNER,{limit:10});
 assert.equal(result.rejected,undefined);assert.deepEqual(await account.searchOutbox.peek(OWNER,10),[]);
});
