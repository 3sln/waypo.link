// Parlay's trusted `services` and `egress` ports for the simulation (apps/parlay/worker/README.md "Trusted ports and
// provisioning"). Test-only: nothing here is imported by production code. Every port that can reach a REAL provider
// does so through the simulation network, and the gaps are named where they are:
//
// - resolveKey: the provider's public identity document (`GET /identity/<sub>/identity.json`, DIRECTORY_ENABLED),
//   fetched over the simulation network. The key is the one whose kid the certificate names.
// - delegationStatus: the provider's public delegation status route (`GET /identity/<sub>/delegations/<jkt>`,
//   KEY_DELEGATION_ENABLED), over the simulation network.
// - certify: the provider's DelegationRegistry signs with the owner's real identity key, but there is NO app-facing
//   issue/renew route yet (packages/runtime/account/identity.mjs `delegationOperation` is an "internal app/system entry"
//   with no HTTP surface). The adapter therefore calls that entry in process, as the trusted installation code the
//   README describes would, and records each call. Occupancy (Parlay as the owner's messaging-mailbox occupant) is
//   answered by `occupant()` below for people who enrolled, because Parlay has no Bindle installation flow either
//   (no /bindle/start, /bindle/callback). Both are expected-pending steps in tests/sim/parts/parlay.mjs.
// - authenticate: a per-person app credential this adapter issues at enrolment (the shell's documented "existing app
//   credential" sign-in), standing in for an app session Parlay cannot create yet.
// - egress: HTTPS only to the simulation's hosts on 443 (the network's fetch refuses every other name), no redirects,
//   bounded body and time. Parlay delivers to other mailboxes' /bindle/ingress through it.
import {randomBytes} from 'node:crypto';

export const PARLAY_ORIGIN='https://messages.example';
export const PARLAY_CLIENT_ID=PARLAY_ORIGIN+'/bindle/client.json';
export const PARLAY_INGRESS=PARLAY_ORIGIN+'/bindle/ingress';
const PURPOSES=['author','receipt','archive'].map(p=>`https://spec.bindle.example/messaging/v1/purposes/${p}`);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail=(code,message,status)=>Object.assign(new Error(message),{code,status});
const MAX_BYTES=4*1024*1024;

export function createParlayAdapter({network,providers=()=>({})}){
 const credentials=new Map(),enrolled=new Map(),calls=[];
 let jwks=null;
 const issuerOf=origin=>Object.values(providers()).find(p=>p.origin===origin);
 const record=(kind,detail)=>{calls.push({kind,...detail,at:Date.now()});if(calls.length>20000)calls.shift();};

 async function getJSON(url){
  const response=await network.fetch(url,{headers:{accept:'application/json'}});
  if(response.status===404)return null;if(!response.ok)throw fail('recipient_unavailable',`${new URL(url).pathname} answered ${response.status}`,503);
  return response.json();
 }

 const services={
  async authenticate({authorization}){
   const token=/^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(authorization??'')?.[1],owner=token&&credentials.get(token);
   return owner?{kind:'owner',owner}:null;
  },
  async resolveKey({issuer,subject,keyId}){
   if(!issuerOf(issuer)||!UUID.test(subject??''))return null;
   const document=await getJSON(`${issuer}/identity/${subject}/identity.json`);record('resolve-key',{issuer});
   const identityURI=`${issuer}/identity/${subject}`;
   const key=(document?.keys??[]).find(k=>k.kid===keyId||`${identityURI}#${k.kid}`===keyId);
   return key?.jwk?{keyId,publicJwk:{kty:key.jwk.kty,crv:key.jwk.crv,x:key.jwk.x,y:key.jwk.y},identityURI}:null;
  },
  async delegationStatus({issuer,subject,jkt}){
   if(!issuerOf(issuer)||!UUID.test(subject??''))return {status:'revoked'};
   const response=await network.fetch(`${issuer}/identity/${subject}/delegations/${encodeURIComponent(jkt)}`);record('delegation-status',{issuer});
   if(!response.ok)throw fail('recipient_unavailable',`delegation status answered ${response.status}`,503);
   return response.json();
  },
  async certify({owner,renew,input}){
   const person=enrolled.get(owner);if(!person)throw fail('not_authorized','Parlay is not installed for this account.',403);
   const provider=issuerOf(person.issuer);if(!provider)throw fail('recipient_unavailable','Unknown provider.',503);
   record('certify',{issuer:person.issuer,renew:!!renew});
   const controller=provider.app.resources.accounts.get(owner);
   return controller.delegationOperation(owner,{actor:{kind:'app',owner,clientId:PARLAY_CLIENT_ID},operation:renew?'delegations.renew':'delegations.issue',input});
  },
  async publicJwks(){return jwks;}
 };

 const egress={async fetch(request){
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.port&&url.port!=='443')throw fail('recipient_unavailable','Egress allows HTTPS on 443 only.',503);
  const body=['GET','HEAD'].includes(request.method)?undefined:new Uint8Array(await request.arrayBuffer());
  if(body&&body.length>MAX_BYTES)throw fail('recipient_unavailable','Request too large.',503);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await network.fetch(url.href,{method:request.method,headers:Object.fromEntries(request.headers),body,signal:controller.signal});record('egress',{target:url.host,path:url.pathname.replace(/[^/]{16,}$/,':token'),status:response.status});return response;}
  finally{clearTimeout(timer);}
 }};

 return {services,egress,calls,
  /** Per-run confidential-client key (publicJwks). */
  async init(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),{kty,crv,x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);jwks={keys:[{kty,crv,x,y,kid:'sim-'+randomBytes(6).toString('hex'),alg:'ES256',use:'sig'}]};},
  /** Messaging-mailbox occupancy for providers' DELEGATION_SLOT_OCCUPANT port: Parlay, only for enrolled owners. */
  occupant({owner}){const person=enrolled.get(owner);return person?{clientId:PARLAY_CLIENT_ID,origin:PARLAY_ORIGIN,ingress:PARLAY_INGRESS,cnx:person.cnx,purposes:[...PURPOSES].sort()}:null;},
  /** Records an installation and issues the person's app credential. */
  enrol({issuer,subject}){
   if(!UUID.test(subject))throw new TypeError('subject');
   if(!enrolled.has(subject))enrolled.set(subject,{issuer,cnx:'sim-cnx-'+randomBytes(8).toString('hex')});
   const token=randomBytes(24).toString('base64url');credentials.set(token,subject);return token;
  },
  enrolled
 };
}
