import {verifyProof} from '../../packages/federation/dpop.mjs';
import {RPC_MEDIA_TYPE,decodeRPC,rpcResponse} from '../../packages/core/rpc-wire.mjs';
import {verifyAccessToken} from '../../packages/federation/signing.mjs';
import {verifyIntegrationEvent,INTEGRATION_EVENT_MEDIA_TYPE,IntegrationEventFault,integrationEventRejection,ctiId} from '../../packages/core/cose.mjs';
// EXT-X9a test double, not a reference verifier or a production integration.
// Opaque fixture tokens stand in for verified JWTs and COSE events (an event stub is the UTF-8 of its token, posted as
// application/cwt); with `keys`, events are verified by verifyIntegrationEvent. X9b supplies real JWS/DPoP,
// introspection and provider conformance. No issuer/key URL is ever fetched here.
import {createServer} from 'node:http';
import {AppAction,AppQuery,createAppEngine,perform,read} from '../../packages/app/engine.mjs';
import {memoryAudit} from '../../packages/app/providers.mjs';

export const INTEGRATION='https://integration.example',ISSUER='https://provider.example',SUBJECT=ISSUER+'/entities/owner',CONNECTION='fixture-connection';
export const CONTRACT='https://spec.bindle.example/contracts/example-records/v1';
export const EVENTS=Object.freeze(Object.fromEntries(['preferences-updated','credential-revoked','connection-revoked','connection-resumed','resource-detached'].map(name=>[name,'https://spec.bindle.example/events/'+name+'/v1'])));
export const ENDPOINTS=Object.freeze({events:INTEGRATION+'/bindle/events',discovery:INTEGRATION+'/bindle/resources',rpc:INTEGRATION+'/bindle/rpc'});
const clone=value=>structuredClone(value),key=(iss,id)=>JSON.stringify([iss,id]);
// Dedupe key: the canonical text of a real 16-byte cti, or a stub's label.
const ctiKey=cti=>cti instanceof Uint8Array&&cti.length===16?ctiId(cti):typeof cti==='string'&&cti?'stub:'+cti:null;
const reject=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const json=(value,status=200)=>Response.json(value,{status});

// Private fixture operations: deliberately absent from the production account
// registry. The existing federation provider slot hosts this test-only port.
export class ReceiveIntegrationEvent extends AppAction {
 static operation='fixture.integration.event';static deps=['federation','clock'];
 run({federation,clock}){return federation.receive(this.input,clock.now());}
}
export class IntegrationDiscovery extends AppQuery {
 static operation='fixture.integration.discovery';static deps=['federation','clock'];
 fetch({federation,clock}){return federation.discover(this.input,clock.now());}
}
export class InvokeIntegrationResource extends AppAction {
 static operation='fixture.integration.invoke';static deps=['federation','clock'];
 run({federation,clock}){return federation.invoke(this.input,clock.now());}
}
export class IntegrationSnapshot extends AppQuery {
 static operation='fixture.integration.snapshot';static deps=['federation'];
 fetch({federation}){return federation.snapshot();}
}

/** In-process Fetch adapter plus optional loopback HTTP transport. All advertised
 * endpoints/resource IDs stay HTTPS .example URLs; loopback is transport only.
 * `verifyToken(token,{kind,audience})` can replace the opaque-token lookup. It
 * must return already verified claims, never merely decode an untrusted JWT.
 * Resources are scoped by {iss,connection,sub,item}; `item` is the §4.2 shape.
 * Invalidation uses events_endpoint (§6–7), not a new protocol endpoint.
 */
export function createIntegrationServer({issuer=ISSUER,subject=SUBJECT,integration=INTEGRATION,clock={now:()=>Date.UTC(2026,9,20)},connections=[{iss:ISSUER,id:CONNECTION,sub:SUBJECT,generation:1}],resources=[],contracts=[CONTRACT],verifyToken,keys,introspect,requiresIntrospection=()=>false,maxRecords=512}={}){
 const endpoints=Object.fromEntries(Object.entries(ENDPOINTS).map(([k,v])=>[k,v.replace(INTEGRATION,integration)]));
 const proofIds=new Map(),tokens=new Map(),known=new Map(),events=[],invocations=[],verifications=[];let serial=0,server,origin,closed=false;
 for(const connection of clone(connections))known.set(key(connection.iss,connection.id),{...connection,floor:connection.generation,highest:connection.generation,preferences:{},revoked:new Map(),seen:new Set()});
 let items=clone(resources);
 const room=list=>{if(list.length>=maxRecords)reject('fixture_capacity',503);};
 const issue=(kind,claims)=>{if(tokens.size>=maxRecords)reject('fixture_capacity',503);const token='fixture-'+kind+'-'+(++serial);tokens.set(token,{kind,claims:clone(claims)});return token;};
 const verify=async(token,kind,audience,now)=>{
  room(verifications);verifications.push({kind,audience});
  const stub=tokens.get(token instanceof Uint8Array?new TextDecoder().decode(token):token),real=keys?kind==='event'?(await verifyIntegrationEvent(token,{contentType:INTEGRATION_EVENT_MEDIA_TYPE,keys:await keys(),issuer,subject,audience,connection:({iss,connection})=>known.has(key(iss,connection)),now})).claims:(await verifyAccessToken(token,{keys:await keys(),issuer,audience,now,connection:({iss,connection})=>known.has(key(iss,connection))})).claims:null,claims=clone(keys?real:verifyToken?await verifyToken(token,{kind,audience}):stub?.kind===kind?stub.claims:null);
  if(!claims||claims.aud!==audience)reject('invalid_token',401);
  const event=kind==='event'?Object.entries(claims.events??{}):null;
  if(event&&event.length!==1)reject('invalid_event');
  const binding=event?event[0][1]:claims.bindle,connection=known.get(key(claims.iss,binding?.connection));
  if(!connection||claims.sub!==connection.sub)reject('invalid_token',401);
  if(!Number.isSafeInteger(binding?.generation)||binding.generation<1||!event&&binding.v!==1)reject('invalid_token',401);
  const seconds=Math.floor(now/1000);
  if(!Number.isFinite(claims.iat)||claims.iat>seconds+30)reject('invalid_token',401);
  if(event){if(claims.iat<seconds-600||!ctiKey(claims.cti)||!Number.isSafeInteger(binding.seq)||binding.seq<1)reject('invalid_event');}
  else{
   const lifetime=binding.purpose==='invoke'?300:60;
   if(!Number.isFinite(claims.exp)||claims.exp<=claims.iat||claims.exp-claims.iat>lifetime||claims.exp<=seconds-30||binding.generation<connection.floor||binding.generation>connection.highest)reject('invalid_token',401);
   if((connection.revoked.get(binding.grant)??0)>seconds)reject('invalid_token',401);
  }
  return {claims,binding,connection,event,seconds};
 };
 const provider={
  async receive({token},now){
   const {claims,binding,connection,event}=await verify(token,'event',endpoints.events,now);
   const id=ctiKey(claims.cti);if(connection.seen.has(id))return {duplicate:true};
   room(events);if(connection.seen.size>=maxRecords)reject('fixture_capacity',503);
   const [[type]]=event;
   if(type===EVENTS['preferences-updated']){
    if(typeof binding.fragment!=='string'||!Object.hasOwn(binding,'values'))reject('invalid_event');
    const previous=connection.preferences[binding.fragment];
    if(binding.generation>=connection.floor&&binding.seq>(previous?.seq??0))Object.defineProperty(connection.preferences,binding.fragment,{value:clone(binding),enumerable:true,configurable:true,writable:true});
   }else if(type===EVENTS['connection-revoked']){
    if(!Number.isSafeInteger(binding.generation_floor)||binding.generation_floor<1)reject('invalid_event');
    connection.floor=Math.max(connection.floor,binding.generation_floor);
   }else if(type===EVENTS['connection-resumed'])connection.highest=Math.max(connection.highest,binding.generation);
   else if(type===EVENTS['credential-revoked']){
    if(!Array.isArray(binding.grants)||binding.grants.some(grant=>typeof grant!=='string')||!Number.isFinite(binding.until))reject('invalid_event');
    const grants=new Set([...connection.revoked.keys(),...binding.grants]);if(grants.size>maxRecords)reject('fixture_capacity',503);
    for(const grant of binding.grants)connection.revoked.set(grant,Math.max(connection.revoked.get(grant)??0,binding.until));
   }
   connection.seen.add(id);events.push({iss:claims.iss,cti:id,type,...clone(binding)});return {duplicate:false};
  },
  async discover({token,query},now){
   const {claims,binding}=await verify(token,'access',endpoints.discovery,now);
   if(binding.purpose!=='discover'||claims.client_id!==claims.iss||binding.resource!==undefined||binding.methods!==undefined)reject('invalid_token',401);
   if(query?.v!==1||!Array.isArray(query.contracts)||query.contracts.some(contract=>typeof contract!=='string'))reject('invalid_request');
   if(query.contracts.some(contract=>!contracts.includes(contract)))reject('unsupported_facet');
   if(query.facets&&Object.keys(query.facets).length)reject('unsupported_facet');
   if(query.ids!=null&&(!Array.isArray(query.ids)||query.ids.length>50||query.ids.some(id=>typeof id!=='string')||query.text!=null||query.parent!=null))reject('invalid_request');
   if(query.text!=null&&(typeof query.text!=='string'||query.text.length>200))reject('invalid_request');
   const limit=query.limit??50,cursor=query.cursor??'0';
   if(!Number.isInteger(limit)||limit<0||limit>100||typeof cursor!=='string'||cursor.length>1024||!/^\d+$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))reject('invalid_request');
   const matches=items.filter(resource=>resource.iss===claims.iss&&resource.connection===binding.connection&&resource.sub===claims.sub&&query.contracts.every(contract=>resource.item.contracts.includes(contract))&&(!query.ids||query.ids.includes(resource.item.id))&&(!query.text||resource.item.label.toLowerCase().includes(query.text.toLowerCase()))&&(query.parent==null||resource.parent===query.parent));
   if(limit===0)return {v:1,items:[],exists:matches.length>0};
   const offset=Number(cursor),page=matches.slice(offset,offset+limit).map(resource=>clone(resource.item));
   return {v:1,items:page,cursor:offset+limit<matches.length?String(offset+limit):null};
  },
  async invoke({token,envelope,proof,scheme='Bearer'},now){
   const {claims,binding}=await verify(token,'access',endpoints.rpc,now);
   if(binding.purpose!=='invoke')reject('invalid_token',401);
   if(requiresIntrospection(envelope?.contract,envelope?.method)){let active=false;try{active=(await introspect?.(token))?.active===true;}catch{}if(!active)reject('inactive_token',401);}
   // RFC9449 proof validation and replay consumption are local to this integration.
   if(claims.cnf){if(scheme!=='DPoP')reject('invalid_token',401);let checked;try{checked=await verifyProof(crypto,proof,{htm:'POST',htu:endpoints.rpc,now,ath:token});}catch{reject('invalid_token',401);}if(checked.jkt!==claims.cnf.jkt)reject('invalid_token',401);for(const [id,expires]of proofIds)if(expires<=now)proofIds.delete(id);const id=checked.jkt+':'+checked.jti;if(proofIds.has(id))reject('invalid_token',401);if(proofIds.size>=maxRecords)reject('fixture_capacity',503);proofIds.set(id,checked.expiresAt);}
   if(binding.scope!=null)reject('fixture_verifier_unimplemented',501);
   if(!envelope||envelope.resource!==binding.resource||!binding.methods?.[envelope.contract]?.includes(envelope.method)||!items.some(resource=>resource.iss===claims.iss&&resource.connection===binding.connection&&resource.sub===claims.sub&&resource.item.id===envelope.resource&&resource.item.contracts.includes(envelope.contract)))reject('forbidden',403);
   room(invocations);invocations.push({iss:claims.iss,sub:claims.sub,client_id:claims.client_id,connection:binding.connection,envelope:clone(envelope)});
   return {fixture:true,accepted:true};
  },
  snapshot(){return clone({events,invocations,verifications,connections:[...known.values()].map(({seen,revoked,...connection})=>({...connection,revoked:[...revoked]}))});}
 };
 const audit=memoryAudit({clock}),engine=createAppEngine({providers:{clock,random:{uuid:()=>crypto.randomUUID()},audit,federation:provider}});
 const handle=async(input,init)=>{
  if(closed)throw new Error('Integration fixture is closed');
  const request=input instanceof Request?input:new Request(input,init),url=new URL(request.url);
  if(![integration,origin].includes(url.origin)||url.search)return json({error:'not_found'},404);
  const operation=url.pathname===new URL(endpoints.events).pathname?ReceiveIntegrationEvent:url.pathname===new URL(endpoints.discovery).pathname?IntegrationDiscovery:url.pathname===new URL(endpoints.rpc).pathname?InvokeIntegrationResource:null;
  if(!operation)return json({error:'not_found'},404);
  if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
  // Brokered RPC is Bindle CBOR (integrations §5; owner-approved 2026-10-28): the RPC endpoint reads and writes
  // application/vnd.bindle.rpc+cbor only, every body it generates included. Discovery stays JSON; events are COSE_Sign1
  // CWTs (application/cwt, CBOR phase 5), refused with a 400 (413/415) and a CBOR {err, description} body.
  const event=operation===ReceiveIntegrationEvent,rpc=operation===InvokeIntegrationResource,type=request.headers.get('content-type')?.split(';')[0].trim(),reply=rpc?(value,status=200)=>rpcResponse(value,status):json;
  if(type!==(event?INTEGRATION_EVENT_MEDIA_TYPE:rpc?RPC_MEDIA_TYPE:'application/json'))return reply({error:'unsupported_media_type'},415);
  try{
   const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.byteLength>65536)reject('request_too_large',413);const body=event?bytes:null;
   let document;if(rpc)try{document=decodeRPC(bytes);}catch{reject('invalid_request');}else if(!event)try{document=JSON.parse(new TextDecoder().decode(bytes));}catch{reject('invalid_json');}
   const token=event?body:request.headers.get('authorization')?.match(/^(?:Bearer|DPoP) (\S+)$/)?.[1];
   const params={input:{token,...event?{}:operation===IntegrationDiscovery?{query:document}:{envelope:document,proof:request.headers.get('DPoP'),scheme:request.headers.get('Authorization')?.split(' ')[0]}}};
   const result=operation===IntegrationDiscovery?await read(engine,new operation(params)):await perform(engine,new operation(params));
   return event?new Response(null,{status:202}):reply(result);
  }catch(error){if(event&&error instanceof IntegrationEventFault)return new Response(integrationEventRejection(error),{status:error.status,headers:{'Content-Type':'application/cbor'}});return reply({error:error.code??'fixture_error'},error.status??500);}
 };
 return {
  engine,provider,clock,audit,endpoints:{...endpoints,invalidation:endpoints.events},fetch:handle,
  issueAccessToken:claims=>issue('access',claims),issueEventToken:claims=>new TextEncoder().encode(issue('event',claims)),
  setResources:resources=>{items=clone(resources);},snapshot:()=>read(engine,new IntegrationSnapshot()),
  async listen(){
   if(closed)throw new Error('Integration fixture is closed');if(server)return origin;
   server=createServer(async(request,response)=>{
    try{
     const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>65536){response.writeHead(413).end();return;}chunks.push(chunk);}
     const result=await handle(new Request(new URL(request.url,integration),{method:request.method,headers:request.headers,...chunks.length?{body:Buffer.concat(chunks)}:{}}));
     response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));
    }catch{response.writeHead(500).end();}
   });
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;return origin;
  },
  async close(){if(closed)return;closed=true;if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await engine.dispose();tokens.clear();}
 };
}
