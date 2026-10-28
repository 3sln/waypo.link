// Shared receive fixtures (no tests of its own; named to stay inside the receive* test ownership glob).
// Mailbox engines are installed on the seeded network simulator's peers; bob and carol share one hub ingress and one
// edge index. First contact is credential-less and gated by the recipient's list policy (messaging §6.7; contact links
// were removed in contacts spike phase 4): `w.admit(to, {policy})` names a list on the recipient, and `w.deliver` puts
// the sender in it before posting (pass `null` to post without any admission). A fake email-bridge port supplies
// bridge consumer keys and calibrations.
// Test-only: no provider, directory, delegation service or deployment is implied.
import {createNetwork} from './helpers/network.mjs';
import {createTestEngine,memoryStore} from './helpers/engine.mjs';
import {fakeClock} from '../helpers/chaos.mjs';
import {operations} from '../../packages/messaging-engine/engine.mjs';
import {ContactsDomain,ReceiveDomain} from '../../packages/messaging-engine/store/mailbox.mjs';
import {createEdgeIndex,flushEdgeOutbox} from '../../packages/messaging-engine/store/edge-index.mjs';
import {RECEIVE_OPERATIONS} from '../../packages/messaging-engine/domains/receive.mjs';
import {handleConversationIngress} from '../../packages/messaging-engine/domains/conversations.mjs';
import {INVITE_OPERATIONS,ReceiveFirstContact,ReceiveRedeem} from '../../packages/messaging-engine/domains/invites.mjs';
import {CONTACT_OPERATIONS} from '../../packages/messaging-engine/domains/contacts.mjs';
import {INTAKE_OPERATIONS,IntakeDeliver} from '../../packages/messaging-engine/domains/intake.mjs';
import {DELEGATION_OPERATIONS} from '../../packages/messaging-engine/domains/delegation.mjs';
import * as B from '../../packages/messaging-protocol/index.mjs';
import {NOW,INGRESS,generateKeys,party,world,firstContactPayload,initEnvelope,uuidOf,encoder} from './vectors/fixtures.mjs';

export const REGISTRY=operations(...RECEIVE_OPERATIONS,...CONTACT_OPERATIONS,...INTAKE_OPERATIONS,...DELEGATION_OPERATIONS,...INVITE_OPERATIONS);
export const keys=await generateKeys();
export const P={alice:await party('alice',keys),bob:await party('bob',keys),carol:await party('carol',keys)};
export {NOW,INGRESS,B,uuidOf,encoder,firstContactPayload,initEnvelope};
const ES={name:'ECDSA',hash:'SHA-256'};
const enc=v=>B.base64url(encoder.encode(JSON.stringify(v)));
export async function signCompact(header,claims,privateKey){const head=`${enc(header)}.${enc(claims)}`;return `${head}.${B.base64url(new Uint8Array(await crypto.subtle.sign(ES,privateKey,encoder.encode(head))))}`;}

// Fake email-bridge port (the owner's provider; spec §9) for one owner: consumer keys, accepted notices, calibrations.
export function bridgePort(){
 const calls={consumerKey:0,accepted:0},state={consumers:new Map(),accepted:[]};
 return {calls,state,
  async consumerKey({consumer,keyId}){calls.consumerKey++;const k=state.consumers.get(consumer);return k&&k.keyId===keyId?{keyId,publicJwk:k.publicJwk}:null;},
  async accepted({jti}){calls.accepted++;state.accepted.push(jti);return {};},
 };
}
// A bridge consumer with its own published key (spec §9).
export async function bridgeConsumer(origin='https://bob.provider.example'){
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const keyId=`${origin}/keys/bridge-1`;let n=0;
 return {origin,keyId,publicJwk:{kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y},
  async args({recipient,from='spammer@spam.example',text='Buy now',dmarc='pass',automation=[],receivedAt,jti=`mail-${++n}`}){
   const message={parts:[{mimeType:'text/plain',dataBase64url:B.base64url(encoder.encode(text))}]};
   const provenance=await signCompact({alg:'ES256',kid:keyId,typ:'bindle-intake-provenance+jwt'},{bindle:'intake-provenance',v:1,iss:origin,channel:'email',recipient,receivedAt,sender:{envelopeFrom:from,headerFrom:`Sender <${from}>`},dmarc,automation,ingressFingerprint:'fp-1',normalizedDigest:await B.intakeDigest(message),jti},pair.privateKey);
   return {message,provenance};
  }};
}

export async function createWorld({seed=1,rules=[],classifier=null,userStorage=null,faults={}}={}){
 const clock=fakeClock(NOW),network=createNetwork({clock,seed,rules}),directory=world(P),edge=createEdgeIndex(memoryStore()),bridges={},delivered={count:0};
 const engineOf=owner=>[...network.peers.values()].find(peer=>peer.owner===owner);
 const refuse=async()=>{throw new B.ProtocolFault('not_authorized');},conversationEdge={check:refuse,route:refuse};
 for(const [name,peer] of network.peers){
  await peer.engine.dispose();bridges[name]=bridgePort();
  // A fresh directory facade per engine start, so in-memory caches do not survive a restart (revocations do).
  const providers=()=>({directory:{resolveKey:q=>directory.resolveKey(q),status:q=>directory.status(q)},delegateKeys:{current:async()=>peer.signer??P[name].signer},providerBridge:bridges[name],classifier:peer.classifier??classifier,userStorage,contacts:ContactsDomain,receive:ReceiveDomain});
  const start=()=>createTestEngine({seed:seed+1,owner:peer.owner,clock:peer.clock,store:peer.store,providers:providers(),registry:REGISTRY,faults:peer.faults??faults[name]??{}});
  peer.engine=start();peer.restart=async()=>{peer.online=false;await peer.engine.dispose();peer.engine=start();peer.online=true;};
  const dispatch=Operation=>(owner,input)=>{delivered.count++;const target=engineOf(owner);return target.engine.perform(new Operation({actor:{kind:'ingress',owner},input}));};
  peer.handler=request=>handleConversationIngress(request,{edge,conversationEdge,now:()=>peer.clock.now(),deliverRecord:refuse,deliverResponse:refuse,deliverFirst:dispatch(ReceiveFirstContact),deliverInvite:dispatch(ReceiveRedeem)});
  await peer.engine.run('receive.configure',{input:{principal:P[name].principal,ingress:INGRESS[name]}});
  await flushEdgeOutbox(peer.store,edge,peer.owner);
 }
 const w={network,clock,directory,edge,bridges,delivered,peers:network.peers,
  peer:name=>network.peers.get(name),
  run:(name,op,input)=>network.peers.get(name).engine.run(op,{input}),
  system:(name,op,input)=>{const peer=network.peers.get(name),Operation=REGISTRY[op];return peer.engine.perform(new Operation({actor:{kind:'system',owner:peer.owner,reason:'test'},input}));},
  intake:(name,input)=>{const peer=network.peers.get(name);return peer.engine.perform(new IntakeDeliver({actor:{kind:'ingress',owner:peer.owner},input}));},
  flush:name=>flushEdgeOutbox(network.peers.get(name).store,edge,network.peers.get(name).owner),
  // A list on `to` that admits first contact: the built-in Contacts (`message`) or a new list with `policy`.
  async admit(to,{policy='message'}={}){const list=policy==='message'?'contacts':(await w.run(to,'lists.create',{name:`List ${policy}`,policy})).id;return {to,list,policy};},
  async enlist(from,to,admission){if(!admission)return;const p=P[from].principal,key=`list-member/${admission.list}/${encodeURIComponent(p.issuer)}|${encodeURIComponent(p.subject)}`;if(!await network.peers.get(to).store.get(key))await w.run(to,'lists.add',{list:admission.list,principal:{issuer:p.issuer,subject:p.subject}});},
  // Builds and signs one first-contact envelope (recipient {issuer, owner}); returns {envelope, body}.
  async envelope(from,to,admission,{kind='one-off',body=encoder.encode(`Hello from ${from}`),operationId=uuidOf(1),createdAt=w.clock.now()-1000,subject='Hello',signer=P[from].signer,author=P[from].author,tamper,...over}={}){
   const payload=await firstContactPayload(P[from],P[to],{kind,body,operationId,createdAt,subject,...over});payload.author=author;
   let envelope=kind==='conversation-init'?await initEnvelope(P[from],P[to],[P[from],P[to]],{body,createdAt}).then(async e=>B.signEnvelope({...e.payload,recipient:payload.recipient,operationId},signer)):await B.signEnvelope(payload,signer);
   if(tamper)envelope=tamper(structuredClone(envelope));return {envelope,body};
  },
  request(to,admission,{envelope,body},{authorization,idempotencyKey}={}){const {contentType,bytes}=B.encodeDelivery(envelope,{body:envelope.payload.content?body:null,boundary:'bb2-boundary'});return {method:'POST',url:INGRESS[to],headers:{...authorization?{authorization}:{},'content-type':contentType,...idempotencyKey?{'idempotency-key':idempotencyKey}:{}},body:bytes};},
  async post(from,to,request){const response=await network.send(from,to,request);return {status:response.status,headers:response.headers,json:await response.json()};},
  // Admits `from` (when an admission is given), then builds, signs and POSTs one first-contact delivery through the
  // simulator; returns {status, json, envelope, body, request}.
  async deliver(from,to,admission,options={},requestOptions={}){await w.enlist(from,to,admission);const built=await w.envelope(from,to,admission,options),request=w.request(to,admission,built,requestOptions);return {...await w.post(from,to,request),...built,request};},
  // Sender-side check of a custody receipt (spec §8.1).
  async verify(to,{envelope,body},receipt){return B.verifyReceipt(receipt,{obligation:{principal:P[to].principal,ingress:INGRESS[to],operationId:envelope.payload.operationId,payloadDigest:await B.payloadDigest(envelope),bodyDigest:envelope.payload.content?await B.sha256(crypto,body):null,kind:envelope.payload.kind},resolveKey:directory.resolveKey,status:directory.status,now:w.clock.now()});},
  items:async name=>[...(await network.peers.get(name).store.list({prefix:'item/'})).values()],
  budget:name=>network.peers.get(name).store.get('budget/v1'),
  dispose:()=>network.dispose(),
 };
 return w;
}
