// Wargame 4 plausible items: oversized connector RPC results are purged with the account; MCP subject erasure resumes
// from a durable cursor instead of restarting every prefix.
import test from 'node:test';
import assert from 'node:assert/strict';
import {deletionFixture} from './helpers/deletion-world.mjs';
import {OWNER} from './helpers/app-engine.mjs';
import {ownedBlobRef} from '../packages/runtime/lifecycle-storage.mjs';
import {McpAuthorization,mcpMetadata} from '../packages/mcp/service.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';

test('rpc-results/<owner>/… blobs referenced by a storage journal are owned and purged on deletion',async t=>{
 const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 assert.equal(ownedBlobRef(OWNER,`rpc-results/${OWNER}/client/tx1`),true);assert.equal(ownedBlobRef(OWNER,`rpc-results/${other}/client/tx1`),false);assert.equal(ownedBlobRef(OWNER,`rpc-results/${OWNER}/../x`),false);
 const x=await deletionFixture(t),ref=`rpc-results/${OWNER}/client/tx1`;
 await x.metadata.put('storage-journal/r1/tx1',{fingerprint:'f',state:'done',resultRef:ref,createdAt:x.clock.now()});await x.blobs.put(ref,'{"big":true}');
 await x.request();await x.toDeadline();const results=await x.run();assert.equal(results.at(-1).action,'deleted');
 assert.equal(x.blobs.map.has(ref),false,'the oversized RPC result is purged with the account');
});

test('MCP eraseSubject resumes from its durable cursor after an interruption',async t=>{
 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',db=new SqliteMetadata(':memory:');t.after(()=>db.close());
 for(let i=0;i<600;i++)await db.put(`mcp/v1/token/t${String(i).padStart(4,'0')}`,{owner:i%2?owner:other});
 await db.put('mcp/v1/grant/07.a',{id:'07.a',owner});await db.put(`mcp/v1/owner/${owner}`,['07.a']);
 const metadata=mcpMetadata(db);let lists=0,failAt=3;
 const flaky={transaction:fn=>metadata.transaction(tx=>fn({...tx,list:async options=>{lists++;if(lists===failAt)throw new Error('storage interrupted');return tx.list(options);}}))};
 const service=new McpAuthorization({metadata:flaky,config:{APP_ORIGIN:'https://mcp.example'},shard:'07'});
 await assert.rejects(service.eraseSubject(owner),/storage interrupted/);
 const cursor=await db.get(`mcp/v1/erase/${owner}`);assert.ok(cursor&&cursor.index===1&&cursor.startAfter,'progress is durable: '+JSON.stringify(cursor));
 const before=lists;failAt=-1;const result=await service.eraseSubject(owner);
 assert.ok(lists-before<=6,`the retry resumed (${lists-before} page reads, not a full restart)`);
 assert.equal(result.deleted,301);assert.equal(await db.get(`mcp/v1/erase/${owner}`),undefined,'the cursor is removed when done');
 assert.equal([...(await db.list({prefix:'mcp/v1/token/'})).values()].filter(v=>v.owner===owner).length,0);
 assert.deepEqual(await service.eraseSubject(owner),{deleted:0},'a later call starts afresh');
});
