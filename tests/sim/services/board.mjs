// Simulation service 'board': the Board sample at https://board.example, its operator-preloaded fragments (the boards
// fragment and the board-changes bus manifest, events §2), and the organizations paid-check port for the providers.
import {createBoardServer} from '../../../apps/samples/board/server.mjs';
import {boardFragment,busManifest} from '../../../apps/samples/board/metadata.mjs';

/**
 * The organizations paid check (ORG-D18) as the ORGANIZATION_PLANS code port, the documented test seam
 * (tests/orgs-certificates-runtime.test.mjs does the same). Production's port is ORGANIZATIONS_PAID_ALLOWLIST, which
 * must name the creator's UUID before the provider starts; simulated accounts exist only after their signup, so the
 * operator "lists" a creator here at run time (`allowCreator`), and the check stays fail-closed for everyone else.
 */
const creators=new Set();
const plans=Object.freeze({async check({creator}){return creators.has(creator?.sub)?{paid:true,plan:'organization-internal',source:'sim-operator-allowlist'}:{paid:false,reason:'billing_unavailable'};}});

export default {
 name:'board',hosts:['board.example'],appOrigins:['https://board.example'],
 schemas:{[boardFragment.id]:boardFragment,[busManifest.id]:busManifest},
 // Board is an operator-reviewed registration on alpha (as Notes is): app messages (createOwn) accept only reviewed
 // FEDERATION_CLIENTS origins (packages/runtime/app-notifications.mjs configuredContext), and the organization's token
 // endpoint knows reviewed clients only (member access needs the client in the org's federation shard). On beta Board
 // stays a client-id-metadata app (the open path).
 providerConfig:p=>({ORGANIZATION_PLANS:plans,...p.name==='alpha'?{reviewedClients:[{id:'https://board.example/bindle/client.json',name:'Board',origin:'https://board.example',redirectUris:['https://board.example/bindle/callback']}]}:{}}),
 allowCreator:sub=>creators.add(sub),
 async start(network,{log}){
  const origin='https://board.example';
  await network.serve(['board.example'],createBoardServer({origin,log}));
  return {origin,describe:()=>({origin,registration:'client-id metadata at /bindle/client.json',seams:['ORGANIZATION_PLANS (operator allowlist filled at run time)']})};
 }
};
