import test from 'node:test';import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
const window=new Window({url:'https://host.example/console?admin'}),previous={};for(const name of ['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData']){previous[name]=globalThis[name];globalThis[name]=window[name];}
const {flagFixture,activity,search}=await import('./admin-flags-fixture.mjs');
const {createScheduler,forEachSeed}=await import('../helpers/chaos.mjs');
const {Engine,Provider,dodo}=await import('../../apps/web/src/shared/stack.mjs');
const {default:State,initialAdminState}=await import('../../apps/web/src/providers/admin-state.mjs');
const bl=await import('../../apps/web/src/bl/admin-flags.mjs'),experiments=await import('../../apps/web/src/bl/admin-experiments.mjs');
const {consoleView}=await import('../../apps/web/src/admin-console.mjs');
const {createLocalization}=await import('../../packages/i18n/index.mjs');
const {default:localize}=await import('../../apps/web/src/ui/localize.mjs');
test.after(async()=>{await window.happyDOM.close();Object.assign(globalThis,previous);});
async function tab(f){
 const calls=[],api={generation:0,forget(){this.generation++;},call:async(actor,path,body)=>{calls.push({actor,path,body});if(path==='/api/admin/step-up/begin')return {passkey:true,authenticationOptions:{}};return f.call(path.split('/').at(-1),body);}},browser={now:()=>f.clock.now(),focus(){},clearSecrets(){},authenticatePasskey:async()=>({id:'verified-test-passkey'})};
 const engine=new Engine({providers:{api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),state:class extends State{constructor(){super(initialAdminState({phase:'console',mode:'admin',consoleReady:true,view:'flags',overview:{catalog:{roles:{},capabilities:{}},reservations:{runtime:[],static:[]},claims:[],featureFlags:{}}}));}}}}),snapshot=await engine.container.use(['state'],({state})=>state.snapshot);
 return {engine,api,calls,state:snapshot,read:()=>bl.flagsState(snapshot()),act:action=>engine.dispatch(action).next('complete'),close:()=>engine.dispose()};
}
const confirmation=t=>({previewAcknowledged:'on',reason:'Reviewed console edit test.',typedName:t.read().selected,...Object.fromEntries(t.read().pending.preview.requiredGates.map(g=>['gate-'+g,'on']))});
test('HTTP refuses foreign origin, GET, implicit actors, bad CSRF and forged passkey timestamps',async()=>{const f=await flagFixture();try{
 const route=async({method='POST',origin=f.env.APP_ORIGIN,actor='admin',scoped={actor,csrfToken:'test-csrf'}}={})=>adminRoute({method,origin,actor,scoped});
 async function adminRoute({method,origin,actor,scoped}){const {adminFlagsRoutes}=await import('../../packages/runtime/admin-flags-http.mjs');return adminFlagsRoutes({path:'/api/admin/flags/list',request:new Request(f.env.APP_ORIGIN+'/api/admin/flags/list',{method,headers:{Origin:origin,'X-Bindle-Admin-Actor':actor}}),env:f.env,admin:f.admin,scoped,body:async()=>({}),json:(v,status=200)=>Response.json(v,{status})});}
 assert.equal((await route({origin:'https://evil.example'})).status,403);assert.equal((await route({method:'GET'})).status,405);assert.equal((await route({actor:'owner'})).status,403);await assert.rejects(f.call('list',{}, {csrfToken:'wrong'}),{code:'csrf'});
 assert.equal((await f.call('list')).flags.length>20,true);await assert.rejects(f.call('seed',{name:activity,expectedRevision:null,stepUpAt:f.clock.now(),stepUpMethod:'passkey'}),{code:'step_up_required'});
 await assert.rejects(f.call('seed',{name:activity,expectedRevision:null,passkeyResponse:{id:'forged'}}),{code:'unauthorized'});
 }finally{await f.dispose();}});
test('client Actions seed, preview exact fractions, confirm exact gates, explain, history, rollback and cutover',async()=>{const f=await flagFixture(),t=await tab(f);try{
 await t.act(new bl.SelectFlag({name:activity}));await t.act(new bl.PreviewFlag({action:'seed'}));assert(t.read().pending.preview.critical);await t.act(new bl.ConfirmFlag({values:confirmation(t)}));assert.equal(t.read().draft.rev,1);
 const draft={...t.read().draft,on:true,rules:[{when:{shards:['01','02']},serve:{value:true,percent:1234}}]};await t.engine.container.use({state:{write:true}},({state})=>state.transition(s=>{s.overview={...s.overview,featureFlags:{...s.overview.featureFlags,draft}};}));
 await t.act(new bl.PreviewFlag());assert.deepEqual(t.read().pending.preview.impact.rules[0].percent,{numerator:1234,denominator:10000});assert.deepEqual(t.read().pending.preview.impact.rules[0].shards,{numerator:2,denominator:64});assert(t.read().pending.preview.requiredGates.length>0);
 await t.act(new bl.ConfirmFlag({values:{previewAcknowledged:'on',reason:'Reviewed this audience.',typedName:activity}}));assert.equal(t.state().error.code,'gates_unacknowledged');assert.equal(t.calls.filter(c=>c.path.endsWith('/update')).length,0);
 await t.act(new bl.ConfirmFlag({values:confirmation(t)}));assert.equal(t.read().draft.rev,2);assert(t.calls.at(-2).body.passkeyResponse);assert.equal(t.calls.at(-2).body.stepUpAt,undefined);
 await t.act(new bl.ExplainFlag({values:{}}));assert.equal(typeof t.read().explanation.reason,'string');await t.act(new bl.FlagHistory());assert.equal(t.read().history.entries.length,2);
 await t.act(new bl.PreviewFlag({action:'rollback',revision:1}));await t.act(new bl.ConfirmFlag({values:confirmation(t)}));assert.equal(t.read().draft.rev,3);assert.equal(t.read().draft.on,false);
 await t.act(new bl.VerifyFlags());assert.equal(t.read().verification.flags[activity].safeToRemove,true);
 }finally{await t.close();await f.dispose();}});
test('authority refusal wipes data, preview_stale drops acknowledgement, and keyboard rule edits preserve form changes',async()=>{const f=await flagFixture();await f.seed(activity);const t=await tab(f);try{
 await t.act(new bl.SelectFlag({name:activity}));await t.act(new bl.RuleEdit({operation:'add'}));await t.act(new bl.RuleEdit({operation:'add'}));
 const values={on:'on',fallthrough:'false',denyAccounts:'', 'rule-0-shards':'01','rule-0-value':'true','rule-0-percent':'100','rule-1-shards':'02','rule-1-value':'false','rule-1-percent':''};await t.act(new bl.RuleEdit({operation:'up',index:1,values}));assert.deepEqual(t.read().draft.rules[0].when.shards,['02']);assert.equal(t.read().draft.on,true);
 await t.act(new bl.PreviewFlag());const original=f.call;f.call=async(op,...args)=>{if(op==='update')throw Object.assign(Error('stale'),{code:'preview_stale'});return original(op,...args);};await t.act(new bl.ConfirmFlag({values:confirmation(t)}));assert.equal(t.state().error.code,'preview_stale');assert.equal(t.read().pending,null);
 f.call=async()=>{throw Object.assign(Error('denied'),{code:'forbidden'});};await t.act(new bl.LoadFlags());assert.equal(t.state().phase,'admin-denied');assert.equal(t.state().overview,null);
 }finally{await t.close();await f.dispose();}});
test('handle resolution uses the existing exact lookup API and previews only verified owner IDs',async()=>{const f=await flagFixture();await f.seed(activity);const t=await tab(f);try{
 await t.act(new bl.SelectFlag({name:activity}));const call=t.api.call,lookups=[];t.api.call=async(actor,path,body)=>{if(path==='/api/admin/users/lookup'){lookups.push(body);return {user:{id:f.actor.owner}};}return call(actor,path,body);};
 await t.engine.container.use({state:{write:true}},({state})=>state.transition(s=>{const ff=s.overview.featureFlags;s.overview={...s.overview,featureFlags:{...ff,draft:{...ff.draft,deny:{accounts:['@test-admin'],clients:[]},rules:[{when:{accounts:['test-admin']},serve:{value:true}}]}}};}));
 await t.act(new bl.PreviewFlag());assert.deepEqual(lookups,[{handle:'test-admin'}]);assert.deepEqual(t.read().pending.input.record.deny.accounts,[f.actor.owner]);assert.deepEqual(t.read().pending.input.record.rules[0].when.accounts,[f.actor.owner]);
 await t.act(new bl.ExplainFlag({values:{handle:'@test-admin'}}));assert.deepEqual(lookups.at(-1),{handle:'test-admin'});assert.equal(typeof t.read().explanation.reason,'string');
 }finally{await t.close();await f.dispose();}});
test('experiment create/start/results suppression/stop/conclude/apply winner use engine authority',async()=>{const f=await flagFixture({config:{[search]:'true'}});await f.seed(search);const t=await tab(f);try{
 await t.act(new bl.SelectFlag({name:search}));await t.act(new experiments.CreateExperiment({values:{variants:'control,treatment',weights:'1,2',percent:10000}}));assert.equal(t.state().error.code,'invalid_snapshot');
 await t.act(new experiments.CreateExperiment({values:{variants:'control,treatment',weights:'5000,5000',percent:10000}}));await t.act(new bl.ConfirmFlag({values:confirmation(t)}));assert.equal(t.read().draft.experiment.status,'draft');
 await t.act(new experiments.ExperimentLifecycle({operation:'start'}));await t.act(new bl.ConfirmFlag({values:confirmation(t)}));assert.equal(t.read().draft.experiment.status,'running');
 await t.act(new experiments.ExperimentResults());assert.equal(t.read().results.visible,false);assert.equal(t.read().results.reason,'minimum_cohort');
 await t.act(new experiments.ExperimentLifecycle({operation:'stop'}));await t.act(new bl.ConfirmFlag({values:confirmation(t)}));await t.act(new experiments.ExperimentLifecycle({operation:'conclude',values:{winner:'treatment'}}));await t.act(new bl.ConfirmFlag({values:confirmation(t)}));await t.act(new experiments.ApplyWinner());assert.equal(t.read().pending.input.record.fallthrough,true);
 }finally{await t.close();await f.dispose();}});
test('seeded two-tab client-engine chaos: one CAS winner, loser reloads, audit verifies',async()=>{await forEachSeed(8,async random=>{const scheduler=createScheduler(random),f=await flagFixture({wrap:{flagStore:store=>scheduler.wrap(store,'flagStore')}});await f.seed(activity);const tabs=await Promise.all([tab(f),tab(f)]);try{
 for(const t of tabs){await t.act(new bl.SelectFlag({name:activity}));await t.act(new bl.PreviewFlag({action:'reshuffle'}));}
 const result=await scheduler.run(tabs.map(t=>()=>t.act(new bl.ConfirmFlag({values:confirmation(t)}))));assert(result.every(r=>r.status==='fulfilled'));
 assert.equal(tabs.filter(t=>t.state().error?.code==='conflict').length,1);assert.equal((await f.call('get',{name:activity})).record.rev,2);assert.equal((await f.flagStore.verifyAudit()).valid,true);for(const t of tabs)assert.equal(t.read().list.version,2);
 }finally{for(const t of tabs)await t.close();await f.dispose();}});});
test('DOM screens localize en/es with permitted dimensions, env kill, exact gates and suppressed cells',async()=>{const f=await flagFixture({config:{[activity]:'false'}});await f.seed(activity);const t=await tab(f);try{
 await t.act(new bl.SelectFlag({name:activity}));await t.act(new bl.PreviewFlag({action:'reshuffle'}));
 for(const locale of ['en','es']){const missing=new Set(),root=document.createElement('div');dodo.reconcile(root,[localize(consoleView({...t.state(),locale}),createLocalization({locale,onMissing:(_,key)=>missing.add(key)}))]);assert(root.textContent.includes(locale==='en'?'KILL (env)':'BLOQUEO (env)'));assert.equal(root.querySelector('[name=country]')!==null,true);assert.equal(root.querySelector('[name=rule-0-countries]'),null);assert(root.querySelector('[name=previewAcknowledged]'));assert.equal(missing.size,0,[...missing].join('\n'));}
 }finally{await t.close();await f.dispose();}});
test('wargame 4 L5: the flag list shows quarantined stored records (en/es, no missing strings)',async()=>{const f=await flagFixture();await f.seed(activity);const t=await tab(f);try{
 await t.act(new bl.LoadFlags());
 await t.engine.container.use({state:{write:true}},({state})=>state.transition(s=>{const flags=s.overview.featureFlags;s.overview={...s.overview,featureFlags:{...flags,screen:'list',selected:null,list:{...flags.list,quarantined:[{name:'RETIRED_EXAMPLE_ENABLED',registered:false},{name:activity,registered:true}]}}};}));
 for(const locale of ['en','es']){const missing=new Set(),root=document.createElement('div');dodo.reconcile(root,[localize(consoleView({...t.state(),locale}),createLocalization({locale,onMissing:(_,key)=>missing.add(key)}))]);
  const alert=[...root.querySelectorAll('[role=alert]')].find(node=>node.textContent.includes('RETIRED_EXAMPLE_ENABLED'));assert.ok(alert,'quarantine notice rendered');assert.ok(alert.textContent.includes(locale==='en'?'Not in registry':'No está en el registro'));assert.ok(alert.textContent.includes(locale==='en'?'Invalid record':'Registro no válido'));assert.equal(missing.size,0,[...missing].join('\n'));}
 }finally{await t.close();await f.dispose();}});
