// Signaling pure units (docs/spec/extensions/signaling.md §7.3, §8, §13.1): the session state machine, first claim,
// ordering and replay, fixed-window limits, the open-offer per-issuer fair share, the capacity classes with the split
// pending reserve and the sub-budgets, and the invite windows by admission class. Carried and retargeted from the
// rtc-engine unit cases; the reserve, fair share and windows are new in rev 2.1 to 3.2.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {transition,canTransition,decideClaim,offerSeq,newLeg,gapExpired,SESSION_EVENTS,BOUNDS} from '../packages/signaling/sessions.mjs';
import {takeLimits,limitsOpen,fairShare,inviteLimits,capacityCounts,capacityAllows,LIMITS,RELATION_MAX_PER_PAIRING,ipPolicyFor,policyWidens,stricterIp} from '../packages/signaling/admission.mjs';
import {createRandom as seeded} from './helpers/chaos.mjs';

const ISS='https://3sln.example',FOREIGN='https://far.example',P=(iss,n)=>({iss,sub:`0a0a0a0a-0000-4000-8000-${String(n).padStart(12,'0')}`});
const store=()=>new SqliteMetadata(':memory:');
const rec=(state='pending',extra={})=>({state,answerBy:Infinity,endsAt:Infinity,delivered:['e1','e2'],claim:null,...extra});

test('§8.1: every legal transition, and every illegal one throws; ended is terminal',()=>{
 const states=['pending','connected','ended'];
 for(const event of SESSION_EVENTS)for(const state of states){
  const r=rec(state);if(canTransition(state,event)){transition(r,event,{now:1});assert.ok(['connected','ended'].includes(r.state));}
  else assert.throws(()=>transition(rec(state),event,{now:1}),e=>e.code==='signaling_illegal_transition');
 }
 assert.equal(SESSION_EVENTS.some(e=>canTransition('ended',e)),false);
 const c=rec('connected');transition(c,'cancel',{now:2});assert.equal(c.endReason,'closed','a cancel crossing a claim is processed as end with closed (§8.4)');
 const p=rec();transition(p,'cancel',{now:2});assert.equal(p.endReason,'cancelled');
});

test('§8.2: exactly one winner; a repeat by the winner while usable; claimed for others and once dead; not_delivered',()=>{
 const r=rec();assert.deepEqual(decideClaim(r,{endpoint:'x',jkt:'k',outcome:'accept',now:1}),{won:false,code:'not_delivered'});
 assert.deepEqual(decideClaim(r,{endpoint:'e1',jkt:'k1',outcome:'accept',now:1}),{won:true,repeat:false});
 assert.deepEqual(decideClaim(r,{endpoint:'e2',jkt:'k2',outcome:'accept',now:1}),{won:false,code:'claimed'});
 assert.deepEqual(decideClaim(r,{endpoint:'e1',jkt:'k1',outcome:'accept',now:2}),{won:true,repeat:true});
 transition(r,'end',{now:3});assert.deepEqual(decideClaim(r,{endpoint:'e1',jkt:'k1',outcome:'accept',now:4}),{won:false,code:'claimed'},'no certificate for a dead session');
 const late=rec('pending',{answerBy:5});assert.equal(decideClaim(late,{endpoint:'e1',jkt:'k',outcome:'accept',now:5}).won,false,'past answer_by');
});

test('§7.3: duplicates by payload bytes, different content fails, a 32-message buffer and a 10 s gap',()=>{
 const leg=newLeg();
 assert.equal(offerSeq(leg,{seq:0,digest:'a',compact:'c0',now:0}).action,'deliver');
 assert.equal(offerSeq(leg,{seq:0,digest:'a',compact:'c0',now:0}).action,'duplicate');
 assert.equal(offerSeq(leg,{seq:0,digest:'b',compact:'x',now:0}).action,'fail');
 for(let i=2;i<34;i++)assert.equal(offerSeq(leg,{seq:i,digest:'d'+i,compact:'c'+i,now:0}).action,'buffer');
 assert.equal(offerSeq(leg,{seq:40,digest:'z',compact:'z',now:0}).action,'fail','the 33rd buffered message');
 assert.equal(gapExpired(leg,10000),false);assert.equal(gapExpired(leg,10001),true);
 const r=offerSeq(leg,{seq:1,digest:'d1',compact:'c1',now:5});assert.equal(r.ready.length,33,'the gap fills and releases the buffer in order');assert.equal(leg.gapSince,null);
});

test('§13.1: fixed windows are all-or-nothing, take amounts and expire with the window',async()=>{
 const s=store();
 await s.transaction(async tx=>{
  const items=[{name:'pair',parts:['a']},{name:'recipient',parts:[]}];
  for(let i=0;i<LIMITS.pair.max;i++)assert.equal(await takeLimits(tx,items,0),true);
  assert.equal(await takeLimits(tx,items,0),false);assert.equal(await limitsOpen(tx,[{name:'recipient',parts:[]}],0),true,'nothing counted on refusal');
  assert.equal(await takeLimits(tx,items,LIMITS.pair.windowMs+1),true,'a new window');
  assert.equal(await takeLimits(tx,[{name:'data',parts:['o'],max:10,windowMs:1000,amount:8}],0),true);assert.equal(await takeLimits(tx,[{name:'data',parts:['o'],max:10,windowMs:1000,amount:3}],0),false);
 });
});

test('§13.1 open offers: the per-issuer fair share max(W/(n+1), F) leaves headroom for an issuer not yet seen',async()=>{
 const s=store(),W=LIMITS.offerOpen.max,F=LIMITS.offerIssuerFloor.max;
 await s.transaction(async tx=>{
  // One flooding issuer takes at most W/2 (n = 1 once it is charged).
  let a=0;while(await fairShare(tx,{offer:'o1',issuer:'https://a.example',service:false,now:0}))if(await fairShare(tx,{offer:'o1',issuer:'https://a.example',service:false,now:0,take:true}))a++;
  assert.equal(a,Math.max(W/2,F));
  // A new issuer still finds room.
  assert.equal(await fairShare(tx,{offer:'o1',issuer:'https://b.example',service:false,now:0}),true,'headroom for a newcomer');
  let b=0;while(b<W&&await fairShare(tx,{offer:'o1',issuer:'https://b.example',service:false,now:0,take:true}))b++;
  assert.ok(b>=Math.floor(W/3)&&b<=W/2,'the second issuer is capped near W/3 once two are charged');
  // The floor F holds even with many issuers.
  for(let i=0;i<40;i++)await fairShare(tx,{offer:'o2',issuer:`https://i${i}.example`,service:false,now:0,take:true});
  let c=0;while(c<F+5&&await fairShare(tx,{offer:'o2',issuer:'https://late.example',service:false,now:0,take:true}))c++;assert.equal(c,F);
 });
});

test('§13.1 windows by admission class: bound offers only per (initiator, recipient); open offers only their own; relation per pairing id',()=>{
 const self=P(ISS,1),foreign=P(FOREIGN,2),names=items=>items.map(i=>i.name).sort();
 assert.deepEqual(names(inviteLimits({cls:'self',sender:self,issuer:ISS})),['self']);
 assert.deepEqual(names(inviteLimits({cls:'ownPairing',sender:self,issuer:ISS,pairing:'p',endpoints:['a','b']})),['ownPairing']);
 assert.deepEqual(names(inviteLimits({cls:'bound',sender:foreign,issuer:ISS})),['pair']);
 assert.deepEqual(names(inviteLimits({cls:'open',sender:foreign,issuer:ISS,offer:'o'})),['offerOpen','offerPrincipal'],'never the windows unbased traffic fills');
 assert.deepEqual(names(inviteLimits({cls:'open',sender:foreign,issuer:ISS,offer:'o',service:true})),['offerOpenService','offerPrincipalService']);
 const rel=inviteLimits({cls:'relation',sender:foreign,issuer:ISS,pairing:'p',covered:3});assert.deepEqual(names(rel),['pair','relation']);assert.equal(rel.find(i=>i.name==='relation').max,90);
 assert.equal(inviteLimits({cls:'relation',sender:foreign,issuer:ISS,pairing:'p',covered:20}).find(i=>i.name==='relation').max,RELATION_MAX_PER_PAIRING);
 assert.deepEqual(names(inviteLimits({cls:'unbased',sender:foreign,issuer:ISS})),['issuerRecipient','pair','recipient']);
 assert.deepEqual(names(inviteLimits({cls:'unbased',sender:P(ISS,3),issuer:ISS})),['issuerRecipient','pair','recipient','sameHost'],'the same-host share bound');
 assert.deepEqual(inviteLimits({cls:'unbased',sender:P(ISS,3),issuer:ISS}).find(i=>i.name==='issuerRecipient').parts.length,2,'same-host principals are individual shares');
});

test('§13.1 capacity: the split pending reserve, the open-offer and pairing sub-budgets, the connected cap',()=>{
 const pending=(cls,n,reserve)=>Array.from({length:n},()=>({state:'pending',cls,...reserve?{reserve}:{}}));
 // Base capacity full of cross-entity invites: a self invite still uses the self share, never the cross share.
 const crossFull=capacityCounts(pending('bound',BOUNDS.recipientPending));
 assert.equal(capacityAllows(crossFull,'self'),'self');assert.equal(capacityAllows(crossFull,'ownPairing'),'self');
 assert.equal(capacityAllows(crossFull,'bound'),'cross');assert.equal(capacityAllows(crossFull,'open'),false,'open offers never use a reserve');
 const crossShareUsed=capacityCounts([...pending('bound',BOUNDS.recipientPending),...pending('relation',BOUNDS.reserveCross,'cross')]);
 assert.equal(capacityAllows(crossShareUsed,'bound'),false,'the cross share is spent');assert.equal(capacityAllows(crossShareUsed,'self'),'self','and cannot take the self share');
 const selfShareUsed=capacityCounts([...pending('self',BOUNDS.recipientPending),...pending('self',BOUNDS.reserveSelf,'self')]);
 assert.equal(capacityAllows(selfShareUsed,'self'),false);assert.equal(capacityAllows(selfShareUsed,'bound'),'cross','own-entity invites cannot take the cross share');
 // Open offers take at most half of pending and of connected capacity.
 const openHalf=capacityCounts(pending('open',Math.floor(BOUNDS.recipientPending*BOUNDS.subBudgetShare)));
 assert.equal(capacityAllows(openHalf,'open'),false);assert.equal(capacityAllows(openHalf,'bound'),'base');
 const openConnected=capacityCounts(Array.from({length:Math.floor(BOUNDS.recipientConnected/2)},()=>({state:'connected',cls:'open'})));
 assert.equal(capacityAllows(openConnected,'open'),false,'connected sub-budget');
 // Pairings together take at most half of the whole pending capacity.
 const total=BOUNDS.recipientPending+BOUNDS.reserveSelf+BOUNDS.reserveCross,pairings=capacityCounts(pending('relation',Math.floor(total/2)));
 assert.equal(capacityAllows(pairings,'relation'),false);assert.equal(capacityAllows(pairings,'ownPairing'),false);assert.notEqual(capacityAllows(pairings,'self'),false);
 assert.equal(capacityAllows(capacityCounts(Array.from({length:BOUNDS.recipientConnected},()=>({state:'connected',cls:'self'}))),'self'),false,'connected cap');
});

test('§13.1 capacity, seeded: no class ever takes another class\'s reserve share, whatever the arrival order',()=>{
 for(let seed=1;seed<=40;seed++){
  const r=seeded(seed),live=[];
  for(let i=0;i<60;i++){
   const cls=r.pick(['self','ownPairing','relation','bound','open']);const got=capacityAllows(capacityCounts(live),cls);
   if(got)live.push({state:'pending',cls,...got==='base'?{}:{reserve:got}});
   if(r.chance(0.2)&&live.length)live.splice(r.int(live.length),1);
   const c=capacityCounts(live);
   assert.ok((c.reserveBy.self??0)<=BOUNDS.reserveSelf&&(c.reserveBy.cross??0)<=BOUNDS.reserveCross,`seed ${seed}: shares bounded`);
   assert.ok(live.filter(x=>x.reserve==='self').every(x=>['self','ownPairing'].includes(x.cls)),`seed ${seed}: self share`);
   assert.ok(live.filter(x=>x.reserve==='cross').every(x=>['relation','bound'].includes(x.cls)),`seed ${seed}: cross share`);
   assert.ok(live.filter(x=>x.cls==='open').every(x=>!x.reserve),`seed ${seed}: open offers never reserve`);
  }
 }
});

test('§16.5: IP policy defaults, widening and the stricter of pinned and current',()=>{
 assert.equal(ipPolicyFor({other:'relay',self:'all'},{crossEntity:true}),'relay');assert.equal(ipPolicyFor({other:'public',self:'all'},{crossEntity:true}),'public');
 assert.equal(ipPolicyFor({other:'public',self:'all'},{crossEntity:false}),'all');
 assert.equal(policyWidens({other:'relay',self:'all'},{other:'public',self:'all'}),true);assert.equal(policyWidens({other:'public',self:'all'},{other:'relay',self:'public'}),false);
 assert.equal(stricterIp('public','relay'),'relay');assert.equal(stricterIp('all','public'),'public');
});
