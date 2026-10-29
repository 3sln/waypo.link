// Email-bridge removal reset `parlay-email-bridge-retired-v1` (owner direction 2026-10-28; provisional, unsigned;
// packages/messaging-engine/domains/email-bridge-reset.mjs): it deletes exactly the retired families (bridge/,
// intake/tx/, intake/jti/, allow/e/) and channel-origin items with their pending/Rejected index rows, body, incoming
// projection, classify-pending entry and hot usage; it keeps native items, native public requests, principal allowlist
// entries, intake settings and every other family; bounded slices, family order, marker last, idempotency, crash
// resume, the app-shell lifecycle (after the contact-links reset, on open and from the alarm) and a seeded chaos run
// with random limits/pages, crashes and interleaved native writes against a reference model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestEngine,memoryStore} from './helpers/engine.mjs';
import {forEachSeed} from '../helpers/chaos.mjs';
import {ContactsDomain,ReceiveDomain,KEYS,principalKey} from '../../packages/messaging-engine/store/mailbox.mjs';
import {projectIncoming,classifyPendingKey} from '../../packages/messaging-engine/store/item-index.mjs';
import {resetEmailBridge,MailboxResetEmailBridge,EMAIL_BRIDGE_RESET,EMAIL_BRIDGE_RESET_MARKER,EMAIL_BRIDGE_RESET_PREFIXES} from '../../packages/messaging-engine/domains/email-bridge-reset.mjs';
import {CONTACT_LINKS_RESET_MARKER} from '../../packages/messaging-engine/domains/contact-links-reset.mjs';
import {createMailbox} from '../../apps/parlay/worker/mailbox.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NOW=Date.UTC(2026,9,28,12),REV='bb:incoming:revision',ROW='bb:incoming:row/';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const person=(name,n)=>({issuer:`https://${name}.provider.example`,subject:uuid(n)});
const ME=person('owner',1),ALICE=person('alice',2),CAROL=person('carol',3);
// Item IDs interleave channel and native items in key order, so channel items sit on every page boundary.
const itemId=n=>`i${String(n).padStart(4,'0')}`.padEnd(43,'x');
const isRetiredRow=key=>EMAIL_BRIDGE_RESET_PREFIXES.some(p=>key.startsWith(p));

function channelItem(n,{state='request',hot=0,receivedAt=NOW-100000+n}={}){
 return {id:itemId(n),origin:'channel',kind:'channel',channel:'email',bridge:{consumer:'https://bob.provider.example',jti:`mail-${n}`},asserted:{sender:{envelopeFrom:`s${n}@spam.example`,headerFrom:`S <s${n}@spam.example>`},dmarc:'pass',automation:[],address:`s${n}@spam.example`},verifiedSender:false,subject:'',content:null,message:{parts:[{mimeType:'text/plain',dataBase64url:'SGk'}]},bodyRef:{storage:'mailbox'},createdAt:receivedAt-10,receivedAt,state,request:true,tags:[],tagHistory:[],quarantined:false,reviewed:false,notification:null,...state==='rejected'?{rejectedAt:receivedAt+5}:{},...hot?{hot}:{}};
}
function nativeItem(n,{state='inbox',hot=0,receivedAt=NOW-100000+n,author=ALICE}={}){
 return {id:itemId(n),origin:'native',kind:'one-off',author:{jkt:`jkt-${n}`,principal:author},subject:`Native ${n}`,content:{mimeType:'text/plain'},bodyRef:{storage:'mailbox'},receivedAt,state,...state==='pending'||state==='request'?{request:true}:{},...state==='rejected'?{rejectedAt:receivedAt+5}:{},tags:[],tagHistory:[],quarantined:false,notification:state==='inbox'?'push':null,...hot?{hot}:{}};
}
// Writes one item with the rows its state implies: the pending or Rejected index row, an inline body, the incoming
// projection (any state but pending; a pending channel item was projected too), a classify-pending entry when asked
// and its by-jkt row for native items.
async function putItem(tx,item,{body=true,classifyPending=false}={}){
 await tx.put(KEYS.item(item.id),item);
 if(item.state==='pending')await tx.put(KEYS.pending(item.receivedAt,item.id),{id:item.id});
 if(item.state==='rejected')await tx.put(KEYS.rejected(item.rejectedAt,item.id),{id:item.id});
 if(body)await tx.put(KEYS.body(item.id),new TextEncoder().encode(`body ${item.id}`));
 await projectIncoming(tx,item);
 if(classifyPending)await tx.put(classifyPendingKey(item.id),{id:item.id,at:item.receivedAt});
 if(item.author?.jkt)await tx.put(`by-jkt/${item.author.jkt}/${item.id}`,1);
}
const usageOf=items=>({hotBytes:items.reduce((n,i)=>n+(i.hot??0),0),hotItems:items.filter(i=>i.hot>0).length,rejected:0});

// A pre-removal mailbox: every retired family (sized to need several pages), channel items in each state (pending with
// its pending row, rejected with its Rejected row, a projected request, one holding hot usage, one with a classify-
// pending entry), native items (inbox with hot usage, pending and rejected public requests) and other families.
async function legacyMailbox({channels=6,natives=5,retired=5}={}){
 const rows=[['owner',OWNER],['config',{principal:ME,ingress:'https://owner.box.example/ingress',plan:'free'}],[CONTACT_LINKS_RESET_MARKER,{version:1,completedAt:NOW-1}]];
 rows.push(['bridge/settings',{enabled:true,consumers:[{origin:'https://bob.provider.example',channel:'email'}]}]);
 for(let i=0;i<retired;i++){
  rows.push([`bridge/fp/${'f'.repeat(8)}${i}`,{at:NOW-i}],[`intake/tx/${uuid(300+i)}`,{disposition:'stored-receipt',digest:'d',jti:`mail-${i}`,at:NOW-i}],[`intake/jti/${encodeURIComponent('https://bob.provider.example')}/mail-${i}`,{disposition:'stored-receipt',digest:'d',at:NOW-i}],[`allow/e/s${i}%40friends.example`,{at:NOW-i,email:`s${i}@friends.example`}]);
 }
 // Kept: principal allowlist, intake settings, blocks, lists, conversations, invitations, an unrelated migration row,
 // a native classify gap record and other mailbox rows whose keys merely resemble the retired ones.
 rows.push([`allow/p/${principalKey(ALICE)}`,{at:NOW-1,principal:ALICE}],[KEYS.settings,{classifierConsent:true,allowance:200,usage:{day:0,calls:0},pins:[]}],[`block/${principalKey(CAROL)}`,{principal:CAROL,at:NOW-1}]);
 rows.push(['list/contacts',{id:'contacts',name:'Contacts',policy:'message',builtin:true,createdAt:NOW-1}],[`conv/room/${uuid(501)}`,{id:uuid(501),state:'active',participants:[]}],[`inv/link/${uuid(900)}`,{id:uuid(900),state:'live'}],['bb:classify:gaps',[{kind:'text',reason:'no_classifier',at:NOW-1}]]);
 rows.push(['bridges/unrelated',{keep:true}],['intake/other',{keep:true}],['allow/everyone',{keep:true}],['storage-gc/parlay%2Fv1%2Fitems%2Fq',{key:'parlay/v1/items/q'}]);
 const store=memoryStore(rows),items=[];
 const states=['pending','rejected','request','request','inbox','accepted'];
 await store.transaction(async tx=>{
  let n=0;
  for(let c=0,m=0;c<channels||m<natives;){
   if(c<channels){const item=channelItem(++n,{state:states[c%states.length],hot:c===3?50:0});await putItem(tx,item,{body:c!==2,classifyPending:c===4});items.push(item);c++;}
   if(m<natives){const state=['inbox','pending','rejected','request','inbox'][m%5],item=nativeItem(++n,{state,hot:m===0?100:0,author:m%2?CAROL:ALICE});await putItem(tx,item,{classifyPending:m===4});items.push(item);m++;}
  }
  await tx.put(KEYS.usage,usageOf(items));
 });
 return store;
}
const snapshot=async store=>new Map([...await store.list({prefix:''})]);
// The reference outcome: the snapshot without retired rows and channel items (with every row they own), usage
// reduced by their hot bytes, the marker written, and the projection revision left to be checked separately.
function reference(before){
 const out=new Map(before),channel=[...before].filter(([k,v])=>k.startsWith('item/')&&v?.origin==='channel').map(([,v])=>v),ids=new Set(channel.map(i=>i.id));
 for(const key of before.keys()){
  if(isRetiredRow(key))out.delete(key);
  const id=key.split('/').at(-1);
  if((key.startsWith('pending/')||key.startsWith('rejected/'))&&ids.has(id))out.delete(key);
 }
 for(const id of ids)for(const key of [KEYS.item(id),KEYS.body(id),ROW+id,classifyPendingKey(id)])out.delete(key);
 const usage=before.get(KEYS.usage);if(usage)out.set(KEYS.usage,{...usage,hotBytes:usage.hotBytes-channel.reduce((n,i)=>n+(i.hot>0?i.hot:0),0),hotItems:usage.hotItems-channel.filter(i=>i.hot>0).length});
 out.set(EMAIL_BRIDGE_RESET_MARKER,{version:1,completedAt:NOW});out.delete(REV);
 return out;
}
const withoutRev=map=>{const m=new Map(map);m.delete(REV);return m;};
const runToEnd=async(store,options)=>{const calls=[];for(let i=0;i<2000;i++){const r=await resetEmailBridge(store,{now:NOW,...options});calls.push(r);if(r.done)return calls;}throw new Error('the reset did not finish');};
// Records each committed transaction's writes (puts and deletes in order).
function recording(store){
 const log=[],inner=store.transaction.bind(store);
 store.transaction=work=>inner(async tx=>{const writes=[],handle={get:k=>tx.get(k),list:o=>tx.list(o),put:(k,v)=>{writes.push(['put',k]);return tx.put(k,v);},delete:k=>{writes.push(['delete',k]);return tx.delete(k);}};const value=await work(handle);log.push(writes);return value;});
 return log;
}

test('the reset deletes exactly the retired families and channel items, in bounded pages and order, marker last',async()=>{
 const store=await legacyMailbox(),before=await snapshot(store),log=recording(store);
 assert.equal(EMAIL_BRIDGE_RESET,'parlay-email-bridge-retired-v1');assert.equal(EMAIL_BRIDGE_RESET_MARKER,'migration/parlay-email-bridge-retired-v1');
 assert.deepEqual([...EMAIL_BRIDGE_RESET_PREFIXES],['bridge/','intake/tx/','intake/jti/','allow/e/']);
 const calls=await runToEnd(store,{limit:3,page:2});
 assert.ok(calls.length>=10,`${calls.length} slices`);for(const r of calls.slice(0,-1))assert.equal(r.done,false);assert.equal(calls.at(-1).done,true);
 // Bounded: no transaction deletes more than `page` retired rows or channel items, no slice more than `limit` of either.
 for(const writes of log){const dels=writes.filter(([op])=>op==='delete').map(([,k])=>k);assert.ok(dels.filter(isRetiredRow).length<=2,JSON.stringify(writes));assert.ok(dels.filter(k=>k.startsWith('item/')).length<=2,JSON.stringify(writes));}
 // Order: bridge/, intake/tx/, intake/jti/, allow/e/, then channel items, then the marker as the very last write.
 const flat=log.flat(),family=k=>EMAIL_BRIDGE_RESET_PREFIXES.find(p=>k.startsWith(p))??(k.startsWith('item/')?'item/':null);
 const order=flat.filter(([op,k])=>op==='delete'&&family(k)).map(([,k])=>family(k));
 assert.deepEqual([...new Set(order)],[...EMAIL_BRIDGE_RESET_PREFIXES,'item/']);
 for(let i=1;i<order.length;i++)assert.ok([...EMAIL_BRIDGE_RESET_PREFIXES,'item/'].indexOf(order[i])>=[...EMAIL_BRIDGE_RESET_PREFIXES,'item/'].indexOf(order[i-1]),'families never interleave');
 const markerAt=flat.findIndex(([op,k])=>op==='put'&&k===EMAIL_BRIDGE_RESET_MARKER);assert.equal(markerAt,flat.length-1,'the marker is the last write');
 assert.deepEqual(log.at(-1),[['delete',`${EMAIL_BRIDGE_RESET_MARKER}/items`],['put',EMAIL_BRIDGE_RESET_MARKER]]);
 // The total reported equals the rows actually removed (retired rows, items, pending/Rejected rows and bodies).
 const after=await snapshot(store);
 assert.deepEqual(withoutRev(after),reference(before));
 // Spot checks on what the reference encodes.
 assert.deepEqual([...after.keys()].filter(isRetiredRow),[]);
 const kept=[...after].filter(([k])=>k.startsWith('item/')).map(([,v])=>v);assert.equal(kept.length,5);assert.ok(kept.every(i=>i.origin==='native'));
 assert.equal([...after.keys()].filter(k=>k.startsWith(ROW)).length,5,'native projections stay');
 assert.deepEqual([...after.keys()].filter(k=>k.startsWith('pending/')).map(k=>after.get(k).id),kept.filter(i=>i.state==='pending').map(i=>i.id),'native pending requests stay');
 assert.deepEqual([...after.keys()].filter(k=>k.startsWith('rejected/')).map(k=>after.get(k).id),kept.filter(i=>i.state==='rejected').map(i=>i.id));
 assert.deepEqual([...after.keys()].filter(k=>k.startsWith('bb:classify:pending/')),[classifyPendingKey(kept.at(-1).id)]);
 assert.deepEqual(after.get(KEYS.usage),{hotBytes:100,hotItems:1,rejected:0});
 for(const key of [`allow/p/${principalKey(ALICE)}`,KEYS.settings,'bridges/unrelated','intake/other','allow/everyone','storage-gc/parlay%2Fv1%2Fitems%2Fq',CONTACT_LINKS_RESET_MARKER])assert.deepEqual(after.get(key),before.get(key),key);
 assert.ok(after.get(REV)>before.get(REV),'removing projected rows bumps the projection revision');
 assert.equal(after.has(`${EMAIL_BRIDGE_RESET_MARKER}/items`),false,'the cursor row is gone');
 const removed=before.size-after.size+1;assert.equal(calls.reduce((n,r)=>n+r.deleted,0)+[...before.keys()].filter(k=>k.startsWith(ROW)||k.startsWith('bb:classify:pending/')).filter(k=>!after.has(k)).length,removed,'deleted counts every removed row but the projection and classify entries');
});

test('the reset is idempotent: a second run, a run after the marker and an empty mailbox do no work',async()=>{
 const store=await legacyMailbox();await runToEnd(store,{});const done=await snapshot(store);
 assert.deepEqual(await resetEmailBridge(store,{now:NOW+1}),{done:true,deleted:0});assert.deepEqual(await snapshot(store),done);
 // Rows written after the marker (for example by an archive import) are not touched again.
 await store.put('bridge/settings',{late:true});await store.put(KEYS.item(itemId(9999)),channelItem(9999));
 assert.deepEqual(await resetEmailBridge(store,{now:NOW}),{done:true,deleted:0});assert.ok(await store.get('bridge/settings'));assert.ok(await store.get(KEYS.item(itemId(9999))));
 const empty=memoryStore([['owner',OWNER]]);assert.deepEqual(await resetEmailBridge(empty,{now:NOW}),{done:true,deleted:0});assert.deepEqual(await empty.get(EMAIL_BRIDGE_RESET_MARKER),{version:1,completedAt:NOW});
 assert.deepEqual([...(await empty.list({prefix:''})).keys()].sort(),[EMAIL_BRIDGE_RESET_MARKER,'owner'].sort());
 // A mailbox with no channel items keeps every item row byte for byte.
 const native=await legacyMailbox({channels:0,retired:0}),nativeBefore=await snapshot(native);await runToEnd(native,{limit:2,page:1});
 const nativeAfter=withoutRev(await snapshot(native));nativeAfter.delete(EMAIL_BRIDGE_RESET_MARKER);const expected=withoutRev(nativeBefore);expected.delete('bridge/settings');
 assert.deepEqual(nativeAfter,expected);assert.equal((await native.get(REV)),nativeBefore.get(REV),'nothing projected changed');
});

test('slices resume across a cursor: exact page boundaries, a channel item on every boundary and items added mid-run',async()=>{
 for(const [limit,page] of [[1,1],[2,1],[2,2],[3,2],[5,3],[6,6],[11,4],[256,64]]){
  const store=await legacyMailbox({channels:7,natives:7,retired:3}),before=await snapshot(store);
  await runToEnd(store,{limit,page});assert.deepEqual(withoutRev(await snapshot(store)),reference(before),`limit ${limit} page ${page}`);
 }
 // A native item and a native request written between slices (keys before and after the cursor) are both kept.
 const store=await legacyMailbox({channels:4,natives:2,retired:1});let inserted=false;
 for(;;){const r=await resetEmailBridge(store,{now:NOW,limit:2,page:1});if(r.done)break;
  // Once the item pass is under way (its cursor row exists), on both sides of the cursor.
  if(!inserted&&await store.get(`${EMAIL_BRIDGE_RESET_MARKER}/items`)!==undefined){inserted=true;await store.transaction(async tx=>{await putItem(tx,nativeItem(0));await putItem(tx,nativeItem(9000,{state:'pending'}));});}}
 assert.equal(inserted,true);
 assert.ok(await store.get(KEYS.item(itemId(0))));assert.ok(await store.get(KEYS.item(itemId(9000))));assert.ok(await store.get(KEYS.pending(NOW-100000+9000,itemId(9000))));
 assert.equal([...(await store.list({prefix:'item/'})).values()].some(i=>i.origin==='channel'),false);
});

test('a crash in any transaction (before commit or with a lost reply) resumes to the same final state as a clean run',async()=>{
 const clean=await legacyMailbox();await runToEnd(clean,{limit:3,page:2});const expected=await snapshot(clean);
 for(let n=1;n<=24;n++)for(const mode of ['throw','after']){
  const store=await legacyMailbox(),inner=store.transaction.bind(store);let count=0,crashed=false;
  store.transaction=work=>{count++;if(count===n){crashed=true;if(mode==='throw')return Promise.reject(new Error('crash'));return inner(work).then(()=>{throw new Error('lost reply');});}return inner(work);};
  for(let i=0;i<1000;i++){try{if((await resetEmailBridge(store,{now:NOW,limit:3,page:2})).done)break;}catch{}}
  assert.ok(crashed||n>count,`transaction ${n}`);assert.deepEqual(await snapshot(store),expected,`crash ${mode} at transaction ${n}`);
 }
});

test('the reset operation runs for system and owner actors only; the app shell runs it after the contact-links reset on open and from the alarm',async t=>{
 const store=await legacyMailbox(),e=createTestEngine({owner:OWNER,store,providers:{contacts:ContactsDomain,receive:ReceiveDomain}});t.after(()=>e.dispose());
 await assert.rejects(e.perform(new MailboxResetEmailBridge({actor:{kind:'ingress',owner:OWNER},input:{}})),{code:'unauthorized'});
 const first=await e.perform(new MailboxResetEmailBridge({actor:{kind:'system',owner:OWNER},input:{limit:3,page:1}}));assert.equal(first.done,false);assert.ok(first.deleted<=3);
 for(let i=0;i<100;i++)if((await e.run('mailbox.reset-email-bridge')).done)break;assert.ok(await store.get(EMAIL_BRIDGE_RESET_MARKER));
 // createMailbox: opening a pre-removal mailbox (here also without the contact-links marker) runs the contact-links
 // reset first, then this one, before the requested operation.
 const shellStore=await legacyMailbox();await shellStore.delete(CONTACT_LINKS_RESET_MARKER);const before=await snapshot(shellStore),log=recording(shellStore);
 const box=createMailbox({store:shellStore,PARLAY_ENABLED:true,clock:{now:()=>NOW}});t.after(()=>box.dispose());
 await box.open(OWNER);
 const flat=log.flat(),contactMarker=flat.findIndex(([op,k])=>op==='put'&&k===CONTACT_LINKS_RESET_MARKER),bridgeMarker=flat.findIndex(([op,k])=>op==='put'&&k===EMAIL_BRIDGE_RESET_MARKER),firstRetired=flat.findIndex(([op,k])=>op==='delete'&&isRetiredRow(k));
 assert.ok(contactMarker>=0&&contactMarker<firstRetired&&firstRetired<bridgeMarker,'contact-links reset first, then the email-bridge reset');
 const opened=withoutRev(await snapshot(shellStore)),expected=reference(before);
 for(const [key,value] of expected)if(!key.startsWith('migration/'))assert.deepEqual(opened.get(key),value,key);
 assert.equal([...opened.keys()].some(k=>isRetiredRow(k)),false);assert.equal([...opened.values()].some(v=>v?.origin==='channel'),false);
 // The owner's request and Rejected views list only native items afterwards.
 assert.deepEqual((await box.run(OWNER,'intake.requests')).map(r=>r.origin),['native']);assert.deepEqual((await box.run(OWNER,'intake.rejected')).map(r=>r.origin),['native']);
 // The alarm runs it too.
 const alarmStore=await legacyMailbox(),alarmBox=createMailbox({store:alarmStore,PARLAY_ENABLED:true,clock:{now:()=>NOW}});t.after(()=>alarmBox.dispose());
 await alarmBox.alarm();assert.ok(await alarmStore.get(EMAIL_BRIDGE_RESET_MARKER));assert.equal((await alarmStore.list({prefix:'bridge/'})).size,0);
 // A reopened mailbox costs one marker read per reset and changes nothing.
 const settled=await snapshot(shellStore);await box.open(OWNER);assert.deepEqual(withoutRev(await snapshot(shellStore)),withoutRev(settled));
 // The operation is not part of the browser's owner API.
 const {WEB_OPERATIONS}=await import('../../apps/parlay/web/providers/mailbox.mjs');assert.equal(WEB_OPERATIONS.includes('mailbox.reset-email-bridge'),false);
});

// ---- Seeded chaos: random mailbox shapes, the reset in random small slices (limit 1–6, page 1–3) with random
// crashes (before commit or after it with a lost reply), interleaved with native activity: new native items and
// requests, principal allowlist adds, and unrelated rows. Reference: the initial snapshot through `reference`, plus
// everything the interleaved writes added; channel items and retired rows are never left behind and the usage
// totals match the kept hot items exactly.
test('seeded chaos: random slices, crashes and interleaved native writes end at the reference state',async()=>{
 let crashes=0,slices=0;
 await forEachSeed(40,async random=>{
  const store=await legacyMailbox({channels:random.int(9),natives:random.int(7),retired:random.int(6)}),initial=await snapshot(store),inner=store.transaction.bind(store);
  const added=new Map();let crash=0,next=5000;
  store.transaction=work=>{if(crash>0&&random.chance(.15)){crash--;crashes++;if(random.chance(.5))return Promise.reject(new Error('crash'));return inner(work).then(()=>{throw new Error('lost reply');});}return inner(work);};
  const native=async()=>{const item=nativeItem(++next,{state:random.pick(['inbox','pending','request']),author:random.chance(.5)?ALICE:CAROL});const writes=new Map();
   await inner(async tx=>{await putItem(tx,item);for(const key of [KEYS.item(item.id),KEYS.body(item.id),ROW+item.id,`by-jkt/${item.author.jkt}/${item.id}`,...item.state==='pending'?[KEYS.pending(item.receivedAt,item.id)]:[]])writes.set(key,await tx.get(key));});
   for(const [k,v] of writes)added.set(k,v);};
  let done=false;
  for(let step=0;step<3000&&!done;step++){
   const roll=random.int(6);
   if(roll<3){crash=random.chance(.3)?1:0;slices++;try{done=(await resetEmailBridge(store,{now:NOW,limit:1+random.int(6),page:1+random.int(3)})).done;}catch{}}
   else if(roll===3)await native();
   else if(roll===4){const key=`allow/p/${principalKey(person(`p${step}`,1000+step))}`,value={at:NOW,principal:person(`p${step}`,1000+step)};await inner(tx=>tx.put(key,value));added.set(key,value);}
   else{const key=`note/${step}`;await inner(tx=>tx.put(key,{step}));added.set(key,{step});}
  }
  crash=0;for(let i=0;i<500&&!done;i++)done=(await resetEmailBridge(store,{now:NOW})).done;
  assert.equal(done,true);
  const expected=reference(initial);for(const [k,v] of added)expected.set(k,v);
  const final=await snapshot(store);assert.deepEqual(withoutRev(final),expected);
  const kept=[...final].filter(([k])=>k.startsWith('item/')).map(([,v])=>v);assert.deepEqual(final.get(KEYS.usage),usageOf(kept));
  assert.equal(kept.some(i=>i.origin==='channel'),false);assert.deepEqual([...final.keys()].filter(isRetiredRow),[]);
  // Every projected row belongs to a kept item, and every kept non-pending item stays projected.
  const ids=new Set(kept.map(i=>i.id));for(const key of final.keys())if(key.startsWith(ROW))assert.ok(ids.has(key.slice(ROW.length)),key);
  for(const i of kept)assert.ok(final.has(ROW+i.id),i.id);
 });
 assert.ok(crashes>=10&&slices>=200,`the run exercised ${crashes} crashes over ${slices} slices`);
});
