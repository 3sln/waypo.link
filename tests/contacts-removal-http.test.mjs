import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeServer } from '../apps/node/server.mjs';
import { base64url,digest } from '../packages/core/records.mjs';
import { softAuthenticator } from './helpers/soft-passkey.mjs';

// Real Node adapter. Contacts phase 4 (contacts spike CR-C1, CR-C3, CR-C4; provisional, unsigned) removed contact links
// from the core: the landing page and its previews, oEmbed and the link-scoped avatar, the descriptor, the owner link
// routes, the opener operation, per-link sharing and `/i/contact`. These are removal regressions over the real adapter,
// plus the reduced `/api/profile`. (It also carries one unrelated sign-out test from the former links-http test file.)
const origin='http://localhost:8791';
let app,directory,alice,bob;
let lane=0;const fetchURL=(url,init={})=>{const request=new Request(new URL(url,origin),init);if(!request.headers.has('CF-Connecting-IP'))request.headers.set('CF-Connecting-IP',`203.0.113.${++lane%250}`);return app.fetch(request);};
let network=1;
async function account(){
 const ip=`198.51.100.${network++}`,post=(path,value,headers={})=>fetchURL(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':ip,...headers},body:JSON.stringify(value)});
 const signup=await post('/api/auth/signup',{method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'}),pending=await signup.json(),setup={Cookie:signup.headers.get('Set-Cookie').split(';')[0]};
 const registered=await post('/api/auth/passkey/register',{pendingToken:pending.pendingToken,response:await softAuthenticator({origin}).register(pending.registrationOptions)},setup);assert.equal(registered.status,200,await registered.clone().text());
 const recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken},setup)).json();
 const activated=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true},setup);assert.equal(activated.status,200,await activated.clone().text());
 const session=await activated.json(),headers={Cookie:activated.headers.getSetCookie().find(c=>c.startsWith('bindle_session=')).split(';')[0],'X-CSRF-Token':session.csrfToken};
 const owner=(path,value,method='POST')=>fetchURL(path,{method,headers:{Origin:origin,...headers,...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}});
 return {session,headers,owner,id:session.account.id,handle:session.account.handle};
}
test.before(async()=>{directory=await mkdtemp(join(tmpdir(),'bindle-links-http-'));app=await createNodeServer({directory,config:{APP_ORIGIN:origin}});
 // HTTP policy coverage supplies its own shell; built composer behavior belongs to the browser gates.
 app.resources.assets.fetch=async request=>new URL(request.url).pathname==='/console.html'?new Response('<!doctype html><html><head><title>Link composer fixture</title></head><body><main id="app"></main></body></html>',{headers:{'Content-Type':'text/html'}}):new Response('Not found',{status:404});alice=await account();bob=await account();});
test.after(async()=>{await app?.close();if(directory)await rm(directory,{recursive:true,force:true});});






test('removed contact-link routes answer as unknown paths, with and without a session',async()=>{
 const jti=crypto.randomUUID(),meta='eyJhbGciOiJFUzI1NiJ9.eyJ0eXBlIjoieCJ9.'+'A'.repeat(86),contact=`/users/${alice.handle}/contact/${jti}`;
 for(const [path,init] of [[contact+'?bindle_meta='+meta,{headers:{Accept:'text/html'}}],[contact+'?bindle_meta='+meta,{headers:{Accept:'application/vnd.bindle.messaging.ingress+json'}}],[contact+'?bindle_meta='+meta,{headers:{Accept:'application/vnd.bindle.contact-profile+json'}}],[contact+'/avatar?bindle_meta='+meta,{}],['/oembed?url='+encodeURIComponent(origin+contact+'?bindle_meta='+meta),{}]]){
  // The path is no longer special: it answers exactly like the same shape under an unknown segment (the site fallback),
  // never a contact representation, preview metadata or the descriptor.
  const response=await fetchURL(path,init),control=await fetchURL(path.replace('/contact/','/not-a-route/').replace('/oembed?','/not-oembed?'),init);
  assert.equal(response.status,control.status,path);assert.equal(response.headers.get('Content-Type'),control.headers.get('Content-Type'),path);
  assert.equal(response.headers.get('Content-Type')?.includes('application/vnd.bindle'),false,'no contact representation: '+path);
  const text=await response.text();assert.equal(/og:|oembed|bindle-contact|contact-preview/i.test(text),false,'no preview metadata: '+path);
 }
 for(const [path,method,value] of [['/api/links','GET'],['/api/links/changes','GET'],['/api/links/'+jti+'/revoke','POST',{}],['/api/links/respond','POST',{link:origin+contact+'?bindle_meta='+meta}],['/api/contacts/'+jti+'/sharing','PUT',{profileFields:['displayName']}]]){
  // Review L4: the same method on an unknown owner path is the control. A 405 would mean a route still claims the path.
  const response=await alice.owner(path,value,method),control=await alice.owner(path.replace(/^\/api\/(links|contacts)/,'/api/not-a-route'),value,method);
  assert.equal(control.status,404,'control '+path);assert.equal(response.status,control.status,path+' '+response.status);
 }
 const snapshot=await (await alice.owner('/api/account',undefined,'GET')).json();assert.equal(Object.hasOwn(snapshot,'contacts'),false,'no contact parents in the account snapshot');
});

test('/api/profile is only displayName and avatar; retired members are refused and never returned',async()=>{
 const read=async()=>(await alice.owner('/api/profile',undefined,'GET')).json();
 const first=await read();assert.deepEqual(Object.keys(first).sort(),['avatar','displayName','revision']);
 assert.equal((await alice.owner('/api/profile',{displayName:'Alice',avatar:'https://img.example/a.png',bio:'x'},'PUT')).status,400);
 assert.equal((await alice.owner('/api/profile',{displayName:'Alice',avatar:'',discloseToContacts:true},'PUT')).status,400);
 assert.equal((await alice.owner('/api/profile',{displayName:'Alice',avatar:'http://img.example/a.png'},'PUT')).status,400,'HTTPS avatars only');
 const saved=await alice.owner('/api/profile',{displayName:'Alice',avatar:'https://img.example/a.png',expectedRevision:first.revision},'PUT');assert.equal(saved.status,200);
 const body=await saved.json();assert.equal(body.displayName,'Alice');assert.equal(body.avatar,'https://img.example/a.png');assert.notEqual(body.revision,first.revision);
 const stale=await alice.owner('/api/profile',{displayName:'Stale',avatar:'',expectedRevision:first.revision},'PUT');assert.equal(stale.status,409);assert.equal((await stale.json()).error,'profile_stale');
 assert.equal((await read()).displayName,'Alice');assert.equal((await (await bob.owner('/api/profile',undefined,'GET')).json()).displayName,'','another account is untouched');
});

test('signing out forgets this device push subscription for that account only',async()=>{
 const carol=await account(),endpoint='https://fcm.googleapis.com/fcm/send/'+crypto.randomUUID(),subscription={endpoint,keys:{p256dh:base64url(new Uint8Array(65).fill(4)),auth:base64url(new Uint8Array(16).fill(1))}};
 for(const who of [carol,bob])assert.equal((await who.owner('/api/notifications/subscribe',{subscription,label:'This device'})).status,200);
 const id=await digest(crypto,endpoint),rows=async who=>[...await app.resources.accounts.get(who.id).metadata.list({prefix:`push-subscription/${who.id}/`})].length;
 assert.equal(await rows(carol),1);assert.equal((await carol.owner('/api/auth/logout',{pushSubscription:id})).status,200);
 assert.equal(await rows(carol),0);assert.equal(await rows(bob),1);assert.equal((await carol.owner('/api/account',undefined,'GET')).status,401);
});
