// The applied service-worker deletion-notice handling (apps/web/sw.js). Existing lifecycle/approval handling is preserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {deletionNoticeTemplate} from '../packages/runtime/deletion-notices.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',ORIGIN='https://push.example';
async function worker(){
 let source=await readFile('apps/web/sw.js','utf8');assert(source.includes("payload?.type==='bindle-deletion-notice'"));source=source.replace('/*__3SLN_PUBLIC_BUILD__*/null',JSON.stringify({buildId:'fixture',cacheVersion:1,assets:[]}));
 const listeners={},shown=[],opened=[],self={location:{origin:ORIGIN},addEventListener:(name,handler)=>{listeners[name]=handler;},registration:{showNotification:async(title,options)=>{shown.push({title,...options});}},clients:{openWindow:async url=>{opened.push(url);}}};runInNewContext(source,{self,URL,TextEncoder,crypto});
 const push=async payload=>{let promise;listeners.push({data:{text:()=>JSON.stringify(payload),json:()=>payload},waitUntil:value=>{promise=value;}});await promise;};
 const click=async data=>{let promise;listeners.notificationclick({notification:{data,close(){}},waitUntil:value=>{promise=value;}});await promise;};return {push,click,shown,opened};
}
test('push handling: snapshot cancellation URL survives notification display/click and never cancels on receipt',async()=>{
 const w=await worker(),template=deletionNoticeTemplate({owner:OWNER,handle:'n.abc123',basis:'owner',kind:'scheduled',executeAfter:Date.UTC(2026,10,5),graceDays:14,cancellable:true,cancelToken:'a'.repeat(43)},{origin:ORIGIN});
 await w.push(template.push);assert.equal(w.shown.length,1);assert.equal(w.shown[0].data.path,template.push.path);assert.deepEqual(w.opened,[]);await w.click(w.shown[0].data);assert.deepEqual(w.opened,[ORIGIN+template.push.path]);
});
test('push handling: cross-origin, query-token, cross-account, overlong and malformed paths are ignored at display and click',async()=>{
 const w=await worker(),base={type:'bindle-deletion-notice',owner:OWNER,kind:'scheduled',title:'Delete',body:'Scheduled',path:'/account/deletion/cancel#owner='+OWNER+'&token='+'a'.repeat(43)};
 for(const extra of [{path:'https://evil.example/cancel'},{path:'//evil.example/cancel'},{path:'/account/deletion/cancel?owner='+OWNER+'&token='+'a'.repeat(43)},{path:base.path.replace(OWNER,OTHER)},{path:base.path+'&redirect=evil'},{owner:'bad'},{title:'x'.repeat(161)},{body:'x'.repeat(2049)},{kind:'unknown'}])await w.push({...base,...extra});
 assert.deepEqual(w.shown,[]);for(const path of ['https://evil.example',base.path.replace(OWNER,OTHER),base.path+'&extra=x'])await w.click({type:base.type,owner:OWNER,path});assert.deepEqual(w.opened,[]);
 const admin={...base,path:'/console?account='+OWNER+'&view=account-data'};await w.push(admin);await w.click(w.shown[0].data);assert.deepEqual(w.opened,[ORIGIN+admin.path]);
});
