import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeServer } from '../apps/node/server.mjs';
import { linkService } from '../packages/runtime/account/links.mjs';
import { MESSAGING_CONTACT_LINK_TYPE } from '../packages/links/types.mjs';
import { base64url,digest } from '../packages/core/records.mjs';

// Real Node adapter: the opener operation (links §9), contact-link refusals and owner routes. Authored delivery, intake
// metadata, JSON inspection and the D10 legacy cutover left the core with messaging on 2026-10-27.
const origin='http://localhost:8791',INTAKE='application/vnd.bindle.contact-intake+json',DELIVERY='application/vnd.bindle.contact-token+jwt; profile="contact-delivery-v1"';
let app,directory,alice,bob;
let lane=0;const fetchURL=(url,init={})=>{const request=new Request(new URL(url,origin),init);if(!request.headers.has('CF-Connecting-IP'))request.headers.set('CF-Connecting-IP',`203.0.113.${++lane%250}`);return app.fetch(request);};
let network=1;
async function account(){
 const ip=`198.51.100.${network++}`,post=(path,value,headers={})=>fetchURL(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':ip,...headers},body:JSON.stringify(value)});
 const signup=await post('/api/auth/signup',{method:'password',password:'Private links account password!',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'}),pending=await signup.json(),setup={Cookie:signup.headers.get('Set-Cookie').split(';')[0]};
 const recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken},setup)).json();
 const activated=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true},setup);assert.equal(activated.status,200,await activated.clone().text());
 const session=await activated.json(),headers={Cookie:activated.headers.getSetCookie().find(c=>c.startsWith('bindle_session=')).split(';')[0],'X-CSRF-Token':session.csrfToken};
 const owner=(path,value,method='POST')=>fetchURL(path,{method,headers:{Origin:origin,...headers,...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}});
 return {session,headers,owner,id:session.account.id,handle:session.account.handle};
}
const send=(url,message,headers={})=>fetchURL(url,{method:'POST',headers:{'Content-Type':message.contentType,...headers},body:message.bytes});
test.before(async()=>{directory=await mkdtemp(join(tmpdir(),'bindle-links-http-'));app=await createNodeServer({directory,config:{APP_ORIGIN:origin}});
 // HTTP policy coverage supplies its own shell; built composer behavior belongs to the browser gates.
 app.resources.assets.fetch=async request=>new URL(request.url).pathname==='/console.html'?new Response('<!doctype html><html><head><title>Link composer fixture</title></head><body><main id="app"></main></body></html>',{headers:{'Content-Type':'text/html'}}):new Response('Not found',{status:404});alice=await account();bob=await account();});
test.after(async()=>{await app?.close();if(directory)await rm(directory,{recursive:true,force:true});});





test('opener operations are owner-authenticated, CSRF-checked and same-host only; tags and default rules are routed',async()=>{
 // An unconditional contact parent issued through the core links service.
 const issued=await linkService(app.resources.accounts.get(alice.id)).issue(alice.id,{type:MESSAGING_CONTACT_LINK_TYPE,claims:{resource:'contact',kinds:['one-off'],mimeTypes:['text/plain'],maxMessages:5,maxBytes:65536,maxMessageBytes:4096},expiresAt:Date.now()+86400000,handle:alice.handle}),link={url:issued.link};
 assert.equal((await fetchURL('/api/links/respond',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal((await fetchURL('/api/links/respond',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:bob.headers.Cookie,'X-CSRF-Token':'wrong'},body:'{}'})).status,403);
 // Envelope authoring and signed-link POST delivery are gone from core.
 assert.equal((await bob.owner('/api/links/envelope',{})).status,404);assert.equal((await fetchURL(link.url,{method:'POST',body:'x'})).status,405);
 assert.equal((await bob.owner('/api/links/respond',{link:link.url})).status,401,'providers sign responses only for conditional links (links §9)');
 assert.equal((await bob.owner('/api/links/respond',{link:link.url+'&utm=1'})).status,401);
 const labels=await (await alice.owner('/api/tags/labels',undefined,'GET')).json();assert.deepEqual(labels,{revision:0,labels:{}});
 const named=await (await alice.owner('/api/tags/labels',{label:'Clients'},'PUT')).json();assert.match(named.id,/^t\./);
 const snapshot=await (await alice.owner('/api/account',undefined,'GET')).json();assert.equal(snapshot.tagLabels.labels[named.id],'Clients');
 const rules=snapshot.rules,target=rules.find(rule=>rule.id.startsWith('default:'));await alice.owner('/api/rules',{rules:rules.filter(rule=>rule.id!==target.id)},'PUT');
 const restored=await alice.owner(`/api/rules/${encodeURIComponent(target.id)}/restore`,{});assert.equal(restored.status,200);assert.equal((await restored.json()).id,target.id);
});

test('signing out forgets this device push subscription for that account only',async()=>{
 const carol=await account(),endpoint='https://fcm.googleapis.com/fcm/send/'+crypto.randomUUID(),subscription={endpoint,keys:{p256dh:base64url(new Uint8Array(65).fill(4)),auth:base64url(new Uint8Array(16).fill(1))}};
 for(const who of [carol,bob])assert.equal((await who.owner('/api/notifications/subscribe',{subscription,label:'This device'})).status,200);
 const id=await digest(crypto,endpoint),rows=async who=>[...await app.resources.accounts.get(who.id).metadata.list({prefix:`push-subscription/${who.id}/`})].length;
 assert.equal(await rows(carol),1);assert.equal((await carol.owner('/api/auth/logout',{pushSubscription:id})).status,200);
 assert.equal(await rows(carol),0);assert.equal(await rows(bob),1);assert.equal((await carol.owner('/api/account',undefined,'GET')).status,401);
});
