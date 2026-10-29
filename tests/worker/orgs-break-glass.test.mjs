// ORG-12b/12e on workerd: the Worker composition mounts the owner-channels adapter, the sign-in hook and the break-glass
// routes. A passkey sign-in runs the hook (one read of the person's hint rows; nothing to signal); the abort page has
// strict headers and changes nothing on GET; the abort POST needs no session, answers a well-formed unknown link with the
// same {received:true}, refuses another origin and keeps its own per-address budget; the organization routes refuse an
// unknown organization with the uniform 404. Creating an organization needs paid checkout or an allowlisted creator id,
// so the claim flows run on the Node runtime (tests/orgs-break-glass-runtime.test.mjs) over the same controllers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';

const GHOST='12345678-1234-4123-8123-123456789abc',TOKEN=`bg1.${GHOST}.${GHOST}.${'A'.repeat(43)}`;
test('Worker: sign-in hook, the abort page and POST, and break-glass routes for an unknown organization',async t=>{
 const h=await createHarness({bindings:{ORGANIZATIONS_ENABLED:'true',ORG_BREAK_GLASS_ENABLED:'true'}});t.after(()=>h.close());
 const {cookie,result}=await h.signup(),handle=result.account.handle;
 // Sign in again with the passkey: the hook runs in the background and the sign-in succeeds as before.
 const login=await h.passkeyLogin(handle);assert.equal(login.status,200,await login.clone().text());
 const items=await h.request('/api/orgs/break-glass',{headers:{Cookie:cookie}});assert.equal(items.status,200);assert.deepEqual(await items.json(),{items:[]});
 for(const path of [`/api/orgs/${GHOST}/break-glass`])assert.equal((await h.request(path,{headers:{Cookie:cookie}})).status,404);
 const page=await h.request('/org-claim/abort');assert.equal(page.status,200);assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.equal(page.headers.get('Referrer-Policy'),'no-referrer');assert.match(await page.text(),/Stop this claim/);
 assert.match(await (await h.request('/org-claim/abort?lang=es')).text(),/Detener esta reclamación/);
 assert.equal((await h.request('/org-claim/abort?token=x')).status,400);
 const rendered=/<meta name="bindle-rendered" content="([^"]+)">/.exec(await (await h.request('/org-claim/abort')).text())[1];await new Promise(r=>setTimeout(r,2100));
 const post=(value,headers={Origin:h.origin})=>h.request('/api/org-claim/abort',{method:'POST',value:{rendered,...value},headers});
 assert.equal((await post({org:GHOST,token:TOKEN,confirmed:'stop'},{Origin:'https://outside.example'})).status,403);
 const first=await post({org:GHOST,token:TOKEN,confirmed:'stop'});assert.equal(first.status,200);assert.deepEqual(await first.json(),{received:true});
 assert.equal((await post({org:GHOST,token:TOKEN,confirmed:'acme'})).status,400,'the typed confirmation must match');
 const statuses=[];for(let i=0;i<6;i++)statuses.push((await post({org:GHOST,token:TOKEN,confirmed:'stop'})).status);
 assert.ok(statuses.includes(429),'the per-address budget: '+statuses.join());
});
