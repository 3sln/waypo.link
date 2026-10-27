import {handleBrokeredIntrospection,CLIENT_ASSERTION_TYPE} from '../../packages/federation/introspection.mjs';
import {Engine,Provider} from '../../vendor/ngin/index.js';
import {canonical,base64url} from '../../packages/core/records.mjs';
// U404 route matrix: account/federation ports inject faults after the edge's active-identity check.
// Boundary (app-uninstall §7.5a): TARGET surfaces (the request names an identity, link or owner) answer one uniform 404
// for unknown/deleting/deleted/suspended/moved targets. CREDENTIAL surfaces (bearer/DPoP/capability/grant/client proof)
// answer the standard protocol refusal (401/400), identical whether the credential is simply invalid or its own subject
// is deleted/deleting/suspended/moved, and never 404/410.
// No credential verification/provider delivery is claimed by this boundary fixture.
import http from '../../packages/runtime/http.mjs';
import {createFlags} from '../../packages/flags/evaluate.mjs';
import {DESCRIPTOR_MEDIA_TYPE,CONTACT_LINK_TYPE} from '../../packages/links/types.mjs';
export const origin='https://unknown.example',embed='https://islands.example',resource='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const cases=['missing-resource','deleting','deleted','never','suspended','moved','gone'];
const ids=Object.fromEntries(cases.map((name,i)=>[name,`${String(i+1).repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`]));
const enc=value=>btoa(typeof value==='string'?value:JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const token=(typ,claims)=>enc({alg:'ES256',kid:'fixture',typ})+'.'+enc(claims)+'.'+enc('s'.repeat(64));
const fault=name=>Object.assign(Error('Private lifecycle detail '+name),name==='missing-resource'||name==='never'?{code:'not_found',status:404}:name==='suspended'?{code:'account_suspended',status:423,retryAfter:99}:name==='gone'?{code:'retired_resource',status:410,retryAfter:99}:{code:'account_'+(name==='deleting'?'deleting':name==='moved'?'moved':'deleted'),status:410,retryAfter:99});
const url=name=>{const sub=ids[name],aud=`${origin}/users/person/contact/${resource}`;return aud+'?bindle_meta='+token('bindle-link-meta+jwt',{bindle:'link-meta',v:1,type:CONTACT_LINK_TYPE,iss:origin,aud,jti:resource,iat:1,exp:2147483647,sub});};
const postbackKey=btoa('k'.repeat(32));
async function prepared(name){const owner=ids[name],nonce='A'.repeat(43),expiresAt=Date.now()+120000,material=await crypto.subtle.importKey('raw',new TextEncoder().encode('k'.repeat(32)),'HKDF',false,['deriveKey']),key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('bindle/form-dispatch/v1'),info:new TextEncoder().encode('message-postback-dispatch-v1')},material,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']),mac=base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(canonical({purpose:'message-postback-dispatch-v1',issuer:origin,owner,messageId:resource,nonce,expiresAt})))));return [owner,nonce,expiresAt,mac].join('.');}
const post=(path,body={},headers={})=>({url:origin+path,method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json',...headers}});
export const targetSurfaces=[
 ...['text/plain','application/json','application/vnd.bindle.contact-profile+json','application/vnd.bindle.contact-intake+json','application/vnd.bindle.contact-token+jwt; profile="contact-delivery-v1"','text/html',DESCRIPTOR_MEDIA_TYPE].map(accept=>({name:'contact '+accept,request:name=>({url:url(name),headers:{Accept:accept}})})),
 {name:'contact HEAD',request:name=>({url:url(name),method:'HEAD',headers:{Accept:'application/json'}})},
 {name:'signed delivery unsupported media',request:name=>({url:url(name),method:'POST',body:'unused',headers:{'Content-Type':'text/plain'}})},
 {name:'signed delivery ambiguous credentials',request:name=>({url:url(name),method:'POST',body:'unused',headers:{Authorization:'Bearer ignored','Content-Type':'multipart/form-data; boundary=fixture'}})},
 {name:'signed delivery',request:name=>({url:url(name),method:'POST',body:'unused',headers:{'Content-Type':'multipart/form-data; boundary=fixture'}})},
 {name:'oEmbed',request:name=>({url:origin+'/oembed?url='+encodeURIComponent(url(name))})},
 {name:'avatar',request:name=>({url:url(name).replace('/contact/'+resource,'/contact/'+resource+'/avatar')})},
 {name:'legacy contact',request:name=>({url:origin+'/users/person/contact/'+resource+'?sig='+token('JWT',{sub:ids[name]}),headers:{Accept:'application/json'}})},
 {name:'descriptor HEAD',request:name=>({url:url(name),method:'HEAD',headers:{Accept:DESCRIPTOR_MEDIA_TYPE}})},
 {name:'oEmbed HEAD',request:name=>({url:origin+'/oembed?url='+encodeURIComponent(url(name)),method:'HEAD'})},
 {name:'avatar HEAD',request:name=>({url:url(name).replace('/contact/'+resource,'/contact/'+resource+'/avatar'),method:'HEAD'})},
 {name:'delivery RPC',request:name=>post('/bindle/rpc',{}, {Authorization:'Bearer '+token('bindle-contact-delivery+jwt',{sub:ids[name]})})},
 {name:'conversation identity',request:name=>({url:origin+'/api/conversations/identity/'+ids[name]})},
 ...['invitations','inbox'].map(part=>({name:'conversation '+part,request:name=>post('/api/conversations/'+part+'/'+ids[name],{},{Authorization:'Bearer '+'a'.repeat(43)})})),
 {name:'conversation join',request:name=>post(`/api/conversations/${ids[name]}/${resource}/join`,{envelope:{payload:{id:resource,source:{owner:ids[name],origin}}}})},
 ...['GET','POST'].map(method=>({name:'conversation bearer '+method,request:name=>({url:`${origin}/api/conversations/${ids[name]}/${resource}`,method,...method==='POST'?{body:'{}'}:{},headers:{Authorization:'Bearer '+'a'.repeat(43),'Content-Type':'application/json'}})})),
 {name:'delegation',request:name=>({url:origin+'/identity/'+ids[name]+'/delegations/'+'A'.repeat(43)})},
 {name:'delegation HEAD',request:name=>({url:origin+'/identity/'+ids[name]+'/delegations/'+'A'.repeat(43),method:'HEAD'})},
 {name:'authorization request',request:()=>post('/api/oauth/requests',{identity:'person@unknown.example',clientId:'app'},{Origin:'https://caller.example'})},
];
// Native invalid credentials (`deleted`/`moved` fixtures) and lifecycle-faulted credential subjects must be indistinguishable.
export const credentialCases=cases.filter(name=>!['missing-resource','never'].includes(name));
export const credentialSurfaces=[
 {name:'prepared postback',request:async name=>post('/api/messages/'+resource+'/postbacks',{}, {Origin:origin,Authorization:'Bearer '+await prepared(name)})},
 {name:'brokered introspection',request:name=>({url:origin+'/oauth/brokering/introspect',method:'POST',body:new URLSearchParams({token:token('at+jwt',{iss:origin,sub:origin+'/entities/'+ids[name],bindle:{connection:resource}}),client_assertion_type:CLIENT_ASSERTION_TYPE,client_assertion:'proof'}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'}})},
 {name:'device token',request:()=>({url:origin+'/oauth/token',method:'POST',body:'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&device_code=opaque&client_id=app',headers:{'Content-Type':'application/x-www-form-urlencoded'}})},
 {name:'incremental token',request:()=>({url:origin+'/oauth/token',method:'POST',body:'grant_type=authorization_code&code=ia1.'+'a'.repeat(43)+'&client_id=app',headers:{'Content-Type':'application/x-www-form-urlencoded'}})},
 {name:'app RPC error envelope',request:()=>post('/bindle/rpc',{fixtureNested:true},{Authorization:'Bearer opaque-app-token'})},
 {name:'DPoP RPC error envelope',request:()=>post('/bindle/rpc',{fixtureNested:true},{Authorization:'DPoP opaque-app-token',DPoP:'proof'})},
 {name:'app RPC',request:()=>post('/bindle/rpc',{}, {Authorization:'Bearer opaque-app-token'})},
 {name:'DPoP RPC',request:()=>post('/bindle/rpc',{}, {Authorization:'DPoP opaque-app-token',DPoP:'proof'})},
 {name:'OAuth token',request:()=>post('/oauth/token',{code:'test',clientId:'app'})},
 {name:'object read',request:()=>({url:origin+'/bindle/objects/opaque'})},
 {name:'object write',request:()=>({url:origin+'/bindle/objects/opaque',method:'PUT',body:'unused'})},
 ...['session','state','forget','claim','session/end','events','avatar'].map(part=>({name:'island '+part,request:()=>({url:embed+'/embed/api/'+part+(part==='avatar'?'?s=64':''),method:['events','avatar'].includes(part)?'GET':'POST',...['events','avatar'].includes(part)?{}:{body:JSON.stringify({claim:'opaque'})},headers:{'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'same-origin','Sec-Fetch-Dest':'empty','X-Bindle-Embed':'1',Origin:embed,Authorization:(['session','forget'].includes(part)?'BindleEmbed ':'BindleEmbedSession ')+'opaque',DPoP:'proof','Content-Type':'application/json'}})})),
 {name:'MCP account fence',request:()=>post('/mcp',{},{Authorization:'Bearer 00.'+'b'.repeat(43)})},
 {name:'MCP',request:()=>post('/mcp',{},{Authorization:'Bearer 00.'+'a'.repeat(43)})},
];
export function fixture(name,{invoke}={}){
 const native=(code,message,status)=>async()=>{throw ['missing-resource','never','deleted','moved'].includes(name)?Object.assign(Error(message),{code,status}):fault(name);},federationFail=native('unauthorized','Application authorization is unavailable.',401),deviceFail=native('unauthorized','A DPoP access token is required.',401),mcpFail=native('invalid_token','The connection has expired or was revoked.',401),objectFail=native('unauthorized','Capability is invalid or expired.',401),embedFail=native('unauthorized','Embed credential is invalid.',401),grantFail=native('invalid_grant','invalid_grant',400),deviceToken=async()=>{if(['missing-resource','never','deleted','moved'].includes(name))return {status:400,body:{error:'invalid_grant'}};throw fault(name);},fail=async()=>{throw fault(name);},flags=createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}},env:{LINKS_ENABLED:'true',FEDERATION_ENABLED:'true',MCP_ENABLED:'true',DEVICE_AUTHORIZATION_ENABLED:'true',INCREMENTAL_AUTH_ENABLED:'true'}});
 const env={BROKERED_INTROSPECTION_MOUNTED:true,BROKERING_ENABLED:'true',BROKERED_INTROSPECTION:request=>handleBrokeredIntrospection(request,{issuer:origin,enabled:true,limiter:{admit:()=>true},account:()=>({brokeredIntegrationAuth:fail})}),KEY_ENCRYPTION_KEY:postbackKey,APP_ORIGIN:origin,LOCAL_DEVELOPMENT:'true',flags,ABUSE_HASH_KEY:'fixture-only',ABUSE:{consume:async()=>true},IDENTITY_REPOSITORY:{findByHandle:async()=>['never','deleted','moved'].includes(name)?null:{id:ids[name],status:'active'},get:async id=>id===ids.never?null:{id,handle:'person',status:id===ids.deleted?'deleted':id===ids.moved?'moved':'active'}},ACCOUNTS:{get:id=>({invoke:async call=>invoke?invoke(id,call):{$fault:{code:fault(name).code,status:fault(name).status,message:fault(name).message,retryAfter:99}}})},ASSETS:{fetch:async()=>new Response('<html><head><title>Fixture</title></head><body></body></html>',{headers:{'Content-Type':'text/html'}})},FEDERATION_AUTHORITY:{ready:()=>true,clients:[{id:'app',origin:'https://caller.example'}],beginAuthorization:fail,rpc:(_,input)=>input?.fixtureNested?{error:{code:fault(name).code,status:fault(name).status}}:federationFail(),exchange:federationFail,inspectObjectURL:objectFail,embedSession:embedFail,embedState:embedFail,embedForget:embedFail,redeemClaim:embedFail,embedEnd:embedFail,embedEvents:embedFail,embedAvatar:embedFail},INCREMENTAL_AUTHORIZATION:{mounted:true,exchange:grantFail},DEVICE_GRANT:{mounted:true,rpc:input=>input.envelope?.fixtureNested?{error:{code:fault(name).code,status:fault(name).status}}:deviceFail(),token:deviceToken},EMBED_ORIGIN:embed,FEDERATION_ENTRIES:{embedOrigin:embed},MCP_ENABLED:'true',MCP_AUTHORITY:{verify:token=>token.endsWith('b')?{owner:ids[name],clientId:'app',permissions:[],scopes:[]}:mcpFail()}};
 env.IDENTITY_ENGINE=()=>new Engine({providers:{identity:Provider.fromSingleton({repository:env.IDENTITY_REPOSITORY,requireCurrentTerms:()=>{}})}});
 return {env,fetch:request=>http.fetch(request,env,{})};
}
export async function requestFor(surface,name){const {url,...init}=await surface.request(name);return new Request(url,init);}

export async function snapshot(response){return {status:response.status,body:await response.text(),headers:[...response.headers].filter(([name])=>!['date','content-length','transfer-encoding','connection','keep-alive'].includes(name))};}
export {ids,fault};
