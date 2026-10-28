// Developer contact through the developer account's messaging-ingress occupant (messaging extraction prep, 2026-10-26).
// GET /api/developer-contact hands out the developer-policy link that the occupant issued through the links contract, and
// the console hands it to the sender's own messaging app as a `send-message` intent. Since 2026-10-27 this is the only
// route: the legacy core grant and the DEVELOPER_CONTACT_MODE switch left the core with messaging.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {developerContactLink,developerContactRoutes,DEVELOPER_CONTACT_POLICY} from '../packages/runtime/developer-contact.mjs';
import {DEVELOPER_OCCUPANT_POINTER} from '../packages/runtime/account/links.mjs';
import {MESSAGING_CONTACT_LINK_TYPE,MESSAGING_INGRESS_SLOT} from '../packages/links/types.mjs';
import {key} from '../packages/core/records.mjs';

const origin='https://developer.example',BOX='https://box.example/client';
const claims={resource:'developer-inbox',kinds:['one-off'],mimeTypes:['text/plain'],maxMessages:5,maxBytes:65536,maxMessageBytes:16384};
async function world({mode='occupant'}={}){
 const accounts=new Map(),directory=new Map(),closers=[],seat={value:{clientId:BOX,generation:1,connection:'cnx-1'}};
 const make=async(handle,extra={})=>{const id=crypto.randomUUID(),metadata=new SqliteMetadata(':memory:'),stored=new Map(),bucket={put:async(k,b)=>{stored.set(k,new Uint8Array(b));},get:async k=>stored.has(k)?{size:stored.get(k).byteLength,arrayBuffer:async()=>stored.get(k).buffer.slice(0)}:null,delete:async k=>{stored.delete(k);}};closers.push(()=>metadata.close());
  const controller=new AccountController({metadata,gate:new SerialGate(),blobs:bucket,archives:bucket,config:{APP_ORIGIN:origin,KEY_ENCRYPTION_KEY:Buffer.alloc(32,12).toString('base64'),WORK_LIMITS_ENABLED:'false',STORAGE_WRITE_ENABLED:'false',CONVERSATION_ACCOUNT:o=>accounts.get(o),IDENTITY_ACCOUNT:async o=>directory.get(o)??null,DEVELOPER_CONTACT_POPULATION:{policy:async()=>({mode:'all-active',observedAt:Date.now(),validUntil:Date.now()+30000})},...extra}});
  await controller.warm(id);await controller.signingKey(id);controller.developerContactTier=async()=>'free';accounts.set(id,controller);directory.set(id,{status:'active',handle});return {id,handle,controller};};
 const developer=await make('n.dev',{LINKS_ENABLED:'true',LINK_SLOT_OCCUPANT:async({slot})=>slot===MESSAGING_INGRESS_SLOT?seat.value:null,...mode?{DEVELOPER_CONTACT_MODE:mode}:{}});
 const actor={kind:'app',owner:developer.id,clientId:BOX,handle:developer.handle,generation:1,connection:'cnx-1'};
 const issue=(input={})=>developer.controller.linkOperation(developer.id,{actor,operation:'links.issue',input:{type:MESSAGING_CONTACT_LINK_TYPE,claims,expiresAt:Date.now()+30*86400000,audience:{policy:DEVELOPER_CONTACT_POLICY},...input}});
 const assignmentId=crypto.randomUUID(),recipient={id:developer.id,handle:developer.handle,assignmentId,status:'active',systemIdentity:{version:1,handle:'ray',role:'developer',assignmentId,bootstrapId:crypto.randomUUID(),claimDigest:'a'.repeat(64)}};
 const env={APP_ORIGIN:origin,DEVELOPER_CONTACT_HANDLE:'ray',IDENTITY_REPOSITORY:{findByHandle:async handle=>handle==='ray'?recipient:null}},accountHandle=(e,id)=>new Proxy({},{get:(_,method)=>async(...args)=>{const result=await accounts.get(id).invoke({method,args});if(result?.$fault)throw Object.assign(Error(result.$fault.message),result.$fault);return result;}});
 const route=caller=>developerContactRoutes({path:'/api/developer-contact',request:{method:'GET'},env,owner:{account:{id:caller.id}},accountHandle,json:(value,status=200)=>({status,value})});
 return {accounts,directory,seat,make,developer,actor,issue,route,close:()=>closers.forEach(close=>close())};
}

test('occupant mode: the occupant-issued developer link is recorded sealed, verified live and handed out; other links are ignored',async()=>{const w=await world();try{const d=w.developer;
 assert.deepEqual(await developerContactLink(d.controller,d.id,d.handle),{available:false,reason:'contact-unavailable'},'nothing until the occupant issues a developer link');
 await w.issue({audience:undefined});assert.equal(await d.controller.metadata.get(DEVELOPER_OCCUPANT_POINTER),undefined,'a link without the developer policy is not the developer link');
 const issued=await w.issue(),pointer=await d.controller.metadata.get(DEVELOPER_OCCUPANT_POINTER);
 assert.equal(pointer.jti,issued.jti);assert.equal(pointer.clientId,BOX);assert.equal(JSON.stringify(pointer).includes('bindle_meta'),false,'the capability URL is sealed at rest');
 const link=await developerContactLink(d.controller,d.id,d.handle);assert.deepEqual(link,{available:true,mode:'occupant',jti:issued.jti,url:issued.link,expiresAt:link.expiresAt,policy:DEVELOPER_CONTACT_POLICY});
 // No legacy contact grant is minted in occupant mode.
 assert.equal((await d.controller.metadata.list({prefix:'contact-grant/'})).size,0);assert.equal(await d.controller.metadata.get('developer-contact/v2'),undefined);
 // Rotation re-signs the meta: the pointer follows the new URL and the old one stops verifying.
 const rotated=await d.controller.linkOperation(d.id,{actor:w.actor,operation:'links.rotate',id:issued.jti});assert.notEqual(rotated.link,issued.link);
 assert.equal((await developerContactLink(d.controller,d.id,d.handle)).url,rotated.link);
 // A different occupant now holds the slot: the previous occupant's link is not handed out.
 w.seat.value={clientId:'https://other.example/client',generation:1,connection:'cnx-2'};assert.deepEqual(await developerContactLink(d.controller,d.id,d.handle),{available:false,reason:'occupant-changed'});
 w.seat.value={clientId:BOX,generation:1,connection:'cnx-1'};
 // Revocation by the owner ends it; nothing is silently re-created.
 await d.controller.revokeLink(d.id,issued.jti);assert.deepEqual(await developerContactLink(d.controller,d.id,d.handle),{available:false,reason:'contact-unavailable'});
}finally{w.close();}});

test('occupant route: eligibility under the developer policy and a send-message intent; no legacy route remains',async()=>{const w=await world();try{const s=await w.make('n.abc');
 assert.deepEqual((await w.route(s)).value,{available:false,reason:'contact-unavailable'});
 const issued=await w.issue(),result=(await w.route(s)).value;
 assert.deepEqual(result,{available:true,mode:'occupant',intent:'send-message',url:issued.link,expiresAt:result.expiresAt,policy:DEVELOPER_CONTACT_POLICY,recipientBadge:result.recipientBadge,eligibility:{state:'eligible',tier:'free'}});assert.equal(result.recipientBadge.role,'developer');
 // The decision is the bounded links §7.5 record for this link and principal.
 const decisions=await w.developer.controller.metadata.list({prefix:`link-audience/${issued.jti}/`});assert.equal(decisions.size,1);
 assert.deepEqual(await w.developer.controller.developerLinkDecide(w.developer.id,crypto.randomUUID(),{issuer:origin,subject:s.id}),{state:'unavailable'});
}finally{w.close();}
 // Without the mode switch (removed with core messaging) the occupant route is still the only route: no core grant.
 const plain=await world({mode:null});try{const s=await plain.make('n.abd');
  assert.deepEqual((await plain.route(s)).value,{available:false,reason:'contact-unavailable'});
  assert.equal((await plain.developer.controller.metadata.list({prefix:'contact-grant/'})).size,0);
  const issued=await plain.issue();assert.equal((await plain.route(s)).value.url,issued.link);
 }finally{plain.close();}
});

test('occupant mode fails closed when links are off for the account or the sealed pointer cannot be opened',async()=>{const w=await world();try{const d=w.developer;
 await w.issue();assert.equal((await developerContactLink(d.controller,d.id,d.handle)).available,true);
 const pointer=await d.controller.metadata.get(DEVELOPER_OCCUPANT_POINTER);await d.controller.metadata.put(DEVELOPER_OCCUPANT_POINTER,{...pointer,sealed:{...pointer.sealed,ciphertext:pointer.sealed.ciphertext.slice(4)+'AAAA'}});
 assert.deepEqual(await developerContactLink(d.controller,d.id,d.handle),{available:false,reason:'contact-unavailable'});
 await d.controller.metadata.put(DEVELOPER_OCCUPANT_POINTER,pointer);d.controller.config.LINKS_ENABLED='false';
 assert.deepEqual(await developerContactLink(d.controller,d.id,d.handle),{available:false,reason:'contact-unavailable'});
 assert.equal((await d.controller.metadata.get(key('link',pointer.jti))).revoked,false,'turning links off never revokes the link');
}finally{w.close();}});

test('developer contact is off without DEVELOPER_CONTACT_HANDLE: no built-in handle, no lookup, no cron census',async()=>{
 const {default:http}=await import('../packages/runtime/http.mjs');
 for(const handle of [undefined,'','  ']){
  const lookups=[],census=[],waits=[],env={APP_ORIGIN:origin,...handle===undefined?{}:{DEVELOPER_CONTACT_HANDLE:handle},IDENTITY_REPOSITORY:{findByHandle:async h=>{lookups.push(h);return null;}},DEVELOPER_CONTACT_POPULATION:{censusStep:async()=>{census.push(1);}}};
  const result=await developerContactRoutes({path:'/api/developer-contact',request:{method:'GET'},env,owner:{account:{id:crypto.randomUUID()}},accountHandle:()=>{throw Error('unreachable');},json:(value,status=200)=>({status,value})});
  assert.deepEqual(result,{status:200,value:{available:false,reason:'developer-unavailable'}});assert.deepEqual(lookups,[]);
  await http.scheduled({},env,{waitUntil:p=>waits.push(p)});await Promise.all(waits);assert.deepEqual(census,[]);
 }
 // Configured: the route looks up exactly that handle (never 'ray' by default) and the cron runs a census step.
 const lookups=[],census=[],waits=[],env={APP_ORIGIN:origin,DEVELOPER_CONTACT_HANDLE:'n.someone',IDENTITY_REPOSITORY:{findByHandle:async h=>{lookups.push(h);return null;}},DEVELOPER_CONTACT_POPULATION:{censusStep:async()=>{census.push(1);}}};
 const result=await developerContactRoutes({path:'/api/developer-contact',request:{method:'GET'},env,owner:{account:{id:crypto.randomUUID()}},accountHandle:()=>{throw Error('unreachable');},json:(value,status=200)=>({status,value})});
 assert.deepEqual(result.value,{available:false,reason:'developer-unavailable'});assert.deepEqual(lookups,['n.someone']);
 await http.scheduled({},env,{waitUntil:p=>waits.push(p)});await Promise.all(waits);assert.deepEqual(census,[1]);
});
