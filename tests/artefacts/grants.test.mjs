import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {federationMetadata} from '../../packages/federation/runtime.mjs';
import {configuredArtefacts,reviewedSchemaFetcher} from '../../packages/runtime/artefact-pins.mjs';
import {FederationService,PinGrantRequests,ConfigureGrantPreferences,GrantPreferenceConsumers} from '../../packages/federation/service.mjs';
import {createAppEngine,perform,read} from '../../packages/app/engine.mjs';
import {versionRecord,versionDigest} from '../../packages/core/artefacts.mjs';
import {forEachSeed,createScheduler,fakeClock} from '../helpers/chaos.mjs';
const ID='https://grants.example/preferences',issuer='https://provider.example',subject=issuer+'/entities/alice',clientId='https://app.example/client',authority={session:'owner'};
const body={id:ID,title:'Preferences',description:'Owner choices.',publisher:'https://grants.example',fields:{enabled:{title:'Enabled',type:'boolean',cardinality:{min:0,max:1}}}};
async function harness(t,{enabled=true,scheduler}={}){
 const db=new SqliteMetadata(':memory:'),clock=fakeClock(),config={ARTEFACT_VERSIONS_ENABLED:String(enabled),FEDERATION_SCHEMAS:{[ID]:body}},versions=[],digests=[];
 for(let version=1;version<=2;version++){const next=structuredClone(body);if(version===2)next.fields.extra={title:'Extra',type:'boolean',cardinality:{min:0,max:1}};const entry={version,prev:digests.at(-1)??null,body:next};versions.push(entry);digests.push(await versionDigest(versionRecord({id:ID,kind:'fragment'},entry)));}
 config.FEDERATION_SCHEMAS[ID+'/envelope']={bindle_artefact:1,id:ID,kind:'fragment',versions};
 const artefacts=configuredArtefacts({config,store:scheduler?scheduler.wrap(db,'artefacts'):db,clock});config.ARTEFACTS=artefacts;
 const service=new FederationService({issuer,store:federationMetadata(db),clock:clock.now,schemaHosts:['grants.example'],schemaFetcher:reviewedSchemaFetcher(config),authenticateOwner:async a=>{assert.equal(a,authority);return {subject,epoch:'epoch'};},clients:[{id:clientId,origin:'https://app.example',name:'App',redirectUris:['https://app.example/callback']}]});
 const engine=createAppEngine({providers:{federation:service,clock,random:{},audit:{record(){}}}});
 t.after(async()=>{await engine.dispose();await artefacts.engine.dispose();db.close();});
 const pin=version=>perform(engine,new PinGrantRequests({input:[{fragment:ID,version,digest:digests[version-1],required:true,purpose:'Read preferences',fields:['enabled']}]}));
 const configure=(version,values)=>perform(engine,new ConfigureGrantPreferences({authority,input:{fragment:ID,...version?{version,digest:digests[version-1]}:{},values}}));
 const grant=async pin=>service.store.transaction(tx=>tx.set('federation/grant/first',{id:'first',subject,clientId,fragment:ID,digest:pin.digest,...pin.version?{version:pin.version}:{},active:true,epoch:'epoch',fields:['enabled'],resources:{},methods:{}}));
 return {db,clock,config,artefacts,service,engine,pin,configure,grant,digests};
}
test('ART-5 flag off preserves legacy pins and refuses version request members',async t=>{
 const h=await harness(t,{enabled:false});await h.configure(null,{enabled:true});const legacy=await h.service.schema(ID);await h.grant(legacy);
 assert.equal((await read(h.engine,new GrantPreferenceConsumers({authority}))).preferences[0].affectedApps.length,1);
 await assert.rejects(h.pin(1),{code:'invalid_args'});assert.equal((await h.db.list({prefix:'federation/schema-version/'})).size,0);
});
test('ART-5 v1 grants remain visible after owner configures v2, without receiving v2 fields',async t=>{
 const h=await harness(t),[first]=await h.pin(1);await h.configure(1,{enabled:true});await h.grant(first);await h.configure(2,{enabled:false,extra:true});
 const preference=(await read(h.engine,new GrantPreferenceConsumers({authority}))).preferences[0];assert.deepEqual(preference.affectedApps[0].fields,['enabled']);
 await h.service.store.transaction(async tx=>{const grant=await tx.get('federation/grant/first'),out=await h.service.readPreferences(tx,{subject},[grant],{fragment:ID},'unused');assert.deepEqual(out.values,{enabled:false});assert.equal(grant.version,1);});
});
test('ART-5 existing digest grants bridge only to identical version-one bodies',async t=>{
 const h=await harness(t,{enabled:false});await h.configure(null,{enabled:true});const legacy=await h.service.schema(ID);await h.grant(legacy);h.config.ARTEFACT_VERSIONS_ENABLED='true';await h.configure(2,{enabled:false,extra:true});
 assert.equal((await read(h.engine,new GrantPreferenceConsumers({authority}))).preferences[0].affectedApps.length,1);
 await h.service.store.transaction(async tx=>{const grant=await tx.get('federation/grant/first');grant.digest='unknown';assert.equal(await h.service.referenceMatches(tx,ID,grant,await tx.get('federation/preferences/'+subject+'|'+ID)),false);});
});
test('ART-5 seeded concurrent grant, publication and owner reconfiguration preserve old field authority',async t=>{
 await forEachSeed(12,async random=>{const scheduler=createScheduler(random),h=await harness(t,{scheduler}),[first]=await h.pin(1);await h.configure(1,{enabled:true});await h.grant(first);
  const results=await scheduler.run([()=>h.pin(2),()=>h.configure(2,{enabled:false,extra:true}),()=>h.grant(first)]);assert.equal(results.filter(r=>r.status==='rejected').length,0);
  const preference=(await read(h.engine,new GrantPreferenceConsumers({authority}))).preferences[0];assert.deepEqual(preference.affectedApps[0].fields,['enabled']);assert.equal((await h.db.get('federation/grant/first')).version,1);
 });
});
test('ART-5 scalar-only additive re-grant advances the pin with owner-readable history and no new fields',async t=>{
 const h=await harness(t),[first]=await h.pin(1);await h.configure(1,{enabled:true});await h.grant(first);await h.configure(2,{enabled:true,extra:true});const [next]=await h.pin(2);
 await h.service.store.transaction(async tx=>{const approved=await h.service.priorApproval(tx,subject,'epoch',clientId,[next]);assert.deepEqual(approved[0].fields,['enabled']);const grant=await tx.get('federation/grant/first');assert.equal(grant.version,2);assert.equal(grant.pinHistory[0].from.digest,first.digest);assert.deepEqual(grant.fields,['enabled']);});
 const grant=(await h.service.grants(authority)).grants[0];assert.equal(grant.pinHistory[0].to.digest,next.digest);
});
test('ART-5 URL-only requests resolve the current head, while older configuration cannot roll the line back',async t=>{
 const h=await harness(t);await h.configure(2,{enabled:true,extra:true});
 const [latest]=await perform(h.engine,new PinGrantRequests({input:[{fragment:ID,required:true,purpose:'Read preferences',fields:['enabled']}]}));assert.equal(latest.version,2);
 await assert.rejects(h.configure(1,{enabled:false}),{code:'stale_consent'});assert.equal((await h.db.get('federation/preferences/'+subject+'|'+ID)).values.extra,true);
 await assert.rejects(perform(h.engine,new PinGrantRequests({input:[{fragment:ID,version:1,digest:'sha256-'+'A'.repeat(43),required:true,purpose:'Read preferences',fields:['enabled']}]})),{code:'artefact_digest_mismatch'});
 assert.equal((await h.db.get('federation/schema-head/'+ID)).version,2);
});
