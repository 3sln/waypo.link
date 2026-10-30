// Test double for the embeddable elements and headless flows (design §9.6, EE-22).
// Never import this from define.mjs or production code. Fixtures use .example hosts.
//
// createMockProvider() implements, in-process, the *proposed* provider contract
// the SDK targets: manifest discovery with extension declarations (`extensions`,
// extensions revision 3.2 §2), the provider-owned authorization entry, the authorization page
// decision, token exchange with PKCE S256 and optional DPoP (nonces, bound
// refresh), refresh rotation, RFC 7009-style revocation, a minimal RPC endpoint
// and a FedCM stand-in. Flows that pass against it are verified only against
// this mock. Subjects deliberately do not use 3sln's /entities/<uuid> shape.
import {handleCallback} from './callback.mjs';
import {EXT} from './capabilities.mjs';
import {readRPCRequest,rpcResponse,RPCWireFault} from './rpc-wire.mjs';
export {memorySessionBackend} from './session-store.mjs';

const encode64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode64=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
const random=(size=32)=>encode64(globalThis.crypto.getRandomValues(new Uint8Array(size)));
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const entryKeys=new Set(['clientId','redirectUri','challenge','challengeMethod','state','intent','loginHint','subjectConstraint','maxAge','requests','uiLocales','colorScheme','presentation','dpopJkt']);
const intents=['login','select-account','reauthenticate','end-session'];
const sha256=async text=>encode64(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));

export function memoryStorage(){const items=new Map();return {get length(){return items.size;},key:index=>[...items.keys()][index]??null,getItem:key=>items.has(key)?items.get(key):null,setItem:(key,value)=>items.set(key,String(value)),removeItem:key=>items.delete(key),clear:()=>items.clear()};}

// Illustrative declarations (components-profile §6.6). They are cases, not logic:
// any feature can be toggled independently with the options below.
export const declarationPresets=Object.freeze({
  full:Object.freeze({supportsEntry:true,supportedIntents:intents,popup:true,fedcm:true,revocation:true,dpop:true,refresh:true,components:true,clientMetadata:true}),
  standard:Object.freeze({supportsEntry:true,supportedIntents:['login','select-account'],popup:true,fedcm:false,revocation:true,dpop:false,refresh:true,components:false}),
  minimal:Object.freeze({supportsEntry:false,popup:false,fedcm:false,revocation:false,dpop:false,refresh:false,components:false}),
});
// Embedded-components extension options (formerly the components profile). Parts are `<name>/<version>` values;
// the former per-part `fedcm` flag and `theme_tokens` have no descriptor option.
export function componentsDeclaration(origin,{parts=['avatar','account-switcher','sign-in'],binding=true}={}){
  const host=new URL(origin).host;
  return {embed_origin:`https://embed.${host}`,protocol:[1],parts:parts.map(name=>name.includes('/')?name:`${name}/1`),...binding?{credential_binding:['key-binding.v1']}:{},manage_url:`${origin}/console/apps`};
}

export function createMockProvider({issuer='https://provider.example',accounts=[{handle:'alex',displayName:'Alex Example'}],clients=[{clientId:'https://app.example/client',redirectUris:['https://app.example/callback']}],declaration,clock=Date.now,profile=false,picture=false,extensionKeys=[],subjectPath=id=>`/people/${id}`,manifestPatch={},dpopTokenType=false,...options}={}){
  const settings={supportsEntry:true,supportedIntents:intents,popup:true,fedcm:false,revocation:true,dpop:false,refresh:true,components:false,clientMetadata:false,...declarationPresets[declaration]??{},...options};
  const origin=new URL(issuer).origin;
  const people=accounts.map(account=>({...account,subject:account.subject??`${origin}${subjectPath(globalThis.crypto.randomUUID())}`}));
  const components=settings.components===true?componentsDeclaration(origin):settings.components||null;
  const extensions=[
    ...settings.supportsEntry?[{spec:EXT.authorizationEntry,options:{endpoint:`${origin}/api/oauth/entries`,intents:[...settings.supportedIntents]}}]:[],
    ...settings.fedcm?[{spec:EXT.fedcm,options:{config_url:`${origin}/fedcm/config.json`}}]:[],
    ...settings.clientMetadata?[{spec:EXT.clientIdMetadata}]:[],
    ...components?[{spec:EXT.embeddedComponents,options:components}]:[],
  ];
  const manifest={version:'0',issuer:origin,authorization_endpoint:`${origin}/oauth/authorize`,token_endpoint:`${origin}/oauth/token`,rpc_endpoint:`${origin}/rpc`,jwks_uri:`${origin}/.well-known/jwks.json`,authorization_request_endpoint:`${origin}/api/oauth/requests`,preferences_contract:'https://contracts.example/preferences/v2',
    login_presentation:settings.popup?['redirect','popup']:['redirect'],grant_types_supported:settings.refresh?['authorization_code','refresh_token']:['authorization_code'],
    ...settings.revocation?{revocation_endpoint:`${origin}/oauth/revoke`}:{},...settings.dpop?{dpop_signing_alg_values_supported:['ES256']}:{},
    ...extensions.length?{extensions}:{},...manifestPatch};
  const entries=new Map(),codes=new Map(),refresh=new Map(),revoked=new Set(),log=[],nonces=new Set(),seenJti=new Set(),accessTokens=new Map();
  // Refresh families (one per code exchange). With `reuseDetection`, presenting an already-rotated refresh token
  // revokes its whole family (auth.md), like a conforming provider; `revokedFamilies` records each such revocation.
  const used=new Map(),revokedFamilies=new Set();let familySeq=0;
  const revokeFamily=family=>{revokedFamilies.add(family);for(const [token,value] of refresh)if(value.family===family)refresh.delete(token);};
  const client=id=>clients.find(item=>item.clientId===id);
  async function verifyProof(proof,htu,{accessToken}={}){
    try{
      const [h,p,s]=proof.split('.'),header=JSON.parse(new TextDecoder().decode(decode64(h))),payload=JSON.parse(new TextDecoder().decode(decode64(p)));
      if(header.typ!=='dpop+jwt'||header.alg!=='ES256'||Object.keys(header.jwk).sort().join()!=='crv,kty,x,y')return {error:'invalid_dpop_proof'};
      const key=await globalThis.crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:header.jwk.x,y:header.jwk.y},{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
      if(!await globalThis.crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,decode64(s),new TextEncoder().encode(`${h}.${p}`))||payload.htm!=='POST'||payload.htu!==htu||seenJti.has(payload.jti))return {error:'invalid_dpop_proof'};
      if(accessToken!==undefined&&payload.ath!==await sha256(accessToken))return {error:'invalid_dpop_proof'};
      if(!nonces.has(payload.nonce))return {error:'use_dpop_nonce'};
      seenJti.add(payload.jti);nonces.delete(payload.nonce);
      return {jkt:await sha256(`{"crv":"P-256","kty":"EC","x":"${header.jwk.x}","y":"${header.jwk.y}"}`)};
    }catch{return {error:'invalid_dpop_proof'};}
  }
  const nonceHeader=()=>{if(!settings.dpop)return {};const nonce=random(16);nonces.add(nonce);return {'DPoP-Nonce':nonce};};
  function issue(entry,account,{jkt,family=++familySeq}={}){
    const access='access-'+random(18),refreshToken=settings.refresh?'refresh-'+random(18):undefined;
    if(refreshToken)refresh.set(refreshToken,{entry,account,jkt,family});
    accessTokens.set(access,{account,type:jkt&&dpopTokenType?'DPoP':'Bearer',jkt});
    return {access_token:access,token_type:jkt&&dpopTokenType?'DPoP':'Bearer',expires_in:300,issuer:origin,client_id:entry.clientId,subject:account.subject,audience:manifest.rpc_endpoint,grants:[],granted_fragments:[],
      ...refreshToken?jkt?{refresh_token:refreshToken,refresh_expires_in:2592000,refresh_idle_expires_in:604800}:{refresh_token:refreshToken,refresh_expires_in:28800}:{},
      // auth_time is returned only for the reauthenticate intent (EE-02).
      ...entry.intent==='reauthenticate'?{auth_time:Math.floor((entry.authTime??clock())/1000)}:{},
      ...profile?{profile:{handle:`${account.handle}@${new URL(origin).host}`,displayName:account.displayName,...picture?{picture:`${origin}/avatars/${encodeURIComponent(account.handle)}.png`}:{}}}:{}};
  }
  async function handle(request){
    const url=new URL(request.url);
    log.push({method:request.method,path:url.pathname,credentials:request.credentials,dpop:request.headers.get('dpop')});
    if(url.origin!==origin)return new Response('Not found',{status:404});
    if(request.method==='GET'&&url.pathname==='/.well-known/bindle/manifest.json')return json(manifest,200,{'Cache-Control':'max-age=300'});
    if(request.method==='POST'&&url.pathname==='/api/oauth/entries'&&settings.supportsEntry){
      // Entry creation is cookieless and session-independent: a generic error, never a reason.
      const generic=()=>json({message:'The authorization entry could not be created.'},400);
      if(settings.entryStatus)return new Response('',{status:settings.entryStatus});
      let body;try{body=await request.json();}catch{return generic();}
      if(!body||typeof body!=='object'||Object.keys(body).some(key=>!entryKeys.has(key)&&!extensionKeys.includes(key)))return generic();
      const registered=client(body.clientId);
      if(!registered?.redirectUris.includes(body.redirectUri)||body.challengeMethod!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(body.challenge??'')||!/^[A-Za-z0-9_-]{43}$/.test(body.state??'')||!settings.supportedIntents.includes(body.intent)||!Array.isArray(body.requests)||!['popup','redirect',...settings.fedcm?['fedcm']:[]].includes(body.presentation))return generic();
      if(body.subjectConstraint!==undefined&&!['reauthenticate','end-session'].includes(body.intent))return generic();
      if(['reauthenticate','end-session'].includes(body.intent)&&typeof body.subjectConstraint!=='string')return generic();
      if((body.maxAge!==undefined)!==(body.intent==='reauthenticate'))return generic();
      if(body.dpopJkt!==undefined&&(!settings.dpop||body.intent==='end-session'||!/^[A-Za-z0-9_-]{43}$/.test(body.dpopJkt)))return generic();
      if(request.headers.get('cookie'))return generic();
      const entryId=random(32);entries.set(entryId,{...body,entryId,createdAt:clock(),opened:false});
      return json({entryId},201);
    }
    if(request.method==='POST'&&url.pathname==='/api/oauth/requests'){
      const body=await request.json();if(!client(body.clientId)?.redirectUris.includes(body.redirectUri))return json({message:'Unknown client.'},400);
      const requestId=random(32);entries.set(requestId,{...body,intent:'login',entryId:requestId,legacy:true,createdAt:clock(),opened:false});return json({requestId});
    }
    if(request.method==='POST'&&url.pathname==='/oauth/token'){
      const form=new URLSearchParams(await request.text()),proofHeader=request.headers.get('dpop');
      const proof=proofHeader&&settings.dpop?await verifyProof(proofHeader,manifest.token_endpoint):null;
      if(proof?.error)return json({error:proof.error,message:'DPoP proof required.'},400,nonceHeader());
      if(form.get('grant_type')==='authorization_code'){
        const record=codes.get(form.get('code'));
        if(!record||record.entry.clientId!==form.get('client_id')||record.entry.redirectUri!==form.get('redirect_uri')||await sha256(form.get('code_verifier')??'')!==record.entry.challenge){codes.delete(form.get('code'));return json({error:'invalid_grant',message:'Invalid grant.'},400,nonceHeader());}
        if((record.entry.dpopJkt??null)!==(proof?.jkt??null))return json({error:'invalid_dpop_proof',message:'The DPoP proof does not match this authorization.'},400,nonceHeader());
        codes.delete(form.get('code'));
        return json(issue(record.entry,record.account,{jkt:record.entry.dpopJkt}),200,nonceHeader());
      }
      if(form.get('grant_type')==='refresh_token'){
        const presented=form.get('refresh_token'),record=refresh.get(presented);
        if(record?.jkt&&proof?.jkt!==record.jkt)return json({error:'invalid_dpop_proof',message:'A DPoP proof from the session key is required.'},400,nonceHeader());
        if(!record&&settings.reuseDetection&&used.has(presented)){revokeFamily(used.get(presented));return json({error:'invalid_grant',message:'Invalid grant.'},400,nonceHeader());}
        refresh.delete(presented);
        if(!record||revoked.has(presented))return json({error:'invalid_grant',message:'Invalid grant.'},400,nonceHeader());
        used.set(presented,record.family);
        const {auth_time:_omit,...token}=issue({...record.entry,intent:'login'},record.account,{jkt:record.jkt,family:record.family});return json(token,200,nonceHeader());
      }
      return json({error:'unsupported_grant_type',message:'Unsupported grant.'},400);
    }
    if(request.method==='POST'&&url.pathname==='/oauth/revoke'&&settings.revocation){const form=new URLSearchParams(await request.text()),record=refresh.get(form.get('token'));revoked.add(form.get('token'));refresh.delete(form.get('token'));if(record&&settings.reuseDetection)revokeFamily(record.family);return new Response(null,{status:200});}
    if(request.method==='POST'&&url.pathname==='/rpc'){
      const [scheme,token]=(request.headers.get('authorization')??'').split(' '),record=accessTokens.get(token);
      // Protocol §5: the RPC endpoint speaks Bindle CBOR only (415 for anything else), like a real provider.
      let body;try{body=await readRPCRequest(request);}catch(error){if(error instanceof RPCWireFault)return rpcResponse({error:error.code,message:error.message},error.status);throw error;}
      if(!record||scheme!==record.type)return rpcResponse({error:'unauthorized',message:'Invalid token.'},401);
      if(record.type==='DPoP'){const checked=await verifyProof(request.headers.get('dpop')??'',manifest.rpc_endpoint,{accessToken:token});if(checked.error||checked.jkt!==record.jkt)return rpcResponse({error:'unauthorized',message:'Invalid proof.'},401,{...nonceHeader(),'WWW-Authenticate':`DPoP error="${checked.error??'invalid_dpop_proof'}"`});}
      return rpcResponse({version:'0',tx:body.tx,result:{subject:record.account.subject}},200,record.type==='DPoP'?nonceHeader():{});
    }
    return new Response('Not found',{status:404});
  }
  const fetch=async(input,init)=>handle(input instanceof Request?input:new Request(input,init));
  // Simulates the first-party provider page: the user picks an account and approves
  // or declines. Returns the callback URL the provider would redirect to.
  function authorize(entryOrUrl,{decision='approve',account=people[0],authTime}={}){
    const entryId=typeof entryOrUrl==='string'&&entryOrUrl.includes('://')?(new URL(entryOrUrl).searchParams.get('entry')??new URL(entryOrUrl).searchParams.get('request_id')):entryOrUrl;
    const entry=entries.get(entryId);if(!entry||entry.opened)throw new Error('Unknown or reused authorization entry.');
    entry.opened=true;entry.authTime=authTime;
    const callback=new URL(entry.redirectUri);callback.searchParams.set('state',entry.state);callback.searchParams.set('iss',origin);
    if(entry.intent==='end-session'){callback.searchParams.set('result',decision==='approve'?'completed':'canceled');return callback.href;}
    if(decision!=='approve'){callback.searchParams.set('error','access_denied');return callback.href;}
    const code=random(32);codes.set(code,{entry,account});callback.searchParams.set('code',code);return callback.href;
  }
  // Fake popup driver for DOM tests: window.open returns a stub whose navigation to
  // the provider triggers `decide(entry)` and then runs the real callback relay in
  // an isolated popup context (its own empty sessionStorage).
  async function drivePopup(popup,value,{decide=()=>({decision:'approve'}),BroadcastChannel:Channel=globalThis.BroadcastChannel}={}){
    const target=new URL(value),entry=entries.get(target.searchParams.get('entry')??target.searchParams.get('request_id'));
    const choice=await decide(entry,popup);if(!choice||popup.closed)return;
    const callback=authorize(value,choice);popup.callbackUrl=callback;
    popup.result=await handleCallback({location:{href:callback},history:{replaceState(){}},storage:memoryStorage(),BroadcastChannel:Channel,render:false,close:false});
  }
  function installPopupDriver(win,options={}){return installPopupDrivers(win,[provider],options);}
  // FedCM stand-in: navigator.credentials.get resolves with the token text of
  // auth.md's exchange ({v,code,state,iss}) or rejects like the browser would.
  function installFedCM(win,{decide=()=>({decision:'approve'})}={}){
    const calls=[],navigator=win.navigator??(win.navigator={}),previous=navigator.credentials;
    navigator.credentials={get:async options=>{
      const provider=options?.identity?.providers?.[0];calls.push({options,activation:navigator.userActivation?.isActive});
      if(provider?.configURL!==manifest.extensions?.find(entry=>entry.spec===EXT.fedcm)?.options?.config_url||options.mediation!=='required')throw new DOMException('Not allowed.','NotAllowedError');
      const entry=entries.get(provider.params?.entry),choice=await decide(entry);
      if(choice?.error)throw new DOMException(choice.error,choice.name??'NetworkError');
      if(!entry||entry.clientId!==provider.clientId||choice?.decision!=='approve')throw new DOMException('access_denied','IdentityCredentialError');
      const callback=new URL(authorize(entry.entryId,choice));
      return {token:JSON.stringify({v:1,code:callback.searchParams.get('code'),state:callback.searchParams.get('state'),iss:callback.searchParams.get('iss')}),...choice?.autoSelected?{isAutoSelected:true}:{}};
    }};
    return {calls,uninstall(){navigator.credentials=previous;}};
  }
  // Live (unrevoked) families that still hold a refresh token, for assertions.
  const liveFamilies=()=>new Set([...refresh.values()].map(value=>value.family));
  const provider={issuer:origin,manifest,settings,accounts:people,entries,log,fetch,handle,authorize,drivePopup,installPopupDriver,installFedCM,revoked,refresh,revokedFamilies,liveFamilies};
  return provider;
}
// One window.open for several mock providers: each popup navigation is driven by
// the provider whose origin it targets.
export function installPopupDrivers(win,providers,{decide,blocked=false,BroadcastChannel:Channel=globalThis.BroadcastChannel}={}){
  const original=win.open,opened=[];
  win.open=(url,target,features)=>{
    if(blocked)return null;
    const popup={url,target,features,closed:false,focused:0,opener:win,document:{title:'',body:{textContent:''}},close(){popup.closed=true;},focus(){popup.focused++;},location:{}};
    Object.defineProperty(popup.location,'href',{get:()=>popup.url,set:value=>{popup.url=value;const match=providers.find(item=>item.issuer===new URL(value).origin);if(match)queueMicrotask(()=>match.drivePopup(popup,value,{decide,BroadcastChannel:Channel}));}});
    opened.push(popup);return popup;
  };
  return {opened,uninstall(){win.open=original;}};
}
