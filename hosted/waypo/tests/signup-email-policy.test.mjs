import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedEmailSignupGuard,canonicalEmailDomain,validateHostedEmailSignupPolicy,PRIVACY_EMAIL_DOMAINS} from '../signup-email-policy.mjs';
test('hosted signup policy uses local domain boundaries and preserves forwarding aliases',()=>{
 const admit=createHostedEmailSignupGuard();
 for(const domain of ['mail.tm','fldubai.com','MAIL.TM','mail.tm.','sub.mail.tm','mail\u3002tm'])assert.equal(admit({email:'owner@'+domain}),false,domain);
 for(const domain of ['notmail.tm','mail.tm.example','ordinary.example',...PRIVACY_EMAIL_DOMAINS,...PRIVACY_EMAIL_DOMAINS.map(x=>'user.'+x)])assert.equal(admit({email:'owner@'+domain}),true,domain);
 assert.equal(admit({email:null}),true,'only trusted constructor maps validated no-email enrollment to null');
 for(const email of ['',undefined,'x@@mail.tm','x@ mail.tm','x@mail.tm/path','x@mail.tm%2e','x@[::1]','x@mail.tm..','x\n@mail.tm'])assert.equal(admit({email}),false,String(email));
 assert.equal(canonicalEmailDomain('BÜCHER.example.'),'xn--bcher-kva.example');
});
test('bounded versioned operator overrides use most-specific domain and validate collisions',()=>{
 const admit=createHostedEmailSignupGuard({revision:'incident-1',allowDomains:['MAIL.TM.'],denyDomains:['sub.mail.tm','duck.com']});
 assert.equal(admit({email:'a@mail.tm'}),true);assert.equal(admit({email:'a@sub.mail.tm'}),false);assert.equal(admit({email:'a@duck.com'}),false);
 for(const value of [{},{revision:'x',allowDomains:['mail.tm','MAIL.TM.']},{revision:'x',allowDomains:['mail.tm'],denyDomains:['MAIL.TM']},{revision:'x',denyDomains:Array(257).fill('a.example')},{revision:'x',extra:true}])assert.throws(()=>validateHostedEmailSignupPolicy(value));
});
