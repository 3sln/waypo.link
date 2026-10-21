import {FlagsAction,flagState,flagCall,patchFlags,previewChange} from './admin-flags.mjs';
import {failure} from './admin-access.mjs';
export class CreateExperiment extends FlagsAction {
 async perform(r,ctx,detail){const f=flagState(r),row=f.list?.flags.find(row=>row.name===f.selected),record=structuredClone(f.draft);if(!row?.registry.experiment||!record||record.experiment?.status==='running')throw failure('invalid_state');
  const v=detail.values??{},keys=String(v.variants??'').split(/[\s,]+/).filter(Boolean),weights=String(v.weights??'').split(/[\s,]+/).filter(Boolean).map(Number);
  if(keys.length<2||keys.length>8||new Set(keys).size!==keys.length||weights.length!==keys.length||weights.some(n=>!Number.isInteger(n)||n<0)||weights.reduce((a,b)=>a+b,0)!==10000)throw failure('invalid_snapshot');
  const when={};for(const [key,dimension]of [['accounts','A'],['shards','S'],['clients','C']]){const entries=String(v[key]??'').split(/[\s,]+/).filter(Boolean);if(entries.length&&row.registry.dimensions.includes(dimension))when[key]=entries;}
  if(v.from||v.until)when.window={...v.from?{from:v.from}:{},...v.until?{until:v.until}:{}};
  record.experiment={id:'00000000-0000-4000-8000-000000000000',status:'draft',variantSalt:'draft-server-replaces-on-start',variants:keys.map((key,i)=>({key,weight:weights[i]})),eligibility:{percent:Number(v.percent),...Object.keys(when).length?{when}:{}}};
  patchFlags(r,ctx,{draft:record});await previewChange(r,ctx,'update',{record});
 }
}
export class ExperimentLifecycle extends FlagsAction {async perform(r,ctx,detail){if(!['start','stop','conclude'].includes(detail.operation))throw failure('invalid_request');await previewChange(r,ctx,'experiment-'+detail.operation,detail.operation==='conclude'?{winner:detail.values?.winner}:{});}}
export class ExperimentResults extends FlagsAction {async perform(r,ctx){patchFlags(r,ctx,{results:null});const e=flagState(r).draft?.experiment;if(!e||e.status==='draft')throw failure('invalid_state');patchFlags(r,ctx,{results:await flagCall(r,'experiment-results',{experimentId:e.id})});}}
export class ApplyWinner extends FlagsAction {
 async perform(r,ctx){const f=flagState(r),row=f.list?.flags.find(row=>row.name===f.selected),record=structuredClone(f.draft),e=record?.experiment;if(e?.status!=='concluded'||!e.winner)throw failure('invalid_state');record.fallthrough=e.winner===e.variants[0].key?row.registry.safe:record.onValue;patchFlags(r,ctx,{draft:record});await previewChange(r,ctx,'update',{record});}
}
export const experimentConstructors={'flags-experiment-create':CreateExperiment,'flags-experiment-lifecycle':ExperimentLifecycle,'flags-experiment-results':ExperimentResults,'flags-apply-winner':ApplyWinner};
