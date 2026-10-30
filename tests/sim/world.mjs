// Topology (spike §3.1): two real 3sln.me providers (alpha, beta) and the sample apps, all on https .example origins
// behind the per-run network. Returns one `world` object the scenario engine and the CLI share.
import {createNetwork} from './network.mjs';
import {startProvider,operatorSchemas,SEAMS} from './providers.mjs';
import {createNotesServer} from '../../apps/samples/notes/server.mjs';
import {syncFragment} from '../../apps/samples/notes/metadata.mjs';
import {createPhotosServer} from '../../apps/samples/photos/server.mjs';
import {libraryFragment} from '../../apps/samples/photos/metadata.mjs';
import {PROFILES,OPERATOR_SETTINGS} from './flags.mjs';
import {SERVICES} from './services/index.mjs';

export const PROVIDERS=Object.freeze([
 {name:'alpha',host:'alpha.example',embedHost:'embed.alpha.example',brand:'Alpha'},
 {name:'beta',host:'beta.example',embedHost:'embed.beta.example',brand:'Beta'}
]);
export const APPS=Object.freeze([{name:'notes',host:'notes.example',create:createNotesServer},{name:'photos',host:'photos.example',create:createPhotosServer}]);

/**
 * Deviations from the plain `sim` profile, each with its reason (recorded in the manifest).
 * - ARTEFACT_VERSIONS_ENABLED: on (the profile's value; no override). The earlier blockers are resolved: object-storage/v1
 *   `modifiedAt` is integer epoch milliseconds (2026-10-29), and the event-bus/v1 `readResult.head` now admits null
 *   (nothing above the reader's floor; regression test tests/event-bus-read-result.test.mjs). Signaling, session kinds
 *   and intent links require it (packages/flags/registry.mjs). Still open with it on: result shaping withholds bus
 *   record `data` (event-bus/v1 declares `data: {}`), carried by Board as an expected-pending step.
 * - Notes is a reviewed registration (FEDERATION_CLIENTS) on alpha only: the embed shell resolves frame-ancestors from
 *   reviewed registrations only, so provider islands are unavailable to client-metadata apps. Beta resolves Notes
 *   through its client-id metadata document (the open path) and Notes shows no islands there.
 */
export const PROFILE_OVERRIDES=Object.freeze({
 alpha:{},
 beta:{}
});
export const REVIEWED_CLIENTS=Object.freeze({
 alpha:[{id:'https://notes.example/bindle/client.json',name:'Notes',origin:'https://notes.example',redirectUris:['https://notes.example/bindle/callback']}],
 beta:[]
});

export async function startWorld({runId,profile='sim'}={}){
 const hosts=[...PROVIDERS.flatMap(p=>[p.host,p.embedHost]),...APPS.map(a=>a.host),...SERVICES.flatMap(s=>s.hosts)];
 const network=await createNetwork({hosts,runId});
 const schemas=await operatorSchemas(Object.assign({[syncFragment.id]:syncFragment,[libraryFragment.id]:libraryFragment},...SERVICES.map(s=>s.schemas??{})));
 const providers={},apps={},appLogs=[],services={};
 const appOrigins=[...APPS.map(a=>'https://'+a.host),...SERVICES.flatMap(s=>s.appOrigins??[])];
 const serviceLog=name=>entry=>{appLogs.push({app:name,...entry});if(appLogs.length>50000)appLogs.shift();};
 try{
  for(const p of PROVIDERS){
   // Services contribute provider config (for example operator-held session kinds, extra foreign issuers); keys that
   // carry JSON objects or arrays are merged, others must not collide.
   const contributed=serviceConfig(p);
   providers[p.name]=await startProvider(network,{...p,profile,schemas,appOrigins,
    foreignIssuers:[...PROVIDERS.filter(o=>o.name!==p.name).map(o=>'https://'+o.host),...contributed.foreignIssuers],
    extra:{...contributed.config,...PROFILE_OVERRIDES[p.name],FEDERATION_CLIENTS:JSON.stringify([...REVIEWED_CLIENTS[p.name],...contributed.reviewedClients])}});
  }
  for(const s of SERVICES)services[s.name]={...s,...await s.start(network,{providers,log:serviceLog(s.name)})};
  for(const a of APPS){
   const origin='https://'+a.host;
   await network.serve([a.host],a.create({origin,log:entry=>{appLogs.push({app:a.name,...entry});if(appLogs.length>50000)appLogs.shift();}}));
   apps[a.name]={...a,origin};
  }
 }catch(error){for(const s of Object.values(services))await s.close?.().catch(()=>{});for(const p of Object.values(providers))await p.close().catch(()=>{});await network.close();throw error;}
 return {
  runId,network,providers,apps,services,appLogs,profile,
  description(){
   return {profile,profileFlags:PROFILES[profile],operatorSettings:OPERATOR_SETTINGS,seams:SEAMS,
    providers:Object.fromEntries(Object.values(providers).map(p=>[p.name,{origin:p.origin,embedOrigin:p.embedOrigin,adapter:'node (apps/node/server.mjs createNodeServer, in process)',config:p.config,overrides:PROFILE_OVERRIDES[p.name],reviewedClients:REVIEWED_CLIENTS[p.name].map(c=>c.id)}])),
    apps:Object.fromEntries(Object.values(apps).map(a=>[a.name,{origin:a.origin,registration:'client-id metadata at /bindle/client.json'}])),
    services:Object.fromEntries(Object.values(services).filter(s=>s.hosts.length).map(s=>[s.name,{hosts:s.hosts,...s.describe?.()}])),
    hosts:[...network.map.keys()]};
  },
  async close(){for(const host of network.map.keys())network.hold(host);for(const s of Object.values(services))await s.close?.().catch(()=>{});for(const p of Object.values(providers))await p.close().catch(()=>{});await network.close();}
 };
}

/** Merges every service's provider contributions for provider `p`. */
function serviceConfig(p){
 const config={},foreignIssuers=[],reviewedClients=[];
 for(const s of SERVICES){
  const c=s.providerConfig?.(p)??{};
  for(const [key,value] of Object.entries(c)){
   if(key==='foreignIssuers'){foreignIssuers.push(...value);continue;}
   if(key==='reviewedClients'){reviewedClients.push(...value);continue;}
   if(!(key in config)){config[key]=value;continue;}
   const a=JSON.parse(config[key]),b=JSON.parse(value);
   if(Array.isArray(a)&&Array.isArray(b))config[key]=JSON.stringify([...a,...b]);
   else if(a&&b&&typeof a==='object'&&typeof b==='object')config[key]=JSON.stringify({...a,...b});
   else throw new Error(`Services disagree on provider config ${key}.`);
  }
 }
 return {config,foreignIssuers,reviewedClients};
}
