// Seeded chaos for ORG-10a–e (design §8b.10 test plan; invariants C1–C9, C10 where it applies to these slices).
// Random instances of 2–6 parties on one loopback host interleave creations, invitations, acceptances (some with a lost
// redemption response or an unreachable inviter), withdrawals, suspensions, resumptions, narrowing, ends, leaving,
// expiry sweeps, flag flips, forged and non-counterpart events, anti-entropy, and event drop, duplication, failure
// (retried later, so reordered) and clock jumps. Invariants are checked after every step; at the end faults stop,
// anti-entropy runs and every mirror must equal its holder's half.
// ORG-10d/10e add: authority resets (an organization's aep rises, so its next signed events and certificates reset its
// counterparts; key resets; attested and unattested move adoptions), admin confirmations (sometimes for a stale aep),
// introductions with admission or decline, and entity certificates issued by grantees and presented at grantors.
//   C2  every honoured certificate's method is within its own `methods` (the issuer's evaluation) and within the
//       grantor's live edge in the certificate's instance.
//   C8  while a full RL-4 hold is active nothing widening from that counterpart is honoured (no mirror of its halves
//       becomes live, no call or certificate of it is allowed), and a confirmation for one aep never covers a later
//       reset (a floor above the last confirmation always has a full hold).
//   C9  an introduction never creates an edge: every counterpart record traces to an invitation between exactly those
//       two parties; no organization holds an introduction naming itself; recognition notices reach only proposers.
// Before the final convergence check every remaining hold is confirmed by an admin (holds block widening by design).
import test from 'node:test';
import assert from 'node:assert/strict';
import {relationsHost,ISS,STORE,LEDGER,PO,BUS} from './helpers/relations-world.mjs';
import {createRandom} from '../packages/app/memory-providers.mjs';
import {validateRelationBody,edgeEntries} from '../packages/orgs/relation-documents.mjs';
import {outgoingLive,incomingLive,edgeAllows,RELATION_EVENT} from '../packages/orgs/relation-edges.mjs';
import {principalKey} from '../packages/orgs/grants.mjs';
import {parseEntityCertificate} from '../packages/identity/entity-certificates.mjs';
import {digest,base64url} from '../packages/messaging/store.mjs';

const ALL={[STORE]:['get','list','put','delete'],[LEDGER]:['get','list','put','delete'],[PO]:['status','acknowledge','cancel'],[BUS]:['read','subscribe','unsubscribe']};
const EXPECTED=new Set(['not_found','invitation_invalid','relation_slot_full','relation_counterpart_exists','relation_invitation_pending','relation_invitation_limit','relation_invitation_empty','relation_values_incomplete','relation_values_invalid','relation_redeem_unavailable','relation_limit','relation_acceptance_conflict','relation_slot_invalid',
 'relation_hold_changed','relation_introduction_invalid','relation_introduction_empty','relation_certificate_unavailable','invalid_token','relation_rebind_required']);
const CLIENT='https://app.example/client',RPC=`${ISS}/bindle/rpc`,te=new TextEncoder();
async function dpopProof(key,{bound,iat}){const enc=v=>base64url(te.encode(JSON.stringify(v)));const head=`${enc({typ:'dpop+jwt',alg:'ES256',jwk:key.jwk})}.${enc({jti:crypto.randomUUID().replaceAll('-',''),htm:'POST',htu:RPC,iat,ath:await digest(crypto,bound)})}`;
 return `${head}.${base64url(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,te.encode(head))))}`;}
const SLOTS={share:[['owner','recipient']],supply:[['buyer','supplier']],partners:[['partner','partner']],group:[['parent','subsidiary'],['subsidiary','parent']]};
const METHOD={[STORE]:'get',[LEDGER]:'get',[PO]:'status',[BUS]:'read'};

async function snapshot(h){
 const out=new Map();
 for(const o of h.orgs.values()){const parts=[...(await o.list('rel/instance/')).values()],cps=[...(await o.list('rel/cp/')).values()];out.set(o.id,{o,parts:new Map(parts.map(p=>[p.instance,p])),cps,state:await o.get('rel/state'),imports:[...(await o.list('rel/import/')).values()]});}
 return out;
}
const cpOf=(snap,holder,instance,other)=>snap.get(holder)?.cps.find(c=>c.instance===instance&&c.principal.sub===other);

async function invariants(h,docs,history,label){
 const snap=await snapshot(h),now=h.clock.now();
 for(const [id,{o,parts,cps,state,imports}] of snap){
  // Counters equal what the rows say (RL-11 caps rely on them).
  const instances=[...parts.values()].filter(p=>p.state!=='left').length,incoming=cps.filter(c=>c.acceptance&&['live','suspended'].includes(c.acceptance.state)).length;
  assert.equal(state?.instances??0,instances,`${label}: org ${o.n} instance counter`);assert.equal(state?.incoming??0,incoming,`${label}: org ${o.n} incoming counter`);
  for(const part of parts.values()){
   const doc=docs.get(part.relation.digest),mine=cps.filter(c=>c.instance===part.instance);
   // C5: arity per view.
   for(const [slot,s] of Object.entries(doc.slots)){const n=(part.slots.includes(slot)&&part.state!=='left'?1:0)+mine.filter(c=>c.slot===slot&&c.state!=='ended').length;assert.ok(n<=s.arity.max,`${label}: C5 org ${o.n} slot ${slot} ${n}>${s.arity.max}`);}
  }
  for(const cp of cps){
   const part=parts.get(cp.instance),doc=docs.get(part.relation.digest),other=snap.get(cp.principal.sub),back=cpOf(snap,cp.principal.sub,cp.instance,id);
   // C4 and the composition rule: every granted resource is the grantor's own, never an import.
   for(const e of cp.grant?.entries??[]){const ceiling=edgeEntries(doc,cp.as,cp.slot).find(x=>x.index===e.index);assert.ok(ceiling,`${label}: entry outside the pair`);
    for(const r of e.resources){assert.ok(!r.resource.startsWith('imp_'),`${label}: C4 import granted`);const own=await o.get('federation/resource/'+r.resource);assert.ok(own,`${label}: C4 not own`);
     // C2: methods within the document entry and the resource's own contracts.
     for(const [c,ms] of Object.entries(r.methods))for(const m of ms){assert.ok(ceiling.methods[r.field]?.[c]?.includes(m),`${label}: C2 doc ceiling`);assert.ok(own.contracts[c]?.includes(m),`${label}: C2 resource`);}}}
   // C1: a live edge has my consent record and a real acceptance at the grantee, never ahead of what it issued.
   if(outgoingLive(part,cp,now)){assert.equal(cp.grant.state,'live');assert.ok(back?.acceptance,`${label}: C1 no acceptance record at the grantee`);
    const m=cp.peerAcceptance,g=back.acceptance;assert.ok(g.generation>m.generation||g.generation===m.generation&&g.state==='live',`${label}: C1 mirror ahead of the grantee`);}
   // Mirrors are never ahead of the holder's own half.
   if(back){for(const [mirror,holder] of [[cp.peerGrant,back.grant],[cp.peerAcceptance,back.acceptance]])if(mirror&&mirror.state!=='ended'){assert.ok(holder&&holder.generation>=mirror.generation,`${label}: mirror ahead`);}}
   // C6 monotonicity: generations never fall and an end never revives (holder halves and mirrors).
   for(const key of ['grant','acceptance','peerGrant','peerAcceptance']){const h_=cp[key],k=`${id}|${cp.instance}|${cp.principal.sub}|${key}`,prev=history.get(k);
    // A confirmed RL-4 reset restarts the floor of the counterpart's mirrors (review L1; cp.peerEpoch rises).
    const reset=key.startsWith('peer')&&(cp.peerEpoch??0)!==(prev?.epoch??0);
    if(prev){if(h_){assert.ok(reset||h_.generation>=prev.generation,`${label}: C6 generation fell ${key}`);if(prev.state==='ended')assert.equal(h_.state,'ended',`${label}: C6 revived ${key}`);}else assert.ok(prev.state==='pending'||key==='grant'||key==='acceptance'&&prev.state==='pending',`${label}: half vanished ${key} from ${prev.state}`);}
    if(h_)history.set(k,{generation:h_.generation,state:h_.state,epoch:cp.peerEpoch??0});}
  }
  // Imports: available only while my acceptance and my mirror of the grant are live.
  for(const row of imports)if(row.status==='available'){const cp=cps.find(c=>c.instance===row.instance&&c.principal.sub===row.grantor.sub);assert.ok(cp&&incomingLive(parts.get(row.instance),cp),`${label}: import available without a live incoming edge`);}
  // C8: a floor above the last confirmation always has a full hold bound to at least that aep; and while a full hold
  // was active at the previous step and still is, no mirror of that counterpart's halves became live.
  for(const [key,floor] of await o.list('rel/aep/')){if(floor.baseline)continue;const rest=key.slice('rel/aep/'.length),confirmed=await o.get('rel/confirmed/'+rest),hold=await o.get('rel/hold/'+rest);
   if(floor.aep>(confirmed?.aep??-1)){assert.ok(hold&&hold.kind==='full'&&hold.aep>=floor.aep,`${label}: C8 org ${o.n} reset to aep ${floor.aep} without a full hold (confirmed ${confirmed?.aep})`);}}
  for(const [key,hold] of await o.list('rel/hold/')){if(hold.kind!=='full')continue;const was=history.get('hold|'+id+'|'+key);
   for(const cp of cps.filter(c=>principalKey(c.principal)===key.slice('rel/hold/'.length)))for(const m of ['peerGrant','peerAcceptance']){const prev=history.get(`${id}|${cp.instance}|${cp.principal.sub}|${m}|held`);
    if(was&&prev&&cp[m]&&cp[m].state==='live')assert.ok(cp[m].generation<=prev.generation||prev.state==='live'&&cp[m].generation===prev.generation,`${label}: C8 org ${o.n} honoured a widening ${m} from a held counterpart`);
    history.set(`${id}|${cp.instance}|${cp.principal.sub}|${m}|held`,cp[m]?{generation:cp[m].generation,state:cp[m].state}:null);}
   history.set('hold|'+id+'|'+key,true);}
  for(const key of [...history.keys()].filter(k=>k.startsWith('hold|'+id+'|')))if(!await o.get(key.slice(('hold|'+id+'|').length))||(await o.get(key.slice(('hold|'+id+'|').length))).kind!=='full'){history.delete(key);for(const k of [...history.keys()])if(k.startsWith(id+'|')&&k.endsWith('|held'))history.delete(k);}
  // C9: every counterpart record traces to an invitation between exactly these two parties; no introduction names its
  // holder; recognition notices only at organizations that introduced someone.
  for(const cp of cps){const other=snap.get(cp.principal.sub)?.o,mine=await o.get('rel/inv/'+cp.invitation),theirs=other?await other.get('rel/inv/'+cp.invitation):null;
   const traced=mine&&mine.invitee.sub===cp.principal.sub||theirs&&theirs.invitee.sub===id;assert.ok(traced||now-(cp.since??0)>29*86400000,`${label}: C9 org ${o.n} recognizes org ${other?.n} without an invitation between them`);}
  for(const item of (await o.list('rel/intro/')).values())assert.notEqual(item.candidate.sub,id,`${label}: C9 an introduction names its holder`);
  if((await o.notices()).some(n=>n.type==='relation-recognition'))assert.ok((await o.list('rel/introduced/')).size>0,`${label}: C9 recognition at a non-proposer`);
 }
 // C3: sampled grantor checks agree with the direct edge in that instance only (no other path grants anything).
 const orgs=[...snap.values()],tuples=[];
 for(const {o,parts} of orgs)for(const part of parts.values())for(const {o:z} of orgs)if(z!==o)tuples.push([o,part,z]);
 for(let i=0;i<Math.min(24,tuples.length);i++){const [o,part,z]=tuples[(i*7919+history.size)%tuples.length];const cp=cpOf(snap,o.id,part.instance,z.id);
  for(const r of (await o.list('federation/resource/')).values())for(const contract of Object.keys(r.contracts)){const method=METHOD[contract];
   const allowed=await o.check(part.instance,z,r.id,contract,method),direct=cp?edgeAllows(part,cp,{resource:r.id,contract,method},now):false;
   // The check may refuse more (a lapsed required entry, a narrowed pool) but never grants beyond the direct edge.
   assert.ok(!allowed||direct,`${label}: C3 org ${o.n} → ${z.n}`);if(!cp)assert.equal(allowed,false);}}
 return snap;
}

async function chaos(seed,steps){
 const h=await relationsHost({seed,orgs:6}),rand=createRandom(seed*7919),docs=new Map();
 try{
  for(const [name,[pin]] of Object.entries(h.pins))docs.set(pin.digest,validateRelationBody(h.bodies[name]));
  for(const o of h.orgs.values())for(const k of ['a','b'])await o.resource(`${ISS}/r/${o.n}/${k}`,ALL);
  const orgs=[...h.orgs.values()],history=new Map(),log=[];
  // A three-partner instance from the start, so introductions (C9) have counterparts that can receive them.
  {const [X,P1,P2]=orgs,inst=(await X.run('relations.create',null,{relation:h.pins.partners[0],slots:['partner']})).instance;
   for(const p of [P1,P2]){const inv=await X.run('relations.invite',null,{instance:inst,slot:'partner',invitee:p.principal,values:{0:[{resource:`${ISS}/r/${X.n}/a`}]},receive:true});await h.accept(p,inv.invitation,{values:{0:[{resource:`${ISS}/r/${p.n}/a`}]}});}
   await h.drain();}
  const holderPair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),hj=await crypto.subtle.exportKey('jwk',holderPair.publicKey),holderKey={privateKey:holderPair.privateKey,jwk:{kty:'EC',crv:'P-256',x:hj.x,y:hj.y}};
  let faulty=false,lastResync=h.clock.now();h.faults.deliver=()=>faulty?rand.pick(['ok','ok','drop','dup','fail']):'ok';
  const pick=list=>list.length?rand.pick(list):null;
  // The organization's own pool (import mirrors are federation resources too, but never grant values).
  const pool=async o=>[...(await o.list('federation/resource/')).entries()].filter(([,r])=>!r.imported).map(([k])=>k.slice('federation/resource/'.length));
  const valuesFor=async(o,doc,from,to,all=false)=>{const out={};for(const e of edgeEntries(doc,from,to)){if(!e.required&&!all&&rand.chance(0.5))continue;out[e.index]=Object.keys(e.methods).length?[{resource:pick(await pool(o))}]:[];}return Object.keys(out).length?out:undefined;};
  const tolerate=async(name,fn)=>{try{await fn();log.push(name);}catch(e){if(!EXPECTED.has(e.code))throw new Error(`seed ${seed} step ${log.length} ${name}: unexpected ${e.code} ${e.stack}`);log.push(name+':'+e.code);}};
  const live=async o=>[...(await o.list('rel/instance/')).values()].filter(p=>p.state==='live');
  const cps=async o=>[...(await o.list('rel/cp/')).values()].filter(c=>c.state==='live');
  const ops={
   async create(){const o=pick(orgs),name=pick(Object.keys(SLOTS)),[as]=pick(SLOTS[name]);await tolerate('create',()=>o.run('relations.create',null,{relation:h.pins[name][0],slots:[as]}));},
   async invite(){const o=pick(orgs),part=pick(await live(o));if(!part)return;const doc=docs.get(part.relation.digest),name=[...Object.entries(h.pins)].find(([,p])=>p[0].digest===part.relation.digest)[0];
    const pairs=SLOTS[name].filter(([a])=>part.slots.includes(a));const pr=pick(pairs);if(!pr)return;const [as,slot]=pr,to=pick(orgs.filter(x=>x!==o));
    await tolerate('invite',async()=>o.run('relations.invite',null,{instance:part.instance,as,slot,invitee:to.principal,values:await valuesFor(o,doc,as,slot),receive:edgeEntries(doc,slot,as).length>0&&rand.chance(0.8)}));},
   async accept(){const o=pick(orgs),item=pick([...(await o.list('rel/inbound/')).values()]);if(!item)return;
    await tolerate('accept',async()=>{const view=await o.run('relations.inbound-preview',null,{invitation:item.meta});const doc=docs.get(view.relation.pin.digest);
     const values=await valuesFor(o,doc,view.slot,view.counterpartySlot,rand.chance(0.3));const r=rand.next();h.faults.redeem=()=>r<0.1?'lose':r<0.15?'fail':'ok';
     try{await o.run('relations.accept',null,{invitation:item.meta,disclosure:view.disclosure,...values?{values}:{},receive:view.receives.length>0&&rand.chance(0.85)});}finally{h.faults.redeem=()=>'ok';}});},
   async retryAccept(){const o=pick(orgs),row=pick([...(await o.list('rel/accepting/')).values()]);if(!row)return;const inv=[...(await h.orgs.get(row.inviter.sub).list('rel/inv/')).values()].find(i=>i.jti===row.jti);if(!inv)return;
    await tolerate('retry',async()=>{const view=await o.run('relations.inbound-preview',null,{invitation:inv.meta});const doc=docs.get(view.relation.pin.digest);await o.run('relations.accept',null,{invitation:inv.meta,disclosure:view.disclosure,values:await valuesFor(o,doc,view.slot,view.counterpartySlot,true),receive:view.receives.length>0});});},
   async withdraw(){const o=pick(orgs),inv=pick([...(await o.list('rel/inv/')).values()].filter(i=>i.state==='open'));if(!inv)return;await tolerate('withdraw',()=>o.run('relations.withdraw',null,{invitation:inv.jti}));},
   async narrowing(){const o=pick(orgs),cp=pick(await cps(o));if(!cp)return;const direction=rand.chance(0.6)?'outgoing':'incoming',action=pick(['relations.suspend','relations.suspend','relations.end','relations.narrow']);
    const input=action==='relations.narrow'?{instance:cp.instance,counterpart:cp.principal,entries:Object.fromEntries((cp.grant?.entries??[]).map(e=>[e.index,e.resources.length>1?[e.resources[0].resource]:true]))}:{instance:cp.instance,counterpart:cp.principal,direction};
    await tolerate(action,async()=>{await o.run(action,null,input);
     // C6: after a narrowing commit the dropped access is refused at once, whatever happens to delivery; a grantee's
     // own narrowing makes its imports from that grantor unavailable at once.
     const after=await o.cp(cp.instance,cp.principal),grantee={principal:cp.principal};
     if(action==='relations.narrow'||direction==='outgoing')for(const e of cp.grant?.entries??[])for(const r of e.resources){
      const kept=action==='relations.narrow'&&after.grant?.entries.some(x=>x.resources.some(y=>y.resource===r.resource));
      if(!kept)for(const [c,ms] of Object.entries(r.methods))assert.equal(await o.check(cp.instance,grantee,r.resource,c,ms[0]),false,`C6 seed ${seed}: refused at once`);}
     if(action!=='relations.narrow'&&direction==='incoming')for(const row of (await o.list('rel/import/')).values())if(row.instance===cp.instance&&row.grantor.sub===cp.principal.sub)assert.equal(row.status,'unavailable',`C6 seed ${seed}: imports held at once`);});},
   async resume(){const o=pick(orgs),cp=pick([...(await o.list('rel/cp/')).values()].filter(c=>c.grant?.state==='suspended'||c.acceptance?.state==='suspended'));if(!cp)return;
    await tolerate('resume',()=>o.run('relations.resume',null,{instance:cp.instance,counterpart:cp.principal,direction:cp.grant?.state==='suspended'?'outgoing':'incoming'}));},
   async leave(){if(!rand.chance(0.3))return;const o=pick(orgs),part=pick(await live(o));if(!part)return;await tolerate('leave',()=>o.run('relations.leave',null,{instance:part.instance}));},
   async drain(){faulty=rand.chance(0.6);await h.drain(3);faulty=false;},
   // The daily anti-entropy schedule ORG-10e will own: every simulated day, every organization re-sends its halves.
   async clock(){h.clock.advance(rand.int(4)*30*60000+rand.int(60000));if(h.clock.now()-lastResync>=86400000){lastResync=h.clock.now();for(const o of orgs)await o.system('relations.resync');}},
   async sweep(){const o=pick(orgs);await o.system('relations.sweep');},
   async flag(){const o=pick(orgs);if(h.flag.deny.has(o.id))h.flag.deny.delete(o.id);else if(rand.chance(0.3))h.flag.deny.set(o.id,new Set(['ORG_RELATIONS_ENABLED']));},
   async forged(){const [x,y]=rand.shuffle(orgs),part=pick(await live(y));if(!part)return;const before=JSON.stringify([...(await y.list('rel/'))]),count=h.counts.resolve;
    // Either an impersonation (claims another organization) or a non-counterpart speaking for itself; a counterpart
    // speaking for itself is a genuine event about its own halves, not a forgery.
    const selfOk=!await y.cp(part.instance,x),claimed=selfOk&&rand.chance(0.5)?x:pick(orgs.filter(z=>z!==x&&z!==y));
    const e={bindle:'relation-event',v:1,iss:ISS,sub:claimed.id,aud:`${ISS}/identity/${y.id}`,instance:part.instance,aep:0,iat:Math.floor(h.clock.now()/1000),jti:'forged-'+rand.int(1e9),events:{[RELATION_EVENT.edgeEnded]:{half:rand.chance(0.5)?'grant':'acceptance'}}};
    const answer=await h.ingest(y,x,e);// signed with x's key: an impersonation fails at step 3, a non-counterpart at step 2assert.deepEqual(answer,{accepted:true});assert.equal(h.counts.resolve,count,'C7: no lookup');
    assert.equal(JSON.stringify([...(await y.list('rel/'))]),before,`C7 seed ${seed}: forged or non-counterpart event changed state`);
    log.push('forged');},
   async resync(){const o=pick(orgs);await o.system('relations.resync');},
   // ORG-10e: an organization's authority epoch rises (recovery or break-glass taking effect); its next signed events
   // and certificates reset its counterparts. Sometimes the directory refresh reports it first.
   async aep(){if(!rand.chance(0.4))return;const o=pick(orgs),rec=await o.get('org/record-v1');await o.metadata.put('org/record-v1',{...rec,aep:(rec.aep??0)+1});
    if(rand.chance(0.5)){const holder=pick(orgs.filter(x=>x!==o));await holder.system('relations.observe-counterpart',{counterpart:o.principal,aep:(rec.aep??0)+1});}log.push('aep');},
   async reset(){const holder=pick(orgs),cp=pick([...(await holder.list('rel/cp/')).values()].filter(c=>c.state==='live'));if(!cp)return;const kind=rand.pick(['keyReset','contested','attested','move']);
    await holder.system('relations.observe-counterpart',{counterpart:cp.principal,...kind==='attested'||kind==='move'?{move:{to:cp.principal,attested:kind==='attested'}}:{[kind]:true}});log.push('reset:'+kind);},
   async confirm(){const o=pick(orgs),hold=pick([...(await o.list('rel/hold/')).values()]);if(!hold)return;const stale=rand.chance(0.2);
    await tolerate('confirm',()=>o.run('relations.confirm-counterpart',null,{counterpart:hold.principal,aep:stale?hold.aep-1:hold.aep}));},
   async introduce(){const o=pick(orgs),cp=pick(await cps(o));if(!cp)return;await tolerate('introduce',()=>o.run('relations.introduce',null,{instance:cp.instance,slot:cp.slot,candidate:cp.principal}));},
   async decide(){const o=pick(orgs),item=pick([...(await o.list('rel/intro/')).values()]);if(!item)return;
    if(rand.chance(0.5))await tolerate('decline-intro',()=>o.run('relations.decline',null,{item:item.id}));
    else await tolerate('admit',async()=>{const part=await o.part(item.instance),doc=part&&docs.get(part.relation.digest);if(!doc)return o.run('relations.decline',null,{item:item.id});const as=part.slots[0];
     await o.run('relations.admit',null,{introduction:item.id,as,values:await valuesFor(o,doc,as,item.slot),receive:edgeEntries(doc,item.slot,as).length>0});});},
   // ORG-10d: a grantee certifies one of its available imports for an application connection (organization context)
   // and presents the certificate at the grantor (C2).
   async cert(){const o=pick(orgs),row=pick([...(await o.list('rel/import/')).values()].filter(r=>r.status==='available'));if(!row)return;const r=pick(row.resources),g=h.orgs.get(row.grantor.sub);if(!r||!g)return;
    const mirror=await o.get('federation/resource/'+r.id);h.connections.set('cc',{generation:1,clientId:CLIENT});
    await o.metadata.put('federation/grant/chaos-'+r.id.slice(4,16),{id:'chaos-'+r.id.slice(4,16),active:true,clientId:CLIENT,connection:{id:'cc',generation:1},fields:['f'],methods:{f:ALL},resources:{f:[r.id]},...mirror?.generation?{resourceGenerations:{[r.id]:mirror.generation}}:{}});
    let out;try{out=await o.system('relations.certify',{client:{client_id:CLIENT,origin:'https://app.example'},grants:['chaos-'+r.id.slice(4,16)],field:'f',resource:r.id,delegate:holderKey.jwk});}catch(e){if(e.code!=='relation_certificate_unavailable')throw e;log.push('cert:unavailable');return;}
    const c=parseEntityCertificate(out.certificate).payload,contract=pick(Object.keys(c.methods)),method=rand.chance(0.8)?pick(c.methods[contract]):'delete';
    let allowed=false;try{allowed=(await g.system('relations.authorize',{form:'direct',certificate:out.certificate,proof:await dpopProof(holderKey,{bound:out.certificate,iat:Math.floor(h.clock.now()/1000)}),htm:'POST',htu:RPC,envelope:{resource:c.resource,contract,method,args:{key:'k'}}})).allowed;}catch(e){if(e.code!=='invalid_token')throw e;}
    if(allowed){const gcp=await g.cp(c.instance,o),gpart=await g.part(c.instance),hold=await g.get('rel/hold/'+principalKey(o.principal));
     assert.ok(c.methods[contract]?.includes(method),`C2 seed ${seed}: honoured outside the certificate`);assert.ok(edgeAllows(gpart,gcp,{resource:c.resource,contract,method},h.clock.now()),`C2 seed ${seed}: honoured outside the live edge in its instance`);
     assert.ok(!hold||hold.kind!=='full',`C8 seed ${seed}: a held counterpart's certificate was honoured`);}
    log.push(allowed?'cert:allowed':'cert:refused');},
  };
  const weights=[['create',3],['invite',9],['accept',9],['retryAccept',1],['withdraw',1],['narrowing',4],['resume',2],['leave',1],['drain',6],['clock',2],['sweep',1],['flag',1],['forged',2],['resync',1],['aep',1],['reset',1],['confirm',2],['introduce',2],['decide',2],['cert',3]];
  const bag=weights.flatMap(([n,w])=>Array(w).fill(n));
  for(let i=0;i<steps;i++){const name=rand.pick(bag);await ops[name]();await invariants(h,docs,history,`seed ${seed} step ${i} ${name}`);}
  // Convergence: faults stop, flags restore, anti-entropy runs everywhere, and every mirror equals its holder's half.
  h.flag.deny.clear();faulty=false;h.clock.advance(2*3600000);await h.drain(30);
  // Holds block widening by design: an admin confirms each remaining hold (at its current aep) before convergence.
  for(let round=0;round<3;round++){for(const o of orgs)for(const hold of (await o.list('rel/hold/')).values())await o.run('relations.confirm-counterpart',null,{counterpart:hold.principal,aep:hold.aep}).catch(e=>{if(e.code!=='relation_hold_changed'&&e.code!=='not_found')throw e;});
   for(const o of orgs)await o.system('relations.resync');await h.drain(30);}
  const snap=await invariants(h,docs,history,`seed ${seed} final`);
  for(const [id,{cps}] of snap)for(const cp of cps){const back=cpOf(snap,cp.principal.sub,cp.instance,id);if(!back||back.state==='pending'||cp.state==='pending')continue;
   // A view that no longer recognizes the counterpart tracks nothing; the counterpart must then have ended its halves.
   if(cp.state==='ended'){for(const k of ['grant','acceptance'])assert.ok(!back[k]||['ended','pending'].includes(back[k].state),`seed ${seed}: ${k} still open towards a party that ended`);continue;}
   for(const [mirror,holder,label] of [[cp.peerGrant,back.grant,'grant'],[cp.peerAcceptance,back.acceptance,'acceptance']]){if(!holder||holder.state==='pending')continue;
    assert.ok(mirror,`seed ${seed}: ${label} mirror missing after anti-entropy`);assert.equal(mirror.state,holder.state,`seed ${seed}: ${label} state converges`);if(holder.state!=='ended')assert.equal(mirror.generation,holder.generation,`seed ${seed}: ${label} generation converges`);}}
  // After convergence, available imports are exactly the grantor's live grant on a live edge.
  for(const [id,{o,parts,imports}] of snap)for(const row of imports){const grantor=snap.get(row.grantor.sub),gcp=grantor?.cps.find(c=>c.instance===row.instance&&c.principal.sub===id),gpart=grantor?.parts.get(row.instance);
   if(row.status==='available')assert.ok(gcp&&outgoingLive(gpart,gcp,h.clock.now()),`seed ${seed}: available import without a live grantor edge`);}
  assert.equal(await h.outbox(),0,`seed ${seed}: outbox drained`);
  return log;
 }finally{await h.close();}
}

for(const seed of [1,2,3,4,5,6])test(`relations chaos seed ${seed}: invariants C1–C9 after every step and convergence at the end`,async()=>{const log=await chaos(seed,120);assert.ok(log.some(x=>x==='accept'),'some acceptance succeeded');});
test('relations chaos: across seeds the ORG-10d/10e paths are exercised (holds, confirmations, introductions, honoured and refused certificates)',async()=>{
 const logs=[];for(const seed of [7,8,9])logs.push(...await chaos(seed,160));
 for(const kind of ['aep','confirm','introduce','cert:allowed','cert:refused'])assert.ok(logs.some(x=>x===kind),`${kind} happened`);
 assert.ok(logs.some(x=>x.startsWith('reset:')),'a key reset or move adoption happened');
});
