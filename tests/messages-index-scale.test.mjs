import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('legacy message arrays read bounded indexed rows and preserve filters, limits and tie ordering',async()=>{
 const db=new SqliteMetadata(':memory:');let lists=0,rows=0;
 const metadata=new Proxy(db,{get(target,property){if(property==='list')return async options=>{if(options?.prefix?.startsWith('message/'))lists++;return target.list(options);};const value=target[property];return typeof value==='function'?value.bind(target):value;}});
 const sql={transaction:db.sql.transaction.bind(db.sql),exec(query,...args){const result=[...db.sql.exec(query,...args)];if(query.startsWith('SELECT id,received_at,record FROM inbox_catalog'))rows+=result.length;return result;}};
 const bucket={get:async()=>null,delete:async()=>{}};
 const c=new AccountController({metadata,sql,gate:new SerialGate(),blobs:bucket,archives:bucket,config:{APP_ORIGIN:'https://provider.example',WORK_LIMITS_ENABLED:'false',STORAGE_WRITE_ENABLED:'false'}});
 try{
  await c.warm(owner);
  for(const size of [100,5000]){
   const start=size===100?0:100;
   for(let i=start;i<size;i++)c.itemIndex.upsert({id:String(i).padStart(8,'0'),owner,receivedAt:100,collection:i%2?'other':'inbox',readAt:i%2?1:null,quarantined:false,mimeType:'text/plain',size:1,tags:[]});
   lists=rows=0;const result=await c.messages.list(owner,{limit:50,collection:'inbox',unread:true,quarantined:false});
   assert.ok(Array.isArray(result));assert.equal(result.length,50);assert.equal(result[0].id,'00000000');assert.equal(result[49].id,'00000098');assert.equal(lists,0);assert.ok(rows<=51);
  }
  const plan=db.db.prepare('EXPLAIN QUERY PLAN SELECT id,received_at,record FROM inbox_catalog WHERE owner=? AND collection=? AND unread=? AND quarantined=? ORDER BY received_at DESC,id ASC LIMIT ?').all(owner,'inbox',1,0,51).map(row=>row.detail).join(' ');
  assert.match(plan,/inbox_filter_7_ASC/);assert.doesNotMatch(plan,/TEMP B-TREE/);
  assert.equal((await c.messages.list(owner,{limit:1000})).length,1000);
  const first=c.itemIndex.page(owner,{limit:50},{legacy:true}),next=c.itemIndex.page(owner,{limit:50,cursor:first.cursor},{legacy:true});
  assert.equal(first.items.at(-1).id,'00000049');assert.equal(next.items[0].id,'00000050');
  const deep=c.itemIndex.page(owner,{limit:1000},{legacy:true});let cursor=deep.cursor;for(let i=0;i<3;i++)cursor=c.itemIndex.page(owner,{limit:1000,cursor},{legacy:true}).cursor;
  rows=0;const deepPage=c.itemIndex.page(owner,{limit:50,cursor},{legacy:true});assert.equal(deepPage.items[0].id,'00004000');assert.ok(rows<=102);
  const seekPlan=db.db.prepare('EXPLAIN QUERY PLAN SELECT id,received_at,record FROM inbox_catalog WHERE owner=? AND received_at=? AND id>? ORDER BY received_at DESC,id ASC LIMIT ?').all(owner,100,'00003999',51).map(row=>row.detail).join(' ');assert.match(seekPlan,/received_at=\? AND id>\?/);assert.doesNotMatch(seekPlan,/TEMP B-TREE/);
  assert.throws(()=>c.itemIndex.page(owner,{limit:50,collection:'other',cursor:first.cursor},{legacy:true}),{code:'invalid_args'});
  await assert.rejects(c.messages.list(owner,{limit:1001}),{code:'invalid_limit'});
  assert.deepEqual(await c.messages.list(owner,{unread:'true'}),[]);
  await db.delete('item-index-ready');await db.put('item-index-migration','message/zzzz');
  // A pending upgrade must never fall back to materializing legacy records.
  c.migrateItemIndex=async()=>{};
  await assert.rejects(c.messages.list(owner,{limit:50}),{code:'temporarily_unavailable'});
 }finally{await c.engine.dispose();db.close();}
});

test('filter indexes over an existing catalog build in bounded steps, never at boot, and reads fail closed until ready',async()=>{
 const db=new SqliteMetadata(':memory:'),bucket={get:async()=>null,delete:async()=>{}},config={APP_ORIGIN:'https://provider.example',WORK_LIMITS_ENABLED:'false',STORAGE_WRITE_ENABLED:'false'};
 const make=()=>new AccountController({metadata:db,sql:db.sql,gate:new SerialGate(),blobs:bucket,archives:bucket,config});
 const fresh=make();
 try{
  // An empty catalog gets every index at once.
  assert.equal(fresh.itemIndex.missingFilterIndexes().length,0);await fresh.warm(owner);assert.equal(await db.get('item-index-ready'),true);
  // Simulate a catalog written before the filter indexes existed: 30,000 rows and no inbox_filter_* indexes.
  for(const {name}of db.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'inbox_filter_%'").all())db.db.exec(`DROP INDEX ${name}`);
  const insert=db.db.prepare('INSERT INTO inbox_catalog(id,owner,received_at,collection,unread,quarantined,record) VALUES(?,?,?,?,?,?,?)');db.db.exec('BEGIN');
  for(let i=0;i<30000;i++){const id=String(i).padStart(8,'0');insert.run(id,owner,i,'inbox',1,0,JSON.stringify({id,owner,receivedAt:i,collection:'inbox',readAt:null,quarantined:false,mimeType:'text/plain',size:1,tags:[]}));}
  db.db.exec('COMMIT');await fresh.engine.dispose();
  const c=make();
  try{
   assert.equal(c.itemIndex.missingFilterIndexes().length,12,'the constructor must not build indexes over existing rows');
   // 100,000 row budget / 30,000 rows = 3 indexes per step. Every read warms first, and each warm runs one step.
   await assert.rejects(c.messages.list(owner,{limit:10}),{code:'temporarily_unavailable'});assert.equal(c.itemIndex.missingFilterIndexes().length,9);
   const alarm=await db.getAlarm();assert.ok(Number.isSafeInteger(alarm)&&alarm<=Date.now()+1000,'a pending build arms a prompt alarm');
   await assert.rejects(c.messagePage(owner,{limit:10}),{code:'temporarily_unavailable'});assert.equal(c.itemIndex.missingFilterIndexes().length,6);
   await assert.rejects(c.messages.list(owner,{limit:10}),{code:'temporarily_unavailable'});assert.equal(c.itemIndex.missingFilterIndexes().length,3);
   assert.equal((await c.messages.list(owner,{limit:10,unread:true})).length,10);assert.equal(c.itemIndex.missingFilterIndexes().length,0);
   assert.equal((await c.messagePage(owner,{limit:10})).items.length,10);
  }finally{await c.engine.dispose();}
 }finally{db.close();}
});
