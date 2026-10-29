// Signaling messages, profiles, SDP, candidate, IP-policy, batch and glare codecs (docs/spec/extensions/signaling.md
// §3.5, §7, §8.3, §9.1, §9.2 step 1, §16; §21.1 "Certificates and messages", "webrtc profile", "Admission", "Transport").
// Retargeted from rtc-messages.test.mjs for signaling rev 3.2: SAS, media, link and callback digests are gone (unknown
// members), the `data` profile and the structural m= check are new. Pure functions only. Provisional, unsigned.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMessage,verifyMessage,validateMessagePayload,validateMessageContent,validateSdp,parseCandidate,validateCandidateItem,candidateAllowedByPolicy,defaultIpPolicy,messageAllowedBeforeClaim,roleMaySend,iatWithinWindow,sidValid,parseBatch,batchStep1,buildBatch,offerDigest,offerTokenValid,typeInProfile,dataPayloadBytes,firstSha256Fingerprint,nonPublicAddress,mdnsName,LIMITS,PROFILES,DECLINE_REASONS,END_REASONS,BATCH_MEDIA_TYPE} from '../packages/signaling/messages.mjs';
import {parseLegCertificate,parseControl,signControl} from '../packages/signaling/certificates.mjs';
import {lowS,MESSAGE_TYP,LEG_CERTIFICATE_TYP,CONTROL_TYP,SignalingWireFault} from '../packages/signaling/jws.mjs';
import {glareSurvivor} from '../packages/signaling/sessions.mjs';
import {fromBase64url,base64url,textEncoder} from '../packages/core/records.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
import {party,payload,invite,sign,sdp,candidate,item,now,ALICE,BOB,SID,SID2,KIND,keyPair,identityOf} from './helpers/signaling-wire-fixture.mjs';

const code=c=>({code:c});
const initiator=await party(ALICE,{role:'initiator',peer:BOB}),recipient=await party(BOB,{role:'recipient',peer:ALICE});
const dataInitiator=await party(ALICE,{role:'initiator',peer:BOB,profile:'data'}),dataRecipient=await party(BOB,{role:'recipient',peer:ALICE,profile:'data'});
const enc=v=>base64url(textEncoder.encode(typeof v==='string'?v:JSON.stringify(v)));
// Raw WebCrypto signing (no normalization); retried until low-S, which the profile requires (review L3).
const raw=async(header,claims,key=initiator.leg.privateKey)=>{const head=`${enc(header)}.${enc(claims)}`;let sig;do sig=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,textEncoder.encode(head)));while(!lowS(sig));return `${head}.${base64url(sig)}`;};
const hdr=(extra={})=>({alg:'ES256',kid:initiator.leg.jkt,typ:MESSAGE_TYP,...extra});
const bytes=(n,fill=7)=>base64url(new Uint8Array(n).fill(fill));
const TOKEN=bytes(16,1),TOKEN2=bytes(16,2);

test('every message type parses and verifies under its leg certificate; roles are enforced',async()=>{
 const cases=[[initiator,'invite',invite()],[initiator,'cancel',{}],[recipient,'accept',{params:{answer:null}}],[recipient,'decline',{reason:'declined'}],[recipient,'decline',{reason:'unsupported'}],
  [initiator,'sdp',{gen:1,description:{type:'offer',sdp:sdp()}}],[recipient,'sdp',{gen:2,description:{type:'rollback',sdp:''}}],[recipient,'candidates',{gen:0,items:[item()],complete:false}],[initiator,'candidates',{gen:0,items:[],complete:true}],
  [recipient,'end',{reason:'closed'}],[initiator,'end',{reason:'failed'}],[initiator,'end',{reason:'timeout'}],
  [dataInitiator,'invite',invite({profile:'data',params:{}})],[dataRecipient,'accept',{params:{}}],[dataInitiator,'data',{payload:bytes(1)}],[dataRecipient,'data',{payload:bytes(LIMITS.dataBytes)}]];
 for(const [p,type,body]of cases){const claims=payload(p,type,body),parsed=parseMessage(await sign(p,claims));assert.deepEqual(await verifyMessage(parsed,p.verified,{now}),claims,type);}
 assert.deepEqual(DECLINE_REASONS,['declined','unsupported']);assert.deepEqual(END_REASONS,['closed','failed','timeout']);assert.deepEqual(PROFILES,['data','webrtc']);
 assert.equal(roleMaySend('recipient','invite'),false);assert.equal(roleMaySend('recipient','cancel'),false);assert.equal(roleMaySend('initiator','accept'),false);assert.equal(roleMaySend('initiator','decline'),false);
 assert.equal(roleMaySend('initiator','end'),true);assert.equal(roleMaySend('recipient','data'),true);assert.equal(roleMaySend('initiator','data'),true);
 for(const role of ['caller','callee','observer'])assert.equal(roleMaySend(role,'end'),false,`${role} is not a role`);
 // A recipient leg's certificate cannot carry an initiator-only type, even when correctly signed (and vice versa).
 const wrong=await sign(recipient,payload(recipient,'cancel',{}));await assert.rejects(verifyMessage(parseMessage(wrong),recipient.verified,{now}),code('signaling_message_invalid'));
 const accepted=await sign(initiator,payload(initiator,'accept',{params:{answer:null}}));await assert.rejects(verifyMessage(parseMessage(accepted),initiator.verified,{now}),code('signaling_message_invalid'));
});

test('payload rules: exact members, seq 0 only for the first message, `to`, sid, answer window and invite body members',()=>{
 const ok=payload(initiator,'invite',invite()),bad=(edit,label)=>{const v=structuredClone(ok);edit(v);assert.throws(()=>validateMessagePayload(v),code('signaling_message_invalid'),label);};
 validateMessagePayload(ok);
 bad(v=>{v.extra=1;},'unknown member');bad(v=>{delete v.iat;},'missing member');bad(v=>{v.bindle='rtc-message';},'the old envelope');bad(v=>{v.bindle='signaling-messages';});bad(v=>{v.v=2;},'unknown v');bad(v=>{v.type='ring';},'unknown type');bad(v=>{v.type='sas';},'SAS is out of core');
 bad(v=>{v.seq=1;},'invite is seq 0');bad(v=>{v.to=initiator.leg.jkt;},'invite has to null');bad(v=>{v.seq=0.5;});bad(v=>{v.iat=-1;});
 bad(v=>{v.sid='A'.repeat(21);},'sid too short');bad(v=>{v.sid='A'.repeat(44);},'sid too long');bad(v=>{v.sid='AAAAAAAAAAAAAAAAAAAAAB';},'noncanonical trailing bits');bad(v=>{v.sid='AAAA+AAAAAAAAAAAAAAAAA';});
 bad(v=>{v.leg='x';});bad(v=>{v.iss='https://a.example/';});bad(v=>{v.iss='http://a.example';});bad(v=>{v.sub='ALICE';});bad(v=>{v.aud='https://b.example/x?y=1';});bad(v=>{v.aud='https://b.example/x#f';});
 // answer_by: after iat and at most iat + 120.
 bad(v=>{v.body.answer_by=now+121;},'answer at most 120 s');bad(v=>{v.body.answer_by=now;},'answer after iat');bad(v=>{v.body.answer_by=now+60.5;});
 {const v=structuredClone(ok);v.body.answer_by=now+120;validateMessagePayload(v);}
 bad(v=>{delete v.body.answer_by;v.body.ring_until=now+60;},'revision 2 ring_until is unknown');
 // Withdrawn members are unknown members (§5.3, §7.2): callback_digest, link_digest, SAS commitments, media.
 bad(v=>{v.body.callback_digest=null;},'callback_digest, even null');bad(v=>{v.body.callback_digest=bytes(32);},'callback_digest');
 bad(v=>{v.body.link_digest=bytes(32);},'link_digest as a body member');bad(v=>{v.body.basis={link_digest:bytes(32)};},'link_digest as a basis');
 bad(v=>{v.body.sas_commit=null;},'sas_commit');bad(v=>{v.body.media=['audio'];},'media');bad(v=>{v.body.purpose=KIND;},'purpose');bad(v=>{v.body.offer=null;},'offer moved into params');
 // basis: null, {offer_digest} or {relation:'pairing'} only.
 for(const basis of [{offer_digest:bytes(32)},{relation:'pairing'}]){const v=structuredClone(ok);v.body.basis=basis;validateMessagePayload(v);}
 bad(v=>{v.body.basis={offer_digest:'x'};},'offer digest length');bad(v=>{v.body.basis={offer_digest:bytes(31)};});bad(v=>{v.body.basis={offer_digest:bytes(32),offer:TOKEN};},'only the digest is signed');
 bad(v=>{v.body.basis={relation:'contact'};});bad(v=>{v.body.basis={relation:'pairing',id:'p'};});bad(v=>{v.body.basis={self:true};},'self is implied by the parties, not a basis member');bad(v=>{v.body.basis={};});bad(v=>{v.body.basis='self';});
 // context: null or an object of at most 8 properties and 2,048 serialized bytes.
 bad(v=>{v.body.context=Object.fromEntries(Array.from({length:9},(_,i)=>['k'+i,i]));},'context: 8 properties');bad(v=>{v.body.context={k:'x'.repeat(LIMITS.contextBytes)};},'context: 2,048 bytes');bad(v=>{v.body.context=[1];});bad(v=>{v.body.context='x';});
 {const v=structuredClone(ok);v.body.context=Object.fromEntries(Array.from({length:8},(_,i)=>['k'+i,i]));validateMessagePayload(v);}
 // kind: an exact {artefact, version, digest} reference.
 bad(v=>{v.body.kind={...KIND,version:0};});bad(v=>{v.body.kind={...KIND,digest:'sha1-x'};});bad(v=>{v.body.kind={...KIND,artefact:'https://x.example/p?q'};});bad(v=>{v.body.kind={...KIND,purpose:KIND.artefact};});bad(v=>{delete v.body.kind.digest;});bad(v=>{v.body.kind=KIND.artefact;},'a line alone');
 // profile and params: a registered profile, with exactly its invite parameters.
 bad(v=>{v.body.profile='quic';},'unregistered profile');bad(v=>{v.body.profile='WebRTC';});bad(v=>{delete v.body.params;},'params required');
 bad(v=>{v.body.params={};},'webrtc params are {offer}');bad(v=>{v.body.params={offer:null,answer:null};});bad(v=>{v.body.params={offer:{type:'offer',sdp:sdp()}};},'the offer is an SDP string');
 bad(v=>{v.body.profile='data';},'data params are {}');bad(v=>{v.body.profile='data';v.body.params={payload:bytes(1)};});
 {const v=structuredClone(ok);v.body.profile='data';v.body.params={};validateMessagePayload(v);v.body.profile='webrtc';v.body.params={offer:sdp()};validateMessagePayload(v);}
 const other=(type,body,edit,p=recipient)=>{const v=payload(p,type,body);edit?.(v);return ()=>validateMessagePayload(v);};
 assert.throws(other('accept',{params:{answer:null}},v=>{v.seq=1;}),code('signaling_message_invalid'),'accept is seq 0');
 assert.throws(other('accept',{}),code('signaling_message_invalid'),'accept carries params');assert.throws(other('accept',{params:{answer:null,sas_nonce:null}}),code('signaling_message_invalid'),'no SAS nonce');
 assert.throws(other('accept',{answer:null}),code('signaling_message_invalid'),'revision 2 accept body');assert.throws(other('accept',{params:null}),code('signaling_message_invalid'));
 assert.throws(other('sdp',{gen:1,description:{type:'offer',sdp:sdp()}},v=>{v.seq=0;}),code('signaling_message_invalid'),'only first messages are seq 0');
 assert.throws(other('data',{payload:bytes(4)},v=>{v.seq=0;}),code('signaling_message_invalid'),'data is never first');
 assert.throws(other('sdp',{gen:1,description:{type:'offer',sdp:sdp()}},v=>{v.to=null;}),code('signaling_message_invalid'),'to null only for invite/cancel');
 assert.throws(other('sdp',{gen:1,description:{type:'offer',sdp:sdp()}},v=>{v.seq=LIMITS.maxSeq+1;}),code('signaling_message_invalid'));
 assert.throws(other('sdp',{gen:1,description:{type:'rollback',sdp:sdp()}}),code('signaling_message_invalid'),'rollback has empty sdp');
 assert.throws(other('sdp',{gen:1,description:{type:'answer',sdp:''}}),code('signaling_message_invalid'));
 // Decline and end reasons: revision 2's busy and hangup are gone.
 for(const reason of ['busy','nope',null])assert.throws(other('decline',{reason}),code('signaling_message_invalid'),`decline ${reason}`);
 for(const reason of ['hangup','bye','cancelled','expired'])assert.throws(other('end',{reason}),code('signaling_message_invalid'),`end ${reason}`);
 assert.throws(other('candidates',{gen:0,items:Array.from({length:17},()=>item()),complete:false}),code('signaling_message_invalid'),'at most 16 candidates');
 assert.throws(()=>validateMessagePayload(payload(initiator,'cancel',{x:1})),code('signaling_message_invalid'));
 assert.throws(()=>validateMessagePayload({...payload(initiator,'cancel',{}),to:initiator.leg.jkt}),code('signaling_message_invalid'),'cancel has to null');
});

test('data profile (§3.5): payload is base64url of 1 to 4,096 bytes; exactly {payload}; never before the claim; never in a webrtc session',()=>{
 const msg=body=>payload(dataInitiator,'data',body),bad=(body,label)=>assert.throws(()=>validateMessagePayload(msg(body)),code('signaling_message_invalid'),label);
 for(const n of [1,2,3,1000,LIMITS.dataBytes]){validateMessagePayload(msg({payload:bytes(n)}));assert.equal(dataPayloadBytes(bytes(n)),n);}
 bad({payload:''},'empty');bad({payload:bytes(LIMITS.dataBytes+1)},'over 4 KiB');bad({payload:bytes(3)+'='},'padded');bad({payload:'AB'},'noncanonical trailing bits');bad({payload:'AA+A'},'standard alphabet');
 bad({payload:bytes(4),gen:0},'exact members');bad({},'payload required');bad({payload:[1,2]});bad({data:bytes(4)});
 assert.equal(dataPayloadBytes(bytes(LIMITS.dataBytes+1)),-1);assert.equal(dataPayloadBytes(7),-1);assert.equal(LIMITS.dataLegBytes,65536,'the per-leg cap the service counts');
 // Content: a data message in a data session, never in a webrtc one (and no webrtc type in a data session).
 assert.deepEqual(validateMessageContent(msg({payload:bytes(8)}),{profile:'data'}),[]);
 assert.throws(()=>validateMessageContent(msg({payload:bytes(8)}),{profile:'webrtc'}),code('signaling_profile_mismatch'),'data in a webrtc session');
 assert.throws(()=>validateMessageContent(payload(dataInitiator,'sdp',{gen:1,description:{type:'offer',sdp:sdp()}}),{profile:'data'}),code('signaling_profile_mismatch'),'sdp in a data session');
 assert.throws(()=>validateMessageContent(payload(dataRecipient,'candidates',{gen:0,items:[item()],complete:false}),{profile:'data'}),code('signaling_profile_mismatch'),'candidates in a data session');
 assert.throws(()=>validateMessageContent(msg({payload:bytes(8)}),{profile:'quic'}),code('signaling_profile_mismatch'));
 for(const [type,profile,ok] of [['data','data',true],['data','webrtc',false],['sdp','webrtc',true],['sdp','data',false],['candidates','data',false],['invite','data',true],['end','webrtc',true],['data',undefined,false]])assert.equal(typeInProfile(type,profile),ok,`${type} in ${profile}`);
 // Generic messages carry the session's profile parameters only.
 assert.throws(()=>validateMessageContent(payload(dataInitiator,'invite',invite()),{profile:'data'}),code('signaling_profile_mismatch'),'a webrtc invite in a data session');
 assert.throws(()=>validateMessageContent(payload(initiator,'invite',invite({profile:'data',params:{}})),{profile:'webrtc'}),code('signaling_profile_mismatch'),'a data invite in a webrtc session');
 assert.throws(()=>validateMessageContent(payload(dataRecipient,'accept',{params:{answer:null}}),{profile:'data'}),code('signaling_profile_mismatch'),'webrtc accept params in a data session');
 assert.throws(()=>validateMessageContent(payload(recipient,'accept',{params:{}}),{profile:'webrtc'}),code('signaling_profile_mismatch'),'data accept params in a webrtc session');
 validateMessageContent(payload(dataRecipient,'accept',{params:{}}),{profile:'data'});
 // Before the claim only invite and cancel travel: data is post-claim only.
 assert.equal(messageAllowedBeforeClaim('data'),false);
});

test('JWS profile: typ, exact header, canonical segments, strict JSON, 64-byte signature, size bound, kid = leg',async()=>{
 const claims=payload(initiator,'cancel',{});const good=await raw(hdr(),claims);parseMessage(good);
 for(const [label,compact] of [
  ['leg certificate typ',await raw(hdr({typ:LEG_CERTIFICATE_TYP}),claims)],['control typ',await raw(hdr({typ:CONTROL_TYP}),claims)],['revision 2 rtc typ',await raw(hdr({typ:'bindle-rtc-message+jwt'}),claims)],
  ['extra jku',await raw({...hdr(),jku:'https://x'},claims)],['alg',await raw(hdr({alg:'ES384'}),claims)],['alg none',await raw(hdr({alg:'none'}),claims)],
  ['kid not the leg',await raw(hdr({kid:recipient.leg.jkt}),claims)],['padded',good.replace(/\.([^.]+)$/,'.$1==')],['two parts',good.split('.').slice(0,2).join('.')],['short signature',good.slice(0,-3)],
  ['duplicate member',`${enc(hdr())}.${enc(JSON.stringify(claims).replace('{','{"seq":1,'))}.${good.split('.')[2]}`],['lone surrogate',`${enc(hdr())}.${enc(JSON.stringify(claims).replace('"cancel"','"\\ud800"'))}.${good.split('.')[2]}`],
  ['negative zero',`${enc(hdr())}.${enc(JSON.stringify(claims).replace('"seq":1','"seq":-0'))}.${good.split('.')[2]}`],['non-object payload',`${enc(hdr())}.${enc('[1]')}.${good.split('.')[2]}`],['not a string',null]
 ])assert.throws(()=>parseMessage(compact),code('signaling_message_invalid'),label);
 // Deep nesting (> 8) is refused by the strict parser.
 const deep=payload(initiator,'invite',invite({context:{a:{b:{c:{d:{e:{f:{g:1}}}}}}}}));assert.throws(()=>parseMessage(`${enc(hdr())}.${enc(deep)}.${good.split('.')[2]}`),code('signaling_message_invalid'));
 // Oversized messages are refused before parsing.
 const big=payload(initiator,'sdp',{gen:1,description:{type:'offer',sdp:'v=0\r\n'+'a=x:'.padEnd(LIMITS.messageBytes,'y')+'\r\n'}});const bigCompact=await raw(hdr(),big);assert.throws(()=>parseMessage(bigCompact),code('signaling_message_invalid'));
});

test('verification binds leg, sender, aud, sid, role, kind, profile, signature and the receipt window',async()=>{
 const claims=payload(initiator,'invite',invite()),parsed=parseMessage(await sign(initiator,claims));
 const variant=edit=>({...initiator.verified,payload:{...initiator.verified.payload,...edit}});
 await assert.rejects(verifyMessage(parsed,variant({aud:'https://c.example/entities/x'}),{now}),code('signaling_message_invalid'),'aud');
 await assert.rejects(verifyMessage(parsed,variant({sid:SID2}),{now}),code('signaling_message_invalid'),'replayed into another session');
 await assert.rejects(verifyMessage(parsed,variant({sub:BOB.sub}),{now}),code('signaling_message_invalid'),'sender');
 await assert.rejects(verifyMessage(parsed,variant({role:'recipient'}),{now}),code('signaling_message_invalid'),'an invite under a recipient certificate');
 await assert.rejects(verifyMessage(parsed,variant({kind:{...KIND,version:2}}),{now}),code('signaling_message_invalid'),'invite kind must match the certificate');
 await assert.rejects(verifyMessage(parsed,variant({kind:{...KIND,digest:'sha256-'+'B'.repeat(43)}}),{now}),code('signaling_message_invalid'),'kind digest');
 await assert.rejects(verifyMessage(parsed,variant({profile:'data'}),{now}),code('signaling_message_invalid'),'invite profile must match the certificate');
 await assert.rejects(verifyMessage(parsed,variant({cnf:{jkt:recipient.leg.jkt}}),{now}),code('signaling_message_invalid'),'leg must equal cnf.jkt');
 await assert.rejects(verifyMessage(parsed,null,{now}),code('signaling_message_invalid'),'no certificate');
 // Signed by a different key under the right kid: signature fails.
 const forged=parseMessage(await raw(hdr(),claims,(await keyPair()).privateKey));await assert.rejects(verifyMessage(forged,initiator.verified,{now}),code('signaling_signature_invalid'));
 // Receipt window: 120 s past and 30 s future are inside; one second more is not.
 assert.ok(iatWithinWindow(now-120,now)&&iatWithinWindow(now+30,now));assert.ok(!iatWithinWindow(now-121,now)&&!iatWithinWindow(now+31,now));
 await assert.rejects(verifyMessage(parsed,initiator.verified,{now:now+121}),code('signaling_message_stale'));await assert.rejects(verifyMessage(parsed,initiator.verified,{now:now-31}),code('signaling_message_stale'));
});

test('SDP rules (§16.4): every MUST, with address leakage attempts; the m= check is structural only',()=>{
 validateSdp(sdp());validateSdp(sdp({origin:'o=- 1 2 IN IP6 ::1'}));
 // Structural only (SG-11): audio, video and application in any combination; no kind or session bound.
 for(const media of [['audio'],['video'],['application'],['audio','video'],['video','audio','application'],['audio','audio','video','video']])validateSdp(sdp({media}));
 assert.equal(validateSdp.length,1,'no media argument any more');
 assert.equal(firstSha256Fingerprint(sdp()).length,32);
 const lines=s=>s.split('\r\n');const bad=(value,label)=>assert.throws(()=>validateSdp(value),code('signaling_sdp_invalid'),label);
 for(const m of ['message','text','image','data','screen','AUDIO'])bad(sdp({media:[m]}),`m=${m} is not audio, video or application`);
 bad(sdp({media:['audio','text']}),'one unknown section refuses the SDP');
 bad(sdp({extra:['a=candidate:1 1 udp 2122260223 192.168.1.4 54321 typ host']}),'a=candidate');bad(sdp({extra:['a=remote-candidates:1 192.168.1.4 54321']}),'remote-candidates');bad(sdp({extra:['a=end-of-candidates']}),'end-of-candidates');
 bad(sdp({trickle:null}),'trickle required');bad(sdp({trickle:'a=ice-options:renomination'}),'trickle token required');
 bad(sdp().replace('c=IN IP4 0.0.0.0','c=IN IP4 192.168.1.5'),'c= address');bad(sdp().replace('c=IN IP4 0.0.0.0','c=IN IP6 2001:db8::1'),'c= IPv6 address');bad(sdp().replace('c=IN IP4 0.0.0.0','c=IN IP4 0.0.0.0/127'),'c= ttl form');
 bad(sdp({media:['audio']}).replace('a=rtcp:9 IN IP4 0.0.0.0','a=rtcp:9 IN IP4 198.51.100.9'),'a=rtcp address');
 bad(sdp({origin:'o=- 1 2 IN IP4 198.51.100.9'}),'o= public address');bad(sdp({origin:'o=- 1 2 IN IP4 10.0.0.2'}),'o= private address');bad(sdp({origin:'o=- 1 2 IN IP4 127.0.0.1 extra'}));
 bad(sdp({fingerprint:null}),'fingerprint required');bad(sdp({fingerprint:'a=fingerprint:sha-1 '+'AB:'.repeat(19)+'AB'}),'sha-1 refused');bad(sdp({fingerprint:'a=fingerprint:sha-256 AB:CD'}),'fingerprint length');
 bad(sdp({fingerprint:`a=fingerprint:sha-256 ${'AB:'.repeat(31)}AB`,extra:['a=fingerprint:md5 '+'AB:'.repeat(15)+'AB']}),'any weak fingerprint');
 bad(sdp().replaceAll('\r\n','\n'),'bare LF');bad(sdp().slice(0,-2),'final CRLF');bad(sdp().replace('s=-','s=-\rx'),'bare CR');bad(sdp().replace('s=-','s=\u0000'),'NUL');
 bad(sdp({extra:['a=x-relay:10.1.2.3']}),'smuggled IPv4 literal');bad(sdp({extra:['a=x-origin:IN IP4 0.0.0.0']}),'address token elsewhere');
 bad(lines(sdp()).filter(l=>!l.startsWith('m=')).join('\r\n'),'needs an m= line');bad(sdp().replace('s=-','o=- 9 9 IN IP4 127.0.0.1\r\ns=-'),'one o= line');bad('x'+sdp(),'starts with v=0');
 bad(sdp({extra:['a=x:'+'y'.repeat(LIMITS.sdpBytes)]}),'oversized');bad(sdp().replace('s=-','s=\ud800'),'lone surrogate');bad(null,'not a string');bad('','empty');
});

test('candidate rules (§16.4): typ, raddr, mDNS host cross-entity, extensions, size',()=>{
 for(const type of ['relay','srflx','host'])assert.equal(parseCandidate(candidate(type)).type,type);
 assert.equal(parseCandidate(candidate('relay',{tail:''})).raddr,null,'relay without raddr');
 assert.equal(parseCandidate(candidate('host',{address:'192.168.1.4'}),{crossEntity:false}).address,'192.168.1.4','raw host only own-entity');
 assert.equal(parseCandidate(candidate('srflx',{tail:' raddr 192.168.1.4 rport 5000'}),{crossEntity:false}).raddr,'192.168.1.4');
 const bad=(value,label,crossEntity=true)=>assert.throws(()=>parseCandidate(value,{crossEntity}),code('signaling_candidate_invalid'),label);
 bad(candidate('relay',{tail:' raddr 198.51.100.4 rport 4000'}),'relay with real raddr');bad(candidate('relay',{tail:' raddr 0.0.0.0 rport 9'}),'relay rport 0');bad(candidate('relay',{tail:' raddr :: rport 0'}),'relay raddr exactly 0.0.0.0');
 bad(candidate('host',{address:'192.168.1.4'}),'raw host cross-entity');bad(candidate('host',{address:'2001:db8::5'}),'raw IPv6 host cross-entity');bad(candidate('host',{tail:' raddr 0.0.0.0 rport 0'}),'host has no raddr');
 bad(candidate('srflx',{tail:' raddr 192.168.1.4 rport 5000'}),'srflx raddr is a host address cross-entity');bad(candidate('relay',{address:'turn.local'}),'mDNS only for host');
 bad(candidate('relay',{tail:' raddr 0.0.0.0'}),'raddr needs rport');bad(candidate('relay').replace(' typ relay',' typ prflx'),'prflx');bad(candidate('relay').replace('candidate:842163049','candidate:'),'foundation');
 bad(candidate('relay').replace('udp','sctp'),'transport');bad(candidate('relay').replace(' 50000 ',' 70000 '),'port');bad(candidate('relay').replace('1677729535','99999999999'),'priority');bad(candidate('relay').replace(' 1 udp',' 0 udp'),'component');
 bad(candidate('relay')+' x-addr 192.168.1.4','unknown extension (could carry an address)');bad(candidate('relay')+' generation 1','duplicate extension');bad(candidate('relay')+' generation','dangling extension');
 bad('a='+candidate('relay'),'a= prefix');bad(candidate('relay').replace(' ','  '),'empty field');bad(candidate('relay')+' ufrag '+'a'.repeat(LIMITS.candidateBytes),'size');bad('','empty');bad(candidate('relay').replace('93.184.216.34','93.184.216.777'),'address');
 // Items
 validateCandidateItem(item());validateCandidateItem({...item(),sdpMid:null});
 for(const value of [{...item(),extra:1},{...item(),sdpMid:null,sdpMLineIndex:null},{...item(),sdpMLineIndex:64},{...item(),usernameFragment:'a'},{...item(),sdpMid:'x y'}])assert.throws(()=>validateCandidateItem(value),code('signaling_candidate_invalid'));
});

test('IP policy (§16.5) restricts only what the sender sends; before the claim only invite and cancel travel; webrtc content rules',()=>{
 const relay=parseCandidate(candidate('relay')),srflx=parseCandidate(candidate('srflx')),mdns=parseCandidate(candidate('host')),rawHost=parseCandidate(candidate('host',{address:'10.0.0.8'}),{crossEntity:false});
 const allowed=(policy,crossEntity)=>[relay,srflx,mdns,rawHost].map(c=>candidateAllowedByPolicy(c,policy,{crossEntity}));
 assert.deepEqual(allowed('relay',true),[true,false,false,false]);assert.deepEqual(allowed('public',true),[true,true,true,false]);assert.deepEqual(allowed('all',true),[true,true,true,false],'all is own-entity only');
 assert.deepEqual(allowed('all',false),[true,true,true,true]);assert.deepEqual(allowed('nonsense',false),[false,false,false,false]);
 assert.equal(defaultIpPolicy({crossEntity:true}),'relay');assert.equal(defaultIpPolicy({crossEntity:false}),'all');
 assert.ok(messageAllowedBeforeClaim('invite')&&messageAllowedBeforeClaim('cancel'));for(const t of ['sdp','candidates','accept','end','decline','data'])assert.equal(messageAllowedBeforeClaim(t),false,t);
 // Content rules applied to whole messages: the invite offer and the accept answer are SDPs under every §16.4 rule.
 assert.throws(()=>validateMessageContent(payload(initiator,'invite',invite({params:{offer:sdp({extra:['a=candidate:1 1 udp 1 192.168.1.2 9 typ host']})}})),{profile:'webrtc'}),code('signaling_sdp_invalid'),'an invite offer stays candidate-free');
 assert.throws(()=>validateMessageContent(payload(initiator,'invite',invite({params:{offer:sdp({media:['text']})}})),{profile:'webrtc'}),code('signaling_sdp_invalid'),'the structural m= check applies to the offer');
 validateMessageContent(payload(initiator,'invite',invite({params:{offer:sdp({media:['audio','video','application']})}})),{profile:'webrtc'});
 assert.throws(()=>validateMessageContent(payload(recipient,'accept',{params:{answer:sdp({trickle:null})}}),{profile:'webrtc'}),code('signaling_sdp_invalid'),'the accept answer too');
 validateMessageContent(payload(recipient,'accept',{params:{answer:sdp()}}),{profile:'webrtc'});
 assert.throws(()=>validateMessageContent(payload(recipient,'sdp',{gen:1,description:{type:'answer',sdp:sdp({media:['image']})}}),{profile:'webrtc'}),code('signaling_sdp_invalid'));
 validateMessageContent(payload(recipient,'sdp',{gen:1,description:{type:'rollback',sdp:''}}),{profile:'webrtc'});
 assert.throws(()=>validateMessageContent(payload(recipient,'candidates',{gen:0,items:[item(candidate('host',{address:'10.0.0.8'}))],complete:false}),{profile:'webrtc',crossEntity:true}),code('signaling_candidate_invalid'));
 assert.equal(validateMessageContent(payload(recipient,'candidates',{gen:0,items:[item(candidate('host',{address:'10.0.0.8'}))],complete:false}),{profile:'webrtc',crossEntity:false}).length,1);
});

test('sids and offer tokens: 22 to 43 base64url characters of at least 128 bits; the offer digest is SHA-256 of the token',async()=>{
 assert.ok(sidValid(SID)&&sidValid(SID2)&&sidValid('A'.repeat(43)));assert.ok(!sidValid('A'.repeat(42)+'B'),'noncanonical 43');assert.ok(!sidValid(12));assert.ok(!sidValid('A'.repeat(21)));
 assert.ok(offerTokenValid(TOKEN)&&offerTokenValid(bytes(32)));assert.ok(!offerTokenValid(bytes(15))&&!offerTokenValid(bytes(33))&&!offerTokenValid(TOKEN+'=')&&!offerTokenValid(null));
 const expected=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',textEncoder.encode(TOKEN))));assert.equal(await offerDigest(TOKEN),expected);assert.equal(expected.length,43);
});

test('glare (§8.3): ranks come from both initiator leg keys, both endpoints agree, no sid is used, equal keys cancel both',async()=>{
 const a=(await keyPair()).jkt,b=(await keyPair()).jkt;
 const ab=await glareSurvivor(a,b),ba=await glareSurvivor(b,a);
 assert.ok(['a','b'].includes(ab));assert.equal(ba,ab==='a'?'b':'a','each endpoint names the same surviving session from its own side');
 // The rank is SHA-256("bindle-signaling-glare" ‖ a ‖ b) over the decoded thumbprint bytes, compared as byte strings.
 const rank=async(x,y)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array([...textEncoder.encode('bindle-signaling-glare'),...fromBase64url(x),...fromBase64url(y)])));
 const [ra,rb]=[await rank(a,b),await rank(b,a)];const lower=Buffer.compare(Buffer.from(ra),Buffer.from(rb))<0?'a':'b';assert.equal(ab,lower,'the lower rank survives');
 assert.equal(glareSurvivor.length,2,'only the two leg key thumbprints are inputs (never a sid, which the peer provider chose)');
 // Equal ranks happen only with the same key on both legs: both endpoints cancel, neither claims.
 assert.equal(await glareSurvivor(a,a),'both-cancel');
 // Deterministic: repeated evaluation gives the same answer.
 for(let i=0;i<3;i++)assert.equal(await glareSurvivor(a,b),ab);
});

test('seeded glare: for random key pairs both endpoints always agree and exactly one session survives',async()=>{
 const keys=await Promise.all(Array.from({length:6},async()=>(await keyPair()).jkt));
 await forEachSeed(40,async random=>{
  const a=random.pick(keys),b=random.pick(keys),x=await glareSurvivor(a,b),y=await glareSurvivor(b,a);
  if(a===b){assert.equal(x,'both-cancel');assert.equal(y,'both-cancel');return;}
  assert.ok(x!=='both-cancel');assert.equal(x==='a'?a:b,y==='a'?b:a,'the same initiator leg wins from both sides');
 });
});

test('batch (§9.1) and step 1 (§9.2): bounds, whole-batch refusal, one aud on this issuer, offers only by invite digest, no links',async()=>{
 const digest=await offerDigest(TOKEN),inv=await sign(initiator,payload(initiator,'invite',invite({basis:{offer_digest:digest}})));
 const control=await signControl({issuer:ALICE.iss,sub:ALICE.sub,aud:initiator.aud,sid:SID,reason:'revoked',now:now*1000},{kid:'cert-1',privateKey:initiator.certification.privateKey});
 const step1=b=>batchStep1(parseBatch(b),{issuer:BOB.iss,now,parseCertificate:parseLegCertificate,parseControl});
 assert.equal(BATCH_MEDIA_TYPE,'application/vnd.bindle.signaling+json');
 const out=await step1(buildBatch({certificates:[initiator.certificate],messages:[inv],controls:[control],offers:[TOKEN]}));
 assert.equal(out.messages.length,1);assert.equal(out.controls[0].payload.reason,'revoked');assert.deepEqual(out.offers,[{token:TOKEN,digest}]);
 // `offers` MAY be omitted when empty, and buildBatch omits it.
 const plain=buildBatch({certificates:[initiator.certificate],messages:[await sign(initiator,payload(initiator,'invite',invite()))]});assert.ok(!('offers' in JSON.parse(plain)));assert.deepEqual((await step1(plain)).offers,[]);
 await step1(JSON.stringify({v:1,certificates:[initiator.certificate],messages:[],controls:[],offers:[]}));
 const refuse=async(text,label)=>{await assert.rejects((async()=>step1(text))(),code('signaling_batch_invalid'),label);};
 const B=(extra={})=>JSON.stringify({v:1,certificates:[initiator.certificate],messages:[inv],controls:[],offers:[TOKEN],...extra});
 await refuse(JSON.stringify({v:1,certificates:[],messages:[],controls:[]}),'not all empty');await refuse(B({v:2}),'unknown v');
 await refuse(B({extra:1}),'exact members');await refuse(B({links:[]}),'revision 2 links is an unknown member, even empty');
 await refuse(B({links:['https://b.example/users/bob/contact/x?bindle_meta=eyJh.eyJi.c2ln']}),'a batch carrying links');
 await refuse(B({certificates:Array(5).fill(initiator.certificate)}),'4 certificates');await refuse(B({messages:Array(33).fill(inv)}),'32 messages');await refuse(B({controls:Array(5).fill(control)}),'4 controls');
 await refuse(B({offers:[TOKEN,TOKEN2,bytes(16,3),bytes(16,4),bytes(16,5)]}),'4 offers');await refuse(B({offers:['short']}),'offer token syntax');await refuse(B({offers:[7]}),'offer token type');
 await refuse(B({offers:[TOKEN2]}),'an offer whose digest no invite in the batch names');await refuse(B({offers:[TOKEN,TOKEN]}),'duplicate offer');
 await refuse(B({messages:[]}),'an offer without any invite');await refuse(B({offers:[TOKEN,TOKEN2]}),'one unreferenced offer refuses the whole batch');
 await refuse(B({messages:[inv,'x.y.z']}),'one malformed element refuses the whole batch');
 await refuse(JSON.stringify({v:1,certificates:[initiator.certificate],messages:[await sign(initiator,payload(initiator,'invite',invite({answer_by:now-450}),{iat:now-500}))],controls:[]}),'iat window at step 1');
 await assert.rejects(batchStep1(parseBatch(B()),{issuer:'https://c.example',now,parseCertificate:parseLegCertificate,parseControl}),code('signaling_batch_invalid'),'aud on another issuer');
 // AMD-RI2: every element names the same aud. Two audiences on this issuer are refused ("Two audiences give 400").
 const carolAud={iss:BOB.iss,sub:'00000000-0000-4000-8000-00000000000c'},toCarol=await party(ALICE,{peer:carolAud});
 await refuse(buildBatch({messages:[inv,await sign(toCarol,payload(toCarol,'cancel',{}))],offers:[TOKEN]}),'two audiences in the messages');
 await refuse(buildBatch({certificates:[toCarol.certificate],messages:[inv],offers:[TOKEN]}),'a certificate for another audience');
 await refuse(buildBatch({messages:[inv],controls:[await signControl({issuer:ALICE.iss,sub:ALICE.sub,aud:identityOf(carolAud),sid:SID,reason:'failed',now:now*1000},{kid:'cert-1',privateKey:initiator.certification.privateKey})],offers:[TOKEN]}),'a control for another audience');
 assert.throws(()=>parseBatch('{"v":1,"v":1}'),code('signaling_batch_invalid'));assert.throws(()=>parseBatch('x'.repeat(LIMITS.batchBytes+1)),code('signaling_batch_invalid'));assert.throws(()=>parseBatch(new Uint8Array([0xff])),code('signaling_batch_invalid'));
 assert.throws(()=>buildBatch({}),code('signaling_batch_invalid'),'the builder refuses what the parser refuses');
});

// packages/signaling/messages.mjs parseBatch reads `b.offers??[]`, so a present `offers: null` passes as empty. §9.1 lets
// `offers` be omitted when empty, not carried as null; reported to the coordinator (packages/ is outside this write set).
test('batch: a present `offers` member must be an array (null is not an omitted member)',async()=>{
 assert.throws(()=>parseBatch(JSON.stringify({v:1,certificates:[initiator.certificate],messages:[],controls:[],offers:null})),code('signaling_batch_invalid'));
});

test('seeded fuzz: mutated messages never verify, valid round-trips always do',async()=>{
 const base=await sign(initiator,payload(initiator,'invite',invite()));
 await forEachSeed(60,async random=>{
  const parts=base.split('.');const which=random.int(3),chars=[...parts[which]],i=random.int(chars.length),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  chars[i]=alphabet[(alphabet.indexOf(chars[i])+1+random.int(alphabet.length-1))%alphabet.length];parts[which]=chars.join('');const mutated=parts.join('.');
  let accepted=false;try{await verifyMessage(parseMessage(mutated),initiator.verified,{now});accepted=true;}catch(e){assert.ok(e instanceof SignalingWireFault,String(e));}
  assert.equal(accepted,false,'a single changed character must not verify');
  const claims=random.chance(0.5)?payload(initiator,'sdp',{gen:random.int(100),description:{type:'offer',sdp:sdp({media:random.chance(0.5)?['application']:['audio','application']})}},{seq:1+random.int(4000)})
   :payload(dataInitiator,'data',{payload:bytes(1+random.int(LIMITS.dataBytes),random.int(256))},{seq:1+random.int(4000)});
  const p=claims.type==='data'?dataInitiator:initiator;
  assert.deepEqual(await verifyMessage(parseMessage(await sign(p,claims)),p.verified,{now}),claims);
 });
});

test('seeded generator: candidates that parse cross-entity never expose a raw host or a real relay raddr',async()=>{
 const addresses=['93.184.216.34','203.0.113.7','::ffff:7f00:1','64:ff9b::a00:1','2002:c0a8:101::','10.0.0.8','192.168.1.4','2001:db8::5','abc.local','1f3c6b2a-0000-4000-8000-000000000001.local','0.0.0.0','::'];
 await forEachSeed(200,async random=>{
  const type=random.pick(['host','srflx','relay','prflx']),address=random.pick(addresses),tail=random.chance(0.5)?'':` raddr ${random.pick(addresses)} rport ${random.pick([0,9,5000])}`;
  const value=`candidate:1 1 udp 100 ${address} 9 typ ${type}${tail}`;let c=null;try{c=parseCandidate(value,{crossEntity:true});}catch(e){assert.equal(e.code,'signaling_candidate_invalid');}
  if(!c)return;assert.notEqual(c.type,'prflx');if(c.type==='host')assert.ok(c.mdns,value);if(c.type==='relay'&&c.raddr!==null)assert.equal(c.raddr,'0.0.0.0');if(c.type==='srflx'&&c.raddr!==null)assert.ok(['0.0.0.0','::'].includes(c.raddr)||c.raddr.endsWith('.local'),value);
  if(candidateAllowedByPolicy(c,'relay',{crossEntity:true}))assert.equal(c.type,'relay');
 });
});

test('seeded SDP fuzz: inserting any forbidden line anywhere is refused; benign lines (any audio, video or application section) are kept',async()=>{
 const forbidden=['a=candidate:1 1 udp 1 10.0.0.1 9 typ host','a=end-of-candidates','a=remote-candidates:1 10.0.0.1 9','c=IN IP4 10.0.0.1','a=rtcp:9 IN IP4 10.0.0.1','a=x:172.16.0.1','o=- 1 1 IN IP4 127.0.0.1','m=text 9 RTP/AVP 0','m=message 9 TCP/MSRP *','a=fingerprint:sha-1 '+'AB:'.repeat(19)+'AB'];
 const benign=['a=extmap-allow-mixed','a=x-google-flag:conference','a=sendrecv','a=rtcp-mux','m=video 9 UDP/TLS/RTP/SAVPF 96','m=audio 9 UDP/TLS/RTP/SAVPF 111','m=application 9 UDP/DTLS/SCTP webrtc-datachannel'];
 await forEachSeed(80,async random=>{
  const lines=sdp().slice(0,-2).split('\r\n'),at=1+random.int(lines.length-1),bad=random.chance(0.6);lines.splice(at,0,random.pick(bad?forbidden:benign));const value=lines.join('\r\n')+'\r\n';
  let ok=true;try{validateSdp(value);}catch(e){ok=false;assert.equal(e.code,'signaling_sdp_invalid');}
  assert.equal(ok,!bad,value);
 });
});

// ---- independent security review follow-ups (carried from rtc-signaling, DEVLOG "RTC-a/b/c"; provisional) -------------
const FB='BB:'.repeat(31)+'BB',FM='EE:'.repeat(31)+'EE';
test('review M1: every a=fingerprint line carries the same (algorithm, value) pair, so the value DTLS checks is the one bound',()=>{
 const bad=(value,label)=>assert.throws(()=>validateSdp(value),code('signaling_sdp_invalid'),label);
 // poc3: session-level fingerprint of the victim, media-level fingerprint of the provider in the middle.
 bad(sdp({fingerprint:`a=fingerprint:sha-256 ${FM}`}).replace('t=0 0\r\n',`t=0 0\r\na=fingerprint:sha-256 ${FB}\r\n`),'session/media split');
 bad(sdp({fingerprint:`a=fingerprint:sha-256 ${FB}\r\na=fingerprint:sha-256 ${FM}`}),'two media-level sha-256 values');
 bad(sdp({fingerprint:`a=fingerprint:sha-256 ${FB}\r\na=fingerprint:sha-384 ${'CC:'.repeat(47)}CC`}),'two strong algorithms');
 bad(sdp({media:['application','application'],fingerprint:null}).replace('a=mid:0',`a=fingerprint:sha-256 ${FB}\r\na=mid:0`).replace('a=mid:1',`a=fingerprint:sha-256 ${FM}\r\na=mid:1`),'different values per m= section');
 // The same pair repeated (session and every media section, any case) is one fingerprint.
 const repeated=sdp({media:['application','application'],fingerprint:`a=fingerprint:sha-256 ${FB}`}).replace('t=0 0\r\n',`t=0 0\r\na=fingerprint:SHA-256 ${FB.toLowerCase()}\r\n`);
 validateSdp(repeated);assert.deepEqual([...firstSha256Fingerprint(repeated)],Array(32).fill(0xbb));
 // A sole sha-384 fingerprint is valid and gives no sha-256 value.
 const only384=sdp({fingerprint:`a=fingerprint:sha-384 ${'CC:'.repeat(47)}CC`});validateSdp(only384);assert.equal(firstSha256Fingerprint(only384),null);
});

test('review L1: case-insensitive candidate lines, constrained o= fields, u=/e=/p= refused, IPv6-like and dotted-quad runs refused',()=>{
 const add=line=>sdp({extra:[line]}),bad=(value,label)=>assert.throws(()=>validateSdp(value),code('signaling_sdp_invalid'),label);
 bad(sdp({origin:'o=10.1.2.3 46117314 2 IN IP4 127.0.0.1'}),'o= username IPv4');bad(sdp({origin:'o=fd00::1234 46117314 2 IN IP4 127.0.0.1'}),'o= username IPv6');bad(sdp({origin:'o=- fd00::1 2 IN IP4 127.0.0.1'}),'o= sess-id IPv6');
 bad(sdp({origin:'o=alice.corp.example 1 2 IN IP4 127.0.0.1'}),'o= username host name');bad(sdp({origin:'o=- 1 v2 IN IP4 127.0.0.1'}),'o= sess-version digits');
 bad(add('a=x-addr:2001:db8::77'),'attribute IPv6');bad(add('a=x-addr:fe80::1'),'link-local IPv6');bad(add('a=x-v:::ffff:10.0.0.1'),'mapped IPv6');bad(add('a=x-v:1::2'),'compressed IPv6');
 bad(add('a=CANDIDATE:1 1 udp 2122260223 2001:db8::77 54400 typ host'),'upper-case candidate');bad(add('a=Candidate:1 1 udp 2122260223 192.168.1.5 54400 typ host'),'mixed-case candidate');
 bad(add('a=End-Of-Candidates'),'mixed-case end-of-candidates');bad(add('a=REMOTE-CANDIDATES:1 x 9'),'upper-case remote-candidates');
 bad(add('a=x-v:1.192.168.1.5'),'IPv4 hidden in a five-number run');bad(add('a=x-v:.192.168.1.5'),'IPv4 after a dot');bad(add('a=x-v:192.168.1.5.'),'IPv4 before a dot');bad(add('a=x-v:192.168.1.5'),'IPv4 control');
 bad(add('u=http://myhost.corp.example/'),'u= host name');bad(add('e=alice@corp.example'),'e= line');bad(add('p=+1 555 0100'),'p= line');bad(add('a=x-origin:in ip6 host'),'lower-case address token');
 // Real browser lines with colons and dots still pass.
 validateSdp(sdp({extra:['a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level','a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid','a=extmap:13 urn:3gpp:video-orientation','a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time','a=framerate:29.97','a=ssrc:3735928559 cname:4TOk42mSjXCkVIa6']}));
 validateSdp(sdp({origin:'o=- 4611731400430051336 2 IN IP4 127.0.0.1'}));
});

test('review L2: public srflx/relay addresses cross-entity, srflx raddr under public, UUID mDNS names',()=>{
 const bad=(value,label,crossEntity=true)=>assert.throws(()=>parseCandidate(value,{crossEntity}),code('signaling_candidate_invalid'),label);
 for(const address of ['192.168.1.5','10.0.0.8','172.16.4.4','127.0.0.1','169.254.1.1','100.64.0.1','0.0.0.0','224.0.0.1','::1','::','fe80::1','fd00::1','fc00::5','ff02::1','::ffff:192.168.1.5','::ffff:10.0.0.1','64:ff9b::a00:1','203.0.113.7','198.51.100.9','192.0.2.1','2001:db8::5','::ffff:7f00:1','0:0:0:0:0:ffff:7f00:1','::127.0.0.1','2002:c0a8:101::','2002:7f00:1::','64:ff9b::7f00:1']){
  bad(candidate('srflx',{address}),`srflx ${address}`);bad(candidate('relay',{address}),`relay ${address}`);
  assert.equal(parseCandidate(candidate('relay',{address}),{crossEntity:false}).address,address,'own-entity unaffected');}
 for(const address of ['93.184.216.34','8.8.8.8','2606:4700::1','::ffff:8.8.8.8'])assert.equal(parseCandidate(candidate('srflx',{address})).address,address,address);
 assert.ok(nonPublicAddress('::ffff:192.168.1.5')&&nonPublicAddress('203.0.113.7')&&nonPublicAddress('abc.local')&&!nonPublicAddress('8.8.8.8'));
 for(const address of ['192-168-1-5.local','abc.local','host.corp.local','1f3c6b2a-0000-4000-8000-00000000000.local','1f3c6b2a-0000-4000-8000-000000000001.local.local'])bad(candidate('host',{address}),address);
 assert.ok(mdnsName('1F3C6B2A-0000-4000-8000-000000000001.local'));bad(candidate('srflx',{tail:' raddr 192-168-1-5.local rport 0'}),'srflx raddr mDNS must be a UUID');
 const own=parseCandidate(candidate('srflx',{tail:' raddr 192.168.1.5 rport 5000'}),{crossEntity:false});
 assert.equal(candidateAllowedByPolicy(own,'public',{crossEntity:false}),false,'poc1: public never reveals the host base');assert.equal(candidateAllowedByPolicy(own,'all',{crossEntity:false}),true);assert.equal(candidateAllowedByPolicy(own,'relay',{crossEntity:false}),false);
 for(const tail of ['',' raddr 0.0.0.0 rport 0',' raddr :: rport 0',' raddr 1f3c6b2a-0000-4000-8000-000000000001.local rport 9'])assert.equal(candidateAllowedByPolicy(parseCandidate(candidate('srflx',{tail})),'public'),true,tail);
});

test('review L3: a high-S twin of a valid signature is refused at parse; signing always emits low-S',async()=>{
 const n=0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n,flip=compact=>{const parts=compact.split('.'),sig=fromBase64url(parts[2]);let s=0n;for(const b of sig.slice(32))s=(s<<8n)|BigInt(b);const out=new Uint8Array(sig);for(let i=63,v=n-s;i>=32;i--,v>>=8n)out[i]=Number(v&0xffn);return `${parts[0]}.${parts[1]}.${base64url(out)}`;};
 for(let i=0;i<8;i++){const compact=await sign(initiator,payload(initiator,'invite',invite()));assert.ok(lowS(fromBase64url(compact.split('.')[2])),'signJws normalizes');
  await verifyMessage(parseMessage(compact),initiator.verified,{now});const twin=flip(compact);assert.notEqual(twin,compact);assert.throws(()=>parseMessage(twin),code('signaling_message_invalid'),'poc1: malleated twin');}
 assert.equal(lowS(new Uint8Array(64)),false,'zero r and s');assert.equal(lowS(new Uint8Array(63)),false);
});
