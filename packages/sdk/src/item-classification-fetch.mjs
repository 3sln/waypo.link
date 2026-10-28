// Classifier-side fetch of a presigned-URL item (item-classification/v1 §5.2; draft, provisional, unsigned). One GET of
// exactly the given URL: no redirects (any 3xx refuses), no credentials, cookies or Referer, only non-public addresses
// refused, bounded by the declared size and a deadline no later than the URL's expiry. The transport (`fetch`) and the
// address check (`checkHost`) are injected, so tests are network-free and each runtime supplies its own resolver.
import {LIMITS,presignedURL,classificationError} from './item-classification.mjs';

const unavailable=message=>classificationError('item_unavailable',message);
/** True for an address literal a classifier must never fetch from: loopback, private, link-local, CGNAT, multicast,
 * reserved and their IPv6 counterparts (including IPv4-mapped forms). */
export function nonPublicAddress(address){
 const v4=String(address).replace(/^::ffff:/i,'');
 const m=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
 if(m){const [a,b]=[Number(m[1]),Number(m[2])];return a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===192&&b===0||a===198&&(b===18||b===19);}
 const v6=String(address).toLowerCase();
 if(!v6.includes(':'))return true;
 return v6==='::'||v6==='::1'||/^f[cd]/.test(v6)||/^fe[89ab]/.test(v6)||/^ff/.test(v6)||v6.startsWith('64:ff9b:')||v6.startsWith('2001:db8');
}
/**
 * Fetches `item` ({mediaType, size, url: {href, expiresAt}}, already validated) and returns its bytes, or throws
 * `item_unavailable`. `checkHost(hostname)` resolves the host and returns its addresses; every one must be public. A
 * runtime that cannot resolve names itself MUST supply a `checkHost` that applies its platform's equivalent control.
 */
export async function fetchPresignedItem(item,{fetch,checkHost,now,timeoutMs=LIMITS.fetchTimeoutMs}){
 if(typeof fetch!=='function'||typeof checkHost!=='function')throw new TypeError('fetchPresignedItem needs fetch and checkHost');
 let url;try{url=presignedURL(item.url,{now:now()});}catch{throw unavailable('The presigned URL is no longer usable.');}
 let addresses;try{addresses=await checkHost(url.hostname);}catch{throw unavailable('The item host could not be resolved.');}
 if(!Array.isArray(addresses)||!addresses.length||addresses.some(nonPublicAddress))throw unavailable('The item host is not a public address.');
 const budget=Math.min(timeoutMs,LIMITS.fetchTimeoutMs,item.url.expiresAt-now());if(budget<=0)throw unavailable('The presigned URL has expired.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),budget);
 try{
  let response;
  try{response=await fetch(url.href,{method:'GET',redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',headers:{Accept:item.mediaType},signal:controller.signal});}
  catch{throw unavailable('The item could not be fetched.');}
  // Only a plain 200 counts. A redirect is never followed, whatever its target (§5.2 rule 3).
  if(response.status!==200||response.type==='opaqueredirect'||response.redirected)throw unavailable('The item could not be fetched.');
  const declared=response.headers?.get?.('content-length');
  if(declared!==null&&declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)!==item.size))throw unavailable('The item size does not match.');
  const reader=response.body?.getReader?.();if(!reader)throw unavailable('The item could not be read.');
  const bytes=new Uint8Array(item.size);let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if(length+value.byteLength>item.size)throw unavailable('The item is larger than declared.');bytes.set(value,length);length+=value.byteLength;}}
  catch(error){await reader.cancel().catch(()=>{});if(error?.code==='item_unavailable')throw error;throw unavailable('The item could not be read.');}
  if(length!==item.size)throw unavailable('The item is smaller than declared.');
  return bytes;
 }finally{clearTimeout(timer);}
}
