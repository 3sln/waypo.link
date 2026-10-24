import test from 'node:test';
import assert from 'node:assert/strict';
import {stages} from '../packages/runtime/routes/intents.mjs';
const env={FLAGS:{for:()=>({global:()=>true})},INTENT_LINKS_ENABLED:'true',APP_ORIGIN:'https://space.example',ASSETS:{fetch:async()=>new Response('<html><head></head><body><main id="app"></main></body></html>',{headers:{'Content-Type':'text/html'}})}};
for(const query of ['bintent=garbage','unknown=value','bintent=a&bintent=b'])test(`malformed public intent ${query} negotiates human HTML and explicit JSON`,async()=>{
 for(const [accept,isJSON] of [['text/html',false],['application/json',true],['application/json;q=0.2,text/html;q=0.9',false],['application/json ; q=0.2, text/html ; q=0.9',false],['*/*',false],['application/json;q=0.2,*/*;q=1',false],['application/json;q=0,*/*;q=1',false],['application/*;q=1,text/html;q=0.5',true],['text/html;q=0.1,application/json;q=0.9',true]])for(const method of ['GET','HEAD']){
 const url=new URL('https://space.example/i?'+query),request=new Request(url,{method,headers:{Accept:accept}}),response=await stages.public({request,env,url,path:'/i'});
 assert.equal(response.status,400);assert.match(response.headers.get('Content-Type'),isJSON?/application\/json/:/text\/html/);
 if(method==='GET'){if(isJSON)assert.equal((await response.json()).error,'intent_malformed');else{assert.match(await response.text(),/name="intent-error"/);assert.equal(response.headers.get('Cache-Control'),'no-store');}}
 }
});
