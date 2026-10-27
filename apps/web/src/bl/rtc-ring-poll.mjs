// RTC-g portal ring polling (review F4; docs/architecture/rtc-signaling.md §7 "Incoming ring"). Provisional
// (coordinator), not signed off by the user. Pure scheduling with injected clock, timers and channel, so it is tested
// without a browser (tests/browser/rtc-settings-engine.mjs); apps/web/src/release.mjs wires it to the engine.
//
// - One read at a time (in-flight guard). Stale answers are dropped by the read itself (bl/rtc-settings.mjs).
// - Errors back off exponentially (interval · 2^failures, at most `maxBackoff`), never sooner than a Retry-After.
// - Only while `eligible()` (signed in, RTC on, the ring's routes, the tab visible). Leaving them stops the timer.
// - One polling tab per account: before reading, a tab announces a lease on the BroadcastChannel; after reading it
//   shares the answer, which the other tabs apply instead of reading themselves. A tab reads only when no lease for
//   the same account key is fresh (a lease lasts 1.5 intervals, longer than the leader's jittered period), so a
//   hidden or closed leader is replaced within two intervals. A tab that starts says hello and waits briefly; the
//   leader answers with its last reading. Without BroadcastChannel every eligible tab polls on its own.
// - `idle` answers (nothing can ring) stop polling for that account key until `active()` reports otherwise (the
//   settings read shows something that can ring), the tab becomes visible again (`poke({force:true})`) or the key
//   changes.
export const RING_INTERVAL_MS=10000;
export const RING_MAX_BACKOFF_MS=300000;

export function createRtcRingPoller({run,apply=()=>{},eligible,key,active=()=>false,channel=null,interval=RING_INTERVAL_MS,maxBackoff=RING_MAX_BACKOFF_MS,helloWait=250,now=()=>Date.now(),random=Math.random,setTimer=setTimeout,clearTimer=clearTimeout}){
 let timer=null,inFlight=false,stopped=false,failures=0,notBefore=0,idleKey='',currentKey='',lease={key:'',until:0},shared=null;
 const hold=interval*1.5;
 const jitter=ms=>Math.round(ms*(0.9+0.2*random()));
 const cancel=()=>{if(timer!==null){clearTimer(timer);timer=null;}};
 const schedule=ms=>{cancel();if(!stopped)timer=setTimer(()=>{timer=null;tick();},Math.max(0,ms));};
 const post=message=>{try{channel?.postMessage(message);}catch{/* a closed channel only loses the sharing */}};
 const reset=k=>{currentKey=k;failures=0;notBefore=0;idleKey='';lease={key:'',until:0};shared=null;};
 /** A new account key: say hello (the leader answers with its last reading) and wait briefly before a first read. */
 const start=k=>{reset(k);cancel();if(channel){post({type:'hello',key:k});schedule(Math.round(helloWait*(0.5+random())));}else tick();};
 async function tick(){
  if(stopped||inFlight)return;
  const k=key();if(!k||!eligible())return;
  if(k!==currentKey)reset(k);
  if(idleKey===k){if(!active())return;idleKey='';}
  const at=now();
  if(at<notBefore){schedule(notBefore-at);return;}
  if(channel&&lease.key===k&&at<lease.until){schedule(lease.until-at+jitter(interval/10));return;}
  inFlight=true;post({type:'lease',key:k,hold});
  let result;
  try{result=await run();}catch(error){result={ok:false,retryAfter:error?.retryAfter};}finally{inFlight=false;}
  if(stopped)return;
  if(key()!==k){poke();return;}
  if(result?.ok===false){
   failures++;const retry=Number(result.retryAfter),after=Number.isFinite(retry)&&retry>0?Math.min(retry,86400)*1000:0,delay=Math.max(after,jitter(Math.min(maxBackoff,interval*2**failures)));
   notBefore=now()+delay;post({type:'lease',key:k,hold:delay});schedule(delay);return;
  }
  failures=0;notBefore=0;
  if(result?.stale!==true&&result?.skipped!==true){shared={type:'ring',key:k,invites:Array.isArray(result?.invites)?result.invites:[],idle:result?.idle===true,at:now()};post({...shared,hold});}
  if(result?.idle===true){idleKey=k;cancel();return;}
  schedule(jitter(interval));
 }
 /** Re-evaluates after a state change; `force` (the tab became visible) reads now unless a backoff or a lease holds. */
 function poke({force=false}={}){
  if(stopped)return;const k=key();
  if(!k||!eligible()){cancel();return;}
  if(k!==currentKey){start(k);return;}
  if(idleKey===k&&(force||active()))idleKey='';
  if(inFlight)return;
  if(force||timer===null){cancel();tick();}
 }
 function onMessage(event){
  const m=event?.data;if(stopped||!m||typeof m!=='object'||typeof m.key!=='string'||m.key!==key())return;
  if(m.type==='hello'){if(shared?.key===m.key&&now()-shared.at<interval)post({type:'ring',key:shared.key,invites:shared.invites,idle:shared.idle,hold:Math.max(0,hold-(now()-shared.at))});return;}
  const span=Number.isFinite(m.hold)&&m.hold>=0?Math.min(m.hold,86400000):hold;lease={key:m.key,until:now()+span};
  if(m.type==='ring'&&Array.isArray(m.invites)){apply({invites:m.invites,idle:m.idle===true});if(m.idle===true)idleKey=m.key;}
 }
 channel?.addEventListener?.('message',onMessage);
 return {
  poke,
  stop(){stopped=true;cancel();channel?.removeEventListener?.('message',onMessage);try{channel?.close?.();}catch{}},
  /** For tests: the scheduler's view. */
  get state(){return {timer:timer!==null,inFlight,failures,notBefore,idle:idleKey!==''&&idleKey===currentKey,lease:{...lease}};},
 };
}
