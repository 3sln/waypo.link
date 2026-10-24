// A loopback host of several organizations, each with its own account store, MembershipService, RelationService and
// ngin engine, wired by the same-host relation transport (RL-15). Drives ORG-10a–e at the engine level: every call is a
// dispatched Action or Query. Relation documents and fragments are served from memory under reserved .example domains.
// Each organization has an identity signing key (statements, invitations) and a certification key (relation events,
// entity certificates). Certification keys are verified only from a cache that a simulated background refresh fills
// (`host.refreshKeys()` runs the queued refreshes); `host.coldKey(sub)` empties one entry. Local behaviour only: no
// foreign provider, no real directory, no production key custody.
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {createAppEngine,perform,read,AppQuery} from '../../packages/app/engine.mjs';
import {memoryAudit} from '../../packages/app/providers.mjs';
import {fakeClock,seededRandom,createRandom} from '../../packages/app/memory-providers.mjs';
import {MembershipService} from '../../packages/orgs/memberships.mjs';
import {organizationsProvider,ORG_OPERATIONS,ORG_SYSTEM_OPERATIONS} from '../../packages/app/domains/orgs.mjs';
import {RelationService,relationsProvider,sameHostRelationTransport,RELATION_OPERATIONS,RELATION_SYSTEM_OPERATIONS} from '../../packages/orgs/relation-instances.mjs';
import {relationDocuments,relationEnvelope,pinKey} from '../../packages/orgs/relation-documents.mjs';
import {digestJSON} from '../../packages/core/artefacts.mjs';
import {principalKey} from '../../packages/orgs/grants.mjs';
import {signRelationEvent,relationEventPayload} from '../../packages/orgs/relation-events.mjs';
import {signCompact} from '../../packages/orgs/relation-statements.mjs';
import {dueMemberKeyRefreshes,removeMemberKeyRefresh} from '../../packages/orgs/key-refresh.mjs';

export const ISS='https://3sln.example',DAY=86400000;
export const OPS=Object.fromEntries([...ORG_OPERATIONS,...ORG_SYSTEM_OPERATIONS,...RELATION_OPERATIONS,...RELATION_SYSTEM_OPERATIONS].map(O=>[O.operation,O]));
export const rejects=(promise,code,label)=>assert.rejects(promise,e=>e.code===code||assert.fail(`${label?label+': ':''}expected ${code}, got ${e.code}: ${e.message}`));
export const fault=async promise=>{try{await promise;}catch(e){return {code:e.code,status:e.status,message:e.message};}return null;};
export const hexId=(prefix,n)=>{const h=n.toString(16).padStart(12,'0');return `${prefix}-0000-4000-8000-${h}`;};
export const orgId=n=>hexId('0e0e0e0e',n),personId=n=>hexId('0a0a0a0a',n);
export const LEDGER='https://contracts.example/ledger/v1',STORE='https://contracts.example/storage/v1',BUS='https://spec.bindle.example/contracts/event-bus/v1',PO='https://contracts.example/purchase-order/v1';

// ---- fragments and relation documents (reserved .example domains, AGENTS.md) ---------------------------------------
const FRAGMENTS={
 ledger:{id:'https://erp.example/fragments/ledger',title:'Ledger',description:'A ledger store.',publisher:'https://erp.example',fields:{ledger:{title:'Ledger',type:'resource',contracts:[LEDGER]},year:{title:'Year',type:'integer',minimum:2000,maximum:2100}}},
 storage:{id:'https://erp.example/fragments/storage',title:'Storage',description:'Generic storage.',publisher:'https://erp.example',fields:{store:{title:'Store',type:'resource',contracts:[STORE]}}},
 orders:{id:'https://erp.example/fragments/orders',title:'Orders',description:'Purchase orders.',publisher:'https://erp.example',fields:{orders:{title:'Orders',type:'resource',contracts:[PO]}}},
 invoices:{id:'https://erp.example/buses/invoices',title:'Invoices',description:'Invoice bus.',publisher:'https://erp.example',fields:{bus:{title:'Bus',type:'resource',contracts:[BUS]}},slot:{bus:{readers:['entity','app']}}},
 privateBus:{id:'https://erp.example/buses/private',title:'Private',description:'A bus no entity reads.',publisher:'https://erp.example',fields:{bus:{title:'Bus',type:'resource',contracts:[BUS]}},slot:{bus:{readers:['app']}}},
};
export async function fragmentPins(){const out={};for(const [name,body] of Object.entries(FRAGMENTS))out[name]={fragment:body.id,version:1,digest:await digestJSON(body),body};return out;}
const entry=(f,grantor,grantee,methods,extra={})=>({grantor,grantee,fragment:f.fragment,version:f.version,digest:f.digest,methods,...extra});
/** The relation bodies used across the suites, keyed by name. */
export async function relationBodies(){
 const f=await fragmentPins();
 return {f,
  supply:{id:'https://erp.example/relations/supply',title:'Supply',description:'A buyer and its suppliers exchange orders and invoices.',publisher:'https://erp.example',crit:[],
   slots:{buyer:{title:'Buyer',arity:{min:1,max:1},kinds:['organization']},supplier:{title:'Supplier',arity:{min:1,max:256},kinds:['organization','person']}},
   access:[entry(f.orders,'buyer','supplier',{orders:{[PO]:['status','acknowledge']}}),entry(f.invoices,'supplier','buyer',{bus:{[BUS]:['read','subscribe','unsubscribe']}}),entry(f.storage,'buyer','supplier',{store:{[STORE]:['get','list']}},{required:false})]},
  share:{id:'https://catalogue.example/relations/share',title:'Share',crit:[],slots:{owner:{arity:{min:1,max:1},kinds:['organization']},recipient:{arity:{min:1,max:1},kinds:['organization']}},
   access:[entry(f.storage,'owner','recipient',{store:{[STORE]:['get','list','put']}})]},
  group:{id:'https://catalogue.example/relations/group',title:'Group',crit:[],slots:{parent:{arity:{min:1,max:1},kinds:['organization']},subsidiary:{arity:{min:0,max:64},kinds:['organization']}},
   access:[entry(f.ledger,'subsidiary','parent',{ledger:{[LEDGER]:['get','list']}},{fields:['ledger']})]},
  partners:{id:'https://catalogue.example/relations/partners',title:'Partners',crit:[],slots:{partner:{arity:{min:2,max:3},kinds:['organization']}},
   access:[entry(f.storage,'partner','partner',{store:{[STORE]:['get']}})]},
 };
}

// ---- the host -------------------------------------------------------------------------------------------------------
export async function relationsHost({seed=1,orgs=3,admins=1,start=400*DAY}={}){
 const clock=fakeClock(start),random=seededRandom(createRandom(seed)),flag={on:true,names:{ORG_FOREIGN_RELATIONS_ENABLED:false},deny:new Map()};
 // Per-subject denials model a flag turned off for one organization (`flag.deny.set(org, new Set([name]))`).
 const flags={for:ctx=>({enabled:name=>!flag.deny.get(ctx?.subject?.owner)?.has(name)&&(flag.names[name]??flag.on)})};
 const bodies=await relationBodies(),envelopes=new Map(),fragments=new Map(),pins={};
 for(const [name,f] of Object.entries(bodies.f))fragments.set(pinKey(f),f.body);
 const publish=async(name,versions)=>{const {envelope,pins:p}=await relationEnvelope(versions[0].id,versions);envelopes.set(versions[0].id,envelope);pins[name]=p;return p;};
 for(const name of ['supply','share','group','partners'])await publish(name,[bodies[name]]);
 const counts={fetch:0,resolve:0,fragment:0,refresh:0};
 const documents=relationDocuments({fetch:async id=>{counts.fetch++;return envelopes.get(id)??null;},fragment:async p=>{counts.fragment++;return fragments.get(pinKey(p));}});
 // Identity keys per entity (organizations and persons): the same-host identity key registry stand-in.
 const keys=new Map(),kinds=new Map(),handles=new Map();
 const mint=async(sub,kind,handle)=>{const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const publicJwk=await crypto.subtle.exportKey('jwk',pair.publicKey);keys.set(sub,{kid:'k-'+sub.slice(0,8)+'-'+sub.slice(-4)+'-'+(keys.get(sub)?.rot??0),privateKey:pair.privateKey,publicJwk,rot:(keys.get(sub)?.rot??0)+1});kinds.set(sub,kind);handles.set(sub,handle);};
 // Certification keys per organization (the registry) and the verifier-side cache (what background refresh has fetched).
 const certs=new Map(),certCache=new Map(),aeps=new Map();
 const mintCert=async sub=>{const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const rot=(certs.get(sub)?.rot??0)+1;
  certs.set(sub,{kid:'c-'+sub.slice(-6)+'-'+rot,privateKey:pair.privateKey,publicJwk:{kty:'EC',crv:'P-256',x,y},rot});certCache.set(sub,[{kid:certs.get(sub).kid,publicJwk:certs.get(sub).publicJwk}]);};
 const counterparts={async resolve(p){counts.resolve++;if(p?.iss!==ISS||!keys.has(p.sub))return null;const k=keys.get(p.sub);return {kind:kinds.get(p.sub),handle:handles.get(p.sub),keys:[{kid:k.kid,publicJwk:k.publicJwk}],aep:aeps.get(p.sub)??0};},
  // Cache-only: never counts as a lookup, never fetches.
  async certificationKey({iss,sub,kid}){if(iss!==ISS)return null;const k=(certCache.get(sub)??[]).find(x=>x.kid===kid);return k?{publicJwk:k.publicJwk,identity:`${ISS}/identity/${sub}`}:null;}};
 const signer=async sub=>{const k=keys.get(sub);return k?{kid:k.kid,privateKey:k.privateKey}:null;};
 const certification=async sub=>{const k=certs.get(sub);return k?{kid:k.kid,privateKey:k.privateKey}:null;};
 // The federation connection port: live exactly at the generation recorded here.
 const connections=new Map(),connectionPort={async check(conn,clientId){const c=connections.get(conn?.id);return Boolean(c&&c.generation===conn.generation&&(c.clientId===undefined||c.clientId===clientId));}};
 // Fault hooks for chaos: deliver(from, to, event) -> 'ok' | 'drop' | 'dup' | 'fail'.
 const faults={deliver:()=>'ok',redeem:()=>'ok'};
 const host={clock,random,flag,bodies,pins,publish,envelopes,fragments,counts,keys,mint,certs,certCache,aeps,mintCert,connections,orgs:new Map(),faults,ISS};
 const dispatch=async(sub,op,input)=>{const o=host.orgs.get(sub);if(!o)throw Object.assign(new Error('Not found.'),{code:'not_found'});return o.system(op,input);};
 const base=sameHostRelationTransport({issuer:ISS,dispatch});
 const transport={offer:base.offer,retract:base.retract,
  async redeem(from,to,input){const f=faults.redeem(from,to,input);if(f==='fail')throw Object.assign(new Error('unreachable'),{code:'temporarily_unavailable'});const out=await base.redeem(from,to,input);if(f==='lose')throw Object.assign(new Error('lost'),{code:'temporarily_unavailable'});return out;},
  async deliver(from,to,jws){const f=faults.deliver(from,to,jws);if(f==='fail')throw new Error('unreachable');if(f==='drop')return {accepted:true};const out=await base.deliver(from,to,jws);if(f==='dup')await base.deliver(from,to,jws);return out;}};
 async function addOrg(n,{adminCount=admins}={}){
  const ORG=orgId(n),people=Array.from({length:adminCount+2},(_,i)=>personId(n*16+i));
  await mint(ORG,'organization','org-'+n);await mintCert(ORG);for(const p of people)await mint(p,'person','person-'+p.slice(-4));
  const metadata=new SqliteMetadata(':memory:');await metadata.put('owner',ORG);
  const orgsService=new MembershipService({metadata,clock,random,issuer:ISS,flags,plans:null});
  const relations=new RelationService({organizations:orgsService,documents,signer,counterparts,transport,issuer:ISS,clock,random,certification,connections:connectionPort,federationSubject:()=>ORG});
  const engine=createAppEngine({providers:{clock,random,audit:memoryAudit({clock}),organizations:organizationsProvider(orgsService),relations:relationsProvider(relations)}});
  const prov=sub=>({kid:'k-'+sub.slice(0,8)+'-0123456789abcdef0123',publicKey:{kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43)},certificationKid:null,authentication:'same-host-session'});
  const act=(sub,extra={})=>({kind:'owner',owner:ORG,principal:{iss:ISS,sub},entity:{kind:'organization',id:ORG},powers:[],authTime:clock.now(),epoch:0,aep:0,addedUnder:prov(sub),...extra});
  const dispatchOp=(Op,actor,input)=>{const action=new Op({actor,input});return action instanceof AppQuery?read(engine,action):perform(engine,action);};
  const o={n,id:ORG,principal:{iss:ISS,sub:ORG},metadata,orgsService,relations,engine,people,admin:people[0],act,host,
   run:(op,sub,input={},extra={})=>dispatchOp(OPS[op],act(sub??people[0],extra),input),
   system:(op,input={})=>dispatchOp(OPS[op],{kind:'system',owner:ORG},input),
   get:key=>metadata.get(key),list:prefix=>metadata.list({prefix}),
   async resource(id,contracts){await metadata.put('federation/resource/'+id,{id,label:'R',contracts,owner:ORG});return id;},
   async cp(instance,other){return metadata.get('rel/cp/'+encodeURIComponent(instance)+'/'+principalKey(other.principal??other));},
   async part(instance){return metadata.get('rel/instance/'+encodeURIComponent(instance));},
   async check(instance,grantee,resource,contract,method){return (await dispatchOp(OPS['relations.edge-check'],{kind:'system',owner:ORG},{instance,grantee:grantee.principal??grantee,resource,contract,method})).allowed;},
   async imports(sub){return (await o.run('relations.imports',sub??people[0],{})).imports;},
   async audits(){return [...(await metadata.list({prefix:'org/audit/'})).values()];},
   async notices(){return [...(await metadata.list({prefix:'org/outbox/pending/'})).values()];},
   close:async()=>{await engine.dispose();metadata.close();}};
  await perform(engine,new OPS['orgs.initialize']({actor:{kind:'system',owner:ORG},input:{request:'relations-request-'+String(n).padStart(4,'0'),creator:{iss:ISS,sub:people[0]},name:'Org '+n,addedUnder:prov(people[0])}}));
  // Further admins (people[1..adminCount-1]) and one plain member (people[adminCount]) join; admin powers start after
  // the admin delay, so the clock moves past it once every organization exists (host.ready).
  for(let i=1;i<people.length-1;i++){const invite=await o.run('orgs.invite',people[0],{invitee:{iss:ISS,sub:people[i]},grants:i<adminCount?[{power:'admin'}]:[]});await o.run('orgs.accept',people[i],{invitation:invite.invitation});}
  o.member=people[adminCount];o.outsider=people[adminCount+1];
  host.orgs.set(ORG,o);return o;
 }
 host.addOrg=addOrg;
 /** Runs every organization's due background key refreshes: the cache entry of each queued subject is re-read from the
  * registry (a rotated or revoked key is then current). Returns how many refreshes ran. */
 host.refreshKeys=async()=>{let n=0;for(const o of host.orgs.values()){const due=await o.metadata.transaction(tx=>dueMemberKeyRefreshes(tx,clock.now()+1,512));
  for(const [key,row] of due){counts.refresh++;n++;const c=certs.get(row.subject);if(c)certCache.set(row.subject,[{kid:c.kid,publicJwk:c.publicJwk}]);else certCache.delete(row.subject);await o.metadata.transaction(tx=>removeMemberKeyRefresh(tx,key));}}return n;};
 /** Empties the verifier cache of one subject (its key is no longer held anywhere until a refresh). */
 host.coldKey=sub=>certCache.delete(sub);
 /** A relation-event payload from `from` to `to` (organizations or principals). */
 host.event=(from,to,instance,events,{jti=random.uuid(),aep=0,iat=Math.floor(clock.now()/1000)}={})=>relationEventPayload({from:from.principal??from,to:to.principal??to,instance,aep,iat,jti,events});
 /** Signs a payload with `as`'s current certification key (or `key`: {kid, privateKey}). */
 host.sign=async(as,payload,{key}={})=>{const sub=as.id??as.sub??as;const k=key??certs.get(sub);return signRelationEvent(payload,{kid:k.kid,privateKey:k.privateKey});};
 /** Ingests a signed event at `to` exactly as the events endpoint would (no adapter-supplied sender). */
 host.ingest=async(to,from,payload,opts)=>to.system('relations.ingest',{event:await host.sign(from,payload,opts)});
 const list=[];for(let i=1;i<=orgs;i++)list.push(await addOrg(i));
 clock.advance(4*DAY);
 host.list=list;
 /** Delivers every queued relation event until no organization has anything left (bounded). */
 host.drain=async(rounds=20)=>{for(let i=0;i<rounds;i++){let moved=0;for(const o of host.orgs.values())moved+=(await o.system('relations.outbox-drain',{})).delivered;if(!moved)return;}};
 host.outbox=async()=>{let n=0;for(const o of host.orgs.values())n+=(await o.list('rel/outbox/')).size;return n;};
 host.close=async()=>{for(const o of host.orgs.values())await o.close();};
 /** The disclosure the invitee's admin reviews, then the acceptance with that disclosure. */
 host.accept=async(invitee,invitation,{values,receive=true,sub}={})=>{const view=await invitee.run('relations.inbound-preview',sub,{invitation});return invitee.run('relations.accept',sub,{invitation,disclosure:view.disclosure,...values?{values}:{},receive});};
 /** A full two-party relation: `a` creates (slot `as`), invites `b` to `slot`, `b` accepts; events drained. */
 host.relate=async(a,b,{relation='share',as='owner',slot='recipient',give,take,receive=true,instance}={})=>{
  const inst=instance??(await a.run('relations.create',null,{relation:pins[relation][0],slots:[as]})).instance;
  const inv=await a.run('relations.invite',null,{instance:inst,as,slot,invitee:b.principal,...give?{values:give}:{},receive});
  await host.accept(b,inv.invitation,{values:take,receive:true});await host.drain();return {instance:inst,invitation:inv};
 };
 return host;
}
