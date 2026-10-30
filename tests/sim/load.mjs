// Load phase (spike §3.3 "a separate load phase runs with a concurrency knob and asserts invariants only, not order").
// API actors: people the scenario does not watch through a browser. Everything goes through the providers' real HTTP
// routes over the simulation network (signup with a soft passkey and the Turnstile stand-in, organizations,
// invitations, acceptance) — nothing is written into storage. Each actor has its own seeded network address.
import {softAuthenticator,registerPending} from '../helpers/soft-passkey.mjs';

/** Runs `fn` over `items` with at most `concurrency` in flight; returns results in input order and per-item ms. */
export async function pool(items,concurrency,fn){
 const results=new Array(items.length),ms=new Array(items.length);let next=0;
 async function worker(){while(next<items.length){const i=next++,started=Date.now();results[i]=await fn(items[i],i);ms[i]=Date.now()-started;}}
 await Promise.all([...Array(Math.min(concurrency,items.length))].map(worker));
 return {results,ms};
}
export const p95=values=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(0.95*sorted.length)-1)];};

/** An owner-route client for one API actor on one provider: session cookies, CSRF, the tab's account selection
 * (X-Bindle-Account and X-Bindle-Session-Context, as the console sends them) and the actor's own address. */
export function ownerClient(world,provider,actor){
 const call=async(path,{method='GET',body,headers={}}={})=>{
  const response=await world.network.fetch(provider.origin+path,{method,clientIp:actor.ip,headers:{Origin:provider.origin,...body!==undefined?{'Content-Type':'application/json'}:{},...actor.cookie?{Cookie:actor.cookie}:{},...actor.csrf&&method!=='GET'?{'X-CSRF-Token':actor.csrf}:{},...actor.accountId?{'X-Bindle-Account':actor.accountId}:{},...actor.sessionContext?{'X-Bindle-Session-Context':actor.sessionContext}:{},...headers},...body!==undefined?{body:JSON.stringify(body)}:{}});
  const text=await response.text();let json=null;try{json=text?JSON.parse(text):null;}catch{}
  if(!response.ok)throw Object.assign(new Error(`${method} ${path} → ${response.status} ${json?.error??''} ${String(json?.message??'').slice(0,160)}`),{status:response.status,code:json?.error,body:json});
  return {json,headers:response.headers};
 };
 return {call,get:path=>call(path).then(r=>r.json),post:(path,body)=>call(path,{method:'POST',body}).then(r=>r.json)};
}

/** Signs one API actor up over HTTP (passkey + recovery file, the same routes the signup wizard uses). */
export async function apiSignUp(world,provider,{ip,config}){
 const authenticator=softAuthenticator({origin:provider.origin}),actor={ip,provider:provider.name};
 const client=ownerClient(world,provider,actor);
 const pending=await client.post('/api/auth/signup',{method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:config.termsVersion,turnstileToken:world.network.turnstileToken(provider.host,'signup')});
 await registerPending(authenticator,(path,data)=>client.post(path,data),pending);
 const recovery=await client.post('/api/auth/recovery/download',{pendingToken:pending.pendingToken});
 const {json:session,headers}=await client.call('/api/auth/recovery/confirm',{method:'POST',body:{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}});
 const cookies=(headers.getSetCookie?.()??[headers.get('set-cookie')]).filter(Boolean).map(c=>c.split(';')[0]);
 return Object.assign(actor,{cookie:cookies.join('; '),csrf:session.csrfToken,sessionContext:session.sessionContext,accountId:session.account.id,handle:session.account.handle,authenticator,principal:{iss:provider.origin,sub:session.account.id}});
}
