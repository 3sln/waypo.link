// DX-5 workerd parity without applying coordinator hunks. Real DO storage, IdentityService.privileged and
// deletion engine operations; mail and push are recording fakes. The landed DX-3 suite covers long alarm purge.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ORIGIN='https://deletion-worker.example';
const source=`
import {DurableObject} from 'cloudflare:workers';
import {stages} from './packages/runtime/routes/deletion.mjs';
import {createDeletionNotices,deletionNoticeTemplate} from './packages/runtime/deletion-notices.mjs';
import {DeletionService,REQUEST_KEY} from './packages/runtime/account-deletion.mjs';
import {createAppEngine,perform,read} from './packages/app/engine.mjs';
import {nullAudit,cryptoRandom,systemClock} from './packages/app/providers.mjs';
import {RequestAccountDeletion,AccountDeletionStatus,CancelAccountDeletion,CancelAccountDeletionByToken} from './packages/app/domains/account-deletion.mjs';
import {IdentityService} from './packages/identity/service.mjs';
import {Engine,Provider} from './vendor/ngin/index.js';
const owner='${OWNER}',origin='${ORIGIN}',token=owner+'.'+'s'.repeat(43),csrf='worker-csrf',handle='n.abc123';
export class DeletionFixture extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.enabled=true;this.killed=false;this.mails=[];this.pushes=[];this.ctx=ctx;this.flags={for:()=>({enabled:()=>this.enabled&&!this.killed,background:()=>!this.killed})};this.record={id:owner,status:'active',handle,sessions:[],credentials:[],verifiedEmail:'owner@worker.example',emailVerifiedAt:Date.now()-86400000,revision:1};
  this.identity=new Engine({providers:{identity:Provider.fromSingleton(new IdentityService({turnstile:{},rateLimiter:{},webauthn:{},passwordHasher:{},repository:{get:async id=>id===owner?this.record:null},config:{origin,rpID:'deletion-worker.example',rpName:'Fixture',termsVersion:'old'},clock:()=>Date.now()}))}});
  const mail={sendDeletionNotice:async value=>{this.mails.push({...value,template:deletionNoticeTemplate(value.notice,{origin})});return {messageId:'fake-mail'};}},push={send:async(subscription,payload)=>{this.pushes.push({subscription,payload});return {accepted:true};}};
  this.notices=createDeletionNotices({origin,flags:this.flags,mail,push});
  this.service=new DeletionService({executor:{metadata:ctx.storage,config:{}},ports:{identity:{get:async()=>this.record},security:async()=>({epoch:1,changedAt:null}),hold:async()=>({held:false}),adminAuthority:async()=>({admin:false}),billing:null,notices:this.notices,due:{put:async()=>{},delete:async()=>{}}},flags:this.flags,clock:systemClock,random:cryptoRandom,wake:async()=>{}});
  this.engine=createAppEngine({providers:{lifecycle:this.service,clock:systemClock,random:cryptoRandom,audit:nullAudit}});
 }
 async fetch(request){
  try{
   await this.ctx.storage.put('owner',owner);const url=new URL(request.url),path=url.pathname;
   if(path==='/test/init'){
    const hash=await this.identity.container.use(['identity'],({identity})=>identity.crypto.hash('session',token));this.record.sessions=[{id:'worker-session-id',hash,csrfToken:csrf,expiresAt:Date.now()+3600000,createdAt:Date.now(),source:'credential',credentialId:'worker-passkey'}];
    await this.ctx.storage.put('push-subscription/'+owner+'/phone',{id:'phone',owner,endpoint:'https://push.example/copied',keys:{p256dh:'key',auth:'auth'}});return Response.json({token,csrf});
   }
   if(path==='/test/step-up'){this.record.sessions[0].stepUpAt=Date.now();return Response.json({ok:true});}
   if(path==='/test/off'){this.enabled=false;return Response.json({ok:true});}
   if(path==='/test/kill'){this.killed=true;return Response.json({ok:true});}
   if(path==='/test/notices')return Response.json({mails:this.mails,pushes:this.pushes});
   const object={deletionRequest:(id,input,evidence)=>perform(this.engine,new RequestAccountDeletion({actor:{kind:'owner',owner:id,...evidence},input})),deletionStatus:id=>read(this.engine,new AccountDeletionStatus({actor:{kind:'owner',owner:id}})),deletionCancel:id=>perform(this.engine,new CancelAccountDeletion({actor:{kind:'owner',owner:id}}))};
   const env={APP_ORIGIN:origin,flags:this.flags,ABUSE_HASH_KEY:'test-only',ABUSE:{consume:async()=>true},ACCOUNTS:{get:id=>({invoke:async call=>{try{if(id!==owner)throw Object.assign(Error('invalid'),{code:'invalid_token',status:400});return await perform(this.engine,new CancelAccountDeletionByToken({actor:{kind:'cancel-link',owner:id},input:call.args[1]}));}catch(error){return {$fault:{code:error.code,message:error.message,status:error.status}};}}})}};
   const context={origin,sessionToken:token,csrfToken:request.headers.get('X-CSRF-Token')},route={request,env,url,path,engine:this.identity,context,id:owner,owner:{csrfToken:csrf},object};
   return await stages.unauthenticated(route)??await stages.beforeActivity(route)??Response.json({error:'not_found'},{status:404});
  }catch(error){return Response.json({error:error.code??'internal_error'},{status:error.status??(error.code==='step_up_required'?401:400)});}
 }
}
export default {fetch:(request,env)=>env.FIXTURE.get(env.FIXTURE.idFromName('dx5')).fetch(request)};
`;
test('workerd deletion routes: real privileged evidence, same-origin/CSRF, snapshot notices and cancel replay match Node',{timeout:30000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'dx5-worker-'));t.after(()=>rm(directory,{recursive:true,force:true}));const outfile=join(directory,'worker.mjs');
 await build({stdin:{contents:source,resolveDir:process.cwd()},outfile,bundle:true,platform:'browser',format:'esm',target:'es2022',external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'dx5-deletion-probe',modulesRoot:directory,modules:[{type:'ESModule',path:outfile}],compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),durableObjects:{FIXTURE:{className:'DeletionFixture',useSQLite:true}}}));t.after(()=>mf.dispose());
 const get=path=>mf.dispatchFetch(ORIGIN+path,{headers:{Origin:ORIGIN}}),post=(path,input,headers={})=>mf.dispatchFetch(ORIGIN+path,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','X-CSRF-Token':'worker-csrf',...headers},body:JSON.stringify(input)}),input={confirmHandle:'@n.abc123',acknowledgements:{messages:true,storage:true,names:true},operationId:'worker-deletion-operation-0001'};
 assert.equal((await get('/test/init')).status,200);
 assert.equal((await post('/api/account/deletion',input)).status,401,'young sign-in is not step-up');await get('/test/step-up');
 assert.equal((await post('/api/account/deletion',input,{Origin:'https://evil.example'})).status,403);assert.equal((await post('/api/account/deletion',input,{'X-CSRF-Token':'bad'})).status,403);
 const result=await post('/api/account/deletion',input);assert.equal(result.status,200,await result.clone().text());assert.equal((await result.json()).notice.accepted,true);
 const notices=await (await get('/test/notices')).json();assert.equal(notices.mails.length,1);assert.equal(notices.pushes.length,1);assert(notices.mails[0].template.text.includes(ORIGIN+notices.pushes[0].payload.path));
 await get('/test/off');assert.equal((await get('/api/account/deletion')).status,200);assert.equal((await post('/api/account/deletion',input)).status,404);
 const value=Object.fromEntries(new URLSearchParams(new URL(notices.pushes[0].payload.path,ORIGIN).hash.slice(1))),cancel=()=>post('/api/account/deletion/cancel-token',value,{'X-Bindle-Cancel':'1'});
 assert.equal((await get('/api/account/deletion/cancel-token')).status,405);assert.equal((await post('/api/account/deletion/cancel-token',value)).status,403);
 const cancelled=await cancel();assert.equal(cancelled.status,200,await cancelled.clone().text());assert.deepEqual(await cancelled.json(),{cancelled:true});assert.equal((await cancel()).status,400);
 // Status follows no flag (§8.1); under an env kill the cancel endpoint refuses instead.
 await get('/test/kill');assert.equal((await get('/api/account/deletion')).status,200);assert.equal((await post('/api/account/deletion/cancel',{})).status,503);
});
