/**
 * Pure synchronous evaluator contract:
 * evaluate(name,ctx,snapshot,env={},options={}) -> frozen {value,reason,variant?,
 * experimentId?}; unknown names throw unknown_flag; unusable snapshots fail safe.
 * ctx={subject:{kind:'account',owner:UUID}|{kind:'anonymous'}|{kind:'system',reason},
 * client:{clientId}|null,region:{country,subdivision},now:epochMs}. Adapters alone
 * establish trusted IDs/geo. options={clock:()=>ms,hasState:(name,owner)=>boolean,
 * platform:'worker'|'node',usable:true,fallback:Snapshot|null}. No ambient clock.
 * hasState is a synchronous predicate over already-read account state, never I/O.
 * createFlags({snapshot,env,...options}) -> {version,evaluate(name,ctx),for(ctx)}.
 * flags.for(ctx) pins clock/context/snapshot and memoizes {version,evaluate(name),
 * enabled(name):boolean,global(name):boolean,background(name):boolean,envState(name)}.
 * global ignores audience/rules/experiments; background follows only the env kill.
 * evaluateGlobal returns a decision, globalComponent its boolean value. Reasons:
 * env-capability,env-kill,dependency:NAME,outage,outage-last-known,legacy-env,
 * no-record,console-off,deny,retained,experiment:ID,rule:N,fallthrough,global.
 * Fallback decisions include detailReason; no bucket or per-user state is stored.
 * Snapshot schema/validation and frozen experiment fields: snapshot.mjs.
 */
import {getFlag} from './registry.mjs';
import {parseEnv,billingConfigured} from './env.mjs';
import {bucket,accountShard} from './hash.mjs';
import {validateSnapshot,timeValue} from './snapshot.mjs';
import {UUID} from '../core/primitives.mjs';
const ownerOf=ctx=>ctx?.subject?.kind==='account'&&typeof ctx.subject.owner==='string'&&UUID.test(ctx.subject.owner)?ctx.subject.owner:null;
const clientOf=ctx=>typeof ctx?.client?.clientId==='string'&&ctx.client.clientId?ctx.client.clientId:null;
export function matches(when,ctx,now=ctx?.now){
 const owner=ownerOf(ctx),client=clientOf(ctx),region=ctx?.region;
 if(when.subject!==undefined&&when.subject!==ctx?.subject?.kind)return false;
 if(when.accounts!==undefined&&(!owner||!when.accounts.includes(owner)))return false;
 if(when.clients!==undefined&&(!client||!when.clients.includes(client)))return false;
 if(when.shards!==undefined){if(!owner)return false;const shard=accountShard(owner);if(!when.shards.some(n=>Number(n)===shard))return false;}
 if(when.countries!==undefined&&(!/^[A-Z]{2}$/.test(region?.country??'')||region.country==='XX'||!when.countries.includes(region.country)))return false;
 if(when.subdivisions!==undefined){const country=region?.country,subdivision=region?.subdivision,code=typeof subdivision==='string'&&subdivision.startsWith(`${country}-`)?subdivision:`${country}-${subdivision}`;if(!/^[A-Z]{2}$/.test(country??'')||country==='XX'||!when.subdivisions.includes(code))return false;}
 if(when.window){if(!Number.isFinite(now))return false;const {from,until}=when.window;if(from!==undefined&&now<timeValue(from)||until!==undefined&&now>=timeValue(until))return false;}
 return true;
}
const usable=snapshot=>{try{return validateSnapshot(snapshot,{quarantine:true});}catch{return null;}};
const decision=(value,reason,extra={})=>Object.freeze({value,reason,...extra});
function evaluator(ctx,snapshot,env,options){
 const primary=options.usable===false?null:usable(snapshot),fallback=usable(options.fallback),memo=new Map(),now=ctx?.now??options.clock?.();
 function run(name,global=false,source=primary,fallingBack=false){
  const f=getFlag(name),key=`${name}/${global}/${fallingBack}`;if(memo.has(key))return memo.get(key);
  const record=source?.flags[name],state=parseEnv(name,env,Boolean(record),options),done=result=>{memo.set(key,result);return result;};
  if(f.class==='b')return done(decision(state.value,'env-capability'));
  if(state.state==='kill'||state.state==='invalid')return done(decision(f.safe,'env-kill'));
  for(const dep of f.requires){const result=run(dep,global||f.dependencyMode==='global',source,fallingBack);if(result.value===getFlag(dep).safe)return done(decision(f.safe,`dependency:${dep}`));}
  if(f.capabilities?.includes('billing-configuration')&&!billingConfigured(env))return done(decision(f.safe,'dependency:billing-configuration'));
  // A quarantined record (L5) is unreadable for this flag only: it follows the outage policy, never legacy env. A
  // renamed flag without its own record whose retired name (envAlias) is quarantined is treated the same way, so a
  // console kill or narrowing stored under the old name is never widened by the old env name (review F1).
  if(!source||source.quarantined?.includes(name)||!record&&f.envAlias&&source.quarantined?.includes(f.envAlias)){if(f.outage==='last-known'&&fallback&&!fallingBack){const result=run(name,global,fallback,true);return done(decision(result.value,'outage-last-known',{...result,reason:'outage-last-known',detailReason:result.reason}));}return done(decision(f.safe,'outage'));}
  if(!record)return done(decision(state.state==='force-on-legacy'?state.value:f.safe,state.state==='force-on-legacy'?'legacy-env':'no-record'));
  if(!record.on)return done(decision(f.safe,'console-off'));
  if(global)return done(decision(record.onValue,'global'));
  const owner=ownerOf(ctx),client=clientOf(ctx);
  if(owner&&record.deny.accounts?.includes(owner)||client&&record.deny.clients?.includes(client))return done(decision(f.safe,'deny'));
  if(record.retainExisting&&owner&&options.hasState?.(name,owner)===true)return done(decision(record.onValue,'retained'));
  const e=record.experiment;
  if(owner&&e?.status==='running'&&matches(e.eligibility.when??{},ctx,now)&&bucket(record.salt,owner)<e.eligibility.percent){const b=bucket(e.variantSalt,owner);let end=0;for(const [i,v]of e.variants.entries()){end+=v.weight;if(b<end)return done(decision(i===0?f.safe:record.onValue,`experiment:${e.id}`,{variant:v.key,experimentId:e.id}));}}
  for(const [i,r]of record.rules.entries())if(matches(r.when,ctx,now)){
   let value=r.serve.value;if(r.serve.percent!==undefined){const clientOnly=r.when.clients!==undefined&&!r.when.accounts&&!r.when.shards,key=clientOnly?client:owner;value=key&&bucket(record.salt,key)<r.serve.percent?value:f.safe;}return done(decision(value,`rule:${i}`));
  }
  return done(decision(record.fallthrough,'fallthrough'));
 }return run;
}
export function evaluate(name,ctx={},snapshot,env={},options={}){getFlag(name);return evaluator(ctx,snapshot,env,options)(name);}
export function evaluateGlobal(name,snapshot,env={},options={}){getFlag(name);return evaluator({},snapshot,env,options)(name,true);}
export const globalComponent=(name,snapshot,env={},options={})=>evaluateGlobal(name,snapshot,env,options).value;
export function createFlags({snapshot,env={},...options}={}){
 const pinned=usable(snapshot),fallback=usable(options.fallback),config=Object.freeze({...env}),settings={...options,fallback},version=pinned?.version??0;
 function forContext(ctx={}){
  const context=Object.freeze({...ctx,subject:Object.freeze({...ctx.subject}),client:ctx.client?Object.freeze({...ctx.client}):null,region:Object.freeze({...ctx.region}),now:ctx.now??settings.clock?.()}),run=evaluator(context,pinned,config,settings);
  return Object.freeze({version,usable:Boolean(pinned)&&settings.usable!==false,evaluate:name=>run(name),enabled:name=>run(name).value,global:name=>run(name,true).value,background:name=>{const state=parseEnv(name,config,Boolean(pinned?.flags[name]),settings);return getFlag(name).class==='b'?state.value:!['kill','invalid'].includes(state.state);},envState:name=>parseEnv(name,config,Boolean(pinned?.flags[name]),settings)});
 }
 return Object.freeze({version,for:forContext,evaluate:(name,ctx)=>forContext(ctx).evaluate(name)});
}
