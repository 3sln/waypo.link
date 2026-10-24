// Regression tests for the ORG-10a–c agent cross-review (2026-10-24, findings H1, M2–M6, M8, L9, L11, L13, L14, L16,
// L17, L21). Each fails if its fix is removed. Engine level on the loopback host; local behaviour only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {relationsHost,rejects,ISS,DAY,STORE} from './helpers/relations-world.mjs';
import {RELATION_EVENT} from '../packages/orgs/relation-edges.mjs';
import {RELATION_INVITATION_MAX_MS} from '../packages/orgs/relation-invitations.mjs';

const ALL={[STORE]:['get','list','put','delete']};
const res=(o,name)=>o.resource(`${ISS}/r/${o.n}/${name}`,ALL);
const mk=async o=>(await o.run('relations.create',null,{relation:o.host.pins.share[0],slots:['owner']})).instance;

async function host(n=3){const h=await relationsHost({orgs:n});for(const o of h.list)o.host=h;return h;}

test('H1: resource scoping is refused until the certificate path can enforce it',async()=>{const h=await host();try{
 const [A,B]=h.list,r=await res(A,'f');
 await rejects(A.run('relations.invite',null,{instance:await mk(A),slot:'recipient',invitee:B.principal,values:{0:[{resource:r,scope:{readOnly:true}}]}}),'relation_scope_unsupported');
}finally{await h.close();}});

test('M2: the grant is re-intersected with the live pool at check time and at resume',async()=>{const h=await host();try{
 const [A,B]=h.list,r=await res(A,'f'),{instance}=await h.relate(A,B,{give:{0:[{resource:r}]}});
 assert.equal(await A.check(instance,B,r,STORE,'put'),true);
 await A.metadata.put('federation/resource/'+r,{id:r,label:'R',contracts:{[STORE]:['get']},owner:A.id});
 assert.equal(await A.check(instance,B,r,STORE,'put'),false,'a method the resource no longer offers');assert.equal(await A.check(instance,B,r,STORE,'get'),true);
 await A.metadata.delete('federation/resource/'+r);assert.equal(await A.check(instance,B,r,STORE,'get'),false,'a resource that left the pool');
 await A.run('relations.suspend',null,{instance,counterpart:B.principal});
 await rejects(A.run('relations.resume',null,{instance,counterpart:B.principal}),'relation_values_incomplete','nothing left to resume with');
}finally{await h.close();}});

test('M3/L14: a lost redemption answer then expiry is abandoned by the sweep and the inviter is told',async()=>{const h=await host();try{
 const [A,B]=h.list,r=await res(A,'f'),instance=await mk(A);
 const inv=await A.run('relations.invite',null,{instance,slot:'recipient',invitee:B.principal,values:{0:[{resource:r}]},expiresAt:h.clock.now()+DAY});
 h.faults.redeem=()=>'lose';await rejects(h.accept(B,inv.invitation),'relation_redeem_unavailable');h.faults.redeem=()=>'ok';
 assert.equal((await A.cp(instance,B)).state,'live');
 // L14: an already-redeemed invitation still answers the idempotent retry just past its expiry.
 h.clock.advance(DAY+1000);const retry=await A.system('relations.redeem',{invitation:inv.invitation,statement:await B.relations.statements.sign({org:B.id,party:B.principal,instance,relation:h.pins.share[0],slot:'recipient',invitation:await (await import('../packages/orgs/relation-invitations.mjs')).invitationDigest(inv.invitation)}),from:B.principal});
 assert.ok(retry.statement);
 // B never retries; once no invitation could still be live, the sweep abandons the pending acceptance and tells A.
 h.clock.advance(RELATION_INVITATION_MAX_MS+2*DAY);await B.system('relations.sweep');
 assert.equal(await B.cp(instance,A),undefined);assert.equal(await B.part(instance),undefined);assert.equal((await B.get('rel/state')).instances,0);
 await h.drain();const a=await A.cp(instance,B);assert.equal(a.state,'ended');assert.equal(a.grant.state,'ended');assert.equal(await A.check(instance,B,r,STORE,'get'),false);
}finally{await h.close();}});

test('M3: leaving with a possibly-redeemed pending acceptance tells the inviter; L11: ended counterparts are not told again',async()=>{const h=await host();try{
 const [A,B]=h.list,r=await res(A,'f'),instance=await mk(A),b2=await mk(B);
 const inv=await A.run('relations.invite',null,{instance,slot:'recipient',invitee:B.principal,values:{0:[{resource:r}]}});
 h.faults.redeem=()=>'lose';await rejects(h.accept(B,inv.invitation),'relation_redeem_unavailable');h.faults.redeem=()=>'ok';
 await B.run('relations.leave',null,{instance});await h.drain();assert.equal((await A.cp(instance,B)).state,'ended');
 // L6 (tightened): within 72 h a resync re-tells the ended counterpart exactly its two final halves; after that, none.
 let before=await h.outbox();await B.system('relations.resync');assert.equal(await h.outbox()-before,2,'two final halves within 72 h');await h.drain();
 h.clock.advance(73*3600000);before=await h.outbox();await B.system('relations.resync');assert.equal(await h.outbox()-before,0,'nothing after 72 h');
 // Leaving another instance whose counterpart already ended sends nothing to it.
 const r2=await res(B,'g'),j=await B.run('relations.invite',null,{instance:b2,slot:'recipient',invitee:A.principal,values:{0:[{resource:r2}]}});await h.accept(A,j.invitation);await h.drain();
 await A.run('relations.leave',null,{instance:b2});await h.drain();assert.equal((await B.cp(b2,A)).state,'ended');
 before=await h.outbox();await B.run('relations.leave',null,{instance:b2});assert.equal(await h.outbox()-before,0,'no event to a party that is no longer a counterpart');
}finally{await h.close();}});

test('M4: backed-off events for an unreachable counterpart never block later events',async()=>{const h=await host();try{
 const [A,B,C]=h.list,r=await res(A,'f');
 for(let i=0;i<70;i++)await A.metadata.put('rel/outbox/'+String(0).padStart(15,'0')+'/'+String(i+1).padStart(15,'0'),{seq:i+1,to:C.principal,instance:'x',events:{[RELATION_EVENT.edgeEnded]:{half:'grant'}},jti:'j'+i,aep:0,createdAt:h.clock.now(),attempts:0,notBefore:0});
 await A.metadata.put('rel/outbox-seq',70);
 h.faults.deliver=(from,to)=>to.sub===C.id?'fail':'ok';
 await A.system('relations.outbox-drain',{});await A.system('relations.outbox-drain',{});
 const {instance}=await h.relate(A,B,{give:{0:[{resource:r}]}});
 assert.equal(await A.check(instance,B,r,STORE,'get'),true,'B\'s acceptance reached A despite 70 backed-off rows');
 assert.equal((await B.imports()).length,1);
}finally{await h.close();}});

test('M5/M6: no document fetch or key lookup before the admin check or the sender binding',async()=>{const h=await host();try{
 const [A,B,C]=h.list;const before={...h.counts};
 await rejects(A.run('relations.create',A.outsider,{relation:{artefact:'https://evil.example/relations/x',version:1,digest:h.pins.share[0].digest},slots:['owner']}),'not_found');
 await rejects(A.run('relations.preview',A.member,{relation:h.pins.share[0],slot:'owner'}),'not_found');
 assert.equal(h.counts.fetch,before.fetch,'no fetch for a non-admin');
 const r=await res(A,'f'),inv=await A.run('relations.invite',null,{instance:await mk(A),slot:'recipient',invitee:B.principal,values:{0:[{resource:r}]}});await h.drain();
 const a=await (async()=>{try{await B.run('relations.inbound-preview',B.member,{invitation:inv.invitation});}catch(e){return e.code;}})(),b=await (async()=>{try{await B.run('relations.inbound-preview',B.member,{invitation:'x.y.z'});}catch(e){return e.code;}})();
 assert.equal(a,b,'a non-admin learns nothing about an invitation\'s validity');
 // An offer naming an inviter other than its sender causes no key lookup at the receiver.
 const count=h.counts.resolve;assert.deepEqual(await B.system('relations.offer',{meta:inv.invitation,from:C.principal}),{received:true});assert.equal(h.counts.resolve,count);
 assert.equal((await B.run('relations.inbound',null,{})).items.length,1,'only A\'s own offer landed');
}finally{await h.close();}});

test('L16: with relations off, inbound offers are neither recorded nor announced',async()=>{const h=await host();try{
 const [A,B]=h.list,r=await res(A,'f');h.flag.deny.set(B.id,new Set(['ORG_RELATIONS_ENABLED']));
 await A.run('relations.invite',null,{instance:await mk(A),slot:'recipient',invitee:B.principal,values:{0:[{resource:r}]}});
 assert.equal((await B.list('rel/inbound/')).size,0);assert.ok(!(await B.notices()).some(n=>n.type==='relation-invitation-received'));
}finally{await h.close();}});

test('M8: pending acceptances count toward the incoming-edge cap',async()=>{const h=await host();try{
 const [A,B]=h.list,r=await res(A,'f');const st=(await B.get('rel/state'))??{v:1,instances:0,incoming:0};
 await B.metadata.put('rel/state',{...st,incoming:1023});await B.metadata.put('rel/accepting/'+'0'.repeat(64),{jti:'0'.repeat(64),instance:'x',inviter:A.principal,createdAt:h.clock.now()});
 const inv=await A.run('relations.invite',null,{instance:await mk(A),slot:'recipient',invitee:B.principal,values:{0:[{resource:r}]}});
 await rejects(h.accept(B,inv.invitation),'relation_limit');
}finally{await h.close();}});

test('L9: the aep floor is per sender across instances',async()=>{const h=await host();try{
 const [A,B]=h.list,r=await res(A,'f'),i1=(await h.relate(A,B,{give:{0:[{resource:r}]}})).instance,i2=(await h.relate(A,B,{give:{0:[{resource:r}]}})).instance;
 const ev=(instance,gen,state,aep)=>({bindle:'relation-event',v:1,iss:ISS,sub:A.id,aud:`${ISS}/identity/${B.id}`,instance,aep,iat:Math.floor(h.clock.now()/1000),jti:h.random.uuid(),events:{[RELATION_EVENT.edgeState]:{half:'grant',generation:gen,state,...state==='live'?{entries:[{index:0,resources:[{resource:r,contracts:[STORE],methods:{[STORE]:['get']}}]}]}:{}}}});
 await B.system('relations.ingest',{event:ev(i1,5,'live',4),from:A.principal});
 await B.system('relations.ingest',{event:ev(i2,5,'suspended',0),from:A.principal});
 await B.system('relations.ingest',{event:ev(i2,6,'live',1),from:A.principal});
 assert.equal((await B.cp(i2,A)).peerGrant.state,'suspended','a widening below the sender\'s floor from another instance is refused');
}finally{await h.close();}});

test('M1: an open invitation never redeems while the inviter is deleting, held, or its issuing admin is gone',async()=>{const h=await host(3);try{
 const [A,B,C]=h.list,r=await res(A,'f');
 const inv=await A.run('relations.invite',null,{instance:await mk(A),slot:'recipient',invitee:B.principal,values:{0:[{resource:r}]}});
 await A.run('orgs.schedule-deletion',null,{});
 const row=await A.get('rel/inv/'+inv.jti);assert.equal(row.state,'withdrawn','scheduling deletion withdraws open invitations');assert.equal(row.reason,'organization-deletion-pending');
 await rejects(h.accept(B,inv.invitation),'invitation_invalid');assert.equal(await A.cp(inv.instance,B),undefined);
 // Directly at the join endpoint, ignoring the withdrawal record: an inactive organization never redeems.
 await A.metadata.put('rel/inv/'+inv.jti,{...row,state:'open'});
 const stmt=await B.relations.statements.sign({org:B.id,party:B.principal,instance:inv.instance,relation:h.pins.share[0],slot:'recipient',invitation:await (await import('../packages/orgs/relation-invitations.mjs')).invitationDigest(inv.invitation)});
 await rejects(A.system('relations.redeem',{invitation:inv.invitation,statement:stmt,from:B.principal}),'invitation_invalid');
 await A.run('orgs.cancel-deletion',null,{});
 // An organization-level hold refuses redemption too.
 const rec=await A.get('org/record-v1');await A.metadata.put('org/record-v1',{...rec,hold:{cause:'test',at:h.clock.now()}});
 await rejects(A.system('relations.redeem',{invitation:inv.invitation,statement:stmt,from:B.principal}),'invitation_invalid');await A.metadata.put('org/record-v1',rec);
 // An issuing admin who leaves (or is removed or held) takes that admin's open invitations along.
 const X=A.people[1];await A.run('orgs.invite',A.admin,{invitee:{iss:ISS,sub:X},grants:[{power:'admin'}]}).then(i=>A.run('orgs.accept',X,{invitation:i.invitation})).catch(()=>{});
 const x=await A.get('org/member/'+(await import('../packages/orgs/grants.mjs')).principalKey({iss:ISS,sub:X}));
 await A.metadata.put('org/member/'+(await import('../packages/orgs/grants.mjs')).principalKey({iss:ISS,sub:X}),{...x,grants:[{power:'admin',grantedAt:0}]});
 const byX=await A.run('relations.invite',X,{instance:await mk(A),slot:'recipient',invitee:C.principal,values:{0:[{resource:r}]}});
 await A.run('orgs.leave',X,{});// the issuing admin leaves: that admin's open invitations go
 const xr=await A.get('rel/inv/'+byX.jti);assert.equal(xr.state,'withdrawn');assert.equal(xr.reason,'issuer-no-longer-admin');
 await rejects(h.accept(C,byX.invitation),'invitation_invalid');
 // Even with the withdrawal record undone, an invitation whose issuing admin is gone never redeems.
 await A.metadata.put('rel/inv/'+byX.jti,{...xr,state:'open'});
 const cs=await C.relations.statements.sign({org:C.id,party:C.principal,instance:byX.instance,relation:h.pins.share[0],slot:'recipient',invitation:await (await import('../packages/orgs/relation-invitations.mjs')).invitationDigest(byX.invitation)});
 await rejects(A.system('relations.redeem',{invitation:byX.invitation,statement:cs,from:C.principal}),'invitation_invalid');
}finally{await h.close();}});

test('L1: a required entry that lapsed stops the whole edge at once, before any sweep',async()=>{const h=await host();try{
 const [A,B]=h.list,po=await A.resource(`${ISS}/r/1/po`,{'https://contracts.example/purchase-order/v1':['status','acknowledge']}),st=await A.resource(`${ISS}/r/1/st`,{[STORE]:['get','list']});
 const instance=(await A.run('relations.create',null,{relation:h.pins.supply[0],slots:['buyer']})).instance,exp=Math.floor(h.clock.now()/1000)+3600;
 const inv=await A.run('relations.invite',null,{instance,as:'buyer',slot:'supplier',invitee:B.principal,values:{0:[{resource:po,expires_at:exp}],2:[{resource:st}]},receive:false});
 await h.accept(B,inv.invitation,{receive:true});await h.drain();
 assert.equal(await A.check(instance,B,st,STORE,'get'),true);h.clock.advance(2*3600000);
 assert.equal(await A.check(instance,B,st,STORE,'get'),false,'the optional entry stops with its required entry');
}finally{await h.close();}});

test('L2: counterpart-supplied names such as constructor never crash or match prototype members',async()=>{const h=await host();try{
 const [A,B]=h.list,r=await res(A,'f'),{instance}=await h.relate(A,B,{give:{0:[{resource:r}]}});
 const ev={bindle:'relation-event',v:1,iss:ISS,sub:A.id,aud:`${ISS}/identity/${B.id}`,instance,aep:0,iat:Math.floor(h.clock.now()/1000),jti:h.random.uuid(),
  events:{[RELATION_EVENT.edgeState]:{half:'grant',generation:50,state:'live',entries:[{index:0,resources:[{resource:r,contracts:['constructor'],methods:{constructor:['get'],__proto__:['get']}}]}]}}};
 assert.deepEqual(await B.system('relations.ingest',{event:ev,from:A.principal}),{accepted:true});
 await rejects(A.run('relations.invite',null,{instance:await mk(A),slot:'constructor',invitee:B.principal,values:{0:[{resource:r}]}}),'relation_slot_invalid');
 assert.equal(await A.check(instance,B,r,'constructor','get'),false);
}finally{await h.close();}});

test('L3: sweeps are indexed and resumable: expiry past 256 old rows, retention, and replay rows in bulk',async()=>{const h=await host();try{
 const [A,B]=h.list,r=await res(A,'f');
 for(let i=0;i<300;i++){const jti='0'+i.toString(16).padStart(63,'0');await A.metadata.put('rel/inv/'+jti,{v:1,jti,state:'withdrawn',invitee:B.principal,instance:'x',expiresAt:0});}
 const inv=await A.run('relations.invite',null,{instance:await mk(A),slot:'recipient',invitee:B.principal,values:{0:[{resource:r}]},expiresAt:h.clock.now()+DAY});
 h.clock.advance(DAY+1000);await A.system('relations.sweep');assert.equal((await A.get('rel/inv/'+inv.jti)).state,'expired');
 h.clock.advance(31*DAY);await A.system('relations.sweep');assert.equal(await A.get('rel/inv/'+inv.jti),undefined,'closed invitations go after the retention window');
 for(let i=0;i<600;i++){const k='x/'+i.toString(16).padStart(8,'0');await A.metadata.put('rel/jti/'+k,{at:0});await A.metadata.put('rel/jti-at/'+'0'.repeat(15)+'/'+k,true);}
 await A.system('relations.sweep');assert.equal((await A.list('rel/jti/')).size,0);assert.equal((await A.list('rel/jti-at/')).size,0);
}finally{await h.close();}});

test('L4: the import authority takes the application ceiling from the approved grant, never from the caller',async()=>{const h=await host();try{
 const [A,B]=h.list,r=await res(A,'f');await h.relate(A,B,{give:{0:[{resource:r}]}});const imp=(await B.imports())[0].resources[0].id;
 const pk=(await import('../packages/orgs/grants.mjs')).principalKey,m=await B.get('org/member/'+pk({iss:ISS,sub:B.member}));
 await B.run('orgs.member-grants',null,{membership:m.id,grants:[{resource:imp,methods:{[STORE]:['get','list','put']}}]});const gen=(await B.get('org/member/'+pk({iss:ISS,sub:B.member}))).generation;
 await rejects(B.run('relations.import-authority',B.member,{resource:imp,application:{[STORE]:['get','list','put','delete']}}),'invalid_request');
 await B.metadata.put('federation/grant/g',{id:'g',active:true,fields:['f'],methods:{f:{[STORE]:['get']}},resources:{f:[imp]}});
 assert.deepEqual((await B.run('relations.import-authority',B.member,{resource:imp,grant:'g',field:'f',generation:gen})).methods,{[STORE]:['get']});
 assert.deepEqual((await B.run('relations.import-authority',B.member,{resource:imp,grant:'g',field:'f',generation:gen+1})).methods,{},'a stale membership generation');
 await B.metadata.put('federation/grant/g',{id:'g',active:false,fields:['f'],methods:{f:{[STORE]:['get']}},resources:{f:[imp]}});
 assert.deepEqual((await B.run('relations.import-authority',B.member,{resource:imp,grant:'g',field:'f',generation:gen})).methods,{},'an inactive connection grant');
}finally{await h.close();}});

test('L5: the invitee offer leaves through the outbox; issuing never waits on, or reveals, the invitee',async()=>{const h=await host();try{
 const [A,B]=h.list,r=await res(A,'f');let offers=0;const base=h.faults.deliver;
 const orig=A.relations.transport.offer;A.relations.transport={...A.relations.transport,offer:async(...a)=>{offers++;return orig(...a);}};
 const inv=await A.run('relations.invite',null,{instance:await mk(A),slot:'recipient',invitee:B.principal,values:{0:[{resource:r}]}});
 assert.equal(offers,0,'issuing made no call to the invitee');assert.equal((await B.list('rel/inbound/')).size,0);
 await A.system('relations.outbox-drain',{});assert.equal(offers,1);assert.equal((await B.list('rel/inbound/')).size,1);assert.ok(inv&&base);
}finally{await h.close();}});
