// U404: real account engine and SQLite lifecycle fence; only the HTTP serializer conceals the fault.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {FENCE_KEY} from '../packages/runtime/account-deletion.mjs';
import {TOMBSTONE_KEY} from '../packages/runtime/lifecycle-storage.mjs';
import {linkService} from '../packages/runtime/account/links.mjs';
import {MESSAGING_CONTACT_LINK_TYPE} from '../packages/links/types.mjs';
import {fixture,origin,ids,snapshot} from './helpers/public-unknown.mjs';
import {createTestEngine} from './helpers/app-engine.mjs';
import {PublicIdentityAvailable} from '../packages/app/domains/public-identity.mjs';
import {forEachSeed,createScheduler} from './helpers/chaos.mjs';
const owner=ids['missing-resource'],bucket={get:async()=>null,put:async()=>({}),delete:async()=>{}};
async function account(t){
 const db=new SqliteMetadata(':memory:'),controller=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,sql:db.sql,config:{APP_ORIGIN:origin,KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),IDENTITY_ACCOUNT:async id=>({id,status:'active',handle:'person'})}});
 t.after(async()=>{await controller.engine.dispose();db.close();});await controller.warm(owner);return {db,controller};
}
test('U404 engine: a contact-profile lookup fenced mid-call conceals 410; owner operations retain it',async t=>{
 const {db,controller}=await account(t),link=await linkService(controller).issue(owner,{type:MESSAGING_CONTACT_LINK_TYPE,claims:{resource:'contact',kinds:['one-off'],mimeTypes:['text/plain'],maxMessages:5,maxBytes:5000,maxMessageBytes:1000},expiresAt:Date.now()+3600000,handle:'person'});
 const calls=[],h=fixture('missing-resource',{invoke:async(id,call)=>{calls.push(call.method);await db.put(FENCE_KEY,{owner,committedAt:Date.now()});return controller.invoke(call);}});
 h.env.IDENTITY_REPOSITORY={get:async id=>({id,status:'active',handle:'person'})};
 const response=await snapshot(await h.fetch(new Request(link.link,{headers:{Accept:'application/vnd.bindle.contact-profile+json'}})));assert.equal(response.status,404);assert.equal(response.body,'{"error":"not_found"}');assert.deepEqual(calls,['contactProfile']);
 for(const [marker,code]of [[FENCE_KEY,'account_deleting'],[TOMBSTONE_KEY,'account_deleted']]){await db.put(marker,{owner});const result=await controller.invoke({method:'dispatch',args:[owner,{operation:'views.list'}]});assert.equal(result.$fault.status,410);assert.equal(result.$fault.code,code);}
});
test('U404 seeded engine schedules: a lookup racing the deletion fence never leaks lifecycle faults or Retry-After',async t=>{
 await forEachSeed(12,async random=>{
  const {db,controller}=await account(t),scheduler=createScheduler(random),ports=scheduler.wrap({lookup:call=>controller.invoke(call),fence:()=>db.put(FENCE_KEY,{owner})},'account'),h=fixture('missing-resource',{invoke:(_,call)=>ports.lookup(call)});
  const aud=`${origin}/users/person/contact/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee`,part=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),link=`${aud}?bindle_meta=${part({alg:'ES256',kid:'k',typ:'bindle-link-meta+jwt'})}.${part({bindle:'link-meta',v:1,type:MESSAGING_CONTACT_LINK_TYPE,iss:origin,aud,jti:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',iat:1,exp:2147483647,sub:owner})}.c2ln`;
  h.env.IDENTITY_REPOSITORY={get:async id=>({id,status:'active',handle:'person'})};
  const results=await scheduler.run([()=>h.fetch(new Request(link,{headers:{Accept:'application/vnd.bindle.contact-profile+json'}})).then(snapshot),()=>ports.fence()]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[0].value.status,404);assert.equal(results[0].value.body,'{"error":"not_found"}');assert(!results[0].value.headers.some(([name])=>name==='retry-after'));
 });
});

test('U404 engine: authorization admission checks the account fence; owner HTTP retains its lifecycle fault',async t=>{
 const {db,controller}=await account(t),repository={findByHandle:async()=>({id:owner,status:'active'})},accounts={get:()=>controller},edge=await createTestEngine({providers:{identityShards:repository,accounts}});t.after(()=>edge.dispose());
 const query=()=>edge.engine.query(new PublicIdentityAvailable({input:{handle:'person'}})).peek();assert.deepEqual(await query(),{available:true});
 await db.put(FENCE_KEY,{owner});await assert.rejects(query(),{code:'account_deleting',status:410});
 const h=fixture('deleting',{invoke:(_,call)=>controller.invoke(call)});h.env.IDENTITY_ENGINE=()=>({query:()=>({peek:async()=>({account:{id:owner},csrfToken:'fixture'})}),dispose(){}});
 const response=await h.fetch(new Request(origin+'/api/views'));assert.equal(response.status,410);assert.equal((await response.json()).error,'account_deleting');
});

test('U404 admission Query: malformed and inactive identities never wake an account; malformed RPC replies fail closed',async t=>{
 const looked=[],woken=[],rows=new Map(),state={reply:{available:true}},edge=await createTestEngine({providers:{identityShards:{findByHandle:async handle=>{looked.push(handle);return rows.get(handle);}},accounts:{get:id=>{woken.push(id);return {invoke:async()=>state.reply};}}}});t.after(()=>edge.dispose());
 const query=handle=>edge.engine.query(new PublicIdentityAvailable({input:{handle}})).peek();
 for(const handle of [undefined,'bad/handle','person'])await assert.rejects(query(handle),{code:'not_found',status:404});assert.deepEqual(woken,[]);assert.deepEqual(looked,['person']);
 for(const status of ['deleting','deleted','suspended','moved']){rows.set('person',{id:owner,status});await assert.rejects(query('person'),{code:'not_found',status:404});}assert.deepEqual(woken,[]);
 rows.set('person',{id:owner,status:'active'});state.reply=null;await assert.rejects(query('person'),{code:'temporarily_unavailable',status:503});assert.deepEqual(woken,[owner]);
});
