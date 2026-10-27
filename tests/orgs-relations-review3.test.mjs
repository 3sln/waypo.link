// Review round 3 (ORG-10f/g) regressions: the cold-key inbox only for recognized counterparts (R3-L1), stale import
// mirrors removed by the federation sync through the real runtime provider (R3-L2), guards that survived mutation
// (R3-L3), and the cursor-based counterpart key refresh with its 300 s cache bound (R3-L4). Local behaviour only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {relationsRuntime} from './orgs-relations-runtime.test.mjs';
import {accountHandle} from '../packages/runtime/routes/shared.mjs';
import {federationControllerOptions} from '../packages/runtime/federation.mjs';
import {importResourceId} from '../packages/runtime/account/relations.mjs';
import {FederationService,MemoryFederationStore} from '../packages/federation/index.mjs';
import {issueMemberAccess} from '../packages/federation/member-access.mjs';
import {principalKey} from '../packages/core/principals.mjs';
import {relationsHost,ISS,STORE} from './helpers/relations-world.mjs';
import {RELATION_EVENT} from '../packages/orgs/relation-edges.mjs';

const ORIGIN='https://relations-runtime.example';
/** A shares its first storage resource with B through `share`; both flushed. */
async function related(t,opts){
 const f=await relationsRuntime(t,opts),a=await f.person(),b=await f.person(),A=await f.organization(a,'ReviewA'),B=await f.organization(b,'ReviewB');
 const path=`/api/orgs/${A.id}/relations`,pin=(await a.call('GET',path+'/catalogue')).body.relations[0].pin;
 const instance=(await a.call('POST',path,{input:{operation:'create',relation:pin,slots:['owner']}})).body.instance;
 const resource=(await a.call('GET',path+'/resources')).body.resources[0].id;
 const invitation=(await a.call('POST',path,{input:{operation:'invite',instance,slot:'recipient',invitee:B.principal,values:{0:[{resource}]}}})).body.invitation;
 const disclosure=(await b.call('POST',`/api/orgs/${B.id}/relations`,{input:{operation:'inbound-preview',invitation}})).body.disclosure;
 await b.call('POST',`/api/orgs/${B.id}/relations`,{input:{operation:'accept',invitation,disclosure,receive:true}});
 await f.flush(A,B);
 return {f,a,b,A,B,instance,resource};
}
async function events(){return {...await import('../packages/orgs/relation-events.mjs')};}
async function rotatedSigner(A){
 const {mintCertificationKey}=await import('../packages/identity/transfer-in.mjs'),{encryptSecret,decryptSecret}=await import('../packages/runtime/secrets.mjs'),{certificationSigner}=await import('../packages/identity/member-certificates.mjs');
 const secret=A.controller.config.KEY_ENCRYPTION_KEY;await mintCertificationKey(A.controller.metadata,A.id,{seal:v=>encryptSecret(v,secret)});
 return certificationSigner({metadata:A.controller.metadata,seal:v=>encryptSecret(v,secret),open:v=>decryptSecret(v,secret)})(A.id);
}

test('R3-L1: only a recognized counterpart\'s cold-key event is buffered, at most 8 per sender; a flood cannot crowd out a genuine narrowing',async t=>{
 const {f,b,A,B,instance}=await related(t),{signRelationEvent,relationEventPayload}=await events(),inbox=async()=>(await B.controller.metadata.list({prefix:'rel/inbox/'})).size;
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const post=async(from,inst,i)=>f.http('/relations/events',{method:'POST',headers:{'Content-Type':'application/secevent+jwt'},body:await signRelationEvent(relationEventPayload({from,to:B.principal,instance:inst,aep:0,iat:Math.floor(Date.now()/1000),jti:crypto.randomUUID(),events:{[RELATION_EVENT.edgeEnded]:{half:'grant'}}}),{kid:'flood-'+i,privateKey:pair.privateKey})});
 // Unrecognized claimed senders, and a recognized sender naming an instance it is not part of: all 202, none kept.
 for(let i=0;i<70;i++)assert.equal((await post({iss:ORIGIN,sub:crypto.randomUUID()},instance,i)).status,202);
 assert.equal((await post(A.principal,`${ORIGIN}/relations/i/00000000-0000-4000-8000-000000000000`,99)).status,202);
 assert.equal(await inbox(),0,'nothing buffered for strangers');
 // The recognized counterpart itself (an attacker with any key claiming A): at most 8 rows.
 for(let i=0;i<20;i++)await post(A.principal,instance,100+i);
 assert.equal(await inbox(),8,'the per-sender cap');
 // A genuine rotated-key narrowing from A still lands: after the forged rows age out, A's real event is buffered and applied.
 await B.controller.metadata.transaction(async tx=>{for(const k of (await tx.list({prefix:'rel/inbox/'})).keys())await tx.delete(k);});
 const signer=await rotatedSigner(A),event=await signRelationEvent(relationEventPayload({from:A.principal,to:B.principal,instance,aep:0,iat:Math.floor(Date.now()/1000),jti:crypto.randomUUID().replaceAll('-',''),events:{[RELATION_EVENT.edgeState]:{half:'grant',generation:100,state:'suspended'}}}),signer);
 await B.controller.relationsPeer(B.id,{operation:'relations.ingest',input:{event}});assert.equal(await inbox(),1);
 await B.controller.relationsAlarm();
 assert.equal((await b.call('GET',`/api/orgs/${B.id}/relations/imports`)).body.imports[0].status,'unavailable');
});

test('R3-L1: request-path refresh rows of senders recognized nowhere are dropped by the background run without a fetch',async t=>{
 const {A,B}=await related(t),{enqueueMemberKeyRefresh,dueMemberKeyRefreshes}=await import('../packages/orgs/key-refresh.mjs');
 const strangers=Array.from({length:10},()=>crypto.randomUUID()),fetched=[],stub=B.controller.config.CONVERSATION_ACCOUNT;
 B.controller.config.CONVERSATION_ACCOUNT=sub=>{const s=stub(sub);return s&&{...s,invoke:async call=>{if(call.method==='relationsPublicKeys')fetched.push(sub);return s.invoke(call);}};};
 await B.controller.metadata.transaction(async tx=>{for(const sub of strangers)await enqueueMemberKeyRefresh(tx,{iss:ORIGIN,sub},{now:Date.now()-1000,source:'claimed'});await enqueueMemberKeyRefresh(tx,A.principal,{now:Date.now()-1000,source:'claimed'});});
 await B.controller.relationsAlarm();
 assert.deepEqual(fetched.filter(s=>strangers.includes(s)),[],'no fetch for a stranger');
 const left=(await B.controller.metadata.transaction(tx=>dueMemberKeyRefreshes(tx,Date.now()+3600000,100))).map(([,r])=>r.subject);
 assert.ok(strangers.every(s=>!left.includes(s)),'their rows are gone');assert.ok(fetched.includes(A.id),'the counterpart is still refreshed');
});

test('R3-L2: the federation sync through the real runtime provider adds import mirrors and removes stale ones',async t=>{
 const {f,B}=await related(t),subject=`${ORIGIN}/entities/${B.id}`,store=new MemoryFederationStore();
 const options=federationControllerOptions({config:B.controller.config,repository:f.repository,accounts:f.accounts,owner:B.id});
 const service=new FederationService({issuer:ORIGIN,store,resourceProvider:options.resourceProvider,relationImports:options.relationImports,clients:[],schemaHosts:['schema.example'],schemaFetcher:async()=>null,authenticateOwner:async()=>({subject})});
 const mirror=[...(await B.controller.metadata.list({prefix:'federation/resource/imp_'})).values()][0],id=importResourceId(ORIGIN,B.id,mirror.id);
 await service.syncResources(subject);
 assert.equal((await store.transaction(tx=>tx.get('federation/resource/'+id)))?.provider,'relation','the provider lists the mirror');
 // The writer no longer lists it (a pruned import): the next sync removes the stale relation row.
 await B.controller.metadata.delete('federation/resource/'+mirror.id);
 await service.syncResources(subject);
 assert.equal(await store.transaction(tx=>tx.get('federation/resource/'+id)),undefined,'the stale mirror is gone');
});

test('R3-L3: the join endpoint refuses any body member beyond {invitation, statement}, a `from` above all',async t=>{
 const {RELATION_FLAGS}=await import('./orgs-relations-runtime.test.mjs'),{f,A,B}=await related(t,{flags:{...RELATION_FLAGS,ORG_FOREIGN_RELATIONS_ENABLED:'true'}});
 const join=body=>B.controller.relationsJoin(B.id,body).then(()=>null,e=>e.code);
 for(const body of [{invitation:'x',statement:'y',from:A.principal},{invitation:'x',statement:'y',extra:1}])assert.equal(await join(body),'invitation_invalid');
 assert.ok(f);
});

test('R3-L3: a member-access token keeps the holder JWK only when its thumbprint is the token\'s jkt',async()=>{
 const {jwkThumbprint}=await import('../packages/identity/delegation.mjs'),routingKey='0e0e0e0e-0000-4000-8000-0000000000aa',subject=`${ORIGIN}/entities/${routingKey}`,store=new MemoryFederationStore(),clientId='https://app.example/client';
 const service=new FederationService({issuer:ORIGIN,store,routingKey,clients:[{id:clientId,name:'App',origin:'https://app.example',redirectUris:['https://app.example/cb']}],schemaHosts:['schema.example'],schemaFetcher:async()=>null,authenticateOwner:async()=>({subject})});
 await store.transaction(tx=>tx.set('federation/grant/g1',{id:'g1',active:true,subject,clientId,epoch:'e1'}));
 const key=async()=>{const p=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']);const {x,y}=await crypto.subtle.exportKey('jwk',p.publicKey);return {kty:'EC',crv:'P-256',x,y};};
 const mine=await key(),other=await key(),jkt=await jwkThumbprint(mine);
 const issue=jwk=>issueMemberAccess(service,{clientId,jkt,jwk,expiresAt:Date.now()+600000,epoch:'e1',connection:{id:'c',generation:1},member:{principal:{iss:ORIGIN,sub:'0a0a0a0a-0000-4000-8000-000000000001'},membership_id:'membership-0000000001',generation:1,aep:0,client:clientId}});
 await issue(other);await issue(mine);
 const tokens=(await store.transaction(tx=>tx.list('federation/token/'))).map(r=>r.value);
 assert.equal(tokens.length,2);assert.deepEqual(tokens.filter(t=>t.jwk).map(t=>t.jwk.x),[mine.x],'only the matching key is kept');
});

test('R3-L3: while relations are off, ingest drops widening events and still applies narrowing',async()=>{const h=await relationsHost({orgs:2});try{
 const [A,B]=h.list,r=await A.resource(`${ISS}/r/1/f`,{[STORE]:['get','list']}),{instance}=await h.relate(A,B,{give:{0:[{resource:r}]}});
 const gen=(await A.cp(instance,B)).grant.generation,entries=[{index:0,resources:[{resource:r,contracts:[STORE],methods:{[STORE]:['get']}}]}];
 const st=(g,state,e)=>({[RELATION_EVENT.edgeState]:{half:'grant',generation:g,state,...e?{entries:e}:{}}});
 h.flag.deny.set(B.id,new Set(['ORG_RELATIONS_ENABLED']));
 await h.ingest(B,A,h.event(A,B,instance,st(gen+1,'suspended')));assert.equal((await B.cp(instance,A)).peerGrant.state,'suspended','narrowing applies');
 await h.ingest(B,A,h.event(A,B,instance,st(gen+2,'live',entries)));assert.equal((await B.cp(instance,A)).peerGrant.state,'suspended','widening is dropped');
 h.flag.deny.clear();await h.ingest(B,A,h.event(A,B,instance,st(gen+3,'live',entries)));assert.equal((await B.cp(instance,A)).peerGrant.state,'live');
}finally{await h.close();}});

test('R3-L4: the counterpart key refresh resumes past the first 1,024 rel/cp rows, uses a 300 s cache and prunes rows nobody refreshes',async t=>{
 const {A,B,instance}=await related(t),pk=principalKey(A.principal),cacheKey='rel/keycache/'+pk;
 // 1,100 ended counterpart rows that sort before the real one; the real counterpart's cache row is missing.
 await B.controller.metadata.transaction(async tx=>{for(let i=0;i<1100;i++){const sub=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;await tx.put('rel/cp/'+encodeURIComponent(`${ORIGIN}/relations/i/0`)+'/'+principalKey({iss:ORIGIN,sub}),{instance:'x',principal:{iss:ORIGIN,sub},state:'ended'});}
  await tx.delete(cacheKey);});
 assert.ok(encodeURIComponent(`${ORIGIN}/relations/i/0`)<encodeURIComponent(instance));
 for(let i=0;i<3&&!await B.controller.metadata.get(cacheKey);i++)await B.controller.relationsAlarm();
 const row=await B.controller.metadata.get(cacheKey);assert.ok(row,'reached past the first page');assert.ok(row.until-Date.now()<=300000&&row.until-Date.now()>290000,'the 300 s bound');
 // A cache row nobody refreshes for a whole period is pruned.
 const stale={iss:ORIGIN,sub:crypto.randomUUID()};await B.controller.metadata.put('rel/keycache/'+principalKey(stale),{identity:'x',keys:[],until:Date.now()-300001});
 await B.controller.relationsAlarm();assert.equal(await B.controller.metadata.get('rel/keycache/'+principalKey(stale)),undefined);
 assert.ok(accountHandle);
});
