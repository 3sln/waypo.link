// Signaling rev 3.2 seeded chaos test (docs/spec/extensions/signaling.md §21.1 "Engine-level and chaos coverage"):
// random interleavings of offer mints (bound and open), dial-backs (right, wrong and dead tokens), claims (accept,
// decline, none), offer revocations, cross-entity pairing creation and removal, principal blocks and unblocks, client
// session revocations, endpoint churn and expiry, checked after every step against a REFERENCE MODEL written from the
// spec text (not from the implementation):
//   §5.2   an offer admits only while live, with a free use, for its principal (bound) or any other principal (open);
//          spent + reserved never exceeds `uses`; a bound offer admits at most one session ever; an open offer's use
//          is reserved at admission, spent by an accept, released by a decline or an unclaimed end
//   §5.4   an admitted offer invite reaches the minting endpoint, else the minting app's other endpoints; a relation
//          invite reaches the endpoints the recipient pairing's local side covers; never another app
//   §5.5   offer_match only on the minting endpoint; paired only on covered endpoints; never auto_connect cross-entity
//   §5.8   the relation basis admits only with the recipient's live pairing whose peer may open; the initiator's own
//          pairing is required to open; deleting a pairing ends its pending invites silently and claimed ones `revoked`
//   §8.5, §12.1  nothing reaches the initiator about an unclaimed session (silence); claimed legs may get controls
//   §13.2  a block admits nothing from the blocked principal and deletes its pairings
//   §13.1  capacity with the reference values of Appendix B: base pending capacity 4, a cross-entity reserve share of 2
//          (bound offers and relation invites only), open offers at most half of pending and connected capacity and
//          never the reserve, pairings at most half of base pending (2) and connected capacity (4), connected capacity
//          8, at most 2 × covered endpoints live per pairing
// Rate windows are kept out of reach (each round advances the clock past every window), so the model need not mirror
// limit internals; they are covered in signaling-admission.test.mjs and signaling-engine-rules.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {forEachSeed} from './helpers/chaos.mjs';
import {signalingHost,standardKinds,payloadOf,APP,CALLBACK,PEER,subOf,identityOf} from './helpers/signaling-fixture.mjs';
import {offerDigest} from '../packages/signaling/messages.mjs';

const N=4,SEEDS=Number(process.env.SIGNALING_CHAOS_SEEDS??6),STEPS=Number(process.env.SIGNALING_CHAOS_STEPS??45);

async function world(seed){
 const h=await signalingHost({seed,entities:N});await standardKinds(h);
 for(let n=1;n<=N;n++){await h.approve(n,APP,CALLBACK);await h.approve(n,APP,PEER);}
 const dev={},dev2={};
 for(let n=1;n<=N;n++){dev[n]=h.device(n,{kinds:[CALLBACK,PEER]});await dev[n].register();dev2[n]=h.device(n,{kinds:[CALLBACK,PEER],clientSession:'cs-'+n});await dev2[n].register();}
 return {h,dev,dev2};
}

// ---- the reference model (spec rules only) ---------------------------------------------------------------------------
class Model{
 constructor(){this.offers=new Map();this.sessions=new Map();this.pairings=new Map();this.blocks=new Set();this.registered={};}
 blocked(n,m){return this.blocks.has(n+'|'+m);}
 offerAdmits(o,m){return !o.dead&&o.spent+o.reserved.size<o.uses&&(o.principal===null?m!==o.n:o.principal===m);}
 /** The endpoints an admitted offer invite reaches (§5.4 case 3, not service-class). */
 offerRoute(o){const reg=this.registered[o.n];if(reg.has(o.endpoint))return [o.endpoint];return [...reg];}
 pairingAt(n,m){return this.pairings.get(n+'>'+m)??null;}
 /** §13.1 capacity at recipient n for an invite of class `cls` ('bound', 'open' or 'relation'): false, 'base' or 'cross'. */
 capacity(n,cls,pairingKey,covered){
  const live=[...this.sessions.values()].filter(s=>s.n===n&&['pending','connected'].includes(s.state)),pending=live.filter(s=>s.state==='pending'),connected=live.filter(s=>s.state==='connected');
  if(connected.length>=8)return false;
  if(cls==='open'&&(pending.filter(s=>s.cls==='open').length>=2||connected.filter(s=>s.cls==='open').length>=4))return false;
  // §13.1 "Pairing sub-budget": at most half of the entity's (base) pending capacity, 4 / 2 = 2, and of its connected
  // capacity, 8 / 2 = 4 (review M-3: this model once copied the implementation's floor((4 + 2 + 2) / 2) = 4).
  if(cls==='relation'&&(pending.filter(s=>s.cls==='relation').length>=2||connected.filter(s=>s.cls==='relation').length>=4||live.filter(s=>s.pairing===pairingKey).length>=Math.max(2,2*covered)))return false;
  if(pending.length<4)return 'base';
  if(cls==='open')return false;
  return pending.filter(s=>s.reserve==='cross').length<2&&pending.length<8?'cross':false;
 }
 relationRoute(p,n){const reg=this.registered[n];return [...reg].filter(id=>p.local.client_session===null||this.sessionOf[id]===p.local.client_session);}
}

test('seeded chaos: offers, claims, revocations, pairings, blocks and client-session revocations keep the spec invariants',async()=>{
 await forEachSeed(SEEDS,async random=>{
  const {h,dev,dev2}=await world(random.seed),M=new Model();
  const all=n=>[dev[n],dev2[n]];
  for(let n=1;n<=N;n++)M.registered[n]=new Set([dev[n].endpoint,dev2[n].endpoint]);
  M.sessionOf={};for(let n=1;n<=N;n++){M.sessionOf[dev[n].endpoint]=null;M.sessionOf[dev2[n].endpoint]='cs-'+n;}
  const tokens=[];const seenInvites=new Map();// sid -> [{endpoint, projection}]
  const listenAll=async()=>{for(let n=1;n<=N;n++)for(const d of all(n))if(M.registered[n].has(d.endpoint)){const out=await d.listen();for(const e of out.events)if(e.type==='invite'){const list=seenInvites.get(e.sid)??[];list.push({endpoint:d.endpoint,projection:e.projection});seenInvites.set(e.sid,list);}}};
  const fresh=n=>h.owner(n,{freshAuth:true});
  const offersAt=async n=>new Map((await h.run(n,'signaling.offers')).offers.map(o=>[o.id,o]));
  const check=async label=>{
   // §5.2 offer accounting: the engine's live offers equal the model's live offers, use for use.
   for(let n=1;n<=N;n++){const live=await offersAt(n);
    for(const [token,o] of M.offers)if(o.n===n){const id=await offerDigest(token),e=live.get(id);
     if(o.dead){assert.equal(e,undefined,`${label}: a dead offer is not listed`);continue;}
     assert.ok(e,`${label}: a live offer is listed`);assert.equal(e.spent,o.spent,`${label}: spent`);if(e.reserved!==o.reserved.size&&process.env.SIGNALING_CHAOS_TRACE){console.log('MISMATCH',token.slice(0,6),o,[...o.reserved].map(sid=>M.sessions.get(sid)));console.log((await h.rows(n,'sig/in/')).map(([k,r])=>[k.slice(-22),r.state,r.endReason,r.claim,r.offerUse,r.delivered]));}assert.equal(e.reserved,o.reserved.size,`${label}: reserved`);
     assert.ok(e.spent+e.reserved<=e.uses,`${label}: spent + reserved <= uses`);}}
  };
  /** A dial-back by holder m to minter n with `token` (possibly dead, wrong or forged). */
  const dial=async(m,n,token)=>{
   const o=M.offers.get(token),cls=o?.principal===null?'open':'bound',predicted=Boolean(o)&&o.n===n&&!M.blocked(n,m)&&M.offerAdmits(o,m)&&M.offerRoute(o).length>0&&M.capacity(n,cls);const reserve=predicted?M.capacity(n,cls):false;
   const s=await dev[m].open(h.principal(n),CALLBACK,{basis:{offer:token}});await dev[m].invite(s);await h.pump();await listenAll();
   const got=seenInvites.get(s.sid)??[];
   if(!predicted){assert.equal(got.length,0,`dial ${m}->${n}: admits nothing`);M.sessions.set(s.sid,{m,n,state:'refused'});await dev[m].cancel(s);await h.pump();return;}
   const route=M.offerRoute(o);
   assert.deepEqual(got.map(x=>x.endpoint).sort(),[...route].sort(),`dial ${m}->${n}: routed to the minting endpoint, else the minting app`);
   for(const x of got){assert.equal(x.projection.basis,'offer');assert.equal(x.projection.offer_match,x.endpoint===o.endpoint,'offer_match only on the minting endpoint');assert.equal(x.projection.auto_connect,false);assert.equal(x.projection.paired,false);}
   if(o.principal===null)o.reserved.add(s.sid);else o.spent++;o.admitted.add(s.sid);
   M.sessions.set(s.sid,{sid:s.sid,m,n,token,cls,reserve:reserve==='cross'?'cross':null,state:'pending',route,initiatorSession:s});
  };
  const relationDial=async(m,n)=>{
   const mine=M.pairingAt(m,n),theirs=M.pairingAt(n,m);
   // §5.1 item 7: the initiator's own pairing must cover the calling endpoint (dev, no client session) and let it open.
   const canOpen=Boolean(mine)&&mine.state==='live'&&['local','both'].includes(mine.opens)&&mine.local.client_session===null;
   let s;try{s=await dev[m].open(h.principal(n),PEER,{basis:{relation:'pairing'}});}catch(e){assert.equal(canOpen,false,`relation ${m}->${n}: open refused only without the initiator's own pairing`);assert.equal(e.code,'invalid_args');return;}
   assert.equal(canOpen,true,`relation ${m}->${n}: open allowed only with the initiator's own pairing`);
   await dev[m].invite(s);await h.pump();await listenAll();
   const covered=theirs?M.relationRoute(theirs,n).length:0,cap=theirs?M.capacity(n,'relation',n+'>'+m,covered):false;
   const predicted=Boolean(theirs)&&theirs.state==='live'&&['peer','both'].includes(theirs.opens)&&!M.blocked(n,m)&&covered>0&&Boolean(cap);
   const got=seenInvites.get(s.sid)??[];
   if(!predicted){assert.equal(got.length,0,`relation ${m}->${n}: admits nothing (only the recipient's record counts)`);M.sessions.set(s.sid,{m,n,state:'refused'});await dev[m].cancel(s);await h.pump();return;}
   assert.deepEqual(got.map(x=>x.endpoint).sort(),M.relationRoute(theirs,n).sort(),`relation ${m}->${n}: routed to covered endpoints`);
   for(const x of got){assert.equal(x.projection.basis,'pairing');assert.equal(x.projection.paired,true);assert.equal(x.projection.offer_match,false);}
   M.sessions.set(s.sid,{sid:s.sid,m,n,token:null,cls:'relation',reserve:cap==='cross'?'cross':null,pairing:n+'>'+m,state:'pending',route:M.relationRoute(theirs,n),initiatorSession:s});
  };
  const endPending=(s,{release=true}={})=>{s.state='ended';const o=s.token?M.offers.get(s.token):null;if(o&&release&&o.reserved.has(s.sid))o.reserved.delete(s.sid);};
  const deletePairing=key=>{const p=M.pairings.get(key);if(!p)return;M.pairings.delete(key);for(const s of M.sessions.values())if(s.pairing===key&&['pending','connected'].includes(s.state))endPending(s);};

  // Rate windows stay out of reach: at most 5 invites per (initiator, recipient) between rounds (the smallest reference
  // window is 6 per (initiator, recipient) per 10 minutes, §13.1, Appendix B); a 6th forces a round first.
  const dials=new Map(),tally=(m,n)=>{const k=m+'>'+n,c=(dials.get(k)??0)+1;dials.set(k,c);return c;};
  const round=async()=>{h.clock.advance(3700000);await h.tickAll();await h.pump();dials.clear();
   for(const s of M.sessions.values())if(s.state==='pending')endPending(s);
   for(const [token,o] of M.offers)if(!o.dead){o.dead=true;o.reserved.clear();}};// every offer here lives at most 900 s
  const guard=async(m,n)=>{if(tally(m,n)>5){await round();tally(m,n);}};
  for(let step=0;step<STEPS;step++){
   let op=random.pick(['mint','mint','dial','dial','dial','wrong','claim','claim','revoke','pair','pair','unpair','relation','relation','block','unblock','session','churn','round']);
   const n=1+random.int(N);let m=1+random.int(N);if(m===n)m=m%N+1;
   if(process.env.SIGNALING_CHAOS_TRACE)console.log(step,op,n,m);
   if(op==='mint'){
    const bound=random.chance(0.6),out=await dev[n].offer(CALLBACK,bound?{principals:[h.principal(m)]}:{uses:1+random.int(3)});
    const token=out.offers[0].offer;tokens.push(token);M.offers.set(token,{n,endpoint:dev[n].endpoint,principal:bound?m:null,uses:bound?1:out.offers.length&&(await offersAt(n)).get(await offerDigest(token)).uses,spent:0,reserved:new Set(),admitted:new Set(),dead:false});
   }
   if(op==='dial'&&tokens.length){const token=random.pick(tokens),o=M.offers.get(token),holder=o.principal??(o.n===m?n:m);await guard(holder,o.n);await dial(holder,o.n,token);}
   if(op==='wrong'&&tokens.length){const token=random.pick(tokens),o=M.offers.get(token);let w=1+random.int(N);if(w===o.n)w=w%N+1;await guard(w,o.n);await dial(w,o.n,token);}
   if(op==='claim'){
    const pending=[...M.sessions.entries()].filter(([,s])=>s.state==='pending');
    if(pending.length){const [sid,s]=random.pick(pending),who=random.pick(s.route),d=all(s.n).find(x=>x.endpoint===who);
     if(d&&M.registered[s.n].has(who)){const outcome=random.pick(['accept','decline']);await d.claim(sid,outcome);
      const o=s.token?M.offers.get(s.token):null;if(o&&o.reserved.has(sid)){o.reserved.delete(sid);if(outcome==='accept')o.spent++;}
      s.state=outcome==='accept'?'connected':'ended';s.claimed=true;await h.pump();await listenAll();
      // The initiator often hangs up at once (frees its open-session cap); a hang-up ends nothing else.
      if(outcome==='decline'||random.chance(0.6)){const init=s.initiatorSession;try{await dev[s.m].end(init);}catch{/* the initiator endpoint may have churned */}if(s.state==='connected')s.state='ended';await h.pump();}}}
   }
   if(op==='revoke'&&tokens.length){
    const token=random.pick(tokens),o=M.offers.get(token);await dev[o.n].revokeOffer([token]).catch(()=>null);
    // The minting endpoint may be gone; its app can still revoke by token through any of its endpoints.
    if(!M.registered[o.n].has(o.endpoint))await all(o.n).find(d=>M.registered[o.n].has(d.endpoint))?.revokeOffer([token]);
    if(!o.dead){o.dead=true;for(const sid of o.admitted){const s=M.sessions.get(sid);if(s.state==='pending')endPending(s);}o.reserved.clear();}
    await h.pump();
    // §5.7: a claim after the offer's end fails with `claimed`.
    for(const sid of o.admitted){const s=M.sessions.get(sid);if(s.state==='ended'&&!s.claimed){const d=all(o.n).find(x=>M.registered[o.n].has(x.endpoint)&&(seenInvites.get(sid)??[]).some(i=>i.endpoint===x.endpoint));if(d)await assert.rejects(d.claim(sid),e=>e.code==='claimed'||e.code==='not_found');}}
   }
   if(op==='pair'&&!M.blocked(n,m)){
    const key=n+'>'+m;if(!M.pairings.has(key)){const opens=random.pick(['local','peer','both']),cs=random.pick([null,'cs-'+n]);
     const p=await h.run(n,'signaling.pairing-create',{actor:fresh(n),input:{kind:h.ref(PEER),local:{client_id:APP,client_session:cs},peer:{principal:h.principal(m)},opens,label:'P',activate:true}});
     assert.equal(p.state,'live');M.pairings.set(key,{id:p.id,state:'live',opens,local:{client_session:cs}});}
   }
   if(op==='unpair'){const keys=[...M.pairings.keys()];if(keys.length){const key=random.pick(keys);await h.run(Number(key.split('>')[0]),'signaling.pairing-remove',{input:{id:M.pairings.get(key).id}});deletePairing(key);await h.pump();}}
   if(op==='relation'){await guard(m,n);await relationDial(m,n);}
   if(op==='block'){await h.run(n,'signaling.block',{input:{principal:h.principal(m)}});M.blocks.add(n+'|'+m);
    for(const s of M.sessions.values())if(s.n===n&&s.m===m&&s.state==='pending')endPending(s);deletePairing(n+'>'+m);await h.pump();}
   if(op==='unblock'&&M.blocked(n,m)){await h.run(n,'signaling.unblock',{input:{principal:h.principal(m)}});M.blocks.delete(n+'|'+m);}
   if(op==='session'&&M.registered[n].has(dev2[n].endpoint)){
    // A device-authorization client session ends (§5.8, §14.2): its endpoints, sessions and bound pairings; no offer.
    await h.run(n,'signaling.lifecycle',{actor:h.system(n),input:{event:'client-session-revoked',clientId:APP,clientSession:'cs-'+n}});
    M.registered[n].delete(dev2[n].endpoint);
    for(const [key,p] of [...M.pairings])if(key.startsWith(n+'>')&&p.local.client_session==='cs-'+n)deletePairing(key);
    for(const s of M.sessions.values())if(s.n===n&&s.state==='pending'){s.route=s.route.filter(id=>id!==dev2[n].endpoint);}
    await h.pump();
    dev2[n]=h.device(n,{kinds:[CALLBACK,PEER],clientSession:'cs-'+n});await dev2[n].register();M.registered[n].add(dev2[n].endpoint);M.sessionOf[dev2[n].endpoint]='cs-'+n;
   }
   if(op==='churn'){
    // The minting endpoint goes away and comes back as a new one: offers stay, routing falls back to the app (§5.7).
    const d=random.pick(all(n).filter(x=>M.registered[n].has(x.endpoint)));
    if(d&&M.registered[n].size>1){await d.run('signaling.unregister',d.auth());M.registered[n].delete(d.endpoint);
     // §14.2: unregistering ends the endpoint's legs with `revoked`; for sessions it initiated (dev[n] initiates every
     // session of entity n) the recipient ends them too, releasing an open offer's reserved use.
     if(d===dev[n])for(const s of M.sessions.values())if(s.m===n&&['pending','connected'].includes(s.state))endPending(s);
     for(const s of M.sessions.values())if(s.n===n&&s.state==='pending')s.route=s.route.filter(id=>id!==d.endpoint);
     await h.pump();const again=h.device(n,{kinds:[CALLBACK,PEER],...d.clientSession?{clientSession:d.clientSession}:{}});await again.register();
     if(d===dev[n])dev[n]=again;else dev2[n]=again;M.registered[n].add(again.endpoint);M.sessionOf[again.endpoint]=d.clientSession??null;await listenAll();
     // Late delivery (§5.4): a pending invite of the minting app's routing set reaches the new endpoint once it listens.
     for(const [sid,s] of M.sessions)if(s.n===n&&s.state==='pending'&&s.token){const o=M.offers.get(s.token);if(!M.registered[n].has(o.endpoint)&&(seenInvites.get(sid)??[]).some(i=>i.endpoint===again.endpoint))s.route.push(again.endpoint);}}
   }
   if(op==='round')await round();
   await check(`seed ${random.seed} step ${step} (${op})`);
  }
  // §8.5, §12.1 silence: nothing in any batch to an initiator names an unclaimed recipient session.
  const claimed=new Set([...M.sessions].filter(([,s])=>s.claimed).map(([sid])=>sid));
  for(const {to,batch} of h.log.batches){const b=JSON.parse(batch);
   for(const c of b.controls)assert.ok(claimed.has(payloadOf(c).sid)||[...M.sessions.values()].some(s=>s.initiatorSession?.sid===payloadOf(c).sid&&s.m!==Number(to)),`seed ${random.seed}: a control names only a claimed session`);
   for(const msg of b.messages){const p=payloadOf(msg);if(['accept','decline'].includes(p.type))assert.ok(claimed.has(p.sid),`seed ${random.seed}: an answer only after a claim`);}
  }
  void identityOf;void subOf;
 });
});
