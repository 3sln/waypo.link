import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';
// Wargame 2026-10-23: on the Worker an unknown location (Cloudflare XX, Tor T1, or no country) blocks signup and paid
// checkout. The harness runs with LOCAL_DEVELOPMENT=true, whose default is allow-unknown, so the production policy is
// set explicitly here; tests/region-policy.test.mjs covers the default selection and a missing country (Miniflare
// merges its own default country into an empty `cf`).
const signupBody=handle=>({handle,method:'passkey',termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token',ageConfirmed:18,country:'US'});
test('real Worker blocks signup, paid checkout and organization checkouts from unknown, Tor and empty countries under block-unknown',async()=>{const h=await createHarness({bindings:{REGION_POLICY:'block-unknown'}});try{
 const post=(path,cf,value,headers={})=>h.mf.dispatchFetch(h.origin+path,{method:'POST',cf,headers:{Origin:h.origin,'Content-Type':'application/json','CF-IPCountry':'US',...headers},body:JSON.stringify(value)});
 for(const [label,cf] of [['XX',{country:'XX'}],['T1',{country:'T1'}],['empty',{country:''}]]){
  const requirement=(await(await h.mf.dispatchFetch(h.origin+'/api/config',{cf})).json()).ageRequirement;assert.equal(requirement.blocked,true,label);assert.equal(requirement.blockedReason,'region-unknown',label);
  const response=await post('/api/auth/signup',cf,signupBody('region_'+label.toLowerCase()));assert.equal(response.status,403,await response.clone().text());assert.equal((await response.json()).error,'signup_region_blocked');
 }
 assert.equal(await h.directory.findByHandle('region_xx'),null);
 // A known country still signs up; the same account's paid checkout from Tor is refused before billing.
 const start=await post('/api/auth/signup',{country:'US'},signupBody('region_known'));assert.equal(start.status,200,await start.clone().text());const pending=await start.json();
 assert.equal((await post('/api/auth/passkey/register',{country:'US'},{pendingToken:pending.pendingToken,response:await h.authenticator.register(pending.registrationOptions)})).status,200);
 const file=await(await post('/api/auth/recovery/download',{country:'US'},{pendingToken:pending.pendingToken})).json(),activation=await post('/api/auth/recovery/confirm',{country:'US'},{pendingToken:pending.pendingToken,recoveryToken:file.recoveryToken,downloadConfirmed:true});assert.equal(activation.status,200);
 const owner=await activation.json(),cookie=activation.headers.get('Set-Cookie').split(';')[0];
 const checkout=await post('/api/billing/checkout',{country:'T1'},{plan:'paid',ageConfirmed:18},{Cookie:cookie,'X-CSRF-Token':owner.csrfToken});assert.equal(checkout.status,403,await checkout.clone().text());assert.equal((await checkout.json()).error,'signup_region_blocked');
 const known=await post('/api/billing/checkout',{country:'US'},{plan:'paid',ageConfirmed:18},{Cookie:cookie,'X-CSRF-Token':owner.csrfToken});assert.equal((await known.json()).error,'billing_disabled');
 // Review M3: organization creation, renewal, claim and transfer-acceptance checkouts pass the same gate first.
 const org='0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b',auth={Cookie:cookie,'X-CSRF-Token':owner.csrfToken};
 for(const [path,value] of [['/api/orgs/checkout',{request:'r',plan:'org-team'}],[`/api/orgs/${org}/billing-checkout`,{plan:'org-team'}],[`/api/orgs/${org}/claim`,{plan:'org-team',confirm:true}],[`/api/orgs/${org}/transfer`,{operation:'accept',transfer:'t',confirm:true}]]){
  const tor=await post(path,{country:'T1'},{...value,ageConfirmed:18},auth);assert.equal(tor.status,403,path+' '+await tor.clone().text());assert.equal((await tor.json()).error,'signup_region_blocked');
  const unattested=await post(path,{country:'US'},value,auth);assert.equal(unattested.status,400,path);assert.equal((await unattested.json()).error,'age_confirmation_required');
 }
 const offer=await post(`/api/orgs/${org}/transfer`,{country:'T1'},{operation:'withdraw',transfer:'t',confirm:true},auth);assert.notEqual((await offer.json()).error,'signup_region_blocked','non-payment ownership steps are not checkouts');
}finally{await h.close();}});
