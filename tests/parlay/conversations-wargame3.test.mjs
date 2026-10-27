// Third wargame round (2026-10-23) against BB-B4 conversations: regressions ported from the red-team repros (B1–B7)
// plus the cheap plausible findings (owner-wide author allowance, issuer refusal buckets, pending-mutation fair share).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMesh,B} from './conversations-fixtures.test.mjs';
import {orderEvents} from '../../packages/messaging-engine/domains/conversations.mjs';
import {issuerSite,refusalKeys,REFUSALS} from '../../packages/messaging-engine/domains/receive.mjs';
import {recordRevocation,REVOCATION_BATCH} from '../../packages/messaging-engine/domains/delegation.mjs';
import {ROOM_STORAGE} from '../../packages/messaging-engine/domains/conversations.mjs';
import {memoryStore} from './helpers/engine.mjs';
import {BOUNDS,principalKey} from '../../packages/messaging-engine/store/mailbox.mjs';

const DAY=86400000;
const mesh=async(t,options)=>{const m=await createMesh(options);t.after(()=>m.dispose());return m;};
const peerKey=(cid,p)=>`conv/peer/${cid}/${encodeURIComponent(p.issuer)}|${encodeURIComponent(p.subject)}`;
const rnd=()=>B.base64url(crypto.getRandomValues(new Uint8Array(32)));
const storedBodyBytes=async(store,cid)=>{let n=0;for(const [,v] of await store.list({prefix:`conv/body/${cid}/`}))n+=v.length;return n;};
// Rotates, lets bob and carol select it, lets the old epoch's overlap end, then has bob switch apps (secrets lost) and rejoin.
async function rejoiningBob(t,{carolSelects=true}={}){
 const m=await mesh(t,{names:['alice','bob','carol']}),cid=await m.conversation('alice',['bob','carol']),e0=(await m.get('bob',cid)).epoch;
 const rotated=await m.run('alice','conversations.rotate',{conversationId:cid});await m.settle();
 for(const n of carolSelects?['bob','carol']:['bob'])await m.run(n,'conversations.select-rotation',{conversationId:cid,epoch:rotated.epoch,decision:'accept'});
 m.clock.advance(8*DAY);await m.renew();
 const oldSecret=Uint8Array.from(await m.party('carol').store.get(`conv/secret/${cid}/${e0}`));
 await m.switchApp('bob');await m.party('bob').store.transaction(async tx=>{for(const [k] of await tx.list({prefix:`conv/secret/${cid}/`}))await tx.delete(k);});
 await m.run('bob','conversations.rejoin');await m.flush();
 const op=[...(await m.party('bob').store.list({prefix:'conv/op/'})).values()].find(o=>o.type==='rejoin'&&o.recipients.some(r=>r.principal.subject===m.party('carol').owner));
 return {m,cid,e0,e1:rotated.epoch,oldSecret,op};
}

test('B1: a secret-share for an expired epoch neither ends the awaiting state nor becomes current',async t=>{
 const {m,cid,e0,e1,oldSecret,op}=await rejoiningBob(t);
 assert.equal((await m.get('bob',cid)).awaitingSecret,true);
 // Only the rejoin reaches carol (hostile), so she learns bob's new incarnation and shares the expired epoch's secret.
 assert.equal((await m.deliverPrepared('bob',op.operationId,'carol')).status,200);
 const incarnation=(await m.party('carol').store.get(peerKey(cid,m.party('bob').principal))).outbound.incarnation;
 const share=await m.craft('carol','bob',cid,{type:'secret-share',counter:900,epoch:e0,incarnation,secret:oldSecret,share:oldSecret,data:{epoch:e0,secretDigest:await B.secretDigest(oldSecret)}});
 await m.post('carol','bob',share.request);
 const after=await m.get('bob',cid);
 assert.equal(after.epoch,e1,'room.current never moves to the expired epoch');
 assert.equal(after.awaitingSecret,true,'the mailbox keeps awaiting the current epoch');
 await m.settle({advance:true});
 assert.equal((await m.get('bob',cid)).epoch,e1);assert.equal((await m.get('bob',cid)).awaitingSecret,false);
 await m.run('bob','conversations.send',{conversationId:cid,text:'after rejoin'});await m.settle({advance:true});
 assert.ok((await m.texts('alice',cid)).includes('after rejoin'),'bob can talk after the rejoin');
});

test('B1: an honest peer still on the previous (expired) epoch does not pin a rejoining mailbox to it',async t=>{
 const {m,cid,e1,op}=await rejoiningBob(t,{carolSelects:false});
 await m.deliverPrepared('bob',op.operationId,'carol');
 for(let i=0;i<3;i++){await m.run('carol','conversations.drain');await m.flush();await m.run('carol','outbox.drain');}
 const mid=await m.get('bob',cid);assert.equal(mid.epoch,e1);assert.equal(mid.awaitingSecret,true);
 await m.settle({advance:true});
 assert.equal((await m.get('bob',cid)).epoch,e1,'bob ends on the epoch it had selected');
 assert.equal((await m.get('bob',cid)).awaitingSecret,false);
});

test('B2: conversation bodies of 4 KiB or more are charged to the hot allowance and refused at its cap',async t=>{
 const m=await mesh(t,{names:['alice','bob','carol']}),cid=await m.conversation('alice',['bob','carol']),alice=m.party('alice').store;
 const big='a'.repeat(262144);
 for(let i=0;i<4;i++)assert.equal((await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:100+i,text:big})).request)).status,200);
 const bytes=await storedBodyBytes(alice,cid),usage=await alice.get('usage/v1');
 assert.ok(bytes>=4*262144);
 assert.ok(usage&&usage.hotBytes>=bytes&&usage.hotItems===4,'bodies held in the mailbox are charged, envelope included');
 const row=[...(await alice.list({prefix:`conv/body/${cid}/`})).values()].find(v=>v.length===262144);
 assert.ok(row instanceof Uint8Array,'bodies are stored as bytes, not number arrays');
 // A small message is not charged.
 assert.equal((await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:150,text:'short'})).request)).status,200);
 assert.equal((await alice.get('usage/v1')).hotItems,4);
 await alice.transaction(tx=>tx.put('usage/v1',{hotBytes:BOUNDS.hotBytes,hotItems:BOUNDS.hotItems,rejected:0}));
 const res=await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:200,text:'b'.repeat(65536)})).request);
 assert.equal(res.status,503);assert.equal(res.json.error,'recipient_storage_unavailable');
 assert.equal(await storedBodyBytes(alice,cid),bytes+5,'nothing more lands in the mailbox once the allowance is full');
});

test('B2: with user storage composed, large conversation bodies are staged there and read back',async t=>{
 const m=await mesh(t,{names:['alice','bob','carol'],storage:true}),cid=await m.conversation('alice',['bob','carol']),alice=m.party('alice');
 const text='c'.repeat(8192);
 assert.equal((await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:100,text})).request)).status,200);
 const ev=[...(await alice.store.list({prefix:`conv/event/${cid}/`})).values()].find(e=>e.counter===100);
 assert.equal(ev.bodyRef?.storage,'user');assert.equal(await alice.store.get(`conv/body/${cid}/${ev.eventId}`),undefined);
 assert.ok(alice.userStorage.objects.size>0);assert.equal((await alice.store.get('usage/v1'))?.hotBytes??0,0);
 assert.ok((await m.texts('alice',cid)).includes(text));
});

test('B3: ordering a one-day flood of sibling events stays near-linear',()=>{
 // Counts event-ID comparisons instead of timing: each ID converts to its string through a counting hook, so the cost
 // is deterministic. O(n log n) grows ~4.7x for 4x events; the former re-sort after every push grew 16x or more.
 let conversions=0;const id=()=>{const value=rnd();return {[Symbol.toPrimitive](){conversions++;return value;}};};
 const star=n=>{const rows=[{eventId:id(),type:'genesis',parents:[]}];for(let i=0;i<n;i++)rows.push({eventId:id(),type:'message',parents:[]});return rows;};
 const cost=n=>{const rows=star(n);conversions=0;const order=orderEvents(rows);assert.equal(order.length,n+1);assert.equal(order[0],rows[0].eventId);return conversions;};
 const small=cost(2000),large=cost(8000),ratio=large/small;
 assert.ok(ratio<8,`ordering must not be quadratic in sibling events (comparison ratio ${ratio.toFixed(1)})`);
 const rows=[{eventId:rnd(),type:'genesis',parents:[]},...Array.from({length:500},()=>({eventId:rnd(),type:'message',parents:[]}))];
 assert.deepEqual(orderEvents(rows).slice(1),rows.slice(1).map(r=>r.eventId).sort());
});

test('B3: heap ordering matches the reference topological order on random DAGs',()=>{
 const reference=all=>{const rows=all.filter(e=>e.type==='genesis'||['message','edit','retract'].includes(e.type)),ids=new Set(rows.map(e=>e.eventId)),children=new Map(),indegree=new Map(rows.map(e=>[e.eventId,0]));
  for(const e of rows)for(const parent of new Set(e.parents??[]))if(ids.has(parent)&&parent!==e.eventId){indegree.set(e.eventId,indegree.get(e.eventId)+1);if(!children.has(parent))children.set(parent,[]);children.get(parent).push(e.eventId);}
  const genesis=rows.find(e=>e.type==='genesis')?.eventId;if(genesis)for(const e of rows)if(e.eventId!==genesis&&indegree.get(e.eventId)===0){indegree.set(e.eventId,1);if(!children.has(genesis))children.set(genesis,[]);children.get(genesis).push(e.eventId);}
  const ready=[...indegree].filter(([,n])=>!n).map(([id])=>id).sort(),out=[];while(ready.length){const id=ready.shift();out.push(id);for(const c of children.get(id)??[]){indegree.set(c,indegree.get(c)-1);if(!indegree.get(c)){ready.push(c);ready.sort();}}}return out;};
 for(let round=0;round<20;round++){
  const rows=[{eventId:rnd(),type:'genesis',parents:[]}];
  for(let i=0;i<200;i++){const parents=Array.from({length:Math.floor(Math.random()*3)},()=>Math.random()<0.1?rnd():rows[Math.floor(Math.random()*rows.length)].eventId);rows.push({eventId:rnd(),type:['message','edit','retract','peer-hello'][Math.floor(Math.random()*4)],parents});}
  assert.deepEqual(orderEvents(rows),reference(rows));
 }
});

test('B4: a member cannot squat another member\'s rotation epoch with a different secret',async t=>{
 let blocking=false;
 const m=await mesh(t,{names:['alice','bob','dave'],rules:[{from:'alice',to:'dave',mode:'status',status:503,when:()=>blocking}]}),cid=await m.conversation('alice',['bob','dave']);
 blocking=true;const rotated=await m.run('alice','conversations.rotate',{conversationId:cid});await m.settle();
 const E=rotated.epoch,alice=m.party('alice'),bob=m.party('bob');
 assert.ok([...(await bob.store.list({prefix:`conv/rotation/${cid}/${E}/`})).values()].some(r=>r.proposer.subject===alice.owner),'bob holds alice\'s proposal');
 // bob races alice's (still undelivered) rotate to dave with the same epoch ID and his own secret.
 const mine=crypto.getRandomValues(new Uint8Array(32));
 assert.equal((await m.post('bob','dave',(await m.craft('bob','dave',cid,{type:'rotate',counter:500,share:mine,data:{newEpoch:E,secretDigest:await B.secretDigest(mine)}})).request)).status,200);
 blocking=false;await m.settle({advance:true});
 const rows=[...(await m.party('dave').store.list({prefix:`conv/rotation/${cid}/`})).values()];
 assert.ok(rows.some(r=>r.proposer.subject===alice.owner&&r.epoch===E),'the honest proposal is not silently dropped');
 assert.ok(rows.every(r=>r.epoch!==E||r.conflict),'both proposals of the epoch are flagged');
 assert.equal((await m.get('dave',cid)).rotationConflict,true);
 await assert.rejects(m.run('dave','conversations.select-rotation',{conversationId:cid,epoch:E,decision:'accept'}),e=>e.code==='rotation_conflict');
 await m.run('dave','conversations.select-rotation',{conversationId:cid,epoch:E,decision:'accept',proposer:alice.principal});
 assert.equal(B.base64url(Uint8Array.from(await m.party('dave').store.get(`conv/secret/${cid}/${E}`))),B.base64url(Uint8Array.from(await alice.store.get(`conv/secret/${cid}/${E}`))),'one epoch ID never carries two secrets');
 await m.run('alice','conversations.send',{conversationId:cid,text:'after rotation'});await m.settle({advance:true});
 assert.ok((await m.texts('dave',cid)).includes('after rotation'));
 // An epoch already selected never takes a second secret: a late differing proposal marks a secret conflict.
 const late=crypto.getRandomValues(new Uint8Array(32));
 await m.post('bob','dave',(await m.craft('bob','dave',cid,{type:'rotate',counter:501,share:late,data:{newEpoch:E,secretDigest:await B.secretDigest(late)}})).request);
 const conflicted=await m.get('dave',cid);assert.equal(conflicted.secretConflict,true);
 assert.equal(conflicted.secretConflictBy.subject,bob.owner,'the conflict names who caused it');assert.equal(conflicted.secretConflictEpoch,E);
 const dismissed=await m.run('dave','conversations.dismiss-conflict',{conversationId:cid});assert.equal(dismissed.by.subject,bob.owner);
 assert.equal((await m.get('dave',cid)).secretConflict,false);
 await assert.rejects(m.run('dave','conversations.dismiss-conflict',{conversationId:cid}),e=>e.code==='not_found');
});

test('B5: an event for an abandoned counter below the frontier is not applied',async t=>{
 const m=await mesh(t,{names:['alice','bob','carol']}),cid=await m.conversation('alice',['bob','carol']);
 assert.equal((await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:1000,text:'jump'})).request)).status,200);
 const late=await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:600,text:'abandoned counter'})).request);
 assert.equal(late.status,200);
 assert.ok(!(await m.texts('alice',cid)).includes('abandoned counter'));
});

test('B5: re-using a consumed counter after the replay row is swept is equivocation, not a new event',async t=>{
 const m=await mesh(t,{names:['alice','bob','carol']}),cid=await m.conversation('alice',['bob','carol']);
 assert.equal((await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:40,text:'original 40'})).request)).status,200);
 m.clock.advance(17*DAY);await m.renew();const swept=await m.run('alice','conversations.sweep',{});assert.ok(swept.replays>0);
 await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:40,text:'fork 40'})).request);
 const texts=await m.texts('alice',cid);assert.ok(texts.includes('original 40'));assert.ok(!texts.includes('fork 40'));
 assert.equal((await m.get('alice',cid)).quarantinedStreams,1,'equivocation evidence stops the stream');
 assert.equal((await m.party('alice').store.list({prefix:`conv/evidence/${cid}/`})).size,1);
});

test('B6: one member cannot exhaust the placeholder pool or set the gap marker for good',async t=>{
 const m=await mesh(t,{names:['alice','bob','carol']}),cid=await m.conversation('alice',['bob','carol']),store=m.party('alice').store;
 for(let i=0;i<8;i++)assert.equal((await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:300+i,parents:Array.from({length:8},rnd)})).request)).status,200);
 const room=await store.get(`conv/room/${cid}`);
 assert.ok(room.placeholders<64,'one author holds at most its share of the pool');
 assert.equal((await store.list({prefix:`conv/placeholder/${cid}/`})).size,room.placeholders);
 await m.post('carol','alice',(await m.craft('carol','alice',cid,{counter:300,parents:[rnd()]})).request);
 const after=await store.get(`conv/room/${cid}`);assert.equal(after.gap,false);assert.equal(after.placeholders,room.placeholders+1);
 // Placeholders expire after 7 days; a drained pool clears a gap marker.
 await store.transaction(async tx=>{const r=await tx.get(`conv/room/${cid}`);await tx.put(`conv/room/${cid}`,{...r,gap:true});});
 m.clock.advance(8*DAY);await m.renew();
 assert.equal((await m.post('carol','alice',(await m.craft('carol','alice',cid,{counter:301,text:'later'})).request)).status,200);
 const drained=await store.get(`conv/room/${cid}`);assert.equal(drained.placeholders,0);assert.equal(drained.gap,false);
 assert.equal((await store.list({prefix:`conv/placeholder/${cid}/`})).size,0);
});

test('B7: a revocation learned by the recheck sweep quarantines conversation events and fences the key',async t=>{
 const m=await mesh(t,{names:['alice','bob','carol']}),cid=await m.conversation('alice',['bob','carol']),bob=m.party('bob');
 assert.equal((await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:50,text:'sent with a stolen key'})).request)).status,200);
 assert.ok(await m.party('alice').store.get(`seen-jkt/${bob.jkt}`),'conversation authors feed the recheck sweep');
 m.revoked.set(bob.jkt,Math.floor(m.clock.now()/3600000));m.clock.advance(6*60000);
 const sweep=await m.run('alice','delegation.recheck',{});assert.equal(sweep.revoked,1);
 const ev=[...(await m.party('alice').store.list({prefix:`conv/event/${cid}/`})).values()].find(e=>e.type==='message'&&e.counter===50);
 assert.ok(ev.quarantined,'the event from the revoked key is quarantined');
 assert.ok(await m.party('alice').store.get(`revoked/${bob.jkt}`),'the revocation is persisted');
 assert.notEqual((await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:51,text:'still posting'})).request)).status,200);
 assert.ok(!(await m.texts('alice',cid)).includes('still posting'));
});

test('plausible: one author is bounded across every conversation of the owner per day',async t=>{
 const m=await mesh(t,{names:['alice','bob','carol']}),cid=await m.conversation('alice',['bob','carol']),store=m.party('alice').store;
 const day=Math.floor(m.clock.now()/DAY),who=principalKey(m.party('bob').principal);
 await store.transaction(async tx=>{const s=await tx.get('conv/allowance');await tx.put('conv/allowance',{...s?.day===day?s:{day,records:0,bytes:0,authors:{}},principals:{[who]:{records:10000,bytes:0}}});});
 const res=await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:70,text:'over'})).request);
 assert.equal(res.status,429);assert.equal(res.json.error,'rate_limited');
 assert.equal((await m.post('carol','alice',(await m.craft('carol','alice',cid,{counter:70,text:'fine'})).request)).status,200);
});

test('plausible: issuer refusal buckets use the registrable domain',()=>{
 // Per host (200) alongside per registrable domain (1,000), and per principal (20).
 assert.equal(REFUSALS.issuer,200);assert.equal(REFUSALS.site,1000);
 assert.deepEqual(refusalKeys({issuer:'https://a.attacker.example',subject:'s'}).slice(1),[['i|a.attacker.example',200],['s|attacker.example',1000]]);
 assert.equal(issuerSite('https://a.attacker.example'),'attacker.example');
 assert.equal(issuerSite('https://b.c.attacker.example'),'attacker.example');
 assert.equal(issuerSite('https://id.foo.co.uk'),'foo.co.uk');
 assert.equal(issuerSite('https://127.0.0.1:8443'),'127.0.0.1');
 assert.equal(issuerSite('https://localhost'),'localhost');
});

test('plausible: colluding members evict only each other\'s pending mutations',async t=>{
 const names=['alice','bob','carol','dave','erin','frank'],m=await mesh(t,{names}),cid=await m.conversation('alice',names.slice(1));
 assert.equal((await m.post('frank','alice',(await m.craft('frank','alice',cid,{type:'edit',counter:300,target:rnd(),text:'honest edit'})).request)).status,200);
 for(const n of ['bob','carol','dave','erin'])for(let i=0;i<16;i++)assert.equal((await m.post(n,'alice',(await m.craft(n,'alice',cid,{type:'edit',counter:300+i,target:rnd(),text:'flood'})).request)).status,200);
 const pending=await m.party('alice').store.get(`conv/mutations/${cid}`);
 assert.ok(pending.length<=B.LIMITS.maxPendingMutations);
 assert.ok(pending.some(p=>p.author.subject===m.party('frank').owner),'the honest member keeps its pending mutation');
});

test('review: replays of a not-applied duplicate stage nothing, cost one record and are answered from a replay row',async t=>{
 const m=await mesh(t,{names:['alice','bob','carol'],storage:true}),cid=await m.conversation('alice',['bob','carol']),alice=m.party('alice');
 assert.equal((await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:1000,text:'jump'})).request)).status,200);
 const puts=[],storage=alice.userStorage,put=storage.put;storage.put=async(k,v)=>{puts.push(k);return put(k,v);};
 const who=principalKey(m.party('bob').principal),records=async()=>(await alice.store.get('conv/allowance'))?.principals?.[who]?.records??0,before=await records();
 const crafted=await m.craft('bob','alice',cid,{counter:600,text:'x'.repeat(200000)});
 for(let i=0;i<5;i++)assert.equal((await m.post('bob','alice',crafted.request)).status,200);
 assert.equal(puts.length,0,'a duplicate or abandoned counter is never staged');
 assert.equal(await records(),before+1,'the first attempt costs one record; retries are replays');
 const replays=[...(await alice.store.list({prefix:'conv/replay/'})).values()].filter(r=>r.applied===false);assert.equal(replays.length,1);
 assert.ok(!(await m.texts('alice',cid)).includes('x'.repeat(200000)));
});

test('review: every stored conversation event counts toward a cumulative per-room and per-author byte bound',async t=>{
 const m=await mesh(t,{names:['alice','bob','carol']}),cid=await m.conversation('alice',['bob','carol']),store=m.party('alice').store,who=principalKey(m.party('bob').principal);
 const before=(await store.get(`conv/room/${cid}`)).stored?.authors?.[who]??0;
 assert.equal((await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:80,text:'small'})).request)).status,200);
 const after=(await store.get(`conv/room/${cid}`)).stored;assert.ok(after.authors[who]-before>500,'small records are charged with their envelope');assert.ok(after.bytes>=after.authors[who]);
 await store.transaction(async tx=>{const r=await tx.get(`conv/room/${cid}`);await tx.put(`conv/room/${cid}`,{...r,stored:{...r.stored,authors:{...r.stored.authors,[who]:ROOM_STORAGE.authorBytes-10}}});});
 const res=await m.post('bob','alice',(await m.craft('bob','alice',cid,{counter:81,text:'over'})).request);
 assert.equal(res.status,503);assert.equal(res.json.error,'recipient_storage_unavailable');
 assert.equal((await m.post('carol','alice',(await m.craft('carol','alice',cid,{counter:80,text:'carol fine'})).request)).status,200);
});

test('review: a revocation walk is bounded per call and finishes in later batches',async()=>{
 const store=memoryStore(),jkt='J'.repeat(43),now=Date.UTC(2026,9,23),total=REVOCATION_BATCH*2+88;
 await store.transaction(async tx=>{for(let i=0;i<total;i++){const id=String(i).padStart(43,'e');await tx.put(`conv/by-jkt/${jkt}/c/${id}`,1);await tx.put(`conv/event/c/${id}`,{eventId:id,createdAt:now,quarantined:false});}});
 const run=()=>store.transaction(tx=>recordRevocation(tx,{jkt,principal:{issuer:'https://x.example',subject:'s'},now}));
 assert.equal(await run(),REVOCATION_BATCH,'one call quarantines at most one batch');
 const row=await store.get(`revoked/${jkt}`);assert.ok(row.sweep,'the cursor is kept');
 assert.equal(await run(),REVOCATION_BATCH);assert.equal(await run(),88);
 assert.equal((await store.get(`revoked/${jkt}`)).sweep,undefined);assert.equal(await run(),0);
 assert.equal([...(await store.list({prefix:'conv/event/c/'})).values()].filter(e=>e.quarantined).length,total);
});
