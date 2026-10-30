// Bindle signaling as a browser app uses it (signaling §5–§10), written for the Meet sample from the spec. The SDK has no
// signaling helper yet, so this file holds what every calling app needs: per-session leg keys, signed messages
// (compact JWS, ES256, low-S), the `listen` long poll, and the §16.4 shapes for SDP and ICE candidates.
// Sample-only code: anything generic here is a candidate for the SDK by separate decision (core-scope rule).
const enc=new TextEncoder(),dec=new TextDecoder();
export const b64u=bytes=>{let s='';for(const b of bytes instanceof Uint8Array?bytes:new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const unb64u=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
const sha256=async data=>new Uint8Array(await crypto.subtle.digest('SHA-256',typeof data==='string'?enc.encode(data):data));
const segment=value=>b64u(enc.encode(JSON.stringify(value)));
// P-256 group order: signatures are sent in low-S form (signaling §7.1, AMD-RV1).
const N=0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,HALF_N=N>>1n;
const big=bytes=>bytes.reduce((n,b)=>(n<<8n)|BigInt(b),0n);
const bytes32=n=>{const out=new Uint8Array(32);for(let i=31;i>=0;i--){out[i]=Number(n&0xffn);n>>=8n;}return out;};

/** A fresh leg key for one session (a delegate is never reused, §6.1). The private key cannot leave the page. */
export async function legKey(){
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey),jwk={kty:'EC',crv:'P-256',x,y};
 return {privateKey:pair.privateKey,jwk,jkt:b64u(await sha256(JSON.stringify({crv:'P-256',kty:'EC',x,y})))};
}
async function signLowS(privateKey,input){
 const raw=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,enc.encode(input)));
 let s=big(raw.slice(32));if(s>HALF_N)s=N-s;
 return Uint8Array.from([...raw.slice(0,32),...bytes32(s)]);
}
/** The payload of a compact JWS or JWT (no verification: the provider verifies certificates and messages). */
export function claims(token){try{return JSON.parse(dec.decode(unb64u(String(token).split('.')[1])));}catch{return null;}}
export const offerDigest=async token=>b64u(await sha256(token));

/** One party's view of a session: who it is (from its own leg certificate) and its ordered, signed messages. */
export function legSigner({leg,certificate}){
 const own=claims(certificate);let seq=0;
 return {
  own,get seq(){return seq;},
  /** A signed message (§7.1). `to` is the peer leg's thumbprint, or null for the invite. */
  async message(type,body,{to=null,peerIdentity}){
   const payload={bindle:'signaling-message',v:1,iss:own.iss,sub:own.sub,aud:peerIdentity,sid:own.sid,leg:leg.jkt,to,seq:seq++,iat:Math.floor(Date.now()/1000),type,body};
   const input=`${segment({alg:'ES256',typ:'bindle-signaling-message+jwt',kid:leg.jkt})}.${segment(payload)}`;
   return `${input}.${b64u(await signLowS(leg.privateKey,input))}`;
  }
 };
}

/**
 * SDP as signaling carries it (§16.4): CRLF lines, no candidate lines (candidates trickle separately), unspecified
 * connection addresses, and trickle ICE declared. Browsers produce exactly this from createOffer/createAnswer before
 * gathering, so the cleaning only guards against a description that already holds candidates.
 */
export function signalingSdp(sdp){
 const lines=String(sdp).split(/\r?\n/).filter(l=>l&&!/^a=(candidate|end-of-candidates|remote-candidates)/.test(l))
  .map(l=>l.startsWith('c=IN IP4 ')?'c=IN IP4 0.0.0.0':l.startsWith('c=IN IP6 ')?'c=IN IP6 ::':/^a=rtcp:\d+ IN IP4 /.test(l)?l.replace(/IN IP4 .+$/,'IN IP4 0.0.0.0'):l);
 if(!lines.some(l=>/^a=ice-options:.*\btrickle\b/.test(l))){const at=lines.findIndex(l=>l.startsWith('m='));lines.splice(at<0?lines.length:at,0,'a=ice-options:trickle');}
 return lines.join('\r\n')+'\r\n';
}
/**
 * Which local candidates may be sent to a person on another provider (§16.4, §16.5 with the `public` policy): host
 * candidates only under their mDNS name (`<uuid>.local`); never a raw address. One refused item would refuse the
 * whole batch, so anything else is held back here.
 */
export function shareable(candidate){
 if(!candidate?.candidate)return false;
 const f=candidate.candidate.replace(/^a=/,'').split(' ');
 return f.length>=8&&f[6]==='typ'&&f[7]==='host'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$/i.test(f[4])&&/^udp$/i.test(f[2]);
}
export const candidateItem=c=>({candidate:c.candidate.replace(/^a=/,''),sdpMid:c.sdpMid??null,sdpMLineIndex:c.sdpMLineIndex??null,usernameFragment:c.usernameFragment??null});

/**
 * The signaling resource through the SDK (`call(method, args)` is the kit's resourceField call bound to the contract).
 * `listen` is a long poll (§10.2, at most 25 s; 10 s here so it ends inside the SDK's request bound).
 */
export function signalingEndpoint({call,kinds,label}){
 let ep=null,cursor,stopped=false,running=null;
 const auth=()=>({endpoint:ep.endpoint,...ep.endpoint_secret?{endpoint_secret:ep.endpoint_secret}:{}});
 return {
  get ready(){return !!ep;},
  async register(){if(!ep){const r=await call('register',{kinds,...label?{label}:{}});ep={endpoint:r.endpoint,...r.endpoint_secret?{endpoint_secret:r.endpoint_secret}:{}};}return ep;},
  offer:args=>call('offer',{...auth(),...args}),
  open:args=>call('open',{...auth(),...args}),
  claim:args=>call('claim',{...auth(),...args}),
  send:(sid,messages)=>call('send',{...auth(),sid,messages}),
  revokeOffers:offers=>call('revoke_offer',{...auth(),...offers?{offers}:{}}),
  /** Starts the long poll; `onEvent(event)` gets every event in order. Errors back off and retry. */
  listen(onEvent,{onError}={}){
   if(running)return running;stopped=false;
   running=(async()=>{let delay=500;while(!stopped){
    try{const r=await call('listen',{...auth(),...cursor!==undefined?{cursor}:{},wait:10});if(stopped)break;cursor=r.cursor;delay=500;for(const e of r.events??[])await onEvent(e);}
    catch(error){if(stopped)break;onError?.(error);await new Promise(r=>setTimeout(r,delay));delay=Math.min(delay*2,8000);}
   }})();return running;
  },
  stop(){stopped=true;running=null;},
  async unregister(){stopped=true;if(ep){try{await call('unregister',auth());}catch{}ep=null;}}
 };
}
