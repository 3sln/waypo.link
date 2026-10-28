// Signaling messages, profiles, SDP, candidate, IP-policy and batch codecs (docs/spec/extensions/signaling.md §3.5, §7,
// §9.1, §9.2 step 1, §16). Pure functions, no I/O, no storage. Provisional (coordinator), not signed off by the user;
// signaling rev 3.2 (draft, unsigned).
//
// Appendix C.1 messages.mjs: a generic envelope and types (`answer_by`, `kind`, `profile`, `params`, the bases on the
// wire: `null` (self), `{offer_digest}` and `{relation: 'pairing'}`, the batch `offers` member) plus two profile validators:
//   webrtc   §16: every SDP and candidate rule, but only the structural `m=` check (no media bound, SG-11)
//   data     §3.5: the `data` type, 1 to 4,096 opaque bytes per message (64 KiB per leg is counted by the service)
// There is no `link_digest`, batch `links`, `callback_digest`, SAS, `busy` or `media`: each is an unknown member or
// value and so invalid (§5.3, §7.2, §9.1).
//
// Readings kept from rtc-signaling (DEVLOG "RTC-a/b/c"; provisional): the invite `offer` and accept `answer` are SDP
// strings; srflx `raddr` is a host address; unknown candidate extension attributes are refused; any weak fingerprint
// makes an SDP invalid; `o=` username and session id are `-` or digits; `u=`, `e=` and `p=` lines are refused.
import {base64url,textEncoder} from '../core/records.mjs';
import {artefactURL,DIGEST_PATTERN} from '../core/artefacts.mjs';
import {jcs,strictJSON,plain as plainValue} from '../core/strict-json.mjs';
import {isJkt,originValid} from '../identity/delegation.mjs';
import {memberURL} from '../identity/member-certificates.mjs';
import {MESSAGE_TYP,LEG_CERTIFICATE_TYP,CONTROL_TYP,SignalingWireFault,fail,plain,exactly,parseSignalingJws,verifySignature,b64Bytes} from './jws.mjs';

export const LIMITS=Object.freeze({messageBytes:40960,sdpBytes:24576,candidateBytes:512,candidates:16,maxSeq:4095,answerSeconds:120,iatPastSeconds:120,iatFutureSeconds:30,
 batchBytes:131072,batchCertificates:4,batchMessages:32,batchControls:4,batchOffers:4,contextProperties:8,contextBytes:2048,dataBytes:4096,dataLegBytes:65536});
/** §3.5: the registered profiles, ascending. A new profile is added only by a revision of the spec. */
export const PROFILES=Object.freeze(['data','webrtc']);
export const GENERIC_TYPES=Object.freeze(['invite','cancel','accept','decline','end']);
export const PROFILE_TYPES=Object.freeze({data:Object.freeze(['data']),webrtc:Object.freeze(['sdp','candidates'])});
export const MESSAGE_TYPES=Object.freeze([...GENERIC_TYPES,'sdp','candidates','data']);
export const BATCH_MEDIA_TYPE='application/vnd.bindle.signaling+json';
export const IP_POLICIES=Object.freeze(['relay','public','all']);
export const DECLINE_REASONS=Object.freeze(['declined','unsupported']),END_REASONS=Object.freeze(['closed','failed','timeout']);
const INITIATOR_ONLY=['invite','cancel'],RECIPIENT_ONLY=['accept','decline'],FIRST=['invite','accept','decline'];
const MEMBERS=['bindle','v','iss','sub','aud','sid','leg','to','seq','iat','type','body'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const safe=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const digest43=v=>typeof v==='string'&&v.length===43&&b64Bytes(v,{size:32})!==null;

/** §7.1: 22 to 43 base64url characters encoding at least 128 random bits. */
export const sidValid=v=>typeof v==='string'&&v.length>=22&&v.length<=43&&b64Bytes(v,{min:16,max:32})!==null;
/** §5.7: an offer token is 22 to 43 base64url characters (at least 128 random bits). */
export const offerTokenValid=v=>typeof v==='string'&&v.length>=22&&v.length<=43&&b64Bytes(v,{min:16,max:32})!==null;
/** base64url SHA-256 of an offer token's ASCII bytes (`basis.offer_digest`, §5.2). */
export async function offerDigest(token,crypto=globalThis.crypto){return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',textEncoder.encode(token))));}
/** A kind reference {artefact, version, digest} (artefacts §5, §3.4). */
export const kindReferenceValid=v=>{try{return exactly(v,['artefact','version','digest'])&&artefactURL(v.artefact)===v.artefact&&!v.artefact.includes('?')&&v.artefact.length<=256&&safe(v.version,1,1024)&&DIGEST_PATTERN.test(v.digest);}catch{return false;}};
export const sameKind=(a,b)=>Boolean(a&&b&&a.artefact===b.artefact&&a.version===b.version&&a.digest===b.digest);
export const profileValid=v=>PROFILES.includes(v);

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

// ---- SDP (§16.4) ------------------------------------------------------------------------------------------------
const STRONG=['sha-256','sha-384','sha-512'],HEX_BYTES={'sha-256':32,'sha-384':48,'sha-512':64};
// Defence in depth outside the address fields (review L1): a dotted run of four numbers anywhere (unanchored, so a
// leading dot or a five-number run cannot hide one), and a run of hex digits, dots and colons with two or more colons
// (an IPv6-like token). `a=fingerprint` is validated exactly instead.
const DOTTED_QUAD=/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,IPV6_LIKE=/[0-9A-Fa-f.]*:[0-9A-Fa-f.]*:[0-9A-Fa-f:.]*/;
/** Throws SignalingWireFault('signaling_sdp_invalid') unless `sdp` satisfies every §16.4 rule. The `m=` check is
 * structural only (`audio`, `video` or `application`): no kind bounds which of them a session uses (§16.2, SG-11). */
export function validateSdp(sdp){
 const bad=()=>fail('signaling_sdp_invalid');
 if(typeof sdp!=='string'||!sdp.length||!sdp.isWellFormed()||textEncoder.encode(sdp).length>LIMITS.sdpBytes||!sdp.endsWith('\r\n'))bad();
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
   // M1: one (algorithm, value) pair for the whole SDP (§16.4 "Fingerprints"), so the value DTLS checks is the one any
   // endpoint-level SAS (out of core, §16.6) would bind.
   const pair=`${hash} ${hex.toUpperCase()}`;if(fingerprint!==null&&fingerprint!==pair)bad();fingerprint=pair;continue;}
  if(/\bIN IP[46]\b/i.test(value)||DOTTED_QUAD.test(value)||IPV6_LIKE.test(value))bad();
  if(kind==='m'){mlines++;const type=value.split(' ')[0];if(!['audio','video','application'].includes(type))bad();continue;}
  if(kind==='a'&&/^ice-options:/.test(value)){if(value.slice(12).split(' ').includes('trickle'))trickle=true;continue;}
 }
 if(origins!==1||!mlines||!trickle||fingerprint===null)bad();
 return sdp;
}
/** The raw bytes of the SDP's sha-256 fingerprint (an input for an endpoint-level SAS, §16.6), or null when its one
 * fingerprint uses another strong hash. Call only on a validated SDP: every fingerprint line carries the same pair. */
export function firstSha256Fingerprint(sdp){const line=sdp.split('\r\n').find(l=>/^a=fingerprint:sha-256 /i.test(l));return line?Uint8Array.from(line.split(' ')[1].split(':'),h=>parseInt(h,16)):null;}

// ---- candidates (§16.4) ------------------------------------------------------------------------------------------
const EXTENSIONS={generation:/^\d{1,10}$/,ufrag:/^[A-Za-z0-9+/]{4,256}$/,'network-id':/^\d{1,10}$/,'network-cost':/^\d{1,10}$/,tcptype:/^(active|passive|so)$/};
/**
 * Parses an RFC 8839 candidate-attribute value (no `a=` prefix). Throws SignalingWireFault('signaling_candidate_invalid') unless:
 * at most 512 bytes; `typ` is host, srflx or relay; a relay candidate has no `raddr` or exactly `raddr 0.0.0.0 rport
 * 0`; in a cross-entity session a host candidate's address is an mDNS name (UUID `.local`), a srflx `raddr` is
 * unspecified, an mDNS name or absent (it is the host base address), and a srflx or relay address is a public address
 * (nonPublicAddress is false). Returns {foundation, component, transport,
 * priority, address, port, type, raddr, rport, mdns}.
 */
export function parseCandidate(value,{crossEntity=true}={}){
 const bad=()=>fail('signaling_candidate_invalid');
 if(typeof value!=='string'||!value.length||textEncoder.encode(value).length>LIMITS.candidateBytes||/[^\x21-\x7e ]/.test(value))bad();
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
 if(!exactly(item,['candidate','sdpMid','sdpMLineIndex','usernameFragment']))fail('signaling_candidate_invalid');
 const mid=item.sdpMid===null||typeof item.sdpMid==='string'&&/^[A-Za-z0-9_.-]{1,32}$/.test(item.sdpMid),line=item.sdpMLineIndex===null||safe(item.sdpMLineIndex,0,63),ufrag=item.usernameFragment===null||typeof item.usernameFragment==='string'&&/^[A-Za-z0-9+/]{4,256}$/.test(item.usernameFragment);
 if(!mid||!line||!ufrag||item.sdpMid===null&&item.sdpMLineIndex===null)fail('signaling_candidate_invalid');
 return parseCandidate(item.candidate,{crossEntity});
}
/** §16.5: whether an endpoint under `policy` may SEND this parsed candidate. `all` adds raw host addresses only in
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
/** §16.5 defaults: relay-only for another entity, direct (`all`) MAY be the own-device default. */
export const defaultIpPolicy=({crossEntity=true}={})=>crossEntity?'relay':'all';
/** §7.2: before the claim the initiator leg sends nothing but `invite` and `cancel`. */
export const messageAllowedBeforeClaim=type=>type==='invite'||type==='cancel';

// ---- profile parameters (§3.5, §16.3) ----------------------------------------------------------------------------
/** Invite `params` of `profile`: webrtc exactly {offer} (null or an SDP string), data exactly {}. Syntax only. */
export const inviteParamsShape=(profile,params)=>profile==='webrtc'?exactly(params,['offer'])&&(params.offer===null||typeof params.offer==='string'):profile==='data'?exactly(params,[]):false;
/** Accept `params` of `profile`: webrtc exactly {answer}, data exactly {}. */
export const acceptParamsShape=(profile,params)=>profile==='webrtc'?exactly(params,['answer'])&&(params.answer===null||typeof params.answer==='string'):profile==='data'?exactly(params,[]):false;
/** §3.4, §16.2: the kind parameters of both registered profiles are exactly {}. */
export const kindParamsValid=(profile,params)=>profileValid(profile)&&exactly(params,[]);
/** The byte length of a `data` payload, or -1 when it is not base64url of 1 to 4,096 bytes (§3.5). */
export const dataPayloadBytes=payload=>{const bytes=b64Bytes(payload,{min:1,max:LIMITS.dataBytes});return bytes?bytes.length:-1;};

// ---- message bodies (§7.2) --------------------------------------------------------------------------------------
const basisValid=v=>v===null||exactly(v,['offer_digest'])&&digest43(v.offer_digest)||exactly(v,['relation'])&&v.relation==='pairing';
/** §7.2: `context` is null or an object of at most 8 properties and 2,048 serialized bytes (its schema is the kind's). */
export const contextShape=v=>{if(v===null)return true;if(!plainValue(v)||Object.keys(v).length>LIMITS.contextProperties)return false;try{return textEncoder.encode(jcs(v,{maxDepth:8})).length<=LIMITS.contextBytes;}catch{return false;}};
const genValid=v=>safe(v,0,LIMITS.maxSeq);
function bodyValid(type,body,iat){
 switch(type){
  case 'invite':return exactly(body,['kind','profile','answer_by','basis','context','params'])&&kindReferenceValid(body.kind)&&profileValid(body.profile)&&Number.isSafeInteger(body.answer_by)&&body.answer_by>iat&&body.answer_by<=iat+LIMITS.answerSeconds&&basisValid(body.basis)&&contextShape(body.context)&&inviteParamsShape(body.profile,body.params);
  case 'cancel':return exactly(body,[]);
  case 'accept':return exactly(body,['params'])&&plain(body.params)&&Object.keys(body.params).length<=1;
  case 'decline':return exactly(body,['reason'])&&DECLINE_REASONS.includes(body.reason);
  case 'end':return exactly(body,['reason'])&&END_REASONS.includes(body.reason);
  case 'sdp':return exactly(body,['gen','description'])&&genValid(body.gen)&&exactly(body.description,['type','sdp'])&&['offer','answer','rollback'].includes(body.description.type)&&typeof body.description.sdp==='string'&&(body.description.type==='rollback')===(body.description.sdp==='');
  case 'candidates':return exactly(body,['gen','items','complete'])&&genValid(body.gen)&&Array.isArray(body.items)&&body.items.length<=LIMITS.candidates&&typeof body.complete==='boolean';
  case 'data':return exactly(body,['payload'])&&dataPayloadBytes(body.payload)>0;
  default:return false;
 }
}
/**
 * Strict syntax of a message payload (§7.1, §7.2): exact members, types and bounds, `seq` 0 exactly for the initiator's
 * invite and the recipient's accept or decline, `to` null exactly for invite and cancel. Profile and content rules need
 * the session (its profile, cross-entity or not) and are applied by `validateMessageContent`.
 */
export function validateMessagePayload(p,{allowLoopback=false}={}){
 const bad=()=>fail('signaling_message_invalid');
 if(!exactly(p,MEMBERS)||p.bindle!=='signaling-message'||p.v!==1||!MESSAGE_TYPES.includes(p.type))bad();
 if(!originValid(p.iss,allowLoopback)||typeof p.sub!=='string'||!UUID.test(p.sub)||!memberURL(p.aud,allowLoopback)||!sidValid(p.sid)||!isJkt(p.leg))bad();
 if(['invite','cancel'].includes(p.type)?p.to!==null:!isJkt(p.to))bad();
 if(!safe(p.seq,0,LIMITS.maxSeq)||(p.seq===0)!==FIRST.includes(p.type)||!safe(p.iat,0,Number.MAX_SAFE_INTEGER))bad();
 if(!bodyValid(p.type,p.body,p.iat))bad();
 return p;
}
/** Whether a message `type` may travel in a session of `profile` (§7.2 "A profile type in a session of another
 * profile is invalid"). */
export const typeInProfile=(type,profile)=>GENERIC_TYPES.includes(type)||(PROFILE_TYPES[profile]??[]).includes(type);
/**
 * §7.2, §16.3, §16.4 content rules for one message in a session of `profile`, cross-entity or own-entity: the type
 * belongs to the profile, profile parameters have the profile's shape, every SDP and candidate rule. Returns the parsed
 * candidates (for the sender's IP policy). Throws SignalingWireFault.
 */
export function validateMessageContent(p,{profile,crossEntity=true}={}){
 if(!typeInProfile(p.type,profile))fail('signaling_profile_mismatch');
 if(p.type==='invite'){if(p.body.profile!==profile||!inviteParamsShape(profile,p.body.params))fail('signaling_profile_mismatch');if(profile==='webrtc'&&p.body.params.offer!==null)validateSdp(p.body.params.offer);}
 if(p.type==='accept'){if(!acceptParamsShape(profile,p.body.params))fail('signaling_profile_mismatch');if(profile==='webrtc'&&p.body.params.answer!==null)validateSdp(p.body.params.answer);}
 if(p.type==='sdp'&&p.body.description.type!=='rollback')validateSdp(p.body.description.sdp);
 if(p.type==='candidates')return p.body.items.map(item=>validateCandidateItem(item,{crossEntity}));
 return [];
}
/** Which leg role may send `type` (§7.2). */
export const roleMaySend=(role,type)=>role==='initiator'?!RECIPIENT_ONLY.includes(type):role==='recipient'?!INITIATOR_ONLY.includes(type):false;
/** §7.3: `iat` at most 120 s in the past and 30 s in the future at receipt (`now` in Unix seconds). */
export const iatWithinWindow=(iat,now)=>Number.isSafeInteger(iat)&&iat>=now-LIMITS.iatPastSeconds&&iat<=now+LIMITS.iatFutureSeconds;

/** Strict syntax of a compact message: header kid is the leg's jkt and equals payload `leg` (§7.1). */
export function parseMessage(compact,options={}){
 const parsed=parseSignalingJws(compact,{typ:MESSAGE_TYP,maxBytes:LIMITS.messageBytes,kid:isJkt,code:'signaling_message_invalid'});
 validateMessagePayload(parsed.payload,options);if(parsed.header.kid!==parsed.payload.leg)fail('signaling_message_invalid');return parsed;
}
/**
 * Verifies a parsed message against a leg certificate already verified by certificates.mjs (`certificate` is its
 * result: {payload, holder}). Checks (§6.1, §9.2 step 4): `leg` equals `cnf.jkt`, the sender (`iss`, `sub`) and `aud`
 * equal the certificate's, `sid` and (for an invite) `kind` and `profile` match, the role may send the type, the
 * signature verifies under `delegate`, and `iat` is inside the receipt window when `now` (seconds) is given.
 */
export async function verifyMessage(parsed,certificate,{now,crypto=globalThis.crypto}={}){
 const p=parsed.payload,c=certificate?.payload;const bad=()=>fail('signaling_message_invalid');
 if(!c||p.leg!==c.cnf.jkt||p.iss!==c.iss||p.sub!==c.sub||p.aud!==c.aud||p.sid!==c.sid||!roleMaySend(c.role,p.type))bad();
 if(p.type==='invite'&&(!sameKind(p.body.kind,c.kind)||p.body.profile!==c.profile))bad();
 if(now!==undefined&&!iatWithinWindow(p.iat,now))fail('signaling_message_stale');
 if(!await verifySignature(parsed,c.delegate,crypto))fail('signaling_signature_invalid');
 return p;
}

// ---- batch (§9.1, §9.2 step 1) -----------------------------------------------------------------------------------
/** Shape and bounds of a batch body (raw JSON text or bytes). Throws SignalingWireFault('signaling_batch_invalid'). */
export function parseBatch(raw){
 const bad=()=>fail('signaling_batch_invalid');let text=raw;
 if(raw instanceof Uint8Array){if(raw.length>LIMITS.batchBytes)bad();try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{bad();}}
 if(typeof text!=='string'||textEncoder.encode(text).length>LIMITS.batchBytes)bad();
 let b;try{b=strictJSON(text,{maxBytes:LIMITS.batchBytes,maxDepth:4});}catch{bad();}
 // Exact members: revision 2's `links` is an unknown member, so invalid (§9.1).
 if(!(exactly(b,['v','certificates','messages','controls'])||exactly(b,['v','certificates','messages','controls','offers']))||b.v!==1)bad();
 const list=(v,max)=>Array.isArray(v)&&v.length<=max&&v.every(x=>typeof x==='string');
 // `offers` MAY be omitted when empty (§9.1); when present it is an array (a null or other value is invalid).
 const offers=Object.hasOwn(b,'offers')?b.offers:[];
 if(!list(b.certificates,LIMITS.batchCertificates)||!list(b.messages,LIMITS.batchMessages)||!list(b.controls,LIMITS.batchControls)||!list(offers,LIMITS.batchOffers)||!b.certificates.length&&!b.messages.length&&!b.controls.length||!offers.every(offerTokenValid))bad();
 return {v:1,certificates:b.certificates,messages:b.messages,controls:b.controls,offers};
}
const audOnIssuer=(aud,issuer,allowLoopback)=>{const u=memberURL(aud,allowLoopback);return Boolean(u)&&u.origin===issuer&&!u.search&&!u.hash&&!u.username;};
/**
 * §9.2 step 1, without any fetch: every element's JWS syntax, `typ`, `bindle`, `v`, exact members and low-S; every `aud`
 * on this provider's `issuer` origin and all the same (AMD-RI2); every message `iat` in the receipt window; every carried
 * offer token referenced by an `offer_digest` of an invite in the same batch, each once. Any failure refuses the whole
 * batch. `parseCertificate` and `parseControl` come from certificates.mjs (passed in to avoid a cycle). Returns the parsed
 * elements, with `offers` as [{token, digest}].
 */
export async function batchStep1(batch,{issuer,now,parseCertificate,parseControl,allowLoopback=false,crypto=globalThis.crypto}={}){
 const bad=()=>fail('signaling_batch_invalid');
 try{
  const certificates=batch.certificates.map(c=>parseCertificate(c,{allowLoopback})),messages=batch.messages.map(m=>parseMessage(m,{allowLoopback})),controls=batch.controls.map(c=>parseControl(c,{allowLoopback}));
  const all=[...certificates,...messages,...controls];
  for(const x of all)if(!audOnIssuer(x.payload.aud,issuer,allowLoopback))bad();
  if(new Set(all.map(x=>x.payload.aud)).size>1)bad();
  for(const m of messages)if(!iatWithinWindow(m.payload.iat,now))bad();
  const digests=new Set(messages.filter(m=>m.payload.type==='invite'&&m.payload.body.basis?.offer_digest).map(m=>m.payload.body.basis.offer_digest));
  if(new Set(batch.offers).size!==batch.offers.length)bad();
  const offers=[];for(const token of batch.offers){const digest=await offerDigest(token,crypto);if(!digests.has(digest))bad();offers.push({token,digest});}
  return {certificates,messages,controls,offers};
 }catch(error){if(error instanceof SignalingWireFault)bad();throw error;}
}
/** Builds a batch body; refuses anything parseBatch would refuse. `offers` is omitted when empty (§9.1). */
export function buildBatch({certificates=[],messages=[],controls=[],offers=[]}={}){const text=JSON.stringify({v:1,certificates,messages,controls,...offers.length?{offers}:{}});parseBatch(text);return text;}
export {MESSAGE_TYP,LEG_CERTIFICATE_TYP,CONTROL_TYP};
