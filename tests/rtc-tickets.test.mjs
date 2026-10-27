// RTC-a: rtc-ticket/v1 meta payloads, callback tickets and canonical basis links (docs/spec/rtc-signaling.md §4.2, §4.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTicketClaims,validateCallbackTicket,ticketAdmits,ticketLifetime,canonicalBasisLink,linkMatchesDigest,linkDigest,RTC_TICKET_TYPE,TICKET_MAX_SECONDS} from '../packages/rtc/tickets.mjs';
import {RTC_PURPOSE_REFERENCES} from '../packages/rtc/purposes.mjs';
import {forEachSeed} from './helpers/chaos.mjs';

const [CALL,SCREEN,FILES]=RTC_PURPOSE_REFERENCES.map(r=>r.artefact),sorted=[CALL,FILES,SCREEN].sort();
const BOB={iss:'https://b.example',sub:'00000000-0000-4000-8000-00000000000b'},CAROL={iss:'https://c.example',sub:'00000000-0000-4000-8000-00000000000c'};
const claims=(extra={})=>({bindle:'link-meta',v:1,type:RTC_TICKET_TYPE,iss:'https://a.example',aud:'https://a.example/rtc/t',jti:'ticket-1',iat:1000,exp:1000+3600,sub:'00000000-0000-4000-8000-00000000000a',purposes:[CALL],uses:1,principal:null,...extra});
const code={code:'rtc_ticket_invalid'};

test('ticket meta payload: exact members, purposes, uses, principal and the 30-day lifetime',()=>{
 validateTicketClaims(claims());validateTicketClaims(claims({purposes:sorted,uses:1000,principal:BOB,exp:1000+TICKET_MAX_SECONDS}));
 for(const [extra,label] of [[{exp:1001+TICKET_MAX_SECONDS},'over 30 days'],[{exp:1000},'exp after iat'],[{uses:0}],[{uses:1001}],[{uses:1.5}],[{purposes:[]}],[{purposes:[SCREEN,CALL]},'ascending'],[{purposes:[CALL,CALL]}],[{purposes:Array.from({length:9},(_,i)=>`https://spec.bindle.example/p/${i}`).sort()},'at most 8'],[{purposes:['https://x.example/p?q']}],
  [{principal:{iss:'https://b.example'}}],[{principal:{...BOB,extra:1}}],[{principal:{iss:'http://b.example',sub:BOB.sub}}],[{type:'https://spec.bindle.example/links/contact/v1'}],[{bindle:'link-data'}],[{v:2}],[{aud:'https://other.example/rtc/t'},'aud under iss'],[{sub:'bob'}],[{extra:1}]])
  assert.throws(()=>validateTicketClaims(claims(extra)),code,label??JSON.stringify(extra));
 const missing=claims();delete missing.principal;assert.throws(()=>validateTicketClaims(missing),code);
 assert.equal(ticketLifetime(10),10);assert.equal(ticketLifetime(TICKET_MAX_SECONDS*2),TICKET_MAX_SECONDS);assert.equal(ticketLifetime(0),null);
});

test('callback tickets are one-use, bound to the callee, at most 24 h; admission compares only verified principals',()=>{
 validateCallbackTicket(claims({principal:BOB,exp:1000+86400}),{callee:BOB});
 for(const extra of [{principal:BOB,uses:2},{principal:BOB,exp:1001+86400},{principal:null},{principal:CAROL}])assert.throws(()=>validateCallbackTicket(claims(extra),{callee:BOB}),code,JSON.stringify(extra));
 const bound=claims({principal:BOB,purposes:sorted});assert.ok(ticketAdmits(bound,{purpose:CALL,principal:BOB}));assert.ok(!ticketAdmits(bound,{purpose:CALL,principal:CAROL}));assert.ok(!ticketAdmits(bound,{purpose:'https://spec.bindle.example/rtc-purposes/x/v1',principal:BOB}));
 assert.ok(ticketAdmits(claims(),{purpose:CALL,principal:CAROL}),'principal null admits any verified identity');assert.ok(!ticketAdmits(bound,{purpose:CALL}),'an unverified caller never matches');
});

test('basis links are canonical (meta or legacy sig only) and match their digest',async()=>{
 const link='https://a.example/users/al/contact/x?bindle_meta=eyJh.eyJi.c2ln';assert.equal(canonicalBasisLink(link,{origin:'https://a.example'}),link);assert.equal(canonicalBasisLink('https://a.example/c?sig=a.b.c'),'https://a.example/c?sig=a.b.c');
 for(const bad of [link+'&bindle_data=x',link+'#f',link.replace('bindle_meta','bindle_data'),link+'&utm=1','http://a.example/x?bindle_meta=a.b.c','https://u:p@a.example/x?bindle_meta=a.b.c','https://a.example/x','https://a.example/x?bindle_meta=a%2Eb',null,'x'.repeat(9000)])assert.equal(canonicalBasisLink(bad),null,String(bad).slice(0,60));
 assert.equal(canonicalBasisLink(link,{origin:'https://b.example'}),null,'the link must be this provider’s');
 const digest=await linkDigest(link);assert.ok(await linkMatchesDigest(link,digest,{origin:'https://a.example'}));assert.ok(!await linkMatchesDigest(link+'x',digest));assert.ok(!await linkMatchesDigest(link+'&x=1',await linkDigest(link+'&x=1')),'non-canonical never matches');
});

test('seeded: random ticket edits keep the validator total and every accepted ticket within bounds',async()=>{
 const mutations=[c=>{c.uses=[-1,0,1,999,1000,1001,2.5][c.n%7];},c=>{c.exp=c.iat+[1,86400,TICKET_MAX_SECONDS,TICKET_MAX_SECONDS+1,0][c.n%5];},c=>{c.purposes=[[CALL],[SCREEN,CALL],[],[CALL,CALL],sorted][c.n%5];},c=>{c.principal=[null,BOB,{iss:BOB.iss},'x'][c.n%4];}];
 await forEachSeed(60,async random=>{const c=claims(),n=random.int(1000);c.n=n;random.pick(mutations)(c);delete c.n;let ok=true;try{validateTicketClaims(c);}catch(e){ok=false;assert.equal(e.code,'rtc_ticket_invalid');}
  if(ok){assert.ok(c.uses>=1&&c.uses<=1000&&Number.isInteger(c.uses));assert.ok(c.exp>c.iat&&c.exp-c.iat<=TICKET_MAX_SECONDS);assert.ok(c.purposes.length>=1&&new Set(c.purposes).size===c.purposes.length);}});
});

test('review: principals honour allowLoopback like every other origin (local development only)',()=>{
 const local={iss:'http://localhost:8787',sub:BOB.sub},base={iss:'http://localhost:8787',aud:'http://localhost:8787/rtc/t'};
 assert.throws(()=>validateTicketClaims(claims({principal:local})),code,'loopback refused by default');
 validateTicketClaims(claims({...base,principal:local}),{allowLoopback:true});
 validateCallbackTicket(claims({...base,principal:local,exp:1000+86400}),{callee:local,allowLoopback:true});
 assert.throws(()=>validateCallbackTicket(claims({principal:local,exp:1000+86400}),{callee:local}),code);
});
