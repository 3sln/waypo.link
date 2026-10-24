// Red-team round 3 L2: POST /api/contacts/redeem decodes the UNVERIFIED `sig` payload and calls devices(env, claims.sub) before the
// link is verified. An inactive or unknown subject answers 409 beam_device_unavailable; an active subject reaches
// verification and answers 401 unauthorized. Any signed-in user can therefore test whether a known account UUID is
// active, suspended, moved or deleted, with a forged link (U404: unknown/suspended/deleted targets are uniform).
// L2b (plain bug, same route): a genuine new-form (bindle_meta) link can never be redeemed (only `sig` is decoded).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const {createNodeServer}=await import('../apps/node/server.mjs');
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const origin='http://localhost:8788';
let app,directory,attacker,victim,req;
test.before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'redeem-oracle-'));let network=1;
 app=await createNodeServer({directory,config:{WORK_LIMITS_ENABLED:'false'}});
 req=async(path,{user,method='GET',value}={})=>app.fetch(new Request(origin+path,{method,headers:{'CF-Connecting-IP':'192.0.2.'+network++,...user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf,Origin:origin}:{},...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}}));
 const signup=async handle=>{const post=(path,value)=>req(path,{method:'POST',value,user:{cookie:'',csrf:''}});const pending=await (await post('/api/auth/signup',{handle,method:'password',password:'Redeem oracle fixture long password!',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();assert.ok(pending.pendingToken,JSON.stringify(pending));const recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();const r=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}),session=await r.json();return {cookie:r.headers.get('Set-Cookie').split(';')[0],csrf:session.csrfToken,owner:session.account.id};};
 attacker=await signup('redeem_attacker');victim=await signup('redeem_victim');
});
test.after(async()=>{await app?.close();await rm(directory,{recursive:true,force:true});});
const forged=(handle,sub)=>{const jti=crypto.randomUUID(),aud=`${origin}/users/${handle}/contact/${jti}`;return `${aud}?sig=${b64({alg:'ES256',kid:'k',typ:'bindle-contact-endpoint+jwt'})}.${b64({iss:origin,sub,aud,jti})}.${Buffer.alloc(64,1).toString('base64url')}`;};
test('contact redemption with a forged link does not reveal whether the named account is active',async()=>{
 const active=await req('/api/contacts/redeem',{user:attacker,method:'POST',value:{url:forged('redeem_victim',victim.owner)}});
 const unknown=await req('/api/contacts/redeem',{user:attacker,method:'POST',value:{url:forged('nobody',crypto.randomUUID())}});
 const at=await active.text(),ut=await unknown.text();
 assert.equal(unknown.status,active.status,`active account answers ${active.status} ${at}; unknown answers ${unknown.status} ${ut}`);
 assert.equal(ut,at);
});
test('a genuine bindle_meta contact link can be redeemed over HTTP',async()=>{
 const created=await req('/api/contact-links',{user:victim,method:'POST',value:{name:'Beam me',mimeTypes:['text/plain'],expiresAt:Date.now()+3600000,maxMessages:5}});
 const link=await created.json();assert.equal(created.status,200,JSON.stringify(link));
 const redeemed=await req('/api/contacts/redeem',{user:attacker,method:'POST',value:{url:link.url}});
 assert.equal(redeemed.status,200,`bindle_meta link redemption: ${redeemed.status} ${await redeemed.text()}`);
});
test('every refusal before verification is the same answer (malformed, foreign, handle mismatch, legacy and new forms)',async()=>{
 const baseline=await req('/api/contacts/redeem',{user:attacker,method:'POST',value:{url:forged('nobody',crypto.randomUUID())}}),expected=[baseline.status,await baseline.text()];
 const jti=crypto.randomUUID(),aud=`${origin}/users/redeem_victim/contact/${jti}`,now=Math.floor(Date.now()/1000);
 const meta=`${b64({alg:'ES256',kid:'k',typ:'bindle-link-meta+jwt'})}.${b64({bindle:'link-meta',v:1,type:'https://spec.bindle.example/links/contact/v1',iss:origin,aud,jti,iat:now,exp:now+3600,sub:victim.owner})}.${Buffer.alloc(64,1).toString('base64url')}`;
 for(const url of ['not a url','https://elsewhere.example/users/x/contact/'+jti,forged('someone_else',victim.owner),`${aud}?bindle_meta=${meta}`,`${aud}?bindle_meta=${meta}&utm=1&sig=x`]){
  const r=await req('/api/contacts/redeem',{user:attacker,method:'POST',value:{url}});assert.deepEqual([r.status,await r.text()],expected,url);
 }
});
