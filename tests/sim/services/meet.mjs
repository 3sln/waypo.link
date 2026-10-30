// The Meet sample (apps/samples/meet) as a simulation service: its app server on meet.example, and the operator
// registration of its sample session kind on every provider (a session kind must be held by both providers before a
// call between them is admitted, signaling §9.2; preloading sample artefacts is allowed and recorded, spike §2.6).
import {createMeetServer} from '../../../apps/samples/meet/server.mjs';
import {CALL_KIND,callKindEnvelope} from '../../../apps/samples/meet/metadata.mjs';

const HOST='meet.example',ORIGIN='https://'+HOST;
export default {
 name:'meet',hosts:[HOST],appOrigins:[ORIGIN],
 providerConfig:()=>({FEDERATION_CONTRACTS:JSON.stringify({[CALL_KIND]:callKindEnvelope,[CALL_KIND+'/envelope']:callKindEnvelope})}),
 async start(network,{providers,log}){
  await network.serve([HOST],createMeetServer({origin:ORIGIN,log}));
  return {origin:ORIGIN,
   // Teardown: services close before providers. After a cross-provider call each provider's signaling key roster keeps
   // refreshing the other's manifest in the background; a refresh that reaches a provider whose stores are already
   // closed answers 500 (G3). Holding the provider hosts first makes those late refreshes fail as unreachable instead.
   // (A world-level hold before providers close would cover every service; proposed as plumbing.)
   async close(){for(const p of Object.values(providers))for(const host of [p.host,p.embedHost])network.hold(host);},
   describe:()=>({origin:ORIGIN,registration:'client-id metadata at /bindle/client.json',sessionKind:CALL_KIND,operatorHeld:'FEDERATION_CONTRACTS (line and line/envelope)'})};
 }
};
