import {createWebHTTP} from '../web/http.mjs';
import {webShell} from '../web/shell.mjs';
import {ingressError} from '../../../packages/messaging-engine/domains/receive.mjs';
import {LIMITS,strictJSON,ProtocolFault,parseRPC,MAILBOX_CONTRACT,INTAKE_CONTRACT,fromBase64url} from '../../../packages/messaging-protocol/index.mjs';
import {fault,MailboxFault} from '../../../packages/messaging-engine/faults.mjs';
import {enabled} from './mailbox.mjs';
import {handleConversationIngress} from '../../../packages/messaging-engine/domains/conversations.mjs';
import {createFirstContactBudget} from '../../../packages/messaging-engine/domains/invites.mjs';
// First-contact budgets (messaging §7.4) are per isolate: an approximation where many edge isolates serve one host.
const firstContactBudget=createFirstContactBudget();
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export async function bodyBytes(request,limit=LIMITS.maxRequestBytes){
 if(Number(request.headers.get('Content-Length'))>limit)fault('too_large','Request too large.',413);
 const reader=request.body?.getReader(),chunks=[];let size=0;if(!reader)return new Uint8Array();
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();fault('too_large','Request too large.',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}return bytes;
}
export function httpError(error){const known=error instanceof MailboxFault||error instanceof ProtocolFault,status=known&&Number.isSafeInteger(error.status)?error.status:500;return Response.json({error:known?error.code:'internal_error'},{status,headers:{...headers,...status===503?{'Retry-After':'60'}:{}}});}
// The first-contact budget's source (messaging §7.4). On Workers, Cloudflare sets CF-Connecting-IP itself. Other adapters
// pass `sourceOf` (the Node shell: the socket address, or a configured trusted proxy header; review L1).
const workerSource=request=>request.headers.get('CF-Connecting-IP')??undefined;
// Authentication is a configured, live verifier (ordinary app credentials). Never accept owner/actor from JSON,
// query parameters or untrusted forwarding headers. Ingress routes only after the capability edge check.
export function createHTTP({PARLAY_ENABLED=false,INTENT_LINKS_ENABLED=false,APP_CLEAN_REMOVAL_ENABLED=false,authenticate,mailbox,edge,conversationEdge,metadata,services,assets,sourceOf=workerSource,archiveEnabled=typeof services?.objectStorage==='function'&&typeof services?.archiveKeys==='function'}={}){
 const web=createWebHTTP({PARLAY_ENABLED:enabled(PARLAY_ENABLED),INTENT_LINKS_ENABLED:enabled(INTENT_LINKS_ENABLED),archiveEnabled,authenticate,mailbox});
 return async(request,info={})=>{
  if(!enabled(PARLAY_ENABLED))return Response.json({error:'not_found'},{status:404,headers});
  const url=new URL(request.url),path=url.pathname;
  if(request.method==='GET'&&(path==='/'||path==='/bindle/intent'&&enabled(INTENT_LINKS_ENABLED)||path==='/bindle/remove'&&enabled(APP_CLEAN_REMOVAL_ENABLED)&&typeof services?.verifyRemoval==='function'))return webShell();
  if(request.method==='GET'&&['/app.mjs','/styles.css'].includes(path)&&assets)return assets(request);
  const client=await web(request);if(client)return client;
  if(request.method==='POST'&&['/api/removal/prepare','/api/removal/complete'].includes(path))try{
   if(!enabled(APP_CLEAN_REMOVAL_ENABLED)||typeof services?.verifyRemoval!=='function')fault('not_found','Not found.',404);
   if(request.headers.get('Origin')!==url.origin)fault('not_authorized','Not authorized.',403);
   if(typeof authenticate!=='function')fault('recipient_unavailable','Authentication unavailable.',503);
   if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')fault('invalid_input','Use application/json.',415);
   const actor=await authenticate(request);if(actor?.kind!=='owner')fault('not_authorized','Not authorized.',403);
   const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bodyBytes(request,16384))),box=await mailbox(actor.owner);
   if(path.endsWith('/prepare')){const claims=await services.verifyRemoval({token:input.removal_request,owner:actor.owner,url:request.url});await box.run(actor.owner,'shell.removal-prepare',{input:{claims}});return Response.json(await box.run(actor.owner,'shell.removal-options'),{headers});}
   return Response.json(await box.run(actor.owner,'shell.removal-complete',{input:{choice:input.choice}}),{headers});
  }catch(error){return httpError(error);}

  if((path==='/bindle/ingress'||/^\/bindle\/ingress\/return\/[A-Za-z0-9_-]{32}$/.test(path))&&request.method==='POST')try{
   if(!edge||!conversationEdge)fault('recipient_unavailable','Ingress index unavailable.',503);
   const wire={url:request.url,method:'POST',headers:Object.fromEntries(request.headers),body:await bodyBytes(request),source:sourceOf(request,info)},deliver=(name)=>async(owner,input)=>(await mailbox(owner)).run(owner,name,{input});
   return await handleConversationIngress(wire,{edge,conversationEdge,deliverRecord:deliver('conversations.receive'),deliverResponse:deliver('conversations.respond'),deliverInvite:deliver('receive.redeem'),deliverFirst:deliver('receive.first-contact'),budget:firstContactBudget});
  }catch(error){return ingressError(error,Date.now());}
  try{
   if(request.method==='GET'&&['/bindle/client.json','/bindle/jwks.json'].includes(path)){if(!metadata)fault('recipient_unavailable','Client metadata unavailable.',503);return Response.json(await metadata(path),{headers});}
   if(request.method==='POST'&&['/bindle/rpc','/bindle/resources','/bindle/events'].includes(path)){
    const contentType=request.headers.get('Content-Type')?.split(';')[0];
    if(path==='/bindle/events'){
     if(contentType!=='application/secevent+jwt')fault('invalid_input','Use application/secevent+jwt.',415);
     if(typeof services?.verifyEvent!=='function')fault('recipient_unavailable','Event verifier unavailable.',503);
     const event=await services.verifyEvent({url:request.url,token:new TextDecoder('utf-8',{fatal:true}).decode(await bodyBytes(request,65536))});
     if(event?.unknown===true)return new Response(null,{status:202,headers});
     if(!event?.owner)fault('not_authorized','Not authorized.',403);const box=await mailbox(event.owner);await box.run(event.owner,'shell.integration-event',{input:{event}});return new Response(null,{status:202,headers});
    }
    if(contentType!=='application/json')fault('invalid_input','Use application/json.',415);
    const bytes=await bodyBytes(request),purpose=path==='/bindle/resources'?'discover':'invoke';let rpc;
    try{if(purpose==='invoke')rpc=parseRPC(bytes);}catch(error){if(error.rpc)return Response.json({version:'0',error:{code:error.code}},{headers});throw error;}
    if(typeof services?.verifyIntegration!=='function')fault('recipient_unavailable','Broker verifier unavailable.',503);
    const verified=await services.verifyIntegration({url:request.url,authorization:request.headers.get('Authorization'),purpose,...rpc?{resource:rpc.resource,contract:rpc.contract,method:rpc.method}:{}});
    if(!verified?.owner)fault('not_authorized','Not authorized.',403);const box=await mailbox(verified.owner);
    if(purpose==='discover')return Response.json(await box.run(verified.owner,'shell.discover',{input:{verified,query:strictJSON(bytes,{maxBytes:65536,maxDepth:12})}}),{headers});
    const name=rpc.contract===MAILBOX_CONTRACT?'shell.describe':rpc.contract===INTAKE_CONTRACT?'shell.public-intake':null;
    if(!name)fault('unsupported_contract','Unsupported contract.',400);
    const result=await box.run(verified.owner,name,{input:{verified,resource:rpc.resource,tx:rpc.tx,contract:rpc.contract,args:rpc.args,consumer:verified.consumer}});
    return Response.json({version:'0',tx:rpc.tx,result},{headers});
   }
   const sendId=/^\/api\/send\/([a-f0-9-]{36})(\/retry|\/cancel)?$/.exec(path);
   let op,id,input,needsBody=false;
   if(path==='/api/send'&&request.method==='POST'){op='send.submit';needsBody=true;}
   else if(path==='/api/send'&&request.method==='GET')op='outbox.list';
   else if(sendId&&request.method==='GET'&&!sendId[2]){op='outbox.get';id=sendId[1];}
   else if(sendId&&request.method==='POST'&&sendId[2]){op=sendId[2]==='/retry'?'outbox.retry-missing':'outbox.cancel';id=sendId[1];}
   else if(path==='/api/events'&&request.method==='GET'){op=request.headers.get('Accept')?.includes('text/event-stream')?'send.events-stream':'send.events';input={after:request.headers.get('Last-Event-ID')??url.searchParams.get('after')};}
   else if(path==='/api/delegation/renew'&&request.method==='POST')op='shell.delegation-renew';
   else return Response.json({error:'not_found'},{status:404,headers});
   const authorization=request.headers.get('Authorization');if(!/^Bearer [^\s]{1,8192}$/.test(authorization??''))fault('unauthorized','Sign in to continue.',401);
   if(typeof authenticate!=='function')fault('recipient_unavailable','Authentication unavailable.',503);
   const actor=await authenticate(request);if(actor?.kind!=='owner'||typeof actor.owner!=='string'||!/^[a-f0-9-]{36}$/.test(actor.owner))fault('unauthorized','Sign in to continue.',401);
   if(needsBody){if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')fault('invalid_input','Use application/json.',415);try{input=strictJSON(await bodyBytes(request,4*1048576),{maxBytes:4*1048576,maxDepth:32});}catch(error){if(error instanceof MailboxFault)throw error;fault('invalid_input','Invalid JSON.',400);}if(!input||typeof input!=='object'||Array.isArray(input)||!Array.isArray(input.recipients))fault('invalid_input','Invalid send request.',400);if(input.body!==null){if(typeof input.body==='string'){try{input.body=fromBase64url(input.body);}catch{fault('invalid_input','Invalid message bytes.',400);}if(input.body.byteLength>LIMITS.maxBodyBytes)fault('invalid_input','Invalid message bytes.',400);}else{if(!Array.isArray(input.body)||input.body.length>LIMITS.maxBodyBytes||input.body.some(n=>!Number.isInteger(n)||n<0||n>255))fault('invalid_input','Invalid message bytes.',400);input.body=Uint8Array.from(input.body);}}for(const recipient of input.recipients){if(!recipient||typeof recipient!=='object'||Array.isArray(recipient))fault('invalid_input','Invalid recipient.',400);if(Array.isArray(recipient.secret)){if(recipient.secret.length!==32||recipient.secret.some(n=>!Number.isInteger(n)||n<0||n>255))fault('invalid_input','Invalid secret bytes.',400);recipient.secret=Uint8Array.from(recipient.secret);}}}
   const box=await mailbox(actor.owner),result=await box.run(actor.owner,op,{id,input});return result instanceof Response?result:Response.json(result,{headers});
  }catch(error){return httpError(error);}
 };
}
