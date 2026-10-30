// Scenario engine (spike §3.3): seeded, ordered steps over actors, each with a declared expectation.
//   expect 'pass'                 the step must succeed;
//   expect {pending: reason, rule} the step asserts the behaviour we want eventually; it must FAIL today, and a pending
//                                  step that starts passing fails the run until it is promoted (G1);
// A created-object ledger records what each actor made, using seeded logical names only (never handles, ids or
// tokens), so the same seed gives the same digest (G6).
import {createHash} from 'node:crypto';

/** mulberry32: small, fast, seedable. */
export function seededRandom(seed){
 let a=(Number(seed)>>>0)||1;
 const next=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
 return {next,int:(min,max)=>min+Math.floor(next()*(max-min+1)),pick:list=>list[Math.floor(next()*list.length)],shuffle:list=>{const out=[...list];for(let i=out.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}};
}

export class Ledger {
 constructor(){this.entries=[];}
 record(actor,kind,key,value={}){this.entries.push({actor,kind,key,value});}
 expected(actor,kind){return this.entries.filter(e=>e.actor===actor&&e.kind===kind);}
 canonical(){return JSON.stringify(this.entries.map(e=>[e.actor,e.kind,e.key,sortKeys(e.value)]));}
 digest(){return createHash('sha256').update(this.canonical()).digest('hex');}
}
const sortKeys=value=>Array.isArray(value)?value.map(sortKeys):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sortKeys(value[k])])):value;

export function createRun({scenario,seed,log=()=>{}}){
 const steps=[],results=[],ledger=new Ledger(),random=seededRandom(seed);let group='base';
 return {
  scenario,seed,ledger,random,results,
  /** Steps declared after this belong to `name` (a scenario part). A failing step skips only the rest of its group;
   * a failure in the 'base' group (signups) skips everything after it, since every part depends on it. */
  group(name){group=name;},
  /** Declares a step. `fn(ctx)` runs it; `shots` names catalogue moments captured inside it. */
  step(id,{actor=null,via='browser',kind=id.split('.')[0],expect='pass'}={},fn){steps.push({id,actor,via,kind,expect,fn,group});},
  async execute(ctx){
   const failedGroups=new Set();
   for(const step of steps){
    if(failedGroups.has(step.group)||failedGroups.has('base')){results.push({id:step.id,actor:step.actor,via:step.via,kind:step.kind,group:step.group,expect:typeof step.expect==='object'?{pending:step.expect.pending,rule:step.expect.rule}:'pass',outcome:'skipped',ok:false,ms:0});log(`  · ${step.id} skipped (an earlier ${failedGroups.has('base')?'base':step.group} step failed)`);continue;}
    const pending=typeof step.expect==='object'&&step.expect?.pending,started=Date.now();let error=null;
    log(`▶ ${step.id}${pending?' (expected pending)':''}`);
    try{await step.fn({...ctx,step});}catch(e){error=e;await ctx.onFailure?.(step,e).catch(()=>{});}
    const ms=Date.now()-started;
    const outcome=pending?(error?'pending-held':'pending-passed'):(error?'fail':'pass');
    const ok=pending?outcome==='pending-held':outcome==='pass';
    results.push({id:step.id,actor:step.actor,via:step.via,kind:step.kind,group:step.group,expect:pending?{pending:step.expect.pending,rule:step.expect.rule}:'pass',outcome,ok,ms,...error?{error:String(error?.message??error).split("\n")[0].slice(0,1200),at:/tests\/sim\/[^\s)]+/.exec(String(error?.stack??''))?.[0]??null}:{}});
    log(`${ok?'  ✓':'  ✗'} ${step.id} ${outcome} ${ms} ms${error&&!pending?' — '+String(error.message).split('\n')[0].slice(0,240)+' @ '+(/tests\/sim\/[^\s)]+/.exec(String(error.stack??''))?.[0]??'?'):''}`);
    // A failing ordinary step leaves the later steps of its group without their preconditions: they are skipped.
    if(!ok&&!pending)failedGroups.add(step.group);
   }
   return results;
  }
 };
}
