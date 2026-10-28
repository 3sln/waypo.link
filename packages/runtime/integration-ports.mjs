import {siteGlobal,siteEnabled,capability} from './account/flags.mjs';
// Shared host composition. X8's projection is unavailable unless an adapter passes `snapshot` (EXT-X8
// preferencesSnapshotPort over the owner's federation shard) with BROKERING_ENABLED; X8 hook: `snapshot`, consumer mint,
// introspection evidence. MESSAGING_DESCRIBE (the messaging-mailbox feature's brokered `describe`, messaging §2.5) is
// offered with KEY_DELEGATION_ENABLED; contacts spike CR-C0 removed its LINKS_ENABLED gate.
// One adapter mount decision controls the handler, declaration and write minting (X8-R7).
export const brokeringMounts=c=>({integrations:capability(c,'BROKERED_INTROSPECTION_MOUNTED'),brokeredResources:capability(c,'BROKERED_INTROSPECTION_MOUNTED'),brokeredIntrospection:capability(c,'BROKERED_INTROSPECTION_MOUNTED')});
const on=(c,k)=>siteGlobal(c,k);
export const pendingPreferencesSnapshot=Object.freeze(Object.assign(async()=>{throw Object.assign(new Error('Preferences v2 snapshots await EXT-X8.'),{code:'snapshot_unavailable'});},{available:false}));
export function integrationPorts(config,{signer,mint,eventEgress,egress,doorbellGrant,describe,snapshot,introspection=false,provision=false}={}){
 const available=name=>provision||on(config,name);
 if(!available('INTEGRATIONS_ENABLED'))return {};
 return {
  INTEGRATION_EVENT_PORTS:{...signer?{signer}:{},...eventEgress?{egress:eventEgress}:{},get snapshot(){return on(config,'BROKERING_ENABLED')&&(!provision||on(config,'FEDERATION_ENABLED'))&&typeof snapshot==='function'&&snapshot.available===true?snapshot:pendingPreferencesSnapshot;},...doorbellGrant?{doorbellGrant}:{}},
  ...available('BROKERING_ENABLED')&&typeof mint==='function'?{BROKERING_CONSUMER_MINT:claims=>{if(claims?.purpose!=='invoke'||typeof claims.clientId!=='string'||claims.clientId===config.APP_ORIGIN||claims.feature!==undefined)throw Object.assign(new Error('Consumer tokens are app invoke tokens only.'),{code:'invalid_request'});if(!siteEnabled(config,'BROKERING_ENABLED',{client:{clientId:claims.clientId}}))throw Object.assign(new Error('Feature unavailable.'),{code:'feature_unavailable'});return mint(claims);},...introspection===true?{BROKERED_INTROSPECTION_MOUNTED:true}:{}}:{},
  ...available('BROKERING_ENABLED')&&typeof mint==='function'&&egress?{BROKERING_MINT:claims=>mint({...claims,clientId:config.APP_ORIGIN}),INTEGRATION_EGRESS:egress,...available('KEY_DELEGATION_ENABLED')&&typeof describe==='function'?{MESSAGING_DESCRIBE:describe}:{}}:{},
 };
}
