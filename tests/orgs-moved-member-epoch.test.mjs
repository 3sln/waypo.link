// Wargame 2026-10-23 F4 (latent until the successor index is wired): the directory key-reset epoch is stored per CLAIMED
// (iss, sub), so a member who moves to another allowlisted issuer starts a fresh baseline instead of being compared
// with the previous issuer's epoch forever.
import test from 'node:test';
import assert from 'node:assert/strict';

const {SqliteMetadata}=await import('../apps/node/resources.mjs');
const {MemoryMessagingStore}=await import('../packages/core/records.mjs');
const {createAppEngine,perform}=await import('../packages/app/engine.mjs');
const {memoryAudit}=await import('../packages/app/providers.mjs');
const {IdentityDirectory}=await import('../packages/federation/directory.mjs');
const {MemberContextService,memberContextProvider,directoryIssuerKeys,cachedIssuerKeys,memberPrincipalKey,MemberToken,MemberKeyRefresh}=await import('../packages/orgs/certificates.mjs');
const {fakeClock}=await import('../tests/helpers/chaos.mjs');
const {holder,dpop}=await import('../tests/helpers/member-certificates.mjs');
const {secondIssuer}=await import('../tests/helpers/second-issuer.mjs');
const HOST='https://3sln.example',ORG='dddddddd-dddd-4ddd-8ddd-dddddddddddd',AUD=`${HOST}/identity/${ORG}`,TOKEN_URL=`${HOST}/oauth/token`;
const CAROL='cccccccc-cccc-4ccc-8ccc-cccccccccccc',CAROL_AT_Y='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ERP={client_id:'https://erp.example/client.json',origin:'https://erp.example'};
test('a moved foreign member is not wedged by the previous issuer\'s key-reset epoch',async()=>{
 const clock=fakeClock(1800000000000),X=await secondIssuer({origin:'https://x.example',clock:clock.now}),Y=await secondIssuer({origin:'https://y.example',clock:clock.now});
 const directory=new IdentityDirectory({store:new MemoryMessagingStore(),fetch:url=>(url.startsWith(X.origin)?X:Y).fetch(url),enabled:true,issuers:[X.origin,Y.origin],clock:clock.now});
 const metadata=new SqliteMetadata(':memory:'),origin={iss:X.origin,sub:CAROL},m={id:'m'.repeat(20),generation:1,aep:0};
 const members={async roster(){return [{...origin}];},async lookup(p){return memberPrincipalKey(p)===memberPrincipalKey(origin)?{...m}:null;},async observe(){return m;},async context(p,{generation}){return {membership_id:m.id,generation};}};
 let moved=false;const successors={origin:async p=>moved&&p.iss===Y.origin&&p.sub===CAROL_AT_Y?{...origin}:p};
 const service=new MemberContextService({metadata,organization:{id:ORG,identity:AUD},issuer:HOST,members,successors,local:cachedIssuerKeys({metadata,issuer:HOST,read:async()=>null,clock:clock.now}),foreign:directoryIssuerKeys(directory),connections:{check:async({clientId,origin})=>clientId===ERP.client_id&&origin===ERP.origin},flags:{organizations:()=>true,foreign:()=>true},foreignIssuers:[X.origin,Y.origin],clock:clock.now});
 const engine=createAppEngine({providers:{clock:{now:clock.now},random:{uuid:()=>crypto.randomUUID()},audit:memoryAudit({clock:{now:clock.now}}),memberContext:memberContextProvider(service)}});
 const key=await holder();
 const token=async(issuer,sub)=>{try{await perform(engine,new MemberToken({actor:{kind:'system',owner:ORG},input:{assertion:await issuer.certify({sub,aud:AUD,client:ERP,holder:key}),clientId:ERP.client_id,dpop:await dpop(key,{htu:TOKEN_URL,nowMs:clock.now()}),htu:TOKEN_URL,network:'n'}}));return true;}catch{return false;}};
 const refresh=async()=>{clock.advance(5000);await perform(engine,new MemberKeyRefresh({actor:{kind:'system',owner:ORG}}));};
 await X.person(CAROL);await token(X,CAROL);await refresh();assert.equal(await token(X,CAROL),true,'control: Carol at X');
 // Issuer X resets Carol's signing key without continuity (an authority reset; directory epoch 0 -> 1).
 await X.resetSigning(CAROL);clock.advance(301000);await refresh();assert.equal(await token(X,CAROL),true,'Carol after X key reset (epoch 1 recorded)');
 // Carol moves to Y as CAROL_AT_Y; the successor index maps it to the origin principal (X, CAROL).
 moved=true;await Y.person(CAROL_AT_Y);await token(Y,CAROL_AT_Y);await refresh();await refresh();
 const after=await token(Y,CAROL_AT_Y);
 
 assert.equal(after,true,'Y pin epoch 0 must not be compared with X pin epoch 1');
});
