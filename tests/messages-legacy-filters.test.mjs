import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {key} from '../packages/core/records.mjs';

// DEVLOG 2026-10-23 review follow-ups: the SQL-indexed legacy array and the scan fallback (custom stores
// without SQL) must agree on filter normalization, and wrong-typed filters keep the legacy empty-array answer.
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bucket={get:async()=>null,delete:async()=>{}};
async function controller(indexed){
 const db=new SqliteMetadata(':memory:');
 const c=new AccountController({metadata:db,...indexed?{sql:db.sql}:{},gate:new SerialGate(),blobs:bucket,archives:bucket,config:{APP_ORIGIN:'https://provider.example',WORK_LIMITS_ENABLED:'false',STORAGE_WRITE_ENABLED:'false'}});
 await c.warm(owner);const collection=(await c.collections(owner))[0].id;
 const base={owner,collection,mimeType:'text/plain',size:1,tags:[]};
 const rows=[
  {...base,id:'00000001',receivedAt:5,readAt:null,quarantined:false},
  {...base,id:'00000002',receivedAt:4,readAt:7,quarantined:true},
  {...base,id:'00000003',receivedAt:3},// legacy shape: neither readAt nor quarantined stored
  {...base,id:'00000004',receivedAt:2,readAt:9},
 ];
 await c.store.transaction(async tx=>{for(const row of rows)await tx.set(key('app-message',owner,row.id),row);});
 return {c,db,collection};
}
for(const indexed of [true,false])test(`legacy filters normalize missing fields and keep [] for wrong types (${indexed?'SQL index':'scan fallback'})`,async()=>{
 const {c,db,collection}=await controller(indexed);
 try{
  if(indexed)assert.equal(await db.get('item-index-ready'),true);else assert.equal(c.itemIndex,null);
  const ids=async filter=>(await c.items.list(owner,filter)).map(m=>m.id);
  assert.deepEqual(await ids({}),['00000001','00000002','00000003','00000004']);
  // A missing readAt is unread, exactly like readAt:null.
  assert.deepEqual(await ids({unread:true}),['00000001','00000003']);
  assert.deepEqual(await ids({unread:false}),['00000002','00000004']);
  // A missing quarantined flag is not quarantined.
  assert.deepEqual(await ids({quarantined:false}),['00000001','00000003','00000004']);
  assert.deepEqual(await ids({quarantined:true}),['00000002']);
  assert.deepEqual(await ids({collection,unread:true,quarantined:false}),['00000001','00000003']);
  // Wrong-typed filters match nothing; they never fault the legacy array.
  for(const filter of [{unread:'true'},{unread:1},{quarantined:'false'},{collection:7},{collection:'x'.repeat(201)},{collection,unread:null}])assert.deepEqual(await c.items.list(owner,filter),[],JSON.stringify(filter).slice(0,60));
  // The legacy array has no cursor contract: a stray cursor is ignored rather than decoded.
  assert.deepEqual(await ids({cursor:'not-a-cursor'}),['00000001','00000002','00000003','00000004']);
  await assert.rejects(c.items.list(owner,{limit:0}),{code:'invalid_limit'});
 }finally{await c.engine.dispose();db.close();}
});
test('the v2 message page keeps rejecting wrong-typed filters',async()=>{
 const {c,db}=await controller(true);
 try{for(const filter of [{unread:'true'},{quarantined:1},{collection:7}])await assert.rejects(c.messagePage(owner,{limit:10,...filter}),{code:'invalid_args'});}
 finally{await c.engine.dispose();db.close();}
});
