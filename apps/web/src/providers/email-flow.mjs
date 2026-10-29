// The original tab's browser resource for the cross-device email flow (sign-in and intents spike §4.1, §4.5; P3).
// It owns the per-flow secret S (memory and this tab's sessionStorage, so a reload or tab discard keeps the flow; never
// a cookie, a URL or another tab), the BroadcastChannel listener whose messages are wake-ups only, and the sign-up
// binding a same-browser helper may hand to this tab after "sign in here instead". The business logic is in
// bl/email-flow.mjs; nothing here talks to the server.
import {Provider} from '../shared/stack.mjs';
import {createFlowSecret,acceptWake,ackMessage,validStoredFlow,EMAIL_FLOW_CHANNEL,EMAIL_FLOW_STORE} from '../shared/email-flow.mjs';
export const EMAIL_SIGNUP_STORE='3sln-email-signup';
const SIGNUP_TOKEN=/^es1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;

export function createEmailFlowResource({storage=globalThis.sessionStorage,Channel=globalThis.BroadcastChannel,now=()=>Date.now(),crypto=globalThis.crypto}={}){
 let prepared=null,flow=null,channel=null,signup=null;const listeners=new Set();
 const read=key=>{try{return JSON.parse(storage?.getItem(key)??'null');}catch{return null;}};
 const write=(key,value)=>{try{if(value===null)storage?.removeItem(key);else storage?.setItem(key,JSON.stringify(value));}catch{}};
 const stored=()=>{if(flow&&validStoredFlow(flow,now()))return flow;const value=read(EMAIL_FLOW_STORE);if(validStoredFlow(value,now())){flow=value;return flow;}if(value)write(EMAIL_FLOW_STORE,null);flow=null;return null;};
 const close=()=>{try{channel?.close();}catch{}channel=null;};
 const listen=()=>{if(channel||typeof Channel!=='function'||!stored())return;try{channel=new Channel(EMAIL_FLOW_CHANNEL);}catch{channel=null;return;}
  channel.onmessage=event=>{const current=stored();if(!current||!acceptWake(event.data,current))return;try{channel.postMessage(ackMessage(current));}catch{}for(const listener of listeners)try{listener();}catch{}};};
 const resource={
  /** A fresh S for a flow about to start; only its hash and T leave this resource. */
  async prepare(){prepared=await createFlowSecret(crypto);return {secretHash:prepared.secretHash,channelTag:prepared.channelTag};},
  /** Keeps the started flow (the server's answer to start) with the prepared S. */
  begin({flowId,expiresIn,interval,email}){if(!prepared)throw new Error('Start again.');flow={v:1,flowId,secret:prepared.secret,channelTag:prepared.channelTag,email,expiresAt:now()+Math.min(900,Number(expiresIn)||0)*1000,interval:Number(interval)||3};prepared=null;if(!validStoredFlow(flow,now())){flow=null;throw new Error('Start again.');}write(EMAIL_FLOW_STORE,flow);listen();return {email,expiresAt:flow.expiresAt,interval:flow.interval};},
  /** The flow this tab holds, without its secret, or null. */
  current(){const value=stored();if(value)listen();return value?{flowId:value.flowId,email:value.email,expiresAt:value.expiresAt,interval:value.interval}:null;},
  /** {flowId, secret} for status, redeem, resend and cancel. */
  proof(){const value=stored();return value?{flowId:value.flowId,secret:value.secret}:null;},
  clear(){flow=null;prepared=null;write(EMAIL_FLOW_STORE,null);close();},
  /** Wake-ups for this tab's flow (already checked against its T). Returns the unsubscribe function. */
  onWake(listener){listeners.add(listener);listen();return ()=>listeners.delete(listener);},
  /** The single-use sign-up binding from a redeemed create-account link: kept in memory, or in this tab's sessionStorage
   * when the helper page signed up "here instead" and handed over to the console. */
  keepSignup(value){signup=value&&SIGNUP_TOKEN.test(value.signupToken??'')?{signupToken:value.signupToken,maskedAddress:String(value.maskedAddress??''),expiresAt:Number(value.expiresAt)||0}:null;},
  signup(){if(signup&&signup.expiresAt>now())return signup;const value=read(EMAIL_SIGNUP_STORE);write(EMAIL_SIGNUP_STORE,null);if(value&&SIGNUP_TOKEN.test(value.signupToken??'')&&Number(value.expiresAt)>now()){signup={signupToken:value.signupToken,maskedAddress:String(value.maskedAddress??''),expiresAt:Number(value.expiresAt)};return signup;}signup=null;return null;},
  dropSignup(){signup=null;write(EMAIL_SIGNUP_STORE,null);},
  dispose(){listeners.clear();close();},
 };
 return resource;
}
export default class EmailFlowProvider extends Provider {
 #resource;
 constructor(){super();this.#resource=createEmailFlowResource();}
 async obtain(){return this.#resource;}
 release(){}
 dispose(){this.#resource.dispose();}
}
