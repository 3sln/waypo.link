// Signaling owner settings as GET /api/signaling/settings answers them (signaling.md rev 3.2 §14.1; shared by the bl
// engine, view and real-browser tests of the re-homed owner controls). Times are Unix milliseconds.
export const ORIGIN='https://space.example';
export const OWNER='550e8400-e29b-41d4-a716-446655440001',OTHER='550e8400-e29b-41d4-a716-446655440002';
export const CHAT='https://kinds.example/session/chat/v1',SYNC='https://kinds.example/session/device-sync/v1';
export const APP='https://app.example/client',APP2='https://other.example/client',LOOSE='https://loose.example/client';
const now=Date.UTC(2026,9,28,12,0,0);
export const NOW=now;
export const FAR={iss:'https://far.example',sub:'990e8400-e29b-41d4-a716-000000000009'};
const pairing=(id,over={})=>({id,revision:1,kind:{artefact:SYNC,version:1,digest:'sha-256:'+'a'.repeat(43)},local:{client_id:APP,client_session:null},peer:{self:{client_id:APP2,client_session:null}},opens:'both',accept:'auto',label:'Desk to phone',created_via:'provider-page',state:'live',expires_at:null,createdAt:now-86400000,...over});
export const SETTINGS=Object.freeze({enabled:true,
 policy:{other:'relay',self:'all',revision:3},
 apps:[
  {clientId:APP,name:'Studio',origin:'https://app.example',
   approvals:[{kind:CHAT,version:2,digest:'sha-256:'+'b'.repeat(43),title:{en:'Chat',es:'Charla'},autoConnect:false,at:now-3600000},{kind:SYNC,version:1,digest:'sha-256:'+'c'.repeat(43),title:{en:'Device sync',es:'Sincronización'},autoConnect:true,at:now-3600000}],
   endpoints:[{endpoint:'ep_'+'a'.repeat(22),label:'Laptop',kinds:[CHAT,SYNC],lastSeen:now-60000},{endpoint:'ep_'+'b'.repeat(22),label:null,kinds:[CHAT],lastSeen:now-120000}],
   offers:[{id:'of_open',kind:CHAT,principal:null,uses:10,spent:3,reserved:1,expiresAt:now+86400000},{id:'of_bound',kind:CHAT,principal:{iss:ORIGIN,sub:OTHER},uses:1,spent:0,reserved:0,expiresAt:now+3600000}],
   pairings:[pairing('pr_self'),pairing('pr_peer',{label:null,peer:{principal:FAR},opens:'local',state:'awaiting_confirmation',expires_at:now+7*86400000})]},
  {clientId:APP2,name:'Other app',origin:'https://other.example',approvals:[],endpoints:[],offers:[],pairings:[]},
  {clientId:LOOSE,name:null,origin:'https://loose.example',approvals:[{kind:SYNC,version:1,digest:'sha-256:'+'d'.repeat(43),title:null,autoConnect:false,at:now}],endpoints:[],offers:[],pairings:[]}],
 pairings:[pairing('pr_self'),pairing('pr_peer',{label:null,peer:{principal:FAR},opens:'local',state:'awaiting_confirmation',expires_at:now+7*86400000})],
 blocked:[{principal:FAR,at:now,handle:null},{principal:{iss:ORIGIN,sub:OTHER},at:now,handle:'river'}],
 blockedIssuers:[{issuer:'https://spam.example',at:now}],
 sessions:[]});
