// ORG-10e relation events and lifecycle at the engine level (packages/orgs/relation-events.mjs, relation-lifecycle.mjs;
// spec §9.4 proposals, §9.9, §12 item 10, §14; design §8b.4, §8b.6, RL-4, RL-5, RL-6, RL-10, RL-12). Signed events on
// the same host through the same path as across providers, forged, replayed and reordered events, aep floors, the
// uniform answer, cache-only verification, manifest-only delivery, daily anti-entropy, and every lifecycle row.
import test from 'node:test';
import assert from 'node:assert/strict';
import {relationsHost,rejects,fault,ISS,DAY,STORE} from './helpers/relations-world.mjs';
import {principalKey} from '../packages/orgs/grants.mjs';
import {RELATION_EVENT} from '../packages/orgs/relation-edges.mjs';
import {manifestEventDelivery,parseRelationEvent,RELATION_EVENT_TYP} from '../packages/orgs/relation-events.mjs';
import {signCompact,STATEMENT_TYP} from '../packages/orgs/relation-statements.mjs';

const ALL={[STORE]:['get','list','put','delete']};
const res=(o,name)=>o.resource(`${ISS}/r/${o.n}/${name}`,ALL);
const st=(gen,state,entries)=>({[RELATION_EVENT.edgeState]:{half:'grant',generation:gen,state,...entries?{entries}:{}}});
const notices=async(o,type)=>(await o.notices()).filter(n=>n.type===type);
/** A shares a store with B; returns the instance and helpers. */
async function shared(opts={}){const h=await relationsHost({orgs:4,...opts}),[A,B,C,D]=h.list,rA=await res(A,'f'),{instance}=await h.relate(A,B,{give:{0:[{resource:rA}]}});
 const entries=[{index:0,resources:[{resource:rA,contracts:[STORE],methods:{[STORE]:['get','list','put']}}]}],status=async()=>(await B.imports())[0]?.status;
 return {h,A,B,C,D,rA,instance,entries,status};}

test('signed path: same-host events are JWS under the sender\'s certification key; no adapter-supplied sender is read',async()=>{const w=await shared();try{
 const {h,A,B,instance}=w;let seen=null;const base=h.faults.deliver;h.faults.deliver=(from,to,jws)=>{seen=jws;return 'ok';};
 await A.run('relations.suspend',null,{instance,counterpart:B.principal});await h.drain();h.faults.deliver=base;
 const parsed=parseRelationEvent(seen,{now:h.clock.now(),audience:`${ISS}/identity/${B.id}`});
 assert.equal(parsed.header.typ,RELATION_EVENT_TYP);assert.equal(parsed.header.kid,h.certs.get(A.id).kid,'signed with the certification key');assert.notEqual(parsed.header.kid,h.keys.get(A.id).kid,'never the identity key');
 assert.deepEqual(Object.keys(parsed.payload).sort(),['aep','aud','bindle','events','iat','instance','iss','jti','sub','v']);
 assert.equal(await w.status(),'unavailable');
 // ORG-10f gate: a `from` naming A next to an event signed by C changes nothing; an unsigned object is malformed.
 const forged=await h.sign(w.C,{...h.event(A,B,instance,{[RELATION_EVENT.edgeEnded]:{half:'grant'}})});
 assert.deepEqual(await B.system('relations.ingest',{event:forged,from:A.principal}),{accepted:true});assert.equal((await B.cp(instance,A)).peerGrant.state,'suspended');
 await rejects(B.system('relations.ingest',{event:h.event(A,B,instance,{[RELATION_EVENT.edgeEnded]:{half:'grant'}}),from:A.principal}),'relation_event_invalid');
}finally{await w.h.close();}});

test('forged, tampered, cross-profile and earlier-key events change nothing and get the same answer',async()=>{const w=await shared();try{
 const {h,A,B,C,instance,entries}=w,snap=async()=>JSON.stringify([...(await B.list('rel/'))]);let before=await snap();
 // Another organization's key claiming A; a payload altered after signing; the same bytes under a statement typ.
 assert.deepEqual(await h.ingest(B,C,h.event(A,B,instance,st(9,'suspended'))),{accepted:true});
 const good=await h.sign(A,h.event(A,B,instance,st(9,'suspended'))),[hd,pl,sg]=good.split('.');
 const altered=JSON.parse(Buffer.from(pl,'base64url'));altered.events=st(9,'live',entries);
 assert.deepEqual(await B.system('relations.ingest',{event:`${hd}.${Buffer.from(JSON.stringify(altered)).toString('base64url')}.${sg}`}),{accepted:true});
 assert.equal(await snap(),before,'neither changed anything (not even a jti row)');
 const k=h.certs.get(A.id),asStatement=await signCompact({typ:STATEMENT_TYP,kid:k.kid,privateKey:k.privateKey,payload:h.event(A,B,instance,st(9,'suspended'))});
 await rejects(B.system('relations.ingest',{event:asStatement}),'relation_event_invalid','a JWS of another profile fails step 1');
 // A rotated certification key: once refreshed, an event signed by the earlier key no longer verifies.
 const old=h.certs.get(A.id);await h.mintCert(A.id);h.certCache.set(A.id,[{kid:h.certs.get(A.id).kid,publicJwk:h.certs.get(A.id).publicJwk}]);
 assert.deepEqual(await h.ingest(B,A,h.event(A,B,instance,st(9,'suspended')),{key:old}),{accepted:true});assert.equal(await w.status(),'available');
 await h.ingest(B,A,h.event(A,B,instance,st(9,'suspended')));assert.equal(await w.status(),'unavailable','the current key verifies');
}finally{await w.h.close();}});

test('replay and jti poisoning: a jti is recorded only after the signature verifies, and never reprocessed',async()=>{const w=await shared();try{
 const {h,A,B,C,instance,entries}=w,jti='poisoned-jti';
 // A forger sends jti J first (bad signature); A's genuine event with jti J is still applied.
 await h.ingest(B,C,h.event(A,B,instance,st(5,'suspended'),{jti}));assert.equal(await w.status(),'available');
 await h.ingest(B,A,h.event(A,B,instance,st(5,'suspended'),{jti}));assert.equal(await w.status(),'unavailable');
 // A re-signed retry (same jti, new iat) is answered 202 and not reprocessed, even carrying something else.
 h.clock.advance(5000);assert.deepEqual(await h.ingest(B,A,h.event(A,B,instance,st(6,'live',entries),{jti})),{accepted:true});assert.equal(await w.status(),'unavailable');
 // After the replay window the iat itself is stale: refused at step 1.
 await rejects(h.ingest(B,A,h.event(A,B,instance,st(7,'live',entries),{iat:Math.floor(h.clock.now()/1000)-301})),'relation_event_invalid');
}finally{await w.h.close();}});

test('reordering: an end is final, the highest generation wins, a resume reordered after an end revives nothing',async()=>{const w=await shared();try{
 const {h,A,B,instance,entries}=w,base=(await A.cp(instance,B)).grant.generation;
 await h.ingest(B,A,h.event(A,B,instance,st(base+3,'suspended')));await h.ingest(B,A,h.event(A,B,instance,st(base+2,'live',entries)));assert.equal(await w.status(),'unavailable','older live after newer suspension');
 await h.ingest(B,A,h.event(A,B,instance,{[RELATION_EVENT.edgeEnded]:{half:'grant'}}));await h.ingest(B,A,h.event(A,B,instance,st(base+9,'live',entries)));
 assert.equal((await B.cp(instance,A)).peerGrant.state,'ended');assert.equal(await w.status(),'unavailable');
}finally{await w.h.close();}});

test('aep: widening below the floor is refused, narrowing always applies, a higher aep holds (RL-4) and no event releases it',async()=>{const w=await shared();try{
 const {h,A,B,instance,entries}=w,base=(await A.cp(instance,B)).grant.generation,hk='rel/hold/'+principalKey(A.principal);
 await h.ingest(B,A,h.event(A,B,instance,st(base+1,'suspended'),{aep:0}));
 await h.ingest(B,A,h.event(A,B,instance,st(base+2,'live',entries),{aep:4}));assert.equal(await w.status(),'unavailable','the reset itself is not honoured');assert.equal((await B.get(hk)).aep,4);
 await h.ingest(B,A,h.event(A,B,instance,st(base+3,'live',entries),{aep:4}));assert.equal(await w.status(),'unavailable','held: nothing widening is honoured');
 await h.ingest(B,A,h.event(A,B,instance,st(base+4,'suspended'),{aep:0}));assert.equal((await B.cp(instance,A)).peerGrant.generation,base+4,'narrowing below the floor still applies');
 await B.run('relations.confirm-counterpart',null,{counterpart:A.principal,aep:4});assert.equal(await B.get(hk),undefined);
 await h.ingest(B,A,h.event(A,B,instance,st(base+5,'live',entries),{aep:3}));assert.equal(await w.status(),'unavailable','widening below the floor is refused');
 await h.ingest(B,A,h.event(A,B,instance,st(base+6,'live',entries),{aep:4}));assert.equal(await w.status(),'available');
}finally{await w.h.close();}});

test('the uniform answer: 202 for every event past step 1, whoever sends it and whatever it names; 400 only for step 1',async()=>{const w=await shared();try{
 const {h,A,B,C,instance}=w,answers=[];
 for(const [from,payload] of [[A,h.event(A,B,instance,st(99,'suspended'))],[C,h.event(C,B,instance,st(1,'suspended'))],[C,h.event(A,B,instance,st(1,'suspended'))],[A,h.event(A,B,`${ISS}/relations/i/00000000-0000-4000-8000-000000000000`,st(1,'suspended'))],[A,h.event(A,B,instance,{[RELATION_EVENT.busAdvanced]:{bus:'x',head:'y'}})]])
  answers.push(await h.ingest(B,from,payload));
 assert.ok(answers.every(a=>JSON.stringify(a)==='{"accepted":true}'),JSON.stringify(answers));
 for(const bad of ['',{},'a.b.c',await h.sign(A,{...h.event(A,B,instance,st(1,'suspended')),aud:`${ISS}/identity/${C.id}`}),await h.sign(A,{...h.event(A,B,instance,st(1,'suspended')),extra:1}),await h.sign(A,h.event(A,B,instance,{}))])
  {const f=await fault(B.system('relations.ingest',{event:bad}));assert.deepEqual([f.code,f.status],['relation_event_invalid',400]);}
}finally{await w.h.close();}});

test('no fetch during verification: cache-only keys; a missing key schedules the same refresh for anyone; anti-entropy recovers',async()=>{const w=await shared();try{
 const {h,A,B,C,instance}=w;await h.refreshKeys();const count=h.counts.resolve,rows=async()=>(await B.list('org/cert/refresh/')).size;
 const cur=(await A.cp(instance,B)).grant.generation;for(let i=0;i<3;i++)await h.ingest(B,A,h.event(A,B,instance,st(cur,'live',w.entries)));assert.equal(await w.status(),'available');await h.ingest(B,C,h.event(C,B,instance,st(1,'suspended')));
 assert.equal(h.counts.resolve,count,'no lookup at all');assert.equal(await rows(),0,'warm keys schedule nothing');
 h.coldKey(A.id);h.coldKey(C.id);
 await A.run('relations.suspend',null,{instance,counterpart:B.principal});await h.drain();assert.equal(await w.status(),'available','not processed: the key is not held');
 assert.equal(await rows(),1);await h.ingest(B,C,h.event(C,B,instance,st(2,'suspended')));assert.equal(await rows(),2,'a non-counterpart schedules exactly the same');assert.equal(h.counts.resolve,count);
 await h.refreshKeys();await A.system('relations.resync');await h.drain();assert.equal(await w.status(),'unavailable','the next anti-entropy round converges');
}finally{await w.h.close();}});

test('events endpoint only from the counterpart\'s current manifest (RL-6); a redemption answer naming an URL is ignored',async()=>{
 const posts=[],manifests={'https://peer.example':{features:{'relations.v1':{events_endpoint:'https://peer.example/relations/events'}}},'https://bad.example':{features:{'relations.v1':{events_endpoint:'http://10.0.0.1/hook'}}},'https://other.example':{features:{'relations.v1':{events_endpoint:'https://attacker.example/x'}}}};
 const moved=new Map([['https://old.example','https://peer.example']]);
 const deliver=manifestEventDelivery({current:async p=>({iss:moved.get(p.iss)??p.iss,sub:p.sub}),manifest:async iss=>manifests[iss]??null,post:async(url,body,o)=>{posts.push([url,o.contentType]);return {status:202};}});
 const sub='00000000-0000-4000-8000-000000000001';
 await deliver({iss:'https://peer.example',sub},'jws');await deliver({iss:'https://old.example',sub},'jws');
 assert.deepEqual(posts,[['https://peer.example/relations/events','application/secevent+jwt'],['https://peer.example/relations/events','application/secevent+jwt']],'after a move, the current issuer\'s manifest');
 for(const iss of ['https://bad.example','https://other.example','https://none.example'])await assert.rejects(deliver({iss,sub},'jws'),{code:'relation_delivery_unavailable'});
 assert.equal(posts.length,2);
 // Same host: the inviter's redemption answer carries an extra events URL; nothing uses it.
 const h=await relationsHost({orgs:2});try{const [A,B]=h.list,rA=await res(A,'f'),targets=[];
  const redeem=B.relations.transport.redeem;B.relations.transport={...B.relations.transport,redeem:async(...a)=>({...await redeem(...a),events_endpoint:'http://169.254.169.254/latest'})};
  const base=h.faults.deliver;h.faults.deliver=(from,to)=>{targets.push(to.sub);return 'ok';};
  await h.relate(A,B,{give:{0:[{resource:rA}]}});h.faults.deliver=base;
  assert.ok(targets.length>0&&targets.every(t=>[A.id,B.id].includes(t)),'events went only to the counterparts themselves');
 }finally{await h.close();}
});

test('daily anti-entropy: relations.tick re-sends every half once a day, so a dropped event converges',async()=>{const w=await shared();try{
 const {h,A,B,instance}=w;await A.system('relations.tick');await B.system('relations.tick');
 const drop=h.faults.deliver;h.faults.deliver=()=> 'drop';await A.run('relations.suspend',null,{instance,counterpart:B.principal});await h.drain();h.faults.deliver=drop;
 assert.equal(await w.status(),'available','the suspension was lost');
 const t=await A.system('relations.tick');assert.equal(t.resynced,false,'not due yet');assert.ok(t.wakeAt<=h.clock.now()+DAY);
 h.clock.advance(DAY);const t2=await A.system('relations.tick');assert.equal(t2.resynced,true);await h.drain();
 assert.equal(await w.status(),'unavailable','converged');
}finally{await w.h.close();}});

test('RL-4 counterpart authority reset: full hold until an admin confirms that aep; a cancelled recovery holds nothing',async()=>{const w=await shared();try{
 const {h,A,B,rA,instance}=w,observe=input=>A.system('relations.observe-counterpart',{counterpart:B.principal,...input});
 assert.equal((await observe({aep:0})).held,false,'an unchanged aep (a cancelled recovery raises none) holds nothing');
 assert.deepEqual(await observe({aep:2}),{held:true,kind:'full',aep:2});
 assert.equal(await A.check(instance,B,rA,STORE,'get'),false,'its calls are refused (C8)');
 assert.equal((await A.run('relations.get',null,{instance})).counterparts[0].hold.kind,'full');assert.ok((await notices(A,'relation-counterpart-held')).length>=1);
 // B's widening event does not release the hold; B's narrowing still applies.
 await B.run('relations.end',null,{instance,counterpart:A.principal,direction:'incoming'}).catch(()=>{});
 await rejects(A.run('relations.confirm-counterpart',null,{counterpart:B.principal,aep:1}),'relation_hold_changed');
 await A.run('relations.confirm-counterpart',null,{counterpart:B.principal,aep:2});
 // Later resets need a new confirmation: a key reset without continuity and a contested identity.
 assert.equal((await observe({keyReset:true})).kind,'full');await A.run('relations.confirm-counterpart',null,{counterpart:B.principal,aep:2});
 assert.equal((await observe({contested:true})).kind,'full');
 assert.equal((await A.run('relations.holds',null,{})).holds.length,1);
}finally{await w.h.close();}});

test('RL-4 moves: an attested move holds writes for 72 h; an unattested move holds everything; events follow the successor',async()=>{const w=await shared();try{
 const {h,A,B,C,D,rA,instance,entries}=w;
 // B "moves" to D's principal (another identity and key on this loopback host stands in for the destination).
 const out=await A.system('relations.observe-counterpart',{counterpart:B.principal,move:{to:D.principal,attested:true}});assert.deepEqual([out.kind],['write']);
 assert.equal(await A.check(instance,B,rA,STORE,'get'),true,'reads continue under the write hold');assert.equal(await A.check(instance,B,rA,STORE,'put'),false,'writes are held');
 // Events: from the destination they verify through the successor index; from the earlier host they fail step 2.
 const base=(await A.cp(instance,B)).peerAcceptance.generation;
 await h.ingest(A,B,{...h.event(B,A,instance,{[RELATION_EVENT.edgeState]:{half:'acceptance',generation:base+1,state:'suspended'}})});assert.equal((await A.cp(instance,B)).peerAcceptance.generation,base,'the earlier host fails');
 await h.ingest(A,D,{...h.event(D,A,instance,{[RELATION_EVENT.edgeState]:{half:'acceptance',generation:base+1,state:'suspended'}})});assert.equal((await A.cp(instance,B)).peerAcceptance.generation,base+1,'the current host verifies');
 await h.ingest(A,D,{...h.event(D,A,instance,{[RELATION_EVENT.edgeState]:{half:'acceptance',generation:base+2,state:'live'}})});
 // Delivery goes to the current principal.
 const targets=[],keep=h.faults.deliver;h.faults.deliver=(from,to)=>{targets.push(to.sub);return 'drop';};await A.run('relations.suspend',null,{instance,counterpart:B.principal});await h.drain();h.faults.deliver=keep;assert.deepEqual(targets,[D.id]);
 await A.run('relations.resume',null,{instance,counterpart:B.principal});
 // 72 h later the write hold has run out; the admins are told.
 h.clock.advance(72*3600000+1000);await A.system('relations.tick');assert.equal(await A.check(instance,B,rA,STORE,'put'),true);assert.ok((await notices(A,'relation-counterpart-hold-ended')).length===1);
 // An unattested (or hand-adopted) move holds everything until an admin confirms.
 const full=await A.system('relations.observe-counterpart',{counterpart:D.principal,move:{to:C.principal,attested:false}});assert.equal(full.kind,'full');
 assert.equal(await A.check(instance,B,rA,STORE,'get'),false);
 h.clock.advance(80*3600000);await A.system('relations.tick');assert.equal(await A.check(instance,B,rA,STORE,'get'),false,'a full hold never times out');
 await A.run('relations.confirm-counterpart',null,{counterpart:B.principal,aep:full.aep});assert.equal(await A.check(instance,B,rA,STORE,'get'),true);
 assert.ok(entries);
}finally{await w.h.close();}});

test('RL-10 own move: outgoing edges arrive suspended; rebinding keeps the import id, members keep their grants',async()=>{const w=await shared();try{
 const {h,A,B,instance}=w,imp=(await B.imports())[0].resources[0].id,mk=principalKey({iss:ISS,sub:B.member}),m=await B.get('org/member/'+mk);
 await B.run('orgs.member-grants',null,{membership:m.id,grants:[{resource:imp,methods:{[STORE]:['get']}}]});
 assert.equal((await A.system('relations.lifecycle',{event:'moved-in'})).changed,1);await h.drain();
 assert.equal(await w.status(),'unavailable');assert.ok((await notices(A,'relation-rebind-needed')).length===1);
 await rejects(A.run('relations.resume',null,{instance,counterpart:B.principal}),'relation_rebind_required','an edge that arrived suspended is re-bound, not resumed');
 // A's destination resource (the move changed resource identifiers).
 const fresh=await A.resource(`${ISS}/r/1/moved`,ALL);await A.metadata.transaction(tx=>tx.delete('federation/resource/'+w.rA));
 await A.run('relations.rebind',null,{instance,counterpart:B.principal,values:{0:[{resource:fresh}]}});await h.drain();
 const now=(await B.imports())[0];assert.equal(now.status,'available');assert.equal(now.resources[0].id,imp,'the import id is kept');assert.equal(now.resources[0].resource,fresh);
 assert.equal((await B.imports(B.member)).length,1,'the member\'s grant survives');assert.ok((await notices(B,'relation-import-rebound')).length===1,'the grantee is told');
 assert.equal((await B.get('federation/resource/'+imp)).generation,1,'an application approval of the earlier resource no longer applies');
 assert.equal(await A.check(instance,B,fresh,STORE,'get'),true);
 await rejects(A.run('relations.rebind',null,{instance,counterpart:B.principal,values:{0:[{resource:fresh}]}}),'not_found','only an edge that arrived suspended');
}finally{await w.h.close();}});

test('deletion takes effect: the pre-purge step leaves every instance; purge waits for acknowledgement or 72 h',async()=>{const w=await shared();try{
 const {h,A,B,C,instance}=w;await h.relate(A,C,{give:{0:[{resource:w.rA}]}});
 assert.deepEqual(await A.system('relations.purge-ready'),{ready:false,closing:false});
 h.faults.deliver=(from,to)=>to.sub===C.id?'fail':'ok';
 assert.equal((await A.system('relations.lifecycle',{event:'deletion-effect'})).left,2);
 await rejects(A.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']}),'organization_deletion_pending');
 await h.drain();assert.equal((await B.cp(instance,A)).peerGrant.state,'ended','the counterpart learns at once');
 assert.equal((await A.system('relations.purge-ready')).ready,false,'C has not acknowledged');
 h.clock.advance(72*3600000);assert.equal((await A.system('relations.purge-ready')).ready,true,'72 h later the purge proceeds anyway');
}finally{await w.h.close();}});

test('an unreachable counterpart is never treated as revoked; after 30 days its admins are told once',async()=>{const w=await shared();try{
 const {h,A,B,rA,instance}=w;h.faults.deliver=(from,to)=>to.sub===B.id?'fail':'ok';
 for(let d=0;d<31;d++){h.clock.advance(DAY);await A.system('relations.tick');}
 assert.equal(await A.check(instance,B,rA,STORE,'get'),true,'edges stay');const v=(await A.run('relations.get',null,{instance})).counterparts[0];assert.equal(v.unreachable.flagged,true);
 assert.equal((await notices(A,'relation-counterpart-unreachable')).length,1);
 h.faults.deliver=()=>'ok';h.clock.advance(DAY);await A.system('relations.tick');assert.equal((await A.run('relations.get',null,{instance})).counterparts[0].unreachable,undefined,'delivery resumed');
}finally{await w.h.close();}});

test('key compromise raises every outgoing generation; billing read-only and export-only; narrowing never gated',async()=>{const w=await shared();try{
 const {h,A,B,rA,instance}=w,g=(await A.cp(instance,B)).grant.generation;
 await A.system('relations.lifecycle',{event:'key-compromise'});await h.drain();assert.equal((await A.cp(instance,B)).grant.generation,g+1);assert.equal((await B.cp(instance,A)).peerGrant.generation,g+1);assert.equal(await w.status(),'available');
 await A.system('relations.lifecycle',{event:'billing',stage:'read-only'});
 assert.equal(await A.check(instance,B,rA,STORE,'get'),true);assert.equal(await A.check(instance,B,rA,STORE,'put'),false);
 await rejects(A.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']}),'relation_billing_lapsed');
 await A.system('relations.lifecycle',{event:'billing',stage:'export-only'});await h.drain();assert.equal(await w.status(),'unavailable');assert.equal(await A.check(instance,B,rA,STORE,'get'),false);
 await A.system('relations.lifecycle',{event:'billing',stage:'active'});await h.drain();assert.equal(await w.status(),'available','restored with a new generation');assert.equal((await A.cp(instance,B)).grant.generation,g+3);
 // An edge an admin suspended stays suspended when billing recovers.
 await A.run('relations.suspend',null,{instance,counterpart:B.principal});await A.system('relations.lifecycle',{event:'billing',stage:'export-only'});await A.system('relations.lifecycle',{event:'billing',stage:'active'});
 assert.equal((await A.cp(instance,B)).grant.state,'suspended');
}finally{await w.h.close();}});

test('introductions (C9): only to counterparts with a live edge, confer nothing, deduplicated, never shown to the candidate',async()=>{const h=await relationsHost({orgs:4});try{
 const [X,P1,P2,Q]=h.list,s=await Promise.all([res(X,'a'),res(P1,'a'),res(P2,'a')]);
 const inst=(await X.run('relations.create',null,{relation:h.pins.partners[0],slots:['partner']})).instance;
 for(const [p,r] of [[P1,s[1]],[P2,s[2]]]){const inv=await X.run('relations.invite',null,{instance:inst,slot:'partner',invitee:p.principal,values:{0:[{resource:s[0]}]},receive:true});await h.accept(p,inv.invitation,{values:{0:[{resource:r}]}});}
 await h.drain();
 const rows=async o=>JSON.stringify([...(await o.list('rel/cp/'))]);const p1before=await rows(P1),p2before=await rows(P2);
 await rejects(X.run('relations.introduce',null,{instance:inst,slot:'partner',candidate:Q.principal}),'relation_introduction_invalid','RL-12: no live edge with the candidate');
 await rejects(X.run('relations.introduce',X.member,{instance:inst,slot:'partner',candidate:P2.principal}),'not_found');
 assert.deepEqual(await X.run('relations.introduce',null,{instance:inst,slot:'partner',candidate:P2.principal}),{introduced:1});await h.drain();
 const items=(await P1.run('relations.inbound',null,{})).introductions;assert.equal(items.length,1);assert.deepEqual([items[0].proposer,items[0].candidate],[X.principal,P2.principal]);
 assert.equal(await rows(P1),p1before,'an introduction creates no edge');assert.equal(await rows(P2),p2before);
 assert.equal((await P2.list('rel/intro/')).size,0,'the candidate is never told');
 // Deduplicated per (instance, proposer, slot, candidate).
 await X.run('relations.introduce',null,{instance:inst,slot:'partner',candidate:P2.principal});await h.drain();assert.equal((await P1.list('rel/intro/')).size,1);
 // P1 declines: only the proposer hears, never the candidate.
 await P1.run('relations.decline',null,{item:items[0].introduction});await h.drain();
 const told=await notices(X,'relation-recognition');assert.equal(told.length,1);assert.equal(told[0].outcome,'declined');
 assert.equal((await notices(P2,'relation-recognition')).length,0);assert.equal(await rows(P2),p2before,'the candidate\'s view never contains a declining party');
 // Admission is an invitation like any other: only the candidate's acceptance makes an edge.
 X.relations.random;const again=await h.orgs.get(X.id).run('relations.introduce',null,{instance:inst,slot:'partner',candidate:P1.principal});assert.equal(again.introduced,1);await h.drain();
 const item=(await P2.run('relations.introductions',null,{})).items[0];
 const inv=await P2.run('relations.admit',null,{introduction:item.introduction,values:{0:[{resource:s[2]}]},receive:true});
 assert.equal(await P1.cp(inst,P2),undefined,'still no edge before the candidate accepts');await h.drain();
 await h.accept(P1,inv.invitation,{values:{0:[{resource:s[1]}]}});await h.drain();
 assert.equal((await P1.cp(inst,P2)).state,'live');assert.equal((await notices(X,'relation-recognition')).filter(n=>n.outcome==='recognized').length,1);
}finally{await h.close();}});

test('introduction limits: 10 a day per proposer, muted proposers dropped silently, nothing while relations are off',async()=>{const h=await relationsHost({orgs:3});try{
 const [X,P1,P2]=h.list,s=await Promise.all([res(X,'a'),res(P1,'a'),res(P2,'a')]),inst=(await X.run('relations.create',null,{relation:h.pins.partners[0],slots:['partner']})).instance;
 for(const [p,r] of [[P1,s[1]],[P2,s[2]]]){const inv=await X.run('relations.invite',null,{instance:inst,slot:'partner',invitee:p.principal,values:{0:[{resource:s[0]}]},receive:true});await h.accept(p,inv.invitation,{values:{0:[{resource:r}]}});}
 await h.drain();
 h.flag.deny.set(P1.id,new Set(['ORG_RELATIONS_ENABLED']));await X.run('relations.introduce',null,{instance:inst,slot:'partner',candidate:P2.principal});await h.drain();assert.equal((await P1.list('rel/intro/')).size,0);h.flag.deny.clear();
 await P1.run('relations.mute',null,{organization:X.principal});await X.run('relations.introduce',null,{instance:inst,slot:'partner',candidate:P2.principal});await h.drain();assert.equal((await P1.list('rel/intro/')).size,0,'muted');
 await P1.run('relations.mute',null,{organization:X.principal,muted:false});
 // The day budget counts recorded items only; distinct candidates are needed, so the bound is exercised directly.
 const day=Math.floor(h.clock.now()/DAY);await P1.metadata.put('rel/intro-day/'+principalKey(X.principal)+'/'+day,10);
 await X.run('relations.introduce',null,{instance:inst,slot:'partner',candidate:P2.principal});await h.drain();assert.equal((await P1.list('rel/intro/')).size,0,'over the daily limit');
 h.clock.advance(DAY);await X.run('relations.introduce',null,{instance:inst,slot:'partner',candidate:P2.principal});await h.drain();assert.equal((await P1.list('rel/intro/')).size,1);
 h.clock.advance(31*DAY);await P1.system('relations.sweep');assert.equal((await P1.list('rel/intro/')).size,0,'expired after 30 days');
}finally{await h.close();}});

// ---- review round 2 (ORG-10d/e independent review; implemented locally, provisional) --------------------------------
test('review M1: the pre-purge step reaches every participation past any number of left rows; ready only when none remains',async()=>{const w=await shared();try{
 const {h,A,B,instance}=w;
 for(let i=0;i<300;i++){const inst=`${ISS}/relations/i/0000${String(i).padStart(4,'0')}-0000-4000-8000-000000000000`;
  await A.metadata.put('rel/instance/'+encodeURIComponent(inst),{v:1,instance:inst,relation:h.pins.share[0],slots:['owner'],state:'left',creator:true,createdAt:0,leftAt:0});}
 await A.system('relations.lifecycle',{event:'deletion-effect'});
 let ready=false;for(let i=0;i<5&&!ready;i++){await A.system('relations.tick');await h.drain();ready=(await A.system('relations.purge-ready')).ready;}
 assert.equal((await A.part(instance)).state,'left','the live participation was left');assert.equal((await B.cp(instance,A)).peerGrant.state,'ended','the counterpart was told');
 assert.equal(ready,true);
 // Left participations go 30 days after leaving, with their counterpart records and import mirrors.
 h.clock.advance(31*DAY);await A.system('relations.sweep');assert.equal(await A.part(instance),undefined);assert.equal(await A.cp(instance,B),undefined);
 await B.run('relations.leave',null,{instance});const imp=(await B.list('rel/import-id/')).keys().next().value?.slice('rel/import-id/'.length);
 h.clock.advance(31*DAY);await B.system('relations.sweep');assert.equal(await B.part(instance),undefined);assert.equal((await B.list('rel/import/')).size,0);if(imp)assert.equal(await B.get('federation/resource/'+imp),undefined);
}finally{await w.h.close();}});

test('review L1: forged generations from a compromised key do not outlive the confirmed reset',async()=>{const h=await relationsHost();try{
 const [A,B]=h.list,r=await B.resource(`${ISS}/r/2/f`,ALL),{instance}=await h.relate(B,A,{give:{0:[{resource:r}]}});
 await h.ingest(B,A,h.event(A,B,instance,{[RELATION_EVENT.edgeState]:{half:'acceptance',generation:Number.MAX_SAFE_INTEGER,state:'live'}}));
 await h.mintCert(A.id);await B.system('relations.observe-counterpart',{counterpart:A.principal,keyReset:true});
 const hold=await B.get('rel/hold/'+principalKey(A.principal));await B.run('relations.confirm-counterpart',null,{counterpart:A.principal,aep:hold.aep});
 await A.run('relations.suspend',null,{instance,counterpart:B.principal,direction:'incoming'});await h.drain();
 assert.equal((await B.cp(instance,A)).peerAcceptance.state,'suspended','the legitimate suspension applies');assert.equal(await B.check(instance,A,r,STORE,'get'),false);
}finally{await h.close();}});

test('review L2: an edge that arrived suspended after a move still needs re-binding after it is narrowed',async()=>{const h=await relationsHost();try{
 const [A,B]=h.list,r1=await res(A,'f1'),r2=await res(A,'f2'),i2=(await A.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']})).instance;
 const inv=await A.run('relations.invite',null,{instance:i2,as:'owner',slot:'recipient',invitee:B.principal,values:{0:[{resource:r1},{resource:r2}]},receive:false});
 await h.accept(B,inv.invitation,{receive:true});await h.drain();await A.system('relations.lifecycle',{event:'moved-in'});
 await A.run('relations.narrow',null,{instance:i2,counterpart:B.principal,entries:{0:[r1]}});assert.equal((await A.cp(i2,B)).grant.cause,'moved');
 await rejects(A.run('relations.resume',null,{instance:i2,counterpart:B.principal}),'relation_rebind_required');
}finally{await h.close();}});

test('review L5: a different resource without the grantor\'s replacement mark gets a new import id; members\' grants do not carry over',async()=>{const w=await shared();try{
 const {h,A,B,instance}=w,imp=(await B.imports())[0].resources[0].id,m=await B.get('org/member/'+principalKey({iss:ISS,sub:B.member}));
 await B.run('orgs.member-grants',null,{membership:m.id,grants:[{resource:imp,methods:{[STORE]:['get']}}]});
 const other=await res(A,'other'),gen=(await A.cp(instance,B)).grant.generation;
 await h.ingest(B,A,h.event(A,B,instance,st(gen+1,'live',[{index:0,resources:[{resource:other,contracts:[STORE],methods:{[STORE]:['get']}}]}])));
 const now=(await B.imports())[0].resources;assert.equal(now.length,1);assert.notEqual(now[0].id,imp,'a new id');assert.equal(await B.get('federation/resource/'+imp),undefined,'the old mirror is gone');
 assert.equal((await B.imports(B.member)).length,0,'the member grant names the old id, which no longer resolves');
 // With the mark (what relations.rebind sends), the id is kept.
 await h.ingest(B,A,h.event(A,B,instance,st(gen+2,'live',[{index:0,resources:[{resource:w.rA,contracts:[STORE],methods:{[STORE]:['get']},replaces:other}]}])));
 assert.equal((await B.imports())[0].resources[0].id,now[0].id);
}finally{await w.h.close();}});

test('review L7 and recognition recipients: day counters and sent-introduction records are pruned; only recipients are heard',async()=>{const h=await relationsHost({orgs:3});try{
 const [X,P1,P2]=h.list,s=await Promise.all([res(X,'a'),res(P1,'a'),res(P2,'a')]),inst=(await X.run('relations.create',null,{relation:h.pins.partners[0],slots:['partner']})).instance;
 for(const [p,r] of [[P1,s[1]],[P2,s[2]]]){const inv=await X.run('relations.invite',null,{instance:inst,slot:'partner',invitee:p.principal,values:{0:[{resource:s[0]}]},receive:true});await h.accept(p,inv.invitation,{values:{0:[{resource:r}]}});}
 await h.drain();await X.run('relations.introduce',null,{instance:inst,slot:'partner',candidate:P2.principal});await h.drain();
 // P2 (a counterpart, but not a recipient of this introduction) sends a recognition: ignored. P1's is heard.
 const rec=outcome=>({[RELATION_EVENT.recognition]:{slot:'partner',candidate:P2.principal,outcome}});
 await h.ingest(X,P2,h.event(P2,X,inst,rec('declined')));assert.equal((await notices(X,'relation-recognition')).length,0);
 await h.ingest(X,P1,h.event(P1,X,inst,rec('recognized')));assert.equal((await notices(X,'relation-recognition')).length,1);
 assert.equal((await P1.list('rel/intro-day/')).size,1);assert.equal((await X.list('rel/introduced/')).size,1);
 h.clock.advance(31*DAY);await P1.system('relations.sweep');await X.system('relations.sweep');
 assert.equal((await P1.list('rel/intro-day/')).size,0);assert.equal((await X.list('rel/introduced/')).size,0);
}finally{await h.close();}});
