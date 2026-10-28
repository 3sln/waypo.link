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
// Settles, then lets retries that are already scheduled (a 401 is retried once after repair) run to their outcome.
async function settleRetries(m,name){await m.settle();for(let n=0;n<4;n++){const due=(await m.tasks(name)).filter(x=>x.state==='retry_scheduled'&&x.nextAttemptAt>m.clock.now()).map(x=>x.nextAttemptAt);if(!due.length)return;m.clock.set(Math.min(...due));await m.settle();}}
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
 // bob and carol are in neither's lists; alice invites both (the mesh makes alice and each invitee mutual contacts).
 const cid=await m.conversation('alice',['bob','carol']);
 for(const name of ['alice','bob','carol'])await m.run(name,'conversations.send',{conversationId:cid,text:`hi from ${name}`});await m.settle();
 for(const name of ['bob','carol'])assert.deepEqual((await m.texts(name,cid)).filter(x=>x?.startsWith('hi from')).sort(),['hi from alice','hi from bob','hi from carol']);
 assert.deepEqual(await m.peerStates('carol',cid),{alice:'accepted',bob:'accepted'});
});

// Test-only: a redemption whose proof signature is zeroed, so author verification fails for the claimed author.
async function forgedRedemption(m,from,to,token,options){
 const built=await redemptionRequest(m,from,to,token,options),e=structuredClone(built.envelope);e.proof.signature=B.base64url(new Uint8Array(64));
 const wire=B.encodeDelivery(e);return {...built,envelope:e,request:{...built.request,headers:{...built.request.headers,'content-type':wire.contentType},body:wire.bytes}};
}

// Seeded redemption chaos against a reference model written from messaging §4.4, §4.5 and §8.2 as amended on 2026-10-28
// (provisional, unsigned; coordinator decision): a recorded redeemer's replay after the token is cancelled or expired is
// invite_invalid (§4.4 step 5), and the acceptance window is checked after the token checks (§13 gate-order vectors).
// The model covers token digest and owner binding (including a token indexed to another owner), liveness (cancelled,
// expired, exhausted unless already redeemed by this author), the bound principal, same-host authors, replay by (token
// digest, author principal) with identical bytes, at most one admission per single-use token under concurrency, and a
// blocked redeemer (the token is spent and the receipt is ordinary, §4.5). Two parts are application policy, not spec:
// the admission outcome (blocked: refused and not in Contacts) and the unverifiable-redemption limiter (per token digest,
// never per claimed principal: review M1). Seeds come from CHAOS_SEED or a fixed list.
for(const seed of process.env.CHAOS_SEED?[Number(process.env.CHAOS_SEED)]:[3,11,29]){
 test(`seeded redemption chaos matches the reference model (seed ${seed})`,async t=>{
  const m=await mesh(t,{seed}),random=createRandom(seed),redeemers=['bob','carol','dave'],invites=[],model=new Map(),sent=new Map(),tally={},blocked=new Set(),foreign=[],LIMIT=INVITE_POLICY.unverifiablePerInvitationPerHour;
  for(let n=0;n<2;n++)foreign.push((await invite(m,'carol')).data.token);// carol's tokens: indexed to another owner than alice
  const create=async(input={})=>{const c=await invite(m,'alice',input),digest=await sha(c.data.token);model.set(digest,{id:c.invite.id,token:c.data.token,bound:input.bound?nameOf(m,input.bound.subject):null,expiresAt:c.invite.expiresAt,revoked:false,used:0,redeemers:new Map()});return {id:c.invite.id,token:c.data.token,digest};};
  const predict=(r,token,{digest,createdAt,payloadDigest,foreignOwner})=>{
   const inv=model.get(digest);if(foreignOwner||!inv||inv.token!==token)return 'invite_invalid';
   const prior=inv.redeemers.get(r);
   if(inv.revoked||m.clock.now()>=inv.expiresAt||inv.bound&&inv.bound!==r||(!prior&&inv.used>=1))return 'invite_invalid';
   if(m.clock.now()-createdAt>B.LIMITS.linkWindowMs)return 'envelope_expired';
   if(m.party(r).principal.issuer!==ONE)return 'author_unverifiable';
   return prior?(prior.payloadDigest===payloadDigest?'replay':'invite_invalid'):'admitted';
  };
  const record=async(r,digest,envelope,result,extra={})=>{const inv=model.get(digest);inv.used++;inv.redeemers.set(r,{payloadDigest:await B.payloadDigest(envelope),receipt:result.json.receipt,outcome:blocked.has(r)?'refused':'admitted'});sent.set(`${r}|${digest}`,{envelope,digest,...extra});};
  for(let step=0;step<36;step++){
   const op=random.int(10);
   // Unverifiable-redemption limiter on a fresh invitation kept out of the random pool: bogus proofs claiming r are
   // counted per token digest, then r still redeems another invitation at once (review M1).
   if(op===5||step===18){
    const r=random.pick(['bob','carol']),burst=await create(),errors=[];
    for(let n=0;n<=LIMIT;n++)errors.push((await post(m,'alice',(await forgedRedemption(m,r,'alice',burst.token)).request)).json.error);
    assert.deepEqual(errors,[...Array(LIMIT).fill('author_unverifiable'),'rate_limited'],`seed ${seed} step ${step}: limiter keyed by token digest`);
    for(const e of errors)tally[e]=(tally[e]??0)+1;
    const other=await create();invites.push(other);const built=await redemptionRequest(m,r,'alice',other.token),result=await post(m,'alice',built.request);
    assert.equal(result.status,200,`seed ${seed} step ${step}: ${r} is not locked out by bogus proofs claiming it`);await record(r,other.digest,built.envelope,result);tally.admitted=(tally.admitted??0)+1;
    continue;
   }
   if(op<2||!invites.length){const bound=random.chance(0.3)?random.pick(redeemers):null;invites.push(await create({...bound?{bound:who(m.party(bound))}:{},expiresIn:3600000*(1+random.int(48))}));continue;}
   if(op===2){const i=random.pick(invites);await m.run('alice','invites.revoke',{id:i.id});model.get(i.digest).revoked=true;await m.flush();continue;}
   if(op===3){m.clock.advance(random.int(3)*3600000*random.int(30));await m.renew();continue;}
   // Blocking a redeemer never changes the wire result (§4.5); the redemption is spent and refused.
   if(op===4){const r=random.pick(['bob','carol']);await m.run('alice','contacts.block',{principal:who(m.party(r)),...blocked.has(r)?{blocked:false}:{}});if(blocked.has(r))blocked.delete(r);else blocked.add(r);continue;}
   // One to three concurrent attempts on one invitation, each fresh, a resend, a token mismatch or another owner's token.
   const i=random.pick(invites),attempts=[];
   for(const r of random.shuffle([...redeemers]).slice(0,1+random.int(3))){
    const mode=random.int(5),key=`${r}|${i.digest}`;
    // A resend keeps the signed payload and may carry a renewed certificate for the same key (§5.3).
    if(mode===0&&sent.has(key)){const prior=sent.get(key),e=structuredClone(prior.envelope);e.proof.delegation=m.party(r).signer.delegation;const wire=B.encodeDelivery(e);attempts.push({r,envelope:e,request:{url:m.party('alice').ingress,method:'POST',headers:{'content-type':wire.contentType,authorization:`BindleInvite ${model.get(i.digest).token}`},body:wire.bytes,source:r},token:model.get(i.digest).token,digest:i.digest,retry:true});}
    else if(mode===1){const wrong=random.pick(invites);attempts.push({r,...await redemptionRequest(m,r,'alice',wrong.token,{invite:i.digest}),token:wrong.token,digest:i.digest});}
    else if(mode===2){const token=random.pick(foreign);attempts.push({r,...await redemptionRequest(m,r,'alice',token),token,digest:await sha(token),foreignOwner:true});}
    else{const built=await redemptionRequest(m,r,'alice',i.token);attempts.push({r,...built,token:i.token,digest:i.digest});}
   }
   const expected=[];for(const a of attempts)expected.push(predict(a.r,a.token,{digest:a.digest,createdAt:a.envelope.payload.createdAt,payloadDigest:await B.payloadDigest(a.envelope),foreignOwner:a.foreignOwner}));
   const results=(await concurrently(attempts.map(a=>()=>post(m,'alice',a.request)))).map(x=>x.value);
   const fresh=attempts.map((a,n)=>expected[n]==='admitted'?n:-1).filter(n=>n>=0);
   // Concurrent fresh redemptions of one live single-use token: exactly one wins (any), the others lose the race.
   const winners=fresh.filter(n=>results[n].status===200);assert.ok(fresh.length===0||winners.length===1,`seed ${seed} step ${step}: one winner among ${fresh.length}: ${JSON.stringify(fresh.map(n=>results[n].json.error??results[n].status))}`);
   for(const [n,a] of attempts.entries()){
    const want=fresh.includes(n)&&!winners.includes(n)?'invite_invalid':expected[n],got=results[n].status===200?(want==='replay'?'replay':'admitted'):results[n].json.error;
    assert.equal(got,want,`seed ${seed} step ${step}: ${a.r} ${a.retry?'retry':a.foreignOwner?'another owner':'attempt'} on ${a.digest.slice(0,6)}`);tally[got]=(tally[got]??0)+1;
    if(want==='admitted')await record(a.r,a.digest,a.envelope,results[n]);
    if(want==='replay')assert.deepEqual(results[n].json.receipt,model.get(a.digest).redeemers.get(a.r).receipt,'a replay returns the stored receipt');
   }
   if(random.chance(0.5))await m.flush();
  }
  assert.ok(tally.admitted>0&&tally.invite_invalid>0&&tally.rate_limited>0,`seed ${seed} exercised: ${JSON.stringify(tally)}`);
  // Final state: the ledger (with outcomes), the Contacts list and the stored items agree with the model.
  const admitted=new Set();for(const inv of model.values())for(const [r,x] of inv.redeemers)if(x.outcome==='admitted')admitted.add(m.party(r).owner);
  await m.settle();
  assert.deepEqual(await members(m,'alice'),[...admitted].sort());
  const listed=(await m.run('alice','invites.list')).invites;
  for(const inv of model.values()){const row=listed.find(l=>l.id===inv.id);assert.equal(row.uses.used,inv.used);assert.deepEqual(row.ledger.map(e=>[nameOf(m,e.principal.subject),e.outcome]).sort(),[...inv.redeemers].map(([r,x])=>[r,x.outcome]).sort());}
 });
}

// Seeded redeemer-side chaos against a reference model of rollback provenance (rethink CL-20; reviews L3 and M2):
// bob redeems alice's invitations, adds or removes her by hand, while alice revokes tokens and blocks or unblocks bob and
// the clock moves. After every sweep, alice is in bob's Contacts exactly when the model holds a reason: a manual add,
// an accepted redemption or a conversation with her, or a redemption still pending. The account starts with 64 settled
// redemption rows (an old account): they never count against the pending cap and are pruned with the rest once their
// token can no longer exist, so the alarm's sweep ends. Application behaviour; the spec does not define rollback.
for(const seed of process.env.CHAOS_SEED?[Number(process.env.CHAOS_SEED)]:[5,17,41]){
 test(`seeded redeemer chaos: provenance-safe rollback, the pending cap and settled-row pruning (seed ${seed})`,async t=>{
  const m=await mesh(t,{seed}),random=createRandom(seed),bob=m.party('bob'),alice=who(m.party('alice')),{CONVERSATION_LIMITS}=await import('../../packages/messaging-engine/domains/conversations.mjs');
  await bob.store.transaction(async tx=>{for(let n=0;n<INVITE_POLICY.pendingRedemptions;n++)await tx.put(`inv/pending/old-${String(n).padStart(2,'0')}`,{tokenDigest:`old-${n}`,inviter:who(m.party('carol')),state:n%2?'accepted':'rolled-back',createdAt:m.clock.now(),settledAt:m.clock.now(),expiresAt:m.clock.now()+3600000});});
  const invites=[],rows=new Map(),tally={};let membership=null,isBlocked=false;
  const inContacts=async()=>(await members(m,'bob')).includes(alice.subject);
  const pendingCount=()=>[...rows.values()].filter(r=>r.state==='pending').length;
  const sweep=async step=>{
    // The model's sweep, in digest order: a terminal error rolls back at once, anything else once its return control lapses.
    const now=m.clock.now();
    for(const [d,row] of [...rows].sort(([a],[b])=>a<b?-1:1)){
     if(row.state!=='pending'||!(row.outcome==='invalid'||now>=row.returnExpiresAt))continue;
     if(row.outcome==='accepted'){if(membership&&!membership.permanent&&membership.held.has(d))membership={permanent:true,held:new Set()};row.state='accepted';continue;}
     const conversation=[...rows].some(([other,r])=>other!==d&&r.outcome==='accepted');
     if(membership&&!membership.permanent&&membership.held.has(d)){if(conversation)membership={permanent:true,held:new Set()};else{membership.held.delete(d);if(!membership.held.size)membership=null;}}
     row.state='rolled-back';
    }
    const swept=await m.run('bob','invites.sweep');tally.rolledBack=(tally.rolledBack??0)+swept.rolledBack;tally.settled=(tally.settled??0)+swept.settled;
    assert.equal(await inContacts(),membership!==null,`seed ${seed} step ${step}: Contacts membership matches the model's reasons`);
  };
  for(let step=0;step<60;step++){
   const op=random.int(12);
   if(op<2||!invites.length){const c=await invite(m,'alice',{expiresIn:3600000*(1+random.int(72))});invites.push({id:c.invite.id,data:c.data,digest:await sha(c.data.token),expiresAt:c.invite.expiresAt,revoked:false,used:false});continue;}
   if(op===2){const i=random.pick(invites);await m.run('alice','invites.revoke',{id:i.id});i.revoked=true;await m.flush();continue;}
   if(op===3){await m.run('alice','contacts.block',{principal:who(bob),...isBlocked?{blocked:false}:{}});isBlocked=!isBlocked;continue;}
   if(op===4){await m.run('bob','lists.add',{list:CONTACTS_LIST,principal:alice});membership={permanent:true,held:new Set()};continue;}
   if(op===5){await m.run('bob','lists.remove',{list:CONTACTS_LIST,principal:alice});membership=null;continue;}
   if(op===6){m.clock.advance(3600000*random.int(100));await m.renew();continue;}
   if(op===7){await sweep(step);continue;}
   // bob redeems one of alice's invitations through his app, then the mesh settles.
   const i=random.pick(invites),existing=rows.get(i.digest);
   // The handler checks `expires_at` locally first (§4.2 step 1), before any local row.
   if(m.clock.now()>=Math.floor(i.expiresAt/1000)*1000){await assert.rejects(m.run('bob','invites.redeem',{data:i.data}),{code:'invite_expired'});continue;}
   if(existing){
    if(existing.state==='rolled-back')await assert.rejects(m.run('bob','invites.redeem',{data:i.data}),{code:'invite_used'});
    else assert.equal((await m.run('bob','invites.redeem',{data:i.data})).state,existing.state);
    continue;
   }
   assert.ok(pendingCount()<INVITE_POLICY.pendingRedemptions);
   const at=m.clock.now(),result=await m.run('bob','invites.redeem',{data:i.data});assert.equal(result.state,'pending',`seed ${seed} step ${step}: settled rows never count against the pending cap`);
   if(!membership)membership={permanent:false,held:new Set([i.digest])};else if(!membership.permanent)membership.held.add(i.digest);
   const live=!i.revoked&&!i.used&&m.clock.now()<i.expiresAt,outcome=!live?'invalid':isBlocked?'held':'accepted';if(live)i.used=true;
   await settleRetries(m,'bob');
   // An accept settles the row at once and makes the admission permanent.
   rows.set(i.digest,{state:outcome==='accepted'?'accepted':'pending',outcome,returnExpiresAt:at+CONVERSATION_LIMITS.bootstrapMs});tally[outcome]=(tally[outcome]??0)+1;
   if(outcome==='accepted'&&membership)membership={permanent:true,held:new Set()};
   const task=(await m.tasks('bob')).find(x=>x.envelope?.payload?.recipient?.invite===i.digest);
   if(outcome==='invalid')assert.equal(task?.state,'rejected',`seed ${seed} step ${step}: a dead token is a terminal error`);
   if(outcome==='accepted')assert.equal((await m.get('bob',result.conversationId)).peers[0].state,'accepted');
  }
  // Every return control lapses: each remaining pending redemption rolls back or settles, as the model says.
  m.clock.advance(CONVERSATION_LIMITS.bootstrapMs+1);await m.renew();await sweep('final');
  assert.ok(tally.accepted>0&&tally.rolledBack>0,`seed ${seed} exercised: ${JSON.stringify(tally)}`);
  // Long after every token: all redemption rows are pruned, so nothing keeps the alarm's sweep running.
  m.clock.advance(INVITE_POLICY.personMaxMs);await m.renew();await m.run('bob','invites.sweep');
  m.clock.advance(B.LIMITS.retentionMs+1);await m.renew();for(let n=0;n<4;n++)await m.run('bob','invites.sweep');
  assert.equal((await bob.store.list({prefix:'inv/pending/'})).size,0,'settled redemption rows are pruned');
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

// ---- Review fixes (2026-10-28, provisional): each test fails without its fix.
test('review M1, L2: bogus proofs claiming a third party never lock it out; no pre-verification result depends on refusal history',async t=>{
 const m=await mesh(t),{data}=await invite(m),LIMIT=INVITE_POLICY.unverifiablePerInvitationPerHour;
 await m.run('alice','lists.add',{list:CONTACTS_LIST,principal:who(m.party('bob'))});
 // Any holder of alice's token sends 25 redemptions claiming bob with a bogus proof: counted per token digest.
 const errors=[];for(let n=0;n<25;n++)errors.push((await post(m,'alice',(await forgedRedemption(m,'bob','alice',data.token)).request)).json.error);
 assert.deepEqual(errors,[...Array(LIMIT).fill('author_unverifiable'),...Array(25-LIMIT).fill('rate_limited')]);
 // bob's genuine first contact and his redemption of another invitation are unaffected.
 assert.equal((await post(m,'alice',(await oneOffRequest(m,'bob','alice')).request)).status,200);
 const other=await invite(m);assert.equal((await post(m,'alice',(await redemptionRequest(m,'bob','alice',other.data.token)).request)).status,200);
 // carol (not admitted) is refused 20 times after verification; her next verified attempt is rate limited ...
 for(let n=0;n<20;n++)assert.equal((await post(m,'alice',(await oneOffRequest(m,'carol','alice')).request)).json.error,'not_authorized');
 assert.equal((await post(m,'alice',(await oneOffRequest(m,'carol','alice')).request)).json.error,'rate_limited');
 // ... but a bogus proof claiming carol still gets the same result as one claiming the admitted bob (§6.7).
 const bogus=async from=>{const r=await oneOffRequest(m,from,'alice'),e=structuredClone(r.envelope);e.proof.signature=B.base64url(new Uint8Array(64));const wire=B.encodeDelivery(e,{body:encoder.encode('hello')});r.request.headers['content-type']=wire.contentType;r.request.body=wire.bytes;return post(m,'alice',r.request);};
 const asCarol=await bogus('carol'),asBob=await bogus('bob');assert.deepEqual([asCarol.status,asCarol.json],[asBob.status,asBob.json]);assert.equal(asCarol.json.error,'author_unverifiable');
});

test('review M2: the pending-redemption cap counts only pending rows, and settled rows are pruned once their token is gone',async t=>{
 const m=await mesh(t),store=m.party('bob').store,now=m.clock.now();
 await store.transaction(async tx=>{for(let n=0;n<INVITE_POLICY.pendingRedemptions;n++)await tx.put(`inv/pending/settled-${n}`,{tokenDigest:`settled-${n}`,inviter:who(m.party('carol')),state:n%2?'accepted':'rolled-back',createdAt:now,settledAt:now,expiresAt:now+3600000});});
 const {data}=await invite(m);assert.equal((await m.run('bob','invites.redeem',{data})).state,'pending','64 settled rows do not block a redemption');await m.settle();
 assert.deepEqual(await members(m,'bob'),[m.party('alice').owner]);
 m.clock.advance(3600000+B.LIMITS.retentionMs);await m.renew();
 assert.equal((await m.run('bob','invites.sweep')).forgotten,INVITE_POLICY.pendingRedemptions,'the real redemption is kept while its token may exist');
 m.clock.advance(INVITE_POLICY.personMaxMs+B.LIMITS.retentionMs);await m.renew();
 assert.equal((await m.run('bob','invites.sweep')).forgotten,1);assert.equal((await store.list({prefix:'inv/pending/'})).size,0,'no row keeps the alarm sweep running');
 assert.deepEqual(await members(m,'bob'),[m.party('alice').owner],'an accepted redemption leaves a permanent contact');
 // Pending rows still count.
 await store.transaction(async tx=>{for(let n=0;n<INVITE_POLICY.pendingRedemptions;n++)await tx.put(`inv/pending/open-${n}`,{tokenDigest:`open-${n}`,inviter:who(m.party('carol')),state:'pending',submitted:true,createdAt:m.clock.now(),expiresAt:null});});
 await assert.rejects(m.run('bob','invites.redeem',{data:(await invite(m)).data}),{code:'limit_reached'});
});

test('review M4: a developer-contact mint replaces the earlier open link for the same principal; system and used links never fill the owner cap',async t=>{
 const m=await mesh(t),engine=m.party('alice').peer.engine,store=m.party('alice').store,{InvitesMintBound}=await import('../../packages/messaging-engine/domains/invites.mjs');
 const mint=principal=>engine.perform(new InvitesMintBound({actor:{kind:'system',owner:m.party('alice').owner},input:{principal,tier:'free'}}));
 const first=await mint(who(m.party('bob'))),second=await mint(who(m.party('bob'))),carol=await mint(who(m.party('carol')));await m.flush();
 const state=async id=>(await m.run('alice','invites.list')).invites.find(i=>i.id===id).state;
 assert.equal(await state(first.invite.id),'revoked');assert.equal(await state(second.invite.id),'live');assert.equal(await state(carol.invite.id),'live','other principals are untouched');
 assert.equal((await store.list({prefix:'inv/rule/'})).size,2,'the replaced link loses its rule');
 assert.equal((await post(m,'alice',(await redemptionRequest(m,'bob','alice',first.data.token)).request)).json.error,'invite_invalid');
 assert.equal((await post(m,'alice',(await redemptionRequest(m,'bob','alice',second.data.token)).request)).status,200);
 const fill=async(n,extra)=>store.transaction(async tx=>{const now=m.clock.now();for(let k=0;k<n;k++){const id=crypto.randomUUID();await tx.put(`inv/link/${id}`,{id,name:null,template:'person',maxUses:1,used:0,bound:{issuer:ONE,subject:crypto.randomUUID()},expiresAt:now+3600000,state:'live',createdAt:now,tokenDigest:`fill-${id}`,ledger:[],redeemers:[],...extra});}});
 await fill(INVITE_POLICY.maxLinks,{system:true});assert.ok((await invite(m)).invite.id,'system-minted links have their own cap');
 await fill(INVITE_POLICY.maxLinks,{used:1});assert.ok((await invite(m)).invite.id,'used links are not open');
 await fill(INVITE_POLICY.maxLinks,{});await assert.rejects(invite(m),{code:'limit_reached'});
 assert.ok((await mint(who(m.party('dave')))).invite.id,'a full owner cap leaves developer contact working');
});

test('review L3: rollback keeps a contact added by hand meanwhile and a membership another pending redemption relies on',async t=>{
 const m=await mesh(t);
 const a=await invite(m,'carol');await m.run('carol','contacts.block',{principal:who(m.party('bob'))});
 await m.run('bob','invites.redeem',{data:a.data});await m.settle();
 await m.run('bob','lists.add',{list:CONTACTS_LIST,principal:who(m.party('carol'))});
 m.clock.advance(7*86400000+1);await m.renew();assert.equal((await m.run('bob','invites.sweep')).rolledBack,1);
 assert.deepEqual(await members(m,'bob'),[m.party('carol').owner],'the hand-added contact stays');
 // Two redemptions of alice's tokens: #1 fails terminally while #2 (silently refused) is still pending.
 const t1=await invite(m),t2=await invite(m);await m.run('alice','contacts.block',{principal:who(m.party('bob'))});await m.run('alice','invites.revoke',{id:t1.invite.id});await m.flush();
 await m.run('bob','invites.redeem',{data:t1.data});await m.run('bob','invites.redeem',{data:t2.data});await settleRetries(m,'bob');
 assert.deepEqual(await m.run('bob','invites.sweep'),{rolledBack:1,settled:0});
 assert.ok((await members(m,'bob')).includes(m.party('alice').owner),'redemption #2 still relies on the membership');
 m.clock.advance(7*86400000+1);await m.renew();assert.equal((await m.run('bob','invites.sweep')).rolledBack,1);
 assert.equal((await members(m,'bob')).includes(m.party('alice').owner),false,'removed once no reason remains');
});

test('coordinator decision: until CL-21 content refusal exists, an invitation never targets a receive-only list',async t=>{
 const m=await mesh(t),earlier=await invite(m);
 await m.run('alice','lists.set-policy',{list:CONTACTS_LIST,policy:'receive-only'});
 await assert.rejects(m.run('alice','invites.create',{template:'person'}),{code:'invalid_input'});
 // An invitation made before the change is held for review, not accepted.
 await m.run('bob','invites.redeem',{data:earlier.data});await m.settle();
 assert.equal((await m.run('alice','invites.list')).invites.find(i=>i.id===earlier.invite.id).ledger[0].outcome,'held');
 assert.deepEqual(await members(m,'alice'),[]);
});

test('review L1: the first-contact budget never reads a client-sent CF-Connecting-IP; Node uses the socket address unless a trusted proxy header is configured',async t=>{
 const budget=createFirstContactBudget({limits:{windowMs:60000,perSource:1,perOwner:100,keys:64}}),m=await mesh(t,{budget});
 const send=async ip=>{const {request}=await oneOffRequest(m,'carol','alice');delete request.source;request.headers['cf-connecting-ip']=ip;return post(m,'alice',request);};
 assert.equal((await send('198.51.100.1')).json.error,'not_authorized');
 assert.equal((await send('198.51.100.2')).json.error,'rate_limited','a rotated header is not a new source');
 const {nodeSource}=await import('../../apps/parlay/node/server.mjs'),spoofed=new Request('https://box.example/bindle/ingress',{headers:{'CF-Connecting-IP':'203.0.113.9','X-Forwarded-For':'203.0.113.10','X-Real-IP':'203.0.113.8'}});
 assert.equal(nodeSource(spoofed,{remoteAddress:'::ffff:192.0.2.7'}),'192.0.2.7','the socket address, never a client header');
 assert.equal(nodeSource(spoofed,{remoteAddress:'2001:db8::1'}),'2001:db8::1');assert.equal(nodeSource(spoofed,{}),'unknown');
 assert.equal(nodeSource(spoofed,{remoteAddress:'192.0.2.7'},{trustedClientIpHeader:'x-real-ip'}),'203.0.113.8','the operator-configured proxy header');
 assert.equal(nodeSource(new Request('https://box.example/',{headers:{'X-Real-IP':'203.0.113.8, 203.0.113.9'}}),{remoteAddress:'192.0.2.7'},{trustedClientIpHeader:'x-real-ip'}),'unknown','an appended list is not one address');
});
