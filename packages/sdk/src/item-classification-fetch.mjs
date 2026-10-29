// Classifier-side fetch of a presigned-URL item (item-classification/v1 §5.2; draft, provisional, unsigned). One GET of
// exactly the given URL: no redirects (any 3xx refuses), no credentials, cookies or Referer, only public addresses,
// bounded by the declared size and a deadline no later than the URL's expiry. The transport (`fetch`) is injected and
// MUST check the address it actually connects to (§5.2 rule 2, review M4): a name-only check before the request is
// open to DNS rebinding. `../node/item-classification-fetch-node.mjs` supplies such a transport for Node. This module imports
// nothing runtime-specific.
import {LIMITS,presignedURL,classificationError} from './item-classification.mjs';

const unavailable=message=>classificationError('item_unavailable',message);

export {parseIPv4,parseIPv6,parseAddress,nonPublicAddress} from '../../core/ip-address.mjs';
import {nonPublicAddress} from '../../core/ip-address.mjs';

/** Marks a transport that checks, at connect time and for every connection attempt, that the address it connects to is
 * public (§5.2 rule 2). fetchPresignedItem refuses a transport without it. */
export const CHECKS_CONNECTED_ADDRESS=Symbol.for('bindle.item-classification.checksConnectedAddress');

/**
 * Fetches `item` ({mediaType, size, url: {href, expiresAt}}, already validated) and returns its bytes, or throws
 * `item_unavailable`. `fetch` MUST check the address it connects to (it carries CHECKS_CONNECTED_ADDRESS); a runtime
 * that cannot do that cannot offer the `url` input. `checkHost(hostname)`, optional, is an early refusal only: it
 * resolves the host and returns its addresses, every one of which must be public. It is not sufficient on its own,
 * because the transport resolves the name again.
 */
export async function fetchPresignedItem(item,{fetch,checkHost,now,timeoutMs=LIMITS.fetchTimeoutMs}){
 if(typeof fetch!=='function'||fetch[CHECKS_CONNECTED_ADDRESS]!==true)throw new TypeError('fetchPresignedItem needs a fetch that checks the connected address');
 if(checkHost!==undefined&&typeof checkHost!=='function')throw new TypeError('checkHost must be a function');
 let url;try{url=presignedURL(item.url,{now:now()});}catch{throw unavailable('The presigned URL is no longer usable.');}
 if(checkHost){
  let addresses;try{addresses=await checkHost(url.hostname);}catch{throw unavailable('The item host could not be resolved.');}
  if(!Array.isArray(addresses)||!addresses.length||addresses.some(nonPublicAddress))throw unavailable('The item host is not a public address.');
 }
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
  // Streamed with a running cap (review I5): memory grows with the bytes actually received, never with the declared size.
  const chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array))throw unavailable('The item could not be read.');if(length+value.byteLength>item.size)throw unavailable('The item is larger than declared.');chunks.push(value);length+=value.byteLength;}}
  catch(error){await reader.cancel().catch(()=>{});if(error?.code==='item_unavailable')throw error;throw unavailable('The item could not be read.');}
  if(length!==item.size)throw unavailable('The item is smaller than declared.');
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
 }finally{clearTimeout(timer);}
}
