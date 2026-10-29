import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {FederationService,MemoryFederationStore,PREFERENCES} from '../packages/federation/index.mjs';
import {organizationFederationPort} from '../packages/orgs/grants.mjs';
import {identityEngine,activate,signupInput,passkeyResponse} from './helpers/identity-engine.mjs';
import {authorityEpoch,raiseAuthorityEpoch,organizationVerification} from '../packages/identity/authority-epoch.mjs';
import {transferIdentityPort} from '../packages/identity/transfer-out.mjs';
const issuer='https://orgs.example',subject=issuer+'/entities/organization',clientId='https://app.example/client',fragment='https://schema.example/settings/v1',contract='https://spec.bindle.example/contracts/object-store/v1',r1=issuer+'/resources/one',r2=issuer+'/resources/two',owner={session:'verified'};
async function federation(){
 const member={id:'membership-000001',generation:1,aep:0,state:'live',grants:[{resource:r1,methods:{[contract]:['get']}},{resource:r2,methods:{[contract]:['put']}}]},store=new MemoryFederationStore(),calls=[];
 const organizations=organizationFederationPort({enabled:()=>true,resolve:async()=>({member,connections:[{state:'connected',generation:member.generation,expectedGeneration:1}]})});
 const service=new FederationService({issuer,clock:()=>100000,store,organizations,clients:[{id:clientId,name:'App',origin:'https://app.example',redirectUris:['https://app.example/callback']}],schemaHosts:['schema.example'],schemaFetcher:async()=>({id:fragment,title:'Settings',description:'Settings',publisher:'https://schema.example',fields:{stores:{title:'Files',type:'resource',cardinality:{min:0,max:4},contracts:[contract]}}}),authenticateOwner:async a=>{assert.equal(a,owner);return {subject};},dispatchCapability:async ctx=>{await ctx.reauthorize();calls.push(ctx);return {ok:true};}});
 for(const id of[r1,r2])await service.registerResource(owner,{id,label:'Files',contracts:{[contract]:['get','put']}});await service.configure(owner,{fragment,values:{stores:[r1,r2]}});
 const verifier='v'.repeat(43),{requestId}=await service.beginAuthorization({clientId,redirectUri:'https://app.example/callback',challenge:createHash('sha256').update(verifier).digest('base64url'),challengeMethod:'S256',state:'state',requests:[{fragment,required:true,purpose:'Files',fields:['stores'],methods:{stores:{[contract]:['get','put']}}}]});
 const view=await service.inspect(requestId,owner),decision=await service.approve(owner,{requestId,approved:[{fragment,revision:view.requests[0].revision,fields:['stores'],resources:{stores:[r1,r2]},methods:{stores:{[contract]:['get','put']}}}]}),issued=await service.exchange({code:new URL(decision.redirectUri).searchParams.get('code'),verifier,clientId,redirectUri:'https://app.example/callback'});
 const token=issued.access_token,hash=createHash('sha256').update('token\0'+token).digest('base64url');await store.transaction(async tx=>{const row=await tx.get('federation/token/'+hash);row.member={membership_id:member.id,generation:1,aep:0};await tx.set('federation/token/'+hash,row);});
 const rpc=(resource,method='get',bearer=token)=>service.rpc(bearer,{version:'0',tx:randomUUID(),resource,contract,method,args:{key:'example'}});
 const preferences=()=>service.rpc(token,{version:'0',tx:randomUUID(),resource:'@preferences',contract:PREFERENCES,method:'read',args:{fragment}});
 const orgPreferences=async()=>{await store.transaction(async tx=>{const row=await tx.get('federation/token/'+hash);delete row.member;await tx.set('federation/token/'+hash,row);});return preferences();};
 const preferencesV2=()=>store.transaction(async tx=>{const loaded=await service.token(tx,token);return service.projectV2(tx,{subject,clientId,grants:loaded.grants,fragment,token:loaded.token,bearer:token,issue:true});});
 return {service,member,calls,rpc,preferences,orgPreferences,preferencesV2};
}
test('ORG-3 federation RPC and derived projections intersect per resource; revocation is live',async()=>{
 const f=await federation();await f.rpc(r1);await f.rpc(r2,'put');await assert.rejects(f.rpc(r1,'put'),{code:'forbidden'});await assert.rejects(f.rpc(r2),{code:'forbidden'});
 const v2=await f.preferencesV2();assert.deepEqual(v2.values.stores.map(d=>d.effective_methods),[['get'],['put']]);
 const prefs=(await f.preferences()).result;assert.equal(prefs.values.stores.length,2);assert.deepEqual(prefs.values.stores.map(d=>d.effective_methods),[['get'],['put']]);assert.equal(JSON.stringify(prefs).includes('grantedBy'),false);
 f.member.grants=f.member.grants.filter(g=>g.resource===r1);const narrowed=(await f.preferences()).result;assert.equal(narrowed.values.stores.length,1);assert.equal(narrowed.requiresConsent,undefined);
 const child=prefs.values.stores[0];await f.rpc(child.id,'get',child.token);f.member.grants=[];await assert.rejects(f.rpc(child.id,'get',child.token),{code:'forbidden'});assert.equal((await f.preferences()).result.values.stores,undefined);
 f.member.state='ended';await assert.rejects(f.preferences(),{code:'forbidden'});
});
test('ORG-3 organization context has no effective_methods; generation changes invalidate member calls',async()=>{
 const f=await federation();f.member.generation=2;await assert.rejects(f.rpc(r1),{code:'forbidden'});const ordinary=(await f.orgPreferences()).result;assert.ok(ordinary.values.stores.every(entry=>!Object.hasOwn(entry,'effective_methods')));
});
test('ORG-2 identity authority epoch changes at recovery completion, not setup or routine security changes',async()=>{
 const f=identityEngine();try{const {owner:person,file}=await activate(f.act,signupInput());assert.equal(authorityEpoch(await f.repository.get(person.account.id)),0);
 const recovering=await f.act('recover',{recoveryToken:file.recoveryToken,turnstileToken:'verified'});assert.equal(authorityEpoch(await f.repository.get(person.account.id)),0);
 const options=await f.act('beginPasskeyRegistration',{pendingToken:recovering.pendingToken});await f.act('registerPasskey',{pendingToken:recovering.pendingToken,response:passkeyResponse(options,'passkey-recovered')});assert.equal(authorityEpoch(await f.repository.get(person.account.id)),0);const replacement=await f.act('downloadRecovery',{pendingToken:recovering.pendingToken});assert.equal(authorityEpoch(await f.repository.get(person.account.id)),0);
 await f.act('confirmRecovery',{pendingToken:recovering.pendingToken,recoveryToken:replacement.recoveryToken,downloadConfirmed:true});assert.equal(authorityEpoch(await f.repository.get(person.account.id)),1);
 const port=transferIdentityPort(f.repository,{clock:f.clock.now});await port.invalidateRecovery(person.account.id,{reason:'elevated-abort'});assert.equal(authorityEpoch(await f.repository.get(person.account.id)),2);await port.invalidateRecovery(person.account.id,{reason:'elevated-abort'});assert.equal(authorityEpoch(await f.repository.get(person.account.id)),2);
 }finally{await f.engine.dispose();}
});
test('ORG-2 epoch validation and credential-bound tight-verification evidence fail closed',()=>{
 for(const aep of[-1,null,NaN,'1',Number.MAX_SAFE_INTEGER])assert.throws(()=>authorityEpoch({aep}));const record={};assert.equal(raiseAuthorityEpoch(record,{reason:'credential-reset'}),1);assert.equal(raiseAuthorityEpoch(record,{reason:'key-reset',floor:5}),5);assert.throws(()=>raiseAuthorityEpoch(record,{reason:'passkey-added'}));
 const account={security:{epoch:100,changedAt:10},credentials:[{id:'p',createdAt:20}]};assert.deepEqual(organizationVerification(account,{stepUpAt:30,stepUpCredential:{kind:'passkey',id:'p'}}),{enrolledAt:20,securityChangedAt:10,stepUpAt:30,hasPasskey:true,method:'passkey'});assert.equal(organizationVerification(account,{stepUpAt:30,stepUpCredential:{kind:'passkey',id:'attacker'}}),null);
});
