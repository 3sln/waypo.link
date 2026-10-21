import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {buildLegalPages} from '../../apps/web/legal-page.mjs';
import {launch} from '../e2e/browser.mjs';

let out,server,browser,origin;const artifacts=resolve('artifacts/browser/legal-pages');
test.before(async()=>{
 out=await mkdtemp(join(tmpdir(),'3sln-legal-browser-'));await mkdir(artifacts,{recursive:true});await buildLegalPages({out,css:'/site.css'});await writeFile(join(out,'site.css'),await readFile('apps/web/styles.css'));
 server=createServer(async(request,response)=>{try{
  const url=new URL(request.url,'http://127.0.0.1'),path=url.pathname;let file;
  if(['/privacy','/terms'].includes(path))file=join(out,path.slice(1)+(url.searchParams.get('lang')==='es'?'.es':'')+'.html');
  else if(/^\/assets\/legal\.[a-f0-9]+\.css$/.test(path)||path==='/site.css')file=join(out,path.slice(1));
  else if(['/branding/3sln-lockup.svg','/branding/3sln-lockup-ondark.svg','/icon.svg'].includes(path))file=join('apps/web',path.slice(1));
  else{response.writeHead(404);response.end();return;}
  response.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'image/svg+xml');response.end(await readFile(file));
 }catch(error){response.writeHead(500);response.end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;browser=await launch();
});
test.after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(out)await rm(out,{recursive:true,force:true});});
for(const name of ['privacy','terms'])for(const locale of ['en','es'])for(const colorScheme of ['light','dark'])for(const width of [320,390,1440])test(`${name}: ${locale} ${colorScheme} ${width}px works without JavaScript`,async()=>{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width,height:900},colorScheme});try{
  const page=await context.newPage(),requests=[];page.on('request',request=>requests.push(request));const response=await page.goto(`${origin}/${name}?lang=${locale}`);assert.equal(response.status(),200);assert.equal(await page.locator('html').getAttribute('lang'),locale);assert.equal(await page.locator('article').getAttribute('lang'),'en');await page.getByRole('heading',{name:name==='privacy'?'3sln.me Privacy Policy':'3sln.me Terms of Service',exact:true}).waitFor();await page.getByRole('note').getByText(locale==='es'?'Borrador — sin vigencia':'Draft — not in effect',{exact:true}).waitFor();
  assert.equal(await page.locator('script').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Document fits the viewport');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),colorScheme==='dark'?'rgb(21, 22, 25)':'rgb(246, 247, 242)');assert.equal(requests.some(request=>['script','fetch','xhr'].includes(request.resourceType())),false);
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('header nav a')].every(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;})),true,'Navigation remains visible');assert.equal(await page.locator('footer a[href*="/privacy"]').count(),1);assert.equal(await page.locator('footer a[href*="/terms"]').count(),1);
  if(name==='privacy'){const table=page.getByRole('region',{name:locale==='es'?'Tabla desplazable':'Scrollable table'}).first();assert.equal(await table.getAttribute('tabindex'),'0');assert.equal(await page.locator('table th[scope=col]').count()>0,true);}
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.className),'legal-skip');await page.screenshot({path:join(artifacts,`${name}-${locale}-${colorScheme}-${width}.png`),fullPage:true});
 }finally{await context.close();}
});
test('document cross-links resolve to the public policy URL and shell locale links work',async()=>{
 const context=await browser.newContext({javaScriptEnabled:false});try{const page=await context.newPage();await page.goto(origin+'/terms');await page.locator('article a[href="/privacy"]').click();assert.equal(new URL(page.url()).pathname,'/privacy');await page.getByRole('link',{name:'Español',exact:true}).click();assert.equal(await page.locator('html').getAttribute('lang'),'es');await page.locator('header a[href="/terms?lang=es"]').click();assert.equal(await page.locator('html').getAttribute('lang'),'es');await page.getByRole('heading',{name:'3sln.me Terms of Service',exact:true}).waitFor();}finally{await context.close();}
});
