import test from 'node:test';
import assert from 'node:assert/strict';
import {FLAGS,FLAG_NAMES,getFlag,validateRegistry,RELEASE_GATES,GATE_REVISION} from '../packages/flags/registry.mjs';
import {legacyValue,parseEnv} from '../packages/flags/env.mjs';
import {validateRecord,validateSnapshot,SNAPSHOT_MAX_BYTES} from '../packages/flags/snapshot.mjs';
import {evaluate} from '../packages/flags/evaluate.mjs';

const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const record=extra=>({rev:1,on:true,onValue:true,fallthrough:false,salt:'flag-salt',...extra});
const snapshot=flags=>({v:1,version:1,issuedAt:0,flags});
const experiment=extra=>({id:owner,status:'running',variants:[{key:'control',weight:5000},{key:'treatment',weight:5000}],eligibility:{percent:10000},variantSalt:'variant-salt',startedAt:0,...extra});

test('registry declares all 48 classifications, dimensions and operational contracts',()=>{
 assert.equal(FLAG_NAMES.length,48);assert.equal(FLAG_NAMES.filter(n=>FLAGS[n].class==='a').length,18);assert.equal(FLAG_NAMES.filter(n=>FLAGS[n].class==='c').length,10);
 for(const f of Object.values(FLAGS)){assert.ok(Object.isFrozen(f));assert.equal(typeof f.safe,'boolean');assert.equal(f.type,'boolean');assert.equal(f.gateRevision,GATE_REVISION);assert.match(GATE_REVISION,/^[a-f0-9]{64}$/);assert.ok(f.gates.length);assert.ok(f.gates.every(g=>RELEASE_GATES.includes(g)));if(!['ACCOUNT_EXPORT_ENABLED','ACCOUNT_DELETION_ENABLED','EMAIL_REMOVAL_ENABLED','IDENTITY_TRANSFER_OUT_ENABLED'].includes(f.name))assert.deepEqual(f.gates,RELEASE_GATES);assert.ok(f.gateReferences[0].includes('open-items.md#2-'));assert.ok(['edge','account'].includes(f.placement));if(f.stateful){assert.equal(f.placement,'account');if(f.retainExisting)assert.equal(f.hasState,f.name);else assert.ok(f.retentionReason);assert.ok(!f.dimensions.includes('R'));}if(f.experiment){assert.equal(f.risk,'std');assert.ok(f.dimensions.includes('V'));assert.ok(f.experiment.metrics.length<=5);}}
 assert.deepEqual(FLAGS.INCREMENTAL_AUTH_ENABLED.requires,['FEDERATION_ENABLED']);assert.deepEqual(FLAGS.EMAIL_BRIDGE_ENABLED.requires,['BINDLEBOX_ENABLED']);assert.deepEqual(FLAGS.DEVICE_AUTHORIZATION_ENABLED.requires,[]);assert.equal(FLAGS.BROKERING_ENABLED.dependencyMode,'global');assert.equal(FLAGS.LIFECYCLE_DRY_RUN.narrowOnly,true);
 assert.throws(()=>getFlag('toString'),{code:'unknown_flag'});assert.throws(()=>getFlag('MISSING'),{code:'unknown_flag'});
 assert.throws(()=>validateRegistry({A:{requires:['B'],dimensions:[]},B:{requires:['A'],dimensions:[]}}),/cycle/);assert.throws(()=>validateRegistry({A:{requires:['B'],dimensions:[]}}),/Unknown flag dependency/);
});

// Pins the actual raw predicates used by today's helpers; bindings, paid
// entitlements and transport readiness remain separate adapter capabilities.
const pins={
 ARTEFACT_VERSIONS_ENABLED:'boolean',ACTIVITY_V2_ENABLED:'boolean',EVENT_BUSES_ENABLED:'boolean',INTEGRATIONS_ENABLED:'boolean',APP_CLEAN_REMOVAL_ENABLED:'boolean',SUBJECT_DELETED_EVENTS_ENABLED:'boolean',INCREMENTAL_AUTH_ENABLED:'boolean',EXTENSIONS_ENABLED:'boolean',BINDLEBOX_ENABLED:'boolean',EMAIL_BRIDGE_ENABLED:'boolean',SEMANTIC_SEARCH_ENABLED:'string',BEAM_ENABLED:'string',DEVICE_AUTHORIZATION_ENABLED:'boolean',APP_METADATA_DISCOVERY_ENABLED:'string',ACCOUNT_EXPORT_ENABLED:'boolean',ACCOUNT_DELETION_ENABLED:'boolean',EMAIL_REMOVAL_ENABLED:'boolean',IDENTITY_TRANSFER_OUT_ENABLED:'boolean',SIGNUP_ENABLED:'string',PAID_SIGNUP_ENABLED:'string',WAITLIST_ENABLED:'string',FEDERATION_ENABLED:'string',BROKERING_ENABLED:'boolean',MCP_ENABLED:'string',CLIENT_METADATA_ENABLED:'string',IDENTITY_TRANSFER_IN_ENABLED:'boolean',IDENTITY_SUCCESSOR_ADOPTION_ENABLED:'boolean',LIFECYCLE_DRY_RUN:'not-false-boolean',LIFECYCLE_ENABLED:'boolean',LIFECYCLE_PURGE_ENABLED:'string',WORK_LIMITS_ENABLED:'work-authority',STORAGE_WRITE_ENABLED:'boolean',BILLING_ENABLED:'string',MAIL_ENABLED:'string',PUSH_ENABLED:'string',BEAM_TURN_ENABLED:'string',BEAM_STUN_ENABLED:'string',FEDERATION_REFRESH_ENABLED:'not-false',FEDERATION_ENTRY_ENABLED:'string',ONBOARDING_ENABLED:'string',ADMIN_ENABLED:'string',ADMIN_CLAIMS_ENABLED:'true-only',BROKERED_INTROSPECTION_MOUNTED:'true-only',EVENT_BUS_WAITS_MOUNTED:'true-only',PUSH_AVAILABLE:'true-only',EMAIL_AVAILABLE:'true-only',EMAIL_SETUP_AVAILABLE:'true-only',WAITLIST_MAIL_AVAILABLE:'true-only'
};
const oldPredicate=(mode,value)=>mode==='not-false'?value!=='false':mode==='not-false-boolean'?value!=='false'&&value!==false:mode==='true-only'?value===true:mode==='boolean'||mode==='work-authority'?value===true||value==='true':value==='true';
test('account data flags exactly match the reviewed gates, remain default off and reject experiments/region targeting',()=>{
 const gates={ACCOUNT_EXPORT_ENABLED:['termsAndPrivacyApproved','realBrowserFlowsPassing','durableStorageAndArchiveRecoveryVerified','notificationTransportsVerified','securityRedTeamFindingsResolved'],ACCOUNT_DELETION_ENABLED:['termsAndPrivacyApproved','realBrowserFlowsPassing','lifecycleNoticesAndDeletionVerified','emailLifecycleVerified','notificationTransportsVerified','durableStorageAndArchiveRecoveryVerified','securityRedTeamFindingsResolved'],EMAIL_REMOVAL_ENABLED:['termsAndPrivacyApproved','realBrowserFlowsPassing','emailLifecycleVerified','lifecycleNoticesAndDeletionVerified']};
 for(const [name,expected]of Object.entries(gates)){const flag=FLAGS[name];assert.deepEqual(flag.gates,expected);assert.deepEqual(flag.dimensions,['G','A','S','P']);assert.equal(flag.class,'a');assert.equal(flag.safe,false);assert.equal(flag.risk,'crit');assert.equal(flag.envParse,'boolean');assert.equal(flag.experiment,null);assert.equal(evaluate(name,{},snapshot({}),{}).value,false);assert.throws(()=>validateRecord(name,record({experiment:experiment()})));assert.throws(()=>validateRecord(name,record({rules:[{when:{countries:['US']},serve:{value:true}}]})));}
 for(const name of ['ACCOUNT_EXPORT_ENABLED','ACCOUNT_DELETION_ENABLED']){assert.equal(FLAGS[name].stateful,true);assert.equal(FLAGS[name].retainExisting,true);assert.equal(FLAGS[name].hasState,name);}
 assert.equal(FLAGS.EMAIL_REMOVAL_ENABLED.stateful,false);
});
test('identity transfer-out flag is default off, crit, stateful without retention and gated as designed',()=>{
 const flag=FLAGS.IDENTITY_TRANSFER_OUT_ENABLED;
 assert.deepEqual(flag.gates,['termsAndPrivacyApproved','realBrowserFlowsPassing','securityRedTeamFindingsResolved','lifecycleNoticesAndDeletionVerified','notificationTransportsVerified']);
 assert.equal(flag.class,'a');assert.equal(flag.risk,'crit');assert.equal(flag.safe,false);assert.deepEqual(flag.dimensions,['G','A','S','P']);assert.equal(flag.envParse,'boolean');assert.equal(flag.experiment,null);
 assert.equal(flag.stateful,true);assert.equal(flag.retainExisting,false);assert.equal(flag.hasState,undefined);assert.match(flag.retentionReason,/env kill switch/);assert.deepEqual(flag.requires,[]);
 assert.equal(evaluate('IDENTITY_TRANSFER_OUT_ENABLED',{},snapshot({}),{}).value,false);assert.throws(()=>validateRecord('IDENTITY_TRANSFER_OUT_ENABLED',record({experiment:experiment()})));
});
test('identity transfer-in and successor adoption flags are default off, crit, global class c',()=>{
 const transferIn=FLAGS.IDENTITY_TRANSFER_IN_ENABLED,adoption=FLAGS.IDENTITY_SUCCESSOR_ADOPTION_ENABLED;
 for(const flag of [transferIn,adoption]){assert.equal(flag.class,'c');assert.equal(flag.risk,'crit');assert.equal(flag.safe,false);assert.deepEqual(flag.dimensions,['G']);assert.equal(flag.envParse,'boolean');assert.equal(flag.experiment,null);assert.equal(flag.stateful,false);assert.deepEqual(flag.gates,RELEASE_GATES);assert.equal(evaluate(flag.name,{},snapshot({}),{}).value,false);}
 assert.deepEqual(transferIn.requires,['SIGNUP_ENABLED']);assert.deepEqual(adoption.requires,[]);
 assert.equal(evaluate('IDENTITY_TRANSFER_IN_ENABLED',{},snapshot({}),{IDENTITY_TRANSFER_IN_ENABLED:'true'}).value,false,'requires signup');
 assert.equal(evaluate('IDENTITY_TRANSFER_IN_ENABLED',{},snapshot({}),{IDENTITY_TRANSFER_IN_ENABLED:'true',SIGNUP_ENABLED:'true'}).value,true);
});
test('table pins every legacy raw predicate and empty-snapshot behaviour',()=>{
 assert.deepEqual(Object.keys(pins),FLAG_NAMES);
 const values=[undefined,'','true','false',true,false,'TRUE','typo',0,null],empty=snapshot({});
 for(const [name,mode]of Object.entries(pins))for(const value of values){const env=value===undefined?{}:{[name]:value},expected=oldPredicate(mode,value);assert.equal(legacyValue(name,env),expected,`${name} raw=${String(value)}`);if(FLAGS[name].class==='b')assert.equal(evaluate(name,{},empty,env).value,expected,name);}
 const ready={...Object.fromEntries(FLAG_NAMES.map(name=>[name,'true'])),POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'local-token',POLAR_WEBHOOK_SECRET:'local-secret',POLAR_PRODUCT_ID_PAID:'paid',POLAR_PRODUCT_ID_PLUS:'plus',POLAR_PRODUCT_ID_ULTRA:'ultra'};
 for(const [name,mode]of Object.entries(pins))for(const value of values){const env={...ready,[name]:value};assert.equal(evaluate(name,{},empty,env).value,oldPredicate(mode,value),`empty snapshot ${name} raw=${String(value)}`);}
 assert.equal(legacyValue('WORK_LIMITS_ENABLED',{WORK_AUTHORITY:{}}),true);
 assert.equal(legacyValue('FEDERATION_REFRESH_ENABLED',{}),true);assert.equal(legacyValue('FEDERATION_REFRESH_ENABLED',{FEDERATION_REFRESH_ENABLED:false}),true);
 assert.equal(legacyValue('STORAGE_WRITE_ENABLED',{}, {platform:'node'}),true);assert.equal(legacyValue('WORK_LIMITS_ENABLED',{}, {platform:'node'}),true);assert.equal(legacyValue('BEAM_STUN_ENABLED',{}, {platform:'node'}),true);
 for(const name of FLAG_NAMES.filter(n=>FLAGS[n].class!=='b')){assert.equal(parseEnv(name,{},false,{platform:'node'}).state,'unset');assert.equal(evaluate(name,{},empty,{}, {platform:'node'}).value,FLAGS[name].safe);}
});

test('env state precedence includes ignored unsafe values, invalid kills and inverted dry run',()=>{
 for(const [raw,present,state,value]of [[undefined,false,'unset',false],['',false,'unset',false],['false',false,'kill',false],['true',false,'force-on-legacy',true],['true',true,'ignored',true],['typo',true,'invalid',false]])assert.deepEqual([parseEnv('BEAM_ENABLED',{BEAM_ENABLED:raw},present).state,parseEnv('BEAM_ENABLED',{BEAM_ENABLED:raw},present).value],[state,value]);
 assert.equal(parseEnv('BEAM_ENABLED',{BEAM_ENABLED:true}).state,'invalid');assert.equal(parseEnv('ACTIVITY_V2_ENABLED',{ACTIVITY_V2_ENABLED:true}).state,'force-on-legacy');
 assert.equal(parseEnv('LIFECYCLE_DRY_RUN',{LIFECYCLE_DRY_RUN:'true'}).state,'kill');assert.equal(parseEnv('LIFECYCLE_DRY_RUN',{LIFECYCLE_DRY_RUN:false}).state,'force-on-legacy');
 assert.equal(evaluate('LIFECYCLE_DRY_RUN',{},snapshot({}),{LIFECYCLE_DRY_RUN:'false'}).value,false);
 assert.equal(evaluate('LIFECYCLE_DRY_RUN',{},snapshot({LIFECYCLE_DRY_RUN:record({fallthrough:true})}),{LIFECYCLE_DRY_RUN:'false'}).value,true);
});

test('validator rejects class b writes, disallowed dimensions, malformed and narrow-only records',()=>{
 const reject=(name,r)=>assert.throws(()=>validateRecord(name,r),{code:'invalid_snapshot'});
 reject('BILLING_ENABLED',record());reject('LIFECYCLE_DRY_RUN',record());reject('LIFECYCLE_DRY_RUN',record({fallthrough:true,rules:[{when:{},serve:{value:false}}]}));
 reject('BEAM_ENABLED',record({rules:[{when:{countries:['US']},serve:{value:true}}]}));reject('FEDERATION_ENABLED',record({rules:[{when:{accounts:[owner]},serve:{value:true}}]}));reject('BEAM_ENABLED',record({deny:{clients:['https://client.example']}}));
 for(const bad of [null,{},[],record({on:'true'}),record({salt:''}),record({unknown:true}),record({deny:null}),record({deny:{accounts:null}}),record({rules:null}),record({retainExisting:null}),record({rules:[{when:{},serve:{value:true,percent:10001}}]}),record({rules:[{when:{window:{from:10,until:10}},serve:{value:true}}]}),record({rules:[{when:{shards:[64]},serve:{value:true}}]}),record({rules:[{when:{accounts:['handle']},serve:{value:true}}]}),record({rules:Array.from({length:33},()=>({when:{},serve:{value:true}}))})])reject('BEAM_ENABLED',bad);
 reject('APP_METADATA_DISCOVERY_ENABLED',record({rules:[{when:{},serve:{value:true,percent:100}}]}));assert.ok(validateRecord('APP_METADATA_DISCOVERY_ENABLED',record({rules:[{when:{clients:['https://client.example']},serve:{value:true,percent:100}}]})));
 reject('SEMANTIC_SEARCH_ENABLED',record({retainExisting:true}));reject('INTEGRATIONS_ENABLED',record({experiment:experiment()}));
 for(const e of [experiment({variants:[{key:'a',weight:1},{key:'b',weight:1}]}),experiment({variants:[{key:'same',weight:5000},{key:'same',weight:5000}]}),experiment({eligibility:{percent:-1}}),experiment({eligibility:{percent:10000,when:{countries:['US']}}}),experiment({startedAt:undefined}),experiment({winner:'missing'})])reject('BEAM_ENABLED',record({experiment:e}));
 const mutable=record({rules:[{when:{accounts:[owner]},serve:{value:true}}]}),validated=validateRecord('BEAM_ENABLED',mutable);mutable.rules[0].when.accounts.push(other);assert.deepEqual(validated.rules[0].when.accounts,[owner]);assert.ok(Object.isFrozen(validated.rules));
});

test('snapshot validation limits total lists, bytes, schema and frozen experiment fields',()=>{
 for(const value of [undefined,null,{},[],{...snapshot({}),v:2},{...snapshot({}),version:-1},snapshot({UNKNOWN:record()}),{...snapshot({}),extra:true}])assert.throws(()=>validateSnapshot(value));
 const ids=Array.from({length:1001},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);assert.throws(()=>validateRecord('BEAM_ENABLED',record({deny:{accounts:ids}})),/Too many/);
 const clients=Array.from({length:200},(_,i)=>`https://client${i}.example/${'x'.repeat(1500)}`);assert.ok(JSON.stringify(clients).length>SNAPSHOT_MAX_BYTES);assert.throws(()=>validateSnapshot(snapshot({INTEGRATIONS_ENABLED:record({deny:{clients}})})),/256 KiB/);
 const before=record({experiment:experiment()}),check=after=>validateRecord('BEAM_ENABLED',after,{before});
 for(const edit of [{salt:'new'},{experiment:experiment({variantSalt:'new'})},{experiment:experiment({eligibility:{percent:9000}})},{experiment:experiment({variants:[{key:'a',weight:5000},{key:'b',weight:5000}]})},{experiment:experiment({id:other})},{experiment:null}])assert.throws(()=>check({...before,...edit}),/frozen/);
 assert.ok(check({...before,rev:2,fallthrough:true}));assert.ok(check({...before,experiment:experiment({status:'stopped',stoppedAt:1})}));
 const input=snapshot({BEAM_ENABLED:before}),compiled=validateSnapshot(input);assert.equal(validateSnapshot(compiled),compiled);input.flags.BEAM_ENABLED.salt='changed';assert.equal(compiled.flags.BEAM_ENABLED.salt,'flag-salt');
});

test('app removal flags are default off, critical and dependency-bound; pending work never relies on retained enrollment',()=>{
 for(const name of ['APP_CLEAN_REMOVAL_ENABLED','SUBJECT_DELETED_EVENTS_ENABLED']){const f=FLAGS[name];assert.equal(f.class,'a');assert.equal(f.safe,false);assert.equal(f.risk,'crit');assert.equal(f.envParse,'boolean');assert.deepEqual(f.requires,['INTEGRATIONS_ENABLED']);assert.equal(evaluate(name,{},snapshot({}),{}).value,false);assert.equal(f.experiment,null);assert.throws(()=>validateRecord(name,record({experiment:experiment()})));}
 assert.deepEqual(FLAGS.APP_CLEAN_REMOVAL_ENABLED.dimensions,['G','A','S','P','C']);assert.equal(FLAGS.APP_CLEAN_REMOVAL_ENABLED.stateful,true);assert.equal(FLAGS.APP_CLEAN_REMOVAL_ENABLED.retainExisting,false);assert.match(FLAGS.APP_CLEAN_REMOVAL_ENABLED.retentionReason,/always conclude/);assert.deepEqual(FLAGS.SUBJECT_DELETED_EVENTS_ENABLED.dimensions,['G']);assert.equal(FLAGS.SUBJECT_DELETED_EVENTS_ENABLED.stateful,false);
});
