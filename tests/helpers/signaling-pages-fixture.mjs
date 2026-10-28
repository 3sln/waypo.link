// Signaling owner-page reviews and reads as the server answers them (POST /api/signaling/review, GET
// /api/signaling/pairing, GET /api/orgs/{org}/signaling; packages/signaling/owner-pages.mjs), for the bl engine, view
// and real-browser tests of the console view `signaling`. Builds on the owner settings of signaling-controls-fixture.mjs.
import {SETTINGS,OWNER,ORIGIN,APP,APP2,CHAT,SYNC,FAR,NOW} from './signaling-controls-fixture.mjs';
export {SETTINGS,OWNER,ORIGIN,APP,APP2,CHAT,SYNC,FAR,NOW};
export const ORG='550e8400-e29b-41d4-a716-4466554400aa';
const DAY=86400000;
const kind=(artefact,{title='Chat',parties='any',profiles=['data','webrtc'],categories=['personal-data'],version=2}={})=>({artefact,version,digest:'sha256-'+'b'.repeat(43),host:new URL(artefact).host,title:{en:title,es:title==='Chat'?'Charla':title},summary:{en:title+' sessions.'},reviewed:false,effect:'join',categories,fields:[{name:'call',title:{en:'Call'},categories}],parties,profiles,bases:null});
const app=clientId=>({client_id:clientId,client_session:null,origin:new URL(clientId).origin});
export const APPROVE_REVIEW=Object.freeze({action:'session-approve',review:'rv_'+'a'.repeat(22),armAt:NOW+1000,expiresAt:NOW+600000,input:{clientId:APP,kind:{artefact:CHAT,version:2,digest:'sha256-'+'b'.repeat(43)}},
 disclosure:{handler:app(APP),kind:kind(CHAT),risk:'medium',sees:['identity','origin','context'],serviceClass:false,autoConnectAllowed:false,existing:null,addsDisclosure:false,
  activatable:[{id:'pr_'+'p'.repeat(22),label:'Desk to phone',state:'pending',opens:'both',kind:{artefact:CHAT,version:2,digest:'x'},local:app(APP),peer:{self:app(APP2)},expires_at:null}]}});
export const SYNC_REVIEW=Object.freeze({...APPROVE_REVIEW,review:'rv_'+'s'.repeat(22),input:{clientId:APP,kind:{artefact:SYNC,version:1,digest:'sha256-'+'c'.repeat(43)}},disclosure:{...APPROVE_REVIEW.disclosure,kind:kind(SYNC,{title:'Device sync',parties:'self',version:1}),autoConnectAllowed:true,activatable:[],serviceClass:true,serviceLimits:{openSeconds:7776000,boundSeconds:604800},existing:{version:0,autoConnect:false},addsDisclosure:true}});
export const PAIR_INPUT=Object.freeze({kind:{artefact:CHAT,version:2,digest:'sha256-'+'b'.repeat(43)},local:{client_id:APP,client_session:null},peer:{principal:FAR},opens:'local',label:'Bob',expiresAt:NOW+90*DAY,created_via:'settings'});
export const PAIR_REVIEW=Object.freeze({action:'pairing-create',review:'rv_'+'c'.repeat(22),armAt:NOW+1000,expiresAt:NOW+600000,input:PAIR_INPUT,
 disclosure:{kind:kind(CHAT),local:app(APP),peer:{principal:FAR,issuerOrigin:'https://far.example',handle:null,sameProvider:false},opens:'local',label:'Bob',cross:true,expiresAt:NOW+90*DAY,effect:{direct:true,data:true,categories:['personal-data']},peerCanTellRunning:true,recipientOnlyEnforcement:true,parties:[{client_id:APP,connected:true,approved:true}],activateNow:true}});
export const OWN_PAIR_REVIEW=Object.freeze({...PAIR_REVIEW,review:'rv_'+'o'.repeat(22),input:{...PAIR_INPUT,peer:{self:{client_id:APP2,client_session:null}},opens:'both',label:'Desk',expiresAt:null},
 disclosure:{...PAIR_REVIEW.disclosure,peer:{self:app(APP2)},opens:'both',label:'Desk',cross:false,expiresAt:null,peerCanTellRunning:false,recipientOnlyEnforcement:false,parties:[{client_id:APP,connected:true,approved:true},{client_id:APP2,connected:true,approved:false}],activateNow:false}});
export const PENDING_ID='pr_'+'q'.repeat(22);
export const DETAIL=Object.freeze({pairing:{id:PENDING_ID,revision:1,kind:{artefact:CHAT,version:2,digest:'sha256-'+'b'.repeat(43)},local:{client_id:APP,client_session:null},peer:{principal:FAR},opens:'local',accept:'auto',label:'Bob',created_via:'settings',state:'pending',expires_at:NOW+90*DAY,createdAt:NOW-DAY},
 kind:kind(CHAT),effect:{direct:true,data:true,categories:['personal-data']},local:app(APP),peer:{principal:FAR,issuerOrigin:'https://far.example',handle:null,sameProvider:false},parties:[{client_id:APP,connected:true,approved:true}],newer:null,maxExpiresAt:NOW+366*DAY,enabled:true});
export const LIVE_DETAIL=Object.freeze({...DETAIL,pairing:{...DETAIL.pairing,state:'live',revision:2},newer:{kind:kind(CHAT,{version:3,categories:['personal-data','location']}),addsDisclosure:true}});
export const ACTIVATE_REVIEW=Object.freeze({action:'pairing-activate',review:'rv_'+'d'.repeat(22),armAt:NOW+1000,expiresAt:NOW+600000,input:{id:PENDING_ID,revision:1},
 disclosure:{id:PENDING_ID,label:'Bob',state:'pending',opens:'local',cross:true,expires_at:NOW+90*DAY,kind:kind(CHAT),local:app(APP),peer:{principal:FAR,issuerOrigin:'https://far.example',handle:null,sameProvider:false},effect:{direct:true,data:true,categories:['personal-data']},peerCanTellRunning:true,recipientOnlyEnforcement:true,parties:[{client_id:APP,connected:true,approved:true}],activateNow:true}});
export const RENEW_REVIEW=Object.freeze({action:'pairing-update',review:'rv_'+'e'.repeat(22),armAt:NOW+1000,expiresAt:NOW+600000,input:{id:PENDING_ID,revision:2,expiresAt:NOW+365*DAY},
 disclosure:{...ACTIVATE_REVIEW.disclosure,state:'live',current:{expires_at:NOW+90*DAY,kind:kind(CHAT)},next:{expires_at:NOW+365*DAY}}});
export const SERVICE=Object.freeze({designated:false,eligible:true,revision:0,longOffers:0,enabled:true});
export const SERVICE_REVIEW=Object.freeze({action:'set-service',review:'rv_'+'f'.repeat(22),armAt:NOW+1000,expiresAt:NOW+600000,input:{designated:true,revision:0},disclosure:{openSeconds:7776000,boundSeconds:604800,personSeconds:900,apps:[{...app(APP),kinds:[CHAT]}]}});
/** A cross-entity pairing as the settings read lists it (with the verified handle the route adds). */
export const SETTINGS_WITH_PEERS=Object.freeze({...structuredClone(SETTINGS),pairings:[...structuredClone(SETTINGS.pairings),{...structuredClone(DETAIL.pairing)},{...structuredClone(DETAIL.pairing),id:'pr_'+'r'.repeat(22),label:'River',state:'live',peer:{principal:{iss:ORIGIN,sub:'550e8400-e29b-41d4-a716-446655440002'}},peerHandle:'river'}]});
