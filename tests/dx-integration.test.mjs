// DX integration over the real Node adapter (apps/node): deletion ports wired independent of the lifecycle, the
// account deletion RPCs and alarm hook, the deletion-due index, MCP and federation erasure, DX-6 email removal route
// and the account channel RPCs. Everything new is behind default-off flags; the flag-off paths are asserted too.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createNodeServer} from '../apps/node/server.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';

const origin='http://localhost:8791',key=randomBytes(32).toString('base64url'),PASSWORD='Integration test long password!';
class Jar{constructor(){this.map=new Map();}apply(response){for(const line of response.headers.getSetCookie()){const [pair,...attributes]=line.split(';'),i=pair.indexOf('='),name=pair.slice(0,i),value=pair.slice(i+1);if(attributes.some(a=>/^\s*Max-Age=0$/i.test(a)))this.map.delete(name);else this.map.set(name,value);}return response;}header(){return [...this.map].map(([k,v])=>k+'='+v).join('; ');}}
async function fixture(t,config={}){
 const directory=await mkdtemp(join(tmpdir(),'bindle-dx-'));const app=await createNodeServer({directory,config:{APP_ORIGIN:origin,SESSION_COOKIE_KEY:key,SIGNUP_IP_DAILY_LIMIT:'50',SIGNUP_SUBNET_DAILY_LIMIT:'50',SIGNUP_REGION_HOURLY_LIMIT:'50',SIGNUP_REGION_DAILY_LIMIT:'50',SIGNUP_GLOBAL_HOURLY_LIMIT:'50',SIGNUP_GLOBAL_DAILY_LIMIT:'200',...config}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});let ip=0;
 const call=(path,{jar,method='GET',value,headers={}}={})=>app.fetch(new Request(origin+path,{method,headers:{...method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'},...jar?{Cookie:jar.header()}:{},'CF-Connecting-IP':'198.51.100.'+(++ip%250),...headers},...value!==undefined?{body:JSON.stringify(value)}:{}}));
 async function signup(jar=new Jar()){const pending=await jar.apply(await call('/api/auth/signup',{jar,method:'POST',value:{method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'}})).json();const recovery=await jar.apply(await call('/api/auth/recovery/download',{jar,method:'POST',value:{pendingToken:pending.pendingToken}})).json();const response=jar.apply(await call('/api/auth/recovery/confirm',{jar,method:'POST',value:{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}}));return {jar,body:await response.json()};}
 const as=session=>({'X-Bindle-Account':session.account.id,'X-Bindle-Session-Context':session.sessionContext,'X-CSRF-Token':session.csrfToken});
 const invoke=(owner,method,args=[])=>app.resources.accounts.get(owner).invoke({method,args:[owner,...args]});
 return {app,directory,call,signup,as,invoke};
}
const request=(owner,stepUpAt,handle)=>[{confirmHandle:handle,acknowledgements:{messages:true,storage:true,names:true,plan:true},operationId:'op-integration-0123456789'},{stepUpAt}];

test('flags off: deletion requests are not found, email removal is unavailable, the lifecycle is untouched',async t=>{
 const f=await fixture(t),{jar,body}=await f.signup(),owner=body.account.id,handle=(await f.app.resources.repository.get(owner)).handle;
 const refused=await f.invoke(owner,'deletionRequest',request(owner,Date.now()-1000,handle));assert.equal(refused.$fault.code,'not_found');
 assert.deepEqual(await f.invoke(owner,'deletionStatus'),{state:'none'});
 const removal=await f.call('/api/auth/email/remove',{jar,method:'POST',value:{confirmed:true},headers:f.as(body)});assert.equal(removal.status,404);assert.equal((await removal.json()).error,'email_removal_unavailable');
 const csrf=await f.call('/api/auth/email/remove',{jar,method:'POST',value:{confirmed:true},headers:{...f.as(body),'X-CSRF-Token':'wrong'}});assert.equal(csrf.status,403);
 const channels=await f.invoke(owner,'accountChannels');assert.equal(channels.owner,owner);assert.equal(channels.ready,false);assert.equal(channels.count,0);
 assert.deepEqual(await f.invoke(owner,'accountSecurityNotice',[{event:'email-removed'}]),{accepted:0});
 assert.equal((await f.call('/api/account',{jar,headers:f.as(body)})).status,200);
});

test('flag on: request over the real controller, due index in the identity directory, alarm hook, cancel; a fenced account answers 410',async t=>{
 const f=await fixture(t,{ACCOUNT_DELETION_ENABLED:'true'}),{jar,body}=await f.signup(),owner=body.account.id,handle=(await f.app.resources.repository.get(owner)).handle;
 const stale=await f.invoke(owner,'deletionRequest',request(owner,Date.now()-300000,handle));assert.equal(stale.$fault.code,'step_up_required');
 const scheduled=await f.invoke(owner,'deletionRequest',request(owner,Date.now()-1000,handle));
 assert.equal(scheduled.state,'scheduled',JSON.stringify(scheduled));assert.equal(scheduled.graceDays,30,'a new account counts as a recent security change (DX-6)');assert.equal(scheduled.billing.pending,false);
 const identities=new SqliteMetadata(join(f.directory,'identities.sqlite'));t.after(()=>identities.close());
 assert.equal((await identities.list({prefix:'deletion-due/'})).size,1);
 // The account alarm runs the deletion step first; before the deadline it only waits, and shelving is refused.
 await f.app.resources.accounts.get(owner).alarm();assert.equal(await f.app.resources.accounts.get(owner).deletionMaintenanceRefused(),true);
 // Checkout and plan changes are refused while scheduled (DX-4 guard).
 assert.equal((await f.invoke(owner,'billingCheckout',['paid',{}])).$fault.code,'deletion_scheduled');
 const cancelled=await f.invoke(owner,'deletionCancel');assert.equal(cancelled.state,'cancelled');
 assert.equal((await identities.list({prefix:'deletion-due/'})).size,0);
 assert.equal((await f.call('/api/account',{jar,headers:f.as(body)})).status,200,'cancelling restores everything');
 // A committed fence answers 410 for every non-purging operation, in lifecycle mode off.
 const metadata=new SqliteMetadata(join(f.directory,'accounts',owner+'.sqlite'));t.after(()=>metadata.close());
 await f.app.resources.accounts.get(owner).metadata.put('deletion/fence-v1',{v:1,owner,requestId:'r',at:Date.now()});
 const fenced=await f.call('/api/account',{jar,headers:f.as(body)});assert.equal(fenced.status,410);assert.equal((await fenced.json()).error,'account_deleting');
});

test('erasure ports: MCP rows on existing shards and the federation shard are erased; absent stores are never created',async t=>{
 const f=await fixture(t,{ACCOUNT_DELETION_ENABLED:'true',LOCAL_DEVELOPMENT:'true'}),{body}=await f.signup(),owner=body.account.id;
 const ports=f.app.resources.accounts.get(owner).config.ACCOUNT_DELETION_PORTS;
 assert.equal(typeof ports.identity.tombstone,'function');assert.equal(ports.erasure.emailBridge,null);assert.equal(ports.erasure.operatorApps,null);
 assert.deepEqual(await ports.erasure.federation.eraseSubject(owner),{deleted:0,absent:true});
 assert.equal(existsSync(join(f.directory,'federation')),true);
 assert.deepEqual(await ports.erasure.mcp.eraseSubject(owner),{deleted:0});
 // Seed one MCP shard with this owner's grant and another owner's grant, then erase.
 const shard=new SqliteMetadata(join(f.directory,'mcp','mcp-auth-v1-64-07.sqlite'));
 await shard.put('mcp/v1/grant/07.a',{id:'07.a',owner});await shard.put('mcp/v1/token/t1',{owner,grantId:'07.a'});await shard.put('mcp/v1/grant/07.b',{id:'07.b',owner:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});await shard.put(`mcp/v1/owner/${owner}`,['07.a']);shard.close();
 assert.deepEqual(await ports.erasure.mcp.eraseSubject(owner),{deleted:2});
 const check=new SqliteMetadata(join(f.directory,'mcp','mcp-auth-v1-64-07.sqlite'));t.after(()=>check.close());
 assert.deepEqual([...(await check.list({prefix:'mcp/v1/'})).keys()],['mcp/v1/grant/07.b']);
});
