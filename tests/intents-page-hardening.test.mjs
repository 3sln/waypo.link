// Wargame F3 and plausible items 1-2: the intent page inserts values literally, isolates its browsing context and
// binds the activation ticket to the server-rendered intent.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {stages} from '../packages/runtime/routes/intents.mjs';
import {encodeIntent} from '../packages/intents/format.mjs';
import {registeredIntent} from '../packages/intents/registered.mjs';
const html=readFileSync(new URL('../apps/web/intent.html',import.meta.url),'utf8');
const origin='https://provider.example',owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const env={APP_ORIGIN:origin,INTENT_LINKS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',KEY_ENCRYPTION_KEY:'k',ASSETS:{fetch:async()=>new Response(html,{headers:{'Content-Type':'text/html'}})}};
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const intent=conversation=>encodeIntent({bintent:1,kind:registeredIntent('open-conversation'),data:{conversation,creator:{iss:origin,sub:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},profile:'https://profile.example/v1'}});
function legacyLink(host){
 // An oversized signature forces the raw legacy bootstrap branch (encodeIntent refuses it).
 const sig=[b64({alg:'ES256'}),b64({sub:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}),'A'.repeat(6000)].join('.');
 return 'web+bindle://send-message?contact-url='+`https://${host}/users/alice/contact/dddddddd-dddd-4ddd-8ddd-dddddddddddd?sig=${sig}`;
}
const serve=async legacy=>{const url=origin+'/console?intent='+encodeURIComponent(legacy);return stages.public({request:new Request(url),env,url:new URL(url),path:'/console'});};
const route=(url,options={})=>stages.public({request:new Request(url,options),env,url:new URL(url),path:new URL(url).pathname});
const navigate={'Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document','Sec-Fetch-Site':'none'};
const ticketOf=async response=>/name="intent-navigation" content="([^"]+)"/.exec(await response.text())[1];
async function resolveWith(navigation,value){let captured;const request=new Request(origin+'/api/intents/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value,navigation})});await stages.beforeActivity({request,env,path:'/api/intents/resolve',id:owner,object:{intentsOwner:async(_o,command)=>{captured=command;return {state:'choose'};}}});return captured.input.activated;}
test('control: an ordinary oversized legacy link renders one bootstrap carrying the exact link',async()=>{
 const legacy=legacyLink('contacts.example'),r=await serve(legacy);assert.equal(r.status,200);const text=await r.text();
 assert.equal(text.split('id="app"').length-1,1);assert.ok(text.includes('value="'+legacy.replaceAll('&','&amp;')+'"'));
});
// `$&` cannot reach the bootstrap through a valid legacy link (a raw `&` adds a query key), so the two reachable
// patterns are exercised; the replacer functions make all three literal.
for(const pattern of ["$'","$`"]){
 test(`F3: ${pattern} in the legacy host never splices page markup into the bootstrap`,async()=>{
  const r=await serve(legacyLink(`x${pattern}.example`));assert.equal(r.status,200);const text=await r.text();
  assert.equal(text.split('id="app"').length-1,1,'page markup was injected via a replacement pattern');
  assert.equal(text.split('<script').length-1,html.split('<script').length-1);
  assert.ok(text.includes('id="intent-bootstrap"'));assert.ok(text.includes(`x${pattern.replace("'",'&#39;')}.example`));
 });
}
test('F3: single quotes are escaped in attribute values',async()=>{
 const text=await (await serve(legacyLink("x'y.example"))).text(),input=/<input type="hidden" id="intent-bootstrap"[^>]*>/.exec(text)[0];
 assert.ok(input.includes('x&#39;y.example'));assert.ok(!input.includes("x'y"));
});
test('plausible-1: every intent page response sends Cross-Origin-Opener-Policy: same-origin',async()=>{
 for(const response of [await route(origin+'/i'),await route(origin+'/i/contact'),await route(origin+'/i?bintent='+intent(owner)),await route(origin+'/i',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'bintent='+intent(owner)}),await serve(legacyLink('contacts.example'))])
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
