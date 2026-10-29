// Shared fixtures for the signaling wire tests (keys, a trickle SDP, certificates and signed messages). Hosts are under
// reserved .example domains. Renamed from rtc-wire-fixture.mjs for signaling rev 3.2 (kinds, profiles, roles).
import {jwkThumbprint} from '../../packages/identity/delegation.mjs';
import {signLegCertificate,parseLegCertificate,verifyLegCertificate,signMessage} from '../../packages/signaling/certificates.mjs';
import {base64url} from '../../packages/core/records.mjs';

export const P256={name:'ECDSA',namedCurve:'P-256'};
export async function keyPair(){const pair=await crypto.subtle.generateKey(P256,true,['sign','verify']);const {kty,crv,x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty,crv,x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};}
/** A placeholder session-kind reference (an app-published kind; core registers none). */
export const KIND={artefact:'https://sync.example/kinds/device-sync/v1',version:1,digest:'sha256-'+'A'.repeat(43)};
export const ALICE={iss:'https://a.example',sub:'00000000-0000-4000-8000-00000000000a'},BOB={iss:'https://b.example',sub:'00000000-0000-4000-8000-00000000000b'};
export const identityOf=p=>`${p.iss}/entities/${p.sub}`;
export const SID='AAAAAAAAAAAAAAAAAAAAAA',SID2='AQAAAAAAAAAAAAAAAAAAAA';
export const FP='AB:'.repeat(31)+'AB';
export const sdp=({media=['application'],extra=[],origin='o=- 46117314 2 IN IP4 127.0.0.1',fingerprint=`a=fingerprint:sha-256 ${FP}`,trickle='a=ice-options:trickle'}={})=>[
 'v=0',origin,'s=-','t=0 0','a=group:BUNDLE '+media.map((_,i)=>i).join(' '),'a=msid-semantic: WMS',
 ...media.flatMap((m,i)=>[`m=${m} 9 ${m==='application'?'UDP/DTLS/SCTP webrtc-datachannel':'UDP/TLS/RTP/SAVPF 111'}`,'c=IN IP4 0.0.0.0',...m==='application'?[]:['a=rtcp:9 IN IP4 0.0.0.0'],'a=ice-ufrag:abcd','a=ice-pwd:aaaaaaaaaaaaaaaaaaaaaaaa',...trickle?[trickle]:[],...fingerprint?[fingerprint]:[],'a=setup:actpass',`a=mid:${i}`,...m==='application'?['a=sctp-port:5000']:['a=rtpmap:111 opus/48000/2']]),...extra].join('\r\n')+'\r\n';
export const candidate=(type='relay',{address=type==='host'?'1f3c6b2a-0000-4000-8000-000000000001.local':'93.184.216.34',tail=type==='relay'?' raddr 0.0.0.0 rport 0':type==='srflx'?' raddr 0.0.0.0 rport 0':''}={})=>`candidate:842163049 1 udp 1677729535 ${address} 50000 typ ${type}${tail} generation 0 ufrag abcd network-cost 999`;
export const item=(c=candidate())=>({candidate:c,sdpMid:'0',sdpMLineIndex:0,usernameFragment:'abcd'});
export const now=1_800_000_000;

/** A provider (certification key) and an endpoint leg for `principal`. */
export async function party(principal,{role='initiator',peer=BOB,sid=SID,lifetime=600,maxSeconds=900,kind=KIND,profile='webrtc',aep=0,feature=null}={}){
 const certification=await keyPair(),leg=await keyPair(),identity=identityOf(principal),aud=identityOf(peer);
 const signed=await signLegCertificate({issuer:principal.iss,sub:principal.sub,identity,aud,sid,role,kind,profile,client:{client_id:'https://app.example/client',origin:'https://app.example',feature},delegate:leg.jwk,aep,now:now*1000,lifetime,maxSeconds},{kid:'cert-1',privateKey:certification.privateKey});
 const keys=[{kid:'cert-1',use:'cert',alg:'ES256',jwk:certification.jwk,state:'active'}];
 const verified=await verifyLegCertificate(parseLegCertificate(signed.certificate),{keys,expected:{aud,sid,role},identity,now,maxSeconds});
 return {principal,certification,leg,identity,aud,keys,certificate:signed.certificate,verified,sid,role};
}
/** A message payload from `p` (a party) of `type` with `body`. */
export const payload=(p,type,body,{seq=['invite','accept','decline'].includes(type)?0:1,to=['invite','cancel'].includes(type)?null:p.leg.jkt,iat=now}={})=>({bindle:'signaling-message',v:1,iss:p.principal.iss,sub:p.principal.sub,aud:p.aud,sid:p.sid,leg:p.leg.jkt,to,seq,iat,type,body});
export const invite=(extra={})=>({kind:KIND,profile:'webrtc',answer_by:now+60,basis:null,context:null,params:{offer:null},...extra});
export const sign=(p,claims)=>signMessage(claims,p.leg.privateKey);
export {base64url};
