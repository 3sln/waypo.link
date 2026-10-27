import {Action} from '../shared/stack.mjs';
// An account-epoch guarded Action. The ticket pins the signed-in account and the
// account/session generation counter (beamGeneration) at dispatch time; any API
// result or state publish after a sign-out, account switch, or offline transition
// is discarded. Mutations share the console's single busy reservation, so a double
// click (or a second submit before the next frame renders) cannot send twice.
export const snapshot=r=>r.state.snapshot();
export const valid=r=>!r.epochTicket||snapshot(r).session?.account?.id===r.epochTicket.owner&&!snapshot(r).offline&&(snapshot(r).beamGeneration??0)===r.epochTicket.generation;
export const publish=(r,ctx,patch)=>{if(!valid(r))return;r.state.transition(next=>Object.assign(next,patch));ctx.engineFeed.dispatchEvent(new Event('browser-state-updated'));};
export class GuardedAction extends Action {
 static deps={state:{write:true},api:{},browser:{}};
 mutation=false;
 constructor(detail={}){super();this.detail=detail;}
 async execute(resources,ctx){if(snapshot(resources).offline||!snapshot(resources).session)return;if(this.mutation&&!resources.state.reserve())return;const r={...resources,epochTicket:{owner:snapshot(resources).session.account.id,generation:snapshot(resources).beamGeneration??0}};if(this.mutation)ctx.engineFeed.dispatchEvent(new Event('browser-state-updated'));const api=resources.api;r.api={get:async path=>{if(!valid(r))throw new Error('Account changed.');const value=await api.get(path);if(!valid(r))throw new Error('Account changed.');return value;},request:async(...args)=>{if(!valid(r))throw new Error('Account changed.');const value=await api.request(...args);if(!valid(r))throw new Error('Account changed.');return value;}};try{await this.perform(r,ctx,this.detail);}catch(error){publish(r,ctx,{error:error.message});}finally{if(this.mutation)publish(r,ctx,{busy:false});}}
}
