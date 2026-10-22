// DX-5: real Chromium, shipped ngin assets, and the bundled route (as Workers execute it). No mail or push I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',TOKEN='a'.repeat(43),ROOT=resolve('.output/public');
let browser,server,origin,stages,mode='ok',calls=[],release,arrival;
test.before(async()=>{
 const bundle=await build({stdin:{contents:"export {stages} from './packages/runtime/routes/deletion.mjs';",resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',external:['node:*'],logLevel:'silent',minify:true,keepNames:true});({stages}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64')));
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,origin),headers=new Headers(req.headers),request=new Request(url,{method:req.method,headers});
  let response;if(url.pathname==='/api/account/deletion/cancel-token'){
   let raw='';for await(const chunk of req)raw+=chunk;calls.push({body:JSON.parse(raw),cookie:req.headers.cookie,origin:req.headers.origin,proof:req.headers['x-bindle-cancel'],url:req.url});arrival?.();
   if(mode==='pending')await new Promise(resolve=>{release=resolve;});response=mode==='invalid'?new Response('{"error":"invalid_token"}',{status:400}):mode==='outage'?new Response('{"error":"unavailable"}',{status:503}):new Response('{"cancelled":true}',{headers:{'Content-Type':'application/json'}});
  }else{
   const env={APP_ORIGIN:origin,flags:{for:()=>({background:()=>true})},ASSETS:{fetch:async value=>new Response(await readFile(resolve(ROOT,'.'+new URL(value.url).pathname)),{headers:{'Content-Type':'application/json'}})}};
   response=await stages.public({request,env,url,path:url.pathname});
   if(!response){const file=resolve(ROOT,'.'+url.pathname);if(!file.startsWith(ROOT+'/'))throw Error('outside assets');response=new Response(await readFile(file),{headers:{'Content-Type':extname(file)==='.js'||extname(file)==='.mjs'?'text/javascript':'application/octet-stream'}});}
  }
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500);res.end('fixture failed');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});
});
test.after(async()=>{release?.();await browser?.close();await new Promise(resolve=>server?.close(resolve));});
for(const locale of ['en','es'])for(const width of [320,1440])test(`cancel page ${locale} ${width}: fragment removed, no scanner side effect, keyboard confirmation and no cookie authority`,async()=>{
 mode='ok';calls=[];const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
 try{
  await page.context().addCookies([{name:'session-canary',value:'do-not-send',url:origin}]);await page.goto(origin+'/account/deletion/cancel?lang='+locale+'#owner='+OWNER+'&token='+TOKEN);
  const button=page.getByRole('button');await button.waitFor();await page.waitForFunction(()=>!document.querySelector('button').disabled);assert.equal(new URL(page.url()).hash,'');assert.equal(calls.length,0);assert.equal(await page.locator('html').getAttribute('lang'),locale);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert(requests.every(url=>!url.includes(TOKEN)));
  await button.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.length>0);
  assert.match(await page.getByRole('status').textContent(),locale==='es'?/Eliminación cancelada/:/Deletion cancelled/);assert.deepEqual(calls,[{body:{owner:OWNER,token:TOKEN},cookie:undefined,origin,proof:'1',url:'/api/account/deletion/cancel-token'}]);assert.equal(await button.isDisabled(),true);assert.equal(await page.evaluate(()=>sessionStorage.length+localStorage.length),0);assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
test('cancel page: invalid fragments remain inert, including markup and duplicate token fields',async()=>{
 for(const fragment of ['',`owner=${OWNER}&token=short`,`owner=${OWNER}&token=${TOKEN}&token=${TOKEN}`,`owner=${OWNER}&token=${TOKEN}&redirect=https://evil.example`,`owner=%3Cimg%20src=x%20onerror=alert(1)%3E&token=${TOKEN}`]){
  calls=[];const page=await browser.newPage();try{await page.goto(origin+'/account/deletion/cancel#'+fragment);await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.length>0);assert.equal(await page.getByRole('button').isDisabled(),true);assert.equal(new URL(page.url()).hash,'');assert.equal(calls.length,0);assert.equal(await page.locator('img').count(),0);}finally{await page.close();}
 }
});
test('cancel page: double submit dispatches once; a failed request allows an explicit retry',async()=>{
 mode='pending';calls=[];const arrived=new Promise(resolve=>{arrival=resolve;}),page=await browser.newPage();try{
  await page.goto(origin+'/account/deletion/cancel#owner='+OWNER+'&token='+TOKEN);await page.waitForFunction(()=>!document.querySelector('button').disabled);await page.evaluate(()=>{document.querySelector('form').requestSubmit();document.querySelector('form').requestSubmit();});
  await arrived;arrival=null;assert.equal(calls.length,1);assert.equal(await page.getByRole('button').isDisabled(),true);
  mode='outage';release();release=null;await page.waitForFunction(()=>!document.querySelector('button').disabled);assert.match(await page.getByRole('status').textContent(),/could not confirm/);assert.equal(calls.length,1);
  mode='ok';await page.getByRole('button').click();await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('Deletion cancelled'));assert.equal(calls.length,2);
 }finally{release?.();release=null;await page.close();}
});
