import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppEngine,perform,read} from '../packages/app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../packages/app/providers.mjs';
import {InspectMemberAcquisition,AcquireMemberCertificate} from '../packages/app/domains/member-acquisition.mjs';
import {stages,allowedMethods} from '../packages/runtime/routes/member-certificates.mjs';
import {forEachSeed,createScheduler} from './helpers/chaos.mjs';
const SUBJECT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ISSUER='https://home.example',AUD=ISSUER+'/identity/dddddddd-dddd-4ddd-8ddd-dddddddddddd',CLIENT='https://app.example/client.json',REDIRECT='https://app.example/callback';
const base={client_id:CLIENT,redirect_uri:REDIRECT,aud:AUD},actor={kind:'owner',owner:SUBJECT};
function fixture({enabled=true,client={id:CLIENT,name:'app.example',origin:'https://app.example',redirectUris:[REDIRECT],reviewed:false,claimedName:'Acme ERP'},account,resolve,describe}={}){
 const calls=[],config={issuer:ISSUER,allowLoopback:false,enabled:()=>enabled},port=account??{memberCertificateAcquire:async(...args)=>{calls.push(['acquire',...args]);return {certificate:'signed'};}};
 const organizations={describe:describe??(async aud=>{calls.push(['describe',aud]);return {name:'Acme Corp',handle:'acme',verified:true,source:'local'};})};
 const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,config,organizations,federationStore:{resolve:resolve??(async()=>client)},accounts:{get:owner=>{assert.equal(owner,SUBJECT);return port;}}}});
 return {engine,calls,inspect:(input=base,a=actor)=>read(engine,new InspectMemberAcquisition({actor:a,input})),acquire:(input={...base,consent:true,delegate:{},proof:{}},a=actor)=>perform(engine,new AcquireMemberCertificate({actor:a,input}))};
}
test('acquisition derives the client origin from an exact registered redirect, and the subject from the authenticated actor',async()=>{
 const f=fixture();try{assert.deepEqual(await f.inspect(),{subject:SUBJECT,issuer:ISSUER,aud:AUD,client:{client_id:CLIENT,origin:'https://app.example'},redirectUri:REDIRECT,purposes:['https://spec.bindle.example/purposes/member-access/v1'],organization:{name:'Acme Corp',handle:'acme',host:'home.example',verified:true,source:'local'},app:{name:'app.example',claimedName:'Acme ERP',reviewed:false}});assert.equal((await f.acquire()).certificate,'signed');assert.deepEqual(f.calls.map(c=>c[0]),['describe','acquire']);assert.deepEqual(f.calls[1][2].client,{client_id:CLIENT,origin:'https://app.example'});assert.equal(f.calls[1][1],SUBJECT);}finally{await f.engine.dispose();}
});
test('unknown clients, lookalike redirects, origin overrides, absent consent and unauthenticated calls fail without account writes',async()=>{
 const f=fixture();try{for(const input of [{...base,redirect_uri:REDIRECT+'?evil=1'},{...base,redirect_uri:'https://evil.example/callback'},{...base,origin:'https://evil.example'},{...base,aud:'https://home.example/identity/nope'},{...base,redirect_uri:REDIRECT+'#fragment'}])await assert.rejects(f.inspect(input));await assert.rejects(f.acquire({...base,consent:false}));await assert.rejects(f.inspect(base,{kind:'app',owner:SUBJECT}));assert.equal(f.calls.filter(c=>c[0]!=='describe').length,0);}finally{await f.engine.dispose();}
 const unknown=fixture({client:null});try{await assert.rejects(unknown.inspect(),{code:'invalid_client'});assert.equal(unknown.calls.length,0);}finally{await unknown.engine.dispose();}
});
test('both flags are represented by the mandatory acquisition gate and disabled issuance never resolves a client',async()=>{
 let calls=0;const f=fixture({enabled:false,resolve:async()=>{calls++;}});try{await assert.rejects(f.inspect(),{code:'not_found'});await assert.rejects(f.acquire(),{code:'not_found'});assert.equal(calls,0);assert.equal(f.calls.length,0);}finally{await f.engine.dispose();}
});
test('commit resolves registry again: changing redirects after inspection cannot reuse a stale origin',async()=>{
 let valid=true;const f=fixture({resolve:async()=>({id:CLIENT,origin:'https://app.example',redirectUris:valid?[REDIRECT]:[]})});try{await f.inspect();valid=false;await assert.rejects(f.acquire(),{code:'invalid_client'});assert.equal(f.calls.filter(c=>c[0]!=='describe').length,0);}finally{await f.engine.dispose();}
});
test('seeded concurrent acquisitions retain each request holder proof and authenticated client binding',async()=>{
 await forEachSeed(12,async random=>{
  const scheduler=createScheduler(random),seen=[],port=scheduler.wrap({async memberCertificateAcquire(owner,{client,input}){assert.equal(owner,SUBJECT);assert.equal(client.origin,'https://app.example');seen.push({...input,client});return {certificate:input.proof.signature};}},'issuer');
  const f=fixture({account:port});try{const inputs=Array.from({length:6},(_,i)=>({...base,consent:true,delegate:{x:String(i)},proof:{iat:123,signature:String(i)}})),results=await scheduler.run(inputs.map(input=>()=>f.acquire(input)));assert.equal(results.filter(r=>r.status==='fulfilled').length,6);assert.equal(seen.length,6);for(const input of seen){assert.equal(input.delegate.x,input.proof.signature);assert.equal(input.client.origin,'https://app.example');}}finally{await f.engine.dispose();}
 });
});
test('HTTP acquire is a no-store owner route and refuses a foreign Origin before account mutation',async()=>{
 assert.deepEqual(allowedMethods('/api/member-certificates/acquire'),['GET','POST']);
 const response=await stages.owner({request:new Request(ISSUER+'/api/member-certificates/acquire',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({...base,consent:true})}),env:{APP_ORIGIN:ISSUER},path:'/api/member-certificates/acquire',id:SUBJECT,object:{}});
 assert.equal(response.status,403);assert.match(response.headers.get('Cache-Control'),/no-store/);
});
test('real issuer composition verifies the SDK holder proof, signs the profile, and keeps revoked holders dead under seeded acquisition races',async()=>{
 const {SqliteMetadata}=await import('../apps/node/resources.mjs'),{IdentityKeyRegistry}=await import('../packages/identity/keys.mjs'),{MemberCertificateIssuer,memberCertificatesProvider,certificationSigner,AcquireMemberConsentCertificate,RevokeMemberKey,MemberCertificateStatus,parseMemberCertificate}=await import('../packages/identity/member-certificates.mjs'),{createKey}=await import('../packages/sdk/src/dpop.mjs'),{createMemberProof}=await import('../packages/sdk/src/member.mjs'),{sealing,registryStore}=await import('./helpers/member-certificates.mjs');
 await forEachSeed(6,async random=>{
  const metadata=new SqliteMetadata(':memory:');await metadata.put('owner',SUBJECT);const keys=new IdentityKeyRegistry({store:registryStore(metadata),...sealing});await keys.ensure(SUBJECT,'signing');
  const issuer=new MemberCertificateIssuer({metadata,issuer:ISSUER,account:async()=>({status:'active'}),authorityEpoch:async()=>0,identityURI:owner=>ISSUER+'/identity/'+owner,signer:certificationSigner({metadata,...sealing}),enabled:()=>true});
  const home=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,memberCertificates:memberCertificatesProvider(issuer)}}),account={memberCertificateAcquire:(owner,{client,input})=>perform(home,new AcquireMemberConsentCertificate({actor:{kind:'owner',owner,client},input}))},f=fixture({account}),holder=await createKey(),proof=await createMemberProof(holder,{aud:AUD,clientId:CLIENT,issuer:ISSUER,subject:SUBJECT}),input={...base,consent:true,delegate:holder.jwk,proof};
  try{
   const result=await f.acquire(input),claims=parseMemberCertificate(result.certificate).payload;assert.equal(claims.cnf.jkt,holder.jkt);assert.deepEqual(claims.client,{client_id:CLIENT,origin:'https://app.example'});
   await assert.rejects(f.acquire({...input,proof:{...proof,signature:'A'.repeat(86)}}),{code:'invalid_request'});
   const tasks=random.shuffle([()=>f.acquire(input),()=>perform(home,new RevokeMemberKey({actor,input:{jkt:holder.jkt}}))]);await Promise.allSettled(tasks.map(task=>task()));
   assert.equal((await read(home,new MemberCertificateStatus({actor:{kind:'public',owner:SUBJECT},input:{jkt:holder.jkt}}))).status,'revoked');
   await assert.rejects(f.acquire(input),{code:'delegation_revoked'});
  }finally{await f.engine.dispose();await home.dispose();}
 });
});
test('HTTP owner adapter observes both kill switches before client resolution and returns no-store context',async()=>{
 const query=new URLSearchParams(base),path='/api/member-certificates/acquire';let resolved=0;
 const described=[],object={memberCertificateOrganization:async(owner,aud)=>{described.push([owner,aud]);return {name:'Acme Corp',handle:'acme',verified:true,source:'local'};},memberCertificateAcquire:async()=>({certificate:'signed'})};
 const env={APP_ORIGIN:ISSUER,DIRECTORY_ENABLED:'true',ORGANIZATIONS_ENABLED:'true',MEMBER_CERTIFICATES_ENABLED:'true',FEDERATION_AUTHORITY:{directory:{resolve:async()=>{resolved++;return {id:CLIENT,origin:'https://app.example',redirectUris:[REDIRECT]};}}}};
 const ctx={request:new Request(ISSUER+path+'?'+query),env,path,id:SUBJECT,object};
 const ok=await stages.owner(ctx);assert.equal(ok.status,200);const okBody=await ok.json();assert.equal(okBody.subject,SUBJECT);assert.equal(okBody.organization.name,'Acme Corp');assert.deepEqual(described,[[SUBJECT,AUD]]);assert.match(ok.headers.get('Cache-Control'),/no-store/);assert.equal(resolved,1);
 for(const flag of ['ORGANIZATIONS_ENABLED','MEMBER_CERTIFICATES_ENABLED'])await assert.rejects(stages.owner({...ctx,env:{...env,[flag]:'false'}}),{code:'not_found'});
 assert.equal(resolved,1);
});
// ---- ORG-6a security review regressions (M1, M2) ----
test('M1: a proof that went stale while the member reviewed fails without stranding an active consent',async()=>{
 const {SqliteMetadata}=await import('../apps/node/resources.mjs'),{IdentityKeyRegistry}=await import('../packages/identity/keys.mjs'),{MemberCertificateIssuer,memberCertificatesProvider,certificationSigner,AcquireMemberConsentCertificate,MemberCertificateList}=await import('../packages/identity/member-certificates.mjs'),{createKey}=await import('../packages/sdk/src/dpop.mjs'),{createMemberProof}=await import('../packages/sdk/src/member.mjs'),{sealing,registryStore}=await import('./helpers/member-certificates.mjs');
 const metadata=new SqliteMetadata(':memory:');await metadata.put('owner',SUBJECT);await new IdentityKeyRegistry({store:registryStore(metadata),...sealing}).ensure(SUBJECT,'signing');
 let skew=121_000;const issuer=new MemberCertificateIssuer({metadata,issuer:ISSUER,account:async()=>({status:'active'}),authorityEpoch:async()=>0,identityURI:o=>ISSUER+'/identity/'+o,signer:certificationSigner({metadata,...sealing}),enabled:()=>true,clock:()=>Date.now()+skew});
 const home=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,memberCertificates:memberCertificatesProvider(issuer)}}),account={memberCertificateAcquire:(owner,{client,input})=>perform(home,new AcquireMemberConsentCertificate({actor:{kind:'owner',owner,client},input}))},f=fixture({account});
 const holder=await createKey(),signed=()=>createMemberProof(holder,{aud:AUD,clientId:CLIENT,issuer:ISSUER,subject:SUBJECT});
 try{
  await assert.rejects(f.acquire({...base,consent:true,delegate:holder.jwk,proof:await signed()}),/stale/i);
  assert.deepEqual((await read(home,new MemberCertificateList({actor}))).consents,[],'no consent without a certificate');
  skew=0;const result=await f.acquire({...base,consent:true,delegate:holder.jwk,proof:await signed()});assert.ok(result.certificate);
  const [consent]=(await read(home,new MemberCertificateList({actor}))).consents;assert.equal(consent.state,'active');assert.deepEqual(consent.keys.map(k=>k.jkt),[holder.jkt]);
 }finally{await f.engine.dispose();await home.dispose();}
});
test('M2: inspection names the organization and the app, and flags an unknown or unverifiable organization',async()=>{
 const reviewed=fixture({client:{id:CLIENT,name:'Acme ERP',origin:'https://app.example',redirectUris:[REDIRECT]}});
 try{const v=await reviewed.inspect();assert.deepEqual(v.app,{name:'Acme ERP',claimedName:null,reviewed:true});assert.deepEqual(v.organization,{name:'Acme Corp',handle:'acme',host:'home.example',verified:true,source:'local'});assert.deepEqual(reviewed.calls,[['describe',AUD]],'naming reads only the audience, never membership (ORG-D9)');}finally{await reviewed.engine.dispose();}
 for(const describe of [async()=>null,async()=>{throw new Error('directory down');},async()=>({verified:true,source:'directory'}),async()=>({name:'Acme‮proC',verified:true,source:'local'}),async()=>({name:'Acme Corp',verified:false,source:'local'})]){
  const f=fixture({describe});try{const v=await f.inspect();assert.deepEqual(v.organization,{name:null,handle:null,host:'home.example',verified:false,source:v.organization.source});assert.equal(v.client.origin,'https://app.example');}finally{await f.engine.dispose();}
 }
 const foreign=fixture({describe:async()=>({name:null,handle:'acme',verified:true,source:'directory'})});
 try{assert.deepEqual((await foreign.inspect()).organization,{name:null,handle:'acme',host:'home.example',verified:true,source:'directory'});}finally{await foreign.engine.dispose();}
});
