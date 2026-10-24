// Wargame 2026-10-23: a paid-signup checkout whose creation outcome is unknown is rechecked after the provider session
// horizon, a bounded number of times, instead of staying locked at outcome_unknown forever.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {PaidSignupBilling} from '../packages/billing/setup.mjs';
import {signupPriceDigest} from '../packages/billing/signup.mjs';
// Mirrors CHECKOUT_RECHECK_MS and MAX_RECHECKS in packages/billing/setup.mjs (literal, so a reverted fix fails by assertion).
const CHECKOUT_RECHECK_MS=3600000,MAX_RECHECKS=3,DAY=86400000,ids=['paid','plus','ultra'],owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function signupFixture(){const metadata=new SqliteMetadata(':memory:'),now=1700000000000,admission={version:1,kind:'paid',plan:'paid',incarnation:crypto.randomUUID(),checkoutStartUntil:now+30*DAY};let time=now,calls=0,fail=true;const catalog={organizationId:'org',entries:Object.fromEntries(ids.map(id=>[id,{id:id+'-product',parameters:{id,name:id,storageBytes:5e9,activityHour:2000,activityDay:10000},prices:{usd:{priceId:id+'-price',currency:'usd',amount:500,exponent:2}}}]))};const billing={config:{APP_ORIGIN:'https://signup.example',POLAR_SERVER:'sandbox'},metadata,now:()=>time,catalog:async()=>catalog,selection:(catalog,{currency='usd'})=>({catalog,currency}),checkout:async()=>{calls++;if(fail)throw Object.assign(Error('timeout'),{code:'billing_provider_unavailable'});return {url:'https://sandbox.polar.sh/checkout/test'};},reconcile:async()=>({plan:'free'})};return {metadata,admission,service:new PaidSignupBilling(billing),get calls(){return calls;},succeed:()=>fail=false,advance:ms=>time+=ms,input:async()=>({requestId:crypto.randomUUID(),currency:'usd',priceDigest:await signupPriceDigest(billing.config,catalog,'paid','usd')})};}
test('paid signup: an outcome_unknown checkout is rechecked after the session horizon, a bounded number of times',async()=>{const f=signupFixture();try{
 await assert.rejects(f.service.checkout(owner,f.admission,await f.input()),{code:'billing_provider_unavailable'});
 assert.equal((await f.service.checkout(owner,f.admission,await f.input())).status,'outcome_unknown');
 const locked=await f.service.status(owner,f.admission);assert.equal(locked.status,'outcome_unknown');assert.equal(locked.recheckAt,1700000000000+CHECKOUT_RECHECK_MS);
 f.advance(CHECKOUT_RECHECK_MS);assert.equal((await f.service.status(owner,f.admission)).status,'payment_required');
 for(let i=2;i<=MAX_RECHECKS;i++){await assert.rejects(f.service.checkout(owner,f.admission,await f.input()),{code:'billing_provider_unavailable'});f.advance(CHECKOUT_RECHECK_MS);}
 f.succeed();const ready=await f.service.checkout(owner,f.admission,await f.input());assert.equal(ready.status,'checkout_ready');assert.equal(f.calls,MAX_RECHECKS+1);
}finally{f.metadata.close();}});
test('paid signup: rechecks are bounded and never run inside the session horizon',async()=>{const f=signupFixture();try{
 await assert.rejects(f.service.checkout(owner,f.admission,await f.input()));
 for(let i=1;i<=MAX_RECHECKS;i++){f.advance(CHECKOUT_RECHECK_MS-1);assert.equal((await f.service.checkout(owner,f.admission,await f.input())).status,'outcome_unknown');f.advance(1);await assert.rejects(f.service.checkout(owner,f.admission,await f.input()));}
 f.advance(CHECKOUT_RECHECK_MS*10);assert.equal((await f.service.checkout(owner,f.admission,await f.input())).status,'outcome_unknown');assert.equal((await f.service.status(owner,f.admission)).status,'outcome_unknown');assert.equal(f.calls,MAX_RECHECKS+1);
}finally{f.metadata.close();}});
