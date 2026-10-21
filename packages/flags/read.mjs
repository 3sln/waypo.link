// Shared synchronous read adapters. Context is supplied only by verified domain/host providers.
import {createFlags} from './evaluate.mjs';
import {legacyValue} from './env.mjs';
import {FLAGS} from './registry.mjs';
const empty={v:1,version:0,issuedAt:0,flags:{}},projected=Symbol('evaluated-features');
export function capability(config,name){const value=legacyValue(name,config);if(!value||!config.FLAGS_RUNTIME)return value;if(name==='EVENT_BUS_WAITS_MOUNTED')return siteGlobal(config,'EVENT_BUSES_ENABLED');if(name==='BROKERED_INTROSPECTION_MOUNTED')return siteGlobal(config,'BROKERING_ENABLED')&&siteGlobal(config,'INTEGRATIONS_ENABLED')&&siteGlobal(config,'FEDERATION_ENABLED');return value;}
export function flagsFor(config={},ctx={}){config??={};return (config.flags??config.FLAGS??config.FLAGS_RUNTIME?.current()??createFlags({snapshot:empty,env:config,clock:()=>Date.now()})).for(ctx);}
export const ownerFlags=(config,owner,clientId)=>flagsFor(config,{subject:{kind:'account',owner},...clientId?{client:{clientId}}:{}});
/** Strict-string sites and independent pre-console switches are compatibility
 * rules only. Once a record exists, the evaluator owns values/dependencies. */
export function siteEnabled(config,name,ctx={},strict=false){if(config?.[projected])return config[name]==='true';const flags=flagsFor(config,ctx),result=flags.evaluate(name),state=flags.envState(name);return state.state==='force-on-legacy'&&(result.reason==='legacy-env'||flags.version===0&&result.reason.startsWith('dependency:'))?strict?state.raw==='true':state.value:result.value;}
export function siteGlobal(config,name,strict=false){if(config?.[projected])return config[name]==='true';const flags=flagsFor(config),state=flags.envState(name),reason=flags.evaluate(name).reason;return state.state==='force-on-legacy'&&(reason==='legacy-env'||flags.version===0&&reason.startsWith('dependency:'))?strict?state.raw==='true':state.value:flags.global(name);}
export function existingFeature(config,name,owner,strict=false){const flags=ownerFlags(config,owner);return flags.version>0||siteEnabled(config,name,{subject:{kind:'account',owner}},strict);}
/** Adapter for unmigrated services whose boolean configuration is string-valued.
 * The service still owns entitlement, consent, quotas and transport readiness. */
export function featureConfig(config,ctx){return new Proxy(config,{get:(target,name,receiver)=>name===projected?true:typeof name==='string'&&FLAGS[name]?.class!=='b'&&Object.hasOwn(FLAGS,name)?(ctx===null?siteGlobal(config,name):siteEnabled(config,name,ctx))?'true':'false':Reflect.get(target,name,receiver)});}
export function surfaceConfig(config){return {...config,...Object.fromEntries(Object.values(FLAGS).filter(f=>f.class!=='b').map(f=>[f.name,siteGlobal(config,f.name)?'true':'false']))};}
