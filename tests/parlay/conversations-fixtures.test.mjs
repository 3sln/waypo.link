// Shared BB-B4 conversation fixtures (no tests of its own; named to stay inside the conversations* ownership glob).
// A 3–5 party mesh on the seeded network simulator: each party has a test identity key, a delegate key with a
// certificate binding its ingress, a mailbox engine with contacts, receive, outbox and conversations, and one host
// handler (handleConversationIngress). bob and carol share one hub ingress; every host shares one edge store.
// Test-only: no provider, directory, delegation service, durable adapter or deployment is implied.
import {createNetwork} from './helpers/network.mjs';
import {createTestEngine,memoryStore} from './helpers/engine.mjs';
import {fakeClock} from '../helpers/chaos.mjs';
import {createMailbox} from '../../apps/parlay/worker/mailbox.mjs';
import {createHTTP} from '../../apps/parlay/worker/http.mjs';
import {operations} from '../../packages/messaging-engine/engine.mjs';
import {ContactsDomain,ReceiveDomain} from '../../packages/messaging-engine/store/mailbox.mjs';
import {createEdgeIndex,flushEdgeOutbox} from '../../packages/messaging-engine/store/edge-index.mjs';
import {RECEIVE_OPERATIONS} from '../../packages/messaging-engine/domains/receive.mjs';
import {CONTACT_OPERATIONS} from '../../packages/messaging-engine/domains/contacts.mjs';
import {DELEGATION_OPERATIONS} from '../../packages/messaging-engine/domains/delegation.mjs';
import {SEND_OPERATIONS} from '../../packages/messaging-engine/domains/send.mjs';
import {OUTBOX_OPERATIONS,createOutboxProvider} from '../../packages/messaging-engine/domains/outbox.mjs';
import {EVENT_OPERATIONS} from '../../packages/messaging-engine/domains/events.mjs';
import {CONVERSATION_OPERATIONS,ConversationsDomain,ConversationsReceive,ConversationsRespond,createConversationEdge,flushConversationEdge,handleConversationIngress,withConversations} from '../../packages/messaging-engine/domains/conversations.mjs';
import * as B from '../../packages/messaging-protocol/index.mjs';
import {INVITE_OPERATIONS,ReceiveRedeem,ReceiveFirstContact,addMember,CONTACTS_LIST} from '../../packages/messaging-engine/domains/invites.mjs';

export {B};
export const NOW=Date.UTC(2026,9,20,12);
export const REGISTRY=operations(...RECEIVE_OPERATIONS,...CONTACT_OPERATIONS,...DELEGATION_OPERATIONS,...SEND_OPERATIONS,...OUTBOX_OPERATIONS,...EVENT_OPERATIONS,...CONVERSATION_OPERATIONS,...INVITE_OPERATIONS);
export const encoder=new TextEncoder();
const ES={name:'ECDSA',namedCurve:'P-256'},pub=({kty,crv,x,y})=>({kty,crv,x,y});
const HOSTS={alice:'https://alice.box.example/ingress',bob:'https://hub.box.example/ingress',carol:'https://hub.box.example/ingress',dave:'https://dave.box.example/ingress',erin:'https://erin.box.example/ingress'};

// `storage: true` composes an in-memory user storage resource per party (bodies of 4 KiB or more are staged there).
// `issuers` maps a party to a shared provider origin (same-host invitations, contacts spike CL-24); `budget` is the
// edge's first-contact budget (createFirstContactBudget), absent by default.
export async function createMesh({names=['alice','bob','carol','dave'],seed=1,rules=[],maxParticipants={},shell=false,storage=false,issuers={},budget}={}){
 const clock=fakeClock(NOW),network=createNetwork({peers:names,clock,seed,rules}),edgeStore=memoryStore(),edge=createEdgeIndex(edgeStore),conversationEdge=createConversationEdge(edgeStore,{now:()=>clock.now()});
 const parties=new Map(),revoked=new Map(),routes=new Map(),calls={status:0,resolve:0};
 const directory={
  resolveKey:async({issuer,subject,keyId})=>{calls.resolve++;const p=[...parties.values()].find(p=>p.principal.issuer===issuer&&p.principal.subject===subject);return p&&p.keyId===keyId?{keyId,publicJwk:p.identity.publicJwk,identityURI:p.principal.identityURI}:null;},
  status:async({jkt})=>{calls.status++;return revoked.has(jkt)?{status:'revoked',revokedHour:revoked.get(jkt)}:{status:'active'};},
 };
 // A certificate for the party's current delegate key, issued at the current clock with its current ingress.
 async function certify(party){
  const jkt=await B.thumbprint(party.delegateJwk),iat=Math.floor(clock.now()/1000)-60;
  party.since??=iat-86400;
  const delegation=await B.encodeDelegation({bindle:'key-delegation',v:1,iss:party.principal.issuer,sub:party.principal.subject,delegate:party.delegateJwk,jkt,purposes:[B.PURPOSES.author,B.PURPOSES.receipt].sort(),client:{client_id:`https://${party.name}.box.example/client.json`,origin:new URL(party.ingress).origin,ingress:party.ingress},cnx:`cnx-${party.name}`,since:party.since,jti:`cert-${party.name}-${jkt.slice(0,8)}-${iat}`,iat,exp:iat+86400},{privateKey:party.identity.privateKey,keyId:party.keyId});
  party.jkt=jkt;party.signer={privateKey:party.delegatePrivate,delegation,kid:`jkt:${jkt}`};
 }
 const engineOf=owner=>[...parties.values()].find(p=>p.owner===owner);
 for(const name of names){
  const peer=network.peers.get(name);await peer.engine.dispose();
  const issuer=issuers[name]??`https://${name}.provider.example`,owner=peer.owner,principal={issuer,subject:owner,identityURI:`${issuer}/identity/${owner}`},keyId=`${principal.identityURI}#k1`;
  const identity=await crypto.subtle.generateKey(ES,true,['sign','verify']),delegate=await crypto.subtle.generateKey(ES,true,['sign','verify']);
  const objects=new Map(),userStorage=storage?{objects,put:async(k,v)=>{objects.set(k,Uint8Array.from(v));},get:async k=>objects.get(k)??null,delete:async k=>{objects.delete(k);}}:null;
  const party={name,owner,peer,principal,keyId,userStorage,ingress:shell?(HOSTS[name]??`https://${name}.box.example/ingress`).replace('/ingress','/bindle/ingress'):HOSTS[name]??`https://${name}.box.example/ingress`,identity:{privateKey:identity.privateKey,publicJwk:pub(await crypto.subtle.exportKey('jwk',identity.publicKey))},delegatePrivate:delegate.privateKey,delegateJwk:pub(await crypto.subtle.exportKey('jwk',delegate.publicKey)),store:peer.store,links:0};
  await certify(party);parties.set(name,party);routes.set(party.ingress,routes.get(party.ingress)??name);
  // Outbox transport: route by exact ingress or its return-control prefix to the host's simulator peer.
  const egress={fetch:async(url,init)=>{const target=[...routes].find(([ingress])=>url===ingress||url.startsWith(`${ingress}/return/`));if(!target)throw Object.assign(new Error('Unknown simulated ingress'),{code:'network_denied'});const {signal,...wire}=init;return network.send(name,target[1],{url,...wire});}};
  const Outbox=createOutboxProvider({PARLAY_ENABLED:true,authorize:withConversations(()=>true),renewDelegation:async()=>{await certify(party);return party.signer.delegation;}});
  const delegateKeys={current:async()=>party.current?party.current():party.signer,renew:()=>certify(party)};
  const start=()=>shell?(()=>{const box=createMailbox({store:peer.store,clock:peer.clock,PARLAY_ENABLED:true,ports:{egress,directory,delegateKeys}});return {...box,run:(op,params)=>box.run(owner,op,params)};})():createTestEngine({seed:seed+1,owner,clock:peer.clock,store:peer.store,registry:REGISTRY,providers:{conversations:ConversationsDomain,contacts:ContactsDomain,receive:ReceiveDomain,outbox:Outbox,egress,directory:{resolveKey:q=>directory.resolveKey(q),status:q=>directory.status(q)},delegateKeys:{current:async()=>party.current?party.current():party.signer},userStorage,classifier:null}});
  peer.engine=start();party.engine=()=>peer.engine;
  peer.restart=async()=>{peer.online=false;await peer.engine.dispose();peer.engine=start();peer.online=true;};
  peer.handler=request=>handleConversationIngress(request,{edge,conversationEdge,now:()=>clock.now(),
   deliverRecord:(o,input)=>engineOf(o).peer.engine.perform(new ConversationsReceive({actor:{kind:'ingress',owner:o},input})),
   deliverResponse:(o,input)=>engineOf(o).peer.engine.perform(new ConversationsRespond({actor:{kind:'ingress',owner:o},input})),
   deliverInvite:(o,input)=>engineOf(o).peer.engine.perform(new ReceiveRedeem({actor:{kind:'ingress',owner:o},input})),
   deliverFirst:(o,input)=>engineOf(o).peer.engine.perform(new ReceiveFirstContact({actor:{kind:'ingress',owner:o},input})),budget});
  if(shell){await peer.engine.run('shell.bind');await peer.engine.run('shell.authorization',{input:{revision:1,active:true,recipients:[]}});}
  await peer.engine.run('receive.configure',{input:{principal,ingress:party.ingress}});
  if(maxParticipants[name])await peer.engine.run('conversations.configure',{input:{maxParticipants:maxParticipants[name]}});
 }
 if(shell){const http=createHTTP({PARLAY_ENABLED:true,edge,conversationEdge,mailbox:async owner=>({run:(owner,name,params)=>engineOf(owner).peer.engine.run(name,params)})});for(const p of parties.values())p.peer.handler=request=>http(new Request(request.url,{method:request.method,headers:request.headers,body:request.body}));}
 for(const [name,party] of parties)if(routes.get(party.ingress)!==name)network.peers.get(name).handler=network.peers.get(routes.get(party.ingress)).handler;
 const m={network,clock,parties,directory,calls,edgeStore,revoked,
  party:name=>parties.get(name),
  // Drive bounded, resumable timeline builds to completion for fixture-level reads.
  async run(name,op,input){for(let step=0;step<1024;step++){try{return await parties.get(name).peer.engine.run(op,{input});}catch(e){if(e.code!=='conversation_index_building'||step===1023)throw e;}}},
  get:(name,conversationId)=>m.run(name,'conversations.get',{conversationId}),
  async flush(){for(const p of parties.values()){await flushEdgeOutbox(p.store,edge,p.owner);await flushConversationEdge(p.store,conversationEdge,p.owner);}},
  // Runs every online party's conversation drain and outbox drain until a round does nothing.
  async settle({rounds=30,advance=false}={}){
   let total=0;
   for(let round=0;round<rounds;round++){
    await m.flush();let busy=0,next=null;
    for(const p of parties.values()){
     if(!p.peer.online)continue;
     const d=await m.run(p.name,'conversations.drain');busy+=d.work+d.submitted+d.responses;await m.flush();
     const o=await m.run(p.name,'outbox.drain');busy+=o.attempted;if(o.pending&&o.nextAlarmAt!==null)next=next===null?o.nextAlarmAt:Math.min(next,o.nextAlarmAt);
     for(const [,w] of await p.store.list({prefix:'conv/work/'}))if(w.nextAt>clock.now())next=next===null?w.nextAt:Math.min(next,w.nextAt);
    }
    total+=busy;if(!busy){if(!advance||next===null||next<=clock.now())break;clock.set(next);}
   }
   await m.flush();return total;
  },
  // Mutual Contacts membership with each side's verified binding, as an accepted invitation would leave it (test-only
  // seeding through the engine's own addMember; contact links were removed in contacts spike phase 4). `a` can then
  // invite `b` by principal, and `b`'s list policy admits `a`'s credential-less first contact.
  async connect(a,b){for(const [x,y] of [[a,b],[b,a]]){const px=parties.get(x),py=parties.get(y);await px.store.transaction(tx=>addMember(tx,CONTACTS_LIST,py.principal,{via:{kind:'manual'},now:clock.now(),binding:{keyId:py.keyId,ingress:py.ingress,identityURI:py.principal.identityURI}}));}},
  async participant(name,creator='alice'){await m.connect(creator,name);const p=parties.get(name);return {principal:{issuer:p.principal.issuer,subject:p.principal.subject}};},
  // Creator invites; each invitee accepts (or not); then the mesh settles.
  async conversation(creator,invitees,{text='Let us talk.',subject='Planning',acceptListed=true,accept=invitees}={}){
   const participants=[];for(const name of invitees)participants.push(await m.participant(name,creator));
   const created=await m.run(creator,'conversations.create',{subject,text,participants});await m.settle();
   for(const name of accept){const {invitations}=await m.run(name,'conversations.invitations');const inv=invitations.find(i=>i.conversationId===created.conversationId);await m.run(name,'conversations.accept',{itemId:inv.itemId,acceptListed});}
   await m.settle();return created.conversationId;
  },
  texts:async(name,cid)=>{const out=[];let offset=0;do{const page=await m.run(name,'conversations.get',{conversationId:cid,limit:100,offset});out.push(...page.timeline.map(e=>e.text));offset=page.pagination.next;}while(offset!==null);return out;},
  order:async(name,cid)=>(await m.get(name,cid)).timeline.map(e=>e.eventId),
  peerStates:async(name,cid)=>Object.fromEntries((await m.get(name,cid)).peers.map(p=>[[...parties.values()].find(x=>x.principal.subject===p.principal.subject).name,p.state])),
  tasks:async name=>[...(await parties.get(name).store.list({prefix:'bb:send:task/'})).values()],
  async taskFor(from,to,eventId){const p=parties.get(to);return (await m.tasks(from)).find(t=>t.principal.subject===p.principal.subject&&t.obligation.eventId===eventId);},
  // Test-only crafting of a credentialed record from one party to another, to probe forgery and replay paths.
  async craft(from,to,cid,{type='message',text='crafted',target,counter,previous,parents=[],epoch,incarnation,signer,author,data,secret,author_principal,share=null}={}){
   const f=parties.get(from),t=parties.get(to),room=await f.store.get(`conv/room/${cid}`),peer=await f.store.get(`conv/peer/${cid}/${encodeURIComponent(t.principal.issuer)}|${encodeURIComponent(t.principal.subject)}`);
   const e=epoch??room.current,s=Uint8Array.from(secret??await f.store.get(`conv/secret/${cid}/${e}`)),inc=incarnation??(type==='peer-hello'?'hello':peer.outbound.incarnation),sign=signer??f.signer;
   const authorDescriptor=author??{principal:f.principal,identityDocument:`${f.principal.identityURI}/identity.json`,keyId:f.keyId,delegate:sign.kid};
   const body=['message','edit'].includes(type)?encoder.encode(text):null;
   const payload={version:1,profile:B.PROFILE,kind:'conversation-record',noReply:false,operationId:crypto.randomUUID(),createdAt:clock.now(),recipient:{issuer:t.principal.issuer,owner:t.principal.subject,conversationId:cid,incarnation:inc},content:body?await B.contentDescriptor('text/plain',body):null,subject:'',author:authorDescriptor,record:{type,conversationId:cid,epoch:e,stream:authorDescriptor.delegate,counter:counter??1,previous:previous??((counter??1)>1?B.base64url(crypto.getRandomValues(new Uint8Array(32))):null),parents,...target?{target}:{},...data?{data}:{}}};
   const envelope=await B.signEnvelope(payload,sign),principalFor=author_principal??f.principal;
   const token=await B.pairToken(s,{conversationId:cid,author:{issuer:principalFor.issuer,subject:principalFor.subject},recipient:t.principal,incarnation:inc});
   const wire=B.encodeDelivery(envelope,{body,secret:share,boundary:'bb4-crafted'});
   return {envelope,request:{method:'POST',url:t.ingress,headers:{authorization:`BindleConversation ${e}.${token}`,'content-type':wire.contentType,'idempotency-key':payload.operationId},body:wire.bytes}};
  },
  async post(from,to,request){const response=await network.send(from,routes.get(parties.get(to).ingress)??to,request);return {status:response.status,json:await response.json()};},
  // Replays one prepared outbox delivery directly (out of band), e.g. to reorder arrivals.
  async deliverPrepared(from,operationId,to){
   const f=parties.get(from),op=await f.store.get(`conv/op/${operationId}`),t=parties.get(to),r=op.prepared.find(x=>x.envelope.payload.recipient.owner===t.principal.subject);
   const body=op.hasBody?Uint8Array.from(await f.store.get(`conv/body/${op.cid}/${op.eventId}`)):null,secret=op.secret?Uint8Array.from(op.secret):null,wire=B.encodeDelivery(r.envelope,{body,secret,boundary:'bb4-prepared'});
   return m.post(from,to,{method:'POST',url:r.ingress,headers:{...r.credential?{authorization:r.credential}:{},'content-type':wire.contentType,'idempotency-key':operationId},body:wire.bytes});
  },
  // App switch: a new delegate key and certificate (optionally a new ingress); the old key is revoked.
  async switchApp(name,{ingress}={}){
   const p=parties.get(name),old=p.jkt,pair=await crypto.subtle.generateKey(ES,true,['sign','verify']);
   p.delegatePrivate=pair.privateKey;p.delegateJwk=pub(await crypto.subtle.exportKey('jwk',pair.publicKey));p.since=Math.floor(clock.now()/1000)-60;
   if(ingress){p.ingress=ingress;routes.set(ingress,routes.get(HOSTS[name])??name);}
   await certify(p);revoked.set(old,Math.floor(clock.now()/3600000));
   await m.run(name,'receive.configure',{principal:p.principal,ingress:p.ingress});return {old,current:p.jkt};
  },
  async renew(){for(const p of parties.values())await certify(p);},
  dispose:()=>network.dispose(),
 };
 return m;
}
