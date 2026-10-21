// LG-1: federation domain/controller tests with real stores and fake authority; no external metadata fetches.
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {FederationController,MemoryFederationStore} from '../packages/federation/index.mjs';
import {ClientDirectory,validateClientMetadata,validClientSnapshot} from '../packages/federation/client-metadata.mjs';
import {clientPolicyLinks} from '../packages/federation/legal.mjs';
import {AuthorizationEntries} from '../packages/federation/authorization-entries.mjs';
import {issuer,appOrigin,clientId,redirectUri,metadata,cimdProvider,pkce,b64} from './client-metadata-helpers.mjs';
import {incrementalRunner} from '../packages/runtime/incremental-authorization.mjs';
import {fixture as incrementalFixture,owner as incrementalOwner,subject as incrementalSubject,tasks,CAL,SUMMARY,calRequest} from './incremental-authorization-helpers.mjs';
const policies={policy_uri:`${appOrigin}/privacy`,tos_uri:`${appOrigin}/terms`},links={policyUri:policies.policy_uri,tosUri:policies.tos_uri};

test('client policy links accept RFC 7591 names, survive snapshots, and drop unsafe optional presentation',()=>{
 const client=validateClientMetadata(metadata(policies),clientId);assert.deepEqual(clientPolicyLinks(client),links);assert.ok(validClientSnapshot(client));
 for(const unsafe of ['javascript:alert(1)','data:text/html,hello','http://app.example/privacy','//app.example/privacy','/privacy','https://foreign.example/privacy','https://sub.app.example/privacy','https://u:p@app.example/privacy','https://app.example/privacy#fragment','https://APP.example/privacy','https://app.example/a/../privacy','https://app.example/\nprivacy','https://app.example/'+'a'.repeat(2048),null,42,{},[]]){
  const rejected=validateClientMetadata(metadata({policy_uri:unsafe,tos_uri:unsafe}),clientId);assert.equal(rejected.policyUri,undefined,String(unsafe));assert.equal(rejected.tosUri,undefined,String(unsafe));
  assert.equal(validClientSnapshot({...client,policyUri:unsafe}),false,String(unsafe));
 }
 assert.equal(validateClientMetadata(metadata({policyUri:links.policyUri}),clientId).policyUri,undefined,'unknown camelCase wire fields confer no metadata');
});

test('reviewed registrations normalize optional client policy links without fetching',async()=>{
 const client={id:clientId,name:'Reviewed',origin:appOrigin,redirectUris:[redirectUri],...policies},directory=new ClientDirectory({clients:[client]});
 const resolved=await directory.resolve(clientId);assert.deepEqual(clientPolicyLinks(resolved),links);assert.equal(resolved.policy_uri,undefined);
 const invalid=new ClientDirectory({clients:[{...client,policy_uri:'javascript:alert(1)',tos_uri:'https://other.example/terms'}]});assert.deepEqual(clientPolicyLinks(await invalid.resolve(clientId)),{});
 const entries=new AuthorizationEntries({store:new MemoryFederationStore(),issuer,clients:[client],authority:{},crypto:webcrypto});
 const {entryId}=await entries.create({clientId,redirectUri,challenge:pkce('v'.repeat(43)),challengeMethod:'S256',state:b64(32),intent:'login',requests:[],presentation:'redirect'},{origin:appOrigin,remote:'remote'});
 assert.deepEqual(clientPolicyLinks((await entries.view(entryId)).entry.client),links);
});

test('metadata policy links reach entry and owner consent from a single pinned metadata fetch; provider HTTP manifest links its own policies',async()=>{
 const p=await cimdProvider({documents:{[clientId]:metadata(policies)}}),manifest=await(await p.fetch(`${issuer}/.well-known/bindle/manifest.json`)).json();
 assert.equal(manifest.op_policy_uri,`${issuer}/privacy`);assert.equal(manifest.op_tos_uri,`${issuer}/terms`);
 const input={clientId,redirectUri,challenge:pkce('v'.repeat(43)),challengeMethod:'S256',state:b64(32),intent:'login',requests:[],presentation:'redirect'},created=await p.entries.create(input,{origin:appOrigin,remote:'remote'}),view=await p.entries.view(created.entryId);
 assert.deepEqual(clientPolicyLinks(view.entry.client),links);
 const session=p.signIn(),context={sessionToken:session.token,csrfToken:session.csrf,origin:issuer},selected=await p.entries.select(created.entryId,context,{nonce:view.entry.nonce},{token:view.pageToken});
 assert.deepEqual(clientPolicyLinks((await p.authority.inspect(context,selected.requestId)).client),links);assert.equal(p.egress.calls.length,1,'policy pages are links, never metadata egress');
 const local=p.shard(session.account.owner).manifest();assert.equal(local.op_policy_uri,`${issuer}/privacy`);assert.equal(local.op_tos_uri,`${issuer}/terms`);
});

test('pending terms gate new federation grants and content, while preserving reads, denial and grant revocation',async()=>{
 const fragment='https://schema.example/settings/v1',subject=`${issuer}/entities/alice`,context={sessionToken:'session',csrfToken:'csrf',origin:issuer},store=new MemoryFederationStore();let pending=false;
 const controller=new FederationController({issuer,metadata:store,crypto:webcrypto,clock:()=>100000,clients:[{id:clientId,name:'Reviewed',origin:appOrigin,redirectUris:[redirectUri],...policies}],schemaHosts:['schema.example'],schemaFetcher:async()=>({id:fragment,title:'Settings',description:'Theme settings',publisher:'https://schema.example',fields:{theme:{title:'Theme',type:'enum',values:['light','dark']}}}),dispatcher:async()=>({ok:true}),auth:{owner:async(ctx,{mutation})=>{assert.equal(ctx.sessionToken,'session');if(mutation)assert.equal(ctx.csrfToken,'csrf');if(pending&&ctx.requireCurrentTerms===true)throw Object.assign(new Error('Accept current terms.'),{code:'terms_acceptance_required'});return {subject};}}});
 await controller.configure(context,{fragment,values:{theme:'light'}});
 const begin=()=>controller.beginAuthorization({clientId,redirectUri,challenge:createHash('sha256').update('v'.repeat(43)).digest('base64url'),challengeMethod:'S256',state:'state',requests:[{fragment,required:true,purpose:'Theme',fields:['theme']}]});
 const first=await begin(),view=await controller.inspect(context,first.requestId),approval={requestId:first.requestId,approved:[{fragment,revision:view.requests[0].revision,fields:['theme']}]};
 await controller.approve(context,approval);const grant=(await controller.grants(context)).grants[0];assert.ok(grant);
 const second=await begin(),other=await controller.inspect(context,second.requestId);pending=true;
 await assert.rejects(controller.approve({...context,requireCurrentTerms:false},{...approval,requestId:second.requestId}),{code:'terms_acceptance_required'});
 await assert.rejects(controller.configure(context,{fragment,values:{theme:'dark'}}),{code:'terms_acceptance_required'});
 await assert.rejects(controller.registerResource(context,{id:`${issuer}/resources/new`,label:'New',contracts:{}}),{code:'terms_acceptance_required'});
 assert.equal((await controller.inspect(context,second.requestId)).requestId,other.requestId);assert.ok(await controller.preferences(context));
 const denied=await controller.approve(context,{requestId:second.requestId,denied:true});assert.equal(new URL(denied.redirectUri).searchParams.get('error'),'access_denied');
 await controller.revoke(context,grant.id);assert.equal((await controller.grants(context)).grants.length,0);assert.equal(context.requireCurrentTerms,undefined,'the caller context is never mutated');
});

test('terms refusal releases the entry decision so another signed-in account can continue',async()=>{
 const p=await cimdProvider({handles:['alex','sam']}),{entryId}=await p.entries.create({clientId,redirectUri,challenge:pkce('v'.repeat(43)),challengeMethod:'S256',state:b64(32),intent:'login',requests:[],presentation:'redirect'},{origin:appOrigin,remote:'remote'}),view=await p.entries.view(entryId),page={token:view.pageToken};
 const first=p.signIn(p.accounts[0]),second=p.signIn(p.accounts[1]),ctx=s=>({sessionToken:s.token,csrfToken:s.csrf,origin:issuer});
 await p.entries.select(entryId,ctx(first),{nonce:view.entry.nonce},page);const approve=p.authority.approve;
 p.authority.approve=async()=>{throw Object.assign(new Error('Accept current terms.'),{code:'terms_acceptance_required'});};
 await assert.rejects(p.entries.decide(entryId,ctx(first),{nonce:view.entry.nonce,approved:[]},page),{code:'terms_acceptance_required'});p.authority.approve=approve;
 await p.entries.select(entryId,ctx(second),{nonce:view.entry.nonce},page);assert.ok(new URL((await p.entries.decide(entryId,ctx(second),{nonce:view.entry.nonce,approved:[]},page)).redirectUri).searchParams.get('code'));
});

test('incremental engine grant-more and configure require current terms for Allow while still permitting decline',async()=>{
 for(const intent of ['grant-more','configure']){
  const f=incrementalFixture();f.p.grant(tasks.id,CAL,{fields:['color'],methods:{}});f.p.grant(tasks.id,SUMMARY,{fields:['day'],methods:{}});f.p.prefs.set(`${incrementalSubject}|${SUMMARY}`,{revision:'r0',values:{day:'friday'}});f.p.newest.set(`${incrementalSubject}|${tasks.id}`,{expiresAt:null,authTime:5});let pending=false;
  const incremental=incrementalRunner({config:{INCREMENTAL_AUTH_ENABLED:'true',FEDERATION_ENABLED:'true',FEDERATION_ENTRY_ENABLED:'true'},incremental:f.incremental,clock:{now:f.time}});
  const entries=new AuthorizationEntries({store:new MemoryFederationStore(),issuer,clients:[tasks],crypto:webcrypto,clock:f.time,incremental,authority:{entryIdentity:async context=>{if(pending&&context.requireCurrentTerms===true)throw Object.assign(new Error('Accept current terms.'),{code:'terms_acceptance_required'});return {subject:incrementalSubject,authTime:f.time()};}}});
  const context={sessionToken:`${incrementalOwner}.${'s'.repeat(43)}`},input={clientId:tasks.id,redirectUri:tasks.redirectUris[0],state:b64(32),intent,subjectConstraint:incrementalSubject,presentation:'redirect',...intent==='grant-more'?{challenge:pkce('v'.repeat(43)),challengeMethod:'S256',requests:[calRequest()]}:{target:{fragment:SUMMARY},suggestion:{values:{day:'monday'}}}},created=await entries.create(input,{origin:tasks.origin,remote:'remote'}),view=await entries.view(created.entryId),page={token:view.pageToken};
  await entries.select(created.entryId,context,{nonce:view.entry.nonce},page);f.time.advance(1500);pending=true;
  await assert.rejects(entries.decide(created.entryId,context,{nonce:view.entry.nonce,...intent==='grant-more'?{approved:[]}:{changes:[{field:'day',take:'suggested',via:'field'}]}},page),{code:'terms_acceptance_required'});
  assert.equal(f.p.calls.commit,0);assert.equal(f.p.calls.save,0);
  assert.ok((await entries.decide(created.entryId,context,{nonce:view.entry.nonce,denied:true},page)).redirectUri);assert.equal(f.p.calls.commit,0);assert.equal(f.p.calls.save,0);
 }
});
