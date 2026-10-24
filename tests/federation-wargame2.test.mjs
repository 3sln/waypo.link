// Identity and federation wargame 2026-10-23 (provisional fixes; DEVLOG "Identity and federation wargame fixes").
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {serviceFixture,app,callback,pkce} from './federation-engine-helpers.mjs';
import {federationIncremental,handleIncrementalToken} from '../packages/runtime/incremental-authorization.mjs';
import {MemoryFederationStore} from '../packages/federation/index.mjs';
// Budgets (packages/federation/service.mjs OWNER_REQUESTS, ANONYMOUS_REQUESTS_PER_CALLER), literal so a revert still loads.
const OWNER_REQUESTS=32,ANONYMOUS_REQUESTS_PER_CALLER=8;
import {dpopKey} from './authorization-entry-helpers.mjs';
import {adminDeletionFixture,OWNER} from './helpers/admin-deletion.mjs';
import {federationEpoch} from '../packages/runtime/federation.mjs';

const anonymous=(service,caller)=>service.beginAuthorization({clientId:app,redirectUri:callback,challenge:pkce(randomUUID()+randomUUID()),challengeMethod:'S256',state:'x',requests:[]},caller?{caller}:{});

// #4: an anonymous request names its owner only by a public handle; it must not spend that owner's budget.
test('wargame #4: anonymous pending requests cannot exhaust the owner request bound',async()=>{
 const {service,connect,exchange}=await serviceFixture();
 // Attacker: no session, 32+ requests spread over many networks, routed into the victim's shard by handle.
 for(let i=0;i<OWNER_REQUESTS+8;i++)await anonymous(service,`attacker-network-${i}`);
 // Victim: a legitimate sign-in into a real app still completes.
 const code=await connect();assert.ok((await exchange(code)).access_token,'owner authorization completes');
});

test('wargame #4: anonymous requests are bounded per caller and client; the owner step moves them to the owner budget',async()=>{
 const {service}=await serviceFixture();
 for(let i=0;i<ANONYMOUS_REQUESTS_PER_CALLER;i++)await anonymous(service,'one-network');
 await assert.rejects(anonymous(service,'one-network'),{code:'rate_limited'},'per-caller bound');
 await anonymous(service,'another-network');
 // Owner-bound requests (bound at the owner step) keep their own budget of 32.
 const rows=async()=>(await service.store.transaction(tx=>tx.list('federation/request/'))).map(r=>r.value);
 const {requestId}=await anonymous(service,'owner-network');
 const {owner}=await import('./federation-engine-helpers.mjs');
 await service.inspect(requestId,owner);
 const bound=(await rows()).find(r=>r.requestId===requestId);assert.equal(bound.anonymous,undefined,'bound to the owner at the owner step');
 assert.ok((await rows()).filter(r=>r.anonymous).length>=ANONYMOUS_REQUESTS_PER_CALLER+1,'anonymous rows stay pre-owner');
});

// Review 2026-10-23 (provisional): the anonymous caller is a NETWORK (IPv6 /64, IPv4 /24), and one network is bounded
// across clients, so address rotation and client cycling buy nothing.
test('review: anonymous requests are bounded per network across clients (16), on top of 8 per network and client',async()=>{
 const {FederationService,MemoryFederationStore:Store}=await import('../packages/federation/index.mjs');
 const {webcrypto}=await import('node:crypto');
 const ids=['a','b','c'].map(n=>`https://app${n}.example/client`);
 const service=new FederationService({issuer:'https://provider.example',refreshEnabled:true,crypto:webcrypto,clock:()=>Date.now(),store:new Store(),clients:ids.map(id=>({id,name:'App',origin:new URL(id).origin,redirectUris:[new URL(id).origin+'/cb']})),schemaHosts:['schema.example'],schemaFetcher:async()=>{throw new Error('unused');},authenticateOwner:async()=>{throw new Error('unused');},dispatchCapability:async()=>({ok:true})});
 const begin=(clientId,caller)=>service.beginAuthorization({clientId,redirectUri:new URL(clientId).origin+'/cb',challenge:pkce(randomUUID()+randomUUID()),challengeMethod:'S256',state:'x',requests:[]},{caller});
 for(let i=0;i<8;i++)await begin(ids[0],'net-1');
 await assert.rejects(begin(ids[0],'net-1'),{code:'rate_limited'},'per network and client');
 for(let i=0;i<8;i++)await begin(ids[1],'net-1');
 await assert.rejects(begin(ids[2],'net-1'),{code:'rate_limited'},'per network across clients');
 await begin(ids[2],'net-2');
});

test('re-verification: 64 anonymous requests per allocation (IPv6 /48) across its networks and clients',async()=>{
 const {FederationService,MemoryFederationStore:Store}=await import('../packages/federation/index.mjs');
 const {webcrypto}=await import('node:crypto');
 const ids=['a','b','c','d','e','f','g','h','i','j'].map(n=>`https://app${n}.example/client`);
 const service=new FederationService({issuer:'https://provider.example',refreshEnabled:true,crypto:webcrypto,clock:()=>Date.now(),store:new Store(),clients:ids.map(id=>({id,name:'App',origin:new URL(id).origin,redirectUris:[new URL(id).origin+'/cb']})),schemaHosts:['schema.example'],schemaFetcher:async()=>{throw new Error('unused');},authenticateOwner:async()=>{throw new Error('unused');},dispatch:async()=>{}});
 const begin=(clientId,caller)=>service.beginAuthorization({clientId,redirectUri:new URL(clientId).origin+'/cb',challenge:pkce(randomUUID()+randomUUID()),challengeMethod:'S256',state:'x',requests:[]},{caller});
 // Four /64 networks inside one /48, 16 each (8 per client): the allocation is full at 64.
 for(let n=0;n<4;n++)for(let c=0;c<2;c++)for(let i=0;i<8;i++)await begin(ids[c],`net-${n}.alloc-1`);
 await assert.rejects(begin(ids[5],'net-9.alloc-1'),{code:'rate_limited'},'a fresh /64 in the same /48 is refused');
 await begin(ids[5],'net-9.alloc-2');
});

test('re-verification: IPv4-mapped IPv6 callers map to their IPv4 /24, not one shared bucket',async()=>{
 const {subnet64,subnet}=await import('../packages/runtime/routes/shared.mjs');
 assert.equal(subnet64('::ffff:198.51.100.7'),subnet('198.51.100.7'));assert.notEqual(subnet64('::ffff:198.51.100.7'),subnet64('::ffff:203.0.113.7'));
});

test('review: the route keys anonymous callers on the /64 (IPv6) or /24 (IPv4) network pseudonym',async()=>{
 const {stages}=await import('../packages/runtime/routes/federation.mjs'),{subnet64,subnet}=await import('../packages/runtime/routes/shared.mjs');
 assert.equal(subnet64('2001:db8:1:2:aaaa::1'),'2001:db8:1:2::/64');assert.equal(subnet64('198.51.100.7'),subnet('198.51.100.7'));assert.equal(subnet('2001:db8:1:2::1'),'2001:db8:1::/48','other callers keep /48');
 const captured=[],client={id:'https://app.example/client',name:'App',origin:'https://app.example',redirectUris:['https://app.example/cb']};
 const env={APP_ORIGIN:'https://3sln.example',ABUSE_HASH_KEY:'k'.repeat(32),ABUSE:{consume:async()=>true},FEDERATION_ENABLED:'true',FEDERATION_AUTHORITY:{clients:[client],ready:async()=>true,beginAuthorization:async(input,options)=>{captured.push(options?.caller);return {requestId:randomUUID(),view:{}};}}};
 const post=ip=>{const request=new Request('https://3sln.example/api/oauth/requests',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://app.example','CF-Connecting-IP':ip},body:JSON.stringify({identity:'alice@other.example',clientId:client.id,redirectUri:'https://app.example/cb',challenge:'A'.repeat(43),challengeMethod:'S256',state:'s',requests:[]})});return stages.public({request,env,path:'/api/oauth/requests',local:false,url:new URL(request.url)});};
 for(const ip of ['2001:db8:1:2:aaaa::1','2001:db8:1:2:bbbb:cccc::9','2001:db8:1:3::1','198.51.100.7','198.51.100.200'])assert.equal((await post(ip)).status,201);
 assert.equal(captured.length,5);assert.equal(captured[0],captured[1],'one /64');assert.notEqual(captured[0],captured[2],'another /64');assert.equal(captured[3],captured[4],'one /24');
});

// #5: proofs with never-issued codes must not exhaust a global table before any code check.
test('wargame #5: anonymous DPoP proofs with junk codes cannot exhaust incremental proof storage',async()=>{
 const issuer='https://provider.example',config={APP_ORIGIN:issuer,KEY_ENCRYPTION_KEY:'k'.repeat(32),DPOP_NONCE_KEY:'n'.repeat(32),FEDERATION_CLIENTS:[]};
 const store=new MemoryFederationStore(),inc=federationIncremental({config,store,shard:()=>{throw new Error('unused');},provision:true});
 let exchanged=0;const port={mounted:true,exchange:async()=>{exchanged++;throw Object.assign(new Error('bad'),{code:'invalid_grant'});}};
 const proofs={verify:p=>inc.tokenProof(p),nonce:()=>inc.tokenNonce()};
 const post=async(key,code)=>{const nonce=await inc.tokenNonce(),dpop=await key.sign({htu:`${issuer}/oauth/token`,nonce});
  return handleIncrementalToken(new Request(`${issuer}/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',DPoP:dpop},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:'https://app.example/client',redirect_uri:'https://app.example/cb',code_verifier:'v'.repeat(43)})}),{port,issuer,proofs});};
 const attacker=await dpopKey();
 for(let i=0;i<512;i++)await post(attacker,'ia1.'+'A'.repeat(42)+String.fromCharCode(65+(i%26)));
 assert.equal((await store.transaction(tx=>tx.list('incremental-dpop/'))).length,0,'verification alone records nothing');
 const victim=await dpopKey(),before=exchanged,body=await(await post(victim,'ia1.'+'B'.repeat(43))).json();
 assert.notEqual(body.error,'invalid_dpop_proof',`legit proof refused: ${JSON.stringify(body)}`);assert.equal(exchanged,before+1,'the code check is reached');
});

// RFC 9700 §4.5 / RFC 6749 §4.1.2: a replayed authorization code revokes what its first redemption issued.
test('wargame: authorization code replay revokes the client session issued by the first redemption',async()=>{
 const {connect,exchange,refresh,alive}=await serviceFixture();
 const code=await connect(),tokens=await exchange(code);assert.ok(await alive(tokens.access_token));
 await assert.rejects(exchange(code),{code:'invalid_grant'});
 assert.equal(await alive(tokens.access_token),false,'the first access token is revoked');
 await assert.rejects(refresh(tokens.refresh_token),{code:'invalid_grant'});
 // A fresh connection is unaffected.
 const other=await exchange(await connect());assert.ok(await alive(other.access_token));
});
test('wargame: without refresh, code replay revokes the lone access token',async()=>{
 const {connect,exchange,alive}=await serviceFixture({refreshEnabled:false});
 const code=await connect(),tokens=await exchange(code);assert.equal(tokens.refresh_token,undefined);assert.ok(await alive(tokens.access_token));
 await assert.rejects(exchange(code),{code:'invalid_grant'});assert.equal(await alive(tokens.access_token),false);
});

// Reopened accounts: ordinary OAuth families stay revoked after suspend → reactivate and close → reopen, even when
// connection severance did not run (federationEpoch moves in the suspension CAS).
test('wargame: suspension then reactivation never revives ordinary OAuth families (federation epoch moves)',async()=>{
 const f=await adminDeletionFixture();try{
  const before=await federationEpoch(await f.repository.get(OWNER));
  await f.admin.suspend({owner:OWNER},f.context);await f.admin.reactivate({owner:OWNER},f.context);
  const after=await f.repository.get(OWNER);assert.equal(after.status,'active');
  assert.notEqual(await federationEpoch(after),before,'families minted before suspension must not validate after reactivation');
 }finally{await f.close();}
});
test('wargame: closure then reopen never revives ordinary OAuth families (federation epoch moves)',async()=>{
 const f=await adminDeletionFixture();try{
  const approved=async patch=>({...await f.input(patch),...await f.assertion()});
  const before=await federationEpoch(await f.repository.get(OWNER));
  await f.run('close',await approved({reason:'Closure following an operator review.'}));
  const out=await f.run('reopen',await approved({reason:'Appeal accepted by the operator.'}));assert.equal(out.user.status,'active');
  assert.notEqual(await federationEpoch(await f.repository.get(OWNER)),before);
 }finally{await f.close();}
});
