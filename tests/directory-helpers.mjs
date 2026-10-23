import {MemoryMessagingStore} from '../packages/core/records.mjs';
import {IdentityKeyRegistry} from '../packages/identity/keys.mjs';
import {IdentityDirectory} from '../packages/federation/directory.mjs';
import {createAppEngine,perform,read} from '../packages/app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../packages/app/providers.mjs';
import {RefreshDirectoryIdentity,DirectoryKey,directoryHook} from '../packages/app/domains/directory.mjs';
export const issuer='https://home.example',subject='11111111-1111-4111-8111-111111111111',identity=issuer+'/people/stable';
export const manifest={version:'0',issuer,authorization_request_endpoint:issuer+'/requests',authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',rpc_endpoint:issuer+'/rpc',jwks_uri:issuer+'/jwks',preferences_contract:'https://contracts.example/preferences',login_presentation:['redirect'],dpop_signing_alg_values_supported:['ES256'],features:{'directory.v1':{directory_url:issuer+'/directory'}}};
export async function fixture(options={}){
 const keys=new IdentityKeyRegistry({store:new MemoryMessagingStore(),seal:async v=>v,open:async v=>v});await keys.ensure(subject,'signing');
 const state={document:null,calls:[],time:1000000};
 const update=async()=>{state.document={v:1,iss:issuer,sub:subject,kind:'person',keys:(await keys.history(subject,{purpose:'signing'})).map(k=>({kid:k.kid,use:'sig',alg:k.alg,jwk:k.publicJwk,state:k.state,predecessor:k.predecessor,continuity:k.continuity}))};return state.document;};await update();
 const fetch=async(url,init)=>{state.calls.push({url,init});if(options.fetch)return options.fetch(url,init,state);return Response.json(url.endsWith('manifest.json')?manifest:url.includes('?sub=')?{iss:issuer,sub:subject,identity}:state.document,{headers:{'Cache-Control':'max-age=99999'}});};
 const store=options.store??new MemoryMessagingStore(),directory=new IdentityDirectory({store,fetch,enabled:true,issuers:[issuer],clock:()=>state.time,...options}),engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,config:options.config??{DIRECTORY_ENABLED:true},federation:directory}});
 return {keys,state,update,store,directory,engine,hook:directoryHook(engine),refresh:input=>perform(engine,new RefreshDirectoryIdentity({actor:{kind:'system'},input:{issuer,subject,...input}})),resolve:input=>read(engine,new DirectoryKey({input:{issuer,subject,kid:state.document.keys.find(k=>k.state==='active').kid,...input}}))};
}
