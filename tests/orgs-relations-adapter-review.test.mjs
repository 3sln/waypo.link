// ORG-10f review regression: dispatch scope must come from the same live grant value that authorizes the call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {relationsHost,ISS,STORE} from './helpers/relations-world.mjs';
import {K} from '../packages/orgs/relation-keys.mjs';

test('relation dispatch composes scope from a live grant value authorizing this method, ignoring other occurrences',async()=>{
 const h=await relationsHost({orgs:2}),[A,B]=h.list;
 try{
  const resource=await A.resource(`${ISS}/r/review/files`,{[STORE]:['get','put']});
  const {instance}=await h.relate(A,B,{give:{0:[{resource}]}});
  const cp=await A.cp(instance,B);
  const cert={instance,resource,methods:{[STORE]:['get']},scope:{maxObjectBytes:1000},actor:{client:'https://app.example/client'},client:{client_id:'https://app.example/client'},aep:0,iat:Math.floor(h.clock.now()/1000),exp:Math.floor(h.clock.now()/1000)+300};
  for(const irrelevant of [
   {resource,methods:{[STORE]:['put']},scope:{maxObjectBytes:1000}},
   {resource,methods:{[STORE]:['get']},scope:{maxObjectBytes:1000},expires_at:Math.floor(h.clock.now()/1000)-1},
  ]){
   cp.grant.entries[0].resources=[irrelevant,{resource,methods:{[STORE]:['get']},scope:{maxObjectBytes:10}}];
   await A.metadata.put(K.cp(instance,B.principal),cp);
   const result=await A.metadata.transaction(tx=>A.relations.authorizeCall(tx,{id:A.id},{c:cert,origin:B.principal,presented:B.principal,env:{resource,contract:STORE,method:'get',args:{key:'a'},tx:crypto.randomUUID()},write:false,now:h.clock.now(),me:A.principal}));
   assert.equal(result.ok,true);
   assert.deepEqual(result.context.assignedScope,{maxObjectBytes:10},'storage receives the authorizing get value’s byte limit');
  }
 }finally{await h.close();}
});
