// ORG-7 HTTP adapter. No membership, contact, profile or delegation data is exposed.
import {createAppEngine,read} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {DirectoryIdentity,DIRECTORY_FLAG,DIRECTORY_PATH} from '../../app/domains/directory.mjs';
import {movedDirectoryResponse,MOVE_PATH} from './moved.mjs';
import {ATTESTATION_KEYS_PATH,parseAttestationKeySet} from '../../identity/attestation-keys.mjs';
import {stages as federation} from './federation.mjs';
import {flagGlobal,json,pseudonym,subnet} from './shared.mjs';
const DOCUMENT=/^\/identity\/([a-f0-9-]{36})\/identity\.json$/;
const headers={'Access-Control-Allow-Origin':'*','Referrer-Policy':'no-referrer','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
const unknown=()=>json({error:'not_found'},404,headers);
export const stages={async public(ctx){
 const {request,env,url,path,local}=ctx;if(url.origin!==env.APP_ORIGIN)return;
 const document=DOCUMENT.exec(path),lookup=path===DIRECTORY_PATH,manifest=path==='/.well-known/bindle/manifest.json';
 if(!document&&!lookup&&!manifest)return;
 if(!flagGlobal(env,DIRECTORY_FLAG))return manifest?undefined:unknown();
 // Compose the existing manifest handler here to avoid changing another workstream's route module.
 if(manifest){
  const response=await federation.public(ctx);if(!response?.ok||request.method!=='GET')return response;
  const value=await response.json(),features={...value.features,'directory.v1':{directory_url:env.APP_ORIGIN+DIRECTORY_PATH}};
  const keys=parseAttestationKeySet(env.IDENTITY_ATTESTATION_KEYS??env.IDENTITY_ATTESTATION_KEY);
  if(flagGlobal(env,'IDENTITY_TRANSFER_OUT_ENABLED')&&keys?.keys.length)features['portability.v1']={move_endpoint:env.APP_ORIGIN+MOVE_PATH,attestation_jwks_uri:env.APP_ORIGIN+ATTESTATION_KEYS_PATH};
  return json({...value,features},200,{'Access-Control-Allow-Origin':'*','Referrer-Policy':'no-referrer'});
 }
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS'}});
 if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405,{...headers,Allow:'GET, HEAD, OPTIONS'});
 const params=[...url.searchParams],valid=lookup?params.length===1&&['handle','sub'].includes(params[0][0]):params.length===0;
 const input=document?{sub:document[1],document:true}:valid?Object.fromEntries(params):{};
 // Rate limits depend on the requested value, never existence. Hash network and handle/sub before storage.
 const secret=env.ABUSE_HASH_KEY||env.KEY_ENCRYPTION_KEY;if(!secret||typeof env.ABUSE?.consume!=='function')return json({error:'temporarily_unavailable'},503,headers);
 const remote=request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown');
 for(const [kind,value,limit]of [['network',subnet(remote),240],['target',String(input.handle??input.sub??'').toLowerCase(),60]])if(!await env.ABUSE.consume('directory/'+kind+'/'+await pseudonym(value,secret),{windowMs:60000,limit}))return json({error:'rate_limited'},429,{...headers,'Retry-After':'60'});
 let response;
 if(!valid)response=unknown();
 else{
  if(lookup){const handle=input.handle?.split('@');const moved=await movedDirectoryResponse(request,env,input.sub?{sub:input.sub}:handle?.length===2&&handle[1].toLowerCase()===new URL(env.APP_ORIGIN).host?{handle:encodeURIComponent(handle[0])}:{});if(moved){const h=new Headers(moved.headers);h.set('Access-Control-Allow-Origin','*');response=new Response(moved.body,{status:moved.status,headers:h});}}
  if(!response){const engine=createAppEngine({providers:{identityShards:env.IDENTITY_REPOSITORY,accounts:env.ACCOUNTS,config:env,clock:systemClock,random:cryptoRandom,audit:nullAudit}});try{const value=await read(engine,new DirectoryIdentity({input}));response=value?json(value,200,{...headers,'Cache-Control':'public, max-age=60'}):unknown();}finally{engine.dispose();}}
 }
 return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
}};
export const allowedMethods=path=>path===DIRECTORY_PATH||DOCUMENT.test(path)?['GET','HEAD','OPTIONS']:null;
