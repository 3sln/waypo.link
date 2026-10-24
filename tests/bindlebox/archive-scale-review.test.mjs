// Scale round 2 review L1 (2026-10-24): derived conversation indexes (replay expiry pointers, materialized timeline) are
// not archived, so an import must rebuild them for the rows it writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createArchiveMesh} from './archive-fixtures.test.mjs';

test('L1: archive import indexes imported replay rows and invalidates a materialized timeline',async t=>{
 const a=await createArchiveMesh({names:['alice','bob']});t.after(()=>a.dispose());
 const cid=await a.conversation('alice',['bob']),bob=a.party('bob');
 for(const text of ['first','second','third'])await a.run('alice','conversations.send',{conversationId:cid,text});
 await a.settle();
 const anchor=await a.archive('bob','archive.export');
 await a.switchApp('bob',{ingress:'https://bob-next.box.example/ingress'});
 // The new mailbox already finished its replay-index migration and holds a ready (empty) materialized order for the room,
 // as live traffic admitted during an import could leave it.
 await bob.store.transaction(async tx=>{await tx.put('conv/sweep-state',{replayMigrated:true});await tx.put(`conv/timeline-state/${cid}`,{phase:'ready',total:0,rank:0,last:null,generation:1});});
 await a.archive('bob','archive.import',{expect:anchor});
 const replays=[...(await bob.store.list({prefix:'conv/replay/'})).keys()].map(k=>k.slice('conv/replay/'.length));
 assert.ok(replays.length>0,'the archive carried replay rows');
 const due=new Set((await bob.store.list({prefix:'conv/replay-due/'})).values());
 for(const id of replays)assert.ok(due.has(id),`imported replay ${id} has an expiry pointer`);
 const view=await a.run('bob','conversations.get',{conversationId:cid});
 const texts=view.timeline.map(e=>e.text);
 for(const text of ['first','second','third'])assert.ok(texts.includes(text),`imported ${text} is in the timeline: ${JSON.stringify(texts)}`);
});
