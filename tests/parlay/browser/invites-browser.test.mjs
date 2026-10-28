// Contacts spike phase 3 (provisional, unsigned): the inviter's "Invite a person" UI through the real dodo/ngin client,
// its authenticated HTTP adapter and the loopback-only fixture mailbox. No demo routes or credentials are mounted.
import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';import {chromium} from 'playwright';
import {createWebHTTP} from '../../../apps/parlay/web/http.mjs';import {fixture,OWNER,INVITE_TOKEN,INVITE_DELEGATION,REDEEMER,principal} from './fixture.mjs';import {COPY} from '../../../apps/parlay/web/ui/locale.mjs';
import {decodeIntent,parseProtocolIntent} from '../../../packages/intents/format.mjs';
let server,browser,origin,current;const root=resolve('.');
const boot=`import {mount} from '/apps/parlay/web/index.mjs';window.client=await mount(document.getElementById('app'),{PARLAY_ENABLED:true,owner:'${OWNER}',token:()=> 'local-test-only',pollMs:3600000});window.ready=true;`;
test.before(async()=>{
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="'+(url.searchParams.get('locale')==='es'?'es':'en')+'"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/apps/parlay/web/styles.css"></head><body><div id="app"></div><script type="module" src="/boot.mjs"></script></body></html>');return;}
  if(url.pathname==='/boot.mjs'){res.setHeader('Content-Type','text/javascript');res.end(boot);return;}
  if(url.pathname==='/api/events'){res.setHeader('Content-Type','text/event-stream');res.setHeader('X-Resume-Token','epoch/1');res.end('');return;}
  if(url.pathname==='/api/web/operation'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const response=await createWebHTTP({PARLAY_ENABLED:true,authenticate:async()=>({kind:'owner',owner:OWNER}),mailbox:async()=>({run:(_owner,name,args)=>current.mailbox.run(name,args)})})(new Request(origin+req.url,{method:req.method,headers:req.headers,body:Buffer.concat(chunks)}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  if(!['/apps/parlay/','/vendor/','/packages/'].some(prefix=>url.pathname.startsWith(prefix))){res.writeHead(404);res.end();return;}
  const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+'/')){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',extname(file)==='.css'?'text/css':'text/javascript');res.end(await readFile(file));
 }catch(error){res.writeHead(500);res.end(error.message);}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});
});
test.after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
for(const locale of ['en','es'])for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`${locale} ${width}px ${theme}: invite a person, one-time link, ledger Block, Revoke and Contacts list`,async()=>{
 current=fixture({size:1});const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme}),errors=[],logs=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{logs.push(m.text());if(m.type()==='error')errors.push(m.text());});
 const t=key=>COPY[locale][key],button=key=>page.getByRole('button',{name:t(key),exact:true}),layout=async()=>{assert.equal(await page.getByRole('heading',{level:1}).count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);};
 try{
  await page.goto(origin+'/?locale='+locale);await page.waitForFunction(()=>window.ready);await button('contacts').click();await page.getByRole('heading',{name:t('invitePerson'),exact:true}).waitFor();
  assert.equal(await page.getByText(t('noInvitations'),{exact:true}).count(),1);assert.equal(await page.getByText(t('noMembers'),{exact:true}).count(),1);await layout();
  // Create: an optional owner-private name, keyboard only.
  await page.getByRole('textbox',{name:t('inviteName'),exact:true}).fill('for Bob');await page.getByRole('textbox',{name:t('inviteName'),exact:true}).press('Enter');
  const box=page.getByRole('textbox',{name:t('inviteLink'),exact:true});await box.waitFor();const link=await box.inputValue();
  assert.deepEqual(current.calls.filter(c=>c.name==='invites.create').map(c=>c.input),[{template:'person',name:'for Bob'}]);
  const {intent}=parseProtocolIntent(encodeURIComponent(link));assert.deepEqual(intent.kind,{artefact:'https://spec.bindle.example/messaging/v1/intents/connect',version:1,digest:'sha256-oCyJ6fKE_vJrmdRY5bF5U_R8t_pfE2HZoZy81yG7H-g'});
  assert.deepEqual(intent.data,{inviter:{iss:principal.issuer,sub:OWNER},token:INVITE_TOKEN,delegation:INVITE_DELEGATION,expires_at:Math.floor((1792454400000+7*86400000)/1000)});assert.equal(decodeIntent(link.slice(link.indexOf('=')+1)).data.token,INVITE_TOKEN);
  assert.equal(await box.evaluate(e=>e.readOnly),true);assert.equal(await page.getByRole('heading',{name:'for Bob',exact:true}).count(),1);assert.equal(await page.getByText(t('inviteState_live'),{exact:true}).count(),1);await layout();
  // The token is a bearer secret: never in browser storage or the console, and gone after Done or navigation.
  assert.equal(await page.evaluate(token=>Object.keys(localStorage).some(k=>localStorage.getItem(k).includes(token))||Object.keys(sessionStorage).length>0,INVITE_TOKEN),false);
  await button('inviteDone').click();await box.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.client.state.value.freshInvite),null);
  await page.getByRole('textbox',{name:t('inviteName'),exact:true}).fill('Second');await button('inviteCreate').click();await box.waitFor();await button('conversations').click();await button('contacts').click();await page.getByRole('heading',{name:t('invitePerson'),exact:true}).waitFor();assert.equal(await box.count(),0);
  assert.equal(await page.evaluate(token=>document.body.innerHTML.includes(token),INVITE_TOKEN),false);assert.equal(logs.some(l=>l.includes(INVITE_TOKEN)),false);
  // Revoke the open "Second" invitation.
  await page.getByRole('article').filter({hasText:'Second'}).getByRole('button',{name:t('revoke'),exact:true}).click();await page.getByRole('article').filter({hasText:'Second'}).getByText(t('inviteState_revoked'),{exact:true}).waitFor();
  assert.deepEqual(current.calls.filter(c=>c.name==='invites.revoke').map(c=>c.input),[{id:current.invites.find(i=>i.name==='Second').id}]);
  // A redemption appears in the ledger as "Used by <principal>" with Block one step away, and in the Contacts list.
  current.redeemInvite('for Bob');
  await page.evaluate(()=>window.client.run('sync'));const used=page.getByRole('article').filter({hasText:'for Bob'});
  await used.getByText(t('usedBy')+REDEEMER.subject+' · '+REDEEMER.issuer,{exact:true}).waitFor();await used.getByText(t('inviteState_used'),{exact:true}).waitFor();assert.equal(await used.getByRole('button',{name:t('revoke'),exact:true}).count(),0);assert.equal(await page.locator('.members>li').count(),1);
  await used.getByRole('button',{name:t('block'),exact:true}).click();await page.waitForFunction(()=>window.client.state.value.notice==='invite-blocked');assert.deepEqual(current.blocked,[REDEEMER]);
  await button('removeMember').click();await page.getByText(t('noMembers'),{exact:true}).waitFor();assert.deepEqual(current.calls.filter(c=>c.name==='lists.remove').map(c=>c.input),[{list:'contacts',principal:REDEEMER}]);
  await layout();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.tagName!=='BODY'),true);assert.deepEqual(errors,[]);
 }catch(error){error.message+='\nBrowser errors: '+JSON.stringify(errors);throw error;}finally{await page.close();}
});
