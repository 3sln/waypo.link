// Wargame 3 (2026-10-23) email-bridge regressions. F6: the pre-directory per-source bucket is charged only by refused
// lookups and a bucket exhausted by one colliding domain never locks out unrelated senders. F8: a reply the platform
// refuses (a forged sender failing DMARC) gives back the sender's 30-day cooldown with the other reply charges.
import test from 'node:test';
import assert from 'node:assert/strict';
import {world,rawMail,DOMAIN} from './email-bridge-helpers.mjs';
import {BRIDGE_LIMITS} from '../packages/email-bridge/index.mjs';

const hex=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const bucket=async d=>parseInt((await hex(`email-bridge-src-v1\0${d}`)).slice(0,2),16);
async function colliding(domain){const target=await bucket(domain);for(let n=0;;n++){const d=`s${n}.attacker.example`;if(await bucket(d)===target)return d;}}

test('F6: a domain colliding with gmail.com\'s source bucket cannot lock legitimate gmail.com senders out',async()=>{
 const dom=await colliding('gmail.com'),w=await world();await w.enable();
 const junk=rawMail({from:`x@${dom}`,to:`nobody@${DOMAIN}`});
 for(let i=0;i<BRIDGE_LIMITS.sourcePerHour;i++)assert.equal((await w.receive(junk,{from:`x@${dom}`,to:`nobody@${DOMAIN}`})).action,'reject');
 const legit=rawMail({from:'alice@gmail.com',header:'Alice <alice@gmail.com>'});
 assert.equal((await w.receive(legit,{from:'alice@gmail.com'})).action,'accept','an unrelated domain exhausted the shared bucket');
 // The colliding (SPF-passing) domain itself is now held to its own small refusal allowance, before any directory work.
 for(let i=0;i<BRIDGE_LIMITS.sourceDomainMissesPerHour;i++)await w.receive(junk,{from:`x@${dom}`,to:`nobody@${DOMAIN}`});
 const lookups=w.directoryCalls.length;await w.receive(junk,{from:`x@${dom}`,to:`nobody@${DOMAIN}`});
 assert.equal(w.directoryCalls.length,lookups,'the colliding domain keeps reaching the directory');
});

// Review follow-up 3: a forged envelope must not spend a real domain's exact-domain allowance.
test('F6 follow-up: forged gmail.com envelopes cannot exhaust gmail.com\'s exact-domain allowance',async()=>{
 const w=await world();await w.enable();
 const forged=rawMail({from:'x@gmail.com',to:`nobody@${DOMAIN}`,auth:'fail'}),opts={from:'x@gmail.com',to:`nobody@${DOMAIN}`};
 // Exhaust gmail.com's hash bucket, then keep going well past the exact-domain allowance.
 for(let i=0;i<BRIDGE_LIMITS.sourcePerHour+BRIDGE_LIMITS.sourceDomainMissesPerHour*2;i++)assert.equal((await w.receive(forged,opts)).action,'reject');
 const domainKey=`w/email-bridge/source-domain-v1/${(await hex('email-bridge-src-v1\0gmail.com')).slice(0,32)}`;
 assert.equal(await w.limiterStore.get(domainKey),undefined,'forged envelopes spent the exact-domain allowance');
 assert.equal((await w.limiterStore.get('w/email-bridge/source-unauthenticated-v1')).count,BRIDGE_LIMITS.sourceDomainMissesPerHour*2);
 // Real, SPF-aligned gmail.com mail to an opted-in recipient is still admitted.
 const legit=rawMail({from:'alice@gmail.com',header:'Alice <alice@gmail.com>'});
 assert.equal((await w.receive(legit,{from:'alice@gmail.com'})).action,'accept');
 // SPF pass for a different domain than the envelope is not aligned evidence.
 const unaligned=rawMail({from:'x@gmail.com',to:`nobody@${DOMAIN}`});
 const text=new TextDecoder().decode(unaligned).replace('smtp.mailfrom=x@gmail.com','smtp.mailfrom=attacker.example');
 await w.receive(new TextEncoder().encode(text),opts);assert.equal(await w.limiterStore.get(domainKey),undefined);
});

test('F6 follow-up: a directory exception charges no source allowance',async()=>{
 const w=await world();await w.enable();let fail=true;// the world directory resolves through the accounts map
 const original=w.accounts.get.bind(w.accounts);w.accounts.get=k=>{if(fail)throw new Error('directory down');return original(k);};
 for(let i=0;i<3;i++)assert.equal((await w.receive(rawMail(),{to:`ghost@${DOMAIN}`})).action,'reject');
 const key=`w/email-bridge/source-v1/${await bucket('sender.example')}`;
 assert.equal(await w.limiterStore.get(key),undefined,'a directory failure charged the source bucket');
 fail=false;await w.receive(rawMail(),{to:`ghost@${DOMAIN}`});assert.equal((await w.limiterStore.get(key)).count,1);
});

test('F6: eligible mail never spends the source bucket; only refused lookups charge it',async()=>{
 const w=await world();await w.enable();
 for(let i=0;i<5;i++)assert.equal((await w.receive(rawMail({messageId:`<ok${i}@sender.example>`,body:`ok ${i}`}))).action,'accept');
 const key=`w/email-bridge/source-v1/${await bucket('sender.example')}`;
 assert.equal(await w.limiterStore.get(key),undefined,'accepted mail charged the per-source bucket');
 await w.receive(rawMail(),{to:`ghost@${DOMAIN}`});assert.equal((await w.limiterStore.get(key)).count,1);
});

test('F8: a refused (forged) reply does not burn the real sender\'s cooldown',async()=>{
 let fail=true;const sent=[];
 const w=await world({sendReply:async r=>{if(fail)throw Object.assign(new Error('dmarc'),{code:'E_SENDER_NOT_VERIFIED'});sent.push(r);}});await w.enable();
 assert.equal((await w.receive(rawMail({messageId:'<forged@x.example>',body:'forged'}))).action,'accept');
 fail=false;w.clock.advance(3600000);
 assert.equal((await w.receive(rawMail({messageId:'<real@sender.example>',body:'real'}))).action,'accept');
 const ledger=(await w.rows(undefined,'reply/')).map(([,l])=>l.initial).sort();
 assert.deepEqual(ledger,['failed','sent']);assert.equal(sent.length,1,'the real sender got no auto-reply because the forged attempt consumed the cooldown');
});
