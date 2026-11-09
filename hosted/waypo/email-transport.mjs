// Hosted-only adapter for the current structured Cloudflare Email Sending API:
// https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
// A messageId means API acceptance, NOT mailbox delivery or human receipt.
// This leaf mounts no private bridge and provisions/sends nothing on creation.
export const HOSTED_EMAIL_PURPOSES=Object.freeze({
 'identity-login':'login',
 'account-lifecycle':'account',
 'identity-passkey-addition':'account',
 'identity-session-security':'account',
 // Reserved future callers: no account-security/app email route is enabled here.
 'account-security':'account',
 'app-notification':'notify',
 'app-digest':'notify',
});
const senders=Object.freeze({login:Object.freeze({email:'login@login.waypo.link',name:'Waypo.link sign-in'}),account:Object.freeze({email:'account@account.waypo.link',name:'Waypo.link account'}),notify:Object.freeze({email:'notifications@notify.waypo.link',name:'Waypo.link app notifications'})});
export class HostedEmailFault extends Error{constructor(code='invalid_hosted_email'){super(code);this.code=code;}}
const fail=()=>{throw new HostedEmailFault();},bytes=value=>new TextEncoder().encode(value).length;
function text(value,max,{multiline=false}={}){if(typeof value!=='string'||!value.length||!value.isWellFormed()||bytes(value)>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\r]/u.test(value)||!multiline&&/[\n\t]/u.test(value))fail();return value;}
function address(value){text(value,254);if(!/^[^\s@<>(),;:\[\]\\"]+@[^\s@<>(),;:\[\]\\"]+\.[^\s@<>(),;:\[\]\\"]+$/u.test(value))fail();return value;}
function origin(value){text(value,2048);let url;try{url=new URL(value);}catch{fail();}if(url.origin!==value||url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||url.hostname.endsWith('.')||/^\[|^[\d.]+$/u.test(url.hostname)||/\.(?:local|localhost|internal|lan|home|corp)$/u.test(url.hostname)||url.hostname.endsWith('.home.arpa'))fail();return url.origin;}
function providerUrl(value,allowedOrigins,{login=false}={}){text(value,4096);let url;try{url=new URL(value);}catch{fail();}if(url.href!==value||!allowedOrigins.includes(url.origin)||url.username||url.password||url.protocol!=='https:'||url.port)fail();if(login){if(url.pathname!=='/email'||url.search)fail();const pairs=[...new URLSearchParams(url.hash.slice(1))],params=new URLSearchParams(pairs);if(pairs.length!==2||pairs.some(([key])=>!['flow','token'].includes(key))||params.getAll('flow').length!==1||params.getAll('token').length!==1||!['flow','token'].every(key=>/^[A-Za-z0-9_-]{1,256}$/u.test(params.get(key)??''))||url.hash!=='#'+new URLSearchParams({flow:params.get('flow'),token:params.get('token')}).toString())fail();}return url.href;}
function securityUrl(value,mainOrigin,purpose){
 const href=providerUrl(value,[mainOrigin]),url=new URL(href),path=purpose==='identity-passkey-addition'?'/passkeys/approve':'/sessions/approve';
 const pairs=[...new URLSearchParams(url.hash.slice(1))],params=new URLSearchParams(pairs);
 if(url.pathname!==path||url.search||pairs.length!==2||params.getAll('operation').length!==1||params.getAll('token').length!==1||!['operation','token'].every(key=>/^[A-Za-z0-9_-]{43}$/u.test(params.get(key)??''))||url.hash!=='#'+new URLSearchParams({operation:params.get('operation'),token:params.get('token')}).toString())fail();return href;
}
function plainMessage(input,mainOrigin){if(input.url!==undefined)providerUrl(input.url,[mainOrigin]);const subject=text(input.subject??input.title,512),body=text(input.text??input.body,32768,{multiline:true});return {subject,text:body};}
function render(message,{mainOrigin,loginOrigins}){
 let input;try{input=structuredClone(message);}catch{fail();}
 if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(HOSTED_EMAIL_PURPOSES,input.purpose))fail();
 const common=['to','purpose','createdAt','jobId','idempotencyKey'],login=input.purpose==='identity-login',security=['identity-passkey-addition','identity-session-security'].includes(input.purpose),app=HOSTED_EMAIL_PURPOSES[input.purpose]==='notify',allowed=[...common,...(login||security)?['url','code']:['url','title','subject','body','text',...app?['senderOrigin']:[]]];
 if(Object.keys(input).some(key=>!allowed.includes(key)))fail();
 const to=address(input.to);if(input.createdAt!==undefined&&(!Number.isSafeInteger(input.createdAt)||input.createdAt<0))fail();for(const key of ['jobId','idempotencyKey'])if(input[key]!==undefined)text(input[key],128);
 for(const key of ['subject','title'])if(input[key]!==undefined)text(input[key],512);for(const key of ['text','body'])if(input[key]!==undefined)text(input[key],32768,{multiline:true});
 let content;if(security){const url=securityUrl(input.url,mainOrigin,input.purpose);if(typeof input.code!=='string'||!/^\d{8}$/u.test(input.code))fail();const action=input.purpose==='identity-passkey-addition'?'add a passkey':'manage your sessions';content={subject:'Confirm your Waypo.link account security request',text:`Confirm your request to ${action}:\n\n${url}\n\nVerification code: ${input.code}\n\nUse the browser that requested this change. If you did not request this, ignore this email.`};}
 else if(login){const url=providerUrl(input.url,loginOrigins,{login:true});if(typeof input.code!=='string'||!/^\d{8}$/u.test(input.code))fail();content={subject:'Your Waypo.link sign-in link',text:`Continue signing in to Waypo.link:\n\n${url}\n\nVerification code: ${input.code}\n\nThe link and code expire ten minutes after the request. If you did not request this, you can ignore this email.`};}
 else if(app){const senderOrigin=origin(input.senderOrigin),title=text(input.subject??input.title,512),body=text(input.text??input.body,32768,{multiline:true});if(input.url!==undefined)providerUrl(input.url,[mainOrigin]);content={subject:text(`App notification from ${new URL(senderOrigin).hostname}: ${title}`,768),text:`App sender: ${senderOrigin}\n\n${body}`};}
 else content=plainMessage(input,mainOrigin);
 return {purpose:input.purpose,payload:{to,from:{...senders[HOSTED_EMAIL_PURPOSES[input.purpose]]},...content}};
}
// One unsettled send per exact native capability, shared by recreated wrappers.
// A caller deadline never releases uncertain native work. No queue or retry.
const pendingSends=new WeakSet();
const unconfigured=new Set(['E_SENDER_NOT_VERIFIED','E_SENDER_DOMAIN_NOT_AVAILABLE','E_RECIPIENT_NOT_ALLOWED']);
const known=new Set([...unconfigured,'E_RECIPIENT_SUPPRESSED','E_VALIDATION_ERROR','E_FIELD_MISSING','E_TOO_MANY_RECIPIENTS','E_TOO_MANY_ATTACHMENTS','E_ACCOUNT_SUSPENDED','E_CONTENT_TOO_LARGE','E_DELIVERY_FAILED','E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED','E_INTERNAL_SERVER_ERROR','E_HEADER_NOT_ALLOWED','E_HEADER_USE_API_FIELD','E_HEADER_VALUE_INVALID','E_HEADER_VALUE_TOO_LONG','E_HEADER_NAME_INVALID','E_HEADERS_TOO_LARGE','E_HEADERS_TOO_MANY']);
/** Internal hosted deliverEmail port. No retries, raw MIME, fetch fallback,
 * custom headers, attachments, sender overrides or delivery/read claims.
 * trustedLoginOrigins comes only from trusted deploy configuration, not input.
 */
export function createHostedEmailTransport({emailBinding,origin:mainOrigin='https://waypo.link',trustedLoginOrigins=[mainOrigin],beforeEmailAttempt,requireEmailBudget=false,emailBudgetTimeoutMs=5000,emailSendTimeoutMs=10000,clock=Date.now,cryptography=globalThis.crypto}={}){
 if(!Number.isSafeInteger(emailSendTimeoutMs)||emailSendTimeoutMs<1||emailSendTimeoutMs>10000||typeof requireEmailBudget!=='boolean'||beforeEmailAttempt!==undefined&&typeof beforeEmailAttempt!=='function'||requireEmailBudget&&typeof beforeEmailAttempt!=='function'||typeof clock!=='function'||typeof cryptography?.getRandomValues!=='function'||!Number.isSafeInteger(emailBudgetTimeoutMs)||emailBudgetTimeoutMs<1||emailBudgetTimeoutMs>10000)throw new TypeError('Trusted bounded email budget capability required');
 origin(mainOrigin);if(!Array.isArray(trustedLoginOrigins)||!trustedLoginOrigins.length||trustedLoginOrigins.length>4||new Set(trustedLoginOrigins).size!==trustedLoginOrigins.length||!trustedLoginOrigins.includes(mainOrigin))throw new TypeError('Explicit exact trusted login origins required');const loginOrigins=trustedLoginOrigins.map(origin),send=typeof emailBinding?.send==='function'?emailBinding.send.bind(emailBinding):null;
 return async function deliverEmail(message){const {payload,purpose}=render(message,{mainOrigin,loginOrigins});if(!send)return {status:'unconfigured',code:'email_binding_missing'};if(pendingSends.has(emailBinding))return {status:'outage',code:'email_transport_unavailable'};
  if(beforeEmailAttempt){const controller=new AbortController();let timer;try{const at=clock();if(!Number.isSafeInteger(at)||at<1000000000000||at>9999999999999)throw Error('clock');const entropy=cryptography.getRandomValues(new Uint8Array(32));if(!(entropy instanceof Uint8Array)||entropy.length!==32)throw Error('entropy');const nonce=btoa(String.fromCharCode(...entropy)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,''),attemptId=at+'.'+nonce,deadline=Date.now()+emailBudgetTimeoutMs,expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('budget_timeout'));},emailBudgetTimeoutMs);}),admission=await Promise.race([Promise.resolve().then(()=>beforeEmailAttempt(Object.freeze({attemptId,purpose,to:payload.to}),{signal:controller.signal})),expired]);if(controller.signal.aborted||Date.now()>=deadline||admission?.admitted!==true)throw Error('admission');}catch{return {status:'outage',code:'email_budget_unavailable'};}finally{clearTimeout(timer);controller.abort();}}
  try{let timer;try{if(pendingSends.has(emailBinding))return {status:'outage',code:'email_transport_unavailable'};pendingSends.add(emailBinding);const dispatched=Promise.resolve().then(()=>send(payload));dispatched.then(()=>pendingSends.delete(emailBinding),()=>pendingSends.delete(emailBinding));const response=await Promise.race([dispatched,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('email_send_timeout')),emailSendTimeoutMs);})]);text(response?.messageId,512);return {status:'accepted',messageId:response.messageId};}finally{clearTimeout(timer);}}
  catch(error){let code='email_transport_unavailable';try{const candidate=error?.code;if(typeof candidate==='string'&&known.has(candidate))code=candidate;}catch{};if(code==='E_RECIPIENT_SUPPRESSED')return {status:'rejected',permanent:true,code};if(unconfigured.has(code))return {status:'unconfigured',code};return {status:'outage',code};}
 };
}
