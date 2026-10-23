// ORG-6a: explicit, top-level member consent. Certificates never enter a redirect URL or browser storage.
// The app keeps the non-extractable holder key and uses it for DPoP at the organization's token endpoint.
import {createKey} from './dpop.mjs';
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const text=new TextEncoder(),ACCESS='https://spec.bindle.example/purposes/member-access/v1';
const failure=code=>Object.assign(new Error(code),{code});
function origin(value,allowLoopback){let u;try{u=new URL(value);}catch{throw failure('invalid_request');}if(u.origin!==value||u.username||u.password||u.protocol!=='https:'&&!(allowLoopback&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw failure('invalid_request');return u;}
/** Proof for the home provider's member-certificate profile; this is deliberately distinct from a DPoP JWS. */
export async function createMemberProof(holder,{aud,clientId,issuer,subject,crypto=globalThis.crypto,clock=Date.now}){
 const iat=Math.floor(clock()/1000),input='bindle-member-certificate-pop-v1\n'+JSON.stringify({aud,client_id:clientId,iat,iss:issuer,jkt:holder.jkt,sub:subject});
 return {iat,signature:encode(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},holder.privateKey,text.encode(input)))};
}
function claims(certificate){try{if(typeof certificate!=='string'||certificate.length>8192)return null;const p=certificate.split('.');if(p.length!==3)return null;return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(p[1].replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-p[1].length%4)%4)),c=>c.charCodeAt(0))));}catch{return null;}}
/** Call from a click handler so the browser can open the consent window. Returns {certificate,...,holder}.
 * `redirectUri` is an exact registered app URI on the current window's origin; it establishes delivery origin.
 * This minimal flow supports a popup only; a blocked/closed popup rejects and can be retried by the caller. */
export function acquireMemberCertificate({issuer,aud,clientId,redirectUri,window:win=globalThis.window,crypto=globalThis.crypto,clock=Date.now,timers=globalThis,timeoutMs=300000,allowLoopback=false}={}){
 try{
  origin(issuer,allowLoopback);if(!win||!crypto?.subtle||typeof clientId!=='string'||!clientId||clientId.length>200||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw failure('invalid_request');
  const redirect=new URL(redirectUri),organization=new URL(aud);origin(redirect.origin,allowLoopback);origin(organization.origin,allowLoopback);
  if(redirect.href!==redirectUri||redirect.origin!==win.location.origin||redirect.username||redirect.password||redirect.hash||organization.href!==aud||organization.username||organization.password||organization.hash||organization.search||!/^\/identity\/[0-9a-f-]{36}$/.test(organization.pathname))throw failure('invalid_request');
  const state=encode(crypto.getRandomValues(new Uint8Array(32))),url=new URL('/console',issuer);
  for(const [k,v]of Object.entries({member_certify:'1',client_id:clientId,redirect_uri:redirectUri,aud,state}))url.searchParams.set(k,v);
  const popup=win.open(url.href,'_blank','popup,width=540,height=760');if(!popup)throw failure('popup_blocked');
  return new Promise((resolve,reject)=>{
   let finished=false,busy=false,subject=null,holder;const pending=createKey(crypto);pending.catch(()=>{});
   const finish=(error,value)=>{if(finished)return;finished=true;win.removeEventListener('message',receive);timers.clearTimeout(deadline);timers.clearInterval(closed);try{popup.close();}catch{}error?reject(error):resolve(value);};
   const receive=async event=>{
    const data=event.data;if(finished||event.source!==popup||event.origin!==issuer||!data||data.state!==state)return;
    if(data.type==='bindle:member-error'){finish(failure(data.code==='canceled'?'canceled':'acquisition_failed'));return;}
    if(data.type==='bindle:member-ready'){
     if(busy||subject!==null)return;
     if(data.issuer!==issuer||data.aud!==aud||data.client?.client_id!==clientId||data.client?.origin!==redirect.origin||typeof data.subject!=='string'||!/^[0-9a-f-]{36}$/.test(data.subject)){finish(failure('invalid_response'));return;}
     busy=true;try{holder=await pending;const proof=await createMemberProof(holder,{aud,clientId,issuer,subject:data.subject,crypto,clock});if(finished)return;subject=data.subject;popup.postMessage({type:'bindle:member-key',state,delegate:holder.jwk,proof},issuer);}catch{finish(failure('acquisition_failed'));}finally{busy=false;}
    }else if(data.type==='bindle:member-result'){
     const result=data.result??data,body=claims(result.certificate);
     if(!subject||!body||body.bindle!=='member-certificate'||body.v!==1||body.iss!==issuer||body.sub!==subject||body.aud!==aud||body.cnf?.jkt!==holder.jkt||body.client?.client_id!==clientId||body.client?.origin!==redirect.origin||!Array.isArray(body.purposes)||body.purposes.length!==1||body.purposes[0]!==ACCESS||!Number.isSafeInteger(body.exp)||body.exp<=clock()/1000){finish(failure('invalid_response'));return;}
     finish(null,{certificate:result.certificate,jkt:holder.jkt,iat:body.iat,exp:body.exp,aep:body.aep,status:result.status,holder});
    }
   };
   const deadline=timers.setTimeout(()=>finish(failure('timeout')),timeoutMs),closed=timers.setInterval(()=>{if(popup.closed)finish(failure('canceled'));},500);
   win.addEventListener('message',receive);
  });
 }catch(error){return Promise.reject(error?.code?error:failure('invalid_request'));}
}
