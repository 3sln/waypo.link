// Bindle Messaging §2.1, §2.2, §2.5 and §3.2 on the provider (contacts spike CR-X1/CR-M3/CR-C0; provisional, unsigned):
// the messaging-ingress fragment's `mailbox` field, the messaging-mailbox extension (descriptor, key-delegation
// prerequisite, manifest row), its provider feature as the only path to key-delegation occupancy, the exact-member
// `describe` validation, and the cascade that revokes every delegate key when the feature is disabled. Engine level on
// the real AccountController, with KEY_DELEGATION_ENABLED and never LINKS_ENABLED.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EXT,BINDLE_REGISTRY,PREREQUISITES,readExtensions,withExtensionEntries,declare} from '../packages/core/extensions.mjs';
import {PROVIDER_REGISTRY} from '../packages/federation/extensions.mjs';
import {FEATURE_DEFINITIONS,PROVIDER_FEATURE_ROWS,providerFeatureDeclarations,messagingMailboxMounted} from '../packages/app/domains/provider-features.mjs';
import {RECOGNIZED_FIELDS,MESSAGING_INGRESS_FRAGMENT_DOCUMENT,DELEGATION_FIELDS} from '../packages/apps/connections.mjs';
import {MESSAGING_INGRESS_FRAGMENT,validateDescribe} from '../packages/identity/messaging-ingress.mjs';
import {DELEGATION_PURPOSES,signDelegationPop,jwkThumbprint} from '../packages/identity/delegation.mjs';
import {providerFeatureMounts} from '../packages/runtime/account/connections.mjs';
import {federationDeclarations} from '../packages/runtime/federation.mjs';
import {surfaceConfig} from '../packages/runtime/account/flags.mjs';
import {brokeringMounts} from '../packages/runtime/integration-ports.mjs';
import {validateIntegrationManifest} from '../packages/federation/integrations.mjs';
import {digest,canonical} from '../packages/core/records.mjs';
import {strictJSON} from '../packages/core/strict-json.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
import {memberCertificateLifetime,MEMBER_CERTIFICATE_DEFAULT_SECONDS,MEMBER_REVOCATION_BOUND_SECONDS} from '../packages/identity/member-certificates.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ISSUER='https://3sln.example';
const MAILBOX='https://spec.bindle.example/messaging/v1/contracts/mailbox',FEATURE=EXT.messagingMailbox,ALL=Object.values(DELEGATION_PURPOSES).sort();
// The canonical digest (protocol §3 pin: sha256 over the canonical JSON) of docs/artefacts/fragments/messaging-ingress-v1.json
// after the field rename `ingress` -> `mailbox` (2026-10-28). The previous document hashed to
// sha256-yWmb56TfD8cgR_2Ifcov3FiYwE_kqc6ygR4z9AwvtLc. Apps pinning the fragment by digest must use this value.
const FRAGMENT_DIGEST='sha256-JpPQ2VP2d3C0bdePV2LScZUP0akYSCbfEzfrLZMk-i4';
const FLAGS={KEY_DELEGATION_ENABLED:'true',INTEGRATIONS_ENABLED:'true',BROKERING_ENABLED:'true',EXTENSIONS_ENABLED:'true'};
const code=c=>e=>{assert.equal(e.code,c,`expected ${c}, got ${e.code}: ${e.message}`);return true;};

test('fragment artefact: matches the spec text, field `mailbox`, and its digest is the pinned one', async()=>{
 const source=await readFile(new URL('../docs/artefacts/fragments/messaging-ingress-v1.json',import.meta.url),'utf8'),doc=strictJSON(source);
 const spec=await readFile(new URL('../docs/spec/extensions/messaging.md',import.meta.url),'utf8'),section=spec.slice(spec.indexOf('### 2.1 Messaging-ingress fragment'));
 assert.deepEqual(doc,JSON.parse(section.slice(section.indexOf('```json')+7,section.indexOf('```',section.indexOf('```json')+7))),'the artefact is exactly the §2.1 document');
 assert.deepEqual(Object.keys(doc.fields),['mailbox']);assert.equal(doc.description,'The one app that receives Bindle messages for you.');
 assert.equal('sha256-'+await digest(globalThis.crypto,canonical(doc)),FRAGMENT_DIGEST);
 assert.deepEqual(MESSAGING_INGRESS_FRAGMENT_DOCUMENT,doc);assert.equal(RECOGNIZED_FIELDS[MESSAGING_INGRESS_FRAGMENT],MESSAGING_INGRESS_FRAGMENT_DOCUMENT);assert.deepEqual(DELEGATION_FIELDS,[MESSAGING_INGRESS_FRAGMENT]);
 // Not a 3sln.me publication: the lock lists only artefacts this provider publishes, so no stale digest can linger there.
 const lock=strictJSON(await readFile(new URL('../docs/artefacts/artefacts.lock.json',import.meta.url)));assert.equal(lock.some(line=>line.id===MESSAGING_INGRESS_FRAGMENT),false);
});

test('descriptor and prerequisite: a Bindle extension whose processors require exactly one key-delegation entry', async()=>{
 const json=JSON.parse(await readFile(new URL('../docs/artefacts/extensions/messaging-mailbox-v1.json',import.meta.url),'utf8'));
 assert.deepEqual(json,{id:'https://spec.bindle.example/extensions/messaging-mailbox/v1',title:'Messaging app keys',description:'Lets the messaging app you choose send and receive Bindle messages as you.',options:{}});
 assert.deepEqual(structuredClone(BINDLE_REGISTRY.get(FEATURE)),json);assert.ok(PROVIDER_REGISTRY.has(FEATURE));assert.deepEqual(PREREQUISITES[FEATURE],[EXT.keyDelegation]);
 assert.equal(PROVIDER_REGISTRY.has('https://3sln.me/extensions/messaging-address/v1'),false,'the withdrawn messaging-address extension is gone');
 const read=extensions=>readExtensions({issuer:ISSUER,extensions},{registry:PROVIDER_REGISTRY});
 assert.deepEqual(read([declare(FEATURE)]).absent,[{spec:FEATURE,reason:'prerequisite'}]);
 assert.ok(read([declare(EXT.keyDelegation,{max_certificate_seconds:600}),declare(FEATURE)]).extensions.has(FEATURE));
 assert.equal(read([declare(EXT.keyDelegation,{max_certificate_seconds:600}),declare(EXT.keyDelegation,{max_certificate_seconds:900}),declare(FEATURE)]).extensions.has(FEATURE),false,'two key-delegation entries are absent, so is the dependent');
 assert.deepEqual(FEATURE_DEFINITIONS[FEATURE],{fragment:MESSAGING_INGRESS_FRAGMENT,field:'mailbox',methods:{[MAILBOX]:['describe']}});
});

test('manifest row: declared only with its own flags and a mounted describe, never LINKS_ENABLED; both sides hold one key-delegation entry', ()=>{
 const describe=()=>null,specs=manifest=>[...readExtensions(manifest,{registry:PROVIDER_REGISTRY,issuer:ISSUER}).extensions.keys()];
 const both=config=>{const mounts={messagingMailbox:messagingMailboxMounted(config),...brokeringMounts(config)};return {published:{issuer:ISSUER,...federationDeclarations(config,{target:'authority',mounts})},account:providerFeatureDeclarations(surfaceConfig(config),providerFeatureMounts(config))};};
 const on={APP_ORIGIN:ISSUER,...FLAGS,MESSAGING_DESCRIBE:describe};
 for(const config of [on,{...on,LINKS_ENABLED:'false'},{...on,LINKS_ENABLED:'true'},{...on,DELEGATION_CERTIFICATE_SECONDS:'3600'}]){
  const {published,account}=both(config);
  for(const manifest of [published,account]){assert.ok(specs(manifest).includes(FEATURE),JSON.stringify(config));assert.equal(manifest.extensions.filter(e=>e.spec===EXT.keyDelegation).length,1,'exactly one prerequisite entry');}
  assert.deepEqual(account.extensions.find(e=>e.spec===EXT.keyDelegation).options,{max_certificate_seconds:config.DELEGATION_CERTIFICATE_SECONDS==='3600'?3600:86400});
 }
 for(const off of [...Object.keys(FLAGS),'MESSAGING_DESCRIBE']){const config={...on,[off]:off==='MESSAGING_DESCRIBE'?undefined:'false'},{published,account}=both(config);assert.equal(specs(published).includes(FEATURE),false,off);assert.equal(specs(account).includes(FEATURE),false,off);}
 assert.equal(specs(both({APP_ORIGIN:ISSUER,LINKS_ENABLED:'true',INTEGRATIONS_ENABLED:'true',BROKERING_ENABLED:'true',EXTENSIONS_ENABLED:'true',MESSAGING_DESCRIBE:describe}).published).includes(FEATURE),false,'LINKS_ENABLED never stands in for KEY_DELEGATION_ENABLED');
 assert.equal(specs(both({...on,DELEGATION_CERTIFICATE_SECONDS:'10'}).published).includes(FEATURE),false,'an unusable host lifetime is not declared');
 assert.equal([PROVIDER_FEATURE_ROWS[FEATURE].flag].flat().includes('LINKS_ENABLED'),false);
 // The directory route's member-certificate entry merges into the row's (routes/directory.mjs, merge:true): still one
 // entry, the prerequisite still holds, and lifetimes combine by maximum (review M3), never the later value.
 const merged=withExtensionEntries(both(on).published,[declare(EXT.keyDelegation,{max_certificate_seconds:3600,revocation_bound_seconds:300})],{merge:true});
 assert.deepEqual(merged.extensions.filter(e=>e.spec===EXT.keyDelegation),[{spec:EXT.keyDelegation,options:{max_certificate_seconds:86400,revocation_bound_seconds:300}}]);assert.ok(specs(merged).includes(FEATURE));
});

test('review M3: with member certificates on, the one key-delegation entry covers the Parlay lifetime, and the account-side port agrees with the published manifest',()=>{
 const describe=()=>null,on={APP_ORIGIN:ISSUER,...FLAGS,MESSAGING_DESCRIBE:describe,MEMBER_CERTIFICATES_ENABLED:'true',DIRECTORY_ENABLED:'true'};
 for(const config of [on,{...on,DELEGATION_CERTIFICATE_SECONDS:'3600'},{...on,MEMBER_CERTIFICATE_SECONDS:'120'}]){
  const mounts={messagingMailbox:messagingMailboxMounted(config),...brokeringMounts(config)},row={issuer:ISSUER,...federationDeclarations(config,{target:'authority',mounts})};
  // The directory route appends the member-certificate entry with merge:true (routes/directory.mjs).
  const published=withExtensionEntries(row,[declare(EXT.keyDelegation,{max_certificate_seconds:memberCertificateLifetime(config.MEMBER_CERTIFICATE_SECONDS)??MEMBER_CERTIFICATE_DEFAULT_SECONDS,revocation_bound_seconds:MEMBER_REVOCATION_BOUND_SECONDS})],{merge:true});
  const account=providerFeatureDeclarations(surfaceConfig(config),providerFeatureMounts(config)),entry=m=>m.extensions.filter(e=>e.spec===EXT.keyDelegation);
  assert.equal(entry(published).length,1);
  const parlay=config.DELEGATION_CERTIFICATE_SECONDS==='3600'?3600:86400;
  assert.ok(entry(published)[0].options.max_certificate_seconds>=parlay,'covers every Parlay certificate');
  assert.equal(entry(published)[0].options.max_certificate_seconds,Math.max(parlay,memberCertificateLifetime(config.MEMBER_CERTIFICATE_SECONDS)??MEMBER_CERTIFICATE_DEFAULT_SECONDS));
  assert.deepEqual(entry(account),entry(published),'account-side port and manifest agree');
 }
});

test('describe: exactly {version: 1, ingress}, absolute HTTPS on the occupant origin, no userinfo, query or fragment; loopback only when allowed', ()=>{
 const origin='https://box.example',ok={version:1,ingress:'https://box.example/ingress'};
 assert.deepEqual(validateDescribe(ok,{origin}),ok);assert.deepEqual(validateDescribe({ingress:ok.ingress,version:1}),ok,'member order is irrelevant');
 const v=validateDescribe(ok);v.ingress='x';assert.equal(ok.ingress,'https://box.example/ingress','a detached copy');
 const refused=[null,[],'x',{},{version:1},{ingress:ok.ingress},{...ok,version:2},{...ok,version:'1'},{...ok,profiles:['https://spec.bindle.example/messaging/v1']},{...ok,kinds:['one-off']},{...ok,limits:{}},{...ok,multicast:'https://box.example/m'},{...ok,expiresAt:1},{...ok,extra:undefined},
  {version:1,ingress:'http://box.example/ingress'},{version:1,ingress:'https://box.example/ingress?x=1'},{version:1,ingress:'https://box.example/ingress?'},{version:1,ingress:'https://box.example/ingress#f'},{version:1,ingress:'https://u:p@box.example/ingress'},{version:1,ingress:'https://BOX.example/ingress'},{version:1,ingress:'/ingress'},{version:1,ingress:'https://box.example/'+'a'.repeat(2050)},{version:1,ingress:7}];
 for(const value of refused)assert.equal(validateDescribe(value,{origin}),null,JSON.stringify(value));
 assert.equal(validateDescribe({version:1,ingress:'https://other.example/ingress'},{origin}),null,'off the occupant origin');
 assert.deepEqual(validateDescribe({version:1,ingress:'https://other.example/ingress'}),{version:1,ingress:'https://other.example/ingress'},'no origin known: any HTTPS origin');
 for(const loop of ['http://localhost:8790/ingress','http://127.0.0.1:8790/ingress','https://localhost/ingress']){
  assert.equal(validateDescribe({version:1,ingress:loop}),null,`${loop} without allowLoopback`);
  assert.deepEqual(validateDescribe({version:1,ingress:loop},{allowLoopback:true}),{version:1,ingress:loop},`${loop} with allowLoopback`);
 }
 assert.equal(validateDescribe({version:1,ingress:'http://box.example/ingress'},{allowLoopback:true}),null,'allowLoopback never admits plain HTTP elsewhere');
});

// ---- The real AccountController: KEY_DELEGATION_ENABLED, never LINKS_ENABLED, and the real declaration rows ----
function snapshot(host){
 const clientId=`https://${host}/bindle/client.json`,redirectUris=[`https://${host}/bindle/callback`],jwksUri=`https://${host}/bindle/jwks.json`;
 const r=validateIntegrationManifest({v:1,resources:{rpc_endpoint:`https://${host}/bindle/rpc`,discovery_endpoint:`https://${host}/bindle/resources`,contracts:[MAILBOX]}},{clientId,confidential:true,redirectUris,jwksUri});assert.equal(r.status,'valid',r.reason);
 return {client:{id:clientId,name:host,origin:`https://${host}`},snapshot:{clientId,redirectUris,authMethod:'private_key_jwt',jwksUri,thumbprints:['A'.repeat(43)],manifest:r.manifest}};
}
async function account(t,overrides={}){
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());
 // No PROVIDER_FEATURE_DECLARATIONS override: the account side evaluates the real manifest rows. MESSAGING_DESCRIBE is the
 // mount evidence; the describe itself goes through the brokered path, which these connections have no record for.
 const config={APP_ORIGIN:ISSUER,KEY_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),...FLAGS,MESSAGING_DESCRIBE:async()=>{throw Object.assign(new Error('unused'),{code:'recipient_unavailable'});},IDENTITY_ACCOUNT:async owner=>owner===OWNER?{status:'active',handle:'alice'}:null,...overrides};
 const bucket={put:async()=>{},get:async()=>null,delete:async()=>{}};
 const a=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,config,sql:db.sql});await a.touch(OWNER);
 const sys=(operation,input)=>a.connectionsSystem(OWNER,{operation,input}),own=(operation,input,authTime=Date.now())=>a.connectionsOwner(OWNER,{operation,input},{authTime});
 const occupant=()=>a.delegationSlotOccupant({owner:OWNER,fragment:MESSAGING_INGRESS_FRAGMENT});
 const feature=async()=>(await own('connections.features')).find(x=>x.feature===FEATURE);
 const connect=async host=>sys('connections.connect',snapshot(host));
 const assign=async(c,{approve=true}={})=>(await own('connections.assign',{fragment:MESSAGING_INGRESS_FRAGMENT,connection:c.id,purposes:ALL,replace:true,...approve&&(await feature())?.state==='active'?{approve:[FEATURE]}:{}})).values[0];
 const ingress=(c,seat,host)=>sys('connections.set-ingress',{fragment:MESSAGING_INGRESS_FRAGMENT,seat,generation:c.generation,ingress:`https://${host}/ingress`});
 const key=async()=>{const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {kty,crv,x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty,crv,x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};};
 const issue=async(clientId,k)=>a.delegationOperation(OWNER,{actor:{kind:'app',owner:OWNER,clientId},operation:'delegations.issue',input:{delegate:k.jwk,purposes:ALL,proof:await signDelegationPop({privateKey:k.privateKey,issuer:ISSUER,clientId,jkt:k.jkt,subject:OWNER,iat:Math.floor(Date.now()/1000)})}});
 const delegations=async()=>(await a.listDelegations(OWNER)).delegations;
 return {db,config,a,sys,own,occupant,feature,connect,assign,ingress,key,issue,delegations};
}

test('occupancy: only through the enabled, unsuspended mailbox feature with a filled field and a recorded ingress; issuance follows it', async t=>{
 const f=await account(t),box=await f.connect('box.example');
 assert.equal((await f.feature()).declared,true,'declared from the real rows without LINKS_ENABLED');
 // Feature off: a filled field is no occupant, and the Parlay purposes are refused.
 const seat=(await f.assign(box)).seat;await f.ingress(box,seat,'box.example');
 assert.equal(await f.occupant(),null,'feature not enabled');await assert.rejects(f.issue(box.clientId,await f.key()),code('forbidden'));
 // Enabled with the value: the occupant, with the recorded ingress, is certified.
 await f.own('connections.enable-feature',{feature:FEATURE});
 assert.deepEqual(await f.occupant(),{clientId:box.clientId,origin:'https://box.example',ingress:'https://box.example/ingress',cnx:`${seat}.1`,purposes:ALL});
 const k=await f.key(),issued=await f.issue(box.clientId,k);assert.deepEqual(issued.purposes,ALL);
 // Suspension (the declaration disappears: KEY_DELEGATION_ENABLED turned off) answers null; the same spec resumes.
 f.config.KEY_DELEGATION_ENABLED='false';assert.equal((await f.feature()).state,'suspended');assert.equal(await f.occupant(),null);
 f.config.KEY_DELEGATION_ENABLED='true';assert.equal((await f.feature()).state,'active');assert.equal((await f.occupant()).clientId,box.clientId);
 // Disabling revokes every delegate key at once (messaging §2.5 step 4), through the durable reconcile cascade.
 await f.own('connections.disable-feature',{feature:FEATURE});
 assert.equal(await f.occupant(),null);assert.deepEqual((await f.delegations()).map(d=>d.state),['revoked']);assert.equal((await f.a.delegationStatus(OWNER,k.jkt)).status,'revoked');
 assert.equal((await f.db.list({prefix:'connections/cascade/'})).size,0,'the cascade drained');
 // Re-enabling never revives the key; a fresh one is certified.
 await f.own('connections.enable-feature',{feature:FEATURE});await assert.rejects(f.issue(box.clientId,k),code('delegation_revoked'));
 assert.equal((await f.issue(box.clientId,await f.key())).purposes.length,3);
});

test('occupancy: an empty field, a missing ingress or another installation is never certified', async t=>{
 const f=await account(t),box=await f.connect('box.example'),other=await f.connect('other.example');
 const on=await f.own('connections.enable-feature',{feature:FEATURE});assert.deepEqual([on.state,on.approved],['active',[]]);
 assert.equal(await f.occupant(),null,'enabled over an empty field');await assert.rejects(f.issue(box.clientId,await f.key()),code('forbidden'));
 const seat=(await f.assign(box)).seat;assert.equal((await f.occupant()).ingress,null,'no describe has validated an ingress yet');
 await assert.rejects(f.issue(box.clientId,await f.key()),code('forbidden'),'no recorded ingress, no certificate');
 await f.ingress(box,seat,'box.example');await f.issue(box.clientId,await f.key());
 await assert.rejects(f.issue(other.clientId,await f.key()),code('forbidden'),'only the installation that supplies the value');
 await f.own('connections.unassign',{fragment:MESSAGING_INGRESS_FRAGMENT,seat});assert.equal(await f.occupant(),null);
 assert.ok((await f.delegations()).every(d=>d.state==='revoked'),'vacating the field revokes');
});

test('issuance gate: KEY_DELEGATION_ENABLED off refuses new certificates even with the feature enabled', async t=>{
 const f=await account(t,{KEY_DELEGATION_ENABLED:'true'}),box=await f.connect('box.example');
 await f.own('connections.enable-feature',{feature:FEATURE});const seat=(await f.assign(box)).seat;await f.ingress(box,seat,'box.example');
 f.config.KEY_DELEGATION_ENABLED='false';await assert.rejects(f.issue(box.clientId,await f.key()),code('not_found'));
 f.config.LINKS_ENABLED='true';await assert.rejects(f.issue(box.clientId,await f.key()),code('not_found'),'a configured KEY_DELEGATION_ENABLED decides alone');
});

test('chaos: across seeded owner sequences the occupant exists exactly when the feature is live and approves the filled value', async t=>{
 await forEachSeed(6,async random=>{
  const f=await account(t),hosts=['a.example','b.example'],conns={};for(const host of hosts)conns[host]=await f.connect(host);
  let model={enabled:false,declared:true,seat:null,host:null,approved:false};
  for(let step=0;step<24;step++){
   const action=random.pick(['enable','disable','assign','assign-unapproved','unassign','undeclare','declare']);
   if(action==='enable'){if(!model.declared){await assert.rejects(f.own('connections.enable-feature',{feature:FEATURE}),code('feature_unavailable'));}else{const was=model.enabled;await f.own('connections.enable-feature',{feature:FEATURE});if(!was){model.enabled=true;model.approved=model.seat!==null;}}}
   else if(action==='disable'){if((await f.feature()).state!=='off'){await f.own('connections.disable-feature',{feature:FEATURE});model.enabled=false;model.approved=false;}}
   else if(action.startsWith('assign')){const host=random.pick(hosts),approve=action==='assign';if(host===model.host){await assert.rejects(f.assign(conns[host],{approve}),code('already_assigned'));continue;}const live=(await f.feature()).state==='active';const value=await f.assign(conns[host],{approve});await f.ingress(conns[host],value.seat,host);model={...model,seat:value.seat,host,approved:live&&approve};}
   else if(action==='unassign'){if(model.seat){await f.own('connections.unassign',{fragment:MESSAGING_INGRESS_FRAGMENT,seat:model.seat});model={...model,seat:null,host:null,approved:false};}}
   else if(action==='undeclare'){f.config.KEY_DELEGATION_ENABLED='false';model.declared=false;}
   else{f.config.KEY_DELEGATION_ENABLED='true';model.declared=true;}
   const state=(await f.feature()).state,found=await f.occupant(),live=state==='active'&&model.declared;
   assert.equal(Boolean(found),live&&model.approved&&model.seat!==null,`step ${step} ${action}: state=${state} ${JSON.stringify(model)}`);
   if(found)assert.equal(found.clientId,conns[model.host].clientId);
   if(state==='suspended')assert.equal(model.declared,false);
  }
 });
});
