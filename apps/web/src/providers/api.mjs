import { decode64 } from '../bl/browser-codecs.mjs';
import { Provider } from '../shared/stack.mjs';
export default class APIProvider extends Provider {
  #resource=createAPI({storage:(()=>{try{return globalThis.sessionStorage??null;}catch{return null;}})()});
  async obtain(){return this.#resource;}
  release(){}
  // Page teardown forgets memory only; the tab's stored selector survives reload.
  dispose(){this.#resource.clearContext({keepSelection:true});}
}
// Per-tab selection survives reload as a non-secret {owner,sessionContext}
// selector in sessionStorage; CSRF and session bearers never leave memory.
const selectionKey='3sln-account-selection';
function restoreSelection(storage){try{const value=JSON.parse(storage?.getItem(selectionKey)??'null');return value&&/^[0-9a-f-]{36}$/.test(value.owner)&&typeof value.sessionContext==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value.sessionContext)?value:null;}catch{return null;}}
// Browser transport errors ("Failed to fetch", "Load failed", …) are engine-specific and unlocalized.
// Aborts and timeouts keep their identity; anything else becomes one honest, translatable failure:
// a non-GET request may already have reached the service, so its outcome is reported as unknown.
function transportFailure(error,method){if(error?.name==='AbortError'||error?.name==='TimeoutError')return error;return Object.assign(new Error(method==='GET'?'The service could not be reached. Check your connection and try again.':'The connection was interrupted before the service replied. Check whether your request went through before trying again.'),{code:'network_unavailable',cause:error});}
function persistSelection(storage,owner,sessionContext){try{if(owner&&sessionContext)storage?.setItem(selectionKey,JSON.stringify({owner,sessionContext}));else storage?.removeItem(selectionKey);}catch{}}
// Reads a contact-profile representation: the permitted fields, null when none are shared, or undefined when the
// answer is not a readable profile representation (wrong type, oversized, malformed).
async function readContactProfile(response){
  if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/vnd.bindle.contact-profile+json'||Number(response.headers.get('content-length'))>8192){await response.body?.cancel();return undefined;}
  const reader=response.body?.getReader();if(!reader)return undefined;const decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0,complete=false;
  try{for(;;){const {done,value}=await reader.read();if(done){complete=true;break;}bytes+=value.byteLength;if(bytes>8192)return undefined;text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}catch{return undefined;}finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
  let value;try{value=JSON.parse(text);}catch{return undefined;}if(!value||typeof value!=='object')return undefined;value=value.profile;if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const profile={};for(const [key,max] of [['displayName',100],['bio',500]])if(Object.hasOwn(value,key)&&typeof value[key]==='string'&&value[key].trim()&&value[key].length<=max)profile[key]=value[key];
  if(Object.hasOwn(value,'avatar')&&typeof value.avatar==='string'&&value.avatar.length<=2048)try{const url=new URL(value.avatar);if(url.protocol==='https:'&&!url.username&&!url.password)profile.avatar=url.href;}catch{}
  return Object.keys(profile).length?profile:null;
}
// A request that never answers must not hold the console busy forever (no stuck spinners).
export function createAPI({storage=null,timeout=60000}={}){const restored=restoreSelection(storage);return {
  csrf:null,account:restored?.owner??null,sessionContext:restored?.sessionContext??null,contextGeneration:0,
  captureContext(){return {owner:this.account,sessionContext:this.sessionContext,csrfToken:this.csrf};},
  setContext(result){if(this.account===(result?.account?.id??null)&&this.sessionContext===(typeof result?.sessionContext==='string'?result.sessionContext:null)&&this.csrf===(result?.csrfToken??null))return;this.contextGeneration++;this.account=result?.account?.id??null;this.sessionContext=typeof result?.sessionContext==='string'?result.sessionContext:null;this.csrf=result?.csrfToken??null;persistSelection(storage,this.account,this.sessionContext);},
  clearContext({keepSelection=false}={}){this.contextGeneration++;this.account=null;this.sessionContext=null;this.csrf=null;if(!keepSelection)persistSelection(storage,null,null);},
  async get(path,options){return this.request(path,undefined,'GET',options);},
  async request(path,body,method='POST',{signal,dispatchToken,context}={}){
    const dispatch=dispatchToken!==undefined,generation=this.contextGeneration,binding=context===undefined?this.captureContext():context,deadline=dispatch?null:AbortSignal.timeout(timeout);
    if(dispatch&&(typeof dispatchToken!=='string'||dispatchToken.length>65536||!/^[A-Za-z0-9._-]+$/.test(dispatchToken)||!/^\/api\/messages\/[0-9a-f-]{36}\/postbacks$/.test(path)||method!=='POST'||JSON.stringify(body)!=='{}'))throw Error('Invalid message dispatch');
    let response;try{response=await fetch(path,{method,signal:dispatch?(signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)):signal?AbortSignal.any([signal,deadline]):deadline,credentials:dispatch?'omit':'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...dispatch?{Authorization:'Bearer '+dispatchToken}:binding?{...binding.csrfToken?{'X-CSRF-Token':binding.csrfToken}:{},...binding.owner&&binding.sessionContext?{'X-Bindle-Account':binding.owner,'X-Bindle-Session-Context':binding.sessionContext}:{}}:{}},...(body?{body:JSON.stringify(body)}:{})});}catch(error){if(deadline?.aborted&&!signal?.aborted)throw Object.assign(new Error(method==='GET'?'The service did not respond in time. Please try again.':'The service did not respond in time. Check whether your request went through before trying again.'),{code:'request_timeout'});throw transportFailure(error,method);}
    if(dispatch){if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||Number(response.headers.get('content-length'))>262144){await response.body?.cancel();throw Error('Unexpected message dispatch response');}const reader=response.body?.getReader();if(!reader)throw Error('Missing message dispatch response');const decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0,complete=false;try{for(;;){const {done,value}=await reader.read();if(done){complete=true;break;}size+=value.byteLength;if(size>262144)throw Error('Message dispatch response is too large');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}response=new Response(text,{status:response.status,headers:response.headers});}
    if(!dispatch&&generation!==this.contextGeneration){await response.body?.cancel();throw Object.assign(new Error('Account changed. Choose an account to continue.'),{code:'local_account_changed'});}return this.parse(response,{csrf:!dispatch&&context===undefined,live:()=>dispatch||generation===this.contextGeneration,method});
  },
  // Public capability requests never carry cookies, account headers or a referrer.
  async contactPublic(endpoint,init={}){let response;try{response=await fetch(endpoint,{...init,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});}catch(error){throw transportFailure(error,init.method??'GET');}return this.parse(response,{csrf:false,method:init.method??'GET'});},
  // The owner-permitted profile of a contact link, or null when none is shared or the link cannot be described.
  async contactProfile(endpoint){try{const result=await this.contactLanding(endpoint);return result.valid?result.profile:null;}catch{return null;}},
  // The contact-link landing description (links §9): the profile representation also verifies the link. A refused link
  // (400/404/406/410) is {valid:false}; a verified link is {valid:true,profile} (profile null when nothing is shared).
  // Any other answer is a retryable failure. Credentialless, no referrer, bounded size and time.
  async contactLanding(endpoint){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
    try{
      let response;try{response=await fetch(endpoint,{signal:controller.signal,headers:{Accept:'application/vnd.bindle.contact-profile+json'},credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});}catch(error){if(controller.signal.aborted)throw Object.assign(new Error('The service did not respond in time. Please try again.'),{code:'request_timeout'});throw transportFailure(error,'GET');}
      if([400,404,406,410].includes(response.status)){await response.body?.cancel();return {valid:false};}
      if(!response.ok){await response.body?.cancel();const retry=Number(response.headers.get('Retry-After'));throw Object.assign(new Error(response.status===429?'Too many requests. Wait a moment, then try again.':'This contact link could not be checked right now. Try again shortly.'),{status:response.status,...response.status===429?{code:'rate_limited'}:{},...Number.isSafeInteger(retry)&&retry>0&&retry<=86400?{retryAfter:retry}:{}});}
      const profile=await readContactProfile(response);if(profile===undefined)throw new Error('This contact link could not be checked right now. Try again shortly.');
      return {valid:true,profile};
    }finally{clearTimeout(timeout);}
  },
  // A successful status with an unreadable body is not a rejection: a mutation may have been applied,
  // so it carries no status (callers treat status<500 as a definite refusal) and says so.
  async parse(response,{csrf=true,live=()=>true,method='GET'}={}){let result;try{result=await response.json();}catch{if(!live())throw Object.assign(new Error('Account changed. Choose an account to continue.'),{code:'local_account_changed'});if(response.ok)throw Object.assign(new Error(method==='GET'?'The service returned an unexpected response. Please try again.':'The service replied, but the reply could not be read. Check whether your request went through before trying again.'),{code:'response_unreadable'});const error=new Error(`The service returned an unexpected response (${response.status}).`);error.status=response.status;throw error;}if(!live())throw Object.assign(new Error('Account changed. Choose an account to continue.'),{code:'local_account_changed'});if(!response.ok){const error=new Error(result?.message??result?.error?.message??(response.status===429?'Too many requests. Wait a moment, then try again.':typeof result?.error==='string'?result.error:'The request could not be completed.'));error.status=response.status;const code=result?.code??result?.error?.code??(typeof result?.error==='string'?result.error:undefined);if(typeof code==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(code))error.code=code;if(code==='signup_capacity_reached'&&['free','global'].includes(result?.capacity))error.capacity=result.capacity;const retry=result?.retryAfter??result?.error?.retryAfter??Number(response.headers.get('Retry-After'));if(Number.isSafeInteger(retry)&&retry>0&&retry<=86400)error.retryAfter=retry;throw error;}if(csrf&&result.csrfToken)this.csrf=result.csrfToken;return result;}
};}
