// A small ngin bootstrap shared by the samples (sample-only code). Business logic lives in Actions over named
// providers; views are pure dodo functions of the state snapshot, re-rendered on each StateQuery emission
// (the pattern of apps/parlay/web). Everything here runs without a DOM, so a sample's logic can be driven headless.
import {Engine,Action,Query,Provider} from '../../../../vendor/ngin/index.js';

export class StateQuery extends Query {
 static deps=['state'];
 fetch({state}){return state.snapshot();}
 boot({state},{notify,engineFeed}){const update=()=>notify(state.snapshot());engineFeed.addEventListener('state-changed',update);this.kill=()=>engineFeed.removeEventListener('state-changed',update);update();}
}
/** Base action: `run(resources)` mutates `resources.state.value`; every dispatch ends with a state emission. */
export class AppAction extends Action {
 static deps=['state'];
 constructor(input={}){super();this.input=input;}
 async execute(resources,{dispatchFeed,engineFeed}){
  try{const result=await this.run(resources);dispatchFeed.dispatchEvent(new CustomEvent('result',{detail:result}));}
  finally{engineFeed.dispatchEvent(new Event('state-changed'));}
 }
 run(){throw new Error('run() not implemented');}
}
export function createState(value){return {value,snapshot(){return structuredClone(this.value);}};}
async function perform(engine,action){
 const feed=engine.dispatch(action);let result;
 feed.addEventListener('result',event=>{result=event.detail;},{once:true});
 await feed.next('complete');return result;
}
/** `operations` maps names to Action classes; `run(name, input)` dispatches one and resolves its result. */
export function createAppEngine({state,providers={},operations}){
 const engine=new Engine({providers:Object.fromEntries(Object.entries({state,...providers}).map(([name,value])=>[name,Provider.fromSingleton(value)]))});
 return {engine,state,
  run(name,input){const Operation=operations[name];if(!Operation)throw new TypeError(`Unknown operation ${name}`);return perform(engine,new Operation(input));},
  subscribe(next){return engine.query(new StateQuery()).subscribe({next});},
  read:()=>state.snapshot(),
  /** Lets views announce plain state changes (focus, drafts) without an operation. */
  changed:()=>engine.feed.dispatchEvent(new Event('state-changed')),
  dispose:()=>engine.dispose()};
}
