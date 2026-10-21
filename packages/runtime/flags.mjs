/** FF-4 platform provider. pin({request,execution,minVersion,writer,alarm,hasState})
 * returns one immutable synchronous flags port; for(ctx) accepts adapter-verified
 * session/account/subject and client IDs, never headers. Request geo comes only
 * from cf plus CF-Connecting-IP (Node always unknown). identity shard is derived.
 * checkedAt is the last successful authority read, NOT snapshot.issuedAt (commit
 * time). Copying between tiers never renews it. invalidate() is synchronous;
 * publish(snapshot) is the FlagService onCommit hook. Writer RPCs carry flagsVersion.
 * FF-3 owns engine operations; this module implements their injected provider.
 */
import {AsyncLocalStorage} from 'node:async_hooks';
import {createFlags} from '../flags/evaluate.mjs';
import {validateSnapshot} from '../flags/snapshot.mjs';
import {accountShard} from '../flags/hash.mjs';
import {UUID,canonical} from '../core/primitives.mjs';
export const FLAGS_TTL_MS=15000,FLAGS_FALLBACK_MS=7*86400000,FLAGS_DEFAULT_MAX_STALE_MS=3600000;
export function flagsMaxStale(value){const n=Number(value);return Number.isSafeInteger(n)&&n>=300000&&n<=86400000?n:FLAGS_DEFAULT_MAX_STALE_MS;}
const unavailable=()=>Object.assign(new Error('Feature configuration is temporarily unavailable.'),{code:'flags_unavailable',status:503});
export function flagContext(ctx={}, {request,platform='worker',now}={}){
 const owner=ctx.subject?.kind==='account'?ctx.subject.owner:ctx.account?.id??ctx.session?.account?.id??ctx.session?.owner,account=typeof owner==='string'&&UUID.test(owner),country=platform==='worker'&&request?.headers?.has('CF-Connecting-IP')&&/^[A-Z]{2}$/.test(request.cf?.country??'')&&request.cf.country!=='XX'?request.cf.country:'unknown',code=request?.cf?.regionCode,subdivision=country!=='unknown'&&typeof code==='string'&&/^[A-Z0-9]{1,3}$/.test(code)?code:'unknown',clientId=ctx.client?.clientId??ctx.clientId;
 return Object.freeze({subject:Object.freeze(account?{kind:'account',owner}:ctx.subject?.kind==='system'?{kind:'system',reason:ctx.subject.reason}:{kind:'anonymous'}),client:typeof clientId==='string'&&clientId?Object.freeze({clientId}):null,region:Object.freeze({country,subdivision}),...account?{shard:accountShard(owner)}:{},now});
}
export const disabledFlagStats=Object.freeze({configure:async()=>({accepted:false,reason:'disabled'}),record:async()=>({accepted:false,reason:'disabled'}),results:async({experimentId}={})=>({experimentId,visible:false,reason:'disabled',variants:[]}),rollup:async()=>({rolledUp:0,expired:0})});
export class FlagsRuntime{
 constructor({store=null,cache=null,cacheKey='https://flags.example/flags-v1',env={},platform='worker',clock=()=>Date.now(),maxStale=env.FLAGS_MAX_STALE_MS}={}){Object.assign(this,{store,cache,cacheKey,env,platform,clock,maxStale:flagsMaxStale(maxStale)});this.scope=new AsyncLocalStorage();this.entry=null;this.freshUntil=0;this.flight=null;this.writes=Promise.resolve();this.generation=0;}
 current(){return this.scope.getStore()??createFlags({snapshot:this.entry?.snapshot,env:this.env,platform:this.platform,clock:this.clock,usable:!!this.entry&&this.clock()-this.entry.checkedAt<=this.maxStale,fallback:this.entry&&this.clock()-this.entry.checkedAt<FLAGS_FALLBACK_MS?this.entry.snapshot:null});}
 bind(config){return new Proxy(config,{get:(target,name,receiver)=>name==='FLAGS_RUNTIME'?this:['flags','FLAGS'].includes(name)?this.current():Reflect.get(target,name,receiver)});}
 run(flags,operation){return this.scope.run(flags,operation);}
 invalidate(){this.generation++;this.freshUntil=0;}
 accept(snapshot,checkedAt=this.clock()){
  const next=validateSnapshot(snapshot),previous=this.entry;
  if(previous&&(next.version<previous.snapshot.version||next.version===previous.snapshot.version&&canonical(next)!==canonical(previous.snapshot)))return false;
  if(previous&&next.version===previous.snapshot.version&&checkedAt<previous.checkedAt)return false;
  this.entry={snapshot:next,checkedAt};this.freshUntil=this.clock()+FLAGS_TTL_MS;return true;
 }
 publish(snapshot){if(this.accept(snapshot))return this.persist();return Promise.resolve();}
 async cached(tier){
  if(!this.cache)return null;try{const response=await this.cache.match(this.cacheKey+'/'+tier);if(!response)return null;const value=await response.json(),now=this.clock();if(!Number.isSafeInteger(value.checkedAt)||value.checkedAt<0||value.checkedAt>now||now-value.checkedAt>=FLAGS_FALLBACK_MS)return null;return {snapshot:validateSnapshot(value.snapshot),checkedAt:value.checkedAt};}catch{return null;}
 }
 persist(){
  const entry=this.entry;if(!this.cache||!entry)return Promise.resolve();const write=async()=>{if(this.entry!==entry)return;for(const [tier,ttl]of [['fresh',15],['fallback',FLAGS_FALLBACK_MS/1000]])try{await this.cache.put(this.cacheKey+'/'+tier,new Response(JSON.stringify(entry),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+ttl}}));}catch{/* Tier two is optional, including local Workers. */}};
  const pending=this.writes.then(write);this.writes=pending.catch(()=>{});return pending;
 }
 refresh({force=false}={}){
  if(this.flight)return this.flight;
  const generation=this.generation;
  const run=async()=>{
   if(!force){const fresh=await this.cached('fresh');if(fresh&&this.clock()-fresh.checkedAt<FLAGS_TTL_MS&&this.accept(fresh.snapshot,fresh.checkedAt))return true;}
   try{const snapshot=this.store?await this.store.flagsSnapshot():{v:1,version:0,issuedAt:0,flags:{}};if(generation!==this.generation)return false;if(!this.accept(snapshot))return false;await this.persist();return true;}catch{return false;}
  };
  this.flight=run().finally(()=>{this.flight=null;});return this.flight;
 }
 async pin({request,execution,minVersion=0,writer=false,alarm=false,hasState}={}){
  if(!Number.isSafeInteger(minVersion)||minVersion<0)throw unavailable();
  if(!this.entry){const fallback=await this.cached('fallback');if(!this.entry&&fallback){this.accept(fallback.snapshot,fallback.checkedAt);this.freshUntil=0;}}
  const older=()=>!this.entry||this.entry.snapshot.version<minVersion;
  if(older()){
   await this.refresh({force:minVersion>0});
   // An in-flight read started before a local invalidation or an edge version
   // overtook it. One new authority read is allowed; never dispatch an older writer.
   if(older()&&minVersion>0)await this.refresh({force:true});
   if(minVersion>0&&older())throw unavailable();
  }else if(alarm?this.clock()-this.entry.checkedAt>=300000:!writer&&this.clock()>=this.freshUntil){
   const refresh=this.refresh({force:alarm});if(alarm||this.platform==='node'||!execution?.waitUntil)await refresh;else execution.waitUntil(refresh);
  }
  const entry=this.entry,now=this.clock(),usable=Boolean(entry&&now-entry.checkedAt<=this.maxStale),fallback=entry&&now-entry.checkedAt<FLAGS_FALLBACK_MS?entry.snapshot:null,base=createFlags({snapshot:entry?.snapshot,env:this.env,platform:this.platform,clock:()=>now,usable,fallback,hasState}),context=ctx=>flagContext(ctx,{request,platform:this.platform,now}),port=base.for(context());
  return Object.freeze({...port,for:ctx=>base.for(context(ctx)),evaluate:(name,ctx)=>ctx===undefined?port.evaluate(name):base.evaluate(name,context(ctx))});
 }
}
const workerRuntimes=new WeakMap();
/** Isolate lifetime, keyed by the binding environment; no namespace means an
 * intentionally empty store (admin-less env configuration), not a store outage. */
export function workerFlags(env){
 if(workerRuntimes.has(env))return workerRuntimes.get(env);let cache=null;try{cache=globalThis.caches?.default??null;}catch{}
 if(!env.ADMIN_AUTHORITY)cache=null;const store=env.ADMIN_AUTHORITY?{flagsSnapshot:()=>env.ADMIN_AUTHORITY.get(env.ADMIN_AUTHORITY.idFromName('admin-v1')).invoke('flagsSnapshot',[])}:null,runtime=new FlagsRuntime({env,store,cache,cacheKey:new URL('/.internal/flags-v1',env.APP_ORIGIN||'https://flags.example').href});workerRuntimes.set(env,runtime);return runtime;
}
/** A request-local account namespace adds only the trusted pinned version. */
export function flagAccounts(accounts,flags){return {get:id=>{const target=accounts.get(id);return new Proxy(target,{get:(object,key)=>key==='invoke'?envelope=>object.invoke({...envelope,flagsVersion:flags.version}):typeof object[key]==='function'?object[key].bind(object):object[key]});}};}
/** Async scope keeps a writer's port pinned throughout overlapping async work.
 * The controller retains its existing gate/transaction/lifecycle policies. */
export function flagWriter(controller,runtime,{flagStats=disabledFlagStats,configure}={}){
 const scope=new AsyncLocalStorage();let latest=null;
 for(const key of ['flags','FLAGS'])Object.defineProperty(controller.config,key,{configurable:true,enumerable:true,get:()=>scope.getStore()?.flags??latest});
 Object.assign(controller.config,{FLAGS_RUNTIME:runtime,flagStats});
 if(configure)for(const name of ['INTEGRATION_EVENT_PORTS','BROKERING_CONSUMER_MINT','BROKERED_INTROSPECTION_MOUNTED','BROKERING_MINT','INTEGRATION_EGRESS','MESSAGING_DESCRIBE','INTEGRATION_CLIENT_SNAPSHOT','EVENT_BUS_WAITS_MOUNTED']){const initial=controller.config[name];Object.defineProperty(controller.config,name,{configurable:true,enumerable:true,get:()=>scope.getStore()?scope.getStore().ports[name]:initial});}
 const run=async(method,args)=>{let flags;try{flags=await runtime.pin({writer:true,minVersion:method==='invoke'?args[0]?.flagsVersion??0:0,alarm:method==='alarm'});}catch(error){if(method!=='invoke')throw error;return {$fault:{code:error.code??'flags_unavailable',message:'Feature configuration is temporarily unavailable.',status:503}};}latest=flags;return scope.run({flags,ports:configure?.(flags)??{}},()=>controller[method](...args));};
 return new Proxy(controller,{get:(target,key)=>['invoke','alarm'].includes(key)?(...args)=>run(key,args):typeof target[key]==='function'?target[key].bind(target):target[key]});
}
