// Portability wargame regressions, source side (2026-10-23): F1–F5, F11, F12, F13, the move-out of an identity that
// moved in (seq > 1), commits whose identity changes before stage 1, and capability cache headers. Each test fails when
// its fix is reverted. Rerun the seeded case with CHAOS_SEED=<seed>.
import test from 'node:test';
import assert from 'node:assert/strict';
import {transferFixture,keyPair,HOUR,DAY,MINUTE,EMAIL,OWNER,ISSUER,DEST} from './helpers/transfer-out.mjs';
import {portabilityPair,packageFrom} from './helpers/transfer-in.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
import {stages,MOVE_PATH,movedResponse,capabilityQuery} from '../packages/runtime/routes/moved.mjs';
import {signMoveStatement,statementDigest,parseMoveStatement,parseMoveAttestation} from '../packages/identity/succession.mjs';
import {identityURI} from '../packages/identity/transfer-out.mjs';
import {RedirectExtensionService} from '../packages/billing/redirect-extension.mjs';

const refusal=async work=>{try{return await work();}catch(error){return {refused:error.code};}};
const fromSession=(fx,extra={})=>({sessionId:'s-two',sessionCreatedAt:fx.clock.now()-20*DAY,credentialId:'pk-two',credentialCreatedAt:fx.clock.now()-50*DAY,...extra});

// ---- F1: no pre-emptive elevation ----------------------------------------------------------------------------------

test('F1a: an elevated restart is refused when no earlier move was disputed, and nothing is removed',async t=>{
 const fx=await transferFixture(t);
 const outcome=await refusal(()=>fx.start({remove:{sessions:['s-two'],passkeys:['pk-two'],push:['p1'],emails:[EMAIL]}}));
 assert.equal(outcome.refused,'elevated_restart_unavailable');
 const account=await fx.identityRecord();
 assert.deepEqual(account.sessions.map(s=>s.id),['s-old','s-two']);assert.deepEqual(account.credentials.map(c=>c.id),['pk-old','pk-two']);assert.equal(account.verifiedEmail,EMAIL);
});

test('F1b: a pre-emptive elevated restart on an account without email never commits',async t=>{
 const fx=await transferFixture(t,{identity:{verifiedEmail:null,emailVerifiedAt:null}});
 await fx.start({remove:{sessions:['s-two'],passkeys:['pk-two'],push:['p1']}}).catch(()=>{});
 await fx.post();fx.clock.advance(73*HOUR);
 assert.notEqual((await fx.post()).status,'attested');
 assert.equal((await fx.identityRecord()).sessions.length,2);
});

test('F1c: requester-side elevation of an undisputed move is refused',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.post();
 const outcome=await refusal(()=>fx.elevate({side:'requester',remove:{sessions:['s-two'],passkeys:['pk-two'],push:['p1'],emails:[EMAIL]}}));
 assert.equal(outcome.refused,'nothing_to_resolve');
 assert.equal((await fx.identityRecord()).credentials.length,2);
});

test('F1d: only recorded disputers (and the passkey of a disputing session) can be named; a restart names the previous aborters',async t=>{
 const fx=await transferFixture(t);await fx.start();
 await fx.dispute({choice:'hold'},{kind:'owner',owner:OWNER,...fromSession(fx)});
 assert.equal((await refusal(()=>fx.elevate({side:'requester',remove:{push:['p1']}}))).refused,'not_a_disputer');
 assert.equal((await refusal(()=>fx.elevate({side:'requester',remove:{emails:[EMAIL]}}))).refused,'not_a_disputer');
 const view=await fx.elevate({side:'requester',remove:{sessions:['s-two'],passkeys:['pk-two']}});assert.equal(view.state,'pending');
 // Restart after an abort: the lock remembers who aborted.
 const other=await transferFixture(t);await other.start();await other.dispute({choice:'abort',token:other.tokenFor('push')});
 assert.deepEqual((await other.lock()).restart.disputers,[{kind:'push',id:'p1'}]);
 assert.equal((await refusal(()=>other.start({remove:{emails:[EMAIL]}}))).refused,'not_a_disputer');
 assert.equal((await other.start({remove:{push:['p1']}})).state,'pending');
});

test('F1e: a removal that would leave no notice target is refused before anything changes',async t=>{
 const fx=await transferFixture(t,{identity:{verifiedEmail:null,emailVerifiedAt:null}});await fx.start();
 await fx.dispute({choice:'hold',token:fx.tokenFor('push')});
 const before=(await fx.identityRecord()).security.epoch;
 assert.equal((await refusal(()=>fx.elevate({side:'requester',remove:{push:['p1']}}))).refused,'notice_channel_required');
 assert.equal((await fx.identityRecord()).security.epoch,before);assert.ok(await fx.metadata.get(`push-subscription/${OWNER}/p1/`));
});

// ---- F2: commit re-checks and deterministic termination ----------------------------------------------------------------

test('F2a: a security change landing between the cancel check and the commit never commits',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.post();fx.clock.advance(25*HOUR);
 let fired=false;fx.state.hold={get held(){if(!fired){fired=true;fx.bumpSecurity().catch(()=>{});}return false;}};
 assert.notEqual((await fx.post()).status,'attested');
 assert.equal((await fx.identityRecord()).status,'active');assert.equal((await fx.get()).state,'cancelled');
});

test('F2b: a recovery reissue landing in the same window never commits',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.post();fx.clock.advance(25*HOUR);
 let fired=false;fx.state.hold={get held(){if(!fired){fired=true;fx.patchIdentity(a=>({...a,recoveryHash:'replaced',recoveryIssuedAt:fx.clock.now()})).catch(()=>{});}return false;}};
 assert.notEqual((await fx.post()).status,'attested');assert.equal((await fx.identityRecord()).status,'active');
});

test('F2c: an identity that changes or leaves active between the account commit and stage 1 unwinds deterministically',async t=>{
 for(const [change,reason] of [[a=>({...a,security:{epoch:a.security.epoch+1,changedAt:a.security.changedAt}}),'security-change'],[a=>({...a,status:'suspended'}),'identity-inactive'],[a=>({...a,recoveryHash:'other'}),'credential-superseded']]){
  const fx=await transferFixture(t);await fx.start();await fx.post();fx.clock.advance(25*HOUR);
  const markMoved=fx.ports.identity.markMoved;fx.ports.identity={...fx.ports.identity,async markMoved(...args){await fx.patchIdentity(change);return markMoved(...args);}};
  const answer=await fx.post();assert.deepEqual(answer,{status:'refused'},reason);
  const record=await fx.get();assert.equal(record.state,'cancelled');assert.equal(record.reason,reason);assert.equal(record.attestation,null);
  assert.notEqual((await fx.identityRecord()).status,'moved');assert.equal(fx.effects.destroyed,0);
  assert.equal((await fx.lock()).restart.reason,reason);
  fx.ports.identity={...fx.ports.identity,markMoved};assert.deepEqual(await fx.post(),{status:'refused'});assert.equal((await fx.step()).action,'cancelled');
 }
});

test('F2d seeded: identity changes and crashes around stage 1 end committed-and-moved or cancelled, never attested-then-unwound',async()=>{
 const outcomes={};
 await forEachSeed(16,async random=>{
  const fx=await transferFixture(null,{seed:random.seed});
  try{
   await fx.start();await fx.post();fx.clock.advance(25*HOUR);
   const change=random.pick(['none','bump','supersede','suspend']),crashes=random.pick([0,1,2]),markMoved=fx.ports.identity.markMoved;let calls=0;
   fx.ports.identity={...fx.ports.identity,async markMoved(...args){calls++;if(calls===1&&change!=='none')await fx.patchIdentity(a=>change==='bump'?{...a,security:{epoch:a.security.epoch+1,changedAt:a.security.changedAt}}:change==='supersede'?{...a,recoveryHash:'other'}:{...a,status:'suspended'});if(calls<=crashes)throw Object.assign(new Error('shard down'),{code:'unavailable'});return markMoved(...args);}};
   const answers=[];
   for(let n=0;n<8;n++){answers.push(await fx.post());fx.clock.advance(random.pick([MINUTE,10*MINUTE,HOUR]));if(random.chance(0.5))await fx.step();}
   const record=await fx.get(),identity=await fx.identityRecord(),attested=answers.filter(a=>a.status==='attested');
   if(change==='none'){assert.equal(record.state,'committed');assert.equal(identity.status,'moved');assert.ok(attested.length>=1);assert.equal(new Set(attested.map(a=>a.attestation)).size,1);}
   else{assert.equal(record.state,'cancelled');assert.notEqual(identity.status,'moved');assert.equal(attested.length,0);assert.equal(fx.effects.destroyed,0);}
   outcomes[record.state]=(outcomes[record.state]??0)+1;
  }finally{await fx.engine.dispose();await fx.f.dispose();fx.idDb.close();fx.dueDb.close();}
 });
 assert.ok(outcomes.committed>=1&&outcomes.cancelled>=1,JSON.stringify(outcomes));
});

// ---- F3, F4, F5 ----------------------------------------------------------------------------------------------------

test('F3: path (a) without an email or push channel is refused instead of committing with zero notices',async t=>{
 const fx=await transferFixture(t,{identity:{verifiedEmail:null,emailVerifiedAt:null},push:false});
 assert.equal((await refusal(()=>fx.start())).refused,'notice_channel_required');
 assert.equal((await fx.get())?.state,'draft');
});

test('F4: an unauthenticated garbage path (b) request after an elevated abort does not lock the account',async t=>{
 const fx=await transferFixture(t);await fx.start();
 await fx.dispute({choice:'hold',token:fx.tokenFor('email')});
 assert.equal((await fx.elevate({side:'disputer'},{credentialId:'pk-two',sessionId:'s-two'})).state,'aborted');
 assert.equal((await refusal(()=>fx.waiting({recoveryToken:'garbage',keychain:null}))).refused,'recovery_invalid');
 assert.equal((await fx.lock()).contested,undefined);
 // The aborting owner's forced reissue stays possible.
 assert.deepEqual(await fx.service.recoveryReissue({kind:'owner',owner:OWNER,credentialId:'pk-two',sessionId:'s-two'}),{transferPending:false});
});

test('F5: the requesting session cannot lift its own restart block; a device added after the move began cannot either',async t=>{
 const fx=await transferFixture(t);const thief={sessionId:'s-old',credentialId:'pk-old'};
 await fx.start({},thief);assert.equal((await fx.dispute({choice:'abort',token:fx.tokenFor('email')})).state,'aborted');
 assert.equal((await refusal(()=>fx.restartChoice('keep',thief))).refused,'restart_choice_not_allowed');
 assert.equal((await refusal(()=>fx.start({},thief))).refused,'restart_blocked');
 assert.equal((await refusal(()=>fx.restartChoice('keep',{sessionId:'s-new',sessionCreatedAt:fx.clock.now(),credentialId:'pk-new',credentialCreatedAt:fx.clock.now()}))).refused,'restart_choice_not_allowed');
 assert.deepEqual(await fx.restartChoice('keep',fromSession(fx)),{restartBlocked:false,recoveryReissueRequired:false});
});

// ---- F11: destination-start ----------------------------------------------------------------------------------------

test('F11: a move begun at the destination completes after the owner authorizes against the statement digest',async t=>{
 const p=await portabilityPair(t,{start:false}),{dest,source}=p;
 const pkg=packageFrom(source,null);
 await dest.reserve(pkg);const begun=await dest.begin(pkg);
 assert.equal(begun.state,'pending');const url=new URL(begun.authorizeUrl);assert.equal(url.origin+url.pathname,`${ISSUER}/account/transfer-out`);
 const digest=url.searchParams.get('statement');assert.match(digest,/^sha256-[A-Za-z0-9_-]{43}$/);
 p.clock.advance(2*HOUR);
 const draft=await source.begin({statement:digest});await source.authorize({draft:draft.draft});
 assert.equal((await source.get()).statementDigest,digest);
 p.clock.advance(2*HOUR);await dest.step();
 assert.equal((await source.get()).statement.digest,digest);
 p.clock.advance(25*HOUR);await dest.step();await dest.step();
 const after=await dest.get();assert.notEqual(after.state,'refused',`transfer-in ended ${after.state}/${after.reason}`);assert.equal((await source.get()).state,'committed');
});

test('F11: transfer null binds only an authorization made against that exact digest',async t=>{
 const fx=await transferFixture(t);await fx.start();
 assert.deepEqual(await fx.post({transfer:null}),{status:'refused'});
 const other=await transferFixture(t);const draft=await other.begin({statement:`sha256-${'A'.repeat(43)}`});await other.authorize({draft:draft.draft});
 assert.deepEqual(await other.post({transfer:null}),{status:'refused'});
 await assert.rejects(other.begin({statement:'sha256-short'}),{code:'invalid_request'});
});

// ---- seq > 1: an identity that moved in can move out again -----------------------------------------------------------

test('an identity that moved in continues its chain when it moves out (seq 2, prev = digest of the arrival)',async t=>{
 const earlier=await keyPair(),FIRST='https://first.example';
 const arrival=await signMoveStatement({kid:'old-kid',payload:{bindle:'identity-move',v:1,sub:OWNER,kind:'person',seq:1,prev:null,from:{iss:FIRST,identity:`${FIRST}/identity/${OWNER}`},to:{iss:ISSUER,identity:identityURI(ISSUER,OWNER)},iat:1790000000}},earlier.privateKey);
 const prev=await statementDigest(parseMoveStatement(arrival).input);
 const fx=await transferFixture(t,{identity:{moves:[{statement:arrival,attestation:null}],identityUri:identityURI(ISSUER,OWNER)}});
 await fx.start();
 assert.deepEqual((await fx.get()).chain,{seq:2,prev,identity:identityURI(ISSUER,OWNER)});
 // A first-move statement does not continue this identity's chain.
 assert.deepEqual(await fx.post({},{payload:{seq:1,prev:null}}),{status:'refused'});
 assert.equal((await fx.post({},{payload:{seq:2,prev}})).status,'pending');
 fx.clock.advance(25*HOUR);const answer=await fx.post();assert.equal(answer.status,'attested');
 assert.equal(parseMoveAttestation(answer.attestation).payload.seq,2);
});

// ---- F12: move endpoint oracle -------------------------------------------------------------------------------------

test('F12: with the flag off the move endpoint answers a moved identity exactly as unknown and deleted ones',async()=>{
 const ORIGIN='https://3sln.example',MOVED='cccccccc-cccc-4ccc-8ccc-cccccccccccc',DELETED='dddddddd-dddd-4ddd-8ddd-dddddddddddd',UNKNOWN='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',now=Date.now();
 const rows=new Map([[MOVED,{id:MOVED,status:'moved',moved:{v:1,ended:true,committedAt:now-200*DAY,exportUntil:now-170*DAY}}],[DELETED,{id:DELETED,status:'deleted'}]]);
 const env={APP_ORIGIN:ORIGIN,IDENTITY_REPOSITORY:{get:async id=>structuredClone(rows.get(id)??null)}};
 const probe=async sub=>{const {privateKey}=await keyPair();
  const statement=await signMoveStatement({kid:'attacker',payload:{bindle:'identity-move',v:1,sub,kind:'person',seq:1,prev:null,from:{iss:ORIGIN,identity:ORIGIN+'/identity/'+sub},to:{iss:DEST,identity:DEST+'/identity/'+sub},iat:Math.floor(now/1000)}},privateKey);
  const request=new Request(ORIGIN+MOVE_PATH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({v:1,statement,transfer:null,redirect_base:DEST+'/x/'})});
  return (await stages.public({request,env,path:MOVE_PATH,local:true,url:new URL(request.url)})).status;};
 const unknown=await probe(UNKNOWN);assert.equal(unknown,404);assert.equal(await probe(DELETED),unknown);assert.equal(await probe(MOVED),unknown);
});

// ---- capability cache header ---------------------------------------------------------------------------------------

test('a percent-encoded capability parameter still gets no-store on a moved redirect',()=>{
 const moved={sub:OWNER,redirectBase:`${DEST}/from/3sln/`,statement:'s',attestation:'a'};
 for(const query of ['bindle%5Fmeta=abc','x=1&%73ig=abc','bintent=1','bindle_data=x']){
  const response=movedResponse(new Request(`https://3sln.example/users/mover?${query}`),moved);
  assert.equal(response.status,308,query);assert.equal(response.headers.get('Cache-Control'),'no-store',query);
 }
 assert.equal(movedResponse(new Request('https://3sln.example/users/mover?page=2'),moved).headers.get('Cache-Control'),'private, max-age=86400');
 assert.equal(capabilityQuery('%E0%A4%A=1'),true);assert.equal(capabilityQuery(null),false);
});

// ---- F13: late redirect-extension webhook --------------------------------------------------------------------------

test('F13: a paid extension processed after the redirect ended is refunded; a failed refund answers 503 for redelivery',async()=>{
 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id='opaque_redirect_identifier_123',commit=Date.UTC(2026,6,1);
 const run=async({refundFails=false,stale=false}={})=>{
  let time=commit+90*DAY-60000;
  let row={id:owner,status:'moved',revision:1,moved:{redirectId:id,to:{iss:'https://new.example'},redirectBase:'https://new.example/m/',committedAt:commit,redirectUntil:commit+90*DAY,movedUntil:commit+90*DAY,attestation:'proof'}};
  const config={APP_ORIGIN:'https://old.example',BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'x',POLAR_WEBHOOK_SECRET:'x',POLAR_PRODUCT_ID_REDIRECT_10Y:'redirect-product',POLAR_ORGANIZATION_ID:'org'};
  const order={id:'order',product_id:'redirect-product',customer:{organization_id:'org'},metadata:{'3sln_me_redirect_id':id,'3sln_me_redirect_owner':owner},subscription_id:null,currency:'usd',subtotal_amount:1000,discount_amount:0,net_amount:1000,tax_amount:0,total_amount:1000,refunded_amount:0,paid:true,status:'paid',created_at:new Date(time).toISOString()};
  const refunds=[],client={orders:{get:async()=>structuredClone(order)},refunds:{create:async b=>{if(refundFails)throw new Error('provider down');refunds.push(b);if(!stale){order.refunded_amount+=b.amount;order.status=order.refunded_amount>=order.net_amount?'refunded':'partially_refunded';}return {order_id:b.order_id};}}};
  const repository={get:async()=>structuredClone(row),findMovedByRedirectId:async k=>k===id?structuredClone(row):null,compareAndSwap:async(k,r,n)=>{if(row.revision!==r)return false;row=structuredClone(n);return true;}};
  const service=new RedirectExtensionService({config,repository,client,now:()=>time,enabled:()=>true});
  time+=2*60000;
  return {result:await service.applyWebhook({type:'order.paid',orderId:'order',redirectId:id,owner}).catch(error=>({error:error.code,status:error.status})),refunds,row};
 };
 const late=await run();assert.equal(late.result.refunded,true);assert.equal(late.refunds.length,1);assert.equal(late.refunds[0].amount,1000);assert.equal(late.row.revision,1);
 const down=await run({refundFails:true});assert.equal(down.result.status,503);
 // Follow-up 4: the order is re-read after refunding; a refund the provider does not show yet answers 503.
 const unconfirmed=await run({stale:true});assert.equal(unconfirmed.result.status,503);
});

// ---- review follow-ups (2026-10-23) ----

test('follow-up 1: the requester is never its own tier-0 disputer', async t => {
 const fx=await transferFixture(t);await fx.start();
 const requester={kind:'owner',owner:OWNER,sessionId:'s-old',sessionCreatedAt:fx.clock.now()-30*DAY,credentialId:'pk-old',credentialCreatedAt:fx.clock.now()-60*DAY};
 assert.equal((await refusal(()=>fx.dispute({choice:'hold'},requester))).refused,'dispute_not_allowed');
 // Even a recorded self-dispute (another session on the requester's passkey) opens no elevation.
 await fx.dispute({choice:'hold'},{...requester,sessionId:'s-other'}).catch(()=>{});
 assert.equal((await refusal(()=>fx.elevate({side:'requester',remove:{sessions:['s-two']}}))).refused,'nothing_to_resolve');
 // The requester's abort is a withdrawal: no restart block, so no elevated restart either.
 const other=await transferFixture(t);await other.start();
 const ended=await other.dispute({choice:'abort'},{...requester,sessionCreatedAt:other.clock.now()-30*DAY,credentialCreatedAt:other.clock.now()-60*DAY});
 assert.equal(ended.state,'cancelled');assert.equal(ended.reason,'withdrawn');assert.equal((await other.lock())?.restart,undefined);
 assert.equal((await refusal(()=>other.start({remove:{sessions:['s-old']}}))).refused,'elevated_restart_unavailable');
 // A legacy lock entry naming the requester is not counted as a disputer.
 const legacy=await transferFixture(t);await legacy.start();const live=await legacy.get();
 await legacy.metadata.put('transfer-out/v1',{...live,disputes:[{at:1,by:{kind:'session',id:'s-old',credentialId:'pk-old'},choice:'abort'}]});
 await legacy.dispute({choice:'abort',token:legacy.tokenFor('push')});
 assert.deepEqual((await legacy.lock()).restart.disputers,[{kind:'push',id:'p1'}]);
});

test('follow-up 4: a new order already partly refunded is not recorded as an extension; its remainder is refunded', async () => {
 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id='opaque_redirect_identifier_123',commit=Date.UTC(2026,6,1),time=commit+DAY;
 let row={id:owner,status:'moved',revision:1,moved:{redirectId:id,to:{iss:'https://new.example'},redirectBase:'https://new.example/m/',committedAt:commit,redirectUntil:commit+90*DAY,movedUntil:commit+90*DAY,attestation:'proof'}};
 const config={APP_ORIGIN:'https://old.example',BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'x',POLAR_WEBHOOK_SECRET:'x',POLAR_PRODUCT_ID_REDIRECT_10Y:'redirect-product',POLAR_ORGANIZATION_ID:'org'};
 const order={id:'order',product_id:'redirect-product',customer:{organization_id:'org'},metadata:{'3sln_me_redirect_id':id,'3sln_me_redirect_owner':owner},subscription_id:null,currency:'usd',subtotal_amount:1000,discount_amount:0,net_amount:1000,tax_amount:0,total_amount:1000,refunded_amount:400,paid:true,status:'partially_refunded',created_at:new Date(time).toISOString()};
 const refunds=[],client={orders:{get:async()=>structuredClone(order)},refunds:{create:async b=>{refunds.push(b);order.refunded_amount+=b.amount;order.status='refunded';return {order_id:b.order_id};}}};
 const repository={get:async()=>structuredClone(row),findMovedByRedirectId:async k=>k===id?structuredClone(row):null,compareAndSwap:async(k,r,n)=>{if(row.revision!==r)return false;row=structuredClone(n);return true;}};
 const service=new RedirectExtensionService({config,repository,client,now:()=>time,enabled:()=>true});
 const result=await service.applyWebhook({type:'order.updated',orderId:'order',redirectId:id,owner});
 assert.equal(result.refunded,true);assert.equal(refunds[0].amount,600);assert.equal(row.revision,1);assert.equal(row.moved.extensionOrder,undefined);
});

test('transfer-in document: `$` patterns in the posted package are embedded verbatim, never expanded', async () => {
 const {transferDocument}=await import('../packages/runtime/routes/transfer-pages.mjs');
 const page='<!doctype html><html><head><title>t</title></head><body>BODY</body></html>';
 const env={ASSETS:{fetch:async()=>new Response(page,{status:200,headers:{'Content-Type':'text/html'}})}};
 const packageJSON=JSON.stringify({a:"$'",b:'$&',c:'$`',d:'$$'});
 const response=await transferDocument({request:new Request('https://3sln.example/bindle/portability/transfer-in',{method:'POST'}),env,url:new URL('https://3sln.example/bindle/portability/transfer-in')},'in',packageJSON);
 const html=await response.text(),match=/<script type="application\/json" id="transfer-package">([\s\S]*?)<\/script>/.exec(html);
 assert.equal(match?.[1],packageJSON);assert.equal(html.split('BODY').length,2);
});
