// Production UI and engine against local API fixtures; no external delivery claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,firefox} from 'playwright';
import {relationsBoot} from '../helpers/org-relations-fixture.mjs';
const project=resolve('.'),browsers={};let server,origin,options={};
test.before(async()=>{server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://127.0.0.1').pathname;if(path==='/fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(options));return;}if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/fixture.mjs"></script>');return;}res.setHeader('Content-Type','text/javascript');if(path==='/fixture.mjs'){res.end(relationsBoot);return;}const file=resolve(project,'.'+path);if(!file.startsWith(project+'/')||!['/apps/','/packages/','/vendor/'].some(p=>path.startsWith(p))){res.writeHead(404);res.end();return;}res.end(await readFile(file));}catch(e){res.writeHead(500);res.end(e.message);}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;for(const [name,type]of Object.entries({chromium,firefox}))browsers[name]=await type.launch({headless:true});});
test.after(async()=>{await Promise.all(Object.values(browsers).map(b=>b.close()));await new Promise(r=>server?.close(r));});
const settle=p=>p.evaluate(async()=>{for(let i=0;i<3;i++){await window.pending;await window.painting;}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
const act=async(p,action,detail={})=>{await p.evaluate(([a,d])=>window.act(a,d),[action,detail]);await settle(p);};
for(const name of ['chromium','firefox'])for(const locale of ['en','es'])for(const colorScheme of ['light','dark'])for(const width of [390,1280])test(`ORG-10g DOM ${name} ${locale} ${colorScheme} ${width}`,async()=>{
 options={locale};const page=await browsers[name].newPage({viewport:{width,height:900},colorScheme}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await page.goto(origin);await page.waitForFunction(()=>window.ready);await act(page,'select',{org:'00000000-0000-4000-8000-000000000001'});await act(page,'rel-tab',{tab:'relationships'});
 const body=page.locator('#org-relations').locator('..');assert.match(await body.innerText(),locale==='es'?/En pausa por seguridad/:/Paused for safety/);
 const exportButton=page.locator('[data-org-action="rel-export"]');await exportButton.focus();await page.keyboard.press('Enter');await settle(page);assert.equal(await page.evaluate(()=>window.downloads.length),1);
 const review=page.locator('[data-org-action="rel-inbound"]').first();await review.focus();await page.keyboard.press('Enter');await settle(page);await page.locator('#org-rel-accept').waitFor();assert.equal(await page.locator('#org-rel-accept').evaluate(e=>document.activeElement===e),true);
 const text=await body.innerText();for(const pattern of locale==='es'?[/Lo que recibirías/,/Lo que darías/,/copias/,/identidad verificada/]:[/What you would receive/,/What you would give/,/Copies/,/verified identity/])assert.match(text,pattern);
 assert.equal(await page.locator('.org-console img,.org-console script').count(),0);assert.doesNotMatch(text,/\b[a-z]+(?:_[a-z]+)+\b/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('[data-org-action="rel-accept"]').click();await settle(page);assert.equal(await page.evaluate(()=>window.calls.some(c=>c.body?.operation==='accept')),false,'acceptance needs values and consent');
 await act(page,'rel-accept-close');await act(page,'rel-pane',{pane:'imports'});assert.match(await body.innerText(),locale==='es'?/Acme/:/Acme/);assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
for(const name of ['chromium','firefox'])test(`ORG-10g member DOM ${name}`,async()=>{options={locale:'en',member:true};const page=await browsers[name].newPage();try{await page.goto(origin);await page.waitForFunction(()=>window.ready);await act(page,'select',{org:'00000000-0000-4000-8000-000000000001'});await act(page,'rel-tab',{tab:'relationships'});assert.match(await page.locator('#org-relations').locator('..').innerText(),/Acme/);assert.equal(await page.locator('[data-org-action="rel-wizard-open"]').count(),0);assert.equal(await page.evaluate(()=>window.calls.some(c=>c.path.endsWith('/relations'))),false);}finally{await page.close();}});
