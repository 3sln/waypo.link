// The cross-device email flow over the real Node runtime and its durable identity store (sign-in and intents spike §4,
// P3): the thin routes (routes/email-flow.mjs), the browser marker cookie, the helper page's headers (GET inert,
// no-store, frame-ancestors 'none'), Fetch Metadata refusal, the flag gate (off answers like any unknown path), and
// email sign-up through activation followed by a cross-device sign-in. The protocol itself is covered at engine level
// (tests/email-flow.test.mjs). Mail goes to a capturing test double; nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {createFlowSecret} from '../apps/web/src/shared/email-flow.mjs';
import {EMAIL_BROWSER_COOKIE} from '../packages/runtime/routes/email-flow.mjs';
import {EmailFlowStorage} from '../packages/runtime/email-flow-store.mjs';
import {MemoryMetadata} from './helpers/identity-engine.mjs';
import {shardedEmailFlows} from '../packages/runtime/email-flow-store.mjs';

const CHALLENGE='local-browser-test-token';
async function server(t,flags={EMAIL_FLOW_V2:'true',EMAIL_SIGNUP_ENABLED:'true'}){
 const directory=await mkdtemp(join(tmpdir(),'3sln-email-flow-')),origin='http://localhost:8788',mail=[];
 const app=await createNodeServer({directory,config:{APP_ORIGIN:origin,BRAND_NAME:'3sln.me',SIGNUP_ENABLED:'true',...flags},mailer:{sendEmailFlow:async value=>{mail.push(value);},sendVerification:async()=>{},sendSecurityAlert:async value=>{mail.push({alert:true,...value});}}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const jar=()=>{const cookies=new Map();return {header:()=>[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),take(response){for(const line of response.headers.getSetCookie()){const [pair,...attrs]=line.split(';'),index=pair.indexOf('='),name=pair.slice(0,index),value=pair.slice(index+1);if(attrs.some(a=>/max-age=0/i.test(a.trim())))cookies.delete(name);else cookies.set(name,value);}},get:name=>cookies.get(name)};};
 const call=async(path,input,{cookies,headers={},ip='198.51.100.10',method='POST'}={})=>{const response=await app.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':ip,'Sec-Fetch-Site':'same-origin',...cookies?{Cookie:cookies.header()}:{},...headers},...method==='POST'?{body:JSON.stringify(input)}:{}}));cookies?.take(response);const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:response.status,value,headers:response.headers};};
 return {app,origin,mail,jar,call};
}
const waitFor=async predicate=>{for(let i=0;i<100;i++){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('timed out');};

test('helper page: GET is a static, no-store, unframeable document that sets no cookie and changes nothing (EL-2, T7)',async t=>{
 const s=await server(t),response=await s.app.fetch(new Request(s.origin+'/email/link#t='+'a'.repeat(43),{headers:{Accept:'text/html'}}));
 assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/text\/html/);
 assert.equal(response.headers.get('Cache-Control'),'no-store');assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 assert.equal(response.headers.get('X-Frame-Options'),'DENY');assert.equal(response.headers.get('Cross-Origin-Opener-Policy'),'same-origin');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
 assert.deepEqual(response.headers.getSetCookie(),[]);
 // POST is not served by the page.
 assert.equal((await s.app.fetch(new Request(s.origin+'/email/link',{method:'POST',headers:{Origin:s.origin}}))).status,405);
});

test('flag off: the email flow paths and the helper page answer exactly like unknown paths',async t=>{
 const s=await server(t,{});
 const known=await s.call('/api/auth/email/flow/start',{email:'a@mail.example'}),unknown=await s.call('/api/auth/email/flow/nothing',{email:'a@mail.example'});
 assert.deepEqual([known.status,known.value],[unknown.status,unknown.value]);
 const page=await s.app.fetch(new Request(s.origin+'/email/link',{headers:{Accept:'text/html'}})),other=await s.app.fetch(new Request(s.origin+'/email/linkx',{headers:{Accept:'text/html'}}));
 assert.equal(page.status,other.status);
 const config=(await s.call('/api/config',undefined,{method:'GET'})).value;assert.equal(config.emailFlowEnabled,false);assert.equal(config.emailSignupEnabled,false);
});

test('routes: Fetch Metadata and Origin are enforced; start sets the HttpOnly SameSite=Strict browser marker; every branch answers the same shape',async t=>{
 const s=await server(t),proofs=await createFlowSecret(),input={email:'new@mail.example',secretHash:proofs.secretHash,channelTag:proofs.channelTag,turnstileToken:CHALLENGE};
 assert.equal((await s.call('/api/auth/email/flow/start',input,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 assert.equal((await s.call('/api/auth/email/flow/start',input,{headers:{'Sec-Fetch-Site':'same-site'}})).status,403);
 assert.equal((await s.app.fetch(new Request(s.origin+'/api/auth/email/flow/start',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify(input)}))).status,403);
 const cookies=s.jar(),started=await s.call('/api/auth/email/flow/start',input,{cookies});
 assert.equal(started.status,200,JSON.stringify(started.value));assert.deepEqual(Object.keys(started.value).sort(),['expiresIn','flowId','interval']);
 const line=started.headers.getSetCookie().find(value=>value.startsWith('bindle_email_flow='));assert.ok(line);
 for(const attribute of ['HttpOnly','SameSite=Strict','Path=/','Max-Age=1200'])assert.ok(line.includes(attribute),attribute);
 assert.equal(EMAIL_BROWSER_COOKIE,'__Host-bindle_email_flow','off loopback the marker is a __Host- cookie');
 assert.equal(started.headers.get('Cache-Control'),'no-store');assert.equal(started.headers.get('Referrer-Policy'),'no-referrer');
 const config=(await s.call('/api/config',undefined,{method:'GET'})).value;assert.equal(config.emailFlowEnabled,true);assert.equal(config.emailSignupEnabled,true);
});

test('email sign-up end to end over HTTP, then a cross-device sign-in with a code; a link opened elsewhere never signs in (EL-1)',async t=>{
 const s=await server(t),r=s.jar(),proofs=await createFlowSecret();
 const started=await s.call('/api/auth/email/flow/start',{email:'person@mail.example',secretHash:proofs.secretHash,channelTag:proofs.channelTag,turnstileToken:CHALLENGE},{cookies:r});
 const mailed=await waitFor(()=>s.mail.find(item=>item.purpose==='sign-up'));assert.equal(mailed.email,'person@mail.example');
 // The helper in the same browser (it shares R's cookie jar) sees and approves; another browser could not.
 const view=await s.call('/api/auth/email/link/inspect',{t:mailed.token},{cookies:r});assert.equal(view.value.sameBrowser,true);assert.equal(view.value.purpose,'sign-up');
 assert.equal((await s.call('/api/auth/email/link/approve',{t:mailed.token,confirmed:true},{cookies:s.jar()})).value.error,'invalid_link');
 const approved=await s.call('/api/auth/email/link/approve',{t:mailed.token,confirmed:true},{cookies:r});assert.equal(approved.value.channelTag,proofs.channelTag);
 const status=await s.call('/api/auth/email/flow/status',{flowId:started.value.flowId,secret:proofs.secret},{cookies:r});assert.equal(status.value.status,'approved');
 const redeemed=await s.call('/api/auth/email/flow/redeem',{flowId:started.value.flowId,secret:proofs.secret,confirmed:true},{cookies:r});
 assert.equal(redeemed.status,200,JSON.stringify(redeemed.value));assert.equal(redeemed.headers.getSetCookie().some(line=>/bindle_session|bindle_account/.test(line)),false,'sign-up redemption sets no session');
 const pending=await s.call('/api/auth/email/signup',{signupToken:redeemed.value.signup.signupToken,termsAccepted:true,termsVersion:'2026-10-11',ageConfirmed:18},{cookies:r,ip:'198.51.100.31'});
 assert.equal(pending.status,200,JSON.stringify(pending.value));assert.match(pending.value.account.handle,/^n\./);assert.equal(pending.value.account.emails[0].state,'sign-in');
 const file=await s.call('/api/auth/recovery/download',{pendingToken:pending.value.pendingToken},{cookies:r});assert.equal(file.status,200,JSON.stringify(file.value));
 const active=await s.call('/api/auth/recovery/confirm',{pendingToken:pending.value.pendingToken,recoveryToken:file.value.recoveryToken,downloadConfirmed:true},{cookies:r});
 assert.equal(active.status,200,JSON.stringify(active.value));assert.equal(active.value.account.hostItems[0].id,'passkey-suggestion');
 // A new device (its own jar): start a sign-in; the link opened in yet another browser reveals a code; only the new device's S redeems it.
 const tv=s.jar(),phone=s.jar(),tvProofs=await createFlowSecret();
 const before=s.mail.length,tvFlow=await s.call('/api/auth/email/flow/start',{email:'person@mail.example',secretHash:tvProofs.secretHash,channelTag:tvProofs.channelTag,turnstileToken:CHALLENGE},{cookies:tv,ip:'203.0.113.40'});
 const link=await waitFor(()=>s.mail.slice(before).find(item=>item.purpose==='sign-in'));
 assert.equal((await s.call('/api/auth/email/link/inspect',{t:link.token},{cookies:phone,ip:'192.0.2.50'})).value.sameBrowser,false);
 const revealed=await s.call('/api/auth/email/link/reveal',{t:link.token,confirmed:true},{cookies:phone,ip:'192.0.2.50'});assert.match(revealed.value.code,/^\d{6}$/);
 assert.equal((await s.call('/api/auth/email/link/complete-here',{t:link.token,confirmed:true},{cookies:phone,ip:'192.0.2.50'})).value.error,'invalid_link');
 const wrong=await s.call('/api/auth/email/flow/redeem',{flowId:tvFlow.value.flowId,secret:tvProofs.secret,code:'000000'===revealed.value.code?'000001':'000000',confirmed:true},{cookies:tv,ip:'203.0.113.40'});assert.equal(wrong.value.error,'invalid_code');assert.equal(wrong.value.remaining,4);
 const signedIn=await s.call('/api/auth/email/flow/redeem',{flowId:tvFlow.value.flowId,secret:tvProofs.secret,code:revealed.value.code,confirmed:true},{cookies:tv,ip:'203.0.113.40'});
 assert.equal(signedIn.status,200,JSON.stringify(signedIn.value));assert.equal(signedIn.value.source,'email-cross-device');assert.equal(signedIn.value.account.id,pending.value.account.id);
 const session=await s.call('/api/session',undefined,{cookies:tv,method:'GET',headers:{'X-Bindle-Account':pending.value.account.id}});assert.equal(session.value.authenticated,true);
 assert.equal((await s.call('/api/session',undefined,{cookies:phone,method:'GET'})).value.authenticated,false,'the helper browser never got a session');
});

test('durable store: create, CAS, link pointers and expiry over transactional metadata and over identity shards',async()=>{
 const now=Date.now(),record={flowId:'A'.repeat(22),revision:0,expiresAt:now+900000,state:'pending',linkIndex:'L'.repeat(43)};
 const shards=new Map(),sharded=shardedEmailFlows(name=>{if(!shards.has(name))shards.set(name,new EmailFlowStorage(new MemoryMetadata()));return shards.get(name);});
 const viaShards={emailFlowCreate:r=>sharded.create(r),emailFlowGet:id=>sharded.get(id),emailFlowCompareAndSwap:(...a)=>sharded.compareAndSwap(...a),emailFlowPutLink:(...a)=>sharded.putLink(...a),emailFlowFindByLink:i=>sharded.findByLink(i)};
 for(const store of [new EmailFlowStorage(new MemoryMetadata()),viaShards]){
  assert.equal(await store.emailFlowCreate(record),true);assert.equal(await store.emailFlowCreate(record),false);
  assert.deepEqual(await store.emailFlowGet(record.flowId),record);
  assert.equal(await store.emailFlowCompareAndSwap(record.flowId,0,{...record,revision:1,state:'approved-same-browser'}),true);
  assert.equal(await store.emailFlowCompareAndSwap(record.flowId,0,{...record,revision:1,state:'redeemed'}),false,'stale revision');
  assert.equal(await store.emailFlowCompareAndSwap(record.flowId,1,{...record,revision:2,expiresAt:record.expiresAt+1}),false,'the expiry is immutable');
  assert.equal(await store.emailFlowPutLink(record.linkIndex,record.flowId,now+86400000),true);assert.equal(await store.emailFlowFindByLink(record.linkIndex),record.flowId);
  assert.equal(await store.emailFlowPutLink(record.linkIndex,'B'.repeat(22),now+86400000),false,'a pointer is immutable');
  assert.equal(await store.emailFlowGet('Z'.repeat(22)),null);assert.equal(await store.emailFlowFindByLink('Q'.repeat(43)),null);
  await assert.rejects(store.emailFlowCreate({...record,flowId:'bad'}),TypeError);
 }
 // The flow and its pointer route to their own shards (no write spans two shards).
 assert.ok([...shards.keys()].some(name=>name.startsWith('identity-v1/email-flow/'))&&[...shards.keys()].some(name=>name.startsWith('identity-v1/email-flow-link/')));
});

test('mail templates: the link only in the fragment, no requester text, the never-share warning, Spanish, link-free notices',async()=>{
 const {mailTransport}=await import('../apps/worker/email.mjs');
 const sent=[],env={APP_ORIGIN:'https://space.example',MAIL_ENABLED:'true',MAIL_SENDER_DOMAIN:'sys.3sln.me',BRAND_NAME:'3sln.me',EMAIL:{async send(message){sent.push(message);return {messageId:'accepted-'+sent.length};}}},transport=mailTransport(env),token='T'.repeat(43);
 await transport.sendEmailFlow({email:'a@inbox.example',token,purpose:'sign-in',issuer:env.APP_ORIGIN});
 assert.match(sent[0].text,new RegExp(`https://space\\.example/email/link#t=${token}`));assert.match(sent[0].text,/will ever ask you for a code/);assert.equal(sent[0].from,'login@sys.3sln.me');
 assert.equal(/Chrome|Windows|Berlin/.test(sent[0].text),false,'no requester-supplied text in mail');
 await transport.sendEmailFlow({email:'a@inbox.example',token,purpose:'sign-up',issuer:env.APP_ORIGIN,locale:'es'});
 assert.match(sent[1].subject,/Crea tu cuenta/);assert.match(sent[1].text,/email\/link\?lang=es#t=/);
 await transport.sendEmailFlow({email:'a@inbox.example',purpose:'notice-verified',issuer:env.APP_ORIGIN});assert.equal(sent[2].text.includes('/email/link'),false,'the notice has no link');
 await transport.sendEmailFlow({email:'a@inbox.example',purpose:'notice-closed',issuer:env.APP_ORIGIN});assert.match(sent[3].text,/console\?waitlist/);
 await assert.rejects(transport.sendEmailFlow({email:'a@inbox.example',token:'short',purpose:'sign-in',issuer:env.APP_ORIGIN}));
 await assert.rejects(transport.sendEmailFlow({email:'a@inbox.example',token,purpose:'notice-verified',issuer:env.APP_ORIGIN}),'a notice never carries a token');
 await assert.rejects(transport.sendEmailFlow({email:'a@inbox.example',token,purpose:'sign-in',issuer:'https://evil.example'}));
 for(const type of ['email-sign-in','email-sign-in-cancelled'])await transport.sendSecurityAlert({email:'a@inbox.example',type});
});
