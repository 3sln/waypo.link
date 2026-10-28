// Wargame F3 and plausible items 1-2: the intent page inserts values literally, isolates its browsing context and
// binds the activation ticket to the server-rendered intent.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {stages} from '../packages/runtime/routes/intents.mjs';
import {encodeIntent} from '../packages/intents/format.mjs';
const registeredIntent=()=>({artefact:'https://spec.bindle.example/intents/open-conversation/v1',version:1,digest:'sha256-BVp7Z5PiP2NNpO9cb-mxI_8uyZWO1PKJ5PsKgPZNU70'});
const html=readFileSync(new URL('../apps/web/intent.html',import.meta.url),'utf8');
const origin='https://provider.example',owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const env={APP_ORIGIN:origin,INTENT_LINKS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',KEY_ENCRYPTION_KEY:'k',ASSETS:{fetch:async()=>new Response(html,{headers:{'Content-Type':'text/html'}})}};
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const intent=conversation=>encodeIntent({bintent:1,kind:registeredIntent('open-conversation'),data:{conversation,creator:{iss:origin,sub:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},profile:'https://profile.example/v1'}});
const serve=async legacy=>{const url=origin+'/console?intent='+encodeURIComponent(legacy);return stages.public({request:new Request(url),env,url:new URL(url),path:'/console'});};
const route=(url,options={})=>stages.public({request:new Request(url,options),env,url:new URL(url),path:new URL(url).pathname});
const navigate={'Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document','Sec-Fetch-Site':'none'};
const ticketOf=async response=>/name="intent-navigation" content="([^"]+)"/.exec(await response.text())[1];
async function resolveWith(navigation,value){let captured;const request=new Request(origin+'/api/intents/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value,navigation})});await stages.beforeActivity({request,env,path:'/api/intents/resolve',id:owner,object:{intentsOwner:async(_o,command)=>{captured=command;return {state:'choose'};}}});return captured.input.activated;}
// Contacts phase 4 (CR-C3) removed the legacy `/console?intent=web+bindle://send-message?contact-url=…` bootstrap and
// `/i/contact`, which were the only routes that placed non-base64url text (a contact link) into the page. The remaining
// bootstrap carries only a validated `bintent` value; the replacer functions still insert it literally.
test('contacts phase 4: the legacy contact bootstrap and /i/contact are not intent routes any more',async()=>{
 const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url'),sig=[b64({alg:'ES256'}),b64({sub:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}),'A'.repeat(86)].join('.');
 for(const legacy of ['web+bindle://send-message?contact-url='+encodeURIComponent(`https://contacts.example/users/alice/contact/dddddddd-dddd-4ddd-8ddd-dddddddddddd?bindle_meta=${sig}`),"web+bindle://add-contact?contact-url=https%3A%2F%2Fx%24'.example%2Fusers%2Fa%2Fcontact%2Fdddddddd-dddd-4ddd-8ddd-dddddddddddd%3Fsig%3Da.b.c"])
  assert.equal(await serve(legacy),undefined,'the console route falls through to the ordinary console page');
 assert.equal(await route(origin+'/i/contact'),undefined);
 // A served bintent value appears exactly once, literally, in the bootstrap.
 const value=intent(owner),text=await (await route(origin+'/i?bintent='+value)).text(),input=/<input type="hidden" id="intent-bootstrap"[^>]*>/.exec(text)[0];
 assert.ok(input.includes('value="'+value+'"'));assert.equal(input.includes('data-legacy'),false);assert.equal(text.split('id="app"').length-1,html.split('id="app"').length-1);
});
test('plausible-1: every intent page response sends Cross-Origin-Opener-Policy: same-origin',async()=>{
 for(const response of [await route(origin+'/i'),await route(origin+'/i?bintent='+intent(owner)),await route(origin+'/i',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'bintent='+intent(owner)})])
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'),'same-origin');
});
test('plausible-2: a ticket rendered with an intent activates only that intent; an unbound ticket stays usable',async()=>{
 const a=intent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),b=intent('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 const bound=await ticketOf(await route(origin+'/i?bintent='+a,{headers:navigate}));
 assert.equal(await resolveWith(bound,a),true);assert.equal(await resolveWith(bound,b),false);assert.equal(await resolveWith(bound,undefined),false);
 const posted=await ticketOf(await route(origin+'/i',{method:'POST',headers:{...navigate,'Content-Type':'application/x-www-form-urlencoded'},body:'bintent='+a}));
 assert.equal(await resolveWith(posted,a),true);assert.equal(await resolveWith(posted,b),false);
 const fragment=await ticketOf(await route(origin+'/i',{headers:navigate}));
 assert.equal(await resolveWith(fragment,b),true);
});
