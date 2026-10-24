// Invitation preview and withdrawal (2026-10-23, provisional coordinator work) at the ngin engine level. The preview
// names the organization from its own record only for an invitation the caller could accept now, and answers every
// other case with the same not_found; a withdrawn invitation fails acceptance exactly like an invalid one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {world,p,rejects,uuid,A,B,C,E,DAY} from './helpers/org-world.mjs';
import {ORG_RETENTION_MS} from '../packages/orgs/roster.mjs';

const fault=async promise=>{try{await promise;}catch(error){return {code:error.code,status:error.status,message:error.message};}return null;};

test('preview: the organization\'s own name and kind, only for an invitation the caller could accept now',async()=>{const w=await world();try{
 await w.run('orgs.rename',A,{name:'Acme Robotics'});await w.run('orgs.set-label',A,{label:'company'});
 const open=await w.run('orgs.invite',A,{grants:[]}),bound=await w.run('orgs.invite',A,{invitee:p(B),grants:[]});
 const view=await w.run('orgs.invitation-preview',E,{invitation:open.invitation});
 assert.deepEqual(view.organization,{name:'Acme Robotics',label:'company',handle:null});assert.equal(view.bound,false);assert.equal(view.member,false);assert.equal(view.expiresAt,open.expiresAt);
 assert.equal((await w.run('orgs.invitation-preview',B,{invitation:bound.invitation})).bound,true);
 // Read-only: the invitation still works afterwards.
 await w.run('orgs.accept',E,{invitation:open.invitation});assert.equal((await w.member(E)).state,'live');
}finally{await w.close();}});
test('preview: every invalid case gives the same not_found (no oracle)',async()=>{const w=await world();try{
 const expected={code:'not_found',status:404,message:'Not found.'};
 const bound=await w.run('orgs.invite',A,{invitee:p(B),grants:[]}),expiring=await w.run('orgs.invite',A,{grants:[],expiresAt:w.clock.now()+1000});
 const used=await w.run('orgs.invite',A,{grants:[]});await w.run('orgs.accept',C,{invitation:used.invitation});
 const revoked=await w.run('orgs.invite',A,{grants:[]});await w.run('orgs.invitation-revoke',A,{invitation:revoked.invitation});
 w.clock.advance(2000);
 for(const invitation of ['garbage','a'.repeat(64),'x.y.z',bound.invitation,expiring.invitation,used.invitation,revoked.invitation,undefined])
  assert.deepEqual(await fault(w.run('orgs.invitation-preview',E,invitation===undefined?{}:{invitation})),expected,`preview of ${String(invitation).slice(0,12)}`);
 // A live invitation at an organization whose deletion is pending, and the same with the flag off, answer the same.
 const live=await w.run('orgs.invite',A,{grants:[]});w.flag.on=false;
 assert.deepEqual(await fault(w.run('orgs.invitation-preview',E,{invitation:live.invitation})),expected);w.flag.on=true;
 await w.run('orgs.schedule-deletion',A,{});assert.deepEqual(await fault(w.run('orgs.invitation-preview',E,{invitation:live.invitation})),expected);
}finally{await w.close();}});
test('preview: a signed invitation is previewed by its whole token, never by its id alone',async()=>{const w=await world();try{
 const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);w.service.invitationSigner=async()=>({alg:'ES256',kid:'invitation-key',privateKey:key.privateKey});
 const i=await w.run('orgs.invite',A,{grants:[]});
 assert.equal((await w.run('orgs.invitation-preview',E,{invitation:i.meta})).organization.name,'Acme');
 await rejects(w.run('orgs.invitation-preview',E,{invitation:i.invitation}),'not_found');
}finally{await w.close();}});
test('revoke: an admin withdraws an open invitation; accepting it then fails like an invalid one',async()=>{const w=await world();try{
 await w.join(E);const i=await w.run('orgs.invite',A,{invitee:p(B),grants:[]});
 await rejects(w.run('orgs.invitation-revoke',E,{invitation:i.invitation}),'not_found');
 assert.deepEqual(await w.run('orgs.invitation-revoke',A,{invitation:i.invitation}),{revoked:true,invitation:i.invitation});
 const invalid=await fault(w.run('orgs.accept',B,{invitation:'b'.repeat(64)})),revokedAccept=await fault(w.run('orgs.accept',B,{invitation:i.invitation}));
 assert.deepEqual(revokedAccept,invalid);assert.equal(revokedAccept.code,'invitation_invalid');
 await rejects(w.run('orgs.invitation-revoke',A,{invitation:i.invitation}),'not_found');
 assert.ok([...(await w.metadata.list({prefix:'org/audit/'})).values()].some(e=>e.action==='member-invitation-revoked'&&e.invitation===i.invitation));
 // It counts as closed: it no longer holds a pending slot, and it is pruned with the other closed invitations.
 let r=await w.record();assert.equal(r.invitations[i.invitation].state,'revoked');assert.ok(!(await w.metadata.get('org/invitation-open/'+i.invitation)));
 w.clock.advance(ORG_RETENTION_MS+DAY);await w.sweep();r=await w.record();assert.equal(r.invitations[i.invitation],undefined);
}finally{await w.close();}});
test('revoke: a reducing operation, open during a ramp-down and a pending deletion; accepted invitations cannot be revoked',async()=>{const w=await world();try{
 const a=await w.run('orgs.invite',A,{grants:[]}),b=await w.run('orgs.invite',A,{grants:[]}),c=await w.run('orgs.invite',A,{grants:[]});
 await w.run('orgs.accept',E,{invitation:c.invitation});await rejects(w.run('orgs.invitation-revoke',A,{invitation:c.invitation}),'not_found');
 w.flag.on=false;await w.run('orgs.invitation-revoke',A,{invitation:a.invitation});w.flag.on=true;
 await w.run('orgs.schedule-deletion',A,{});await w.run('orgs.invitation-revoke',A,{invitation:b.invitation});
 const r=await w.record();assert.equal(r.invitations[a.invitation].state,'revoked');assert.equal(r.invitations[b.invitation].state,'revoked');
 for(let n=1;n<=3;n++)await rejects(w.run('orgs.invitation-revoke',A,{invitation:uuid(n)}),'not_found');
}finally{await w.close();}});
