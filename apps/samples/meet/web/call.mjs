// One 1:1 call: an RTCPeerConnection carried over Bindle signaling (signaling §7–§8, §16). The initiator (the guest who
// asks to join) opens the session with the host's offer as its basis and sends `invite` with its SDP offer; the
// recipient (the host) claims it and answers in `accept`. After the claim both sides trickle mDNS host candidates.
// No TURN relay is used (the hosted relay needs an operator spend authority, signaling §16.7), so the call needs both
// owners' "with other people" privacy set to allow their public address.
import {legKey,legSigner,claims,offerDigest,signalingSdp,shareable,candidateItem} from './signaling.mjs';
import {CALL_KIND} from './constants.mjs';

/** A camera stand-in drawn on a canvas: no getUserMedia, so no device permission and Chromium keeps mDNS candidates. */
export function previewStream({label,hue}){
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
 const g=canvas.getContext('2d'),initials=String(label||'?').split(/[\s@.]+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
 let frame=0;
 const draw=()=>{
  frame++;const t=frame/15;
  const grad=g.createLinearGradient(0,0,640,360);grad.addColorStop(0,`hsl(${hue} 55% 34%)`);grad.addColorStop(1,`hsl(${(hue+40)%360} 60% 22%)`);
  g.fillStyle=grad;g.fillRect(0,0,640,360);
  for(let i=0;i<3;i++){g.beginPath();g.arc(320,180,70+i*26+6*Math.sin(t+i),0,Math.PI*2);g.strokeStyle=`hsl(${hue} 70% 80% / ${0.22-i*0.06})`;g.lineWidth=3;g.stroke();}
  g.beginPath();g.arc(320,180,64,0,Math.PI*2);g.fillStyle=`hsl(${hue} 45% 92%)`;g.fill();
  g.fillStyle=`hsl(${hue} 50% 24%)`;g.font='600 52px system-ui,-apple-system,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(initials,320,184);
 };
 draw();const timer=setInterval(draw,66);
 const stream=canvas.captureStream(15);
 return {stream,stop(){clearInterval(timer);for(const track of stream.getTracks())track.stop();}};
}

/**
 * @param {object} o
 * @param {'initiator'|'recipient'} o.role
 * @param {ReturnType<import('./signaling.mjs').signalingEndpoint>} o.endpoint
 * @param {MediaStream} o.local
 * @param {(event:object)=>void} o.emit  'state' {state}, 'remote' {stream}, 'chat' {text, mine}, 'stats' {route}
 */
export function createCall({role,endpoint,local,emit,label}){
 const pc=new RTCPeerConnection({iceServers:[],bundlePolicy:'max-bundle'});
 for(const track of local.getTracks())pc.addTrack(track,local);
 let channel=null,signer=null,peerLeg=null,peerIdentity=null,sid=null,claimed=false,ended=false,queue=Promise.resolve(),pending=[],batch=[],flushTimer=null;
 const remote=new MediaStream();
 pc.ontrack=e=>{remote.addTrack(e.track);emit('remote',{stream:remote});};
 const wire=dc=>{channel=dc;let greeted=false;const opened=()=>{if(greeted)return;greeted=true;emit('state',{state:'in-call'});dc.send(JSON.stringify({t:'hello',from:label}));};dc.onopen=opened;if(dc.readyState==='open')queueMicrotask(opened);dc.onmessage=e=>{try{const m=JSON.parse(e.data);if(typeof m.text==='string')emit('chat',{text:m.text.slice(0,500),mine:false,from:m.from});else if(m.t==='hello')emit('chat',{hello:true,from:String(m.from??'').slice(0,120),mine:false});}catch{}};dc.onclose=()=>{if(!ended)finish('closed',{remote:true});};};
 if(role==='initiator')wire(pc.createDataChannel('meet',{ordered:true}));else pc.ondatachannel=e=>wire(e.channel);
 pc.onconnectionstatechange=()=>{emit('state',{connection:pc.connectionState});if(pc.connectionState==='failed'&&!ended)finish('failed');};

 // Messages leave in seq order, one send at a time (seq increases by exactly one per leg, §7.1).
 const post=(type,body)=>{queue=queue.then(async()=>{if(!signer)return;const message=await signer.message(type,body,{to:peerLeg,peerIdentity});const r=await endpoint.send(sid,[message]);if(!r?.accepted)throw new Error(`The provider did not accept ${type}.`);}).catch(error=>{emit('error',{message:String(error?.message??error),type});});return queue;};
 const flush=()=>{flushTimer=null;if(!batch.length)return;const items=batch.splice(0,16);post('candidates',{gen:0,items,complete:false});if(batch.length)flush();};
 pc.onicecandidate=e=>{
  if(!e.candidate||!shareable(e.candidate))return;
  // Before the claim the initiator may send only `invite` or `cancel` (§7.2): candidates wait until the session is live.
  if(!claimed){pending.push(candidateItem(e.candidate));return;}
  batch.push(candidateItem(e.candidate));if(!flushTimer)flushTimer=setTimeout(flush,120);
 };
 const live=()=>{claimed=true;if(pending.length){batch.push(...pending);pending=[];flush();}};

 function finish(reason,{remote:byPeer=false,send=false}={}){
  if(ended)return;ended=true;
  if(send&&signer&&claimed)post('end',{reason:'closed'});
  else if(send&&signer&&!claimed&&role==='initiator')post('cancel',{});
  setTimeout(()=>{try{channel?.close();}catch{}try{pc.close();}catch{}},300);
  emit('state',{state:'ended',reason,byPeer});
 }
 async function onMessage(event){
  const m=claims(event.message);if(!m||m.sid!==sid)return;
  if(m.type==='accept'&&role==='initiator'){peerLeg=m.leg;await pc.setRemoteDescription({type:'answer',sdp:m.body.params.answer});emit('state',{state:'connecting'});live();}
  else if(m.type==='decline')finish('declined',{remote:true});
  else if(m.type==='candidates'){for(const item of m.body.items??[])await pc.addIceCandidate(item).catch(()=>{});}
  else if(m.type==='end'||m.type==='cancel')finish(m.type==='cancel'?'canceled':m.body?.reason??'closed',{remote:true});
 }
 return {
  pc,get sid(){return sid;},get ended(){return ended;},remote,
  /** Initiator: opens the session toward `host` ({iss, sub}) with the host's offer token as the basis, and invites. */
  async open({host,offer}){
   const leg=await legKey(),description=await pc.createOffer();await pc.setLocalDescription(description);const sdp=signalingSdp(description.sdp);
   const opened=await endpoint.open({to:host,kind:CALL_KIND,profile:'webrtc',params:{offer:sdp},delegate:leg.jwk,basis:{offer}});
   sid=opened.sid;signer=legSigner({leg,certificate:opened.certificate});peerIdentity=signer.own.aud;
   const iat=Math.floor(Date.now()/1000);
   await post('invite',{kind:signer.own.kind,profile:'webrtc',answer_by:iat+110,basis:{offer_digest:await offerDigest(offer)},context:null,params:{offer:sdp}});
   emit('state',{state:'ringing'});return sid;
  },
  /** Recipient: claims an `invite` event and answers it. */
  async accept(event){
   const invite=claims(event.invite);sid=event.sid;peerLeg=invite.leg;
   const leg=await legKey(),claim=await endpoint.claim({sid,outcome:'accept',delegate:leg.jwk});
   signer=legSigner({leg,certificate:claim.certificate});peerIdentity=signer.own.aud;
   await pc.setRemoteDescription({type:'offer',sdp:invite.body.params.offer});
   const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
   await post('accept',{params:{answer:signalingSdp(answer.sdp)}});live();emit('state',{state:'connecting'});
  },
  /** Recipient: declines an invite without taking the call. */
  async decline(event){
   sid=event.sid;peerLeg=claims(event.invite).leg;const leg=await legKey(),claim=await endpoint.claim({sid,outcome:'decline',delegate:leg.jwk});
   signer=legSigner({leg,certificate:claim.certificate});peerIdentity=signer.own.aud;await post('decline',{reason:'declined'});finish('declined');
  },
  onEvent(event){if(event.sid!==sid)return false;if(event.type==='message')return onMessage(event).then(()=>true);if(event.type==='state'&&['ended','expired'].includes(event.state))finish(event.state==='expired'?'expired':'closed',{remote:true});return true;},
  say(text){if(channel?.readyState==='open'){channel.send(JSON.stringify({text,from:label}));emit('chat',{text,mine:true});return true;}return false;},
  hangUp(){finish('closed',{send:true});return queue;},
  async route(){const stats=await pc.getStats();for(const r of stats.values())if(r.type==='candidate-pair'&&(r.nominated||r.selected)&&r.state==='succeeded'){const l=stats.get(r.localCandidateId);return {local:l?.candidateType,protocol:l?.protocol};}return null;}
 };
}
