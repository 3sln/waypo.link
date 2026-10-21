// FF-3: edge administration over the FF-2 service and the FF-7 aggregate port.
// actor is adapter-verified {kind:'admin'|'boot',owner?,expect,internalAccounts?};
// input.stepUpAt/stepUpMethod are explicit verified passkey evidence, never
// inferred from the actor kind. HTTP adapters must replace them from the session.
// id may name the flag; input.name is also accepted, but the two must agree.
import {AppAction,AppQuery} from '../engine.mjs';
import {fault} from '../faults.mjs';
import {FlagService} from '../../flags/service.mjs';
import {getFlag} from '../../flags/registry.mjs';
import {resultRequest} from '../../flags/experiments.mjs';
import {UUID} from '../../core/primitives.mjs';

const deps=['flagStore','config','clock','random'];
const service=({flagStore,config,clock,random})=>new FlagService({store:flagStore,env:config,clock:()=>clock.now(),randomId:()=>random.uuid(),platform:config.FLAGS_PLATFORM??'worker'});
function request(operation){
 const source=operation.input===undefined?{}:operation.input;if(!source||typeof source!=='object'||Array.isArray(source))fault('invalid_request','Provide a flag operation object.',400);
 let value;try{value=structuredClone(source);}catch{fault('invalid_request','Provide a cloneable flag operation object.',400);}
 const {stepUpAt,stepUpMethod,...input}=value;
 if(operation.id!==undefined){if(input.name!==undefined&&input.name!==operation.id)fault('invalid_request','Flag names must agree.',400);input.name=operation.id;}
 return {input,context:{actor:operation.actor,stepUpAt,stepUpMethod,internalAccounts:operation.actor?.internalAccounts}};
}
const metadata=async(flagStore,experimentId)=>{
 if(typeof experimentId!=='string'||!UUID.test(experimentId))fault('invalid_flag_stats','Choose an experiment.',400);
 const row=await flagStore.get('flag-experiment/'+experimentId);
 if(!row)fault('not_found','Experiment not found.',404);
 const declaration=getFlag(row.name).experiment,e=row.experiment;
 if(!declaration||e?.id!==experimentId||!['running','stopped','concluded'].includes(e.status))fault('invalid_state','Experiment metadata is unavailable.',409);
 return {experimentId:e.id,variants:e.variants,metrics:declaration.metrics,concludedAt:e.concludedAt??null};
};
async function configure({flagStore,flagStats},experimentId){return flagStats.configure(await metadata(flagStore,experimentId));}

class FlagQuery extends AppQuery {
 static deps=deps;
 fetch(resources){const {input,context}=request(this);return service(resources)[this.constructor.method](input,context);}
}
class FlagMutation extends AppAction {
 static deps=deps;static changes='flags-changed';
 run(resources){const {input,context}=request(this);return service(resources)[this.constructor.method](input,context);}
}
export class FlagList extends FlagQuery {static operation='flags.list';static method='list';}
export class FlagGet extends FlagQuery {static operation='flags.get';static method='get';}
export class FlagHistory extends FlagQuery {static operation='flags.history';static method='history';}
export class FlagPreview extends FlagQuery {static operation='flags.preview';static method='preview';}
export class FlagExplain extends FlagQuery {static operation='flags.explain';static method='explain';}
export class FlagEvaluate extends FlagQuery {static operation='flags.evaluate';static method='evaluate';}
export class FlagSeedVerify extends FlagQuery {static operation='flags.seed-verify';static method='seedVerify';}
export class SeedFlag extends FlagMutation {static operation='flags.seed';static method='seed';}
export class TakeControlFlag extends FlagMutation {static operation='flags.take-control';static method='takeControl';}
export class UpdateFlag extends FlagMutation {static operation='flags.update';static method='update';}
export class RollbackFlag extends FlagMutation {static operation='flags.rollback';static method='rollback';}
export class ReshuffleFlag extends FlagMutation {static operation='flags.reshuffle';static method='reshuffle';}
class ExperimentMutation extends FlagMutation {
 static deps=[...deps,'flagStats'];
 async run(resources){
  const result=await super.run(resources);
  // The flag CAS is already durable. Counter setup is idempotent, but belongs to
  // another store: report failure without pretending the admin commit rolled
  // back. Record/results retry setup from committed metadata before using it.
  try{return {...result,stats:await configure(resources,result.record.experiment.id)};}
  catch{return {...result,stats:{accepted:false,reason:'unavailable'}};}
 }
}
export class StartFlagExperiment extends ExperimentMutation {static operation='flags.experiment-start';static method='experimentStart';}
export class StopFlagExperiment extends ExperimentMutation {static operation='flags.experiment-stop';static method='experimentStop';}
export class ConcludeFlagExperiment extends ExperimentMutation {static operation='flags.experiment-conclude';static method='experimentConclude';}
export class FlagExperimentResults extends AppQuery {
 static operation='flags.experiment-results';static deps=[...deps,'flagStats'];
 async fetch(resources){
  const {input,context}=request(this);service(resources).authority(context);resultRequest(input);
  const configured=await configure(resources,input.experimentId);
  if(!configured.accepted)return {experimentId:input.experimentId,visible:false,reason:configured.reason,variants:[]};
  return resources.flagStats.results(input);
 }
}
// No account actor reaches the generic audit trail. owner is consumed by the
// counter port only; neither inputs nor aggregate delivery results are audited.
export class RecordFlagEvent extends AppAction {
 static operation='flags.record';static deps=['flagStore','flagStats'];
 constructor(params){super(params);this.actor=this.actor?.kind==='system'&&this.actor.owner===undefined?{kind:'system'}:{kind:'untrusted'};}
 async run(resources){
  if(this.actor?.kind!=='system'||this.actor.owner!==undefined)fault('forbidden','A system actor is required.',403);
  const input=this.input;if(!input||typeof input!=='object'||Array.isArray(input))fault('invalid_flag_stats','Provide an experiment event.',400);
  if(typeof input.experimentId!=='string'||!UUID.test(input.experimentId))fault('invalid_flag_stats','Choose an experiment.',400);
  const row=await resources.flagStore.get('flag-experiment/'+input.experimentId);
  if(!row)return {accepted:false,reason:'unknown_experiment'};
  if(row.experiment.status!=='running')return {accepted:false,reason:row.experiment.status};
  const result=await resources.flagStats.record(input);
  if(result.accepted||result.reason!=='unknown_experiment')return result;
  const configured=await configure(resources,input.experimentId);if(!configured.accepted)return configured;
  // Only retry a definite refusal, never an uncertain delivery or exception.
  return resources.flagStats.record(input);
 }
}
export class RollupFlagStats extends AppAction {
 static operation='flags.stats-rollup';static deps=['flagStats'];
 run({flagStats}){if(this.actor?.kind!=='system'||this.actor.owner!==undefined)fault('forbidden','A system actor is required.',403);return flagStats.rollup();}
}
export const FLAG_OPERATIONS=[FlagList,FlagGet,FlagHistory,FlagPreview,FlagExplain,FlagEvaluate,FlagSeedVerify,SeedFlag,TakeControlFlag,UpdateFlag,RollbackFlag,ReshuffleFlag,StartFlagExperiment,StopFlagExperiment,ConcludeFlagExperiment,FlagExperimentResults,RecordFlagEvent,RollupFlagStats];
