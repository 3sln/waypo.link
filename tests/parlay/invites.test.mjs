// Contacts spike phase 3 (docs/architecture/contacts-and-links-rethink.md §4.3–§4.5, CR-C9 single-use subset; messaging
// §4, §6.7, §7.4, §8.2, §13; provisional, unsigned): Parlay single-use invitations, contact lists and the first-contact
// gate at the engine level, over the seeded network simulator with real signatures. alice, bob and carol share one
// provider (same-host, CL-24); dave is on another provider. bob and carol share one hub ingress.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMesh,B,encoder} from './conversations-fixtures.test.mjs';
import {createRandom,concurrently} from '../helpers/chaos.mjs';
import {createFirstContactBudget,INVITE_POLICY,CONTACTS_LIST} from '../../packages/messaging-engine/domains/invites.mjs';

const ONE='https://one.provider.example';
const mesh=async(t,options={})=>{const m=await createMesh({names:['alice','bob','carol','dave'],issuers:{alice:ONE,bob:ONE,carol:ONE},...options});t.after(()=>m.dispose());await m.flush();return m;};
const who=p=>({issuer:p.principal.issuer,subject:p.principal.subject});
const invite=async(m,name='alice',input={})=>{const r=await m.run(name,'invites.create',{template:'person',...input});await m.flush();return r;};
const members=async(m,name,list=CONTACTS_LIST)=>(await m.run(name,'lists.members',{list})).members.map(x=>x.principal.subject).sort();
const nameOf=(m,subject)=>[...m.parties.values()].find(p=>p.principal.subject===subject)?.name;
const sha=v=>B.sha256(crypto,v);

// Test-only crafting of wire requests, to probe the inviter's processing order directly.
const authorOf=f=>({principal:f.principal,identityDocument:`${f.principal.identityURI}/identity.json`,keyId:f.keyId,delegate:f.signer.kid});
const binding=f=>({ingress:f.ingress,incarnation:`inc-${crypto.randomUUID()}`,profiles:[B.PROFILE],limits:{maxParticipants:32,maxMessageBytes:B.LIMITS.maxBodyBytes,maxEnvelopeBytes:B.LIMITS.maxEnvelopeBytes}});
async function redemptionRequest(m,from,to,token,{operationId=crypto.randomUUID(),createdAt=m.clock.now(),invite,subject='',third,authorization=`BindleInvite ${token}`,owner}={}){
 const f=m.party(from),t=m.party(to),secret=crypto.getRandomValues(new Uint8Array(32)),parts=[f,t,...third?[m.party(third)]:[]];
 const genesis=await B.signGenesis({version:1,profile:B.PROFILE,conversationId:crypto.randomUUID(),createdAt,creator:authorOf(f),participants:parts.map(p=>({principal:p.principal,keyId:p.keyId})),secretEpoch:crypto.randomUUID(),secretDigest:await B.secretDigest(secret),subject:'',content:null},f.signer);
 const envelope=await B.signEnvelope({version:1,profile:B.PROFILE,kind:'conversation-init',noReply:false,operationId,createdAt,recipient:{issuer:t.principal.issuer,owner:owner??t.principal.subject,invite:invite??await sha(token)},content:null,subject,author:authorOf(f),
  conversation:{genesis,sharedSecret:B.base64url(secret),returnControl:{resource:`${new URL(f.ingress).origin}/ingress/return/${B.base64url(crypto.getRandomValues(new Uint8Array(24)))}`,nonce:B.base64url(crypto.getRandomValues(new Uint8Array(16))),expiresAt:createdAt+86400000,maxResponseBytes:8192},creatorBinding:binding(f)}},f.signer);
 const wire=B.encodeDelivery(envelope);return {envelope,request:{url:t.ingress,method:'POST',headers:{'content-type':wire.contentType,...authorization?{authorization}:{}},body:wire.bytes,source:from}};
}
async function oneOffRequest(m,from,to,{text='hello',operationId=crypto.randomUUID(),createdAt=m.clock.now(),signer,recipientOwner}={}){
 const f=m.party(from),t=m.party(to),body=encoder.encode(text);
 const envelope=await B.signEnvelope({version:1,profile:B.PROFILE,kind:'one-off',noReply:true,operationId,createdAt,recipient:{issuer:t.principal.issuer,owner:recipientOwner??t.principal.subject},content:await B.contentDescriptor('text/plain',body),subject:'Hi',author:authorOf(f)},signer??f.signer);
 const wire=B.encodeDelivery(envelope,{body});return {envelope,request:{url:t.ingress,method:'POST',headers:{'content-type':wire.contentType},body:wire.bytes,source:from}};
}
const post=async(m,to,request)=>{const res=await m.party(to).peer.handler(structuredClone(request));return {status:res.status,json:await res.json()};};

test('invite a person: redeem, admission into Contacts on both sides, a two-party conversation, then credential-less first contact',async t=>{
 const m=await mesh(t),created=await invite(m,'alice',{name:'for Bob'});
 assert.equal(created.invite.uses.max,1);assert.equal(created.invite.expiresAt-m.clock.now(),INVITE_POLICY.personDefaultMs);
 assert.deepEqual(Object.keys(created.data).sort(),['delegation','expires_at','inviter','token']);assert.match(created.data.token,/^[A-Za-z0-9_-]{43}$/);
 // The token is never stored: only its digest is.
 const raw=JSON.stringify([...(await m.party('alice').store.list({prefix:''})).entries()]);assert.equal(raw.includes(created.data.token),false);
 // Handler duties 1–3 (CL-19): inspect verifies the certificate, its status and returns no secret; nothing is sent.
 const before=m.network.trace.length,inspected=await m.run('bob','invites.inspect',{data:created.data});
 assert.deepEqual(inspected.inviter,who(m.party('alice')));assert.equal(inspected.host,'one.provider.example');assert.equal(inspected.alreadyContact,false);assert.equal(m.network.trace.length,before,'inspect sends nothing');
 const redeemed=await m.run('bob','invites.redeem',{data:created.data});assert.equal(redeemed.state,'pending');await m.settle();
 assert.deepEqual(await members(m,'alice'),[m.party('bob').owner]);assert.deepEqual(await members(m,'bob'),[m.party('alice').owner]);
 const ledger=(await m.run('alice','invites.list')).invites[0];assert.equal(ledger.state,'used');assert.deepEqual(ledger.ledger.map(e=>[nameOf(m,e.principal.subject),e.outcome]),[['bob','admitted']]);
 // The redemption conversation is accepted both ways, two parties, no subject or content, never acceptListed.
 const cid=redeemed.conversationId,bobView=await m.get('bob',cid),aliceView=await m.get('alice',cid);
 assert.equal(bobView.peers[0].state,'accepted');assert.equal(aliceView.peers[0].state,'accepted');assert.equal(aliceView.acceptListed,false);assert.equal(bobView.subject,'');
 assert.equal((await m.party('bob').store.get(`inv/pending/${await sha(created.data.token)}`)).state,'accepted');
 await m.run('alice','conversations.send',{conversationId:cid,text:'Welcome, Bob'});await m.run('bob','conversations.send',{conversationId:cid,text:'Thanks!'});await m.settle();
 assert.deepEqual((await m.texts('bob',cid)).filter(Boolean).sort(),['Thanks!','Welcome, Bob']);
 // The lists recorded each other's signed binding, so a new conversation is credential-less first contact (§6.7).
 const second=await m.run('bob','conversations.create',{subject:'Lunch',text:'Lunch on Friday?',participants:[{principal:who(m.party('alice'))}]});await m.settle();
 const {invitations}=await m.run('alice','conversations.invitations');const inv=invitations.find(i=>i.conversationId===second.conversationId);assert.ok(inv,'admitted into custody by the Contacts policy');assert.equal(inv.request,false);
 await m.run('alice','conversations.accept',{itemId:inv.itemId});await m.settle();assert.equal((await m.get('bob',second.conversationId)).peers[0].state,'accepted');
 // carol is in nobody's lists: no binding to address alice, and a crafted first contact is refused before custody.
 await assert.rejects(m.run('carol','conversations.create',{text:'hi',participants:[{principal:who(m.party('alice'))}]}),{code:'invalid_input'});
 const refused=await post(m,'alice',(await oneOffRequest(m,'carol','alice')).request);assert.deepEqual([refused.status,refused.json.error],[403,'not_authorized']);
 // A reused token reads as used to the redeemer without contacting anyone.
 assert.deepEqual(await m.run('bob','invites.redeem',{data:created.data}),{state:'accepted',conversationId:cid});
});

test('spend races: concurrent redemptions of one single-use token admit exactly one redeemer; the loser rolls back',async t=>{
 const m=await mesh(t),{data}=await invite(m);
 await m.run('carol','lists.add',{list:CONTACTS_LIST,principal:who(m.party('dave'))});
 const results=await concurrently(['bob','carol'].map(name=>()=>m.run(name,'invites.redeem',{data})));assert.ok(results.every(r=>r.status==='fulfilled'),'both submitted locally');
 await m.settle({advance:true});
 const admitted=await members(m,'alice');assert.equal(admitted.length,1,'exactly one admission');const winner=nameOf(m,admitted[0]),loser=winner==='bob'?'carol':'bob';
 assert.equal((await m.run('alice','invites.list')).invites[0].uses.used,1);
 const loserTask=(await m.tasks(loser)).find(t=>t.envelope.payload.recipient.invite);assert.equal(loserTask.state,'rejected');assert.equal(loserTask.credential,null,'the token leaves the task once it is final');
 // Rollback: only the loser's self-created admission goes; the winner keeps it.
 assert.deepEqual(await m.run(loser,'invites.sweep'),{rolledBack:1,settled:0});
 assert.equal((await members(m,loser)).includes(m.party('alice').owner),false);assert.deepEqual(await members(m,winner),[m.party('alice').owner]);
 await assert.rejects(m.run(loser,'invites.redeem',{data}),{code:'invite_used'});
 // carol's unrelated contact is untouched.
 assert.ok((await members(m,'carol')).includes(m.party('dave').owner));
});

test('replay by principal: an identical retry gets the stored receipt, a different envelope is invite_invalid, nothing is counted twice',async t=>{
 const m=await mesh(t),{data}=await invite(m),{request,envelope}=await redemptionRequest(m,'bob','alice',data.token);
 const first=await post(m,'alice',request);assert.equal(first.status,200);
 assert.equal(first.json.receipt.payload.payloadDigest,await B.payloadDigest(envelope));
 await m.flush();// the edge now lists the token as exhausted, with bob among its redeemers
 const again=await post(m,'alice',request);assert.equal(again.status,200);assert.deepEqual(again.json.receipt,first.json.receipt,'lost response: identical retry');
 const concurrent=await concurrently([0,1,2].map(()=>()=>post(m,'alice',request)));for(const r of concurrent)assert.deepEqual(r.value.json.receipt,first.json.receipt);
 const other=await post(m,'alice',(await redemptionRequest(m,'bob','alice',data.token)).request);assert.deepEqual([other.status,other.json.error],[401,'invite_invalid']);
 const l=(await m.run('alice','invites.list')).invites[0];assert.equal(l.uses.used,1);assert.equal(l.ledger.length,1);
 assert.equal((await m.party('alice').store.list({prefix:'item/'})).size,1);
});

test('binding and expiry: a bound invitation admits only its principal; expired and revoked tokens fail uniformly',async t=>{
 const m=await mesh(t),bound=await invite(m,'alice',{bound:who(m.party('bob')),expiresIn:3600000});
 assert.deepEqual(bound.invite.bound,who(m.party('bob')));
 const wrong=await post(m,'alice',(await redemptionRequest(m,'carol','alice',bound.data.token)).request);assert.deepEqual([wrong.status,wrong.json.error],[401,'invite_invalid']);
 assert.equal((await post(m,'alice',(await redemptionRequest(m,'bob','alice',bound.data.token)).request)).status,200);
 const expiring=await invite(m,'alice',{expiresIn:3600000});m.clock.advance(3600000);
 await assert.rejects(m.run('bob','invites.inspect',{data:expiring.data}),{code:'invite_expired'},'expiry is checked locally first');
 const late=await post(m,'alice',(await redemptionRequest(m,'bob','alice',expiring.data.token)).request);assert.deepEqual([late.status,late.json.error],[401,'invite_invalid']);
 const revoked=await invite(m);await m.run('alice','invites.revoke',{id:revoked.invite.id});await m.flush();
 const dead=await post(m,'alice',(await redemptionRequest(m,'bob','alice',revoked.data.token)).request);assert.deepEqual([dead.status,dead.json.error],[401,'invite_invalid']);
 await assert.rejects(m.run('alice','invites.create',{template:'person',expiresIn:31*86400000}),{code:'invalid_input'},'single use: at most 30 days');
});

test('uniform results: every token failure is one invite_invalid body before any directory or status fetch (no oracle)',async t=>{
 const m=await mesh(t),used=await invite(m),live=await invite(m),bound=await invite(m,'alice',{bound:who(m.party('carol'))}),revoked=await invite(m);
 assert.equal((await post(m,'alice',(await redemptionRequest(m,'carol','alice',used.data.token)).request)).status,200);
 await m.run('alice','invites.revoke',{id:revoked.invite.id});await m.flush();
 const unknown=B.base64url(crypto.getRandomValues(new Uint8Array(32)));
 const cases={unknown:await redemptionRequest(m,'bob','alice',unknown),exhausted:await redemptionRequest(m,'bob','alice',used.data.token),bound:await redemptionRequest(m,'bob','alice',bound.data.token),revoked:await redemptionRequest(m,'bob','alice',revoked.data.token),
  digestMismatch:await redemptionRequest(m,'bob','alice',live.data.token,{invite:await sha(unknown)}),ownerMismatch:await redemptionRequest(m,'bob','alice',(await invite(m,'carol')).data.token)};
 const calls={...m.calls},bodies=new Set();
 for(const [name,{request}] of Object.entries(cases)){const r=await post(m,'alice',request);assert.equal(r.status,401,name);bodies.add(JSON.stringify(r.json));}
 assert.deepEqual([...bodies].map(b=>JSON.parse(b)),[{error:'invite_invalid',message:'The invitation is not valid.'}],'one body for every token failure, including a token indexed to another owner');
 assert.deepEqual({...m.calls},calls,'no directory or status work for any token failure');
 // A live token still works afterwards: failures cost nothing to the token.
 assert.equal((await post(m,'alice',(await redemptionRequest(m,'bob','alice',live.data.token)).request)).status,200);
});

test('shape, same-host and gate order: malformed shapes, a foreign redeemer without fetch, identical results before verification',async t=>{
 const m=await mesh(t),{data}=await invite(m);
 for(const [label,over] of [['subject',{subject:'hi'}],['third participant',{third:'carol'}],['no BindleInvite',{authorization:null}]]){
  const r=await post(m,'alice',(await redemptionRequest(m,'bob','alice',data.token,over).catch(error=>({error}))).request??{url:m.party('alice').ingress,method:'POST',headers:{},body:new Uint8Array()});
  assert.deepEqual([r.status,r.json.error],[400,'malformed'],label);
 }
 const plain=await oneOffRequest(m,'bob','alice');plain.request.headers.authorization=`BindleInvite ${data.token}`;
 assert.deepEqual((await post(m,'alice',plain.request)).json.error,'malformed','BindleInvite without recipient.invite');
 // dave is on another provider: author_unverifiable (401) with no fetch, and the token stays live.
 const calls={...m.calls},foreign=await post(m,'alice',(await redemptionRequest(m,'dave','alice',data.token)).request);
 assert.deepEqual([foreign.status,foreign.json.error],[401,'author_unverifiable']);assert.deepEqual({...m.calls},calls);
 await assert.rejects(m.run('dave','invites.inspect',{data:{...data,inviter:{iss:ONE,sub:m.party('alice').owner}}}),{code:'invite_unverifiable'},'a foreign inviter fails at the handler without a fetch');assert.deepEqual({...m.calls},calls);
 // Gate position (§6.7, §13): a bogus proof claiming an admitted author and one claiming a stranger get identical results.
 await m.run('alice','lists.add',{list:CONTACTS_LIST,principal:who(m.party('bob'))});
 const forged={...m.party('carol').signer};
 const asBob=await oneOffRequest(m,'bob','alice',{signer:forged}).catch(()=>null),asCarol=await oneOffRequest(m,'carol','alice',{signer:{...m.party('bob').signer}}).catch(()=>null);
 if(asBob&&asCarol){const a=await post(m,'alice',asBob.request),b=await post(m,'alice',asCarol.request);assert.deepEqual([a.status,a.json],[b.status,b.json]);assert.equal(a.json.error,'author_unverifiable');}
 else{// The signer refuses a certificate for another principal; tamper the signature instead.
  const x=await oneOffRequest(m,'bob','alice'),y=await oneOffRequest(m,'carol','alice');
  for(const r of [x,y]){const e=structuredClone(r.envelope);e.proof.signature=B.base64url(new Uint8Array(64));const wire=B.encodeDelivery(e,{body:encoder.encode('hello')});r.request.headers['content-type']=wire.contentType;r.request.body=wire.bytes;}
  const a=await post(m,'alice',x.request),b=await post(m,'alice',y.request);assert.deepEqual([a.status,a.json],[b.status,b.json]);assert.equal(a.json.error,'author_unverifiable');
 }
 // "Not hosted here" and "no current occupant" are one recipient_unavailable; neither wakes a mailbox.
 const unhosted=await post(m,'alice',(await oneOffRequest(m,'bob','alice',{recipientOwner:crypto.randomUUID()})).request);
 await m.party('alice').peer.engine.run('receive.configure',{input:{principal:m.party('alice').principal,ingress:m.party('alice').ingress}});
 await m.party('alice').store.transaction(async tx=>{const seq=(await tx.get('edge-seq')??0)+1;await tx.put('edge-seq',seq);await tx.put(`edge-outbox/${String(seq).padStart(16,'0')}`,{kind:'host',issuer:ONE,subject:m.party('alice').owner,active:false,generation:seq});});await m.flush();
 const vacant=await post(m,'alice',(await oneOffRequest(m,'bob','alice')).request);
 assert.deepEqual([unhosted.status,unhosted.json],[vacant.status,vacant.json]);assert.equal(vacant.json.error,'recipient_unavailable');
});

test('first-contact budgets: per-source and per-owner 429s are identical for hosted and unhosted owners and wake no mailbox',async t=>{
 const budget=createFirstContactBudget({limits:{windowMs:60000,perSource:1000,perOwner:2,keys:64}}),m=await mesh(t,{budget});
 const ghost=crypto.randomUUID(),results={hosted:[],ghost:[]};
 for(let i=0;i<3;i++){results.hosted.push(await post(m,'alice',(await oneOffRequest(m,'carol','alice')).request));results.ghost.push(await post(m,'alice',(await oneOffRequest(m,'carol','alice',{recipientOwner:ghost})).request));}
 assert.deepEqual(results.hosted.map(r=>r.json.error),['not_authorized','not_authorized','rate_limited']);
 assert.deepEqual(results.ghost.map(r=>r.json.error),['recipient_unavailable','recipient_unavailable','rate_limited']);
 assert.deepEqual(results.hosted[2].json,results.ghost[2].json);
 const perSource=createFirstContactBudget({limits:{windowMs:60000,perSource:1,perOwner:100,keys:64}});
 assert.doesNotThrow(()=>perSource.charge({source:'a',owner:'x'}));assert.throws(()=>perSource.charge({source:'a',owner:'y'}),{code:'rate_limited'});
});

test('list policies: the most permissive list wins, a block overrides every list, request holds, receive-only refuses; changes apply at once',async t=>{
 const m=await mesh(t),bob=who(m.party('bob')),send=async()=>post(m,'alice',(await oneOffRequest(m,'bob','alice')).request);
 const quiet=await m.run('alice','lists.create',{name:'Newsletter',policy:'receive-only'}),vetted=await m.run('alice','lists.create',{name:'Website contacts',policy:'request'});
 await m.run('alice','lists.add',{list:quiet.id,principal:bob});assert.equal((await send()).json.error,'not_authorized','receive only');
 await m.run('alice','lists.add',{list:vetted.id,principal:bob});const held=await send();assert.equal(held.status,200,'request: custody, held');
 const items=[...(await m.party('alice').store.list({prefix:'item/'})).values()];assert.equal(items.length,1);assert.equal(items[0].state,'pending');assert.equal(items[0].request,true);
 await m.run('alice','lists.add',{list:CONTACTS_LIST,principal:bob});assert.equal((await send()).status,200);
 assert.equal([...(await m.party('alice').store.list({prefix:'item/'})).values()].filter(i=>i.state==='inbox').length,1,'can message you wins');
 await m.run('alice','contacts.block',{principal:bob});assert.equal((await send()).json.error,'not_authorized','a block overrides every list');
 await m.run('alice','contacts.block',{principal:bob,blocked:false});await m.run('alice','lists.set-policy',{list:CONTACTS_LIST,policy:'receive-only'});await m.run('alice','lists.remove',{list:vetted.id,principal:bob});
 assert.equal((await send()).json.error,'not_authorized','a policy change applies to members at once');
});

test('rollback: a refused redemption gets no response; the redeemer removes only its own admission once the return control lapses',async t=>{
 const m=await mesh(t),{data}=await invite(m);
 await m.run('alice','contacts.block',{principal:who(m.party('bob'))});
 await m.run('bob','invites.redeem',{data});await m.settle();
 assert.equal((await m.run('alice','invites.list')).invites[0].ledger[0].outcome,'refused');
 assert.equal((await m.run('alice','conversations.invitations')).invitations.length,0,'a refused redemption is not offered');
 assert.deepEqual(await m.run('bob','invites.sweep'),{rolledBack:0,settled:0},'not before the return control lapses');
 m.clock.advance(7*86400000+1);await m.renew();assert.deepEqual(await m.run('bob','invites.sweep'),{rolledBack:1,settled:0});
 assert.deepEqual(await members(m,'bob'),[]);
 // An admission the flow did not create is never rolled back.
 const second=await invite(m,'carol');await m.run('dave','lists.add',{list:CONTACTS_LIST,principal:who(m.party('carol'))}).catch(()=>{});
 await m.run('bob','lists.add',{list:CONTACTS_LIST,principal:who(m.party('carol'))});await m.run('carol','contacts.block',{principal:who(m.party('bob'))});
 await m.run('bob','invites.redeem',{data:second.data});await m.settle();m.clock.advance(7*86400000+1);await m.renew();await m.run('bob','invites.sweep');
 assert.deepEqual(await members(m,'bob'),[m.party('carol').owner]);
});

test('revoke: stops joins at the edge, removes the link rules and optionally the people it admitted',async t=>{
 const m=await mesh(t),{data,invite:i}=await invite(m);await m.run('bob','invites.redeem',{data});await m.settle();
 const out=await m.run('alice','invites.revoke',{id:i.id,removeAdmitted:true});assert.equal(out.rulesRemoved,1);assert.equal(out.membersRemoved,1);assert.deepEqual(await members(m,'alice'),[]);
 const kept=await invite(m);const out2=await m.run('alice','invites.revoke',{id:kept.invite.id,removeRules:false});assert.equal(out2.rulesRemoved,0);
 await m.flush();const r=await post(m,'alice',(await redemptionRequest(m,'carol','alice',kept.data.token)).request);assert.equal(r.json.error,'invite_invalid');
 assert.equal((await m.edgeStore.get(`invite/${await sha(kept.data.token)}`)).state,'dead');
});

test('groups with non-contacts keep working: list policy gates first contact only, never records, hellos or rejoin',async t=>{
 const m=await mesh(t),{data}=await invite(m);await m.run('bob','invites.redeem',{data});await m.settle();
 // carol is in nobody's lists; alice invites bob and carol through carol's contact link and bob through his.
 const cid=await m.conversation('alice',['bob','carol']);
 for(const name of ['alice','bob','carol'])await m.run(name,'conversations.send',{conversationId:cid,text:`hi from ${name}`});await m.settle();
 for(const name of ['bob','carol'])assert.deepEqual((await m.texts(name,cid)).filter(x=>x?.startsWith('hi from')).sort(),['hi from alice','hi from bob','hi from carol']);
 assert.deepEqual(await m.peerStates('carol',cid),{alice:'accepted',bob:'accepted'});
});

// Seeded redemption chaos against a reference model written from messaging §4.4 and §8.2 alone: token digest and
// owner binding, liveness (cancelled, expired, exhausted unless already redeemed by this author), bound principal,
// same-host authors, replay by (token digest, author principal) with identical bytes, and at most one admission per
// single-use token under concurrency. Seeds come from CHAOS_SEED or a fixed list.
for(const seed of process.env.CHAOS_SEED?[Number(process.env.CHAOS_SEED)]:[3,11,29]){
 test(`seeded redemption chaos matches the spec reference model (seed ${seed})`,async t=>{
  const m=await mesh(t,{seed}),random=createRandom(seed),redeemers=['bob','carol','dave'],invites=[],model=new Map(),sent=new Map(),tally={};
  const predict=(r,token,{digest,createdAt,payloadDigest})=>{
   const inv=model.get(digest);if(!inv||inv.token!==token)return 'invite_invalid';
   const prior=inv.redeemers.get(r);
   if(inv.revoked||m.clock.now()>=inv.expiresAt||inv.bound&&inv.bound!==r||(!prior&&inv.used>=1))return 'invite_invalid';
   if(m.clock.now()-createdAt>B.LIMITS.linkWindowMs)return 'envelope_expired';
   if(m.party(r).principal.issuer!==ONE)return 'author_unverifiable';
   return prior?(prior.payloadDigest===payloadDigest?'replay':'invite_invalid'):'admitted';
  };
  for(let step=0;step<36;step++){
   const op=random.int(10);
   if(op<2||!invites.length){const bound=random.chance(0.3)?random.pick(redeemers):null,expiresIn=3600000*(1+random.int(48)),c=await invite(m,'alice',{...bound?{bound:who(m.party(bound))}:{},expiresIn});
    const digest=await sha(c.data.token);invites.push({id:c.invite.id,token:c.data.token,digest});model.set(digest,{token:c.data.token,bound,expiresAt:c.invite.expiresAt,revoked:false,used:0,redeemers:new Map()});continue;}
   if(op===2){const i=random.pick(invites);await m.run('alice','invites.revoke',{id:i.id});model.get(i.digest).revoked=true;await m.flush();continue;}
   if(op===3){m.clock.advance(random.int(3)*3600000*random.int(30));await m.renew();continue;}
   // One to three concurrent attempts on one invitation, each fresh, a resend, or a token mismatch.
   const i=random.pick(invites),attempts=[];
   for(const r of random.shuffle([...redeemers]).slice(0,1+random.int(3))){
    const mode=random.int(4),key=`${r}|${i.digest}`;
    // A resend keeps the signed payload and may carry a renewed certificate for the same key (§5.3).
    if(mode===0&&sent.has(key)){const prior=sent.get(key),e=structuredClone(prior.envelope);e.proof.delegation=m.party(r).signer.delegation;const wire=B.encodeDelivery(e);attempts.push({r,...prior,envelope:e,request:{...prior.request,headers:{...prior.request.headers,'content-type':wire.contentType},body:wire.bytes},retry:true});}
    else if(mode===1){const wrong=random.pick(invites);attempts.push({r,...await redemptionRequest(m,r,'alice',wrong.token,{invite:i.digest}),token:wrong.token,digest:i.digest});}
    else{const built=await redemptionRequest(m,r,'alice',i.token);attempts.push({r,...built,token:i.token,digest:i.digest});}
   }
   const expected=[];for(const a of attempts)expected.push(predict(a.r,a.token,{digest:a.digest,createdAt:a.envelope.payload.createdAt,payloadDigest:await B.payloadDigest(a.envelope)}));
   const results=(await concurrently(attempts.map(a=>()=>post(m,'alice',a.request)))).map(x=>x.value);
   const fresh=attempts.map((a,n)=>expected[n]==='admitted'?n:-1).filter(n=>n>=0);
   // Concurrent fresh redemptions of one live single-use token: exactly one wins (any), the others lose the race.
   const winners=fresh.filter(n=>results[n].status===200);assert.ok(fresh.length===0||winners.length===1,`seed ${seed} step ${step}: one winner among ${fresh.length}: ${JSON.stringify(fresh.map(n=>results[n].json.error??results[n].status))}`);
   for(const [n,a] of attempts.entries()){
    const want=fresh.includes(n)&&!winners.includes(n)?'invite_invalid':expected[n],got=results[n].status===200?(want==='replay'?'replay':'admitted'):results[n].json.error;
    assert.equal(got,want,`seed ${seed} step ${step}: ${a.r} ${a.retry?'retry':'attempt'} on ${a.digest.slice(0,6)}`);tally[got]=(tally[got]??0)+1;
    const inv=model.get(a.digest);
    if(want==='admitted'){inv.used++;inv.redeemers.set(a.r,{payloadDigest:await B.payloadDigest(a.envelope),receipt:results[n].json.receipt});sent.set(`${a.r}|${a.digest}`,{request:a.request,envelope:a.envelope,token:a.token,digest:a.digest});}
    if(want==='replay')assert.deepEqual(results[n].json.receipt,inv.redeemers.get(a.r).receipt,'a replay returns the stored receipt');
   }
   if(random.chance(0.5))await m.flush();
  }
  assert.ok(tally.admitted>0&&tally.invite_invalid>0,`seed ${seed} exercised: ${JSON.stringify(tally)}`);
  // Final state: the ledger, the Contacts list and the stored items agree with the model.
  const admitted=new Set();for(const inv of model.values())for(const r of inv.redeemers.keys())admitted.add(m.party(r).owner);
  await m.settle();
  assert.deepEqual(await members(m,'alice'),[...admitted].sort());
  const listed=(await m.run('alice','invites.list')).invites;
  for(const i of invites){const row=listed.find(l=>l.id===i.id),inv=model.get(i.digest);assert.equal(row.uses.used,inv.used);assert.deepEqual(row.ledger.map(e=>nameOf(m,e.principal.subject)).sort(),[...inv.redeemers.keys()].sort());}
 });
}

test('spec §13 vectors: the fixed redemption and first-contact vectors validate and pair with their credentials',async()=>{
 const V=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./vectors/vectors.json',import.meta.url),'utf8'));
 const redemption=V.objects.find(o=>o.name==='conversation-init-redemption').signed,first=V.objects.find(o=>o.name==='one-off-first-contact').signed;
 await B.validateEnvelope(redemption);await B.validateEnvelope(first);
 assert.equal(redemption.payload.recipient.invite,V.invitation.tokenDigest);assert.equal(await sha(V.invitation.token),V.invitation.tokenDigest);
 assert.equal(B.checkCredentialKind(redemption,B.parseCredential(V.invitation.authorization)),'BindleInvite');
 assert.equal(B.checkCredentialKind(first,B.parseCredential(undefined)),null);
 assert.throws(()=>B.checkCredentialKind(first,B.parseCredential(V.invitation.authorization)),{code:'malformed'});
});

test('developer contact mint (CR-C5): a system-only, principal-bound, one-hour invitation placing the user in Users with a priority tag',async t=>{
 const m=await mesh(t),engine=m.party('alice').peer.engine,{InvitesMintBound}=await import('../../packages/messaging-engine/domains/invites.mjs');
 await assert.rejects(m.run('alice','invites.mint-bound',{principal:who(m.party('bob')),tier:'paid'}),{code:'unauthorized'},'never an owner operation');
 const minted=await engine.perform(new InvitesMintBound({actor:{kind:'system',owner:m.party('alice').owner},input:{principal:who(m.party('bob')),tier:'paid'}}));await m.flush();
 assert.deepEqual(minted.invite.bound,who(m.party('bob')));assert.equal(minted.invite.expiresAt-m.clock.now(),3600000);
 await assert.rejects(engine.perform(new InvitesMintBound({actor:{kind:'system',owner:m.party('alice').owner},input:{principal:who(m.party('bob')),tier:'paid',expiresIn:7200000}})),{code:'invalid_input'});
 const stolen=await post(m,'alice',(await redemptionRequest(m,'carol','alice',minted.data.token)).request);assert.equal(stolen.json.error,'invite_invalid','bound to the requesting user');
 await m.run('bob','invites.redeem',{data:minted.data});await m.settle();
 assert.deepEqual(await members(m,'alice','users'),[m.party('bob').owner]);assert.deepEqual(await members(m,'alice'),[],'not in Contacts');
 const item=[...(await m.party('alice').store.list({prefix:'item/'})).values()].find(i=>i.redemption);assert.deepEqual(item.tags.map(x=>x.id),['priority:paid']);
});

test('retention: dead invitation records are pruned after the receipt-retention time, and their tokens then read as unknown',async t=>{
 const m=await mesh(t),{data}=await invite(m),{request}=await redemptionRequest(m,'bob','alice',data.token);
 assert.equal((await post(m,'alice',request)).status,200);
 assert.deepEqual(await m.run('alice','invites.sweep'),{rolledBack:0,settled:0},'kept while replays are answerable');
 m.clock.advance(B.LIMITS.retentionMs+1);await m.renew();
 assert.equal((await m.run('alice','invites.sweep')).pruned,1);await m.flush();
 assert.equal((await m.run('alice','invites.list')).invites.length,0);
 assert.equal((await m.party('alice').store.list({prefix:'inv/redeemed/'})).size,0);
 assert.equal((await m.edgeStore.get(`invite/${await sha(data.token)}`)).state,'dead');
});

test('shell composition: invitations, redemption and credential-less first contact over the Parlay HTTP shell and mailbox',async t=>{
 const m=await mesh(t,{shell:true}),{data}=await invite(m);
 assert.equal((await m.run('bob','invites.redeem',{data})).state,'pending');await m.settle();
 assert.deepEqual(await members(m,'alice'),[m.party('bob').owner]);
 const created=await m.run('alice','conversations.create',{text:'Hello again',participants:[{principal:who(m.party('bob'))}]});await m.settle();
 assert.ok((await m.run('bob','conversations.invitations')).invitations.some(i=>i.conversationId===created.conversationId));
 // The trusted mailbox runs mint-bound as a system actor; no owner web operation reaches it.
 const {WEB_OPERATIONS}=await import('../../apps/parlay/web/providers/mailbox.mjs');assert.equal(WEB_OPERATIONS.includes('invites.mint-bound'),false);assert.equal(WEB_OPERATIONS.some(name=>['receive.redeem','receive.first-contact','receive.deliver'].includes(name)),false);
});
