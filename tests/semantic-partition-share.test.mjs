// App-platform wargame round 3, F1 (2026-10-23): one account must not exhaust a shared AI budget partition.
// Ports scratch repros B/classifier-shard-budget and C/semantic-partition, plus one test per mechanism:
// per-owner partition share, separate classifier ledger, request-sized classifier cost. Review follow-ups: lease-floor
// configuration check, per-question classifier pricing, paid-or-7-day semantic admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestEngine,OWNER} from './helpers/app-engine.mjs';
import {AppConnections} from '../packages/apps/connections.mjs';
import * as C from '../packages/app/domains/connections.mjs';
import * as X from '../packages/runtime/account/classifier.mjs';
import {GlobalSemanticBudget} from '../packages/runtime/semantic-budget.mjs';
import {LeasedSemanticSpend} from '../packages/runtime/semantic-leases.mjs';
import {semanticShard,SEMANTIC_LAYOUT,semanticBudgetPartition} from '../packages/runtime/semantic-routing.mjs';
import {DurableSemanticBudget} from '../packages/search/semantic-budget.mjs';
import {methods as searchMethods,SEMANTIC_MIN_ACCOUNT_AGE_MS} from '../packages/runtime/account/search.mjs';

const ORIGIN='https://3sln.example';
function memory(){const m=new Map();const tx={get:async k=>structuredClone(m.get(k)),put:async(k,v)=>{m.set(k,structuredClone(v));},delete:async k=>m.delete(k)};return {map:m,...tx,transaction:fn=>fn(tx)};}
// Mirrors apps/worker/semantic-budget.mjs SemanticBudgetObject.reserveLease with default env totals.
function partitions(env={}){const stores=new Map();return {stores,authorityFor:async owner=>{const partition=await semanticShard(owner,SEMANTIC_LAYOUT.budgetShards);if(!stores.has(partition))stores.set(partition,memory());return {partition,authority:{reserveLease:async input=>{const grant=await new GlobalSemanticBudget({metadata:stores.get(partition),config:semanticBudgetPartition(env,partition)}).reserveLease(input);return {...grant,owner:input.owner,partition,layoutVersion:SEMANTIC_LAYOUT.version};}}};}};}
async function neighbourOf(owner){const p=await semanticShard(owner,SEMANTIC_LAYOUT.budgetShards);for(let i=0;;i++){const id=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;if(id!==owner&&await semanticShard(id,SEMANTIC_LAYOUT.budgetShards)===p)return id;}}

test('one account using its classifier allowance does not pause semantic search for its shard neighbours (engine)',async t=>{
 const system={kind:'system',owner:OWNER,clientId:'https://evil.example/app'},owner={kind:'owner',owner:OWNER};
 const partition=await semanticShard(OWNER,SEMANTIC_LAYOUT.budgetShards),neighbour=await neighbourOf(OWNER);
 const config={APP_ORIGIN:ORIGIN,INTEGRATIONS_ENABLED:true,EXTENSIONS_ENABLED:true};
 const global=await createTestEngine();t.after(()=>global.dispose());
 const authority=new GlobalSemanticBudget({metadata:global.metadata,clock:global.clock.now,config:semanticBudgetPartition({},partition)});
 const authorityFor=async id=>({partition:await semanticShard(id,SEMANTIC_LAYOUT.budgetShards),authority:{async reserveLease(input){const g=await authority.reserveLease(input);return {...g,owner:input.owner,partition:input.partition,layoutVersion:SEMANTIC_LAYOUT.version};}}});
 const spend=new LeasedSemanticSpend({metadata:global.metadata,clock:global.clock.now,authorityFor});
 const response=()=>({model:'clef-flash',answers:Object.fromEntries(X.CLASSIFIER_CATEGORIES.map(k=>[k,.01]))});
 const ai=X.classifierAI({binding:{async run(){return response();}},spend,clock:global.clock,version:'v1',eligible:async()=>true,admitWork:async()=>true});
 const e=await createTestEngine({clock:global.clock,providers:{config,ai}});t.after(()=>e.dispose());await e.metadata.put('owner',OWNER);
 const connections=new AppConnections({metadata:e.metadata,origin:ORIGIN,clock:e.clock.now,builtins:{classifier:X.CLASSIFIER_INTEGRATION}});
 const h=await createTestEngine({clock:e.clock,providers:{config,ai,accountStore:e.metadata,connections:C.connectionsProvider({connections,enabled:C.integrationsEnabled(config),account:async()=>({status:'active'})})}});t.after(()=>h.dispose());
 const perform=(Operation,input,actor=owner)=>h.perform(new Operation({actor,...input===undefined?{}:{input}}));
 const record=await perform(C.ConnectBuiltIn,{integration:'classifier'});await perform(C.OccupySlot,{slot:X.CLASSIFIER_SLOT,connection:record.id});
 let ok=0;for(let i=0;i<40;i++){try{await perform(X.ClassifierDecide,{text:'probe '+i,hints:[]},system);ok++;}catch(error){if(error.code!=='semantic_global_budget')throw error;break;}}
 assert.ok(ok>0);
 const other=await createTestEngine();t.after(()=>other.dispose());
 const neighbourSpend=new LeasedSemanticSpend({metadata:other.metadata,clock:global.clock.now,authorityFor});
 let queries=0;for(let i=0;i<50;i++){try{await neighbourSpend.reserve({owner:neighbour,operation:'query',units:1});queries++;}catch(error){if(error.code!=='semantic_global_budget')throw error;break;}}
 assert.equal(queries,50,`after ${ok} classifier calls by one account, a different account got only ${queries}/50 semantic queries`);
});

test('a single account within its classifier allowance cannot exhaust semantic admission for partition neighbours',async()=>{
 const spend=partitions(),attacker=crypto.randomUUID(),victim=await neighbourOf(attacker);
 const ai=X.classifierAI({binding:{run:async()=>({})},spend,eligible:async()=>true,admitWork:async()=>true,version:'v1'});
 let calls=0;for(;calls<X.CLASSIFIER_LIMITS.dailyCalls;calls++){try{await ai.reserve(attacker);}catch{break;}}
 const victimSpend=new LeasedSemanticSpend({metadata:memory(),authorityFor:spend.authorityFor});
 for(let i=0;i<20;i++){await assert.doesNotReject(victimSpend.reserve({owner:victim,operation:'embed',units:512}),`after ${calls} classifier calls the victim's search #${i+1} was refused`);await assert.doesNotReject(victimSpend.reserve({owner:victim,operation:'query',units:384}));}
});

test('one owner may spend only its configured share of a partition; neighbours keep the rest',async()=>{
 const metadata=memory(),config=semanticBudgetPartition({},0),budget=new GlobalSemanticBudget({metadata,config,clock:()=>Date.UTC(2026,9,23,12)});
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 let granted=0;for(let i=0;i<1000;i++){try{await budget.reserveLease({owner:a,microUSD:128,upsertSlots:0});granted+=128;}catch(error){assert.equal(error.code,'semantic_global_budget');break;}}
 const daily=config.SEMANTIC_GLOBAL_DAILY_MICRO_USD;
 assert.ok(granted<=Math.floor(daily/10),`one owner leased ${granted} of a ${daily} partition day`);assert.ok(granted>0);
 await budget.reserveLease({owner:b,microUSD:128,upsertSlots:0});
 // The share is configurable per deployment.
 const wide=new GlobalSemanticBudget({metadata:memory(),config:{...config,SEMANTIC_OWNER_SHARE_PERCENT:50},clock:()=>Date.UTC(2026,9,23,12)});let wider=0;
 for(let i=0;i<1000;i++){try{await wide.reserveLease({owner:a,microUSD:128,upsertSlots:0});wider+=128;}catch{break;}}
 assert.ok(wider>granted*4&&wider<=Math.floor(daily/2));
 assert.throws(()=>semanticBudgetPartition({SEMANTIC_OWNER_SHARE_PERCENT:'0'},0),TypeError);
 // A corrupt owner-share row fails closed.
 await metadata.put(`semantic/owner-spend/${b}`,{day:'2026-10-23',month:'2026-10',dayMicroUSD:-1,monthMicroUSD:0});
 await assert.rejects(budget.reserveLease({owner:b,microUSD:128,upsertSlots:0}),{code:'semantic_global_budget'});
});

test('classifier leases use their own ledger and never consume semantic owner admissions',async()=>{
 const metadata=memory(),budget=new GlobalSemanticBudget({metadata,config:{SEMANTIC_GLOBAL_MAX_OWNERS:'1'},clock:()=>Date.UTC(2026,9,23,12)});
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const grant=await budget.reserveLease({owner:a,microUSD:500,upsertSlots:0,ledger:'classifier'});assert.equal(grant.ledger,'classifier');
 assert.equal(await metadata.get('semantic/stock'),undefined);assert.equal(await metadata.get('semantic/day'),undefined);assert.equal((await metadata.get('classifier/day')).microUSD,500);
 // The only semantic owner admission is still available to a different account.
 await budget.reserveLease({owner:b,microUSD:128,upsertSlots:0});assert.deepEqual(await metadata.get('semantic/stock'),{owners:1,upserts:0});
 await assert.rejects(budget.reserveLease({owner:a,microUSD:0,upsertSlots:1,ledger:'classifier'}),{code:'semantic_global_budget'});
 await assert.rejects(budget.reserveLease({owner:a,microUSD:1,upsertSlots:0,ledger:'other'}),{code:'semantic_global_budget'});
});

test('classifier charges a request-sized estimate instead of a flat 1,000 microUSD',async()=>{
 const spend=partitions(),owner=crypto.randomUUID(),leases=[];
 const authorityFor=async id=>{const r=await spend.authorityFor(id);return {...r,authority:{reserveLease:async input=>{leases.push(input);return r.authority.reserveLease(input);}}};};
 const ai=X.classifierAI({binding:{run:async()=>({})},spend:{authorityFor},eligible:async()=>true,admitWork:async()=>true,version:'v1'});
 const small=X.classifierRequest({text:'hi'}),large=X.classifierRequest({text:'x'.repeat(X.CLASSIFIER_LIMITS.inputBytes)});
 assert.deepEqual(await ai.reserve(owner,small),{microUSD:X.classifierCostMicroUSD(small)});await ai.reserve(owner,large);
 assert.equal(leases[0].ledger,'classifier');assert.ok(leases[0].microUSD<leases[1].microUSD);assert.ok(leases[1].microUSD<X.CLASSIFIER_LIMITS.microUSD);
 // Review follow-up: the state is conservatively priced once per question (tokens <= bytes, $0.038 per million).
 const b=v=>new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v)).length,questions=Object.values(small.questions);
 assert.equal(X.classifierCostMicroUSD(small),Math.ceil((questions.length*b(small.state)+questions.reduce((n,q)=>n+b(q),0)+b(small.model))*0.038));
 // Worst bounded requests (escape-heavy text near the 8 KiB request cap) stay under the classifier lease ceiling.
 for(const ch of ['\u0001','"','a','\u{1F600}'])for(let n=1;n<=2000;n+=37){let r;try{r=X.classifierRequest({text:ch.repeat(n)});}catch(error){assert.doesNotMatch(error.message,/cost/);continue;}assert.ok(X.classifierCostMicroUSD(r)<=X.CLASSIFIER_LIMITS.microUSD);}
});

test('a budget whose owner share cannot hold one lease is rejected at construction',()=>{
 const metadata=memory();
 assert.throws(()=>new GlobalSemanticBudget({metadata,config:{SEMANTIC_GLOBAL_DAILY_MICRO_USD:'1270'}}),/semantic owner share is below one lease/);
 assert.throws(()=>new GlobalSemanticBudget({metadata,config:{CLASSIFIER_GLOBAL_DAILY_MICRO_USD:'29990'}}),/classifier owner share is below one lease/);
 assert.throws(()=>new GlobalSemanticBudget({metadata,config:{SEMANTIC_GLOBAL_DAILY_MICRO_USD:'2000',SEMANTIC_OWNER_SHARE_PERCENT:'5'}}),TypeError);
 // Production partition defaults hold at least one lease for each ledger.
 for(let p=0;p<SEMANTIC_LAYOUT.budgetShards;p++)new GlobalSemanticBudget({metadata,config:semanticBudgetPartition({},p)});
});

test('semantic admission requires a paid entitlement or a 7-day-old account',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,23,12)});
 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';let plan='free',reserved=0;
 const state=memory();const controller={billing:{entitlement:async()=>({plan})},metadata:state};
 await state.put('account/created-at',Date.now());
 const eligible=id=>searchMethods.semanticEligible.call(controller,id);
 const budget=new DurableSemanticBudget({state:{...state,transaction:fn=>state.transaction(fn)},configured:true,globalSpend:{reserve:async()=>{reserved++;return true;}},eligible});
 await assert.rejects(budget.consent(owner,true),{code:'semantic_search_not_eligible'});
 plan='plus';await budget.consent(owner,true);await budget.reserve(owner,'embed',{purpose:'query'});assert.equal(reserved,1);
 plan='free';await assert.rejects(budget.reserve(owner,'embed',{purpose:'query'}),{code:'semantic_search_not_eligible'});assert.equal(reserved,1,'refused before the shared ledger');
 t.mock.timers.tick(SEMANTIC_MIN_ACCOUNT_AGE_MS);await budget.reserve(owner,'embed',{purpose:'query'});assert.equal(reserved,2);
 // Accounts predating account/created-at start their clock at the first check, never earlier.
 const legacy={billing:{entitlement:async()=>({plan:'free'})},metadata:memory()};
 assert.equal(await searchMethods.semanticEligible.call(legacy,owner),false);assert.equal(await legacy.metadata.get('semantic/first-seen'),Date.now());
 t.mock.timers.tick(SEMANTIC_MIN_ACCOUNT_AGE_MS);assert.equal(await searchMethods.semanticEligible.call(legacy,owner),true);
});
