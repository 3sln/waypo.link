// RTC-a: message, SDP, candidate, IP-policy and batch codecs (docs/spec/rtc-signaling.md §6, §8.1, §8.2 step 1, §10).
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMessage,verifyMessage,validateMessagePayload,validateMessageContent,validateSdp,parseCandidate,validateCandidateItem,candidateAllowedByPolicy,defaultIpPolicy,messageAllowedBeforeClaim,roleMaySend,iatWithinWindow,sidValid,compareSid,mediaValid,parseBatch,batchStep1,buildBatch,linkDigest,firstSha256Fingerprint,nonPublicAddress,mdnsName,RTC_LIMITS} from '../packages/rtc/messages.mjs';
import {parseLegCertificate,parseControl,signControl} from '../packages/rtc/certificates.mjs';
import {signRtcJws,lowS,RTC_MESSAGE_TYP,RTC_LEG_CERTIFICATE_TYP,RtcWireFault} from '../packages/rtc/jws.mjs';
import {fromBase64url} from '../packages/core/records.mjs';
import {base64url,textEncoder} from '../packages/core/records.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
import {party,payload,invite,sign,sdp,candidate,item,now,ALICE,BOB,SID,SID2,CALL,keyPair} from './helpers/rtc-wire-fixture.mjs';

const code=c=>({code:c});
const caller=await party(ALICE,{role:'caller',peer:BOB}),callee=await party(BOB,{role:'callee',peer:ALICE});
const enc=v=>base64url(textEncoder.encode(typeof v==='string'?v:JSON.stringify(v)));
// Raw WebCrypto signing (no normalization); retried until low-S, which the profile requires (review L3).
const raw=async(header,claims,key=caller.leg.privateKey)=>{const head=`${enc(header)}.${enc(claims)}`;let sig;do sig=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,textEncoder.encode(head)));while(!lowS(sig));return `${head}.${base64url(sig)}`;};
const hdr=(extra={})=>({alg:'ES256',kid:caller.leg.jkt,typ:RTC_MESSAGE_TYP,...extra});

test('every message type parses and verifies under its leg certificate; roles are enforced',async()=>{
 const cases=[[caller,'invite',invite()],[caller,'cancel',{}],[callee,'accept',{answer:null,sas_nonce:null}],[callee,'decline',{reason:'busy'}],[caller,'sdp',{gen:1,description:{type:'offer',sdp:sdp()}}],[callee,'sdp',{gen:2,description:{type:'rollback',sdp:''}}],[callee,'candidates',{gen:0,items:[item()],complete:false}],[caller,'candidates',{gen:0,items:[],complete:true}],[caller,'sas',{nonce:base64url(new Uint8Array(32).fill(7))}],[callee,'end',{reason:'hangup'}]];
 for(const [p,type,body]of cases){const claims=payload(p,type,body),parsed=parseMessage(await sign(p,claims));assert.deepEqual(await verifyMessage(parsed,p.verified,{now}),claims,type);}
 assert.equal(roleMaySend('callee','invite'),false);assert.equal(roleMaySend('caller','accept'),false);assert.equal(roleMaySend('callee','sas'),false);assert.equal(roleMaySend('caller','end'),true);assert.equal(roleMaySend('observer','end'),false);
 // A callee leg's certificate cannot carry a caller-only type, even when correctly signed.
 const wrong=await sign(callee,payload(callee,'cancel',{}));await assert.rejects(verifyMessage(parseMessage(wrong),callee.verified,{now}),code('rtc_message_invalid'));
 const sas=await sign(callee,payload(callee,'sas',{nonce:base64url(new Uint8Array(32))}));await assert.rejects(verifyMessage(parseMessage(sas),callee.verified,{now}),code('rtc_message_invalid'));
});

test('payload rules: exact members, seq 0 only for the first message, `to`, sid, ring window and body members',()=>{
 const ok=payload(caller,'invite',invite()),bad=(edit,label)=>{const v=structuredClone(ok);edit(v);assert.throws(()=>validateMessagePayload(v),code('rtc_message_invalid'),label);};
 validateMessagePayload(ok);
 bad(v=>{v.extra=1;},'unknown member');bad(v=>{delete v.iat;},'missing member');bad(v=>{v.bindle='rtc-messages';});bad(v=>{v.v=2;},'unknown v');bad(v=>{v.type='ring';},'unknown type');
 bad(v=>{v.seq=1;},'invite is seq 0');bad(v=>{v.to=caller.leg.jkt;},'invite has to null');bad(v=>{v.seq=0.5;});bad(v=>{v.iat=-1;});
 bad(v=>{v.sid='A'.repeat(21);},'sid too short');bad(v=>{v.sid='A'.repeat(44);},'sid too long');bad(v=>{v.sid='AAAAAAAAAAAAAAAAAAAAAB';},'noncanonical trailing bits');bad(v=>{v.sid='AAAA+AAAAAAAAAAAAAAAAA';});
 bad(v=>{v.leg='x';});bad(v=>{v.iss='https://a.example/';});bad(v=>{v.iss='http://a.example';});bad(v=>{v.sub='ALICE';});bad(v=>{v.aud='https://b.example/x?y=1';});bad(v=>{v.aud='https://b.example/x#f';});
 bad(v=>{v.body.ring_until=now+121;},'ring at most 120 s');bad(v=>{v.body.ring_until=now;},'ring after iat');bad(v=>{v.body.media=['video','audio'];},'ascending');bad(v=>{v.body.media=[];});bad(v=>{v.body.media=['audio','audio'];});bad(v=>{v.body.media=['hologram'];});
 bad(v=>{v.body.basis={link_digest:'x'};});bad(v=>{v.body.basis={link_digest:base64url(new Uint8Array(32)),link:'https://x'};},'only the digest is signed');bad(v=>{v.body.callback_digest='short';});bad(v=>{v.body.sas_commit=base64url(new Uint8Array(31));});
 bad(v=>{v.body.context=Object.fromEntries(Array.from({length:9},(_,i)=>['k'+i,i]));},'context bounded');bad(v=>{v.body.purpose={...CALL,version:0};});bad(v=>{v.body.purpose={...CALL,digest:'sha1-x'};});bad(v=>{v.body.purpose={...CALL,purpose:'https://x.example/p?q'};});bad(v=>{v.body.offer={type:'offer',sdp:''};});bad(v=>{delete v.body.sas_commit;});
 const other=(type,body,edit)=>{const v=payload(callee,type,body);edit?.(v);return ()=>validateMessagePayload(v);};
 assert.throws(other('accept',{answer:null,sas_nonce:null},v=>{v.seq=1;}),code('rtc_message_invalid'),'accept is seq 0');
 assert.throws(other('sdp',{gen:1,description:{type:'offer',sdp:sdp()}},v=>{v.seq=0;}),code('rtc_message_invalid'),'only first messages are seq 0');
 assert.throws(other('sdp',{gen:1,description:{type:'offer',sdp:sdp()}},v=>{v.to=null;}),code('rtc_message_invalid'),'to null only for invite/cancel');
 assert.throws(other('sdp',{gen:1,description:{type:'offer',sdp:sdp()}},v=>{v.seq=RTC_LIMITS.maxSeq+1;}),code('rtc_message_invalid'));
 assert.throws(other('sdp',{gen:1,description:{type:'rollback',sdp:sdp()}}),code('rtc_message_invalid'),'rollback has empty sdp');
 assert.throws(other('sdp',{gen:1,description:{type:'answer',sdp:''}}),code('rtc_message_invalid'));
 assert.throws(other('decline',{reason:'nope'}),code('rtc_message_invalid'));assert.throws(other('end',{reason:'bye'}),code('rtc_message_invalid'));
 assert.throws(other('candidates',{gen:0,items:Array.from({length:17},()=>item()),complete:false}),code('rtc_message_invalid'),'at most 16 candidates');
 assert.throws(()=>validateMessagePayload(payload(caller,'cancel',{x:1})),code('rtc_message_invalid'));
 assert.throws(()=>validateMessagePayload({...payload(caller,'cancel',{}),to:caller.leg.jkt}),code('rtc_message_invalid'),'cancel has to null');
});

test('JWS profile: typ, exact header, canonical segments, strict JSON, 64-byte signature, size bound, kid = leg',async()=>{
 const claims=payload(caller,'cancel',{});const good=await raw(hdr(),claims);parseMessage(good);
 for(const [label,compact] of [
  ['leg certificate typ',await raw(hdr({typ:RTC_LEG_CERTIFICATE_TYP}),claims)],['extra jku',await raw({...hdr(),jku:'https://x'},claims)],['alg',await raw(hdr({alg:'ES384'}),claims)],['alg none',await raw(hdr({alg:'none'}),claims)],
  ['kid not the leg',await raw(hdr({kid:callee.leg.jkt}),claims)],['padded',good.replace(/\.([^.]+)$/,'.$1==')],['two parts',good.split('.').slice(0,2).join('.')],['short signature',good.slice(0,-3)],
  ['duplicate member',`${enc(hdr())}.${enc(JSON.stringify(claims).replace('{','{"seq":1,'))}.${good.split('.')[2]}`],['lone surrogate',`${enc(hdr())}.${enc(JSON.stringify(claims).replace('"cancel"','"\\ud800"'))}.${good.split('.')[2]}`],
  ['negative zero',`${enc(hdr())}.${enc(JSON.stringify(claims).replace('"seq":1','"seq":-0'))}.${good.split('.')[2]}`],['non-object payload',`${enc(hdr())}.${enc('[1]')}.${good.split('.')[2]}`],['not a string',null]
 ])assert.throws(()=>parseMessage(compact),code('rtc_message_invalid'),label);
 // Deep nesting (> 8) is refused by the strict parser.
 const deep=payload(caller,'invite',invite({context:{a:{b:{c:{d:{e:{f:{g:1}}}}}}}}));assert.throws(()=>parseMessage(`${enc(hdr())}.${enc(deep)}.${good.split('.')[2]}`),code('rtc_message_invalid'));
 // Oversized messages are refused before parsing.
 const big=payload(caller,'sdp',{gen:1,description:{type:'offer',sdp:'v=0\r\n'+'a=x:'.padEnd(RTC_LIMITS.messageBytes,'y')+'\r\n'}});const bigCompact=await raw(hdr(),big);assert.throws(()=>parseMessage(bigCompact),code('rtc_message_invalid'));
});

test('verification binds leg, sender, aud, sid, purpose, signature and the receipt window',async()=>{
 const claims=payload(caller,'invite',invite()),parsed=parseMessage(await sign(caller,claims));
 const variant=edit=>({...caller.verified,payload:{...caller.verified.payload,...edit}});
 await assert.rejects(verifyMessage(parsed,variant({aud:'https://c.example/entities/x'}),{now}),code('rtc_message_invalid'));
 await assert.rejects(verifyMessage(parsed,variant({sid:SID2}),{now}),code('rtc_message_invalid'),'replayed into another session');
 await assert.rejects(verifyMessage(parsed,variant({sub:BOB.sub}),{now}),code('rtc_message_invalid'));
 await assert.rejects(verifyMessage(parsed,variant({purpose:{...CALL,version:2}}),{now}),code('rtc_message_invalid'),'invite purpose must match the certificate');
 await assert.rejects(verifyMessage(parsed,variant({cnf:{jkt:callee.leg.jkt}}),{now}),code('rtc_message_invalid'),'leg must equal cnf.jkt');
 // Signed by a different key under the right kid: signature fails.
 const forged=parseMessage(await raw(hdr(),claims,(await keyPair()).privateKey));await assert.rejects(verifyMessage(forged,caller.verified,{now}),code('rtc_signature_invalid'));
 // Receipt window: 120 s past and 30 s future are inside; one second more is not.
 assert.ok(iatWithinWindow(now-120,now)&&iatWithinWindow(now+30,now));assert.ok(!iatWithinWindow(now-121,now)&&!iatWithinWindow(now+31,now));
 await assert.rejects(verifyMessage(parsed,caller.verified,{now:now+121}),code('rtc_message_stale'));await assert.rejects(verifyMessage(parsed,caller.verified,{now:now-31}),code('rtc_message_stale'));
});

test('SDP rules (§6.3): every MUST, with address leakage attempts',()=>{
 const media=['data'];validateSdp(sdp(),{media});validateSdp(sdp({media:['audio','video']}),{media:['audio','screen']});validateSdp(sdp({origin:'o=- 1 2 IN IP6 ::1'}),{media});
 assert.equal(firstSha256Fingerprint(sdp()).length,32);
 const lines=s=>s.split('\r\n');const bad=(value,label,m=media)=>assert.throws(()=>validateSdp(value,{media:m}),code('rtc_sdp_invalid'),label);
 bad(sdp({extra:['a=candidate:1 1 udp 2122260223 192.168.1.4 54321 typ host']}),'a=candidate');bad(sdp({extra:['a=remote-candidates:1 192.168.1.4 54321']}),'remote-candidates');bad(sdp({extra:['a=end-of-candidates']}),'end-of-candidates');
 bad(sdp({trickle:null}),'trickle required');bad(sdp({trickle:'a=ice-options:renomination'}),'trickle token required');
 bad(sdp().replace('c=IN IP4 0.0.0.0','c=IN IP4 192.168.1.5'),'c= address');bad(sdp().replace('c=IN IP4 0.0.0.0','c=IN IP6 2001:db8::1'),'c= IPv6 address');bad(sdp().replace('c=IN IP4 0.0.0.0','c=IN IP4 0.0.0.0/127'),'c= ttl form');
 bad(sdp({media:['audio']}).replace('a=rtcp:9 IN IP4 0.0.0.0','a=rtcp:9 IN IP4 198.51.100.9'),'a=rtcp address',['audio']);
 bad(sdp({origin:'o=- 1 2 IN IP4 198.51.100.9'}),'o= public address');bad(sdp({origin:'o=- 1 2 IN IP4 10.0.0.2'}),'o= private address');bad(sdp({origin:'o=- 1 2 IN IP4 127.0.0.1 extra'}));
 bad(sdp({media:['video']}),'video needs video/screen media');bad(sdp({media:['audio']}),'audio not negotiated');bad(sdp({media:['message']}),'unknown m= type',['audio','data','video']);
 bad(sdp({fingerprint:null}),'fingerprint required');bad(sdp({fingerprint:'a=fingerprint:sha-1 '+'AB:'.repeat(19)+'AB'}),'sha-1 refused');bad(sdp({fingerprint:'a=fingerprint:sha-256 AB:CD'}),'fingerprint length');
 bad(sdp({fingerprint:`a=fingerprint:sha-256 ${'AB:'.repeat(31)}AB`,extra:['a=fingerprint:md5 '+'AB:'.repeat(15)+'AB']}),'any weak fingerprint');
 bad(sdp().replaceAll('\r\n','\n'),'bare LF');bad(sdp().slice(0,-2),'final CRLF');bad(sdp().replace('s=-','s=-\rx'),'bare CR');bad(sdp().replace('s=-','s=\u0000'),'NUL');
 bad(sdp({extra:['a=x-relay:10.1.2.3']}),'smuggled IPv4 literal');bad(sdp({extra:['a=x-origin:IN IP4 0.0.0.0']}),'address token elsewhere');
 bad(lines(sdp()).filter(l=>!l.startsWith('m=')).join('\r\n'),'needs an m= line');bad(sdp().replace('s=-','o=- 9 9 IN IP4 127.0.0.1\r\ns=-'),'one o= line');bad('x'+sdp(),'starts with v=0');
 bad(sdp({extra:['a=x:'+'y'.repeat(RTC_LIMITS.sdpBytes)]}),'oversized');bad(sdp(),'media must be valid',['data','data']);bad(sdp().replace('s=-','s=\ud800'),'lone surrogate');
});

test('candidate rules (§6.3): typ, raddr, mDNS host cross-entity, extensions, size',()=>{
 for(const type of ['relay','srflx','host'])assert.equal(parseCandidate(candidate(type)).type,type);
 assert.equal(parseCandidate(candidate('relay',{tail:''})).raddr,null,'relay without raddr');
 assert.equal(parseCandidate(candidate('host',{address:'192.168.1.4'}),{crossEntity:false}).address,'192.168.1.4','raw host only own-entity');
 assert.equal(parseCandidate(candidate('srflx',{tail:' raddr 192.168.1.4 rport 5000'}),{crossEntity:false}).raddr,'192.168.1.4');
 const bad=(value,label,crossEntity=true)=>assert.throws(()=>parseCandidate(value,{crossEntity}),code('rtc_candidate_invalid'),label);
 bad(candidate('relay',{tail:' raddr 198.51.100.4 rport 4000'}),'relay with real raddr');bad(candidate('relay',{tail:' raddr 0.0.0.0 rport 9'}),'relay rport 0');bad(candidate('relay',{tail:' raddr :: rport 0'}),'relay raddr exactly 0.0.0.0');
 bad(candidate('host',{address:'192.168.1.4'}),'raw host cross-entity');bad(candidate('host',{address:'2001:db8::5'}),'raw IPv6 host cross-entity');bad(candidate('host',{tail:' raddr 0.0.0.0 rport 0'}),'host has no raddr');
 bad(candidate('srflx',{tail:' raddr 192.168.1.4 rport 5000'}),'srflx raddr is a host address cross-entity');bad(candidate('relay',{address:'turn.local'}),'mDNS only for host');
 bad(candidate('relay',{tail:' raddr 0.0.0.0'}),'raddr needs rport');bad(candidate('relay').replace(' typ relay',' typ prflx'),'prflx');bad(candidate('relay').replace('candidate:842163049','candidate:'),'foundation');
 bad(candidate('relay').replace('udp','sctp'),'transport');bad(candidate('relay').replace(' 50000 ',' 70000 '),'port');bad(candidate('relay').replace('1677729535','99999999999'),'priority');bad(candidate('relay').replace(' 1 udp',' 0 udp'),'component');
 bad(candidate('relay')+' x-addr 192.168.1.4','unknown extension (could carry an address)');bad(candidate('relay')+' generation 1','duplicate extension');bad(candidate('relay')+' generation','dangling extension');
 bad('a='+candidate('relay'),'a= prefix');bad(candidate('relay').replace(' ','  '),'empty field');bad(candidate('relay')+' ufrag '+'a'.repeat(RTC_LIMITS.candidateBytes),'size');bad('','empty');bad(candidate('relay').replace('203.0.113.7','203.0.113.777'),'address');
 // Items
 validateCandidateItem(item());validateCandidateItem({...item(),sdpMid:null});
 for(const value of [{...item(),extra:1},{...item(),sdpMid:null,sdpMLineIndex:null},{...item(),sdpMLineIndex:64},{...item(),usernameFragment:'a'},{...item(),sdpMid:'x y'}])assert.throws(()=>validateCandidateItem(value),code('rtc_candidate_invalid'));
});

test('IP policy (§10) restricts only what the sender sends; before the claim only invite and cancel travel',()=>{
 const relay=parseCandidate(candidate('relay')),srflx=parseCandidate(candidate('srflx')),mdns=parseCandidate(candidate('host')),raw=parseCandidate(candidate('host',{address:'10.0.0.8'}),{crossEntity:false});
 const allowed=(policy,crossEntity)=>[relay,srflx,mdns,raw].map(c=>candidateAllowedByPolicy(c,policy,{crossEntity}));
 assert.deepEqual(allowed('relay',true),[true,false,false,false]);assert.deepEqual(allowed('public',true),[true,true,true,false]);assert.deepEqual(allowed('all',true),[true,true,true,false],'all is own-entity only');
 assert.deepEqual(allowed('all',false),[true,true,true,true]);assert.deepEqual(allowed('nonsense',false),[false,false,false,false]);
 assert.equal(defaultIpPolicy({crossEntity:true}),'relay');assert.equal(defaultIpPolicy({crossEntity:false}),'all');
 assert.ok(messageAllowedBeforeClaim('invite')&&messageAllowedBeforeClaim('cancel'));for(const t of ['sdp','candidates','accept','sas','end','decline'])assert.equal(messageAllowedBeforeClaim(t),false,t);
 // Content rules applied to whole messages.
 assert.throws(()=>validateMessageContent(payload(caller,'invite',invite({offer:sdp({extra:['a=candidate:1 1 udp 1 192.168.1.2 9 typ host']})})),{media:['audio','video']}),code('rtc_sdp_invalid'),'an invite offer stays candidate-free');
 validateMessageContent(payload(caller,'invite',invite({media:['data'],offer:sdp()})),{media:['data']});
 assert.throws(()=>validateMessageContent(payload(callee,'candidates',{gen:0,items:[item(candidate('host',{address:'10.0.0.8'}))],complete:false}),{media:['data'],crossEntity:true}),code('rtc_candidate_invalid'));
 assert.equal(validateMessageContent(payload(callee,'candidates',{gen:0,items:[item(candidate('host',{address:'10.0.0.8'}))],complete:false}),{media:['data'],crossEntity:false}).length,1);
});

test('sids: validity and the lower-sid glare rule compare decoded bytes',()=>{
 assert.ok(sidValid(SID)&&sidValid(SID2)&&sidValid('A'.repeat(43)));assert.ok(!sidValid('A'.repeat(42)+'B'),'noncanonical 43');assert.ok(!sidValid(12));
 assert.equal(compareSid(SID,SID2),-1);assert.equal(compareSid(SID2,SID),1);assert.equal(compareSid(SID,SID),0);assert.equal(compareSid(SID,'A'.repeat(43)),-1,'shorter prefix sorts first');assert.throws(()=>compareSid('x',SID),RtcWireFault);
 assert.ok(mediaValid(['audio','data','screen','video']));assert.ok(!mediaValid(['screen','data']));
});

test('batch (§8.1) and step 1 (§8.2): bounds, whole-batch refusal, aud on this issuer, same entities, links only by digest',async()=>{
 const link='https://b.example/users/bob/contact/x?bindle_meta=eyJh.eyJi.c2ln',digest=await linkDigest(link),inv=await sign(caller,payload(caller,'invite',invite({basis:{link_digest:digest}})));
 const control=await signControl({issuer:ALICE.iss,sub:ALICE.sub,aud:caller.aud,sid:SID,reason:'revoked',now:now*1000},{kid:'cert-1',privateKey:caller.certification.privateKey});
 const step1=b=>batchStep1(parseBatch(b),{issuer:BOB.iss,now,parseCertificate:parseLegCertificate,parseControl});
 const out=await step1(buildBatch({certificates:[caller.certificate],messages:[inv],controls:[control],links:[link]}));assert.equal(out.messages.length,1);assert.equal(out.controls[0].payload.reason,'revoked');
 const refuse=async(text,label)=>{await assert.rejects((async()=>step1(text))(),code('rtc_batch_invalid'),label);};
 await refuse(JSON.stringify({v:1,certificates:[],messages:[],controls:[],links:[]}),'not all empty');await refuse(JSON.stringify({v:2,certificates:[caller.certificate],messages:[],controls:[],links:[]}),'unknown v');
 await refuse(JSON.stringify({v:1,certificates:[caller.certificate],messages:[],controls:[],links:[],extra:1}),'exact members');await refuse(JSON.stringify({v:1,certificates:Array(5).fill(caller.certificate),messages:[],controls:[],links:[]}),'4 certificates');
 await refuse(JSON.stringify({v:1,certificates:[],messages:Array(33).fill(inv),controls:[],links:[]}),'32 messages');await refuse(JSON.stringify({v:1,certificates:[],messages:[],controls:Array(5).fill(control),links:[]}),'4 controls');
 await refuse(JSON.stringify({v:1,certificates:[caller.certificate],messages:[inv],controls:[],links:[link,link+'1',link+'2',link+'3',link+'4']}),'4 links');
 await refuse(JSON.stringify({v:1,certificates:[caller.certificate],messages:[inv],controls:[],links:[link+'&x=1']}),'non-canonical link');await refuse(JSON.stringify({v:1,certificates:[caller.certificate],messages:[inv],controls:[],links:[link.replace('bindle_meta','bindle_data')]}),'bindle_data link');
 await refuse(JSON.stringify({v:1,certificates:[caller.certificate],messages:[],controls:[],links:[link]}),'link without a referencing invite');await refuse(JSON.stringify({v:1,certificates:[caller.certificate],messages:[inv],controls:[],links:[link,link]}),'duplicate link');
 await refuse(JSON.stringify({v:1,certificates:[caller.certificate],messages:[inv,'x.y.z'],controls:[],links:[link]}),'one malformed element refuses the whole batch');
 await refuse(JSON.stringify({v:1,certificates:[caller.certificate],messages:[await sign(caller,payload(caller,'invite',invite({ring_until:now-450}),{iat:now-500}))],controls:[],links:[]}),'iat window at step 1');
 await assert.rejects(batchStep1(parseBatch(buildBatch({certificates:[caller.certificate],messages:[inv],links:[link]})),{issuer:'https://c.example',now,parseCertificate:parseLegCertificate,parseControl}),code('rtc_batch_invalid'),'aud on another issuer');
 const carol=await party({iss:'https://a.example',sub:'00000000-0000-4000-8000-00000000000c'},{peer:BOB});await refuse(buildBatch({messages:[inv,await sign(carol,payload(carol,'cancel',{}))],links:[link]}),'two entity pairs');
 assert.throws(()=>parseBatch('{"v":1,"v":1}'),code('rtc_batch_invalid'));assert.throws(()=>parseBatch('x'.repeat(RTC_LIMITS.batchBytes+1)),code('rtc_batch_invalid'));assert.throws(()=>parseBatch(new Uint8Array([0xff])),code('rtc_batch_invalid'));
 // A callback digest also licenses its link.
 const cb='https://a.example/rtc/t?bindle_meta=eyJh.eyJi.c2ln',withCb=await sign(caller,payload(caller,'invite',invite({callback_digest:await linkDigest(cb)})));assert.equal((await step1(buildBatch({certificates:[caller.certificate],messages:[withCb],links:[cb]}))).links.length,1);
});

test('seeded fuzz: mutated messages never verify, valid round-trips always do',async()=>{
 const base=await sign(caller,payload(caller,'invite',invite()));
 await forEachSeed(60,async random=>{
  const parts=base.split('.');const which=random.int(3),chars=[...parts[which]],i=random.int(chars.length),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  chars[i]=alphabet[(alphabet.indexOf(chars[i])+1+random.int(alphabet.length-1))%alphabet.length];parts[which]=chars.join('');const mutated=parts.join('.');
  let accepted=false;try{await verifyMessage(parseMessage(mutated),caller.verified,{now});accepted=true;}catch(e){assert.ok(e instanceof RtcWireFault,String(e));}
  assert.equal(accepted,false,'a single changed character must not verify');
  const claims=payload(caller,'sdp',{gen:random.int(100),description:{type:'offer',sdp:sdp({media:random.chance(0.5)?['application']:['audio','application']})}},{seq:1+random.int(4000)});
  assert.deepEqual(await verifyMessage(parseMessage(await sign(caller,claims)),caller.verified,{now}),claims);
 });
});

test('seeded generator: candidates that parse cross-entity never expose a raw host or a real relay raddr',async()=>{
 const addresses=['203.0.113.7','10.0.0.8','192.168.1.4','2001:db8::5','abc.local','1f3c6b2a-0000-4000-8000-000000000001.local','0.0.0.0','::'];
 await forEachSeed(200,async random=>{
  const type=random.pick(['host','srflx','relay','prflx']),address=random.pick(addresses),tail=random.chance(0.5)?'':` raddr ${random.pick(addresses)} rport ${random.pick([0,9,5000])}`;
  const value=`candidate:1 1 udp 100 ${address} 9 typ ${type}${tail}`;let c=null;try{c=parseCandidate(value,{crossEntity:true});}catch(e){assert.equal(e.code,'rtc_candidate_invalid');}
  if(!c)return;assert.notEqual(c.type,'prflx');if(c.type==='host')assert.ok(c.mdns,value);if(c.type==='relay'&&c.raddr!==null)assert.equal(c.raddr,'0.0.0.0');if(c.type==='srflx'&&c.raddr!==null)assert.ok(['0.0.0.0','::'].includes(c.raddr)||c.raddr.endsWith('.local'),value);
  if(candidateAllowedByPolicy(c,'relay',{crossEntity:true}))assert.equal(c.type,'relay');
 });
});

test('seeded SDP fuzz: inserting any forbidden line anywhere is refused; benign lines are kept',async()=>{
 const forbidden=['a=candidate:1 1 udp 1 10.0.0.1 9 typ host','a=end-of-candidates','a=remote-candidates:1 10.0.0.1 9','c=IN IP4 10.0.0.1','a=rtcp:9 IN IP4 10.0.0.1','a=x:172.16.0.1','o=- 1 1 IN IP4 127.0.0.1','m=video 9 UDP/TLS/RTP/SAVPF 96','a=fingerprint:sha-1 '+'AB:'.repeat(19)+'AB'],benign=['a=extmap-allow-mixed','a=x-google-flag:conference','a=sendrecv','a=rtcp-mux'];
 await forEachSeed(80,async random=>{
  const lines=sdp().slice(0,-2).split('\r\n'),at=1+random.int(lines.length-1),bad=random.chance(0.6);lines.splice(at,0,random.pick(bad?forbidden:benign));const value=lines.join('\r\n')+'\r\n';
  let ok=true;try{validateSdp(value,{media:['data']});}catch(e){ok=false;assert.equal(e.code,'rtc_sdp_invalid');}
  assert.equal(ok,!bad,value);
 });
});

// ---- independent security review follow-ups (DEVLOG "RTC-a/b/c", "Review follow-ups"; provisional) -------------------
const FB='BB:'.repeat(31)+'BB',FM='EE:'.repeat(31)+'EE';
test('review M1: every a=fingerprint line carries the same (algorithm, value) pair, so the SAS input is what DTLS checks',()=>{
 const media=['data'],bad=(value,label)=>assert.throws(()=>validateSdp(value,{media}),code('rtc_sdp_invalid'),label);
 // poc3: session-level fingerprint of the victim, media-level fingerprint of the provider in the middle.
 bad(sdp({fingerprint:`a=fingerprint:sha-256 ${FM}`}).replace('t=0 0\r\n',`t=0 0\r\na=fingerprint:sha-256 ${FB}\r\n`),'session/media split');
 bad(sdp({fingerprint:`a=fingerprint:sha-256 ${FB}\r\na=fingerprint:sha-256 ${FM}`}),'two media-level sha-256 values');
 bad(sdp({fingerprint:`a=fingerprint:sha-256 ${FB}\r\na=fingerprint:sha-384 ${'CC:'.repeat(47)}CC`}),'two strong algorithms');
 bad(sdp({media:['application','application'],fingerprint:null}).replace('a=mid:0',`a=fingerprint:sha-256 ${FB}\r\na=mid:0`).replace('a=mid:1',`a=fingerprint:sha-256 ${FM}\r\na=mid:1`),'different values per m= section');
 // The same pair repeated (session and every media section, any case) is one fingerprint.
 const repeated=sdp({media:['application','application'],fingerprint:`a=fingerprint:sha-256 ${FB}`}).replace('t=0 0\r\n',`t=0 0\r\na=fingerprint:SHA-256 ${FB.toLowerCase()}\r\n`);
 validateSdp(repeated,{media});assert.deepEqual([...firstSha256Fingerprint(repeated)],Array(32).fill(0xbb));
 // A sole sha-384 fingerprint is valid and gives no SAS input.
 const only384=sdp({fingerprint:`a=fingerprint:sha-384 ${'CC:'.repeat(47)}CC`});validateSdp(only384,{media});assert.equal(firstSha256Fingerprint(only384),null);
});

test('review L1: case-insensitive candidate lines, constrained o= fields, u=/e=/p= refused, IPv6-like and dotted-quad runs refused',()=>{
 const media=['data'],add=line=>sdp({extra:[line]}),bad=(value,label)=>assert.throws(()=>validateSdp(value,{media}),code('rtc_sdp_invalid'),label);
 // poc1/poc2 cases.
 bad(sdp({origin:'o=10.1.2.3 46117314 2 IN IP4 127.0.0.1'}),'o= username IPv4');bad(sdp({origin:'o=fd00::1234 46117314 2 IN IP4 127.0.0.1'}),'o= username IPv6');bad(sdp({origin:'o=- fd00::1 2 IN IP4 127.0.0.1'}),'o= sess-id IPv6');
 bad(sdp({origin:'o=alice.corp.example 1 2 IN IP4 127.0.0.1'}),'o= username host name');bad(sdp({origin:'o=- 1 v2 IN IP4 127.0.0.1'}),'o= sess-version digits');
 bad(add('a=x-addr:2001:db8::77'),'attribute IPv6');bad(add('a=x-addr:fe80::1'),'link-local IPv6');bad(add('a=x-v:::ffff:10.0.0.1'),'mapped IPv6');bad(add('a=x-v:1::2'),'compressed IPv6');
 bad(add('a=CANDIDATE:1 1 udp 2122260223 2001:db8::77 54400 typ host'),'upper-case candidate');bad(add('a=Candidate:1 1 udp 2122260223 192.168.1.5 54400 typ host'),'mixed-case candidate');
 bad(add('a=End-Of-Candidates'),'mixed-case end-of-candidates');bad(add('a=REMOTE-CANDIDATES:1 x 9'),'upper-case remote-candidates');
 bad(add('a=x-v:1.192.168.1.5'),'IPv4 hidden in a five-number run');bad(add('a=x-v:.192.168.1.5'),'IPv4 after a dot');bad(add('a=x-v:192.168.1.5.'),'IPv4 before a dot');bad(add('a=x-v:192.168.1.5'),'IPv4 control');
 bad(add('u=http://myhost.corp.example/'),'u= host name');bad(add('e=alice@corp.example'),'e= line');bad(add('p=+1 555 0100'),'p= line');bad(add('a=x-origin:in ip6 host'),'lower-case address token');
 // Real browser lines with colons and dots still pass.
 validateSdp(sdp({extra:['a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level','a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid','a=extmap:13 urn:3gpp:video-orientation','a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time','a=framerate:29.97','a=ssrc:3735928559 cname:4TOk42mSjXCkVIa6']}),{media});
 validateSdp(sdp({origin:'o=- 4611731400430051336 2 IN IP4 127.0.0.1'}),{media});
});

test('review L2: public srflx/relay addresses cross-entity, srflx raddr under public, UUID mDNS names',()=>{
 const bad=(value,label,crossEntity=true)=>assert.throws(()=>parseCandidate(value,{crossEntity}),code('rtc_candidate_invalid'),label);
 for(const address of ['192.168.1.5','10.0.0.8','172.16.4.4','127.0.0.1','169.254.1.1','100.64.0.1','0.0.0.0','224.0.0.1','::1','::','fe80::1','fd00::1','fc00::5','ff02::1','::ffff:192.168.1.5','::ffff:10.0.0.1','64:ff9b::a00:1']){
  bad(candidate('srflx',{address}),`srflx ${address}`);bad(candidate('relay',{address}),`relay ${address}`);
  assert.equal(parseCandidate(candidate('relay',{address}),{crossEntity:false}).address,address,'own-entity unaffected');}
 for(const address of ['203.0.113.7','198.51.100.9','8.8.8.8','2001:db8::5','2606:4700::1','::ffff:8.8.8.8'])assert.equal(parseCandidate(candidate('srflx',{address})).address,address,address);
 assert.ok(nonPublicAddress('::ffff:192.168.1.5')&&!nonPublicAddress('203.0.113.7')&&!nonPublicAddress('abc.local'));
 // mDNS: a UUID followed by .local; any other .local label could encode an address.
 for(const address of ['192-168-1-5.local','abc.local','host.corp.local','1f3c6b2a-0000-4000-8000-00000000000.local','1f3c6b2a-0000-4000-8000-000000000001.local.local'])bad(candidate('host',{address}),address);
 assert.ok(mdnsName('1F3C6B2A-0000-4000-8000-000000000001.local'));bad(candidate('srflx',{tail:' raddr 192-168-1-5.local rport 0'}),'srflx raddr mDNS must be a UUID');
 // Under `public` a srflx raddr must be unspecified, mDNS or absent; only own-entity `all` may send a raw base address.
 const own=parseCandidate(candidate('srflx',{tail:' raddr 192.168.1.5 rport 5000'}),{crossEntity:false});
 assert.equal(candidateAllowedByPolicy(own,'public',{crossEntity:false}),false,'poc1: public never reveals the host base');assert.equal(candidateAllowedByPolicy(own,'all',{crossEntity:false}),true);assert.equal(candidateAllowedByPolicy(own,'relay',{crossEntity:false}),false);
 for(const tail of ['',' raddr 0.0.0.0 rport 0',' raddr :: rport 0',' raddr 1f3c6b2a-0000-4000-8000-000000000001.local rport 9'])assert.equal(candidateAllowedByPolicy(parseCandidate(candidate('srflx',{tail})),'public'),true,tail);
});

test('review L3: a high-S twin of a valid signature is refused at parse; signing always emits low-S',async()=>{
 const n=0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n,flip=compact=>{const parts=compact.split('.'),sig=fromBase64url(parts[2]);let s=0n;for(const b of sig.slice(32))s=(s<<8n)|BigInt(b);const out=new Uint8Array(sig);for(let i=63,v=n-s;i>=32;i--,v>>=8n)out[i]=Number(v&0xffn);return `${parts[0]}.${parts[1]}.${base64url(out)}`;};
 for(let i=0;i<8;i++){const compact=await sign(caller,payload(caller,'invite',invite()));assert.ok(lowS(fromBase64url(compact.split('.')[2])),'signRtcJws normalizes');
  await verifyMessage(parseMessage(compact),caller.verified,{now});const twin=flip(compact);assert.notEqual(twin,compact);assert.throws(()=>parseMessage(twin),code('rtc_message_invalid'),'poc1: malleated twin');}
 assert.equal(lowS(new Uint8Array(64)),false,'zero r and s');assert.equal(lowS(new Uint8Array(63)),false);
});
