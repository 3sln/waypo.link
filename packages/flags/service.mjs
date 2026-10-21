/**
 * FF-2 provider contract. Construct with {store:AdminStorage,env,clock,randomId?,
 * onCommit?}; env is server configuration, never mutation input. All public
 * operations take (input,context). context is adapter-verified, not request JSON:
 * {actor:{kind:'admin'|'boot',expect:{principalKey:revision,...},rate?,audit?},
 * stepUpAt:epochMs,stepUpMethod:'passkey',internalAccounts?:Set<verified UUID>}.
 * The principal expectation is mandatory and participates in the same commit;
 * expect may also bind catalog, session and verified internal-provenance claims.
 * Adapters must establish authority/provenance; this service rechecks freshness.
 *
 * Mutations: seed, takeControl, update, rollback, reshuffle, experimentStart,
 * experimentStop, experimentConclude. Input: {name,expectedRevision,expectedVersion?,
 * reason?,typedName?,previewDigest?,acknowledgeGates?,record? (update only),
 * revision? (rollback only),winner? (conclude only)}. Creation expects null.
 * preview takes the same input plus action (default 'update'), returning digest,
 * critical, requiredGates and impact. It never mints salts/IDs or writes state.
 * Critical mutations require that digest; server-generated randomness and times
 * are represented by markers in it, while intent, snapshot, env and impact bind it.
 * Returns {name,record,revision,version,audit}; history returns {name,entries}.
 * seed is per flag, refuses existing records (no overwrite or duplicate audit).
 * Queries: list, get, history, preview, seedVerify, explain, evaluate, snapshot.
 * FF-3 owns the ngin Actions/Queries wrapping this provider; no nested dispatch.
 */
import {FLAGS,getFlag,GATE_REVISION} from './registry.mjs';
import {validateRecord,validateSnapshot} from './snapshot.mjs';
import {evaluate,evaluateGlobal} from './evaluate.mjs';
import {legacyValue,parseEnv} from './env.mjs';
import {widens} from './widen.mjs';
import {canonical,UUID} from '../core/primitives.mjs';
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status});};
const same=(a,b)=>canonical(a)===canonical(b),own=(x,key)=>Object.hasOwn(x??{},key);
const consoleFlags=Object.values(FLAGS).filter(f=>f.class!=='b'),marker='server-generated-salt',idMarker='00000000-0000-4000-8000-000000000000';
const actions=['seed','take-control','update','rollback','reshuffle','experiment-start','experiment-stop','experiment-conclude'];
const common=['name','expectedRevision','expectedVersion','reason','typedName','previewDigest','acknowledgeGates'];
const extras={update:['record'],rollback:['revision'],'experiment-conclude':['winner']};
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
const revision=x=>x===null||Number.isSafeInteger(x)&&x>0;
const empty=(f,salt)=>({rev:0,on:false,onValue:f.onValue,fallthrough:f.safe,salt,retainExisting:false,deny:{accounts:[],clients:[]},rules:[],experiment:null});
/** Fixed, non-user matrix. No owner/region input to seed verification. */
export function seedContexts(now){return [{kind:'anonymous'},{kind:'system',reason:'seed-verify'},...['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'].map(owner=>({kind:'account',owner}))].flatMap(subject=>[null,{clientId:'https://client.example'},{clientId:'https://other.example'}].flatMap(client=>[{country:'unknown'},{country:'US',subdivision:'TX'},{country:'US',subdivision:'CA'},{country:'MX',subdivision:'YUC'},{country:'DE',subdivision:'BE'}].map(region=>({subject,client,region,now}))));}
export class FlagService {
 constructor({store,env={},config,clock=()=>Date.now(),randomId=()=>crypto.randomUUID(),onCommit,platform='worker'}={}){if(!store?.flagsSnapshot||!store?.get||!store?.commit)throw new TypeError('Flag storage is required');Object.assign(this,{store,env:config??env,clock,randomId,onCommit,platform});}
 authority(context,mutation=false){
  const actor=context?.actor;if(!actor||!['admin','boot'].includes(actor.kind))fail('actor_required','Choose an explicit administrator or boot actor.',403);
  const key=actor.kind==='boot'?'boot/principal':typeof actor.owner==='string'&&UUID.test(actor.owner)?'principal/'+actor.owner:null;
  if(!key||!own(actor.expect,key)||!revision(actor.expect[key])||Object.entries(actor.expect).some(([k,v])=>!revision(v)||!/^(?:boot\/(?:principal|sessions)|catalog|(?:principal|claim)\/[a-f0-9-]{36})$/.test(k)))fail('actor_required','Provide verified principal revision expectations.',403);
  const now=this.clock();if(mutation&&(!Number.isSafeInteger(context.stepUpAt)||context.stepUpAt>now||context.stepUpAt+300000<=now))fail('step_up_required','A fresh passkey step-up is required.',403);
  if(mutation&&context.stepUpMethod!=='passkey')fail('step_up_required','A fresh passkey step-up is required.',403);
  return actor;
 }
 async snapshot(){return validateSnapshot(await this.store.flagsSnapshot());}
 async state(){const snapshot=await this.snapshot(),head=await this.store.get('flags-head');if((head?.version??0)!==snapshot.version)fail('conflict','Flags changed; reload and try again.',409);return {snapshot,head};}
 checkInput(input,action){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>![...common,...extras[action]??[]].includes(k)))fail('invalid_request','Unexpected flag mutation fields.');getFlag(input.name);if(!own(input,'expectedRevision')||!revision(input.expectedRevision)||own(input,'expectedVersion')&&(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0))fail('invalid_request','Provide the expected flag revision.');}
 async proposal(input,action,snapshot,now){
  this.checkInput(input,action);const f=getFlag(input.name),before=snapshot.flags[f.name]??null;
  if(f.class==='b')fail('invalid_snapshot','Env-only capabilities cannot have console records.');
  if(input.expectedRevision!==(before?.rev??null)||own(input,'expectedVersion')&&input.expectedVersion!==snapshot.version)fail('conflict','Flags changed; reload and try again.',409);
  let next;
  if(['seed','take-control'].includes(action)){
   if(before)fail('already_managed','The flag already has a console record.',409);
   next=empty(f,marker);const state=parseEnv(f.name,this.env,false,{platform:this.platform});if(state.state==='force-on-legacy'){next.on=true;next.fallthrough=f.onValue;}
   if(action==='seed'){
    const candidate=validateSnapshot({...snapshot,flags:{...snapshot.flags,[f.name]:next}});
    if(seedContexts(now).some(ctx=>evaluate(f.name,ctx,snapshot,this.env,{platform:this.platform}).value!==evaluate(f.name,ctx,candidate,this.env,{platform:this.platform}).value))fail('seed_mismatch','This env state cannot be preserved by a console record.',409);
   }
  }else{
   if(!before)fail('not_managed','Take control of this flag first.',409);
   next=structuredClone(before);
   if(action==='update'){
    if(!input.record||typeof input.record!=='object'||Array.isArray(input.record))fail('invalid_request','Provide the complete flag record.');
    next={...input.record};if(own(next,'rev')&&next.rev!==before.rev)fail('conflict','The submitted record revision changed.',409);
    if(next.salt!==before.salt)fail('invalid_state','Use the separate reshuffle action to change the salt.',409);
    const old=before.experiment,e=next.experiment??null;
    if(old?.status==='running'&&!same(old,e)||e&&e.status!=='draft'&&!same(old,e))fail('invalid_state','Use experiment lifecycle actions to change experiment state.',409);
   }else if(action==='rollback'){
    if(!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>=before.rev)fail('invalid_request','Choose a prior flag revision.');
    const prior=await this.store.get(`flag-rev/${f.name}/${input.revision}`);if(!prior)fail('revision_unavailable','That revision is no longer retained.',404);next=structuredClone(prior.record);
    if(next.experiment?.status==='running'&&!same(before.experiment,next.experiment))fail('invalid_state','Rollback cannot restart a historical experiment.',409);
   }else if(action==='reshuffle')next.salt=marker;
   else if(action==='experiment-start'){
    if(!f.experiment||!before.on||before.experiment?.status!=='draft')fail('invalid_state','Only an enabled flag with a draft experiment can start.',409);
    if(Object.values(snapshot.flags).filter(r=>r.experiment?.status==='running').length>=3)fail('experiment_limit','At most three experiments may run.',409);
    next.experiment={...before.experiment,id:idMarker,variantSalt:marker,status:'running',startedAt:now};delete next.experiment.stoppedAt;delete next.experiment.concludedAt;delete next.experiment.winner;
   }else if(action==='experiment-stop'){
    if(before.experiment?.status!=='running')fail('invalid_state','Only a running experiment can stop.',409);next.experiment={...before.experiment,status:'stopped',stoppedAt:now};
   }else if(action==='experiment-conclude'){
    if(before.experiment?.status!=='stopped'||!before.experiment.variants.some(v=>v.key===input.winner))fail('invalid_state','Choose a winner for a stopped experiment.',409);next.experiment={...before.experiment,status:'concluded',concludedAt:now,winner:input.winner};
   }
  }
  next.rev=(before?.rev??0)+1;next=validateRecord(f.name,next,{before});validateSnapshot({...snapshot,version:snapshot.version+1,issuedAt:now,flags:{...snapshot.flags,[f.name]:next}});
  return {f,before,next};
 }
 impact(f,next,snapshot){
  const candidate={...snapshot,flags:{...snapshot.flags,[f.name]:next}},envState=parseEnv(f.name,this.env,true,{platform:this.platform}),warnings=[];
  if(['kill','invalid'].includes(envState.state))warnings.push('env-kill');if(envState.state==='ignored')warnings.push('env-ignored');
  const dependencies=f.requires.map(name=>({name,revision:snapshot.flags[name]?.rev??null,global:evaluateGlobal(name,snapshot,this.env).value}));if(dependencies.some(d=>d.global===getFlag(d.name).safe))warnings.push('dependency');
  const rules=next.rules.map(r=>({percent:r.serve.percent===undefined?null:{numerator:r.serve.percent,denominator:10000},shards:r.when.shards?{numerator:new Set(r.when.shards.map(Number)).size,denominator:64}:null,accounts:r.when.accounts?.length??0,clients:r.when.clients?.length??0,region:r.when.countries||r.when.subdivisions?'unknown fraction':null}));
  const e=next.experiment,experiment=e?{status:e.status,eligibility:{numerator:e.eligibility.percent,denominator:10000},variants:e.variants.map(v=>({key:v.key,numerator:v.weight,denominator:10000})),settingsFrozen:e.status==='running'}:null;
  return {on:next.on,fallthrough:next.fallthrough,rules,deny:{accounts:next.deny.accounts?.length??0,clients:next.deny.clients?.length??0},experiment,dependencies,envState:envState.state,warnings,beforeGlobal:evaluateGlobal(f.name,snapshot,this.env).value,afterGlobal:evaluateGlobal(f.name,candidate,this.env).value};
 }
 async previewFor(input,action,state,context,now){
  const {f,before,next}=await this.proposal(input,action,state.snapshot,now),openGates=this.env.RELEASE_READY==='true'?[]:[...f.gates].sort(),widening=action==='seed'?false:widens(before,next,{name:f.name,internalAccounts:context.internalAccounts}),requiredGates=widening?openGates:[],critical=f.risk==='crit'||openGates.length>0||before&&next.salt!==before.salt||['seed','take-control','reshuffle','experiment-start'].includes(action),impact=this.impact(f,next,state.snapshot);
  const normalized=structuredClone(next);if(action==='experiment-start')normalized.experiment.startedAt='server-time';if(action==='experiment-stop')normalized.experiment.stoppedAt='server-time';if(action==='experiment-conclude')normalized.experiment.concludedAt='server-time';
  const preview={name:f.name,action,version:state.snapshot.version,expectedRevision:before?.rev??null,record:next,critical,widens:widening,openGates,requiredGates,impact};
  preview.digest=await digest({name:f.name,action,version:state.snapshot.version,before,after:normalized,critical,requiredGates,impact,env:Object.fromEntries(Object.entries(this.env).filter(([name])=>own(FLAGS,name)||name==='RELEASE_READY').sort(([a],[b])=>a.localeCompare(b))),gateRevision:GATE_REVISION});return preview;
 }
 async preview(input,context){this.authority(context);const {action='update',...change}=input??{};if(!actions.includes(action))fail('invalid_request','Unknown flag action.');return this.previewFor(change,action,await this.state(),context,this.clock());}
 async mutate(action,input,context){
  if(!actions.includes(action))fail('invalid_request','Unknown flag action.');
  const actor=this.authority(context,true),now=this.clock(),state=await this.state(),preview=await this.previewFor(input,action,state,context,now),{name,critical}=preview;
  if(critical){if(typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>500)fail('reason_required','Provide a reason of 10–500 characters.');if(input.typedName!==name)fail('typed_name_required','Type the exact flag name.');if(input.previewDigest!==preview.digest)fail('preview_stale','Preview changed; review the new impact.',409);}
  else if(input.reason!==undefined&&(typeof input.reason!=='string'||input.reason.length>500)||input.typedName!==undefined&&(typeof input.typedName!=='string'||input.typedName.length>80))fail('invalid_request','Invalid optional confirmation fields.');
  const acknowledged=input.acknowledgeGates??[];if(!Array.isArray(acknowledged)||acknowledged.some(x=>typeof x!=='string')||new Set(acknowledged).size!==acknowledged.length||!same([...acknowledged].sort(),preview.requiredGates))fail('gates_unacknowledged','Acknowledge exactly the open release gates.',409);
  const before=state.snapshot.flags[name]??null,next=structuredClone(preview.record);
  if(['seed','take-control','reshuffle'].includes(action))next.salt=this.randomId();
  if(action==='experiment-start'){next.experiment.id=this.randomId();next.experiment.variantSalt=this.randomId();}
  const after=validateRecord(name,next,{before}),version=state.snapshot.version+1,snapshot=validateSnapshot({...state.snapshot,version,issuedAt:now,flags:{...state.snapshot.flags,[name]:after}}),writes={['flag/'+name]:after,[`flag-rev/${name}/${after.rev}`]:{record:after,version,at:now,action:'flag.'+action},'flags-head':{version,issuedAt:now}},expect={...actor.expect,['flag/'+name]:before?.rev??null,'flags-head':state.head?.revision??null};
  // Transitive dependencies are explicit CAS inputs, in addition to the head.
  const dependency=name=>{for(const parent of getFlag(name).requires){if(own(expect,'flag/'+parent))continue;expect['flag/'+parent]=state.snapshot.flags[parent]?.rev??null;dependency(parent);}};dependency(name);
  if(after.rev>100)writes[`flag-rev/${name}/${after.rev-100}`]=null;
  if(after.experiment&&['experiment-start','experiment-stop','experiment-conclude'].includes(action))writes['flag-experiment/'+after.experiment.id]={name,experiment:after.experiment,updatedAt:now};
  const result=await this.store.commit({expect,writes,rate:{key:actor.kind==='boot'?'boot':'admin-'+actor.owner,limit:60,windowMs:60000,now},audit:{at:now,actor:actor.audit??{kind:actor.kind,...actor.owner?{owner:actor.owner}:{}},action:'flag.'+action,target:name,before,after,reason:input.reason??null,typedName:input.typedName??null,acknowledgeGates:acknowledged,gateRevision:GATE_REVISION,previewDigest:preview.digest,version,...action==='rollback'?{rollbackRevision:input.revision}:{}}});
  if(result.rateLimited)fail('rate_limited','Administrative actions are rate limited.',429);if(!result.committed)fail('conflict','Flags or authority changed; reload and try again.',409);
  if(this.onCommit)await this.onCommit(snapshot);return {name,record:after,revision:after.rev,version,audit:result.audit};
 }
 seed(input,context){return this.mutate('seed',input,context);}
 takeControl(input,context){return this.mutate('take-control',input,context);}
 update(input,context){return this.mutate('update',input,context);}
 rollback(input,context){return this.mutate('rollback',input,context);}
 reshuffle(input,context){return this.mutate('reshuffle',input,context);}
 experimentStart(input,context){return this.mutate('experiment-start',input,context);}
 experimentStop(input,context){return this.mutate('experiment-stop',input,context);}
 experimentConclude(input,context){return this.mutate('experiment-conclude',input,context);}
 async list(input,context){this.authority(context);const snapshot=await this.snapshot();return {version:snapshot.version,flags:Object.values(FLAGS).map(f=>({name:f.name,registry:f,record:snapshot.flags[f.name]??null,env:parseEnv(f.name,this.env,own(snapshot.flags,f.name),{platform:this.platform}),global:evaluateGlobal(f.name,snapshot,this.env).value}))};}
 async get({name},context){this.authority(context);getFlag(name);const snapshot=await this.snapshot();return {name,record:snapshot.flags[name]??null,version:snapshot.version,env:parseEnv(name,this.env,own(snapshot.flags,name),{platform:this.platform})};}
 async history({name},context){this.authority(context);getFlag(name);const row=await this.store.get('flag/'+name),entries=[];for(let rev=row?.rev??0;rev>Math.max(0,(row?.rev??0)-100);rev--){const entry=await this.store.get(`flag-rev/${name}/${rev}`);if(entry)entries.push(entry);}return {name,entries};}
 async seedVerify(input,context){this.authority(context);if(Object.keys(input??{}).length)fail('invalid_request','Seed verification accepts no client values.');const snapshot=await this.snapshot(),contexts=seedContexts(this.clock()),env={...this.env};for(const f of consoleFlags)delete env[f.name];return {version:snapshot.version,contexts:contexts.length,flags:Object.fromEntries(consoleFlags.map(f=>{const state=parseEnv(f.name,this.env,own(snapshot.flags,f.name),{platform:this.platform}),legacy=legacyValue(f.name,this.env,{platform:this.platform}),mismatches=contexts.reduce((n,ctx)=>n+Number(evaluate(f.name,ctx,snapshot,env,{platform:this.platform}).value!==legacy),0);return [f.name,{safeToRemove:own(snapshot.flags,f.name)&&!['kill','invalid'].includes(state.state)&&mismatches===0,envState:state.state,managed:own(snapshot.flags,f.name),matches:contexts.length-mismatches,total:contexts.length}];}))};}
 async evaluate({name,context:ctx},context){this.authority(context);return evaluate(name,ctx,await this.snapshot(),this.env,{clock:this.clock,platform:this.platform});}
 async explain(input,context){const actor=this.authority(context),result=await this.evaluate(input,context),now=this.clock(),committed=await this.store.commit({expect:actor.expect,rate:{key:'read-'+(actor.kind==='boot'?'boot':'admin-'+actor.owner),limit:300,windowMs:60000,now},audit:{at:now,actor:actor.audit??{kind:actor.kind},action:'flag.explain',target:input.name,before:null,after:result}});if(committed.rateLimited)fail('rate_limited','Administrative reads are rate limited.',429);if(!committed.committed)fail('conflict','Authority changed; reload and try again.',409);return result;}
}
