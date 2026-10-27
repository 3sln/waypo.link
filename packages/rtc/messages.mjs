// RTC-a: signaling message, SDP, candidate, IP-policy and batch codecs (docs/spec/rtc-signaling.md §6, §8.1, §10;
// design docs/architecture/rtc-signaling.md §3.1). Pure functions, no I/O, no storage. Provisional (coordinator), not
// signed off by the user.
//
// What lives here:
//   parseMessage / verifyMessage   `bindle-rtc-message+jwt` syntax (§6.1, §6.2) and its signature under a verified
//                                  leg certificate (certificates.mjs); `iatWithinWindow` is the §6.4 receipt window
//   validateSdp                    §6.3: CRLF, trickle, no candidates, unspecified c=/a=rtcp/o= addresses, m= kinds
//                                  consistent with the invite's media, a strong fingerprint
//   parseCandidate                 §6.3: RFC 8839 candidate-attribute, `raddr` rules, mDNS-only host cross-entity
//   candidateAllowedByPolicy       §10: which candidates an endpoint may SEND under its owner's IP policy (enforced only
//                                  by the sender's own provider; receivers apply only the policy-independent rules)
//   messageAllowedBeforeClaim      §6.3 "no SDP and no candidate travels before the claim"
//   parseBatch / batchStep1        §8.1 batch shape and bounds, and the §8.2 step 1 checks that need no fetch
//
// Provisional readings (DEVLOG 2026-10-26 "RTC-a/b/c"): the invite `offer` and the accept `answer` are SDP strings
// (their type is implied); `to` is null for both `invite` and `cancel`; srflx `raddr` is a host address, so it obeys
// the cross-entity host rule; unknown candidate extension attributes are refused (an extension could carry an address);
// any weak (sha-1, md5) fingerprint makes the SDP invalid.
//
// Review follow-ups (DEVLOG "RTC-a/b/c", "Review follow-ups"; provisional, unsigned): every `a=fingerprint` line of an
// SDP carries the same (algorithm, value) pair, so the SAS input is the fingerprint DTLS checks (M1); candidate-line
// names match case-insensitively, the `o=` username and session-id are `-` or digits, `u=`, `e=` and `p=` lines are
// refused, and IPv6-like or dotted-quad runs outside the address fields are refused (L1); cross-entity srflx and relay
// addresses are public, a srflx `raddr` under `public` is unspecified, mDNS or absent, and an mDNS name is a UUID
// followed by `.local` (L2).
import {base64url,textEncoder} from '../core/records.mjs';
import {artefactURL,DIGEST_PATTERN} from '../core/artefacts.mjs';
import {isJkt,originValid} from '../identity/delegation.mjs';
import {memberURL} from '../identity/member-certificates.mjs';
import {strictJSON} from '../links/envelope.mjs';
import {RTC_MESSAGE_TYP,RTC_LEG_CERTIFICATE_TYP,RTC_CONTROL_TYP,RtcWireFault,fail,plain,exactly,parseRtcJws,verifyRtcSignature,b64Bytes} from './jws.mjs';

export const RTC_LIMITS=Object.freeze({messageBytes:40960,sdpBytes:24576,candidateBytes:512,candidates:16,maxSeq:4095,ringSeconds:120,iatPastSeconds:120,iatFutureSeconds:30,
 batchBytes:131072,batchCertificates:4,batchMessages:32,batchControls:4,batchLinks:4,linkChars:8192,contextProperties:8});
export const RTC_MEDIA=Object.freeze(['audio','data','screen','video']);
export const RTC_MESSAGE_TYPES=Object.freeze(['invite','cancel','accept','decline','sdp','candidates','sas','end']);
export const RTC_BATCH_MEDIA_TYPE='application/vnd.bindle.rtc+json';
export const IP_POLICIES=Object.freeze(['relay','public','all']);
const CALLER_ONLY=['invite','cancel','sas'],CALLEE_ONLY=['accept','decline'],FIRST=['invite','accept','decline'];
const MEMBERS=['bindle','v','iss','sub','aud','sid','leg','to','seq','iat','type','body'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const safe=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const digest43=v=>typeof v==='string'&&v.length===43&&b64Bytes(v,{size:32})!==null;

/** §6.1: 22 to 43 base64url characters encoding at least 128 random bits. */
export const sidValid=v=>typeof v==='string'&&v.length>=22&&v.length<=43&&b64Bytes(v,{min:16,max:32})!==null;
/** Byte-string comparison of two sids after base64url decoding (§7.3 crossing invites: the lower sid survives). */
export function compareSid(a,b){const x=b64Bytes(a,{min:16,max:32}),y=b64Bytes(b,{min:16,max:32});if(!x||!y)fail('rtc_invalid');for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]<y[i]?-1:1;return x.length===y.length?0:x.length<y.length?-1:1;}
/** A purpose reference {purpose, version, digest} (artefacts §5, spec §3.4). */
export const purposeReferenceValid=v=>{try{return exactly(v,['purpose','version','digest'])&&artefactURL(v.purpose)===v.purpose&&safe(v.version,1,1024)&&DIGEST_PATTERN.test(v.digest);}catch{return false;}};
/** Nonempty, unique, ascending subset of the four media values. */
export const mediaValid=v=>Array.isArray(v)&&v.length>0&&v.length<=RTC_MEDIA.length&&v.every((m,i)=>RTC_MEDIA.includes(m)&&(i===0||v[i-1]<m));

// ---- addresses --------------------------------------------------------------------------------------------------
const IPV4=/^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
export const ipv4=v=>typeof v==='string'&&IPV4.test(v);
export const ipv6=v=>{if(typeof v!=='string'||!v.includes(':')||!/^[0-9A-Fa-f:.]{2,45}$/.test(v))return false;try{new URL(`http://[${v}]/`);return true;}catch{return false;}};
/** An mDNS candidate name as browsers generate it (RFC 8828 §5.1.1): a random UUID followed by `.local`. Any other
 * `.local` label could encode an address or a host name (review L2). */
export const mdnsName=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$/i.test(v);
export const unspecified=v=>v==='0.0.0.0'||v==='::';
const v4Private=([a,b])=>a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168;
/** True for an IP literal that is not a public unicast address: unspecified, loopback, private (RFC 1918), shared
 * (RFC 6598), link-local, multicast or reserved IPv4; and unspecified, loopback, link-local, site-local, ULA or
 * multicast IPv6, including IPv4-mapped, IPv4-compatible and NAT64 forms of a non-public IPv4 address (review L2).
 * Documentation ranges are not refused: they reveal nothing. Non-literals return false. */
export function nonPublicAddress(v){
 if(ipv4(v))return v4Private(v.split('.').map(Number));
 if(!ipv6(v))return false;
 let raw;try{raw=new URL(`http://[${v}]/`).hostname.slice(1,-1);}catch{return true;}
 const [left,right]=raw.split('::'),a=left?left.split(':'):[],b=right?right.split(':'):[],g=(right===undefined?a:[...a,...Array(8-a.length-b.length).fill('0'),...b]).map(x=>parseInt(x,16));
 if(g.length!==8||g.some(x=>!Number.isInteger(x)))return true;
 const embedded=()=>v4Private([g[6]>>8,g[6]&255]);
 if(g.slice(0,5).every(x=>x===0)&&(g[5]===0||g[5]===0xffff))return g[5]===0&&g[6]===0?true:embedded(); // ::, ::1, ::a.b.c.d, ::ffff:a.b.c.d
 if(g[0]===0x64&&g[1]===0xff9b&&g.slice(2,6).every(x=>x===0))return embedded();
 return (g[0]&0xffc0)===0xfe80||(g[0]&0xffc0)===0xfec0||(g[0]&0xfe00)===0xfc00||(g[0]&0xff00)===0xff00;
}

// ---- SDP (§6.3) -------------------------------------------------------------------------------------------------
const MEDIA_KIND={audio:'audio',video:'video',screen:'video',data:'application'};
const STRONG=['sha-256','sha-384','sha-512'],HEX_BYTES={'sha-256':32,'sha-384':48,'sha-512':64};
// Defence in depth outside the address fields (review L1): a dotted run of four numbers anywhere (unanchored, so a
// leading dot or a five-number run cannot hide one), and a run of hex digits, dots and colons with two or more colons
// (an IPv6-like token). `a=fingerprint` is validated exactly instead.
const DOTTED_QUAD=/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,IPV6_LIKE=/[0-9A-Fa-f.]*:[0-9A-Fa-f.]*:[0-9A-Fa-f:.]*/;
/** Throws RtcWireFault('rtc_sdp_invalid') unless `sdp` satisfies every §6.3 rule for a session negotiating `media`. */
export function validateSdp(sdp,{media}={}){
 const bad=()=>fail('rtc_sdp_invalid');
 if(typeof sdp!=='string'||!sdp.length||!sdp.isWellFormed()||textEncoder.encode(sdp).length>RTC_LIMITS.sdpBytes||!sdp.endsWith('\r\n'))bad();
 if(!mediaValid(media))bad();const allowed=new Set(media.map(m=>MEDIA_KIND[m]));
 const lines=sdp.slice(0,-2).split('\r\n');if(lines[0]!=='v=0')bad();
 let origins=0,mlines=0,trickle=false,fingerprint=null;
 for(const line of lines){
  // Bare CR/LF, NUL and other controls are refused (only CRLF terminators exist after the split).
  if(!line.length||/[\u0000-\u001f\u007f]/.test(line)||!/^[a-z]=/.test(line))bad();
  const kind=line[0],value=line.slice(2);
  if(kind==='a'&&/^(candidate|remote-candidates|end-of-candidates)(:|$)/i.test(value))bad();
  // `u=`, `e=` and `p=` carry URIs, mail addresses and phone numbers (host names, identities); browsers never emit them.
  if(['u','e','p'].includes(kind))bad();
  if(kind==='o'){origins++;const f=value.split(' ');if(f.length!==6||!/^(-|\d{1,20})$/.test(f[0])||!/^(-|\d{1,20})$/.test(f[1])||!/^\d{1,20}$/.test(f[2])||f[3]!=='IN'||!['IP4','IP6'].includes(f[4])||!['0.0.0.0','::','127.0.0.1','::1'].includes(f[5]))bad();continue;}
  if(kind==='c'){const f=value.split(' ');if(f.length!==3||f[0]!=='IN'||!['IP4','IP6'].includes(f[1])||!unspecified(f[2]))bad();continue;}
  if(kind==='a'&&value.startsWith('rtcp:')){const f=value.slice(5).split(' ');if(!/^\d{1,5}$/.test(f[0])||!(f.length===1||f.length===4&&f[1]==='IN'&&['IP4','IP6'].includes(f[2])&&unspecified(f[3])))bad();continue;}
  // Defence in depth: no other line may carry an address token or a dotted IPv4 literal.
  if(kind==='a'&&value.startsWith('fingerprint:')){const [alg,hex,...rest]=value.slice(12).split(' '),hash=String(alg).toLowerCase();if(rest.length||!STRONG.includes(hash)||typeof hex!=='string'||!new RegExp(`^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){${HEX_BYTES[hash]-1}}$`).test(hex))bad();
   // M1: one (algorithm, value) pair for the whole SDP, so no session/media-level split can steer the SAS input.
   const pair=`${hash} ${hex.toUpperCase()}`;if(fingerprint!==null&&fingerprint!==pair)bad();fingerprint=pair;continue;}
  if(/\bIN IP[46]\b/i.test(value)||DOTTED_QUAD.test(value)||IPV6_LIKE.test(value))bad();
  if(kind==='m'){mlines++;const type=value.split(' ')[0];if(!['audio','video','application'].includes(type)||!allowed.has(type))bad();continue;}
  if(kind==='a'&&/^ice-options:/.test(value)){if(value.slice(12).split(' ').includes('trickle'))trickle=true;continue;}
 }
 if(origins!==1||!mlines||!trickle||fingerprint===null)bad();
 return sdp;
}
/** The raw bytes of the SDP's sha-256 fingerprint (SAS input, §11.3), or null when its one fingerprint uses another
 * strong hash. Call only on a validated SDP: validation guarantees every fingerprint line carries the same pair. */
export function firstSha256Fingerprint(sdp){const line=sdp.split('\r\n').find(l=>/^a=fingerprint:sha-256 /i.test(l));return line?Uint8Array.from(line.split(' ')[1].split(':'),h=>parseInt(h,16)):null;}

// ---- candidates (§6.3) ------------------------------------------------------------------------------------------
const EXTENSIONS={generation:/^\d{1,10}$/,ufrag:/^[A-Za-z0-9+/]{4,256}$/,'network-id':/^\d{1,10}$/,'network-cost':/^\d{1,10}$/,tcptype:/^(active|passive|so)$/};
/**
 * Parses an RFC 8839 candidate-attribute value (no `a=` prefix). Throws RtcWireFault('rtc_candidate_invalid') unless:
 * at most 512 bytes; `typ` is host, srflx or relay; a relay candidate has no `raddr` or exactly `raddr 0.0.0.0 rport
 * 0`; in a cross-entity session a host candidate's address is an mDNS name (UUID `.local`), a srflx `raddr` is
 * unspecified, an mDNS name or absent (it is the host base address), and a srflx or relay address is a public address
 * (nonPublicAddress is false). Returns {foundation, component, transport,
 * priority, address, port, type, raddr, rport, mdns}.
 */
export function parseCandidate(value,{crossEntity=true}={}){
 const bad=()=>fail('rtc_candidate_invalid');
 if(typeof value!=='string'||!value.length||textEncoder.encode(value).length>RTC_LIMITS.candidateBytes||/[^\x21-\x7e ]/.test(value))bad();
 const f=value.split(' ');if(f.length<8||f.some(x=>!x.length))bad();
 const [head,component,transport,priority,address,port,typ,type,...rest]=f;
 if(!/^candidate:[A-Za-z0-9+/]{1,32}$/.test(head)||!/^\d{1,3}$/.test(component)||+component<1||+component>256||!/^(udp|tcp)$/i.test(transport)||!/^\d{1,10}$/.test(priority)||+priority>4294967295||!/^\d{1,5}$/.test(port)||+port>65535||typ!=='typ'||!['host','srflx','relay'].includes(type))bad();
 const mdns=mdnsName(address),ip=ipv4(address)||ipv6(address);if(!mdns&&!ip||mdns&&type!=='host')bad();
 if(rest.length%2)bad();let raddr=null,rport=null;const seen=new Set();
 for(let i=0;i<rest.length;i+=2){const [name,v]=[rest[i],rest[i+1]];if(seen.has(name))bad();seen.add(name);
  if(name==='raddr'){if(!(ipv4(v)||ipv6(v)||mdnsName(v)))bad();raddr=v;}
  else if(name==='rport'){if(!/^\d{1,5}$/.test(v)||+v>65535)bad();rport=+v;}
  else if(!Object.hasOwn(EXTENSIONS,name)||!EXTENSIONS[name].test(v))bad();
 }
 if((raddr===null)!==(rport===null))bad();
 if(type==='host'&&raddr!==null)bad();
 if(type==='relay'&&raddr!==null&&!(raddr==='0.0.0.0'&&rport===0))bad();
 if(crossEntity&&type==='host'&&!mdns)bad();
 if(crossEntity&&type==='srflx'&&raddr!==null&&!(unspecified(raddr)&&rport===0||mdnsName(raddr)))bad();
 if(crossEntity&&(type==='srflx'||type==='relay')&&nonPublicAddress(address))bad();
 return {foundation:head.slice(10),component:+component,transport:transport.toLowerCase(),priority:+priority,address,port:+port,type,raddr,rport,mdns};
}
/** One `candidates` item: exactly {candidate, sdpMid, sdpMLineIndex, usernameFragment}. */
export function validateCandidateItem(item,{crossEntity=true}={}){
 if(!exactly(item,['candidate','sdpMid','sdpMLineIndex','usernameFragment']))fail('rtc_candidate_invalid');
 const mid=item.sdpMid===null||typeof item.sdpMid==='string'&&/^[A-Za-z0-9_.-]{1,32}$/.test(item.sdpMid),line=item.sdpMLineIndex===null||safe(item.sdpMLineIndex,0,63),ufrag=item.usernameFragment===null||typeof item.usernameFragment==='string'&&/^[A-Za-z0-9+/]{4,256}$/.test(item.usernameFragment);
 if(!mid||!line||!ufrag||item.sdpMid===null&&item.sdpMLineIndex===null)fail('rtc_candidate_invalid');
 return parseCandidate(item.candidate,{crossEntity});
}
/** §10: whether an endpoint under `policy` may SEND this parsed candidate. `all` adds raw host addresses only in
 * own-entity sessions; cross-entity it behaves as `public`. Under `public` a srflx `raddr` (its host base address)
 * must be unspecified, an mDNS name or absent (review L2); only own-entity `all` may reveal it. */
export function candidateAllowedByPolicy(candidate,policy,{crossEntity=true}={}){
 if(!IP_POLICIES.includes(policy))return false;
 const raw=policy==='all'&&!crossEntity;
 if(candidate.type==='relay')return true;if(policy==='relay')return false;
 if(candidate.type==='srflx')return raw||candidate.raddr===null||unspecified(candidate.raddr)||mdnsName(candidate.raddr);
 if(candidate.type==='host'&&candidate.mdns)return true;
 return raw;
}
/** §10 defaults: relay-only for another entity, direct (`all`) MAY be the own-device default. */
export const defaultIpPolicy=({crossEntity=true}={})=>crossEntity?'relay':'all';
/** §6.3: before the claim only the caller's `invite` (with its candidate-free offer) and `cancel` may travel. */
export const messageAllowedBeforeClaim=type=>type==='invite'||type==='cancel';

// ---- message bodies (§6.2) --------------------------------------------------------------------------------------
const basisValid=v=>v===null||exactly(v,['link_digest'])&&digest43(v.link_digest);
const contextShape=v=>v===null||plain(v)&&Object.keys(v).length<=RTC_LIMITS.contextProperties;
const genValid=v=>safe(v,0,RTC_LIMITS.maxSeq);
function bodyValid(type,body,iat){
 switch(type){
  case 'invite':return exactly(body,['purpose','media','ring_until','basis','context','offer','callback_digest','sas_commit'])&&purposeReferenceValid(body.purpose)&&mediaValid(body.media)&&Number.isSafeInteger(body.ring_until)&&body.ring_until>iat&&body.ring_until<=iat+RTC_LIMITS.ringSeconds&&basisValid(body.basis)&&contextShape(body.context)&&(body.offer===null||typeof body.offer==='string')&&(body.callback_digest===null||digest43(body.callback_digest))&&(body.sas_commit===null||digest43(body.sas_commit));
  case 'cancel':return exactly(body,[]);
  case 'accept':return exactly(body,['answer','sas_nonce'])&&(body.answer===null||typeof body.answer==='string')&&(body.sas_nonce===null||digest43(body.sas_nonce));
  case 'decline':return exactly(body,['reason'])&&['declined','busy','unsupported'].includes(body.reason);
  case 'sdp':return exactly(body,['gen','description'])&&genValid(body.gen)&&exactly(body.description,['type','sdp'])&&['offer','answer','rollback'].includes(body.description.type)&&typeof body.description.sdp==='string'&&(body.description.type==='rollback')===(body.description.sdp==='');
  case 'candidates':return exactly(body,['gen','items','complete'])&&genValid(body.gen)&&Array.isArray(body.items)&&body.items.length<=RTC_LIMITS.candidates&&typeof body.complete==='boolean';
  case 'sas':return exactly(body,['nonce'])&&digest43(body.nonce);
  case 'end':return exactly(body,['reason'])&&['hangup','failed','timeout'].includes(body.reason);
  default:return false;
 }
}
/**
 * Strict syntax of a message payload (§6.1, §6.2): exact members, types and bounds, `seq` 0 exactly for the
 * caller's invite and the callee's accept or decline, `to` null exactly for invite and cancel. SDP and candidate
 * content rules need the session (media, cross-entity) and are applied by `validateMessageContent`.
 */
export function validateMessagePayload(p,{allowLoopback=false}={}){
 const bad=()=>fail('rtc_message_invalid');
 if(!exactly(p,MEMBERS)||p.bindle!=='rtc-message'||p.v!==1||!RTC_MESSAGE_TYPES.includes(p.type))bad();
 if(!originValid(p.iss,allowLoopback)||typeof p.sub!=='string'||!UUID.test(p.sub)||!memberURL(p.aud,allowLoopback)||!sidValid(p.sid)||!isJkt(p.leg))bad();
 if(['invite','cancel'].includes(p.type)?p.to!==null:!isJkt(p.to))bad();
 if(!safe(p.seq,0,RTC_LIMITS.maxSeq)||(p.seq===0)!==FIRST.includes(p.type)||!safe(p.iat,0,Number.MAX_SAFE_INTEGER))bad();
 if(!bodyValid(p.type,p.body,p.iat))bad();
 return p;
}
/** §6.3 content rules for one message in a session with `media` (the invite's), cross-entity or own-entity. */
export function validateMessageContent(p,{media,crossEntity=true}={}){
 if(p.type==='invite'&&p.body.offer!==null)validateSdp(p.body.offer,{media});
 if(p.type==='accept'&&p.body.answer!==null)validateSdp(p.body.answer,{media});
 if(p.type==='sdp'&&p.body.description.type!=='rollback')validateSdp(p.body.description.sdp,{media});
 if(p.type==='candidates')return p.body.items.map(item=>validateCandidateItem(item,{crossEntity}));
 return [];
}
/** Which leg role may send `type` (§6.2). */
export const roleMaySend=(role,type)=>role==='caller'?!CALLEE_ONLY.includes(type):role==='callee'?!CALLER_ONLY.includes(type):false;
/** §6.4: `iat` at most 120 s in the past and 30 s in the future at receipt (`now` in Unix seconds). */
export const iatWithinWindow=(iat,now)=>Number.isSafeInteger(iat)&&iat>=now-RTC_LIMITS.iatPastSeconds&&iat<=now+RTC_LIMITS.iatFutureSeconds;

/** Strict syntax of a compact message: header kid is the leg's jkt and equals payload `leg`. */
export function parseMessage(compact,options={}){
 const parsed=parseRtcJws(compact,{typ:RTC_MESSAGE_TYP,maxBytes:RTC_LIMITS.messageBytes,kid:isJkt,code:'rtc_message_invalid'});
 validateMessagePayload(parsed.payload,options);if(parsed.header.kid!==parsed.payload.leg)fail('rtc_message_invalid');return parsed;
}
/**
 * Verifies a parsed message against a leg certificate already verified by certificates.mjs (`certificate` is its
 * result: {payload, holder}). Checks (§6.1, §8.2 step 4): `leg` equals `cnf.jkt`, the sender (`iss`, `sub`) and `aud`
 * equal the certificate's, `sid` and (for an invite) `purpose` match, the role may send the type, the signature verifies
 * under `delegate`, and `iat` is inside the receipt window when `now` (seconds) is given. Throws RtcWireFault.
 */
export async function verifyMessage(parsed,certificate,{now,crypto=globalThis.crypto}={}){
 const p=parsed.payload,c=certificate?.payload;const bad=()=>fail('rtc_message_invalid');
 if(!c||p.leg!==c.cnf.jkt||p.iss!==c.iss||p.sub!==c.sub||p.aud!==c.aud||p.sid!==c.sid||!roleMaySend(c.role,p.type))bad();
 if(p.type==='invite'&&(p.body.purpose.purpose!==c.purpose.purpose||p.body.purpose.version!==c.purpose.version||p.body.purpose.digest!==c.purpose.digest))bad();
 if(now!==undefined&&!iatWithinWindow(p.iat,now))fail('rtc_message_stale');
 if(!await verifyRtcSignature(parsed,c.delegate,crypto))fail('rtc_signature_invalid');
 return p;
}

// ---- batch (§8.1, §8.2 step 1) -----------------------------------------------------------------------------------
const linkCanonical=v=>{try{const u=new URL(v);return typeof v==='string'&&v.length<=RTC_LIMITS.linkChars&&u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!v.includes('#')&&u.href===v&&/^\?(bindle_meta|sig)=[A-Za-z0-9_.-]+$/.test(u.search);}catch{return false;}};
/** base64url SHA-256 of a canonical link's ASCII bytes (`link_digest`, `callback_digest`). */
export async function linkDigest(link,crypto=globalThis.crypto){return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',textEncoder.encode(link))));}
/** Shape and bounds of a batch body (raw JSON text or bytes). Throws RtcWireFault('rtc_batch_invalid'). */
export function parseBatch(raw){
 const bad=()=>fail('rtc_batch_invalid');let text=raw;
 if(raw instanceof Uint8Array){if(raw.length>RTC_LIMITS.batchBytes)bad();try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{bad();}}
 if(typeof text!=='string'||textEncoder.encode(text).length>RTC_LIMITS.batchBytes)bad();
 let b;try{b=strictJSON(text);}catch{bad();}
 if(!exactly(b,['v','certificates','messages','controls','links'])||b.v!==1)bad();
 const list=(v,max)=>Array.isArray(v)&&v.length<=max&&v.every(x=>typeof x==='string');
 if(!list(b.certificates,RTC_LIMITS.batchCertificates)||!list(b.messages,RTC_LIMITS.batchMessages)||!list(b.controls,RTC_LIMITS.batchControls)||!list(b.links,RTC_LIMITS.batchLinks)||!b.certificates.length&&!b.messages.length&&!b.controls.length||!b.links.every(linkCanonical))bad();
 return b;
}
const audOnIssuer=(aud,issuer,allowLoopback)=>{const u=memberURL(aud,allowLoopback);return Boolean(u)&&u.origin===issuer;};
/**
 * §8.2 step 1, without any fetch: every element's JWS syntax, `typ`, `bindle`, `v` and exact members; every `aud` on
 * this provider's `issuer` origin; every message `iat` in the receipt window; all messages between the same two
 * entities; every carried link referenced by a digest in an invite of the same batch, and nothing else. Any failure
 * refuses the whole batch (`rtc_batch_invalid`). `parseCertificate` and `parseControl` come from certificates.mjs
 * (passed in to keep this module free of a cycle). Returns the parsed elements.
 */
export async function batchStep1(batch,{issuer,now,parseCertificate,parseControl,allowLoopback=false,crypto=globalThis.crypto}={}){
 const bad=()=>fail('rtc_batch_invalid');
 try{
  const certificates=batch.certificates.map(c=>parseCertificate(c,{allowLoopback})),messages=batch.messages.map(m=>parseMessage(m,{allowLoopback})),controls=batch.controls.map(c=>parseControl(c,{allowLoopback}));
  for(const x of [...certificates,...messages,...controls])if(!audOnIssuer(x.payload.aud,issuer,allowLoopback))bad();
  for(const m of messages)if(!iatWithinWindow(m.payload.iat,now))bad();
  const pairs=new Set(messages.map(m=>JSON.stringify([m.payload.iss,m.payload.sub,m.payload.aud])));if(pairs.size>1)bad();
  const digests=new Set(messages.filter(m=>m.payload.type==='invite').flatMap(m=>[m.payload.body.basis?.link_digest,m.payload.body.callback_digest]).filter(Boolean));
  for(const link of batch.links)if(!digests.has(await linkDigest(link,crypto)))bad();
  if(new Set(batch.links).size!==batch.links.length)bad();
  return {certificates,messages,controls,links:[...batch.links]};
 }catch(error){if(error instanceof RtcWireFault)bad();throw error;}
}
/** Builds a batch body; refuses anything parseBatch would refuse. */
export function buildBatch({certificates=[],messages=[],controls=[],links=[]}={}){const text=JSON.stringify({v:1,certificates,messages,controls,links});parseBatch(text);return text;}
export {RTC_MESSAGE_TYP,RTC_LEG_CERTIFICATE_TYP,RTC_CONTROL_TYP};
