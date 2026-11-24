// Local merchant interception only. Initial operator setup is trusted; the
// tested owner, session, OAuth grant, financial backing and policy are genuine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {discoverServiceCapabilities} from '@3sln/waypo/sdk/discovery';
import {createBlobTransfers} from '@3sln/waypo/sdk/blob-transfers';
import {createLogStorage,createLogOperationId} from '@3sln/waypo/sdk/logs';
import {createPolar} from '@polar-sh/sdk/2026-10';
import {createNodeApplication} from '@3sln/waypo/node';
import {provisionNodeInstallation,openNodeSqliteStore} from '@3sln/waypo/adapters/node/sqlite';
import {initializeNodeWorkPeriodBudget} from '@3sln/waypo/adapters/node/work-period-provision';
import {createWaypoLinkNodeApplication} from '../node.mjs';
import {provisionNodeFinancialAuthority} from '../financial-provision-node.mjs';
import {POLAR_REVIEWED_TERMINAL_CONTRACT} from '../polar-financial-authority.mjs';
import {financialOperatorFixtureConfiguration} from './financial-provision.fixture.mjs';
import {createFixtureAuthority,seedInitializedFixture} from './native-capacity.fixture.mjs';
import {freeCreationRate} from './free-rate.fixture.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function merchantFixture(t){
 const state={calls:[],creates:0,checkout:null,customer:null,subscription:null,orders:new Map(),hold:null,started:null};
 const server=createServer(async(request,response)=>{
  try{
   const chunks=[];for await(const chunk of request)chunks.push(chunk);
   const path=new URL(request.url,'http://localhost').pathname,input=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
   state.calls.push({method:request.method,path});let value;
   if(request.method==='GET'&&['/v1/customers/','/v1/checkouts/','/v1/subscriptions/','/v1/orders/'].includes(path)){
    const items=path==='/v1/orders/'?[...state.orders.values()]:[];value={items,pagination:{total_count:items.length,max_page:items.length?1:0}};
   }else if(request.method==='POST'&&path==='/v1/checkouts/'){
    state.creates++;value=state.checkout={id:'checkout',url:'https://sandbox.polar.sh/c/checkout',external_customer_id:input.external_customer_id,organization_id:'org',product_id:'product',product_price_id:'price',expires_at:new Date(Date.now()+3600000).toISOString(),status:'open',metadata:input.metadata,currency:'usd',amount:1000,net_amount:1000,total_amount:1000,discount_amount:0,tax_amount:0,allow_trial:input.allow_trial,trial_interval:null,trial_interval_count:null,active_trial_interval:null,active_trial_interval_count:null,trial_end:null};
   }else if(request.method==='GET'&&path==='/v1/checkouts/checkout')value=state.checkout;
   else if(request.method==='GET'&&/^\/v1\/customers\/external\/.+\/state$/.test(path)){
    state.started?.resolve();if(state.hold)await state.hold.promise;value=state.customer;
   }else if(path==='/v1/subscriptions/subscription'){
    if(request.method==='PATCH')state.subscription={...state.subscription,...input};value=state.subscription;
   }else if(request.method==='GET'&&path.startsWith('/v1/orders/'))value=state.orders.get(path.split('/').at(-1));
   response.writeHead(value?200:404,{'Content-Type':'application/json'});response.end(JSON.stringify(value??{}));
  }catch{response.writeHead(500,{'Content-Type':'application/json'});response.end('{}');}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{state.hold?.resolve();server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
 const sdk=createPolar({accessToken:'local-fixture-not-a-merchant-secret',environment:'sandbox',organizationId:'org',baseUrl:'http://127.0.0.1:'+server.address().port,timeout:5});
 function pay(){
  const external=state.checkout.external_customer_id,start=Date.now()-86400000,end=start+365*86400000;
  state.checkout={...state.checkout,status:'succeeded',customer_id:'customer'};
  state.customer={id:'customer',external_id:external,organization_id:'org',deleted_at:null,active_subscriptions:[{id:'subscription',product_id:'product'}]};
  state.subscription={id:'subscription',customer_id:'customer',customer:{id:'customer',external_id:external},product_id:'product',product:{id:'product',organization_id:'org'},checkout_id:'checkout',status:'active',currency:'usd',amount:1000,recurring_interval:'year',recurring_interval_count:1,cancel_at_period_end:false,current_period_start:new Date(start).toISOString(),current_period_end:new Date(end).toISOString()};
  state.orders.set('order',{id:'order',customer_id:'customer',customer:{id:'customer',external_id:external},product_id:'product',product:{id:'product',organization_id:'org'},subscription_id:'subscription',checkout_id:'checkout',currency:'usd',status:'paid',paid:true,subtotal_amount:1000,net_amount:1000,discount_amount:0,refunded_amount:0,refunded_tax_amount:0,tax_amount:0,total_amount:1000,created_at:new Date(start).toISOString(),items:[{product_price_id:'price',proration:false,start_timestamp:new Date(start).toISOString(),end_timestamp:new Date(end).toISOString()}]});return{end};
 }
 return{state,sdk,pay};
}

test('actual Native owner signup and OAuth session drive provisioned paid admission, canonical quota and retained cancellation',{timeout:90000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'waypo-native-paid-')),database=join(directory,'metadata.sqlite'),mail=join(directory,'mail.jsonl');
 let app,browser;const merchant=await merchantFixture(t),jar=new Map();
 const clientId='https://paid-app.example/client.json',redirect='https://paid-app.example/callback';
 const metadata=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'public,max-age=300'});response.end(JSON.stringify({client_id:clientId,client_name:'Native paid fixture application',redirect_uris:[redirect],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none'}));});
 metadata.listen(0,'127.0.0.1');await once(metadata,'listening');
 const key=join(directory,'fixture-key.pem'),cert=join(directory,'fixture-cert.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
 const http=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},async(incoming,outgoing)=>{try{const parts=[];for await(const chunk of incoming)parts.push(chunk);const result=await app.handle(new Request(origin+incoming.url,{method:incoming.method,headers:incoming.headers,...['GET','HEAD'].includes(incoming.method)?{}:{body:Buffer.concat(parts)}}));const headers=Object.fromEntries([...result.headers].filter(([name])=>name!=='set-cookie'));if(result.headers.getSetCookie().length)headers['Set-Cookie']=result.headers.getSetCookie();outgoing.writeHead(result.status,headers);outgoing.end(Buffer.from(await result.arrayBuffer()));}catch{outgoing.writeHead(500);outgoing.end();}});
 http.listen(0,'127.0.0.1');await once(http,'listening');
 const origin='https://localhost:'+http.address().port,issuer=origin+'/api/auth',configuration={...financialOperatorFixtureConfiguration(database),issuer,adminUrl:origin+'/admin/'};
 const provider={...configuration,localMail:true,localMailFile:mail,emailHuman:{required:false},localClientMetadata:[{clientId,url:'http://localhost:'+metadata.address().port+'/client.json'}],accountAdmission:{revision:1,maxPublicAccounts:16,maxProtectedAccounts:4,acceptingNewAccounts:true},accountCreationRate:freeCreationRate(),services:{...configuration.services,storageCapacity:{...configuration.services.storageCapacity,maxAccounts:4,fleetPhysicalBytes:256001310720,fleetRows:4000156}}};
 // Cleanup order is deliberate: held vendor work must resolve before app close.
 t.after(async()=>{merchant.state.hold?.resolve();await browser?.close();http.closeAllConnections();await new Promise((resolve,reject)=>http.close(error=>error?reject(error):resolve()));await app?.close();metadata.closeAllConnections();await new Promise((resolve,reject)=>metadata.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});});
 await provisionNodeInstallation({filename:database,installationId:provider.installationId});
 await initializeNodeWorkPeriodBudget({database,installationId:provider.installationId,issuer,allowInsecureLoopback:true,services:provider.services});
 app=await createNodeApplication(provider);await createFixtureAuthority(app);
 const initial=openNodeSqliteStore({filename:database});try{await initial.transaction(tx=>seedInitializedFixture(tx,issuer));}finally{await initial.close();}
 await app.close();app=null;
 const provisioned=await provisionNodeFinancialAuthority({configuration:provider,merchant:{environment:'sandbox',organizationId:'org',productId:'product',basePriceId:'price',revision:'2026-10',vendorContract:POLAR_REVIEWED_TERMINAL_CONTRACT},accessToken:'local-fixture-not-a-merchant-secret'},{sdk:merchant.sdk});
 assert.equal(provisioned.paidPlansEnabled,false);assert.equal(merchant.state.calls.length,4);assert.equal(merchant.state.creates,0);
 const settings={environment:'sandbox',organizationId:'org',productId:'product',basePriceId:'price',webhookSecret:'whsec_'+Buffer.from('native-paid-local-fixture').toString('base64'),accessToken:'local-fixture-not-a-merchant-secret',paidPlansEnabled:true,subscriptionServicingEnabled:true,enableActions:true,enableCancellation:true,enableTrial:false,financialAdmission:provisioned.financialAdmission,sdk:merchant.sdk,allowedSignupCountries:['US']};
 const start=async next=>{app=await createWaypoLinkNodeApplication({...provider,admission:'public'},{...settings,...next},{resolveSignupCountry:()=> 'US'});};
 await start();assert.equal(merchant.state.calls.length,4,'startup performs no merchant reads');
 async function request(path,{body,form,bearer,cookies=true,originHeader=origin,expectedUser}={}){
  const headers=new Headers();if(cookies)headers.set('Cookie',[...jar].map(([key,value])=>key+'='+value).join('; '));
  if(body!==undefined){headers.set('Content-Type','application/json');headers.set('Origin',originHeader);}if(form)headers.set('Content-Type','application/x-www-form-urlencoded');if(bearer)headers.set('Authorization','Bearer '+bearer);if(expectedUser)headers.set('X-Waypo-Expected-User',expectedUser);
  const response=await app.handle(new Request(origin+path,{method:body!==undefined||form?'POST':'GET',headers,...body!==undefined?{body:JSON.stringify(body)}:form?{body:new URLSearchParams(form)}:{}}));
  if(cookies)for(const item of response.headers.getSetCookie()){const [key,...parts]=item.split(';')[0].split('=');jar.set(key,parts.join('='));}return response;
 }
 assert.equal((await request('/api/waypo/email/start',{body:{email:'paid-owner@example.test'}})).status,200);
 const message=JSON.parse((await readFile(mail,'utf8')).trim().split('\n').at(-1));
 assert.equal((await request('/api/waypo/email/approve',{body:Object.fromEntries(new URLSearchParams(new URL(message.url).hash.slice(1)))})).status,200);
 const session=await(await request('/api/auth/get-session')).json();assert.equal(session.user.email,'paid-owner@example.test');assert.ok(session.session.id);assert.notEqual(session.user.id,'fixture-bootstrap-authority');
 const policy=async()=>{const response=await request('/api/waypo/account-policy');assert.equal(response.status,200);return response.json();};
 assert.equal((await policy()).state.storageBytes,500000000);
 const discovery=await request('/api/auth/.well-known/openid-configuration');assert.equal(discovery.status,200);
 const verifier=randomBytes(32).toString('base64url'),query=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:'openid blobs:read blobs:write logs:read logs:write',state:randomBytes(32).toString('base64url'),nonce:randomBytes(32).toString('base64url'),code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
 const authorization=await request('/api/auth/oauth2/authorize?'+query);assert.equal(authorization.status,302);let location=new URL(authorization.headers.get('location'),origin);
 if(location.pathname==='/consent'){const consent=await request('/api/auth/oauth2/consent',{body:{accept:true,oauth_query:location.search.slice(1)}});assert.equal(consent.status,200);const value=await consent.json();location=new URL(value.redirect_uri??value.url);}
 assert.equal(location.origin,new URL(redirect).origin);
 const exchange=await request('/api/auth/oauth2/token',{cookies:false,form:{grant_type:'authorization_code',client_id:clientId,redirect_uri:redirect,code_verifier:verifier,code:location.searchParams.get('code')}});assert.equal(exchange.status,200);const tokens=await exchange.json();assert.ok(tokens.id_token);assert.ok(tokens.access_token);
 const identity=await request('/api/auth/oauth2/userinfo',{cookies:false,bearer:tokens.access_token});assert.equal(identity.status,200);const pairwise=await identity.json();assert.ok(pairwise.sub);assert.notEqual(pairwise.sub,session.user.id);
 const billing=async(operation,body)=>request('/api/hosted/billing/'+operation,{body,expectedUser:session.user.id});
 const before=await(await billing('status')).json();assert.equal(before.portalEnabled,false);assert.equal(before.actionsEnabled,true);
 const checkout=await billing('checkout',{intent:'annual'});assert.equal(checkout.status,200);assert.deepEqual(await checkout.json(),{url:'https://sandbox.polar.sh/c/checkout'});assert.equal(merchant.state.creates,1);
 assert.notEqual((await billing('checkout',{intent:'annual'})).status,200);assert.equal(merchant.state.creates,1);
 assert.equal((await request('/api/hosted/billing/checkout',{cookies:false,body:{intent:'annual'}})).status,401);
 assert.equal((await request('/api/hosted/billing/checkout',{body:{intent:'annual'},originHeader:'https://foreign.example',expectedUser:session.user.id})).status,403);
 assert.notEqual((await request('/api/hosted/billing/checkout',{body:{intent:'annual'},expectedUser:'foreign-owner'})).status,200);assert.equal(merchant.state.creates,1);
 const paid=merchant.pay(),order=merchant.state.orders.get('order');merchant.state.orders.set('order',{...order,currency:'eur'});
 assert.notEqual((await billing('refresh',{})).status,200);assert.equal((await policy()).state.storageBytes,500000000);
 merchant.state.orders.set('order',order);const refreshed=await billing('refresh',{});assert.equal(refreshed.status,200);assert.equal((await policy()).state.storageBytes,10000000000);
 const verified=await(await billing('status')).json();assert.equal(verified.paidThrough,paid.end);assert.equal(verified.portalEnabled,false);assert.equal(merchant.state.creates,1);
 assert.equal((await billing('refresh',{})).status,200);assert.equal((await policy()).state.storageBytes,10000000000);
 const fetchResource=(url,options={})=>{const headers=new Headers(options.headers);headers.set('Authorization','Bearer '+tokens.access_token);return app.handle(new Request(url,{...options,headers}));};
 const capabilities=await discoverServiceCapabilities({issuer,metadata:await discovery.json(),allowInsecureLoopback:true});
 const transfers=createBlobTransfers({issuer,streaming:capabilities.features.blobs.transfers,fetchResource,allowInsecureLoopback:true}),content=new TextEncoder().encode('Genuine Native application resource after funded policy');
 const uploaded=await transfers.uploadBlob(new Blob([content]),{key:'native-paid-file',requestId:randomBytes(16).toString('hex'),retryDeadlineMs:20000});
 const download=await transfers.getResumableStream('native-paid-file',{ifVersion:uploaded.version});assert.deepEqual(new Uint8Array(await new Response(download.stream).arrayBuffer()),content);
 const logs=createLogStorage({issuer,capabilities,fetchResource,allowInsecureLoopback:true}),log=await logs.create('native-paid-events'),appended=await logs.append('native-paid-events',content,{operationId:createLogOperationId(),expectedHead:log.head}),page=await logs.read('native-paid-events',{after:log.origin});
 assert.equal(page.entries.length,1);assert.equal(page.entries[0].cursor,appended.cursor);assert.deepEqual(page.entries[0].bytes,content);
 const backing=openNodeSqliteStore({filename:database});let allocation;
 try{allocation=await backing.transaction(async tx=>{const marker=await tx.get('bootstrap/installation'),accountId=createHash('sha256').update(JSON.stringify([issuer,session.user.id])).digest('base64url');return tx.get('storage-capacity/v1/'+marker.storageCapacity.scope+'/account/'+accountId);});}finally{await backing.close();}
 assert.match(allocation.allocationId,/^[a-f0-9]{32}$/);assert.deepEqual(allocation.sources['financial-metadata'],{bytes:524288,rows:64});assert.ok(allocation.bytes>=524288+264192);assert.ok(allocation.rows>=64+2);
 // Headless UI uses the genuine owner cookies and real request handlers.
 const require=createRequire(import.meta.url),playwrightPath=require.resolve('playwright',{paths:[fileURLToPath(new URL('.',import.meta.resolve('@3sln/waypo/node')))]}),{chromium}=require(playwrightPath);
 browser=await chromium.launch({headless:true});const context=await browser.newContext({ignoreHTTPSErrors:true});await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await context.addCookies([...jar].map(([name,value])=>({name,value,url:origin,httpOnly:true,secure:true,sameSite:'Lax'})));const ui=await context.newPage();await ui.goto(origin+'/account/billing');await ui.getByText('Status: active (sandbox; no live billing)',{exact:true}).waitFor();assert.equal(await ui.locator('#portal').isVisible(),false);assert.equal(await ui.locator('#cancel').isEnabled(),true);assert.equal(await ui.locator('#checkout').isDisabled(),true);
 for(const [name,width,height]of[['desktop',1365,900],['mobile',390,844]]){await ui.setViewportSize({width,height});assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);if(process.env.E2E_SNAPSHOTS==='true'){const output=process.env.E2E_SNAPSHOT_DIR??join(process.cwd(),'.artifacts/native-paid');await mkdir(output,{recursive:true});await ui.screenshot({path:join(output,name+'.png'),fullPage:true});}}
 await context.clearCookies();await ui.evaluate(()=>window.dispatchEvent(new Event('focus')));await ui.getByText('Sign in again to view billing.',{exact:true}).waitFor();assert.equal(await ui.locator('#portal').isVisible(),false);assert.equal(await ui.locator('#checkout').isDisabled(),true);assert.equal(await ui.locator('#details').textContent(),'');
 await browser.close();browser=null;
 // Revoke the actual Native SID while a canonical GET is pending. Financial
 // evidence may complete for its original account, but disclosure must refuse.
 merchant.state.started=deferred();merchant.state.hold=deferred();const pending=billing('refresh',{});await merchant.state.started.promise;assert.equal((await request('/api/auth/sign-out',{body:{}})).status,200);merchant.state.hold.resolve();assert.notEqual((await pending).status,200);merchant.state.hold=null;merchant.state.started=null;
 assert.equal((await request('/api/waypo/email/start',{body:{email:'paid-owner@example.test'}})).status,200);const again=JSON.parse((await readFile(mail,'utf8')).trim().split('\n').at(-1));assert.equal((await request('/api/waypo/email/approve',{body:Object.fromEntries(new URLSearchParams(new URL(again.url).hash.slice(1)))})).status,200);assert.equal((await(await request('/api/auth/get-session')).json()).user.id,session.user.id);
 // The original app token remains valid after the policy transition.
 assert.equal((await request('/api/auth/oauth2/userinfo',{cookies:false,bearer:tokens.access_token})).status,200);
 await app.close();app=null;await start({paidPlansEnabled:false,enableActions:false});
 const retained=await(await billing('status')).json();assert.equal(retained.actionsEnabled,false);assert.equal(retained.portalEnabled,false);assert.equal(retained.cancellationEnabled,true);assert.equal(retained.paidThrough,paid.end);
 browser=await chromium.launch({headless:true});const retainedContext=await browser.newContext({ignoreHTTPSErrors:true});await retainedContext.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await retainedContext.addCookies([...jar].map(([name,value])=>({name,value,url:origin,httpOnly:true,secure:true,sameSite:'Lax'})));const retainedPage=await retainedContext.newPage();await retainedPage.goto(origin+'/account/billing');await retainedPage.getByText('Status: active (sandbox; no live billing)',{exact:true}).waitFor();assert.equal(await retainedPage.locator('#portal').isVisible(),false);assert.equal(await retainedPage.locator('#checkout').isDisabled(),true);retainedPage.on('dialog',dialog=>dialog.accept());await retainedPage.locator('#cancel').click();await retainedPage.getByRole('button',{name:'Future renewal is canceled',exact:true}).waitFor();assert.equal(await retainedPage.locator('#cancel').isDisabled(),true);
 assert.equal(merchant.state.subscription.cancel_at_period_end,true);assert.equal((await policy()).state.storageBytes,10000000000);assert.equal(merchant.state.creates,1);
 assert.equal(merchant.state.calls.filter(call=>call.method==='POST').length,1,'one real checkout wire POST, never a portal or checkout replay');
 t.diagnostic(JSON.stringify({scope:'real-native-email-oidc-policy;local-merchant-only',wirePost:merchant.state.creates,merchantGets:merchant.state.calls.filter(call=>call.method==='GET').length,capacityWorkloadBytes:0}));
});
