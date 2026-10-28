import test from 'node:test';
import assert from 'node:assert/strict';
import application from '../packages/runtime/http.mjs';
const origin='https://bindle.example';
function fixture(){
 const calls=[];
 const env={APP_ORIGIN:origin,LOCAL_DEVELOPMENT:'false',ASSETS:{fetch:async request=>{
  const url=new URL(request.url);calls.push({path:url.pathname,search:url.search,method:request.method});
  const marker=url.pathname==='/'?'STATIC EN':url.pathname==='/index.es.html'?'STATIC ES':url.pathname==='/console.html'?'CONSOLE':url.pathname==='/authorize.html'?'AUTHORIZE':'MISSING';
  return new Response(request.method==='HEAD'?null:'<!doctype html><title>'+marker+'</title>',{status:marker==='MISSING'?404:200,headers:{'Content-Type':'text/html'}});
 }},IDENTITY_ENGINE:()=>{throw new Error('Static navigation must not access identity');},IDENTITY_REPOSITORY:{get:()=>{throw new Error('Static navigation must not load accounts');}}};
 return {calls,env,get:(path,options={})=>application.fetch(new Request(origin+path,options),env)};
}
test('root serves public static language documents with no account lookup or query passed to assets',async()=>{
 const f=fixture();for(const [url,marker,lang]of [['/','STATIC EN','en'],['/?campaign=one','STATIC EN','en'],['/?lang=es','STATIC ES','es'],['/?lang=es&lang=en','STATIC EN','en'],['/?lang=unknown','STATIC EN','en']]){
  const response=await f.get(url,{headers:{Cookie:'__Host-bindle_session=anything'}});assert.equal(response.status,200);assert.match(await response.text(),new RegExp(marker));assert.equal(response.headers.get('Content-Language'),lang);assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Cache-Control'),'public, max-age=0, must-revalidate');
 }assert(f.calls.every(call=>call.search===''));
 const head=await f.get('/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('legacy root auth redirects preserve exact query without interpreting arbitrary return targets',async()=>{
 const f=fixture();for(const query of ['?signin','?signup=1&lang=es','?signin=&signin=1','?return_to=https%3A%2F%2Fevil.example%2F','?return_to=%2Foauth%2Fauthorize%3Frequest_id%3Done&return_to=other'])for(const method of ['GET','HEAD']){
  const response=await f.get('/'+query,{method});assert.equal(response.status,307);assert.equal(response.headers.get('Location'),'/console'+query);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(await response.text(),'');
 }assert.equal(f.calls.length,0);
});
test('console route selects SPA without query leakage and canonicalizes only exact trailing slash',async()=>{
 const f=fixture();const page=await f.get('/console?signin&return_to=%2Fpreferences');assert.match(await page.text(),/CONSOLE/);assert.equal(page.headers.get('Cache-Control'),'no-store');assert.deepEqual(f.calls,[{path:'/console.html',search:'',method:'GET'}]);
 const redirect=await f.get('/console/?signup&lang=es');assert.equal(redirect.status,307);assert.equal(redirect.headers.get('Location'),'/console?signup&lang=es');
 assert.equal((await f.get('/consolex')).status,404);assert.equal((await f.get('/console',{method:'POST'})).status,405);
 const head=await f.get('/console',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('public auth continuations retain URL and load console while recovery remains isolated',async()=>{
 const f=fixture();for(const path of ['/device','/device/approve','/email/confirm','/email/login','/unsubscribe','/mcp/consent','/integrations/google/complete','/users/alice/message','/recovery/setup','/recovery/restore']){
  const response=await f.get(path+'?token=private');assert.equal(response.status,200);assert.equal(response.headers.get('Location'),null);assert.match(await response.text(),/CONSOLE/);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(f.calls.at(-1).search,'');
  if(path.startsWith('/recovery/')){assert.match(response.headers.get('Content-Security-Policy'),/frame-src 'none'/);assert(!response.headers.get('Content-Security-Policy').includes('challenges.cloudflare.com'));}
 }
 const prefs=await f.get('/preferences');assert.match(await prefs.text(),/AUTHORIZE/);
});
test('former contact-link paths are not special (contacts phase 4): no preview page, no contact CORS, no lookup, no query to assets',async()=>{
 const f=fixture(),path='/users/alice/contact/12345678-1234-1234-1234-123456789abc?bindle_meta=a.b.c',control='/users/alice/not-a-route/12345678-1234-1234-1234-123456789abc?bindle_meta=a.b.c';
 for(const accept of ['text/html','application/vnd.bindle.contact-token+jwt','application/vnd.bindle.contact-profile+json','application/vnd.bindle.messaging.ingress+json']){
  const response=await f.get(path,{headers:{Accept:accept}}),expected=await f.get(control,{headers:{Accept:accept}});
  assert.equal(response.status,expected.status,accept);assert.equal(response.headers.get('Content-Type'),expected.headers.get('Content-Type'),accept);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),null,accept);const text=await response.text();assert.doesNotMatch(text,/Send a private message|og:|oembed/i,accept);
 }
 const options=await f.get(path,{method:'OPTIONS'});assert.notEqual(options.status,204,'no contact-link preflight');
 assert.ok(f.calls.every(call=>call.search===''),'no capability query reaches assets');
});

test('durable Node host serves separate landing/console files through the shared router',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {createNodeServer}=await import('../apps/node/server.mjs');
 const directory=await mkdtemp(join(tmpdir(),'bindle-route-assets-')),previous=process.cwd();let app;
 try{
  await mkdir(join(directory,'.output/public'),{recursive:true});
  for(const [name,marker]of [['index.html','STATIC EN'],['index.es.html','STATIC ES'],['console.html','CONSOLE']])await writeFile(join(directory,'.output/public',name),'<!doctype html><title>'+marker+'</title>');
  process.chdir(directory);app=await createNodeServer({directory:join(directory,'state')});
  for(const [path,marker]of [['/','STATIC EN'],['/?lang=es','STATIC ES'],['/console','CONSOLE'],['/device','CONSOLE'],['/recovery/setup','CONSOLE']]){const response=await app.fetch(new Request('http://localhost:8788'+path));assert.equal(response.status,200);assert.match(await response.text(),new RegExp(marker));}
  const head=await app.fetch(new Request('http://localhost:8788/console',{method:'HEAD'}));assert.equal(await head.text(),'');
  const legacy=await app.fetch(new Request('http://localhost:8788/?signup'));assert.equal(legacy.status,307);assert.equal(legacy.headers.get('Location'),'/console?signup');
 }finally{await app?.close();process.chdir(previous);await rm(directory,{recursive:true,force:true});}
});

test('static host branding replaces the marked picture logo with escaped text only',async()=>{
 const f=fixture();f.env.BRAND_NAME='A & <host> "brand" $&';f.env.ASSETS.fetch=async()=>new Response('<!doctype html><title>3sln.me · Welcome</title><a class="logo" href="/" data-bindle-brand-logo><picture><source srcset="/branding/dark.svg"><img src="/branding/light.svg"></picture><span>.me</span></a><a href="/console?signup">Create an account</a>',{headers:{'Content-Type':'text/html'}});
 const response=await f.get('/');const html=await response.text();assert.equal(response.status,200);assert.match(html,/<a class="logo" href="\/" data-bindle-brand-logo><span>A &amp; &lt;host> &quot;brand&quot; \$&amp;<\/span><\/a>/);assert(html.includes('<title>A &amp; &lt;host> &quot;brand&quot; $&amp;</title>'));assert(!html.includes('<picture>'));assert(!html.includes('<host>'));assert.match(html,/href="\/console\?signup">Create an account/);assert.equal(response.headers.get('Cache-Control'),'public, max-age=0, must-revalidate');
});
