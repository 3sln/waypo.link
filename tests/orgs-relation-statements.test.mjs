// ORG-10b participation statements and invitations as signed artefacts (packages/orgs/relation-statements.mjs,
// relation-invitations.mjs; spec §9.3 freshness rev 4.5, §9.4; RL-7). C10: a statement older than 300 s where it is
// presented, or signed by anything but the party's active key, never verifies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {participationStatements,verifyStatement,signCompact,statementPayload,STATEMENT_TYP} from '../packages/orgs/relation-statements.mjs';
import {signRelationInvitation,parseRelationInvitation,invitationAllowed,RELATION_LIMITS,RELATION_INVITATION_TYPE} from '../packages/orgs/relation-invitations.mjs';
import {fakeClock,seededRandom,createRandom} from '../packages/app/memory-providers.mjs';
import {relationsHost,STORE,ISS,DAY} from './helpers/relations-world.mjs';

const ORG='0e0e0e0e-0000-4000-8000-000000000001',OTHER='0e0e0e0e-0000-4000-8000-000000000002';
const pin={artefact:'https://catalogue.example/relations/share',version:1,digest:'sha256-'+'A'.repeat(43)};
async function keyset(){const make=async()=>{const p=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {privateKey:p.privateKey,publicJwk:await crypto.subtle.exportKey('jwk',p.publicKey)};};return {a:await make(),b:await make()};}

test('statements: exact payload, fresh only, the party\'s active key only (C10)',async()=>{
 const clock=fakeClock(1_800_000_000_000),random=seededRandom(createRandom(3)),{a,b}=await keyset();
 let active=[{kid:'a1',publicJwk:a.publicJwk}];
 const port=participationStatements({signer:async()=>({kid:'a1',privateKey:a.privateKey}),keys:async()=>active,clock,random});
 const party={iss:ISS,sub:ORG},jws=await port.sign({org:ORG,party,instance:'https://3sln.example/relations/i/x',relation:pin,slot:'owner'});
 const ok=await port.verify(jws,{party,mode:'presented',expect:{instance:'https://3sln.example/relations/i/x',relation:pin,slot:'owner'}});
 assert.deepEqual(Object.keys(ok).sort(),['bindle','iat','instance','jti','party','relation','slot','v']);
 for(const [expect,label] of [[{slot:'recipient'},'slot'],[{instance:'https://3sln.example/relations/i/y'},'instance'],[{relation:{...pin,version:2}},'relation'],[{invitation:'d'},'invitation']])
  assert.equal(await port.verify(jws,{party,mode:'presented',expect}),null,label);
 assert.equal(await port.verify(jws,{party:{iss:ISS,sub:OTHER},mode:'presented'}),null,'another party');
 assert.equal(await port.verify(jws,{party,mode:'unknown'}),null);
 clock.advance(300000);assert.ok(await port.verify(jws,{party,mode:'presented'}),'300 s is still fresh');
 clock.advance(1000);assert.equal(await port.verify(jws,{party,mode:'presented'}),null,'301 s is stale');
 // Invitation mode is relative to the invitation's iat, not to now.
 const iat=Math.floor(clock.now()/1000)-301;assert.ok(await port.verify(jws,{party,mode:'invitation',invitationIat:iat}));assert.equal(await port.verify(jws,{party,mode:'invitation',invitationIat:iat+302}),null);
 // A future iat beyond 30 s.
 const future=await signCompact({typ:STATEMENT_TYP,kid:'a1',privateKey:a.privateKey,payload:statementPayload({instance:'i',relation:pin,slot:'owner',party,iat:Math.floor(clock.now()/1000)+31,jti:'j'})});
 assert.equal(await verifyStatement(future,{keys:active,now:clock.now(),mode:'presented'}),null);
 // Rotation: the old key is no longer active, so a fresh statement under it fails.
 const again=await port.sign({org:ORG,party,instance:'i',relation:pin,slot:'owner'});active=[{kid:'b1',publicJwk:b.publicJwk}];
 assert.equal(await port.verify(again,{party,mode:'presented'}),null);
 // Forged: signed by another key under the party's kid.
 const forged=await signCompact({typ:STATEMENT_TYP,kid:'b1',privateKey:a.privateKey,payload:statementPayload({instance:'i',relation:pin,slot:'owner',party,iat:Math.floor(clock.now()/1000),jti:'j'})});
 assert.equal(await port.verify(forged,{party,mode:'presented'}),null);
 // Wrong typ, extra members, tampering.
 const wrongTyp=await signCompact({typ:'bindle-relation-event+jwt',kid:'b1',privateKey:b.privateKey,payload:statementPayload({instance:'i',relation:pin,slot:'owner',party,iat:Math.floor(clock.now()/1000),jti:'j'})});
 assert.equal(await port.verify(wrongTyp,{party,mode:'presented'}),null);
 const extra=await signCompact({typ:STATEMENT_TYP,kid:'b1',privateKey:b.privateKey,payload:{...statementPayload({instance:'i',relation:pin,slot:'owner',party,iat:Math.floor(clock.now()/1000),jti:'j'}),role:'admin'}});
 assert.equal(await port.verify(extra,{party,mode:'presented'}),null);
 const good=await signCompact({typ:STATEMENT_TYP,kid:'b1',privateKey:b.privateKey,payload:statementPayload({instance:'i',relation:pin,slot:'owner',party,iat:Math.floor(clock.now()/1000),jti:'j'})});
 const [h,p,sig]=good.split('.');assert.equal(await port.verify(`${h}.${p.slice(0,-2)}AA.${sig}`,{party,mode:'presented'}),null);
 for(const bad of [null,'','a.b','x'.repeat(5000),good+'.x'])assert.equal(await port.verify(bad,{party,mode:'presented'}),null);
});

test('invitations: exact members, the inviter\'s key, 30-day bound, expiry',async()=>{
 const {a,b}=await keyset(),now=1_800_000_000_000,iat=Math.floor(now/1000),keys=async p=>p.sub===ORG?[{kid:'a1',publicJwk:a.publicJwk}]:[];
 const base={issuer:ISS,org:ORG,signer:{kid:'a1',privateKey:a.privateKey},jti:'f'.repeat(64),iat,exp:iat+DAY/1000,instance:'https://3sln.example/relations/i/x',relation:pin,slot:'recipient',invitee:{iss:ISS,sub:OTHER},accept:`${ISS}/relations/accept`,statement:'s.t.u'};
 const meta=await signRelationInvitation(base),parsed=await parseRelationInvitation(meta,{keys,now});
 assert.equal(parsed.claims.type,RELATION_INVITATION_TYPE);assert.deepEqual(parsed.inviter,{iss:ISS,sub:ORG});
 assert.equal(await parseRelationInvitation(meta,{keys,now:now+DAY}),null,'expired');
 assert.equal(await parseRelationInvitation(await signRelationInvitation({...base,exp:iat+31*86400}),{keys,now}),null,'beyond 30 days');
 assert.equal(await parseRelationInvitation(await signRelationInvitation({...base,signer:{kid:'a1',privateKey:b.privateKey}}),{keys,now}),null,'another key');
 assert.equal(await parseRelationInvitation(meta,{keys:async()=>[],now}),null,'no active key');
 assert.equal(await parseRelationInvitation(meta.replace(/.$/,c=>c==='A'?'B':'A'),{keys,now}),null,'tampered signature');
});

test('issuance limits are pure and exact (RL-11)',()=>{
 const now=100*DAY,today=Math.floor(now/DAY);
 assert.equal(invitationAllowed({day:{date:today,count:RELATION_LIMITS.invitationsPerDay-1},pair:{sent:[],pending:null}},now),null);
 assert.equal(invitationAllowed({day:{date:today,count:RELATION_LIMITS.invitationsPerDay},pair:null},now),'relation_invitation_limit');
 assert.equal(invitationAllowed({day:{date:today-1,count:999},pair:null},now),null,'a new day');
 assert.equal(invitationAllowed({day:null,pair:{sent:[now-1,now-2,now-3],pending:null}},now),'relation_invitation_limit');
 assert.equal(invitationAllowed({day:null,pair:{sent:[now-1,now-2,now-RELATION_LIMITS.pairWindowMs-1],pending:null}},now),null,'outside the window');
 assert.equal(invitationAllowed({day:null,pair:{sent:[],pending:'x'}},now),'relation_invitation_pending');
});

test('a party that left signs no new statement, and its old statements go stale (C10 end to end)',async()=>{const h=await relationsHost({orgs:3});try{
 const [A,B,C]=h.list,r=await A.resource(`${ISS}/r/a`,{[STORE]:['get']}),{instance}=await h.relate(A,B,{give:{0:[{resource:r}]}});
 const old=await A.relations.statements.sign({org:A.id,party:A.principal,instance,relation:h.pins.share[0],slot:'owner'});
 await A.run('relations.leave',null,{instance});
 await assert.rejects(A.run('relations.invite',null,{instance,slot:'recipient',invitee:C.principal,values:{0:[{resource:r}]}}),e=>e.code==='not_found','no invitation, so no statement, for a participation that is not live');
 h.clock.advance(301000);assert.equal(await C.relations.statements.verify(old,{party:A.principal,mode:'presented',expect:{instance}}),null);
}finally{await h.close();}});
