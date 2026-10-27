import {siteEnabled,recordFlag} from './account/flags.mjs';
import {validateContent} from '../content/render.mjs';
import {APP_NOTIFICATIONS,ACTIVITY_CONTRACT,ACTIVITY_METHODS,notificationInput} from '../federation/app-notifications.mjs';
import {perform} from '../app/engine.mjs';
import {ACTIVITY_APP_OPERATIONS} from '../app/domains/activity.mjs';
import {StorageError} from '../storage/policy.mjs';
import {key,canonical,digest,base64url} from '../core/records.mjs';
import {initialTags,applyRules,escapeLegacyTag,isSystemTag,ownerRules} from '../core/tags.mjs';
// Admitted v1 app messages live in activity's own families (messaging extraction prep, 2026-10-26), never in the
// legacy peer `message/` store that the BB-CUT reset deletes. Placement (`collection`) and owner rules still run so the
// existing inbox, views, MCP and export keep seeing them; both are BB-CUT inventory items (messaging-extraction.md §2.8).
import {appMessageKey,appMessageUsageKey} from '../activity/app-messages.mjs';
const fail=(code='app_notifications_unavailable',message='App notifications are unavailable.',status=503,retryAfter)=>{const e=new StorageError(code,message,status);if(retryAfter)e.retryAfter=retryAfter;throw e;};
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const jwkFields=['kid','kty','crv','x','y','alg','use','key_ops','ext'];
function parsed(value){try{return typeof value==='string'?JSON.parse(value):value;}catch{fail();}}
function publicKey(value){
 if(!plain(value)||Object.keys(value).some(k=>!jwkFields.includes(k))||typeof value.kid!=='string'||!value.kid||value.kid.length>128||value.kty!=='EC'||value.crv!=='P-256'||value.alg!=='ES256'||value.use!==undefined&&value.use!=='sig'||![value.x,value.y].every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x))||value.key_ops!==undefined&&(!Array.isArray(value.key_ops)||value.key_ops.length!==1||value.key_ops[0]!=='verify')||value.ext!==undefined&&typeof value.ext!=='boolean')fail();
 return {...value,key_ops:['verify']};
}
export function publicNotificationKeys(value){const input=parsed(value);if(!plain(input)||Object.keys(input).some(k=>k!=='keys')||!Array.isArray(input.keys)||!input.keys.length||input.keys.length>8)fail();const keys=input.keys.map(publicKey);if(new Set(keys.map(k=>k.kid)).size!==keys.length)fail();return {keys};}
export const appNotificationPublicKeys=config=>publicNotificationKeys(config.APP_NOTIFICATION_PUBLIC_JWKS);
const signers=new WeakMap();
export async function appNotificationSigner(config){
 const source=JSON.stringify([config.APP_NOTIFICATION_SIGNING_JWK,config.APP_NOTIFICATION_PUBLIC_JWKS]);const prior=signers.get(config);if(prior?.source===source)return prior.promise;
 const promise=(async()=>{try{const privateKey=parsed(config.APP_NOTIFICATION_SIGNING_JWK);if(!plain(privateKey)||Object.keys(privateKey).some(k=>![...jwkFields,'d'].includes(k))||typeof privateKey.d!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(privateKey.d)||privateKey.key_ops!==undefined&&(!Array.isArray(privateKey.key_ops)||privateKey.key_ops.length!==1||privateKey.key_ops[0]!=='sign'))fail();const {d,key_ops,...pub}=privateKey;const expected=publicKey(pub),keys=appNotificationPublicKeys(config),published=keys.keys.find(k=>k.kid===expected.kid);if(!published||['kty','crv','x','y','alg'].some(k=>published[k]!==expected[k]))fail();const signing=await crypto.subtle.importKey('jwk',{...privateKey,key_ops:['sign']},{name:'ECDSA',namedCurve:'P-256'},false,['sign']),verifying=await crypto.subtle.importKey('jwk',published,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);const probe=new TextEncoder().encode('bindle-app-notification-key-check-v1'),proof=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signing,probe);if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},verifying,proof,probe))fail();return {kid:published.kid,sign:async payload=>base64url(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signing,new TextEncoder().encode(canonical(payload)))))};}catch{fail();}})();signers.set(config,{source,promise});return promise;
}
export async function appNotificationAllowed(tx,owner,message){
 if(!message.appNotification)return true;const p=message.appNotification,r=await tx.get('resource/'+p.connectionId);
 return r?.owner===owner&&r.kind==='app-connection'&&r.transport==='bindle'&&r.status==='active'&&r.clientId===p.clientId&&r.appOrigin===p.origin&&r.generation===p.connectionGeneration&&r.notifications?.enabled===true&&r.notifications.generation===p.notificationGeneration;
}
export async function appNotificationCheck(c,owner,connection,clientId){
 if(!connection||connection.notifications?.enabled!==true||!Number.isSafeInteger(connection.notifications?.generation))fail('forbidden','App messages need fresh consent.',403);
 await c.apps.check(owner,connection.id,connection.generation,clientId);
 const r=await c.metadata.get('resource/'+connection.id);if(!r?.notifications?.enabled||r.appOrigin!==connection.appOrigin||r.notifications.generation!==connection.notifications.generation)fail('forbidden','App messages are disabled or need fresh consent.',403);return true;
}
async function configuredContext(c,owner,context,{path='app-messages',contract=APP_NOTIFICATIONS,methods=['createOwn']}={}){
 if(context.authority!=='bindle'||context.resource!==`${c.config.APP_ORIGIN}/entities/${owner}/${path}`||context.resourceGeneration!==owner||context.contract!==contract||!methods.includes(context.method)||!context.epoch||!c.config.FEDERATION_IDENTITY_CHECK||await c.config.FEDERATION_IDENTITY_CHECK(owner,context.epoch)!==true)fail('forbidden','App message authority is unavailable.',403);
 const clients=parsed(c.config.FEDERATION_CLIENTS)||[];if(!Array.isArray(clients))fail();const client=clients.find(x=>x.id===context.clientId);if(!client||context.requestOrigin!==client.origin||context.app?.id!==client.id||context.app?.origin!==client.origin||context.app?.name!==client.name)fail('forbidden','Use the approved application origin.',403);
 await appNotificationCheck(c,owner,context.connection,context.clientId);return client;
}
async function budget(c,owner,connection,now){
 const path='app-notification-budget/'+connection.id;
 await c.metadata.transaction(async tx=>{let r=await tx.get(path);if(r&&(!plain(r)||r.owner!==owner||!Number.isSafeInteger(r.last)||r.last>now||!Number.isSafeInteger(r.minute)||!Number.isSafeInteger(r.day)||!Number.isSafeInteger(r.minuteCount)||!Number.isSafeInteger(r.dayCount)||r.minuteCount<1||r.dayCount<r.minuteCount||r.dayCount>100||r.minute!==Math.floor(r.last/60000)||r.day!==Math.floor(r.last/86400000)))fail();const minute=Math.floor(now/60000),day=Math.floor(now/86400000),minuteCount=r?.minute===minute?r.minuteCount:0,dayCount=r?.day===day?r.dayCount:0;if(minuteCount>=10||dayCount>=100)fail('rate_limited','This app has reached its message limit.',429,Math.ceil(((dayCount>=100?(day+1)*86400000:(minute+1)*60000)-now)/1000));await tx.put(path,{owner,last:now,minute,day,minuteCount:minuteCount+1,dayCount:dayCount+1});});
}
async function intake(tx,owner,input){
 const collection=(await tx.list(key('collection',owner))).find(r=>r.value.active)?.value.id;if(!collection)fail('forbidden','Message storage is unavailable.',403);
 // App-supplied tags never gain system meaning; `app-message` and `sys:automation` are host-structural facts.
 const now=Date.now(),deliveryTags=[...new Set(['app-message',...input.tags.map(escapeLegacyTag)])],message=initialTags({collection,deliveryCollection:collection,mimeType:input.mimeType,grantId:null,deliveryTags,quarantined:false},[...deliveryTags,'sys:automation'],{source:'app'},now);
 await applyRules(message,await ownerRules(tx,owner),{now,active:async id=>(await tx.get(key('collection',owner,id)))?.active});
 if(!message.tags.includes('app-message')){if(message.tags.filter(t=>!isSystemTag(t)).length>=32)fail('invalid_actions','The message rule must leave room for the app-message tag.',400);message.tags=['app-message',...message.tags];message.tagProvenance={...message.tagProvenance,'app-message':{source:'app',at:now}};}const {mimeType,grantId,...stored}=message;return stored;
}
// F5 (wargame 3): receipts are counted per connection, so one app at its permitted 100/day pace (at most ~300 live
// receipts across a 48-hour retention window) cannot fill a shared account cap. The account-wide bound still exists,
// but every connection keeps a reserved share below which the account bound never refuses it. A `reserved` receipt
// is a short lease: a crash before commit leaves it indeterminate only until the lease lapses, after which it no
// longer counts and the same transaction may retry. The commit re-checks the lease identity, so a lapsed in-flight
// attempt cannot commit beside its retry. The reserved share itself is bounded account-wide by `accountHard`, so
// many connections each under their reserve cannot grow the account without limit. The authoritative capacity check
// runs in the same metadata transaction as the reservation write, so concurrent sends cannot both pass a full cap.
export const APP_NOTIFICATION_RECEIPTS=Object.freeze({perConnection:320,account:1024,accountHard:4096,reservedPerConnection:32,retainMs:2*86400000,reservedLeaseMs:5*60000});
async function liveReceipts(store,prefix,limit,now){
 // Expired rows are deleted as they are seen; a full page that contained expired rows is re-listed so the live
 // count at the bound is exact rather than hidden behind stale rows.
 for(;;){const rows=await store.list({prefix,limit:limit+1});let count=0,expired=0;
  for(const [path,row]of rows){if(!Number.isSafeInteger(row?.expiresAt))fail();if(row.expiresAt<=now){await store.delete(path);expired++;}else count++;}
  if(!expired||rows.size<=limit)return count;}
}
async function receiptCapacity(store,connectionId,now){
 const L=APP_NOTIFICATION_RECEIPTS,own=await liveReceipts(store,`app-notification-receipt/${connectionId}/`,L.perConnection,now);
 if(own>=L.perConnection)fail('rate_limited','This app has too many retained message operations.',429,86400);
 if(await liveReceipts(store,'app-notification-receipt/',L.account,now)<L.account)return;
 if(own>=L.reservedPerConnection)fail('rate_limited','Retained app notification operations are full.',429,86400);
 if(await liveReceipts(store,'app-notification-receipt/',L.accountHard,now)>=L.accountHard)fail('rate_limited','Retained app notification operations are full.',429,86400);
}
export async function createAppNotification(c,owner,context){
 const now=Date.now(),input=notificationInput(context.args,context.tx,now);validateContent(input.mimeType,new TextEncoder().encode(input.body));await c.warm(owner);const client=await configuredContext(c,owner,context);const signer=await appNotificationSigner(c.config);
 const fingerprint=await digest(crypto,canonical({input,owner,clientId:client.id,origin:client.origin,connection:context.connection.id,generation:context.connection.generation,notificationGeneration:context.connection.notifications.generation})),receiptKey=`app-notification-receipt/${context.connection.id}/${input.transactionId}`;
 let prior=await c.metadata.get(receiptKey);if(prior&&(!Number.isSafeInteger(prior.expiresAt)||prior.expiresAt<=now)){if(!Number.isSafeInteger(prior.expiresAt))fail();await c.metadata.delete(receiptKey);prior=undefined;}
 if(prior){if(prior.fingerprint!==fingerprint)fail('tx_conflict','The transaction was already used for another message.',409);if(prior.state!=='done')fail('indeterminate','The previous notification outcome is unknown.',503,Math.max(1,Math.ceil((prior.expiresAt-now)/1000)));return prior.result;}
 await receiptCapacity(c.metadata,context.connection.id,now);
 await c.store.transaction(tx=>intake(tx,owner,input));
 const bytes=new TextEncoder().encode(input.body);await c.quota.check(owner,{bytes:bytes.length});await budget(c,owner,context.connection,now);await c.messageReceiptBudget.admit(owner,{source:'app-notification',bytes:bytes.length});await c.admitWork(owner,{clientId:client.id});
 const id=crypto.randomUUID(),result={id,accepted:true,receivedAt:now};
 // Authoritative capacity check and reservation write in one transaction (the earlier check only fails fast).
 await c.metadata.transaction(async tx=>{const held=await tx.get(receiptKey);if(held!==undefined&&held!==null){if(!Number.isSafeInteger(held.expiresAt))fail();if(held.expiresAt>now)fail('indeterminate','The previous notification outcome is unknown.',503,Math.max(1,Math.ceil((held.expiresAt-now)/1000)));await tx.delete(receiptKey);}
  await receiptCapacity(tx,context.connection.id,now);await tx.put(receiptKey,{fingerprint,state:'reserved',reservation:id,expiresAt:now+APP_NOTIFICATION_RECEIPTS.reservedLeaseMs});});
 let reservation;try{reservation=await c.quota.reserve(owner,{id,bytes:bytes.length,blobRef:`messages/${owner}/${id}`,kind:'message'});}catch(error){await c.metadata.transaction(async tx=>{if((await tx.get(receiptKey))?.reservation===id)await tx.delete(receiptKey);});throw error;}
 c.messageReservation=reservation;
 try{
  const provenance={version:1,purpose:'bindle-app-notification-admission-v1',issuer:c.config.APP_ORIGIN,owner,id,clientId:client.id,origin:client.origin,name:client.name,connectionId:context.connection.id,connectionGeneration:context.connection.generation,notificationGeneration:context.connection.notifications.generation,transactionId:input.transactionId,createdAt:input.createdAt,receivedAt:now,subject:input.subject,mimeType:input.mimeType,tags:input.tags,bodyDigest:await digest(crypto,bytes)};
  const attestation={alg:'ES256',kid:signer.kid,keysURL:c.config.APP_ORIGIN+'/.well-known/bindle/app-notification-keys.json',signature:await signer.sign(provenance)};
  await c.blobs.put(reservation.blobRef,bytes,{httpMetadata:{contentType:'application/octet-stream'},storageAdmission:{clientId:client.id}});
  await configuredContext(c,owner,context);
  await c.store.transaction(async tx=>{const held=await tx.get(receiptKey);if(held?.state!=='reserved'||held.reservation!==id||held.fingerprint!==fingerprint)fail('indeterminate','The notification reservation lapsed before commit.',503);if(!await appNotificationAllowed(tx,owner,{appNotification:provenance}))fail('forbidden','App messages were disabled.',403);const routed=await intake(tx,owner,input);
   const message={id,owner,...routed,mimeType:input.mimeType,size:bytes.length,bytes,receivedAt:now,readAt:null,grantId:null,senderMetadata:{subject:input.subject,tags:input.tags},appNotification:{...provenance,attestation}};
   const usage=await tx.get(appMessageUsageKey(owner))||{bytes:0,messages:0};if(!Number.isSafeInteger(usage.bytes)||!Number.isSafeInteger(usage.messages)||usage.bytes<0||usage.messages<0)fail();usage.bytes+=bytes.length;usage.messages++;await tx.set(appMessageUsageKey(owner),usage);await tx.set(appMessageKey(owner,id),message);await tx.set(receiptKey,{fingerprint,state:'done',result,expiresAt:now+APP_NOTIFICATION_RECEIPTS.retainMs});if(!message.quarantined)await tx.set(key('notification-event',owner,id),{id,owner,messageId:id,createdAt:now});
  });await c.scheduleAlarm(Date.now()+1000);return result;
 }finally{c.messageReservation=null;await c.quota.release(id);}
}
// ACT-1 activity methods (create | replace | retract) on the provisional activity contract. The same live federation,
// client, exact-origin and admission-consent checks as v1 run before any effect; the engine transaction re-checks the
// connection. The app actor and signer are built here from verified state only; content fields cannot name another
// app, account, sender or channel. Off unless ACTIVITY_V2_ENABLED, where the contract is unknown (not_found).
export async function activityResourceMethod(c,owner,context){
 if(!ACTIVITY_METHODS.includes(context.method))fail('unsupported_method','Unsupported activity method.',400);
 await c.warm(owner);const client=await configuredContext(c,owner,context,{path:'activity',contract:ACTIVITY_CONTRACT,methods:ACTIVITY_METHODS});
 recordFlag(c,owner,'ACTIVITY_V2_ENABLED','exposure',client.id);
 if(context.method!=='retractOwn'&&!siteEnabled(c.config,'ACTIVITY_V2_ENABLED',{subject:{kind:'account',owner},client:{clientId:client.id}},true))fail('not_found','Activity is unavailable.',404);
 if(typeof context.tx!=='string')fail('invalid_args','A stable operation identifier is required.',400);
 await c.admitWork(owner,{clientId:client.id});const keys=await appNotificationSigner(c.config);
 const actor={kind:'app',owner,issuer:c.config.APP_ORIGIN,app:{clientId:client.id,origin:client.origin,name:client.name},connection:{id:context.connection.id,generation:context.connection.generation,admissionGeneration:context.connection.notifications.generation}};
 return perform(c.engine,new ACTIVITY_APP_OPERATIONS[context.method]({actor,input:context.args,keys,operationId:context.tx.toLowerCase()}));
}
