// ORG-10b/10c relations at the ngin engine level (packages/orgs/relation-*.mjs; spec §9.3–§9.9, §10, §12; design
// §8b.2–§8b.7, RL-1–RL-17). Several organizations on one loopback host, each in its own writer, related through the
// same-host transport (RL-15). Every state transition, the consent requirements, privacy, RL-11 limits, no transitivity,
// ceilings, immediate narrowing and the named adversarial cases. Local behaviour only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {relationsHost,rejects,fault,ISS,DAY,STORE,LEDGER,BUS,PO,orgId,OPS} from './helpers/relations-world.mjs';
import {principalKey} from '../packages/orgs/grants.mjs';
import {RELATION_EVENT} from '../packages/orgs/relation-edges.mjs';
import {RELATION_LIMITS} from '../packages/orgs/relation-invitations.mjs';
import {RELATION_NEVER_GATED} from '../packages/orgs/relation-instances.mjs';

const ALL={[STORE]:['get','list','put','delete'],[LEDGER]:['get','list','put','delete'],[PO]:['status','acknowledge','cancel'],[BUS]:['read','subscribe','unsubscribe']};
const res=(o,name)=>o.resource(`${ISS}/r/${o.n}/${name}`,ALL);
const audits=async(o,action)=>(await o.audits()).filter(a=>a.action===action);
const stale=h=>({authTime:h.clock.now()-16*60000});
const event=(h,from,to,instance,events,{jti=h.random.uuid(),aep=0,iat=Math.floor(h.clock.now()/1000)}={})=>({bindle:'relation-event',v:1,iss:from.principal.iss,sub:from.principal.sub,aud:`${ISS}/identity/${to.id}`,instance,aep,iat,jti,events});
const ingest=(to,from,e)=>to.system('relations.ingest',{event:e,from:from.principal});
/** The import authority for `sub` through an application connection whose approved grant carries `ceiling` for the
 * import (review L4: the ceiling is the grant record's, never the caller's). */
async function authority(o,sub,resource,ceiling){const id='g-'+Math.abs([...JSON.stringify([resource,ceiling])].reduce((a,c)=>a*31+c.charCodeAt(0)|0,7));
 await o.metadata.put('federation/grant/'+id,{id,active:true,fields:['f'],methods:{f:ceiling},resources:{f:[resource]}});
 const m=await o.get('org/member/'+principalKey({iss:ISS,sub:sub??o.admin}));return o.run('relations.import-authority',sub,{resource,grant:id,field:'f',generation:m.generation});}

test('flags: widening needs ORG_RELATIONS_ENABLED; narrowing, leaving and own reads are never gated',async()=>{const h=await relationsHost();try{
 const [A,B,C]=h.list,rA=await res(A,'files');
 h.flag.names.ORG_RELATIONS_ENABLED=false;
 await rejects(A.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']}),'not_found');
 await rejects(A.run('relations.preview',null,{relation:h.pins.share[0],slot:'owner'}),'not_found');
 delete h.flag.names.ORG_RELATIONS_ENABLED;
 const {instance}=await h.relate(A,B,{give:{0:[{resource:rA}]}});
 const pending=await A.run('relations.invite',null,{instance:(await A.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']})).instance,slot:'recipient',invitee:C.principal,values:{0:[{resource:rA}]}});
 h.flag.names.ORG_RELATIONS_ENABLED=false;
 for(const name of RELATION_NEVER_GATED)assert.ok(OPS[name],`${name} is a registered operation`);
 await rejects(A.run('relations.invite',null,{instance,slot:'recipient',invitee:C.principal,values:{0:[{resource:rA}]}}),'not_found');
 await rejects(h.accept(C,pending.invitation),'not_found','accepting is widening');
 await A.run('relations.suspend',null,{instance,counterpart:B.principal});
 await rejects(A.run('relations.resume',null,{instance,counterpart:B.principal}),'not_found','resuming is widening');
 assert.equal((await A.run('relations.get',null,{instance})).counterparts[0].outgoing.state,'suspended');
 assert.equal((await A.run('relations.list',null,{})).instances.length,2);
 await A.run('relations.withdraw',null,{invitation:pending.jti});
 await B.run('relations.end',null,{instance,counterpart:A.principal,direction:'incoming'});
 await A.run('relations.mute',null,{organization:C.principal});
 await h.drain();await A.run('relations.leave',null,{instance});
 assert.equal((await A.part(instance)).state,'left');
 // The inviter's own flag off: redemption of a new edge is refused uniformly and the invitee's pending records go.
 delete h.flag.names.ORG_RELATIONS_ENABLED;
 const fresh=(await A.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']})).instance;
 const inv=await A.run('relations.invite',null,{instance:fresh,slot:'recipient',invitee:B.principal,values:{0:[{resource:rA}]}});
 h.flag.deny.set(A.id,new Set(['ORG_RELATIONS_ENABLED']));
 await rejects(h.accept(B,inv.invitation),'invitation_invalid');
 assert.equal(await B.part(fresh),undefined,'pending participation discarded');assert.equal(await B.cp(fresh,A),undefined);
}finally{await h.close();}});

test('create: an unheld admin with a fresh step-up; slots must admit organizations',async()=>{const h=await relationsHost();try{
 const [A]=h.list,pin=h.pins.supply[0];
 await rejects(A.run('relations.create',A.member,{relation:pin,slots:['buyer']}),'not_found','a plain member');
 await rejects(A.run('relations.create',A.outsider,{relation:pin,slots:['buyer']}),'not_found','a non-member');
 await rejects(A.run('relations.create',null,{relation:pin,slots:['buyer']},stale(h)),'reauthentication_required');
 await rejects(A.run('relations.create',null,{relation:pin,slots:['auditor']}),'relation_slot_invalid');
 await rejects(A.run('relations.create',null,{relation:{...pin,digest:h.pins.share[0].digest},slots:['buyer']}),'relation_unavailable','a pin whose digest is not this version');
 // A held admin (governance held, §12c.3) has no powers.
 const key='org/member/'+principalKey({iss:ISS,sub:A.admin}),m=await A.get(key);await A.metadata.put(key,{...m,hold:{aep:0,at:h.clock.now(),cause:'test'}});
 await rejects(A.run('relations.create',null,{relation:pin,slots:['buyer']}),'not_found','a held admin');
 await A.metadata.put(key,m);
 const out=await A.run('relations.create',null,{relation:pin,slots:['buyer']});
 assert.match(out.instance,/^https:\/\/3sln\.example\/relations\/i\/[a-f0-9-]{36}$/);
 assert.equal((await audits(A,'relation-instance-created')).length,1);assert.ok((await A.notices()).some(n=>n.type==='relation-instance-created'),'every admin is told');
 const part=await A.part(out.instance);assert.deepEqual([part.state,part.slots,part.creator],['live',['buyer'],true]);
}finally{await h.close();}});

test('invite: organizations only, values from the organization\'s own pool, never an import, arity per view',async()=>{const h=await relationsHost();try{
 const [A,B,C]=h.list,rA=await res(A,'files'),{instance}=await h.relate(A,B,{give:{0:[{resource:rA}]}});
 const sup=(await A.run('relations.create',null,{relation:h.pins.supply[0],slots:['buyer']})).instance,orders=await res(A,'orders');
 const invite=(input,sub)=>A.run('relations.invite',sub,{instance:sup,slot:'supplier',invitee:C.principal,...input});
 await rejects(invite({invitee:{iss:ISS,sub:A.member}}),'relation_party_unsupported','a person (RL-17)');
 await rejects(invite({invitee:A.principal}),'relation_party_invalid','itself');
 await rejects(invite({invitee:{iss:'https://other.example',sub:orgId(9)}}),'not_found','a foreign provider while the kill switch is off');
 h.flag.names.ORG_FOREIGN_RELATIONS_ENABLED=true;await rejects(invite({invitee:{iss:'https://other.example',sub:orgId(9)}}),'relation_foreign_unavailable','ORG-11 transport is not implemented');h.flag.names.ORG_FOREIGN_RELATIONS_ENABLED=false;
 await rejects(invite({invitee:{iss:ISS,sub:orgId(99)}}),'relation_party_unsupported','unknown');
 await rejects(invite({values:{2:[{resource:rA}]}}),'relation_values_incomplete','required entry 0 missing');
 await rejects(invite({values:{0:[{resource:`${ISS}/r/elsewhere`}]}}),'relation_values_invalid','not in the pool');
 await rejects(invite({values:{0:[{resource:orders}],7:[]}}),'relation_values_invalid','an entry the pair does not have');
 await rejects(invite({values:{0:[{resource:orders,methods:{[LEDGER]:['get']}}]}}),'relation_values_invalid','a contract the entry does not grant');
 await rejects(invite({}),'relation_invitation_empty');
 // B tries to pass A's import onward: refused (spec §9.7 composition rule).
 const imp=(await B.imports())[0].resources[0].id;const bi=(await B.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']})).instance;
 await rejects(B.run('relations.invite',null,{instance:bi,slot:'recipient',invitee:C.principal,values:{0:[{resource:imp}]}}),'relation_values_invalid');
 // Methods are the entry ceiling ∩ the resource's contracts ∩ the grantor's narrowing.
 await invite({values:{0:[{resource:orders,methods:{[PO]:['status']}}]}});
 const row=[...(await A.list('rel/inv/')).values()].find(i=>i.instance===sup);assert.deepEqual(row.grant[0].resources[0].methods,{[PO]:['status']});
 await rejects(invite({values:{0:[{resource:orders}]}}),'relation_invitation_pending','one pending per pair');
 await rejects(A.run('relations.invite',null,{instance,slot:'recipient',invitee:B.principal,values:{0:[{resource:rA}]}}),'relation_counterpart_exists');
 await rejects(A.run('relations.invite',null,{instance,slot:'recipient',invitee:C.principal,values:{0:[{resource:rA}]}}),'relation_slot_full','share recipient max 1, already held in A\'s view');
 await rejects(A.run('relations.invite',A.member,{instance,slot:'recipient',invitee:C.principal,values:{0:[{resource:rA}]}}),'not_found');
}finally{await h.close();}});

test('accept: full disclosure echoed, consent at both ends, activation on both sides',async()=>{const h=await relationsHost();try{
 const [A,B]=h.list,orders=await res(A,'orders'),bus=await res(B,'invoices');
 const sup=(await A.run('relations.create',null,{relation:h.pins.supply[0],slots:['buyer']})).instance;
 const inv=await A.run('relations.invite',null,{instance:sup,slot:'supplier',invitee:B.principal,values:{0:[{resource:orders}]},receive:true});
 assert.equal((await B.run('relations.inbound',null,{})).items.length,0,'the offer leaves through the outbox (review L5)');await h.drain();
 const items=(await B.run('relations.inbound',null,{})).items;assert.equal(items.length,1);assert.deepEqual(items[0].from,A.principal);
 await rejects(B.run('relations.inbound',B.member,{}),'not_found');
 const view=await B.run('relations.inbound-preview',null,{invitation:inv.invitation});
 assert.deepEqual(view.inviter,{identity:`${ISS}/identity/${A.id}`,handle:'org-1',origin:ISS});assert.deepEqual(view.warnings,['new-counterparty','new-relation']);
 assert.equal(view.slot,'supplier');assert.equal(view.counterpartySlot,'buyer');assert.deepEqual(view.gives.map(e=>e.index),[1]);assert.deepEqual(view.receives.map(e=>e.index),[0,2]);assert.equal(view.relation.publisherVerified,false);
 await rejects(B.run('relations.accept',null,{invitation:inv.invitation,disclosure:'x'.repeat(43),values:{1:[{resource:bus}]},receive:true}),'relation_disclosure_changed');
 await rejects(B.run('relations.accept',null,{invitation:inv.invitation,disclosure:view.disclosure,values:{1:[{resource:bus}]},receive:true},stale(h)),'reauthentication_required');
 const out=await B.run('relations.accept',null,{invitation:inv.invitation,disclosure:view.disclosure,values:{1:[{resource:bus}]},receive:true});
 assert.deepEqual(out,{instance:sup,counterpart:A.principal,slot:'supplier',counterpartySlot:'buyer',state:'live'});
 // Before events arrive, each grantor's edge is NOT live: the grantee's acceptance is not yet known to it (C1).
 assert.equal(await A.check(sup,B,orders,PO,'status'),false);assert.equal(await B.check(sup,A,bus,BUS,'read'),false);
 await h.drain();
 assert.equal(await A.check(sup,B,orders,PO,'status'),true);assert.equal(await A.check(sup,B,orders,PO,'cancel'),false,'cancel is outside the matrix');
 assert.equal(await B.check(sup,A,bus,BUS,'subscribe'),true);
 assert.equal((await A.imports())[0].resources[0].resource,bus);assert.equal((await B.imports())[0].resources[0].resource,orders);
 assert.equal((await B.run('relations.inbound',null,{})).items.length,0,'the inbound item is gone');
 assert.equal((await audits(A,'relation-redeemed')).length,1);assert.equal((await audits(B,'relation-accepted')).length,1);assert.equal((await audits(B,'relation-acceptance-pending')).length,1);
 assert.ok((await B.notices()).some(n=>n.type==='relation-accepted'));
 // The second relation with the same counterparty and relation shows neither warning.
 const C=h.list[2],sup2=(await C.run('relations.create',null,{relation:h.pins.supply[0],slots:['buyer']})).instance,o2=await res(C,'orders');
 const inv2=await C.run('relations.invite',null,{instance:sup2,slot:'supplier',invitee:B.principal,values:{0:[{resource:o2}]}});
 assert.deepEqual((await B.run('relations.inbound-preview',null,{invitation:inv2.invitation})).warnings,['new-counterparty']);
}finally{await h.close();}});

test('consent: no edge is live without the grantee\'s acceptance or the grantor\'s own values',async()=>{const h=await relationsHost();try{
 const [A,B,C]=h.list,orders=await res(A,'orders'),bus=await res(B,'invoices');
 const sup=(await A.run('relations.create',null,{relation:h.pins.supply[0],slots:['buyer']})).instance;
 // B accepts while declining to receive: A's grant to B never becomes live, and B shows nothing as available.
 const inv=await A.run('relations.invite',null,{instance:sup,slot:'supplier',invitee:B.principal,values:{0:[{resource:orders}]},receive:true});
 await h.accept(B,inv.invitation,{values:{1:[{resource:bus}]},receive:false});await h.drain();
 assert.equal(await A.check(sup,B,orders,PO,'status'),false,'no grantee acceptance');
 assert.equal((await B.imports()).length,0,'nothing is recorded as received without acceptance');assert.equal(await B.check(sup,A,bus,BUS,'read'),true,'B granted and A accepted at invite time');
 // A grantor that only receives: C grants invoices, A gives nothing; C's grant needs A's acceptance (given at invite).
 const sup2=(await A.run('relations.create',null,{relation:h.pins.supply[0],slots:['buyer']})).instance,cbus=await res(C,'invoices');
 const inv2=await A.run('relations.invite',null,{instance:sup2,slot:'supplier',invitee:C.principal,receive:true});
 await rejects(h.accept(C,inv2.invitation,{receive:false}),'relation_invitation_empty','accepting with neither values nor receipt');
 await h.accept(C,inv2.invitation,{values:{1:[{resource:cbus}]},receive:false});await h.drain();
 assert.equal(await C.check(sup2,A,cbus,BUS,'read'),true);assert.equal((await C.imports()).length,0);
 // An invitation the invitee ignores grants nothing, ever.
 const sup3=(await A.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']})).instance;const lone=await res(A,'lone');
 await A.run('relations.invite',null,{instance:sup3,slot:'recipient',invitee:C.principal,values:{0:[{resource:lone}]}});await h.drain();
 assert.equal(await A.check(sup3,C,lone,STORE,'get'),false);
}finally{await h.close();}});

test('invitations: single use, bound to the invitee; forwarded, withdrawn, expired and garbage fail identically',async()=>{const h=await relationsHost({orgs:4});try{
 const [A,B,C,D]=h.list,rA=await res(A,'files'),mk=async()=>(await A.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']})).instance;
 const garbage=await fault(B.run('relations.inbound-preview',null,{invitation:'x.y.z'}));assert.equal(garbage.code,'invitation_invalid');
 const i1=await A.run('relations.invite',null,{instance:await mk(),slot:'recipient',invitee:B.principal,values:{0:[{resource:rA}]}});
 assert.deepEqual(await fault(C.run('relations.inbound-preview',null,{invitation:i1.invitation})),garbage,'forwarded to another organization');
 // A non-invitee redeeming directly at the join endpoint, with its own fresh statement.
 const cStatement=await C.relations.statements.sign({org:C.id,party:C.principal,instance:i1.instance,relation:h.pins.share[0],slot:'recipient',invitation:'d'});
 assert.deepEqual(await fault(A.system('relations.redeem',{invitation:i1.invitation,statement:cStatement,from:C.principal})),garbage);
 // Withdrawn: refused exactly as an invalid one, and the invitee's pending records are discarded.
 await h.drain();assert.equal((await B.run('relations.inbound',null,{})).items.length,1);
 await A.run('relations.withdraw',null,{invitation:i1.jti});await h.drain();assert.equal((await B.run('relations.inbound',null,{})).items.length,0,'the inbound item was retracted');
 const view=await fault(h.accept(B,i1.invitation));assert.deepEqual(view,garbage);
 assert.equal(await B.part(i1.instance),undefined);await rejects(A.run('relations.withdraw',null,{invitation:i1.jti}),'not_found');
 // Redemption racing withdrawal, the other order: redeemed first, then withdrawal finds nothing open.
 const i2=await A.run('relations.invite',null,{instance:await mk(),slot:'recipient',invitee:B.principal,values:{0:[{resource:rA}]}});
 await h.accept(B,i2.invitation);await rejects(A.run('relations.withdraw',null,{invitation:i2.jti}),'not_found');
 assert.deepEqual(await fault(h.accept(B,i2.invitation)),{code:'relation_counterpart_exists',status:409,message:'This organization is already part of your view of this relation.'},'single use');
 // Expired.
 const i3=await A.run('relations.invite',null,{instance:await mk(),slot:'recipient',invitee:C.principal,values:{0:[{resource:rA}]},expiresAt:h.clock.now()+DAY});
 h.clock.advance(DAY+1000);assert.deepEqual(await fault(C.run('relations.inbound-preview',null,{invitation:i3.invitation})),garbage);
 // A lost redemption response: the inviter activated; a retry is answered idempotently and the invitee activates.
 const i4=await A.run('relations.invite',null,{instance:await mk(),slot:'recipient',invitee:D.principal,values:{0:[{resource:rA}]}});
 let once=true;h.faults.redeem=()=>{if(once){once=false;return 'lose';}return 'ok';};
 await rejects(h.accept(D,i4.invitation),'relation_redeem_unavailable');
 assert.equal((await A.cp(i4.instance,D)).state,'live');assert.equal((await D.cp(i4.instance,A)).state,'pending');
 await h.accept(D,i4.invitation);assert.equal((await D.cp(i4.instance,A)).state,'live');await h.drain();assert.equal(await A.check(i4.instance,D,rA,STORE,'get'),true);
 // An unreachable inviter keeps the pending records for a retry.
 const i5=await A.run('relations.invite',null,{instance:await mk(),slot:'recipient',invitee:C.principal,values:{0:[{resource:rA}]}});
 h.faults.redeem=()=>'fail';await rejects(h.accept(C,i5.invitation),'relation_redeem_unavailable');assert.equal((await C.cp(i5.instance,A)).state,'pending');
 h.faults.redeem=()=>'ok';await h.accept(C,i5.invitation);assert.equal((await C.cp(i5.instance,A)).state,'live');
 // After the inviter's key rotates, an outstanding invitation fails as invalid (L4: ask for a new one).
 const i6=await A.run('relations.invite',null,{instance:await mk(),slot:'recipient',invitee:B.principal,values:{0:[{resource:rA}]}});
 await h.mint(A.id,'organization','org-1');assert.deepEqual(await fault(B.run('relations.inbound-preview',null,{invitation:i6.invitation})),garbage);
}finally{await h.close();}});

test('edge transitions: suspend, resume, narrow and end are immediate at the holder; events converge the other side',async()=>{const h=await relationsHost();try{
 const [A,B]=h.list,r1=await res(A,'one'),r2=await res(A,'two');
 const {instance}=await h.relate(A,B,{give:{0:[{resource:r1},{resource:r2}]}});
 const avail=async()=>(await B.imports()).flatMap(i=>i.resources.filter(r=>r.status==='available').map(r=>r.resource)).sort();
 assert.deepEqual(await avail(),[r1,r2].sort());
 // Suspend outgoing: refused at once, whatever happens to delivery (C6); the grantee converges on receipt.
 await A.run('relations.suspend',null,{instance,counterpart:B.principal},stale(h));
 assert.equal(await A.check(instance,B,r1,STORE,'get'),false);assert.deepEqual(await avail(),[r1,r2].sort(),'before delivery');
 await h.drain();assert.deepEqual(await avail(),[]);assert.equal((await A.cp(instance,B)).grant.generation,2);
 await rejects(A.run('relations.suspend',null,{instance,counterpart:B.principal}),'not_found','already suspended');
 await rejects(A.run('relations.resume',null,{instance,counterpart:B.principal},stale(h)),'reauthentication_required');
 await A.run('relations.resume',null,{instance,counterpart:B.principal});assert.equal(await A.check(instance,B,r1,STORE,'get'),true);
 await h.drain();assert.deepEqual(await avail(),[r1,r2].sort());assert.equal((await B.cp(instance,A)).peerGrant.generation,3);
 // Narrow to one resource: the dropped one is refused at once; the grantee's import for it disappears.
 const before=(await B.imports())[0].resources.find(r=>r.resource===r2).id;
 await A.run('relations.narrow',null,{instance,counterpart:B.principal,entries:{0:[r1]}});
 assert.equal(await A.check(instance,B,r2,STORE,'get'),false);assert.equal(await A.check(instance,B,r1,STORE,'get'),true);
 await h.drain();assert.deepEqual(await avail(),[r1]);
 assert.deepEqual(await authority(B,null,before,{[STORE]:['get']}),{methods:{}});
 await rejects(A.run('relations.narrow',null,{instance,counterpart:B.principal,entries:{}}),'relation_values_incomplete','a required entry cannot be dropped');
 await rejects(A.run('relations.narrow',null,{instance,counterpart:B.principal,entries:{0:[r2]}}),'relation_values_invalid','cannot narrow to something not shared');
 // The grantee suspends its acceptance: its own imports stop at once; the grantor refuses after receipt.
 await B.run('relations.suspend',null,{instance,counterpart:A.principal,direction:'incoming'});assert.deepEqual(await avail(),[]);
 assert.equal(await A.check(instance,B,r1,STORE,'get'),true,'the grantor learns on receipt (spec §8b.4 table)');
 await h.drain();assert.equal(await A.check(instance,B,r1,STORE,'get'),false);
 await B.run('relations.resume',null,{instance,counterpart:A.principal,direction:'incoming'});await h.drain();assert.equal(await A.check(instance,B,r1,STORE,'get'),true);assert.deepEqual(await avail(),[r1]);
 // End is final: nothing revives it, and the counterpart ends its matching half.
 await A.run('relations.end',null,{instance,counterpart:B.principal});assert.equal(await A.check(instance,B,r1,STORE,'get'),false);
 await rejects(A.run('relations.resume',null,{instance,counterpart:B.principal}),'not_found');
 await h.drain();const b=await B.cp(instance,A),a=await A.cp(instance,B);
 assert.equal(b.peerGrant.state,'ended');assert.equal(b.acceptance.state,'ended');assert.equal(b.state,'ended');assert.equal(a.state,'ended');assert.deepEqual(await avail(),[]);
 for(const action of ['relation-grant-suspended','relation-grant-live','relation-grant-ended','relation-acceptance-suspended','relation-acceptance-live'])assert.ok((await audits(A,action)).length+(await audits(B,action)).length>=1,action);
}finally{await h.close();}});

test('leave: every half ends, counterparts are told, and the instance is final for the leaver',async()=>{const h=await relationsHost();try{
 const [A,B,C]=h.list,orders=await res(A,'orders'),bus=await res(B,'invoices'),bus2=await res(C,'invoices');
 const sup=(await A.run('relations.create',null,{relation:h.pins.supply[0],slots:['buyer']})).instance;
 for(const [X,b] of [[B,bus],[C,bus2]]){const inv=await A.run('relations.invite',null,{instance:sup,slot:'supplier',invitee:X.principal,values:{0:[{resource:orders}]},receive:true});await h.accept(X,inv.invitation,{values:{1:[{resource:b}]}});}
 await h.drain();assert.equal((await A.imports()).length,2);
 await B.run('relations.leave',null,{instance:sup},stale(h));assert.equal((await B.part(sup)).state,'left');
 assert.equal(await B.check(sup,A,bus,BUS,'read'),false);assert.deepEqual((await B.imports()).map(i=>i.status),['unavailable']);
 await h.drain();assert.equal((await A.cp(sup,B)).state,'ended');assert.equal(await A.check(sup,B,orders,PO,'status'),false);
 assert.equal(await A.check(sup,C,orders,PO,'status'),true,'other edges are untouched');assert.equal((await A.imports()).filter(i=>i.status==='available').length,1);
 await rejects(B.run('relations.invite',null,{instance:sup,slot:'supplier',invitee:C.principal,values:{1:[{resource:bus}]}}),'not_found');
 await rejects(B.run('relations.leave',null,{instance:sup}),'not_found');
 assert.equal((await B.relations.counters({get:k=>B.get(k)})).instances,0);
}finally{await h.close();}});

test('privacy: only counterparts see a relation; members see only imports they hold grants on (RL-13)',async()=>{const h=await relationsHost({orgs:4});try{
 const [P,S1,S2,X]=h.list,l1=await res(S1,'ledger'),l2=await res(S2,'ledger');
 const g=(await P.run('relations.create',null,{relation:h.pins.group[0],slots:['parent']})).instance;
 for(const [S,l] of [[S1,l1],[S2,l2]]){const inv=await P.run('relations.invite',null,{instance:g,slot:'subsidiary',invitee:S.principal,receive:true});await h.accept(S,inv.invitation,{values:{0:[{resource:l}]},receive:false});}
 await h.drain();
 // S1's store never mentions S2, and its view of the instance lists only P.
 const dump=JSON.stringify([...(await S1.list(''))]);assert.ok(!dump.includes(S2.id),'no row at S1 names S2');
 assert.deepEqual((await S1.run('relations.get',null,{instance:g})).counterparts.map(c=>c.principal.sub),[P.id]);
 assert.equal((await P.run('relations.get',null,{instance:g})).counterparts.length,2);
 await rejects(X.run('relations.get',null,{instance:g}),'not_found','a non-party');
 await rejects(P.run('relations.list',P.member,{}),'not_found','members do not see relations');
 await rejects(P.run('relations.get',P.member,{instance:g}),'not_found');
 assert.deepEqual(await P.imports(P.member),[],'no grants, no imports listed');
 const imps=(await P.imports()).flatMap(i=>i.resources);assert.equal(imps.length,2);
 const mid=(await P.get('org/member/'+principalKey({iss:ISS,sub:P.member}))).id;
 await P.run('orgs.member-grants',null,{membership:mid,grants:[{resource:imps[0].id,methods:{[LEDGER]:['get']}}]});
 const seen=await P.imports(P.member);assert.equal(seen.length,1);assert.equal(seen[0].id,imps[0].id);assert.ok(!('resource' in seen[0]),'the grantor resource id stays with admins');
 // An event from a non-counterpart is answered like any other and changes nothing (spec §12 item 10).
 const before=JSON.stringify([...(await S1.list('rel/'))]),count=h.counts.resolve;
 assert.deepEqual(await ingest(S1,X,event(h,X,S1,g,{[RELATION_EVENT.edgeEnded]:{half:'grant'}})),{accepted:true});
 assert.equal(JSON.stringify([...(await S1.list('rel/'))]),before);assert.equal(h.counts.resolve,count,'no lookup');
}finally{await h.close();}});

test('no transitivity, no onward sharing, grants scoped to their instance (privilege laundering through chains)',async()=>{const h=await relationsHost({orgs:5});try{
 const [A,B,C,S1,S2]=h.list,rA=await res(A,'ledger'),rB=await res(B,'store'),rA2=await res(A,'second');
 const ab=(await h.relate(A,B,{give:{0:[{resource:rA}]}})).instance,bc=(await h.relate(B,C,{give:{0:[{resource:rB}]}})).instance;
 // C reaches nothing of A's, whatever instance it names; it holds only B's import.
 for(const inst of [ab,bc])for(const m of ['get','list','put'])assert.equal(await A.check(inst,C,rA,STORE,m),false);
 assert.deepEqual((await C.imports()).flatMap(i=>i.resources.map(r=>r.resource)),[rB]);
 // B cannot put A's import into what it grants C, in any instance (composition rule).
 const imp=(await B.imports())[0].resources[0].id,again=(await B.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']})).instance;
 await rejects(B.run('relations.invite',null,{instance:again,slot:'recipient',invitee:C.principal,values:{0:[{resource:imp}]}}),'relation_values_invalid');
 await rejects(B.run('relations.invite',null,{instance:again,slot:'recipient',invitee:C.principal,values:{0:[{resource:rA}]}}),'relation_values_invalid','nor A\'s raw resource id');
 for(const cp of (await B.list('rel/cp/')).values())for(const e of cp.grant?.entries??[])for(const r of e.resources)assert.ok(!r.resource.startsWith('imp_')&&r.resource!==rA);
 // Sibling subsidiaries of one parent get nothing from each other: the group document has no sibling entry.
 const g=(await A.run('relations.create',null,{relation:h.pins.group[0],slots:['parent']})).instance,l1=await res(S1,'l'),l2=await res(S2,'l');
 for(const [S,l] of [[S1,l1],[S2,l2]]){const inv=await A.run('relations.invite',null,{instance:g,slot:'subsidiary',invitee:S.principal,receive:true});await h.accept(S,inv.invitation,{values:{0:[{resource:l}]},receive:false});}
 await h.drain();assert.equal(await S2.check(g,S1,l2,LEDGER,'get'),false);assert.equal(await S1.check(g,S2,l1,LEDGER,'get'),false);assert.equal((await S1.imports()).length,0);
 assert.equal(await S1.check(g,A,l1,LEDGER,'get'),true);
 // The same two entities in two instances: each grant applies only in its own instance.
 const two=(await A.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']})).instance;const inv=await A.run('relations.invite',null,{instance:two,slot:'recipient',invitee:B.principal,values:{0:[{resource:rA2}]}});
 await h.accept(B,inv.invitation);await h.drain();
 assert.equal(await A.check(two,B,rA2,STORE,'get'),true);assert.equal(await A.check(ab,B,rA2,STORE,'get'),false);assert.equal(await A.check(two,B,rA,STORE,'get'),false);
}finally{await h.close();}});

test('ceilings: effective access is within the document, the grantor\'s values, the member\'s grant and the application',async()=>{const h=await relationsHost();try{
 const [P,S]=h.list,l=await res(S,'ledger');
 const g=(await P.run('relations.create',null,{relation:h.pins.group[0],slots:['parent']})).instance,inv=await P.run('relations.invite',null,{instance:g,slot:'subsidiary',invitee:S.principal,receive:true});
 await h.accept(S,inv.invitation,{values:{0:[{resource:l}]},receive:false});await h.drain();
 // The resource offers get, list, put, delete; the document allows get and list; nothing else passes.
 for(const [m,ok] of [['get',true],['list',true],['put',false],['delete',false]])assert.equal(await S.check(g,P,l,LEDGER,m),ok,m);
 await S.run('relations.narrow',null,{instance:g,counterpart:P.principal,entries:{0:true}});
 const imp=(await P.imports())[0].resources[0];assert.deepEqual(imp.methods,{[LEDGER]:['get','list']});
 const mid=(await P.get('org/member/'+principalKey({iss:ISS,sub:P.member}))).id;
 await P.run('orgs.member-grants',null,{membership:mid,grants:[{resource:imp.id,methods:{[LEDGER]:['get','list','put']}}]});
 assert.deepEqual((await authority(P,P.member,imp.id,{[LEDGER]:['get','put']})).methods,{[LEDGER]:['get']},'member ∩ application ∩ edge');
 assert.deepEqual((await authority(P,P.member,imp.id,{[STORE]:['get']})).methods,{});
 // Unavailable imports give nothing.
 await S.run('relations.suspend',null,{instance:g,counterpart:P.principal});await h.drain();
 assert.deepEqual((await authority(P,P.member,imp.id,{[LEDGER]:['get']})).methods,{});
 await S.run('relations.resume',null,{instance:g,counterpart:P.principal});await h.drain();
 // A grantor that sends a wider grant than the matrix: the grantee clamps to the document's ceilings.
 const cp=await S.cp(g,P);const e=event(h,S,P,g,{[RELATION_EVENT.edgeState]:{half:'grant',generation:cp.grant.generation+5,state:'live',entries:[{index:0,resources:[{resource:l,contracts:[LEDGER],methods:{[LEDGER]:['get','delete'],[STORE]:['put']}}]},{index:9,resources:[{resource:l,contracts:[STORE],methods:{[STORE]:['get']}}]}]}});
 await ingest(P,S,e);const after=(await P.imports());assert.equal(after.length,1);assert.deepEqual(after[0].resources[0].methods,{[LEDGER]:['get']});
}finally{await h.close();}});

test('RL-11 limits: per pair, per day, inbound capacity with notice and mute, instance and incoming caps',async()=>{const h=await relationsHost({orgs:4});try{
 const [A,B,C,X]=h.list,rA=await res(A,'f'),mk=async(o=A)=>(await o.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']})).instance;
 const inst=await mk(),invite=async(to=B,i=inst)=>{const v=await A.run('relations.invite',null,{instance:i,slot:'recipient',invitee:to.principal,values:{0:[{resource:rA}]}});await h.drain();return v;};
 for(let i=0;i<RELATION_LIMITS.invitationsPerPair;i++){const v=await invite();await A.run('relations.withdraw',null,{invitation:v.jti});}
 await rejects(invite(),'relation_invitation_limit','3 per pair per 30 days');
 h.clock.advance(RELATION_LIMITS.pairWindowMs+1000);const ok=await invite();await A.run('relations.withdraw',null,{invitation:ok.jti});
 const st=await A.get('rel/state');await A.metadata.put('rel/state',{...st,day:{date:Math.floor(h.clock.now()/DAY),count:RELATION_LIMITS.invitationsPerDay}});
 await rejects(invite(C),'relation_invitation_limit','300 a day');h.clock.advance(DAY);await A.run('relations.withdraw',null,{invitation:(await invite(C)).jti});
 // B's inbound capacity is full of another organization's items: new items are refused (silently to the sender) and
 // B's admins are told; muting that organization frees the space and the legitimate invitation then lands.
 for(let i=0;i<RELATION_LIMITS.inbound;i++)await B.metadata.put('rel/inbound/'+String(i).padStart(64,'0'),{jti:String(i).padStart(64,'0'),from:X.principal,expiresAt:h.clock.now()+DAY,meta:'m'});
 const lost=await invite();assert.ok(lost.invitation,'the sender sees an ordinary issuance');
 assert.equal((await B.run('relations.inbound',null,{})).items.filter(i=>i.from.sub===A.id).length,0);assert.ok((await B.notices()).some(n=>n.type==='relation-inbound-full'));
 assert.equal((await B.run('relations.mute',null,{organization:X.principal})).cleared,RELATION_LIMITS.inbound);
 await A.run('relations.withdraw',null,{invitation:lost.jti});h.clock.advance(RELATION_LIMITS.pairWindowMs+1000);
 const landed=await invite(B,await mk());assert.equal((await B.run('relations.inbound',null,{})).items.length,1);
 // A muted organization's invitations are dropped silently; the link itself still works if B chooses to use it.
 await B.run('relations.mute',null,{organization:A.principal});assert.equal((await B.run('relations.inbound',null,{})).items.length,0,'muting clears its items');
 await A.run('relations.withdraw',null,{invitation:landed.jti});const silent=await invite(B,await mk());assert.equal((await B.run('relations.inbound',null,{})).items.length,0);
 await h.accept(B,silent.invitation);await B.run('relations.mute',null,{organization:A.principal,muted:false});
 // Caps (RL-11 "until measured").
 const cs=await C.get('rel/state')??{v:1,instances:0,incoming:0};await C.metadata.put('rel/state',{...cs,instances:RELATION_LIMITS.instances});
 await rejects(mk(C),'relation_limit','256 live instances');
 await C.metadata.put('rel/state',{...cs,instances:0,incoming:RELATION_LIMITS.incomingEdges});
 const v=await A.run('relations.invite',null,{instance:await mk(),slot:'recipient',invitee:C.principal,values:{0:[{resource:rA}]}});
 await rejects(h.accept(C,v.invitation),'relation_limit','1,024 live incoming edges');
}finally{await h.close();}});

test('arity is per view: a full view refuses, split views are normal, and nobody can squat another party\'s view',async()=>{const h=await relationsHost({orgs:5});try{
 const [P1,P2,P3,P4,X]=h.list,s=[];for(const o of h.list)s.push(await res(o,'s'));
 const inst=(await P1.run('relations.create',null,{relation:h.pins.partners[0],slots:['partner']})).instance;
 const join=async(from,to,fi,ti)=>{const inv=await from.run('relations.invite',null,{instance:inst,slot:'partner',invitee:to.principal,values:{0:[{resource:s[fi]}]},receive:true});return h.accept(to,inv.invitation,{values:{0:[{resource:s[ti]}]}});};
 // Two outstanding invitations for the last place in P1's view: the second redemption is refused at P1.
 await join(P1,P2,0,1);
 const i3=await P1.run('relations.invite',null,{instance:inst,slot:'partner',invitee:P3.principal,values:{0:[{resource:s[0]}]},receive:true});
 const i4=await P1.run('relations.invite',null,{instance:inst,slot:'partner',invitee:P4.principal,values:{0:[{resource:s[0]}]},receive:true});
 await h.accept(P3,i3.invitation,{values:{0:[{resource:s[2]}]}});
 await rejects(h.accept(P4,i4.invitation,{values:{0:[{resource:s[3]}]}}),'invitation_invalid');assert.equal(await P4.part(inst),undefined);
 await rejects(P1.run('relations.invite',null,{instance:inst,slot:'partner',invitee:X.principal,values:{0:[{resource:s[0]}]}}),'relation_slot_full');
 // P2's view (P1, P2) has room: P2 recognizes X. That is a split view, the intended model; P1's view is unchanged.
 await join(P2,X,1,4);await h.drain();
 assert.equal((await P1.run('relations.get',null,{instance:inst})).counterparts.length,2);
 assert.deepEqual((await P2.run('relations.get',null,{instance:inst})).counterparts.map(c=>c.principal.sub).sort(),[P1.id,X.id].sort());
 // X now participates and invites P1: P1's view is full, so P1 cannot be made to recognize it.
 const ix=await X.run('relations.invite',null,{instance:inst,slot:'partner',invitee:P1.principal,values:{0:[{resource:s[4]}]},receive:true});
 await rejects(h.accept(P1,ix.invitation,{values:{0:[{resource:s[0]}]}}),'relation_slot_full');
 assert.equal(await P1.cp(inst,X),undefined);assert.equal(await X.check(inst,P1,s[4],STORE,'get'),false);
 // Every view is within max (C5).
 for(const o of [P1,P2,P3,X]){const v=await o.run('relations.get',null,{instance:inst});assert.ok(v.counterparts.filter(c=>c.state!=='ended').length+1<=3,`view of org ${o.n}`);}
}finally{await h.close();}});

test('relation events: uniform answers, no lookups, generation ordering, aep floors and replay',async()=>{const h=await relationsHost({orgs:3});try{
 const [A,B,X]=h.list,rA=await res(A,'f'),{instance}=await h.relate(A,B,{give:{0:[{resource:rA}]}});
 const st=(gen,state,entries)=>({[RELATION_EVENT.edgeState]:{half:'grant',generation:gen,state,...entries?{entries}:{}}}),entries=[{index:0,resources:[{resource:rA,contracts:[STORE],methods:{[STORE]:['get']}}]}];
 const status=async()=>(await B.imports())[0]?.status;const count=h.counts.resolve;
 // Malformed (step 1) is refused; everything else gets the same answer.
 for(const bad of [{},{...event(h,A,B,instance,st(9,'live',entries)),aud:`${ISS}/identity/${X.id}`},{...event(h,A,B,instance,st(9,'live',entries)),iat:Math.floor(h.clock.now()/1000)-301},{...event(h,A,B,instance,st(9,'live',entries)),extra:1},{...event(h,A,B,instance,{})},{...event(h,A,B,instance,{'https://spec.bindle.example/events/other/v1':{}})}])
  await rejects(ingest(B,A,bad),'relation_event_invalid');
 // Forged: X sends an event claiming to be A.
 const forged=event(h,A,B,instance,{[RELATION_EVENT.edgeEnded]:{half:'grant'}});assert.deepEqual(await ingest(B,X,forged),{accepted:true});assert.equal(await status(),'available');
 // Reordering: a newer suspension, then an older live state, changes nothing back.
 await ingest(B,A,event(h,A,B,instance,st(5,'suspended')));assert.equal(await status(),'unavailable');
 await ingest(B,A,event(h,A,B,instance,st(4,'live',entries)));assert.equal(await status(),'unavailable');
 // Replay: the same jti is not reprocessed even with a higher generation inside.
 const once=event(h,A,B,instance,st(6,'live',entries));await ingest(B,A,once);assert.equal(await status(),'available');
 await ingest(B,A,event(h,A,B,instance,st(7,'suspended')));await ingest(B,A,once);assert.equal(await status(),'unavailable','a replay of an applied jti is ignored');
 // aep: a higher aep is recorded; a later widening event below it is refused; a narrowing applies whatever its aep.
 await ingest(B,A,event(h,A,B,instance,st(8,'live',entries),{aep:3}));assert.equal((await B.cp(instance,A)).peerAep,3);assert.equal(await status(),'available');
 await ingest(B,A,event(h,A,B,instance,st(10,'suspended'),{aep:0}));assert.equal(await status(),'unavailable','narrowing below the floor still applies');
 await ingest(B,A,event(h,A,B,instance,st(11,'live',entries),{aep:1}));assert.equal(await status(),'unavailable','widening below the floor is refused');
 // An end is final: no later generation revives it.
 await ingest(B,A,event(h,A,B,instance,{[RELATION_EVENT.edgeEnded]:{half:'grant'}},{aep:0}));await ingest(B,A,event(h,A,B,instance,st(99,'live',entries),{aep:3}));
 assert.equal((await B.cp(instance,A)).peerGrant.state,'ended');assert.equal(await status(),'unavailable');
 assert.equal(h.counts.resolve,count,'no event caused a key lookup');
 // Introductions and other registered types are answered and ignored in this pass (ORG-10e).
 assert.deepEqual(await ingest(B,A,event(h,A,B,instance,{[RELATION_EVENT.introduction]:{slot:'recipient',candidate:X.principal,statement:'x'}})),{accepted:true});
}finally{await h.close();}});

test('lookalike documents: same title at another id is flagged, and the disclosure binds the exact matrix',async()=>{const h=await relationsHost({orgs:3});try{
 const [A,B,C]=h.list,o=await res(A,'orders'),oc=await res(C,'orders');
 const sup=(await A.run('relations.create',null,{relation:h.pins.supply[0],slots:['buyer']})).instance;
 const inv=await A.run('relations.invite',null,{instance:sup,slot:'supplier',invitee:B.principal,values:{0:[{resource:o}]}});
 const genuine=await B.run('relations.inbound-preview',null,{invitation:inv.invitation});await h.accept(B,inv.invitation,{values:{1:[{resource:await res(B,'bus')}]}});
 // A clone: same title, another id, a wider matrix (the supplier also hands over storage).
 const wider={...structuredClone(h.bodies.supply),id:'https://erp-relations.example/relations/supply'};wider.access.push({...structuredClone(h.bodies.supply.access[2]),grantor:'supplier',grantee:'buyer',required:true});
 const [pin]=await h.publish('clone',[wider]);
 const ci=(await C.run('relations.create',null,{relation:pin,slots:['buyer']})).instance,cinv=await C.run('relations.invite',null,{instance:ci,slot:'supplier',invitee:B.principal,values:{0:[{resource:oc}]}});
 const view=await B.run('relations.inbound-preview',null,{invitation:cinv.invitation});
 assert.deepEqual(view.warnings,['new-counterparty','new-relation','same-title-different-relation']);assert.notEqual(view.disclosure,genuine.disclosure);
 assert.deepEqual(view.gives.map(e=>e.index),[1,3],'the extra storage entry is disclosed as given');
 await rejects(B.run('relations.accept',null,{invitation:cinv.invitation,disclosure:genuine.disclosure,values:{1:[{resource:await res(B,'bus2')}],3:[{resource:await res(B,'store')}]}}),'relation_disclosure_changed');
}finally{await h.close();}});

test('sweep: invitations, inbound items and granted resources expire; a required entry left empty ends the grant',async()=>{const h=await relationsHost();try{
 const [A,B,C]=h.list,rA=await res(A,'f');
 const i=(await A.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']})).instance;
 const inv=await A.run('relations.invite',null,{instance:i,slot:'recipient',invitee:C.principal,values:{0:[{resource:rA}]},expiresAt:h.clock.now()+DAY});
 h.clock.advance(DAY+1);await A.system('relations.sweep');await C.system('relations.sweep');
 assert.equal((await A.get('rel/inv/'+inv.jti)).state,'expired');assert.equal((await A.get('rel/pair/'+principalKey(C.principal))).pending,null);assert.equal((await C.list('rel/inbound/')).size,0);
 const exp=Math.floor(h.clock.now()/1000)+3600,{instance}=await h.relate(A,B,{give:{0:[{resource:rA,expires_at:exp}]}});
 assert.equal(await A.check(instance,B,rA,STORE,'get'),true);h.clock.advance(2*3600000);
 assert.equal(await A.check(instance,B,rA,STORE,'get'),false,'expired before any sweep');
 await A.system('relations.sweep');assert.equal((await A.cp(instance,B)).grant.state,'ended');await h.drain();assert.equal((await B.cp(instance,A)).peerGrant.state,'ended');
}finally{await h.close();}});

test('a pending deletion leaves relations as they are and keeps narrowing open',async()=>{const h=await relationsHost();try{
 const [A,B]=h.list,rA=await res(A,'f'),{instance}=await h.relate(A,B,{give:{0:[{resource:rA}]}});
 await A.run('orgs.schedule-deletion',null,{});assert.equal(await A.check(instance,B,rA,STORE,'get'),true,'scheduling sends nothing and changes nothing');
 assert.equal(await h.outbox(),0);
 await rejects(A.run('relations.create',null,{relation:h.pins.share[0],slots:['owner']}),'organization_deletion_pending');
 await A.run('relations.suspend',null,{instance,counterpart:B.principal});assert.equal(await A.check(instance,B,rA,STORE,'get'),false);
}finally{await h.close();}});
