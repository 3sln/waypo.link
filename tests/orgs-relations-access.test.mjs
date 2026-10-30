// ORG-10d entity certificates at the engine level (packages/identity/entity-certificates.mjs, packages/orgs/relation-
// access.mjs; spec §9.5, §10; design §8b.3, RL-4, RL-16) and the federation relay projection hunk. Issuance at the
// grantee after its own hops (member ∩ application connection ∩ edge), verification at the grantor through the edge
// decision, uniform failures, no fetch on the request path. Local behaviour only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {relationsHost,rejects,fault,ISS,STORE,LEDGER} from './helpers/relations-world.mjs';
import {principalKey} from '../packages/core/principals.mjs';
import {encodeEntityCertificate,parseEntityCertificate,ENTITY_PURPOSE,ENTITY_CERTIFICATE_TYP} from '../packages/identity/entity-certificates.mjs';
import {federationRelationImports} from '../packages/orgs/relation-access.mjs';
import {jwkThumbprint} from '../packages/identity/delegation.mjs';
import {digest,base64url} from '../packages/core/records.mjs';
import {FederationService,MemoryFederationStore} from '../packages/federation/index.mjs';
import {PREFERENCES_V2} from '../packages/federation/service.mjs';

const ALL={[STORE]:['get','list','put','delete','presign'],[LEDGER]:['get','list']};
const CLIENT='https://app.example/client',APP_ORIGIN='https://app.example',RPC=`${ISS}/bindle/rpc`;
const te=new TextEncoder();
async function holder(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);return {privateKey:pair.privateKey,jwk:{kty:'EC',crv:'P-256',x,y}};}
/** An RFC 9449 proof by `key` for (htm, htu), with `ath` = SHA-256 of `bound` when given. */
async function dpop(key,{htm='POST',htu=RPC,bound,iat=Math.floor(Date.now()/1000),jti=randomUUID().replaceAll('-','')}={}){
 const enc=v=>base64url(te.encode(JSON.stringify(v)));const head=`${enc({typ:'dpop+jwt',alg:'ES256',jwk:key.jwk})}.${enc({jti,htm,htu,iat,...bound?{ath:await digest(crypto,bound)}:{}})}`;
 return `${head}.${base64url(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,te.encode(head))))}`;}

/** A (grantor) shares `rA` with B (grantee) through `share`; B's member holds a grant on the import and an application
 * connection `g1` approves it for field `store`. */
async function world({scope,methods={[STORE]:['get','put']},memberMethods={[STORE]:['get','list','put']}}={}){
 const h=await relationsHost({orgs:3}),[A,B,C]=h.list;
 const rA=await A.resource(`${ISS}/r/1/files`,ALL);if(scope)await A.metadata.put('federation/resource/'+rA,{...await A.get('federation/resource/'+rA),scoping:{fields:{prefix:{maxLength:200},readOnly:{},maxObjectBytes:{maximum:1e6}}}});
 const {instance}=await h.relate(A,B,{give:{0:[{resource:rA,...scope?{scope}:{}}]}});
 const imp=(await B.imports())[0].resources[0].id,mk=principalKey({iss:ISS,sub:B.member}),m=await B.get('org/member/'+mk);
 await B.run('orgs.member-grants',null,{membership:m.id,grants:[{resource:imp,methods:memberMethods}]});
 h.connections.set('c1',{generation:1,clientId:CLIENT});
 await B.metadata.put('federation/grant/g1',{id:'g1',active:true,clientId:CLIENT,connection:{id:'c1',generation:1},fields:['store'],methods:{store:methods},resources:{store:[imp]}});
 const key=await holder(),member=async()=>{const row=await B.get('org/member/'+mk);return {principal:{iss:ISS,sub:B.member},membership_id:row.id,generation:row.generation};};
 const certify=async(extra={})=>B.system('relations.certify',{client:{client_id:CLIENT,origin:APP_ORIGIN},grants:['g1'],field:'store',resource:imp,delegate:key.jwk,member:await member(),...extra});
 const call=async(certificate,{method='get',args={key:'a/b'},resource=rA,contract=STORE,form='direct',k=key,proof}={})=>A.system('relations.authorize',{form,certificate,proof:proof??await dpop(k,{iat:Math.floor(h.clock.now()/1000),...form==='direct'?{bound:certificate}:{}}),htm:'POST',htu:RPC,envelope:{resource,contract,method,args,tx:randomUUID()}});
 return {h,A,B,C,rA,imp,instance,key,certify,call,member};
}
const refusedDirect=async p=>{const f=await fault(p);assert.deepEqual([f?.code,f?.status,f?.message],['invalid_token',401,'invalid_token']);};

test('certify → authorize: member ∩ application ∩ edge; the certificate binds the edge, instance, resource and holder',async()=>{const w=await world();try{
 const out=await w.certify();assert.deepEqual(out.methods,{[STORE]:['get','put']},'member {get,list,put} ∩ application {get,put} ∩ edge');
 const c=parseEntityCertificate(out.certificate).payload;
 assert.equal(c.iss,ISS);assert.equal(c.sub,w.B.id);assert.equal(c.aud,`${ISS}/identity/${w.A.id}`);assert.equal(c.instance,w.instance);assert.deepEqual(c.purposes,[ENTITY_PURPOSE]);
 assert.equal(c.resource,w.rA,'the grantor\'s resource ID behind the import');assert.equal(c.exp-c.iat,300,'RL-16');assert.match(c.actor.member,/^pw_/,'pairwise by default');assert.equal(c.actor.client,CLIENT);
 assert.equal(JSON.stringify(c).includes(w.B.member),false,'the member identity never leaves under pairwise disclosure');
 assert.equal(out.broker.endpoint,RPC);assert.equal(out.broker.resource,w.rA);
 const ok=await w.call(out.certificate);assert.equal(ok.allowed,true);assert.deepEqual(ok.context.grantee,w.B.principal);assert.equal(ok.context.journal.client_id,CLIENT);
 assert.equal((await w.call(out.certificate,{method:'put',args:{key:'a/b',data:new Uint8Array([0])}})).allowed,true,'a fresh certificate may write');
 // The token form: the same checks, `invalid_grant` on failure.
 assert.equal((await w.call(out.certificate,{form:'token'})).allowed,true);
 const tf=await fault(w.call('garbage',{form:'token'}));assert.deepEqual([tf.code,tf.status],['invalid_grant',400]);
}finally{await w.h.close();}});

test('certificate scope: the envelope must match its resource and methods, and stay within the edge in its instance',async()=>{const w=await world({methods:{[STORE]:['get']}});try{
 const {certificate}=await w.certify();
 await refusedDirect(w.call(certificate,{method:'put'}));// outside the certificate (application ceiling get only)
 await refusedDirect(w.call(certificate,{method:'list'}));
 const other=await w.A.resource(`${ISS}/r/1/other`,ALL);await refusedDirect(w.call(certificate,{resource:other}));// another resource on the same edge
 // An edge in another instance between the same two organizations never applies (spec §9.5, R3-H1).
 const second=await w.h.relate(w.A,w.B,{give:{0:[{resource:other}]}});assert.equal(await w.A.check(second.instance,w.B,other,STORE,'get'),true);
 await refusedDirect(w.call(certificate,{resource:other}));
 // A third entity's certificate for A's resource: no edge from A to it, refused (no transitivity).
 const c=w.C,cc=await c.system('relations.certify',{client:{client_id:CLIENT,origin:APP_ORIGIN},grants:['g1'],field:'store',resource:'imp_'+'x'.repeat(32),delegate:w.key.jwk}).catch(e=>e);assert.equal(cc.code,'relation_certificate_unavailable');
 const forged=await encodeEntityCertificate({...parseEntityCertificate(certificate).payload,sub:c.id,identity:`${ISS}/identity/${c.id}`},await w.h.certs.get(c.id));
 await refusedDirect(w.call(forged));
}finally{await w.h.close();}});

test('expiry, the 300 s cap, the write age rule, the holder proof and replay',async()=>{const w=await world();try{
 const {certificate}=await w.certify();
 w.h.clock.advance(61000);
 assert.equal((await w.call(certificate)).allowed,true,'reads within the lifetime');
 await refusedDirect(w.call(certificate,{method:'put',args:{key:'a/b',data:new Uint8Array([0])}}));// write: now − iat > 60 s
 w.h.clock.advance(300000);await refusedDirect(w.call(certificate));// past exp + 60 s skew
 // A certificate claiming a longer lifetime is capped at iat + 300 s by the verifier.
 const now=Math.floor(w.h.clock.now()/1000),p=parseEntityCertificate((await w.certify()).certificate).payload;
 const long=await encodeEntityCertificate({...p,iat:now-400,exp:now+3600,jti:'L'.repeat(24)},await w.h.certs.get(w.B.id));
 await refusedDirect(w.call(long));
 // Signed with the identity signing key instead of the certification key (R4-H1): refused.
 const k=w.h.keys.get(w.B.id),wrong=await encodeEntityCertificate({...p,jti:'W'.repeat(24)},{kid:k.kid,privateKey:k.privateKey});await refusedDirect(w.call(wrong));
 // The proof: another key, a missing ath, a replay.
 const fresh=(await w.certify()).certificate,other=await holder();
 await refusedDirect(w.call(fresh,{k:other}));
 await refusedDirect(w.call(fresh,{proof:await dpop(w.key,{iat:Math.floor(w.h.clock.now()/1000)})}));
 const proof=await dpop(w.key,{iat:Math.floor(w.h.clock.now()/1000),bound:fresh});assert.equal((await w.call(fresh,{proof})).allowed,true);await refusedDirect(w.call(fresh,{proof}));
 // Every refusal above had the same code, status and body; garbage too.
 await refusedDirect(w.call('x.y.z'));await refusedDirect(w.A.system('relations.authorize',{}));
}finally{await w.h.close();}});

test('issuance hops: membership generation, connection-generation fence, application grant, live import, pairwise or named',async()=>{const w=await world();try{
 const m=await w.member();
 await rejects(w.certify({member:{...m,generation:m.generation+1}}),'relation_certificate_unavailable','a stale membership generation');
 await rejects(w.certify({member:{...m,membership_id:'membership-zzzzzzzz'}}),'relation_certificate_unavailable');
 await rejects(w.certify({connection:{id:'c1',generation:2}}),'relation_certificate_unavailable','the token\'s connection is not the grant\'s');
 w.h.connections.set('c1',{generation:2,clientId:CLIENT});await rejects(w.certify(),'relation_certificate_unavailable','the connection was re-established since the approval');
 w.h.connections.set('c1',{generation:1,clientId:CLIENT});
 await rejects(w.certify({client:{client_id:'https://other.example/client',origin:'https://other.example'}}),'relation_certificate_unavailable','another client');
 await rejects(w.certify({field:'other'}),'relation_certificate_unavailable');
 // Organization context (no member): application ceiling ∩ edge, no member in the actor.
 const org=await w.certify({member:undefined});assert.deepEqual(org.methods,{[STORE]:['get','put']});assert.equal(parseEntityCertificate(org.certificate).payload.actor.member,undefined);
 // The member loses the grant: refused at once.
 await w.B.run('orgs.member-grants',null,{membership:m.membership_id,grants:[]});await rejects(w.certify({member:await w.member()}),'relation_certificate_unavailable');
}finally{await w.h.close();}});

test('imports are reachable only through a live edge; narrowing stops the next call whatever the certificate says',async()=>{const w=await world();try{
 const {certificate}=await w.certify();assert.equal((await w.call(certificate)).allowed,true);
 await w.A.run('relations.suspend',null,{instance:w.instance,counterpart:w.B.principal});
 await refusedDirect(w.call(certificate));// immediate at the grantor, before any event
 await w.h.drain();await rejects(w.certify(),'relation_certificate_unavailable','the grantee stops certifying once it learns');
 await w.A.run('relations.resume',null,{instance:w.instance,counterpart:w.B.principal});await w.h.drain();
 const again=(await w.certify()).certificate;assert.equal((await w.call(again)).allowed,true);
 // The grantee ends its acceptance half: it stops certifying at once, and the grantor refuses once told.
 await w.B.run('relations.end',null,{instance:w.instance,counterpart:w.A.principal,direction:'incoming'});
 await rejects(w.certify(),'relation_certificate_unavailable');await w.h.drain();await refusedDirect(w.call(again));
}finally{await w.h.close();}});

test('aep floor and RL-4: a lower aep fails; a higher aep is held before refusing; only a bound confirmation releases',async()=>{const w=await world();try{
 const {certificate}=await w.certify();assert.equal((await w.call(certificate)).allowed,true);
 const rec=await w.B.get('org/record-v1');await w.B.metadata.put('org/record-v1',{...rec,aep:2});
 const higher=(await w.certify()).certificate;assert.equal(parseEntityCertificate(higher).payload.aep,2);
 await refusedDirect(w.call(higher));const hold=await w.A.get('rel/hold/'+principalKey(w.B.principal));assert.deepEqual([hold.kind,hold.aep],['full',2]);
 await refusedDirect(w.call((await w.certify()).certificate));// still held
 await refusedDirect(w.call(certificate));// aep 0 is now below the floor
 await rejects(w.A.run('relations.confirm-counterpart',null,{counterpart:w.B.principal,aep:1}),'relation_hold_changed');
 await w.A.run('relations.confirm-counterpart',null,{counterpart:w.B.principal,aep:2});
 assert.equal((await w.call((await w.certify()).certificate)).allowed,true);
 // A later reset needs a new confirmation (C8).
 await w.B.metadata.put('org/record-v1',{...rec,aep:3});await refusedDirect(w.call((await w.certify()).certificate));assert.equal((await w.A.get('rel/hold/'+principalKey(w.B.principal))).aep,3);
}finally{await w.h.close();}});

test('no fetch during verification: cache-only keys, a refresh scheduled only for a counterpart (review R3-L1), the same answer for anyone',async()=>{const w=await world();try{
 const {certificate}=await w.certify(),count=w.h.counts.resolve;
 assert.equal((await w.call(certificate)).allowed,true);assert.equal(w.h.counts.resolve,count,'a valid call resolves nothing');
 await w.h.refreshKeys();// the background run empties the queue first
 const refreshRows=async()=>(await w.A.list('org/cert/refresh/')).size,base=await refreshRows();assert.equal(base,0);
 w.h.coldKey(w.B.id);await refusedDirect(w.call((await w.certify()).certificate));assert.equal(w.h.counts.resolve,count,'a missing key fetches nothing');
 assert.equal(await refreshRows(),base+1,'and schedules one background refresh');
 // Review R3-L1: a non-counterpart's claim with a missing key schedules nothing (provisional deviation from §9.9 step 3).
 w.h.coldKey(w.C.id);const p=parseEntityCertificate(certificate).payload,cforged=await encodeEntityCertificate({...p,sub:w.C.id,identity:`${ISS}/identity/${w.C.id}`,jti:'C'.repeat(24)},await w.h.certs.get(w.C.id));
 await refusedDirect(w.call(cforged));assert.equal(await refreshRows(),base+1);assert.equal(w.h.counts.resolve,count);
 await w.h.refreshKeys();assert.equal((await w.call((await w.certify()).certificate)).allowed,true,'after the background refresh');
}finally{await w.h.close();}});

test('resource scope on a relation grant: enforced by the grantor, carried in the certificate, validated at grant time',async()=>{const w=await world({scope:{prefix:'ledgers/2026',readOnly:true},methods:{[STORE]:['get','list','put']}});try{
 const out=await w.certify();assert.deepEqual(parseEntityCertificate(out.certificate).payload.scope,{prefix:'ledgers/2026',readOnly:true});
 assert.equal((await w.call(out.certificate,{args:{key:'ledgers/2026/jan'}})).allowed,true);
 assert.equal((await w.call(out.certificate,{args:{key:'ledgers/2026'}})).allowed,true);
 await refusedDirect(w.call(out.certificate,{args:{key:'ledgers/2025/jan'}}));
 await refusedDirect(w.call(out.certificate,{args:{key:'ledgers/2026x'}}));
 await refusedDirect(w.call(out.certificate,{args:{key:'ledgers/2026/../2025'}}));
 await refusedDirect(w.call(out.certificate,{args:{}}));// no key: refused under a prefix
 await refusedDirect(w.call(out.certificate,{method:'put',args:{key:'ledgers/2026/x',data:new Uint8Array([0])}}));// read-only
 assert.equal((await w.A.check(w.instance,w.B,w.rA,STORE,'put')),false,'read-only refuses write-capable methods at the edge too');
 // Grant time: a scope the resource does not offer, or a malformed one, is refused.
 const plain=await w.A.resource(`${ISS}/r/1/plain`,ALL),inst=(await w.A.run('relations.create',null,{relation:w.h.pins.share[0],slots:['owner']})).instance;
 await rejects(w.A.run('relations.invite',null,{instance:inst,slot:'recipient',invitee:w.C.principal,values:{0:[{resource:plain,scope:{prefix:'a'}}]}}),'relation_values_invalid','no scoping offered');
 await rejects(w.A.run('relations.invite',null,{instance:inst,slot:'recipient',invitee:w.C.principal,values:{0:[{resource:w.rA,scope:{prefix:'../x'}}]}}),'relation_values_invalid','malformed prefix');
 await rejects(w.A.run('relations.invite',null,{instance:inst,slot:'recipient',invitee:w.C.principal,values:{0:[{resource:w.rA,scope:{readOnly:false}}]}}),'relation_values_invalid');
}finally{await w.h.close();}});

test('federation projection hunk: an imported resource in relay form with an entity certificate; never dispatched locally',async()=>{const w=await world();try{
 const subject=w.B.id,fragment='https://schema.example/files/v1',store=new MemoryFederationStore();
 const schema={id:fragment,title:'Files',description:'Files',publisher:'https://schema.example',fields:{store:{title:'Files',type:'resource',cardinality:{min:0,max:4},contracts:[STORE]}}};
 const relationImports=federationRelationImports({certify:input=>w.B.system('relations.certify',input),clientOrigin:id=>id===CLIENT?APP_ORIGIN:null});
 const service=new FederationService({issuer:ISS,clock:()=>w.h.clock.now(),store,relationImports,clients:[{id:CLIENT,name:'App',origin:APP_ORIGIN,redirectUris:[APP_ORIGIN+'/callback']}],schemaHosts:['schema.example'],schemaFetcher:async()=>schema,authenticateOwner:async()=>({subject}),dispatchCapability:async()=>{throw new Error('never dispatched');}});
 // In the runtime the organization's account store holds both records; here the mirror and grant are copied across.
 const mirror=await w.B.get('federation/resource/'+w.imp);assert.equal(mirror.provider,'relation');assert.equal(mirror.imported,true);assert.equal(mirror.available,true);
 const token='t'.repeat(43),hash=await digest(crypto,'token\0'+token),grant=await w.B.get('federation/grant/g1');
 await store.transaction(async tx=>{await tx.set('federation/resource/'+w.imp,mirror);await tx.set('federation/schema/'+fragment,{schema,digest:'d'});
  await tx.set('federation/preferences/'+subject+'|'+fragment,{fragment,digest:'d',values:{store:[w.imp]},revision:'r'.repeat(43),resourceRevisions:{store:'s'.repeat(43)}});
  await tx.set('federation/grant/g1',{...grant,subject,fragment,digest:'d',epoch:1,fields:['store']});
  await tx.set('federation/token/'+hash,{issuer:ISS,audience:RPC,subject,epoch:1,clientId:CLIENT,grants:['g1'],connection:{id:'c1',generation:1},expiresAt:w.h.clock.now()+600000,jkt:await jwkThumbprint(w.key.jwk),jwk:w.key.jwk});});
 const read=()=>service.rpc(token,{version:'0',tx:randomUUID(),resource:'@preferences',contract:PREFERENCES_V2,method:'read',args:{fragment}});
 const [entry]=(await read()).result.values.store;
 assert.equal(entry.status,'available');assert.equal(entry.token_type,'BindleEntity');assert.equal(entry.grantor,`${ISS}/identity/${w.A.id}`);assert.equal(entry.instance,w.instance);
 assert.deepEqual(entry.broker,{endpoint:RPC,origin:ISS,resource:w.rA});assert.notEqual(entry.id,w.imp,'a grantee-scoped reference, not the import id');
 assert.deepEqual(parseEntityCertificate(entry.token).payload.methods,{[STORE]:['get','put']},'organization context: application ∩ edge');
 assert.equal((await w.call(entry.token)).allowed,true,'the relay token works at the grantor');
 // Local dispatch of an imported mirror is refused (calls go to the grantor's broker endpoint).
 await assert.rejects(service.rpc(token,{version:'0',tx:randomUUID(),resource:w.imp,contract:STORE,method:'get',args:{key:'a'}}),{code:'forbidden'});
 // A refused certification (the connection fence) reports the member unavailable, with no token and no reason.
 w.h.connections.set('c1',{generation:2,clientId:CLIENT});const [held]=(await read()).result.values.store;assert.equal(held.status,'unavailable');assert.equal(held.token,undefined);assert.equal(held.broker,undefined);
}finally{await w.h.close();}});

// ---- review round 2 (ORG-10d/e independent review; implemented locally, provisional) --------------------------------
test('review M2: a federation resource sync keeps the import mirrors its provider does not return',async()=>{const w=await world();try{
 const subject=w.B.id,store=new MemoryFederationStore(),mirror=await w.B.get('federation/resource/'+w.imp);
 const own={id:`${ISS}/r/2/own`,label:'Own',contracts:{[STORE]:['get']}};
 const service=new FederationService({issuer:ISS,clock:()=>w.h.clock.now(),store,resourceProvider:async()=>[own],clients:[],schemaHosts:['schema.example'],schemaFetcher:async()=>null,authenticateOwner:async()=>({subject})});
 await store.transaction(tx=>tx.set('federation/resource/'+w.imp,{...mirror,owner:subject}));
 await service.syncResources(subject);
 const after=await store.transaction(tx=>tx.get('federation/resource/'+w.imp));assert.equal(after?.provider,'relation','the mirror survives the sync');
 assert.ok(await store.transaction(tx=>tx.get('federation/resource/'+own.id)));
}finally{await w.h.close();}});

test('review L3: the call runs under edge ∩ certificate scope (storage assignedScope semantics, for the ORG-10f dispatch)',async()=>{
 const {composeRelationScope}=await import('../packages/orgs/relation-edges.mjs');
 assert.deepEqual(composeRelationScope({prefix:'a',maxObjectBytes:10},{prefix:'a/b',readOnly:true,maxObjectBytes:5}),{prefix:'a/b',readOnly:true,maxObjectBytes:5});
 assert.equal(composeRelationScope({prefix:'a'},{prefix:'b'}),null);assert.deepEqual(composeRelationScope(undefined,undefined),{});
 const w=await world({scope:{maxObjectBytes:100},methods:{[STORE]:['get']}});try{
  const out=await w.certify(),ok=await w.call(out.certificate,{args:{key:'x'}});assert.equal(ok.allowed,true);
  assert.deepEqual(ok.context.assignedScope,{maxObjectBytes:100},'the storage adapter refuses an oversized get with it');
 }finally{await w.h.close();}
});

test('review L4: a throw inside the edge decision is the uniform failure',async()=>{const w=await world();try{
 const {certificate}=await w.certify();w.A.relations.edgeDecision=async()=>{throw new TypeError('boom');};
 await refusedDirect(w.call(certificate));const tf=await fault(w.call(certificate,{form:'token'}));assert.deepEqual([tf.code,tf.status,tf.message],['invalid_grant',400,'invalid_grant']);
}finally{await w.h.close();}});

test('review L6: while the grantor is fully held, only read methods are certified',async()=>{const w=await world();try{
 await w.B.system('relations.observe-counterpart',{counterpart:w.A.principal,keyReset:true});
 assert.deepEqual((await w.certify()).methods,{[STORE]:['get']},'put is write-capable');
 await w.B.metadata.put('federation/grant/g1',{...await w.B.get('federation/grant/g1'),methods:{store:{[STORE]:['put']}}});
 await rejects(w.certify(),'relation_certificate_unavailable','nothing readable is left');
}finally{await w.h.close();}});

test('review test gaps: wrong aud, the pre-purge fence in authorize and certify, a lower aep while not held',async()=>{const w=await world();try{
 const {certificate}=await w.certify(),p=parseEntityCertificate(certificate).payload;
 const wrongAud=await encodeEntityCertificate({...p,aud:`${ISS}/identity/${w.C.id}`,jti:'A'.repeat(24)},await w.h.certs.get(w.B.id));await refusedDirect(w.call(wrongAud));
 // A lower aep than the recorded floor fails even with no hold (the floor alone).
 await w.A.metadata.put('rel/aep/'+principalKey(w.B.principal),{aep:2,at:0,baseline:true});await refusedDirect(w.call((await w.certify()).certificate));
 assert.equal(await w.A.get('rel/hold/'+principalKey(w.B.principal)),undefined,'no hold involved');
 await w.A.metadata.put('rel/aep/'+principalKey(w.B.principal),{aep:0,at:0,baseline:true});const fresh=(await w.certify()).certificate;assert.equal((await w.call(fresh)).allowed,true);
 // The pre-purge step has begun but this edge was not left yet: the grantor refuses, the grantee stops certifying.
 await w.A.metadata.put('rel/closing',{at:w.h.clock.now(),cursor:null});await refusedDirect(w.call((await w.certify()).certificate));await w.A.metadata.transaction(tx=>tx.delete('rel/closing'));
 await w.B.metadata.put('rel/closing',{at:w.h.clock.now(),cursor:null});await rejects(w.certify(),'relation_certificate_unavailable');
}finally{await w.h.close();}});

test('review test gap: without the relation port an imported mirror is projected unavailable, with no token (preferences/v1 dropped)',async()=>{const w=await world();try{
 const {PREFERENCES}=await import('../packages/federation/service.mjs');
 const subject=w.B.id,fragment='https://schema.example/files/v1',store=new MemoryFederationStore();
 const schema={id:fragment,title:'Files',description:'Files',publisher:'https://schema.example',fields:{store:{title:'Files',type:'resource',cardinality:{min:0,max:4},contracts:[STORE]}}};
 const service=new FederationService({issuer:ISS,clock:()=>w.h.clock.now(),store,clients:[{id:CLIENT,name:'App',origin:APP_ORIGIN,redirectUris:[APP_ORIGIN+'/callback']}],schemaHosts:['schema.example'],schemaFetcher:async()=>schema,authenticateOwner:async()=>({subject}),dispatchCapability:async()=>{throw new Error('never');}});
 const token='v'.repeat(43),hash=await digest(crypto,'token\0'+token),grant=await w.B.get('federation/grant/g1');
 await store.transaction(async tx=>{await tx.set('federation/resource/'+w.imp,await w.B.get('federation/resource/'+w.imp));await tx.set('federation/schema/'+fragment,{schema,digest:'d'});
  await tx.set('federation/preferences/'+subject+'|'+fragment,{fragment,digest:'d',values:{store:[w.imp]},revision:'r'.repeat(43),resourceRevisions:{store:'s'.repeat(43)}});
  await tx.set('federation/grant/g1',{...grant,subject,fragment,digest:'d',epoch:1,fields:['store']});
  await tx.set('federation/token/'+hash,{issuer:ISS,audience:RPC,subject,epoch:1,clientId:CLIENT,grants:['g1'],expiresAt:w.h.clock.now()+600000});});
 const out=(await service.rpc(token,{version:'0',tx:randomUUID(),resource:'@preferences',contract:PREFERENCES,method:'read',args:{fragment}})).result;
 assert.equal(out.values.store.length,1);assert.equal(out.values.store[0].status,'unavailable');assert.equal(out.values.store[0].token,undefined);assert.equal(out.requiresConsent,undefined);
}finally{await w.h.close();}});
