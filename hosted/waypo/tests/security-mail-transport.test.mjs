import test from 'node:test';import assert from 'node:assert/strict';
import {createHostedEmailTransport} from '../email-transport.mjs';
const main='https://identity.example',operation='A'.repeat(43),token='B'.repeat(43);
const message=purpose=>({to:'owner@mail.example',purpose,url:main+(purpose==='identity-passkey-addition'?'/passkeys/approve':'/sessions/approve')+'#'+new URLSearchParams({operation,token}),code:'00123456'});
test('security purposes use fixed account sender, exact main-origin templates and spend before one dispatch',async()=>{
 const charged=[],sent=[],deliver=createHostedEmailTransport({origin:main,trustedLoginOrigins:[main,'https://admin.identity.example'],requireEmailBudget:true,beforeEmailAttempt:async input=>{charged.push(input);return {admitted:true};},emailBinding:{send:async input=>{assert.equal(charged.length,sent.length+1);sent.push(input);return {messageId:'accepted'};}}});
 for(const purpose of ['identity-passkey-addition','identity-session-security']){assert.equal((await deliver(message(purpose))).status,'accepted');assert.equal(sent.at(-1).from.email,'account@account.waypo.link');assert.match(sent.at(-1).text,/00123456/);assert.equal(charged.at(-1).purpose,purpose);}
 const before=charged.length;
 for(const purpose of ['identity-passkey-addition','identity-session-security']){const m=message(purpose);for(const patch of [{url:m.url.replace(main,'https://admin.identity.example')},{url:m.url.replace(main,'https://wrong.example')},{url:m.url.replace('/approve','/other')},{url:m.url.replace('#','?x=1#')},{url:m.url+'&operation='+operation},{url:m.url.replace('operation=','flow=')},{url:m.url.replace(token,'short')},{purpose:purpose==='identity-passkey-addition'?'identity-session-security':'identity-passkey-addition'},{code:'1234567'},{subject:'caller-selected'},{from:'attacker@example.com'},{to:['owner@mail.example']}])await assert.rejects(deliver({...m,...patch}));}
 assert.equal(charged.length,before);assert.equal(sent.length,before);
});
test('failed security dispatch is charged once with no automatic retry; budget outage dispatches nothing',async()=>{
 let charges=0,sends=0;const options={origin:main,requireEmailBudget:true,beforeEmailAttempt:async()=>{charges++;return {admitted:true};},emailBinding:{send:async()=>{sends++;throw Error('uncertain dispatch');}}};
 assert.equal((await createHostedEmailTransport(options)(message('identity-session-security'))).status,'outage');assert.equal(charges,1);assert.equal(sends,1);
 assert.equal((await createHostedEmailTransport({...options,beforeEmailAttempt:async()=>{throw Error('budget outage');}})(message('identity-passkey-addition'))).status,'outage');assert.equal(charges,1);assert.equal(sends,1);
});

test('native acceptance deadline keeps uncertain debit spent and ignores late settlement without retry',async()=>{
 for(const outcome of ['never','late-success','late-rejection']){let charges=0,sends=0,settle;const deliver=createHostedEmailTransport({origin:main,requireEmailBudget:true,emailSendTimeoutMs:5,beforeEmailAttempt:async()=>{charges++;return {admitted:true};},emailBinding:{send:()=>{sends++;return new Promise((resolve,reject)=>{settle=()=>outcome==='late-rejection'?reject(Error('late native failure')):resolve({messageId:'late'});});}}});
 assert.deepEqual(await deliver(message('identity-session-security')),{status:'outage',code:'email_transport_unavailable'});assert.equal(charges,1);assert.equal(sends,1);if(outcome!=='never')settle();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(charges,1);assert.equal(sends,1);}
});

test('timed-out native work retains one exact-binding slot across recreated wrappers until real settlement',async()=>{
 let settle,sends=0,charges=0;const emailBinding={send:()=>{sends++;return new Promise(resolve=>settle=()=>resolve({messageId:'late'}));}},options={origin:main,emailBinding,requireEmailBudget:true,emailSendTimeoutMs:5,beforeEmailAttempt:async()=>{charges++;return {admitted:true};}};
 assert.equal((await createHostedEmailTransport(options)(message('identity-passkey-addition'))).status,'outage');
 for(let i=0;i<8;i++)assert.equal((await createHostedEmailTransport(options)(message('identity-session-security'))).status,'outage');
 assert.equal(sends,1);assert.equal(charges,1);settle();await new Promise(resolve=>setTimeout(resolve,0));
 emailBinding.send=async()=>{sends++;return {messageId:'next'};};assert.equal((await createHostedEmailTransport(options)(message('identity-session-security'))).status,'accepted');assert.equal(sends,2);assert.equal(charges,2);
});
