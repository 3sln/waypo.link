import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {AccountItemIndex} from '../packages/runtime/item-index.mjs';
import {retentionUnitBytes} from '../packages/runtime/account/retention.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function metered(sql){const stats={rows:0,bytes:0,queries:[]};return {stats,reset(){stats.rows=stats.bytes=0;stats.queries=[];},exec(query,...args){const rows=[...sql.exec(query,...args)];stats.queries.push(query);stats.rows+=rows.length;stats.bytes+=Buffer.byteLength(JSON.stringify(rows));return rows;}};}
function audit(db,index){
 const expected={collections:{},resources:{}};
 for(const r of db.sql.exec("SELECT collection AS unit,SUM(json_extract(record,'$.size')) AS bytes FROM inbox_catalog WHERE owner=? GROUP BY collection",owner))if(r.bytes)expected.collections[r.unit]=r.bytes;
 for(const r of db.sql.exec("SELECT resource AS unit,SUM(json_extract(record,'$.size')) AS bytes FROM hosted_catalog GROUP BY resource"))if(r.bytes)expected.resources[r.unit]=r.bytes;
 const actual=index.unitBytes(owner);for(const map of Object.values(actual))for(const [k,v]of Object.entries(map))if(v===0)delete map[k];assert.deepEqual(actual,expected);
}
test('retention totals: seeded write/delete/move chaos exactly reconciles and rolls back',async()=>{
 const db=new SqliteMetadata(':memory:');try{const index=new AccountItemIndex(db.sql);let seed=7331;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 for(let step=0;step<700;step++){
  const id='m'+random(60),resource='r'+random(5),key='o'+random(25);
  await db.transaction(async()=>{if(random(4)===0)index.remove(id);else index.upsert({id,owner:random(6)===0?'other':owner,collection:'c'+random(5),receivedAt:step,size:random(5000),readAt:null});if(random(3)===0)index.removeObject(resource,key);else index.upsertObject(resource,{key,size:random(5000)});});
  if(step%23===0)audit(db,index);
 }
 audit(db,index);const prior=index.unitBytes(owner);await assert.rejects(db.transaction(async()=>{index.upsert({id:'rollback',owner,collection:'new',size:123});index.upsertObject('new',{key:'rollback',size:456});throw Error('rollback');}));assert.deepEqual(index.unitBytes(owner),prior);
 }finally{db.close();}
});
test('retention totals read fixed units with flat SQL rows/bytes at 100 versus 10000 messages',async()=>{
 const results=[];
 for(const size of [100,10000]){const db=new SqliteMetadata(':memory:');try{const sql=metered(db.sql),index=new AccountItemIndex(sql);await db.transaction(async tx=>{await tx.put('item-index-ready',true);await tx.put('search-backfill-ready',true);for(let i=0;i<size;i++)db.sql.exec('INSERT INTO inbox_catalog VALUES(?,?,?,?,?,?,?)','m'+i,owner,i,'c'+i%5,1,0,JSON.stringify({size:1}));});sql.reset();const result=await db.transaction(tx=>retentionUnitBytes({itemIndex:index},owner,tx));assert.equal(Object.values(result.collections).reduce((a,b)=>a+b,0),size);assert.ok(sql.stats.queries.every(q=>!q.includes('GROUP BY')&&!q.includes('FROM inbox_catalog')));results.push({...sql.stats});}finally{db.close();}}
 assert.equal(results[0].rows,results[1].rows);assert.ok(results[1].bytes<=results[0].bytes+20);assert.ok(results[1].rows<=6);
});
test('legacy totals migration is resumable, bounded and safe across interleaved moves/deletes',()=>{
 const db=new SqliteMetadata(':memory:');try{let index=new AccountItemIndex(db.sql);db.sql.exec("DELETE FROM incoming_state WHERE key LIKE 'unit-totals-%'");for(const r of db.sql.exec("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'retention_%'"))db.sql.exec('DROP TRIGGER '+r.name);
 for(let i=0;i<525;i++)db.sql.exec('INSERT INTO inbox_catalog VALUES(?,?,?,?,?,?,?)','m'+String(i).padStart(4,'0'),owner,i,'old',1,0,JSON.stringify({id:'m'+i,owner,collection:'old',size:2}));
 for(let i=0;i<85;i++)db.sql.exec('INSERT INTO hosted_catalog VALUES(?,?,?)','r'+i%3,'key/'+i,JSON.stringify({key:'key/'+i,size:7}));
 const sql=metered(db.sql);index=new AccountItemIndex(sql);sql.reset();assert.equal(index.migrateUnitTotals(40),false);assert.ok(sql.stats.rows<=45);
 index.upsert({id:'m0001',owner,collection:'moved',size:13});index.remove('m0500');index.upsertObject('r1',{key:'key/1',size:19});index.removeObject('r2','key/2');let calls=0;while(!index.migrateUnitTotals(40))assert.ok(++calls<20);audit(db,index);
 }finally{db.close();}
});
