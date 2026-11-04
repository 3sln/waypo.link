import {createHostedEmailTransport} from './email-transport.mjs';
export const PRIVATE_EMAIL_URL='https://mail-transport.invalid/send';
export const EMAIL_REQUEST_LIMIT=128*1024;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Waypo-Email-Result':'v1'}});
const failure=(code,status)=>json({status:'outage',code},status);
async function readInput(request){const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>EMAIL_REQUEST_LIMIT))throw Object.assign(Error('email_request_size'),{code:'email_request_size'});const reader=request.body?.getReader();if(!reader)throw Error('invalid_email_request');let size=0;const chunks=[];try{for(;;){const {value,done}=await reader.read();if(done)break;if(!(value instanceof Uint8Array))throw Error('invalid_email_request');size+=value.byteLength;if(size>EMAIL_REQUEST_LIMIT)throw Object.assign(Error('email_request_size'),{code:'email_request_size'});chunks.push(value);}}catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
/** Private in-process service-binding capability. Never mount this object's
 * fetch method as a public route. Configuration must be validated by the core
 * deployment validator before construction; message JSON cannot choose origins.
 */
export function createHostedEmailBinding({emailBinding,configuration,beforeEmailAttempt,requireEmailBudget=false}={}){
 if(typeof emailBinding?.send!=='function')throw TypeError('Actual Email Sending binding required');
 const mainOrigin=new URL(configuration.issuer).origin,adminOrigin=new URL(configuration.adminUrl).origin,deliver=createHostedEmailTransport({emailBinding,origin:mainOrigin,trustedLoginOrigins:[...new Set([mainOrigin,adminOrigin])],beforeEmailAttempt,requireEmailBudget});
 return Object.freeze({async fetch(request){
  if(!(request instanceof Request)||request.url!==PRIVATE_EMAIL_URL)return failure('email_route_unavailable',404);
  if(request.method!=='POST')return failure('email_method_unavailable',405);
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return failure('email_json_required',415);
  let input;try{input=await readInput(request);}catch(error){let oversized=false;try{oversized=error?.code==='email_request_size';}catch{}return failure(oversized?'email_request_size':'invalid_email_request',oversized?413:400);}
  try{return json(await deliver(input));}catch{return failure('invalid_hosted_email',400);}
 }});
}
