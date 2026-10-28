// Cloudflare TURN credential adapter. Moved from packages/beaming/turn.mjs when Beam left the core (DEVLOG 2026-10-26);
// kept as a tested, unused building block for the ice-relay occupant planned in docs/architecture/rtc-signaling.md §5 (carried by signaling §16.7).
// Provider credentials are bearer secrets. Never log responses or persisted SDP.
// API: https://developers.cloudflare.com/realtime/turn/generate-credentials/
export class TurnError extends Error {constructor(code,message,status=400){super(message);this.name='TurnError';this.code=code;this.status=status;}}
const fail=(code,message,status)=>{throw new TurnError(code,message,status);};
export const TURN_MAX_TTL_SECONDS=300;
export class CloudflareTurnAdapter {
 constructor({keyId,apiToken,fetch:request=globalThis.fetch}){Object.assign(this,{keyId,apiToken,request});}
 /** Issues short-lived ICE servers; every URL must be Cloudflare's TURN or STUN host. */
 async issue({ttl=TURN_MAX_TTL_SECONDS}={}){
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(this.keyId||'')||!this.apiToken||!Number.isSafeInteger(ttl)||ttl<1||ttl>TURN_MAX_TTL_SECONDS)fail('turn_unconfigured','TURN is unavailable.',503);
  let response;try{response=await this.request(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(this.keyId)}/credentials/generate-ice-servers`,{method:'POST',headers:{Authorization:`Bearer ${this.apiToken}`,'Content-Type':'application/json'},body:JSON.stringify({ttl}),signal:AbortSignal.timeout(10000)});}catch{fail('turn_unavailable','TURN credential issuance failed.',503);}
  if(!response.ok)fail('turn_unavailable','TURN credential issuance failed.',503);
  let payload;try{payload=await response.json();}catch{fail('turn_invalid','TURN returned invalid credentials.',503);}
  if(!Array.isArray(payload?.iceServers)||payload.iceServers.length>8||!payload.iceServers.length)fail('turn_invalid','TURN returned invalid credentials.',503);
  const iceServers=payload.iceServers.map(s=>{const urls=Array.isArray(s?.urls)?s.urls:[s?.urls];if(urls.length>8||urls.some(u=>typeof u!=='string'||!/^turns?:turn\.cloudflare\.com:\d+(\?transport=(tcp|udp))?$/.test(u)&&!/^stun:stun\.cloudflare\.com:\d+$/.test(u))||urls.some(u=>u.startsWith('turn'))&&(typeof s.username!=='string'||s.username.length>512||typeof s.credential!=='string'||s.credential.length>512))fail('turn_invalid','TURN returned invalid credentials.',503);return {urls,...s.username?{username:s.username}:{},...s.credential?{credential:s.credential}:{}};});
  return {iceServers,expiresIn:ttl};
 }
 async revoke(username){
  if(typeof username!=='string'||!username||username.length>512)fail('turn_invalid','Invalid TURN credential.');
  const response=await this.request(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(this.keyId)}/credentials/${encodeURIComponent(username)}/revoke`,{method:'POST',headers:{Authorization:`Bearer ${this.apiToken}`},signal:AbortSignal.timeout(10000)});
  if(response.status!==204)fail('turn_unavailable','TURN credential revocation failed.',503);
 }
}
