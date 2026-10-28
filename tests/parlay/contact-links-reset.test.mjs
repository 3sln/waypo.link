// Contacts spike phase 4 reset `parlay-contact-links-retired-v1` (docs/architecture/contacts-and-links-rethink.md §9;
// packages/messaging-engine/domains/contact-links-reset.mjs): bounded pages, idempotency, deletion order, marker last,
// what it keeps, the Contacts seeding rule (accepted two-party peers only; never group-only, blocked, inactive or
// unaccepted peers; never a duplicate), crash resume, the app-shell lifecycle, the instance-index half, and a seeded
// chaos run interleaving the reset with blocks, list changes and newly accepted conversations against a reference model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestEngine,memoryStore} from './helpers/engine.mjs';
import {forEachSeed} from '../helpers/chaos.mjs';
import {ContactsDomain,ReceiveDomain,principalKey} from '../../packages/messaging-engine/store/mailbox.mjs';
import {resetContactLinks,MailboxResetContactLinks,CONTACT_LINKS_RESET_MARKER,CONTACT_LINKS_RESET_PREFIXES} from '../../packages/messaging-engine/domains/contact-links-reset.mjs';
import {resetEdgeIndexLinks,EDGE_LINKS_RESET_MARKER,createEdgeIndex} from '../../packages/messaging-engine/store/edge-index.mjs';
import {createMailbox} from '../../apps/parlay/worker/mailbox.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NOW=Date.UTC(2026,9,28,12);
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const person=(name,n)=>({issuer:`https://${name}.provider.example`,subject:uuid(n),identityURI:`https://${name}.provider.example/identity/${uuid(n)}`});
const who=p=>({issuer:p.issuer,subject:p.subject});
const ME=person('owner',1);
const memberKey=(list,p)=>`list-member/${list}/${principalKey(p)}`,memberOf=(p,list)=>`member-of/${principalKey(p)}/${list}`;
const LEGACY=['edge-outbox/','decision/','contact-link/','known/','contact/','parent/'];
const isLegacy=key=>CONTACT_LINKS_RESET_PREFIXES.some(p=>key.startsWith(p));

// A room with the owner and `peers`; each peer row in `state`.
function room(cid,peers,{state='active',peerState='accepted'}={}){
 const rows=[[`conv/room/${cid}`,{id:cid,role:'creator',state,subject:'',participants:[{principal:ME,keyId:`${ME.identityURI}#k1`},...peers.map(p=>({principal:p,keyId:`${p.identityURI}#k1`}))]}]];
 for(const p of peers)rows.push([`conv/peer/${cid}/${principalKey(p)}`,{principal:p,keyId:`${p.identityURI}#k1`,state:peerState,outbound:{ingress:`https://${new URL(p.issuer).host.split('.')[0]}.box.example/ingress`,incarnation:'inc'}}]);
 return rows;
}
const P={alice:person('alice',2),bob:person('bob',3),carol:person('carol',4),dave:person('dave',5),erin:person('erin',6),frank:person('frank',7),gina:person('gina',8)};
// Pre-phase-4 mailbox: link families (sized to need several pages), a block and conversations. `curated` adds what a
// mailbox that used phase 3 lists holds: invitations, the built-in list row and alice in Contacts through an invitation.
function legacyMailbox({links=7,curated=false}={}){
 const rows=[['owner',OWNER],['config',{principal:ME,ingress:'https://owner.box.example/ingress',plan:'free'}]];
 for(let i=0;i<links;i++){
  rows.push([`parent/jti-${i}`,{jti:`jti-${i}`,iss:ME.issuer,revoked:false,link:'https://owner.provider.example/c?bindle_meta=a.b.c'}]);
  rows.push([`contact/${uuid(100+i)}`,{id:uuid(100+i),principal:who(P.gina),jti:`their-${i}`}]);
  rows.push([`contact-link/${encodeURIComponent(P.gina.issuer)}/their-${i}`,uuid(100+i)]);
  rows.push([`decision/jti-${i}/${principalKey(P.gina)}`,{state:'eligible',until:NOW+1}]);
 }
 rows.push([`known/${principalKey(P.gina)}`,{principal:who(P.gina),contacts:[uuid(100)]}]);
 // Queued edge publications: two contact-link entries (no kind) and one live hosted-recipient entry.
 rows.push(['edge-outbox/0000000000000001',{iss:ME.issuer,jti:'jti-0',claimsDigest:'d',revoked:false,generation:1}],['edge-outbox/0000000000000002',{kind:'host',issuer:ME.issuer,subject:ME.subject,active:true,generation:2}],['edge-outbox/0000000000000003',{iss:ME.issuer,jti:'jti-1',claimsDigest:'d',revoked:true,generation:3}],['edge-seq',3]);
 // Invitations and lists (kept): alice joined through an invitation and is already in Contacts.
 if(curated){
  rows.push(['inv/link/'+uuid(900),{id:uuid(900),state:'live',tokenDigest:'t'.repeat(43)}],['inv/token/'+'t'.repeat(43),uuid(900)],['inv/rule/'+uuid(901),{id:uuid(901),when:{link:uuid(900)},place:['contacts']}]);
  rows.push(['list/contacts',{id:'contacts',name:'Contacts',policy:'message',builtin:true,createdAt:NOW-1}],[memberKey('contacts',P.alice),{principal:who(P.alice),list:'contacts',addedAt:NOW-1,via:{kind:'invite',invite:uuid(900)}}],[memberOf(P.alice,'contacts'),{list:'contacts'}]);
 }
 rows.push([`block/${principalKey(P.carol)}`,{principal:who(P.carol),at:NOW-1}]);
 // Conversations: alice (two-party and group), bob, carol (blocked), dave (invited only), erin (group only),
 // frank (two-party but the room is no longer active).
 rows.push(...room(uuid(501),[P.alice]),...room(uuid(502),[P.bob]),...room(uuid(503),[P.carol]),...room(uuid(504),[P.dave],{peerState:'invited'}),...room(uuid(505),[P.erin,P.alice]),...room(uuid(506),[P.frank],{state:'left'}));
 rows.push([`item/x`,{id:'x',state:'inbox'}]);
 return rows;
}
const snapshot=async store=>new Map([...await store.list({prefix:''})]);
const members=async store=>new Map([...await store.list({prefix:'list-member/contacts/'})].map(([,m])=>[principalKey(m.principal),m]));
const runToEnd=async(store,options)=>{const calls=[];for(let i=0;i<1000;i++){const r=await resetContactLinks(store,{now:NOW,...options});calls.push(r);if(r.done)return calls;}throw new Error('the reset did not finish');};
// Records each committed transaction's writes (puts and deletes in order).
function recording(store){
 const log=[],inner=store.transaction.bind(store);
 store.transaction=work=>inner(async tx=>{const writes=[],handle={get:k=>tx.get(k),list:o=>tx.list(o),put:(k,v)=>{writes.push(['put',k]);return tx.put(k,v);},delete:k=>{writes.push(['delete',k]);return tx.delete(k);}};const value=await work(handle);log.push(writes);return value;});
 return log;
}

test('the reset deletes the link families in bounded pages, in order, seeds Contacts and writes its marker last',async()=>{
 const store=memoryStore(legacyMailbox()),log=recording(store),before=await snapshot(store);
 const calls=await runToEnd(store,{limit:5,page:2});
 assert.ok(calls.length>=8,`${calls.length} slices`);
 for(const r of calls.slice(0,-1))assert.equal(r.done,false);
 // Bounded: no transaction touches more than `page` rows of a deleted family, no slice more than `limit`.
 for(const writes of log)assert.ok(writes.filter(([op,k])=>op==='delete'&&isLegacy(k)).length<=2,JSON.stringify(writes));
 for(const r of calls)assert.ok(r.deleted<=5);
 // Order: queued link publications, then decision/, contact-link/, known/, contact/, parent/ (parents last), then
 // seeding, then the marker in the final transaction with nothing after it.
 const order=log.flat().filter(([op,k])=>op==='delete'&&LEGACY.some(p=>k.startsWith(p))).map(([,k])=>LEGACY.find(p=>k.startsWith(p)));
 assert.deepEqual([...new Set(order)],LEGACY);
 for(let i=1;i<order.length;i++)assert.ok(LEGACY.indexOf(order[i])>=LEGACY.indexOf(order[i-1]),'families never interleave');
 const flat=log.flat(),markerAt=flat.findIndex(([op,k])=>op==='put'&&k===CONTACT_LINKS_RESET_MARKER),seededAt=flat.findIndex(([op,k])=>op==='put'&&k===memberKey('contacts',P.bob)),lastParent=flat.findLastIndex(([op,k])=>op==='delete'&&k.startsWith('parent/'));
 assert.ok(lastParent<seededAt&&seededAt<markerAt);assert.equal(markerAt,flat.length-1,'the marker is the last write');
 assert.deepEqual(log.at(-1).map(([,k])=>k).sort(),[`${CONTACT_LINKS_RESET_MARKER}/outbox`,`${CONTACT_LINKS_RESET_MARKER}/rooms`,CONTACT_LINKS_RESET_MARKER].sort());
 assert.equal(calls.at(-1).done,true);assert.equal(calls.reduce((n,r)=>n+r.seeded,0),2);
 // Everything retired is gone; the live edge publication and every other family is untouched.
 const after=await snapshot(store);
 assert.deepEqual([...after.keys()].filter(isLegacy),[]);
 assert.deepEqual([...after.keys()].filter(k=>k.startsWith('edge-outbox/')),['edge-outbox/0000000000000002']);
 // Untouched; the reset writes no list row (the built-in Contacts definition is implied).
 for(const [key,value] of before)if(!isLegacy(key)&&!(key.startsWith('edge-outbox/')&&key!=='edge-outbox/0000000000000002'))assert.deepEqual(after.get(key),value,key);
 assert.equal(after.get('list/contacts'),undefined);
 assert.ok(await store.get(CONTACT_LINKS_RESET_MARKER));
});

test('seeding: accepted two-party peers only, with their binding; no group, blocked, inactive, unaccepted or duplicate members',async()=>{
 const store=memoryStore(legacyMailbox());await runToEnd(store,{});
 const m=await members(store);
 assert.deepEqual([...m.keys()].sort(),[principalKey(P.alice),principalKey(P.bob)].sort());
 assert.deepEqual(m.get(principalKey(P.alice)).via,{kind:'reset',reset:'parlay-contact-links-retired-v1'});
 const bob=m.get(principalKey(P.bob));assert.deepEqual(bob.principal,who(P.bob));assert.deepEqual(bob.via,{kind:'reset',reset:'parlay-contact-links-retired-v1'});
 assert.deepEqual(bob.binding,{keyId:`${P.bob.identityURI}#k1`,ingress:'https://bob.box.example/ingress',identityURI:P.bob.identityURI});
 assert.deepEqual(await store.get(memberOf(P.bob,'contacts')),{list:'contacts'});
 // Alice is in a two-party and a group room: one membership, with the two-party binding.
 assert.equal(m.get(principalKey(P.alice)).binding.ingress,'https://alice.box.example/ingress');assert.equal((await store.list({prefix:`member-of/${principalKey(P.alice)}/`})).size,1);
 for(const p of [P.carol,P.dave,P.erin,P.frank,ME])assert.equal(await store.get(memberKey('contacts',p)),undefined,p.issuer);
 assert.ok(await store.get(`block/${principalKey(P.carol)}`),'the block stays');
});

test('the reset is idempotent: a second run, a run after the marker and an empty mailbox do no work',async()=>{
 const store=memoryStore(legacyMailbox());await runToEnd(store,{});const done=await snapshot(store);
 assert.deepEqual(await resetContactLinks(store,{now:NOW+1}),{done:true,deleted:0,seeded:0});assert.deepEqual(await snapshot(store),done);
 // Rows written after the marker (for example by an import) are not touched again.
 await store.put('parent/late',{});assert.deepEqual(await resetContactLinks(store,{now:NOW}),{done:true,deleted:0,seeded:0});assert.ok(await store.get('parent/late'));
 const empty=memoryStore([['owner',OWNER]]);assert.deepEqual(await resetContactLinks(empty,{now:NOW}),{done:true,deleted:0,seeded:0});assert.ok(await empty.get(CONTACT_LINKS_RESET_MARKER));
});

test('a crash in any transaction resumes to the same final state as a clean run',async()=>{
 const clean=memoryStore(legacyMailbox());await runToEnd(clean,{limit:5,page:2});const expected=await snapshot(clean);
 for(let n=1;n<=16;n++)for(const mode of ['throw','after']){
  const store=memoryStore(legacyMailbox()),inner=store.transaction.bind(store);let count=0;
  store.transaction=work=>{count++;if(count===n){if(mode==='throw')return Promise.reject(new Error('crash'));return inner(work).then(()=>{throw new Error('lost reply');});}return inner(work);};
  for(let i=0;i<1000;i++){try{if((await resetContactLinks(store,{now:NOW,limit:5,page:2})).done)break;}catch{}}
  assert.deepEqual(await snapshot(store),expected,`crash ${mode} at transaction ${n}`);
 }
});

test('the reset operation runs for system and owner actors only, and the app shell runs it on open and from the alarm',async t=>{
 const store=memoryStore(legacyMailbox()),e=createTestEngine({owner:OWNER,store,providers:{contacts:ContactsDomain,receive:ReceiveDomain}});t.after(()=>e.dispose());
 await assert.rejects(e.perform(new MailboxResetContactLinks({actor:{kind:'ingress',owner:OWNER},input:{}})),{code:'unauthorized'});
 const first=await e.perform(new MailboxResetContactLinks({actor:{kind:'system',owner:OWNER},input:{limit:3}}));assert.equal(first.done,false);assert.ok(first.deleted<=3);
 for(let i=0;i<100;i++)if((await e.run('mailbox.reset-contact-links')).done)break;assert.ok(await store.get(CONTACT_LINKS_RESET_MARKER));
 // createMailbox: opening a pre-phase-4 mailbox completes the reset before the requested operation runs.
 const shellStore=memoryStore(legacyMailbox()),box=createMailbox({store:shellStore,PARLAY_ENABLED:true,clock:{now:()=>NOW}});t.after(()=>box.dispose());
 await box.open(OWNER);assert.ok(await shellStore.get(CONTACT_LINKS_RESET_MARKER));assert.deepEqual([...(await shellStore.list({prefix:'parent/'})).keys()],[]);
 assert.equal((await box.run(OWNER,'lists.members',{input:{list:'contacts'}})).members.length,2);
 // The alarm finishes a reset that open left unfinished (here: rows that reappear before the marker is written).
 const alarmStore=memoryStore(legacyMailbox()),alarmBox=createMailbox({store:alarmStore,PARLAY_ENABLED:true,clock:{now:()=>NOW}});t.after(()=>alarmBox.dispose());
 await alarmBox.alarm();assert.ok(await alarmStore.get(CONTACT_LINKS_RESET_MARKER));assert.equal((await alarmStore.list({prefix:'contact/'})).size,0);
 // The operation is not part of the browser's owner API.
 const {WEB_OPERATIONS}=await import('../../apps/parlay/web/providers/mailbox.mjs');assert.equal(WEB_OPERATIONS.includes('mailbox.reset-contact-links'),false);
});

test('the instance-index half deletes retired link entries in pages, keeps invitation, hosted and conversation entries, marker last',async()=>{
 const rows=[];for(let i=0;i<9;i++)rows.push([`link/${encodeURIComponent('https://bob.provider.example')}/jti-${i}`,{owner:OWNER,claimsDigest:'d',revoked:false,generation:i}]);
 rows.push(['invite/'+'d'.repeat(43),{owner:OWNER,state:'live',redeemers:[],expiresAt:NOW+1,generation:1}],['host/x|y',{owner:OWNER,active:true,generation:1}],['conv-peer/k',{owner:OWNER}],['conv-route/r',{owner:OWNER}]);
 const store=memoryStore(rows),log=recording(store),calls=[];
 for(let i=0;i<20;i++){const r=await resetEdgeIndexLinks(store,{limit:4,page:2,now:()=>NOW});calls.push(r);if(r.done)break;}
 assert.deepEqual(calls.map(r=>r.done),[false,false,true]);assert.ok(calls.every(r=>r.deleted<=4));
 for(const writes of log)assert.ok(writes.filter(([op])=>op==='delete').length<=2);
 assert.deepEqual(log.at(-1),[['put',EDGE_LINKS_RESET_MARKER]]);
 assert.deepEqual([...(await store.list({prefix:''})).keys()].sort(),['conv-peer/k','conv-route/r','host/x|y','invite/'+'d'.repeat(43),EDGE_LINKS_RESET_MARKER].sort());
 assert.deepEqual(await resetEdgeIndexLinks(store),{done:true,deleted:0});
 assert.equal(await createEdgeIndex(store).hosted('x','y'),OWNER,'the hosted-recipient entry still routes');
});

// ---- Seeded chaos: the reset in small slices interleaved with blocks, unblocks, list adds/removes and newly accepted
// two-party or group conversations. Reference model (rethink §9 seeding rule; reset reads live rows per room):
//  - lower bound: every peer of a two-party room that was accepted and active before the reset started and stayed so,
//    who was never blocked and never removed from Contacts during the run, ends in Contacts;
//  - upper bound: a membership created by the reset (via `reset`) belongs to a principal that was, at some moment, the
//    accepted peer of an active two-party room while not blocked; never to a principal only ever seen in group rooms;
//  - memberships made by lists.add keep `manual`; nothing is duplicated (member-of agrees with list-member exactly);
//  - every retired row is gone, the marker exists, its cursor rows are gone, and blocks equal the model's.
test('seeded chaos: the reset interleaved with blocks, list changes and new conversations keeps the seeding model',async()=>{
 const people=Array.from({length:10},(_,i)=>person(`p${i}`,200+i));
 await forEachSeed(25,async random=>{
  const rows=legacyMailbox({links:3}).filter(([k])=>!k.startsWith('conv/')&&!k.startsWith('block/'));
  const store=memoryStore(rows),e=createTestEngine({seed:random.seed,owner:OWNER,store,providers:{contacts:ContactsDomain,receive:ReceiveDomain}});
  try{
   // Curation (any lists.add or lists.remove) stops seeding for good (M1): `atCuration` is the set of reset-created
   // memberships just before the first curation; no reset membership exists afterwards that was not in it.
   let atCuration=null;const resetMembers=async()=>new Set([...await members(store)].filter(([,m])=>m.via?.kind==='reset').map(([k])=>k));
   const curate=async()=>{if(!atCuration)atCuration=await resetMembers();};
   const blocked=new Set(),removed=new Set(),unblocked=new Set(),everEligible=new Set(),groupOnly=new Set(),twoParty=new Set(),rooms=new Map();let cid=1000;
   const pkOf=p=>principalKey(p);
   const accept=async(peers,{active=true}={})=>{const id=uuid(++cid);await store.transaction(async tx=>{for(const [k,v] of room(id,peers,{state:active?'active':'left'}))await tx.put(k,v);});rooms.set(id,{peers,active});
    for(const p of peers){if(peers.length===1){twoParty.add(pkOf(p));if(active&&!blocked.has(pkOf(p)))everEligible.add(pkOf(p));}else if(!twoParty.has(pkOf(p)))groupOnly.add(pkOf(p));}};
   // State before the reset starts.
   const initial=new Set();
   for(const p of people.slice(0,6))if(random.chance(.6)){await accept([p]);initial.add(pkOf(p));}
   await accept([people[6],people[7]]);
   // Some initial peers are already list members (added by hand): the reset must keep those rows, never re-create them.
   const manualBefore=new Set();if(random.chance(.4))for(const p of people.slice(0,6))if(random.chance(.3)){await curate();await e.run('lists.add',{input:{list:'contacts',principal:who(p)}});manualBefore.add(pkOf(p));}
   for(const p of people)if(random.chance(.15)){await e.run('contacts.block',{input:{principal:who(p)}});blocked.add(pkOf(p));}
   const blockedBefore=new Set(blocked),blockedDuring=new Set();
   for(const p of initial)if(blocked.has(p))everEligible.delete(p);
   // Interleave.
   let done=false;
   for(let step=0;step<200&&!done;step++){
    const roll=random.int(6),p=random.pick(people);
    if(roll===0)done=(await e.run('mailbox.reset-contact-links',{input:{limit:1+random.int(4),page:1+random.int(2)}})).done;
    else if(roll===1){await e.run('contacts.block',{input:{principal:who(p)}});blocked.add(pkOf(p));blockedDuring.add(pkOf(p));}
    else if(roll===2){await e.run('contacts.block',{input:{principal:who(p),blocked:false}});if(blocked.delete(pkOf(p)))unblocked.add(pkOf(p));}
    else if(roll===3){await curate();if(random.chance(.5)){await e.run('lists.add',{input:{list:'contacts',principal:who(p)}});}else{await e.run('lists.remove',{input:{list:'contacts',principal:who(p)}});removed.add(pkOf(p));}}
    else if(roll===4)await accept(random.chance(.7)?[p]:[p,random.pick(people.filter(x=>x!==p))],{active:random.chance(.85)});
    else{for(const [id,r] of rooms)if(r.active&&random.chance(.1)){await store.transaction(async tx=>{const row=await tx.get(`conv/room/${id}`);await tx.put(`conv/room/${id}`,{...row,state:'left'});});r.active=false;}}
   }
   for(let i=0;i<500&&!done;i++)done=(await e.run('mailbox.reset-contact-links')).done;
   assert.equal(done,true);
   // Lower bound.
   const contacts=await members(store);
   const stayed=p=>[...rooms.values()].some(r=>r.peers.length===1&&pkOf(r.peers[0])===p&&r.active);
   if(!atCuration)for(const p of initial)if(!blockedBefore.has(p)&&!blockedDuring.has(p)&&!removed.has(p)&&stayed(p))assert.ok(contacts.has(p),`missing ${p}`);
   // Upper bound and provenance.
   for(const [key,m] of contacts){
    if(m.via?.kind==='reset'){assert.ok(twoParty.has(key),`group-only or unknown ${key}`);
     if(atCuration)assert.ok(atCuration.has(key),`seeded after curation ${key}`);assert.equal(removed.has(key),false,`removed ${key} re-added`);assert.ok(everEligible.has(key)||unblocked.has(key),`never eligible ${key}`);}
    else assert.equal(m.via?.kind,'manual');
   }
   for(const key of groupOnly)if(!twoParty.has(key))assert.notEqual(contacts.get(key)?.via?.kind,'reset',`group peer ${key} seeded`);
   // A principal blocked from before the reset until its end was never seeded.
   for(const key of blockedBefore)if(!unblocked.has(key))assert.notEqual(contacts.get(key)?.via?.kind,'reset',`blocked ${key} seeded`);
   for(const key of manualBefore)if(!removed.has(key))assert.equal(contacts.get(key)?.via?.kind,'manual',`manual ${key} overwritten`);
   // No duplicates; indexes agree.
   const index=new Set([...(await store.list({prefix:'member-of/'})).keys()].filter(k=>k.endsWith('/contacts')).map(k=>k.slice('member-of/'.length,-'/contacts'.length)));
   assert.deepEqual([...index].sort(),[...contacts.keys()].sort());
   // Retired rows gone, marker present, cursors gone, blocks as modelled.
   const all=await snapshot(store);
   assert.deepEqual([...all.keys()].filter(isLegacy),[]);assert.ok(all.get(CONTACT_LINKS_RESET_MARKER));
   assert.deepEqual([...all.keys()].filter(k=>k.startsWith(`${CONTACT_LINKS_RESET_MARKER}/`)),[]);
   assert.deepEqual([...all.values()].filter(v=>v&&typeof v==='object'&&'jti'in v&&'claimsDigest'in v&&!v.kind),[]);
   assert.deepEqual([...all.keys()].filter(k=>k.startsWith('block/')).map(k=>k.slice(6)).sort(),[...blocked].sort());
   // Seeded members carry a usable binding.
   for(const m of contacts.values())if(m.via?.kind==='reset')assert.equal(typeof m.binding?.ingress,'string');
  }finally{await e.dispose();}
 });
});

test('a peer blocked when the reset reaches its room is not seeded, even if unblocked afterwards',async()=>{
 const rows=legacyMailbox({links:1}).filter(([k])=>!k.startsWith('conv/'));rows.push(...room(uuid(700),[P.bob]),...room(uuid(701),[P.dave]));
 const store=memoryStore(rows);
 const e=createTestEngine({owner:OWNER,store,providers:{contacts:ContactsDomain,receive:ReceiveDomain}});
 try{
  await e.run('contacts.block',{input:{principal:who(P.dave)}});
  for(let i=0;i<100;i++)if((await e.run('mailbox.reset-contact-links')).done)break;
  await e.run('contacts.block',{input:{principal:who(P.dave),blocked:false}});
  const m=await members(store);assert.ok(m.has(principalKey(P.bob)));assert.equal(m.has(principalKey(P.dave)),false);
 }finally{await e.dispose();}
});

// ---- M1 (review 2026-10-28): seeding never widens a narrower placement and never undoes a removal.
import {firstContactPolicy} from '../../packages/messaging-engine/domains/invites.mjs';
const LIST_ID='11111111-1111-4111-8111-111111111111';
for(const policy of ['request','receive-only'])test(`M1: a peer the owner placed only in a ${policy} list is not added to Contacts`,async()=>{
 const rows=legacyMailbox({curated:true});
 rows.push([`list/${LIST_ID}`,{id:LIST_ID,name:'Narrow',policy,builtin:false,createdAt:NOW-1}],[memberKey(LIST_ID,P.bob),{principal:who(P.bob),list:LIST_ID,addedAt:NOW-1,via:{kind:'manual'}}],[memberOf(P.bob,LIST_ID),{list:LIST_ID}]);
 const store=memoryStore(rows);assert.equal(await firstContactPolicy(store,P.bob),policy);
 const calls=await runToEnd(store,{});assert.equal(calls.reduce((n,r)=>n+r.seeded,0),0);
 assert.equal(await store.get(memberKey('contacts',P.bob)),undefined);assert.equal(await firstContactPolicy(store,P.bob),policy,'the policy is not widened');
 // The curated mailbox's existing member keeps its row exactly; nobody else is seeded.
 assert.deepEqual(await store.get(memberKey('contacts',P.alice)),{principal:who(P.alice),list:'contacts',addedAt:NOW-1,via:{kind:'invite',invite:uuid(900)}});
 assert.deepEqual([...(await members(store)).keys()],[principalKey(P.alice)]);
});

test('M1: a peer with any membership is skipped even where no list row exists (second guard)',async()=>{
 const rows=legacyMailbox();rows.push([memberKey(LIST_ID,P.bob),{principal:who(P.bob),list:LIST_ID,addedAt:NOW-1,via:{kind:'manual'}}],[memberOf(P.bob,LIST_ID),{list:LIST_ID}]);
 const store=memoryStore(rows);await runToEnd(store,{});
 const m=await members(store);assert.equal(m.has(principalKey(P.bob)),false);assert.equal(m.has(principalKey(P.alice)),true);
});

test('M1: a peer the owner removed from Contacts before the reset is not re-added',async t=>{
 const store=memoryStore(legacyMailbox()),e=createTestEngine({owner:OWNER,store,providers:{contacts:ContactsDomain,receive:ReceiveDomain}});t.after(()=>e.dispose());
 // Phase 3: the owner added bob, then removed him. The removal leaves no membership row behind.
 await e.run('lists.add',{input:{list:'contacts',principal:who(P.bob)}});await e.run('lists.remove',{input:{list:'contacts',principal:who(P.bob)}});
 assert.equal((await store.list({prefix:`member-of/${principalKey(P.bob)}/`})).size,0);
 for(let i=0;i<100;i++)if((await e.run('mailbox.reset-contact-links')).done)break;
 assert.ok(await store.get(CONTACT_LINKS_RESET_MARKER));
 assert.equal(await store.get(memberKey('contacts',P.bob)),undefined,'the removal stands');
 assert.equal(await firstContactPolicy(store,P.bob),null);
});

test('M1: removing a seeded peer between two slices stops seeding, so another room of that peer cannot re-add it',async t=>{
 // alice has two active two-party rooms (501 and 507); bob's room (502) sorts between them.
 const rows=legacyMailbox();rows.push(...room(uuid(507),[P.alice]));
 const store=memoryStore(rows),e=createTestEngine({owner:OWNER,store,providers:{contacts:ContactsDomain,receive:ReceiveDomain}});t.after(()=>e.dispose());
 let done=false;for(let i=0;i<200&&!done&&!await store.get(memberKey('contacts',P.alice));i++)done=(await e.run('mailbox.reset-contact-links',{input:{limit:1,page:1}})).done;
 assert.equal(done,false);assert.ok(await store.get(memberKey('contacts',P.alice)),'alice was seeded from her first room');
 await e.run('lists.remove',{input:{list:'contacts',principal:who(P.alice)}});
 for(let i=0;i<200&&!done;i++)done=(await e.run('mailbox.reset-contact-links',{input:{limit:1,page:1}})).done;
 assert.equal(done,true);assert.equal(await store.get(memberKey('contacts',P.alice)),undefined,'alice stays removed');
 assert.equal(await store.get(memberKey('contacts',P.bob)),undefined,'seeding stopped once the owner curated');
});
