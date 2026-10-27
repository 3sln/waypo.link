/**
 * Explicit-input env contract: legacyValue(name, env, {platform:'worker'|'node'})
 * reproduces each raw flag predicate, without testing transport/secret readiness.
 * parseEnv(name, env, hasRecord=false, options) -> {state,value,raw,warning}; state is
 * unset|kill|invalid|force-on-legacy|ignored (class b: env-capability). Invalid kills.
 * No process.env access. envDefault is applied only by legacyValue for class b;
 * a/c unset always delegates to the console. LIFECYCLE_DRY_RUN is narrow-only:
 * its unsafe env false still permits live mode until console explicitly pauses it.
 * flags.for(ctx).envState(name) returns this object. Snapshot schema: snapshot.mjs.
 */
import {getFlag} from './registry.mjs';
import {assertBillingConfiguration} from '../billing/catalog.mjs';
// A renamed flag still reads its retired env name (registry envAlias) while the new name is unset.
const rawEnv=(f,env)=>env[f.name]!==undefined||!f.envAlias?env[f.name]:env[f.envAlias];
export function legacyValue(name,env={},options={}){
 const f=getFlag(name),raw=rawEnv(f,env),value=raw===undefined?(options.platform==='node'?f.envDefaults.node??f.envDefault:f.envDefault):raw;
 switch(options.parse??f.envParse){case 'true-only':return value===true;case 'boolean':return value===true||value==='true';case 'not-false':return value!=='false';case 'not-false-boolean':return value!==false&&value!=='false';case 'work-authority':return value===true||value==='true'||value===undefined&&Boolean(env.WORK_AUTHORITY);default:return value==='true';}
}
export const envParse=legacyValue;
export function parseEnv(name,env={},hasRecord=false,options={}){
 const f=getFlag(name),raw=rawEnv(f,env);
 if(f.class==='b')return {state:'env-capability',value:legacyValue(name,env,options),raw,warning:null};
 if(raw===undefined||raw==='')return {state:'unset',value:f.safe,raw,warning:null};
 const boolean=f.envParse==='boolean'||f.envParse==='not-false-boolean',valid=raw==='true'||raw==='false'||boolean&&typeof raw==='boolean';
 if(!valid)return {state:'invalid',value:f.safe,raw,warning:'invalid'};
 const value=raw===true||raw==='true';
 if(value===f.safe)return {state:'kill',value:f.safe,raw,warning:null};
 return {state:hasRecord?'ignored':'force-on-legacy',value,raw,warning:hasRecord?'ignored':null};
}
export const envState=parseEnv;
export function billingConfigured(env={}){try{assertBillingConfiguration(env);return true;}catch{return false;}}
